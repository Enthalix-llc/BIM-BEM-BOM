// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// A FINISHED CASE, LOADED: the mesh's cells (centre, volume), the averaged fields at the last time, and each opening
// patch's faces (centre, area, outward normal, mass flux, temperature). The reader is handed a file reader, so the
// app (over IPC) and the gate (node fs) load a case through the same code.
//
// Volume flow at an opening = the patch's mass flux ÷ the air's density THERE — Boussinesq, ρ = ρ0 (1 − β (T − T0)),
// with ρ0, β and T0 read from the case's own constant/thermophysicalProperties. (Dividing by ρ0 alone reads the
// 150 cfm the inlet was given as 146.6 at 29 °C supply — the 2026-11-03 scripted report did that.)

import { readBoundary, readFaces, readInternal, readLabels, readPatchScalars, readPoints, readSymmTensorTrace, latestTime, type Patch } from "./foamRead.js";

export interface CaseFiles {
  read(rel: string): Promise<string>;
  list(rel: string): Promise<string[]>;
  exists(rel: string): Promise<boolean>;
}

export interface Opening {
  name: string;
  /** "in" when air enters the room through it (net mass flux < 0), else "out" */
  dir: "in" | "out";
  /** volume flow, m³/s, positive (at the opening's own density) */
  m3s: number;
  /** mass flow, kg/s, positive — what a converged solve balances */
  kgs: number;
  /** face centres (3 per face), areas, outward unit normals, volume flux per face m³/s (positive = out of the room) */
  centres: Float64Array; areas: Float64Array; normals: Float64Array; flux: Float64Array;
  /** the patch's area-weighted temperature, °C */
  tC: number;
}

export interface WallPatch { name: string; area: number; tC: number; heatW: number | null }

export interface LoadedCase {
  time: string;
  averaged: boolean;
  /** the iteration the fields' averaging started (the case's own fieldAverage timeStart, or — a moving window — the last
   *  iteration less the window), null when none */
  averagedFrom: number | null;
  /** STOP WHEN SETTLED (2026-11-10): the verdict the app kept beside the case (settled.json), null for a fixed-count run */
  settle: { settled: boolean; iteration: number; cap: number; words: string } | null;
  cells: number;
  C: Float64Array; V: Float64Array;
  /** °C */ T: Float64Array;
  U: Float64Array;
  /** the temperature's standard deviation over the averaging window, K (0 when the run kept no average) */
  Tsd: Float64Array;
  age: Float64Array; PMV: Float64Array | null; PPD: Float64Array | null; k: Float64Array;
  floorY: number;
  bounds: { lo: [number, number, number]; hi: [number, number, number] };
  openings: Opening[];
  walls: WallPatch[];
  eos: { rho0: number; beta: number; T0: number };
  /** the case's own case.json (settings written by the runner or the scripts) */
  info: Record<string, unknown>;
}

function eosOf(t: string): { rho0: number; beta: number; T0: number } {
  const g = (k: string): number => {
    const m = new RegExp(`\\b${k}\\s+([-+0-9.eE]+)\\s*;`).exec(t);
    if (!m) throw new Error(`thermophysicalProperties states no ${k} — a Boussinesq case is expected`);
    return +m[1]!;
  };
  return { rho0: g("rho0"), beta: g("beta"), T0: g("T0") };
}

