// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// WHAT THE RUN CFD… DIALOG OFFERS for one space, read from the files: the space's design peaks (bem.db's space sizing —
// the hour, the load, the outdoor air), the inside face temperatures at each peak's hour (bem.db surface_dd), the zone's
// thermostat (bem.db zones), the air terminals the MEP file places in the room (idf.db mep_elements, each a box on the
// room face nearest it), and the file's interior doors on the room's faces (idf.db openings). Nothing is chosen here:
// a terminal's role and flow, a door's state, are the user's in the dialog.

import type { Database } from "sql.js";
import polygonClipping from "polygon-clipping";
import { queryResults, queryBemZones, queryDesignSurfaceTemps, querySystems } from "../../bem/core/bemDb.js";
import { parseIdfObjects } from "../../bem/core/idfLib.js";
import { decodeTime } from "../../bem/core/eplusSql.js";
import { queryMepElements } from "../../../core/db.js";
import { queryOpenings } from "../../../core/db.js";
import { idfSurfacesOf, type RoomFace, type TerminalRole } from "./cfdCase.js";
import { roomEnclosure, type Enclosure } from "./cfdEnclosure.js";

type V3 = [number, number, number];

export interface PeakChoice { peak: "heating" | "cooling"; time: number; label: string; hour: number; loadW: number; outdoorC: number | null; setpointC: number | null; insideC: Map<string, number> }
export interface TerminalOffer {
  id: number; name: string; globalId: string | null; system: string | null; guess: TerminalRole | null;
  /** the element's own box from its mesh */
  bbLo: V3; bbHi: V3;
  /** the room face it sits on (index), its axis (0 x, 1 y, 2 z) and the plane's coordinate */
  face: number; axis: 0 | 1 | 2; plane: number;
  /** its size in the face's plane, the two other axes, m — the mesh's extent */
  size: [number, number];
  /** how far the element's centre sits from that face, m (the file's placement) */
  offFace: number;
  /** every room face within 0.6 m of the element, nearest first — the user may put it on another (a misplaced file) */
  candidates: Array<{ face: number; label: string; dist: number }>;
}
export interface DoorOffer { name: string; elementId: number; quad: V3[]; widthM: number; isExternal: boolean | null }
/** the supply air the MECHANICAL SYSTEM states for a peak, and where it says so (2026-11-10) */
export interface SupplySource { c: number; from: string; unit: string | null }
/** WHERE THE FILE DRAWS NO FLOOR UNDER THE ROOM (2026-11-10, the user: "The stair opening disappeared in the cfd model"): the room's
 *  solid is drawn across a stair well, but no floor or ceiling cell of the model lies under that part — the well, read from the file */
export interface FloorOpening { key: string; face: number; y: number; ring: Array<[number, number]>; lo: [number, number]; hi: [number, number]; areaM2: number; below: string[] }
/** THE CFD ROOM (2026-11-10, the user's rulings: "IT IS SUPPOSED TO BE IDF DB MODEL" · "force the space volume to match the
 *  enclosure"): the room's enclosure in idf.db (cfdEnclosure.ts) — `faces` is what the case is written from; `enclosure` what it
 *  measures, and the reason when the room is used as drawn */
/** ANOTHER ROOM OF THE MODEL air may come from (2026-11-11, the user: "Transfer air should be the room temperature from which it
 *  transfers from"): its zone in the run's IDF and that zone's thermostat per peak — null when the zone is not conditioned on that side */
export interface RoomTemp { space: string; zone: string; conditioned: boolean; heatingC: number | null; coolingC: number | null }
export interface CfdOffer { space: string; zone: string | null; faces: RoomFace[]; enclosure: Omit<Enclosure, "faces">; peaks: PeakChoice[]; terminals: TerminalOffer[]; doors: DoorOffer[]; floorOpenings: FloorOpening[]; refusals: string[]; supply: Record<"heating" | "cooling", SupplySource | null>; rooms: RoomTemp[] }

/** THE SUPPLY AIR FROM THE SYSTEM (the user, 2026-11-10: "expected supply temperature … picked up from mechanical system
 *  definition"): read from the run's own IDF for the unit that serves the room's zone — first a supply temperature typed on the
 *  unit's card (written as its Schedule:Constant "<unit> <mode> supply"), then the air loop's Sizing:System design supply
 *  temperatures (the unit as the engine sized it), then the zone's own Sizing:Zone. None of them → null: the case falls back to
 *  the temperature that delivers the design load at the flow typed. */
