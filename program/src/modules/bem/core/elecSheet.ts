// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE ELECTRICAL SHEET (user, 2026-10-02: "the PV panel system needs to be assembled like the mechanical systems" — "with components
// below the system view, and details of the components shown in right column"; the chain ruled the same day: Array → Inverter →
// Load center → Utility; the panel count edited by PICKING panels). The sheet is the MECHANICAL sheet's own canvas, bench and
// column; what differs is its cards and its connectors. A card is one EnergyPlus object, as on MECHANICAL — but these objects are
// joined by NAMING one another (a load center names its generator list and its inverter), not by nodes, so the schema has no node
// field to read a connector from: the connectors are STATED here, one line per card, direct current from an array to an inverter,
// alternating current from the inverter to a load center and from the load center to the utility. The compile reads the lines into
// the load centers the writer emits; what the engine cannot take is refused and named on the card.

import { type Assembly, type AsmNode, addNode, addEdge, patchNode } from "./assembly.js";
import type { EpSchema } from "./epSchema.js";
import type { Catalogue, CatEntry, CatPort } from "./epCatalogue.js";
import type { SystemFields } from "./bemDb.js";
import type { PvPanel } from "./pvArrays.js";

export const ELEC_CLASS = { array: "Generator:PVWatts", inverter: "ElectricLoadCenter:Inverter:PVWatts", centre: "ElectricLoadCenter:Distribution", meter: "Meter:Custom", utility: "Output:Meter" } as const;
/** the bench's shelves for the sheet, outside in: what generates, what converts, what distributes */
export const ELEC_SHELVES = ["GENERATION", "INVERTERS", "DISTRIBUTION"];
const P = (key: string, medium: "dc" | "ac", dir: "in" | "out", label: string): CatPort => ({ key, medium, dir, label });
const SPECS: Array<{ cls: string; shelf: string; label: string; sub: string; ports: CatPort[] }> = [
  { cls: ELEC_CLASS.array, shelf: "GENERATION", label: "PV array", sub: "the panels it holds (ticked in the column, read from the projected files) — one Generator:PVWatts per panel on its own top face, the module, mounting and losses the array's", ports: [P("dc-out", "dc", "out", "DC")] },
  { cls: ELEC_CLASS.inverter, shelf: "INVERTERS", label: "Inverter (PVWatts)", sub: "turns the arrays' DC to AC: its efficiency and the DC-to-AC ratio — microinverters on every panel are written as one, their shared efficiency", ports: [P("dc-in", "dc", "in", "DC"), P("ac-out", "ac", "out", "AC")] },
  { cls: ELEC_CLASS.centre, shelf: "DISTRIBUTION", label: "Load center", sub: "the panel: the zones dragged onto it (their loads and the units serving them) and the inverter that feeds it, if any — ElectricLoadCenter:Distribution when PV feeds it", ports: [P("ac-in", "ac", "in", "AC"), P("grid-out", "ac", "out", "Grid")] },
  { cls: ELEC_CLASS.meter, shelf: "DISTRIBUTION", label: "Meter", sub: "a revenue meter: the loads of the zones on the load centers wired to it — Meter:Custom, reported by month, day and hour", ports: [P("grid-in", "ac", "in", "Grid"), P("grid-out", "ac", "out", "Grid")] },
  { cls: ELEC_CLASS.utility, shelf: "DISTRIBUTION", label: "Utility", sub: "the service: what the building buys from the grid — and, with PV, what it sends back and the net; net metering is the tariff's, in BOM › UTILITY", ports: [P("grid-in", "ac", "in", "Grid")] },
];

/** the sheet's catalogue: the five cards, their connectors stated (the canvas and the bench read it as they read MECHANICAL's) */
export function readElecCatalogue(schema: EpSchema | null): Catalogue {
  const entries = new Map<string, CatEntry>(), missing: string[] = [];
  for (const s of SPECS) {
    const c = schema?.classOf(s.cls) ?? null;
    if (schema && !c) missing.push(s.cls);
    entries.set(s.cls, { cls: s.cls, group: c?.group ?? "", tier: "component", shelf: s.shelf, label: s.label, sub: s.sub, ports: s.ports, unread: [], zoneAttached: false, accepts: {} });
  }
  return {
    entries, missing, census: `${entries.size} electrical cards${missing.length ? ` · NOT IN THE SCHEMA ${missing.join(", ")}` : ""}`,
    of: (cls) => entries.get(cls) ?? null,
    byShelf: (shelf) => [...entries.values()].filter((e) => e.shelf === shelf),
  };
}

