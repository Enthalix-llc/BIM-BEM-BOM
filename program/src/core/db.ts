// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// ifc.db — the module contract (references/architecture.md). sql.js keeps the
// build free of native modules; the exported bytes are a standard SQLite file
// any downstream module (BEM, BOM, CFD) opens directly.

import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import type { ExtractRun, TypeMeta, TypeLayer } from "./ifcStream.js";
import type { Choices, IdfFaceOut } from "./collapse.js";
import type { WallQARow } from "./wallQA.js";
import type { VoidQaRow, VoidFlag, VoidVerdict } from "./voidQa.js";
import type { PlacedOpening } from "./placeOpenings.js";

let sqlPromise: Promise<SqlJsStatic> | null = null;
export function getSql(locateFile: (f: string) => string): Promise<SqlJsStatic> {
  if (!sqlPromise) sqlPromise = initSqlJs({ locateFile });
  return sqlPromise;
}

// 1 µm. NOT 0.1 mm: that is the same scale as the weld the open-edge
// instrument uses, so a stored coordinate could land far enough off its plane
// to fail the contact test — reading idf.db back reported 83 m more leak than
// the same geometry in memory (2026-08-31). The DB is the contract; it must
// not lose what the maths produced.
const round6 = (v: number): number => Math.round(v * 1e6) / 1e6;
const loopJson = (loop: Array<[number, number, number]>): string =>
  JSON.stringify(loop.map((p) => [round6(p[0]), round6(p[1]), round6(p[2])]));

export function buildIfcDb(
  SQL: SqlJsStatic,
  run: ExtractRun,
  meta: { sourceName: string; sourceSha256: string },
): Database {
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE elements (
      id INTEGER PRIMARY KEY, global_id TEXT, ifc_class TEXT, name TEXT, storey TEXT,
      storey_elev_m REAL,
      is_external INTEGER,
      -- the element's PredefinedType as the file states it (CEILING, …)
      predefined_type TEXT,
      -- the IfcSpace names this element bounds, as the FILE states them:
      -- "Yard", "ADU + ADU Bath". The user names defects this way.
      spaces TEXT,
      -- Pset_DoorCommon / Pset_WindowCommon.GlazingAreaFraction as the file
      -- states it (NULL = not stated), and whether a Pset_DoorWindowGlazingType
      -- is attached — the file's own word on what is glass
      glazing_fraction REAL,
      glazing_pset INTEGER,
      -- IfcDoor / IfcWindow OverallWidth and OverallHeight as the file states
      -- them, in metres — the OPENING's size, which the leaf's geometry is not
      overall_width_m REAL,
      overall_height_m REAL,
      -- the element's TYPE (schema 3, 2026-09-08): element_types carries the
      -- type's stated U and its material layer set, read from the file
      type_id INTEGER
    );
    CREATE TABLE faces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      element_id INTEGER NOT NULL REFERENCES elements(id),
      nx REAL, ny REAL, nz REAL,
      area_m2 REAL NOT NULL,
      rgba INTEGER NOT NULL,
      source TEXT NOT NULL,
      outer TEXT NOT NULL,
      holes TEXT NOT NULL
    );
    CREATE INDEX faces_element ON faces(element_id);
    -- the rooms. Named the way the user names things, and for BEM these are
    -- the thermal zones. color_index is stored so EVERY view colours a space
    -- identically without agreeing on anything else.
    CREATE TABLE spaces (
      id INTEGER PRIMARY KEY, global_id TEXT, name TEXT, long_name TEXT,
      color_index INTEGER NOT NULL,
      -- the storey that aggregates this space, and its stated elevation
      storey TEXT, storey_elev_m REAL
    );
    CREATE TABLE space_faces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id INTEGER NOT NULL REFERENCES spaces(id),
      nx REAL, ny REAL, nz REAL, area_m2 REAL NOT NULL, outer TEXT NOT NULL, holes TEXT NOT NULL
    );
    CREATE INDEX space_faces_space ON space_faces(space_id);
  `);
  const now = new Date().toISOString();
  const mput = db.prepare("INSERT INTO meta VALUES (?, ?)");
  for (const [k, v] of Object.entries({
    schema_version: "3",
    source_name: meta.sourceName,
    source_sha256: meta.sourceSha256,
    thermal_transmittance_unit: run.uUnit ?? "",
    axes: "Y_UP_METRES_WEBIFC",
    true_north: run.trueNorth ? `${run.trueNorth[0]},${run.trueNorth[1]}` : "",
    address: run.address ?? "",
    project_global_id: run.project?.globalId ?? "",
    project_name: run.project?.name ?? "",
    project_long_name: run.project?.longName ?? "",
    created_at: now,
  })) mput.run([k, v]);
  mput.free();

  const eput = db.prepare("INSERT INTO elements VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const e of run.elements)
    eput.run([e.expressId, e.globalId, e.ifcClass, e.name, e.storey ?? null,
      e.storeyElevM ?? null,
      e.isExternal === null ? null : e.isExternal ? 1 : 0,
      e.predefinedType ?? null,
      e.spaces.length ? e.spaces.join(" + ") : null,
      e.glazingFraction ?? null,
      e.glazingPset ? 1 : 0,
      e.overallWidthM ?? null,
      e.overallHeightM ?? null,
      e.typeId ?? null]);
  eput.free();
  writeElementTypes(db, run.types ?? []);

  const sput = db.prepare("INSERT INTO spaces VALUES (?, ?, ?, ?, ?, ?, ?)");
  const sfput = db.prepare(
    "INSERT INTO space_faces (space_id, nx, ny, nz, area_m2, outer, holes) VALUES (?,?,?,?,?,?,?)",
  );
  db.run("BEGIN");
  for (const sp of run.spaces) {
    sput.run([sp.expressId, sp.globalId, sp.name, sp.longName, sp.colorIndex, sp.storey ?? null, sp.storeyElevM ?? null]);
    for (const f of sp.faces) {
      sfput.run([sp.expressId, round6(f.n[0]), round6(f.n[1]), round6(f.n[2]),
        f.areaM2, loopJson(f.outer), JSON.stringify(f.holes.map((h) => JSON.parse(loopJson(h))))]);
    }
  }
  db.run("COMMIT");
  sput.free(); sfput.free();

  const fput = db.prepare(
    "INSERT INTO faces (element_id, nx, ny, nz, area_m2, rgba, source, outer, holes) VALUES (?,?,?,?,?,?,?,?,?)",
  );
  db.run("BEGIN");
  for (const f of run.faces) {
    fput.run([
      f.expressId, round6(f.n[0]), round6(f.n[1]), round6(f.n[2]),
      f.areaM2, f.rgba, f.source, loopJson(f.outer),
      JSON.stringify(f.holes.map((h) => JSON.parse(loopJson(h)))),
    ]);
  }
  db.run("COMMIT");
  fput.free();
  return db;
}

/** THE GROUND IN THE DATABASE. The site model's terrain triangles, turned
 *  into the house frame, as one Float32 row (x,y,z × 3 per triangle) with
 *  the site file's sha and the rotation applied — a documented blob rather
 *  than 320,000 rows, so the app reads it in one query. */
export function writeTerrain(
  db: Database,
  tris: Float32Array,
  meta: { siteName: string; siteSha256: string; rotationDeg: number },
): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS terrain (
      id INTEGER PRIMARY KEY,
      site_name TEXT NOT NULL, site_sha256 TEXT NOT NULL,
      rotation_deg REAL NOT NULL, triangles INTEGER NOT NULL,
      -- Float32 little-endian, 9 values per triangle, metres, Y-up, house frame
      xyz BLOB NOT NULL
    );
    DELETE FROM terrain;
  `);
  const put = db.prepare("INSERT INTO terrain (site_name, site_sha256, rotation_deg, triangles, xyz) VALUES (?,?,?,?,?)");
  put.run([meta.siteName, meta.siteSha256, meta.rotationDeg, tris.length / 9, new Uint8Array(tris.buffer, tris.byteOffset, tris.byteLength)]);
  put.free();
}

export function queryTerrain(db: Database): { tris: Float32Array; siteName: string; siteSha256: string; rotationDeg: number } | null {
  const has = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='terrain'");
  if (!has.length || !has[0]!.values.length) return null;
  const st = db.prepare("SELECT site_name, site_sha256, rotation_deg, xyz FROM terrain LIMIT 1");
  let out: ReturnType<typeof queryTerrain> = null;
  if (st.step()) {
    const r = st.get() as [string, string, number, Uint8Array];
    const bytes = r[3];
    const tris = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    out = { tris, siteName: r[0], siteSha256: r[1], rotationDeg: r[2] };
  }
  st.free();
  return out;
}

