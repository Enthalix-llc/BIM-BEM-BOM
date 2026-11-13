// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE ACTUAL WEATHER FOR THE BILLS' PERIOD, MADE IN THE APP (user, 2026-10-07: "When Utility costs are compared to model costs, that has to
// adjust to the utility bills available and ideally capture real weather for the same period. How can we fill out the weather with real
// data?"). What scripts/makeEpw.ts does, through the app: the hourly readings of the NOAA NCEI GHCNh station NEAREST the site (CC0, no
// key — the station list read once, the nearest stations that report hourly tried in turn) and the Open-Meteo archive's sun and sky at
// the site (no key; CC BY 4.0, "Weather data by Open-Meteo.com"; its FREE API IS FOR NON-COMMERCIAL USE ONLY — paid work needs a source
// whose terms allow it, or the user's own actual-year file, picked on the calibration card). Fetched by the main process into
// data/cache/, converted by the same core (amyEpw.ts) and saved into Weather/ beside the typical-year file whose header and .ddy it
// keeps. Nothing is applied: the file is picked on BEM › SITE like any other.

import { parseGhcnh, parseOpenMeteo, makeAmyEpw, OPEN_METEO_HOURLY, type AmyCounts } from "../bem/core/amyEpw.js";
import { DEFAULT_EPW, distanceKm } from "../bem/core/weather.js";
import { parseCsv } from "./core/csvRead.js";
import type { AmyStation } from "../../core/projectSources.js";

/** NOAA's GHCNh station list (CC0): id, position, elevation, state, name, WMO and ICAO ids */
export const GHCNH_STATIONS_URL = "https://www.ncei.noaa.gov/oa/global-historical-climatology-network/hourly/doc/ghcnh-station-list.csv";
export interface GhcnhStation { id: string; name: string; latitude: number; longitude: number; km: number }
/** the stations nearest a position that report HOURLY — those with an airport (ICAO) or a WMO id — within `maxKm`, nearest first */
export function nearestGhcnh(csv: string, lat: number, lon: number, maxKm = 150, limit = 6): GhcnhStation[] {
  const c = parseCsv(csv), h = c.header.map((x) => x.trim().toUpperCase());
  const at = (n: string): number => h.indexOf(n);
  const iId = at("GHCN_ID"), iLat = at("LATITUDE"), iLon = at("LONGITUDE"), iName = at("NAME"), iWmo = at("WMO_ID"), iIcao = at("ICAO");
  const out: GhcnhStation[] = [];
  for (const r of c.rows) {
    const la = Number(r[iLat]), lo = Number(r[iLon]);
    if (!Number.isFinite(la) || !Number.isFinite(lo) || !(r[iIcao] ?? "").trim() && !(r[iWmo] ?? "").trim()) continue;
    const km = distanceKm({ latitude: lat, longitude: lon }, { latitude: la, longitude: lo });
    if (km <= maxKm) out.push({ id: (r[iId] ?? "").trim(), name: (r[iName] ?? "").trim(), latitude: la, longitude: lo, km });
  }
  return out.sort((a, b) => a.km - b.km).slice(0, limit);
}

/** the Open-Meteo archive trails today by about five days (its own note): a period must end before that */
export const ARCHIVE_LAG_DAYS = 6;

export function latestEnd(today = new Date()): string {
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - ARCHIVE_LAG_DAYS * 86_400_000).toISOString().slice(0, 10);
}

/** the file's name: the station, the period, the sources — or, when the project's data sources pin a station with a name for its
 *  files (2026-11-12), that name, the period and the sources */
export const amyStem = (stationId: string, start: string, end: string, fileStem?: string): string =>
  fileStem ? `${fileStem}_AMY_${start}_${end}_GHCNh-OpenMeteo` : `GHCNh-${stationId}_AMY_${start}_${end}_OpenMeteo`;

