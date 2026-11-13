// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE TARIFF (user, 2026-10-03: "BOM main view should show the energyplus results with utility costs included in both energyplus
// runs and utility bills"). A card is the utility's own schedule as DATA (the user's tables/tariffs/tariff.json, made from the
// template references/tariffs/tariff.template.json): every number with the schedule, section and URL it was read from;
// a number without its citation is refused. One arithmetic prices a month of the run and a month of the bills alike:
//
//   net = kWh in − kWh out (the meter's delivered minus received)
//   net > 0: credits banked earlier are applied first; the rest is billed — delivery and supply per kWh, the PCA per kWh, the
//            demand charge on the month's billing demand
//   net ≤ 0: a billing-period credit — only the non-usage-sensitive charge (the access charge) is paid; −net kWh are banked
//   end of a 12-month net metering period: the bank carries into the next period only up to the period's billed consumption
//            (less the credits carried in and applied); the rest is not compensated (no purchase agreement — the user's ruling)
//
// The PCA (power cost adjustment) is NOT in the schedule: typed from a bill, or the line says it is missing and the total leaves it
// out. A demand the month did not state (a bill without kW) is said, never assumed.

import { hourDate, isCalendarYear, DAYS_IN, MONTH_NAMES } from "../../bem/core/runCalendar.js";

export interface Cited { value: number; unit: string; cite: string; url: string }
export interface TariffCharges { accessUsdMonth: Cited; deliveryUsdKwh: Cited; demandUsdKw: Cited; supplySummerUsdKwh: Cited; supplyWinterUsdKwh: Cited }
export interface TariffCard {
  id: string; name: string; status: "in force" | "pending"; effective: string; fuel: string; note?: string;
  /** THE SAMPLE CARD shipped with the program (user, 2026-10-16): example values, no utility's — no schedule to link to */
  sample?: boolean;
  charges?: TariffCharges; summerMonths?: number[];
  demandWindow?: { fromHour: number; toHour: number; cite: string };
  minimum?: { cite: string }; pca?: { cite: string; url: string };
  netMetering?: { schedule: string; url: string; maxKwAc: number; rules: string[]; rulesUrl: string };
}
export interface TariffFile { readAt: string; utility: string; cards: TariffCard[] }

const CHARGE_KEYS: Array<keyof TariffCharges> = ["accessUsdMonth", "deliveryUsdKwh", "demandUsdKw", "supplySummerUsdKwh", "supplyWinterUsdKwh"];

/** the cards, each checked: an in-force card with a charge missing its number, unit, citation or URL is refused by name */
export function parseTariffs(text: string): { file: TariffFile | null; usable: TariffCard[]; refused: string[] } {
  const refused: string[] = [];
  let file: TariffFile;
  try { file = JSON.parse(text) as TariffFile; } catch (e) { return { file: null, usable: [], refused: [`the tariff file does not read: ${(e as Error).message}`] }; }
  const usable: TariffCard[] = [];
  for (const c of file.cards ?? []) {
    if (c.status !== "in force") continue;
    const bad = CHARGE_KEYS.filter((k) => { const x = c.charges?.[k]; return !x || typeof x.value !== "number" || !Number.isFinite(x.value) || !x.unit || !x.cite || (!x.url && !c.sample); });
    if (!c.summerMonths?.length) bad.push("summerMonths" as keyof TariffCharges);
    if (!c.demandWindow) bad.push("demandWindow" as keyof TariffCharges);
    if (bad.length) refused.push(`${c.id}: ${bad.join(", ")} without a number and its citation — refused`);
    else usable.push(c);
  }
  return { file, usable, refused };
}

/** THE SAMPLE CARD beside the user's (2026-10-16: "a 'Sample' utility card … predefined and applied in absence of other card"): the
 *  user's cards first, then the sample's — offered always, priced by when no card is applied */
export function withSample(user: ReturnType<typeof parseTariffs> | null, sample: ReturnType<typeof parseTariffs>): ReturnType<typeof parseTariffs> {
  const mark = (c: TariffCard): TariffCard => ({ ...c, sample: true });
  const cards = [...(user?.file?.cards ?? []), ...(sample.file?.cards ?? []).map(mark)];
  return { file: { readAt: user?.file?.readAt ?? sample.file?.readAt ?? "", utility: user?.file?.utility ?? "", cards }, usable: [...(user?.usable ?? []), ...sample.usable.map(mark)], refused: [...(user?.refused ?? []), ...sample.refused] };
}
/** the card a run is priced by: the one applied, else the sample */
export const cardInForce = (read: ReturnType<typeof parseTariffs> | null, applied: string | undefined): TariffCard | undefined =>
  applied ? read?.usable.find((c) => c.id === applied) : read?.usable.find((c) => c.sample);