/** ABOVE AND BELOW GRADE, per exterior wall element — the same rows in
 *  ifc.db and idf.db, so either file answers "how much of this wall is in
 *  the ground" (the user, 2026-09-03). fill_m2 is the part of below_m2 that
 *  concrete on fill, not the terrain, put under ground. */
export function writeWallGrade(
  db: Database,
  rows: Array<{ elementId: number; aboveM2: number; belowM2: number; fillM2: number; gradeMinM: number; gradeMaxM: number; samples: number }>,
): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS wall_grade (
      element_id INTEGER PRIMARY KEY,
      above_m2 REAL NOT NULL, below_m2 REAL NOT NULL, fill_m2 REAL NOT NULL,
      grade_min_m REAL NOT NULL, grade_max_m REAL NOT NULL, samples INTEGER NOT NULL
    );
    DELETE FROM wall_grade;
  `);
  const put = db.prepare("INSERT OR REPLACE INTO wall_grade VALUES (?,?,?,?,?,?,?)");
  db.run("BEGIN");
  const byEl = new Map<number, typeof rows[number]>();
  for (const r of rows) {
    const a = byEl.get(r.elementId);
    if (a) { a.aboveM2 += r.aboveM2; a.belowM2 += r.belowM2; a.fillM2 += r.fillM2; a.gradeMinM = Math.min(a.gradeMinM, r.gradeMinM); a.gradeMaxM = Math.max(a.gradeMaxM, r.gradeMaxM); a.samples += r.samples; }
    else byEl.set(r.elementId, { ...r });
  }
  for (const r of byEl.values()) put.run([r.elementId, round6(r.aboveM2), round6(r.belowM2), round6(r.fillM2), round6(r.gradeMinM), round6(r.gradeMaxM), r.samples]);
  db.run("COMMIT");
  put.free();
}

/** THE FILL LIST — the concrete elements ruled to stand on earth, so the
 *  views can draw that earth in the terrain's colour and a downstream module
 *  knows which slabs are on grade. In ifc.db and idf.db alike. */
export function writeFills(db: Database, fills: Array<{ elementId: number; name: string; topM: number }>): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS fill_elements (element_id INTEGER PRIMARY KEY, name TEXT NOT NULL, top_m REAL NOT NULL);
    DELETE FROM fill_elements;
  `);
  const put = db.prepare("INSERT OR REPLACE INTO fill_elements VALUES (?,?,?)");
  for (const f of fills) put.run([f.elementId, f.name, round6(f.topM)]);
  put.free();
}

/** THE SITE'S SHADING ELEMENTS (2026-09-05): every non-terrain product of the
 *  site file, in the house frame, one row each — trees, ties, dock, walls */
/** A SITE ELEMENT ROW (schema 7, 2026-09-07): elements may come from several
 *  files beside the house — the site model and a shade model (the MEP file's
 *  PV panels) — so each carries the file it came from and its express id
 *  THERE; `expressId` is the row's unique key across files (the file's own
 *  id for the first file, offset by FILE_ID_STRIDE per further file), which
 *  every pick, hide and delete uses. */
export const FILE_ID_STRIDE = 100_000_000;
export interface SiteElementRow { expressId: number; file: string; fileExpressId: number; name: string; ifcClass: string; tris: number; xyz: Float32Array }
export function writeSiteElements(db: Database, els: Array<{ expressId: number; file?: string; fileExpressId?: number; name: string; ifcClass: string; xyz: Float32Array }>): void {
  db.run(`
    DROP TABLE IF EXISTS site_elements;
    CREATE TABLE site_elements (express_id INTEGER PRIMARY KEY, file TEXT NOT NULL, file_express_id INTEGER NOT NULL, name TEXT NOT NULL, ifc_class TEXT NOT NULL, tris INTEGER NOT NULL, xyz BLOB NOT NULL);
  `);
  const put = db.prepare("INSERT INTO site_elements VALUES (?,?,?,?,?,?,?)");
  for (const e of els) put.run([e.expressId, e.file ?? "", e.fileExpressId ?? e.expressId, e.name, e.ifcClass, e.xyz.length / 9, new Uint8Array(e.xyz.buffer, e.xyz.byteOffset, e.xyz.byteLength)]);
  put.free();
}
export function querySiteElements(db: Database): SiteElementRow[] {
  const out: SiteElementRow[] = [];
  const has = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='site_elements'");
  if (!has.length || !has[0]!.values.length) return out;
  const st = db.prepare("SELECT express_id, file, file_express_id, name, ifc_class, tris, xyz FROM site_elements ORDER BY express_id");
  while (st.step()) {
    const r = st.get() as [number, string, number, string, string, number, Uint8Array];
    const b = r[6];
    out.push({ expressId: r[0], file: r[1], fileExpressId: r[2], name: r[3], ifcClass: r[4], tris: r[5], xyz: new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) });
  }
  st.free();
  return out;
}
/** THE SERVICES INVENTORY (2026-09-10, idf.db schema 9): every element of a projected shade file — interior
 *  INCLUDED — with what the file states about it (core/mepRead.ts) and the room it lies in; the SYSTEMS tab's
 *  instrument. `site_elements` above stays the shading set, so a PV panel is in both, one row per purpose. */
export interface MepElementRow {
  expressId: number; file: string; fileExpressId: number; globalId: string | null;
  name: string; kind: string; ifcClass: string; predefinedType: string | null; typeName: string | null;
  discipline: string; interior: boolean; room: string | null; storey: string | null;
  systems: Array<{ name: string; predefinedType: string }>;
  uniformat: string | null; manufacturer: string | null; model: string | null;
  wattageW: number | null; powerW: number | null;
  props: Record<string, string | number | boolean>;
  cx: number; cy: number; cz: number;
  /** the geometry kept — the file's mesh, or its box past MEP_TRI_CAP — and the file's own triangle count */
  lod: "mesh" | "box"; fileTris: number;
  tris: number; xyz: Float32Array;
}
export interface MepSystemRow { expressId: number; file: string; name: string; longName: string | null; predefinedType: string; members: number; rooms: Record<string, number> }
export function writeMepElements(db: Database, els: Array<Omit<MepElementRow, "tris">>): void {
  db.run(`
    DROP TABLE IF EXISTS mep_elements;
    CREATE TABLE mep_elements (express_id INTEGER PRIMARY KEY, file TEXT NOT NULL, file_express_id INTEGER NOT NULL, global_id TEXT,
      name TEXT NOT NULL, kind TEXT NOT NULL, ifc_class TEXT NOT NULL, predefined_type TEXT, type_name TEXT,
      discipline TEXT NOT NULL, interior INTEGER NOT NULL, room TEXT, storey TEXT, systems TEXT NOT NULL,
      uniformat TEXT, manufacturer TEXT, model TEXT, wattage_w REAL, power_w REAL, props TEXT NOT NULL,
      cx REAL NOT NULL, cy REAL NOT NULL, cz REAL NOT NULL, lod TEXT NOT NULL, file_tris INTEGER NOT NULL, tris INTEGER NOT NULL, xyz BLOB NOT NULL);
  `);
  const put = db.prepare("INSERT INTO mep_elements VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  db.run("BEGIN");
  for (const e of els) put.run([e.expressId, e.file, e.fileExpressId, e.globalId, e.name, e.kind, e.ifcClass, e.predefinedType, e.typeName, e.discipline, e.interior ? 1 : 0, e.room, e.storey,
    JSON.stringify(e.systems), e.uniformat, e.manufacturer, e.model, e.wattageW, e.powerW, JSON.stringify(e.props), round6(e.cx), round6(e.cy), round6(e.cz), e.lod, e.fileTris, e.xyz.length / 9,
    new Uint8Array(e.xyz.buffer, e.xyz.byteOffset, e.xyz.byteLength)]);
  db.run("COMMIT");
  put.free();
}
/** the inventory read back; `withXyz` false leaves the triangles in the file (the resolver needs none of them) */
export function queryMepElements(db: Database, withXyz = true): MepElementRow[] {
  const out: MepElementRow[] = [];
  const has = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='mep_elements'");
  if (!has.length || !has[0]!.values.length) return out;
  const st = db.prepare(`SELECT express_id, file, file_express_id, global_id, name, kind, ifc_class, predefined_type, type_name, discipline, interior, room, storey, systems, uniformat, manufacturer, model, wattage_w, power_w, props, cx, cy, cz, lod, file_tris, tris${withXyz ? ", xyz" : ""} FROM mep_elements ORDER BY express_id`);
  while (st.step()) {
    const r = st.get() as [number, string, number, string | null, string, string, string, string | null, string | null, string, number, string | null, string | null, string, string | null, string | null, string | null, number | null, number | null, string, number, number, number, string, number, number, Uint8Array | undefined];
    const b = r[26];
    out.push({ expressId: r[0], file: r[1], fileExpressId: r[2], globalId: r[3], name: r[4], kind: r[5], ifcClass: r[6], predefinedType: r[7], typeName: r[8], discipline: r[9], interior: r[10] === 1, room: r[11], storey: r[12],
      systems: JSON.parse(r[13]) as MepElementRow["systems"], uniformat: r[14], manufacturer: r[15], model: r[16], wattageW: r[17], powerW: r[18], props: JSON.parse(r[19]) as MepElementRow["props"],
      cx: r[20], cy: r[21], cz: r[22], lod: r[23] as "mesh" | "box", fileTris: r[24], tris: r[25], xyz: b ? new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) : new Float32Array(0) });
  }
  st.free();
  return out;
}
/** THE SYSTEMS DIAGRAM (2026-09-10, idf.db schema 10): the sheet the user drew on SYSTEMS › MECHANICAL — a row per component
 *  (its kind, its ID, its name, its place, the user's fields, what is attached to it, the file's element it came from), a row
 *  per connector (the two components and their ports, the corners as routed) and a row per zone assigned to a component. The
 *  BEM ledger keyed to the file is the source, replayed on every load; these tables are its copy in the contract, like the
 *  edits and step_decisions the corrections ledger keeps — written on every rebuild and by the SYSTEMS column's Save. */
