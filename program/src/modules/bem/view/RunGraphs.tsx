// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// RUN · THE GRAPHS (user, 2026-10-02): "Under Run tab, the view should show graphed model results. The frame below the graph
// view should define the graph viewed." Two sections, one active: ANNUAL — a line over the year of the run's daily meters
// (Heating, Cooling, Ventilation, Renewable), kWh; PEAK — each zone's design-day peak stacked by load component (the engine's
// Zone Component Load Summary), MBH under imperial. Every number is a stored row of the run; a series the model has nothing for
// says so rather than drawing a zero.

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { BemOutcome } from "../pipeline.js";
import type { ComponentLoad } from "../core/eplusSql.js";
import { J_PER_KWH, BALANCE } from "../core/eplusSql.js";
import { calendarHours } from "../core/runCalendar.js";
import { coilRows, unitRows, designStamp, designDayShort, structurePeaks, type CoilRow, type UnitRow, type StructurePeak } from "./runResults.js";

export type RunGraphSection = "annual" | "peak" | "unmet";
export type AnnualSeries = "use" | "heating" | "cooling" | "ventilation" | "lighting" | "equipment" | "hotwater" | "water" | "charging" | "renewable" | "purchased" | "surplus" | "net";
export type PeakKind = "heating" | "cooling";
/** THE TIME SCALE (user, 2026-10-03): "a time scale adjustment … with slider below view ranging from a day (showing 24 hours) to week
 *  (showing 7 days) to month (calendar month) to year, and a window scroll bar on the graph so the reduced view can be moved" */
export type TimeScale = "day" | "week" | "month" | "year";
export const TIME_SCALES: TimeScale[] = ["day", "week", "month", "year"];
/** the outside temperature (user, 2026-10-03): each day's high, low and average, on a temperature axis on the right */
export type TempLine = "high" | "low" | "avg";
/** PEAK in two parts (user, 2026-10-03): peak conditioning, heating and cooling, per system and per zone */
/** "space" (user, 2026-10-23): each space's design air flow for heating and cooling, from its design load across the coil's ΔT */
export type PeakPart = "system" | "zone" | "space";
/** `pick` (2026-10-12): the point left-clicked on the Annual graph — a day of the year, and its hour on the day and week scales; `pick2` the
 *  point right-clicked (user: "Left click on chart sets one point and right click on chart sets second point so that a range is selected") —
 *  the frame sums the point, or the range between the two */
export type GraphPoint = { day: number; hour: number | null };
export interface RunGraphState { section: RunGraphSection; annual: AnnualSeries[]; peak: PeakKind[]; scale: TimeScale; start: number; temps: TempLine[]; peakParts: PeakPart[]; pick?: GraphPoint | null; pick2?: GraphPoint | null;
  /** PER SPACE (user, 2026-10-23): the coil's ΔT, °F, cooling and heating (20 and 30 unless typed) — the air flow is the space's design
   *  load across it; and the zones whose spaces are drawn, absent = All */
  dtCoolF?: number; dtHeatF?: number; spaceZones?: string[] | null;
  /** the lines' checkboxes under the Annual graph unfolded (user, 2026-10-16: "a collapsing view of the checkbox plotting values so the graph
   *  has more space") — folded unless opened */
  checksOpen?: boolean }
export const RUN_GRAPH_DEFAULT: RunGraphState = { section: "annual", annual: ["use", "heating", "cooling", "ventilation", "renewable", "purchased", "net"], peak: ["heating", "cooling"], scale: "year", start: 0, temps: [], peakParts: ["system", "zone", "space"], dtCoolF: 20, dtHeatF: 30, spaceZones: null };

/** what each Annual line sums: the engine's own meters, the ones the run has. Heating and cooling read the electric meter (real
 *  equipment) and the district one (ideal loads), whichever the run wrote; VENTILATION is the ventilation fans' own end-use
 *  subcategory, never a unit's supply fan (the user's word, 2026-10-02); RENEWABLE is what a generator produced. TOTAL USE and the
 *  utility side of net metering (user, 2026-10-02: "add total use and grid" — PV drawn against heating and cooling alone looked far
 *  bigger than the house's use): the facility's whole electricity, what was bought, what was sold back, and the net, which goes
 *  below zero on a day the arrays out-produce the house. THE OCCUPANT LOADS (user, 2026-10-03: "lighting, equipment, hot water,
 *  domestic water and car charging"): the lights' and the plug loads' end uses, the water heaters' WaterSystems end use (a gas
 *  heater's fuel in kWh of fuel), the well pump's and the car charging's own end-use subcategories */
/** RIGHT: the facility's series on their own axis (user, 2026-10-02: "add right side y-axis … so pv vs utility use can be seen against
 *  heating and cooling loads") — a house's whole use is several times its heating, so on one scale the end uses lie flat */
export const ANNUAL_SERIES: Array<{ id: AnnualSeries; label: string; color: string; meters: string[]; none: string; dash?: string; right?: boolean;
  /** meters named by the model (2026-10-08: an ERV's fans meter to its card's own subcategory, "ERV-H:Fans:Electricity") */
  match?: RegExp }> = [
  { id: "use", label: "Total use", color: "#e5e7eb", right: true, meters: ["Electricity:Facility"], none: "no facility electricity meter in this run" },
  { id: "heating", label: "Heating", color: "#e8603c", meters: ["Heating:Electricity", "DistrictHeatingWater:Facility"], none: "no heating meter in this run" },
  { id: "cooling", label: "Cooling", color: "#3c8ce8", meters: ["Cooling:Electricity", "DistrictCooling:Facility"], none: "no cooling meter in this run" },
  { id: "ventilation", label: "Ventilation", color: "#4ade80", meters: ["Ventilation (simple):Fans:Electricity"], match: /^(?!General:)[^:]+:Fans:Electricity$/, none: "no ventilation fans in this run — SYSTEMS › MECHANICAL › Ventilation, then Run" },
  { id: "lighting", label: "Lighting", color: "#f59e0b", meters: ["InteriorLights:Electricity", "ExteriorLights:Electricity"], none: "no lights in this run" },
  { id: "equipment", label: "Equipment", color: "#94a3b8", meters: ["InteriorEquipment:Electricity"], none: "no plug loads in this run" },
  { id: "hotwater", label: "Hot water", color: "#fb7185", meters: ["WaterSystems:Electricity", "WaterSystems:NaturalGas", "WaterSystems:Propane"], none: "no water heater in this run — SYSTEMS › PLUMBING, then Run" },
  { id: "water", label: "Domestic water", color: "#22d3ee", meters: ["Well Pump:ExteriorEquipment:Electricity"], none: "no well pump in this run — SYSTEMS › PLUMBING › Domestic Water, then Run" },
  { id: "charging", label: "Car charging", color: "#818cf8", meters: ["Charging:InteriorEquipment:Electricity", "Charging:ExteriorEquipment:Electricity"], none: "no car charging in this run — ZONES › LOADS › Charging, then Run" },
  { id: "renewable", label: "Renewable (PV)", right: true, color: "#ffd166", meters: ["ElectricityProduced:Facility"], none: "no generator in the model — model the PV on SYSTEMS › ELECTRICAL › Generation" },
  { id: "purchased", label: "From the utility", right: true, color: "#c084fc", meters: ["ElectricityPurchased:Facility"], none: "no generator in the model — all use is from the utility" },
  { id: "surplus", label: "Surplus to the utility", right: true, color: "#2dd4bf", meters: ["ElectricitySurplusSold:Facility"], none: "no generator in the model — nothing sold back" },
  { id: "net", label: "Net from the utility", right: true, color: "#f472b6", meters: ["ElectricityNet:Facility"], none: "no generator in the model — net is the total use", dash: "5 3" },
];
export const PEAK_KINDS: Array<{ id: PeakKind; label: string }> = [{ id: "heating", label: "Heating" }, { id: "cooling", label: "Cooling" }];
export const PEAK_PARTS: Array<{ id: PeakPart; label: string; title: string }> = [
  { id: "system", label: "Per system", title: "each system's (each heat pump card on SYSTEMS) peak heating and cooling on the design days — its units' coils summed at the instant they peak together, each unit's share stacked" },
  { id: "zone", label: "Per zone", title: "each zone's design-day peak, stacked by load component (the engine's Zone Component Load Summary), with its design air flow" },
  { id: "space", label: "Per space", title: "each space's design air flow, cooling and heating — its design sensible load (the engine's space sizing) across the coil's ΔT typed below: CFM = Btu/h ÷ (1.08 × ΔT °F)" },
];
export const TEMP_LINES: Array<{ id: TempLine; label: string; color: string }> = [
  { id: "high", label: "Outside high", color: "#fca5a5" }, { id: "low", label: "Outside low", color: "#93c5fd" }, { id: "avg", label: "Outside average", color: "#d1d5db" },
];
const DRYBULB = "Site Outdoor Air Drybulb Temperature";

const W_TO_BTUH = 3.412142;
const M3S_TO_CFM = 2118.88;
const DAYS_BEFORE = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
const DAYS_IN = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthOf = (d: number): number => { let m = 11; while (m > 0 && DAYS_BEFORE[m]! > d) m--; return m; };
const dayLabel = (d: number): string => { const m = monthOf(d); return `${MONTHS[m]} ${d - DAYS_BEFORE[m]! + 1}`; };

/** a 1–2–5 step that puts about `n` ticks over [0, max] */
function niceTicks(max: number, n = 5): number[] {
  if (!(max > 0)) return [0];
  const raw = max / n, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(v);
  if (out[out.length - 1]! < max) out.push(out[out.length - 1]! + step);
  return out;
}
const fmtTick = (v: number): string => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1).replace(/\.0$/, "") : v.toFixed(2).replace(/\.?0+$/, ""));

