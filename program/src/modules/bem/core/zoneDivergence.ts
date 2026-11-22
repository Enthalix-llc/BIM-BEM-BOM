// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// HOW FAR A ZONE MISSED ITS SETPOINT, HOUR BY HOUR (user, 2026-11-22: "visualize per space divergence into unmet hours … blue for too
// cold and red for too hot … a timeline (month/day/hour) … drill down by degree divergence"). Read from the engine's own hourly output
// (bemIdf.ZONE_DIVERGENCE_VARIABLES, conditioned zones only): the zone's mean air temperature, its heating and cooling setpoints, and
// the not-met time the engine counts at each zone timestep. Per hour:
//   unmet  −h when the heating setpoint was not met for h of the hour, +c for the cooling setpoint (the engine's count: the hours
//          summed are its own not-met hours)
//   div    the hour's mean air less the setpoint it missed — negative too cold, positive too hot; 0 in an hour met. An hour the engine
//          counts as not met but whose MEAN stood on the right side of the setpoint (the miss was inside the hour) reads 0
// EnergyPlus reports the air per ZONE: every space of a zone takes its zone's value. Pure — the writer, the reader and the view share it.

export interface ZoneDivergence {
  /** the zone's name as the engine reports it (UPPERCASE) */
  zone: string;
  /** °C, signed: below the heating setpoint negative, above the cooling setpoint positive, 0 met */
  div: number[];
  /** hours of the hour not met, signed: heating −, cooling + */
  unmet: number[];
  /** the run's first day as the engine dated it */
  start?: [number, number, number];
}

/** the UNMET HOURS view's hourly variables, per conditioned zone: the air, the two setpoints, the not-met time */
export const ZONE_DIVERGENCE_VARIABLES = ["Zone Mean Air Temperature", "Zone Thermostat Heating Setpoint Temperature", "Zone Thermostat Cooling Setpoint Temperature",
  "Zone Heating Setpoint Not Met Time", "Zone Cooling Setpoint Not Met Time"] as const;

export const DIV_PREFIX = "zdiv|";
export const UNMET_PREFIX = "zunmet|";

/** the five hourly series of each zone → its divergence (series keyed by `${VARIABLE}|${ZONE}`) */
export function divergenceFrom(series: Map<string, number[]>, start?: [number, number, number]): ZoneDivergence[] {
  const zones = new Set<string>();
  for (const k of series.keys()) zones.add(k.slice(k.indexOf("|") + 1));
  const out: ZoneDivergence[] = [];
  for (const z of [...zones].sort()) {
    const t = series.get(`Zone Mean Air Temperature|${z}`), hs = series.get(`Zone Thermostat Heating Setpoint Temperature|${z}`), cs = series.get(`Zone Thermostat Cooling Setpoint Temperature|${z}`);
    const hn = series.get(`Zone Heating Setpoint Not Met Time|${z}`), cn = series.get(`Zone Cooling Setpoint Not Met Time|${z}`);
    if (!t || !hn || !cn) continue;
    const div: number[] = [], unmet: number[] = [];
    for (let i = 0; i < t.length; i++) {
      const h = hn[i] ?? 0, c = cn[i] ?? 0;
      if (h > 0 && h >= c) { unmet.push(-h); div.push(hs && Number.isFinite(hs[i]) ? Math.min(0, t[i]! - hs[i]!) : 0); }
      else if (c > 0) { unmet.push(c); div.push(cs && Number.isFinite(cs[i]) ? Math.max(0, t[i]! - cs[i]!) : 0); }
      else { unmet.push(0); div.push(0); }
    }
    out.push({ zone: z, div, unmet, ...(start ? { start } : {}) });
  }
  return out;
}

/** the largest divergence in the year, °C — the legend's span, fixed over the timeline so a colour means the same at every hour */
export function divergenceSpan(zs: ZoneDivergence[]): number {
  let m = 0;
  for (const z of zs) for (const d of z.div) if (Math.abs(d) > m) m = Math.abs(d);
  return m;
}

/** the zone's colour over hours [a, b): the WORST hour in the window (largest |div|, its sign) — an hour not met at the mean's right
 *  side counts as a miss of ~0; met every hour → 0 */
export function windowValue(z: ZoneDivergence, a: number, b: number): number {
  let v = 0;
  for (let i = Math.max(0, a); i < Math.min(b, z.div.length); i++) if (Math.abs(z.div[i]!) > Math.abs(v)) v = z.div[i]!;
  return v;
}

/** the calendar date of hour i (the hour ENDING i+1) from the run's first day; a typical year's engine year may be 0 — read as 2017,
 *  the engine's own default year (a Sunday 1 January, non-leap) */
export function dateOfHour(start: [number, number, number] | undefined, i: number): { y: number; m: number; d: number; h: number; dayOfRun: number } {
  const [y0, m0, d0] = start ?? [2017, 1, 1];
  const t = Date.UTC(y0 > 1900 ? y0 : 2017, m0 - 1, d0) + i * 3600e3;
  const dt = new Date(t);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), h: dt.getUTCHours() + 1, dayOfRun: Math.floor(i / 24) };
}

/** the run's months, in the run's own order (an actual year may start in October): month index (0-based in the run) of each hour */
export function runMonths(start: [number, number, number] | undefined, hours: number): Array<{ y: number; m: number; a: number; b: number }> {
  const out: Array<{ y: number; m: number; a: number; b: number }> = [];
  for (let i = 0; i < hours; i++) {
    const { y, m } = dateOfHour(start, i), last = out[out.length - 1];
    if (last && last.y === y && last.m === m) last.b = i + 1; else out.push({ y, m, a: i, b: i + 1 });
  }
  return out;
}

export interface DivergenceBin {
  /** the bin's lower edge in the units asked for (0 → "under 1°") */
  from: number;
  /** hours not met in the bin, per run month and the year */
  months: number[];
  year: number;
}

/** one side's not-met hours, binned by whole degrees of divergence in the user's units (scale 1 °C, or 1.8 for °F) */
export function binsOf(z: ZoneDivergence, side: "heating" | "cooling", months: Array<{ a: number; b: number }>, degScale: number): DivergenceBin[] {
  const by = new Map<number, DivergenceBin>();
  months.forEach((mo, mi) => {
    for (let i = mo.a; i < mo.b; i++) {
      const u = z.unmet[i] ?? 0;
      if (side === "heating" ? u >= 0 : u <= 0) continue;
      const k = Math.floor(Math.abs(z.div[i] ?? 0) * degScale);
      const bin = by.get(k) ?? by.set(k, { from: k, months: new Array(months.length).fill(0), year: 0 }).get(k)!;
      bin.months[mi]! += Math.abs(u); bin.year += Math.abs(u);
    }
  });
  return [...by.values()].sort((p, q) => p.from - q.from);
}

/** one side's not-met hours per run month and the year — the engine's count summed */
export function sideHours(z: ZoneDivergence, side: "heating" | "cooling", months: Array<{ a: number; b: number }>): { months: number[]; year: number } {
  const ms = months.map((mo) => { let s = 0; for (let i = mo.a; i < mo.b; i++) { const u = z.unmet[i] ?? 0; if (side === "heating" ? u < 0 : u > 0) s += Math.abs(u); } return s; });
  return { months: ms, year: ms.reduce((p, q) => p + q, 0) };
}