/** `cls` (schema 12, 2026-09-12): a catalogue card's EnergyPlus class — a component card read back from the rows without it had no class */
export interface SystemComponentRow { id: string; kind: string; ident: string | null; label: string | null; x: number; y: number; fields: string | null; attached: string | null; vent: string | null; fromFile: string | null; rooms: string | null; collapsed: number; cls: string | null;
  /** a Zone card's thermostat (schema 13, 2026-09-12): 1 on, 0 off — served, not controlled */
  thermostat: number }
/** a room held by a Zone component (2026-09-10, schema 11) */
export interface SystemRoomRow { room: string; component: string }
export interface SystemConnectorRow { id: string; fromId: string; fromPort: string | null; toId: string; toPort: string | null; points: string | null }
export interface SystemZoneRow { zone: string; component: string }
export interface SystemsDiagramRows { components: SystemComponentRow[]; connectors: SystemConnectorRow[]; zones: SystemZoneRow[]; rooms: SystemRoomRow[] }
export const EMPTY_DIAGRAM: SystemsDiagramRows = { components: [], connectors: [], zones: [], rooms: [] };
export function writeSystemsDiagram(db: Database, d: SystemsDiagramRows): void {
  db.run(`
    DROP TABLE IF EXISTS system_components; DROP TABLE IF EXISTS system_connectors; DROP TABLE IF EXISTS system_zones; DROP TABLE IF EXISTS system_rooms;
    CREATE TABLE system_components (id TEXT PRIMARY KEY, kind TEXT NOT NULL, ident TEXT, label TEXT, x REAL NOT NULL, y REAL NOT NULL, fields TEXT, attached TEXT, vent TEXT, from_file TEXT, rooms TEXT, collapsed INTEGER NOT NULL DEFAULT 0, cls TEXT, thermostat INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE system_rooms (room TEXT PRIMARY KEY, component TEXT NOT NULL);
    CREATE TABLE system_connectors (id TEXT PRIMARY KEY, from_id TEXT NOT NULL, from_port TEXT, to_id TEXT NOT NULL, to_port TEXT, points TEXT);
    CREATE TABLE system_zones (zone TEXT NOT NULL, component TEXT NOT NULL, PRIMARY KEY (zone, component));
  `);
  const pc = db.prepare("INSERT INTO system_components VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  for (const c of d.components) pc.run([c.id, c.kind, c.ident, c.label, c.x, c.y, c.fields, c.attached, c.vent, c.fromFile, c.rooms, c.collapsed, c.cls, c.thermostat]);
  pc.free();
  const pr = db.prepare("INSERT OR IGNORE INTO system_rooms VALUES (?,?)");
  for (const r of d.rooms) pr.run([r.room, r.component]);
  pr.free();
  const pk = db.prepare("INSERT INTO system_connectors VALUES (?,?,?,?,?,?)");
  for (const k of d.connectors) pk.run([k.id, k.fromId, k.fromPort, k.toId, k.toPort, k.points]);
  pk.free();
  const pz = db.prepare("INSERT OR IGNORE INTO system_zones VALUES (?,?)");
  for (const z of d.zones) pz.run([z.zone, z.component]);
  pz.free();
}
/** the diagram as idf.db holds it, in the order it was written; null when the file predates the tables */
export function querySystemsDiagram(db: Database): SystemsDiagramRows | null {
  const has = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='system_components'");
  if (!has.length || !has[0]!.values.length) return null;
  const s = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
  const out: SystemsDiagramRows = { components: [], connectors: [], zones: [], rooms: [] };
  const v11 = db.exec("SELECT name FROM pragma_table_info('system_components') WHERE name='rooms'").length > 0;
  const v12 = db.exec("SELECT name FROM pragma_table_info('system_components') WHERE name='cls'").length > 0;
  const v13 = db.exec("SELECT name FROM pragma_table_info('system_components') WHERE name='thermostat'").length > 0;
  let st = db.prepare(`SELECT id, kind, ident, label, x, y, fields, attached, vent, from_file${v11 ? ", rooms, collapsed" : ""}${v12 ? ", cls" : ""}${v13 ? ", thermostat" : ""} FROM system_components ORDER BY rowid`);
  while (st.step()) { const r = st.get(); const i12 = v11 ? 12 : 10, i13 = i12 + (v12 ? 1 : 0); out.components.push({ id: String(r[0]), kind: String(r[1]), ident: s(r[2]), label: s(r[3]), x: Number(r[4]), y: Number(r[5]), fields: s(r[6]), attached: s(r[7]), vent: s(r[8]), fromFile: s(r[9]), rooms: v11 ? s(r[10]) : null, collapsed: v11 ? Number(r[11] ?? 0) : 0, cls: v12 ? s(r[i12]) : null, thermostat: v13 ? Number(r[i13] ?? 1) : 1 }); }
  st.free();
  if (v11) { st = db.prepare("SELECT room, component FROM system_rooms ORDER BY rowid"); while (st.step()) { const r = st.get(); out.rooms.push({ room: String(r[0]), component: String(r[1]) }); } st.free(); }
  st = db.prepare("SELECT id, from_id, from_port, to_id, to_port, points FROM system_connectors ORDER BY rowid");
  while (st.step()) { const r = st.get(); out.connectors.push({ id: String(r[0]), fromId: String(r[1]), fromPort: s(r[2]), toId: String(r[3]), toPort: s(r[4]), points: s(r[5]) }); }
  st.free();
  st = db.prepare("SELECT zone, component FROM system_zones ORDER BY rowid");
  while (st.step()) { const r = st.get(); out.zones.push({ zone: String(r[0]), component: String(r[1]) }); }
  st.free();
  return out;
}
export function writeMepSystems(db: Database, rows: MepSystemRow[]): void {
  db.run(`
    DROP TABLE IF EXISTS mep_systems;
    CREATE TABLE mep_systems (express_id INTEGER PRIMARY KEY, file TEXT NOT NULL, name TEXT NOT NULL, long_name TEXT, predefined_type TEXT NOT NULL, members INTEGER NOT NULL, rooms TEXT NOT NULL);
  `);
  const put = db.prepare("INSERT INTO mep_systems VALUES (?,?,?,?,?,?,?)");
  for (const r of rows) put.run([r.expressId, r.file, r.name, r.longName, r.predefinedType, r.members, JSON.stringify(r.rooms)]);
  put.free();
}
export function queryMepSystems(db: Database): MepSystemRow[] {
  const out: MepSystemRow[] = [];
  const has = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='mep_systems'");
  if (!has.length || !has[0]!.values.length) return out;
  const st = db.prepare("SELECT express_id, file, name, long_name, predefined_type, members, rooms FROM mep_systems ORDER BY express_id");
  while (st.step()) {
    const r = st.get() as [number, string, string, string | null, string, number, string];
    out.push({ expressId: r[0], file: r[1], name: r[2], longName: r[3], predefinedType: r[4], members: r[5], rooms: JSON.parse(r[6]) as Record<string, number> });
  }
  st.free();
  return out;
}
/** THE FILES BESIDE THE HOUSE (user, 2026-09-07): every IFC in the opened
 *  file's folder — the site model, a shade model — with what each holds and
 *  whether it is projected into the model; the SITE table reads this back */
export interface SiteFileRow { name: string; sha256: string; bytes: number; kind: "site" | "shade" | "unread"; projected: boolean; terrainTris: number; elements: number; word: string; /** the user's extra turn, ° clockwise (2026-09-15) */ turnDeg: number;
  /** THE PLACEMENT (2026-11-03): the move (metres, the house frame) and the pivot the turn is about — siteAlign.ts */
  dx?: number; dy?: number; dz?: number; pivotX?: number; pivotZ?: number }
export function writeSiteFiles(db: Database, files: SiteFileRow[]): void {
  db.run(`
    DROP TABLE IF EXISTS site_files;
    CREATE TABLE site_files (name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL, kind TEXT NOT NULL, projected INTEGER NOT NULL, terrain_tris INTEGER NOT NULL, elements INTEGER NOT NULL, word TEXT NOT NULL, turn_deg REAL NOT NULL DEFAULT 0,
      -- the user's placement on top of the TrueNorth turn: a move in metres (x east, y up, z south) and the pivot of turn_deg
      dx_m REAL NOT NULL DEFAULT 0, dy_m REAL NOT NULL DEFAULT 0, dz_m REAL NOT NULL DEFAULT 0, pivot_x_m REAL NOT NULL DEFAULT 0, pivot_z_m REAL NOT NULL DEFAULT 0);
  `);
  const put = db.prepare("INSERT INTO site_files VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  for (const f of files) put.run([f.name, f.sha256, f.bytes, f.kind, f.projected ? 1 : 0, f.terrainTris, f.elements, f.word, f.turnDeg ?? 0, f.dx ?? 0, f.dy ?? 0, f.dz ?? 0, f.pivotX ?? 0, f.pivotZ ?? 0]);
  put.free();
}
export function querySiteFiles(db: Database): SiteFileRow[] {
  const out: SiteFileRow[] = [];
  const has = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='site_files'");
  if (!has.length || !has[0]!.values.length) return out;
  // an older file's table has no turn_deg column (it is dropped and remade on every projection): read it when it is there
  const cols = new Set((db.exec("PRAGMA table_info(site_files)")[0]?.values ?? []).map((r) => String(r[1])));
  const col = (c: string): string => (cols.has(c) ? `, ${c}` : ", 0");
  const st = db.prepare(`SELECT name, sha256, bytes, kind, projected, terrain_tris, elements, word${col("turn_deg")}${col("dx_m")}${col("dy_m")}${col("dz_m")}${col("pivot_x_m")}${col("pivot_z_m")} FROM site_files ORDER BY name`);
  while (st.step()) {
    const r = st.get() as [string, string, number, string, number, number, number, string, number, number, number, number, number, number];
    out.push({ name: r[0], sha256: r[1], bytes: r[2], kind: r[3] as SiteFileRow["kind"], projected: r[4] === 1, terrainTris: r[5], elements: r[6], word: r[7], turnDeg: Number(r[8]) || 0,
      dx: Number(r[9]) || 0, dy: Number(r[10]) || 0, dz: Number(r[11]) || 0, pivotX: Number(r[12]) || 0, pivotZ: Number(r[13]) || 0 });
  }
  st.free();
  return out;
}

export function queryFills(db: Database): Array<{ elementId: number; name: string; topM: number }> {
  const out: Array<{ elementId: number; name: string; topM: number }> = [];
  const has = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='fill_elements'");
  if (!has.length || !has[0]!.values.length) return out;
  const st = db.prepare("SELECT element_id, name, top_m FROM fill_elements");
  while (st.step()) { const r = st.get() as [number, string, number]; out.push({ elementId: r[0], name: r[1], topM: r[2] }); }
  st.free();
  return out;
}

export interface WallGradeOut { elementId: number; aboveM2: number; belowM2: number; fillM2: number; gradeMinM: number; gradeMaxM: number; samples: number }

export function queryWallGrade(db: Database): Map<number, WallGradeOut> {
  const out = new Map<number, WallGradeOut>();
  const has = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='wall_grade'");
  if (!has.length || !has[0]!.values.length) return out;
  const st = db.prepare("SELECT element_id, above_m2, below_m2, fill_m2, grade_min_m, grade_max_m, samples FROM wall_grade");
  while (st.step()) {
    const r = st.get() as [number, number, number, number, number, number, number];
    out.set(r[0], { elementId: r[0], aboveM2: r[1], belowM2: r[2], fillM2: r[3], gradeMinM: r[4], gradeMaxM: r[5], samples: r[6] });
  }
  st.free();
  return out;
}

export interface SpaceFaceRow {
  spaceId: number;
  label: string;
  colorIndex: number;
  n: [number, number, number];
  outer: Array<[number, number, number]>;
  holes: Array<Array<[number, number, number]>>;
}

/** the space overlay is drawn from THESE rows in all three panes, so the
 *  colours cannot drift between views */
export function querySpaces(db: Database): SpaceFaceRow[] {
  const rows: SpaceFaceRow[] = [];
  const st = db.prepare(`
    SELECT f.space_id, COALESCE(s.long_name, s.name, ''), s.color_index,
           f.nx, f.ny, f.nz, f.outer, f.holes
    FROM space_faces f JOIN spaces s ON s.id = f.space_id
  `);
  while (st.step()) {
    const r = st.get() as [number, string, number, number, number, number, string, string];
    rows.push({
      spaceId: r[0], label: r[1], colorIndex: r[2],
      n: [r[3], r[4], r[5]],
      outer: JSON.parse(r[6]) as Array<[number, number, number]>,
      holes: JSON.parse(r[7]) as Array<Array<[number, number, number]>>,
    });
  }
  st.free();
  return rows;
}

export interface DbFaceRow {
  /** idf.db only — the stored row's own id, the join key a downstream module paints by */
  id?: number;
  elementId: number;
  ifcClass: string;
  n: [number, number, number];
  areaM2: number;
  rgba: number;
  outer: Array<[number, number, number]>;
  holes: Array<Array<[number, number, number]>>;
  /** ifc.db only — the file's IsExternal verdict and the spaces it bounds */
  isExternal?: boolean | null;
  spaces?: string | null;
  /** idf.db only — the pair gap this surface came from */
  thicknessM?: number;
  /** idf.db only — the OUTER ring's area, openings included. EnergyPlus takes
   *  a base surface gross and subtracts its subsurfaces itself, so the IDF
   *  writer needs this one; `areaM2` stays net, which is what the identity
   *  against the file's triangles is measured on (user, 2026-09-02). */
  grossAreaM2?: number;
  /** idf.db only — the zone this surface bounds, null if no room claimed it */
  space?: string | null;
  spaceFacing?: string | null;
  spaceColorIndex?: number | null;
  /** idf.db only — the IfcSpace each side came from before zone rulings (schema 6, 2026-09-04) */
  spaceIfc?: string | null;
  spaceFacingIfc?: string | null;
  /** idf.db only — the site terrain's verdict, when a site model was read */
  grade?: "above" | "below" | null;
  gradeM?: number | null;
  gradeDepthM?: number | null;
}

/** Pane 2 reads THE DATABASE, never the in-memory extraction — the view
 *  proves the DB (principles.md #2). */
export function queryFaces(db: Database, classes: Set<string> | null): DbFaceRow[] {
  const rows: DbFaceRow[] = [];
  const st = db.prepare(`
    SELECT f.element_id, e.ifc_class, f.nx, f.ny, f.nz, f.area_m2, f.rgba, f.outer, f.holes,
           e.is_external, e.spaces
    FROM faces f JOIN elements e ON e.id = f.element_id
  `);
  while (st.step()) {
    const r = st.get() as [number, string, number, number, number, number, number, string, string,
                           number | null, string | null];
    const cls = (r[1] ?? "").toUpperCase();
    if (classes && !classes.has(cls)) continue;
    rows.push({
      elementId: r[0], ifcClass: r[1],
      n: [r[2], r[3], r[4]], areaM2: r[5], rgba: r[6] >>> 0,
      outer: JSON.parse(r[7]) as Array<[number, number, number]>,
      holes: JSON.parse(r[8]) as Array<Array<[number, number, number]>>,
      isExternal: r[9] === null ? null : r[9] === 1,
      spaces: r[10],
    });
  }
  st.free();
  return rows;
}

// ── idf.db — Phase 2: the single-plane surfaces + the user's choices ───────
/** the area of one ring in its own plane — the outline's gross area */
function outlineArea(n: [number, number, number], ring: Array<[number, number, number]>): number {
  let sx = 0, sy = 0, sz = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    if (!p || !q) continue;
    sx += p[1] * q[2] - p[2] * q[1];
    sy += p[2] * q[0] - p[0] * q[2];
    sz += p[0] * q[1] - p[1] * q[0];
  }
  return Math.abs(sx * n[0] + sy * n[1] + sz * n[2]) / 2;
}

export function buildIdfDb(
  SQL: SqlJsStatic,
  faces: IdfFaceOut[],
  choices: Choices,
  meta: {
    sourceName: string; sourceSha256: string;
    /** the airtight-shell solve is the user's switch — idf.db records whether
     *  it ran and what the instrument said, so a downstream module never has
     *  to guess which geometry it is holding. */
    shellApplied?: boolean; leakBeforeM?: number; leakAfterM?: number;
    /** the site and true north the FILE states — an EnergyPlus writer reading
     *  idf.db alone needs them (schema 3, 2026-09-04) */
    site?: { latitude: number; longitude: number; elevationM: number } | null;
    trueNorth?: [number, number] | null;
    /** the IFC's own file name — an IDF header names its source */
    sourceIfcName?: string;
    /** the address the file states (schema 7, 2026-09-07) — the locator's seed */
    address?: string | null;
    /** where `site.elevationM` came from (2026-09-07): the lowest occupied level, else the IfcSite */
    siteElevationFrom?: string;
    /** IfcSite.RefElevation as stated, for the record */
    siteRefElevationM?: number | null;
  },
): Database {
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE choices (category TEXT PRIMARY KEY, mode TEXT NOT NULL);
    -- schema 3: what a downstream writer needs beyond the surfaces — the
    -- elements' GlobalIds and IsExternal verdicts, and every zone with the
    -- volume of the solid it came from (an IfcSpace, or an attic the module
    -- built over a ceiling). Written by writeIdfElements / writeZones.
    CREATE TABLE elements (
      id INTEGER PRIMARY KEY, global_id TEXT, ifc_class TEXT NOT NULL,
      is_external INTEGER, name TEXT, spaces TEXT,
      -- what fills a window or door: 1 glass, 0 opaque, NULL for everything
      -- else — and who said so: file | default (the type name) | user
      glazed INTEGER, glazed_source TEXT,
      -- the element's type in element_types (schema 8, 2026-09-08)
      type_id INTEGER,
      -- a door's GLASS SHARE as the file states it (schema 16, 2026-10-07): Pset_DoorCommon.GlazingAreaFraction, 0 for
      -- BIMedit_Glazing.Opaque = true; NULL when the file states neither or the user ruled the door — the writer splits it
      glazing_fraction REAL
    );
    CREATE TABLE zones (
      name TEXT PRIMARY KEY, kind TEXT NOT NULL, color_index INTEGER,
      storey TEXT, volume_m3 REAL, volume_source TEXT NOT NULL
    );
    CREATE TABLE surfaces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      element_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      mode TEXT NOT NULL,
      nx REAL, ny REAL, nz REAL,
      area_m2 REAL NOT NULL,
      -- the outer ring's area with the openings counted in: EnergyPlus wants a
      -- base surface GROSS and subtracts its windows and doors itself.
      -- area_m2 stays net, the number the identity against the file holds on.
      gross_area_m2 REAL NOT NULL,
      rgba INTEGER NOT NULL,
      thickness_m REAL NOT NULL,
      source TEXT NOT NULL,
      -- the zone this surface belongs to. One surface, one space: that is
      -- what makes these rows readable as a BEM zone model rather than a
      -- shell. NULL means no room claimed it.
      space TEXT,
      space_facing TEXT,
      -- the IfcSpace each side came from BEFORE the user's zone rulings: a
      -- zone of several rooms still names each room's own Space in the IDF,
      -- so the engine sizes per space as well as per zone (schema 6)
      space_ifc TEXT,
      space_facing_ifc TEXT,
      space_color_index INTEGER,
      -- the site terrain's verdict: 'above' / 'below' the ground line, the
      -- ground's elevation beside the surface, the depth below it
      grade TEXT,
      grade_m REAL,
      grade_depth_m REAL,
      outer TEXT NOT NULL,
      holes TEXT NOT NULL
    );
    -- WHAT CUTS EACH SURFACE: every window and door placed on the cell it
    -- stands in by the element's OWN geometry projected into the cell's plane.
    -- A door that runs to the floor, or out of the end of its wall, is a
    -- NOTCH in the cell's outline and not a hole ring — invisible to any
    -- hole-based reading (29 of 41 doors here; user, 2026-09-04).
    CREATE TABLE openings (
      element_id INTEGER PRIMARY KEY, global_id TEXT, kind TEXT NOT NULL, name TEXT,
      is_external INTEGER, glazed INTEGER NOT NULL, glazed_source TEXT NOT NULL,
      surface_id INTEGER NOT NULL REFERENCES surfaces(id),
      fit TEXT NOT NULL,                     -- hole | notch | clear
      s0 REAL NOT NULL, s1 REAL NOT NULL, t0 REAL NOT NULL, t1 REAL NOT NULL,
      area_m2 REAL NOT NULL,
      coincident_m REAL NOT NULL,
      quad TEXT NOT NULL                     -- the four world corners, JSON
    );
  `);
  const mput = db.prepare("INSERT INTO meta VALUES (?, ?)");
  for (const [k, v] of Object.entries({
    schema_version: "16",
    source_name: meta.sourceName,
    source_ifc_sha256: meta.sourceSha256, // provenance, always
    source_ifc_name: meta.sourceIfcName ?? "",
    axes: "Y_UP_METRES_WEBIFC",
    created_at: new Date().toISOString(),
    // the file's own site and north, at full precision — read, never rounded
    true_north: meta.trueNorth ? `${meta.trueNorth[0]},${meta.trueNorth[1]}` : "",
    site_latitude: meta.site ? String(meta.site.latitude) : "",
    site_longitude: meta.site ? String(meta.site.longitude) : "",
    site_elevation_m: meta.site ? String(meta.site.elevationM) : "",
    site_address: meta.address ?? "",
    site_elevation_from: meta.siteElevationFrom ?? "",
    site_ref_elevation_m: meta.siteRefElevationM !== undefined && meta.siteRefElevationM !== null ? String(meta.siteRefElevationM) : "",
    shell_applied: meta.shellApplied ? "1" : "0",
    open_edge_leak_m: (meta.shellApplied ? meta.leakAfterM : meta.leakBeforeM)?.toFixed(3) ?? "",
    open_edge_leak_unsolved_m: meta.leakBeforeM?.toFixed(3) ?? "",
  })) mput.run([k, v]);
  mput.free();
  const cput = db.prepare("INSERT INTO choices VALUES (?, ?)");
  for (const [cat, mode] of Object.entries(choices)) cput.run([cat, mode]);
  cput.free();
  const fput = db.prepare(
    "INSERT INTO surfaces (element_id, category, mode, nx, ny, nz, area_m2, gross_area_m2, rgba, thickness_m, source, space, space_facing, space_ifc, space_facing_ifc, space_color_index, grade, grade_m, grade_depth_m, outer, holes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  );
  db.run("BEGIN");
  for (const f of faces) {
    fput.run([
      f.elementId, f.category, f.mode,
      round6(f.n[0]), round6(f.n[1]), round6(f.n[2]),
      f.areaM2, outlineArea(f.n, f.outer), f.rgba, round6(f.thicknessM), f.source,
      f.space ?? null, f.spaceFacing ?? null, f.spaceIfc ?? f.space ?? null, f.spaceFacingIfc ?? f.spaceFacing ?? null, f.spaceColorIndex ?? null,
      f.grade ?? null, f.gradeM === undefined ? null : round6(f.gradeM), f.gradeDepthM === undefined ? null : round6(f.gradeDepthM),
      loopJson(f.outer), JSON.stringify(f.holes.map((h) => JSON.parse(loopJson(h)))),
    ]);
  }
  db.run("COMMIT");
  fput.free();
  return db;
}

/** The user's ruling on each storey step, recorded beside the geometry it
 *  produced. A decision a person made must be visible to whoever opens the
 *  file next, and must not evaporate when a dropdown changes. */
export function writeStepDecisions(
  db: Database,
  steps: Array<{ key: string; lowerId: number; upperId: number; offsetM: number; atHeightM: number }>,
  choices: Map<string, string>,
): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS step_decisions (
      key TEXT PRIMARY KEY, lower_id INTEGER, upper_id INTEGER,
      offset_m REAL, at_height_m REAL, choice TEXT NOT NULL
    );
  `);
  const put = db.prepare("INSERT OR REPLACE INTO step_decisions VALUES (?,?,?,?,?,?)");
  db.run("BEGIN");
  for (const st of steps) {
    put.run([st.key, st.lowerId, st.upperId, round6(st.offsetM), round6(st.atHeightM),
      choices.get(st.key) ?? "keep"]);
  }
  db.run("COMMIT");
  put.free();
}