export async function makeActualWeather(o: { start: string; end: string; lat: number; lon: number; template?: string; station?: AmyStation; onProgress?: (s: string) => void }): Promise<{ epw: string; name: string; counts: AmyCounts; ddy: boolean; station: GhcnhStation } | { error: string }> {
  const say = o.onProgress ?? (() => {});
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.start) || !/^\d{4}-\d{2}-\d{2}$/.test(o.end) || o.end < o.start) return { error: `the period ${o.start} – ${o.end} is not a period` };
  if (o.end > latestEnd()) return { error: `the archive reaches ${latestEnd()} — the period must end by then` };
  // the header (location, design conditions, ground) is the project's own typical-year file, the one in force on BEM › SITE
  const tplName = o.template ?? DEFAULT_EPW;
  const tplPath = await window.bem.resolveEpw(tplName);
  const template = tplPath ? await window.bem.readText(tplPath) : null;
  if (!tplPath || !template) return { error: `the typical-year file ${tplName} is not found — pick the site's weather file on BEM › SITE first; its header is the new file's` };
  say("NOAA's station list …");
  const list = await window.bem.fetchCached(GHCNH_STATIONS_URL, "weather/ghcnh-station-list.csv", 30);
  if ("error" in list) return { error: `NOAA's station list: ${list.error}` };
  // THE STATION THE PROJECT'S DATA SOURCES NAME (2026-11-12): pinned by its GHCNh id — the one tried, its distance read from the list —
  // or the nearest that report hourly, tried in turn
  const pinned = o.station?.mode === "pinned" ? o.station : null;
  const candidates = pinned
    ? [nearestGhcnh(list.text, o.lat, o.lon, 20000, 100000).find((x) => x.id === pinned.id) ?? { id: pinned.id, name: pinned.name ?? pinned.id, latitude: NaN, longitude: NaN, km: NaN }]
    : nearestGhcnh(list.text, o.lat, o.lon);
  if (!candidates.length) return { error: "no NOAA station reporting hourly lies within 150 km of the site — use your own actual-year file" };
  const y0 = Number(o.start.slice(0, 4)) - (o.start.slice(5) === "01-01" ? 1 : 0), y1 = Number(o.end.slice(0, 4)) + (o.end.slice(5) === "12-31" ? 1 : 0);
  const thisYear = new Date().getUTCFullYear();
  // the nearest station that has every year the period touches; the next nearest when one has not
  let psv = "", used: GhcnhStation | null = null;
  const tried: string[] = [];
  for (const st of candidates) {
    let text = "", ok = true;
    for (let y = y0; y <= Math.min(y1, thisYear); y++) {
      say(`NOAA GHCNh ${st.name} ${y} …`);
      const url = `https://www.ncei.noaa.gov/oa/global-historical-climatology-network/hourly/access/by-year/${y}/psv/GHCNh_${st.id}_${y}.psv`;
      // a past year's file is final; the current year's is fetched again after a day
      const r = await window.bem.fetchCached(url, `weather/GHCNh_${st.id}_${y}.psv`, y < thisYear ? 3650 : 1);
      if ("error" in r) { ok = false; tried.push(`${st.name} (${st.km.toFixed(0)} km): ${y} ${r.error}`); break; }
      text += text ? `\n${r.text.split(/\r?\n/).slice(1).join("\n")}` : r.text;
    }
    if (ok) { psv = text; used = st; break; }
  }
  if (!used) return { error: `no nearby NOAA station has every year of the period — ${tried.join("; ")}` };
  const station = parseGhcnh(psv);
  const day = (iso: string, k: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);
  const a = day(o.start, -1), b = day(o.end, 1);
  say(`Open-Meteo archive ${a} – ${b} …`);
  const omUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${o.lat}&longitude=${o.lon}&start_date=${a}&end_date=${b}&hourly=${OPEN_METEO_HOURLY.join(",")}&timezone=GMT`;
  const om = await window.bem.fetchCached(omUrl, `weather/open-meteo_${o.lat}_${o.lon}_${a}_${b}.json`, 1);
  if ("error" in om) return { error: `Open-Meteo: ${om.error}` };
  const j = JSON.parse(om.text) as Parameters<typeof parseOpenMeteo>[0] & { latitude?: number; longitude?: number; elevation?: number; reason?: string };
  if (j.reason) return { error: `Open-Meteo: ${j.reason}` };
  say("converting …");
  let out: ReturnType<typeof makeAmyEpw>;
  try {
    out = makeAmyEpw({ template, station, grid: parseOpenMeteo(j), start: o.start, end: o.end, site: { lat: o.lat, lon: o.lon },
      gridAt: j.latitude !== undefined ? { lat: j.latitude, lon: j.longitude!, elevationM: j.elevation ?? null } : null });
  } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  const name = amyStem(used.id, o.start, o.end, pinned?.fileStem);
  const saved = await window.bem.saveWeather(name, out.epw, tplPath.replace(/\.epw$/i, ".ddy"));
  if ("error" in saved) return { error: saved.error };
  return { epw: saved.epw, name: `${name}.epw`, counts: out.counts, ddy: saved.ddy, station: used };
}