/** the panels an array card holds: express ids, kept in its fields as one list */
export const PANELS_FIELD = "panels";
export const panelsOf = (n: AsmNode): number[] => String(n.fields?.[PANELS_FIELD] ?? "").split(",").map((x) => Number(x.trim())).filter((x) => Number.isInteger(x) && x > 0);
export function withPanels(asm: Assembly, id: string, panels: number[]): Assembly {
  return patchNode(asm, id, (n) => { const f: SystemFields = { ...(n.fields ?? {}) }; if (panels.length) f[PANELS_FIELD] = [...new Set(panels)].sort((a, b) => a - b).join(","); else delete f[PANELS_FIELD]; return { ...n, fields: f }; });
}

/** THE ZONES ON A LOAD CENTER (user, 2026-10-23: "Dragging a zone space to a load center on the Electrical System view should assign
 *  that zone to the load center"): the model's zone names, kept in its fields as one list ("|" between — a zone name may hold a comma) */
export const ZONES_FIELD = "zones";
export const zonesOn = (n: AsmNode): string[] => String(n.fields?.[ZONES_FIELD] ?? "").split("|").map((x) => x.trim()).filter(Boolean);
export function withZones(asm: Assembly, id: string, zones: string[]): Assembly {
  return patchNode(asm, id, (n) => { const f: SystemFields = { ...(n.fields ?? {}) }; const z = [...new Set(zones)]; if (z.length) f[ZONES_FIELD] = z.join("|"); else delete f[ZONES_FIELD]; return { ...n, fields: f }; });
}
/** a zone onto a load center: off any other it was on (a zone is on one), the words for what moved */
export function zoneOnto(asm: Assembly, id: string, zone: string): { asm: Assembly; note: string } {
  let a = asm, from: string | null = null;
  for (const x of asm.nodes.filter((y) => y.cls === ELEC_CLASS.centre && y.id !== id)) if (zonesOn(x).includes(zone)) { from = nameOf(x); a = withZones(a, x.id, zonesOn(x).filter((z) => z !== zone)); }
  const n = a.nodes.find((x) => x.id === id)!;
  if (zonesOn(n).includes(zone)) return { asm: a, note: `${zone} is already on ${nameOf(n)}` };
  a = withZones(a, id, [...zonesOn(n), zone]);
  return { asm: a, note: from ? `${zone} moved from ${from} to ${nameOf(n)}` : `${zone} is on ${nameOf(n)}` };
}

export interface ElecArray { node: string; name: string; panels: number[]; fields: SystemFields }
export interface ElecCentre { node: string; name: string; inverter: { node: string; name: string; fields: SystemFields }; arrays: ElecArray[]; utility: string | null }
/** a METER (user, 2026-10-23: "assign each load center to a meter (with label) … multiple load centers to one meter"): the zones of the
 *  load centers whose Grid runs to it */
export interface ElecMeter { node: string; name: string; centres: string[]; zones: string[] }
export interface ElecCompiled { centres: ElecCentre[]; meters: ElecMeter[]; arrayCards: number; refusals: Array<{ node: string; text: string }>; cautions: Array<{ node: string; text: string }>;
  /** panel → the array card that holds it (the first; a second holder is refused) */
  owner: Map<number, string> }

const nameOf = (n: AsmNode): string => {
  // a METER is named by both (user's sheet, 2026-10-23: label "Meter", ID "Apt A" read "Apt A" alone on RUN): "Meter Apt A"
  if (n.cls === ELEC_CLASS.meter) { const l = n.label?.trim() || "Meter", id = n.ident?.trim(); return id && id !== l ? `${l} ${id}` : l; }
  return n.ident?.trim() || n.label || SPECS.find((s) => s.cls === n.cls)?.label || n.id;
};
/** OLD WORDS ON A SAVED SHEET (2026-10-23): card labels as the first sheets stored them, read as today's — "Load centre" is "Load
 *  center", "Utility — net metering" is "Utility" (net metering is the tariff's, not the card's) */