/** the container's size, for an SVG drawn at the pixels it has */
function useSize<T extends HTMLElement>(): [React.RefObject<T | null>, { w: number; h: number }] {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ w: 800, h: 400 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

/** a series: kWh per day of the year (index 0 = Jan 1), kWh per hour when the run has the hours (index 0 = Jan 1 00:00–01:00), and
 *  which meters fed it */
export interface SeriesLine { kwh: number[]; hourly: number[] | null; meters: string[] }
export function annualLines(bem: BemOutcome): Map<AnnualSeries, SeriesLine> {
  const byName = new Map<string, number[]>();
  for (const d of bem.daily) {
    const i = (DAYS_BEFORE[d.month - 1] ?? 0) + d.day - 1;
    if (i < 0 || i > 364) continue;
    const a = byName.get(d.name) ?? byName.set(d.name, new Array(365).fill(0)).get(d.name)!;
    a[i] = (a[i] ?? 0) + d.value / J_PER_KWH;
  }
  // the hours placed by their DATE on the calendar year's grid (2026-10-07: an actual-year run need not start on Jan 1)
  const hourlyOf = new Map((bem.hourly ?? []).map((h) => [h.name, calendarHours(h.values, h.start, 0)] as const));
  const out = new Map<AnnualSeries, SeriesLine>();
  for (const s of ANNUAL_SERIES) {
    const meters = [...new Set([...s.meters.filter((m) => byName.has(m)), ...(s.match ? [...byName.keys()].filter((m) => s.match!.test(m)) : [])])];
    if (!meters.length) continue;
    const kwh = new Array(365).fill(0);
    for (const m of meters) byName.get(m)!.forEach((v, i) => { kwh[i] += v; });
    let hourly: number[] | null = meters.every((m) => hourlyOf.has(m)) ? new Array(365 * 24).fill(0) : null;
    if (hourly) for (const m of meters) hourlyOf.get(m)!.forEach((v, i) => { hourly![i]! += v / J_PER_KWH; });
    out.set(s.id, { kwh, hourly, meters });
  }
  return out;
}

/** the outside dry-bulb: each day's high, low and average (°C) and the hours, from the engine's hourly reading of the weather file */
export function outsideTemps(bem: BemOutcome): { high: number[]; low: number[]; avg: number[]; hourly: number[] } | null {
  const s = (bem.hourly ?? []).find((x) => x.name === DRYBULB);
  if (!s || s.values.length < 24) return null;
  // by date on the calendar grid; a day the run does not hold reads NaN and is drawn as a gap
  const h = calendarHours(s.values, s.start, NaN);
  const high: number[] = [], low: number[] = [], avg: number[] = [];
  for (let d = 0; d < 365; d++) {
    const day = h.slice(d * 24, d * 24 + 24).filter((v) => Number.isFinite(v));
    if (!day.length) { high.push(NaN); low.push(NaN); avg.push(NaN); continue; }
    high.push(Math.max(...day)); low.push(Math.min(...day)); avg.push(day.reduce((t, v) => t + v, 0) / day.length);
  }
  return { high, low, avg, hourly: h };
}

/** the window's words: the year, a month's name, a week's days, a day */
export function windowWordsOf(scale: TimeScale, start: number): string {
  const { d0 } = windowOf(scale, start);
  return scale === "year" ? "the run's weather year" : scale === "month" ? MONTH_NAMES[monthOf(d0)]! : scale === "week" ? `${dayLabel(d0)} – ${dayLabel(d0 + 6)}` : dayLabel(d0);
}

/** the days a scale shows from a start day: a day, seven, the calendar month the start is in, the year */
export function windowOf(scale: TimeScale, start: number): { d0: number; n: number } {
  const s = Math.max(0, Math.min(364, Math.round(start)));
  if (scale === "year") return { d0: 0, n: 365 };
  if (scale === "month") { const m = monthOf(s); return { d0: DAYS_BEFORE[m]!, n: DAYS_IN[m]! }; }
  if (scale === "week") return { d0: Math.min(s, 358), n: 7 };
  return { d0: s, n: 1 };
}
/** the scale changed about the window's middle */
export function rescale(st: RunGraphState, scale: TimeScale): RunGraphState {
  const w = windowOf(st.scale, st.start), mid = w.d0 + w.n / 2, n = windowOf(scale, 0).n;
  return { ...st, scale, start: scale === "month" ? Math.floor(mid) : Math.max(0, Math.round(mid - n / 2)) };
}

/** `size` draws at a fixed size (the printed report) instead of the container's; `onState` absent = no time controls (the report) */
export function AnnualGraph({ bem, shown, size, scale = "year", start = 0, temps = [], imperial = false, onWindow, pick = null, pick2 = null, onPick }: {
  bem: BemOutcome; shown: AnnualSeries[]; size?: { w: number; h: number }; scale?: TimeScale; start?: number; temps?: TempLine[]; imperial?: boolean;
  onWindow?: (scale: TimeScale, start: number) => void;
  /** the point clicked (2026-10-12): its amounts are the frame's second column */
  pick?: GraphPoint | null; pick2?: GraphPoint | null; onPick?: (p: GraphPoint | null, second: boolean) => void;
}): ReactNode {
  const [ref, seen] = useSize<HTMLDivElement>();
  const { w, h } = size ?? seen;
  const [hover, setHover] = useState<number | null>(null);
  const lines = annualLines(bem);
  const T0 = outsideTemps(bem);
  const drawn = ANNUAL_SERIES.filter((s) => shown.includes(s.id) && lines.has(s.id));
  const { d0, n } = windowOf(scale, start);
  // the day and week views read the HOURS; a run made before they were asked for draws by the day, and says so
  const wantHours = scale === "day" || scale === "week";
  const hours = wantHours && drawn.every((s) => !!lines.get(s.id)!.hourly) && (!temps.length || !!T0);
  const N = hours ? n * 24 : n;
  const valuesOf = (s: AnnualSeries): number[] => { const l = lines.get(s)!; return hours ? l.hourly!.slice(d0 * 24, (d0 + n) * 24) : l.kwh.slice(d0, d0 + n); };
  const vis = new Map(drawn.map((s) => [s.id, valuesOf(s.id)] as const));
  const toT = (c: number): number => (imperial ? c * 9 / 5 + 32 : c);
  const tUnit = imperial ? "°F" : "°C";
  const tShown = T0 ? TEMP_LINES.filter((t) => temps.includes(t.id)) : [];
  // a temperature line: the day's high / low / average, held over the day's hours in the hour views
  const tVals = new Map(tShown.map((t) => [t.id, Array.from({ length: N }, (_, i) => toT(T0![t.id][d0 + (hours ? Math.floor(i / 24) : i)]!))] as const));
  const perUnit = hours ? "h" : "day";
  // TWO AXES: the end uses (heating, cooling, ventilation) on the left, the facility (use, PV, the utility) on the right, each on
  // its own 1–2–5 step; both share the zero line and the grid — the same count of steps above and below zero — so a moment reads across
  const sideOf = (right: boolean): { lo: number; hi: number } => {
    const v = drawn.filter((s) => !!s.right === right).flatMap((s) => vis.get(s.id)!);
    return { lo: Math.min(0, ...v), hi: Math.max(0, ...v) };
  };
  const two = drawn.some((s) => s.right) && drawn.some((s) => !s.right);
  const bothSides = two ? [sideOf(false), sideOf(true)] : [{ lo: Math.min(sideOf(false).lo, sideOf(true).lo), hi: Math.max(sideOf(false).hi, sideOf(true).hi) }];
  // scaled: kWh until a value passes 1,000 kWh, MWh beyond (the user's "scaled kWh")
  const kOf = (r: { lo: number; hi: number }): number => (Math.max(r.hi, -r.lo) >= 1000 ? 1 / 1000 : 1);
  // six grid steps shared by both sides; the steps below zero chosen so both sides fill the grid best, each on its own 1–2–2.5–5 step
  const GRID = 6;
  const niceUp = (v: number): number => { if (!(v > 0)) return 1; const p = 10 ** Math.floor(Math.log10(v)); return ([1, 2, 2.5, 5, 10].find((f) => f * p >= v - 1e-9) ?? 10) * p; };
  let best = { nDown: 0, steps: [] as number[], fill: -1 };
  for (let nDown = 0; nDown <= 2; nDown++) {
    if (nDown === 0 && bothSides.some((r) => r.lo < 0)) continue;
    if (nDown > 0 && !bothSides.some((r) => r.lo < 0)) break;
    const nUp = GRID - nDown;
    const st = bothSides.map((r) => niceUp(Math.max((r.hi * kOf(r)) / nUp, nDown ? (-r.lo * kOf(r)) / nDown : 0)));
    const fill = bothSides.reduce((t, r, i) => t + (r.hi - r.lo) * kOf(r) / (st[i]! * GRID), 0);
    if (fill > best.fill) best = { nDown, steps: st, fill };
  }
  const mk = (i: number) => { const r = bothSides[i]!, k = kOf(r); return { k, unit: `${k < 1 ? "MWh" : "kWh"}/${perUnit}`, step: best.steps[i] ?? 1 }; };
  const sL = mk(0), sR = two ? mk(1) : sL;
  const nDown = best.nDown, nUp = GRID - nDown;
  const steps = Array.from({ length: nUp + nDown + 1 }, (_, i) => i - nDown);
  // THE TEMPERATURE AXIS, outermost on the right: a 1–2–5 step and a base so the window's range sits on the same grid lines
  const tAll = [...tVals.values()].flat().filter((v) => Number.isFinite(v));
  const tScale = (() => {
    if (!tAll.length) return null;
    const lo = Math.min(...tAll), hi = Math.max(...tAll), G = nUp + nDown;
    for (const s of [1, 2, 2.5, 5, 10, 20, 25, 50]) { const base = Math.floor(lo / s) * s; if (base + G * s >= hi) return { base, s }; }
    return { base: Math.floor(lo / 50) * 50, s: 50 };
  })();
  const L = 56, RF = two ? 52 : 0, RT = tScale ? 48 : 0, R = Math.max(16, RF + RT + 4), T = 16, B = 34, pw = Math.max(10, w - L - R), ph = Math.max(10, h - T - B);
  const x = (i: number): number => L + ((i + 0.5) / N) * pw;
  const xAt = (frac: number): number => L + frac * pw;
  const yStep = (k: number): number => T + ph - ((k + nDown) / (nUp + nDown)) * ph;
  const yOn = (sc: typeof sL) => (v: number): number => yStep((v * sc.k) / sc.step);
  const yOf = (right: boolean | undefined) => (two && right ? yOn(sR) : yOn(sL));
  const yT = (v: number): number => (tScale ? yStep((v - tScale.base) / tScale.s - nDown) : 0);
  // a value the run does not hold (NaN) breaks the line: the next point starts a new run of it
  const path = (a: number[], y: (v: number) => number): string => { let pen = false; return a.map((v, i) => { if (!Number.isFinite(v)) { pen = false; return ""; } const c = `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true; return c; }).join(""); };
  // the x axis: months over the year, days over a month, each day over a week, every third hour over a day
  const ticks: Array<{ at: number; label: string; mid?: boolean }> = scale === "year" ? DAYS_BEFORE.map((d, m) => ({ at: d / 365, label: MONTHS[m]! }))
    : scale === "month" ? Array.from({ length: n }, (_, i) => ({ at: i / n, label: [0, 4, 9, 14, 19, 24, 29].includes(i) ? String(i + 1) : "" }))
    : scale === "week" ? Array.from({ length: 7 }, (_, i) => ({ at: i / 7, label: dayLabel(d0 + i) }))
    : Array.from({ length: 9 }, (_, i) => ({ at: i / 8, label: i < 8 ? `${String(i * 3).padStart(2, "0")}:00` : "" }));
  const labelMid = scale === "year" || scale === "week";
  const when = (i: number): string => {
    if (!hours) return scale === "year" || scale === "month" ? dayLabel(d0 + i) : dayLabel(d0 + i);
    const d = d0 + Math.floor(i / 24), hr = i % 24;
    return `${dayLabel(d)} ${String(hr).padStart(2, "0")}:00–${String(hr + 1).padStart(2, "0")}:00`;
  };
  const windowWords = windowWordsOf(scale, start);
  // a picked point's index in this window (clamped to its edge, so a range reaching past the window still shades to it), and whether it is in it
  const idxOf = (p: GraphPoint | null): number | null => (!p ? null : hours ? (p.day - d0) * 24 + (p.hour ?? 0) : p.day - d0);
  const ia = idxOf(pick), ib = idxOf(pick2);
  const inWin = (i: number | null): i is number => i !== null && i >= 0 && i < N;
  const clampI = (i: number): number => Math.max(0, Math.min(N - 1, i));
  const fallback = wantHours && !hours;
  // left-click: the first point; right-click: the second — the range between them is summed in the frame; the same point again clears it
  const pickAt = (e: React.MouseEvent<SVGSVGElement>, second: boolean): void => {
    if (!onPick) return;
    const r = e.currentTarget.getBoundingClientRect(), i = Math.floor(((e.clientX - r.left - L) / pw) * N);
    if (i < 0 || i >= N) return;
    const p: GraphPoint = hours ? { day: d0 + Math.floor(i / 24), hour: i % 24 } : { day: d0 + i, hour: null };
    const was = second ? pick2 : pick;
    onPick(was && was.day === p.day && was.hour === p.hour ? null : p, second);
  };
  return (
    <div className="runGraph">
      <div className="runGraphHead">
        ENERGY · {windowWords} · by the {hours ? "hour" : "day"}, {two && sR.unit !== sL.unit ? `${sL.unit} left · ${sR.unit} right` : sL.unit}{two ? " · end uses left, facility right" : ""}{tScale ? ` · outside ${tUnit} outermost right` : ""}
        {fallback && <span className="runKey dim">this run has no hourly results — drawn by the day; Run again for the hours</span>}
        {/* the lines' names, sums and notes are in the frame under the view (user, 2026-10-16: "Why is the summary data listed in the
            view? It should be in the frame below the view") — the view is the drawing */}
        {temps.length > 0 && !T0 && <span className="runKey dim">— no outside temperature in this run; Run again</span>}
      </div>
      <div className="runGraphBody" ref={ref} style={size ? { height: size.h, flex: "0 0 auto" } : undefined}>
        <svg width={w} height={h} onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const i = Math.floor(((e.clientX - r.left - L) / pw) * N); setHover(i >= 0 && i < N ? i : null); }}
          onClick={(e) => pickAt(e, false)} onContextMenu={(e) => { e.preventDefault(); pickAt(e, true); }}
          style={onPick ? { cursor: "crosshair" } : undefined}>
          {ia !== null && ib !== null && (inWin(ia) || inWin(ib) || (ia < 0) !== (ib < 0)) && (() => { const a = clampI(Math.min(ia, ib)), b = clampI(Math.max(ia, ib));
            return <rect x={x(a) - pw / N / 2} y={T} width={x(b) - x(a) + pw / N} height={ph} fill="#ffd166" opacity={0.08} />; })()}
          {inWin(ia) && <line x1={x(ia)} x2={x(ia)} y1={T} y2={T + ph} stroke="#ffd166" strokeWidth={1.2} />}
          {inWin(ib) && <line x1={x(ib)} x2={x(ib)} y1={T} y2={T + ph} stroke="#ffd166" strokeWidth={1.2} strokeDasharray="4 3" />}
          {steps.map((k) => (
            <g key={k}>
              <line x1={L} x2={L + pw} y1={yStep(k)} y2={yStep(k)} className="gridLine" />
              <text x={L - 6} y={yStep(k) + 3} textAnchor="end" className="axisText">{fmtTick(k * sL.step)}</text>
              {two && <text x={L + pw + 6} y={yStep(k) + 3} textAnchor="start" className="axisText">{fmtTick(k * sR.step)}</text>}
              {tScale && <text x={L + pw + RF + 6} y={yStep(k) + 3} textAnchor="start" className="axisText" fill="#fca5a5">{fmtTick(tScale.base + (k + nDown) * tScale.s)}</text>}
            </g>
          ))}
          {ticks.map((t, j) => (
            <g key={j}>
              <line x1={xAt(t.at)} x2={xAt(t.at)} y1={T} y2={T + ph} className="gridLine faint" />
              {t.label && <text x={labelMid ? xAt(t.at + (scale === "year" ? 15 / 365 : 0.5 / 7)) : xAt(t.at + (scale === "month" ? 0.5 / n : 0))} y={T + ph + 14} textAnchor="middle" className="axisText">{t.label}</text>}
            </g>
          ))}
          <text x={12} y={T + ph / 2} transform={`rotate(-90 12 ${T + ph / 2})`} textAnchor="middle" className="axisText">{two ? `end uses · ${sL.unit}` : sL.unit}</text>
          {two && <text x={L + pw + RF - 6} y={T + ph / 2} transform={`rotate(90 ${L + pw + RF - 6} ${T + ph / 2})`} textAnchor="middle" className="axisText">facility · PV · utility · {sR.unit}</text>}
          {tScale && <text x={w - 8} y={T + ph / 2} transform={`rotate(90 ${w - 8} ${T + ph / 2})`} textAnchor="middle" className="axisText">outside {tUnit}</text>}
          <line x1={L} x2={L + pw} y1={yStep(0)} y2={yStep(0)} className="axisLine" />
          {tShown.map((t) => <path key={t.id} d={path(tVals.get(t.id)!, yT)} fill="none" stroke={t.color} strokeWidth={1.2} strokeDasharray="4 3" />)}
          {drawn.map((s) => <path key={s.id} d={path(vis.get(s.id)!, yOf(s.right))} fill="none" stroke={s.color} strokeWidth={1.4} strokeDasharray={s.dash} />)}
          {hover !== null && (drawn.length > 0 || tShown.length > 0) && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={T} y2={T + ph} className="hoverLine" />
              {drawn.map((s) => <circle key={s.id} cx={x(hover)} cy={yOf(s.right)(vis.get(s.id)![hover]!)} r={3} fill={s.color} />)}
              {tShown.map((t) => <circle key={t.id} cx={x(hover)} cy={yT(tVals.get(t.id)![hover]!)} r={2.5} fill={t.color} />)}
              <g transform={`translate(${Math.min(x(hover) + 8, L + pw - 228)},${T + 6})`}>
                <rect width={220} height={16 + 14 * (drawn.length + tShown.length)} rx={3} className="hoverBox" />
                <text x={8} y={13} className="hoverText">{when(hover)}</text>
                {drawn.map((s, j) => <text key={s.id} x={8} y={27 + 14 * j} className="hoverText" fill={s.color}>{s.label}: {vis.get(s.id)![hover]!.toFixed(hours ? 2 : 1)} kWh</text>)}
                {tShown.map((t, j) => <text key={t.id} x={8} y={27 + 14 * (drawn.length + j)} className="hoverText" fill={t.color}>{t.label}: {tVals.get(t.id)![hover]!.toFixed(1)} {tUnit}</text>)}
              </g>
            </g>
          )}
        </svg>
        {drawn.length === 0 && tShown.length === 0 && <div className="runGraphEmpty">{shown.length ? "none of the checked series is in this run" : "check a series in the frame below"}</div>}
      </div>
      {onWindow && <TimeControls scale={scale} start={start} onWindow={onWindow} />}
    </div>
  );
}

/** THE SLIDER AND THE SCROLL BAR below the view: the scale (day · week · month · year) and the window over the year — the thumb is
 *  the window's share of the year, dragged or stepped with ‹ › (a day, a week, a month at a time); a click on the track centres the
 *  window there */
function TimeControls({ scale, start, onWindow }: { scale: TimeScale; start: number; onWindow: (scale: TimeScale, start: number) => void }): ReactNode {
  const track = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; d0: number } | null>(null);
  const { d0, n } = windowOf(scale, start);
  const go = (d: number): void => onWindow(scale, Math.max(0, Math.min(365 - (scale === "month" ? 1 : n), d)));
  const step = (dir: 1 | -1): void => {
    if (scale === "month") { const m = Math.max(0, Math.min(11, monthOf(d0) + dir)); go(DAYS_BEFORE[m]!); }
    else go(d0 + dir * n);
  };
  const dayAt = (clientX: number): number => { const r = track.current!.getBoundingClientRect(); return Math.floor(((clientX - r.left) / r.width) * 365); };
  const year = scale === "year";
  return (
    <div className="runTime">
      <div className="runScroll">
        <button className="runStep" disabled={year || d0 <= 0} onClick={() => step(-1)} title="back one window">‹</button>
        <div className={`runTrack${year ? " full" : ""}`} ref={track}
          onPointerDown={(e) => { if (year || e.target !== e.currentTarget) return; const d = dayAt(e.clientX); go(scale === "month" ? d : d - Math.floor(n / 2)); }}>
          {DAYS_BEFORE.slice(1).map((d) => <i key={d} style={{ left: `${(d / 365) * 100}%` }} />)}
          <div className="runThumb" style={{ left: `${(d0 / 365) * 100}%`, width: `${Math.max(0.6, (n / 365) * 100)}%` }}
            onPointerDown={(e) => { if (year) return; e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, d0 }; }}
            onPointerMove={(e) => { const g = drag.current; if (!g || !track.current) return; const dd = Math.round(((e.clientX - g.x) / track.current.getBoundingClientRect().width) * 365); if (dd) go(g.d0 + dd); }}
            onPointerUp={() => { drag.current = null; }}
            title={year ? "the whole year is in view — pick a shorter scale to move a window over it" : "drag to move the window over the year"} />
        </div>
        <button className="runStep" disabled={year || d0 + n >= 365} onClick={() => step(1)} title="forward one window">›</button>
      </div>
      <label className="runScale" title="the time scale: a day of 24 hours, a week of 7 days, a calendar month, the year">
        <span>scale</span>
        <input type="range" min={0} max={3} step={1} value={TIME_SCALES.indexOf(scale)} onChange={(e) => onWindow(TIME_SCALES[Number(e.target.value)]!, start)} />
        <span className="runScaleWords">{TIME_SCALES.map((t) => <b key={t} className={t === scale ? "on" : ""} onClick={() => onWindow(t, start)}>{t === "day" ? "Day" : t === "week" ? "Week" : t === "month" ? "Month" : "Year"}</b>)}</span>
      </label>
    </div>
  );
}

/** the coil ΔT defaults (user, 2026-10-23): cooling 20 °F, heating 30 °F */
export const DT_DEFAULT_F: Record<PeakKind, number> = { cooling: 20, heating: 30 };
export const dtOf = (state: RunGraphState, k: PeakKind): number => (k === "cooling" ? state.dtCoolF : state.dtHeatF) ?? DT_DEFAULT_F[k];
type SpaceRow = { name: string; zone: string; coolW: number; heatW: number };
/** each space in the run with its zone (the model's spacesByZone, matched by the engine's name in capitals), in the zones' order */
export function spaceRowsOf(bem: BemOutcome, spacesByZone: Record<string, string[]>): SpaceRow[] {
  const placed = new Set<string>(), out: SpaceRow[] = [];
  for (const [zone, rooms] of Object.entries(spacesByZone)) for (const room of rooms) {
    const l = bem.loads.spaces.get(room.toUpperCase());
    if (!l) continue;
    placed.add(room.toUpperCase()); out.push({ name: room, zone, coolW: l.designCoolingW, heatW: l.designHeatingW });
  }
  for (const [k, l] of bem.loads.spaces) if (!placed.has(k)) out.push({ name: k, zone: "—", coolW: l.designCoolingW, heatW: l.designHeatingW });
  return out;
}
/** the air that carries a sensible load across ΔT: CFM = Btu/h ÷ (1.08 × ΔT °F); metric L/s = W ÷ (1.207 × ΔT K) — 1.2 kg/m³ air at 1.006 kJ/kg·K */
const flowOf = (w: number, dtF: number, imperial: boolean): number => (dtF > 0 ? (imperial ? (w * W_TO_BTUH) / (1.08 * dtF) : w / (1.2072 * (dtF * 5) / 9)) : 0);

/** PEAK AIR FLOW PER SPACE (user, 2026-10-23: "graphs for Per Space for Cooling and Heating CFM, where coil difference in temperature (dT)
 *  has an input box … a slide bar for scrolling through spaces … a Zone dropdown"): one graph per load, a bar per space, the spaces of the
 *  zones picked in the frame; one slide bar under them moves both over the spaces */
export function SpaceFlowGraphs({ rows, kinds, state, imperial }: { rows: SpaceRow[]; kinds: PeakKind[]; state: RunGraphState; imperial: boolean }): ReactNode {
  const [ref, { w }] = useSize<HTMLDivElement>();
  const [start, setStart] = useState(0);
  const unit = imperial ? "CFM" : "L/s";
  const shown = state.spaceZones ? rows.filter((r) => state.spaceZones!.includes(r.zone)) : rows;
  const L = 56, R = 12, T = 18, B = 92, H = 300, pw = Math.max(10, w - L - R), ph = H - T - B;
  const n = Math.max(1, Math.min(shown.length, Math.floor(pw / 44)));
  const s0 = Math.max(0, Math.min(start, shown.length - n));
  const view = shown.slice(s0, s0 + n);
  const COLOR: Record<PeakKind, string> = { heating: "#e8603c", cooling: "#3c8ce8" };
  const graph = (k: PeakKind): ReactNode => {
    const dt = dtOf(state, k), dtWords = imperial ? `${dt} °F` : `${((dt * 5) / 9).toFixed(1)} K`;
    const flow = (r: SpaceRow): number => flowOf(k === "cooling" ? r.coolW : r.heatW, dt, imperial);
    const max = Math.max(0, ...shown.map(flow));          // one scale over every shown space, so a scroll does not rescale
    const tk = niceTicks(max, 4), top = tk[tk.length - 1] || 1;
    const y = (v: number): number => T + ph - (v / top) * ph;
    const slot = pw / n, bw = Math.min(34, slot * 0.7);
    return (
      <div key={k} className="runGraph" style={{ flex: "0 0 auto" }}>
        <div className="runGraphHead" title={`each space's design ${k} load (sensible, the engine's space sizing on the ${k === "cooling" ? "summer" : "winter"} design day) across the coil's ΔT ${dtWords}: ${imperial ? "CFM = Btu/h ÷ (1.08 × ΔT)" : "L/s = W ÷ (1.207 × ΔT)"} — each space at its own peak (non-coincident), so their sum can exceed the zone's design load; ΔT is typed in the frame below`}>
          PEAK AIR FLOW · PER SPACE · {k === "cooling" ? "COOLING" : "HEATING"} · {unit} · ΔT {dtWords}
          <span className="runKey dim">{shown.length} spaces{state.spaceZones ? ` · ${state.spaceZones.length} zone${state.spaceZones.length === 1 ? "" : "s"}` : " · all zones"} · Σ {Math.round(shown.reduce((t, r) => t + flow(r), 0)).toLocaleString()} {unit}</span>
        </div>
        <div className="runGraphBody" style={{ height: H, flex: "0 0 auto" }}>
          <svg width={w} height={H}>
            {tk.map((t) => (
              <g key={t}>
                <line x1={L} x2={L + pw} y1={y(t)} y2={y(t)} className={t === 0 ? "axisLine" : "gridLine"} />
                <text x={L - 6} y={y(t) + 3} textAnchor="end" className="axisText">{fmtTick(t)}</text>
              </g>
            ))}
            <text x={12} y={T + ph / 2} transform={`rotate(-90 12 ${T + ph / 2})`} textAnchor="middle" className="axisText">{unit}</text>
            {view.map((r, i) => {
              const cx = L + slot * i + slot / 2, v = flow(r), lw = k === "cooling" ? r.coolW : r.heatW;
              const zoneStart = i === 0 || view[i - 1]!.zone !== r.zone;
              return (
                <g key={`${r.zone}|${r.name}`}>
                  {zoneStart && <><line x1={cx - slot / 2} x2={cx - slot / 2} y1={T - 8} y2={T + ph} className="gridLine" /><text x={cx - slot / 2 + 3} y={T - 6} className="axisText dim">{r.zone}</text></>}
                  <rect x={cx - bw / 2} y={y(v)} width={bw} height={Math.max(0.5, y(0) - y(v))} fill={COLOR[k]}>
                    <title>{`${r.name} · ${r.zone}\n${k} ${Math.round(v)} ${unit} — design load ${imperial ? `${Math.round(lw * W_TO_BTUH).toLocaleString()} Btu/h` : `${Math.round(lw)} W`} across ΔT ${dtWords}`}</title>
                  </rect>
                  <text x={cx} y={y(v) - 3} textAnchor="middle" className="axisText strong">{Math.round(v)}</text>
                  <text x={cx} y={T + ph + 10} textAnchor="end" transform={`rotate(-40 ${cx} ${T + ph + 10})`} className="axisText">{r.name.length > 20 ? `${r.name.slice(0, 19)}…` : r.name}</text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    );
  };
  return (
    <div ref={ref} className="spaceFlow">
      {shown.length === 0 ? <div className="runGraphEmpty">{rows.length ? "no space in the zones picked — Zones in the frame below" : "this run has no space sizing — Run again"}</div> : kinds.map(graph)}
      {shown.length > n && (
        <div className="runTime">
          <div className="runScroll" title="slide through the spaces">
            <button className="runStep" disabled={s0 <= 0} onClick={() => setStart(Math.max(0, s0 - n))} title="back one page of spaces">‹</button>
            <input className="spaceSlide" type="range" min={0} max={shown.length - n} step={1} value={s0} onChange={(e) => setStart(Number(e.target.value))} />
            <button className="runStep" disabled={s0 + n >= shown.length} onClick={() => setStart(Math.min(shown.length - n, s0 + n))} title="forward one page of spaces">›</button>
          </div>
          <span className="runScale">{s0 + 1}–{s0 + view.length} of {shown.length}</span>
        </div>
      )}
    </div>
  );
}

/** PEAK CONDITIONING PER STRUCTURE (user, 2026-10-12: "Peak conditioning in MBH per system needs to be per structure (ADU and House) and have
 *  only one label under the columns per set"): each structure's design-day peak — its units' coils summed at the instant the SUM is largest
 *  (structurePeaks, the RUN column's Structure Peak) — heating and cooling side by side, each bar stacked by the unit's rate at that instant;
 *  the structure's name the one label under its set, the units and the instant on hover */
export function StructurePeakGraph({ structures, kinds, imperial, size }: { structures: StructurePeak[]; kinds: PeakKind[]; imperial: boolean; size?: { w: number; h: number } }): ReactNode {
  const [ref, seen] = useSize<HTMLDivElement>();
  const { w, h } = size ?? seen;
  const [hover, setHover] = useState<string | null>(null);
  const conv = (watts: number): number => (imperial ? (watts * W_TO_BTUH) / 1000 : watts / 1000);
  const unit = imperial ? "MBH" : "kW";
  const rows = structures.filter((s) => kinds.some((k) => s.design[k]));
  const max = Math.max(0, ...rows.flatMap((s) => kinds.map((k) => conv(s.design[k]?.w ?? 0))));
  const tk = niceTicks(max, 4), top = tk[tk.length - 1] || 1;
  const L = 56, R = 12, T = 14, B = 24, pw = Math.max(10, w - L - R), ph = Math.max(10, h - T - B);
  const y = (v: number): number => T + ph - (v / top) * ph;
  const slot = pw / Math.max(1, rows.length), bw = Math.min(90, (slot * 0.6) / Math.max(1, kinds.length));
  const COLOR: Record<PeakKind, string> = { heating: "#e8603c", cooling: "#3c8ce8" };
  return (
    <div className="runGraph">
      <div className="runGraphHead" title="each system's units summed at the instant their summed load is largest on the design day of its kind — what the system's real equipment must meet; each unit's share at that instant is stacked (not its own peak). The RUN column's System Peak tables carry the weather-year peaks too">
        PEAK CONDITIONING · PER SYSTEM · {unit}
        {kinds.map((k) => <span key={k} className="runKey"><i style={{ background: COLOR[k], borderColor: COLOR[k] }} />{k === "heating" ? "Heating" : "Cooling"}</span>)}
        {hover && <span className="runKey">{hover}</span>}
      </div>
      <div className="runGraphBody" ref={ref} style={size ? { height: size.h, flex: "0 0 auto" } : undefined}>
        <svg width={w} height={h}>
          {tk.map((t) => (
            <g key={t}>
              <line x1={L} x2={L + pw} y1={y(t)} y2={y(t)} className={t === 0 ? "axisLine" : "gridLine"} />
              <text x={L - 6} y={y(t) + 3} textAnchor="end" className="axisText">{fmtTick(t)}</text>
            </g>
          ))}
          <text x={12} y={T + ph / 2} transform={`rotate(-90 12 ${T + ph / 2})`} textAnchor="middle" className="axisText">{unit}</text>
          {rows.map((s, i) => {
            const cx = L + slot * i + slot / 2;
            return (
              <g key={s.name}>
                {kinds.map((k, j) => {
                  const side = s.design[k], bx = cx + (j - kinds.length / 2) * bw;
                  if (!side) return <text key={k} x={bx + bw / 2} y={y(0) - 4} textAnchor="middle" className="axisText dim">no {k}</text>;
                  const words = `${s.name} · ${k} ${conv(side.w).toFixed(1)} ${unit} at the ${side.at} — ${side.byUnit.map((u) => `${u.unit} ${conv(u.w).toFixed(1)}`).join(" · ")}`;
                  let acc = 0;
                  return (
                    <g key={k} onMouseEnter={() => setHover(words)} onMouseLeave={() => setHover(null)}>
                      {side.byUnit.filter((u) => u.w > 0).map((u, n) => { const v0 = acc; acc += conv(u.w);
                        // each segment named (user, 2026-10-12: "squeeze in the zone names on top of the structures totals"): the zone the unit
                        // serves (else the unit's name less its card's) and its share, where the segment is tall enough for a line of text
                        const segH = y(v0) - y(acc), name = (u.zones || u.unit.replace(new RegExp(`^${s.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "i"), "") || u.unit).toUpperCase();
                        return (
                          <g key={u.unit}>
                            <rect x={bx} y={y(acc)} width={bw - 3} height={Math.max(0.5, segH)} fill={COLOR[k]} opacity={Math.max(0.45, 1 - n * 0.11)} stroke="#0f1218" strokeWidth="0.6"><title>{`${u.unit}${u.zones ? ` (${u.zones})` : ""}: ${conv(u.w).toFixed(1)} ${unit} at that instant · its own peak ${conv(u.ownPeakW).toFixed(1)}`}</title></rect>
                            {segH >= 11 && <text x={bx + (bw - 3) / 2} y={(y(acc) + y(v0)) / 2 + 3.5} textAnchor="middle" className="segText">{name.length * 5.6 + 30 > bw ? name.slice(0, Math.max(3, Math.floor((bw - 30) / 5.6))) : name} {conv(u.w).toFixed(1)}</text>}
                          </g>
                        ); })}
                      <text x={bx + (bw - 3) / 2} y={y(conv(side.w)) - 4} textAnchor="middle" className="axisText strong">{conv(side.w).toFixed(1)}</text>
                    </g>
                  );
                })}
                <text x={cx} y={T + ph + 15} textAnchor="middle" className="axisText strong">{s.name}</text>
              </g>
            );
          })}
        </svg>
        {rows.length === 0 && <div className="runGraphEmpty">no system's coil rates in this run — the units are drawn on SYSTEMS, and runs made before 2026-10-23 did not always ask the engine for the rates: Run again</div>}
      </div>
    </div>
  );
}

