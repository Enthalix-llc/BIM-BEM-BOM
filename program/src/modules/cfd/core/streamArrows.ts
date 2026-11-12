// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE AIRFLOW AS ARROWS (the user's ruling, 2026-11-04): an arrow's THICKNESS is the share of the supply air passing
// through it, its LENGTH the local speed. Streamlines are traced from each opening the air comes IN by, seeded on its
// faces in proportion to each face's flux, every line carrying an equal share of that opening's cfm. Along each line a
// sample every `step` m falls in a bin (`bin` m on a side); a line counts once per bin it passes, so a bin's cfm is the
// supply air that passes through it — never more than the supply. The bin's arrow sits at the mean of its samples,
// points along their cfm-weighted direction and is as long as |U| there.
//
// A line ends: at an outlet (out), cornered by walls with no way along them (wall — a step that would cross a wall
// slides along it instead), slower than 1 mm/s (stall), or past `maxLen` (recirculating: room air turns over several times before
// it leaves — at 0.07 m/s and a 13-minute age a parcel travels ~55 m). Every end is counted; none is hidden.

import type { LoadedCase } from "./caseLoad.js";
import { CFM_PER_M3S } from "./caseLoad.js";
import { sampleU, voxelOf, type Grid } from "./voxelGrid.js";

export interface Arrow { x: number; y: number; z: number; dx: number; dy: number; dz: number; speed: number; cfm: number; t: number }

export interface ArrowSet {
  arrows: Arrow[];
  lines: number;
  supplyCfm: number;
  /** the cfm the seeds carry — equals supplyCfm by construction */
  seededCfm: number;
  ends: { out: number; wall: number; stall: number; recirculating: number };
  /** the cfm of the lines that reached an outlet, by outlet */
  reached: Record<string, number>;
  params: { lines: number; step: number; bin: number; maxLen: number };
}