/** every element's identity and verdict in one read — for a writer that
 *  names hundreds of surfaces and must not query per row */
/** what every element-keyed reading needs from ifc.db: the identity, the
 *  class, the file's IsExternal and its glazing word */
export interface ElementIndexRow { globalId: string | null; ifcClass: string; isExternal: boolean | null; name: string | null; glazingFraction: number | null; glazingPset: boolean; overallWidthM: number | null; overallHeightM: number | null; typeId: number | null }
export function queryElementIndex(db: Database): Map<number, ElementIndexRow> {
  const out = new Map<number, ElementIndexRow>();
  const st = db.prepare("SELECT id, global_id, ifc_class, is_external, name, glazing_fraction, glazing_pset, overall_width_m, overall_height_m, type_id FROM elements");
  while (st.step()) {
    const r = st.get() as [number, string | null, string, number | null, string | null, number | null, number | null, number | null, number | null, number | null];
    out.set(r[0], { globalId: r[1], ifcClass: r[2], isExternal: r[3] === null ? null : r[3] === 1, name: r[4], glazingFraction: r[5], glazingPset: r[6] === 1, overallWidthM: r[7], overallHeightM: r[8], typeId: r[9] });
  }
  st.free();
  return out;
}

export interface DbElementRow {
  elementId: number;
  globalId: string | null;
  ifcClass: string;
  name: string | null;
  isExternal: boolean | null;
  predefinedType: string | null;
  spaces: string | null;
  /** the file's own glazing word: GlazingAreaFraction, and a glazing pset attached */
  glazingFraction: number | null;
  glazingPset: boolean;
  /** IfcDoor / IfcWindow OverallWidth × OverallHeight, the file's stated opening size */
  overallWidthM: number | null;
  overallHeightM: number | null;
  /** the containing IfcBuildingStorey — "Basement", "Main", "Studio" */
  storey: string | null;
  storeyElevM: number | null;
}

