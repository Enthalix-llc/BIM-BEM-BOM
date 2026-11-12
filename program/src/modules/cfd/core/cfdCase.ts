// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// A ROOM'S OPENFOAM CASE, WRITTEN (the Bed 1 scripts of 2026-11-03, general): the room's air is idf.db's room solid,
// one STL region per face; each face held at the area-weighted INSIDE face temperature EnergyPlus gave the surfaces
// on its plane at the design hour (the run's own IDF says which surfaces are the room's — their Space Name field);
// each window and door its own patch at its own temperature; the terminals the user placed are boxes that cut inlet
// and outlet patches out of the faces after meshing (topoSet + createPatch). The supply's temperature delivers the
// space's EnergyPlus design load at the supply flow about the setpoint: T = Tset ± Q / (ρ·cp·V̇).
//
// The solver set-up is the one the Bed 1 runs proved stable on this machine: buoyantSimpleFoam, Boussinesq about the
// setpoint, k-ε started at k 0.08 / ε 0.23 (near-zero starting turbulence diverged at iteration 2), relaxation p_rgh 0.3 ·
// U 0.2 · h 0.2 · k/ε 0.5, the comfortHotRoom tutorial's temperature limit and velocity damping as a safety net, the
// fields averaged over the last 3,000 iterations. Nothing here is a value the code tables state: they are the solver's.

import earcut from "earcut";
import { touchesRoom } from "./cfdPrep.js";

type V3 = [number, number, number];
/** "transfer" — a transfer grille the room's air LEAVES by (free); "transfer-in" — one the next room's air ENTERS by, at a set flow
 *  (2026-11-10, the user: "set transfer registers … to match supply that is transferred") and AT THE TEMPERATURE OF THE ROOM IT
 *  COMES FROM (2026-11-11, the user: "Transfer air should be the room temperature from which it transfers from") */
export type TerminalRole = "supply" | "return" | "transfer" | "transfer-in" | "exhaust";
/** a face of the room's solid; `holes` are cut out of it (2026-11-10: the Great room's ceiling has one, filled by another face —
 *  written as the outer ring alone, that ceiling area was counted twice and the room did not close) */
/** `tris`: the face's own triangles when its maker states them (the enclosure's — the cells' faces, so the surface written closes
 *  edge for edge); absent, the outline is cut into triangles */
export interface RoomFace { n: V3; outer: V3[]; areaM2: number; holes?: V3[][]; tris?: V3[][] }
/** `from` / `fromC`: the room the air comes from through this opening and its temperature at the peak — a transfer in's supply
 *  temperature; on a free opening, the temperature of any air that comes back in by it (absent: this room's setpoint) */
export interface TerminalBox { name: string; role: TerminalRole; cfm: number; lo: V3; hi: V3; from?: string | null; fromC?: number | null }
export type DoorMode = "sealed" | "undercut" | "open";
/** an interior door: by its IDF subsurface name, or the file's own door by its four corners (idf.db openings) */
export interface DoorChoice { name: string; mode: DoorMode; undercutM?: number; quad?: V3[] }

export interface CaseInput {
  space: string;
  peak: "heating" | "cooling";
  /** "1/21 04:00" — the label the run carries */
  designTime: string;
  outdoorC: number | null;
  faces: RoomFace[];
  /** the run's own IDF text (in.idf) */
  idf: string;
  /** each surface's inside face temperature at the design hour, by its IDF name in upper case */
  insideC: Map<string, number>;
  terminals: TerminalBox[];
  doors: DoorChoice[];
  setpointC: number;
  loadW: number;
  /** a supply temperature typed instead of the one the load gives */
  supplyC?: number | null;
  meshM?: number;
  iterations?: number;
  /** STOP WHEN SETTLED (2026-11-10): `iterations` becomes the cap; the fields averaged over a moving window of the last 3,000; the
   *  app watches the room's averages and ends the run once they hold still (cfdConverge.ts) — absent, the fixed count as before */
  stop?: { tolK: number; minIterations: number } | null;
  clothing?: number;
}

export interface EpSurface { name: string; type: string; bc: string; pts: V3[] }
export interface EpOpening { name: string; type: string; base: string; pts: V3[] }

const CFM = 0.000471947443, RHO = 1.2, CP = 1005;
const K = (c: number): number => c + 273.15;
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const mean = (ps: V3[]): V3 => { const s: V3 = [0, 0, 0]; for (const p of ps) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; } return [s[0] / ps.length, s[1] / ps.length, s[2] / ps.length]; };
const f6 = (x: number): string => (Math.abs(x) < 1e-12 ? "0" : x.toFixed(6));

/** polygon area vector / 2 (Newell) */
function areaVec(ps: V3[]): V3 {
  const s: V3 = [0, 0, 0];
  for (let i = 0; i < ps.length; i++) { const a = ps[i]!, b = ps[(i + 1) % ps.length]!; s[0] += (a[1] - b[1]) * (a[2] + b[2]); s[1] += (a[2] - b[2]) * (a[0] + b[0]); s[2] += (a[0] - b[0]) * (a[1] + b[1]); }
  return [s[0] / 2, s[1] / 2, s[2] / 2];
}
export const polyArea = (ps: V3[]): number => Math.hypot(...areaVec(ps));

/** BuildingSurface:Detailed and FenestrationSurface:Detailed of one SPACE, read from the IDF, in the house frame
 *  (EnergyPlus (X, Y, Z) = house (x, −z, y), so house = (X, Z, −Y)) */
export function idfSurfacesOf(idf: string, space: string): { base: EpSurface[]; subs: EpOpening[] } {
  const objs = idf.replace(/!.*$/gm, "").split(";").map((o) => o.split(",").map((x) => x.trim()));
  const toHouse = (f: string[], from: number): V3[] => {
    const v = f.slice(from).filter((x) => x !== "").map(Number);
    const out: V3[] = [];
    for (let i = 0; i + 2 < v.length; i += 3) out.push([v[i]!, v[i + 2]!, -v[i + 1]!]);
    return out;
  };
  const base: EpSurface[] = [];
  for (const f of objs) if (/^BuildingSurface:Detailed$/i.test(f[0] ?? "") && (f[5] ?? "") === space) base.push({ name: f[1]!, type: f[2]!, bc: f[6]!, pts: toHouse(f, 12) });
  const names = new Set(base.map((b) => b.name));
  const subs: EpOpening[] = [];
  for (const f of objs) if (/^FenestrationSurface:Detailed$/i.test(f[0] ?? "") && names.has(f[4] ?? "")) subs.push({ name: f[1]!, type: f[2]!, base: f[4]!, pts: toHouse(f, 10) });
  return { base, subs };
}

