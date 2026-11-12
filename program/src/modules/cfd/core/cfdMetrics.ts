// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE ROOM'S ASSESSMENT from a loaded case — the numbers the right column states, each with the limit it is read
// against and where that limit is written. Computed from the CELLS (volume-weighted), the grid only deciding which
// cells are in the occupied zone.
//
// The occupied zone: 0.1–1.8 m above the floor, 0.3 m in from every wall (the Bed 1 report's, 2026-11-03 — standards
// that keep it 1.0 m off an exterior wall or window are stricter); read from the room's own shape, layer by layer, so an
// alcove narrower than 0.6 m drops out by itself.
// Draught rating: ISO 7730:2005 eq. 6, DR = (34 − t)(v − 0.05)^0.62 (0.37 v Tu + 3.14), v < 0.05 → 0.05, Tu from k.
// Age of air: the nominal time constant V/Q over the occupied zone's mean age = the air-change effectiveness
// (ASHRAE 129-1997: 1 = fully mixed, > 1 the supply reaches the occupants before the room's air does).
// Category B limits (ISO 7730:2005 Annex A): DR < 20 %, vertical difference < 3 K, PMV −0.5 … +0.5, PPD < 10 %.

import type { LoadedCase } from "./caseLoad.js";
import { CFM_PER_M3S } from "./caseLoad.js";
import { at, voxelOf, wallDistance, type Grid } from "./voxelGrid.js";

export type Verdict = "ok" | "note" | "warn";

export interface Metric { key: string; group: "room" | "air" | "comfort" | "flows" | "run"; label: string; value: number; unit: string; verdict: Verdict | null; limit: string | null }

export interface Slice { plane: string; axis: 0 | 1 | 2; at: number; /** the two in-plane axes */ u: 0 | 1 | 2; v: 0 | 1 | 2; u0: number; v0: number; h: number; nu: number; nv: number; T: Float32Array; speed: Float32Array; age: Float32Array }

export interface Assessment { metrics: Metric[]; slices: Slice[]; speedHist: { edges: number[]; pct: number[] }; occupiedCells: number; drOccupied: Float64Array }