/** PEAK CONDITIONING PER SYSTEM (user, 2026-10-03): each unit's heating and cooling peak side by side — the load its coils met at the
 *  design-day peak (CoilSizingDetails, "Coil Total Capacity at Ideal Loads Peak"), the air flow under each bar */
export function SystemPeakGraph({ units, kinds, imperial, size }: { units: UnitRow[]; kinds: PeakKind[]; imperial: boolean; size?: { w: number; h: number } }): ReactNode {
  const [ref, seen] = useSize<HTMLDivElement>();
  const { w, h } = size ?? seen;
  const [hover, setHover] = useState<string | null>(null);
  const conv = (watts: number): number => (imperial ? (watts * W_TO_BTUH) / 1000 : watts / 1000);
  const unit = imperial ? "MBH" : "kW";
  const air = (m3s: number | null): string => (m3s === null ? "—" : imperial ? `${Math.round(m3s * M3S_TO_CFM).toLocaleString()} cfm` : `${Math.round(m3s * 1000).toLocaleString()} L/s`);
  const coilOf = (u: UnitRow, k: PeakKind): CoilRow | null => (k === "heating" ? u.heating : u.cooling);
  const valOf = (c: CoilRow | null): number | null => (c ? c.peakW ?? null : null);
  const rows = units.filter((u) => kinds.some((k) => coilOf(u, k)));
  const max = Math.max(0, ...rows.flatMap((u) => kinds.map((k) => conv(valOf(coilOf(u, k)) ?? 0))));
  const tk = niceTicks(max, 4), top = tk[tk.length - 1] || 1;
  const L = 56, R = 12, T = 10, B = 54, pw = Math.max(10, w - L - R), ph = Math.max(10, h - T - B);
  const y = (v: number): number => T + ph - (v / top) * ph;
  const slot = pw / Math.max(1, rows.length), bw = Math.min(44, (slot * 0.7) / Math.max(1, kinds.length));
  const COLOR: Record<PeakKind, string> = { heating: "#e8603c", cooling: "#3c8ce8" };
  return (
    <div className="runGraph">
      <div className="runGraphHead">
        PEAK CONDITIONING · PER SYSTEM · each unit's design-day peak load, {unit}, with its air flow
        {kinds.map((k) => <span key={k} className="runKey"><i style={{ background: COLOR[k], borderColor: COLOR[k] }} />{k === "heating" ? "Heating" : "Cooling"}</span>)}
        {hover && <span className="runKey">{hover}</span>}
      </div>
      <div className="runGraphBody" ref={ref} style={size ? { height: size.h, flex: "0 0 auto" } : undefined}>
        <svg width={w} height={h}>
          {tk.map((t) => (
            <g key={t}>
              <line x1={L} x2={L + pw} y1={y(t)} y2={y(t)} className={t === 0 ? "axisLine" : "gridLine"} />
              <text x={L - 6} y={y(t) + 3} textAnchor="end" className="axisText">{fmtTick(t)}</text>
            </g>
          ))}
          <text x={12} y={T + ph / 2} transform={`rotate(-90 12 ${T + ph / 2})`} textAnchor="middle" className="axisText">{unit}</text>
          {rows.map((u, i) => {
            const cx = L + slot * i + slot / 2;
            return (
              <g key={u.unit}>
                {kinds.map((k, j) => {
                  const c = coilOf(u, k), v = valOf(c);
                  const bx = cx + (j - kinds.length / 2) * bw;
                  if (v === null) return <text key={k} x={bx + bw / 2} y={y(0) - 4} textAnchor="middle" className="axisText dim">{c ? "no peak" : "—"}</text>;
                  const words = `${u.unit} · ${k}: ${conv(v).toFixed(1)} ${unit} at ${designStamp(c!.time)} (${designDayShort(c!.day)}) · air ${air(c!.airM3s)} · coil ${c!.capacityW !== null ? `${conv(c!.capacityW).toFixed(1)} ${unit}` : "—"}`;
                  return (
                    <g key={k} onMouseEnter={() => setHover(words)} onMouseLeave={() => setHover(null)}>
                      <rect x={bx} y={y(conv(v))} width={bw - 2} height={Math.max(0.5, y(0) - y(conv(v)))} fill={COLOR[k]} />
                      <text x={bx + bw / 2 - 1} y={y(conv(v)) - 4} textAnchor="middle" className="axisText strong">{conv(v).toFixed(1)}</text>
                    </g>
                  );
                })}
                <text x={cx} y={T + ph + 14} textAnchor="middle" className="axisText">{u.unit}</text>
                <text x={cx} y={T + ph + 27} textAnchor="middle" className="axisText dim">{kinds.map((k) => `${k === "heating" ? "H" : "C"} ${air(coilOf(u, k)?.airM3s ?? null)}`).join(" · ")}</text>
                <text x={cx} y={T + ph + 40} textAnchor="middle" className="axisText dim">{u.zones.length > 28 ? `${u.zones.slice(0, 26)}…` : u.zones}</text>
              </g>
            );
          })}
        </svg>
        {rows.length === 0 && <div className="runGraphEmpty">no unit in this run — under ideal loads the per-zone part is the peak; draw the units on SYSTEMS</div>}
      </div>
    </div>
  );
}

