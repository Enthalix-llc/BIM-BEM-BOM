// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE CONSTRUCTIONS TABLE's rows (user, 2026-09-05): not a listing of every
// surface but the UNIQUE TYPES the file names, in the five sections the user
// set (2026-09-08) — Roof (incl. skylights), CEILING, Wall, Window, Door,
// Floors — each with the elements and cells it covers (so a row
// can light them in the view), its gross area, the construction(s) the writer
// gave those cells (read back from bem.db), and THE FILE'S OWN WORD on the
// type: its stated U and its material layers (idf.db's element_types).

import type { DbFaceRow, ElementTypeRow } from "../../core/db.js";
import type { TypeLayer } from "../../core/ifcStream.js";
import type { PlacedOpening } from "../../core/placeOpenings.js";
import type { BemModelOutcome } from "./pipeline.js";
import type { ConstructionRuling } from "./core/bemDb.js";
import { elementTypeLabel } from "../bim/openings.js";

// A CEILING IS NOT A ROOF (the user, 2026-09-20: "THE DUPLICATE CEILINGS ARE STILL SHOWING AS ROOFS … THE CEILING FORMING
// VOIDS ABOVE CAN HAVE A FLOOR OF DRYWALL, WHICH IS THE CEILING OF THE SPACES BELOW. CARRYING CEILING AS ROOFS WILL INDUCE
// A MODEL ERROR"). A ceiling type had been filed under Roof since 2026-09-08, on the reasoning that the code has one
// Ceiling U-factor row and lets you put it at the attic floor or in the roof deck. In THIS project every roof is insulated,
// so the roof's own construction already ends in the interior gypsum and a ceiling beside it is that plane twice — a second
// finish, a second surface pair, and insulation on a path already insulated. The ceiling gets its own section: the void's
// floor and the room's ceiling, an interior plane, never an envelope one.
export type TypeSection = "Roof" | "Ceiling" | "Wall" | "Window" | "Door" | "Floors";
export const TYPE_SECTIONS: TypeSection[] = ["Roof", "Ceiling", "Wall", "Window", "Door", "Floors"];
export const SECTION_TITLES: Record<TypeSection, string> = { Roof: "Roof (incl. skylights)", Ceiling: "Ceiling — separation between space and attic void", Wall: "Wall", Window: "Window", Door: "Door", Floors: "Floors (incl. ground-coupled)" };

export interface TypeRow {
  section: TypeSection;
  /** the ruling key: the type's name as the file states it — the element name without its instance id */
  key: string;
  label: string;
  typeId: number | null;
  /** what the cells are: a roof, a ceiling under an attic, a wall, a floor, a window, a door */
  kind: "roof" | "ceiling" | "wall" | "floor" | "window" | "door";
  elements: number[];
  rowIds: number[];
  /** exterior / interior cells, by the collapse's own category (walls) or the element's IsExternal (openings) */
  ext: number;
  int: number;
  /** the FILE's accounting: every cell of the type, emitted or not. It OVERSTATES the plane — an unclaimed remainder's
   *  outer ring encloses the cells a room claimed, so summing gross counts that area twice (measured on this file's
   *  roofs: 7,452 ft² gross against 5,307 net = 3,493 claimed + 1,815 eave). Kept for the record; not what is shown. */
  grossM2: number;
  /** THE AREA THAT REACHES THE IDF — WHAT THE COLUMN STATES (the user, 2026-09-20: "Since we are modeling energy flows,
   *  the areas stated must reflect what is in the idf db for the idf file. If 3,494 sf is the roof impacting energy (not
   *  shade), then that is what is stated."): the gross of the cells the writer actually emitted, which is what EnergyPlus
   *  takes as a base surface and subtracts its own subsurfaces from. An opening counts when a subsurface was written for it. */
  modelM2: number;
  /** and what did NOT reach the IDF, by the writer's own reason, at NET area — never dropped silently */
  notEmitted: Array<{ reason: string; cells: number; m2: number }>;
  constructions: string[];
  /** THE CODE DEFAULT the cells WOULD take (2026-09-16): the writer's own kind per cell whatever governs, by area — the PLAN's
   *  CODE column names the first; a wall type with exterior and partition cells lists both */
  codeConstructions: Array<{ kind: string; cells: number; m2: number }>;
  /** THE MODEL'S U for this type's cells (2026-09-09, the user: "the wall U-value must reflect the derived reciprocal sum of
   *  R-values shown in the detail"): 1/(ΣR + films) of the construction the cells carry — the one value when every
   *  construction they carry has it (a construction and its inter-zone "reversed" copy are one U), the area-weighted U
   *  when they differ (`uMixed`, each listed in `uByCons`); null only when no construction states a U */
  uWm2k: number | null;
  uMixed?: boolean;
  uByCons?: Array<{ name: string; uWm2k: number | null; m2: number }>;
  /** the file's word: the type's stated ThermalTransmittance (W/m²K) and its layer set */
  fileU: number | null;
  layers: TypeLayer[];
  /** windows and doors: the glazing verdict the file, the type name or the user gave */
  glazed: boolean | null;
}