/** the PCA as typed: one value for every month, or a value per month ("1"…"12", or a bill's "YYYY-MM"), $/kWh */
export interface PcaRuling { all?: number; byMonth?: Record<string, number> }
/** a month to price: the run's calendar month or a bill's period */
export interface MonthUse {
  key: string; label: string;
  /** the month the season is read from (1–12): the run's own month, a bill's period-end month */
  month: number;
  kwhIn: number; kwhOut: number;
  /** the month's billing demand, kW — the greatest hour in the demand window; null = not stated */
  peakKw: number | null;
}
export interface BillLine {
  key: string; label: string; month: number;
  kwhIn: number; kwhOut: number; netKwh: number;
  /** credits (kWh) banked before the month, applied in it, banked after it */
  creditIn: number; creditApplied: number; creditOut: number;
  billedKwh: number; peakKw: number | null;
  access: number; delivery: number; demand: number | null; supply: number; pca: number | null;
  total: number;
  surplus: boolean; pcaMissing: boolean; demandMissing: boolean;
  /** kWh not compensated at the end of a net metering period, when this month closes one */
  forfeitedKwh: number;
  notes: string[];
}

const pcaFor = (p: PcaRuling | undefined, m: MonthUse): number | null => p?.byMonth?.[m.key] ?? p?.byMonth?.[String(m.month)] ?? p?.all ?? null;

/** the months priced in order; `periodStart` = the index of the month that opens a 12-month net metering period (the first by default) */
export function priceMonths(card: TariffCard, months: MonthUse[], opts: { pca?: PcaRuling; periodStart?: number } = {}): { lines: BillLine[]; total: number; refused: string[] } {
  const ch = card.charges;
  if (!ch || card.status !== "in force") return { lines: [], total: 0, refused: [`${card.id} is ${card.status} — it holds no rates to price with`] };
  const lines: BillLine[] = [];
  let bank = 0, periodBilled = 0, carriedInApplied = 0, carriedIn = 0;
  const start = Math.max(0, opts.periodStart ?? 0);
  months.forEach((m, i) => {
    // a new 12-month period opens: what the last one banked carries only up to its billed consumption (less the carry it used)
    if (i > start && (i - start) % 12 === 0) {
      const cap = Math.max(0, periodBilled - carriedInApplied);
      const keep = Math.min(bank, cap), lost = bank - keep;
      if (lines.length) { lines[lines.length - 1]!.forfeitedKwh = lost; if (lost > 0) lines[lines.length - 1]!.notes.push(`end of the net metering period: ${lost.toFixed(0)} kWh of credit not compensated (no purchase agreement); ${keep.toFixed(0)} kWh carried into the next period (up to the period's billed consumption)`); }
      bank = keep; carriedIn = keep; carriedInApplied = 0; periodBilled = 0;
    }
    const net = m.kwhIn - m.kwhOut, creditIn = bank, notes: string[] = [];
    const summer = card.summerMonths!.includes(m.month);
    const access = ch.accessUsdMonth.value;
    let billed = 0, applied = 0, demand: number | null = 0, delivery = 0, supply = 0, pca: number | null = 0;
    const surplus = net <= 0;
    if (surplus) {
      bank += -net;
      notes.push(`a billing-period credit: ${(-net).toFixed(0)} kWh banked; only the access charge is paid (NEM-10A §3)`);
    } else {
      applied = Math.min(bank, net);
      bank -= applied;
      billed = net - applied;
      if (applied > 0) { notes.push(`${applied.toFixed(0)} kWh of banked credit applied`); const fromCarry = Math.min(applied, Math.max(0, carriedIn - carriedInApplied)); carriedInApplied += fromCarry; }
      periodBilled += net;
      delivery = billed * ch.deliveryUsdKwh.value;
      supply = billed * (summer ? ch.supplySummerUsdKwh.value : ch.supplyWinterUsdKwh.value);
      demand = m.peakKw === null ? null : m.peakKw * ch.demandUsdKw.value;
      const p = pcaFor(opts.pca, m);
      pca = p === null ? null : billed * p;
    }
    const pcaMissing = !surplus && pca === null, demandMissing = !surplus && demand === null;
    if (pcaMissing) notes.push("the PCA is not typed — left out of the total");
    if (demandMissing) notes.push("no demand stated for the month — the demand charge is left out");
    const total = access + delivery + (demand ?? 0) + supply + (pca ?? 0);
    lines.push({ key: m.key, label: m.label, month: m.month, kwhIn: m.kwhIn, kwhOut: m.kwhOut, netKwh: net, creditIn, creditApplied: applied, creditOut: bank,
      billedKwh: billed, peakKw: m.peakKw, access, delivery, demand: surplus ? 0 : demand, supply, pca: surplus ? 0 : pca, total, surplus, pcaMissing, demandMissing, forfeitedKwh: 0, notes });
  });
  return { lines, total: lines.reduce((t, l) => t + l.total, 0), refused: [] };
}

