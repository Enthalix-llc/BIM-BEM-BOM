// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
/**
 * THE FILE CHANGED — what moved, and the rulings that ride it (2026-09-09).
 *
 * idf.db is derived: it is rebuilt from ifc.db and the user's ledgers on every
 * load, and the ledgers are keyed to the source IFC's sha256. So when the file
 * changes — a re-export, a deletion — the next load finds no ledger under the
 * new hash, and every ruling silently vanishes (the user, 2026-09-09: "the
 * idf db changes were not retained"). This module is the instrument for that
 * moment. It reads the PREVIOUS ifc.db (the original, kept for accounting)
 * and the new one into two indexes — one row per element, type and room with
 * the file's word on it and its geometry at 1 mm — diffs them by GlobalId
 * (the identity every IFC viewer shares; express ids are renumbered by a
 * re-export), and classifies every ruling in the old ledgers by its subject:
 * CARRIED when the subject is unchanged, CHANGED when the file moved it (the
 * user's choice: keep the ruling or take the file's word), GONE when the
 * subject is no longer in the file (dropped and named). Nothing here derives
 * a fact; it reports what the file says now against what it said then.
 */
import type { Database } from "sql.js";
import { roomOfVoidZone } from "./zones.js";
import { readMeta } from "./stale.js";
import type { BemLedger } from "../modules/bem/core/bemDb.js";

export interface ElementPrint {
  id: number; globalId: string | null; ifcClass: string; name: string | null;
  spaces: string | null; storey: string | null; typeName: string | null;
  /** the file's word on the element, field by field — what a change is named by */
  word: Record<string, string>;
  /** the element's faces, order-independent, at 1 mm */
  geom: string;
  areaM2: number; faces: number;
  bbox: [number, number, number, number, number, number] | null;
}
export interface TypePrint { id: number; name: string; ifcClass: string; uWm2k: number | null; layers: string }
export interface SpacePrint { id: number; globalId: string | null; name: string; geom: string; areaM2: number; faces: number }
export interface FileIndex { sha: string; name: string; elements: ElementPrint[]; types: TypePrint[]; spaces: SpacePrint[] }

/** FNV-1a over a string; two seeds give a 64-bit change detector */
const fnv = (s: string, h: number): number => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; };
const mm = (v: number): number => Math.round(v * 1000);
/** one ring as a multiset of 1 mm vertices — independent of the start vertex and the direction */
const ringKey = (ring: Array<[number, number, number]>): string => ring.map((p) => `${mm(p[0])},${mm(p[1])},${mm(p[2])}`).sort().join(";");

class GeomAcc {
  h1 = 0; h2 = 0; area = 0; faces = 0;
  min: [number, number, number] = [Infinity, Infinity, Infinity]; max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  add(outer: Array<[number, number, number]>, holes: Array<Array<[number, number, number]>>, area: number): void {
    const key = `${ringKey(outer)}|${holes.map(ringKey).sort().join("|")}`;
    this.h1 = (this.h1 + fnv(key, 2166136261)) >>> 0;
    this.h2 = (this.h2 + fnv(key, 0x9e3779b9)) >>> 0;
    this.area += area; this.faces++;
    for (const p of outer) for (let k = 0; k < 3; k++) { if (p[k]! < this.min[k]!) this.min[k] = p[k]!; if (p[k]! > this.max[k]!) this.max[k] = p[k]!; }
  }
  get geom(): string { return `${this.h1.toString(16)}-${this.h2.toString(16)}`; }
  get bbox(): ElementPrint["bbox"] { return this.faces ? [this.min[0], this.min[1], this.min[2], this.max[0], this.max[1], this.max[2]] : null; }
}

