// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE CFD ROOM IS ITS ENCLOSURE IN THE IDF DB MODEL (the user, 2026-11-10: "force the space volume to match the enclosure
// (eliminating the 'great room attic' as it does not exist in reality)" — after "IT IS SUPPOSED TO BE IDF DB MODEL"). The room is
// built from its own idf.db surface rows alone, never grown from the file's room solid:
//
//   1 · THE ROWS THAT BOUND IT — a row with the room on exactly ONE side (surfaces.space / space_facing). A row with the room on
//       BOTH sides is the ceiling or partition between the room and a void the user merged into it (BIM › spaces): it bounds
//       nothing, and the room's surface may not lie on it — which is what joins a merged attic to its room. A FLOOR CAVITY is
//       the exception (the user, 2026-11-10: "Basement rooms should stop at ceiling of basement spaces"): the void inside a
//       floor assembly is never the room's air, merged or not, so the ceiling under it still bounds the room.
//   2 · EACH ROW AT THE ELEMENT'S ROOM-SIDE FACE — idf.db keeps a surface on one plane of its element (the exterior face, the
//       midplane, a floor's top) with the element's thickness. The kept face's normal points away from the element's solid
//       (collapse.ts), so a room BEHIND the row (space) has the whole thickness between it and the plane, a room FACED
//       (space_facing) none, and a midplane half either way. Measured 2026-11-10: Bed 1 110.47 m³ = the file's room to 0.01 m³,
//       where the same rows at their kept planes hold 134.81 m³.
//   3 · THE ROOM'S BOX CUT BY THOSE PLANES into convex cells; a cell is inside when the winding number of the rows about its
//       centre says so, weighed against how much of its faces the rows cover — the labelling with the least boundary off the
//       room's own rows (a minimum cut). The room is the outer faces of the inside cells: closed by construction, every face on a
//       plane of the model.
//
// The room as drawn (its IfcSpace, as ruled) only LENDS PLANES where the model draws no surface — an open side to the next room, a
// stair — and is the volume the result is read against. Nothing is written back: idf.db's rooms stay as ruled.

import polygonClipping from "polygon-clipping";
import type { Database } from "sql.js";
import { isFloorCavity } from "../../../core/zones.js";
import { triangles, type RoomFace } from "./cfdCase.js";

type V3 = [number, number, number];
type P2 = [number, number];
type MP = P2[][][];

/** two rows share a plane within this: 0.5° and 1 cm (the engine's own resolution) */
const PLANE_COS = 0.99996, PLANE_M = 0.01;
/** a vertex within this of a plane is on it */
const ON_M = 1e-6;
/** THE CUT'S WEIGHTS, stated: a cell's own reading (its volume × how far the winding number is from one half) outweighs its faces
 *  once the cell is thicker than 1 / EVIDENCE_PER_M = 5 cm; a face of the room as drawn counts half where the model draws no
 *  surface; a boundary AGAINST a row's own facing, on a row the room has on both sides, or on the room's box (no plane at all)
 *  costs several times its area; a hair per m² keeps the boundary small. A cell reads unsure between the two bounds */
const EVIDENCE_PER_M = 20, DRAWN_CREDIT = 0.5, AGAINST = 4, ON_BOX = 4, HAIR = 0.02, SURE_IN = 0.75, SURE_OUT = 0.25;

export interface EnclosureRow { id: number; category: string; out: V3; outer: V3[] }
/** the room's rows: `bound` the ones with the room on one side, at the room-side face; `within` both faces of each row with the
 *  room on both sides (a void merged into it lies beyond) */
export interface RoomRows { bound: EnclosureRow[]; within: V3[][] }
export interface Enclosure {
  faces: RoomFace[];
  /** every edge of the surface written is shared by two of its triangles' faces (an even number) and its area vectors sum to 0 */
  closed: boolean;
  volumeM3: number; drawnVolumeM3: number;
  /** of the surface: on the room's own rows · on a face of the room as drawn where the model draws none · on the room's box */
  areaM2: number; onRowsM2: number; drawnM2: number; boxM2: number;
  rows: number; planes: number; cells: number; unsureM3: number;
  /** the room used as drawn, and why */
  refused: string | null;
  notes: string[];
}

