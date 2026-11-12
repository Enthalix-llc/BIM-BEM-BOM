// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// A ROOM'S CFD CHOICES → ITS CASES (2026-11-04): what the user typed in Run CFD… (each terminal's role, flow, size and place,
// each door's state, the setpoints, the mesh and the iterations) turned into the cases written for OpenFOAM. One function, so the
// dialog for one room and the run of several rooms write the same case from the same choices.

import { terminalBox, type CfdOffer, type TerminalOffer } from "./cfdPrep.js";
import { writeCase, type CaseInput, type CaseOut, type DoorMode, type RoomFace, type TerminalRole } from "./cfdCase.js";
import { BED1_CELLS } from "./cfdParallel.js";

type V3 = [number, number, number];
/** a terminal of the MEP file as set up: `label` the user's own name for it (2026-11-10), used in the plan, the case and cfd.db */
/** WHERE TRANSFER AIR COMES FROM (2026-11-11, the user: "Transfer air should be the room temperature from which it transfers
 *  from"): `from` the room, `fromC` a temperature typed per peak in its place — absent, the room's thermostat at that peak */
export interface FromChoice { from?: string | null; fromC?: Partial<Record<"heating" | "cooling", number | null>> }
export interface TermChoice extends FromChoice { use: boolean; role: TerminalRole | ""; cfm: number | null; size: [number, number]; nudge: V3; face?: number; label?: string }
/** a terminal the user ADDED in the setup plan (2026-11-10): on a floor, a ceiling or a wall face of the room, its centre on that
 *  face's plane, its size in the face's plane (width along the face, then height/depth), a role and a flow */
export interface AddedTerminal extends FromChoice { id: string; label: string; host: "floor" | "ceiling" | "wall"; face: number; c: V3; size: [number, number]; role: TerminalRole | ""; cfm: number | null; use: boolean }
export interface DoorChoiceUi { mode: DoorMode; undercutM: number | null }
/** the supply air per peak (2026-11-10): the system's own temperature, with a duct gain (+) or loss (−) on its way to the room,
 *  or — `system: false` — the temperature that delivers the design load at the flow typed */
export interface SupplyChoice { system: boolean; ductK: number }
/** STOP WHEN SETTLED (2026-11-10): off by default; the tolerance on the room's averages, the minimum, and `iterations` the cap */
export interface StopChoice { on: boolean; tolK: number; minIterations: number }
// OFF by default since 2026-11-10 (the user's ruling): Bed 1 settled by it at 6,700 but its speeds and draught were still moving
// (95th-percentile speed 0.39 against 0.25 m/s at a fixed 11,000) — a fixed count until the test also watches the speed tail
export const STOP_CHOICE_DEFAULT: StopChoice = { on: false, tolK: 0.1, minIterations: 4000 };
export interface CfdChoices { stop?: StopChoice; terms: Record<string, TermChoice>; doors: Record<string, DoorChoiceUi>; setpoints: Record<string, number | null>; meshM: number; iterations: number; supply?: Record<string, SupplyChoice>; added?: AddedTerminal[] }

/** an added terminal as the offer's shape, so the one box rule places it (its box centred on its own point) */
export function addedAsOffer(a: AddedTerminal, faces: RoomFace[]): TerminalOffer {
  const f = faces[a.face];
  const axis = f ? ([0, 1, 2] as const).reduce((m, i) => (Math.abs(f.n[i]) > Math.abs(f.n[m]) ? i : m), 0 as 0 | 1 | 2) : 1;
  return { id: -1, name: a.label, globalId: null, system: null, guess: null, bbLo: a.c, bbHi: a.c, face: a.face, axis, plane: f ? f.outer[0]![axis] : a.c[axis]!, size: a.size, offFace: 0, candidates: [] };
}
/** the supply temperature a peak's case is run at, and where it came from — null: the load-balance temperature */
export function supplyUsed(offer: CfdOffer, ch: Partial<CfdChoices>, peak: "heating" | "cooling"): { c: number; from: string; ductK: number } | null {
  const src = offer.supply[peak], sc = ch.supply?.[peak] ?? { system: true, ductK: 0 };
  if (!src || !sc.system) return null;
  return { c: src.c + sc.ductK, from: src.from, ductK: sc.ductK };
}
export interface CfdCase { peak: "heating" | "cooling"; input: CaseInput; out: CaseOut }