/** The element behind a picked surface — its GlobalId is the identity every
 *  downstream module and every IFC viewer shares, so it is what the inspector
 *  shows, not our express id. */
export function queryElement(db: Database, id: number): DbElementRow | null {
  const st = db.prepare(
    "SELECT global_id, ifc_class, name, is_external, spaces, storey, storey_elev_m, predefined_type, glazing_fraction, glazing_pset, overall_width_m, overall_height_m " +
    "FROM elements WHERE id = ?");
  st.bind([id]);
  const row = st.step() ? st.get() : null;
  st.free();
  if (!row) return null;
  return {
    elementId: id,
    globalId: (row[0] as string) ?? null,
    ifcClass: (row[1] as string) ?? "?",
    name: (row[2] as string) ?? null,
    isExternal: row[3] === null ? null : row[3] === 1,
    spaces: (row[4] as string) ?? null,
    storey: (row[5] as string) ?? null,
    storeyElevM: (row[6] as number) ?? null,
    predefinedType: (row[7] as string) ?? null,
    glazingFraction: (row[8] as number | null) ?? null,
    glazingPset: row[9] === 1,
    overallWidthM: (row[10] as number | null) ?? null,
    overallHeightM: (row[11] as number | null) ?? null,
  };
}

/** The corrections the user made BY HAND, in the order they made them. Stored
 *  as operations rather than as moved coordinates, so they can be replayed
 *  over a fresh collapse — and so whoever opens idf.db next can see that a
 *  person, not a solver, closed that seam. */
