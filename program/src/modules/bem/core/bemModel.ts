// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE MODEL, WITH ITS SOURCES. What the engine is dressed in is a small set
// of decisions: the envelope (a code default until the library arrives), the
// HVAC (ideal loads), the weather file and its design days, the run period,
// the ground temperatures, the simulation settings, and per zone whether it
// is conditioned, at what setpoints, with how much leakage. Each is the
// file's word, a code default the census names, or the user's ruling from
// the BEM ledger — and the same function builds it for the gate and the app.

import { groundMethodOf } from "./groundCoupling.js";
import { infilRulingOf } from "./infiltration.js";
import { resolvePv, resolvePvSheet, isPvPanel, type PvRulingIn } from "./pvArrays.js";
import { compileElectrical } from "./elecSheet.js";
import { compilePlumbing, type PlumbCompiled } from "./plumbSheet.js";
import { writeDhw } from "./dhwWrite.js";
import { mainsCorrelation } from "./epwRead.js";
import { mergeInputZones, BemInput } from "./bemInput.js";
import type { BemLedger, SiteRuling, ConstructionRuling, LayerPick } from "./bemDb.js";
import { energyCodeIdOf } from "./bemDb.js";
import type { IdfModel, IdfSiteSettings, ZoneOverride, Source, ResolvedConstruction, ResolvedParts, ConsSection, ResolvedSchedule, VoidRulingIn } from "./bemIdf.js";
import { ieccFor } from "./bemIdf.js";
import { retiredPicks, projectHolidayDays, type ScheduleDays } from "./scheduleDays.js";
import { withProjectCopies } from "./scheduleEdit.js";
import { SCHEDULE_ROLES, ROLE_LABELS, ROLE_CONSUMER, CODE_DEFAULT_SCHEDULE, DEFAULT_PROFILE_REF, profileFor, scheduleFileName, type ScheduleRole, type ScheduleRef, type ScheduleProfile } from "./schedules.js";
import { resolveConstruction, stackR, windowNote, layerThickness, layerR, FILMS, type Library, type IdfObject } from "./idfLib.js";
import { resolveMaterialRef } from "./materialsDb.js";
import type { ElementTypeRow } from "../../../core/db.js";
import type { TypeLayer } from "../../../core/ifcStream.js";
import { distanceKm, type WeatherRead } from "./weather.js";
import type { CountyZoneRead } from "../../../core/climateZone.js";
import type { EpSchema } from "./epSchema.js";
import { compiledZones, THERMOSTAT_SIDE_FIELD } from "./assembly.js";
import { resolveSystems } from "./bemSystems.js";
import { isConditioned } from "./bemIdf.js";
import { modelChecks, type CheckRow } from "./modelChecks.js";
import { resolveGains, gainRulingCount, bedroomMarksOf } from "./bemGains.js";
import { resolveTransfers, transfersInWords } from "./transferAir.js";
import { estimateGroundTemps, groundInputsFromAir, ftToM, GEOKISS } from "./groundTemp.js";

export interface BemSetting { key: string; value: string; source: Source }

export interface BuiltModel {
  model: IdfModel;
  /** the input as the model reads it — the zones drawn on the sheet merged (2026-09-10); the caller's object when nothing is held */
  input: BemInput;
  settings: BemSetting[];
  /** ledger zone names that resolve to no zone in this idf.db — reported, never dropped */
  unresolvedZones: string[];
  /** construction rulings that could not be honoured (a type not in this file, a library object not read,
   *  a file U leaving no resistance after the films) — reported, the code default used */
  unresolvedConstructions: string[];
  /** schedule rulings that could not be honoured (a name not in the library, an object the reader cannot read) — reported, the code default used */
  unresolvedSchedules: string[];
  /** system rulings that could not be honoured, in whole or in part (a zone not in the model, a zone claimed twice, a required field unstated, no schema) — reported, never invented (2026-09-10) */
  unresolvedSystems: string[];
  /** gains that could not be written (a schedule the library lacks) — reported, the room left without (2026-09-13) */
  unresolvedGains: string[];
  /** THE CHECKS (2026-10-06): every question asked of the model as built, and its answer — written to bem.db's checks table */
  checks: CheckRow[];
}

/** the CONSTRUCTIONS section a type's class belongs to (2026-09-08); a ceiling covering sits under Roof (the attic floor) */
export const sectionOfClass = (ifcClass: string): ConsSection | null =>
  /wall/i.test(ifcClass) ? "wall" : /slab/i.test(ifcClass) ? "floor" : /roof|covering/i.test(ifcClass) ? "roof" : /window/i.test(ifcClass) ? "window" : /door/i.test(ifcClass) ? "door" : null;
const filmOf = (s: ConsSection): number => (s === "roof" ? FILMS.ceiling : s === "floor" ? FILMS.floor : FILMS.wall);
/** the type's name without the family: "Basic Wall:Exterior - Wood Siding on Wood Stud" → "Exterior - Wood Siding on Wood Stud" */
const labelOf = (name: string | null): string => (name ?? "").replace(/^[^:]*:/, "").trim() || "type";
const noMass = (name: string, rSi: number): IdfObject => ({ cls: "Material:NoMass", name, fields: [name, "MediumRough", rSi.toFixed(3), "0.9", "0.7", "0.7"], file: "built", note: null });
const numF = (s: string | undefined): number => (s !== undefined && s !== "" && Number.isFinite(Number(s)) ? Number(s) : NaN);
const sig = (n: number): string => String(Number(n.toPrecision(6)));

/** THE FRAMING FRACTION a bridged layer's parts default to (2026-09-08), READ from the 2014 Building America House
 *  Simulation Protocols (NREL/TP-5500-60988), Table 3 "Benchmark Framing Factors" — a dataset default; a typed fraction is the user's */
export const FRAMING_DEFAULTS: Record<ConsSection, { fraction: number; source: string }> = {
  wall: { fraction: 0.25, source: "2014 Building America House Simulation Protocols (NREL/TP-5500-60988), Table 3: 2×4 walls at 16 in o.c. 25 %, 2×6 walls at 24 in o.c. 22 % (citing ASHRAE Handbook—Fundamentals 2009, p. 27.3)" },
  roof: { fraction: 0.07, source: "2014 Building America House Simulation Protocols (NREL/TP-5500-60988), Table 3: ceilings below unconditioned space at 24 in o.c. 7 %; a roof insulated at the roof 7 %" },
  floor: { fraction: 0.13, source: "2014 Building America House Simulation Protocols (NREL/TP-5500-60988), Table 3: floors / basement ceilings at 16 in o.c. 13 %" },
  window: { fraction: 0, source: "" },
  door: { fraction: 0, source: "" },
};

/** a part's own R across the LAYER's thickness: a Material's t / k at that thickness, a massless part's stated R */
export const partR = (o: IdfObject, thicknessM: number): number | null => (o.cls === "Material" ? (numF(o.fields[3]) > 0 ? thicknessM / numF(o.fields[3]) : null) : layerR(o));
export interface EffectiveLayer { rEff: number; rParallel: number; rIsothermal: number; kEff: number | null; rho: number | null; cp: number | null; roughness: string; parts: Array<{ name: string; fraction: number; rSi: number }> }
/** ONE LAYER FROM ITS PARTS (2026-09-08) — EnergyPlus takes 1-D layers only, so the stud and the batt between the studs
 *  become one material by a stated method: PARALLEL PATH (ASHRAE HOF Ch. 27, the method for wood framing: the U through
 *  each path with the films, area-weighted; the layer's R is what makes the 1-D stack give that U — it depends on the rest
 *  of the stack, `rOthers`) or ISOTHERMAL PLANES (1 / Σ fᵢ/Rᵢ at the layer's thickness, the lower bound). Mass is
 *  area-weighted over the Material parts; a massless batt adds none. The same function draws the screen and feeds the writer. */
