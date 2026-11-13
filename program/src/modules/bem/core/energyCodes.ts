// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
// THE ENERGY CODES (user, 2026-09-29: "we need a table to track all code related factors per issuance"): the residential code's
// values by edition and climate zone, and a state's adoptions with the dates they applied — THE USER'S OWN, read at start from
// tables/energy-codes/ (ENERGY_CODE_FILES; the empty templates and how to fill them: references/energy-codes/). No code table ships with
// the program: a code is its publisher's, free to read (read-only) at codes.iccsafe.org, and the user enters the values their project
// is under. Pure: no I/O. A value without a unit or a citation is refused; an empty value is the code's "NR", never a number invented;
// a factor with no value on record reads NaN and is named in `missing` — the writer refuses a model that needs it.

import { parseCsv } from "../../bom/core/csvRead.js";

/** the user's files, under data/ */
export const ENERGY_CODE_FILES = { editions: "energy-codes/editions.csv", values: "energy-codes/values.csv", adoptions: "energy-codes/state-adoptions.csv", overrides: "energy-codes/state-overrides.csv" } as const;

/** the factors one edition's table states per zone (U in Btu/h·ft²·°F, R in h·ft²·°F/Btu, depth in ft) */
export interface IeccRow { fenestrationU: number; skylightU: number; ceilingU: number; frameWallU: number; massWallU: number; floorU: number; basementWallU: number; crawlWallU: number; fenestrationSHGC: number | null; slabR: number; slabDepthFt: number }
/** the factors an edition states for every zone: the air-leakage limit and the reference thermostat */
export interface CodeShared { ach50: number; heatingSetpointC: number; coolingSetpointC: number }
export type IeccTable = IeccRow & CodeShared & { /** the table row read ("4"; Marine 4 reads "5", 8 reads "7") */ row: string; /** the zone asked for, as given */ zone: string; /** why the row differs from the zone's number, when it does */ note: string | null };
export const ROW_FACTORS = ["fenestrationU", "skylightU", "ceilingU", "frameWallU", "massWallU", "floorU", "basementWallU", "crawlWallU", "fenestrationSHGC", "slabR", "slabDepthFt"] as const;
export const SHARED_FACTORS = ["ach50", "heatingSetpointC", "coolingSetpointC"] as const;
/** a factor that may be the code's "NR" (no requirement) — stated as null */
const NULLABLE = new Set<string>(["fenestrationSHGC"]);
/** factors the model's writer never reads (2026-10-15): a table may leave them out — the DOE/PNNL prototypes state the mass and crawl
 *  space walls only as an insulation R (their crawl space is vented, its wall uninsulated) — and the model still runs */
const NOT_REQUIRED = new Set<string>(["massWallU", "crawlWallU"]);

export interface Edition { id: string; label: string; base: string; publisher: string; ircEquivalent: string; sourceUrl: string; readOn: string; readFrom: string;
  /** shipped with the program (the DOE/PNNL prototype values), not the user's own table */
  shipped?: boolean }
export interface CodeValue { edition: string; zone: string; factor: string; value: number | null; unit: string; cite: string; note: string }
/** `usable` false: the adoption is LISTED (a state-developed code, an edition the table has no values for) and cannot be picked —
 *  `why` says so; `from` empty: the source states no date; `graceUntil`: the previous edition may still be used until then (VA 103.2) */
export interface Adoption { state: string; id: string; label: string; baseEdition: string; amended: boolean; amendments: string; from: string; to: string | null; graceUntil: string | null; scope: string; sourceUrl: string; readOn: string; usable: boolean; why: string | null }
export interface Override { state: string; adoptionId: string; zone: string; factor: string; value: number | null; unit: string; cite: string; note: string }
export interface EnergyCodeData { editions: Edition[]; values: CodeValue[]; adoptions: Adoption[]; overrides: Override[]; problems: string[] }

