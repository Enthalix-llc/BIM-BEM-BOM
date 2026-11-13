// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE MATERIALS DATABASE (user, 2026-09-08: "material change, with options
// downloaded from industry/energyplus data source into new material dbs
// saved with program for current and future reference"). ONE program-wide
// data/materials.db, DERIVED like every .sqlite here: rebuilt from its seeds
// — the engine's own DataSets beside the binary, with the provenance their
// headers state; the openstudio-standards catalogue fetched once at a pinned
// commit (IP units, converted on import, the copyright notice kept) — plus a
// replayable sidecar, data/materials-user.json, holding every row saved from
// the search dialog or typed by hand. A ruling references a row by its KEY;
// the row becomes an IdfObject through one adapter, so the library resolver,
// the R arithmetic and the writer are untouched. Nothing is derived from a
// material: a row with neither (thickness, conductivity) nor a stated R is
// refused at seed time, named, and never emitted.

import type { Database, SqlJsStatic } from "sql.js";
import { sha256Hex } from "../../../core/sha256.js";
import { parseIdfObjects, matchMaterials, windowNote, type IdfObject, type Library } from "./idfLib.js";
import { parseCsv } from "../../bom/core/csvRead.js";

/** 2 (2026-09-16): `materials.keywords` and the glazing products table — the user's reference lists (below)
 *  3 (2026-09-17): the palette's filter data — `sources.source_class` / `sources.label`, `materials.name_group`
 *  4 (2026-09-17): the FENESTRATION table — the engine's own window constructions beside the ratings and the
 *    generic sets, with `row_kind`, `lib_file`, `lib_name` and `name_group` (the user: windows carry different
 *    material data than standard materials, and a window or door reads that table, not the material rows) */
export const MATERIALS_SCHEMA = "7";   // 7 (2026-09-29): the ROOFING kind — every row's kind re-read
export const MATERIALS_DB = "materials.db";
export const MATERIALS_SIDECAR = "materials-user.json";
/** the reference lists under references/materials/, by base name: the material keyword list (IFC material words → catalogue rows).
 *  A manufacturer's ratings or another list can be added here by a user; none ships with the program */
export const REFERENCE_FILES = ["opus-keyword-map.csv"] as const;
/** the openstudio-standards catalogue, pinned to a commit of the NatLabRockies org — NREL was renamed and the old `NREL` login is another account */
export const OSSTD_PIN = "c8479fa5266b0f272d2320ee36d2176452b879a0";
export const OSSTD_URL = `https://raw.githubusercontent.com/NatLabRockies/openstudio-standards/${OSSTD_PIN}/lib/openstudio-standards/standards/ashrae_90_1/data/ashrae_90_1.materials.json`;
export const OSSTD_CACHE = `osstd-materials-${OSSTD_PIN.slice(0, 7)}.json`;
/** IP → SI, stated once: inches · Btu·in/h·ft²·°F · h·ft²·°F/Btu · lb/ft³ · Btu/lb·°F */
export const IP = { inM: 0.0254, kWmK: 0.1442279, rSi: 0.1761102, rho: 16.01846, cp: 4186.8 } as const;

export type MaterialClass = "Material" | "Material:NoMass" | "Material:AirGap";
export const MATERIAL_KINDS = ["roofing", "siding", "wood", "plywood", "concrete", "masonry", "gypsum", "insulation-batt", "insulation-rigid", "metal", "membrane", "air", "glass", "gas", "generic"] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];
/** the categories a layer is ruled to be, in the user's words (2026-09-08: "Siding, Air Gap, Wood, Brick, Concrete, Insulation, Vapor Barrier, Wall Board") */
export const KIND_LABELS: Record<MaterialKind, string> = { roofing: "Roofing (asphalt / bituminous)", siding: "Siding", air: "Air Gap", wood: "Wood", plywood: "Plywood / Sheathing", masonry: "Brick / Masonry", concrete: "Concrete", "insulation-batt": "Insulation — batt", "insulation-rigid": "Insulation — rigid", membrane: "Vapor Barrier / Membrane", gypsum: "Wall Board (gypsum)", metal: "Metal", glass: "Glass", gas: "Gas fill", generic: "Generic" };

/** THE CATEGORIES A SECTION TAKES (user, 2026-09-16: "different materials from local reference that relate to the material category
 *  of roof, walls, floors"): what the DETAIL palette offers when the layer's own category is widened — a roof never offers siding,
 *  a floor never a roofing membrane's cousins under "siding". A judgment list, stated once; "show every category" is the escape */
export const SECTION_KINDS: Record<"roof" | "wall" | "floor", MaterialKind[]> = {
  roof: ["roofing", "membrane", "metal", "masonry", "concrete", "plywood", "wood", "insulation-batt", "insulation-rigid", "air", "gypsum"],
  wall: ["siding", "plywood", "membrane", "wood", "insulation-batt", "insulation-rigid", "gypsum", "masonry", "concrete", "metal", "air"],
  floor: ["wood", "plywood", "insulation-batt", "insulation-rigid", "concrete", "masonry", "membrane", "air", "gypsum"],
};

export interface MaterialRow {
  key: string; name: string; cls: MaterialClass; kind: MaterialKind; roughness: string | null;
  /** the dataset the row belongs to (2026-09-18); absent = its source's dataset of that kind */
  datasetKey?: string | null;
  thicknessM: number | null; conductivityWmK: number | null; densityKgM3: number | null; specificHeatJKgK: number | null;
  /** NoMass / AirGap: the stated resistance */
  rSi: number | null;
  thermalAbs: number | null; solarAbs: number | null; visibleAbs: number | null;
  sourceId: string;
  /** the chapter and table, the standard, the uuid and URL, the article — what the row's source itself states */
  sourceRef: string;
  unitsAsFetched: "SI" | "IP" | "SI mm";
  /** the row as fetched, verbatim (the audit trail); null for the DataSets, whose text is beside the engine */
  fetchedJson: string | null;
  notes: string | null;
  addedAt: string;
  /** THE REFERENCE LIST'S IFC MATCH KEYWORDS (2026-09-16): the words a file's layer name is matched against
   *  ("wood siding;clapboard;timber cladding"); null on every other source */
  keywords?: string[] | null;
  /** THE NAME'S GROUP (2026-09-17, the user's third filter): the first word of the name, a leading code or number
   *  taken with the word after it — "Aluminum", "F08 Metal", "10 PSF", "Asphalt". Stored in the db, read back here */
  nameGroup?: string | null;
}
/** WHERE A ROW COMES FROM, for the palette's Source filter (2026-09-17): an open library or standard · a
 *  manufacturer's own published data · the user's own rows (typed by hand, or saved from a search) */
export type SourceClass = "open" | "manufacturer" | "yours";
export const SOURCE_CLASS_LABELS: Record<SourceClass, string> = { open: "Open", manufacturer: "Manufacturers", yours: "Custom" };
/** what a dataset holds: the opaque `materials` table or the `fenestration` one (2026-09-18, the user:
 *  "the datasets need to be grouped by material and fenestration") */
export type DataKind = "material" | "fenestration";
/** A DATASET is one source's rows OF ONE KIND — so a provider that publishes both (the reference list, your own
 *  rows) is two datasets, and a palette only ever offers the datasets of the kind it lists. Its class and provider
 *  come from the source row; `set` is the set's own name, shown as "<provider> - <set>" (user, 2026-09-18:
 *  "separate datasets for Open, Manufacturers, and Custom … Manufacturer - Model, for example Marvin - Essential"). */
export const DATASETS: { key: string; sourceId: string; kind: DataKind; set: string; provider?: string }[] = [
  { key: "hof2005", sourceId: "hof2005", kind: "material", set: "HOF 2005 materials (via the EnergyPlus DataSets)" },
  // the catalogue cites its own authority per row (901 of 1,071 read "CEC Title24-2013", 170 name none), and the
  // user's ruling of 2026-09-18 is that the dataset id IS the source — so its rows sit in two datasets
  { key: "cec-t24", sourceId: "osstd", kind: "material", set: "Title 24-2013 (through openstudio-standards)", provider: "CEC" },
  { key: "osstd-uncited", sourceId: "osstd", kind: "material", set: "rows citing no standard" },
  { key: "bcl", sourceId: "bcl", kind: "material", set: "saved by you" },
  { key: "hand", sourceId: "hand", kind: "material", set: "your own materials" },
  { key: "general", sourceId: "general", kind: "material", set: "the browser" },
  { key: "epwin", sourceId: "epwin", kind: "fenestration", set: "window constructions" },
  { key: "hand-fen", sourceId: "hand", kind: "fenestration", set: "your own windows and doors" },
  { key: "igsdb", sourceId: "igsdb", kind: "fenestration", set: "IGSDB (glazing)" },
];
/** THE PUBLISHER'S RIGHTS (user, 2026-11-07): BIM-BEM-BOM ships none of these numbers — they are read from the user's own
 *  EnergyPlus installation or downloaded to the user's computer — and the user is told the right to use them is theirs to obtain.
 *  Shown on a row's tooltip; the splash page and THIRD-PARTY-NOTICES.md say the same. */