/** a face's word for its patch: floor, ceiling/roof (sloped), or a wall by its compass on the drawing (north = the model's −z) */
function faceKind(n: V3): string {
  if (n[1] < -0.9) return "floor";
  if (n[1] > 0.9) return "ceiling";
  if (n[1] > 0.2) return "roof";
  const a = Math.atan2(n[0], -n[2]) * 180 / Math.PI;   // 0 = north, 90 = east
  const dirs = ["north", "east", "south", "west"];
  return `wall_${dirs[(Math.round(((a + 360) % 360) / 90)) % 4]}`;
}

/** triangles of one planar polygon (earcut in its own plane), wound to the face's normal */
export function triangles(f: RoomFace): V3[][] {
  if (f.tris) return f.tris;
  const a = [0, 1, 2].reduce((m, i) => (Math.abs(f.n[i]!) > Math.abs(f.n[m]!) ? i : m), 0);
  const [u, v] = [0, 1, 2].filter((i) => i !== a) as [number, number];
  const pts: V3[] = [...f.outer], holeAt: number[] = [];
  for (const h of f.holes ?? []) { if (h.length < 3) continue; holeAt.push(pts.length); pts.push(...h); }
  const flat: number[] = [];
  for (const p of pts) flat.push(p[u]!, p[v]!);
  const idx = earcut(flat, holeAt.length ? holeAt : undefined);
  const out: V3[][] = [];
  for (let i = 0; i < idx.length; i += 3) {
    let t: V3[] = [pts[idx[i]!]!, pts[idx[i + 1]!]!, pts[idx[i + 2]!]!];
    if (dot(cross(sub(t[1]!, t[0]!), sub(t[2]!, t[0]!)), f.n) < 0) t = [t[0]!, t[2]!, t[1]!];
    out.push(t);
  }
  return out;
}

/** a point inside the room for snappyHexMesh's locationInMesh: ray parity against the room's triangles, tried from the
 *  floor's centre 1 m up, then a grid over the room's box */
export function pointInside(faces: RoomFace[]): V3 | null {
  const tris = faces.flatMap(triangles);
  const inside = (p: V3): boolean => {
    let hits = 0;
    const d: V3 = norm([0.2341, 0.0017, 0.9723]);
    for (const [a, b, c] of tris as Array<[V3, V3, V3]>) {
      const e1 = sub(b, a), e2 = sub(c, a), h = cross(d, e2), det = dot(e1, h);
      if (Math.abs(det) < 1e-12) continue;
      const s = sub(p, a), uu = dot(s, h) / det;
      if (uu < 0 || uu > 1) continue;
      const q = cross(s, e1), vv = dot(d, q) / det;
      if (vv < 0 || uu + vv > 1) continue;
      if (dot(e2, q) / det > 1e-9) hits++;
    }
    return hits % 2 === 1;
  };
  const all = faces.flatMap((f) => f.outer);
  const lo = [0, 1, 2].map((i) => Math.min(...all.map((p) => p[i]!))), hi = [0, 1, 2].map((i) => Math.max(...all.map((p) => p[i]!)));
  const floor = faces.filter((f) => f.n[1] < -0.9).sort((a, b) => b.areaM2 - a.areaM2)[0];
  if (floor) { const c = mean(floor.outer); const p: V3 = [c[0] + 0.0137, lo[1]! + 1.0, c[2] + 0.0113]; if (inside(p)) return p; }
  for (let k = 1; k < 8; k++) for (let i = 1; i < 8; i++) for (let j = 1; j < 4; j++) {
    const p: V3 = [lo[0]! + (hi[0]! - lo[0]!) * (i / 8 + 0.0131), lo[1]! + Math.min(1.0, (hi[1]! - lo[1]!) * j / 4), lo[2]! + (hi[2]! - lo[2]!) * (k / 8 + 0.0117)];
    if (inside(p)) return p;
  }
  return null;
}

export interface CaseOut {
  files: Record<string, string>;
  info: Record<string, unknown>;
  /** reasons the case cannot be run — none means it can */
  refusals: string[];
  /** what was assumed, said in words for the run's record */
  notes: string[];
  /** what lets the case run but makes its answer doubtful — shown at the top of Run CFD… (2026-11-10) */
  cautions: string[];
}

/** a box on the room face nearest a subsurface, as geometry.py's openings() */
function onFace(faces: RoomFace[], pts: V3[]): { lo: V3; hi: V3; face: number } | null {
  const c = mean(pts), n = norm(areaVec(pts));
  let best = -1, bd = Infinity;
  faces.forEach((f, i) => {
    if (Math.abs(dot(f.n, n)) < 0.98) return;
    const d = Math.abs(dot(sub(c, f.outer[0]!), f.n));
    if (d < bd) { bd = d; best = i; }
  });
  if (best < 0 || bd > 0.8) return null;
  const f = faces[best]!, d = dot(sub(c, f.outer[0]!), f.n);
  const P = pts.map((p) => [p[0] - d * f.n[0], p[1] - d * f.n[1], p[2] - d * f.n[2]] as V3);
  const lo = [0, 1, 2].map((i) => Math.min(...P.map((p) => p[i]!))) as V3, hi = [0, 1, 2].map((i) => Math.max(...P.map((p) => p[i]!))) as V3;
  const a = [0, 1, 2].reduce((m, i) => (Math.abs(f.n[i]!) > Math.abs(f.n[m]!) ? i : m), 0);
  lo[a] = lo[a]! - 0.03; hi[a] = hi[a]! + 0.03;
  return { lo, hi, face: best };
}

