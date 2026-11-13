// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// GROUND COUPLING (2026-09-08, slice 4). Three methods the engine offers for
// a surface on the ground, ruled per model: plain `Ground` (a constant
// temperature under every ground surface — what the model has run with), the
// ASHRAE 90.1 / IECC F-factor and C-factor method (a slab by its area and
// EXPOSED perimeter, a below-grade wall by its height — the compliance path),
// and Foundation:Kiva (the 2-D finite-difference foundation, the physics).
// What this module holds is READ or STATED, never derived: the F and C factors
// the user types from their copy of the standard, the IRC defaults (code), and the exposed
// perimeter of a floor cell taken from the stored rows — an edge is exposed
// when it lies on an exterior wall cell's plane that stands at the slab.

import type { IdfFaceIn } from "./bemIdf.js";

type V3 = [number, number, number];
const F_SI = 1.7307;     // W/m·K per Btu/h·ft·°F
const C_SI = 5.678263;   // W/m²K per Btu/h·ft²·°F

/** THE F/C METHOD'S NUMBERS ARE THE USER'S: the F-factor of a slab and the C-factor of a below-grade wall are printed in ASHRAE 90.1
 *  Appendix A (Table A6.3.1, slabs, by where the insulation lies, its R and its distance; Table A4.2.1, below-grade walls, by R). The
 *  standard's tables do not ship with the program: the user reads the row for their assembly in their own copy and types it on
 *  CONSTRUCTIONS › Floors (GroundRuling fIp / cIp). Untyped, the factor reads NaN and the writer refuses the F/C method. */
export type SlabPlacement = "horizontal" | "vertical" | "full";
export const F_TABLE_CITE = "ASHRAE 90.1 Appendix A, Table A6.3.1 (slab F-factors) — the row for this slab typed by the user from their copy of the standard";
export const C_TABLE_CITE = "ASHRAE 90.1 Appendix A, Table A4.2.1 (below-grade wall C-factors) — the row for this wall typed by the user from their copy of the standard";
/** the IRC 2018 climate-zone-4 defaults: slab R-10 for 2 ft; basement and crawl walls R-10 continuous */
export const GROUND_DEFAULTS = { slabR: 10, slabDepthM: 0.6096, wallR: 10 } as const;
/** THE SLAB'S DEFAULT IS THE CODE'S (2026-10-07, the user's rule "the CODE defines code values"): Table R402.1.2's slab R and depth
 *  for the model's zone and edition, read from the code table. The below-grade wall's R-10 stays a STATED default — the table holds
 *  the basement wall's U, not the continuous R the C-factor table is keyed by, and no R is derived from a U */
export function groundDefaultsFor(code: { slabR: number; slabDepthFt: number }): { slabR: number; slabDepthM: number; wallR: number } {
  return { slabR: code.slabR, slabDepthM: code.slabDepthFt * 0.3048, wallR: GROUND_DEFAULTS.wallR };
}

/** THE SLAB'S INSULATION AS RULED (user, 2026-10-10: "This project does not externally apply vertical insulation on below ground walls, but
 *  the walls are insulated internally. There is required insulation under slabs at edges"): where it lies — UNDER THE SLAB AT THE EDGE, the
 *  code's distance in from the wall's inside face (the default; R402.2.10 counts insulation "extending under the slab" toward the table's
 *  distance), or under the FULL slab — its R and the distance, the code's when not typed. The model's ground coupling defaults to Kiva, the
 *  engine's 2-D foundation model, which takes the edge strip as Foundation:Kiva's interior horizontal insulation (the user: "We need to show
 *  code required and actual performance (Kiva)") */
export type SlabExtent = "edge" | "full";
export interface SlabPlan { extent: SlabExtent; r: number; distM: number; codeR: number; codeDistM: number; ruled: boolean }
export function slabPlan(g: { slabR?: number; slabDepthM?: number; slabExtent?: SlabExtent } | undefined, code: { slabR: number; slabDepthFt: number }): SlabPlan {
  const d = groundDefaultsFor(code);
  return { extent: g?.slabExtent ?? "edge", r: g?.slabR ?? d.slabR, distM: g?.slabDepthM ?? d.slabDepthM, codeR: d.slabR, codeDistM: d.slabDepthM,
    ruled: g?.slabExtent !== undefined || g?.slabR !== undefined || g?.slabDepthM !== undefined };
}

/** the method a model runs when none is ruled (user, 2026-10-10: "actual performance (Kiva)") */
export const DEFAULT_GROUND_METHOD = "kiva" as const;
export function groundMethodOf(g: { method?: "ground" | "fcfactor" | "kiva" } | undefined): "ground" | "fcfactor" | "kiva" { return g?.method ?? DEFAULT_GROUND_METHOD; }

