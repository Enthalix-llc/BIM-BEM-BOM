// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// PROJECTING A FILE BESIDE THE HOUSE INTO THE MODEL (user, 2026-09-07):
// "Selecting a site or shade (MEP file that shows exterior elements that can
// shade, such as PV panels) file projects those files to become part of the
// idf db." One routine for the gate and the app: read the file's terrain (a
// SITE file has one) and its shading elements, read ITS OWN TrueNorth, and
// turn it into the house frame by the difference of the two files' north —
// the site file is true-north-up (22° to turn), the MEP file is exported in
// the house's shared coordinates and says so ((0, 1) too, and the panels
// land on the roof under that turn: the gate measures it). A SHADE file
// also carries interior equipment — outlets, switches, junction boxes —
// which shade nothing: an element lying within one of the house's own rooms
// (INSIDE the IfcSpace solid — a box was tried first and the Great room,
// which wraps a corner, swallowed 31 of the 35 PV panels on the lower roof
// in its notch; a point pushed a wall thickness each way is asked, so a box
// recessed in a wall still counts as the room's) is left out and counted,
// never silently kept. Elements from a further file are keyed by
// their own express id offset by FILE_ID_STRIDE, so the one pick / hide /
// delete path serves every file.

import type * as WebIFC from "web-ifc";
import { readTerrain, readSiteElements, readMepGeometry, rotateY, rotationFromTrueNorth, type SiteElement, type V3 } from "./terrain.js";
import { readTrueNorth } from "./ifcStream.js";
import { readMepMeta, disciplineOf, type MepMeta, type MepSystemMeta, type Discipline } from "./mepRead.js";
import { FILE_ID_STRIDE } from "./db.js";
import { alignPoint, isIdentity, NO_ALIGN, type FileAlign } from "./siteAlign.js";

export interface RoomSolid { faces: Array<{ n: V3; outer: V3[] }>; name?: string }
/** a wall thickness: an outlet box recessed into a wall is still the room's */
export const INTERIOR_GROW_M = 0.3;

export interface ProjectedElement { expressId: number; file: string; fileExpressId: number; name: string; ifcClass: string; tris: V3[][]; room: string | null }
/** THE SERVICES INVENTORY (2026-09-10): every element of a shade file, interior INCLUDED, with what the file states
 *  about it (core/mepRead.ts) and the room it lies in — the SYSTEMS tab's instrument; `site_elements` stays the
 *  shading set, so a panel is in both, one row per purpose */
export interface MepProjected { expressId: number; file: string; fileExpressId: number; name: string; kind: string; ifcClass: string; tris: V3[][]; interior: boolean; room: string | null; meta: MepMeta; discipline: Discipline; centroid: V3;
  /** the geometry kept: the file's mesh, or its bounding box when the mesh exceeds MEP_TRI_CAP (measured: 217 light fixtures carry a million triangles; the runs a tenth of that) */
  lod: "mesh" | "box"; fileTris: number }
/** a manufacturer's mesh over this many triangles is stored and drawn as its box — a stated display bound, the file's count kept beside it */
export const MEP_TRI_CAP = 1000;
/** the axis-aligned box of the triangles, as 12 triangles */
export function boxTris(tris: V3[][]): V3[][] {
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (const p of t) for (let k = 0; k < 3; k++) { if (p[k]! < lo[k]!) lo[k] = p[k]!; if (p[k]! > hi[k]!) hi[k] = p[k]!; }
  const c = (x: number, y: number, z: number): V3 => [x ? hi[0] : lo[0], y ? hi[1] : lo[1], z ? hi[2] : lo[2]];
  const q = (a: V3, b: V3, cc: V3, d: V3): V3[][] => [[a, b, cc], [a, cc, d]];
  return [
    ...q(c(0, 0, 0), c(0, 0, 1), c(1, 0, 1), c(1, 0, 0)), ...q(c(0, 1, 0), c(1, 1, 0), c(1, 1, 1), c(0, 1, 1)),
    ...q(c(0, 0, 0), c(1, 0, 0), c(1, 1, 0), c(0, 1, 0)), ...q(c(0, 0, 1), c(0, 1, 1), c(1, 1, 1), c(1, 0, 1)),
    ...q(c(0, 0, 0), c(0, 1, 0), c(0, 1, 1), c(0, 0, 1)), ...q(c(1, 0, 0), c(1, 0, 1), c(1, 1, 1), c(1, 1, 0)),
  ];
}
export interface MepSystemOut { expressId: number; name: string; longName: string | null; predefinedType: string; members: number; rooms: Record<string, number> }
export interface MepProjection { elements: MepProjected[]; systems: MepSystemOut[] }
export interface FileProjection {
  name: string;
  kind: "site" | "shade";
  /** the turn into the house frame, degrees about Y */
  rotationDeg: number;
  /** THE USER'S EXTRA TURN (2026-09-15, C1): degrees clockwise seen from above, on top of the TrueNorth turn; 0 unless ruled */
  turnDeg: number;
  /** the placement on top of the TrueNorth turn (identity when none) */
  align: FileAlign;
  fileTrueNorth: [number, number] | null;
  terrain: V3[][] | null;
  terrainElements: Array<{ expressId: number; name: string; tris: number; top: number }>;
  /** the elements projected, in the house frame, keyed for the model */
  elements: ProjectedElement[];
  /** shade-file elements inside the house's rooms — left out of the shading, named */
  interior: ProjectedElement[];
  /** a shade file's services inventory; null for a site file */
  mep: MepProjection | null;
  word: string;
}