const HEAD = (cls: string, obj: string): string => `FoamFile { version 2.0; format ascii; class ${cls}; object ${obj}; }\n`;
// an OpenFOAM word may not start with a digit — it reads as a number and the dictionary fails to parse (measured 2026-11-10: the
// Great room's grille "9S80V:4355281" stopped snappyHexMesh on "Expected a '(' or a '{' … found word '9S80V_4355281_box'")
const word = (s: string): string => { const w = s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "x"; return /^[0-9]/.test(w) ? `n${w}`.slice(0, 40) : w; };

export function writeCase(inp: CaseInput): CaseOut {
  const refusals: string[] = [], notes: string[] = [];
  // the solver writes its fields every `every` iterations only, so the count is kept a multiple of it — a run that stops between
  // writes leaves nothing to read (the 2026-11-04 trial: 40 iterations, written every 500, left only 0/)
  const h = inp.meshM ?? 0.1, every = Math.min(500, Math.max(1, inp.iterations ?? 11000));
  const iters = Math.ceil((inp.iterations ?? 11000) / every) * every, avgFrom = Math.max(1, iters - 3000);
  const stop = inp.stop ?? null;
  const faces = inp.faces.filter((f) => f.areaM2 > 1e-4 && f.outer.length >= 3);
  if (!faces.length) refusals.push(`${inp.space} has no room solid in idf.db`);
  const { base, subs } = idfSurfacesOf(inp.idf, inp.space);
  if (!base.length) refusals.push(`the run's IDF names no surface in the space "${inp.space}" (its Space Name field) — run the model again on BEM › RUN`);
  // EACH FACE'S TEMPERATURE: the EnergyPlus surfaces on its side and plane, by area (geometry.py's match, build_case.py's weights)
  const names: string[] = [], temps: number[] = [], sources: string[][] = [];
  const used = new Map<string, number>();
  faces.forEach((f, i) => {
    const kind = faceKind(f.n);
    const k = (used.get(kind) ?? 0) + 1; used.set(kind, k);
    names.push(`f${String(i).padStart(2, "0")}_${kind}${k > 1 ? k : ""}`);
    const hits: Array<[string, number]> = [];
    const flo = [0, 1, 2].map((a) => Math.min(...f.outer.map((p) => p[a]!))), fhi = [0, 1, 2].map((a) => Math.max(...f.outer.map((p) => p[a]!)));
    for (const s of base) {
      const n = norm(areaVec(s.pts));
      if (dot(n, f.n) < 0.98) continue;
      if (Math.abs(dot(sub(f.outer[0]!, mean(s.pts)), n)) > 0.6) continue;
      const lo = [0, 1, 2].map((a) => Math.min(...s.pts.map((p) => p[a]!)) - 0.05), hi = [0, 1, 2].map((a) => Math.max(...s.pts.map((p) => p[a]!)) + 0.05);
      const ov = [0, 1, 2].filter((a) => Math.min(fhi[a]!, hi[a]!) - Math.max(flo[a]!, lo[a]!) > 0.05).length;
      if (ov < 2) continue;
      if (!inp.insideC.has(s.name.toUpperCase())) continue;
      hits.push([s.name, polyArea(s.pts)]);
    }
    if (hits.length) {
      const w = hits.reduce((t, [, a]) => t + a, 0);
      temps.push(hits.reduce((t, [n, a]) => t + inp.insideC.get(n.toUpperCase())! * a, 0) / w);
      sources.push(hits.map(([n]) => n));
    } else { temps.push(NaN); sources.push([]); }
  });
  const known = temps.filter(Number.isFinite);
  if (!known.length && faces.length) refusals.push(`no surface of ${inp.space} has an inside face temperature for ${inp.designTime} — the run predates 2026-11-04; run the model again on BEM › RUN`);
  const meanKnown = known.length ? known.reduce((a, b) => a + b, 0) / known.length : inp.setpointC;
  temps.forEach((t, i) => { if (!Number.isFinite(t)) { temps[i] = meanKnown; notes.push(`${names[i]}: no EnergyPlus surface on its plane — held at the mean of the room's other faces, ${meanKnown.toFixed(2)} °C`); } });

  // THE OPENINGS: windows, glass doors and exterior doors are walls at their own temperature; an interior door is the user's —
  // sealed (a wall), closed with an undercut (an outlet slot at its foot), or open (the whole door an outlet)
  const wallPatches: Array<{ name: string; tC: number; lo: V3; hi: V3 }> = [];
  const outlets: Array<{ name: string; lo: V3; hi: V3; cfm: null }> = [];
  /** an interior door the user left open (the whole door an outlet) or closed with an undercut; true when it became an outlet */
  const doorOutlet = (name: string, b: { lo: V3; hi: V3 }, ch: DoorChoice): boolean => {
    if (ch.mode === "open") { outlets.push({ name: `door_${word(name)}`.slice(0, 48), lo: b.lo, hi: b.hi, cfm: null }); notes.push(`${name}: open — the whole door an outlet`); return true; }
    if (ch.mode !== "undercut") return false;
    if (!(ch.undercutM && ch.undercutM > 0)) { refusals.push(`${name}: closed with an undercut, but no undercut height is typed`); return true; }
    const gap = ch.undercutM;
    // the gap's open area (gap × the door's width) as a slot 25 mm tall from 1 mm above the floor: a 19 mm slot needs 6 mm cells and
    // left sliver cells that made the Bed 1 solve unstable (2026-11-03) — the AREA is what passes the air
    const a = [0, 2].find((i) => boxHi(b, i) - boxLo(b, i) > 0.2) ?? 0;
    const width = boxHi(b, a) - boxLo(b, a), slot = 0.025, along = Math.min(width, (gap * width) / slot), mid = (boxHi(b, a) + boxLo(b, a)) / 2;
    const slo: V3 = [...b.lo] as V3, shi: V3 = [...b.hi] as V3;
    slo[1] = b.lo[1] + 0.001; shi[1] = b.lo[1] + slot;
    slo[a] = mid - along / 2; shi[a] = mid + along / 2;
    outlets.push({ name: `undercut_${word(name)}`.slice(0, 48), lo: slo, hi: shi, cfm: null });
    notes.push(`${name}: closed with a ${(gap * 1000).toFixed(0)} mm undercut — an outlet slot of the same open area, ${(along * 1000).toFixed(0)} × 25 mm`);
    return true;
  };
  // the file's own interior doors (idf.db openings, by their four corners) — the IDF writes no subsurface for most of them
  for (const d of inp.doors.filter((x) => x.quad)) {
    const b = onFace(faces, d.quad!);
    if (!b) { if (d.mode !== "sealed") refusals.push(`${d.name}: no face of ${inp.space} beside it`); continue; }
    doorOutlet(d.name, b, d);
  }
  for (const o of subs) {
    const b = onFace(faces, o.pts);
    if (!b) { notes.push(`${o.name}: no room face beside it — left as part of its wall`); continue; }
    const host = base.find((s) => s.name === o.base);
    const interior = /^Surface$/i.test(host?.bc ?? "") && /Door/i.test(o.type);
    const t = inp.insideC.get(o.name.toUpperCase());
    if (interior && doorOutlet(o.name, b, inp.doors.find((d) => d.name === o.name) ?? { name: o.name, mode: "sealed" })) continue;
    if (t == null) { notes.push(`${o.name}: no inside face temperature — left as part of its wall`); continue; }
    wallPatches.push({ name: `${/Window/i.test(o.type) ? "win" : /GlassDoor/i.test(o.type) ? "glassdoor" : "door"}_${word(o.name)}`.slice(0, 48), tC: t, lo: b.lo, hi: b.hi });
  }
  // THE TERMINALS the user placed
  // every terminal must open onto the room — checked here, before anything runs
  for (const t of inp.terminals) if (faces.length && !touchesRoom(faces, t)) refusals.push(`${t.name} does not touch the room's surface — it sits off the face it was put on (past the end of a wall, off the floor, or away from a sloped ceiling). It is red: in CFD · SETUP › 3-D drag it onto the face it sits on (it attaches there; a ceiling: from below), or switch it off`);
  const supplies = inp.terminals.filter((t) => t.role === "supply" && t.cfm > 0);
  const exits = inp.terminals.filter((t) => t.role !== "supply" && t.role !== "transfer-in");
  // AIR FROM THE NEXT ROOM (2026-11-10): a transfer grille the next room's supply comes back through — an inlet at the flow typed,
  // at the temperature of the room it comes from (2026-11-11) — never assumed: no room and no temperature, it is refused
  const transfersIn = inp.terminals.filter((t) => t.role === "transfer-in");
  for (const t of transfersIn) if (!(t.cfm > 0)) refusals.push(`${t.name}: a transfer grille the next room's air enters by needs the flow it brings — type it (the next room's supply that comes back this way)`);
  for (const t of transfersIn) if (t.fromC == null || !Number.isFinite(t.fromC)) refusals.push(`${t.name}: the air comes in at the temperature of the room it transfers from — pick that room (its thermostat at this peak), or type the temperature${t.from ? ` (${t.from} states no ${inp.peak} setpoint)` : ""}`);
  if (!supplies.length) refusals.push("no supply terminal with a flow — give one a role of supply and its cfm");
  if (!exits.length && !outlets.length) refusals.push("no way out for the air — give a terminal a role of return, transfer or exhaust, or an interior door an undercut or open");
  const supplyCfm = supplies.reduce((t, s) => t + s.cfm, 0);
  const dT = supplyCfm > 0 ? inp.loadW / (RHO * CP * supplyCfm * CFM) : 0;
  const tsup = inp.supplyC ?? (inp.peak === "heating" ? inp.setpointC + dT : inp.setpointC - dT);
  if (inp.supplyC == null) notes.push(`supply ${tsup.toFixed(2)} °C: the setpoint ${inp.setpointC.toFixed(2)} °C ${inp.peak === "heating" ? "+" : "−"} ${inp.loadW.toFixed(0)} W ÷ (ρ ${RHO} · cp ${CP} · ${supplyCfm.toFixed(0)} cfm)`);
  else if (supplyCfm > 0) {
    // a supply temperature from the SYSTEM need not deliver the room's design load at the flow typed (2026-11-10) — said, so the
    // room settling above or below its setpoint is read as the system's answer, not the solver's
    const delivered = RHO * CP * supplyCfm * CFM * Math.abs(tsup - inp.setpointC);
    notes.push(`supply ${tsup.toFixed(2)} °C from the system: at ${supplyCfm.toFixed(0)} cfm it delivers about ${delivered.toFixed(0)} W against the design load ${inp.loadW.toFixed(0)} W (${((100 * delivered) / Math.max(1, inp.loadW)).toFixed(0)} %) — the room settles ${delivered > inp.loadW * 1.05 ? (inp.peak === "heating" ? "above" : "below") : delivered < inp.loadW * 0.95 ? (inp.peak === "heating" ? "below" : "above") : "near"} its setpoint`);
  }
  // THE ROOM MUST CLOSE (2026-11-10: the Great room's solid is 0.14 m² short in its floors and ceilings — the mesh came out with
  // 2,664 open cells): a closed solid's outward area vectors sum to zero; what is left over is a hole that size, facing that way
  const cautions: string[] = [];
  if (faces.length) {
    // measured on the triangles WRITTEN — the surface the mesher reads, not the faces' stated areas
    const sum = [0, 0, 0]; let total = 0;
    for (const f of faces) for (const t of triangles(f)) { const c = cross(sub(t[1]!, t[0]!), sub(t[2]!, t[0]!)); for (let k = 0; k < 3; k++) sum[k] = sum[k]! + c[k]! / 2; total += Math.hypot(c[0]!, c[1]!, c[2]!) / 2; }
    const gap = Math.hypot(sum[0]!, sum[1]!, sum[2]!);
    if (gap > Math.max(0.01, 1e-4 * total)) {
      const ax = [0, 1, 2].reduce((m, k) => (Math.abs(sum[k]!) > Math.abs(sum[m]!) ? k : m), 0);
      const where = ax === 1 ? (sum[1]! < 0 ? "a piece of CEILING or roof is missing (the downward faces outweigh the upward)" : "a piece of FLOOR is missing (the upward faces outweigh the downward)") : `a piece of WALL facing ${ax === 0 ? (sum[0]! < 0 ? "east" : "west") : (sum[2]! < 0 ? "south" : "north")} is missing`;
      cautions.push(`${inp.space}'s solid is not closed: ${(gap).toFixed(3)} m² (${(gap * 10.7639).toFixed(1)} ft²) of it is open — ${where}. The mesher fills the room anyway, but leaves open cells along the gap and the air there is not to be trusted. To close it: BIM › LEVELS · SPACES with spaces shown, find the room's face that stops short, and Extend Space to Space (right-click the face)`);
    }
  }
  const inside = faces.length ? pointInside(faces) : null;
  if (faces.length && !inside) refusals.push(`no point found inside ${inp.space}'s solid for the mesher — the solid may not be closed`);
  const tnames = new Set<string>();
  const tname = (n: string): string => { let s = word(n).slice(0, 40), k = 2; const b = s; while (tnames.has(s)) s = `${b}_${k++}`; tnames.add(s); return s; };
  const inl = [...supplies, ...transfersIn.filter((t) => t.cfm > 0)].map((t) => ({ ...t, patch: tname(t.name) }));
  const inCfm = supplyCfm + transfersIn.reduce((s, t) => s + (t.cfm > 0 ? t.cfm : 0), 0);
  if (transfersIn.some((t) => t.cfm > 0)) notes.push(`air from the next rooms: ${transfersIn.filter((t) => t.cfm > 0).map((t) => `${t.name} ${t.cfm.toFixed(0)} cfm from ${t.from ?? "the next room"} at ${t.fromC != null ? `${t.fromC.toFixed(2)} °C` : "—"}`).join(", ")}; the age of air counts from every opening air enters by`);
  // A RETURN WITH A SET FLOW (2026-11-10, the user: "we should be able to set the return airflow"): written as a fixed outflow —
  // typed negative or positive, it leaves (the user's sign: "exhaust and return air flows should be negative");
  // a transfer grille, a door, or a return left blank stays FREE — the solver's pressure reference, where the rest of the air goes
  const outl = [...exits.map((t) => ({ name: t.name, lo: t.lo, hi: t.hi, patch: tname(t.name), cfm: (t.role === "return" || t.role === "exhaust") && Math.abs(t.cfm) > 0 ? Math.abs(t.cfm) : null as number | null, backC: t.fromC ?? null })), ...outlets.map((o) => ({ name: o.name, lo: o.lo, hi: o.hi, patch: tname(o.name), cfm: null as number | null, backC: null as number | null }))];
  const back = outl.filter((o) => o.cfm == null && o.backC != null);
  if (back.length) notes.push(`air coming back in by a free opening enters at the room it comes from: ${back.map((o) => `${o.name} ${o.backC!.toFixed(2)} °C`).join(", ")}; the other free openings at the setpoint ${inp.setpointC.toFixed(2)} °C`);
  const fixedOut = outl.filter((o) => o.cfm != null).reduce((t, o) => t + o.cfm!, 0);
  if (outl.length && !outl.some((o) => o.cfm == null)) refusals.push(`every outlet has a set flow (${fixedOut.toFixed(0)} cfm) — leave one free (a transfer grille, a door undercut, or a return with no flow typed): the solver needs one opening where the pressure is held and the rest of the air goes`);
  else if (fixedOut > 0 && fixedOut >= inCfm) refusals.push(`the returns' set flows (${fixedOut.toFixed(0)} cfm) take all the air coming in (${inCfm.toFixed(0)} cfm) or more — at a steady state the room can only send out what comes in; lower them below it`);
  else if (fixedOut > 0) notes.push(`returns at their set flows: ${outl.filter((o) => o.cfm != null).map((o) => `${o.name} ${o.cfm!.toFixed(0)} cfm`).join(", ")}; the other ${(inCfm - fixedOut).toFixed(0)} cfm leaves by ${outl.filter((o) => o.cfm == null).map((o) => o.name).join(", ")}`);
  const wp = wallPatches.map((w) => ({ ...w, patch: tname(w.name) }));

  const files: Record<string, string> = {};
  const write = (rel: string, cls: string, obj: string, body: string): void => { files[rel] = HEAD(cls, obj) + body; };
  // the STL: one solid per face
  files["constant/triSurface/room.stl"] = faces.map((f, i) => {
    const nm = names[i]!;
    return [`solid ${nm}`, ...triangles(f).map((t) => { const n = norm(cross(sub(t[1]!, t[0]!), sub(t[2]!, t[0]!))); return `  facet normal ${n.map(f6).join(" ")}\n    outer loop\n${t.map((p) => `      vertex ${p.map(f6).join(" ")}`).join("\n")}\n    endloop\n  endfacet`; }), `endsolid ${nm}`].join("\n");
  }).join("\n") + "\n";
  const allp = faces.flatMap((f) => f.outer);
  const lo = [0, 1, 2].map((i) => Math.min(...allp.map((p) => p[i]!)) - 0.12), hi2 = [0, 1, 2].map((i) => Math.max(...allp.map((p) => p[i]!)) + 0.12);
  const nc = [0, 1, 2].map((i) => Math.max(1, Math.ceil((hi2[i]! - lo[i]!) / h)));
  const [x0, y0, z0] = lo.map(f6), [x1, y1, z1] = hi2.map(f6);
  write("system/blockMeshDict", "dictionary", "blockMeshDict", `
convertToMeters 1;
vertices ( (${x0} ${y0} ${z0}) (${x1} ${y0} ${z0}) (${x1} ${y1} ${z0}) (${x0} ${y1} ${z0}) (${x0} ${y0} ${z1}) (${x1} ${y0} ${z1}) (${x1} ${y1} ${z1}) (${x0} ${y1} ${z1}) );
blocks ( hex (0 1 2 3 4 5 6 7) (${nc.join(" ")}) simpleGrading (1 1 1) );
boundary ( background { type wall; faces ( (0 3 2 1) (4 5 6 7) (0 1 5 4) (2 3 7 6) (0 4 7 3) (1 2 6 5) ); } );
`);
  const terms = [...inl.map((t) => ({ patch: t.patch, lo: t.lo, hi: t.hi })), ...outl];
  const pad = (b: { lo: V3; hi: V3 }, d: number): string => `min (${b.lo.map((v) => f6(v - d)).join(" ")}); max (${b.hi.map((v) => f6(v + d)).join(" ")});`;
  write("system/snappyHexMeshDict", "dictionary", "snappyHexMeshDict", `
castellatedMesh true; snap true; addLayers false;
geometry {
    room.stl { type triSurfaceMesh; name room; }
${terms.map((t) => `    ${t.patch}_box { type searchableBox; ${pad(t, 0.06)} }`).join("\n")}
}
castellatedMeshControls {
    maxLocalCells 4000000; maxGlobalCells 8000000; minRefinementCells 0; nCellsBetweenLevels 3; maxLoadUnbalance 0.10;
    features ( );
    refinementSurfaces { room { level (1 1); regions { ${names.map((n) => `${n} { level (1 1); patchInfo { type wall; } }`).join(" ")} } } }
    resolveFeatureAngle 30;
    refinementRegions {
${terms.map((t) => `        ${t.patch}_box { mode inside; levels ((1e15 3)); }`).join("\n")}
    }
    locationInMesh (${(inside ?? [0, 0, 0]).map(f6).join(" ")});
    allowFreeStandingZoneFaces false;
}
snapControls { nSmoothPatch 3; tolerance 2.0; nSolveIter 50; nRelaxIter 5; nFeatureSnapIter 10; implicitFeatureSnap true; explicitFeatureSnap false; multiRegionFeatureSnap false; }
addLayersControls { relativeSizes true; layers { } expansionRatio 1.2; finalLayerThickness 0.5; minThickness 0.1; nGrow 0; featureAngle 60; nRelaxIter 3; nSmoothSurfaceNormals 1; nSmoothNormals 3; nSmoothThickness 10; maxFaceThicknessRatio 0.5; maxThicknessToMedialRatio 0.3; minMedianAxisAngle 90; nBufferCellsNoExtrude 0; nLayerIter 50; }
meshQualityControls { #includeEtc "caseDicts/mesh/generation/meshQualityDict.cfg" }
mergeTolerance 1e-6;
`);
  const sets = [...terms.map((t) => ({ patch: t.patch, lo: t.lo, hi: t.hi })), ...wp];
  write("system/topoSetDict", "dictionary", "topoSetDict", `actions (\n${sets.map((s) => `    { name ${s.patch}; type faceSet; action new; source boxToFace; box (${s.lo.map(f6).join(" ")}) (${s.hi.map(f6).join(" ")}); }\n    { name ${s.patch}; type faceSet; action subset; source patchToFace; patch "room_.*"; }`).join("\n")}\n);\n`);
  write("system/createPatchDict", "dictionary", "createPatchDict", `pointSync false; writeCyclicMatch false;\npatches (\n${[
    ...terms.map((t) => `    { name ${t.patch}; patchInfo { type patch; } constructFrom set; set ${t.patch}; }`),
    ...wp.map((w) => `    { name ${w.patch}; patchInfo { type wall; } constructFrom set; set ${w.patch}; }`),
  ].join("\n")}\n);\n`);
  const clo = inp.clothing ?? (inp.peak === "heating" ? 1.0 : 0.5);
  write("system/controlDict", "dictionary", "controlDict", `
application buoyantSimpleFoam; startFrom latestTime; startTime 0; stopAt endTime; endTime ${iters}; deltaT 1;
writeControl timeStep; writeInterval ${every}; purgeWrite 2; writeFormat binary; writePrecision 8; writeCompression off;
timeFormat general; timePrecision 6; runTimeModifiable true;
functions {
    ageOfAir { type age; libs (fieldFunctionObjects); phi phi; rho rho; schemesField age; tolerance 1e-5; nCorr 5; diffusion on; executeControl writeTime; writeControl writeTime; }
    comfort { type comfort; libs (fieldFunctionObjects); clothing ${clo}; metabolicRate 1.0; extWork 0; relHumidity 50; pSat 0; tolerance 1e-4; maxClothIter 100; meanVelocity false; executeControl writeTime; writeControl writeTime; }
    flows { type surfaceFieldValue; libs (fieldFunctionObjects); writeControl timeStep; writeInterval 50; log true; writeFields false; regionType patch; names (${terms.map((t) => t.patch).join(" ")}); operation sum; fields (phi); }
    walls { type wallHeatFlux; libs (fieldFunctionObjects); writeControl writeTime; log false; }
${stop
    // the average waits: it starts 3,000 before the cap (a run that never settles still has its last 3,000), and once the room has
    // settled at N the app moves it to N + 1 and the end to N + 3,000 (cfd:settle) — 3,000 iterations of settled air. (OpenFOAM's
    // approximate moving window was tried first, 2026-11-10: stopped at 4,751 it still held 56 % of iterations 1–3,000.) And the
    // three things watched, written every 50 iterations
    ? `    avg { type fieldAverage; libs (fieldFunctionObjects); timeStart ${Math.max(1, iters - 3000)}; writeControl writeTime; fields ( U { mean on; prime2Mean on; base iteration; } T { mean on; prime2Mean on; base iteration; } ); }
    magU { type mag; libs (fieldFunctionObjects); field U; result magU; executeControl timeStep; writeControl none; }
    roomT { type volFieldValue; libs (fieldFunctionObjects); regionType all; operation volAverage; fields (T); writeFields false; writeControl timeStep; writeInterval 50; log false; }
    roomU { type volFieldValue; libs (fieldFunctionObjects); regionType all; operation volAverage; fields (magU); writeFields false; writeControl timeStep; writeInterval 50; log false; }
${outl.length ? `    outT { type surfaceFieldValue; libs (fieldFunctionObjects); regionType patch; names (${outl.map((o) => o.patch).join(" ")}); operation weightedAverage; weightField phi; fields (T); writeFields false; writeControl timeStep; writeInterval 50; log false; }
` : ""}`
    : `    avg { type fieldAverage; libs (fieldFunctionObjects); timeStart ${avgFrom}; writeControl writeTime; fields ( U { mean on; prime2Mean on; base iteration; } T { mean on; prime2Mean on; base iteration; } ); }
`}}
`);
  write("system/fvSchemes", "dictionary", "fvSchemes", `
ddtSchemes { default steadyState; } gradSchemes { default Gauss linear; }
divSchemes { default none; div(phi,U) bounded Gauss linearUpwind grad(U); div(phi,h) bounded Gauss upwind; div(phi,k) bounded Gauss upwind;
  div(phi,epsilon) bounded Gauss upwind; div(phi,K) bounded Gauss upwind; div(phi,Ekp) bounded Gauss linear;
  div(((rho*nuEff)*dev2(T(grad(U))))) Gauss linear; div(phi,age) bounded Gauss upwind; }
laplacianSchemes { default Gauss linear limited corrected 0.5; } interpolationSchemes { default linear; } snGradSchemes { default limited corrected 0.5; }
wallDist { method meshWave; }
`);
  write("system/fvSolution", "dictionary", "fvSolution", `
solvers {
  p_rgh { solver GAMG; smoother GaussSeidel; tolerance 1e-8; relTol 0.01; }
  "(U|h|k|epsilon)" { solver PBiCGStab; preconditioner DILU; tolerance 1e-8; relTol 0.1; }
  age { $U; relTol 0.001; }
}
SIMPLE { momentumPredictor false; nNonOrthogonalCorrectors 1; residualControl { p_rgh 1e-5; U 1e-6; h 1e-6; "(k|epsilon)" 1e-6; } }
relaxationFactors { fields { p_rgh 0.3; } equations { U 0.2; h 0.2; "(k|epsilon)" 0.5; age 1; } }
`);
  // THE TEMPERATURE GUARD from the case's own temperatures (2026-11-10: a fixed 280–310 K, set for Bed 1's 29 °C supply, clamped
  // a 40 °C system supply — 2,330 cells cut to 36.9 °C): 5 K past the coldest and the warmest of the supply and the room's faces,
  // never narrower than the 280–310 K it was
  const tCase = [tsup, ...temps, ...wallPatches.map((w) => w.tC), ...inp.terminals.map((t) => t.fromC ?? NaN)].filter(Number.isFinite);
  const tLo = Math.min(280, Math.floor(Math.min(...tCase) + 273.15 - 5)), tHi = Math.max(310, Math.ceil(Math.max(...tCase) + 273.15 + 5));
  write("system/fvOptions", "dictionary", "fvOptions", `limitT { type limitTemperature; active yes; selectionMode all; min ${tLo}; max ${tHi}; }\ndampU { type velocityDampingConstraint; active yes; velocityDampingConstraintCoeffs { selectionMode all; UMax 10; } }\n`);
  write("system/meshQualityDict", "dictionary", "meshQualityDict", '#includeEtc "caseDicts/mesh/generation/meshQualityDict.cfg"\n');
  write("constant/g", "uniformDimensionedVectorField", "g", "dimensions [0 1 -2 0 0 0 0]; value (0 -9.81 0);\n");
  write("constant/turbulenceProperties", "dictionary", "turbulenceProperties", "simulationType RAS; RAS { model kEpsilon; turbulence on; printCoeffs on; }\n");
  const T0 = K(inp.setpointC);
  write("constant/thermophysicalProperties", "dictionary", "thermophysicalProperties", `
thermoType { type heRhoThermo; mixture pureMixture; transport const; thermo hConst; equationOfState Boussinesq; specie specie; energy sensibleEnthalpy; }
mixture { specie { molWeight 28.96; } equationOfState { rho0 ${RHO}; T0 ${T0.toFixed(2)}; beta ${(1 / T0).toExponential(6)}; }
          thermodynamics { Cp ${CP}; Hf 0; } transport { mu 1.81e-05; Pr 0.71; } }
`);
  // 0.orig: every patch named — the faces at their temperatures, the windows and doors at theirs, the terminals in and out
  const wallT = new Map<string, number>([...names.map((n, i) => [`room_${n}`, K(temps[i]!)] as const), ...wp.map((w) => [w.patch, K(w.tC)] as const)]);
  const field = (name: string, cls: string, dim: string, internal: string, wall: (p: string) => string, inlet: (p: string, cfm: number) => string, outlet: string | ((o: (typeof outl)[number]) => string), fixedOutlet?: (cfm: number) => string): void => {
    const b = [...[...wallT.keys()].map((p) => `    ${p} { ${wall(p)} }`), ...inl.map((t) => `    ${t.patch} { ${inlet(t.patch, t.cfm)} }`), ...outl.map((t) => `    ${t.patch} { ${t.cfm != null && fixedOutlet ? fixedOutlet(t.cfm) : typeof outlet === "string" ? outlet : outlet(t)} }`)];
    write(`0.orig/${name}`, cls, name, `dimensions ${dim};\ninternalField ${internal};\nboundaryField\n{\n${b.join("\n")}\n}\n`);
  };
  const ti = "turbulentIntensityKineticEnergyInlet; intensity 0.05; value uniform 1e-3;";
  field("U", "volVectorField", "[0 1 -1 0 0 0 0]", "uniform (0 0 0)", () => "type noSlip;", (_p, cfm) => `type flowRateInletVelocity; volumetricFlowRate ${(cfm * CFM).toFixed(6)}; value uniform (0 0 0);`, "type pressureInletOutletVelocity; value uniform (0 0 0);", (cfm) => `type flowRateOutletVelocity; volumetricFlowRate ${(cfm * CFM).toFixed(6)}; value uniform (0 0 0);`);
  field("T", "volScalarField", "[0 0 0 1 0 0 0]", `uniform ${T0.toFixed(2)}`, (p) => `type fixedValue; value uniform ${wallT.get(p)!.toFixed(2)};`, (p) => { const t = inl.find((x) => x.patch === p); return `type fixedValue; value uniform ${K(t?.role === "transfer-in" ? (t.fromC ?? inp.setpointC) : tsup).toFixed(2)};`; }, (o) => { const b = o.backC != null ? K(o.backC) : T0; return `type inletOutlet; inletValue uniform ${b.toFixed(2)}; value uniform ${b.toFixed(2)};`; });
  field("p_rgh", "volScalarField", "[1 -1 -2 0 0 0 0]", "uniform 0", () => "type fixedFluxPressure; value uniform 0;", () => "type fixedFluxPressure; value uniform 0;", "type fixedValue; value uniform 0;", () => "type fixedFluxPressure; value uniform 0;");
  field("p", "volScalarField", "[1 -1 -2 0 0 0 0]", "uniform 1e5", () => "type calculated; value uniform 1e5;", () => "type calculated; value uniform 1e5;", "type calculated; value uniform 1e5;");
  field("k", "volScalarField", "[0 2 -2 0 0 0 0]", "uniform 8e-2", () => "type kqRWallFunction; value uniform 1e-4;", () => `type ${ti}`, "type inletOutlet; inletValue uniform 1e-4; value uniform 1e-4;");
  field("epsilon", "volScalarField", "[0 2 -3 0 0 0 0]", "uniform 0.23", () => "type epsilonWallFunction; value uniform 1e-5;", () => "type turbulentMixingLengthDissipationRateInlet; mixingLength 0.01; value uniform 1e-5;", "type inletOutlet; inletValue uniform 1e-5; value uniform 1e-5;");
  field("nut", "volScalarField", "[0 2 -1 0 0 0 0]", "uniform 0", () => "type nutkWallFunction; value uniform 0;", () => "type calculated; value uniform 0;", "type calculated; value uniform 0;");
  field("alphat", "volScalarField", "[1 -1 -1 0 0 0 0]", "uniform 0", () => "type compressible::alphatJayatillekeWallFunction; Prt 0.85; value uniform 0;", () => "type calculated; value uniform 0;", "type calculated; value uniform 0;");
  for (const f of ["PMV", "PPD", "DR"]) field(f, "volScalarField", "[0 0 0 0 0 0 0]", "uniform 0", () => "type calculated; value uniform 0;", () => "type calculated; value uniform 0;", "type calculated; value uniform 0;");

  const info = {
    space: inp.space, peak: inp.peak, time: inp.designTime, outdoor_c: inp.outdoorC, setpoint_c: inp.setpointC, supply_c: +tsup.toFixed(2),
    load_w: inp.loadW, supply_cfm: supplyCfm, clothing: clo, mesh_m: h, iterations: iters, averaged_from: avgFrom, temperature_guard_k: [tLo, tHi], ...(stop ? { stop: { tol_k: stop.tolK, min_iterations: stop.minIterations, cap: iters, window: 3000 } } : {}),
    faces: Object.fromEntries(names.map((n, i) => [n, { c: +temps[i]!.toFixed(2), from: sources[i] }])),
    openings: Object.fromEntries(wp.map((w) => [w.patch, +w.tC.toFixed(2)])),
    terminals: [...inl.map((t) => ({ name: t.name, patch: t.patch, role: t.role, cfm: t.cfm, lo: t.lo, hi: t.hi, ...(t.fromC != null ? { from: t.from ?? null, from_c: +t.fromC.toFixed(2) } : {}) })), ...exits.map((t, i) => ({ name: t.name, patch: outl[i]!.patch, role: t.role, cfm: t.cfm, lo: t.lo, hi: t.hi, ...(t.fromC != null ? { from: t.from ?? null, from_c: +t.fromC.toFixed(2) } : {}) }))],
    doors: inp.doors, notes,
  };
  files["case.json"] = JSON.stringify(info, null, 1);
  files["system/openings"] = terms.map((t) => t.patch).join("\n") + "\n";
  return { files, info, refusals, notes, cautions };
}
function boxLo(b: { lo: V3 }, i: number): number { return b.lo[i]!; }
function boxHi(b: { hi: V3 }, i: number): number { return b.hi[i]!; }

