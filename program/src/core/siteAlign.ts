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

/** the move that takes a point of the file (as drawn now) onto a point of the house — and that house point becomes the locked pivot,
 *  so a later turn keeps the two points together */
export function matchPoint(a: FileAlign, filePoint: V3, housePoint: V3): FileAlign {
  const moved = moveBy(a, [housePoint[0] - filePoint[0], housePoint[1] - filePoint[1], housePoint[2] - filePoint[2]]);
  return setPivot(moved, housePoint[0], housePoint[2]);
}

/** the placement a file has: its alignment when the user accepted one, else the older per-file turn (about the house's origin) */
export function alignOf(name: string, align: Record<string, FileAlign> | undefined, turn: Record<string, number> | undefined): FileAlign {
  const a = align?.[name];
  if (a) return a;
  const t = turn?.[name] ?? 0;
  return t ? { ...NO_ALIGN, deg: t } : NO_ALIGN;
}