/** the temperature the air from another room enters at, for a peak: the one typed, else that room's thermostat at that peak
 *  (its zone's setpoint in the run), else none — and where it came from */
export function fromTemp(offer: CfdOffer, c: FromChoice, peak: "heating" | "cooling"): { c: number | null; why: string } {
  const typed = c.fromC?.[peak];
  if (typed != null && Number.isFinite(typed)) return { c: typed, why: "typed" };
  if (!c.from) return { c: null, why: "no room picked" };
  const r = offer.rooms.find((x) => x.space === c.from);
  if (!r) return { c: null, why: `${c.from} is not a room of the run` };
  const v = peak === "heating" ? r.heatingC : r.coolingC;
  return v != null ? { c: v, why: `${r.space}'s thermostat (zone ${r.zone}, ${peak})` } : { c: null, why: `${r.space} (zone ${r.zone}) has no ${peak} setpoint — type its temperature` };
}

/** the choices the dialog opens on: what was saved, else the file's word (a role guessed from the name, no flow — never assumed) */
export function choicesFor(offer: CfdOffer, saved0: Partial<CfdChoices>): CfdChoices {
  const saved = refaced(offer, saved0);
  return {
    terms: Object.fromEntries(offer.terminals.map((t) => [String(t.id), saved.terms?.[String(t.id)] ?? { use: true, role: t.guess ?? "", cfm: null, size: t.size, nudge: [0, 0, 0] }])),
    doors: Object.fromEntries(offer.doors.map((d) => [String(d.elementId), saved.doors?.[String(d.elementId)] ?? { mode: "sealed", undercutM: null }])),
    setpoints: Object.fromEntries(offer.peaks.map((p) => [p.peak, saved.setpoints?.[p.peak] ?? p.setpointC])),
    meshM: saved.meshM ?? 0.1,
    // a fixed 11,000 (Bed 1's flow settled after about 8,000, 2026-11-03); with the stop on it is the cap
    iterations: saved.iterations ?? 11000,
    stop: saved.stop ?? STOP_CHOICE_DEFAULT,
    supply: saved.supply ?? {},
    added: saved.added ?? [],
  };
}

/** A FACE INDEX IS RE-FOUND EVERY TIME A SETUP IS READ (2026-11-10): the room's faces are its enclosure in idf.db, and their order
 *  moves when the model does — so a saved index is only a hint. A terminal of the file the user had put on a face goes to the face
 *  its own point (its box's centre, moved by its nudge) lies on; an added one to the face under its point, of its own kind (floor,
 *  ceiling, wall). None found: the file's terminal goes back to its nearest face, the added one is switched off — never dropped */
function refaced(offer: CfdOffer, saved: Partial<CfdChoices>): Partial<CfdChoices> {
  const faces = offer.faces;
  const faceAt = (c: V3, host: string | null): number | undefined => {
    let best: number | undefined, bd = Infinity;
    faces.forEach((f, i) => {
      if (host && (f.n[1] < -0.9 ? "floor" : f.n[1] > 0.2 ? "ceiling" : "wall") !== host) return;
      const d = Math.abs((c[0] - f.outer[0]![0]) * f.n[0] + (c[1] - f.outer[0]![1]) * f.n[1] + (c[2] - f.outer[0]![2]) * f.n[2]);
      if (d > 0.6) return;
      // over the face itself (its outline seen along its main axis, holes out), else within 5 cm of its box — the nearer plane first
      const ax = ([0, 1, 2] as const).reduce((m, k) => (Math.abs(f.n[k]) > Math.abs(f.n[m]) ? k : m), 0 as 0 | 1 | 2), [u, v] = [0, 1, 2].filter((k) => k !== ax) as [number, number];
      const inRing = (r: V3[]): boolean => { let inn = false; for (let a = 0, b = r.length - 1; a < r.length; b = a++) { const p = r[a]!, q = r[b]!; if ((p[v]! > c[v]!) !== (q[v]! > c[v]!) && c[u]! < ((q[u]! - p[u]!) * (c[v]! - p[v]!)) / (q[v]! - p[v]!) + p[u]!) inn = !inn; } return inn; };
      const on = inRing(f.outer) && !(f.holes ?? []).some(inRing);
      const near = on || [u, v].every((k) => c[k]! >= Math.min(...f.outer.map((p) => p[k]!)) - 0.05 && c[k]! <= Math.max(...f.outer.map((p) => p[k]!)) + 0.05);
      const score = d + (on ? 0 : 1);
      if (near && score < bd) { bd = score; best = i; }
    });
    return best;
  };
  const byId = new Map(offer.terminals.map((t) => [String(t.id), t]));
  return {
    ...saved,
    terms: saved.terms ? Object.fromEntries(Object.entries(saved.terms).map(([k, t]) => {
      const o = byId.get(k);
      if (t.face == null || !o) return [k, { ...t, face: undefined }];
      return [k, { ...t, face: faceAt([0, 1, 2].map((a) => (o.bbLo[a]! + o.bbHi[a]!) / 2 + (t.nudge?.[a] ?? 0)) as V3, null) }];
    })) : saved.terms,
    added: (saved.added ?? []).map((a) => { const fi = faceAt(a.c, a.host); return fi != null ? { ...a, face: fi } : { ...a, use: false }; }),
  };
}