/** ONE index of an ifc.db — the same function on the previous file and the new one */
export function indexIfcDb(db: Database): FileIndex {
  const meta = readMeta(db);
  const types: TypePrint[] = [];
  const typeName = new Map<number, string>();
  if (db.exec("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='element_types'")[0]?.values[0]?.[0]) {
    const layers = new Map<number, string[]>();
    const ls = db.prepare("SELECT type_id, part, material, thickness_m, category FROM type_layers ORDER BY type_id, seq");
    while (ls.step()) { const r = ls.get() as [number, string | null, string, number | null, string | null]; (layers.get(r[0]) ?? layers.set(r[0], []).get(r[0])!).push(`${r[1] ? `${r[1]}: ` : ""}${r[2]}${r[3] === null ? "" : ` ${(r[3] * 1000).toFixed(1)} mm`}${r[4] ? ` (${r[4]})` : ""}`); }
    ls.free();
    const ts = db.prepare("SELECT id, global_id, ifc_class, name, u_w_m2k FROM element_types ORDER BY id");
    while (ts.step()) { const r = ts.get() as [number, string | null, string, string | null, number | null]; const name = r[3] ?? `#${r[0]}`; typeName.set(r[0], name); types.push({ id: r[0], name, ifcClass: r[2], uWm2k: r[4], layers: (layers.get(r[0]) ?? []).join(" · ") }); }
    ts.free();
  }
  const acc = new Map<number, GeomAcc>();
  const fs = db.prepare("SELECT element_id, area_m2, outer, holes FROM faces");
  while (fs.step()) {
    const r = fs.get() as [number, number, string, string];
    (acc.get(r[0]) ?? acc.set(r[0], new GeomAcc()).get(r[0])!).add(JSON.parse(r[2]) as Array<[number, number, number]>, JSON.parse(r[3]) as Array<Array<[number, number, number]>>, r[1]);
  }
  fs.free();
  const elements: ElementPrint[] = [];
  const es = db.prepare("SELECT id, global_id, ifc_class, name, storey, is_external, predefined_type, spaces, glazing_fraction, glazing_pset, overall_width_m, overall_height_m, type_id FROM elements ORDER BY id");
  while (es.step()) {
    const r = es.get() as [number, string | null, string, string | null, string | null, number | null, string | null, string | null, number | null, number | null, number | null, number | null, number | null];
    const g = acc.get(r[0]);
    const tn = r[12] === null ? null : typeName.get(r[12]) ?? `#${r[12]}`;
    const word: Record<string, string> = { class: r[2], name: r[3] ?? "", storey: r[4] ?? "", IsExternal: r[5] === null ? "not stated" : r[5] ? "true" : "false", PredefinedType: r[6] ?? "", spaces: r[7] ?? "", glazing: r[8] === null ? (r[9] ? "pset" : "") : String(r[8]), size: r[10] === null && r[11] === null ? "" : `${((r[10] ?? 0) * 1000).toFixed(0)} × ${((r[11] ?? 0) * 1000).toFixed(0)} mm`, type: tn ?? "" };
    elements.push({ id: r[0], globalId: r[1], ifcClass: r[2], name: r[3], spaces: r[7], storey: r[4], typeName: tn, word, geom: g?.geom ?? "-", areaM2: g?.area ?? 0, faces: g?.faces ?? 0, bbox: g?.bbox ?? null });
  }
  es.free();
  const spaces: SpacePrint[] = [];
  const sacc = new Map<number, GeomAcc>();
  const sfs = db.prepare("SELECT space_id, area_m2, outer, holes FROM space_faces");
  while (sfs.step()) { const r = sfs.get() as [number, number, string, string]; (sacc.get(r[0]) ?? sacc.set(r[0], new GeomAcc()).get(r[0])!).add(JSON.parse(r[2]) as Array<[number, number, number]>, JSON.parse(r[3]) as Array<Array<[number, number, number]>>, r[1]); }
  sfs.free();
  const ss = db.prepare("SELECT id, global_id, name, long_name FROM spaces ORDER BY id");
  while (ss.step()) { const r = ss.get() as [number, string | null, string | null, string | null]; const g = sacc.get(r[0]); spaces.push({ id: r[0], globalId: r[1], name: r[3] ?? r[2] ?? `#${r[0]}`, geom: g?.geom ?? "-", areaM2: g?.area ?? 0, faces: g?.faces ?? 0 }); }
  ss.free();
  return { sha: meta.get("source_sha256") ?? "", name: meta.get("source_name") ?? "", elements, types, spaces };
}