export function assess(c: LoadedCase, g: Grid, opts: { setpointC?: number } = {}): Assessment {
  const D = wallDistance(g);
  const n = c.cells;
  const occ = new Uint8Array(n);
  let occN = 0;
  for (let i = 0; i < n; i++) {
    const h = c.C[3 * i + 1]! - c.floorY;
    if (h < 0.1 || h > 1.8) continue;
    const q = voxelOf(g, c.C[3 * i]!, c.C[3 * i + 1]!, c.C[3 * i + 2]!);
    if (q >= 0 && D[q]! >= 0.3) { occ[i] = 1; occN++; }
  }
  const S = new Float64Array(n), DR = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    S[i] = Math.hypot(c.U[3 * i]!, c.U[3 * i + 1]!, c.U[3 * i + 2]!);
    const v = Math.max(S[i]!, 0.05), Tu = Math.min((100 * Math.sqrt((2 * Math.max(c.k[i]!, 0)) / 3)) / v, 60);
    DR[i] = Math.min(100, Math.max(0, (34 - c.T[i]!) * (v - 0.05) ** 0.62 * (0.37 * v * Tu + 3.14)));
  }
  const wavg = (f: ArrayLike<number>, m?: (i: number) => boolean): number => {
    let s = 0, w = 0;
    for (let i = 0; i < n; i++) if (!m || m(i)) { s += f[i]! * c.V[i]!; w += c.V[i]!; }
    return w ? s / w : NaN;
  };
  const pct = (f: ArrayLike<number>, m: (i: number) => boolean, p: number): number => {
    const a: number[] = [];
    for (let i = 0; i < n; i++) if (m(i)) a.push(f[i]!);
    a.sort((x, y) => x - y);
    if (!a.length) return NaN;
    // numpy's default (linear between the two nearest ranks)
    const r = (p / 100) * (a.length - 1), lo = Math.floor(r);
    return a[lo]! + (a[Math.min(lo + 1, a.length - 1)]! - a[lo]!) * (r - lo);
  };
  const isOcc = (i: number): boolean => occ[i] === 1;
  const band = (lo: number, hi: number) => (i: number): boolean => isOcc(i) && c.C[3 * i + 1]! - c.floorY >= lo && c.C[3 * i + 1]! - c.floorY < hi;
  const vol = c.V.reduce((s, x) => s + x, 0);
  const supply = c.openings.filter((o) => o.dir === "in").reduce((s, o) => s + o.m3s, 0);
  const tauN = vol / supply;
  const ageOcc = wavg(c.age, isOcc);
  let overV = 0, occV = 0;
  for (let i = 0; i < n; i++) if (occ[i]) { occV += c.V[i]!; if (S[i]! > 0.2) overV += c.V[i]!; }

  const M: Metric[] = [];
  const put = (key: string, group: Metric["group"], label: string, value: number, unit: string, verdict: Verdict | null = null, limit: string | null = null): void => {
    M.push({ key, group, label, value, unit, verdict, limit });
  };
  const ankle = wavg(c.T, band(0.05, 0.15)), head11 = wavg(c.T, band(1.05, 1.15)), head17 = wavg(c.T, band(1.65, 1.75));
  const tOcc = wavg(c.T, isOcc);
  put("room_mean_c", "room", "room air, mean", wavg(c.T), "°C");
  put("occupied_mean_c", "room", "occupied zone, mean", tOcc, "°C",
    opts.setpointC == null ? null : Math.abs(tOcc - opts.setpointC) <= 1 ? "ok" : "note",
    opts.setpointC == null ? null : `the thermostat's setpoint ${opts.setpointC.toFixed(2)} °C, ±1 K`);
  put("ankle_c", "room", "ankle (0.1 m)", ankle, "°C");
  put("head_1_1_c", "room", "head seated (1.1 m)", head11, "°C");
  put("head_1_7_c", "room", "head standing (1.7 m)", head17, "°C");
  const strat = head11 - ankle;
  put("stratification_k", "room", "head (1.1 m) − ankle (0.1 m)", strat, "K", Math.abs(strat) <= 3 ? "ok" : "warn", "ISO 7730:2005 Annex A, category B: vertical difference under 3 K");
  put("t_spread_sd_k", "room", "temperature wander over the averaging window (SD)", wavg(c.Tsd, isOcc), "K");
  put("speed_mean_ms", "air", "air speed, mean", wavg(S, isOcc), "m/s");
  const p95 = pct(S, isOcc, 95);
  put("speed_p95_ms", "air", "air speed, 95th percentile", p95, "m/s");
  put("speed_over_0_2_pct", "air", "occupied zone above 0.2 m/s", (100 * overV) / occV, "%");
  const drM = wavg(DR, isOcc), dr95 = pct(DR, isOcc, 95);
  put("dr_mean_pct", "air", "draught rating, mean", drM, "%", drM <= 20 ? "ok" : "warn", "ISO 7730:2005 category B: DR < 20 %");
  put("dr_p95_pct", "air", "draught rating, 95th percentile", dr95, "%", dr95 <= 20 ? "ok" : "note", "ISO 7730:2005 category B: DR < 20 % — the worst 5 % of the zone");
  put("tau_nominal_s", "air", "nominal time constant V/Q", tauN, "s");
  put("age_room_s", "air", "age of air, room mean", wavg(c.age), "s");
  put("age_occupied_s", "air", "age of air, occupied zone", ageOcc, "s");
  const ace = tauN / ageOcc;
  put("ace_occupied", "air", "air-change effectiveness (occupied)", ace, "", null, "ASHRAE 129-1997: 1 = fully mixed; above 1 the supply reaches the occupied zone first");
  if (c.PMV) {
    const pmv = wavg(c.PMV, isOcc);
    put("pmv_occupied", "comfort", "PMV (seated, 1 clo, 1 met — indicative)", pmv, "", Math.abs(pmv) <= 0.5 ? "ok" : Math.abs(pmv) <= 0.7 ? "note" : "warn", "ISO 7730:2005 category B: −0.5 … +0.5");
  }
  if (c.PPD) put("ppd_occupied_pct", "comfort", "PPD (indicative)", wavg(c.PPD, isOcc), "%", null, "ISO 7730:2005 category B: under 10 %");
  let inKg = 0, outKg = 0;
  for (const o of c.openings) {
    if (o.dir === "in") inKg += o.kgs; else outKg += o.kgs;
    put(`flow_${o.name}_cfm`, "flows", `${o.name} (${o.dir})`, o.m3s * CFM_PER_M3S, "cfm");
  }
  // by MASS: the warmer supply is lighter, so the cfm out of a heated room is less than the cfm in by the density ratio
  const bal = inKg ? (100 * (outKg - inKg)) / inKg : NaN;
  put("mass_balance_pct", "flows", "mass out − in", bal, "%", Math.abs(bal) <= 1 ? "ok" : "warn", "a converged steady solve: under 1 %");
  // SETTLED? Bed 1's solve (2026-11-03) wandered until about iteration 8,000 and was averaged over 8,000–11,000; an average that
  // starts earlier takes in the start-up and is not the room's answer
  // STOP WHEN SETTLED (2026-11-10): the run's own verdict — settled, or the cap reached with the change it still had
  if (c.settle && c.averagedFrom != null) put("averaged_from", "run", "fields averaged from iteration", c.averagedFrom, "", c.settle.settled ? "ok" : "warn",
    c.settle.settled ? `settled at iteration ${c.settle.iteration.toLocaleString()}: ${c.settle.words}` : `did NOT settle by the cap of ${c.settle.cap.toLocaleString()} iterations — still changing: ${c.settle.words}`);
  else if (c.averagedFrom != null) put("averaged_from", "run", "fields averaged from iteration", c.averagedFrom, "", c.averagedFrom >= 8000 ? "ok" : "warn",
    "a measured 110 m³ bedroom, 2026-11-03: the flow settled after about 8,000 iterations; an average that starts earlier includes the start-up — not converged");
  else put("averaged_from", "run", "fields averaged", NaN, "", "warn", "the case kept no average: one iteration's field, which wanders in a buoyant room");
  put("cells", "run", "cells", n, "");
  put("volume_m3", "run", "room volume (the mesh)", vol, "m³");
  put("occupied_cells", "run", "cells in the occupied zone", occN, "");

  // THE SLICES: a section across the room's shorter horizontal extent through the supply openings' centre, and plans
  // at 0.1 m and 1.1 m — sampled from the grid at its own spacing
  const inl = c.openings.filter((o) => o.dir === "in");
  let sx = 0, sz = 0, sw = 0;
  for (const o of inl) for (let j = 0; j < o.areas.length; j++) { sx += o.centres[3 * j]! * o.areas[j]!; sz += o.centres[3 * j + 2]! * o.areas[j]!; sw += o.areas[j]!; }
  const ex = c.bounds.hi[0] - c.bounds.lo[0], ez = c.bounds.hi[2] - c.bounds.lo[2];
  const sec: 0 | 2 = ex <= ez ? 0 : 2;
  const slices: Slice[] = [
    cut(g, "section", sec, sec === 0 ? sx / sw : sz / sw),
    cut(g, "plan 0.1 m", 1, c.floorY + 0.1),
    cut(g, "plan 1.1 m", 1, c.floorY + 1.1),
  ];
  const edges = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 1e9];
  const hist = edges.slice(0, -1).map(() => 0);
  for (let i = 0; i < n; i++) if (occ[i]) { const b = edges.findIndex((e, k) => S[i]! >= e && S[i]! < edges[k + 1]!); if (b >= 0) hist[b] = hist[b]! + c.V[i]!; }
  return { metrics: M, slices, speedHist: { edges, pct: hist.map((v) => (100 * v) / occV) }, occupiedCells: occN, drOccupied: DR };
}