/** the type name the file states for an element: "Basic Wall:Exterior - Wood Siding on Wood Stud:1234567" → without its instance id */
export const typeKeyOf = (name: string | null): string => (name ?? "").replace(/:\d+$/, "");

const kindOf = (category: string): TypeRow["kind"] | null =>
  /wall/i.test(category) ? "wall" : category === "floor" ? "floor" : category === "roof" ? "roof" : category === "ceiling" ? "ceiling" : null;
const sectionOfKind: Record<TypeRow["kind"], TypeSection> = { roof: "Roof", ceiling: "Ceiling", wall: "Wall", floor: "Floors", window: "Window", door: "Door" };

export function constructionTypes(
  rows: DbFaceRow[],
  elements: Map<number, { name: string | null; ifcClass: string; typeId?: number | null }>,
  openings: PlacedOpening[],
  model: BemModelOutcome | null,
  types: Map<number, ElementTypeRow> = new Map(),
): TypeRow[] {
  const consOfRow = new Map<number, string[]>();
  if (model) for (const s of model.surfaces) if (s.idfSurfaceId !== null) { const a = consOfRow.get(s.idfSurfaceId) ?? []; if (!a.includes(s.construction)) a.push(s.construction); consOfRow.set(s.idfSurfaceId, a); }
  const uOf = new Map<string, number | null>(model ? model.constructions.map((c) => [c.name, c.uWm2k]) : []);
  // the gross the writer emitted per cell — a cell whose outline a door's notch joined (2026-10-01) carries the door's
  // area in its gross now, as the engine takes it; the column states that
  const grossOfRow = new Map<number, number>();
  if (model) for (const s of model.report.out) if (s.idfSurfaceId !== null && !grossOfRow.has(s.idfSurfaceId)) grossOfRow.set(s.idfSurfaceId, s.grossAreaM2);
  const codeOfRow = new Map<number, string>();
  if (model) for (const s of model.surfaces) if (s.idfSurfaceId !== null && s.codeConstruction && !codeOfRow.has(s.idfSurfaceId)) codeOfRow.set(s.idfSurfaceId, s.codeConstruction);
  const addNot = (t: TypeRow, reason: string, m2: number): void => { const e = t.notEmitted.find((x) => x.reason === reason); if (e) { e.cells++; e.m2 += m2; } else t.notEmitted.push({ reason, cells: 1, m2 }); };
  const subEl = new Set<number>();
  if (model) for (const q of model.report.subsurfaces) if (q.elementId !== null && q.elementId !== undefined) subEl.add(q.elementId);
  // an exterior opening's own account (2026-10-01): what the model carries of it and every square metre it does not, named
  const accountOf = new Map((model?.report.openingAccounts ?? []).map((a) => [a.op.elementId, a]));
  const addCode = (t: TypeRow, k: string, m2: number): void => { const e = t.codeConstructions.find((x) => x.kind === k); if (e) { e.cells++; e.m2 += m2; } else t.codeConstructions.push({ kind: k, cells: 1, m2 }); };
  const byKey = new Map<string, TypeRow>();
  const areaOf = new Map<string, number>();   // `${section}|${key}|${construction}` → the cells' gross area carrying it
  const rowFor = (kind: TypeRow["kind"], elementId: number, fallback: string): TypeRow => {
    const el = elements.get(elementId);
    // an element with its OWN materials (2026-11-13) is a row of its own, keyed by that row's name — the key its ruling takes
    const own = el?.typeId !== null && el?.typeId !== undefined ? types.get(el.typeId) : undefined;
    const ownName = own?.ownOf !== null && own?.ownOf !== undefined ? own.name : null;
    const key = ownName ?? (typeKeyOf(el?.name ?? null) || fallback);
    const section = sectionOfKind[kind];
    const k = `${section}|${key}`;
    let t = byKey.get(k);
    if (!t) {
      const typeId = el?.typeId ?? null;
      const ty = typeId !== null ? types.get(typeId) : undefined;
      t = { section, key, label: ownName ? `${elementTypeLabel(el?.name ?? null) || fallback} · own materials` : elementTypeLabel(el?.name ?? null) || fallback, typeId, kind, elements: [], rowIds: [], ext: 0, int: 0, grossM2: 0, modelM2: 0, notEmitted: [], constructions: [], codeConstructions: [], uWm2k: null,
        fileU: ty?.uWm2k ?? null, layers: ty?.layers ?? [], glazed: null };
      byKey.set(k, t);
    }
    return t;
  };
  for (const r of rows) {
    const kind = kindOf(r.ifcClass);
    if (!kind || r.id === undefined) continue;
    const t = rowFor(kind, r.elementId, elements.get(r.elementId)?.ifcClass ?? r.ifcClass);
    if (!t.elements.includes(r.elementId)) t.elements.push(r.elementId);
    t.rowIds.push(r.id);
    if (r.ifcClass === "exteriorWall") t.ext++; else if (r.ifcClass === "interiorWall") t.int++;
    const emittedGross = grossOfRow.get(r.id);
    // a notch joined: the file's gross over the cell grows by the door it now holds, so the two stay comparable
    t.grossM2 += Math.max(r.grossAreaM2 ?? r.areaM2, emittedGross ?? 0);
    if (!model || consOfRow.has(r.id)) t.modelM2 += emittedGross ?? r.grossAreaM2 ?? r.areaM2;
    else addNot(t, model.notEmitted?.get(r.id) ?? "not written", r.areaM2);
    { const ck = codeOfRow.get(r.id); if (ck) addCode(t, ck, r.grossAreaM2 ?? r.areaM2); }
    for (const c of consOfRow.get(r.id) ?? []) { if (!t.constructions.includes(c)) t.constructions.push(c); areaOf.set(`${t.section}|${t.key}|${c}`, (areaOf.get(`${t.section}|${t.key}|${c}`) ?? 0) + (r.grossAreaM2 ?? r.areaM2)); }
  }
  // windows and doors: the placed openings, by the file's type name
  const subCons = (kind: "Window" | "Door"): string[] => model ? [...new Set(model.report.subsurfaces.filter((s) => s.kind === kind).map((s) => s.construction))] : [];
  for (const o of openings) {
    const t = rowFor(o.kind === "window" ? "window" : "door", o.elementId, o.kind);
    if (!t.elements.length) { t.constructions = subCons(o.kind === "window" ? "Window" : "Door"); t.glazed = o.glazed; }
    t.elements.push(o.elementId);
    if (!t.rowIds.includes(o.surfaceId)) t.rowIds.push(o.surfaceId);
    if (o.isExternal) t.ext++; else t.int++;
    t.grossM2 += o.areaM2;
    const acc = accountOf.get(o.elementId);
    if (!model) t.modelM2 += o.areaM2;
    else if (acc) {
      // THE AREA STATED IS THE MODEL'S: the pieces written, never the file's rectangle
      t.modelM2 += acc.emittedM2;
      for (const l of acc.losses) addNot(t, l.reason, l.m2);
      if (acc.overlapM2 > 1e-4) addNot(t, "overlaps another opening in the file — carried by that opening", acc.overlapM2);
    } else if (subEl.has(o.elementId)) t.modelM2 += o.areaM2;
    else addNot(t, "no subsurface written for this opening", o.areaM2);
    if (t.glazed !== o.glazed) t.glazed = null;
  }
  const out = [...byKey.values()];
  // windows and doors: the code kind per placed opening's subsurfaces (by element; every subsurface of the kind when none names one)
  for (const t of out) {
    if (t.kind !== "window" && t.kind !== "door" || !model) continue;
    const kinds = t.kind === "window" ? ["Window"] : ["Door", "GlassDoor"];
    const mine = model.report.subsurfaces.filter((s) => kinds.includes(s.kind) && s.elementId !== null && s.elementId !== undefined && t.elements.includes(s.elementId));
    for (const s of mine.length ? mine : model.report.subsurfaces.filter((q) => kinds.includes(q.kind))) if (s.codeConstruction) addCode(t, s.codeConstruction, 0);
  }
  for (const t of out) {
    t.codeConstructions.sort((a, b) => b.m2 - a.m2 || b.cells - a.cells);
    t.uByCons = t.constructions.map((c) => ({ name: c, uWm2k: uOf.get(c) ?? null, m2: areaOf.get(`${t.section}|${t.key}|${c}`) ?? 0 }));
    const withU = t.uByCons.filter((x): x is { name: string; uWm2k: number; m2: number } => x.uWm2k !== null);
    if (!withU.length) { t.uWm2k = null; continue; }
    const distinct = withU.filter((x, i) => withU.findIndex((y) => Math.abs(y.uWm2k - x.uWm2k) < 1e-6) === i);
    t.uMixed = distinct.length > 1;
    const area = withU.reduce((s, x) => s + x.m2, 0);
    t.uWm2k = !t.uMixed ? distinct[0]!.uWm2k : area > 0 ? withU.reduce((s, x) => s + x.uWm2k * x.m2, 0) / area : distinct[0]!.uWm2k;
  }
  for (const t of out) t.notEmitted.sort((a, b) => b.m2 - a.m2);
  return out.sort((a, b) => TYPE_SECTIONS.indexOf(a.section) - TYPE_SECTIONS.indexOf(b.section) || b.modelM2 - a.modelM2 || b.grossM2 - a.grossM2);
}