export const DATASET_RIGHTS: Record<string, string> = {
  hof2005: "these numbers are ASHRAE's (Handbook of Fundamentals 2005), read from the DataSets file in your own EnergyPlus installation; BIM-BEM-BOM does not ship them or license them. Using them in your work may require your own copy or license from ASHRAE.",
  "cec-t24": "these numbers cite the California Energy Commission's Title 24-2013, through the openstudio-standards catalogue downloaded to your computer; BIM-BEM-BOM does not ship them or license them. Check the publisher's terms for your use.",
};
/** a row's dataset: its source, of the kind the table it sits in holds */
export function dataSetKeyOf(sourceId: string, kind: DataKind): string {
  return DATASETS.find((d) => d.sourceId === sourceId && d.kind === kind)?.key ?? sourceId;
}
/** the datasets as the filters read them — class and provider joined from the source row */
export interface ResolvedDataSet { key: string; sourceId: string; kind: DataKind; sourceClass: SourceClass; provider: string; set: string; label: string }
export function resolveDataSets(srcs: MaterialSource[], kind?: DataKind, extra: typeof DATASETS = []): ResolvedDataSet[] {
  return [...DATASETS, ...extra].filter((d) => !kind || d.kind === kind).map((d) => {
    const s = srcs.find((x) => x.id === d.sourceId);
    const provider = d.provider ?? s?.provider ?? d.sourceId;
    return { key: d.key, sourceId: d.sourceId, kind: d.kind, sourceClass: s?.sourceClass ?? "open", provider, set: d.set, label: `${provider} - ${d.set}` };
  });
}
/** the DataSet dropdown's options: the datasets the rows ON SCREEN come from, grouped by provider, with an
 *  "All <provider>" entry where a provider has more than one set in that class */
export interface DataSetGroup { provider: string; total: number; sets: { key: string; label: string; set: string; n: number }[] }
export function dataSetGroups(ds: ResolvedDataSet[], counts: Iterable<readonly [string, number]>): DataSetGroup[] {
  const by = new Map<string, DataSetGroup>();
  for (const [key, n] of counts) {
    const d = ds.find((x) => x.key === key);
    const provider = d?.provider ?? key;
    const g = by.get(provider) ?? { provider, total: 0, sets: [] };
    g.total += n; g.sets.push({ key, label: d?.label ?? key, set: d?.set ?? key, n });
    by.set(provider, g);
  }
  for (const g of by.values()) g.sets.sort((a, b) => a.set.localeCompare(b.set));
  return [...by.values()].sort((a, b) => a.provider.localeCompare(b.provider));
}
/** a DataSet selection — "all", "provider:<name>" or a dataset key — against a row's own dataset */
export function inDataSet(value: string, key: string, ds: ResolvedDataSet[]): boolean {
  if (value === "all") return true;
  if (value.startsWith("provider:")) return (ds.find((x) => x.key === key)?.provider ?? key) === value.slice(9);
  return key === value;
}

export interface MaterialSource {
  id: string; name: string; kind: "dataset" | "catalogue" | "web" | "browser" | "hand" | "reference";
  /** the Source filter's class (Open · Manufacturers · Custom), who published it, and the set's own name;
   *  the DataSet filter groups by `provider` and lists each set as "<provider> - <label>" (2026-09-18) */
  sourceClass: SourceClass; provider: string; label: string;
  url: string | null; attribution: string; license: string; units: "SI" | "IP" | "SI mm" | "—"; keyless: boolean;
  /** the search dialog offers it: a URL template with {q} — fetched as text (web) or opened in the user's browser (browser) */
  searchUrl: string | null;
  pin: string | null; note: string;
}
/** THE RESOURCES (the user asked for the list, 2026-09-08; verified by HTTP the same day) — references/material-sources.md is the reading, these rows its machine form */
export const SOURCES: MaterialSource[] = [
  { id: "hof2005", sourceClass: "open", provider: "ASHRAE", label: "HOF 2005 materials", name: "EnergyPlus DataSets · ASHRAE 2005 HOF materials", kind: "dataset", url: null, attribution: "ASHRAE Handbook of Fundamentals 2005, Ch. 30 Tables 19 & 22 and Ch. 25 Table 4 — EnergyPlus DataSets/ASHRAE_2005_HOF_Materials.idf", license: "ships with EnergyPlus (BSD-3-style); the numbers are ASHRAE's", units: "SI", keyless: true, searchUrl: null, pin: "EnergyPlus 8.4.0+ dataset", note: "the seed: 204 Material · 64 NoMass · 2 AirGap; provenance read from the file's own banners" },
  { id: "osstd", sourceClass: "open", provider: "openstudio-standards", label: "materials catalogue", name: "openstudio-standards materials catalogue", kind: "catalogue", url: OSSTD_URL, attribution: "openstudio-standards, ashrae_90_1.materials.json (NatLabRockies), a material_standard per row", license: "OpenStudio(R), Copyright (c) 2008-2023, Alliance for Sustainable Energy, LLC. BSD-3-clause; this notice is retained", units: "IP", keyless: true, searchUrl: null, pin: OSSTD_PIN, note: "1,071 rows in IP units, converted on import; glazing and gas rows skipped; fetched once and cached" },
  { id: "bcl", sourceClass: "yours", provider: "BCL", label: "saved by you", name: "BCL — NREL/NLR Building Component Library", kind: "web", url: "https://bcl.nlr.gov/", attribution: "NREL/NLR Building Component Library (U.S. DOE) — from ASHRAE HOF 2005 and 90.1-2004 App. A; per component: name, uuid, URL", license: "public; per component", units: "SI mm", keyless: true, searchUrl: "https://bcl.nlr.gov/api/search/{q}.json?fq[]=bundle:component&fq[]=component_tags:Material&show_rows=50&page=0", pin: null, note: "the default live search; thickness in millimetres; roughness from the component's file; no absorptances (the engine's defaults)" },
  { id: "general", sourceClass: "open", provider: "General search", label: "the browser", name: "General search (the browser)", kind: "browser", url: null, attribution: "the page the user names", license: "the page's", units: "—", keyless: true, searchUrl: "https://duckduckgo.com/?q={q}", pin: null, note: "opens the browser with the search prefilled; the numbers come back by hand with the page's URL" },
  { id: "igsdb", sourceClass: "open", provider: "LBNL", label: "IGSDB (glazing)", name: "LBNL IGSDB (glazing)", kind: "web", url: "https://igsdb.lbl.gov/", attribution: "LBNL International Glazing Database", license: "free registration; a key is required", units: "SI", keyless: false, searchUrl: "https://igsdb.lbl.gov/api/v1/products/?search={q}", pin: null, note: "glazing products for the window track; needs a free key — not read without one" },
  { id: "hand", sourceClass: "yours", provider: "Typed by hand", label: "your own rows", name: "typed by hand", kind: "hand", url: null, attribution: "the source the user names on the row", license: "—", units: "SI", keyless: true, searchUrl: null, pin: null, note: "every hand row carries the URL or document it was read from" },
  /** THE MATERIAL KEYWORD LIST (2026-09-16): the words an IFC file uses for a material, mapped to the openstudio-standards catalogue
   *  row that carries its numbers — references/materials/opus-keyword-map.csv, derived with Claude Opus. It holds words and catalogue
   *  keys only, no material values: the numbers are the catalogue's own. A seed, read on every rebuild */
  { id: "opus", sourceClass: "open", provider: "Enthalix", label: "keyword list", name: "material keyword list (IFC words → catalogue rows)", kind: "reference", url: null, attribution: "references/materials/opus-keyword-map.csv: IFC material keywords mapped to openstudio-standards catalogue rows, derived with Claude Opus (2026-09-16)", license: "Apache-2.0 (Enthalix)", units: "SI", keyless: true, searchUrl: null, pin: "2026-09-16", note: "words and catalogue keys only — the numbers are the catalogue's" },
  { id: "epwin", sourceClass: "open", provider: "EnergyPlus", label: "window constructions", name: "EnergyPlus DataSets · window constructions", kind: "dataset", url: null, attribution: "EnergyPlus DataSets/WindowConstructs.idf — each construction's U, SHGC, TSOL and TVIS as the file's own `!` banner states them (centre of glass, no frame)", license: "ships with EnergyPlus (BSD-3-style)", units: "SI", keyless: true, searchUrl: null, pin: "EnergyPlus 8.4.0+ dataset", note: "the fenestration table's construction rows: a pick is a library ruling and the engine's own objects are emitted verbatim" },
];

/** THE NAME'S GROUP (2026-09-17, the user: "a final dropdown filter based on unique ID names … the first word
 *  including any numeric number before first word"): the first word, and a leading token that carries a digit —
 *  a code or a size — taken together with the word after it. "Aluminum Alloy" → Aluminum · "F08 Metal surface" →
 *  F08 Metal · "10 PSF Roof - 1 in." → 10 PSF · "Asphalt shingles" → Asphalt. Nothing is invented: it is the name's
 *  own head, and the palette's third filter lists the groups it finds. */