/** the commands of a run, in order — the runner streams each one's output; the last three turn the result into ASCII
 *  with the cell centres and volumes, which is what caseLoad reads */
export const RUN_STEPS: Array<{ label: string; cmd: string }> = [
  { label: "background mesh", cmd: "blockMesh" },
  { label: "the room's mesh", cmd: "snappyHexMesh -overwrite" },
  { label: "the openings' faces", cmd: "topoSet" },
  { label: "the openings' patches", cmd: "createPatch -overwrite" },
  // EVERY OPENING MUST HAVE FACES (2026-11-10): a terminal whose box misses the room's surface makes an empty patch, and a supply
  // with no area divides by zero in the solver (a floating-point crash at iteration 1) — caught here, named, before the solve.
  // No filename wildcard: OpenFOAM.app's shell dies of one (2026-11-04)
  { label: "the openings checked", cmd: `bad=""; for p in $(cat system/openings); do n=$(awk -v p="$p" '$1==p {f=1} f && /nFaces/ {gsub(";", "", $2); print $2; exit}' constant/polyMesh/boundary); if test "\${n:-0}" = "0"; then echo "OPENING WITH NO FACES: $p"; bad=1; fi; done; test -z "$bad"` },
  { label: "mesh check", cmd: "checkMesh || true" },
  // ── the mesh above, the solve below (MESH_STEPS / SOLVE_STEPS: a room's mesh made once, both peaks solved on it — 2026-11-10)
  { label: "initial fields", cmd: "rm -rf 0 && cp -r 0.orig 0" },
  { label: "the solve", cmd: "buoyantSimpleFoam" },
  { label: "results to text", cmd: "foamDictionary -entry writeFormat -set ascii system/controlDict > /dev/null && foamFormatConvert -latestTime" },
  { label: "cell centres", cmd: "postProcess -latestTime -func writeCellCentres" },
  { label: "cell volumes", cmd: "postProcess -latestTime -func writeCellVolumes" },
];
/** THE MESH ONCE, THE PEAKS ON IT (the user, 2026-11-10: "there should be a separate meshing process, then processing for cooling
 *  and heating"): the room's mesh does not depend on the peak — the same solid, terminals and doors — so it is made in its own run
 *  folder and each peak's solve starts by copying it in. */
export const MESH_STEPS = RUN_STEPS.slice(0, RUN_STEPS.findIndex((x) => x.label === "initial fields"));
export const SOLVE_STEPS = RUN_STEPS.slice(MESH_STEPS.length);
/** a peak's steps on a mesh made in the sibling run folder `meshStamp` (the stamp's own characters only — no wildcard) */
export function stepsOnMesh(meshStamp: string): Array<{ label: string; cmd: string }> {
  if (!/^[0-9A-Za-z_-]+$/.test(meshStamp)) throw new Error("bad mesh stamp");
  return [{ label: "the room's mesh, copied", cmd: `rm -rf constant/polyMesh && cp -r ../${meshStamp}/constant/polyMesh constant/polyMesh` }, ...SOLVE_STEPS];
}