export function supplyOf(idf: string, bemDb: Database, zone: string | null): Record<"heating" | "cooling", SupplySource | null> {
  const none = { heating: null, cooling: null };
  if (!zone) return none;
  const objs = parseIdfObjects(idf, "in.idf"), Z = zone.toUpperCase();
  const find = (cls: string, name: string) => objs.find((o) => o.cls.toUpperCase() === cls.toUpperCase() && o.name.toUpperCase() === name.toUpperCase());
  const num = (v: string | undefined): number | null => (v != null && v.trim() !== "" && Number.isFinite(+v) ? +v : null);
  const unit = querySystems(bemDb).find((r) => r.zones.some((z) => z.toUpperCase() === Z) && /AirLoopHVAC|HVACTemplate:System|ZoneHVAC/.test(r.kind)) ?? null;
  const out: Record<"heating" | "cooling", SupplySource | null> = { heating: null, cooling: null };
  for (const mode of ["heating", "cooling"] as const) {
    if (unit) {
      const typed = num(find("Schedule:Constant", `${unit.id} ${mode} supply`)?.fields[2]);
      if (typed != null) { out[mode] = { c: typed, from: `typed on ${unit.id}'s card (SYSTEMS)`, unit: unit.id }; continue; }
      const ss = find("Sizing:System", `${unit.id} Air Loop`);
      const v = num(ss?.fields[mode === "cooling" ? 8 : 9]);
      if (v != null) { out[mode] = { c: v, from: `${unit.id} as sized — Sizing:System "${ss!.name}", central ${mode} design supply air temperature`, unit: unit.id }; continue; }
    }
    const sz = find("Sizing:Zone", zone);
    const meth = sz?.fields[mode === "cooling" ? 1 : 4] ?? "";
    const v = /SupplyAirTemperature/i.test(meth) ? num(sz?.fields[mode === "cooling" ? 2 : 5]) : null;
    if (v != null) out[mode] = { c: v, from: `the zone ${zone} as sized — Sizing:Zone, zone ${mode} design supply air temperature`, unit: unit?.id ?? null };
  }
  return out;
}

const hourOf = (t: number): number => { const hh = Math.floor(t / 100) % 100, mm = t % 100; return Math.min(24, hh + (mm > 0 ? 1 : 0)) || 24; };

