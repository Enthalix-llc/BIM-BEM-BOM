// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// cfd.db — THE AIRFLOW RUNS, accumulated: one row per run (a space at a design peak), and per run the snapshot the
// screen draws — its assessment, the flow at each opening, each wall's temperature and heat, the arrows, and three
// slices as packed float grids. The solver's own fields stay in the run's folder (data/cfd/runs/<stamp>/); cfd.db
// holds what was read from them. A newer run of the same space and peak does not delete the older one.

import type { Database, SqlJsStatic } from "sql.js";
import type { Arrow } from "./streamArrows.js";
import type { Metric, Slice } from "./cfdMetrics.js";

export const CFD_SCHEMA = "1";

const DDL = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, stamp TEXT NOT NULL, space TEXT NOT NULL, peak TEXT NOT NULL, design_hour TEXT,
  status TEXT NOT NULL, iteration TEXT, averaged INTEGER NOT NULL, cells INTEGER NOT NULL, seconds REAL, solver TEXT,
  case_dir TEXT, settings TEXT NOT NULL, source_ifc_sha256 TEXT, source_idf_sha256 TEXT, bem_run TEXT,
  lines INTEGER, ends TEXT, arrow_params TEXT, speed_hist TEXT
);
CREATE TABLE IF NOT EXISTS metrics (run INTEGER NOT NULL, key TEXT NOT NULL, grp TEXT NOT NULL, label TEXT NOT NULL, value REAL, unit TEXT NOT NULL, verdict TEXT, limit_text TEXT, PRIMARY KEY (run, key));
CREATE TABLE IF NOT EXISTS openings (run INTEGER NOT NULL, name TEXT NOT NULL, dir TEXT NOT NULL, cfm REAL NOT NULL, t_c REAL, cx REAL, cy REAL, cz REAL, area_m2 REAL, lo TEXT, hi TEXT, reached_cfm REAL, PRIMARY KEY (run, name));
CREATE TABLE IF NOT EXISTS walls (run INTEGER NOT NULL, name TEXT NOT NULL, area_m2 REAL NOT NULL, t_c REAL, heat_w REAL, PRIMARY KEY (run, name));
CREATE TABLE IF NOT EXISTS arrows (run INTEGER NOT NULL, x REAL, y REAL, z REAL, dx REAL, dy REAL, dz REAL, speed REAL, cfm REAL, t_c REAL);
CREATE INDEX IF NOT EXISTS arrows_run ON arrows (run);
CREATE TABLE IF NOT EXISTS slices (run INTEGER NOT NULL, plane TEXT NOT NULL, axis INTEGER, at REAL, u INTEGER, v INTEGER, u0 REAL, v0 REAL, h REAL, nu INTEGER, nv INTEGER, t BLOB, speed BLOB, age BLOB, PRIMARY KEY (run, plane));
`;

export function openCfdDb(SQL: SqlJsStatic, bytes: Uint8Array | null): Database {
  const db = bytes ? new SQL.Database(bytes) : new SQL.Database();
  db.run(DDL);
  db.run("INSERT OR REPLACE INTO meta VALUES ('schema_version', ?)", [CFD_SCHEMA]);
  return db;
}

export interface RunRow {
  id: number; stamp: string; space: string; peak: "heating" | "cooling"; designHour: string | null; status: string; iteration: string | null;
  averaged: boolean; cells: number; seconds: number | null; solver: string | null; caseDir: string | null; settings: Record<string, unknown>;
  lines: number | null; ends: Record<string, number> | null; arrowParams: Record<string, number> | null; speedHist: { edges: number[]; pct: number[] } | null;
}

export interface RunWrite {
  stamp: string; space: string; peak: string; designHour: string | null; status: string; iteration: string | null; averaged: boolean; cells: number;
  seconds: number | null; solver: string | null; caseDir: string | null; settings: unknown; sourceIfcSha256?: string | null; sourceIdfSha256?: string | null;
  bemRun?: string | null; lines: number; ends: unknown; arrowParams: unknown; speedHist: unknown;
}

export function writeRunRow(db: Database, r: RunWrite): number {
  db.run(`INSERT INTO runs (stamp, space, peak, design_hour, status, iteration, averaged, cells, seconds, solver, case_dir, settings, source_ifc_sha256, source_idf_sha256, bem_run, lines, ends, arrow_params, speed_hist)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  [r.stamp, r.space, r.peak, r.designHour, r.status, r.iteration, r.averaged ? 1 : 0, r.cells, r.seconds, r.solver, r.caseDir, JSON.stringify(r.settings ?? {}),
    r.sourceIfcSha256 ?? null, r.sourceIdfSha256 ?? null, r.bemRun ?? null, r.lines, JSON.stringify(r.ends), JSON.stringify(r.arrowParams), JSON.stringify(r.speedHist)]);
  return db.exec("SELECT last_insert_rowid()")[0]!.values[0]![0] as number;
}

export function writeMetrics(db: Database, run: number, ms: Metric[]): void {
  const st = db.prepare("INSERT OR REPLACE INTO metrics VALUES (?,?,?,?,?,?,?,?)");
  for (const m of ms) st.run([run, m.key, m.group, m.label, Number.isFinite(m.value) ? m.value : null, m.unit, m.verdict, m.limit]);
  st.free();
}

export interface OpeningRow { name: string; dir: "in" | "out"; cfm: number; tC: number | null; c: [number, number, number]; area: number; lo: [number, number, number]; hi: [number, number, number]; reachedCfm: number | null }

