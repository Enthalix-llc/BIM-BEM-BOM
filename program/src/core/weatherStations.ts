// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE WEATHER STATIONS ON THE MAP (user, 2026-09-07): "when selecting a weather file, the view shows the mapped location of all
// available files (use recommended EnergyPlus weather files from the web) with selection from a list below the view." The listing is
// EnergyPlus's OWN weather repository (energyplus.net/weather, the user's ruling of 2026-10-14: "the standard EnergyPlus weather
// sources"): the EnergyPlus project publishes it as weather/master.geojson in its repository — 3,034 locations worldwide, each with its
// title ("USA_MD_Baltimore-Washington.Intl.AP.724060_TMY3"), its position and the zip of its .epw, .ddy and .stat on the project's
// file store. Nothing is computed here except the distance from the IfcSite, a number the user reads to choose by. The listing is
// cached under data/cache. A file from another source (a TMYx file, a purchased one) is placed in Weather/ by the user and picked there.

import { distanceKm } from "../modules/bem/core/weather.js";

/** the listing this module reads: EnergyPlus's weather repository, pinned to a commit of the EnergyPlus project */
export const WEATHER_LISTING_PIN = "87ed9199d49e60b2e95f3927ed372ffb57ba9417";
export const WEATHER_LISTING_URL = `https://raw.githubusercontent.com/NatLabRockies/EnergyPlus/${WEATHER_LISTING_PIN}/weather/master.geojson`;
export const STATIONS_CACHE = `energyplus-weather-${WEATHER_LISTING_PIN.slice(0, 7)}.geojson`;
/** the repository's own page, where the sources of each data set and their terms are stated */
export const WEATHER_SOURCES_URL = "https://energyplus.net/weather/sources";

export interface StationFile {
  /** the data set, as the title names it: "TMY3", "TMY", "IWEC", "CWEC" … */
  period: string;
  /** the zip on the EnergyPlus file store: epw + ddy + stat inside */
  url: string;
  /** the data set again — the sources page says what each is and its terms */
  source: string;
  /** the file's stem, as the zip is named */
  stem: string;
}

export interface Station {
  wmo: string;
  /** "Baltimore-Washington.Intl.AP" */
  name: string;
  state: string;
  latitude: number;
  longitude: number;
  elevationM: number;
  timeZone: number | null;
  climateZone: string;
  hdd18: number | null;
  cdd10: number | null;
  files: StationFile[];
}

const num = (s: string | undefined): number | null => (s !== undefined && s !== "" && Number.isFinite(Number(s)) ? Number(s) : null);