/** the rooms as the house's own IfcSpace solids: their faces, with a box each for the quick reject; the name is the zone's rule (long name, else name) */
export function roomSolids(spaces: Array<{ faces: Array<{ n: V3; outer: V3[] }>; name?: string }>): Array<RoomSolid & { min: V3; max: V3 }> {
  return spaces.map((sp) => {
    const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
    for (const f of sp.faces) for (const p of f.outer) for (let k = 0; k < 3; k++) { if (p[k]! < min[k]!) min[k] = p[k]!; if (p[k]! > max[k]!) max[k] = p[k]!; }
    return { faces: sp.faces, name: sp.name, min, max };
  }).filter((b) => Number.isFinite(b.min[0]) && b.faces.length >= 4);
}

/** a fixed ray in an odd direction, so it meets no edge or vertex of a house drawn on a grid */
const RAY: V3 = [0.5323, 0.3781, 0.7576];

/** the point is inside the closed solid: an odd number of its faces are crossed by a ray from it */
export function insideSolid(p: V3, solid: RoomSolid & { min?: V3; max?: V3 }): boolean {
  if (solid.min && solid.max && (p[0] < solid.min[0] || p[0] > solid.max[0] || p[1] < solid.min[1] || p[1] > solid.max[1] || p[2] < solid.min[2] || p[2] > solid.max[2])) return false;
  let crossings = 0;
  for (const f of solid.faces) {
    const nd = f.n[0] * RAY[0] + f.n[1] * RAY[1] + f.n[2] * RAY[2];
    if (Math.abs(nd) < 1e-12) continue;
    const r0 = f.outer[0]!;
    const t = (f.n[0] * (r0[0] - p[0]) + f.n[1] * (r0[1] - p[1]) + f.n[2] * (r0[2] - p[2])) / nd;
    if (t <= 1e-9) continue;
    const q: V3 = [p[0] + t * RAY[0], p[1] + t * RAY[1], p[2] + t * RAY[2]];
    // point in polygon in the face's plane: drop the normal's dominant axis
    const ax = Math.abs(f.n[0]), ay = Math.abs(f.n[1]), az = Math.abs(f.n[2]);
    const [u, v]: [0 | 1 | 2, 0 | 1 | 2] = ax >= ay && ax >= az ? [1, 2] : ay >= az ? [0, 2] : [0, 1];
    let inside = false;
    const r = f.outer;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[i]!, b = r[j]!;
      if ((a[v] > q[v]) !== (b[v] > q[v]) && q[u] < ((b[u] - a[u]) * (q[v] - a[v])) / (b[v] - a[v]) + a[u]) inside = !inside;
    }
    if (inside) crossings++;
  }
  return crossings % 2 === 1;
}

/** the triangles' vertex centroid */
export function centroidOf(tris: V3[][]): V3 | null {
  const c: V3 = [0, 0, 0];
  let n = 0;
  for (const t of tris) for (const p of t) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; n++; }
  if (!n) return null;
  return [c[0] / n, c[1] / n, c[2] / n];
}
/** THE ROOM an element lies in: its centroid, or that point pushed a wall thickness along any axis, inside a room
 *  solid — the first such room, by its name; null when it lies in none (outside the house) */
export function roomOf(tris: V3[][], rooms: Array<RoomSolid & { min?: V3; max?: V3 }>, grow = INTERIOR_GROW_M): string | null {
  const c = centroidOf(tris);
  if (!c) return null;
  const probes: V3[] = [c, [c[0] + grow, c[1], c[2]], [c[0] - grow, c[1], c[2]], [c[0], c[1] + grow, c[2]], [c[0], c[1] - grow, c[2]], [c[0], c[1], c[2] + grow], [c[0], c[1], c[2] - grow]];
  for (const p of probes) { const r = rooms.find((room) => insideSolid(p, room)); if (r) return r.name ?? "?"; }
  return null;
}
/** the element is the room's: its centroid, or that point pushed a wall thickness along any axis, lies inside a room solid */
export function insideRooms(tris: V3[][], rooms: Array<RoomSolid & { min?: V3; max?: V3 }>, grow = INTERIOR_GROW_M): boolean {
  return roomOf(tris, rooms, grow) !== null;
}

