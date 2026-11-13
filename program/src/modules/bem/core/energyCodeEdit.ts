// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
// THE ENERGY CODE'S VALUES, TYPED (user, 2026-10-15: "We should provide the user with an input screen for code related necessary values
// (name, wall/roof/floor values etc)"): what SITE › energy code › Edit values reads and writes — the same tables/energy-codes/*.csv the
// app reads at start, so there is one place the values live. One edition, one climate-zone row at a time; every other row of the files
// is kept as it was. Values are stored as the README states them (U in Btu/h·ft²·°F, R in h·ft²·°F/Btu, depth in ft, thermostat in
// °F); a value without a citation is refused, an empty one is "not entered" (the SHGC's empty is the code's NR). Pure: no I/O.

import { parseCsv } from "../../bom/core/csvRead.js";

export const EDITION_HEADER = ["id", "label", "base", "publisher", "irc_equivalent", "source_url", "read_on", "read_from"] as const;
export const VALUE_HEADER = ["edition", "zone", "factor", "value", "unit", "cite", "note", "source_url"] as const;
export type Rec = Record<string, string>;

/** what each factor is, the unit the file holds it in, and the key its row is read at (the zone's number, or "all") */
export interface FactorDef { factor: string; label: string; unit: string; kind: "u" | "r" | "ft" | "shgc" | "ach" | "f"; at: "zone" | "all"; nullable?: boolean; /** the writer never reads it: a run does not wait on it */ optional?: boolean; tip: string }
export const FACTOR_DEFS: FactorDef[] = [
  { factor: "ceilingU", label: "ceiling / roof U", unit: "Btu/h·ft²·°F", kind: "u", at: "zone", tip: "the ceiling's assembly U-factor — every roof and ceiling the model builds by default is made to it" },
  { factor: "frameWallU", label: "wood frame wall U", unit: "Btu/h·ft²·°F", kind: "u", at: "zone", tip: "the above-grade wall's assembly U-factor" },
  { factor: "massWallU", label: "mass wall U", unit: "Btu/h·ft²·°F", kind: "u", at: "zone", optional: true, tip: "the mass (concrete, masonry) wall's U-factor — recorded; the model does not read it yet" },
  { factor: "basementWallU", label: "basement wall U", unit: "Btu/h·ft²·°F", kind: "u", at: "zone", tip: "the below-grade wall's U-factor" },
  { factor: "crawlWallU", label: "crawl space wall U", unit: "Btu/h·ft²·°F", kind: "u", at: "zone", optional: true, tip: "the crawl space wall's U-factor — recorded; the model does not read it yet" },
  { factor: "floorU", label: "floor U", unit: "Btu/h·ft²·°F", kind: "u", at: "zone", tip: "a floor over unconditioned space or outside air" },
  { factor: "fenestrationU", label: "window U", unit: "Btu/h·ft²·°F", kind: "u", at: "zone", tip: "the window's U-factor (also the default exterior door's)" },
  { factor: "skylightU", label: "skylight U", unit: "Btu/h·ft²·°F", kind: "u", at: "zone", tip: "the skylight's U-factor" },
  { factor: "fenestrationSHGC", label: "window SHGC", unit: "-", kind: "shgc", at: "zone", nullable: true, tip: "the glazed fenestration's solar heat gain coefficient; leave it empty where the code says NR (no requirement)" },
  { factor: "slabR", label: "slab edge R", unit: "h·ft²·°F/Btu", kind: "r", at: "zone", tip: "the slab's edge insulation R-value — 0 where none is required" },
  { factor: "slabDepthFt", label: "slab insulation depth", unit: "ft", kind: "ft", at: "zone", tip: "how deep the slab insulation runs — 0 where none is required" },
  { factor: "ach50", label: "air leakage", unit: "ACH50", kind: "ach", at: "zone", tip: "the air-leakage limit, air changes per hour at 50 Pa — written as the zones' infiltration (ACH50 / 20)" },
  { factor: "heatingSetpointF", label: "thermostat, heating", unit: "°F", kind: "f", at: "all", tip: "the standard reference design's heating thermostat — every zone's until typed on its card in ZONES" },
  { factor: "coolingSetpointF", label: "thermostat, cooling", unit: "°F", kind: "f", at: "all", tip: "the standard reference design's cooling thermostat" },
];

const U_IP = 5.678263, R_IP = 0.1761102, FT = 0.3048;
/** a value as the file holds it → as the user reads it (metric: U W/m²K, R m²K/W, depth m, °C) */
export function shownOf(kind: FactorDef["kind"], v: number, imperial: boolean): number {
  if (imperial) return v;
  return kind === "u" ? v * U_IP : kind === "r" ? v * R_IP : kind === "ft" ? v * FT : kind === "f" ? ((v - 32) * 5) / 9 : v;
}
/** a value as typed → as the file holds it */
export function storedOf(kind: FactorDef["kind"], v: number, imperial: boolean): number {
  if (imperial) return v;
  return kind === "u" ? v / U_IP : kind === "r" ? v / R_IP : kind === "ft" ? v / FT : kind === "f" ? (v * 9) / 5 + 32 : v;
}
export const shownUnit = (d: FactorDef, imperial: boolean): string =>
  imperial ? d.unit : d.kind === "u" ? "W/m²K" : d.kind === "r" ? "m²K/W" : d.kind === "ft" ? "m" : d.kind === "f" ? "°C" : d.unit;