/** an F-factor as typed (Btu/h·ft·°F) → W/m·K; untyped → NaN, said so */
export function fFactor(typedIp?: number): { wmK: number; ip: number; entry: string } {
  return typedIp !== undefined && Number.isFinite(typedIp) && typedIp > 0 ? { wmK: typedIp * F_SI, ip: typedIp, entry: "typed from ASHRAE 90.1 Table A6.3.1" } : { wmK: NaN, ip: NaN, entry: "not entered" };
}
/** the slab's F: the code's assembly (not read — no table ships) and as placed (the user's typed F) */
export function slabFactors(_p: SlabPlan, typedIp?: number): { code: ReturnType<typeof fFactor>; placed: ReturnType<typeof fFactor> } {
  return { code: fFactor(undefined), placed: fFactor(typedIp) };
}
/** a C-factor as typed (Btu/h·ft²·°F) → W/m²K; untyped → NaN, said so. `_rIp` is the wall's stated R, kept for the readers that print it */
export function cFactor(_rIp: number, typedIp?: number): { wm2K: number; ip: number; entry: string } {
  return typedIp !== undefined && Number.isFinite(typedIp) && typedIp > 0 ? { wm2K: typedIp * C_SI, ip: typedIp, entry: "typed from ASHRAE 90.1 Table A4.2.1" } : { wm2K: NaN, ip: NaN, entry: "not entered" };
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);

/** an exterior wall cell as a plane with its run and height, for the exposure test */
export interface WallPlane { n: V3; d: number; th: V3; s0: number; s1: number; y0: number; y1: number; elementId: number }
export function wallPlanes(faces: IdfFaceIn[]): WallPlane[] {
  return faces.filter((f) => f.category === "exteriorWall" && f.outer.length >= 3).map((f) => {
    const n = f.n;
    const th: V3 = [-n[2], 0, n[0]];
    const l = len(th) || 1;
    th[0] /= l; th[2] /= l;
    const p0 = f.outer[0]!;
    let s0 = Infinity, s1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of f.outer) { const s = dot(sub(p, p0), th); if (s < s0) s0 = s; if (s > s1) s1 = s; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
    return { n, d: dot(n, p0), th, s0: dot(p0, th) + s0, s1: dot(p0, th) + s1, y0, y1, elementId: f.elementId };
  });
}

/** which edges of a floor ring are EXPOSED — under an exterior wall standing at the slab: both ends
 *  within 3 cm of the wall's plane, the edge inside the wall's run, the wall's bottom at or under
 *  the slab's top and its top above it. A carve cut between two cells is not exposed. */
export function exposedEdges(ring: V3[], walls: WallPlane[], tol = 0.03): boolean[] {
  const out: boolean[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    const y = Math.min(a[1], b[1]);
    out.push(walls.some((w) => {
      if (Math.abs(dot(w.n, a) - w.d) > tol || Math.abs(dot(w.n, b) - w.d) > tol) return false;
      const sa = dot(a, w.th), sb = dot(b, w.th);
      const lo = Math.min(sa, sb), hi = Math.max(sa, sb);
      if (hi < w.s0 - tol || lo > w.s1 + tol) return false;
      return w.y0 <= y + 0.3 && w.y1 >= y - 0.05;
    }));
  }
  return out;
}
/** the length of a ring's edges, and of the exposed ones */
export function perimeterOf(ring: V3[], exposed: boolean[]): { totalM: number; exposedM: number } {
  let totalM = 0, exposedM = 0;
  for (let i = 0; i < ring.length; i++) {
    const l = len(sub(ring[(i + 1) % ring.length]!, ring[i]!));
    totalM += l;
    if (exposed[i]) exposedM += l;
  }
  return { totalM, exposedM };
}