export async function loadCase(f: CaseFiles, progress?: (s: string) => void): Promise<LoadedCase> {
  const say = (s: string): void => progress?.(s);
  const time = latestTime(await f.list("."));
  if (!time) throw new Error("the case has no time folder past 0 — it has not run");
  const has = async (n: string): Promise<boolean> => f.exists(`${time}/${n}`);
  for (const need of ["C", "V", "T", "U", "phi", "age", "k"]) if (!(await has(need))) throw new Error(`${time}/${need} is missing — the runner writes it after the solve`);
  say(`reading time ${time}`);
  const C = readInternal(await f.read(`${time}/C`)).data;
  const cells = C.length / 3;
  const V = readInternal(await f.read(`${time}/V`), cells).data;
  const averaged = await has("TMean");
  const Tk = readInternal(await f.read(`${time}/${averaged ? "TMean" : "T"}`), cells).data;
  const T = Tk.map((x) => x - 273.15);
  const U = readInternal(await f.read(`${time}/${averaged ? "UMean" : "U"}`), cells).data;
  const Tsd = averaged && (await has("TPrime2Mean")) ? readInternal(await f.read(`${time}/TPrime2Mean`), cells).data.map((x) => Math.sqrt(Math.max(x, 0))) : new Float64Array(cells);
  const age = readInternal(await f.read(`${time}/age`), cells).data;
  const k = readInternal(await f.read(`${time}/k`), cells).data;
  const PMV = (await has("PMV")) ? readInternal(await f.read(`${time}/PMV`), cells).data : null;
  const PPD = (await has("PPD")) ? readInternal(await f.read(`${time}/PPD`), cells).data : null;

  say("reading the mesh");
  const mesh = (await f.exists(`${time}/polyMesh/points`)) ? `${time}/polyMesh` : "constant/polyMesh";
  const pts = readPoints(await f.read(`${mesh}/points`));
  const patches: Patch[] = readBoundary(await f.read(`${mesh}/boundary`));
  const faces = readFaces(await f.read(`${mesh}/faces`));
  void readLabels; // owner is not needed: a boundary face's normal points out of the domain by OpenFOAM's convention
  let floorY = Infinity;
  const lo: [number, number, number] = [Infinity, Infinity, Infinity], hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let p = 0; p < pts.length; p += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a]!, pts[p + a]!); hi[a] = Math.max(hi[a]!, pts[p + a]!); }
  floorY = lo[1];

  const eos = eosOf(await f.read("constant/thermophysicalProperties"));
  const phiT = await f.read(`${time}/phi`), TT = await f.read(`${time}/T`);
  const whfT = (await has("wallHeatFlux")) ? await f.read(`${time}/wallHeatFlux`) : null;

  const geom = (p: Patch): { centres: Float64Array; areas: Float64Array; normals: Float64Array } => {
    const centres = new Float64Array(3 * p.nFaces), areas = new Float64Array(p.nFaces), normals = new Float64Array(3 * p.nFaces);
    for (let j = 0; j < p.nFaces; j++) {
      const fi = p.startFace + j, a0 = faces.off[fi]!, a1 = faces.off[fi + 1]!;
      let cx = 0, cy = 0, cz = 0;
      for (let q = a0; q < a1; q++) { const v = 3 * faces.idx[q]!; cx += pts[v]!; cy += pts[v + 1]!; cz += pts[v + 2]!; }
      const n = a1 - a0; cx /= n; cy /= n; cz /= n;
      // area vector: the fan of triangles from the face's mean point
      let sx = 0, sy = 0, sz = 0;
      for (let q = a0; q < a1; q++) {
        const v = 3 * faces.idx[q]!, w = 3 * faces.idx[q + 1 < a1 ? q + 1 : a0]!;
        const ax = pts[v]! - cx, ay = pts[v + 1]! - cy, az = pts[v + 2]! - cz, bx = pts[w]! - cx, by = pts[w + 1]! - cy, bz = pts[w + 2]! - cz;
        sx += ay * bz - az * by; sy += az * bx - ax * bz; sz += ax * by - ay * bx;
      }
      const A = 0.5 * Math.hypot(sx, sy, sz);
      centres[3 * j] = cx; centres[3 * j + 1] = cy; centres[3 * j + 2] = cz;
      areas[j] = A;
      if (A > 0) { normals[3 * j] = sx / (2 * A); normals[3 * j + 1] = sy / (2 * A); normals[3 * j + 2] = sz / (2 * A); }
    }
    return { centres, areas, normals };
  };
  const meanT = (name: string, areas: Float64Array): number => {
    const v = readPatchScalars(TT, name);
    if (!v) return NaN;
    if (v.length === 1) return v[0]! - 273.15;
    let s = 0, a = 0;
    for (let j = 0; j < v.length; j++) { s += v[j]! * areas[j]!; a += areas[j]!; }
    return s / a - 273.15;
  };

  const openings: Opening[] = [], walls: WallPatch[] = [];
  for (const p of patches) {
    if (p.nFaces === 0 || p.type === "empty") continue;
    const g = geom(p);
    const tC = meanT(p.name, g.areas);
    if (p.type === "wall") {
      let heatW: number | null = null;
      const q = whfT ? readPatchScalars(whfT, p.name) : null;
      if (q) { heatW = 0; for (let j = 0; j < g.areas.length; j++) heatW += (q.length === 1 ? q[0]! : q[j]!) * g.areas[j]!; }
      walls.push({ name: p.name, area: g.areas.reduce((s, x) => s + x, 0), tC, heatW });
      continue;
    }
    const phi = readPatchScalars(phiT, p.name);
    if (!phi || phi.length !== p.nFaces) throw new Error(`${time}/phi states no per-face flux on the opening "${p.name}"`);
    const tv = readPatchScalars(TT, p.name);
    const flux = new Float64Array(p.nFaces);
    let net = 0, mass = 0;
    for (let j = 0; j < p.nFaces; j++) mass += phi[j]!;
    for (let j = 0; j < p.nFaces; j++) {
      const tK = tv ? (tv.length === 1 ? tv[0]! : tv[j]!) : eos.T0;
      const rho = eos.rho0 * (1 - eos.beta * (tK - eos.T0));
      flux[j] = phi[j]! / rho;
      net += flux[j]!;
    }
    openings.push({ name: p.name, dir: net < 0 ? "in" : "out", m3s: Math.abs(net), kgs: Math.abs(mass), ...g, flux, tC });
  }
  const info = (await f.exists("case.json")) ? (JSON.parse(await f.read("case.json")) as Record<string, unknown>) : {};
  const cd = (await f.exists("system/controlDict")) ? await f.read("system/controlDict") : "";
  const ts = /fieldAverage[\s\S]*?timeStart\s+(\d+)/.exec(cd) ?? /timeStart\s+(\d+)\s*;[^}]*fieldAverage/.exec(cd);
  const averagedFrom = averaged && ts ? +ts[1]! : null;
  const settle = (await f.exists("settled.json")) ? (JSON.parse(await f.read("settled.json")) as LoadedCase["settle"]) : null;
  return { time, averaged, averagedFrom, settle, cells, C, V, T, U, Tsd, age, PMV, PPD, k, floorY, bounds: { lo, hi }, openings, walls, eos, info };
}

export const CFM_PER_M3S = 1 / 0.000471947443;