export function nameGroup(name: string): string {
  const toks = name.trim().split(/[\s,]+/).filter(Boolean);
  if (!toks.length) return "—";
  const head = /\d/.test(toks[0]!) && toks[1] ? `${toks[0]} ${toks[1]}` : toks[0]!;
  return head.replace(/[.;:,]+$/, "");
}

/** the colour and the family, from the source's own category and the name — a reading for the eye, never a thermal property */
export function kindOfName(name: string, cls: MaterialClass, category: string | null = null): MaterialKind {
  const n = `${category ?? ""} ${name}`.toLowerCase();
  if (cls === "Material:AirGap" || /air ?space|air ?gap|airspace|^air$|\bair\b(?! infiltration)/.test(n)) return "air";
  if (/batt|mineral fiber|mineral wool|glass fiber|fiberglass|cellulose|blown|loose[- ]fill|rock wool|slag/.test(n)) return "insulation-batt";
  if (/insul|foam|polystyrene|polyiso|\bxps\b|\beps\b|polyurethane|spray|compliance/.test(n)) return "insulation-rigid";
  if (/gypsum|plaster|gwb|drywall/.test(n)) return "gypsum";
  if (/plywood|\bosb\b|oriented strand|sheathing|wood panel|particle ?board|fiberboard/.test(n)) return "plywood";
  // ROOFING (user, 2026-09-29: "Asphalt is black"): asphalt and bituminous roofing, read BEFORE siding — "shingle" alone had filed
  // "Asphalt Shingles" as siding and drawn it off-white. A siding, a floor tile or linoleum that names asphalt is not roofing
  if (/asphalt|bitumen|bituminous|built[- ]?up roof|\bbur\b|roll roofing|composition shingle/.test(n) && !/siding|tile|linoleum|vinyl/.test(n)) return "roofing";
  if (/siding|stucco|eifs|clapboard|fiber ?cement|hardboard|shingle|shake|cladding/.test(n)) return "siding";
  if (/brick|block|\bcmu\b|masonry|stone|terrazzo|tile|granite|marble|limestone/.test(n)) return "masonry";
  if (/concrete|cast|mortar|cement|gypcrete|screed/.test(n)) return "concrete";
  if (/metal|steel|aluminum|aluminium|copper|zinc|\btin\b|iron/.test(n)) return "metal";
  if (/membrane|felt|vapor|vapour|polyethylene|film|roofing|built-up|asphalt|bitumen|rubber|epdm|\btpo\b|vinyl|carpet|acoustic/.test(n)) return "membrane";
  if (/wood|lumber|softwood|hardwood|oak|pine|\bfir\b|timber|joist|stud|rafter|cork/.test(n)) return "wood";
  if (/glass|glazing/.test(n)) return "glass";
  if (/argon|krypton|xenon|^gas\b/.test(n)) return "gas";
  return "generic";
}

const num = (s: string | number | null | undefined): number | null => (s === null || s === undefined || s === "" ? null : Number.isFinite(Number(s)) ? Number(s) : null);
const now = (): string => new Date().toISOString();

/** the file's banner condensed to the citation it carries: "Chapter 30, Table 19 and Table 22" → "ASHRAE 2005 HOF Ch. 30, Tables 19 & 22" */
export function condenseProvenance(banner: string | undefined, file: string): string {
  if (!banner) return `${file} (no source stated in the file)`;
  const m = /Chapter\s+(\d+)[^.]*?Table\s+(\d+)(?:\s+and\s+Table\s+(\d+))?/i.exec(banner);
  if (m) return `ASHRAE 2005 HOF Ch. ${m[1]}, ${m[3] ? `Tables ${m[2]} & ${m[3]}` : `Table ${m[2]}`} (EnergyPlus DataSets)`;
  const rp = /ASHRAE\s+1145-(?:RP|TRP)[^.]*/i.exec(banner);
  if (rp) return `${rp[0].trim()} (EnergyPlus DataSets)`;
  return banner.slice(0, 160);
}

/** a DataSets object → a row; null when the object is not an opaque material or states no usable numbers */
export function rowFromIdfObject(o: IdfObject, sourceId: string, sourceRef: string): MaterialRow | null {
  const f = o.fields;
  const base = { key: `${sourceId}:${o.name}`, name: o.name, sourceId, sourceRef, unitsAsFetched: "SI" as const, fetchedJson: null, notes: null, addedAt: "" };
  if (o.cls === "Material") {
    const t = num(f[2]), k = num(f[3]), rho = num(f[4]), cp = num(f[5]);
    if (t === null || k === null || k <= 0 || rho === null || cp === null) return null;
    return { ...base, cls: "Material", kind: kindOfName(o.name, "Material"), roughness: f[1] ?? null, thicknessM: t, conductivityWmK: k, densityKgM3: rho, specificHeatJKgK: cp, rSi: null, thermalAbs: num(f[6]), solarAbs: num(f[7]), visibleAbs: num(f[8]) };
  }
  if (o.cls === "Material:NoMass") {
    const r = num(f[2]);
    if (r === null || r <= 0) return null;
    return { ...base, cls: "Material:NoMass", kind: kindOfName(o.name, "Material:NoMass"), roughness: f[1] ?? null, thicknessM: null, conductivityWmK: null, densityKgM3: null, specificHeatJKgK: null, rSi: r, thermalAbs: num(f[3]), solarAbs: num(f[4]), visibleAbs: num(f[5]) };
  }
  if (o.cls === "Material:AirGap") {
    const r = num(f[1]);
    if (r === null || r <= 0) return null;
    return { ...base, cls: "Material:AirGap", kind: "air", roughness: null, thicknessM: null, conductivityWmK: null, densityKgM3: null, specificHeatJKgK: null, rSi: r, thermalAbs: null, solarAbs: null, visibleAbs: null };
  }
  return null;
}

/** an openstudio-standards row (IP) → a row (SI); the class by material_type; null with the reason for the census when skipped */
export function rowFromOsstd(m: Record<string, unknown>, keyUsed: Set<string>): { row: MaterialRow | null; skipped: string | null } {
  const type = String(m.material_type ?? "none");
  const name = String(m.name ?? "").trim();
  if (!name) return { row: null, skipped: "unnamed" };
  const cls: MaterialClass | null = type === "StandardOpaqueMaterial" ? "Material" : type === "MasslessOpaqueMaterial" ? "Material:NoMass" : type === "AirGap" ? "Material:AirGap" : null;
  if (!cls) return { row: null, skipped: type };
  let key = `osstd:${name}`;
  for (let k = 2; keyUsed.has(key); k++) key = `osstd:${name}#${k}`;
  keyUsed.add(key);
  const std = [m.material_standard, m.material_standard_source].filter((x) => typeof x === "string" && x).join(" — ");
  // THE DATASET IS THE SOURCE (user, 2026-09-18): the rows that cite CEC Title 24 are the CEC dataset; a row that
  // cites no standard is its own dataset, never filed under one it does not name
  const datasetKey = /^CEC Title\s*24/i.test(String(m.material_standard ?? "")) ? "cec-t24" : "osstd-uncited";
  const category = typeof m.code_category === "string" ? m.code_category : null;
  const base = { key, name, sourceId: "osstd", datasetKey, sourceRef: std || "openstudio-standards catalogue (no standard named on the row)", unitsAsFetched: "IP" as const, fetchedJson: JSON.stringify(m), notes: typeof m.notes === "string" ? m.notes : null, addedAt: "", roughness: typeof m.roughness === "string" ? m.roughness : null, thermalAbs: num(m.thermal_absorptance as number), solarAbs: num(m.solar_absorptance as number), visibleAbs: num(m.visible_absorptance as number) };
  if (cls === "Material") {
    const t = num(m.thickness as number), k = num(m.conductivity as number), rho = num(m.density as number), cp = num(m.specific_heat as number), r = num(m.resistance as number);
    if (t === null || t <= 0) return { row: null, skipped: "opaque without thickness" };
    if (k !== null && k > 0 && rho !== null && rho > 0 && cp !== null && cp > 0) {
      return { row: { ...base, cls, kind: kindOfName(name, cls, category), thicknessM: t * IP.inM, conductivityWmK: k * IP.kWmK, densityKgM3: rho * IP.rho, specificHeatJKgK: cp * IP.cp, rSi: null }, skipped: null };
    }
    // conductivity without mass, or a resistance only: massless at the stated R — never invented mass
    const rSi = k !== null && k > 0 ? (t * IP.inM) / (k * IP.kWmK) : r !== null && r > 0 ? r * IP.rSi : null;
    if (rSi === null) return { row: null, skipped: "opaque without conductivity or resistance" };
    return { row: { ...base, cls: "Material:NoMass", kind: kindOfName(name, cls, category), thicknessM: t * IP.inM, conductivityWmK: null, densityKgM3: null, specificHeatJKgK: null, rSi, notes: [base.notes, "no density or specific heat in the source; emitted massless at the stated R"].filter(Boolean).join(" · ") }, skipped: null };
  }
  const r = num(m.resistance as number);
  if (r === null || r <= 0) return { row: null, skipped: `${type} without resistance` };
  const t = num(m.thickness as number);
  return { row: { ...base, cls, kind: cls === "Material:AirGap" ? "air" : kindOfName(name, cls, category), thicknessM: t !== null && t > 0 ? t * IP.inM : null, conductivityWmK: null, densityKgM3: null, specificHeatJKgK: null, rSi: r * IP.rSi }, skipped: null };
}