export function effectiveLayer(parts: Array<{ o: IdfObject; fraction: number }>, thicknessM: number, rOthers: number, film: number, method: "parallel-path" | "isothermal-planes" = "parallel-path"): EffectiveLayer | null {
  const rs = parts.map((p) => ({ ...p, r: partR(p.o, thicknessM) }));
  if (!rs.length || rs.some((p) => p.r === null || p.r <= 0 || !(p.fraction > 0))) return null;
  if (Math.abs(rs.reduce((t, p) => t + p.fraction, 0) - 1) > 1e-6) return null;
  const u = rs.reduce((t, p) => t + p.fraction / (rOthers + film + p.r!), 0);
  const rParallel = 1 / u - rOthers - film;
  const rIsothermal = 1 / rs.reduce((t, p) => t + p.fraction / p.r!, 0);
  const rEff = method === "isothermal-planes" ? rIsothermal : rParallel;
  const mats = rs.filter((p) => p.o.cls === "Material").sort((a, b) => b.fraction - a.fraction);
  const rho = mats.length ? mats.reduce((t, p) => t + p.fraction * numF(p.o.fields[4]), 0) : null;
  const cp = rho ? mats.reduce((t, p) => t + p.fraction * numF(p.o.fields[4]) * numF(p.o.fields[5]), 0) / rho : null;
  return { rEff, rParallel, rIsothermal, kEff: rho ? thicknessM / rEff : null, rho, cp, roughness: mats[0]?.o.fields[1] ?? "MediumRough", parts: rs.map((p) => ({ name: p.o.name, fraction: p.fraction, rSi: p.r! })) };
}
const FRAMING_RE = /wood|softwood|lumber|stud|joist|rafter|framing/i;

/** THE STACK AS RULED (2026-09-09; the one order the resolver, the DETAIL view and the options table walk): the file's
 *  layers in the file's order, each joined to its pick by `seq` (a legacy pick claims the first unclaimed layer of its
 *  name); the layers the user ADDED placed after the layer each names (`after`; none = outside everything; an orphan
 *  whose `after` is gone lands last); the layers the user DELETED kept in place but struck. `position` numbers the live
 *  layers from the outside — the number the screen shows, which moves as layers come and go; `seq` is the identity */
export interface RuledLayer { seq: number; file: TypeLayer | null; pick: LayerPick; deleted: boolean; added: boolean; position: number | null }
export function ruledStack(fileLayers: TypeLayer[], picks: LayerPick[] | undefined): RuledLayer[] {
  const ps = picks ?? [];
  const bySeq = new Map<number, LayerPick>();
  for (const l of ps) if (l.seq !== undefined && !l.added) bySeq.set(l.seq, l);
  for (const l of ps) if (l.seq === undefined) { const i = fileLayers.findIndex((x, j) => x.material === l.material && !bySeq.has(j)); if (i >= 0) bySeq.set(i, { ...l, seq: i }); }
  const added = ps.filter((l) => l.added && l.seq !== undefined);
  const out: RuledLayer[] = [], seen = new Set<number>();
  const emit = (r: RuledLayer): void => {
    if (seen.has(r.seq)) return;
    seen.add(r.seq); out.push(r);
    for (const a of added) if (a.after === r.seq) emit({ seq: a.seq!, file: null, pick: a, deleted: false, added: true, position: null });
  };
  for (const a of added) if (a.after === undefined || a.after === null) emit({ seq: a.seq!, file: null, pick: a, deleted: false, added: true, position: null });
  fileLayers.forEach((fl, i) => { const l: LayerPick = bySeq.get(i) ?? { seq: i, material: fl.material }; emit({ seq: i, file: fl, pick: l, deleted: !!l.deleted, added: false, position: null }); });
  for (const a of added) emit({ seq: a.seq!, file: null, pick: a, deleted: false, added: true, position: null });
  let n = 0;
  for (const r of out) if (!r.deleted) r.position = ++n;
  return out;
}
/** the layer as the messages name it: its position from the outside and its name (the file's, or the user's for an added one) */
export const ruledLabel = (rl: RuledLayer): string => `${rl.position ?? "—"} ${rl.file?.material ?? rl.pick.material}${rl.added ? " (added)" : ""}`;

/** "layers" (2026-09-08): the FILE's layers in the file's order, each by its `seq`, given the material picked, the thickness
 *  typed or the file's, the parts sharing its placement, or a typed R; a layer with none of these is dropped and NAMED.
 *  Since 2026-09-09 the stack is the one AS RULED: deleted layers struck and named, added layers in their place */