export function writeOpenings(db: Database, run: number, os: OpeningRow[]): void {
  const st = db.prepare("INSERT OR REPLACE INTO openings VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
  for (const o of os) st.run([run, o.name, o.dir, o.cfm, Number.isFinite(o.tC) ? o.tC : null, o.c[0], o.c[1], o.c[2], o.area, JSON.stringify(o.lo), JSON.stringify(o.hi), o.reachedCfm]);
  st.free();
}

export function writeWalls(db: Database, run: number, ws: Array<{ name: string; area: number; tC: number; heatW: number | null }>): void {
  const st = db.prepare("INSERT OR REPLACE INTO walls VALUES (?,?,?,?,?)");
  for (const w of ws) st.run([run, w.name, w.area, Number.isFinite(w.tC) ? w.tC : null, w.heatW]);
  st.free();
}

export function writeArrows(db: Database, run: number, as: Arrow[]): void {
  const st = db.prepare("INSERT INTO arrows VALUES (?,?,?,?,?,?,?,?,?,?)");
  db.run("BEGIN");
  for (const a of as) st.run([run, a.x, a.y, a.z, a.dx, a.dy, a.dz, a.speed, a.cfm, Number.isFinite(a.t) ? a.t : null]);
  db.run("COMMIT");
  st.free();
}

const f32 = (a: Float32Array): Uint8Array => new Uint8Array(a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength));
const asF32 = (b: unknown): Float32Array => {
  const u = b as Uint8Array;
  return new Float32Array(u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength));
};

export function writeSlices(db: Database, run: number, ss: Slice[]): void {
  const st = db.prepare("INSERT OR REPLACE INTO slices VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  for (const s of ss) st.run([run, s.plane, s.axis, s.at, s.u, s.v, s.u0, s.v0, s.h, s.nu, s.nv, f32(s.T), f32(s.speed), f32(s.age)]);
  st.free();
}

const rowsOf = (db: Database, sql: string, args: unknown[] = []): Array<Record<string, unknown>> => {
  const st = db.prepare(sql);
  st.bind(args as never);
  const out: Array<Record<string, unknown>> = [];
  while (st.step()) out.push(st.getAsObject());
  st.free();
  return out;
};
const json = <T>(v: unknown): T | null => (typeof v === "string" && v ? (JSON.parse(v) as T) : null);

export function queryRuns(db: Database): RunRow[] {
  return rowsOf(db, "SELECT * FROM runs ORDER BY id").map((r) => ({
    id: r.id as number, stamp: r.stamp as string, space: r.space as string, peak: r.peak as RunRow["peak"], designHour: (r.design_hour as string) ?? null,
    status: r.status as string, iteration: (r.iteration as string) ?? null, averaged: r.averaged === 1, cells: r.cells as number, seconds: (r.seconds as number) ?? null,
    solver: (r.solver as string) ?? null, caseDir: (r.case_dir as string) ?? null, settings: json<Record<string, unknown>>(r.settings) ?? {},
    lines: (r.lines as number) ?? null, ends: json(r.ends), arrowParams: json(r.arrow_params), speedHist: json(r.speed_hist),
  }));
}

export function queryMetrics(db: Database, run: number): Metric[] {
  return rowsOf(db, "SELECT * FROM metrics WHERE run = ? ORDER BY rowid", [run]).map((r) => ({
    key: r.key as string, group: r.grp as Metric["group"], label: r.label as string, value: (r.value as number) ?? NaN, unit: r.unit as string,
    verdict: (r.verdict as Metric["verdict"]) ?? null, limit: (r.limit_text as string) ?? null,
  }));
}

export function queryOpenings(db: Database, run: number): OpeningRow[] {
  return rowsOf(db, "SELECT * FROM openings WHERE run = ? ORDER BY rowid", [run]).map((r) => ({
    name: r.name as string, dir: r.dir as "in" | "out", cfm: r.cfm as number, tC: (r.t_c as number) ?? null, c: [r.cx as number, r.cy as number, r.cz as number],
    area: r.area_m2 as number, lo: json(r.lo) ?? [0, 0, 0], hi: json(r.hi) ?? [0, 0, 0], reachedCfm: (r.reached_cfm as number) ?? null,
  }));
}

export function queryWalls(db: Database, run: number): Array<{ name: string; area: number; tC: number | null; heatW: number | null }> {
  return rowsOf(db, "SELECT * FROM walls WHERE run = ? ORDER BY rowid", [run]).map((r) => ({ name: r.name as string, area: r.area_m2 as number, tC: (r.t_c as number) ?? null, heatW: (r.heat_w as number) ?? null }));
}

export function queryArrows(db: Database, run: number): Arrow[] {
  return rowsOf(db, "SELECT * FROM arrows WHERE run = ?", [run]).map((r) => ({
    x: r.x as number, y: r.y as number, z: r.z as number, dx: r.dx as number, dy: r.dy as number, dz: r.dz as number, speed: r.speed as number, cfm: r.cfm as number, t: (r.t_c as number) ?? NaN,
  }));
}

export function querySlices(db: Database, run: number): Slice[] {
  return rowsOf(db, "SELECT * FROM slices WHERE run = ? ORDER BY rowid", [run]).map((r) => ({
    plane: r.plane as string, axis: r.axis as Slice["axis"], at: r.at as number, u: r.u as Slice["u"], v: r.v as Slice["v"], u0: r.u0 as number, v0: r.v0 as number,
    h: r.h as number, nu: r.nu as number, nv: r.nv as number, T: asF32(r.t), speed: asF32(r.speed), age: asF32(r.age),
  }));
}