/** a sidecar row is taken only when its numbers can make a layer: k, ρ, cp for a Material, a positive R otherwise */
export function validateRow(r: MaterialRow): string | null {
  if (!r.key || !r.name || !r.sourceId) return "no key, name or source";
  for (const [w, v] of [["thermal", r.thermalAbs], ["solar", r.solarAbs], ["visible", r.visibleAbs]] as const) if (v !== null && !(v >= 0 && v <= 1)) return `a ${w} absorptance between 0 and 1`;
  if (r.cls === "Material") return r.thicknessM !== null && r.thicknessM > 0 && r.conductivityWmK !== null && r.conductivityWmK > 0 && r.densityKgM3 !== null && r.densityKgM3 > 0 && r.specificHeatJKgK !== null && r.specificHeatJKgK >= 100 ? null : "a Material needs thickness, conductivity, density and a specific heat ≥ 100 J/kg·K";
  return r.rSi !== null && r.rSi > 0 ? null : "a massless layer needs a positive R";
}

/** A GLAZING PRODUCT (2026-09-16): a whole-window rating — U with the frame, SHGC, a VT when published — that the window
 *  and glazed-door tracks offer as a `u` ruling (one WindowMaterial:SimpleGlazingSystem); the Marvin Elevate NFRC rows,
 *  and the reference list's 19 generic sets. `section` says which track offers it: window, door, or any */
/** A ROW OF THE FENESTRATION DATASETS (2026-09-17, the user: "windows carry different material data than standard
 *  materials — can we carry a Fenestration (Window · Door · Skylights) db DataSets table that is referenced when
 *  windows / doors are selected (and not show standard Material db DataSets)"). Two kinds of row live in it:
 *  a CONSTRUCTION (the engine's own window constructions, picked as a library ruling — its file and name) and a
 *  PRODUCT (a whole-product rating: Marvin's NFRC rows, the reference list's generic sets — picked as a U ruling). */
export interface GlazingProduct {
  key: string; name: string; sourceId: string; sourceRef: string; section: "window" | "door" | "skylight" | "any";
  /** which kind of row, and for a construction the dataset file and name a library ruling names */
  rowKind: "construction" | "product"; libFile: string | null; libName: string | null;
  /** the name's own group, the third filter's entry — stored in the db beside the row (2026-09-17) */
  nameGroup?: string | null;
  productType: string; cpd: string | null; glassOption: string | null; panes: number | null; igThicknessIn: number | null;
  coating: string | null; gas: string | null; dividerCode: string | null; divider: string | null;
  /** the rating: the range's maximum in W/m²K (conservative), the minimum beside it; SHGC the midpoint; VT null when not published */
  uWm2k: number; uMinWm2k: number | null; shgc: number; vt: number | null;
  uIpMin: number | null; uIpMax: number | null; shgcMin: number | null; shgcMax: number | null;
  keywords: string[] | null; notes: string | null;
}
export interface ReferenceRead { materials: MaterialRow[]; products: GlazingProduct[]; keywords: { targetKey: string; words: string[] }[]; skipped: Record<string, number>; problems: string[] }
const kwOf = (s: string | undefined): string[] | null => { const k = (s ?? "").split(";").map((x) => x.trim()).filter(Boolean); return k.length ? k : null; };
const numOr = (s: string | undefined): number | null => num(s);

/** THE ENGINE'S OWN WINDOW CONSTRUCTIONS (2026-09-17): DataSets/WindowConstructs.idf states U, SHGC, TSOL and TVIS for
 *  each one in the `!` banner above it (centre of glass, the file's own words). They are read into the fenestration
 *  table as CONSTRUCTION rows — a pick stages the library ruling the resolver already writes, the objects verbatim. */
export function readWindowConstructions(file: string, text: string): GlazingProduct[] {
  const out: GlazingProduct[] = [];
  for (const o of parseIdfObjects(text, file)) {
    if (o.cls !== "Construction") continue;
    const note = windowNote(o);
    if (!note) continue;
    const layers = o.fields.slice(1).filter(Boolean).length;
    out.push({
      key: `epwin:${o.name}`, name: o.name, sourceId: "epwin",
      sourceRef: `EnergyPlus DataSets/${file} — the file's own note: U=${note.u} SHGC=${note.shgc}${note.tsol !== null ? ` TSOL=${note.tsol}` : ""}${note.tvis !== null ? ` TVIS=${note.tvis}` : ""} (centre of glass, no frame)`,
      section: "any", rowKind: "construction", libFile: file, libName: o.name, nameGroup: nameGroup(o.name),
      productType: `${layers} layer${layers === 1 ? "" : "s"}`, cpd: null, glassOption: null, panes: null, igThicknessIn: null,
      coating: null, gas: null, dividerCode: null, divider: null,
      uWm2k: note.u, uMinWm2k: null, shgc: note.shgc, vt: note.tvis,
      uIpMin: null, uIpMax: null, shgcMin: null, shgcMax: null, keywords: null,
      notes: "centre of glass — the glazing alone, no frame; the layers are the engine's own objects, emitted verbatim",
    });
  }
  return out;
}

/** THE REFERENCE CSVs READ (2026-09-16), told apart by their header: the opaque list (`ifc_match_keywords` + `conductivity_W_mK`),
 *  the window list (`optical_data_type`) — its glazing and gas LAYER rows are the DataSets' own and are skipped, counted; its
 *  SimpleGlazingSystem rows become generic products — and the Marvin list (`nfrc_cpd`). A row that cannot be read is named */
export function readReferenceCsv(file: string, text: string): ReferenceRead {
  const csv = parseCsv(text);
  const out: ReferenceRead = { materials: [], products: [], keywords: [], skipped: {}, problems: [] };
  const recs = csv.rows.map((r) => Object.fromEntries(csv.header.map((h, i) => [h, (r[i] ?? "").trim()])) as Record<string, string>);
  const skip = (k: string): void => { out.skipped[k] = (out.skipped[k] ?? 0) + 1; };
  const h = new Set(csv.header);
  // THE KEYWORD MAP (user, 2026-09-18: "the data is from some source … that should be the dataset id" — the reference
  // list states none, so its NUMBERS are not seeded; its IFC match keywords are carried onto a row that does cite one)
  if (h.has("target_key") && h.has("keywords")) {
    for (const m of recs) {
      const words = kwOf(m.keywords);
      if (!words) continue;
      if (!m.target_key) { skip("keywords with no cited row to carry them"); continue; }
      out.keywords.push({ targetKey: m.target_key, words });
    }
  } else if (h.has("nfrc_cpd") && h.has("u_factor_W_m2K")) {
    for (const m of recs) {
      const u = num(m.u_factor_W_m2K), shgc = num(m.solar_heat_gain_coefficient);
      if (!m.id || u === null || u <= 0 || shgc === null) { out.problems.push(`${m.id || "?"}: no U or SHGC`); continue; }
      const section = /door/i.test(m.category ?? "") ? "door" : "window";
      // the LINE is the CSV's own `collection` word — Elevate and Essential are separate DataSets in the palette's filter
      const line = m.collection || "Elevate", sid = /essential/i.test(line) ? "marvin-essential" : "marvin";
      out.products.push({
        key: `${sid}:${m.id}`, name: `${m.nfrc_cpd} ${m.product_type} · ${m.glass_option} · ${m.divider_description}`, sourceId: sid,
        sourceRef: `NFRC CPD ${m.nfrc_cpd} · Marvin ${line} ${m.product_type} (${m.id})`, section,
        rowKind: "product", libFile: null, libName: null, nameGroup: m.product_type || "—",
        productType: m.product_type ?? "", cpd: m.nfrc_cpd || null, glassOption: m.glass_option || null, panes: numOr(m.panes), igThicknessIn: numOr(m.ig_thickness_in),
        coating: m.low_e_coating_tint || null, gas: m.gas_fill || null, dividerCode: m.divider_code || null, divider: m.divider_description || null,
        uWm2k: u, uMinWm2k: numOr(m.u_factor_min_W_m2K), shgc, vt: numOr(m.visible_transmittance), uIpMin: numOr(m.u_factor_min_IP), uIpMax: numOr(m.u_factor_max_IP), shgcMin: numOr(m.shgc_min), shgcMax: numOr(m.shgc_max),
        keywords: kwOf(m.ifc_match_keywords), notes: m.notes || null,
      });
    }
  } else if (h.has("optical_data_type")) {
    for (const m of recs) {
      if (m.eplus_object !== "WindowMaterial:SimpleGlazingSystem") { skip(`${m.eplus_object || "?"} (the DataSets' own)`); continue; }
      // 2026-09-18: "typical center-of-glass values in the style of ASHRAE HOF Ch.15; not product-certified" is the
      // file's own word on them — no authority to name, so they are left out; the engine's 207 window constructions
      // are the cited generic sets and carry their U, SHGC and VT from their own banners
      skip("generic glazing sets (uncertified — the engine's own window constructions are the cited generic sets)");
    }
  } else if (h.has("ifc_match_keywords") && h.has("conductivity_W_mK")) {
    for (const m of recs) {
      const cls = m.eplus_object as MaterialClass;
      if (!(cls === "Material" || cls === "Material:NoMass" || cls === "Material:AirGap")) { skip(m.eplus_object || "no class"); continue; }
      if (!m.id || !m.name) { out.problems.push(`${m.id || "?"}: no id or name`); continue; }
      const mass = cls === "Material";
      out.materials.push({
        key: `opus:${m.id}`, name: m.name ?? "", cls, kind: kindOfName(m.name ?? "", cls, m.category || null), roughness: cls === "Material:AirGap" ? null : m.roughness || null,
        thicknessM: mass ? num(m.thickness_m) : null, conductivityWmK: mass ? num(m.conductivity_W_mK) : null, densityKgM3: mass ? num(m.density_kg_m3) : null, specificHeatJKgK: mass ? num(m.specific_heat_J_kgK) : null,
        rSi: mass ? null : num(m.thermal_resistance_m2K_W), thermalAbs: cls === "Material:AirGap" ? null : num(m.thermal_absorptance), solarAbs: cls === "Material:AirGap" ? null : num(m.solar_absorptance), visibleAbs: cls === "Material:AirGap" ? null : num(m.visible_absorptance),
        sourceId: "opus", sourceRef: `derived by Claude Opus · reference list ${m.id} (${m.category || "no category"})${m.notes ? ` · ${m.notes}` : ""}`, unitsAsFetched: "SI", fetchedJson: JSON.stringify(m), notes: m.notes || null, addedAt: "",
        keywords: kwOf(m.ifc_match_keywords),
      });
    }
  } else out.problems.push(`${file}: a header no reader knows (${csv.header.slice(0, 5).join(", ")}…)`);
  return out;
}