export function cfdOffer(q: { space: string; faces: RoomFace[]; idf: string; idfDb: Database; bemDb: Database; stamp: string }): CfdOffer {
  const { faces: room, ...enclosure } = roomEnclosure(q.idfDb, q.space, q.faces);
  const p = { ...q, faces: room };
  const refusals: string[] = [];
  const key = p.space.toUpperCase();
  const { base, subs } = idfSurfacesOf(p.idf, p.space);
  const spaceZone = new Map<string, string>();
  for (const x of p.idf.matchAll(/BuildingSurface:Detailed\s*,\s*([^,;]+),\s*[^,;]+,\s*[^,;]+,\s*([^,;]+),\s*([^,;]+),/g)) if (!spaceZone.has(x[3]!.trim())) spaceZone.set(x[3]!.trim(), x[2]!.trim());
  const zoneOf = spaceZone.get(p.space) ?? null;
  if (!base.length) refusals.push(`the run's IDF has no surface in ${p.space} — run the model on BEM › RUN`);
  const bemZones = queryBemZones(p.bemDb);
  const zoneRow = (zn: string) => bemZones.find((r) => r.name.toUpperCase() === zn.toUpperCase() || r.epName.toUpperCase() === zn.toUpperCase());
  const z = zoneOf ? zoneRow(zoneOf) : undefined;
  const rooms: RoomTemp[] = [...spaceZone].filter(([sp]) => sp !== p.space).map(([sp, zn]) => { const r = zoneRow(zn); return { space: sp, zone: zn, conditioned: !!r?.conditioned, heatingC: r?.heatingSetpointC ?? null, coolingC: r?.coolingSetpointC ?? null }; }).sort((a, b) => a.space.localeCompare(b.space));
  const ins = queryDesignSurfaceTemps(p.bemDb, p.stamp, "inside");
  const peaks: PeakChoice[] = [];
  for (const peak of ["heating", "cooling"] as const) {
    const time = queryResults(p.bemDb, p.stamp, "space", `design_${peak}_time`).get(key) ?? 0;
    const loadW = queryResults(p.bemDb, p.stamp, "space", `design_${peak}_w`).get(key) ?? 0;
    if (!time || !(loadW > 0)) continue;
    const hour = hourOf(time), day = ins[peak === "heating" ? "winter" : "summer"];
    peaks.push({
      peak, time, label: decodeTime(time), hour, loadW, outdoorC: queryResults(p.bemDb, p.stamp, "space", `design_${peak}_outdoor_c`).get(key) ?? null,
      setpointC: (peak === "heating" ? z?.heatingSetpointC : z?.coolingSetpointC) ?? null,
      insideC: new Map([...day].map(([k, a]) => [k, a[hour - 1] ?? NaN] as const).filter(([, v]) => Number.isFinite(v))),
    });
  }
  if (!peaks.length) refusals.push(`bem.db holds no design load for the space ${p.space} — run the model on BEM › RUN`);
  if (peaks.length && !peaks.some((x) => x.insideC.size)) refusals.push("the run has no inside face temperatures (runs before 2026-11-04) — run the model again on BEM › RUN");

  // THE TERMINALS: every IfcAirTerminal idf.db puts in this room, on the room face nearest its centre
  const faceAxis = (f: RoomFace): 0 | 1 | 2 => ([0, 1, 2] as const).reduce((m, i) => (Math.abs(f.n[i]) > Math.abs(f.n[m]) ? i : m), 0 as 0 | 1 | 2);
  const terminals: TerminalOffer[] = [];
  for (const e of queryMepElements(p.idfDb, true)) {
    if (e.ifcClass !== "IfcAirTerminal" || e.room !== p.space) continue;
    const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < e.xyz.length; i += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a]!, e.xyz[i + a]!); hi[a] = Math.max(hi[a]!, e.xyz[i + a]!); }
    if (lo[0] === Infinity) { lo[0] = hi[0] = e.cx; lo[1] = hi[1] = e.cy; lo[2] = hi[2] = e.cz; }
    const c: V3 = [e.cx, e.cy, e.cz];
    const cands: Array<{ face: number; label: string; dist: number }> = [];
    p.faces.forEach((f, i) => {
      const fl = [0, 1, 2].map((a) => Math.min(...f.outer.map((q) => q[a]!)) - 0.3), fh = [0, 1, 2].map((a) => Math.max(...f.outer.map((q) => q[a]!)) + 0.3);
      if (![0, 1, 2].every((a) => c[a]! >= fl[a]! && c[a]! <= fh[a]!)) return;
      const d = Math.abs((c[0] - f.outer[0]![0]) * f.n[0] + (c[1] - f.outer[0]![1]) * f.n[1] + (c[2] - f.outer[0]![2]) * f.n[2]);
      if (d <= 0.6) cands.push({ face: i, label: faceLabel(f), dist: d });
    });
    cands.sort((a, b) => a.dist - b.dist);
    if (!cands.length) continue;
    const best = cands[0]!.face, bd = cands[0]!.dist;
    const f = p.faces[best]!, axis = faceAxis(f), [u, v] = [0, 1, 2].filter((a) => a !== axis) as [number, number];
    const sys = e.systems[0];
    const words = `${e.name} ${sys?.name ?? ""} ${sys?.predefinedType ?? ""}`;
    const guess: TerminalRole | null = /exhaust/i.test(words) ? "exhaust" : /return/i.test(words) ? "return" : /supply/i.test(words) ? "supply" : /transfer/i.test(words) ? "transfer" : null;
    terminals.push({ id: e.expressId, name: e.name.split(":").slice(-2).join(":"), globalId: e.globalId, system: sys?.name ?? null, guess, bbLo: lo, bbHi: hi, face: best, axis, plane: f.outer[0]![axis], size: [hi[u]! - lo[u]!, hi[v]! - lo[v]!], offFace: bd, candidates: cands });
  }
  // THE DOORS: the file's doors on a face of the room (parallel, within 0.3 m, the door's centre over the face) that the IDF did
  // not write as this room's own window or door — whatever the file's IsExternal says (Bed 1's hall door is flagged external,
  // 2026-11-04); the flag is shown beside it
  const subCentres = subs.map((x) => [0, 1, 2].map((a) => x.pts.reduce((t, q) => t + q[a]!, 0) / x.pts.length));
  const doors: DoorOffer[] = [];
  for (const o of queryOpenings(p.idfDb)) {
    if (o.kind !== "door") continue;
    const q = o.quad as V3[];
    const c: V3 = [0, 1, 2].map((a) => q.reduce((t, x) => t + x[a]!, 0) / q.length) as V3;
    const n = (() => { const a = q[1]!.map((x, i) => x - q[0]![i]!) as V3, b = q[2]!.map((x, i) => x - q[0]![i]!) as V3; const cr: V3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; const l = Math.hypot(...cr) || 1; return cr.map((x) => x / l) as V3; })();
    const near = p.faces.some((f) => {
      if (Math.abs(f.n[0] * n[0] + f.n[1] * n[1] + f.n[2] * n[2]) < 0.98) return false;
      const d = Math.abs((c[0] - f.outer[0]![0]) * f.n[0] + (c[1] - f.outer[0]![1]) * f.n[1] + (c[2] - f.outer[0]![2]) * f.n[2]);
      if (d > 0.3) return false;
      const ax = faceAxis(f);
      return [0, 1, 2].filter((a) => a !== ax).every((a) => c[a]! >= Math.min(...f.outer.map((x) => x[a]!)) - 0.05 && c[a]! <= Math.max(...f.outer.map((x) => x[a]!)) + 0.05);
    });
    // written by the IDF already (a glass door, an exterior door of the room): its centre within 0.4 m of a subsurface's, across the wall
    const written = subCentres.some((sc) => Math.hypot(sc[0]! - c[0], sc[1]! - c[1], sc[2]! - c[2]) < 0.4);
    if (near && !written) doors.push({ name: o.name.split(":").slice(-2).join(":"), elementId: o.elementId, quad: q, widthM: Math.hypot(q[1]![0] - q[0]![0], q[1]![2] - q[0]![2]), isExternal: o.isExternal });
  }
  return { space: p.space, zone: zoneOf, faces: p.faces, enclosure, peaks, terminals, doors, floorOpenings: floorOpeningsOf(p.faces, p.space, p.idfDb), refusals, supply: supplyOf(p.idf, p.bemDb, zoneOf), rooms };
}