export function writeEdits(
  db: Database,
  ops: Array<{ op: "extend" | "extendSpace"; from: string; to: string; fromLabel: string; toLabel: string }>,
): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS edits (
      seq INTEGER PRIMARY KEY, op TEXT NOT NULL,
      from_surface TEXT NOT NULL, to_surface TEXT NOT NULL,
      from_label TEXT, to_label TEXT
    );
  `);
  db.run("DELETE FROM edits");
  const put = db.prepare("INSERT INTO edits VALUES (?,?,?,?,?,?)");
  db.run("BEGIN");
  ops.forEach((o, i) => put.run([i + 1, o.op, o.from, o.to, o.fromLabel, o.toLabel]));
  db.run("COMMIT");
  put.free();
}

/** THE ROOMS THE ZONE MODEL USES: the file's IfcSpace solids with the user's
 *  space extensions applied, in the same two tables ifc.db keeps the file's
 *  own, so `querySpaces` reads either. Pane 3 draws its room overlay from
 *  THESE rows and panes 1 and 2 from ifc.db's — the rooms as ruled beside
 *  the rooms as drawn, in one colour each. Downstream gets the zone solids
 *  it was computing volumes from anyway. */
export function writeZoneSolids(
  db: Database,
  spaces: Array<{
    expressId: number; globalId: string | null; name: string | null; longName: string | null;
    colorIndex: number; storey: string | null; storeyElevM: number | null;
    faces: Array<{ n: [number, number, number]; outer: Array<[number, number, number]>; holes: Array<Array<[number, number, number]>>; areaM2: number }>;
  }>,
): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS spaces (
      id INTEGER PRIMARY KEY, global_id TEXT, name TEXT, long_name TEXT,
      color_index INTEGER NOT NULL,
      storey TEXT, storey_elev_m REAL
    );
    CREATE TABLE IF NOT EXISTS space_faces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id INTEGER NOT NULL REFERENCES spaces(id),
      nx REAL, ny REAL, nz REAL, area_m2 REAL NOT NULL, outer TEXT NOT NULL, holes TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS space_faces_space ON space_faces(space_id);
  `);
  db.run("DELETE FROM space_faces");
  db.run("DELETE FROM spaces");
  const sput = db.prepare("INSERT INTO spaces VALUES (?, ?, ?, ?, ?, ?, ?)");
  const sfput = db.prepare(
    "INSERT INTO space_faces (space_id, nx, ny, nz, area_m2, outer, holes) VALUES (?,?,?,?,?,?,?)",
  );
  db.run("BEGIN");
  for (const sp of spaces) {
    sput.run([sp.expressId, sp.globalId, sp.name, sp.longName, sp.colorIndex, sp.storey, sp.storeyElevM]);
    for (const f of sp.faces) {
      sfput.run([sp.expressId, round6(f.n[0]), round6(f.n[1]), round6(f.n[2]),
        f.areaM2, loopJson(f.outer), JSON.stringify(f.holes.map((h) => JSON.parse(loopJson(h))))]);
    }
  }
  db.run("COMMIT");
  sput.free(); sfput.free();
}

/** The per-wall QA travels WITH the geometry: a downstream module opening
 *  idf.db can see which walls are suspect without recomputing anything, and
 *  the app's QA panel reads these rows rather than an in-memory result
 *  (principles.md #2). Written after the surfaces, because the QA is measured
 *  from them. */