const OLD_LABELS: Record<string, string> = { "Load centre": "Load center", "Utility — net metering": "Utility" };
export function withTodaysLabels(asm: Assembly): Assembly;
export function withTodaysLabels(asm: Assembly | undefined): Assembly | undefined;
export function withTodaysLabels(asm: Assembly | undefined): Assembly | undefined {
  if (!asm || !asm.nodes.some((n) => n.label && OLD_LABELS[n.label])) return asm;
  return { ...asm, nodes: asm.nodes.map((n) => (n.label && OLD_LABELS[n.label] ? { ...n, label: OLD_LABELS[n.label] } : n)) };
}
const fieldsOf = (n: AsmNode): SystemFields => { const f: SystemFields = { ...(n.fields ?? {}) }; delete f[PANELS_FIELD]; delete f[ZONES_FIELD]; return f; };

/** the sheet → the load centers the writer emits. `available` = the panels the projected files carry; absent, any id is taken.
 *  `inRoom` = the panels the projection left out because they now lie inside a room (panel → the room): named as such, since a panel
 *  under the roof is a placement to check, not a panel the file lacks (user, 2026-11-03: the panels "slid under the roof with MEP rotation") */
export function compileElectrical(asm: Assembly, available?: ReadonlySet<number>, inRoom?: ReadonlyMap<number, string>): ElecCompiled {
  const refusals: ElecCompiled["refusals"] = [], cautions: ElecCompiled["cautions"] = [];
  const refuse = (n: AsmNode, text: string): void => { refusals.push({ node: n.id, text: `${nameOf(n)} ${text}` }); };
  const of = (cls: string): AsmNode[] => asm.nodes.filter((n) => n.kind === "component" && n.cls === cls);
  const linesFrom = (n: AsmNode, port: string): AsmNode[] => asm.edges.filter((e) => e.from === n.id && e.fromPort === port).map((e) => asm.nodes.find((x) => x.id === e.to)).filter((x): x is AsmNode => !!x);
  const linesInto = (n: AsmNode, port: string): AsmNode[] => asm.edges.filter((e) => e.to === n.id && e.toPort === port).map((e) => asm.nodes.find((x) => x.id === e.from)).filter((x): x is AsmNode => !!x);
  const owner = new Map<number, string>();
  // the arrays: their panels, each held once, and the one inverter their DC runs to
  const goodArrays = new Map<string, { a: ElecArray; inverter: string }>();
  for (const n of of(ELEC_CLASS.array)) {
    const ids = panelsOf(n);
    const missing = available ? ids.filter((x) => !available.has(x)) : [];
    const under = missing.filter((x) => inRoom?.has(x)), absent = missing.filter((x) => !inRoom?.has(x));
    const twice = ids.filter((x) => owner.has(x));
    for (const x of ids) if (!owner.has(x)) owner.set(x, n.id);
    const inv = linesFrom(n, "dc-out").filter((x) => x.cls === ELEC_CLASS.inverter);
    let ok = true;
    if (!ids.length) { refuse(n, "holds no panel — tick its panels in the column"); ok = false; }
    if (under.length) {
      const rooms = [...new Set(under.map((x) => inRoom!.get(x)!))].sort();
      refuse(n, `holds ${under.length} panel${under.length === 1 ? "" : "s"} that now lie${under.length === 1 ? "s" : ""} inside ${rooms.join(", ")} (#${under.slice(0, 4).join(", #")}${under.length > 4 ? " …" : ""}) — the file's placement puts ${under.length === 1 ? "it" : "them"} under the roof: check the roof gap in Edit Alignment, or untick ${under.length === 1 ? "it" : "them"}`); ok = false;
    }
    if (absent.length) { refuse(n, `holds ${absent.length} panel${absent.length === 1 ? "" : "s"} the projected files do not carry (#${absent.slice(0, 4).join(", #")}${absent.length > 4 ? " …" : ""}) — project the file on SITE, or untick them`); ok = false; }
    if (twice.length) { refuse(n, `holds ${twice.length} panel${twice.length === 1 ? "" : "s"} another array already holds (#${twice.slice(0, 4).join(", #")}${twice.length > 4 ? " …" : ""}) — a panel is in one array`); ok = false; }
    if (!inv.length) { refuse(n, "— its DC out runs to no inverter: connect it to an inverter's DC in"); ok = false; }
    if (inv.length > 1) { refuse(n, "— its DC out runs to two inverters: an array feeds one"); ok = false; }
    if (ok) goodArrays.set(n.id, { a: { node: n.id, name: nameOf(n), panels: ids, fields: fieldsOf(n) }, inverter: inv[0]!.id });
  }
  // the inverters: the arrays they take and the one load center their AC runs to
  const goodInverters = new Map<string, { n: AsmNode; arrays: ElecArray[]; centre: string }>();
  for (const n of of(ELEC_CLASS.inverter)) {
    const arrays = [...goodArrays.values()].filter((g) => g.inverter === n.id).map((g) => g.a);
    const fed = linesInto(n, "dc-in").length;
    const centres = linesFrom(n, "ac-out").filter((x) => x.cls === ELEC_CLASS.centre);
    let ok = true;
    if (!fed) { refuse(n, "— no array feeds its DC in"); ok = false; }
    else if (!arrays.length) { refuse(n, "— every array feeding it is refused (see the arrays)"); ok = false; }
    if (!centres.length) { refuse(n, "— its AC out runs to no load center"); ok = false; }
    if (centres.length > 1) { refuse(n, "— its AC out runs to two load centers: an inverter feeds one"); ok = false; }
    if (ok) goodInverters.set(n.id, { n, arrays, centre: centres[0]!.id });
  }
  // the load centers: ONE inverter each (ElectricLoadCenter:Distribution names one), the utility their Grid runs to
  const centres: ElecCentre[] = [];
  const zoneHolder = new Map<string, string>();
  for (const n of of(ELEC_CLASS.centre)) {
    const invs = [...goodInverters.values()].filter((g) => g.centre === n.id);
    const fed = linesInto(n, "ac-in").length;
    const util = linesFrom(n, "grid-out").filter((x) => x.cls === ELEC_CLASS.utility || x.cls === ELEC_CLASS.meter);
    for (const z of zonesOn(n)) { const h = zoneHolder.get(z); if (h) refuse(n, `holds ${z}, which ${h} holds too — a zone is on one load center`); else zoneHolder.set(z, nameOf(n)); }
    // A LOAD CENTER OF LOADS ALONE (2026-10-23): no inverter feeds it — its zones are metered, nothing is written for it as a load center
    if (!fed) {
      if (!zonesOn(n).length) cautions.push({ node: n.id, text: `${nameOf(n)} holds no zone and no inverter feeds it — drag a space from LEVELS · SPACES onto it to put that space's zone on it` });
      else if (!linesFrom(n, "grid-out").some((x) => x.cls === ELEC_CLASS.meter)) cautions.push({ node: n.id, text: `${nameOf(n)}'s Grid runs to no Meter — its zones (${zonesOn(n).join(", ")}) count on the building's total alone` });
      continue;
    }
    if (fed > 1) { refuse(n, "— two inverters feed it: EnergyPlus gives a load center ONE inverter (ElectricLoadCenter:Distribution names one) — give the second inverter its own load center"); continue; }
    if (!invs.length) { refuse(n, "— the inverter feeding it is refused (see the inverter)"); continue; }
    if (!util.length) cautions.push({ node: n.id, text: `${nameOf(n)} is not connected to a meter or the utility — what it produces is still metered (the facility meters are the house's), the sheet just does not show where the surplus goes` });
    const inv = invs[0]!;
    centres.push({ node: n.id, name: nameOf(n), inverter: { node: inv.n.id, name: nameOf(inv.n), fields: fieldsOf(inv.n) }, arrays: inv.arrays, utility: util[0]?.id ?? null });
  }
  // the meters: the zones of the load centers wired to each
  const meters: ElecMeter[] = [];
  for (const n of of(ELEC_CLASS.meter)) {
    const cs = linesInto(n, "grid-in").filter((x) => x.cls === ELEC_CLASS.centre);
    const zones = [...new Set(cs.flatMap(zonesOn))];
    if (!cs.length) cautions.push({ node: n.id, text: `${nameOf(n)}: no load center's Grid runs to it — it meters nothing` });
    else if (!zones.length) cautions.push({ node: n.id, text: `${nameOf(n)}: its load centers hold no zone — drag spaces onto them` });
    if (!linesFrom(n, "grid-out").some((x) => x.cls === ELEC_CLASS.utility)) cautions.push({ node: n.id, text: `${nameOf(n)} is not connected to the utility — it is still written; the sheet just does not show the service it is on` });
    if (zones.length) meters.push({ node: n.id, name: nameOf(n), centres: cs.map((c) => c.id), zones });
  }
  const utils = of(ELEC_CLASS.utility);
  for (const n of utils.slice(1)) cautions.push({ node: n.id, text: `${nameOf(n)}: the house has one service — the utility is the facility's meters, a second card adds nothing` });
  return { centres, meters, arrayCards: of(ELEC_CLASS.array).length, refusals, cautions, owner };
}

