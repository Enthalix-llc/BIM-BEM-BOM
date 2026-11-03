// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// A LINKED FILE'S ALIGNMENT (user, 2026-11-03: "a persistent dialog offering displacement and rotation tools to see added ifc model
// before accepting its location (and storing translation coordinates in a ifc db)"). A file beside the house is first turned by its
// TrueNorth against the house's (siteProject.ts); the user's alignment then moves it and turns it about a PIVOT — a point of the
// house's frame the user locks, which stays where it is however far the file is turned. Every coordinate is the house frame:
// metres, Y up, the project grid's −Z north. The turn is about the vertical through the pivot, in rotateY's sense (positive =
// clockwise seen from above, as the per-file turn has always been).
//
// A point p of the file (after its TrueNorth turn) is placed at  R(p + d − W) + W  : moved by d, then turned about W. So the file's
// point that was at W − d lands on W and stays there as the turn changes, and d is how far that point of the file has moved.

import { rotateY } from "./terrain.js";

type V3 = [number, number, number];

/** the user's placement of one linked file on top of its TrueNorth turn */
export interface FileAlign {
  /** the move, metres: x east, y up, z south (the project grid) — how far the file's point now at the pivot has moved */
  dx: number; dy: number; dz: number;
  /** the turn, ° clockwise from above, about the vertical through the pivot (px, pz) */
  deg: number; px: number; pz: number;
  /** when the user accepted this placement (an identity accepted is still an answer: the dialog does not ask again) */
  at?: string;
}

export const NO_ALIGN: FileAlign = { dx: 0, dy: 0, dz: 0, deg: 0, px: 0, pz: 0 };

export const isIdentity = (a: FileAlign): boolean =>
  Math.abs(a.dx) < 1e-9 && Math.abs(a.dy) < 1e-9 && Math.abs(a.dz) < 1e-9 && Math.abs(a.deg) < 1e-9;

/** a point of the file, after its TrueNorth turn, placed by the alignment */
export function alignPoint(p: V3, a: FileAlign): V3 {
  if (isIdentity(a)) return p;
  const q = rotateY([p[0] + a.dx - a.px, 0, p[2] + a.dz - a.pz], a.deg);
  return [q[0] + a.px, p[1] + a.dy, q[2] + a.pz];
}

/** the same placement as a column-major 4×4 (three.js Matrix4.fromArray) — the dialog's live preview moves the drawn file by it */
export function alignMatrix(a: FileAlign): number[] {
  const r = (a.deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  // rotateY: x' = c·x − s·z, z' = s·x + c·z; the translation is R(d − W) + W
  const ux = a.dx - a.px, uz = a.dz - a.pz;
  return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, c * ux - s * uz + a.px, a.dy, s * ux + c * uz + a.pz, 1];
}

/** the inverse turn (R⁻¹), for keeping a placement while its parts change */
const unturn = (x: number, z: number, deg: number): [number, number] => {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return [c * x + s * z, -s * x + c * z];
};

/** the file moved by m in the house frame, the pivot left where it is */
export function moveBy(a: FileAlign, m: V3): FileAlign {
  const [ux, uz] = unturn(m[0], m[2], a.deg);
  return { ...a, dx: a.dx + ux, dy: a.dy + m[1], dz: a.dz + uz };
}

/** the file turned by `deg` more about its pivot */
export const turnBy = (a: FileAlign, deg: number): FileAlign => ({ ...a, deg: Math.round((a.deg + deg) * 1e6) / 1e6 });

/** the pivot put at a house point W', the file left exactly where it is */
export function setPivot(a: FileAlign, px: number, pz: number): FileAlign {
  const wx = px - a.px, wz = pz - a.pz;
  const [ux, uz] = unturn(wx, wz, a.deg);
  return { ...a, px, pz, dx: a.dx + wx - ux, dz: a.dz + wz - uz };
}

/** the move axes the user has locked in the dialog (user, 2026-11-03: "Lock button beside each displacement input"): a locked
 *  axis is not moved by a nudge, a typed value or a matched point — east and north in the house frame, up the height */
export interface AxisLocks { east: boolean; north: boolean; up: boolean }
export const NO_LOCKS: AxisLocks = { east: false, north: false, up: false };

/** the move that takes a point of the file (as drawn now) onto a point of the house — and where that point lands becomes the
 *  locked pivot, so a later turn keeps the two points together. A locked axis keeps its part of the move at nothing: the file
 *  point goes as far as the unlocked axes take it, and the pivot is put where it lands */
export function matchPoint(a: FileAlign, filePoint: V3, housePoint: V3, lock: AxisLocks = NO_LOCKS): FileAlign {
  const m: V3 = [lock.east ? 0 : housePoint[0] - filePoint[0], lock.up ? 0 : housePoint[1] - filePoint[1], lock.north ? 0 : housePoint[2] - filePoint[2]];
  return setPivot(moveBy(a, m), filePoint[0] + m[0], filePoint[2] + m[2]);
}

/** the placement a file has: its alignment when the user accepted one, else the older per-file turn (about the house's origin) */
export function alignOf(name: string, align: Record<string, FileAlign> | undefined, turn: Record<string, number> | undefined): FileAlign {
  const a = align?.[name];
  if (a) return a;
  const t = turn?.[name] ?? 0;
  return t ? { ...NO_ALIGN, deg: t } : NO_ALIGN;
}

/** a placed point back to the file's TrueNorth-turned frame: the inverse of alignPoint, so a draft placement can be measured on
 *  geometry stored under the accepted one */
export function unalignPoint(p: V3, a: FileAlign): V3 {
  if (isIdentity(a)) return p;
  const [ux, uz] = unturn(p[0] - a.px, p[2] - a.pz, a.deg);
  return [ux - a.dx + a.px, p[1] - a.dy, uz - a.dz + a.pz];
}

/** THE ROOF GAP (user, 2026-11-03: "The PV panels apparently slid under the roof with MEP rotation"): each panel's lowest corner
 *  above the house's roof under it — the highest roof plane whose outline holds the corner in plan. A file square to the house
 *  seats every panel at the same gap; a spread says it is turned or tilted against the roof, a negative gap that a panel is under
 *  it. It measures only; nothing is moved. */
export interface RoofPlane { n: V3; outer: V3[] }
export interface RoofGap { panels: number; measured: number; min: number; max: number; under: number }
const inPlan = (x: number, z: number, ring: V3[]): boolean => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, , zi] = ring[i]!, [xj, , zj] = ring[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};
export function roofGap(panels: V3[][], roofs: RoofPlane[]): RoofGap | null {
  if (!panels.length) return null;
  const sloped = roofs.filter((r) => Math.abs(r.n[1]) > 0.2 && r.outer.length >= 3);
  const gaps: number[] = [];
  for (const pts of panels) {
    let low = Infinity;
    for (const [x, y, z] of pts) {
      let top = -Infinity;
      for (const r of sloped) {
        if (!inPlan(x, z, r.outer)) continue;
        const o = r.outer[0]!, ry = o[1] - (r.n[0] * (x - o[0]) + r.n[2] * (z - o[2])) / r.n[1];
        if (ry > top) top = ry;
      }
      if (top > -Infinity) low = Math.min(low, y - top);
    }
    if (low < Infinity) gaps.push(low);
  }
  if (!gaps.length) return { panels: panels.length, measured: 0, min: NaN, max: NaN, under: 0 };
  return { panels: panels.length, measured: gaps.length, min: Math.min(...gaps), max: Math.max(...gaps), under: gaps.filter((g) => g < 0).length };
}
