// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE COUNTY, AND THE CLIMATE ZONE THE USER READS FOR IT. The IECC and ASHRAE 169 do not define climate zones by coordinates: they
// assign every US COUNTY a zone (IECC Table R301.1 / C301.1). This module places a position in its county, through the US Census
// cartographic county boundaries at 1:20,000,000 (3,221 features keyed by the five-digit FIPS, the plotly/datasets copy, MIT),
// cached under data/cache. The ZONE itself is the user's: they read their county's row in the code's own table — free and read-only
// at codes.iccsafe.org — and enter it with the energy code (BEM › SITE). No county-to-zone table ships with the program. Nothing is
// interpolated; a position outside every county (the sea, another country) reads as not placed.

export const COUNTIES_URL = "https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json";
export const COUNTIES_CACHE = "us-counties-20m.geojson";
/** where the user reads their county's zone: the code's climate-zone table, free and read-only on the publisher's site */
export const ZONE_TABLE_URL = "https://codes.iccsafe.org/";

/** A COUNTY TABLE, named by a project's data sources (2026-11-12): the DOE Building America layout — State, State FIPS, County FIPS,
 *  IECC Climate Zone, IECC Moisture Regime, BA Climate Zone, County Name (the 2015 "Guide to Determining Climate Regions by County").
 *  None ships with the program: a project names a file in the home folder or a URL fetched once */
export interface CountyZone {
  /** five-digit state + county FIPS */
  fips: string;
  state: string;
  county: string;
  /** "4A" — the IECC zone number with its moisture letter (none for the marine/dry N/A rows) */
  zone: string;
  number: string;
  moisture: string;
  /** the Building America region: "Mixed-Humid" */
  ba: string;
}

/** the county table, keyed by FIPS */
export function parseCountyZones(csv: string): Map<string, CountyZone> {
  const out = new Map<string, CountyZone>();
  const lines = csv.split(/\r?\n/);
  const head = (lines[0] ?? "").split(",").map((x) => x.trim().toLowerCase());
  const col = (name: string): number => head.findIndex((h) => h === name.toLowerCase());
  const iState = col("State"), iSF = col("State FIPS"), iCF = col("County FIPS"), iZone = col("IECC Climate Zone"), iMoist = col("IECC Moisture Regime"), iBa = col("BA Climate Zone"), iName = col("County Name");
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const f = line.split(",").map((x) => x.trim());
    const sf = (f[iSF] ?? "").padStart(2, "0"), cf = (f[iCF] ?? "").padStart(3, "0");
    if (!/^\d{2}$/.test(sf) || !/^\d{3}$/.test(cf)) continue;
    const number = f[iZone] ?? "", moisture = f[iMoist] ?? "";
    out.set(sf + cf, { fips: sf + cf, state: f[iState] ?? "", county: f[iName] ?? "", zone: number + (/^[A-C]$/i.test(moisture) ? moisture.toUpperCase() : ""), number, moisture, ba: f[iBa] ?? "" });
  }
  return out;
}

/** the county a position lies in, with its zone READ from a county table — the moisture and Building America region too */
export function climateZoneFromTable(lat: number, lon: number, counties: CountyFeature[], zones: Map<string, CountyZone>): CountyZoneRead | null {
  const c = countyAt(lat, lon, counties);
  if (!c) return null;
  const z = zones.get(c.fips);
  return { fips: c.fips, county: z?.county || c.name, state: z?.state || (STATE_BY_FIPS[c.stateFips] ?? c.stateFips), zone: z?.zone ?? "", moisture: z?.moisture ?? "", ba: z?.ba ?? "" };
}

/** the states and territories by their two-digit FIPS code (US Census) — the code's tables and a state's adoptions name the state */
export const STATE_BY_FIPS: Record<string, string> = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA",
  "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD", "25": "MA",
  "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY",
  "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX",
  "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY", "60": "AS", "66": "GU", "69": "MP", "72": "PR",
  "78": "VI",
};

export interface CountyFeature {
  fips: string;
  name: string;
  stateFips: string;
  bbox: [number, number, number, number];
  /** each polygon as its rings, [lon, lat] pairs; the first ring is the outer one */
  polygons: number[][][][];
}

/** the Census boundaries: every county with its rings and a box for the quick reject */
export function parseCounties(geojson: string): CountyFeature[] {
  const fc = JSON.parse(geojson) as { features: Array<{ id?: string; properties: { STATE?: string; COUNTY?: string; NAME?: string; GEO_ID?: string }; geometry: { type: string; coordinates: unknown } }> };
  const out: CountyFeature[] = [];
  for (const ft of fc.features) {
    const p = ft.properties ?? {};
    const fips = ft.id ?? ((p.STATE ?? "") + (p.COUNTY ?? ""));
    if (!/^\d{5}$/.test(fips)) continue;
    const polygons: number[][][][] = ft.geometry.type === "Polygon" ? [ft.geometry.coordinates as number[][][]] : ft.geometry.type === "MultiPolygon" ? (ft.geometry.coordinates as number[][][][]) : [];
    if (!polygons.length) continue;
    const bbox: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const poly of polygons) for (const ring of poly) for (const q of ring) {
      if (q[0]! < bbox[0]) bbox[0] = q[0]!; if (q[1]! < bbox[1]) bbox[1] = q[1]!;
      if (q[0]! > bbox[2]) bbox[2] = q[0]!; if (q[1]! > bbox[3]) bbox[3] = q[1]!;
    }
    out.push({ fips, name: p.NAME ?? "", stateFips: p.STATE ?? fips.slice(0, 2), bbox, polygons });
  }
  return out;
}

const inRing = (lon: number, lat: number, ring: number[][]): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a[1]! > lat) !== (b[1]! > lat) && lon < ((b[0]! - a[0]!) * (lat - a[1]!)) / (b[1]! - a[1]!) + a[0]!) inside = !inside;
  }
  return inside;
};

/** the county a position lies in: inside a polygon's outer ring and in none of its holes */
export function countyAt(lat: number, lon: number, counties: CountyFeature[]): CountyFeature | null {
  for (const c of counties) {
    if (lon < c.bbox[0] || lon > c.bbox[2] || lat < c.bbox[1] || lat > c.bbox[3]) continue;
    for (const poly of c.polygons) {
      if (!inRing(lon, lat, poly[0]!)) continue;
      if (poly.slice(1).some((hole) => inRing(lon, lat, hole))) continue;
      return c;
    }
  }
  return null;
}

/** the county a position lies in, and the zone the user entered for it ("" until entered); `moisture` and `ba` stay empty for the
 *  readers that print them */
export interface CountyZoneRead { fips: string; county: string; state: string; zone: string; moisture: string; ba: string }

/** position → county, with the user's zone; null when the position is in no county */
export function climateZoneAt(lat: number, lon: number, counties: CountyFeature[], zone: string | null | undefined): CountyZoneRead | null {
  const c = countyAt(lat, lon, counties);
  if (!c) return null;
  return { fips: c.fips, county: c.name, state: STATE_BY_FIPS[c.stateFips] ?? c.stateFips, zone: (zone ?? "").trim().toUpperCase(), moisture: "", ba: "" };
}

export const formatCountyZone = (z: CountyZoneRead | null): string =>
  z ? `${z.zone ? `climate zone ${z.zone}` : "climate zone not entered"} — ${z.county} County, ${z.state}` : "not placed in any county";