/** the element's kind as the file names it: the family:type with the instance id dropped */
export const kindName = (name: string): string => name.replace(/:\d+$/, "");

export function projectSiteFile(
  api: WebIFC.IfcAPI, modelID: number,
  opts: { name: string; index: number; houseTrueNorth: [number, number] | null; rooms: Array<RoomSolid & { min?: V3; max?: V3 }>; turnDeg?: number;
    /** the user's placement on top of the TrueNorth turn (siteAlign.ts) — when given, it replaces turnDeg */
    align?: FileAlign },
  /** pre-read geometry (the gate's cache) instead of streaming the file; `mep` holds a shade file's services geometry and facts */
  pre?: { terrain: V3[][]; terrainElements: FileProjection["terrainElements"]; elements: SiteElement[]; fileTrueNorth: [number, number] | null;
    mep?: { geometry: SiteElement[]; meta: Map<number, MepMeta>; systems: MepSystemMeta[] } | null },
): FileProjection {
  const src = pre ? { tris: pre.terrain, elements: pre.terrainElements } : readTerrain(api, modelID);
  const els = pre ? pre.elements : readSiteElements(api, modelID);
  const fileTrueNorth = pre ? pre.fileTrueNorth : readTrueNorth(api, modelID);
  // the user's extra turn (C1): rotateY's positive sense is CLOCKWISE seen from above (the gate measures it on the panels), so a
  // typed "0.65° clockwise" adds +0.65 to the TrueNorth turn
  const align = opts.align && !isIdentity(opts.align) ? opts.align : null;
  const turnDeg = opts.align ? opts.align.deg : (opts.turnDeg ?? 0);
  const northDeg = rotationFromTrueNorth(opts.houseTrueNorth) - rotationFromTrueNorth(fileTrueNorth);
  const rotationDeg = northDeg + turnDeg;
  // the TrueNorth turn about the house's origin, then the user's placement (a move and a turn about a locked pivot) when there is one
  const place = (p: V3): V3 => (align ? alignPoint(Math.abs(northDeg) < 1e-9 ? p : rotateY(p, northDeg), align) : rotateY(p, rotationDeg));
  const turn = (tris: V3[][]): V3[][] => (!align && Math.abs(rotationDeg) < 1e-9 ? tris : tris.map((t) => t.map(place) as V3[]));
  const kind: FileProjection["kind"] = src.tris.length ? "site" : "shade";
  const offset = opts.index * FILE_ID_STRIDE;
  const elements: ProjectedElement[] = [], interior: ProjectedElement[] = [];
  for (const e of els) {
    const tris = turn(e.tris);
    const room = kind === "shade" ? roomOf(tris, opts.rooms) : null;
    const out: ProjectedElement = { expressId: e.expressId + offset, file: opts.name, fileExpressId: e.expressId, name: e.name, ifcClass: e.ifcClass, tris, room };
    if (room !== null) interior.push(out); else elements.push(out);
  }
  // THE SERVICES INVENTORY of a shade file: the proxies above and every distribution class, interior included,
  // each with the facts the file states and the room it lies in; the shading set above is unchanged
  let mep: MepProjection | null = null;
  if (kind === "shade") {
    const geometry = pre ? (pre.mep?.geometry ?? []) : readMepGeometry(api, modelID);
    const all = [...els, ...geometry];
    const read = pre ? (pre.mep ?? { meta: new Map<number, MepMeta>(), systems: [] as MepSystemMeta[] }) : readMepMeta(api, modelID, new Set(all.map((e) => e.expressId)));
    const roomByFileId = new Map<number, string | null>();
    for (const e of [...elements, ...interior]) roomByFileId.set(e.fileExpressId, e.room);
    const mepElements: MepProjected[] = [];
    for (const e of all) {
      const tris = turn(e.tris);
      const room = roomByFileId.has(e.expressId) ? roomByFileId.get(e.expressId)! : roomOf(tris, opts.rooms);
      const meta: MepMeta = read.meta.get(e.expressId) ?? { globalId: null, predefinedType: e.predefinedType ?? null, typeName: null, storey: null, systems: [], uniformat: null, manufacturer: null, model: null, wattageW: null, powerW: null, props: {} };
      if (!meta.predefinedType && e.predefinedType) meta.predefinedType = e.predefinedType;
      const boxed = tris.length > MEP_TRI_CAP;
      mepElements.push({ expressId: e.expressId + offset, file: opts.name, fileExpressId: e.expressId, name: e.name, kind: kindName(e.name), ifcClass: e.ifcClass, tris: boxed ? boxTris(tris) : tris, interior: room !== null, room,
        meta, discipline: disciplineOf(e.ifcClass, e.name, meta.systems), centroid: centroidOf(tris) ?? [0, 0, 0], lod: boxed ? "box" : "mesh", fileTris: tris.length });
    }
    const roomOfId = new Map(mepElements.map((e) => [e.fileExpressId, e.room] as const));
    const systems: MepSystemOut[] = read.systems.map((sy) => {
      const rooms: Record<string, number> = {};
      for (const m of sy.members) { const r = roomOfId.get(m); if (r) rooms[r] = (rooms[r] ?? 0) + 1; }
      return { expressId: sy.expressId + offset, name: sy.name, longName: sy.longName, predefinedType: sy.predefinedType, members: sy.members.length, rooms };
    });
    mep = { elements: mepElements, systems };
  }
  const byKind = new Map<string, number>();
  for (const e of elements) byKind.set(kindName(e.name), (byKind.get(kindName(e.name)) ?? 0) + 1);
  const top = [...byKind].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${n} × ${k}`).join(", ");
  const word = `${kind === "site" ? `${src.tris.length.toLocaleString()} terrain tris` : "no terrain"} · ${elements.length} shading elements${top ? ` (${top}${byKind.size > 3 ? ", …" : ""})` : ""}`
    + (interior.length ? ` · ${interior.length} inside the rooms, left out` : "")
    + ` · turned ${rotationDeg.toFixed(2)}° (its TrueNorth ${fileTrueNorth ? `(${fileTrueNorth[0].toFixed(3)}, ${fileTrueNorth[1].toFixed(3)})` : "unstated"}${turnDeg ? `, plus the user's ${turnDeg > 0 ? "+" : ""}${turnDeg.toFixed(2)}° clockwise${align ? ` about (${align.px.toFixed(3)}, ${align.pz.toFixed(3)})` : ""}` : ""})`
    + (align && (align.dx || align.dy || align.dz) ? ` · moved (${align.dx.toFixed(3)}, ${align.dy.toFixed(3)}, ${align.dz.toFixed(3)}) m` : "")
    + (mep ? ` · services inventory ${mep.elements.length} elements, ${mep.systems.length} systems` : "");
  return { name: opts.name, kind, rotationDeg, turnDeg, align: align ?? (turnDeg ? { ...NO_ALIGN, deg: turnDeg } : NO_ALIGN), fileTrueNorth, terrain: src.tris.length ? turn(src.tris) : null, terrainElements: src.elements, elements, interior, mep, word };
}

/** which files beside the house are projected: the user's word, else the default — `_Site.ifc` yes, any other no */
export function isProjected(name: string, ruling: Record<string, boolean> | undefined): boolean {
  return ruling?.[name] ?? name.toLowerCase() === "_site.ifc";
}

/** the height of an element's centroid above the nearest surface plane under it
 *  in plan (a PV panel over its roof) — the gate's proof that a shade file
 *  turned into the house frame lands where the house is; null when no face
 *  lies under the point */
export function heightAbove(tris: V3[][], faces: Array<{ n: V3; outer: V3[] }>): number | null {
  const c: V3 = [0, 0, 0];
  let n = 0;
  for (const t of tris) for (const p of t) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; n++; }
  if (!n) return null;
  c[0] /= n; c[1] /= n; c[2] /= n;
  let best: number | null = null;
  for (const f of faces) {
    if (Math.abs(f.n[1]) < 0.2) continue;                       // walls are not under anything
    // point in polygon, plan (x, z)
    let inside = false;
    const r = f.outer;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[i]!, b = r[j]!;
      if ((a[2] > c[2]) !== (b[2] > c[2]) && c[0] < ((b[0] - a[0]) * (c[2] - a[2])) / (b[2] - a[2]) + a[0]) inside = !inside;
    }
    if (!inside) continue;
    const d = f.n[0] * r[0]![0] + f.n[1] * r[0]![1] + f.n[2] * r[0]![2];
    const yPlane = (d - f.n[0] * c[0] - f.n[2] * c[2]) / f.n[1];
    const h = c[1] - yPlane;
    if (h >= -0.05 && (best === null || h < best)) best = h;
  }
  return best;
}