type Ring2 = Array<[number, number]>;
/** a floor of the room is held by the model where a floor or ceiling cell (idf.db surfaces) lies under it within the floor
 *  assembly's depth (0.6 m) — what is left is open: an opening of at least 0.1 m² and 0.2 m across, the rooms whose ceilings lie
 *  under it within 3 m named */
export function floorOpeningsOf(faces: RoomFace[], space: string, idfDb: Database): FloorOpening[] {
  const cells: Array<{ y: number; poly: Ring2[] }> = [];
  const st = idfDb.prepare("SELECT outer, holes FROM surfaces WHERE category IN ('floor','ceiling') AND ABS(ny) > 0.9");
  while (st.step()) {
    const [o, h] = st.get() as [string, string];
    const outer = JSON.parse(o) as V3[], holes = JSON.parse(h || "[]") as V3[][];
    cells.push({ y: outer[0]![1], poly: [outer.map((q) => [q[0], q[2]] as [number, number]), ...holes.map((r) => r.map((q) => [q[0], q[2]] as [number, number]))] });
  }
  st.free();
  // the other rooms' ceilings, to name what lies under
  const ceilings: Array<{ name: string; y: number; poly: Ring2[] }> = [];
  const sq = idfDb.prepare("SELECT COALESCE(s.long_name, s.name, ''), f.outer, f.holes FROM space_faces f JOIN spaces s ON s.id = f.space_id WHERE f.ny > 0.9");
  while (sq.step()) {
    const [nm, o, h] = sq.get() as [string, string, string];
    if (nm === space) continue;
    const outer = JSON.parse(o) as V3[], holes = JSON.parse(h || "[]") as V3[][];
    ceilings.push({ name: nm, y: outer[0]![1], poly: [outer.map((q) => [q[0], q[2]] as [number, number]), ...holes.map((r) => r.map((q) => [q[0], q[2]] as [number, number]))] });
  }
  sq.free();
  const area = (r: Ring2): number => Math.abs(r.reduce((t, a, i) => { const b = r[(i + 1) % r.length]!; return t + a[0] * b[1] - b[0] * a[1]; }, 0) / 2);
  const out: FloorOpening[] = [];
  faces.forEach((f, fi) => {
    if (f.n[1] > -0.9) return;
    const y = f.outer[0]![1];
    const floor: Ring2[] = [f.outer.map((q) => [q[0], q[2]] as [number, number]), ...(f.holes ?? []).map((r) => r.map((q) => [q[0], q[2]] as [number, number]))];
    const under = cells.filter((c) => c.y <= y + 0.05 && c.y >= y - 0.6).map((c) => c.poly);
    let open: Ring2[][];
    try { open = (under.length ? polygonClipping.difference(floor as never, ...(under as never[])) : [floor]) as unknown as Ring2[][]; } catch { return; }
    for (const mp of open) {
      const ring = mp[0]!, a = area(ring) - mp.slice(1).reduce((t, h) => t + area(h), 0);
      const xs = ring.map((q) => q[0]), zs = ring.map((q) => q[1]);
      const lo: [number, number] = [Math.min(...xs), Math.min(...zs)], hi: [number, number] = [Math.max(...xs), Math.max(...zs)];
      if (a < 0.1 || Math.min(hi[0] - lo[0], hi[1] - lo[1]) < 0.2 || a / ((hi[0] - lo[0]) * (hi[1] - lo[1])) < 0.3) continue;
      let below: string[] = [];
      try { below = ceilings.filter((c) => c.y < y + 0.05 && c.y > y - 3 && (polygonClipping.intersection([ring] as never, c.poly as never) as unknown as Ring2[][]).length).map((c) => c.name); } catch { /* named none */ }
      // named by where it is (its centre, to 0.1 m): the room's faces are re-made with the model, their order with them
      out.push({ key: `fo_${Math.round((lo[0] + hi[0]) * 5)}_${Math.round((lo[1] + hi[1]) * 5)}`, face: fi, y, ring, lo, hi, areaM2: a, below: [...new Set(below)] });
    }
  });
  return out;
}