/** the file's own precision kept, the float noise of a round trip through the other units dropped */
export const tidy = (v: number): string => String(Number(v.toPrecision(6)));

export const recsOf = (text: string): Rec[] => {
  if (!text.trim()) return [];
  const c = parseCsv(text);
  return c.rows.filter((r) => r.some((x) => x.trim())).map((r) => Object.fromEntries(c.header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
};
const cell = (s: string): string => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
export const csvOf = (header: readonly string[], recs: Rec[]): string => [header.join(","), ...recs.map((r) => header.map((h) => cell(r[h] ?? "")).join(","))].join("\n") + "\n";

/** one factor's entry in the editor: the value as the file holds it (null: empty), its citation and note */
export interface Entry { value: number | null; cite: string; note: string }
/** the key a factor's row is read at for a zone row ("4" or "all") — ACH50 is read at the zone's own number first, then "all" */
export const keyOf = (d: FactorDef, zoneRow: string): string => (d.at === "all" ? "all" : zoneRow);

/** an edition's entries for one zone row, read from values.csv: the zone's own row first; ACH50 falls back to "all" */
export function entriesOf(values: Rec[], edition: string, zoneRow: string): Record<string, Entry> {
  const out: Record<string, Entry> = {};
  for (const d of FACTOR_DEFS) {
    const keys = d.factor === "ach50" ? [zoneRow, "all"] : [keyOf(d, zoneRow)];
    let r: Rec | undefined;
    for (const k of keys) { r = values.find((x) => x.edition === edition && x.zone === k && x.factor === d.factor); if (r) break; }
    out[d.factor] = r ? { value: r.value === "" ? null : Number(r.value), cite: r.cite ?? "", note: r.note ?? "" } : { value: null, cite: "", note: "" };
  }
  return out;
}

/** what the editor would refuse to save, in words — empty when the entries can be written */
export function entryProblems(entries: Record<string, Entry>): string[] {
  const out: string[] = [];
  for (const d of FACTOR_DEFS) {
    const e = entries[d.factor];
    if (!e) continue;
    if (e.value !== null && !Number.isFinite(e.value)) out.push(`${d.label}: not a number`);
    else if (e.value !== null && e.value < 0) out.push(`${d.label}: below 0`);
    else if (e.value !== null && !e.cite.trim()) out.push(`${d.label}: no citation — say where in the code the value is (the table or section)`);
    else if (e.value === null && d.nullable && e.cite.trim() === "" && e.note.trim() === "") { /* not entered — or NR once cited */ }
  }
  return out;
}

/** the factors a zone row still lacks — the model cannot run until each is entered (SHGC's empty is NR when it is cited) */
export const missingOf = (entries: Record<string, Entry>): string[] =>
  FACTOR_DEFS.filter((d) => { if (d.optional) return false; const e = entries[d.factor]; return !e || (e.value === null && !(d.nullable && e.cite.trim())); }).map((d) => d.label);

/** THE WRITE: the edition's record put in (replacing one of the same id), the zone row's entries put in (each factor at its own key,
 *  replacing the row there; an empty entry removes it — "not entered"), every other row kept, in its order */
export function withEdits(csv: { editions: string; values: string }, edition: Rec, zoneRow: string, entries: Record<string, Entry>): { editions: string; values: string } {
  const eds = recsOf(csv.editions);
  const i = eds.findIndex((e) => e.id === edition.id);
  const rec: Rec = { ...edition, base: edition.base || edition.id || "" };
  if (i >= 0) eds[i] = { ...eds[i], ...rec }; else eds.push(rec);
  const vals = recsOf(csv.values);
  for (const d of FACTOR_DEFS) {
    const e = entries[d.factor];
    if (!e) continue;
    const key = keyOf(d, zoneRow);
    const j = vals.findIndex((x) => x.edition === edition.id && x.zone === key && x.factor === d.factor);
    const keep = e.value !== null || (d.nullable && e.cite.trim() !== "");
    if (!keep) { if (j >= 0) vals.splice(j, 1); continue; }
    const r: Rec = { edition: edition.id!, zone: key, factor: d.factor, value: e.value === null ? "" : tidy(e.value), unit: d.unit, cite: e.cite.trim(), note: e.note.trim(), source_url: j >= 0 ? vals[j]!.source_url ?? "" : edition.source_url ?? "" };
    if (j >= 0) vals[j] = r; else vals.push(r);
  }
  return { editions: csvOf(EDITION_HEADER, eds), values: csvOf(VALUE_HEADER, vals) };
}
