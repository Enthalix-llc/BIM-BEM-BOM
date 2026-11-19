// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// ONE FRAME, WRITTEN INTO EVERY FILE (the user's rulings, 2026-11-19). The files beside the house are aligned to it in Edit
// Alignment; this says what each IFC must state so that it lands there BY ITSELF, as BIM programs share coordinates, with no
// record of ours: every file's IfcSite placement absorbs the placement the projection gives it (its TrueNorth turn and the user's
// move and turn), and every file's TrueNorth becomes the frame's. The common frame is the analysed building's own project
// coordinates — every ruling, the IDF and the CFD rooms already live there — so the building's placement is never rewritten and no
// vertex of it moves; only its TrueNorth may change. The frame's true north is the STANDARD's (the site plan, else the file the user
// names): the standard keeps its own rotation to true north, and every other file follows it.
//
// The geometry the projection works in is web-ifc's: metres, Y up, IFC (x, y, z) → (x, z, −y). A file's placement is IFC's: Z up,
// its own length unit. Both are converted here and nowhere else.

import type { StepFrame } from "./ifcStepPlace.js";

type V3 = [number, number, number];
type M4 = number[][];

const mul = (a: M4, b: M4): M4 => a.map((r) => [0, 1, 2, 3].map((j) => r.reduce((s, v, k) => s + v * b[k]![j]!, 0)));

/** the placement map of a file (projected point = place(world point), web-ifc's frame, metres) as a 4×4 in the FILE's IFC frame and
 *  length unit — read off the map itself (the image of the origin and the three axes), so it is exactly what the projection does */
export function placeMatrixIfc(place: (p: V3) => V3, lengthScale: number): M4 {
  const toWeb = (p: number[]): V3 => [p[0]! * lengthScale, p[2]! * lengthScale, -p[1]! * lengthScale];
  const toIfc = (q: V3): number[] => [q[0] / lengthScale, -q[2] / lengthScale, q[1] / lengthScale];
  const o = toIfc(place(toWeb([0, 0, 0])));
  const col = (axis: number[]): number[] => { const q = toIfc(place(toWeb(axis))); return [q[0]! - o[0]!, q[1]! - o[1]!, q[2]! - o[2]!]; };
  const x = col([1, 0, 0]), y = col([0, 1, 0]), z = col([0, 0, 1]);
  return [[x[0]!, y[0]!, z[0]!, o[0]!], [x[1]!, y[1]!, z[1]!, o[1]!], [x[2]!, y[2]!, z[2]!, o[2]!], [0, 0, 0, 1]];
}

export interface FrameFile {
  name: string;
  /** what the file states now */
  frame: StepFrame;
  /** where the projection puts it (null for the analysed building — the frame itself) */
  place: ((p: V3) => V3) | null;
}

export interface FileWrite {
  name: string;
  /** the new IfcSite placement (row-major, the file's units); null = unchanged (the analysed building) */
  site: M4 | null;
  trueNorth: [number, number];
}

/** a TrueNorth (IFC x, y) turned anticlockwise by deg */
const turnNorth = (tn: [number, number], deg: number): [number, number] => {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return [tn[0] * c - tn[1] * s, tn[0] * s + tn[1] * c];
};

/** what every file gets. The standard's true north, turned by the turn its own placement map makes, is the frame's true north —
 *  so the standard's rotation to true north (its site turn less its true north) is the same after as before. */
export function planFrame(files: FrameFile[], standard: string): { writes: FileWrite[]; trueNorth: [number, number] } | { refused: string } {
  const std = files.find((f) => f.name === standard);
  if (!std) return { refused: `${standard} is not among the files` };
  let trueNorth = std.frame.trueNorth;
  if (std.place) {
    const P = placeMatrixIfc(std.place, std.frame.lengthScale);
    trueNorth = turnNorth(std.frame.trueNorth, (Math.atan2(P[1]![0]!, P[0]![0]!) * 180) / Math.PI);
  }
  const writes = files.map((f): FileWrite => {
    if (!f.place) return { name: f.name, site: null, trueNorth };
    return { name: f.name, site: mul(placeMatrixIfc(f.place, f.frame.lengthScale), f.frame.site), trueNorth };
  });
  return { writes, trueNorth };
}