/** the components' colours — envelope in earth tones, internal gains warm, air cool; one per engine row */
const COMPONENT_COLOR: Record<string, string> = {
  "Heat Pump Water Heater": "#ff4fa3", "People": "#f4a261", "Lights": "#ffd166", "Equipment": "#e9c46a", "Refrigeration": "#a8dadc", "Water Use Equipment": "#90e0ef",
  "HVAC Equipment Losses": "#b5838d", "Power Generation Equipment": "#ffb4a2", "DOAS Direct to Zone": "#8ecae6",
  "Infiltration": "#48cae4", "Zone Ventilation": "#00b4d8", "Interzone Mixing": "#0096c7",
  "Roof": "#9c6644", "Interzone Ceiling": "#b08968", "Other Roof": "#7f5539",
  "Exterior Wall": "#6a994e", "Interzone Wall": "#a7c957", "Ground Contact Wall": "#386641", "Other Wall": "#52796f",
  "Exterior Floor": "#8d99ae", "Interzone Floor": "#adb5bd", "Ground Contact Floor": "#5c677d", "Other Floor": "#6c757d",
  "Fenestration Conduction": "#c77dff", "Fenestration Solar": "#e0aaff", "Opaque Door": "#d00000",
  // the zone air balance's own (2026-10-11)
  [BALANCE.internal]: "#e9c46a", [BALANCE.erv]: "#00b4d8",
  [BALANCE.storage]: "#ced4da", [BALANCE.fenestration]: "#c77dff", [BALANCE.mass]: "#6c757d", [BALANCE.residual]: "#ff0054",
};

