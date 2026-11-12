// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// HAS THE ROOM SETTLED? (the user, 2026-11-10: "Shouldn't the run be limited by convergence … with an absolute run limit (with
// caution noting it did not converge below allowable difference)"). A buoyant room never reaches one steady state — its plumes
// meander — so the solver's residuals level off rather than fall, and OpenFOAM's own average condition (one iteration's value
// against the window's mean) can be met by chance on a quiet iteration. The test here is the AVERAGES: the room's mean air
// temperature, its mean air speed and the air leaving by the outlets, each averaged over the last BLOCK iterations and over the
// block before; the room has settled when no average moved by more than the tolerance between the two blocks, and not before
// the minimum. OpenFOAM writes the three every 50 iterations (the case's roomT, roomU and outT function objects); the app reads
// them as the run goes and, settled at N, has the solver average the next 3,000 iterations and end (cfd:settle). A run that reaches
// the cap is kept, averaged over its last 3,000, with the change it still had.

/** the three things watched, as OpenFOAM writes them: postProcessing/<name>/<start>/<file> */
export const MONITORS = [
  { key: "roomT", file: "volFieldValue.dat", label: "room air temperature", unit: "K" },
  { key: "roomU", file: "volFieldValue.dat", label: "room air speed", unit: "m/s" },
  { key: "outT", file: "surfaceFieldValue.dat", label: "air leaving by the outlets", unit: "K" },
] as const;
export type MonitorKey = (typeof MONITORS)[number]["key"];

export interface StopRule { tolK: number; minIterations: number; block: number }
export const STOP_DEFAULT: StopRule = { tolK: 0.1, minIterations: 4000, block: 1000 };
/** the speed's tolerance: 2 % of the room's mean speed, never under 1 mm/s */
export const speedTol = (meanU: number): number => Math.max(0.001, 0.02 * meanU);

/** an OpenFOAM .dat (# comments, then "time value" columns) → [iteration, first value] pairs */
export function readDat(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const c = line.trim().split(/\s+/);
    const it = +c[0]!, v = +c[1]!;
    if (Number.isFinite(it) && Number.isFinite(v)) out.push([it, v]);
  }
  return out;
}

export interface Settle { settled: boolean; iteration: number; change: Partial<Record<MonitorKey, number>>; tol: Partial<Record<MonitorKey, number>>; why: string }

/** the verdict on the series as written so far */
export function settledYet(series: Partial<Record<MonitorKey, Array<[number, number]>>>, rule: StopRule = STOP_DEFAULT): Settle {
  const last = Math.max(0, ...Object.values(series).map((s) => (s?.length ? s[s.length - 1]![0] : 0)));
  const change: Settle["change"] = {}, tol: Settle["tol"] = {};
  if (last < rule.minIterations) return { settled: false, iteration: last, change, tol, why: `before the minimum of ${rule.minIterations.toLocaleString()} iterations` };
  const mean = (s: Array<[number, number]>, a: number, b: number): number | null => { const v = s.filter(([i]) => i > a && i <= b).map(([, x]) => x); return v.length ? v.reduce((t, x) => t + x, 0) / v.length : null; };
  let all = true;
  for (const m of MONITORS) {
    const s = series[m.key];
    if (!s?.length) { if (m.key === "outT") continue; return { settled: false, iteration: last, change, tol, why: `no ${m.label} written yet` }; }
    const now = mean(s, last - rule.block, last), before = mean(s, last - 2 * rule.block, last - rule.block);
    if (now == null || before == null) return { settled: false, iteration: last, change, tol, why: `${m.label}: not two blocks yet` };
    change[m.key] = Math.abs(now - before);
    tol[m.key] = m.key === "roomU" ? speedTol(now) : rule.tolK;
    if (change[m.key]! > tol[m.key]!) all = false;
  }
  return { settled: all, iteration: last, change, tol, why: all ? `every average moved less than its tolerance over the last ${rule.block.toLocaleString()} iterations` : "still moving" };
}

/** the change in words, in the user's units */
export function settleWords(s: Pick<Settle, "change" | "tol">, imperial: boolean): string {
  return MONITORS.filter((m) => s.change[m.key] != null).map((m) => {
    const v = s.change[m.key]!, t = s.tol[m.key]!;
    const f = (x: number): string => (m.unit === "K" ? (imperial ? `${(x * 1.8).toFixed(2)} °F` : `${x.toFixed(2)} K`) : imperial ? `${(x * 196.85).toFixed(1)} fpm` : `${x.toFixed(4)} m/s`);
    return `${m.label} ${f(v)} (tolerance ${f(t)})`;
  }).join(" · ");
}