/** the roof faces the panels sit on: one normal within 3° and one plane within 0.3 m — the file's own arrays */
export function panelFaces(panels: PvPanel[]): PvPanel[][] {
  const faces: Array<{ n: [number, number, number]; d: number; ps: PvPanel[] }> = [];
  const dot = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  for (const p of panels) {
    const d = dot(p.poly[0]!, p.normal);
    const f = faces.find((x) => dot(x.n, p.normal) > Math.cos((3 * Math.PI) / 180) && Math.abs(x.d - d) < 0.3);
    if (f) f.ps.push(p); else faces.push({ n: p.normal, d, ps: [p] });
  }
  return faces.map((f) => f.ps).sort((a, b) => b.length - a.length);
}

/** A FIRST SHEET FROM THE FILE: an array per roof face holding its panels, one inverter, one load center, the utility, wired — the
 *  house's one service; `legacy` carries the fields of the PV form this sheet replaces onto its cards (module, mounting, losses on
 *  every array; the inverter's efficiency and ratio) */
export function sheetFromFile(panels: PvPanel[], legacy?: SystemFields): Assembly {
  let asm: Assembly = { nodes: [], edges: [] };
  const pick = (keys: string[]): SystemFields => { const f: SystemFields = {}; for (const k of keys) if (legacy?.[k] !== undefined && legacy[k] !== "") f[k] = legacy[k]!; return f; };
  const faces = panelFaces(panels);
  const add = (cls: string, label: string, x: number, y: number, fields?: SystemFields): string => {
    const r = addNode(asm, { node: "component", cls, label }, x, y); asm = r.asm;
    if (fields && Object.keys(fields).length) asm = patchNode(asm, r.id, (n) => ({ ...n, fields }));
    return r.id;
  };
  const mid = Math.max(0, (faces.length - 1) * 48);
  const inv = add(ELEC_CLASS.inverter, "Inverter", 296, mid, pick(["dc_to_ac_size_ratio", "inverter_efficiency"]));
  const elc = add(ELEC_CLASS.centre, "Load center", 560, mid);
  const util = add(ELEC_CLASS.utility, "Utility", 824, mid);
  faces.forEach((ps, i) => {
    const tilt = ps.reduce((t, p) => t + p.tiltDeg, 0) / ps.length;
    const id = add(ELEC_CLASS.array, `Array ${String.fromCharCode(65 + (i % 26))} · ${ps.length} panel${ps.length === 1 ? "" : "s"} at ${tilt.toFixed(0)}°`, 0, i * 96, pick(["module_type", "array_type", "system_losses"]));
    asm = withPanels(asm, id, ps.map((p) => p.expressId));
    asm = addEdge(asm, id, inv, "dc-out", "dc-in");
  });
  asm = addEdge(asm, inv, elc, "ac-out", "ac-in");
  asm = addEdge(asm, elc, util, "grid-out", "grid-in");
  return asm;
}