const DDL = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS datasets (key TEXT PRIMARY KEY, source_id TEXT NOT NULL, kind TEXT NOT NULL, source_class TEXT NOT NULL, provider TEXT NOT NULL, set_name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, source_class TEXT NOT NULL, provider TEXT NOT NULL, label TEXT NOT NULL, url TEXT, attribution TEXT NOT NULL, license TEXT NOT NULL, units TEXT NOT NULL, keyless INTEGER NOT NULL, search_url TEXT, pin TEXT, note TEXT, fetched_at TEXT, sha256 TEXT);
CREATE TABLE IF NOT EXISTS materials (
  key TEXT PRIMARY KEY, name TEXT NOT NULL, class TEXT NOT NULL, kind TEXT NOT NULL, roughness TEXT, dataset_key TEXT NOT NULL DEFAULT '',
  thickness_m REAL, conductivity_w_mk REAL, density_kg_m3 REAL, specific_heat_j_kgk REAL, r_si REAL,
  thermal_abs REAL, solar_abs REAL, visible_abs REAL,
  source_id TEXT NOT NULL, source_ref TEXT NOT NULL, units_as_fetched TEXT NOT NULL, fetched_json TEXT, notes TEXT, added_at TEXT NOT NULL,
  keywords TEXT, name_group TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS materials_ck ON materials (class, kind);
CREATE INDEX IF NOT EXISTS materials_ng ON materials (name_group);
CREATE TABLE IF NOT EXISTS fenestration (
  key TEXT PRIMARY KEY, name TEXT NOT NULL, source_id TEXT NOT NULL, source_ref TEXT NOT NULL, section TEXT NOT NULL,
  row_kind TEXT NOT NULL, lib_file TEXT, lib_name TEXT,
  product_type TEXT NOT NULL, cpd TEXT, glass_option TEXT, panes INTEGER, ig_thickness_in REAL, coating TEXT, gas TEXT, divider_code TEXT, divider TEXT,
  u_w_m2k REAL NOT NULL, u_min_w_m2k REAL, shgc REAL NOT NULL, vt REAL, u_ip_min REAL, u_ip_max REAL, shgc_min REAL, shgc_max REAL,
  keywords TEXT, notes TEXT, name_group TEXT NOT NULL, dataset_key TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS fenestration_s ON fenestration (section, product_type);
CREATE INDEX IF NOT EXISTS fenestration_ng ON fenestration (name_group);`;

/** `reference`: the CSVs under references/materials/ (2026-09-16), by base name */
/** `manifest` (2026-11-12): the sources and datasets a project's own reference lists fill (its data sources' referenceManifest) — rows the
 *  palette's Source and DataSet filters offer beside the shipped ones; none ships with the program */
export interface ReferenceManifest { sources: MaterialSource[]; datasets: typeof DATASETS }
export interface MaterialsSeeds { datasets: Array<{ file: string; text: string }>; osstdJson: string | null; user: MaterialRow[]; reference?: Array<{ file: string; text: string }>; userFen?: GlazingProduct[]; manifest?: ReferenceManifest }
export interface MaterialsCensus {
  datasets: { material: number; nomass: number; airgap: number; provenance: number; refused: string[] };
  osstd: { rows: number; of: number; skipped: Record<string, number> } | null;
  user: { rows: number; fenestration: number; rejected: string[] };
  reference: { materials: number; keywords: number; keywordsMapped: number; keywordsUnmapped: number; keywordsMissing: string[]; products: { marvin: number; essential: number; window: number; door: number; essentialWindow: number; essentialDoor: number; generic: number; constructions: number }; skipped: Record<string, number>; rejected: string[] };
  sources: number;
}

/** what the seeds are: their shas, so the db is rebuilt exactly when an input moved */
export function seedSha(seeds: MaterialsSeeds): string {
  return sha256Hex([MATERIALS_SCHEMA, ...seeds.datasets.map((d) => `${d.file}:${sha256Hex(d.text)}`), `osstd:${seeds.osstdJson ? sha256Hex(seeds.osstdJson) : "none"}`, `user:${sha256Hex(JSON.stringify(seeds.user))}`, `userFen:${sha256Hex(JSON.stringify(seeds.userFen ?? []))}`, ...(seeds.reference ?? []).map((d) => `reference ${d.file}:${sha256Hex(d.text)}`), ...(seeds.manifest ? [`manifest:${sha256Hex(JSON.stringify(seeds.manifest))}`] : [])].join("\n"));
}

/** the database from its seeds, in one pass; the census says what was taken and what was refused, by name */
export function buildMaterialsDb(SQL: SqlJsStatic, seeds: MaterialsSeeds): { db: Database; census: MaterialsCensus } {
  const db = new SQL.Database();
  db.run(DDL);
  const stamp = now();
  const allSources = [...SOURCES, ...(seeds.manifest?.sources ?? [])];
  for (const s of allSources) db.run("INSERT INTO sources (id, name, kind, source_class, provider, label, url, attribution, license, units, keyless, search_url, pin, note, fetched_at, sha256) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [s.id, s.name, s.kind, s.sourceClass, s.provider, s.label, s.url, s.attribution, s.license, s.units, s.keyless ? 1 : 0, s.searchUrl, s.pin, s.note, s.id === "osstd" && seeds.osstdJson ? stamp : null, s.id === "osstd" && seeds.osstdJson ? sha256Hex(seeds.osstdJson) : null]);
  for (const d of resolveDataSets(allSources, undefined, seeds.manifest?.datasets ?? [])) db.run("INSERT INTO datasets (key, source_id, kind, source_class, provider, set_name) VALUES (?,?,?,?,?,?)", [d.key, d.sourceId, d.kind, d.sourceClass, d.provider, d.set]);
  const ins = db.prepare("INSERT OR REPLACE INTO materials (key, dataset_key, name, class, kind, roughness, thickness_m, conductivity_w_mk, density_kg_m3, specific_heat_j_kgk, r_si, thermal_abs, solar_abs, visible_abs, source_id, source_ref, units_as_fetched, fetched_json, notes, added_at, keywords, name_group) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const put = (r: MaterialRow): void => { ins.run([r.key, r.datasetKey ?? dataSetKeyOf(r.sourceId, "material"), r.name, r.cls, r.kind, r.roughness, r.thicknessM, r.conductivityWmK, r.densityKgM3, r.specificHeatJKgK, r.rSi, r.thermalAbs, r.solarAbs, r.visibleAbs, r.sourceId, r.sourceRef, r.unitsAsFetched, r.fetchedJson, r.notes, r.addedAt || stamp, r.keywords?.length ? r.keywords.join(";") : null, nameGroup(r.name)]); };
  const census: MaterialsCensus = { datasets: { material: 0, nomass: 0, airgap: 0, provenance: 0, refused: [] }, osstd: null, user: { rows: 0, fenestration: 0, rejected: [] }, reference: { materials: 0, keywords: 0, keywordsMapped: 0, keywordsUnmapped: 0, keywordsMissing: [], products: { marvin: 0, essential: 0, window: 0, door: 0, essentialWindow: 0, essentialDoor: 0, generic: 0, constructions: 0 }, skipped: {}, rejected: [] }, sources: allSources.length };
  // the DataSets: every opaque material, a composite's numbered equivalents (#n) left on the library path
  for (const d of seeds.datasets) {
    for (const o of parseIdfObjects(d.text, d.file)) {
      if (!(o.cls === "Material" || o.cls === "Material:NoMass" || o.cls === "Material:AirGap") || / #\d+$/.test(o.name)) continue;
      const row = rowFromIdfObject(o, "hof2005", condenseProvenance(o.provenance, d.file));
      if (!row) { census.datasets.refused.push(`${d.file}: ${o.name}`); continue; }
      put(row);
      if (o.cls === "Material") census.datasets.material++; else if (o.cls === "Material:NoMass") census.datasets.nomass++; else census.datasets.airgap++;
      if (o.provenance) census.datasets.provenance++;
    }
  }
  if (seeds.osstdJson) {
    const rows = (JSON.parse(seeds.osstdJson) as { materials?: Array<Record<string, unknown>> }).materials ?? [];
    const used = new Set<string>();
    census.osstd = { rows: 0, of: rows.length, skipped: {} };
    for (const m of rows) {
      const { row, skipped } = rowFromOsstd(m, used);
      if (row) { put(row); census.osstd.rows++; } else if (skipped) census.osstd.skipped[skipped] = (census.osstd.skipped[skipped] ?? 0) + 1;
    }
  }
  // THE REFERENCE LISTS (2026-09-16): the opaque rows with their keywords; the Marvin ratings and the generic sets into
  // the fenestration table; a glazing or gas LAYER row is the DataSets' own and is skipped, counted
  const pins = db.prepare("INSERT OR REPLACE INTO fenestration (key, name, source_id, source_ref, section, row_kind, lib_file, lib_name, product_type, cpd, glass_option, panes, ig_thickness_in, coating, gas, divider_code, divider, u_w_m2k, u_min_w_m2k, shgc, vt, u_ip_min, u_ip_max, shgc_min, shgc_max, keywords, notes, name_group, dataset_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const putFen = (g: GlazingProduct): void => pins.run([g.key, g.name, g.sourceId, g.sourceRef, g.section, g.rowKind, g.libFile, g.libName, g.productType, g.cpd, g.glassOption, g.panes, g.igThicknessIn, g.coating, g.gas, g.dividerCode, g.divider, g.uWm2k, g.uMinWm2k, g.shgc, g.vt, g.uIpMin, g.uIpMax, g.shgcMin, g.shgcMax, g.keywords?.join(";") ?? null, g.notes, g.nameGroup ?? nameGroup(g.name), dataSetKeyOf(g.sourceId, "fenestration")]);
  // THE ENGINE'S OWN WINDOW CONSTRUCTIONS into the same table (2026-09-17) — the fenestration datasets in one place
  for (const d of seeds.datasets) {
    if (!/^WindowConstructs/.test(d.file)) continue;
    for (const g of readWindowConstructions(d.file, d.text)) { putFen(g); census.reference.products.constructions++; }
  }
  const keywordMap: { targetKey: string; words: string[] }[] = [];
  for (const f of seeds.reference ?? []) {
    const read = readReferenceCsv(f.file, f.text);
    for (const r of read.materials) {
      const why = validateRow(r);
      if (why) { census.reference.rejected.push(`${f.file} ${r.key}: ${why}`); continue; }
      put(r); census.reference.materials++; if (r.keywords?.length) census.reference.keywords++;
    }
    for (const g of read.products) {
      putFen(g);
      if (g.sourceId === "marvin") { census.reference.products.marvin++; if (g.section === "door") census.reference.products.door++; else census.reference.products.window++; }
      else if (g.sourceId === "marvin-essential") { census.reference.products.essential++; if (g.section === "door") census.reference.products.essentialDoor++; else census.reference.products.essentialWindow++; }
      else census.reference.products.generic++;
    }
    for (const e of read.keywords) keywordMap.push(e);
    for (const [k, n] of Object.entries(read.skipped)) census.reference.skipped[k] = (census.reference.skipped[k] ?? 0) + n;
    census.reference.rejected.push(...read.problems.map((p) => `${f.file}: ${p}`));
  }
  // the user's own FENESTRATION rows (2026-09-17), from the same sidecar — checked by the one rule the dialog uses
  for (const g of seeds.userFen ?? []) {
    const { row, why } = handFenestration({ name: g.name, section: g.section, group: g.nameGroup ?? null, uWm2k: g.uWm2k, shgc: g.shgc, vt: g.vt, sourceName: g.sourceRef, sourceUrl: "" });
    if (!row) { census.user.rejected.push(`${g.name || g.key}: ${why}`); continue; }
    putFen({ ...g, sourceId: "hand" }); census.user.fenestration++;
  }
  pins.free();
  for (const r of seeds.user) {
    const why = validateRow(r);
    if (why) { census.user.rejected.push(`${r.name || r.key}: ${why}`); continue; }
    put(r); census.user.rows++;
  }
  ins.free();
  // THE KEYWORD MAP APPLIED (2026-09-18): the reference list's IFC match keywords land on the CITED row each entry
  // names — its numbers are the authority's, the keyword is the user's own matching. A target the db does not hold
  // is named, never silently dropped.
  census.reference.keywordsUnmapped = census.reference.skipped["keywords with no cited row to carry them"] ?? 0;
  for (const { targetKey, words } of keywordMap) {
    const cur = db.exec("SELECT keywords FROM materials WHERE key = ?", [targetKey])[0]?.values[0]?.[0];
    if (cur === undefined) { census.reference.keywordsMissing.push(targetKey); continue; }
    const merged = [...new Set([...(cur === null ? [] : String(cur).split(";")), ...words])].filter(Boolean);
    db.run("UPDATE materials SET keywords = ? WHERE key = ?", [merged.join(";"), targetKey]);
    census.reference.keywordsMapped++;
  }
  for (const [k, v] of Object.entries({ schema_version: MATERIALS_SCHEMA, seed_sha256: seedSha(seeds), created_at: stamp, osstd_pin: OSSTD_PIN })) db.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", [k, v]);
  stampMaterialsContentSha(db);
  return { db, census };
}

/** an existing file, or null when it is not a materials.db of this schema */
export function openMaterialsDb(SQL: SqlJsStatic, bytes: Uint8Array): Database | null {
  try {
    const db = new SQL.Database(bytes);
    const v = db.exec("SELECT value FROM meta WHERE key = 'schema_version'")[0]?.values[0]?.[0];
    if (String(v) !== MATERIALS_SCHEMA) { db.close(); return null; }
    return db;
  } catch { return null; }
}
export function readMaterialsMeta(db: Database): Map<string, string> {
  return new Map((db.exec("SELECT key, value FROM meta")[0]?.values ?? []).map((r) => [String(r[0]), String(r[1])]));
}
/** the rows' own hash (added_at and fetched_at excluded), stamped after the last write — what bem.db records as source_materials_sha256 */
export function stampMaterialsContentSha(db: Database): string {
  const lines: string[] = [];
  for (const r of db.exec("SELECT key, dataset_key, name, class, kind, roughness, thickness_m, conductivity_w_mk, density_kg_m3, specific_heat_j_kgk, r_si, thermal_abs, solar_abs, visible_abs, source_id, source_ref, keywords FROM materials ORDER BY key")[0]?.values ?? []) lines.push(r.map((v) => (v === null ? "" : String(v))).join("|"));
  for (const r of db.exec("SELECT key, name, source_id, source_ref, section, row_kind, lib_file, lib_name, product_type, u_w_m2k, shgc, vt, name_group FROM fenestration ORDER BY key")[0]?.values ?? []) lines.push(r.map((v) => (v === null ? "" : String(v))).join("|"));
  for (const r of db.exec("SELECT id, name, kind, source_class, provider, label, url, license, search_url, pin FROM sources ORDER BY id")[0]?.values ?? []) lines.push(r.map((v) => (v === null ? "" : String(v))).join("|"));
  for (const r of db.exec("SELECT key, source_id, kind, source_class, provider, set_name FROM datasets ORDER BY key")[0]?.values ?? []) lines.push(r.map((v) => (v === null ? "" : String(v))).join("|"));
  const sha = sha256Hex(lines.join("\n"));
  db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('content_sha256', ?)", [sha]);
  return sha;
}

const rowOf = (r: unknown[]): MaterialRow => ({
  key: String(r[0]), name: String(r[1]), cls: String(r[2]) as MaterialClass, kind: String(r[3]) as MaterialKind, roughness: r[4] === null ? null : String(r[4]),
  thicknessM: r[5] === null ? null : Number(r[5]), conductivityWmK: r[6] === null ? null : Number(r[6]), densityKgM3: r[7] === null ? null : Number(r[7]), specificHeatJKgK: r[8] === null ? null : Number(r[8]), rSi: r[9] === null ? null : Number(r[9]),
  thermalAbs: r[10] === null ? null : Number(r[10]), solarAbs: r[11] === null ? null : Number(r[11]), visibleAbs: r[12] === null ? null : Number(r[12]),
  sourceId: String(r[13]), sourceRef: String(r[14]), unitsAsFetched: String(r[15]) as MaterialRow["unitsAsFetched"], fetchedJson: r[16] === null ? null : String(r[16]), notes: r[17] === null ? null : String(r[17]), addedAt: String(r[18]),
  keywords: r[19] === null || r[19] === undefined ? null : String(r[19]).split(";").filter(Boolean),
  nameGroup: r[20] === null || r[20] === undefined ? nameGroup(String(r[1])) : String(r[20]),
  datasetKey: r[21] === null || r[21] === undefined || String(r[21]) === "" ? null : String(r[21]),
});
const COLS = "key, name, class, kind, roughness, thickness_m, conductivity_w_mk, density_kg_m3, specific_heat_j_kgk, r_si, thermal_abs, solar_abs, visible_abs, source_id, source_ref, units_as_fetched, fetched_json, notes, added_at, keywords, name_group, dataset_key";
/** the rows, optionally by class, kind, or a text over name · kind · source */
export function queryMaterials(db: Database, q: { cls?: MaterialClass; kind?: MaterialKind; text?: string } = {}): MaterialRow[] {
  const where: string[] = [], args: (string | number)[] = [];
  if (q.cls) { where.push("class = ?"); args.push(q.cls); }
  if (q.kind) { where.push("kind = ?"); args.push(q.kind); }
  if (q.text) { where.push("(name LIKE ? OR kind LIKE ? OR source_ref LIKE ? OR source_id LIKE ? OR keywords LIKE ?)"); const t = `%${q.text}%`; args.push(t, t, t, t, t); }
  return (db.exec(`SELECT ${COLS} FROM materials${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY name`, args)[0]?.values ?? []).map(rowOf);
}
/** THE FENESTRATION DATASETS (2026-09-17): every row, or those a track offers — its own section and the `any` rows —
 *  the engine's window constructions, the reference list's generic sets and the manufacturers' ratings in one table */
export function queryFenestration(db: Database, section?: "window" | "door" | "skylight"): GlazingProduct[] {
  const where = section ? " WHERE section = ? OR section = 'any'" : "";
  return (db.exec(`SELECT key, name, source_id, source_ref, section, row_kind, lib_file, lib_name, product_type, cpd, glass_option, panes, ig_thickness_in, coating, gas, divider_code, divider, u_w_m2k, u_min_w_m2k, shgc, vt, u_ip_min, u_ip_max, shgc_min, shgc_max, keywords, notes, name_group FROM fenestration${where} ORDER BY source_id, product_type, name`, section ? [section] : [])[0]?.values ?? []).map((r) => {
    const s = (i: number): string | null => (r[i] === null ? null : String(r[i]));
    const n = (i: number): number | null => (r[i] === null ? null : Number(r[i]));
    return { key: String(r[0]), name: String(r[1]), sourceId: String(r[2]), sourceRef: String(r[3]), section: String(r[4]) as GlazingProduct["section"], rowKind: String(r[5]) as GlazingProduct["rowKind"], libFile: s(6), libName: s(7), productType: String(r[8]), cpd: s(9), glassOption: s(10), panes: n(11), igThicknessIn: n(12), coating: s(13), gas: s(14), dividerCode: s(15), divider: s(16), uWm2k: Number(r[17]), uMinWm2k: n(18), shgc: Number(r[19]), vt: n(20), uIpMin: n(21), uIpMax: n(22), shgcMin: n(23), shgcMax: n(24), keywords: r[25] === null ? null : String(r[25]).split(";").filter(Boolean), notes: s(26), nameGroup: s(27) };
  });
}
/** the datasets as the db holds them (2026-09-18) — the filters' taxonomy, read back like every other table */
export function queryDataSets(db: Database): ResolvedDataSet[] {
  return (db.exec("SELECT key, source_id, kind, source_class, provider, set_name FROM datasets ORDER BY kind, provider, set_name")[0]?.values ?? []).map((r) => ({
    key: String(r[0]), sourceId: String(r[1]), kind: String(r[2]) as DataKind, sourceClass: String(r[3]) as SourceClass,
    provider: String(r[4]), set: String(r[5]), label: `${String(r[4])} - ${String(r[5])}`,
  }));
}

export function querySources(db: Database): MaterialSource[] {
  return (db.exec("SELECT id, name, kind, source_class, provider, label, url, attribution, license, units, keyless, search_url, pin, note FROM sources ORDER BY rowid")[0]?.values ?? []).map((r) => ({
    id: String(r[0]), name: String(r[1]), kind: String(r[2]) as MaterialSource["kind"], sourceClass: String(r[3]) as SourceClass, provider: String(r[4]), label: String(r[5]), url: r[6] === null ? null : String(r[6]), attribution: String(r[7]), license: String(r[8]), units: String(r[9]) as MaterialSource["units"], keyless: Number(r[10]) === 1, searchUrl: r[11] === null ? null : String(r[11]), pin: r[12] === null ? null : String(r[12]), note: String(r[13] ?? ""),
  }));
}

const sig = (n: number, s = 6): string => String(Number(n.toPrecision(s)));
/** THE ADAPTER: a row as the IDF takes it — the class and every field in the IDD's order, the name first — so the resolver, the R arithmetic and the writer read it like a dataset object */
export function materialToIdfObject(r: MaterialRow): IdfObject {
  const name = r.name.replace(/[,;!]/g, "_").replace(/\s+/g, " ").trim();
  const abs = [sig(r.thermalAbs ?? 0.9), sig(r.solarAbs ?? 0.7), sig(r.visibleAbs ?? 0.7)];
  const fields = r.cls === "Material" ? [name, r.roughness ?? "MediumRough", sig(r.thicknessM ?? 0), sig(r.conductivityWmK ?? 0), sig(r.densityKgM3 ?? 0), sig(r.specificHeatJKgK ?? 0), ...abs]
    : r.cls === "Material:NoMass" ? [name, r.roughness ?? "MediumRough", sig(r.rSi ?? 0), ...abs]
    : [name, sig(r.rSi ?? 0)];
  return { cls: r.cls, name, fields, file: `materials:${r.sourceId}`, note: null, key: r.key, kind: r.kind, provenance: r.sourceRef };
}
/** the object as IDF text, for the round trip the gate checks */
export const idfObjectText = (o: IdfObject): string => `${o.cls},\n  ${o.fields.join(",\n  ")};\n`;

export type MaterialRef = { key: string } | { file: string; name: string };
/** the library with the database's rows beside the datasets: `materials` by key, and by name where the datasets have no object of that name */
export function withMaterials(lib: Library, rows: MaterialRow[]): Library {
  const materials = new Map<string, IdfObject>();
  const byName = new Map(lib.byName);
  for (const r of rows) { const o = materialToIdfObject(r); materials.set(r.key, o); if (!byName.has(o.name)) byName.set(o.name, o); }
  return { ...lib, byName, materials };
}
/** a ruling's reference → the object: by KEY for a materials.db row, by name for a dataset pick */
export function resolveMaterialRef(lib: Library, ref: MaterialRef): IdfObject | null {
  return ("key" in ref ? lib.materials?.get(ref.key) : lib.byName.get(ref.name)) ?? null;
}

/** THE USER'S OWN ROWS COME FIRST (2026-09-08, "the new material does not show for replacement"): the seeds are 1,277 rows
 *  ranked by a name match and cut at eight, and a row the user saved for this very layer fell below the cut — or, named
 *  freely ("HardiePlank 5/16"), never matched at all. A saved row (hand, bcl) of the layer's KIND is a candidate whatever its
 *  name, ahead of the seeds; the name-matched seeds follow. A layer the file draws at 0 mm still takes massless rows only */
/** THE REFERENCE LIST'S KEYWORDS MATCH THE FILE'S WORD (2026-09-16): a row matches a layer when one of its keywords lies
 *  inside the layer's material name ("clapboard" in "Siding, Clapboard"), or every word of a short layer name is a whole
 *  word of the keyword ("Air" → "air gap"); case-blind. A keyword matches or it does not — nothing is scored */
export function keywordMatch(r: { keywords?: string[] | null }, material: string): boolean {
  if (!r.keywords?.length) return false;
  const n = material.toLowerCase();
  const words = n.split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  return r.keywords.some((k) => {
    const kk = k.toLowerCase().trim();
    if (!kk) return false;
    if (n.includes(kk)) return true;
    const kw = new Set(kk.split(/[^a-z0-9]+/));
    return words.length > 0 && words.every((w) => kw.has(w));
  });
}
export function candidateRows(rows: MaterialRow[], lib: Library | null, layer: { material: string; thicknessM: number | null; category: string | null }, ruledKind?: MaterialKind | null): MaterialRow[] {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const matched = lib ? matchMaterials(lib, layer).map((o) => (o.key ? byKey.get(o.key) : undefined)).filter((r): r is MaterialRow => !!r) : [];
  const isMine = (r: MaterialRow): boolean => r.sourceId === "hand" || r.sourceId === "bcl";
  // the reference list's keyword matches come right after the user's own rows (2026-09-16)
  const byKeyword = rows.filter((r) => !isMine(r) && keywordMatch(r, layer.material));
  // THE LAYER'S CATEGORY RULED (2026-09-08): every row of that kind is a candidate — the user's first, the keyword matches,
  // the name-matched next, the rest by name; a 0 mm layer takes a row with mass too, since a pick carries its own thickness
  if (ruledKind) {
    const mine = rows.filter((r) => isMine(r) && r.kind === ruledKind);
    const kw = byKeyword.filter((r) => r.kind === ruledKind);
    const named = matched.filter((r) => r.kind === ruledKind && !mine.some((x) => x.key === r.key) && !kw.some((x) => x.key === r.key));
    const taken = new Set([...mine, ...kw, ...named].map((r) => r.key));
    const rest = rows.filter((r) => r.kind === ruledKind && !taken.has(r.key)).sort((a, b) => a.name.localeCompare(b.name));
    return [...mine, ...kw, ...named, ...rest];
  }
  const kind = kindOfName(layer.material, "Material", layer.category);
  const mine = rows.filter((r) => isMine(r) && (r.kind === kind || matched.some((x) => x.key === r.key)));
  const taken = new Set([...mine, ...byKeyword].map((r) => r.key));
  return [...mine, ...byKeyword, ...matched.filter((r) => !taken.has(r.key))];
}

/** THE ENGINE'S OWN DEFAULTS for a material's surface (the IDD: thermal 0.9, solar 0.7, visible 0.7) — what a blank field becomes */
export const ENGINE_ABS = { thermal: 0.9, solar: 0.7, visible: 0.7 } as const;
/** IS A ROW'S SURFACE STATED? (user, 2026-09-29: "the listed reflectance value of 0.30 for standard asphalt shingles doesn't look
 *  right"). Measured: no HOF row states an absorptance, and 49 of the catalogue's 104 that do carry exactly the engine's three
 *  defaults with no standard named — a copy of the defaults, read as defaults, never as a measurement. Every other value is stated */
export function absStated(m: MaterialRow): { thermal: boolean; solar: boolean } {
  const copy = m.sourceId === "osstd" && m.thermalAbs === ENGINE_ABS.thermal && m.solarAbs === ENGINE_ABS.solar && m.visibleAbs === ENGINE_ABS.visible;
  return { thermal: m.thermalAbs !== null && !copy, solar: m.solarAbs !== null && !copy };
}

/** A PICK CARRIES ITS OWN THICKNESS (user, 2026-09-08: "view list and component width do not update in view"): a row that
 *  states a thickness — a product's 5/16 in, a dataset's 12.7 mm — makes the layer that thick, in the drawing, the list and
 *  the IDF; the file's drawn thickness is kept when the row states none (a massless row) or states the file's own. The
 *  thickness row under the pick restores the file's. `thicknessM: undefined` clears an earlier override on a re-pick */
export function layerPickFor(m: MaterialRow, fileThicknessM: number | null): { ref: MaterialRef; parts: undefined; rSi: undefined; thicknessM: number | undefined } {
  const own = m.cls === "Material" && m.thicknessM !== null && m.thicknessM > 0 ? m.thicknessM : null;
  const differs = own !== null && (fileThicknessM === null || Math.abs(own - fileThicknessM) > 1e-4);
  return { ref: { key: m.key }, parts: undefined, rSi: undefined, thicknessM: differs ? own : undefined };
}

/** THE USER'S ROWS SURVIVE A LOST SIDECAR (2026-09-08, after the sidecar was deleted in a clean-up and the user's
 *  hand-typed materials with it): materials.db itself carries every saved row, so on a rebuild the rows the previous
 *  file held (hand, bcl — anything not a seed) are carried forward when the sidecar lacks them, and written back to it */
export function mergeUserRows(sidecar: MaterialRow[], previous: MaterialRow[], removed: string[] = []): { rows: MaterialRow[]; recovered: MaterialRow[] } {
  const have = new Set(sidecar.map((r) => r.key)), gone = new Set(removed);
  const recovered = previous.filter((r) => (r.sourceId === "hand" || r.sourceId === "bcl") && !have.has(r.key) && !gone.has(r.key));
  return { rows: [...sidecar, ...recovered], recovered };
}
/** the sidecar's two forms: the first days' bare array, or `{ rows, removed }` — a row the user removed is remembered
 *  by its key so the carry-forward never resurrects it */
export interface Sidecar { rows: MaterialRow[]; removed: string[]; fenestration?: GlazingProduct[] }
export function readSidecar(text: string | null): Sidecar {
  if (!text) return { rows: [], removed: [], fenestration: [] };
  const v = JSON.parse(text) as MaterialRow[] | Partial<Sidecar>;
  return Array.isArray(v) ? { rows: v, removed: [], fenestration: [] } : { rows: v.rows ?? [], removed: v.removed ?? [], fenestration: v.fenestration ?? [] };
}
export const writeSidecar = (s: Sidecar): string => JSON.stringify({ rows: s.rows, removed: s.removed, fenestration: s.fenestration ?? [] }, null, 1);

/** THE USER'S OWN FENESTRATION ROW (2026-09-17): a window, glazed door or skylight assembly typed by hand — the
 *  label's whole-product U, its SHGC and (where published) VT, with the document or page it was read from. It goes
 *  into the sidecar beside the hand materials and is seeded into the fenestration table as a row of YOURS. */
export function handFenestration(h: {
  name: string; section: "window" | "door" | "skylight" | "any"; group: string | null;
  uWm2k: number | null; shgc: number | null; vt: number | null; sourceName: string; sourceUrl: string;
}): { row: GlazingProduct | null; why: string | null } {
  const name = h.name.trim();
  if (!name) return { row: null, why: "a name" };
  if (h.uWm2k === null || !(h.uWm2k > 0)) return { row: null, why: "a U above zero" };
  if (h.shgc === null || h.shgc <= 0 || h.shgc > 1) return { row: null, why: "an SHGC between 0 and 1" };
  if (h.vt !== null && (h.vt <= 0 || h.vt > 1)) return { row: null, why: "a VT between 0 and 1, or none" };
  const src = h.sourceName.trim(), url = /^https?:\/\//i.test(h.sourceUrl.trim()) ? h.sourceUrl.trim() : "";
  if (!src && !url) return { row: null, why: "the source — the document by name, or its page" };
  const key = `fen:${sha256Hex([name, h.section, String(h.uWm2k), String(h.shgc), String(h.vt ?? ""), src, url].join("|")).slice(0, 12)}`;
  return { row: {
    key, name, sourceId: "hand", sourceRef: `${src || url}${src && url ? ` · ${url}` : ""} — typed by hand`,
    section: h.section, rowKind: "product", libFile: null, libName: null, nameGroup: (h.group ?? "").trim() || nameGroup(name),
    productType: (h.group ?? "").trim() || "typed by hand", cpd: null, glassOption: null, panes: null, igThicknessIn: null,
    coating: null, gas: null, dividerCode: null, divider: null,
    uWm2k: h.uWm2k, uMinWm2k: null, shgc: h.shgc, vt: h.vt,
    uIpMin: null, uIpMax: null, shgcMin: null, shgcMax: null, keywords: null,
    notes: "typed by hand — the label's whole-product numbers as the source states them",
  }, why: null };
}

export function formatMaterialsCensus(c: MaterialsCensus): string {
  const d = c.datasets;
  const os = c.osstd ? `osstd ${c.osstd.rows} of ${c.osstd.of} (skipped: ${Object.entries(c.osstd.skipped).map(([k, n]) => `${k} ${n}`).join(" · ") || "none"})` : "osstd not cached";
  const rf = c.reference;
  const ref = rf.materials || rf.products.marvin || rf.products.generic ? ` + the reference list's keywords on ${rf.keywordsMapped} cited rows (${rf.keywordsUnmapped} of its rows found none) · fenestration ${rf.products.marvin + rf.products.essential + rf.products.generic + rf.products.constructions} rows (the engine's window constructions ${rf.products.constructions} · Marvin Elevate ${rf.products.marvin} (windows ${rf.products.window} · doors ${rf.products.door}) · Marvin Essential ${rf.products.essential} (windows ${rf.products.essentialWindow} · doors ${rf.products.essentialDoor}) · generic sets ${rf.products.generic})${Object.keys(rf.skipped).length ? ` · skipped ${Object.entries(rf.skipped).map(([k, n]) => `${k} ${n}`).join(", ")}` : ""}${rf.rejected.length ? ` · rejected ${rf.rejected.join("; ")}` : ""}` : " · no reference lists";
  return `DataSets ${d.material + d.nomass + d.airgap} (Material ${d.material} · NoMass ${d.nomass} · AirGap ${d.airgap}; provenance on ${d.provenance}${d.refused.length ? `; refused ${d.refused.length}` : ""}) + ${os}${ref} · user rows ${c.user.rows}${c.user.fenestration ? ` + ${c.user.fenestration} fenestration` : ""}${c.user.rejected.length ? ` (rejected ${c.user.rejected.join("; ")})` : ""} · sources ${c.sources}`;
}