/** a face in words: floor, ceiling, roof, or a wall by its compass on the drawing (north = the model's −z), with its plane */
export function faceLabel(f: RoomFace): string {
  const n = f.n;
  const w = n[1] < -0.9 ? "floor" : n[1] > 0.9 ? "ceiling" : n[1] > 0.2 ? "roof" : `${["north", "east", "south", "west"][Math.round(((Math.atan2(n[0], -n[2]) * 180 / Math.PI + 360) % 360) / 90) % 4]} wall`;
  const a = ([0, 1, 2] as const).reduce((m, i) => (Math.abs(n[i]) > Math.abs(n[m]) ? i : m), 0 as 0 | 1 | 2);
  return `${w} (${["x", "y", "z"][a]} ${f.outer[0]![a].toFixed(2)} m, ${f.areaM2.toFixed(1)} m²)`;
}

/** a terminal's box on its face (the file's nearest, or the one the user picked), from the dialog's choices: its size in the
 *  face's plane, its centre moved by the nudge */
export function terminalBox(t: TerminalOffer, size: [number, number], nudge: V3, faces?: RoomFace[], face?: number): { lo: V3; hi: V3 } {
  const f = face != null && faces ? faces[face] : undefined;
  const axis = f ? ([0, 1, 2] as const).reduce((m, i) => (Math.abs(f.n[i]) > Math.abs(f.n[m]) ? i : m), 0 as 0 | 1 | 2) : t.axis;
  const plane = f ? f.outer[0]![axis] : t.plane;
  const c: V3 = [0, 1, 2].map((a) => (t.bbLo[a]! + t.bbHi[a]!) / 2 + nudge[a]!) as V3;
  const [u, v] = [0, 1, 2].filter((a) => a !== axis) as [number, number];
  const lo: V3 = [0, 0, 0], hi: V3 = [0, 0, 0];
  // ON A SLOPE (2026-11-10: the Great room's roof return was put at the roof face's first corner, 1.1 m under the roof where it
  // sat — no faces in the mesh): the face's own height AT the terminal's point, and the box thick enough to span the slope across it
  let at = plane, half = 0.03, foot: [number, number] = [size[0], size[1]];
  if (f && Math.abs(f.n[axis]) < 0.999) {
    const o = f.outer[0]!, na = Math.abs(f.n[axis]);
    at = o[axis]! - (f.n[u]! * (c[u]! - o[u]!) + f.n[v]! * (c[v]! - o[v]!)) / f.n[axis]!;
    // THE SIZE IS THE GRILLE'S, ON ITS FACE (2026-11-10, the user: "the ceiling return needs to be attached to the ceiling matching
    // its slope"): an 18 in grille on a sloped ceiling covers less than 18 in of plan along the slope — its footprint is projected
    foot = [size[0] * na / Math.hypot(na, f.n[u]!), size[1] * na / Math.hypot(na, f.n[v]!)];
    half = 0.03 + (Math.abs(f.n[u]!) * foot[0] / 2 + Math.abs(f.n[v]!) * foot[1] / 2) / na;
  }
  lo[axis] = at - half; hi[axis] = at + half;
  lo[u] = c[u]! - foot[0] / 2; hi[u] = c[u]! + foot[0] / 2;
  lo[v] = c[v]! - foot[1] / 2; hi[v] = c[v]! + foot[1] / 2;
  return { lo, hi };
}