/** one stacked column per zone: each component's W as DEMAND — heating flips the engine's sign, so what the system must supply
 *  stands above the axis and what offsets it (people, lights, a warmer neighbour) below; the total is the engine's Grand Total */
export function peakColumns(loads: ComponentLoad[], kind: PeakKind): Array<{ zone: string; time: string; total: number; parts: Array<{ component: string; w: number }> }> {
  const sign = kind === "heating" ? -1 : 1;
  const byZone = new Map<string, { zone: string; time: string; total: number; parts: Array<{ component: string; w: number }> }>();
  for (const c of loads) {
    if (c.kind !== kind) continue;
    const z = byZone.get(c.zone) ?? byZone.set(c.zone, { zone: c.zone, time: c.time, total: 0, parts: [] }).get(c.zone)!;
    if (c.component === "Grand Total") z.total = sign * c.w;
    else if (c.w !== 0) z.parts.push({ component: c.component, w: sign * c.w });
  }
  return [...byZone.values()].sort((a, b) => a.zone.localeCompare(b.zone));
}

/** the loads PEAK draws (2026-10-11): each zone's own air heat balance when the run has it, else the engine's Component Load Summary */
export function peakLoadsOf(bem: { zoneBalance?: ComponentLoad[]; componentLoads: ComponentLoad[] }): { loads: ComponentLoad[]; basis: PeakBasis } {
  return bem.zoneBalance?.length ? { loads: bem.zoneBalance, basis: "balance" } : { loads: bem.componentLoads, basis: "engine" };
}
export type PeakBasis = "balance" | "engine";