export function writeWallQA(db: Database, rows: WallQARow[]): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS wall_qa (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      element_id INTEGER NOT NULL,
      spaces TEXT, facing TEXT, facing_true TEXT,
      ifc_length_m REAL, ifc_height_m REAL, ifc_area_m2 REAL,
      idf_length_m REAL, idf_height_m REAL, idf_area_m2 REAL,
      lost_length_m REAL, open_count INTEGER, worst_gap_m REAL,
      start_state TEXT, start_gap_m REAL, start_meets TEXT,
      end_state   TEXT, end_gap_m   REAL, end_meets   TEXT,
      bottom_state TEXT, bottom_gap_m REAL, bottom_meets TEXT,
      top_state   TEXT, top_gap_m   REAL, top_meets   TEXT
    );
  `);
  const put = db.prepare(
    "INSERT INTO wall_qa (element_id, spaces, facing, facing_true," +
    " ifc_length_m, ifc_height_m, ifc_area_m2, idf_length_m, idf_height_m, idf_area_m2," +
    " lost_length_m, open_count, worst_gap_m," +
    " start_state, start_gap_m, start_meets, end_state, end_gap_m, end_meets," +
    " bottom_state, bottom_gap_m, bottom_meets, top_state, top_gap_m, top_meets)" +
    " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  );
  db.run("BEGIN");
  for (const w of rows) {
    put.run([
      w.elementId, w.spaces, w.facing, w.facingTrue,
      round6(w.authoredFace.lengthM), round6(w.authoredFace.heightM), w.authoredFace.areaM2,
      round6(w.idf.lengthM), round6(w.idf.heightM), w.idf.areaM2,
      round6(w.lostLengthM), w.openCount, round6(w.worstGapM),
      w.boundaries.start.state, round6(w.boundaries.start.gapM), w.boundaries.start.meets,
      w.boundaries.end.state, round6(w.boundaries.end.gapM), w.boundaries.end.meets,
      w.boundaries.bottom.state, round6(w.boundaries.bottom.gapM), w.boundaries.bottom.meets,
      w.boundaries.top.state, round6(w.boundaries.top.gapM), w.boundaries.top.meets,
    ]);
  }
  db.run("COMMIT");
  put.free();
}

export interface WallQaRowOut {
  elementId: number; spaces: string; facing: string;
  lostLengthM: number; worstGapM: number; openCount: number;
  boundaries: Array<{ name: string; state: string; gapM: number; meets: string }>;
}

/** the QA panel reads THE DATABASE, like every other view in this module */
export function queryWallQA(db: Database): WallQaRowOut[] {
  const out: WallQaRowOut[] = [];
  const st = db.prepare(`
    SELECT element_id, spaces, facing, lost_length_m, worst_gap_m, open_count,
           start_state, start_gap_m, start_meets, end_state, end_gap_m, end_meets,
           bottom_state, bottom_gap_m, bottom_meets, top_state, top_gap_m, top_meets
    FROM wall_qa ORDER BY lost_length_m DESC, worst_gap_m DESC
  `);
  while (st.step()) {
    const r = st.get() as unknown[];
    out.push({
      elementId: r[0] as number, spaces: (r[1] as string) ?? "", facing: (r[2] as string) ?? "",
      lostLengthM: r[3] as number, worstGapM: r[4] as number, openCount: r[5] as number,
      boundaries: ["start", "end", "bottom", "top"].map((name, i) => ({
        name,
        state: r[6 + i * 3] as string,
        gapM: r[7 + i * 3] as number,
        meets: (r[8 + i * 3] as string) ?? "",
      })),
    });
  }
  st.free();
  return out;
}

/** THE VOID QA travels with the geometry, exactly as the wall QA does: a
 *  downstream module opening idf.db sees which spaces the file leaves a
 *  question over without recomputing anything, and the app's `?` on a space
 *  name reads THESE rows rather than an in-memory result (principles.md #2).
 *  Written after the surfaces and the zones, because the QA is measured from
 *  them (schema 14, 2026-09-18). */
export function writeVoidQA(db: Database, rows: VoidQaRow[]): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS void_qa (
      name TEXT PRIMARY KEY,
      kind TEXT NOT NULL,                    -- void | room
      top TEXT, top_m2 REAL, bottom TEXT, bottom_m2 REAL,
      gap_min_m REAL, gap_max_m REAL,
      roof_m2 REAL, ceiling_m2 REAL, floor_m2 REAL, ext_wall_m2 REAL,
      under TEXT, over TEXT,                 -- the zones below and above, comma-separated
      covered_m2 REAL, covered_by TEXT,
      flags TEXT NOT NULL,                   -- insulation | interstitial | no-top | covered, comma-separated
      verdict TEXT NOT NULL,                 -- what the QA proposes; the dialog pre-selects it
      note TEXT NOT NULL
    );
  `);
  db.run("DELETE FROM void_qa");
  const put = db.prepare("INSERT INTO void_qa VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  db.run("BEGIN");
  for (const r of rows) {
    put.run([r.name, r.kind, r.top, round6(r.topM2), r.bottom, round6(r.bottomM2),
      round6(r.gapMinM), round6(r.gapMaxM),
      round6(r.roofM2), round6(r.ceilingM2), round6(r.floorM2), round6(r.extWallM2),
      r.under.join(", "), r.over.join(", "), round6(r.coveredM2), r.coveredBy.join(", "),
      r.flags.join(","), r.verdict, r.note]);
  }
  db.run("COMMIT");
  put.free();
}

/** THE VOID RULING TRAVELS IN THE CONTRACT (user, 2026-09-18). The QA above is a MEASUREMENT and stays out of
 *  `canonicalIdfText`; this is a RULING — the user's answer to a question the file does not answer — and the IDF
 *  writer reads it, so it belongs in the canonical text beside the step decisions: ruling a space moves idf.db's
 *  content sha and the BEM model reads stale until it is rebuilt (schema 15). */