function cut(g: Grid, plane: string, axis: 0 | 1 | 2, pos: number): Slice {
  // a section reads ACROSS (the other horizontal axis) by UP; a plan reads x (east) by z
  const [u, v]: [0 | 1 | 2, 0 | 1 | 2] = axis === 0 ? [2, 1] : axis === 2 ? [0, 1] : [0, 2];
  const idx = Math.min(g.n[axis] - 1, Math.max(0, Math.floor((pos - g.o[axis]) / g.h)));
  const nu = g.n[u!], nv = g.n[v!];
  const T = new Float32Array(nu * nv), speed = new Float32Array(nu * nv), age = new Float32Array(nu * nv);
  for (let a = 0; a < nu; a++) for (let b = 0; b < nv; b++) {
    const ijk = [0, 0, 0];
    ijk[axis] = idx; ijk[u!] = a; ijk[v!] = b;
    const q = at(g, ijk[0]!, ijk[1]!, ijk[2]!);
    const o = b * nu + a;
    if (!g.inside[q]) { T[o] = NaN; speed[o] = NaN; age[o] = NaN; continue; }
    T[o] = g.T[q]!; age[o] = g.age[q]!;
    speed[o] = Math.hypot(g.U[3 * q]!, g.U[3 * q + 1]!, g.U[3 * q + 2]!);
  }
  return { plane, axis, at: g.o[axis] + (idx + 0.5) * g.h, u: u!, v: v!, u0: g.o[u!] + 0.5 * g.h, v0: g.o[v!] + 0.5 * g.h, h: g.h, nu, nv, T, speed, age };
}