const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3, s: number): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const neg = (a: V3): V3 => [-a[0], -a[1], -a[2]];
function basis(n: V3): { u: V3; v: V3 } { const a: V3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; const u = unit(cross(n, a)); return { u, v: cross(n, u) }; }
function areaVec(r: V3[]): V3 { const s: V3 = [0, 0, 0]; for (let i = 0; i < r.length; i++) { const c = cross(r[i]!, r[(i + 1) % r.length]!); s[0] += c[0] / 2; s[1] += c[1] / 2; s[2] += c[2] / 2; } return s; }
function mean(r: V3[]): V3 { const c: V3 = [0, 0, 0]; for (const p of r) { c[0] += p[0] / r.length; c[1] += p[1] / r.length; c[2] += p[2] / r.length; } return c; }
function ringArea(r: P2[]): number { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i]!, q = r[(i + 1) % r.length]!; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
function mpArea(mp: MP): number { let a = 0; for (const poly of mp) poly.forEach((r, i) => { a += (i ? -1 : 1) * Math.abs(ringArea(r)); }); return a; }
const clip = { union: (ps: MP[]): MP => (ps.length ? (polygonClipping.union(...(ps as unknown as [never, ...never[]])) as unknown as MP) : []), and: (a: MP, b: MP): MP => (a.length && b.length ? (polygonClipping.intersection(a as never, b as never) as unknown as MP) : []) };

/** THE ROOM'S OWN ROWS in idf.db, each at its element's room-side face, with the normal that points out of the room */
export function roomRows(idfDb: Database, space: string): RoomRows {
  const out: EnclosureRow[] = [], within: V3[][] = [];
  const st = idfDb.prepare("SELECT id, category, mode, thickness_m, nx, ny, nz, outer, space, space_facing, space_ifc, space_facing_ifc FROM surfaces WHERE space = $s OR space_facing = $s");
  st.bind({ $s: space });
  while (st.step()) {
    const [id, category, mode, th, nx, ny, nz, o, a, b, ai, bi] = st.get() as [number, string, string, number, number, number, number, string, string | null, string | null, string | null, string | null];
    // a side is the room's AIR when it is the room's and not a floor cavity merged into it (space_ifc names what it was)
    const airA = a === space && !isFloorCavity(ai ?? a), airB = b === space && !isFloorCavity(bi ?? b);
    if (!airA && !airB) continue;
    const n = unit([nx, ny, nz]), ring = JSON.parse(o) as V3[];
    if (airA && airB) { for (const sh of mode === "M" ? [th / 2, -th / 2] : [0, -th]) within.push(ring.map((p) => add(p, n, sh))); continue; }
    const behind = airA, t = mode === "M" ? th / 2 : behind ? th : 0;
    out.push({ id, category, out: behind ? n : neg(n), outer: ring.map((p) => add(p, n, behind ? -t : t)) });
  }
  st.free();
  return { bound: out, within };
}

/** the winding number of p about oriented triangles (Van Oosterom & Strackee): 1 inside a closed surface, 0 outside */
function winding(p: V3, T: Float64Array): number {
  let w = 0;
  for (let i = 0; i < T.length; i += 9) {
    const ax = T[i]! - p[0], ay = T[i + 1]! - p[1], az = T[i + 2]! - p[2], bx = T[i + 3]! - p[0], by = T[i + 4]! - p[1], bz = T[i + 5]! - p[2], cx = T[i + 6]! - p[0], cy = T[i + 7]! - p[1], cz = T[i + 8]! - p[2];
    const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz), lc = Math.hypot(cx, cy, cz);
    const det = ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    w += 2 * Math.atan2(det, la * lb * lc + (ax * bx + ay * by + az * bz) * lc + (bx * cx + by * cy + bz * cz) * la + (cx * ax + cy * ay + cz * az) * lb);
  }
  return w / (4 * Math.PI);
}