function resolveLayers(key: string, t: ElementTypeRow, r: ConstructionRuling, lib: Library | null, label: string, section: ConsSection, film: number, unresolved: string[]): Omit<ResolvedConstruction, "key" | "typeId" | "section"> | null {
  const fileLayers = t.layers.filter((l) => !l.part);
  const stack = ruledStack(fileLayers, r.layers);
  interface Entry { seq: number; position: number; material: string; thickness: number; obj?: IdfObject; parts?: Array<{ o: IdfObject; fraction: number }>; method: "parallel-path" | "isothermal-planes" }
  const entries: Entry[] = [], dropped: string[] = [], struck: string[] = [];
  let typed = false;
  /** a reference that resolves to nothing, said as what happened: a material of YOURS (hand, BCL) picked before idf.db kept a
 *  material's values (2026-10-07) is gone with the file that held it — pick it again; anything else is simply not in the library */
const missingRef = (r: { key: string } | { file: string; name: string }): string => ("key" in r && /^(hand|bcl):/.test(r.key)
  ? `your saved material "${r.key}" is gone — it was picked before idf.db kept a material's values and its file was lost; pick this layer's material again`
  : `"${refName(r)}" is not in the library`);
const refName = (ref: { key: string } | { file: string; name: string }): string => ("key" in ref ? ref.key : ref.name);
  for (const rl of stack) {
    const l = rl.pick, name = rl.file?.material ?? l.material, num = rl.position ?? 0;
    if (rl.deleted) { struck.push(`${name}: deleted by the user`); typed = true; continue; }
    if (rl.added) typed = true;
    const thick = l.thicknessM ?? rl.file?.thicknessM ?? 0;
    if (l.thicknessM !== undefined) typed = true;
    const entry: Entry = { seq: rl.seq, position: num, material: name, thickness: thick, method: l.method ?? "parallel-path" };
    if (l.parts && l.parts.length) {
      if (!(thick > 0)) { unresolved.push(`${key}: layer ${num} ${name} has no thickness — a layer with no thickness cannot carry parts`); return null; }
      if (/steel|metal stud/i.test(name)) { unresolved.push(`${key}: layer ${num} ${name} is steel framing — the zone method is not implemented; take the dataset's composite steel-stud wall`); return null; }
      const ps: Array<{ o: IdfObject; fraction: number }> = [];
      for (const p of l.parts) {
        const o = lib ? resolveMaterialRef(lib, p.ref) : null;
        if (!o) { unresolved.push(`${key}: layer ${num} ${name}: ${missingRef(p.ref)}`); return null; }
        ps.push({ o, fraction: p.fraction });
      }
      const sumF = ps.reduce((q, p) => q + p.fraction, 0);
      if (Math.abs(sumF - 1) > 1e-6) { unresolved.push(`${key}: layer ${num} ${name}: the parts' fractions sum to ${sumF.toFixed(2)}, not 1`); return null; }
      const framing = ps.find((p) => FRAMING_RE.test(p.o.name)) ?? ps[0]!;
      if (Math.abs(framing.fraction - FRAMING_DEFAULTS[section].fraction) > 1e-6 || l.method === "isothermal-planes" || ps.some((p) => p.o.file.startsWith("materials:hand"))) typed = true;
      entries.push({ ...entry, parts: ps });
      continue;
    }
    const ref = l.ref ?? (l.library ? { file: l.library.file, name: l.library.name } : null);
    if (ref) {
      const o = lib ? resolveMaterialRef(lib, ref) : null;
      if (!o) { unresolved.push(`${key}: layer ${num} ${name}: ${missingRef(ref)}`); dropped.push(`${num} ${name}: its material is not in the library`); continue; }
      if (o.file.startsWith("materials:hand")) typed = true;
      // a Material takes the LAYER's thickness (the file's, or the typed one) with the source's conductivity, density and specific heat
      if (o.cls === "Material" && thick > 0 && Math.abs((layerThickness(o) ?? 0) - thick) > 1e-4) {
        const nm = `${o.name} @ ${(thick * 1000).toFixed(1)} mm`;
        // 6 decimals (1 µm): at 4 a 7.9 mm siding rounded to 7.9 → 0.3 % on its R, and the DETAIL view and the model read two U's (2026-09-09)
        entries.push({ ...entry, obj: { ...o, name: nm, fields: [nm, o.fields[1]!, thick.toFixed(6), ...o.fields.slice(3)] } });
      } else entries.push({ ...entry, obj: o });
      continue;
    }
    if (l.rSi !== undefined && l.rSi > 0) { entries.push({ ...entry, obj: noMass(`${label} · ${name} R${l.rSi.toFixed(2)}`, l.rSi) }); typed = true; continue; }
    dropped.push(`${num} ${name}${rl.added ? " (added)" : ""}: no material picked`);
  }
  // the bridged layers last: a parallel path's R needs the rest of the stack (another bridged layer counts at its isothermal-planes R)
  const rPlain = entries.reduce((q, e) => q + (e.obj ? layerR(e.obj) ?? 0 : 0), 0);
  const isoOf = new Map<number, number>();
  for (const e of entries) if (e.parts) { const eff = effectiveLayer(e.parts, e.thickness, 0, 0, "isothermal-planes"); if (eff) isoOf.set(e.seq, eff.rIsothermal); }
  const partsOut: ResolvedParts[] = [];
  for (const e of entries) {
    if (!e.parts) continue;
    const rOthers = rPlain + [...isoOf].filter(([q]) => q !== e.seq).reduce((q, [, rr]) => q + rr, 0);
    const eff = effectiveLayer(e.parts, e.thickness, rOthers, film, e.method);
    if (!eff) { unresolved.push(`${key}: layer ${e.position} ${e.material}: a part states no R`); return null; }
    const framing = eff.parts.find((p) => FRAMING_RE.test(p.name)) ?? eff.parts[0]!;
    const nm = `${labelOf(t.name)} · layer ${e.position} · ${e.method === "parallel-path" ? "parallel path" : "isothermal planes"} ${(framing.fraction * 100).toFixed(0)} %`;
    const note = `${e.method === "parallel-path" ? "parallel path (ASHRAE HOF Ch. 27, wood framing)" : "isothermal planes (1/Σ f/R)"}: ${eff.parts.map((p) => `${(p.fraction * 100).toFixed(0)} % ${p.name} R ${p.rSi.toFixed(3)}`).join(" + ")} → R_eff ${eff.rEff.toFixed(3)} m²K/W at ${(e.thickness * 1000).toFixed(1)} mm (parallel path ${eff.rParallel.toFixed(3)}, isothermal planes ${eff.rIsothermal.toFixed(3)}); ${eff.rho !== null ? "mass from the Material parts only" : "every part massless: one NoMass layer"}`;
    e.obj = eff.rho !== null && eff.cp !== null && eff.kEff !== null
      ? { cls: "Material", name: nm, fields: [nm, eff.roughness, sig(e.thickness), sig(eff.kEff), sig(eff.rho), sig(eff.cp), "0.9", "0.7", "0.7"], file: "built", note }
      : { cls: "Material:NoMass", name: nm, fields: [nm, "MediumRough", sig(eff.rEff), "0.9", "0.7", "0.7"], file: "built", note };
    partsOut.push({ seq: e.seq, method: e.method, rEff: eff.rEff, rParallel: eff.rParallel, rIsothermal: eff.rIsothermal, parts: eff.parts });
  }
  const objects = entries.filter((e) => e.obj).map((e) => e.obj!);
  if (!objects.length || objects.length > 10) { unresolved.push(`${key}: ${objects.length ? "more than 10 layers" : "no layer given a material"}`); return null; }
  const ordered = r.outsideFirst === false ? [...objects].reverse() : objects;
  const sr = stackR(ordered);
  return { source: typed ? "user" : "dataset", label: `${label} · the file's layers${struck.length || stack.some((x) => x.added) ? " as ruled" : ""}`, objects: ordered, layers: ordered.map((o) => o.name), uWm2k: sr.unknown.length ? null : 1 / (sr.rSi + film), dropped, struck, parts: partsOut };
}

/** RULING → CONSTRUCTION (2026-09-08): for every ruled type in this idf.db, the objects the writer
 *  emits once, the layer names outside / top first, and the U with its source. Nothing is derived
 *  beyond the engine's own arithmetic: a stated U less the films the engine adds is one NoMass
 *  layer; a dataset construction is its own materials verbatim with U = 1 / (ΣR + films); the
 *  file's layers each take the material the user picked, at the file's thickness. What cannot be
 *  honoured is named and left to the code default. */