/** THE GLAZED VALUES A TYPE CARRIES (2026-09-18, the user: the window list "shown as a single row each, with columns
 *  arranged: ID, Reference, Count, Area, U, SHGC, VT"). ONE rule for the column's schedule and the DETAIL frame, so the
 *  two can never disagree: the RULING's numbers when one is staged or applied (a product's certified set, a dataset
 *  construction's note, or a typed set), else the construction the model wrote, else the code default's. `from` says
 *  which — the caller marks a ruling the user has staged and not yet applied; `vtBlank` is a rating that publishes no
 *  VT (the field is left blank in the IDF and the engine estimates it — never a number we invented). A type that is
 *  not glazed — a solid door, the Door section being a mixture — reads SHGC and VT as none, never the glazed default. */
export interface FenValues {
  name: string;
  u: number | null; shgc: number | null; vt: number | null;
  source: "code-default" | "file" | "dataset" | "user";
  from: "ruling" | "model" | "code";
  vtBlank: boolean;
}
export function fenValues(
  st: ConstructionRuling | undefined,
  resolved: { label: string; uWm2k: number | null; shgc?: number; vt?: number; source: string } | null,
  code: { name: string; uWm2k: number | null; shgc?: number | null; vt?: number | null } | null,
  /** a dataset window construction's own U · SHGC · VT, from the library's `!` banner (the column and the view pass it in) */
  noteOf?: (lib: { file: string; name: string }) => { u: number; shgc: number; tvis: number | null } | null,
  /** whether the TYPE is glazed — the Door section is a mixture (user, 2026-09-18), and a solid door's typed U carries
   *  no SHGC or VT; left out, the ruling's own fields decide, which is the resolver's test (a door is glazed when it states one) */
  glazed?: boolean,
): FenValues {
  // A TYPE WITH NO GLASS HAS NO SHGC AND NO VT, whatever else states one (2026-09-18, measured on the door schedule: a
  // solid door read SHGC 0.40 · VT 0.50 because the code kind its subsurfaces carry can be the FENESTRATION kind — the
  // writer gives every GlassDoor that construction, and a door type's code kinds are gathered over the section)
  const out = (v: FenValues): FenValues => (glazed === false ? { ...v, shgc: null, vt: null, vtBlank: false } : v);
  if (st?.source === "u" && st.uWm2k !== undefined && st.uWm2k > 0) {
    // a MANUFACTURER's certified rating is a dataset ruling whichever line it is; a set typed by hand is the user's
    const maker = st.product?.source === "marvin" || st.product?.source === "marvin-essential";
    const isGlazed = glazed ?? (st.shgc !== undefined || st.vt !== undefined || !!st.product);
    return out({ name: st.product?.name ?? (isGlazed ? "a typed set" : "a typed U"), u: st.uWm2k,
      shgc: isGlazed ? st.shgc ?? 0.4 : null, vt: isGlazed ? st.vt ?? null : null,
      source: maker ? "dataset" : "user", from: "ruling", vtBlank: isGlazed && st.vt === undefined && !!st.product });
  }
  if (st?.source === "library" && st.library && noteOf) {
    const n = noteOf(st.library);
    if (n) return out({ name: st.library.name, u: n.u, shgc: n.shgc, vt: n.tvis, source: "dataset", from: "ruling", vtBlank: n.tvis === null });
  }
  if (resolved) {
    const src = resolved.source === "dataset" || resolved.source === "file" || resolved.source === "user" ? resolved.source : "code-default";
    return out({ name: resolved.label, u: resolved.uWm2k, shgc: resolved.shgc ?? null, vt: resolved.vt ?? null, source: src, from: "model", vtBlank: resolved.shgc !== undefined && resolved.vt === undefined });
  }
  return out({ name: code?.name ?? "—", u: code?.uWm2k ?? null, shgc: code?.shgc ?? null, vt: code?.vt ?? null, source: "code-default", from: "code", vtBlank: false });
}

