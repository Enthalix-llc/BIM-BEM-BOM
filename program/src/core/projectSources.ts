// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE PROJECT'S DATA SOURCES (user, 2026-11-12: "a project related file that can identify what the various data sources for the project
// are … with a new project the file would start with a template (initially standard, and adjusted if the sources change)"). One record
// per project, kept in the project's own project.sqlite (a project is a folder, 2026-11-12), says
// where each kind of data the model reads comes from: the weather-station map, the station an actual-year weather file is made from, the
// energy code's tables, the climate zone, the infiltration and ground-coupling factors, the material reference lists and the tariff cards.
// A new project takes its record from the TEMPLATE it is made from — the standard one shipped in templates/standard, or one of
// the user's own. A source that is a TABLE is a file the user supplies, read from the project's folder: BIM-BEM-BOM ships none of them.
// Pure: no I/O.

/** where the weather station map's listing comes from */
export type WeatherListing = "energyplus" | "onebuilding-tmyx-usa";
/** the NOAA GHCNh station an actual-year weather file is made from: the nearest that reports hourly, or one pinned by its id */
export type AmyStation = { mode: "nearest" } | { mode: "pinned"; id: string; name?: string;
  /** the name a made file carries before "_AMY_<period>" (the project's own naming); absent = "GHCNh-<id>" */
  fileStem?: string };
/** the energy code's tables: the DOE/PNNL prototype values shipped with the program, and the user's own tables in a folder (relative to
 *  the project folder; tables/energy-codes by default) */
export interface EnergyCodeSource { shipped: boolean; tables?: string }
/** the climate zone: typed with the energy code, or read from a county table (a CSV with State FIPS, County FIPS, IECC Climate Zone, IECC
 *  Moisture Regime, County Name — the DOE Building America layout), given as a file in the project folder or a URL fetched once and cached */
export type ClimateZoneSource = { mode: "typed" } | { mode: "county-table"; file?: string; url?: string };
/** a table file the user supplies (JSON, the layouts in references/sources/README.md), or typed by hand */
export type TableSource = { mode: "typed" } | { mode: "table"; file: string };
export interface TariffSource { sample: boolean; files: string[] }

export interface ProjectSources {
  /** the template this record started from ("standard", or one of the user's) — said beside the record, never read for a value */
  template: string;
  /** a short mark the program shows beside its name while this project is open (a private project's, say) — none by default */
  badge?: string;
  weatherListing: WeatherListing;
  amyStation: AmyStation;
  energyCodes: EnergyCodeSource;
  climateZone: ClimateZoneSource;
  /** the stack and wind coefficients (Cs, Cw) of a blower-door infiltration ruling */
  infiltration: TableSource;
  /** the F-factor of a slab and the C-factor of a below-grade wall, for the F/C ground method */
  groundFactors: TableSource;
  /** material and window reference lists (CSV, relative to the project folder), read into materials.db beside the shipped keyword list */
  referenceLists: string[];
  /** a JSON naming the datasets those lists fill (the palette's DataSet filter): { sources: [...], datasets: [...] } — none, none */
  referenceManifest?: string;
  tariffs: TariffSource;
}

/** THE STANDARD TEMPLATE: every source the public program ships with or reads from the web under its own terms */
export const STANDARD_SOURCES: ProjectSources = {
  template: "standard",
  weatherListing: "energyplus",
  amyStation: { mode: "nearest" },
  energyCodes: { shipped: true },
  climateZone: { mode: "typed" },
  infiltration: { mode: "typed" },
  groundFactors: { mode: "typed" },
  referenceLists: [],
  tariffs: { sample: true, files: ["tables/tariffs/tariff.json"] },
};

/** the folder in the project the user's own energy-code tables are read from when the source names none */
export const DEFAULT_CODE_TABLES = "tables/energy-codes";

/** a record as read (a template file, a ledger written by another version): every field checked, an unknown or missing one taken from
 *  `base`, each refusal named — never a source invented */