const href = (h: unknown): string | null => /href=(https?:\/\/[^\s>"]+)/.exec(String(h ?? ""))?.[1] ?? null;

/** every location of the listing as one station file; a feature without a zip or a position is skipped. The zone, the degree days,
 *  the elevation and the time zone are not in the listing — they are read from the file once it is downloaded */
export function parseStationListing(text: string): Array<StationFile & { wmo: string; name: string; state: string; latitude: number; longitude: number; elevationM: number; timeZone: number | null; climateZone: string; hdd18: number | null; cdd10: number | null }> {
  const out: ReturnType<typeof parseStationListing> = [];
  const fc = JSON.parse(text) as { features?: Array<{ properties?: Record<string, unknown>; geometry?: { type?: string; coordinates?: number[] } }> };
  for (const f of fc.features ?? []) {
    const p = f.properties ?? {}, c = f.geometry?.coordinates ?? [];
    const url = href(p.all), title = String(p.title ?? "");
    if (!url || !title || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
    // COUNTRY_STATE_Name.WMO_SOURCE, the state only where the country has them ("DZA_Algiers.603900_IWEC")
    const t = /^([A-Z]{3})_(?:([A-Z]{2})_)?(.+?)\.(\d{6})_(.+)$/.exec(title);
    const stem = url.split("/").pop()!.replace(/\.zip$/i, "");
    out.push({
      wmo: t?.[4] ?? "", name: t?.[3] ?? title, state: t?.[2] ?? t?.[1] ?? "",
      latitude: c[1]!, longitude: c[0]!, elevationM: 0, timeZone: null, climateZone: "", hdd18: null, cdd10: null,
      period: t?.[5] ?? "", url, source: t?.[5] ?? "", stem,
    });
  }
  return out;
}

/** A SECOND LISTING, named by a project's data sources (2026-11-12): climate.onebuilding.org's KML of every USA TMYx file it serves —
 *  the station, WMO number and position, elevation, time zone, the ASHRAE climate zone, HDD/CDD and the zip's URL (13,356 placemarks,
 *  measured 2026-09-07). Read only when a project names it; its files keep their own terms (climate.onebuilding.org) */
export const USA_TMYX_KML = "https://climate.onebuilding.org/sources/Region4_USA_TMYx_EPW_Processing_locations.kml";
export const TMYX_CACHE = "weather-stations-usa-tmyx.kml";
/** every placemark of the KML as one station file; the first placemark (the region's own marker) has no URL and is skipped */
export function parseStationKml(text: string): Array<StationFile & { wmo: string; name: string; state: string; latitude: number; longitude: number; elevationM: number; timeZone: number | null; climateZone: string; hdd18: number | null; cdd10: number | null }> {
  const out: ReturnType<typeof parseStationKml> = [];
  const re = /<Placemark>\s*<name>([^<]*)<\/name>\s*<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>[\s\S]*?<coordinates>([^<]*)<\/coordinates>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const d = m[2]!;
    const url = /URL (https?:\/\/[^\s<]+)/.exec(d)?.[1];
    if (!url) continue;
    const title = /<b>([^<]*)<\/b><\/td>/.exec(d)?.[1] ?? "";          // "USA <state> <station>.<WMO> TMYx.<period>"
    const stem = url.split("/").pop()!.replace(/\.zip$/i, "");
    const t = /^(\w+)\s+(\w+)\s+(.+?)\.(\d{6})\s+(\S+)/.exec(title);
    const wmo = /WMO <b>(\d+)/.exec(d)?.[1] ?? t?.[4] ?? "";
    const c = m[3]!.trim().split(",").map(Number);
    if (!Number.isFinite(c[0]!) || !Number.isFinite(c[1]!)) continue;
    const period = (t?.[5] ?? "").replace(/^TMYx\.?/, "") || "TMYx";
    out.push({
      wmo, name: t?.[3] ?? m[1]!.trim(), state: t?.[2] ?? "",
      latitude: c[1]!, longitude: c[0]!, elevationM: c[2] ?? 0,
      timeZone: num(/GMT <b>([-\d.]+)/.exec(d)?.[1]),
      climateZone: (/Climate Zone <b>([^<]*)/.exec(d)?.[1] ?? "").trim(),
      hdd18: num(/HDD18 <b>(\d+)/.exec(d)?.[1]), cdd10: num(/CDD10 <b>(\d+)/.exec(d)?.[1]),
      period, url, source: (/Data Source ([^<]*)/.exec(d)?.[1] ?? "").trim(), stem,
    });
  }
  return out;
}

/** one row per station AND position — a listing may place one station's files apart, and that is its word — its files by period */
export function groupStations(rows: ReturnType<typeof parseStationListing> | ReturnType<typeof parseStationKml>): Station[] {
  const by = new Map<string, Station>();
  for (const r of rows) {
    const k = `${r.wmo}|${r.name}|${r.latitude.toFixed(3)}|${r.longitude.toFixed(3)}`;
    let s = by.get(k);
    if (!s) {
      s = { wmo: r.wmo, name: r.name, state: r.state, latitude: r.latitude, longitude: r.longitude, elevationM: r.elevationM, timeZone: r.timeZone, climateZone: r.climateZone, hdd18: r.hdd18, cdd10: r.cdd10, files: [] };
      by.set(k, s);
    }
    s.files.push({ period: r.period, url: r.url, source: r.source, stem: r.stem });
  }
  for (const s of by.values()) s.files.sort((a, b) => (a.period === "TMYx" ? -1 : b.period === "TMYx" ? 1 : a.period.localeCompare(b.period)));
  return [...by.values()];
}

export interface NearStation extends Station { km: number }

/** the file a click on the station uses (user, 2026-09-07): the newest dated period where the listing has periods, else its first
 *  file (EnergyPlus's repository has one file per location, TMY3 for most US stations) */
export function newestFile(s: Station): StationFile | null {
  const periods = s.files.filter((f) => /^\d{4}-\d{4}$/.test(f.period)).sort((a, b) => a.period.localeCompare(b.period));
  return periods[periods.length - 1] ?? s.files.find((f) => f.period === "TMYx") ?? s.files[0] ?? null;
}

/** one station row's identity — the WMO number AND the position, since the listing places some stations twice */
export const stationId = (s: Station): string => `${s.wmo}|${s.latitude.toFixed(3)}|${s.longitude.toFixed(3)}`;

/** the stations within a radius of a position, nearest first — the distance is the user's to read */
export function nearestStations(stations: Station[], site: { latitude: number; longitude: number }, maxKm: number, limit = 400): NearStation[] {
  return stations.map((s) => ({ ...s, km: distanceKm(site, s) })).filter((s) => s.km <= maxKm).sort((a, b) => a.km - b.km).slice(0, limit);
}

/** the WMO number an EPW file name carries (`…Field.724040_TMYx…`), for marking the installed ones */
export function wmoOfEpw(path: string): string | null {
  return /\.(\d{6})_/.exec(path.split(/[\\/]/).pop() ?? "")?.[1] ?? null;
}