const recs = (text: string): Record<string, string>[] => {
  const c = parseCsv(text);
  return c.rows.filter((r) => r.some((x) => x.trim())).map((r) => Object.fromEntries(c.header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
};
const num = (s: string): number | null => (s === "" ? null : Number(s));

/** the four files read; every row that cannot be used is named in `problems`, never dropped silently */
export function parseEnergyCodes(csv: { editions: string; values: string; adoptions: string; overrides: string }): EnergyCodeData {
  const problems: string[] = [];
  const editions: Edition[] = recs(csv.editions).map((r) => ({ id: r.id!, label: r.label!, base: r.base || r.id!, publisher: r.publisher ?? "", ircEquivalent: r.irc_equivalent ?? "", sourceUrl: r.source_url ?? "", readOn: r.read_on ?? "", readFrom: r.read_from ?? "" }));
  const ids = new Set(editions.map((e) => e.id));
  const values: CodeValue[] = [];
  recs(csv.values).forEach((r, i) => {
    const v = num(r.value ?? ""), where = `values.csv line ${i + 2} (${r.edition} ${r.zone} ${r.factor})`;
    if (!ids.has(r.edition ?? "")) return void problems.push(`${where}: no such edition`);
    if (!r.unit || !r.cite) return void problems.push(`${where}: no unit or no citation — refused`);
    if (v !== null && !Number.isFinite(v)) return void problems.push(`${where}: "${r.value}" is not a number`);
    if (v === null && !NULLABLE.has(r.factor ?? "")) return void problems.push(`${where}: empty, and this factor has no "NR"`);
    values.push({ edition: r.edition!, zone: r.zone!, factor: r.factor!, value: v, unit: r.unit, cite: r.cite, note: r.note ?? "" });
  });
  const adoptions: Adoption[] = [];
  const isDate = (d: string | undefined): boolean => !d || /^\d{4}-\d{2}-\d{2}$/.test(d);
  recs(csv.adoptions).forEach((r, i) => {
    const where = `state-adoptions.csv line ${i + 2} (${r.state} ${r.adoption_id})`;
    if (!r.state || !r.adoption_id) return void problems.push(`${where}: no state or id`);
    if (!isDate(r.effective_from) || !isDate(r.effective_to) || !isDate(r.grace_until)) return void problems.push(`${where}: dates must be YYYY-MM-DD`);
    if (!r.source_url) return void problems.push(`${where}: no source — refused`);
    const base = r.base_edition ?? "", known = ids.has(base);
    const why = known ? null : !base || base === "none" ? (r.scope === "local" ? "no statewide code — local jurisdictions adopt their own" : "a state-developed code — its values are not in the table") : `${base} — its values are not in the table`;
    adoptions.push({ state: r.state, id: r.adoption_id, label: r.label || r.adoption_id, baseEdition: base, amended: /^y/i.test(r.amended ?? ""), amendments: r.amendments ?? "", from: r.effective_from ?? "", to: r.effective_to || null, graceUntil: r.grace_until || null, scope: r.scope ?? "", sourceUrl: r.source_url, readOn: r.read_on ?? "", usable: known, why });
  });
  const aids = new Set(adoptions.map((a) => a.id));
  const overrides: Override[] = [];
  recs(csv.overrides).forEach((r, i) => {
    const where = `state-overrides.csv line ${i + 2} (${r.adoption_id} ${r.zone} ${r.factor})`;
    if (!aids.has(r.adoption_id ?? "")) return void problems.push(`${where}: no such adoption`);
    if (!r.unit || !r.cite) return void problems.push(`${where}: no unit or no citation — refused`);
    overrides.push({ state: r.state!, adoptionId: r.adoption_id!, zone: r.zone!, factor: r.factor!, value: num(r.value ?? ""), unit: r.unit, cite: r.cite, note: r.note ?? "" });
  });
  return { editions, values, adoptions, overrides, problems };
}

/** the code tables in force — empty until the user's files are read (setEnergyCodeData, at start); a live binding, so a reader that
 *  imports it sees the tables once they are read */
export let ENERGY_CODE_DATA: EnergyCodeData = { editions: [], values: [], adoptions: [], overrides: [], problems: [] };
export function setEnergyCodeData(d: EnergyCodeData): void { ENERGY_CODE_DATA = d; }
/** the edition read when none is ruled — when the user's table has it; otherwise the user's first edition, else SHIPPED_DEFAULT */
export const DEFAULT_EDITION = "IECC-2018";
/** the shipped edition a project with no table of its own reads (2026-10-15): the DOE/PNNL prototype values for the 2021 IECC */
export const SHIPPED_DEFAULT = "PNNL-IECC-2021";
/** THE NOTICE the shipped values carry wherever they are offered or read (user, 2026-10-15: "the notice could be under the energy code") */
export const PNNL_SOURCE_URL = "https://www.energycodes.gov/prototype-building-models";
export const PNNL_NOTICE = "Values from the Residential Prototype Building Models developed by Pacific Northwest National Laboratory (PNNL) for the "
  + "U.S. Department of Energy (DOE), energycodes.gov/prototype-building-models — information DOE publishes as public domain, used here with "
  + "acknowledgement to DOE and PNNL. The wall, ceiling, floor and basement-wall U-factors are those EnergyPlus computed for the prototypes' "
  + "assemblies, built to the edition's insulation R-values; the window, skylight, slab, air-leakage and thermostat values are the requirements "
  + "the prototypes state. A model code as published, not a state's adopted code; BIM-BEM-BOM is not endorsed by DOE or PNNL.";
/** THE SHIPPED VALUES BESIDE THE USER'S (2026-10-15): the user's editions and values first — a row of theirs is read before a shipped
 *  one — then the shipped editions, marked, and their values; a state's adoptions and overrides are only ever the user's */
export function mergeEnergyCodes(user: EnergyCodeData, shipped: EnergyCodeData): EnergyCodeData {
  const ids = new Set(user.editions.map((e) => e.id));
  return {
    editions: [...user.editions, ...shipped.editions.filter((e) => !ids.has(e.id)).map((e) => ({ ...e, shipped: true }))],
    values: [...user.values, ...shipped.values.filter((v) => !ids.has(v.edition))],
    adoptions: user.adoptions, overrides: user.overrides,
    problems: [...user.problems, ...shipped.problems.map((p) => `shipped values: ${p}`)],
  };
}
/** what reads when the user's table holds no edition at all */
export const NO_EDITION: Edition = { id: "none", label: "no energy code on record", base: "none", publisher: "", ircEquivalent: "", sourceUrl: "", readOn: "", readFrom: "" };

/** a code id → the edition whose table it reads and the adoption (a state's) it is, if it is one */
export function resolveCode(id: string | null | undefined, data: EnergyCodeData = ENERGY_CODE_DATA): { edition: Edition; adoption: Adoption | null; note: string | null } {
  const fallback = data.editions.find((e) => e.id === DEFAULT_EDITION) ?? data.editions.find((e) => !e.shipped) ?? data.editions.find((e) => e.id === SHIPPED_DEFAULT) ?? data.editions[0] ?? NO_EDITION;
  const want = id || fallback.id;
  const found = data.adoptions.find((a) => a.id === want) ?? null;
  const adoption = found?.usable ? found : null;
  const edId = found ? (found.usable ? found.baseEdition : fallback.id) : want;
  if (found && !found.usable) return { edition: fallback, adoption: null, note: `${found.label}: ${found.why} — ${fallback.label} read` };
  const edition = data.editions.find((e) => e.id === edId) ?? fallback;
  return { edition, adoption, note: edition.id === edId ? null : `${want} is not on record — ${edition.label} read` };
}

/** THE CODE'S ROW FOR A ZONE, for a code (an edition, or a state's adoption with its overrides): "4A" → zone 4's; Marine 4 → the "5
 *  and Marine 4" row; 8 → "7 and 8"; 0 → "0 and 1" when the table merges them; a zone the table does not know (or none) → zone 4's,
 *  said so in `note`. Each factor's citation is in `cites` */
export function codeFor(code: string | null | undefined, zone: string | null | undefined, data: EnergyCodeData = ENERGY_CODE_DATA): IeccTable & { cites: Record<string, string>; edition: Edition; adoption: Adoption | null; missing: string[] } {
  const { edition, adoption, note: codeNote } = resolveCode(code, data);
  const mine = data.values.filter((v) => v.edition === edition.id);
  const rows = new Set(mine.map((v) => v.zone).filter((z) => z !== "all"));
  const z = (zone ?? "").trim().toUpperCase();
  const digit = /^\d/.exec(z)?.[0] ?? "";
  const marine = /^4C/.test(z) && !rows.has("4C");
  const row = rows.has(z) ? z : marine ? "5" : rows.has(digit) ? digit : digit === "8" && rows.has("7") ? "7" : digit === "0" && rows.has("1") ? "1" : "4";
  const note = !z ? "no climate zone read — zone 4's row assumed" : marine ? "Marine 4 reads the \"5 and Marine 4\" row" : row === "7" && digit === "8" ? "zone 8 reads the \"7 and 8\" row" : row === "1" && digit === "0" ? "zone 0 reads the \"0 and 1\" row" : row === "4" && digit !== "4" ? `zone ${z} is not in the table — zone 4's row assumed` : null;
  const out: Record<string, number | null> = {}, cites: Record<string, string> = {};
  // a factor is read at the most specific key the table has: the zone's own number (ACH50 is stated by zone, its groups differ from
  // the U table's rows), the U table's row, then "all"; a state's override first. The thermostat an edition does not carry is the
  // app's (the 2018 rows' — the user rules between it and the code's reference design), cited so
  const keys = [digit, row, "all"].filter((k, i, a) => k && a.indexOf(k) === i);
  const put = (factor: string, own: string[]): void => {
    const o = adoption ? data.overrides.find((x) => x.adoptionId === adoption.id && x.factor === factor && (own.includes(x.zone) || x.zone === "all")) : undefined;
    let v: CodeValue | Override | undefined = o;
    for (const k of own) { if (v) break; v = mine.find((x) => x.factor === factor && x.zone === k); }
    let from = edition.label;
    // THE THERMOSTAT IS THE CODE'S (the user, 2026-10-07: "Let's use the 72/75"): the edition's standard reference design, its
    // °F row converted — the app's own 68 / 78 °F is gone
    if (!v && (factor === "heatingSetpointC" || factor === "coolingSetpointC")) {
      const f = mine.find((x) => x.factor === (factor === "heatingSetpointC" ? "heatingSetpointF" : "coolingSetpointF") && x.zone === "all");
      if (f && f.value !== null) { out[factor] = Number((((f.value - 32) * 5) / 9).toFixed(2)); cites[factor] = `${from}, ${f.cite} (standard reference design, ${f.value} °F)`; }
      return;
    }
    if (!v) return;
    out[factor] = v.value; cites[factor] = o ? `${adoption!.label}: ${o.cite}` : `${from}, ${v.cite}`;
  };
  for (const f of ROW_FACTORS) put(f, [row]);
  for (const f of SHARED_FACTORS) put(f, f === "ach50" ? keys : ["all"]);
  const missing = [...ROW_FACTORS, ...SHARED_FACTORS].filter((f) => !NOT_REQUIRED.has(f) && (!(f in out) || (out[f] === null && !NULLABLE.has(f))));
  // A FACTOR WITH NO VALUE ON RECORD reads NaN — never a number invented — and is named, so the writer can refuse (energyCodeGap)
  for (const f of missing) out[f] = NaN;
  return { ...(out as unknown as IeccRow & CodeShared), row, zone: z || "4A", note: codeNote ? `${codeNote}${note ? `; ${note}` : ""}` : note, cites, edition, adoption, missing };
}

/** a state's adoptions, newest first, the one in force on `date` (YYYY-MM-DD) marked */
export function adoptionsFor(state: string | null | undefined, date: string, data: EnergyCodeData = ENERGY_CODE_DATA): (Adoption & { inForce: boolean; grace: boolean })[] {
  const s = (state ?? "").trim().toUpperCase();
  return data.adoptions.filter((a) => a.state.toUpperCase() === s).sort((a, b) => (b.from || "9999").localeCompare(a.from || "9999"))
    .map((a) => ({ ...a, inForce: (a.from === "" || a.from <= date) && (a.to === null || date < a.to), grace: a.to !== null && a.graceUntil !== null && a.to <= date && date < a.graceUntil }));
}

/** WHAT THE WRITER NEEDS AND THE USER HAS NOT ENTERED — null when the code's row is complete. Said in words the user can act on */
export function energyCodeGap(t: { missing: string[]; edition: Edition; row: string }): string | null {
  if (!t.missing.length) return null;
  const where = "BEM › SITE › energy code › Choose… › Edit values… (kept in the project's tables/energy-codes/)";
  const words: Record<string, string> = { fenestrationU: "window U", skylightU: "skylight U", ceilingU: "ceiling U", frameWallU: "frame wall U", massWallU: "mass wall U", floorU: "floor U",
    basementWallU: "basement wall U", crawlWallU: "crawl space wall U", fenestrationSHGC: "window SHGC", slabR: "slab R", slabDepthFt: "slab depth", ach50: "air leakage (ACH50)",
    heatingSetpointC: "heating thermostat", coolingSetpointC: "cooling thermostat" };
  return t.edition.id === NO_EDITION.id
    ? `no energy code is on record — enter the code your project is under, and its values, in ${where}; the code's text is free to read at codes.iccsafe.org`
    : `the energy code ${t.edition.label}, climate zone row ${t.row}, has no value for ${t.missing.map((f) => words[f] ?? f).join(", ")} — enter them in ${where}`;
}