export function PeakGraph({ loads, kind, imperial, size, flows, basis = "engine", tall = false }: { loads: ComponentLoad[]; kind: PeakKind; imperial: boolean; size?: { w: number; h: number };
  /** each zone's design air flow for this kind, m³/s, by zone name in capitals (HVAC Sizing Summary) */
  flows?: Map<string, number>;
  /** "balance": the zone air's own heat balance at the unit's peak timestep; "engine": the Component Load Summary (a run made before 2026-10-11) */
  basis?: PeakBasis;
  /** more height for the stacks (2026-10-12) */
  tall?: boolean }): ReactNode {
  const [ref, seen] = useSize<HTMLDivElement>();
  const { w, h } = size ?? seen;
  const [hover, setHover] = useState<{ zone: string; component: string; w: number } | null>(null);
  const all = peakColumns(loads, kind);
  // a zone whose unit supplies nothing of this kind has no peak to draw (the Garage has no cooling) — named, not drawn
  const cols = basis === "balance" ? all.filter((c) => c.total > 0) : all;
  const none = basis === "balance" ? all.filter((c) => c.total <= 0).map((c) => c.zone) : [];
  const conv = (watts: number): number => (imperial ? (watts * W_TO_BTUH) / 1000 : watts / 1000);
  const unit = imperial ? "MBH" : "kW";
  const up = Math.max(0, ...cols.map((c) => c.parts.filter((p) => p.w > 0).reduce((t, p) => t + p.w, 0)));
  const down = Math.max(0, ...cols.map((c) => -c.parts.filter((p) => p.w < 0).reduce((t, p) => t + p.w, 0)));
  const tu = niceTicks(conv(up), 4), td = down > 0 ? niceTicks(conv(down), 2) : [0];
  const topV = tu[tu.length - 1] || 1, botV = td[td.length - 1] || 0;
  const L = 56, R = 12, T = 10, B = 22, pw = Math.max(10, w - L - R), ph = Math.max(10, h - T - B);
  const y = (v: number): number => T + ((topV - v) / (topV + botV)) * ph;
  const slot = pw / Math.max(1, cols.length), bw = Math.min(64, slot * 0.6);
  const sum = cols.reduce((t, c) => t + c.total, 0);
  const used = [...new Set(cols.flatMap((c) => c.parts.map((p) => p.component)))];
  return (
    <div className={`runGraph${tall ? " tall" : ""}`}>
      {/* the title alone (user, 2026-10-12: "drop the excess header verbage (leaving "Peak Conditioning - Per Zone - Heating"), and the long
          explanation should be a tooltip on the header") */}
      <div className="runGraphHead" title={[
        basis === "balance" ? "Each zone's design-day peak — the zone air's heat balance at the timestep its unit supplies the most." : "Each zone's design-day peak by load component (the engine's Zone Component Load Summary).",
        `The zones' peaks summed: ${conv(sum).toFixed(1)} ${unit} (each at its own time — not one moment's load).`,
        none.length ? `No ${kind} (its unit supplied under 10 W on the design day): ${none.join(", ")}.` : "",
        basis === "balance" ? "Each term a gain (+) or loss (−) to the air: the sun and the lights' radiant share reach the air through the surfaces that absorb them, so they sit in those surfaces' bars; Zone Air Storage is the air warming or cooling; latent loads are not in it. The engine's Zone Component Load Summary (in its report) splits the peak another way, and with Kiva foundations its split is not reliable."
          : "With Kiva foundations in the model the engine's split by component is not reliable (the totals are) — Run again to draw each zone's own air heat balance.",
        "Under each column: the zone; hover it for the peak's time and the design air flow.",
      ].filter(Boolean).join("\n\n")}>
        PEAK CONDITIONING · PER ZONE · {kind === "heating" ? "HEATING" : "COOLING"} · {unit}
        {hover && <span className="runKey">{hover.zone} · {hover.component}: {conv(hover.w).toFixed(2)} {unit}{hover.component === "Heat Pump Water Heater" ? (basis === "balance" ? " — the heat its evaporator takes from the room at that instant" : " — the heat its evaporator takes from the room, the design day's mean (zone equipment: not in the engine's total)") : ""}</span>}
      </div>
      <div className="runGraphBody" ref={ref} style={size ? { height: size.h, flex: "0 0 auto" } : undefined}>
        <svg width={w} height={h}>
          {[...tu.map((t) => t), ...td.slice(1).map((t) => -t)].map((t) => (
            <g key={t}>
              <line x1={L} x2={L + pw} y1={y(t)} y2={y(t)} className={t === 0 ? "axisLine" : "gridLine"} />
              <text x={L - 6} y={y(t) + 3} textAnchor="end" className="axisText">{fmtTick(t)}</text>
            </g>
          ))}
          <text x={12} y={T + ph / 2} transform={`rotate(-90 12 ${T + ph / 2})`} textAnchor="middle" className="axisText">{unit}{kind === "heating" ? " · losses up" : " · gains up"}</text>
          {cols.map((c, i) => {
            const cx = L + slot * i + slot / 2;
            let pos = 0, neg = 0;
            return (
              <g key={c.zone}>
                {c.parts.map((p) => {
                  const v = conv(p.w), y0 = v >= 0 ? y(pos) : y(neg), y1 = v >= 0 ? y(pos + v) : y(neg + v);
                  if (v >= 0) pos += v; else neg += v;
                  return <rect key={p.component} x={cx - bw / 2} y={Math.min(y0, y1)} width={bw} height={Math.max(0.5, Math.abs(y1 - y0))} fill={COMPONENT_COLOR[p.component] ?? "#888"}
                    onMouseEnter={() => setHover({ zone: c.zone, component: p.component, w: p.w })} onMouseLeave={() => setHover(null)} />;
                })}
                <line x1={cx - bw / 2 - 4} x2={cx + bw / 2 + 4} y1={y(conv(c.total))} y2={y(conv(c.total))} className="totalTick" />
                <text x={cx} y={y(conv(c.total)) - 4} textAnchor="middle" className="axisText strong">{conv(c.total).toFixed(1)}</text>
                <text x={cx} y={T + ph + 14} textAnchor="middle" className="axisText">{c.zone}<title>{`${c.zone} · peak ${conv(c.total).toFixed(1)} ${unit} at ${c.time}${flows?.has(c.zone.toUpperCase()) ? ` · design air ${imperial ? `${Math.round(flows.get(c.zone.toUpperCase())! * M3S_TO_CFM)} cfm` : `${Math.round(flows.get(c.zone.toUpperCase())! * 1000)} L/s`}` : ""}`}</title></text>
              </g>
            );
          })}
        </svg>
        {all.length === 0 && <div className="runGraphEmpty">this run has no component loads — run again: the report is asked for since 2026-10-02</div>}
      </div>
      {basis === "engine" && all.length > 0 && <div className="runGraphNote runStale">the engine's split — not reliable with Kiva; Run again</div>}
      {used.length > 0 && (
        <div className="runLegend">
          {used.map((u) => <span key={u}><i style={{ background: COMPONENT_COLOR[u] ?? "#888" }} />{u === "Heat Pump Water Heater" && basis === "engine" ? "Heat Pump Water Heater (the day's mean; not in the engine's total)" : u}</span>)}
          <span><i className="tick" />{basis === "balance" ? "the unit's supply" : "the engine's total"}</span>
        </div>
      )}
    </div>
  );
}

/** THE VIEW: the active section's graphs */
export function RunGraphs({ bem, state, imperial, modelSha, onState, structures, spacesByZone }: { bem: BemOutcome | null; state: RunGraphState; imperial: boolean; modelSha: string | null; onState: (s: RunGraphState) => void;
  /** the sheet's structures and their units (the RUN column's Structure Peak) — PEAK's per-structure part */
  structures?: Array<{ name: string; units: string[]; unitZones?: Record<string, string[]> }>;
  /** the model's zones and their spaces — PEAK's per-space part */
  spacesByZone?: Record<string, string[]> }): ReactNode {
  if (!bem) return <div className="runGraphs"><div className="runGraphEmpty">no run yet — Run in the column, and its results are graphed here</div></div>;
  const stale = modelSha && bem.run.modelSha256 && bem.run.modelSha256 !== modelSha;
  const flowsOf = (k: PeakKind): Map<string, number> => new Map([...bem.loads.zones].map(([z, l]) => [z.toUpperCase(), k === "heating" ? l.designHeatingFlowM3s : l.designCoolingFlowM3s] as const).filter(([, v]) => v > 0));
  const parts = state.peakParts ?? RUN_GRAPH_DEFAULT.peakParts;
  return (
    <div className="runGraphs">
      {stale && <div className="runStale">these results are from an earlier model (run {bem.stamp}) — the model has changed since; Run again to graph it</div>}
      {state.section === "unmet" ? <UnmetHoursTable bem={bem} imperial={imperial} />
      : state.section === "annual" ? <>
          <AnnualGraph bem={bem} shown={state.annual} scale={state.scale} start={state.start} temps={state.temps} imperial={imperial} onWindow={(scale, start) => onState(scale !== state.scale ? rescale(state, scale) : { ...state, start })}
            pick={state.pick ?? null} pick2={state.pick2 ?? null} onPick={(p, second) => onState(second ? { ...state, pick2: p } : { ...state, pick: p })} />
          {/* the lines to draw, under the graph (user, 2026-10-12: "We should have the graph selection components in the upper section below the graph") */}
          <div className={`runViewChecks${state.checksOpen ? " open" : ""}`}>
            <button className="runChecksFold" onClick={() => onState({ ...state, checksOpen: !state.checksOpen })} title={state.checksOpen ? "fold the lines' checkboxes — the graph takes the space" : "unfold: check the lines the graph draws"}>
              {state.checksOpen ? "▾" : "▸"} lines drawn · {state.annual.length + (state.temps ?? []).length} of {ANNUAL_SERIES.length + TEMP_LINES.length}
              {!state.checksOpen && <span className="runChecksShown">{[...ANNUAL_SERIES.filter((x) => state.annual.includes(x.id)), ...TEMP_LINES.filter((x) => (state.temps ?? []).includes(x.id))].map((x) => <span key={x.id}><i style={{ background: x.color }} />{x.label}</span>)}</span>}
            </button>
            {state.checksOpen && <AnnualChecks state={state} onState={onState} bem={bem} />}
          </div>
        </>
        : state.peak.length === 0 || parts.length === 0 ? <div className="runGraphEmpty">check a part (per system, per zone, per space) and Heating or Cooling in the frame below</div>
        : <>
            {parts.includes("system") && <StructurePeakGraph structures={structurePeaks(structures ?? [], coilRows(bem.sizingDetails), bem.coilRates ?? { design: [], year: [] }, () => "")} kinds={state.peak} imperial={imperial} />}
            {parts.includes("zone") && state.peak.map((k) => <PeakGraph key={k} {...peakLoadsOf(bem)} kind={k} imperial={imperial} flows={flowsOf(k)} tall />)}
            {/* per space after per zone (user, 2026-10-23): a zone holds spaces, the lower detail follows */}
            {parts.includes("space") && <SpaceFlowGraphs rows={spaceRowsOf(bem, spacesByZone ?? {})} kinds={state.peak} state={state} imperial={imperial} />}
          </>}
    </div>
  );
}

/** THE FRAME: two section titles, the active one's checkboxes under it, the other's hidden */
/** THE ANNUAL GRAPH'S LINES, the checkboxes (2026-10-12: drawn under the graph in the view) */
export function AnnualChecks({ state, onState, bem }: { state: RunGraphState; onState: (s: RunGraphState) => void; bem: BemOutcome | null }): ReactNode {
  const lines = bem ? annualLines(bem) : new Map<AnnualSeries, SeriesLine>();
  const temps = bem ? outsideTemps(bem) : null;
  const toggle = <T extends string>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const check = (s: (typeof ANNUAL_SERIES)[number]): ReactNode => (
    <label key={s.id} title={lines.has(s.id) ? `the engine's ${lines.get(s.id)!.meters.join(" + ")}` : s.none}>
      <input type="checkbox" checked={state.annual.includes(s.id)} onChange={() => onState({ ...state, annual: toggle(state.annual, s.id) })} />
      <i style={{ background: s.color }} />{s.label}{bem && !lines.has(s.id) ? <em> · {s.none}</em> : null}
    </label>
  );
  const OCCUPANT: AnnualSeries[] = ["lighting", "equipment", "hotwater", "water", "charging"];
  return (
          <>
            <div className="runChecks"><span className="runGroup">conditioning · facility</span>{ANNUAL_SERIES.filter((s) => !OCCUPANT.includes(s.id)).map(check)}</div>
            <div className="runChecks"><span className="runGroup">occupant loads</span>{ANNUAL_SERIES.filter((s) => OCCUPANT.includes(s.id)).map(check)}</div>
            <div className="runChecks"><span className="runGroup">outside temperature · right axis</span>
              {TEMP_LINES.map((t) => (
                <label key={t.id} title={temps ? "each day's, from the engine's hourly outdoor dry-bulb (the run's weather file)" : "this run has no hourly outdoor temperature — Run again"}>
                  <input type="checkbox" checked={(state.temps ?? []).includes(t.id)} onChange={() => onState({ ...state, temps: toggle(state.temps ?? [], t.id) })} />
                  <i style={{ background: t.color }} />{t.label}{bem && !temps ? <em> · Run again</em> : null}
                </label>
              ))}
            </div>
          </>
  );
}

/** THE ANNUAL GRAPH'S SUMS (user, 2026-10-12: "use the lower frame under the Annual graph to show summations for their time frame of the
 *  components shown … A summation … would allow for quick checking between day and month (selecting a day point) amounts"): each line
 *  drawn, summed over the window in view — and at the point clicked on the graph, a day (or an hour on the day and week scales). The
 *  outside temperature: the window's highest high, lowest low and mean */
export function AnnualSums({ state, bem, imperial }: { state: RunGraphState; bem: BemOutcome | null; imperial: boolean }): ReactNode {
  if (!bem) return <div className="idfInfo">no run yet</div>;
  const lines = annualLines(bem), T0 = outsideTemps(bem);
  const { d0, n } = windowOf(state.scale, state.start);
  // the second column: the left-clicked point, or the range to the right-clicked one (the two in time order, both ends counted). Two points
  // picked by the hour sum the hours between them; a point picked by the day takes whole days
  const a = state.pick ?? null, b = state.pick2 ?? null;
  const one = a ?? b;
  const byHour = !!a && !!b ? a.hour !== null && b.hour !== null : !!one && one.hour !== null;
  const hIdx = (p: GraphPoint): number => p.day * 24 + (p.hour ?? 0);
  const [lo, hi] = a && b ? (byHour ? [Math.min(hIdx(a), hIdx(b)), Math.max(hIdx(a), hIdx(b))] : [Math.min(a.day, b.day), Math.max(a.day, b.day)]) : one ? (byHour ? [hIdx(one), hIdx(one)] : [one.day, one.day]) : [0, -1];
  const ptWords = (p: GraphPoint): string => `${dayLabel(p.day)}${p.hour !== null ? ` ${String(p.hour).padStart(2, "0")}:00` : ""}`;
  const endWords = (i: number): string => (byHour ? `${dayLabel(Math.floor(i / 24))} ${String(i % 24).padStart(2, "0")}:00` : dayLabel(i));
  const pickWords = !one ? null : a && b ? `${endWords(lo)} – ${byHour ? `${String((hi % 24) + 1).padStart(2, "0")}:00${Math.floor(hi / 24) !== Math.floor(lo / 24) ? ` ${dayLabel(Math.floor(hi / 24))}` : ""}` : dayLabel(hi)}${byHour ? ` (${hi - lo + 1} h)` : ` (${hi - lo + 1} days)`}`
    : `${ptWords(one)}${one.hour !== null ? `–${String(one.hour + 1).padStart(2, "0")}:00` : ""}`;
  const kwh = (v: number): string => (Number.isFinite(v) ? `${v.toLocaleString(undefined, { maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 2 })} kWh` : "—");
  const toT = (c: number): string => (Number.isFinite(c) ? (imperial ? `${(c * 9 / 5 + 32).toFixed(1)} °F` : `${c.toFixed(1)} °C`) : "—");
  const shown = ANNUAL_SERIES.filter((s) => state.annual.includes(s.id) && lines.has(s.id));
  const absent = ANNUAL_SERIES.filter((s) => state.annual.includes(s.id) && !lines.has(s.id));
  const tShown = T0 ? TEMP_LINES.filter((t) => (state.temps ?? []).includes(t.id)) : [];
  const sum = (arr: number[] | null, i0: number, i1: number): number => (!arr ? NaN : arr.slice(i0, i1 + 1).reduce((t, v) => t + v, 0));
  const atPick = (id: AnnualSeries): number => { const l = lines.get(id)!; return byHour ? sum(l.hourly, lo, hi) : sum(l.kwh, lo, hi); };
  const tOf = (id: TempLine, vals: number[]): number => { const v = vals.filter((x) => Number.isFinite(x)); return !v.length ? NaN : id === "high" ? Math.max(...v) : id === "low" ? Math.min(...v) : v.reduce((s, x) => s + x, 0) / v.length; };
  const tWin = (id: TempLine): number => tOf(id, T0![id].slice(d0, d0 + n));
  const tPick = (id: TempLine): number => tOf(id, byHour ? T0!.hourly.slice(lo, hi + 1) : T0![id].slice(lo, hi + 1));
  if (!shown.length && !tShown.length && !absent.length) return <div className="idfInfo">check a line under the graph (unfold "lines drawn") — its sum shows here</div>;
  return (
    <table className="runSums">
      <thead><tr><th>line</th><th className="num">{windowWordsOf(state.scale, state.start)}</th>{pickWords && <th className="num">{pickWords}</th>}</tr></thead>
      <tbody>
        {shown.map((s) => (
          <tr key={s.id}><td><i style={{ background: s.color }} />{s.label}</td>
            <td className="num">{kwh(lines.get(s.id)!.kwh.slice(d0, d0 + n).reduce((t, v) => t + v, 0))}</td>
            {pickWords && <td className="num">{kwh(atPick(s.id))}</td>}</tr>
        ))}
        {absent.map((s) => (
          <tr key={s.id} className="dim"><td><i style={{ background: "transparent", border: `1px solid ${s.color}` }} />{s.label}</td><td colSpan={pickWords ? 2 : 1}>not drawn — {s.none}</td></tr>
        ))}
        {tShown.map((tl) => (
          <tr key={tl.id}><td><i style={{ background: tl.color }} />{tl.label}{tl.id === "high" ? " (the highest)" : tl.id === "low" ? " (the lowest)" : " (the mean)"}</td>
            <td className="num">{toT(tWin(tl.id))}</td>
            {pickWords && <td className="num">{toT(tPick(tl.id))}</td>}</tr>
        ))}
      </tbody>
    </table>
  );
}

/** THE FRAME UNDER THE GRAPHS: Annual's sums; Peak's parts and loads */
export function RunGraphFrame({ state, onState, bem, imperial = false, spacesByZone = {} }: { state: RunGraphState; onState: (s: RunGraphState) => void; bem: BemOutcome | null; imperial?: boolean;
  /** the model's zones (PER SPACE's Zones drop-down) */ spacesByZone?: Record<string, string[]> }): ReactNode {
  const toggle = <T extends string>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const parts = state.peakParts ?? RUN_GRAPH_DEFAULT.peakParts;
  const [zonesOpen, setZonesOpen] = useState(false);
  const zones = Object.keys(spacesByZone);
  const picked = state.spaceZones ?? null;
  const pickZone = (z: string): void => { const cur = picked ?? zones; const next = toggle(cur, z); onState({ ...state, spaceZones: next.length === zones.length ? null : next }); };
  // ΔT typed in the units shown (°F, or K when metric), kept in °F
  const dtIn = (k: PeakKind): ReactNode => {
    const f = dtOf(state, k), shown = imperial ? f : Number(((f * 5) / 9).toFixed(1));
    return (
      <label key={k} title={`the ${k} coil's air temperature difference, entering to leaving — the per-space air flow is the design load across it (default ${imperial ? `${DT_DEFAULT_F[k]} °F` : `${((DT_DEFAULT_F[k] * 5) / 9).toFixed(1)} K`})`}>
        {k === "cooling" ? "Cooling" : "Heating"} ΔT
        <input type="number" className="dtIn" min={1} step={imperial ? 1 : 0.5} value={shown}
          onChange={(e) => { const v = Number(e.target.value); if (!(v > 0)) return; const fv = imperial ? v : (v * 9) / 5; onState({ ...state, [k === "cooling" ? "dtCoolF" : "dtHeatF"]: Number(fv.toFixed(2)) }); }} />
        {imperial ? "°F" : "K"}
      </label>
    );
  };
  return (
    <div className="runFrame">
      {state.section === "unmet" && (
        <div className="runSection on">
          <div className="idfInfo">The view lists each conditioned zone with its conditioned spaces, by the month its setpoint was not met.
            A zone's spaces share one thermostat, so the hours are the zone's. Read beside it: the zone's heating and cooling (RUN › results),
            its design load against its equipment's capacity (GRAPHS · PEAK), and its thermostat on ZONES.</div>
        </div>
      )}
      {state.section === "annual" && (
        <div className="runSection on">
          <div title={`left-click the graph for a point, right-click for a second: the range between them${state.pick || state.pick2 ? " — click a point again to clear it" : ""}`}><AnnualSums state={state} bem={bem} imperial={imperial} /></div>
        </div>
      )}
      <div className={`runSection${state.section === "peak" ? " on" : ""}`} hidden={state.section !== "peak"}>
        <button className="runTitle" onClick={() => onState({ ...state, section: "peak" })}>PEAK CONDITIONING</button>
        {state.section === "peak" && (
          <>
            <div className="runChecks"><span className="runGroup">part</span>
              {PEAK_PARTS.map((p) => (
                <label key={p.id} title={p.title}>
                  <input type="checkbox" checked={parts.includes(p.id)} onChange={() => onState({ ...state, peakParts: toggle(parts, p.id) })} />{p.label}
                </label>
              ))}
            </div>
            <div className="runChecks"><span className="runGroup">load</span>
              {PEAK_KINDS.map((k) => (
                <label key={k.id}>
                  <input type="checkbox" checked={state.peak.includes(k.id)} onChange={() => onState({ ...state, peak: toggle(state.peak, k.id) })} />{k.label}
                </label>
              ))}
            </div>
            {parts.includes("space") && (
              <div className="runChecks"><span className="runGroup">per space · coil ΔT and zones</span>
                {(["cooling", "heating"] as PeakKind[]).map(dtIn)}
                <span className="zoneDrop">
                  <button className="qaBtn" onClick={() => setZonesOpen((o) => !o)} title="the zones whose spaces the per-space graphs draw">
                    Zones: {picked ? `${picked.length} of ${zones.length}` : "All"} ▾
                  </button>
                  {zonesOpen && <>
                    <div className="menuScrim" onPointerDown={() => setZonesOpen(false)} />
                    <div className="zoneDropMenu">
                      <label><input type="checkbox" checked={!picked} onChange={() => onState({ ...state, spaceZones: picked ? null : [] })} />All</label>
                      {zones.map((z) => <label key={z}><input type="checkbox" checked={!picked || picked.includes(z)} onChange={() => pickZone(z)} />{z} <em>{spacesByZone[z]!.length}</em></label>)}
                    </div>
                  </>}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** THE UNMET HOURS (user, 2026-11-21: "the unmet hours should show on a Unmet Hours view as a table with spaces listed that show when
 *  temperatures were not met. If a space is unconditioned, then it should not be listed as unmet"): every CONDITIONED zone with hours
 *  its heating or cooling setpoint was not met, a row per side, the engine's own Zone … Setpoint Not Met Time month by month and the
 *  year; the zone's conditioned spaces beside it. A zone with none is named once at the foot; an unconditioned zone is never listed */
export function UnmetHoursTable({ bem, imperial }: { bem: BemOutcome; imperial: boolean }): ReactNode {
  const up = (s: string): string => s.toUpperCase();
  const pick = <T,>(m: Map<string, T>, z: { name: string; epName: string }): T | undefined => m.get(up(z.epName)) ?? m.get(up(z.name));
  const byMonth = bem.monthlyUnmet.heating.size + bem.monthlyUnmet.cooling.size > 0;
  const zones = bem.zones.filter((z) => z.conditioned);
  const unconditioned = bem.zones.filter((z) => !z.conditioned).map((z) => z.name);
  const temp = (c: number | null): string => (c === null ? "—" : imperial ? `${(c * 9 / 5 + 32).toFixed(0)} °F` : `${c.toFixed(1)} °C`);
  const hrs = (v: number): string => (v < 0.05 ? "" : v < 10 ? v.toFixed(1) : v.toFixed(0));
  type Row = { side: "heating" | "cooling"; setC: number | null; months: number[] | null; total: number };
  const groups = zones.map((z) => {
    const spaces = bem.rooms.filter((r) => r.zone === z.name && r.conditioned).map((r) => r.room);
    const rows: Row[] = (["heating", "cooling"] as const).map((side) => {
      const months = pick(bem.monthlyUnmet[side], z) ?? null;
      const total = months ? months.reduce((t, v) => t + v, 0) : pick(bem.unmetYear[side], z) ?? 0;
      return { side, setC: side === "heating" ? z.heatingSetpointC : z.coolingSetpointC, months, total };
    }).filter((r) => r.total >= 0.05);
    return { zone: z.name, spaces: spaces.length ? spaces : [z.name], rows, worst: Math.max(0, ...rows.map((r) => r.total)) };
  });
  const hit = groups.filter((g) => g.rows.length).sort((a, b) => b.worst - a.worst);
  const met = groups.filter((g) => !g.rows.length).map((g) => g.zone);
  const sum = (side: "heating" | "cooling"): number => hit.reduce((t, g) => t + (g.rows.find((r) => r.side === side)?.total ?? 0), 0);
  return (
    <div className="unmetView">
      <div className="runGraphNote">
        UNMET HOURS · run {bem.stamp} — the hours each conditioned zone's air stood below its heating setpoint or above its cooling setpoint by
        more than the engine's tolerance (0.2 °C = 0.36 °F, OutputControl:ReportingTolerances' default), month by month. Unconditioned zones
        are not listed{unconditioned.length ? ` (${unconditioned.length}: ${unconditioned.join(", ")})` : ""}.
        {!byMonth && <span className="runStale"> This run holds the year only — Run again for the months.</span>}
      </div>
      {hit.length === 0 ? <div className="runGraphNote">every conditioned zone met its setpoints every hour of the run</div> : (
        <table className="runSums unmetTable">
          <thead><tr><th>zone</th><th>spaces</th><th>side</th><th className="num">setpoint</th>
            {byMonth && MONTHS.map((m) => <th key={m} className="num">{m}</th>)}<th className="num">year, h</th></tr></thead>
          <tbody>
            {hit.flatMap((g) => g.rows.map((r, i) => (
              <tr key={`${g.zone}|${r.side}`} className={i === 0 ? "first" : ""}>
                <td>{i === 0 ? g.zone : ""}</td>
                <td className="spaces">{i === 0 ? g.spaces.join(", ") : ""}</td>
                <td className={r.side === "heating" ? "heat" : "cool"}>{r.side}</td>
                <td className="num">{temp(r.setC)}</td>
                {byMonth && MONTHS.map((m, k) => <td key={m} className={`num${(r.months?.[k] ?? 0) >= 0.05 ? " hit" : ""}`}>{hrs(r.months?.[k] ?? 0)}</td>)}
                <td className="num"><b>{hrs(r.total)}</b></td>
              </tr>
            )))}
          </tbody>
          <tfoot><tr><td colSpan={byMonth ? 16 : 4}>Σ over the zones listed: heating {hrs(sum("heating")) || "0"} h · cooling {hrs(sum("cooling")) || "0"} h — zone-hours, not the facility's (the engine's facility count is {bem.facility.unmetHeatingH.toFixed(1)} h heating · {bem.facility.unmetCoolingH.toFixed(1)} h cooling, occupied hours with any zone unmet)</td></tr></tfoot>
        </table>
      )}
      {met.length > 0 && <div className="runGraphNote">met every hour: {met.join(", ")}</div>}
    </div>
  );
}