export function resolveConstructions(input: BemInput, rulings: Record<string, ConstructionRuling>, lib: Library | null): { map: Map<number, ResolvedConstruction>; unresolved: string[] } {
  const map = new Map<number, ResolvedConstruction>();
  const unresolved: string[] = [];
  const byName = new Map<string, number[]>();
  for (const t of input.types.values()) if (t.name) (byName.get(t.name) ?? byName.set(t.name, []).get(t.name)!).push(t.id);
  // THE GLAZED-DOOR GUARD (the tab review, CONSTRUCTIONS item 2): a door type whose placed openings are glass goes out as a GlassDoor
  // subsurface, and the engine refuses an opaque (NoMass) construction on one — so such a type is glazed for the U tracks exactly
  // as a window is: its stated U cannot become a layer, a typed U becomes a SimpleGlazingSystem
  const glazedTypes = new Set<number>();
  for (const o of input.openings) { if (!o.glazed) continue; const tid = input.elements.get(o.elementId)?.typeId; if (typeof tid === "number") glazedTypes.add(tid); }
  for (const [key, r] of Object.entries(rulings)) {
    if (!r || typeof r !== "object" || !("source" in r) || r.source === "code") continue;
    const ids = byName.get(key);
    if (!ids) { unresolved.push(`${key}: no such type in this file`); continue; }
    for (const typeId of ids) {
      const t = input.types.get(typeId)!;
      const section = sectionOfClass(t.ifcClass);
      if (!section) { unresolved.push(`${key}: ${t.ifcClass} is not an envelope type`); continue; }
      const label = `${section} · ${labelOf(t.name)}`;
      const film = filmOf(section);
      const glazedKind = section === "window" || (section === "door" && glazedTypes.has(typeId));
      let out: ResolvedConstruction | null = null;
      if (r.source === "file") {
        const u = t.uWm2k;
        const rSi = u !== null && u > 0 ? 1 / u - film : null;
        if (glazedKind) { unresolved.push(`${key}: ${section === "door" ? "its openings are glass (a GlassDoor)" : "a window"} — the file's stated U cannot be an opaque layer on a glazed opening; type NFRC values (U, SHGC, VT) instead`); continue; }
        if (rSi === null || rSi < 0.001) { unresolved.push(`${key}: the file states ${u === null ? "no U" : `U ${u.toFixed(2)}, which leaves no resistance after the films`}`); continue; }
        const o = noMass(`${label} · file U`, rSi);
        out = { key, typeId, section, source: "file", label, objects: [o], layers: [o.name], uWm2k: u };
      } else if (r.source === "library") {
        const res = lib && r.library ? resolveConstruction(lib, r.library.name) : null;
        if (!res) { unresolved.push(`${key}: ${lib ? `"${r.library?.name ?? "?"}" is not in the library` : "the library is not read"}`); continue; }
        const note = windowNote(res.cons);
        const sr = stackR(res.layers);
        const uWm2k = note ? note.u : sr.unknown.length ? null : 1 / (sr.rSi + film);
        out = { key, typeId, section, source: "dataset", label: `${label} · ${res.cons.name}`, objects: res.layers, layers: res.layers.map((l) => l.name), uWm2k, shgc: note?.shgc, vt: note?.tvis ?? undefined };
      } else if (r.source === "layers") {
        const res = resolveLayers(key, t, r, lib, label, section, film, unresolved);
        if (!res) continue;
        out = { key, typeId, section, ...res };
      } else if (r.source === "sameAs") { continue; }   // resolved after every other ruling, below
      else if (r.source === "u") {
        if (r.uWm2k === undefined || r.uWm2k <= 0) { unresolved.push(`${key}: no U typed`); continue; }
        if (glazedKind || (section === "door" && r.shgc !== undefined)) {
          // A GLAZING PRODUCT (2026-09-16): the SimpleGlazingSystem is named for it and its provenance rides as the object's
          // note; a VT the rating does not publish is left BLANK — the IDD's own word on the field ("optional"; the engine
          // estimates it) — never the typed track's 0.5. An NFRC rating reads in the dataset colour, the reference list's
          // generic set (derived by Claude Opus, uncertified) in the user's
          const nm = r.product ? `${label} · ${r.product.name}` : `${label} · NFRC`;
          const vt = r.vt ?? (r.product ? undefined : 0.5);
          // a MANUFACTURER's certified rating is a dataset ruling, whichever line it is (2026-09-18: Elevate and Essential)
          const maker = r.product?.source === "marvin" ? "Marvin Elevate" : r.product?.source === "marvin-essential" ? "Marvin Essential" : null;
          const note = r.product ? `${maker ? `NFRC whole-product rating, ${maker}` : "typed by hand — the label's whole-product numbers as its source states them"}: ${r.product.name}${vt === undefined ? " — VT not published, left blank (the engine estimates it)" : ""}` : null;
          const o: IdfObject = { cls: "WindowMaterial:SimpleGlazingSystem", name: nm, fields: [nm, r.uWm2k.toFixed(3), (r.shgc ?? 0.4).toFixed(2), ...(vt === undefined ? [] : [vt.toFixed(2)])], file: "built", note };
          out = { key, typeId, section, source: maker ? "dataset" : "user", label: nm, objects: [o], layers: [nm], uWm2k: r.uWm2k, shgc: r.shgc ?? 0.4, vt };
        } else {
          const rSi = 1 / r.uWm2k - film;
          if (rSi < 0.001) { unresolved.push(`${key}: U ${r.uWm2k.toFixed(2)} leaves no resistance after the films`); continue; }
          const o = noMass(`${label} · U ${r.uWm2k.toFixed(3)}`, rSi);
          out = { key, typeId, section, source: "user", label: o.name, objects: [o], layers: [o.name], uWm2k: r.uWm2k };
        }
      }
      if (!out) continue;
      // the Construction's name in the IDF: the user's, else the type's own name (the namer sanitises)
      out.name = r.name?.trim() || t.name || out.label;
      if (r.frame && (section === "window" || section === "door") && out.source !== "user") {
        const nm = `frame · ${labelOf(t.name)}`;
        out.frame = { cls: "WindowProperty:FrameAndDivider", name: nm, fields: [nm, r.frame.widthM.toFixed(4), "0", "0", r.frame.conductanceWm2k.toFixed(3)], file: "built", note: null };
      }
      map.set(typeId, out);
    }
  }
  // "sameAs" (the user's "select other", 2026-09-08): this type takes another type's construction — the chain followed
  // with a visited set, a target that is not ruled refused (an unruled type already takes the code default, which
  // cannot be aliased), a target in another section refused (the films differ), the copy carrying the target's name
  for (const [key, r] of Object.entries(rulings)) {
    if (!r || typeof r !== "object" || r.source !== "sameAs") continue;
    const ids = byName.get(key);
    if (!ids) { unresolved.push(`${key}: no such type in this file`); continue; }
    // an EMPTY "same as" is no ruling: the screen shows it as the code default and the type takes the code default (the user,
    // 2026-10-07: "THE PIVOT DOOR IS SELECTED TO BE CODE DEFAULT") — a door's "same as" stopped being offered 2026-10-01
    if (!r.sameAs) continue;
    const seen = new Set([key]);
    let target: string | undefined = r.sameAs, cycle = false;
    for (let hops = 0; target && rulings[target]?.source === "sameAs"; hops++) {
      if (seen.has(target) || hops > 10) { cycle = true; break; }
      seen.add(target); target = rulings[target]!.sameAs;
    }
    if (cycle || !target || seen.has(target)) { unresolved.push(`${key}: same as "${r.sameAs}" is a cycle`); continue; }
    const tid = (byName.get(target) ?? []).find((id) => map.has(id));
    if (tid === undefined) { unresolved.push(`${key}: same as "${target}": ${byName.has(target) ? "it is not ruled — an unruled type takes the code default, which cannot be aliased" : "no such type in this file"}`); continue; }
    const src = map.get(tid)!;
    for (const typeId of ids) {
      const t = input.types.get(typeId)!;
      const section = sectionOfClass(t.ifcClass);
      if (section !== src.section) { unresolved.push(`${key}: same as "${target}" is a ${src.section}, not a ${section} — the films differ`); continue; }
      map.set(typeId, { ...src, key, typeId, sameAs: target });
    }
  }
  return { map, unresolved };
}

/** the engine's own defaults where the app states a different code default — shown beside the value */
export const ENGINE_DEFAULTS = { timestep: 6, shadowCalculation: "PolygonClipping", terrain: "Suburbs", solarDistribution: "FullExterior", groundTempC: 18 } as const;
/** the app's code defaults (2026-09-03): pixel counting has no convexity rule for the carve's L-shaped cells */
export const CODE_DEFAULTS = { timestep: 4, shadowCalculation: "PixelCounting", terrain: "Suburbs", solarDistribution: "FullExterior", groundTempC: 18 } as const;
/** the climate zone the IRC envelope assumes when the project states none */
export const ASSUMED_CLIMATE_ZONE = "4A";