export const elementLabel = (p: { id: number; ifcClass: string; name: string | null; spaces: string | null }): string =>
  `#${p.id} ${p.ifcClass.replace(/^Ifc/, "")}${p.spaces ? ` [${p.spaces}]` : ""}${p.name ? ` "${p.name.length > 48 ? `${p.name.slice(0, 46)}…` : p.name}"` : ""}`;

export interface Change {
  kind: "added" | "removed" | "changed";
  what: "element" | "type" | "space";
  /** the identity: an element's or a room's GlobalId, a type's name */
  key: string;
  label: string;
  /** the previous and the current express id (an element or a room) */
  prevId: number | null; nextId: number | null;
  /** what moved, in words: `name "a" → "b"`, `geometry: area 12.30 → 12.41 m², moved 0.030 m` */
  diffs: string[];
}
export interface FileDiff {
  prevSha: string; nextSha: string;
  /** the share of GlobalIds the two files have in common (over the larger set) — under 0.5 it is another building */
  overlap: number;
  unchanged: number;
  changes: Change[];
  /** old express id → new, by GlobalId — how a ruling is re-keyed */
  elementIds: Map<number, number>;
  spaceIds: Map<number, number>;
  changedElements: Set<string>; goneElements: Set<string>;
  changedTypes: Set<string>; goneTypes: Set<string>;
  changedSpaces: Set<string>; goneSpaces: Set<string>;
  roomNames: Set<string>;
}
const idKey = (p: { id: number; globalId: string | null }): string => p.globalId ?? `#${p.id}`;
const dist = (a: number[], b: number[]): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