/** a minimum cut (Dinic): which nodes stay on the source's side */
function minCut(n: number, s: number, t: number, arcs: Array<[number, number, number, number]>): Uint8Array {
  const head = new Int32Array(n).fill(-1), nxt: number[] = [], to: number[] = [], cap: number[] = [];
  const arc = (a: number, b: number, c: number): void => { to.push(b); cap.push(c); nxt.push(head[a]!); head[a] = to.length - 1; };
  for (const [a, b, c, r] of arcs) { arc(a, b, c); arc(b, a, r); }
  const level = new Int32Array(n), it = new Int32Array(n), q = new Int32Array(n);
  const bfs = (): boolean => {
    level.fill(-1); level[s] = 0; let h = 0, e = 0; q[e++] = s;
    while (h < e) { const x = q[h++]!; for (let i = head[x]!; i >= 0; i = nxt[i]!) if (cap[i]! > 1e-12 && level[to[i]!]! < 0) { level[to[i]!] = level[x]! + 1; q[e++] = to[i]!; } }
    return level[t]! >= 0;
  };
  const dfs = (x: number, f: number): number => {
    if (x === t) return f;
    for (; it[x]! >= 0; it[x] = nxt[it[x]!]!) {
      const i = it[x]!, y = to[i]!;
      if (cap[i]! > 1e-12 && level[y] === level[x]! + 1) { const d = dfs(y, Math.min(f, cap[i]!)); if (d > 0) { cap[i]! -= d; cap[i ^ 1]! += d; return d; } }
    }
    return 0;
  };
  while (bfs()) { it.set(head); while (dfs(s, Infinity) > 0) { /* push */ } }
  const side = new Uint8Array(n);
  for (let i = 0; i < n; i++) side[i] = level[i]! >= 0 ? 1 : 0;
  return side;
}

interface Plane { n: V3; d: number; u: V3; v: V3; model: boolean; pos: MP; negv: MP; drawn: MP; inner: MP }
interface Face { pl: number; v: number[] }