export const SHADOW_METHODS = ["PixelCounting", "PolygonClipping"] as const;
export const TERRAINS = ["Country", "Suburbs", "City", "Ocean", "Urban"] as const;
export const SOLAR_DISTRIBUTIONS = ["MinimalShadowing", "FullExterior", "FullInteriorAndExterior", "FullExteriorWithReflections", "FullInteriorAndExteriorWithReflections"] as const;

/** THE SCHEDULES (2026-09-09): each ruled role's object found in the library and read into a profile; a ruling that
 *  names nothing readable is reported and the role keeps the writer's default. A pick carries the dataset's numbers. */
export function resolveSchedules(rulings: BemLedger["schedules"] | undefined, lib: Library | null, days?: ScheduleDays, copies?: Record<string, string>): { map: Map<ScheduleRole, ResolvedSchedule>; unresolved: string[] } {
  const map = new Map<ScheduleRole, ResolvedSchedule>(), unresolved: string[] = [];
  // the project's copies of the user's schedules stand in for the user's file (2026-10-05)
  const L = lib ? withProjectCopies(lib, copies) : null;
  for (const role of SCHEDULE_ROLES) {
    const ref = rulings?.[role];
    if (!ref) continue;
    const p = L ? profileFor(L, ref) : null;
    if (!p) { unresolved.push(`${ROLE_LABELS[role]}: ${L ? `"${ref.name}" is not in ${ref.file || "the library"}` : "the library is not read"}`); continue; }
    if (p.problem) { unresolved.push(`${ROLE_LABELS[role]}: "${p.name}" — ${p.problem}`); continue; }
    map.set(role, { role, profile: p, source: "dataset" });
  }
  // THE RETIRED DAY PARTS (2026-10-02 → 2026-10-05): a ledger still carrying picks is told, never silently run without them
  const retired = retiredPicks(days);
  if (retired.length) unresolved.push(`the retired "assignment by" day-part picks no longer apply (${retired.join("; ")}) — make each role's parts in the editor's buttons (SCHEDULES, the frame under the calendar)`);
  return { map, unresolved };
}