/** the run's months from its hourly meters (J per hour; hour i = the i-th hour after the run's first midnight, dated by the series'
 *  `start`): kWh in = purchased (or the facility's whole electricity without a generator), kWh out = surplus sold; the billing demand =
 *  the greatest hourly kWh (= mean kW over the clock hour) of what was bought in the window's hours. A run over one calendar year from
 *  Jan 1 (a typical year) reads as the twelve months Jan–Dec, keyed by the month's number; any other run (an actual-year run from the
 *  solar's connection, 2026-10-07) reads as its own months in date order, keyed YYYY-MM — a month the run holds only part of is left
 *  out and named (its access charge is a whole month's) */
export function monthsFromHourly(hourly: ReadonlyArray<{ name: string; values: number[]; start?: readonly [number, number, number] }>, window: { fromHour: number; toHour: number }): { months: MonthUse[]; meters: string[]; dated: boolean; partial: string[] } | null {
  const ser = (n: string) => hourly.find((h) => h.name === n);
  const boughtS = ser("ElectricityPurchased:Facility") ?? ser("Electricity:Facility"), soldS = ser("ElectricitySurplusSold:Facility");
  const bought = boughtS?.values, sold = soldS?.values;
  if (!bought || bought.length < 24 * 28) return null;
  const meters = [ser("ElectricityPurchased:Facility") ? "ElectricityPurchased:Facility" : "Electricity:Facility", ...(sold ? ["ElectricitySurplusSold:Facility"] : [])];
  const start = boughtS!.start;
  const dated = !isCalendarYear(start, bought.length);
  const by = new Map<string, MonthUse & { hours: number; y: number }>();
  const n = dated ? bought.length : 8760;
  for (let h = 0; h < n; h++) {
    const [y, m, d, clock] = hourDate(start, h);
    if (!dated && m === 2 && d === 29) continue;
    const key = dated ? `${y}-${String(m).padStart(2, "0")}` : String(m);
    const u = by.get(key) ?? by.set(key, { key, label: dated ? `${MONTH_NAMES[m - 1]} ${y}` : MONTH_NAMES[m - 1]!, month: m, kwhIn: 0, kwhOut: 0, peakKw: 0, hours: 0, y }).get(key)!;
    const kwh = bought[h]! / 3.6e6;
    u.kwhIn += kwh; u.kwhOut += sold ? (sold[h] ?? 0) / 3.6e6 : 0; u.hours++;
    if (clock >= window.fromHour && clock < window.toHour && kwh > (u.peakKw ?? 0)) u.peakKw = kwh;
  }
  const partial: string[] = [];
  const months: MonthUse[] = [];
  for (const u of by.values()) {
    const leap = u.y % 4 === 0 && (u.y % 100 !== 0 || u.y % 400 === 0);
    const full = (u.month === 2 && leap ? 29 : DAYS_IN[u.month - 1]!) * 24;
    if (dated && u.hours < full) { partial.push(`${u.label} (${Math.round(u.hours / 24)} of ${full / 24} days)`); continue; }
    const { hours: _h, y: _y, ...m } = u;
    months.push(m);
  }
  return { months, meters, dated, partial };
}

/** a bill as a month to price: its billed kWh as kWh in (a net meter's bill states the net), the season by its period's end month; a bill
 *  that states what the meter received (entered by hand, 2026-10-08) prices delivered in and received out, the net unchanged */