// ── KIVA'S WALLS, EACH ON THE SLAB IT STANDS ON (2026-10-11). The user's first Kiva run stopped: "the Wall surfaces referencing the same
// Foundation:Kiva have a combined length greater than the exposed perimeter of the foundation". The writer had hung every below-grade wall
// of a zone on the zone's LARGEST floor cell — right for a room, wrong for a zone card that merges rooms (Entry = Storage + Gym + the
// interstitial floor: every wall of three rooms on Storage's 21 m slab). The engine's rules, read in its source
// (HeatBalanceKivaManager.cc, SurfaceGeometry.cc): a floor's exposed perimeter is capped at its OWN perimeter; a wall's length is the run
// of its edges lying in the floor's plane (|d| < SmallDistance, 1e-4 m), else the distance between its two lowest points; the walls on a
// floor may not sum past the exposed perimeter by more than 0.1 m. So: each wall goes on the nearest Kiva floor of its own zone (in plan,
// from the middle of its two lowest points), nearest first, while the floor's perimeter holds it; a wall that fits no floor stays on
// Ground, counted — never a weight the engine refuses.
const SMALL_DISTANCE = 1e-4;
/** a wall's length as Kiva takes it against a horizontal floor at height `floorY` */
export function kivaWallLength(ring: V3[], floorY: number): number {
  const on = ring.map((p) => Math.abs(p[1] - floorY) < SMALL_DISTANCE * 2);
  let L = 0;
  for (let i = 0; i < ring.length; i++) { const j = (i + 1) % ring.length; if (on[i] && on[j]) L += len(sub(ring[j]!, ring[i]!)); }
  if (L > 0) return L;
  const lows = [...ring].sort((a, b) => a[1] - b[1]);
  return lows.length >= 2 ? len(sub(lows[1]!, lows[0]!)) : 0;
}
const planDist = (p: V3, a: V3, b: V3): number => {
  const ax = b[0] - a[0], az = b[2] - a[2], l2 = ax * ax + az * az;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ax + (p[2] - a[2]) * az) / l2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * ax), p[2] - (a[2] + t * az));
};
export interface KivaFloorIn { key: string; zone: string; ring: V3[] }
export interface KivaWallIn { key: string; zone: string; ring: V3[] }
/** each wall → the floor it hangs on (or null: stays on Ground), and each floor's walls' summed length */
export function assignKivaWalls(floors: KivaFloorIn[], walls: KivaWallIn[], reachM = 1.0): { wallFloor: Map<string, string | null>; floorWalls: Map<string, number>; unplaced: Array<{ key: string; why: string }> } {
  const per = new Map(floors.map((f) => [f.key, f.ring.reduce((t, p, i) => t + len(sub(f.ring[(i + 1) % f.ring.length]!, p)), 0)] as const));
  const y = new Map(floors.map((f) => [f.key, f.ring[0]![1]] as const));
  const cand: Array<{ w: KivaWallIn; f: KivaFloorIn; d: number; L: number }> = [];
  const wallFloor = new Map<string, string | null>(), unplaced: Array<{ key: string; why: string }> = [];
  for (const w of walls) {
    const lows = [...w.ring].sort((a, b) => a[1] - b[1]);
    const mid: V3 = [(lows[0]![0] + lows[1]![0]) / 2, 0, (lows[0]![2] + lows[1]![2]) / 2];
    let best: { f: KivaFloorIn; d: number } | null = null;
    for (const f of floors) {
      if (f.zone !== w.zone) continue;
      let d = Infinity;
      for (let i = 0; i < f.ring.length; i++) d = Math.min(d, planDist(mid, f.ring[i]!, f.ring[(i + 1) % f.ring.length]!));
      if (!best || d < best.d) best = { f, d };
    }
    if (!best || best.d > reachM) { wallFloor.set(w.key, null); unplaced.push({ key: w.key, why: best ? `the nearest slab of its zone is ${best.d.toFixed(2)} m away` : "no Kiva slab in its zone" }); continue; }
    cand.push({ w, f: best.f, d: best.d, L: kivaWallLength(w.ring, y.get(best.f.key)!) });
  }
  const floorWalls = new Map<string, number>();
  for (const c of cand.sort((a, b) => a.d - b.d)) {
    const used = floorWalls.get(c.f.key) ?? 0;
    if (used + c.L <= per.get(c.f.key)! - 0.05) { floorWalls.set(c.f.key, used + c.L); wallFloor.set(c.w.key, c.f.key); }
    else { wallFloor.set(c.w.key, null); unplaced.push({ key: c.w.key, why: `its slab's perimeter (${per.get(c.f.key)!.toFixed(2)} m) is taken by nearer walls` }); }
  }
  return { wallFloor, floorWalls, unplaced };
}

/** AN F/C TABLE THE USER SUPPLIES (2026-11-12, named by a project's data sources): ASHRAE 90.1 Appendix A's rows from the user's own copy,
 *  as JSON — { fCite, fUninsulated, f: [{ placement, inches, rIp, f }], cCite, c: [{ rIp, c }] }. None ships with the program; it only
 *  FILLS the F and C the user would type (CONSTRUCTIONS › Floors), which stay what the writer reads */
export interface GroundTable { fCite: string; fUninsulated: number; f: Array<{ placement: SlabPlacement; inches: number; rIp: number; f: number }>; cCite: string; c: Array<{ rIp: number; c: number }> }
export function readGroundTable(text: string | null): GroundTable | null {
  try {
    const t = text ? JSON.parse(text) as GroundTable : null;
    return t && Array.isArray(t.f) && Array.isArray(t.c) && typeof t.fUninsulated === "number" ? t : null;
  } catch { return null; }
}
/** the table's row at or under the asked R and distance (never interpolated), named */
export function fFromTable(t: GroundTable, rIp: number, distM: number, placement: SlabPlacement): { ip: number; entry: string } {
  const inches = distM / 0.0254;
  const best = t.f.filter((x) => x.placement === placement && x.rIp <= rIp + 1e-9 && (placement === "full" || x.inches <= inches + 1e-9)).sort((a, b) => b.rIp - a.rIp || b.inches - a.inches)[0];
  if (!best || rIp <= 0) return { ip: t.fUninsulated, entry: "uninsulated" };
  return { ip: best.f, entry: placement === "full" ? `fully insulated slab, R-${best.rIp}` : `${best.inches} in ${placement}, R-${best.rIp}` };
}
export function cFromTable(t: GroundTable, rIp: number): { ip: number; entry: string } | null {
  const best = t.c.filter((x) => x.rIp <= rIp + 1e-9).sort((a, b) => b.rIp - a.rIp)[0];
  return best ? { ip: best.c, entry: best.rIp === 0 ? "uninsulated" : `R-${best.rIp} continuous` } : null;
}