export function traceArrows(c: LoadedCase, g: Grid, opts: { lines?: number; step?: number; bin?: number; maxLen?: number } = {}): ArrowSet {
  const L = opts.lines ?? 400, step = opts.step ?? 0.15, bin = opts.bin ?? 0.3, maxLen = opts.maxLen ?? 40;
  const inlets = c.openings.filter((o) => o.dir === "in"), outlets = c.openings.filter((o) => o.dir === "out");
  const supply = inlets.reduce((s, o) => s + o.m3s, 0);
  // the outlets' voxels, grown by one so a line one voxel short of a grille ends there
  const outAt = new Map<number, string>();
  for (const o of outlets) for (let j = 0; j < o.areas.length; j++) {
    // the face centre lies ON a voxel boundary (the room's edge): half a voxel into the room first, so rounding never
    // puts it in the voxel outside
    const x = o.centres[3 * j]! - o.normals[3 * j]! * 0.5 * g.h, y = o.centres[3 * j + 1]! - o.normals[3 * j + 1]! * 0.5 * g.h, z = o.centres[3 * j + 2]! - o.normals[3 * j + 2]! * 0.5 * g.h;
    // grown by INDEX (a coordinate ± h can round past a voxel at a boundary and skip it)
    const i0 = Math.floor((x - g.o[0]) / g.h), j0 = Math.floor((y - g.o[1]) / g.h), k0 = Math.floor((z - g.o[2]) / g.h);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let d = -1; d <= 1; d++) {
      const i = i0 + a, j = j0 + b, k = k0 + d;
      if (i < 0 || j < 0 || k < 0 || i >= g.n[0] || j >= g.n[1] || k >= g.n[2]) continue;
      outAt.set((i * g.n[1] + j) * g.n[2] + k, o.name);
    }
  }
  type Bin = { n: number; sx: number; sy: number; sz: number; dx: number; dy: number; dz: number; cfm: number };
  const bins = new Map<string, Bin>();
  const ends = { out: 0, wall: 0, stall: 0, recirculating: 0 };
  const reached: Record<string, number> = {};
  let lines = 0, seeded = 0;
  const u = new Float64Array(3), k1 = new Float64Array(3), k2 = new Float64Array(3), k3 = new Float64Array(3), k4 = new Float64Array(3);

  for (const o of inlets) {
    const nLines = Math.max(4, Math.round((L * o.m3s) / supply));
    const cfmEach = (o.m3s * CFM_PER_M3S) / nLines;
    // seeds at the flux quantiles: face j takes the seeds whose (s + ½)/n falls in its share of the inflow
    const inflow = Array.from(o.flux, (f) => Math.max(0, -f));
    const tot = inflow.reduce((s, x) => s + x, 0);
    let cum = 0, s = 0;
    for (let j = 0; j < inflow.length && s < nLines; j++) {
      cum += inflow[j]! / tot;
      while (s < nLines && (s + 0.5) / nLines <= cum) {
        s++;
        // half a voxel into the room (the face normal points out of the domain)
        let x = o.centres[3 * j]! - o.normals[3 * j]! * 0.5 * g.h, y = o.centres[3 * j + 1]! - o.normals[3 * j + 1]! * 0.5 * g.h, z = o.centres[3 * j + 2]! - o.normals[3 * j + 2]! * 0.5 * g.h;
        lines++; seeded += cfmEach;
        const seen = new Set<string>();
        let len = 0, sinceSample = step, end: keyof typeof ends | null = null;
        for (let it = 0; it < 200000 && !end; it++) {
          if (!sampleU(g, x, y, z, k1)) { end = "wall"; break; }
          const sp = Math.hypot(k1[0]!, k1[1]!, k1[2]!);
          if (sp < 1e-3) { end = "stall"; break; }
          const q = voxelOf(g, x, y, z);
          const hit = outAt.get(q);
          if (hit && len > g.h) { end = "out"; reached[hit] = (reached[hit] ?? 0) + cfmEach; break; }
          if (sinceSample >= step) {
            sinceSample = 0;
            const key = `${Math.floor(x / bin)},${Math.floor(y / bin)},${Math.floor(z / bin)}`;
            let b = bins.get(key);
            if (!b) { b = { n: 0, sx: 0, sy: 0, sz: 0, dx: 0, dy: 0, dz: 0, cfm: 0 }; bins.set(key, b); }
            b.n++; b.sx += x; b.sy += y; b.sz += z;
            b.dx += (k1[0]! / sp) * cfmEach; b.dy += (k1[1]! / sp) * cfmEach; b.dz += (k1[2]! / sp) * cfmEach;
            if (!seen.has(key)) { seen.add(key); b.cfm += cfmEach; }
          }
          // RK4 with a time step that moves the parcel half a voxel
          const dt = (0.5 * g.h) / sp;
          const ok2 = sampleU(g, x + 0.5 * dt * k1[0]!, y + 0.5 * dt * k1[1]!, z + 0.5 * dt * k1[2]!, k2);
          const ok3 = ok2 && sampleU(g, x + 0.5 * dt * k2[0]!, y + 0.5 * dt * k2[1]!, z + 0.5 * dt * k2[2]!, k3);
          const ok4 = ok3 && sampleU(g, x + dt * k3[0]!, y + dt * k3[1]!, z + dt * k3[2]!, k4);
          if (ok4) { for (let a = 0; a < 3; a++) u[a] = (k1[a]! + 2 * k2[a]! + 2 * k3[a]! + k4[a]!) / 6; }
          else { u[0] = k1[0]!; u[1] = k1[1]!; u[2] = k1[2]!; }
          // a step that would leave the room SLIDES along the wall: the component that crosses it is dropped (the mean
          // flow on a 5 cm grid points into a wall where the real near-wall layer turns along it)
          let sx = dt * u[0]!, sy = dt * u[1]!, sz = dt * u[2]!;
          const inside = (px: number, py: number, pz: number): boolean => { const q2 = voxelOf(g, px, py, pz); return q2 >= 0 && g.inside[q2] === 1; };
          if (!inside(x + sx, y + sy, z + sz)) {
            const tries: Array<[number, number, number]> = [[0, sy, sz], [sx, 0, sz], [sx, sy, 0], [sx, 0, 0], [0, sy, 0], [0, 0, sz]];
            const ok = tries.find(([a, b, d]) => (a || b || d) && inside(x + a, y + b, z + d));
            if (!ok) { end = "wall"; break; }
            [sx, sy, sz] = ok;
          }
          x += sx; y += sy; z += sz;
          const ds = Math.hypot(sx, sy, sz);
          len += ds; sinceSample += ds;
          if (len > maxLen) end = "recirculating";
        }
        ends[end ?? "recirculating"]++;
      }
    }
  }
  const arrows: Arrow[] = [];
  for (const b of bins.values()) {
    const x = b.sx / b.n, y = b.sy / b.n, z = b.sz / b.n;
    const m = Math.hypot(b.dx, b.dy, b.dz);
    if (m === 0) continue;
    const speedAt = sampleU(g, x, y, z, u) ? Math.hypot(u[0]!, u[1]!, u[2]!) : 0;
    const q = voxelOf(g, x, y, z);
    arrows.push({ x, y, z, dx: b.dx / m, dy: b.dy / m, dz: b.dz / m, speed: speedAt, cfm: b.cfm, t: q >= 0 ? g.T[q]! : NaN });
  }
  return { arrows, lines, supplyCfm: supply * CFM_PER_M3S, seededCfm: seeded, ends, reached, params: { lines: L, step, bin, maxLen } };
}