export interface VoidRulingRow { space: string; answer: string; grille: boolean }
export function writeVoidRulings(db: Database, rows: VoidRulingRow[]): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS void_rulings (
      space TEXT PRIMARY KEY,
      answer TEXT NOT NULL,                  -- roof | ceiling | not-a-space | make-a-void | shade
      grille INTEGER NOT NULL                -- 1 = it opens into conditioned space (a transfer grille)
    );
  `);
  db.run("DELETE FROM void_rulings");
  const put = db.prepare("INSERT INTO void_rulings VALUES (?,?,?)");
  db.run("BEGIN");
  for (const r of rows) put.run([r.space, r.answer, r.grille ? 1 : 0]);
  db.run("COMMIT");
  put.free();
}
export function queryVoidRulings(db: Database): VoidRulingRow[] {
  if (!db.exec("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='void_rulings'")[0]?.values[0]?.[0]) return [];
  const out: VoidRulingRow[] = [];
  const st = db.prepare("SELECT space, answer, grille FROM void_rulings ORDER BY space");
  while (st.step()) { const r = st.get() as [string, string, number]; out.push({ space: r[0], answer: r[1], grille: !!r[2] }); }
  st.free();
  return out;
}

/** the `?` on a space name and its dialog read THE DATABASE, like every other view here */
export function queryVoidQA(db: Database): VoidQaRow[] {
  if (!db.exec("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='void_qa'")[0]?.values[0]?.[0]) return [];
  const out: VoidQaRow[] = [];
  const list = (v: string | null): string[] => (v ? v.split(", ").filter((x) => x) : []);
  const st = db.prepare("SELECT name, kind, top, top_m2, bottom, bottom_m2, gap_min_m, gap_max_m," +
    " roof_m2, ceiling_m2, floor_m2, ext_wall_m2, under, over, covered_m2, covered_by, flags, verdict, note" +
    " FROM void_qa ORDER BY covered_m2 + top_m2 DESC, name");
  while (st.step()) {
    const r = st.get() as [string, string, string | null, number, string | null, number, number, number,
                           number, number, number, number, string | null, string | null, number, string | null, string, string, string];
    out.push({
      name: r[0], kind: r[1] as "void" | "room", top: r[2], topM2: r[3], bottom: r[4], bottomM2: r[5],
      gapMinM: r[6], gapMaxM: r[7], roofM2: r[8], ceilingM2: r[9], floorM2: r[10], extWallM2: r[11],
      under: list(r[12]), over: list(r[13]), coveredM2: r[14], coveredBy: list(r[15]),
      flags: r[16].split(",").filter((x) => x) as VoidFlag[], verdict: r[17] as VoidVerdict, note: r[18],
    });
  }
  st.free();
  return out;
}

/** Pane 3 reads idf.db the way pane 2 reads ifc.db — the view proves the DB. */
export function queryIdfFaces(db: Database): DbFaceRow[] {
  const rows: DbFaceRow[] = [];
  const st = db.prepare(
    "SELECT element_id, category, nx, ny, nz, rgba, outer, holes, area_m2, thickness_m, " +
    "space, space_facing, space_color_index, gross_area_m2, grade, grade_m, grade_depth_m, id, space_ifc, space_facing_ifc FROM surfaces ORDER BY id",
  );
  while (st.step()) {
    const r = st.get() as [number, string, number, number, number, number, string, string,
                           number, number, string | null, string | null, number | null, number,
                           string | null, number | null, number | null, number, string | null, string | null];
    rows.push({
      id: r[17],
      elementId: r[0], ifcClass: r[1],
      n: [r[2], r[3], r[4]], areaM2: r[8], rgba: r[5] >>> 0,
      outer: JSON.parse(r[6]) as Array<[number, number, number]>,
      holes: JSON.parse(r[7]) as Array<Array<[number, number, number]>>,
      thicknessM: r[9], space: r[10], spaceFacing: r[11], spaceColorIndex: r[12], grossAreaM2: r[13],
      grade: r[14] as "above" | "below" | null, gradeM: r[15], gradeDepthM: r[16],
      spaceIfc: r[18], spaceFacingIfc: r[19],
    });
  }
  st.free();
  return rows;
}

// ── idf.db schema 3: the elements and the zones a downstream writer needs ──
/** the elements' GlobalIds and IsExternal verdicts, so an EnergyPlus writer
 *  never has to open ifc.db to name a surface or decide a boundary */
export interface IdfElementIn { expressId: number; globalId: string | null; ifcClass: string; name: string | null; isExternal: boolean | null; spaces: string[]; glazingFraction: number | null; glazingPset: boolean; typeId?: number | null }
export function writeIdfElements(
  db: Database,
  elements: IdfElementIn[],
  /** the glazing verdict per element — file, default or the user's ruling; null for what is not an opening */
  glazingOf: (e: IdfElementIn) => { glazed: boolean; source: string } | null = () => null,
): void {
  // an idf.db written before schema 16 is opened for this write too (a glazing ruling): it gains the column
  if (!db.exec("SELECT name FROM pragma_table_info('elements') WHERE name='glazing_fraction'").length) db.run("ALTER TABLE elements ADD COLUMN glazing_fraction REAL");
  db.run("DELETE FROM elements");
  const put = db.prepare("INSERT INTO elements VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  db.run("BEGIN");
  for (const e of elements) {
    const g = glazingOf(e);
    put.run([e.expressId, e.globalId, e.ifcClass, e.isExternal === null ? null : e.isExternal ? 1 : 0, e.name, e.spaces.length ? e.spaces.join(" + ") : null,
      g ? (g.glazed ? 1 : 0) : null, g?.source ?? null, e.typeId ?? null,
      // the fraction rides only where the FILE's word governs the verdict — a ruled or a defaulted door is whole glass or whole opaque
      g?.source === "file" && /^IFCDOOR$/i.test(e.ifcClass) ? e.glazingFraction : null]);
  }
  db.run("COMMIT");
  put.free();
}
export interface ZoneRowIn { name: string; kind: "room" | "attic"; colorIndex: number; storey: string | null; volumeM3: number; volumeSource: string }
/** every zone the carve names, with the volume of the solid it came from */
export function writeZones(db: Database, zones: ZoneRowIn[]): void {
  db.run("DELETE FROM zones");
  const put = db.prepare("INSERT INTO zones VALUES (?, ?, ?, ?, ?, ?)");
  db.run("BEGIN");
  for (const z of zones) put.run([z.name, z.kind, z.colorIndex, z.storey, z.volumeM3, z.volumeSource]);
  db.run("COMMIT");
  put.free();
}
export function queryZones(db: Database): ZoneRowIn[] {
  const out: ZoneRowIn[] = [];
  const st = db.prepare("SELECT name, kind, color_index, storey, volume_m3, volume_source FROM zones ORDER BY name");
  while (st.step()) {
    const r = st.get() as [string, string, number, string | null, number, string];
    out.push({ name: r[0], kind: r[1] as "room" | "attic", colorIndex: r[2], storey: r[3], volumeM3: r[4], volumeSource: r[5] });
  }
  st.free();
  return out;
}
/** the placed openings, written from the placement and READ BACK by every view */
export function writeOpenings(db: Database, placed: PlacedOpening[]): void {
  db.run("DELETE FROM openings");
  const put = db.prepare("INSERT INTO openings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  db.run("BEGIN");
  for (const o of placed) put.run([o.elementId, o.globalId, o.kind, o.name, o.isExternal === null ? null : o.isExternal ? 1 : 0, o.glazed ? 1 : 0, o.glazedSource,
    o.surfaceId, o.fit, o.s0, o.s1, o.t0, o.t1, o.areaM2, o.coincidentM, JSON.stringify(o.quad.map((p) => p.map((v) => round6(v))))]);
  db.run("COMMIT");
  put.free();
}
export function queryOpenings(db: Database): PlacedOpening[] {
  const out: PlacedOpening[] = [];
  const st = db.prepare("SELECT element_id, global_id, kind, name, is_external, glazed, glazed_source, surface_id, fit, s0, s1, t0, t1, area_m2, coincident_m, quad FROM openings ORDER BY element_id");
  while (st.step()) {
    const r = st.get() as [number, string | null, string, string | null, number | null, number, string, number, string, number, number, number, number, number, number, string];
    out.push({ elementId: r[0], globalId: r[1], kind: r[2], name: r[3] ?? "", isExternal: r[4] === null ? null : r[4] === 1, glazed: r[5] === 1, glazedSource: r[6],
      surfaceId: r[7], fit: r[8] as PlacedOpening["fit"], s0: r[9], s1: r[10], t0: r[11], t1: r[12], areaM2: r[13], coincidentM: r[14], quad: JSON.parse(r[15]) as PlacedOpening["quad"] });
  }
  st.free();
  return out;
}

export interface IdfElementRow { id: number; globalId: string | null; ifcClass: string; name: string | null; isExternal: boolean | null; spaces: string | null; glazed: boolean | null; glazedSource: string | null; typeId: number | null; glazingFraction: number | null }
export function queryIdfElements(db: Database): Map<number, IdfElementRow> {
  const out = new Map<number, IdfElementRow>();
  const hasF = db.exec("SELECT name FROM pragma_table_info('elements') WHERE name='glazing_fraction'").length > 0;
  const st = db.prepare(`SELECT id, global_id, ifc_class, name, is_external, spaces, glazed, glazed_source, type_id, ${hasF ? "glazing_fraction" : "NULL"} FROM elements`);
  while (st.step()) {
    const r = st.get() as [number, string | null, string, string | null, number | null, string | null, number | null, string | null, number | null, number | null];
    out.set(r[0], { id: r[0], globalId: r[1], ifcClass: r[2], name: r[3], isExternal: r[4] === null ? null : r[4] === 1, spaces: r[5], glazed: r[6] === null ? null : r[6] === 1, glazedSource: r[7], typeId: r[8], glazingFraction: r[9] });
  }
  st.free();
  return out;
}

// ── THE ELEMENT TYPES (2026-09-08): what the file states per TYPE — the
//    Pset_*Common.ThermalTransmittance held by the type itself (25 of 85 here,
//    in W/m²K by the file's own derived unit) and its IfcMaterialLayerSet
//    (name, thickness, category per layer; no thermal property in this file)
//    or, for a window or door, its IfcMaterialConstituentSet parts. Written
//    into ifc.db AND idf.db by the same function so a downstream writer reads
//    the file's word without opening the IFC. Nothing here derives a U.
export function writeElementTypes(db: Database, types: TypeMeta[]): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS element_types (
      id INTEGER PRIMARY KEY, global_id TEXT, ifc_class TEXT NOT NULL, name TEXT,
      u_w_m2k REAL,               -- the type's stated ThermalTransmittance; NULL = not stated
      u_pset TEXT,                -- which pset stated it (Pset_WallCommon …)
      layers INTEGER NOT NULL,    -- rows in type_layers
      own_of INTEGER              -- 2026-11-13: an element's OWN materials, a row of its own — the type it was split from; NULL = a type the file states
    );
    CREATE TABLE IF NOT EXISTS type_layers (
      type_id INTEGER NOT NULL, seq INTEGER NOT NULL,
      part TEXT,                  -- a constituent's part ("Glass", "Frame/Mullion") — NULL for a layer
      material TEXT NOT NULL, thickness_m REAL, category TEXT,
      PRIMARY KEY (type_id, seq)
    );
    DELETE FROM element_types; DELETE FROM type_layers;
  `);
  if (!(db.exec("PRAGMA table_info(element_types)")[0]?.values ?? []).some((r) => r[1] === "own_of")) db.run("ALTER TABLE element_types ADD COLUMN own_of INTEGER");
  const tput = db.prepare("INSERT INTO element_types (id, global_id, ifc_class, name, u_w_m2k, u_pset, layers, own_of) VALUES (?,?,?,?,?,?,?,?)");
  const lput = db.prepare("INSERT INTO type_layers VALUES (?,?,?,?,?,?)");
  db.run("BEGIN");
  for (const t of types) {
    tput.run([t.expressId, t.globalId, t.ifcClass, t.name, t.uWm2k, t.uPset, t.layers.length, t.ownOf ?? null]);
    t.layers.forEach((l, i) => lput.run([t.expressId, i, l.part, l.material, l.thicknessM === null ? null : round6(l.thicknessM), l.category]));
  }
  db.run("COMMIT");
  tput.free(); lput.free();
}
export interface ElementTypeRow { id: number; globalId: string | null; ifcClass: string; name: string | null; uWm2k: number | null; uPset: string | null; layers: TypeLayer[]; ownOf: number | null }
export function queryElementTypes(db: Database): Map<number, ElementTypeRow> {
  const out = new Map<number, ElementTypeRow>();
  const r = db.exec("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='element_types'");
  if (!Number(r[0]?.values[0]?.[0] ?? 0)) return out;
  const hasOwn = (db.exec("PRAGMA table_info(element_types)")[0]?.values ?? []).some((c) => c[1] === "own_of");
  const st = db.prepare(`SELECT id, global_id, ifc_class, name, u_w_m2k, u_pset, ${hasOwn ? "own_of" : "NULL"} FROM element_types ORDER BY id`);
  while (st.step()) {
    const row = st.get() as [number, string | null, string, string | null, number | null, string | null, number | null];
    out.set(row[0], { id: row[0], globalId: row[1], ifcClass: row[2], name: row[3], uWm2k: row[4], uPset: row[5], layers: [], ownOf: row[6] });
  }
  st.free();
  const ls = db.prepare("SELECT type_id, part, material, thickness_m, category FROM type_layers ORDER BY type_id, seq");
  while (ls.step()) {
    const row = ls.get() as [number, string | null, string, number | null, string | null];
    out.get(row[0])?.layers.push({ part: row[1], material: row[2], thicknessM: row[3], category: row[4] });
  }
  ls.free();
  return out;
}

/** the meta table as a map — the same reader core/stale.ts uses */
export { readMeta as readMetaOf } from "./stale.js";