/** the selection key of a row: section and the type's name */
export const typeKey = (r: TypeRow): string => `${r.section}|${r.key}`;

/** the census line: unique types per section */
export function formatTypeCensus(rows: TypeRow[]): string {
  return TYPE_SECTIONS.map((s) => `${s.toLowerCase()} ${rows.filter((r) => r.section === s).length}`).join(" · ");
}

/** a stated U an opaque assembly cannot have: above 7 W/m²K there is less resistance than the air films alone */
export const implausibleU = (u: number | null, kind: TypeRow["kind"]): boolean => u !== null && kind !== "window" && kind !== "door" && u > 7;

/** COMBINED TYPES (user, 2026-09-09): the types the user combined into one — an alias (`sameAs`) marked `combined` — fold
 *  into their target's row: elements, cells, constructions and gross area summed; the members kept for the row's chip
 *  and for uncombining. One arithmetic for the column and the gate; the resolver sees only the alias */
export function foldRows(rows: TypeRow[], stage: Record<string, { sameAs?: string; combined?: true } | undefined>): { rows: TypeRow[]; members: Map<string, TypeRow[]> } {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const targetOf = (r: TypeRow): string | null => { const st = stage[r.key]; const t = st?.combined && st.sameAs && st.sameAs !== r.key && byKey.has(st.sameAs) ? st.sameAs : null; return t !== null && byKey.get(t)!.section === r.section ? t : null; };
  const members = new Map<string, TypeRow[]>();
  for (const r of rows) { const t = targetOf(r); if (t) (members.get(t) ?? members.set(t, []).get(t)!).push(r); }
  const out: TypeRow[] = [];
  for (const r of rows) {
    if (targetOf(r)) continue;
    const ms = members.get(r.key);
    if (!ms) { out.push(r); continue; }
    const f: TypeRow = { ...r, elements: [...r.elements], rowIds: [...r.rowIds], constructions: [...r.constructions], codeConstructions: r.codeConstructions.map((c) => ({ ...c })), notEmitted: r.notEmitted.map((c) => ({ ...c })) };
    for (const m of ms) {
      for (const c of m.codeConstructions) { const e = f.codeConstructions.find((x) => x.kind === c.kind); if (e) { e.cells += c.cells; e.m2 += c.m2; } else f.codeConstructions.push({ ...c }); }
      for (const e of m.elements) if (!f.elements.includes(e)) f.elements.push(e);
      for (const id of m.rowIds) if (!f.rowIds.includes(id)) f.rowIds.push(id);
      for (const c of m.constructions) if (!f.constructions.includes(c)) f.constructions.push(c);
      for (const n of m.notEmitted) { const e = f.notEmitted.find((x) => x.reason === n.reason); if (e) { e.cells += n.cells; e.m2 += n.m2; } else f.notEmitted.push({ ...n }); }
      f.ext += m.ext; f.int += m.int; f.grossM2 += m.grossM2; f.modelM2 += m.modelM2;
    }
    out.push(f);
  }
  return { rows: out, members };
}
/** the file's layer set as one string — two types with the same signature are "exact" (the same materials, thicknesses and categories in the same order) */
export const layerSignature = (r: { layers: TypeLayer[] }): string => r.layers.filter((l) => !l.part).map((l) => `${l.material}|${l.thicknessM === null ? "" : Math.round(l.thicknessM * 1e6)}|${l.category ?? ""}`).join(";");
/** a name-family hint, never a verdict: the two labels share their leading words (12+ characters of common word prefix) */
export function sharesName(a: string, b: string): boolean {
  const wa = a.split(/\s+/), wb = b.split(/\s+/);
  let i = 0;
  while (i < wa.length && i < wb.length && wa[i]!.toLowerCase() === wb[i]!.toLowerCase()) i++;
  return wa.slice(0, i).join(" ").length >= 12;
}