export function monthFromBill(b: { periodStart: string; periodEnd: string; measured: number; demandKw: number | null; receivedKwh?: number | null; account?: string }): MonthUse {
  const m = Number(b.periodEnd.slice(5, 7));
  const rec = b.receivedKwh ?? null;
  const io = rec !== null && rec >= 0 ? { kwhIn: b.measured + rec, kwhOut: rec } : { kwhIn: Math.max(0, b.measured), kwhOut: Math.max(0, -b.measured) };
  return { key: b.periodEnd.slice(0, 7), label: `${b.periodStart} – ${b.periodEnd}`, month: m, ...io, peakKw: b.demandKw };
}

/** THE EQUIVALENT $/kWh (user, 2026-10-10): the bills' total dollars over the kWh the grid delivered across the same bills */
export function equivalentPerKwh(bills: ReadonlyArray<{ costUsd: number | null; measured: number; receivedKwh?: number | null; fuel?: string }>): { usd: number; kwh: number; n: number; perKwh: number } | null {
  const b = bills.filter((x) => x.costUsd !== null && (!x.fuel || /elec/i.test(x.fuel)));
  const usd = b.reduce((t, x) => t + (x.costUsd ?? 0), 0);
  // the bill's Consumption: the net and what was sent to the grid
  const kwh = b.reduce((t, x) => t + x.measured + Math.max(0, x.receivedKwh ?? 0), 0);
  return b.length && kwh > 0 ? { usd, kwh, n: b.length, perKwh: usd / kwh } : null;
}

/** THE MODEL OVER A BILL'S OWN DAYS (user, 2026-10-07: "When Utility costs are compared to model costs, that has to adjust to the utility
 *  bills available and ideally capture real weather for the same period"). The run's hours whose date falls inside the bill's period
 *  (inclusive, as bills state it), summed as the bill's month is: kWh in, kWh out, the greatest hour in the demand window. A run dated
 *  by an actual-year weather file is read by its DATES; a typical-year run by the bill's calendar days (month and day, any year — the
 *  weather is not the bills'; Feb 29 has none). `hours` against `needed` says whether the run covered the whole period. */
export function usageOverPeriod(hourly: ReadonlyArray<{ name: string; values: number[]; start?: readonly [number, number, number] }>, periodStart: string, periodEnd: string,
  window: { fromHour: number; toHour: number }): { use: MonthUse; hours: number; needed: number; basis: "dates" | "calendar days" } | null {
  const ser = (n: string) => hourly.find((h) => h.name === n);
  const boughtS = ser("ElectricityPurchased:Facility") ?? ser("Electricity:Facility"), soldS = ser("ElectricitySurplusSold:Facility");
  const bought = boughtS?.values, sold = soldS?.values;
  if (!bought?.length) return null;
  const start = boughtS!.start, dated = !isCalendarYear(start, bought.length);
  const iso = (y: number, m: number, d: number): string => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const md = (s: string): string => s.slice(5, 10);
  const a = periodStart.slice(0, 10), b = periodEnd.slice(0, 10);
  const needed = Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000 + 1) * 24;
  // a typical year's calendar days: a period crossing the new year wraps (Dec 20 → Jan 19)
  const inTyp = (k: string): boolean => (md(a) <= md(b) ? k >= md(a) && k <= md(b) : k >= md(a) || k <= md(b));
  let kwhIn = 0, kwhOut = 0, peak = 0, hours = 0;
  const n = dated ? bought.length : Math.min(bought.length, 8760);
  for (let h = 0; h < n; h++) {
    const [y, m, d, clock] = hourDate(start, h);
    const day = iso(y, m, d);
    if (dated ? day < a || day > b : !inTyp(day.slice(5))) continue;
    const kwh = bought[h]! / 3.6e6;
    kwhIn += kwh; kwhOut += sold ? (sold[h] ?? 0) / 3.6e6 : 0; hours++;
    if (clock >= window.fromHour && clock < window.toHour && kwh > peak) peak = kwh;
  }
  const m = Number(b.slice(5, 7));
  return { use: { key: b.slice(0, 7), label: `${a} – ${b}`, month: m, kwhIn, kwhOut, peakKw: hours ? peak : null }, hours, needed, basis: dated ? "dates" : "calendar days" };
}