export function diffIndex(prev: FileIndex, next: FileIndex): FileDiff {
  const changes: Change[] = [];
  const elementIds = new Map<number, number>(), spaceIds = new Map<number, number>();
  const changedElements = new Set<string>(), goneElements = new Set<string>(), changedTypes = new Set<string>(), goneTypes = new Set<string>(), changedSpaces = new Set<string>(), goneSpaces = new Set<string>();
  let unchanged = 0;
  const pe = new Map(prev.elements.map((e) => [idKey(e), e])), ne = new Map(next.elements.map((e) => [idKey(e), e]));
  let common = 0;
  for (const [k, a] of pe) {
    const b = ne.get(k);
    if (!b) { goneElements.add(k); changes.push({ kind: "removed", what: "element", key: k, label: elementLabel(a), prevId: a.id, nextId: null, diffs: [] }); continue; }
    common++; elementIds.set(a.id, b.id);
    const diffs: string[] = [];
    for (const f of Object.keys(a.word)) if (a.word[f] !== b.word[f]) diffs.push(`${f} ${a.word[f] ? `"${a.word[f]}"` : "—"} → ${b.word[f] ? `"${b.word[f]}"` : "—"}`);
    if (a.geom !== b.geom) {
      const moved = a.bbox && b.bbox ? Math.max(dist(a.bbox.slice(0, 3), b.bbox.slice(0, 3)), dist(a.bbox.slice(3), b.bbox.slice(3))) : 0;
      diffs.push(`geometry: area ${a.areaM2.toFixed(2)} → ${b.areaM2.toFixed(2)} m² · faces ${a.faces} → ${b.faces} · extent moved ${moved.toFixed(3)} m`);
    }
    if (diffs.length) { changedElements.add(k); changes.push({ kind: "changed", what: "element", key: k, label: elementLabel(b), prevId: a.id, nextId: b.id, diffs }); }
    else unchanged++;
  }
  for (const [k, b] of ne) if (!pe.has(k)) changes.push({ kind: "added", what: "element", key: k, label: elementLabel(b), prevId: null, nextId: b.id, diffs: [] });
  const pt = new Map(prev.types.map((t) => [t.name, t])), nt = new Map(next.types.map((t) => [t.name, t]));
  for (const [k, a] of pt) {
    const b = nt.get(k);
    if (!b) { goneTypes.add(k); changes.push({ kind: "removed", what: "type", key: k, label: k, prevId: a.id, nextId: null, diffs: [] }); continue; }
    const diffs: string[] = [];
    if ((a.uWm2k ?? null) !== (b.uWm2k ?? null)) diffs.push(`stated U ${a.uWm2k === null ? "—" : a.uWm2k.toFixed(3)} → ${b.uWm2k === null ? "—" : b.uWm2k.toFixed(3)} W/m²K`);
    if (a.layers !== b.layers) diffs.push(`layers ${a.layers || "—"} → ${b.layers || "—"}`);
    if (diffs.length) { changedTypes.add(k); changes.push({ kind: "changed", what: "type", key: k, label: k, prevId: a.id, nextId: b.id, diffs }); }
  }
  for (const [k, b] of nt) if (!pt.has(k)) changes.push({ kind: "added", what: "type", key: k, label: k, prevId: null, nextId: b.id, diffs: [] });
  const ps = new Map(prev.spaces.map((s) => [idKey(s), s])), ns = new Map(next.spaces.map((s) => [idKey(s), s]));
  for (const [k, a] of ps) {
    const b = ns.get(k);
    if (!b) { goneSpaces.add(k); changes.push({ kind: "removed", what: "space", key: k, label: `room ${a.name}`, prevId: a.id, nextId: null, diffs: [] }); continue; }
    spaceIds.set(a.id, b.id);
    const diffs: string[] = [];
    if (a.name !== b.name) diffs.push(`name "${a.name}" → "${b.name}"`);
    if (a.geom !== b.geom) diffs.push(`geometry: area ${a.areaM2.toFixed(2)} → ${b.areaM2.toFixed(2)} m² · faces ${a.faces} → ${b.faces}`);
    if (diffs.length) { changedSpaces.add(k); changes.push({ kind: "changed", what: "space", key: k, label: `room ${b.name}`, prevId: a.id, nextId: b.id, diffs }); }
  }
  for (const [k, b] of ns) if (!ps.has(k)) changes.push({ kind: "added", what: "space", key: k, label: `room ${b.name}`, prevId: null, nextId: b.id, diffs: [] });
  return { prevSha: prev.sha, nextSha: next.sha, overlap: common / Math.max(1, pe.size, ne.size), unchanged, changes, elementIds, spaceIds, changedElements, goneElements, changedTypes, goneTypes, changedSpaces, goneSpaces, roomNames: new Set(next.spaces.map((s) => s.name)) };
}

export function formatDiff(d: FileDiff): string[] {
  const n = (what: Change["what"], kind: Change["kind"]): number => d.changes.filter((c) => c.what === what && c.kind === kind).length;
  const out = [`FILE CHANGED ${d.prevSha.slice(0, 12)} → ${d.nextSha.slice(0, 12)}: GlobalIds in common ${(100 * d.overlap).toFixed(1)} % · elements unchanged ${d.unchanged} · removed ${n("element", "removed")} · added ${n("element", "added")} · changed ${n("element", "changed")} · types changed ${n("type", "changed")} (removed ${n("type", "removed")}, added ${n("type", "added")}) · rooms changed ${n("space", "changed")} (removed ${n("space", "removed")}, added ${n("space", "added")})`];
  for (const c of d.changes) out.push(`    ${c.kind.padEnd(7)} ${c.what.padEnd(7)} ${c.label}${c.diffs.length ? ` — ${c.diffs.join("; ")}` : ""}`);
  return out;
}