/** THE ENCLOSURE of a room from its rows (roomRows); `drawn` the room as the file draws it, as ruled (idf.db space_faces) */
export function enclosureOf(all: RoomRows, drawn: RoomFace[]): Enclosure {
  const rows = all.bound;
  const drawnVolumeM3 = Math.abs(drawn.reduce((t, f) => t + triangles(f).reduce((s, [a, b, c]) => s + dot(a!, cross(b!, c!)) / 6, 0), 0));
  const asDrawn = (why: string): Enclosure => ({ faces: drawn, closed: false, volumeM3: drawnVolumeM3, drawnVolumeM3, areaM2: drawn.reduce((t, f) => t + f.areaM2, 0), onRowsM2: 0, drawnM2: 0, boxM2: 0, rows: rows.length, planes: 0, cells: 0, unsureM3: 0, refused: why, notes: [] });
  if (!rows.length) return asDrawn("idf.db holds no surface with this room on one side (a room merged into another on BIM › spaces has none of its own)");

  // ── the planes: the rows', then the drawn room's where no row lies ──
  const planes: Plane[] = [];
  const planeOf = (n: V3, pts: V3[], make: boolean, model: boolean): number => {
    const at = planes.findIndex((p) => { const s = dot(p.n, n); return Math.abs(s) > PLANE_COS && pts.every((q) => Math.abs(dot(p.n, q) - p.d) < PLANE_M); });
    if (at >= 0 || !make) return at;
    const { u, v } = basis(n);
    planes.push({ n, d: pts.reduce((t, q) => t + dot(n, q), 0) / pts.length, u, v, model, pos: [], negv: [], drawn: [], inner: [] });
    return planes.length - 1;
  };
  const sized = rows.map((r) => ({ r, a: len(areaVec(r.outer)) })).sort((x, y) => y.a - x.a);
  type Slot = { pos: MP[]; negv: MP[]; drawn: MP[]; inner: MP[] };
  const on: Slot[] = [];
  const slot = (j: number): Slot => (on[j] ??= { pos: [], negv: [], drawn: [], inner: [] });
  const to2 = (p: Plane, q: V3): P2 => [dot(q, p.u), dot(q, p.v)];
  for (const { r, a } of sized) {
    const j = planeOf(unit(areaVec(r.outer)), r.outer, a >= 0.05, true);
    if (j < 0) continue;
    const P = planes[j]!;
    (dot(r.out, P.n) > 0 ? slot(j).pos : slot(j).negv).push([[r.outer.map((q) => to2(P, q))]]);
  }
  for (const f of [...drawn].sort((x, y) => y.areaM2 - x.areaM2)) {
    const j = planeOf(unit(f.n), f.outer, f.areaM2 >= 0.05, false);
    if (j >= 0) slot(j).drawn.push([[f.outer.map((q) => to2(planes[j]!, q)), ...(f.holes ?? []).filter((h) => h.length >= 3).map((h) => h.map((q) => to2(planes[j]!, q)))]]);
  }
  for (const ring of all.within) { if (len(areaVec(ring)) < 0.01) continue; const j = planeOf(unit(areaVec(ring)), ring, false, true); if (j >= 0) slot(j).inner.push([[ring.map((q) => to2(planes[j]!, q))]]); }
  planes.forEach((P, j) => { const s = slot(j); for (const k of ["pos", "negv", "drawn", "inner"] as const) { try { P[k] = clip.union(s[k]); } catch { P[k] = s[k].flat(); } } });

  // ── the box, and its cells: every plane cuts every cell it crosses; a vertex and a cut point are made ONCE, so two cells
  //    that share a face state it by the same vertices ──
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of [...rows.flatMap((r) => r.outer), ...drawn.flatMap((f) => f.outer)]) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, p[k]! - 0.05); hi[k] = Math.max(hi[k]!, p[k]! + 0.05); }
  const V: V3[] = [];
  for (let i = 0; i < 8; i++) V.push([i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]]);
  let cells: Face[][] = [[{ pl: -1, v: [0, 2, 6, 4] }, { pl: -2, v: [1, 5, 7, 3] }, { pl: -3, v: [0, 4, 5, 1] }, { pl: -4, v: [2, 3, 7, 6] }, { pl: -5, v: [0, 1, 3, 2] }, { pl: -6, v: [4, 6, 7, 5] }]];
  planes.forEach((P, j) => {
    const side = new Map<number, number>(), cuts = new Map<number, number>();
    const sd = (i: number): number => { let s = side.get(i); if (s === undefined) { const x = dot(P.n, V[i]!) - P.d; s = x > ON_M ? 1 : x < -ON_M ? -1 : 0; side.set(i, s); } return s; };
    const cut = (a: number, b: number): number => {
      const k = a < b ? a * 4194304 + b : b * 4194304 + a;
      let x = cuts.get(k);
      if (x === undefined) { const pa = V[a]!, pb = V[b]!, sa = dot(P.n, pa) - P.d, sb = dot(P.n, pb) - P.d; x = V.length; V.push(add(pa, sub(pb, pa), sa / (sa - sb))); side.set(x, 0); cuts.set(k, x); }
      return x;
    };
    const next: Face[][] = [];
    for (const cell of cells) {
      let up = false, down = false;
      for (const f of cell) for (const i of f.v) { const s = sd(i); if (s > 0) up = true; else if (s < 0) down = true; }
      if (!up || !down) { next.push(cell); continue; }
      const A: Face[] = [], B: Face[] = [], onIt = new Set<number>();
      for (const f of cell) {
        const pv: number[] = [], nv: number[] = [];
        for (let i = 0; i < f.v.length; i++) {
          const a = f.v[i]!, b = f.v[(i + 1) % f.v.length]!, sa = sd(a), sb = sd(b);
          if (sa >= 0) pv.push(a); if (sa <= 0) nv.push(a);
          if (sa === 0) onIt.add(a);
          if (sa * sb < 0) { const x = cut(a, b); pv.push(x); nv.push(x); onIt.add(x); }
        }
        if (pv.length >= 3 && pv.some((i) => sd(i) > 0)) A.push({ pl: f.pl, v: pv });
        if (nv.length >= 3 && nv.some((i) => sd(i) < 0)) B.push({ pl: f.pl, v: nv });
      }
      const ring = [...onIt];
      if (ring.length >= 3) {
        const c = mean(ring.map((i) => V[i]!)), ang = new Map(ring.map((i) => { const q = sub(V[i]!, c); return [i, Math.atan2(dot(q, P.v), dot(q, P.u))] as const; }));
        ring.sort((x, y) => ang.get(x)! - ang.get(y)!);
        A.push({ pl: j, v: ring }); B.push({ pl: j, v: [...ring].reverse() });
      }
      next.push(A, B);
    }
    cells = next;
  });

  // ── each cell: its centre, its volume, the rows' winding number about its centre ──
  const T = new Float64Array(rows.flatMap((r) => triangles({ n: r.out, outer: r.outer, areaM2: 0 }).flat(2)));
  const C = cells.length, centre: V3[] = [], vol = new Float64Array(C), w = new Float64Array(C);
  cells.forEach((cell, ci) => {
    const o = mean([...new Set(cell.flatMap((f) => f.v))].map((i) => V[i]!)), c: V3 = [0, 0, 0];
    let vv = 0;
    for (const f of cell) for (let i = 1; i + 1 < f.v.length; i++) {
      const a = sub(V[f.v[0]!]!, o), b = sub(V[f.v[i]!]!, o), e = sub(V[f.v[i + 1]!]!, o), x = Math.abs(dot(a, cross(b, e))) / 6;
      vv += x; for (let k = 0; k < 3; k++) c[k] = c[k]! + x * (o[k]! + (a[k]! + b[k]! + e[k]!) / 4);
    }
    vol[ci] = vv; centre.push(vv > 0 ? [c[0] / vv, c[1] / vv, c[2] / vv] : o);
  });
  let turn = 0;
  cells.forEach((_, ci) => { w[ci] = winding(centre[ci]!, T); turn += vol[ci]! * w[ci]!; });
  // rows wound the other way round as a set would read every cell as −1: the larger sum says which way the set faces
  if (turn < 0) for (let ci = 0; ci < C; ci++) w[ci] = -w[ci]!;

  // ── the faces between cells, by their vertices ──
  const shared = new Map<string, Array<[number, number]>>();
  cells.forEach((cell, ci) => cell.forEach((f, fi) => { const k = `${f.pl}:${[...f.v].sort((a, b) => a - b).join(",")}`; const s = shared.get(k); if (s) s.push([ci, fi]); else shared.set(k, [[ci, fi]]); }));
  const face2 = (f: Face): MP => { const P = planes[f.pl]!; return [[f.v.map((i) => to2(P, V[i]!))]]; };
  const cover = (mp: MP, by: MP): number => { if (!by.length) return 0; try { return mpArea(clip.and(mp, by)); } catch { return 0; } };

  // ── inside or outside: each cell's own reading against the cover of its faces — the least boundary off the room's own rows ──
  const S = C, Tn = C + 1, arcs: Array<[number, number, number, number]> = [];
  let unsureM3 = 0;
  for (let ci = 0; ci < C; ci++) {
    const lean = EVIDENCE_PER_M * vol[ci]! * 2 * (Math.max(0, Math.min(1, w[ci]!)) - 0.5);
    arcs.push(lean > 0 ? [S, ci, lean, 0] : [ci, Tn, -lean, 0]);
    if (w[ci]! > SURE_OUT && w[ci]! < SURE_IN) unsureM3 += vol[ci]!;
  }
  for (const pair of shared.values()) {
    const [ci, fi] = pair[0]!, f = cells[ci]![fi]!, a = len(areaVec(f.v.map((i) => V[i]!)));
    if (a < 1e-9) continue;
    if (f.pl < 0) { if (pair.length === 1) arcs.push([ci, Tn, a * ON_BOX, 0]); continue; }
    if (pair.length !== 2) continue;
    const cj = pair[1]![0];
    const P = planes[f.pl]!, below = dot(P.n, centre[ci]!) - P.d < 0 ? ci : cj, above = below === ci ? cj : ci;
    const mp = face2(f), cp = cover(mp, P.pos), cn = cover(mp, P.negv), cd = cover(mp, P.drawn), cw = cover(mp, P.inner);
    // `below` inside and `above` outside: the boundary faces +n, as the rows in `pos` do
    const cost = (withIt: number, against: number): number => { const bare = Math.max(0, a - withIt); return bare - DRAWN_CREDIT * Math.min(bare, Math.max(0, cd - cw)) + AGAINST * (against + cw) + HAIR * a; };
    arcs.push([below, above, cost(cp, cn), cost(cn, cp)]);
  }
  const inside = minCut(C + 2, S, Tn, arcs);
  // one room: the largest connected part is kept, the rest named
  const nb: number[][] = Array.from({ length: C }, () => []);
  for (const pair of shared.values()) if (pair.length === 2) { nb[pair[0]![0]]!.push(pair[1]![0]); nb[pair[1]![0]]!.push(pair[0]![0]); }
  const part = new Int32Array(C).fill(-1), partVol: number[] = [];
  for (let ci = 0; ci < C; ci++) {
    if (!inside[ci] || part[ci]! >= 0) continue;
    const id = partVol.length; let vv = 0; const stack = [ci]; part[ci] = id;
    while (stack.length) { const x = stack.pop()!; vv += vol[x]!; for (const y of nb[x]!) if (inside[y] && part[y]! < 0) { part[y] = id; stack.push(y); } }
    partVol.push(vv);
  }
  if (!partVol.length) return asDrawn("no part of the room's box reads as inside its idf.db surfaces");
  const keep = partVol.indexOf(Math.max(...partVol)), notes: string[] = [];
  const dropped = partVol.reduce((t, x, i) => t + (i === keep ? 0 : x), 0);
  if (dropped > 1e-3) notes.push(`${(partVol.length - 1)} detached pocket(s), ${dropped.toFixed(2)} m³, left out`);
  const isIn = (ci: number): boolean => inside[ci] === 1 && part[ci] === keep;

  // ── the room's surface: the faces of inside cells with no inside cell beyond ──
  interface Bf { pl: number; pts: V3[]; n: V3; ids: number[] }
  const bnd: Bf[] = [];
  let volumeM3 = 0;
  for (let ci = 0; ci < C; ci++) if (isIn(ci)) volumeM3 += vol[ci]!;
  for (const pair of shared.values()) {
    const ins = pair.filter(([ci]) => isIn(ci));
    if (ins.length !== 1) continue;
    const [ci, fi] = ins[0]!, f = cells[ci]![fi]!;
    let ids = f.v, pts = ids.map((i) => V[i]!), n = areaVec(pts);
    if (len(n) < 1e-10) continue;
    if (dot(n, sub(mean(pts), centre[ci]!)) < 0) { ids = [...ids].reverse(); pts = [...pts].reverse(); n = neg(n); }
    bnd.push({ pl: f.pl, pts, n: unit(n), ids });
  }
  const edges = new Map<number, number>(), sum: V3 = [0, 0, 0];
  let areaM2 = 0;
  for (const b of bnd) {
    const av = areaVec(b.pts); areaM2 += len(av); for (let k = 0; k < 3; k++) sum[k] = sum[k]! + av[k]!;
    for (let i = 0; i < b.ids.length; i++) { const x = b.ids[i]!, y = b.ids[(i + 1) % b.ids.length]!, k = x < y ? x * 4194304 + y : y * 4194304 + x; edges.set(k, (edges.get(k) ?? 0) + 1); }
  }
  let odd = 0, fourfold = 0;
  for (const c of edges.values()) { if (c % 2) odd++; else if (c > 2) fourfold++; }
  const closed = odd === 0 && len(sum) < Math.max(1e-6, 1e-9 * areaM2);
  if (fourfold) notes.push(`${fourfold} edge(s) where two parts of the room touch along a line`);

  // ── the faces the setup and the case use: one per plane, facing and connected piece — its outline for the eye, its triangles
  //    the cells' own faces (fans from each face's centre), so the surface written is closed edge for edge ──
  const groups = new Map<string, Bf[]>();
  for (const b of bnd) { const P = b.pl >= 0 ? planes[b.pl]! : null, k = `${b.pl}|${P ? (dot(b.n, P.n) > 0 ? 1 : -1) : 0}`; const g = groups.get(k); if (g) g.push(b); else groups.set(k, [b]); }
  const faces: RoomFace[] = [];
  let onRowsM2 = 0, drawnM2 = 0, boxM2 = 0;
  const fan = (b: Bf): V3[][] => { const c = mean(b.pts); return b.pts.map((p, i) => [c, p, b.pts[(i + 1) % b.pts.length]!]); };
  for (const [, g] of [...groups].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    const n = g[0]!.n, { u, v } = g[0]!.pl >= 0 ? planes[g[0]!.pl]! : basis(n), d = dot(n, g[0]!.pts[0]!);
    const p2 = (q: V3): P2 => [dot(q, u), dot(q, v)], p3 = (q: P2): V3 => { const o = add(add([0, 0, 0], u, q[0]), v, q[1]); return add(o, n, d - dot(n, o)); };
    let mp: MP;
    try { mp = clip.union(g.map((b) => [[b.pts.map(p2)]] as MP)); } catch { mp = g.map((b) => [b.pts.map(p2)]); }
    const P = g[0]!.pl >= 0 ? planes[g[0]!.pl]! : null, a = g.reduce((t, b) => t + len(areaVec(b.pts)), 0);
    if (!P) boxM2 += a;
    else { const own = cover(mp, dot(n, P.n) > 0 ? P.pos : P.negv); onRowsM2 += own; if (!P.model) drawnM2 += a; else drawnM2 += Math.min(a - own, Math.max(0, cover(mp, P.drawn) - own)); }
    const inPoly = (poly: P2[][], q: P2): boolean => poly.reduce((inn, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const A = r[i]!, B = r[j]!; if ((A[1] > q[1]) !== (B[1] > q[1]) && q[0] < ((B[0] - A[0]) * (q[1] - A[1])) / (B[1] - A[1]) + A[0]) c = !c; } return c ? !inn : inn; }, false);
    const tris: V3[][][] = mp.map(() => []);
    for (const b of g) { const c = p2(mean(b.pts)); let at = mp.findIndex((poly) => inPoly(poly, c)); if (at < 0) at = 0; if (mp.length) tris[at]!.push(...fan(b)); }
    mp.forEach((poly, i) => {
      const open = (r: P2[]): P2[] => (r.length > 1 && r[0]![0] === r[r.length - 1]![0] && r[0]![1] === r[r.length - 1]![1] ? r.slice(0, -1) : r);
      const rings = poly.map(open).filter((r) => r.length >= 3);
      if (!rings.length || !tris[i]!.length) return;
      // u × v = n, so a ring counter-clockwise in (u, v) is counter-clockwise about the outward normal
      const outer = (ringArea(rings[0]!) >= 0 ? rings[0]! : [...rings[0]!].reverse()).map(p3);
      faces.push({ n, outer, holes: rings.slice(1).map((r) => r.map(p3)), areaM2: Math.abs(ringArea(rings[0]!)) - rings.slice(1).reduce((t, r) => t + Math.abs(ringArea(r)), 0), tris: tris[i]! });
    });
  }
  if (boxM2 > 1e-3) notes.push(`${boxM2.toFixed(2)} m² lies on no plane of the model or of the room as drawn`);
  return { faces, closed, volumeM3, drawnVolumeM3, areaM2, onRowsM2, drawnM2, boxM2, rows: rows.length, planes: planes.length, cells: C, unsureM3, refused: null, notes };
}

/** the model's surfaces must enclose at least this share of the room the file draws, and no more than this multiple of it (a void
 *  merged in adds to it) — outside them the model does not hold this room, and it is used as drawn */
const ENCLOSED_MIN = 0.75, ENCLOSED_MAX = 2;
/** the CFD room of a space: its enclosure in idf.db — the room as drawn when the model cannot give one, the reason named */
export function roomEnclosure(idfDb: Database, space: string, drawn: RoomFace[]): Enclosure {
  const e = enclosureOf(roomRows(idfDb, space), drawn);
  if (e.refused) return e;
  const asDrawn = (why: string): Enclosure => ({ ...e, faces: drawn, closed: false, refused: why });
  if (!e.closed) return asDrawn("its enclosure did not come out closed");
  if (drawn.length && e.drawnVolumeM3 > 0 && (e.volumeM3 < ENCLOSED_MIN * e.drawnVolumeM3 || e.volumeM3 > ENCLOSED_MAX * e.drawnVolumeM3))
    return asDrawn(`its idf.db surfaces enclose ${e.volumeM3.toFixed(1)} m³ where the file draws ${e.drawnVolumeM3.toFixed(1)} m³ — the model holds no surface on its open sides`);
  return e;
}