/** `tariff` (2026-10-03): BOM's applied card and PCA — a ruling of the OPERATIONS model the IDF carries, read like the SYSTEMS ones */
export function buildModel(rawInput: BemInput, ledger: BemLedger | null, weather: WeatherRead | null, base: IdfModel, countyZone: CountyZoneRead | null = null, library: Library | null = null, schema: EpSchema | null = null, tariff: IdfModel["tariff"] = null): BuiltModel {
  // THE ZONES DRAWN ON THE SHEET (2026-09-10): the rooms a Zone node holds are ONE zone from here on — the input is merged before
  // the resolver, the writer or the settings read it; the caller keeps the rooms (the level tree, the sheet's compile)
  const drawn = ledger?.systems?.assembly ? compiledZones(ledger.systems.assembly, rawInput.zones.map((z) => z.name)) : null;
  const input = drawn ? mergeInputZones(rawInput, drawn.roomZone) : rawInput;
  const zones: Record<string, ZoneOverride> = {};
  const unresolvedZones: string[] = [];
  const cons = resolveConstructions(input, ledger?.constructions ?? {}, library);
  // A DOOR'S TYPED GLASS SHARE (2026-10-07), by type id — whatever the type's Reference, the code default included
  // THE FILE'S GREEN ROOFS (2026-10-16): a roof type whose OUTERMOST layer is planting or soil, by the material's name
  const VEG = /\b(grass|turf|sedum|vegetat\w*|planting|plants?|soil|growing medium|green roof|live roof|eco ?roof)\b/i;
  const vegetated = new Map<number, { soilM: number; material: string; typeName: string | null }>();
  for (const t of input.types.values()) {
    const top = t.layers.find((l) => !l.part);
    if (!/ROOF|SLAB/i.test(t.ifcClass) || !top || !VEG.test(top.material)) continue;
    vegetated.set(t.id, { soilM: top.thicknessM ?? 0.1, material: top.material, typeName: t.name });
  }
  const doorGlass = new Map<number, number>();
  for (const t of input.types.values()) {
    const g = t.name ? ledger?.constructions?.[t.name]?.glassShare : undefined;
    if (typeof g === "number" && Number.isFinite(g) && /door/i.test(t.ifcClass)) doorGlass.set(t.id, Math.min(1, Math.max(0, g)));
  }
  const sched = resolveSchedules(ledger?.schedules, library, ledger?.scheduleDays, ledger?.scheduleCopies);
  // THE GAINS (2026-09-13): People, Lights and ElectricEquipment per room — the cited residential defaults, the zone's and the
  // room's rulings on top (bemGains.ts); a zone's conditioning as the systems read it
  const gains = resolveGains(input, ledger?.gains, library, { conditioned: (z) => ledger?.zones?.[z]?.conditioned ?? isConditioned(z), schedules: sched.map });
  // TRANSFER AIR THROUGH A VOID (2026-11-11): the paths ruled on ZONES, checked against the rooms as the gains read them (their
  // zone after the sheet's merge, conditioned, occupied) — written as ZoneMixing, a refusal named on ZONES
  const transfers = resolveTransfers(ledger?.gains?.transfers, gains.rooms.map((r) => ({ room: r.room, zone: r.zone, conditioned: r.conditioned, people: r.people.count })));
  // THE SYSTEMS (2026-09-10): the rulings per subsection resolved against the engine's schema; a zone's conditioning
  // by the ZONES ledger, else by its name; local exhaust waits on the SCHEDULES ventilation role
  const sys = resolveSystems(ledger?.systems, input, { schema, datasets: library?.objects ?? [], conditioned: (z) => ledger?.zones?.[z]?.conditioned ?? isConditioned(z), ventilationScheduled: sched.map.has("ventilation"), bedroomMarks: bedroomMarksOf(ledger?.gains),
    zoneFloorM2: gains.rooms.reduce((m, r) => m.set(r.zone, (m.get(r.zone) ?? 0) + r.floorM2), new Map<string, number>()) });
  // the library schedules the systems' fields name by marker (2026-09-14: a schedule dropdown on a component's inputs) — each read into its
  // profile for the writer to emit once; one the library lacks is named as not honoured and the field goes out blank (the engine's default)
  const systemSchedules: Array<{ ref: ScheduleRef; profile: ScheduleProfile }> = [];
  for (const ref of sys.schedules) {
    const p = library ? profileFor(library, ref) : null;
    if (!p) { sys.unresolved.push(`schedule "${ref.name}" (${ref.file || "the library"}) named on a component: ${library ? "not in the library" : "the library is not read"} — the field is left blank (the engine's default)`); continue; }
    if (p.problem) { sys.unresolved.push(`schedule "${p.name}" named on a component: ${p.problem} — the field is left blank`); continue; }
    systemSchedules.push({ ref, profile: p });
  }
  // PLUMBING › THE WATER HEATERS (user, 2026-10-02): the sheet's heaters, each in the room the user placed it, the use the code
  // states — written AHEAD of the other systems (a zone's equipment list names the heat pump), its zone's equipment patched in place
  const plumbAsm = ledger?.systems?.dhw?.assembly;
  let dhw: PlumbCompiled | null = null;
  if (plumbAsm?.nodes.length) {
    const roomZone = new Map<string, string>();
    for (const f of input.faces) {
      if (f.space) roomZone.set(f.spaceIfc ?? f.space, f.space);
      if (f.spaceFacing) roomZone.set(f.spaceFacingIfc ?? f.spaceFacing, f.spaceFacing);
    }
    const edition = ieccFor(countyZone?.zone || undefined, energyCodeIdOf(ledger?.site?.energyCode)).edition;
    dhw = compilePlumbing(plumbAsm, [...roomZone.keys()], edition.base || edition.id, gains.nocc, bedroomMarksOf(ledger?.gains));
    const w = writeDhw(dhw, schema, sys, roomZone, (z) => ledger?.zones?.[z]?.conditioned ?? isConditioned(z), { hotWater: sched.map.get("hot-water")?.profile ?? null, domestic: sched.map.get("domestic-water")?.profile ?? null, mains: mainsCorrelation(weather?.header ?? null) });
    if (w.wellRow) sys.list.unshift(w.wellRow);
    if (w.row) sys.list.unshift(w.row);
    sys.unresolved.push(...w.refused.map((x) => `PLUMBING: ${x}`));
  }
  const sysSettings: BemSetting[] = sys.list.map((s) => ({ key: `system:${s.id}`, value: s.setting, source: s.refused.length && !s.objects.length ? "code-default" : s.source }));
  const schedSettings: BemSetting[] = SCHEDULE_ROLES.map((role) => {
    const r = sched.map.get(role);
    return { key: `schedule:${role}`, value: r ? `${r.profile.name} — ${scheduleFileName(r.profile.file)}${ROLE_CONSUMER[role] ? "" : " · assigned; no object takes it until ZONES rules the gains"}` : CODE_DEFAULT_SCHEDULE[role], source: r ? r.source : "code-default" };
  });
  // one setting per envelope type the file names: what governs it and the U that follows
  // (two door types share one name here: one setting, one ruling, for both)
  const consByKey = new Map<string, BemSetting>();
  for (const t of [...input.types.values()].filter((x) => sectionOfClass(x.ifcClass))) {
    const rc = cons.map.get(t.id);
    const key = `construction:${t.name ?? t.id}`;
    if (!consByKey.has(key) || rc) consByKey.set(key, { key, value: rc ? `${rc.sameAs ? `same as ${rc.sameAs} → ` : ""}${rc.label} · U ${rc.uWm2k?.toFixed(3) ?? "—"}${rc.name && rc.name !== t.name ? ` · named "${rc.name}"` : ""}${rc.dropped?.length ? ` · left out: ${rc.dropped.join("; ")}` : ""}${rc.struck?.length ? ` · struck: ${rc.struck.join("; ")}` : ""}` : "code default", source: rc ? rc.source : "code-default" });
  }
  const consSettings = [...consByKey.values()];
  for (const [name, o] of Object.entries(ledger?.zones ?? {})) {
    if (input.zones.some((z) => z.name === name)) zones[name] = o;
    else unresolvedZones.push(name);
  }
  // a drawn zone's thermostat rides on its node (the ZONES tab and the settings edit the same fields)
  for (const z of drawn?.zones ?? []) {
    const n = ledger?.systems?.assembly?.nodes.find((x) => x.id === z.id);
    const h = n?.fields?.heating_setpoint_c, c = n?.fields?.cooling_setpoint_c;
    // a side switched off on the card (2026-09-14) → the writer puts its setpoint out of reach
    const hOff = n?.fields?.[THERMOSTAT_SIDE_FIELD.heating] === "off", cOff = n?.fields?.[THERMOSTAT_SIDE_FIELD.cooling] === "off";
    // the zone's infiltration (2026-10-08): a constant ACH or the blower-door ACH50, typed on the same card
    const inf = infilRulingOf(n?.fields);
    if (typeof h !== "number" && typeof c !== "number" && !hOff && !cOff && !inf) continue;
    if (!input.zones.some((x) => x.name === z.name)) continue;
    zones[z.name] = { ...(zones[z.name] ?? {}), ...(typeof h === "number" ? { heatingSetpointC: h } : {}), ...(typeof c === "number" ? { coolingSetpointC: c } : {}), ...(hOff ? { heat: false } : {}), ...(cOff ? { cool: false } : {}), ...(inf ? { infiltration: inf } : {}) };
  }
  const r: SiteRuling = ledger?.site ?? {};
  // THE CODE RULED ON SITE (2026-09-29): an edition or a state adoption id; unset = the 2018 IECC
  const codeId = energyCodeIdOf(r.energyCode);
  const h = weather?.header ?? null;
  // ground temperatures: the EPW's depth when ruled, the geokiss estimate at a depth when ruled (2026-09-15), twelve
  // numbers when typed, the code default otherwise — the code default is the IDD's own rule for the object ("a
  // reasonable default value is 2 °C less than the average indoor space temperature"): 20 − 2
  let groundTempsC: number[] = Array(12).fill(CODE_DEFAULTS.groundTempC);
  let groundSource: Source = "code-default", groundLabel = `${CODE_DEFAULTS.groundTempC} °C constant — the IDD's rule: 2 °C less than the average indoor temperature (20 − 2)`;
  const groundInputs = groundInputsFromAir(h?.monthlyDryBulbC, h?.annualDryBulbC);
  if (r.groundTemp && "values" in r.groundTemp && r.groundTemp.values.length === 12) { groundTempsC = r.groundTemp.values; groundSource = "user"; groundLabel = "twelve values, ruled"; }
  else if (r.groundTemp && "from" in r.groundTemp && r.groundTemp.from.startsWith("estimate:")) {
    const ft = Number(r.groundTemp.from.replace(/^estimate:/, ""));
    if (groundInputs && Number.isFinite(ft)) { groundTempsC = estimateGroundTemps(groundInputs, ftToM(ft)); groundSource = "dataset"; groundLabel = `estimated at ${ft} ft — ${GEOKISS.source}; Tavg ${groundInputs.tavgC.toFixed(1)} °C and amplitude ${groundInputs.tampC.toFixed(1)} K from the EPW's air temperatures, the soil and the 15-day phase the sheet's — UNDER INVESTIGATION`; }
    else groundLabel += " (the estimate was ruled but the weather file's rows were not read)";
  }
  else if (r.groundTemp && "from" in r.groundTemp) {
    const depth = Number(r.groundTemp.from.replace(/^epw:/, ""));
    const g = h?.ground.find((x) => Math.abs(x.depthM - depth) < 1e-6);
    if (g) { groundTempsC = g.monthsC; groundSource = "file"; groundLabel = `the EPW's undisturbed ground at ${depth} m — the IDD cautions against it under a conditioned building`; }
  }
  const site: IdfSiteSettings = {
    northAxisDeg: r.northAxisDeg,
    timestep: r.timestep ?? CODE_DEFAULTS.timestep,
    shadowCalculation: r.shadowCalculation ?? CODE_DEFAULTS.shadowCalculation,
    terrain: r.terrain ?? CODE_DEFAULTS.terrain,
    solarDistribution: r.solarDistribution ?? CODE_DEFAULTS.solarDistribution,
    runPeriod: r.runPeriod ?? { begin: [1, 1], end: [12, 31] },
    groundTempsC,
    // the F/C-factor method's ground temperatures: the EPW's own 0.5 m row (the file's word) when it states one
    fcfactorGroundTempsC: h?.ground.find((x) => Math.abs(x.depthM - 0.5) < 1e-6)?.monthsC,
    location: r.location ? { latitude: r.location.latitude, longitude: r.location.longitude, elevationM: r.location.elevationM ?? input.site?.elevationM ?? 0 } : undefined,
    // THE TIME ZONE (2026-09-15, the tab review's SITE item 1): the weather file's stated zone — the file's word, and the
    // engine warns when Site:Location's differs from the EPW's — else the longitude's
    timeZone: h?.timeZone ?? undefined,
  };
  const loc = site.location ?? input.site ?? null;
  const locSrc: Source = r.location ? "user" : "file";
  const src = (ruled: unknown): Source => (ruled !== undefined ? "user" : "code-default");
  const dist = h && h.latitude !== null && h.longitude !== null && loc ? distanceKm(loc, { latitude: h.latitude, longitude: h.longitude }) : null;
  // the void rulings idf.db carries, as the writer reads them (2026-09-18); a void merged into a Zone card is already re-keyed
  const voidRulings = new Map<string, VoidRulingIn>();
  for (const v of input.voidRulings) if (!voidRulings.has(v.space)) voidRulings.set(v.space, { answer: v.answer, grille: v.grille });
  // ELECTRICAL › GENERATION (2026-10-02): the PV panels of the projected files, when PV is ruled on
  // the ELECTRICAL sheet governs once drawn (2026-10-02): its load centers compiled, the panels it holds checked against the files'
  const gen = ledger?.systems?.generation;
  const pvInRoom = new Map((input.mep?.elements ?? []).filter((e) => e.interior && isPvPanel(e.name)).map((e) => [e.expressId, e.room ?? "a room"] as const));
  const elecSheet = gen?.assembly?.nodes.length ? compileElectrical(gen.assembly, new Set(input.siteElements.filter((e) => isPvPanel(e.name)).map((e) => e.expressId)), pvInRoom) : null;
  const pv = elecSheet ? resolvePvSheet(input.siteElements, elecSheet) : resolvePv(input.siteElements, gen?.pv as PvRulingIn | undefined);
  // THE METERS (user, 2026-10-23): each Meter card's zones — the writer sums their loads and the units serving them
  const meters = (elecSheet?.meters ?? []).map((m) => ({ name: m.name, zones: m.zones }));
  const settings: BemSetting[] = [
    { key: "site_latitude", value: loc ? String(loc.latitude) : "", source: locSrc },
    { key: "site_longitude", value: loc ? String(loc.longitude) : "", source: locSrc },
    { key: "site_elevation_m", value: loc ? String(loc.elevationM) : "", source: locSrc },
    { key: "site_elevation_from", value: r.location ? "located on the map" : (input.siteElevationFrom || "the IfcSite"), source: locSrc },
    { key: "site_ref_elevation_m", value: input.siteRefElevationM !== null ? String(input.siteRefElevationM) : "", source: "file" },
    { key: "site_location_from", value: r.location ? (r.location.label ?? "located on the map") : "the IfcSite", source: locSrc },
    { key: "true_north", value: input.trueNorth ? `${input.trueNorth[0]},${input.trueNorth[1]}` : "", source: "file" },
    { key: "north_axis_deg", value: r.northAxisDeg !== undefined ? String(r.northAxisDeg) : "from TrueNorth", source: r.northAxisDeg !== undefined ? "user" : "file" },
    { key: "weather_epw", value: weather?.epw ?? "", source: ledger?.weather?.epw ? "user" : "code-default" },
    { key: "epw_station", value: h ? `${h.station} ${h.stateCountry} WMO ${h.wmo}` : "", source: "file" },
    { key: "epw_position", value: h && h.latitude !== null ? `${h.latitude}, ${h.longitude}` : "", source: "file" },
    { key: "epw_distance_km", value: dist !== null ? dist.toFixed(1) : "", source: "file" },
    { key: "epw_kind", value: h ? `${h.kind}${h.years.length ? ` ${h.years.length} source years ${h.years[0]}–${h.years[h.years.length - 1]}` : ""}` : "", source: "file" },
    { key: "epw_data_period", value: h?.dataPeriod ?? "", source: "file" },
    { key: "design_days", value: weather ? weather.picked.join(" / ") : "placeholders", source: weather ? (r.designDays?.length ? "user" : "file") : "code-default" },
    { key: "design_days_in_ddy", value: weather ? `${weather.days.length} (${weather.invalid} the engine refuses)` : "", source: "file" },
    { key: "climate_zone_ddy", value: weather?.climateZone ?? "not stated", source: "file" },
    // THE ZONE THE CODE DEFAULT READS (2026-09-16): the county's from the location, else zone 4 assumed; the table's row and why
    { key: "climate_zone_code", value: (() => { const t = ieccFor(countyZone?.zone || undefined, codeId); return `${t.zone} → the ${t.edition.label.replace(/ \(.*\)$/, "")} table's row ${t.row}${t.note ? ` (${t.note})` : ""}`; })(), source: countyZone?.zone ? "dataset" : "code-default" },
    { key: "climate_zone_assumed", value: ASSUMED_CLIMATE_ZONE, source: "code-default" },
    // by county (2026-09-07): the IECC assigns zones by county; the site's county from the Census boundaries, its zone from the DOE table
    { key: "climate_zone_county", value: countyZone ? `${countyZone.zone || "no zone in the table"} — ${countyZone.county} County, ${countyZone.state}${countyZone.ba ? ` (${countyZone.ba})` : ""}` : "not placed in any county", source: "dataset" },
    { key: "run_period", value: `${site.runPeriod.begin[0]}/${site.runPeriod.begin[1]} – ${site.runPeriod.end[0]}/${site.runPeriod.end[1]}`, source: src(r.runPeriod) },
    { key: "ground_temp_c", value: groundTempsC.map((v) => v.toFixed(1)).join(" "), source: groundSource },
    { key: "ground_temp_from", value: groundLabel, source: groundSource },
    { key: "ground_estimate_inputs", value: groundInputs ? `Tavg ${groundInputs.tavgC.toFixed(2)} °C · amplitude ${groundInputs.tampC.toFixed(2)} K (the EPW's rows) · phase ${GEOKISS.dayToMin} d · α ${GEOKISS.alphaFt2Day.toFixed(4)} ft²/day (the sheet's soil)` : "no weather rows read", source: groundInputs ? "file" : "code-default" },
    { key: "site_time_zone", value: site.timeZone !== undefined ? String(site.timeZone) : (loc ? `${Math.round(loc.longitude / 15)} (from the longitude — no weather file read)` : ""), source: site.timeZone !== undefined ? "file" : "code-default" },
    // THE ENERGY CODE AND ITS ZONE (2026-09-16): the code chosen on SITE (one today), the zone by county from the location; a zone
    // whose table the app does not carry is said so — zone 4's table is what the code default reads until that zone's is read
    { key: "energy_code", value: (() => { const t = ieccFor(countyZone?.zone || undefined, codeId); return `${t.adoption?.label ?? t.edition.label} · climate zone ${countyZone?.zone || ASSUMED_CLIMATE_ZONE} ${countyZone?.zone ? `by county (${countyZone.county} County, ${countyZone.state})` : "assumed"} · the table's row ${t.row}${t.note ? ` (${t.note})` : ""}${t.fenestrationSHGC === null ? " · no SHGC requirement in this zone — 0.40 kept as a stated default" : ""}`; })(), source: codeId ? "user" : "code-default" },
    { key: "envelope", value: base.envelope, source: "code-default" },
    { key: "constructions_ruled", value: String(cons.map.size), source: cons.map.size ? "user" : "code-default" },
    { key: "ground_coupling", value: groundMethodOf(ledger?.ground), source: ledger?.ground?.method ? "user" : "code-default" },
    ...consSettings,
    { key: "schedules_ruled", value: String(sched.map.size), source: sched.map.size ? "user" : "code-default" },
    ...schedSettings,
    { key: "systems_ruled", value: String(sys.list.length), source: sys.list.length ? "user" : "code-default" },
    ...sysSettings,
    // THE VOID RULINGS (user, 2026-09-18): which plane carries the insulation over each void the app built. An unruled void keeps
    // the DEFAULT is inside the envelope (2026-09-20); `make-a-void` and `shade` answer a geometry question and write nothing
    { key: "voids_ruled", value: voidRulings.size ? [...voidRulings].map(([z, r]) => `${z}: ${r.answer === "roof" ? "insulation at the roof" : r.answer === "ceiling" ? "insulation at the ceiling (a vented attic)" : r.answer === "not-a-space" ? "part of the floor assembly" : r.answer}${r.grille ? " · a transfer grille into conditioned space" : ""}`).join(" · ") : "none ruled — every void is INSIDE the envelope (the project's ruling: all roofs are insulated, so any void under one is interior): the roof over it carries the insulation, the ceiling under it is interior drywall", source: voidRulings.size ? "user" : "code-default" },
    { key: "transfer_air", value: `${transfersInWords(transfers)}${transfers.unresolved.length ? ` · not written: ${transfers.unresolved.length}` : ""}`, source: ledger?.gains?.transfers?.length ? "user" : "code-default" },
    { key: "gains_ruled", value: String(gainRulingCount(ledger?.gains)), source: gainRulingCount(ledger?.gains) ? "user" : "code-default" },
    { key: "gains_people", value: `${gains.rooms.reduce((t, r) => t + r.people.count, 0).toFixed(2)} over ${gains.rooms.filter((r) => r.people.count > 0).length} rooms — ${gains.nocc.toFixed(2)} for ${gains.nbr} bedrooms by name, by floor share of ${gains.cfaM2.toFixed(1)} m² (BAHSP 2014 §4.6 Eq. 23)`, source: gains.rooms.some((r) => r.people.source === "user") ? "user" : "dataset" },
    { key: "gains_lights_w", value: `${gains.rooms.reduce((t, r) => t + r.lights.wattsW, 0).toFixed(0)} W — the file's fixtures ${gains.rooms.filter((r) => r.lights.source === "file").length} rooms, the example's W/m² ${gains.rooms.filter((r) => r.lights.source === "dataset").length}${gains.exterior ? ` · exterior ${gains.exterior.wattsW.toFixed(0)} W (${gains.exterior.stated} fixtures in no room)` : ""}`, source: gains.rooms.some((r) => r.lights.source === "user") ? "user" : gains.rooms.some((r) => r.lights.source === "file") ? "file" : "dataset" },
    { key: "gains_equipment_w", value: `${gains.rooms.reduce((t, r) => t + r.equipment.reduce((u, e) => u + e.wattsW, 0), 0).toFixed(0)} W — ${gains.placed.rule}`, source: gains.rooms.some((r) => r.equipment.some((e) => e.source === "user")) ? "user" : "dataset" },
    { key: "hvac", value: base.idealLoads ? (sys.zoneSystem.size ? `ideal loads on the zones no ruled system takes; ${sys.zoneSystem.size} zone${sys.zoneSystem.size === 1 ? "" : "s"} on ${new Set(sys.zoneSystem.values()).size} ruled system${new Set(sys.zoneSystem.values()).size === 1 ? "" : "s"}` : "ideal loads") : "none", source: sys.zoneSystem.size ? "user" : "code-default" },
    { key: "generation", value: pv?.centres && !pv.centres.length && !pv.refused.length ? "none — the ELECTRICAL sheet draws no PV array" : pv?.centres ? `the ELECTRICAL sheet: ${pv.centres.length} load center${pv.centres.length === 1 ? "" : "s"} · ${pv.centres.reduce((t, c) => t + c.arrays.length, 0)} arrays · ${pv.panels.length} PV panels · ${(pv.dcW / 1000).toFixed(2)} kW DC${pv.centres.map((c) => ` · ${c.name}: ${c.inverter.name} (${c.inverter.efficiency.value}, DC/AC ${c.inverter.dcToAc.value}) ← ${c.arrays.map((a) => `${a.name} ${a.panels.length} × ${a.moduleType.value}`).join(", ")}`).join("")}${pv.refused.length ? ` · not written: ${pv.refused.join("; ")}` : ""}` : pv ? `${pv.panels.length} PV panels · ${(pv.dcW / 1000).toFixed(2)} kW DC · module ${pv.moduleType.value} (${pv.moduleType.why}) · ${pv.arrayType.value} · losses ${pv.systemLosses.value} · inverter ${pv.inverterEfficiency.value}, DC/AC ${pv.dcToAc.value}${pv.refused.length ? ` · not written: ${pv.refused.join("; ")}` : ""}` : "none — no PV until ruled", source: pv?.centres ? "user" : pv ? (([pv.moduleType, pv.arrayType, pv.systemLosses, pv.dcToAc, pv.inverterEfficiency] as Array<{ source: string }>).some((x) => x.source === "user") ? "user" : "file") : "code-default" },
    { key: "meters", value: meters.length ? meters.map((m) => `${m.name}: ${m.zones.join(", ")}`).join(" · ") : "none — the building's own meters alone", source: meters.length ? "user" : "code-default" },
    { key: "timestep", value: String(site.timestep), source: src(r.timestep) },
    { key: "shadow_calculation", value: site.shadowCalculation, source: src(r.shadowCalculation) },
    { key: "terrain", value: site.terrain, source: src(r.terrain) },
    { key: "solar_distribution", value: site.solarDistribution, source: src(r.solarDistribution) },
  ];
  // THE CHECKS (the user, 2026-10-06): the questions asked of every build, answered from what it resolved
  const checks = modelChecks({ drawn, nodes: ledger?.systems?.assembly?.nodes ?? [], sys, gains, conditioned: (z) => ledger?.zones?.[z]?.conditioned ?? isConditioned(z), plumbing: dhw, approvals: ledger?.sideApprovals, pv: elecSheet ? { refused: pv?.refused ?? [], arrays: elecSheet.arrayCards } : null,
    unresolved: [{ where: "ZONES", items: unresolvedZones }, { where: "CONSTRUCTIONS", items: cons.unresolved }, { where: "SCHEDULES", items: sched.unresolved },
      { where: "SYSTEMS", items: sys.unresolved.filter((x) => !x.startsWith("PLUMBING: ")) }, { where: "ZONES › gains", items: gains.unresolved }, { where: "ZONES › transfer air", items: transfers.unresolved }] });
  return { checks, model: { ...base, climateZone: countyZone?.zone || undefined, energyCode: codeId, zones, site, constructions: cons.map, ...(doorGlass.size ? { doorGlass } : {}), ...(vegetated.size ? { vegetated } : {}), ground: ledger?.ground, schedules: sched.map, holidays: projectHolidayDays(ledger).length ? projectHolidayDays(ledger) : undefined, systems: sys, systemSchedules, gains, ...(transfers.mixing.length ? { transfers: transfers.mixing } : {}), shading: input.siteElements, pv, voidRulings, ...(tariff?.card.charges ? { tariff } : {}), ...(meters.length ? { meters } : {}) }, input, settings, unresolvedZones, unresolvedConstructions: cons.unresolved, unresolvedSchedules: sched.unresolved, unresolvedSystems: sys.unresolved, unresolvedGains: [...gains.unresolved, ...transfers.unresolved] };
}

/** the model the user asked for (2026-09-03): the 2018 IRC climate-zone-4
 *  envelope with ideal loads — until the library and the systems arrive */
export const DEFAULT_MODEL: IdfModel = { envelope: "irc2018cz4", idealLoads: true };
