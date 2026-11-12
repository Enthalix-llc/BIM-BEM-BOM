// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE CASE ON A UNIFORM GRID. The mesh's cells are 1.25–10 cm (refined at the grilles), unordered; tracing a
// streamline or cutting a slice wants a lookup by position. Each cell is spread over the grid voxels its own extent
// covers (half size ½·∛V about its centre), volume-weighted, so a voxel holds the mean of the cells in it. A voxel no
// cell reaches is OUTSIDE the room — the room's shape is the mesh's, never redrawn.

import type { LoadedCase } from "./caseLoad.js";

export interface Grid {
  h: number;
  o: [number, number, number];
  n: [number, number, number];
  /** 1 inside the room */
  inside: Uint8Array;
  U: Float32Array; T: Float32Array; age: Float32Array;
}

export function buildGrid(c: LoadedCase, h = 0.05): Grid {
  const o: [number, number, number] = [c.bounds.lo[0] - h, c.bounds.lo[1] - h, c.bounds.lo[2] - h];
  const n: [number, number, number] = [0, 1, 2].map((a) => Math.ceil((c.bounds.hi[a]! - o[a]!) / h) + 2) as [number, number, number];
  const N = n[0] * n[1] * n[2];
  const w = new Float32Array(N), U = new Float32Array(3 * N), T = new Float32Array(N), age = new Float32Array(N);
  for (let i = 0; i < c.cells; i++) {
    const v = c.V[i]!, r = 0.5 * Math.cbrt(v);
    const cx = c.C[3 * i]!, cy = c.C[3 * i + 1]!, cz = c.C[3 * i + 2]!;
    const i0 = Math.max(0, Math.ceil((cx - r - o[0]) / h - 0.5)), i1 = Math.min(n[0] - 1, Math.floor((cx + r - o[0]) / h - 0.5));
    const j0 = Math.max(0, Math.ceil((cy - r - o[1]) / h - 0.5)), j1 = Math.min(n[1] - 1, Math.floor((cy + r - o[1]) / h - 0.5));
    const k0 = Math.max(0, Math.ceil((cz - r - o[2]) / h - 0.5)), k1 = Math.min(n[2] - 1, Math.floor((cz + r - o[2]) / h - 0.5));
    // a cell smaller than a voxel lands in the voxel holding its centre
    const ci = Math.floor((cx - o[0]) / h), cj = Math.floor((cy - o[1]) / h), ck = Math.floor((cz - o[2]) / h);
    const ia = i1 >= i0 ? i0 : ci, ib = i1 >= i0 ? i1 : ci, ja = j1 >= j0 ? j0 : cj, jb = j1 >= j0 ? j1 : cj, ka = k1 >= k0 ? k0 : ck, kb = k1 >= k0 ? k1 : ck;
    for (let a = ia; a <= ib; a++) for (let b = ja; b <= jb; b++) for (let d = ka; d <= kb; d++) {
      const q = (a * n[1] + b) * n[2] + d;
      w[q] = w[q]! + v;
      U[3 * q] = U[3 * q]! + v * c.U[3 * i]!; U[3 * q + 1] = U[3 * q + 1]! + v * c.U[3 * i + 1]!; U[3 * q + 2] = U[3 * q + 2]! + v * c.U[3 * i + 2]!;
      T[q] = T[q]! + v * c.T[i]!; age[q] = age[q]! + v * c.age[i]!;
    }
  }
  const inside = new Uint8Array(N);
  for (let q = 0; q < N; q++) {
    if (w[q]! <= 0) { T[q] = NaN; age[q] = NaN; continue; }
    inside[q] = 1;
    const s = 1 / w[q]!;
    U[3 * q] = U[3 * q]! * s; U[3 * q + 1] = U[3 * q + 1]! * s; U[3 * q + 2] = U[3 * q + 2]! * s; T[q] = T[q]! * s; age[q] = age[q]! * s;
  }
  return { h, o, n, inside, U, T, age };
}

export const at = (g: Grid, i: number, j: number, k: number): number => (i * g.n[1] + j) * g.n[2] + k;

/** the voxel holding a point, or -1 outside the grid */
export function voxelOf(g: Grid, x: number, y: number, z: number): number {
  const i = Math.floor((x - g.o[0]) / g.h), j = Math.floor((y - g.o[1]) / g.h), k = Math.floor((z - g.o[2]) / g.h);
  if (i < 0 || j < 0 || k < 0 || i >= g.n[0] || j >= g.n[1] || k >= g.n[2]) return -1;
  return at(g, i, j, k);
}

/** trilinear sample of U at a point (voxel centres at o + (i + ½) h); voxels outside the room read 0; null when the
 *  point's own voxel is outside */
export function sampleU(g: Grid, x: number, y: number, z: number, out: Float64Array): boolean {
  const q0 = voxelOf(g, x, y, z);
  if (q0 < 0 || !g.inside[q0]) return false;
  const fx = (x - g.o[0]) / g.h - 0.5, fy = (y - g.o[1]) / g.h - 0.5, fz = (z - g.o[2]) / g.h - 0.5;
  const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz), tx = fx - i, ty = fy - j, tz = fz - k;
  out[0] = 0; out[1] = 0; out[2] = 0;
  let wsum = 0;
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let d = 0; d < 2; d++) {
    const ii = i + a, jj = j + b, kk = k + d;
    if (ii < 0 || jj < 0 || kk < 0 || ii >= g.n[0] || jj >= g.n[1] || kk >= g.n[2]) continue;
    const q = at(g, ii, jj, kk);
    if (!g.inside[q]) continue;
    const wt = (a ? tx : 1 - tx) * (b ? ty : 1 - ty) * (d ? tz : 1 - tz);
    out[0] += wt * g.U[3 * q]!; out[1] += wt * g.U[3 * q + 1]!; out[2] += wt * g.U[3 * q + 2]!;
    wsum += wt;
  }
  if (wsum > 0) { out[0] /= wsum; out[1] /= wsum; out[2] /= wsum; }
  return true;
}

/** per voxel, the horizontal distance (m) to the nearest voxel outside the room in its own layer — a chamfer
 *  transform (3-4), so the occupied zone's "0.3 m in from the walls" is read from the room's own shape */
export function wallDistance(g: Grid): Float32Array {
  const [nx, ny, nz] = g.n;
  const D = new Float32Array(nx * ny * nz);
  const BIG = 1e9;
  for (let j = 0; j < ny; j++) {
    const d = new Float32Array(nx * nz);
    for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) d[i * nz + k] = g.inside[at(g, i, j, k)] ? BIG : 0;
    const rel = (i: number, k: number, di: number, dk: number, c: number): void => {
      const a = i + di, b = k + dk;
      if (a < 0 || b < 0 || a >= nx || b >= nz) { d[i * nz + k] = Math.min(d[i * nz + k]!, c); return; }
      d[i * nz + k] = Math.min(d[i * nz + k]!, d[a * nz + b]! + c);
    };
    for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) { rel(i, k, -1, 0, 3); rel(i, k, 0, -1, 3); rel(i, k, -1, -1, 4); rel(i, k, -1, 1, 4); }
    for (let i = nx - 1; i >= 0; i--) for (let k = nz - 1; k >= 0; k--) { rel(i, k, 1, 0, 3); rel(i, k, 0, 1, 3); rel(i, k, 1, 1, 4); rel(i, k, 1, -1, 4); }
    // a voxel's distance is to the nearest OUTSIDE voxel's centre; the wall lies half a voxel nearer
    for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) D[at(g, i, j, k)] = Math.max(0, (d[i * nz + k]! / 3 - 0.5) * g.h);
  }
  return D;
}