export function readSources(raw: unknown, base: ProjectSources = STANDARD_SOURCES): { sources: ProjectSources; problems: string[] } {
  const problems: string[] = [];
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
  const out: ProjectSources = structuredClone(base);
  if (str(o.template)) out.template = o.template.trim();
  if (str(o.badge)) out.badge = o.badge.trim().slice(0, 12); else if (o.badge !== undefined) delete out.badge;
  if (o.weatherListing !== undefined) {
    if (o.weatherListing === "energyplus" || o.weatherListing === "onebuilding-tmyx-usa") out.weatherListing = o.weatherListing;
    else problems.push(`weatherListing "${String(o.weatherListing)}" is not one this program reads (energyplus, onebuilding-tmyx-usa)`);
  }
  const a = o.amyStation as Record<string, unknown> | undefined;
  if (a !== undefined) {
    if (a?.mode === "nearest") out.amyStation = { mode: "nearest" };
    else if (a?.mode === "pinned" && str(a.id)) out.amyStation = { mode: "pinned", id: a.id.trim(), ...(str(a.name) ? { name: a.name.trim() } : {}), ...(str(a.fileStem) ? { fileStem: a.fileStem.trim() } : {}) };
    else problems.push("amyStation: { mode: \"nearest\" } or { mode: \"pinned\", id: \"<GHCNh id>\" }");
  }
  const e = o.energyCodes as Record<string, unknown> | undefined;
  if (e !== undefined) {
    if (e && typeof e.shipped === "boolean") out.energyCodes = { shipped: e.shipped, ...(str(e.tables) ? { tables: e.tables.trim() } : {}) };
    else problems.push("energyCodes: { shipped: true | false, tables?: \"<folder>\" }");
  }
  const c = o.climateZone as Record<string, unknown> | undefined;
  if (c !== undefined) {
    if (c?.mode === "typed") out.climateZone = { mode: "typed" };
    else if (c?.mode === "county-table" && (str(c.file) || str(c.url))) out.climateZone = { mode: "county-table", ...(str(c.file) ? { file: c.file.trim() } : {}), ...(str(c.url) ? { url: c.url.trim() } : {}) };
    else problems.push("climateZone: { mode: \"typed\" } or { mode: \"county-table\", file | url }");
  }
  const table = (k: "infiltration" | "groundFactors"): void => {
    const t = o[k] as Record<string, unknown> | undefined;
    if (t === undefined) return;
    if (t?.mode === "typed") out[k] = { mode: "typed" };
    else if (t?.mode === "table" && str(t.file)) out[k] = { mode: "table", file: t.file.trim() };
    else problems.push(`${k}: { mode: "typed" } or { mode: "table", file: "<json>" }`);
  };
  table("infiltration"); table("groundFactors");
  if (o.referenceLists !== undefined) {
    if (Array.isArray(o.referenceLists) && o.referenceLists.every(str)) out.referenceLists = (o.referenceLists as string[]).map((x) => x.trim());
    else problems.push("referenceLists: a list of CSV paths");
  }
  if (o.referenceManifest !== undefined) {
    if (str(o.referenceManifest)) out.referenceManifest = o.referenceManifest.trim(); else problems.push("referenceManifest: a JSON path");
  }
  const tr = o.tariffs as Record<string, unknown> | undefined;
  if (tr !== undefined) {
    if (tr && typeof tr.sample === "boolean" && Array.isArray(tr.files) && tr.files.every(str)) out.tariffs = { sample: tr.sample, files: (tr.files as string[]).map((x) => x.trim()) };
    else problems.push("tariffs: { sample: true | false, files: [\"<json>\", …] }");
  }
  return { sources: out, problems };
}

/** the record a project reads: its own, else the template in force */
export const sourcesOf = (own: ProjectSources | undefined | null, template: ProjectSources): ProjectSources => own ?? template;

/** a path in a source record, under the project's folder only — never absolute, never above it */
export const safeRel = (p: string): string | null => (/^(\/|[A-Za-z]:|\\)/.test(p) || p.split(/[\\/]/).includes("..") ? null : p.replace(/\\/g, "/"));

/** THE RECORD IN WORDS, one row per source — what SITE › data sources lists */
export function sourceRows(s: ProjectSources): Array<{ key: keyof ProjectSources; label: string; value: string }> {
  const t = (x: TableSource, typed: string): string => (x.mode === "typed" ? typed : `table: ${x.file}`);
  return [
    { key: "weatherListing", label: "weather station map", value: s.weatherListing === "energyplus" ? "EnergyPlus's weather repository (energyplus.net/weather)" : "climate.onebuilding.org · USA TMYx files" },
    { key: "amyStation", label: "actual-year weather station", value: s.amyStation.mode === "nearest" ? "the NOAA station nearest the site that reports hourly" : `NOAA station ${s.amyStation.id}${s.amyStation.name ? ` (${s.amyStation.name})` : ""}, pinned` },
    { key: "energyCodes", label: "energy code tables", value: `${s.energyCodes.tables ?? DEFAULT_CODE_TABLES} (your own)${s.energyCodes.shipped ? " + the DOE/PNNL prototype values shipped with the program" : ""}` },
    { key: "climateZone", label: "climate zone", value: s.climateZone.mode === "typed" ? "typed with the energy code" : `the county's row of a county table (${s.climateZone.file ?? s.climateZone.url})` },
    { key: "infiltration", label: "infiltration Cs, Cw", value: t(s.infiltration, "typed on each Zone card") },
    { key: "groundFactors", label: "F/C ground factors", value: t(s.groundFactors, "typed on CONSTRUCTIONS › Floors") },
    { key: "referenceLists", label: "material reference lists", value: s.referenceLists.length ? `the keyword list + ${s.referenceLists.join(", ")}` : "the keyword list (shipped)" },
    { key: "tariffs", label: "tariff cards", value: `${s.tariffs.files.join(", ") || "none"}${s.tariffs.sample ? " + the Sample card" : ""}` },
  ];
}

/** the open project's mark (its record's badge), for the splash and the rail; none when no project or no badge — read in the page only */
export function projectBadge(): string | null {
  const raw = (globalThis as { projectNow?: { sources?: unknown } | null }).projectNow?.sources as { badge?: unknown } | null | undefined;
  return raw && typeof raw.badge === "string" && raw.badge.trim() ? raw.badge.trim().slice(0, 12) : null;
}