/** DOES A TERMINAL TOUCH THE ROOM? (2026-11-10: the Great room's entrance register, put on a north-wall face whose run ends 0.2 m
 *  before it, and its roof return, under the slope — both opened onto nothing, the supply's empty opening crashed the solver at
 *  iteration 1). The box's centre, along its own thin axis, must fall inside some face of the room whose surface passes through
 *  the box there. */
export function touchesRoom(faces: RoomFace[], box: { lo: V3; hi: V3 }): boolean {
  const d = [0, 1, 2].map((a) => box.hi[a]! - box.lo[a]!), axis = d.indexOf(Math.min(...d)) as 0 | 1 | 2;
  const [u, v] = [0, 1, 2].filter((a) => a !== axis) as [number, number];
  const c = [0, 1, 2].map((a) => (box.lo[a]! + box.hi[a]!) / 2);
  for (const f of faces) {
    if (Math.abs(f.n[axis]) < 0.3) continue;
    // inside the face's outline seen along the axis
    let inside = false;
    for (let i = 0, j = f.outer.length - 1; i < f.outer.length; j = i++) {
      const a = f.outer[i]!, b = f.outer[j]!;
      if ((a[v]! > c[v]!) !== (b[v]! > c[v]!) && c[u]! < ((b[u]! - a[u]!) * (c[v]! - a[v]!)) / (b[v]! - a[v]!) + a[u]!) inside = !inside;
    }
    if (!inside) continue;
    const o = f.outer[0]!, at = o[axis]! - (f.n[u]! * (c[u]! - o[u]!) + f.n[v]! * (c[v]! - o[v]!)) / f.n[axis]!;
    if (at >= box.lo[axis] - 0.005 && at <= box.hi[axis] + 0.005) return true;
  }
  return false;
}

/** the distances from a box on a floor or ceiling to the room's walls, by direction — what "6 in from the wall" is read against */
export function wallClearance(faces: RoomFace[], box: { lo: V3; hi: V3 }): { north: number | null; south: number | null; east: number | null; west: number | null } {
  const out = { north: null as number | null, south: null as number | null, east: null as number | null, west: null as number | null };
  const c = [0, 1, 2].map((a) => (box.lo[a]! + box.hi[a]!) / 2);
  for (const f of faces) {
    if (Math.abs(f.n[1]) > 0.2) continue;
    const ys = f.outer.map((q) => q[1]), zs = f.outer.map((q) => q[2]), xs = f.outer.map((q) => q[0]);
    if (Math.abs(f.n[2]) > 0.9) {
      if (c[0]! < Math.min(...xs) - 0.01 || c[0]! > Math.max(...xs) + 0.01 || box.lo[1] > Math.max(...ys)) continue;
      const pz = f.outer[0]![2];
      // signed: negative when the box reaches past the wall (the file's placement can put a terminal there)
      if (f.n[2] < 0) { const d = box.lo[2] - pz; if (d > -0.5 && (out.north === null || Math.abs(d) < Math.abs(out.north))) out.north = d; }
      if (f.n[2] > 0) { const d = pz - box.hi[2]; if (d > -0.5 && (out.south === null || Math.abs(d) < Math.abs(out.south))) out.south = d; }
    } else if (Math.abs(f.n[0]) > 0.9) {
      if (c[2]! < Math.min(...zs) - 0.01 || c[2]! > Math.max(...zs) + 0.01 || box.lo[1] > Math.max(...ys)) continue;
      const px = f.outer[0]![0];
      if (f.n[0] > 0) { const d = px - box.hi[0]; if (d > -0.5 && (out.east === null || Math.abs(d) < Math.abs(out.east))) out.east = d; }
      if (f.n[0] < 0) { const d = box.lo[0] - px; if (d > -0.5 && (out.west === null || Math.abs(d) < Math.abs(out.west))) out.west = d; }
    }
  }
  return out;
}