// ── THE RULINGS THAT RIDE THE CHANGE ─────────────────────────────────────────
export type Verdict = "carried" | "changed" | "gone";
export interface RulingCase {
  /** `corrections:steps:80607|11804|11582` — the ledger, the table, the key */
  id: string;
  ledger: "corrections" | "bem" | "bom";
  kind: string;
  label: string;
  /** the subjects, as the census names them */
  subjects: string[];
  verdict: Verdict;
  why: string;
}
export interface Ledgers { corrections: CorrectionsLedger | null; bem: BemLedger | null; bom: unknown | null }
export interface CarryRecord {
  fromSha: string; fromName: string; at: string;
  carried: number;
  /** changed subjects the user KEPT their ruling on, over the file's change */
  kept: string[];
  /** changed subjects where the file's word was taken — the ruling dropped */
  overwritten: string[];
  /** subjects gone from the file — the ruling dropped and named */
  dropped: string[];
}
export interface Carry { cases: RulingCase[]; build(keep: (c: RulingCase) => boolean, at?: string): Ledgers & { record: CarryRecord } }

const roomOfVoid = (name: string): string => roomOfVoidZone(name);

/** classify every ruling in the previous file's ledgers against the diff, and
 *  build the ledgers for the new file from the user's choices */
export function carryRulings(prev: FileIndex, next: FileIndex, diff: FileDiff, old: Ledgers): Carry {
  const pe = new Map(prev.elements.map((e) => [e.id, e])), ps = new Map(prev.spaces.map((s) => [s.id, s]));
  const ne = new Map(next.elements.map((e) => [e.id, e]));
  const cases: RulingCase[] = [];
  const elCase = (ids: number[]): { verdict: Verdict; why: string; subjects: string[] } => {
    const subjects: string[] = []; let verdict: Verdict = "carried"; const whys: string[] = [];
    for (const id of ids) {
      const e = pe.get(id); const k = e ? idKey(e) : `#${id}`;
      subjects.push(e ? elementLabel(e) : `#${id}`);
      if (!e || diff.goneElements.has(k)) { verdict = "gone"; whys.push(`${e ? elementLabel(e) : `#${id}`} is not in the file`); }
      else if (diff.changedElements.has(k) && verdict !== "gone") { verdict = "changed"; whys.push(...(diff.changes.find((c) => c.what === "element" && c.key === k)?.diffs ?? [])); }
    }
    return { verdict, why: whys.join("; "), subjects };
  };
  const spCase = (ids: number[]): { verdict: Verdict; why: string; subjects: string[] } => {
    const subjects: string[] = []; let verdict: Verdict = "carried"; const whys: string[] = [];
    for (const id of ids) {
      const s = ps.get(id); const k = s ? idKey(s) : `#${id}`;
      subjects.push(s ? `room ${s.name}` : `room #${id}`);
      if (!s || diff.goneSpaces.has(k)) { verdict = "gone"; whys.push(`room ${s?.name ?? `#${id}`} is not in the file`); }
      else if (diff.changedSpaces.has(k) && verdict !== "gone") { verdict = "changed"; whys.push(...(diff.changes.find((c) => c.what === "space" && c.key === k)?.diffs ?? [])); }
    }
    return { verdict, why: whys.join("; "), subjects };
  };
  const nameCase = (names: string[]): { verdict: Verdict; why: string; subjects: string[] } => {
    const missing = names.filter((n) => !diff.roomNames.has(n));
    return { verdict: missing.length ? "gone" : "carried", why: missing.map((n) => `room ${n} is not in the file`).join("; "), subjects: names.map((n) => `room ${n}`) };
  };
  const typeCase = (name: string): { verdict: Verdict; why: string; subjects: string[] } => {
    if (diff.goneTypes.has(name)) return { verdict: "gone", why: `type ${name} is not in the file`, subjects: [`type ${name}`] };
    if (diff.changedTypes.has(name)) return { verdict: "changed", why: (diff.changes.find((c) => c.what === "type" && c.key === name)?.diffs ?? []).join("; "), subjects: [`type ${name}`] };
    return { verdict: "carried", why: "", subjects: [`type ${name}`] };
  };
  const c = old.corrections, b = old.bem;
  const num = (s: string): number => Number(s.split("|")[0]);
  const rekeyEl = (s: string): string => { const [id, ...rest] = s.split("|"); const n = diff.elementIds.get(Number(id)); return n === undefined ? s : [n, ...rest].join("|"); };
  const rekeySp = (s: string): string => { const [id, ...rest] = s.split("|"); const n = diff.spaceIds.get(Number(id)); return n === undefined ? s : [n, ...rest].join("|"); };
  if (c) {
    for (const [key, choice] of Object.entries(c.steps ?? {})) { const [lo, up] = key.split("|").map(Number); const r = elCase([lo!, up!]); cases.push({ id: `corrections:steps:${key}`, ledger: "corrections", kind: "storey step", label: `${choice} · ${r.subjects.join(" under ")}`, ...r }); }
    (c.extends ?? []).forEach((op, i) => { const r = elCase([num(op.from), num(op.to)]); cases.push({ id: `corrections:extends:${i}`, ledger: "corrections", kind: "extend to surface", label: `${r.subjects[0]} → ${r.subjects[1]}`, ...r }); });
    (c.spaceExtends ?? []).forEach((op, i) => { const r = spCase([num(op.from), num(op.to)]); cases.push({ id: `corrections:spaceExtends:${i}`, ledger: "corrections", kind: "extend space to space", label: `${r.subjects[0]} → ${r.subjects[1]}`, ...r }); });
    for (const [name, target] of Object.entries(c.zones?.spaces ?? {})) { const r = nameCase([name, target]); cases.push({ id: `corrections:zones.spaces:${name}`, ledger: "corrections", kind: "zone ruling", label: `${name} into ${target}`, ...r }); }
    for (const [name, target] of Object.entries(c.zones?.voids ?? {})) { const r = nameCase([roomOfVoid(name), roomOfVoid(target)]); cases.push({ id: `corrections:zones.voids:${name}`, ledger: "corrections", kind: "zone ruling", label: `${name} into ${target}`, ...r }); }
    for (const [gid, glass] of Object.entries(c.glazing ?? {})) {
      const e = prev.elements.find((x) => x.globalId === gid); const r = e ? elCase([e.id]) : { verdict: "gone" as Verdict, why: `${gid} is not in the file`, subjects: [gid] };
      cases.push({ id: `corrections:glazing:${gid}`, ledger: "corrections", kind: "glazing", label: `${glass ? "glass" : "opaque"} · ${r.subjects[0]}`, ...r });
    }
    if ((c.shading?.deleted ?? []).length) cases.push({ id: "corrections:shading", ledger: "corrections", kind: "shading", label: `${c.shading!.deleted.length} site elements deleted from the model`, subjects: ["the site file"], verdict: "carried", why: "keyed to the site file, not this one" });
    // the void answers (2026-09-18) ride on the room the void stands over, like the zone rulings; the per-file turn
    // (2026-09-15) is about the files beside the house, like siteFiles — both were DROPPED by the carry until 2026-09-25
    for (const [name, a] of Object.entries(c.voids ?? {})) { const r = nameCase([roomOfVoid(name)]); cases.push({ id: `corrections:voids:${name}`, ledger: "corrections", kind: "void answer", label: `${name}: ${a.answer}${a.grille ? " (grille)" : ""}`, ...r }); }
    if (Object.keys(c.siteFileTurn ?? {}).length) cases.push({ id: "corrections:siteFileTurn", ledger: "corrections", kind: "site file turn", label: Object.entries(c.siteFileTurn!).map(([n, d]) => `${n} ${d}° CW`).join(", "), subjects: ["the files beside the house"], verdict: "carried", why: "keyed to those files, not this one" });
    if (Object.keys(c.siteFiles ?? {}).length) cases.push({ id: "corrections:siteFiles", ledger: "corrections", kind: "site files", label: Object.entries(c.siteFiles!).map(([n, v]) => `${n} ${v ? "projected" : "left out"}`).join(", "), subjects: ["the files beside the house"], verdict: "carried", why: "" });
    if (Object.keys(c.staged?.zones ?? {}).length) cases.push({ id: "corrections:staged", ledger: "corrections", kind: "staged zone rulings", label: `${Object.keys(c.staged!.zones).length} staged, not yet applied`, subjects: ["the zones"], verdict: "carried", why: "" });
  }
  if (b) {
    for (const [name, r0] of Object.entries(b.constructions ?? {})) { const r = typeCase(name); cases.push({ id: `bem:constructions:${name}`, ledger: "bem", kind: "construction", label: `${r0.source}${r0.name ? ` "${r0.name}"` : ""} · ${name}`, ...r }); }
    for (const name of Object.keys(b.zones ?? {})) { const r = nameCase([name]); cases.push({ id: `bem:zones:${name}`, ledger: "bem", kind: "zone settings", label: name, ...r }); }
    // the gains (2026-09-13): a room's ruling rides on the room's name, a drawn zone's on the zone's (a name the sheet gives, not the file)
    for (const name of Object.keys(b.gains?.rooms ?? {})) { const r = nameCase([name]); cases.push({ id: `bem:gains.rooms:${name}`, ledger: "bem", kind: "room gains", label: name, ...r }); }
    for (const name of Object.keys(b.gains?.zones ?? {})) cases.push({ id: `bem:gains.zones:${name}`, ledger: "bem", kind: "zone gains", label: name, subjects: [`zone ${name}`], verdict: "carried", why: "" });
    // a transfer-air path (2026-11-11) rides on its three rooms' names
    (b.gains?.transfers ?? []).forEach((t, i) => { const r = nameCase([t.from, t.via, t.to]); cases.push({ id: `bem:gains.transfers:${i}`, ledger: "bem", kind: "transfer air", label: `${t.from} → ${t.via} → ${t.to}`, ...r }); });
    if (b.weather) cases.push({ id: "bem:weather", ledger: "bem", kind: "weather file", label: b.weather.epw.split(/[\\/]/).pop() ?? b.weather.epw, subjects: ["the site"], verdict: "carried", why: "" });
    if (b.site && Object.keys(b.site).length) cases.push({ id: "bem:site", ledger: "bem", kind: "site settings", label: Object.keys(b.site).join(", "), subjects: ["the site"], verdict: "carried", why: "" });
    if (b.ground) cases.push({ id: "bem:ground", ledger: "bem", kind: "ground coupling", label: b.ground.method ?? "the slab insulation", subjects: ["the floors"], verdict: "carried", why: "" });
    if (b.staged) cases.push({ id: "bem:staged", ledger: "bem", kind: "staged rulings", label: `${Object.keys(b.staged.constructions ?? {}).length} constructions${b.staged.site ? " + site" : ""}${b.staged.ground ? " + ground" : ""} staged, not yet applied`, subjects: ["the BEM tabs"], verdict: "carried", why: "" });
  }
  if (old.bom) cases.push({ id: "bom", ledger: "bom", kind: "bills", label: "the imported bills and their column maps", subjects: ["the operations model"], verdict: "carried", why: "" });

  const build: Carry["build"] = (keep, at = new Date().toISOString()) => {
    const on = (id: string): boolean => { const k = cases.find((x) => x.id === id); return !!k && (k.verdict === "carried" || (k.verdict === "changed" && keep(k))); };
    const record: CarryRecord = { fromSha: prev.sha, fromName: prev.name, at, carried: 0, kept: [], overwritten: [], dropped: [] };
    for (const k of cases) { if (k.verdict === "carried") record.carried++; else if (k.verdict === "gone") record.dropped.push(`${k.kind}: ${k.label} (${k.why})`); else if (keep(k)) record.kept.push(`${k.kind}: ${k.label} (${k.why})`); else record.overwritten.push(`${k.kind}: ${k.label} (${k.why})`); }
    let corrections: CorrectionsLedger | null = null;
    if (c) {
      // every key the ledger holds comes across (…c first): a ruling kind added later is carried as it stands, never
      // silently lost — the keys below are the ones a file change can touch, rebuilt from the user's choices
      corrections = {
        ...c,
        sourceName: next.name, sourceSha256: next.sha, savedAt: at,
        steps: Object.fromEntries(Object.entries(c.steps ?? {}).filter(([k]) => on(`corrections:steps:${k}`)).map(([k, v]) => { const [lo, up, ...rest] = k.split("|"); return [[diff.elementIds.get(Number(lo)) ?? lo, diff.elementIds.get(Number(up)) ?? up, ...rest].join("|"), v]; })),
        extends: (c.extends ?? []).filter((_, i) => on(`corrections:extends:${i}`)).map((op) => ({ from: rekeyEl(op.from), to: rekeyEl(op.to) })),
        spaceExtends: (c.spaceExtends ?? []).filter((_, i) => on(`corrections:spaceExtends:${i}`)).map((op) => ({ from: rekeySp(op.from), to: rekeySp(op.to) })),
        zones: { spaces: Object.fromEntries(Object.entries(c.zones?.spaces ?? {}).filter(([k]) => on(`corrections:zones.spaces:${k}`))), voids: Object.fromEntries(Object.entries(c.zones?.voids ?? {}).filter(([k]) => on(`corrections:zones.voids:${k}`))) },
        deletes: c.deletes ?? [],
        glazing: Object.fromEntries(Object.entries(c.glazing ?? {}).filter(([k]) => on(`corrections:glazing:${k}`))),
        shading: c.shading ?? { siteSha256: "", deleted: [] },
        siteFiles: c.siteFiles ?? {},
        siteFileTurn: c.siteFileTurn ?? {},
        voids: Object.fromEntries(Object.entries(c.voids ?? {}).filter(([k]) => on(`corrections:voids:${k}`))),
        carried: record,
      };
      if (c.staged) corrections.staged = c.staged; else delete corrections.staged;
    }
    let bem: BemLedger | null = null;
    if (b) {
      bem = { ...b, sourceIfcSha256: next.sha, savedAt: at, constructions: Object.fromEntries(Object.entries(b.constructions ?? {}).filter(([k]) => on(`bem:constructions:${k}`))), zones: Object.fromEntries(Object.entries(b.zones ?? {}).filter(([k]) => on(`bem:zones:${k}`))), carriedFrom: record };
      if (b.gains) { const rooms = Object.fromEntries(Object.entries(b.gains.rooms ?? {}).filter(([k]) => on(`bem:gains.rooms:${k}`))); const transfers = (b.gains.transfers ?? []).filter((_, i) => on(`bem:gains.transfers:${i}`)); const g = { ...(b.gains.zones ? { zones: b.gains.zones } : {}), ...(Object.keys(rooms).length ? { rooms } : {}), ...(transfers.length ? { transfers } : {}) }; if (Object.keys(g).length) bem.gains = g; else delete bem.gains; }
    }
    const bom = old.bom && typeof old.bom === "object" ? { ...(old.bom as Record<string, unknown>), sourceIfcSha256: next.sha } : null;
    // the labels a new element carries: re-keyed subjects are named by the NEW file
    void ne;
    return { corrections, bem, bom, record };
  };
  return { cases, build };
}

export function formatCases(cases: RulingCase[]): string[] {
  const n = (v: Verdict): number => cases.filter((c) => c.verdict === v).length;
  const out = [`RULINGS ON THE CHANGED FILE: ${cases.length} — carried ${n("carried")} · changed (the user's choice) ${n("changed")} · gone (dropped, named) ${n("gone")}`];
  for (const c of cases) if (c.verdict !== "carried") out.push(`    ${c.verdict.padEnd(7)} ${c.ledger}/${c.kind}: ${c.label}${c.why ? ` — ${c.why}` : ""}`);
  return out;
}