/** the cases of the peaks picked, each written and checked (its refusals in out.refusals) */
export function casesFrom(offer: CfdOffer, ch: CfdChoices, ctx: { space: string; faces: RoomFace[]; idf: string }, peaks: Record<string, boolean>): CfdCase[] {
  return offer.peaks.filter((p) => peaks[p.peak]).map((p) => {
    const input: CaseInput = {
      space: ctx.space, peak: p.peak, designTime: p.label, outdoorC: p.outdoorC, faces: ctx.faces, idf: ctx.idf, insideC: p.insideC,
      terminals: [
        ...offer.terminals.filter((t) => { const c = ch.terms[String(t.id)]; return c?.use && c.role && (c.role !== "supply" || (c.cfm ?? 0) > 0); }).map((t) => {
          const c = ch.terms[String(t.id)]!;
          return { name: c.label?.trim() || t.name, role: c.role as TerminalRole, cfm: c.cfm ?? 0, from: c.from ?? null, fromC: fromTemp(offer, c, p.peak).c, ...terminalBox(t, c.size, c.nudge, ctx.faces, c.face) };
        }),
        ...(ch.added ?? []).filter((a) => a.use && a.role && (a.role !== "supply" || (a.cfm ?? 0) > 0)).map((a) =>
          ({ name: a.label.trim() || a.id, role: a.role as TerminalRole, cfm: a.cfm ?? 0, from: a.from ?? null, fromC: fromTemp(offer, a, p.peak).c, ...terminalBox(addedAsOffer(a, ctx.faces), a.size, [0, 0, 0], ctx.faces, a.face) })),
      ],
      doors: offer.doors.map((d) => ({ name: d.name, mode: ch.doors[String(d.elementId)]!.mode, undercutM: ch.doors[String(d.elementId)]!.undercutM ?? undefined, quad: d.quad })),
      setpointC: ch.setpoints[p.peak] ?? NaN, loadW: p.loadW, meshM: ch.meshM, iterations: ch.iterations,
      supplyC: supplyUsed(offer, ch, p.peak)?.c ?? null,
      stop: (ch.stop ?? STOP_CHOICE_DEFAULT).on ? { tolK: (ch.stop ?? STOP_CHOICE_DEFAULT).tolK, minIterations: (ch.stop ?? STOP_CHOICE_DEFAULT).minIterations } : null,
    };
    const out = writeCase(input);
    if (!Number.isFinite(input.setpointC)) out.refusals.push(`no ${p.peak} setpoint — type the thermostat's`);
    return { peak: p.peak, input, out };
  });
}

/** the room's volume from its solid (the divergence theorem over its faces) */
export const roomVolume = (faces: RoomFace[]): number =>
  Math.abs(faces.reduce((t, f) => t + (f.outer[0]![0] * f.n[0] + f.outer[0]![1] * f.n[1] + f.outer[0]![2] * f.n[2]) * f.areaM2, 0) / 3);
/** Bed 1's measured mesh: 325,324 cells in 110.47 m³ at 0.1 m — the estimate scales by volume and the mesh size cubed */
const BED1_VOLUME = 110.468;
export const estimateCells = (faces: RoomFace[], meshM: number): number => Math.round(BED1_CELLS * (roomVolume(faces) / BED1_VOLUME) * (0.1 / meshM) ** 3);
