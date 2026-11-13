// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// BOM · ENERGY & COST (user, 2026-10-03: "BOM main view should show the energyplus results with utility costs included in both
// energyplus runs and utility bills … This could be a card under the Utility view in the frame below. Selected utility card should
// show details in right column"). Three parts, the SYSTEMS pattern:
//   the VIEW   — the run's twelve months and the bills' periods, each priced by the applied tariff, kWh in and out, the credit bank
//   the FRAME  — rails UTILITY · WEATHER · BILLS, a card each (a tariff card, the weather file, each import)
//   the COLUMN — the selected card's details: a tariff's every charge with its citation, the PCA typed from a bill, Apply
// One arithmetic prices both sides (core/tariff.ts); the engine's own monthly totals ride beside the run's when the run priced them.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { priceMonths, monthsFromHourly, monthFromBill, usageOverPeriod, equivalentPerKwh, type TariffCard, type BillLine, type PcaRuling, type MonthUse } from "../core/tariff.js";
import type { BomLedger } from "../core/bomDb.js";
import type { BillRow } from "../core/csvRead.js";
import type { AmyCounts } from "../../bem/core/amyEpw.js";
import { groupSubtotals, statementTotal, statementMonth, type Statement } from "../core/statement.js";
import { equivalentWithoutPv, type BillNoPv } from "../core/calibration.js";
import { makeActualWeather, latestEnd } from "../weatherMake.js";
import type { AmyStation } from "../../../core/projectSources.js";

export type BomRail = "UTILITY" | "WEATHER" | "BILLS";
export const BOM_RAILS: BomRail[] = ["UTILITY", "WEATHER", "BILLS"];
const RAIL_COLOR: Record<BomRail, string> = { UTILITY: "#b8860b", WEATHER: "#2f6fd6", BILLS: "#2e9e5e" };
export interface BomCardSel { rail: BomRail; id: string }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const usd = (v: number): string => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const k0 = (v: number): string => Math.round(v).toLocaleString();

export interface Priced {
  card: TariffCard;
  /** the run's months, Jan…Dec (priced from the opening month of the net metering period, shown by calendar month) */
  run: BillLine[] | null; runMeters: string[];
  /** an actual-year run's months it holds only part of — left out of the pricing, named */
  runPartial: string[];
  /** the engine's own monthly totals for this card, when the run priced it */
  engine: number[] | null; engineAnnual: number | null;
  /** the bills in their order, each priced; with the billed $ the utility stated, when the CSV had it */
  bills: Array<{ line: BillLine; bill: BillRow }>;
  /** EACH BILL AGAINST THE MODEL OVER ITS OWN DAYS (2026-10-07), both priced by the card in the bills' order: `covered` when the run holds
   *  every hour of the period; `basis` "dates" (an actual-year run — the weather the bill was metered under, when the file is that
   *  period's) or "calendar days" (a typical-year run on the bill's month and day) */
  paired: Array<{ bill: BillRow; billLine: BillLine; model: BillLine; covered: boolean; hours: number; needed: number }>;
  pairBasis: "dates" | "calendar days" | null;
}

/** both sides priced by one card: the run's hourly meters, the bills' rows */
export function priceBoth(card: TariffCard, t: BomLedger["tariff"] | undefined, hourly: ReadonlyArray<{ name: string; values: number[]; start?: readonly [number, number, number] }>, bills: BillRow[],
  engine: Array<{ name: string; annualUsd: number; monthlyUsd: number[] }>): Priced {
  const pca: PcaRuling | undefined = t?.pca, start = Math.min(12, Math.max(1, t?.nemStartMonth ?? 1));
  const R = monthsFromHourly(hourly, card.demandWindow!);
  let run: BillLine[] | null = null;
  if (R && R.dated) {
    // AN ACTUAL-YEAR RUN (2026-10-07): its own months in date order; the net metering period opens at the first month that is the
    // period's month, as on the bills
    const ps = Math.max(0, R.months.findIndex((m) => m.month === start));
    run = priceMonths(card, R.months, { ...(pca ? { pca } : {}), periodStart: ps }).lines;
  } else if (R) {
    // the 12-month net metering period opens at its month: the run's months priced from there, wrapping into the next January
    const order: MonthUse[] = [...R.months.slice(start - 1), ...R.months.slice(0, start - 1)];
    const lines = priceMonths(card, order, pca ? { pca } : {}).lines;
    run = [...lines].sort((a, b) => a.month - b.month);
  }
  const sorted = [...bills].filter((b) => /elec/i.test(b.fuel) || !b.fuel).sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  const um = sorted.map((b) => monthFromBill(b));
  const ps = Math.max(0, um.findIndex((m) => m.month === start));
  const bl = priceMonths(card, um, { ...(pca ? { pca } : {}), periodStart: ps }).lines;
  const e = engine.find((x) => x.name.toUpperCase() === card.id.toUpperCase()) ?? null;
  const uses = sorted.map((b) => usageOverPeriod(hourly, b.periodStart, b.periodEnd, card.demandWindow!));
  const okUses = uses.every((u) => !!u);
  const ml = okUses ? priceMonths(card, uses.map((u) => u!.use), { ...(pca ? { pca } : {}), periodStart: ps }).lines : [];
  const paired = okUses ? sorted.map((bill, i) => ({ bill, billLine: bl[i]!, model: ml[i]!, hours: uses[i]!.hours, needed: uses[i]!.needed,
    // a typical year has no Feb 29: a period holding one is still whole
    covered: uses[i]!.hours >= uses[i]!.needed - (uses[i]!.basis === "calendar days" ? 24 : 0) })).filter((x) => x.billLine && x.model) : [];
  return { paired, pairBasis: okUses && uses[0] ? uses[0].basis : null, card, run, runPartial: R?.partial ?? [], runMeters: R?.meters ?? [], engine: e?.monthlyUsd ?? null, engineAnnual: e?.annualUsd ?? null, bills: bl.map((line, i) => ({ line, bill: sorted[i]! })) };
}

/** the container's size */
/** the box's size, measured whenever the box itself appears (2026-10-23: BOM opened before its run is read draws the chart later — a
 *  measure taken once, on the first render, found no box and left the chart at 800 × 300 in a box twice that) */
function useSize<T extends HTMLElement>(): [(el: T | null) => void, { w: number; h: number }] {
  const [el, setEl] = useState<T | null>(null);
  const [size, setSize] = useState({ w: 800, h: 300 });
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el); setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [el]);
  return [setEl, size];
}
function niceTop(v: number): number { if (!(v > 0)) return 1; const p = 10 ** Math.floor(Math.log10(v)); return ([1, 2, 2.5, 5, 10].find((f) => f * p >= v) ?? 10) * p; }

/** THE VIEW (user, 2026-10-10: "graph the BEM Standard (based on BEM standard TMY), Calibrated (as amended with actual period of billing
 *  data) and Bill (total) costs" — then "show Standard w/o and w/ PV, Calibrated w/o and w/ PV, and Billed w/o and w/ PV"): by month, each
 *  side as the house without the panels and as it is — BEM's design run priced by the card; BOM's calibration run priced by the same card
 *  over each bill's own dates; each bill's total as billed and, without the panels, that total moved by the card's price of what they made */
export type BomCostProps = { priced: Priced | null; calibrated?: Priced | null;
  withoutPv?: { standard: Priced | null; calibrated: Priced | null; bills: BillNoPv[] | null }; applied: boolean; why: string | null; statements?: Statement[];
  /** the building has a PV or other renewable system (user, 2026-10-23: without one, BOM shows no PV values) */
  pv?: boolean;
  /** EACH METER PRICED (user, 2026-10-23: "The BOM should offer utility cost per meter"): the ELECTRICAL sheet's meters, each priced on
   *  the same card as an account of its own */
  meters?: MeterPriced[] };
export interface MeterPriced { name: string; zones: string[]; priced: Priced }

/** THE VIEW IS THE CHART (user, 2026-10-23: "The chart is the item to show in view, the tables in the view should be referenced in the
 *  right column under 5. Cost Tables") — the months' cost, w/o PV dark behind, w/ PV light in front; the tables are BomCostTables */
export function BomCostView({ priced, calibrated = null, withoutPv, applied, why, pv = true, meters = [] }: BomCostProps): ReactNode {
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);
  if (!priced) return <div className="runGraphs"><div className="runGraphEmpty">{why ?? "pick the tariff in UTILITY below and Apply it"}</div></div>;
  const P = priced;
  const billByMonth = new Map<number, { line: BillLine; bill: BillRow }>();
  for (const b of P.bills) billByMonth.set(b.line.month, b);   // the latest bill ending in each month
  // a calibration run over each bill's own dates — only the periods it covers whole
  const byMonthOf = (Q: Priced | null | undefined): Map<number, BillLine> => {
    const m = new Map<number, BillLine>();
    for (const x of Q?.paired ?? []) if (x.covered) m.set(x.billLine.month, x.model);
    return m;
  };
  const calW = byMonthOf(calibrated), calNo = byMonthOf(withoutPv?.calibrated);
  const billNo = new Map<number, BillNoPv>();
  for (const x of withoutPv?.bills ?? []) if (x.usd !== null) billNo.set(x.withPv.month, x);
  type Series = { id: string; label: string; color: string; val: (m: number) => number | null; line: (m: number) => BillLine | null; note?: (m: number) => string };
  const all: Series[] = [
    { id: "std-no", label: "Total w/o PV", color: "#1f5fae", val: (m) => withoutPv?.standard?.run?.[m - 1]?.total ?? null, line: (m) => withoutPv?.standard?.run?.[m - 1] ?? null },
    { id: "std", label: "Total w/ PV", color: "#8fc0f5", val: (m) => P.run?.[m - 1]?.total ?? null, line: (m) => P.run?.[m - 1] ?? null },
    { id: "cal-no", label: "Calibrated w/o PV", color: "#5e33a8", val: (m) => calNo.get(m)?.total ?? null, line: (m) => calNo.get(m) ?? null },
    { id: "cal", label: "Calibrated w/ PV", color: "#c4a7ef", val: (m) => calW.get(m)?.total ?? null, line: (m) => calW.get(m) ?? null },
    { id: "bill-no", label: "Billed w/o PV (estimate)", color: "#b8401f", val: (m) => billNo.get(m)?.usd ?? null, line: (m) => billNo.get(m)?.withoutPv ?? null, note: (m) => billNo.get(m)?.why ?? "" },
    { id: "bill", label: "Billed w/ PV", color: "#f6a88b", val: (m) => billByMonth.get(m)?.bill.costUsd ?? null, line: (m) => billByMonth.get(m)?.line ?? null },
  ];
  // "Total", not "Standard" (user, 2026-10-23: "Instead of \"Standard\" for utility, let us use \"Total\"")
  // NO RENEWABLE SYSTEM (user, 2026-10-23): one bar per side, the house as it is — no w/o PV, no "w/ PV" in a label; the side keeps its
  // darker colour ("Use the darker colors for standard, and the lighter colors for renewable impacted values")
  const dark = (id: string): string => all.find((x) => x.id === `${id}-no`)?.color ?? "";
  const shown = pv ? all : all.filter((s) => !s.id.endsWith("-no")).map((s) => ({ ...s, label: s.label.replace(" w/ PV", ""), color: dark(s.id) || s.color }));
  // THE METERS IN THE VIEW (user, 2026-10-23: "the BOM view does not show the individual meters"): a bar per meter each month beside
  // the sides — each meter its own account on the card, in its own dark colour (a meter takes no PV)
  const METER_COLORS = ["#1f7a6e", "#a8741a", "#3f7d2a", "#8e2f6e", "#4a5670", "#9a3b3b"];
  const meterSeries: Series[] = meters.map((m, i) => ({ id: `meter-${i}`, label: `${m.name} (${m.zones.join(", ")})`, color: METER_COLORS[i % METER_COLORS.length]!,
    val: (mo) => m.priced.run?.find((l) => l.month === mo)?.total ?? null, line: (mo) => m.priced.run?.find((l) => l.month === mo) ?? null }));
  const series = [...shown, ...meterSeries].filter((s) => MONTHS.some((_, i) => s.val(i + 1) !== null));
  // ONE SLOT PER SIDE (user, 2026-10-10: "use darker color graph for w/o and lighter color overlay w/PV"): the w/o PV bar full width and
  // dark behind, the w/ PV bar lighter and a little narrower in front, so neither hides the other whichever is taller
  const SIDES = ["std", "cal", "bill"] as const;
  const groups: Array<{ k: string; no: Series | null; w: Series | null }> = [...SIDES.map((k) => ({ k: k as string, no: series.find((s) => s.id === `${k}-no`) ?? null, w: series.find((s) => s.id === k) ?? null })),
    ...series.filter((s) => s.id.startsWith("meter-")).map((s) => ({ k: s.id, no: null, w: s }))].filter((g) => g.no || g.w);
  const top = niceTop(Math.max(1, ...series.flatMap((s) => MONTHS.map((_, i) => s.val(i + 1) ?? 0))));
  const L = 56, R = 12, T = 10, B = 34, pw = Math.max(10, w - L - R), ph = Math.max(10, h - T - B);
  const y = (v: number): number => T + ph - (v / top) * ph;
  const slot = pw / 12, bw = Math.min(26, (slot * 0.84) / Math.max(1, groups.length));
  const ticks = Array.from({ length: 6 }, (_, i) => (top * i) / 5);
  return (
    <div className="runGraphs">
      <div className="runGraph" style={{ flex: "1 1 0" }}>
        <div className="runGraphHead">
          ENERGY &amp; COST · {P.card.name}{applied ? "" : " · NOT APPLIED — the run carries no tariff"}
          {hover && <span className="runKey">{hover}</span>}
        </div>
        <div className="runGraphBody" ref={ref}>
          <svg width={w} height={h}>
            {ticks.map((t) => (
              <g key={t}><line x1={L} x2={L + pw} y1={y(t)} y2={y(t)} className={t === 0 ? "axisLine" : "gridLine"} /><text x={L - 6} y={y(t) + 3} textAnchor="end" className="axisText">{`$${Math.round(t)}`}</text></g>
            ))}
            {MONTHS.map((mn, i) => {
              const cx = L + slot * i + slot / 2;
              return (
                <g key={mn}>
                  {groups.flatMap((g, j) => {
                    const bx = cx + (j - groups.length / 2) * bw;
                    return ([[g.no, 0], [g.w, g.no ? Math.max(1, bw * 0.18) : 0]] as const).map(([s, inset]) => {
                      if (!s) return null;
                      const v = s.val(i + 1); if (v === null) return null;
                      const line = s.line(i + 1);
                      const words = `${mn} · ${s.label}: ${usd(v)}${line ? ` · ${line.label} · in ${k0(line.kwhIn)} kWh${pv ? `, out ${k0(line.kwhOut)}` : ""} · billed ${k0(line.billedKwh)} kWh${line.creditOut > 0 ? ` · credit banked ${k0(line.creditOut)} kWh` : ""}` : ""}${s.note ? ` · ${s.note(i + 1)}` : ""}`;
                      return <rect key={s.id} x={bx + inset} y={y(Math.max(0, v))} width={Math.max(1, bw - 2 - 2 * inset)} height={Math.max(0.5, y(0) - y(Math.max(0, v)))} fill={s.color} onMouseEnter={() => setHover(words)} onMouseLeave={() => setHover(null)} />;
                    });
                  })}
                  <text x={cx} y={T + ph + 14} textAnchor="middle" className="axisText">{mn}</text>
                  {pv && P.run?.[i] && P.run[i]!.creditOut > 0 && <text x={cx} y={T + ph + 27} textAnchor="middle" className="axisText dim">bank {k0(P.run[i]!.creditOut)}</text>}
                </g>
              );
            })}
          </svg>
        </div>
        <div className="runLegend">{series.map((s) => <span key={s.id}><i style={{ background: s.color }} />{s.label}</span>)}{pv && <span className="dim">· w/o PV dark behind, w/ PV light in front</span>}</div>
      </div>
    </div>
  );
}

/** 5 · COST TABLES, the column (user, 2026-10-23): the Equivalent $/kWh at the top, the tables the view used to carry, and under them
 *  the Standard · Calibrated · Billed totals */
export function BomCostTables({ priced, calibrated = null, withoutPv, why, statements = [], pv = true, meters = [] }: BomCostProps): ReactNode {
  if (!priced) return <div className="idfInfo">{why ?? "pick the tariff in UTILITY below and Apply it"}</div>;
  const P = priced;
  const sumRun = (Q: Priced | null | undefined): number | null => (Q?.run ? Q.run.reduce((t, l) => t + l.total, 0) : null);
  const sumCal = (Q: Priced | null | undefined): { usd: number; n: number } => { const ok = Q?.paired.filter((x) => x.covered) ?? []; return { usd: ok.reduce((t, x) => t + x.model.total, 0), n: ok.length }; };
  const stdW = sumRun(P), stdNo = sumRun(withoutPv?.standard), cW = sumCal(calibrated), cNo = sumCal(withoutPv?.calibrated);
  const billedYear = P.bills.reduce((t, b) => t + (b.bill.costUsd ?? 0), 0);
  const noOk = (withoutPv?.bills ?? []).filter((x) => x.usd !== null);
  const noWhy = (withoutPv?.bills ?? []).find((x) => x.usd === null)?.why ?? "";
  const eq = equivalentPerKwh(P.bills.map((b) => b.bill)), eqNo = equivalentWithoutPv(withoutPv?.bills ?? []);
  const missing = [...(P.run ?? []), ...P.bills.map((b) => b.line)].some((l) => l.pcaMissing);
  const pair = (no: string | null, w: string | null): string => (pv ? `${no ?? "—"} w/o · ${w ?? "—"} w/ PV` : (w ?? "—"));
  if (!pv) return (
    <div className="bomCostCol">
      <div className="bomEquiv" title={eq ? `the ${eq.n} bills' total ${usd(eq.usd)} ÷ the ${k0(eq.kwh)} kWh the grid delivered over them` : "no bill states its total"}>
        <b>Equivalent $/kWh {eq ? `$${eq.perKwh.toFixed(3)}` : "—"}</b>
        {eq && <span className="dim">{usd(eq.usd)} billed ÷ {k0(eq.kwh)} kWh delivered · {eq.n} bills</span>}
      </div>
      {P.paired.length > 0 && <CompareTable P={P} />}
      {P.run && <CostTable pv={false} title={`THE RUN · by calendar month · ${P.runMeters.join(" + ")}${P.runPartial.length ? ` · left out, the run holds only part of: ${P.runPartial.join(", ")}` : ""}`} lines={P.run} engine={P.engine} engineAnnual={P.engineAnnual} />}
      {statements.length > 0 && <StatementsTable P={P} statements={statements} pv={false} />}
      {P.bills.length > 0 && <CostTable pv={false} title="THE BILLS · by their periods" lines={P.bills.map((b) => b.line)} billed={P.bills.map((b) => b.bill.costUsd ?? null)} />}
      {meters.length > 0 && <MeterCosts meters={meters} building={stdW} card={P.card.name} pv={pv} />}
      <div className="bomTotals">
          {stdW !== null && <span className="runKey"><i style={{ background: "#1f5fae" }} />Total {usd(stdW)} /yr</span>}
          {calibrated ? <span className="runKey"><i style={{ background: "#5e33a8" }} />Calibrated {usd(cW.usd)} over {cW.n} bill period{cW.n === 1 ? "" : "s"}</span>
            : <span className="runKey dim">Calibrated: run the calibration year in the column (4 · calibration)</span>}
          {P.bills.length > 0 && <span className="runKey"><i style={{ background: "#b8401f" }} />Billed {usd(billedYear)} over {P.bills.length} bills</span>}
          {missing && P.card.pca && <span className="runKey dim">the PCA is not typed — left out of every total (type it from a bill in the column)</span>}
      </div>
    </div>
  );
  return (
    <div className="bomCostCol">
      <div className="bomEquiv" title={eq ? `the ${eq.n} bills' total ${usd(eq.usd)} ÷ the ${k0(eq.kwh)} kWh the grid delivered over them (each bill's Consumption: its net and what it sent to the grid)` : "no bill states its total"}>
        <b>Equivalent $/kWh w/ PV {eq ? `$${eq.perKwh.toFixed(3)}` : "—"}</b>
        {eq && <span className="dim">w/ PV · {usd(eq.usd)} billed ÷ {k0(eq.kwh)} kWh delivered · {eq.n} bills</span>}
      </div>
      <div className="bomEquiv" title={eqNo ? `without the panels (an estimate): the ${eqNo.n} bills' totals moved by the card's price of what the panels made, ${usd(eqNo.usd)} ÷ the ${k0(eqNo.kwh)} kWh the grid would have delivered (each bill's net plus the panels' measured production)` : `without the panels: ${noWhy || "no bill can be estimated"}`}>
        <b>Equivalent $/kWh w/o PV {eqNo ? `$${eqNo.perKwh.toFixed(3)}` : "—"}</b>
        <span className="dim">{eqNo ? `estimate · ${usd(eqNo.usd)} ÷ ${k0(eqNo.kwh)} kWh the grid would have delivered · ${eqNo.n} bills` : noWhy}</span>
      </div>
      {P.paired.length > 0 && <CompareTable P={P} />}
      {P.run && <CostTable title={`THE RUN · by calendar month · ${P.runMeters.join(" + ")}${P.runPartial.length ? ` · left out, the run holds only part of: ${P.runPartial.join(", ")}` : ""}`} lines={P.run} engine={P.engine} engineAnnual={P.engineAnnual} />}
      {statements.length > 0 && <StatementsTable P={P} statements={statements} />}
      {P.bills.length > 0 && <CostTable title="THE BILLS · by their periods" lines={P.bills.map((b) => b.line)} billed={P.bills.map((b) => b.bill.costUsd ?? null)} />}
      {meters.length > 0 && <MeterCosts meters={meters} building={stdW} card={P.card.name} pv={pv} />}
      <div className="bomTotals">
          {stdW !== null && <span className="runKey"><i style={{ background: "#1f5fae", borderColor: "#8fc0f5" }} />Total {pair(stdNo === null ? null : usd(stdNo), usd(stdW))} /yr</span>}
          {calibrated ? <span className="runKey"><i style={{ background: "#5e33a8", borderColor: "#c4a7ef" }} />Calibrated {pair(usd(cNo.usd), usd(cW.usd))} over {cW.n} bill period{cW.n === 1 ? "" : "s"}</span>
            : <span className="runKey dim">Calibrated: run the calibration year in the column (4 · calibration)</span>}
          {P.bills.length > 0 && <span className="runKey"><i style={{ background: "#b8401f", borderColor: "#f6a88b" }} />Billed {usd(billedYear)} w/ PV over {P.bills.length} bills{noOk.length ? ` · w/o PV ${usd(noOk.reduce((t, x) => t + x.usd!, 0))} over ${noOk.length} (estimate)` : ""}</span>}
          {P.bills.length > 0 && noOk.length < P.bills.length && noWhy && <span className="runKey dim">Billed w/o PV: {noWhy}</span>}
          {missing && P.card.pca && <span className="runKey dim">the PCA is not typed — left out of every total (type it from a bill in the column)</span>}
      </div>
    </div>
  );
}

/** THE BILLS AS PRINTED (2026-10-09): each bill's Detail of Charges by group, its total, and the card's price for the same usage — the card
 *  holds no taxes, so its price is set against the bill's charges less its taxes */
/** THE METERS, EACH ITS OWN ACCOUNT (user, 2026-10-23): a meter's hourly use priced on the same card as a service of its own — its own
 *  access charge every month, its own demand; the building on ONE account (Standard) beside them, and the difference the second
 *  service's charges make. A meter takes no PV: its use is what its zones and their units draw */
export function MeterCosts({ meters, building, card, pv }: { meters: MeterPriced[]; building: number | null; card: string; pv: boolean }): ReactNode {
  const [open, setOpen] = useState<string | null>(null);
  const rows = meters.map((m) => ({ ...m, kwh: m.priced.run?.reduce((t, l) => t + l.kwhIn, 0) ?? null, usd: m.priced.run?.reduce((t, l) => t + l.total, 0) ?? null }));
  const kwh = rows.reduce((t, r) => t + (r.kwh ?? 0), 0), cost = rows.reduce((t, r) => t + (r.usd ?? 0), 0);
  return (
    <div className="bomTableWrap">
      <div className="runGraphHead" title={`each meter's hourly use (its Meter:Custom) priced on ${card} as an account of its own: the access charge each month, the demand on its own peak${pv ? "; a meter takes no PV — the panels' credit stays with the building's service" : ""}`}>THE METERS · each its own account on {card}</div>
      <table className="bomCostTable">
        <thead><tr><th>meter</th><th>zones</th><th className="num">kWh /yr</th><th className="num">$ /yr</th><th className="num">$/kWh</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="clickRow" onClick={() => setOpen(open === r.name ? null : r.name)} title={`${open === r.name ? "hide" : "show"} ${r.name}'s months`}>
              <td>{open === r.name ? "▾" : "▸"} {r.name}</td><td>{r.zones.join(", ")}</td>
              <td className="num">{r.kwh === null ? "—" : k0(r.kwh)}</td><td className="num"><b>{r.usd === null ? "not in this run" : usd(r.usd)}</b></td>
              <td className="num">{r.kwh && r.usd !== null ? `$${(r.usd / r.kwh).toFixed(3)}` : "—"}</td>
            </tr>
          ))}
          <tr className="sum"><td>the {rows.length} meters</td><td></td><td className="num">{k0(kwh)}</td><td className="num"><b>{usd(cost)}</b></td><td className="num">{kwh ? `$${(cost / kwh).toFixed(3)}` : "—"}</td></tr>
          {building !== null && <tr className="dim" title="the run priced as the building on one service (Total): the difference is the second account's monthly charges and the demand of each meter on its own peak"><td>Total, one account</td><td></td><td></td><td className="num">{usd(building)}</td><td className="num">{cost - building >= 0 ? "+" : ""}{usd(cost - building)} as meters</td></tr>}
        </tbody>
      </table>
      {rows.filter((r) => r.name === open && r.priced.run).map((r) => <CostTable key={r.name} pv={false} title={`${r.name} · by calendar month · ${r.zones.join(", ")}`} lines={r.priced.run!} />)}
    </div>
  );
}

export function StatementsTable({ P, statements, pv = true }: { P: Priced; statements: Statement[]; pv?: boolean }): ReactNode {
  const rows = [...statements].filter((s) => s.from && s.to).sort((a, b) => a.from.localeCompare(b.from));
  const groups = rows[0] ? rows[0].groups : [];
  const priced = (s: Statement): number | null => P.bills.find((b) => b.bill.periodStart === s.from && b.bill.account === s.meter)?.line.total ?? null;
  const taxes = (s: Statement): number => groupSubtotals(s).filter((g) => /tax/i.test(g.label)).reduce((t, g) => t + g.total, 0);
  return (
    <div className="bomTableWrap">
      <div className="runGraphHead">THE BILLS AS PRINTED · the Detail of Charges by group · {P.card.name} priced on the same usage (no taxes on the card)</div>
      <table className="bomCostTable">
        <thead><tr><th>bill</th><th>period</th><th className="num">consumption</th>{pv && <th className="num">generation</th>}<th className="num">net kWh</th><th className="num">kW</th>
          {groups.map((g) => <th key={g.id} className="num">{g.label}</th>)}<th className="num">total</th><th className="num">less taxes</th><th className="num">card priced</th><th className="num">Δ</th></tr></thead>
        <tbody>
          {rows.map((s) => {
            const sub = groupSubtotals(s), t = statementTotal(s), p = priced(s), lt = t.total - taxes(s);
            return (
              <tr key={s.id} title={t.open ? `${t.open} line(s) not figured yet` : ""} className={t.open ? "dim" : ""}>
                <td>{statementMonth(s)}</td><td>{s.from} – {s.to}</td><td className="num">{k0(s.usage.consumption.kwh ?? 0)}</td>{pv && <td className="num">{k0(s.usage.generation.kwh ?? 0)}</td>}
                <td className="num">{k0(s.usage.net.kwh ?? 0)}</td><td className="num">{s.usage.net.kw ?? "—"}</td>
                {groups.map((g) => <td key={g.id} className="num">{usd(sub.find((x) => x.id === g.id)?.total ?? 0)}</td>)}
                <td className="num"><b>{usd(t.total)}</b></td><td className="num">{usd(lt)}</td><td className="num">{p === null ? "—" : usd(p)}</td>
                <td className="num">{p === null ? "" : `${p - lt >= 0 ? "+" : ""}${(p - lt).toFixed(2)}`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** the words for the comparison's weather basis */
export function pairWords(P: Priced): string {
  return P.pairBasis === "dates"
    ? "the run's own dates — an actual-year weather file: the weather the bills were metered under where the file covers their days"
    : "the bills' calendar days in a TYPICAL year — not the weather the bills were metered under; make the actual weather for the bills' period in WEATHER below";
}

/** THE COMPARISON (2026-10-07): each bill against the model over the same days, both priced by the card; totals over the periods the run
 *  covers whole, never the run's year against however many bills there are */
export function CompareTable({ P }: { P: Priced }): ReactNode {
  const ok = P.paired.filter((x) => x.covered), out = P.paired.filter((x) => !x.covered);
  const net = (l: BillLine): number => l.kwhIn - l.kwhOut;
  const pct = (m: number, b: number): string => (b !== 0 ? `${(((m - b) / Math.abs(b)) * 100).toFixed(1)} %` : "—");
  const sum = (f: (x: Priced["paired"][number]) => number): number => ok.reduce((t, x) => t + f(x), 0);
  const billed = ok.every((x) => x.bill.costUsd !== null);
  return (
    <div className="bomTableWrap">
      <div className="runGraphHead">THE BILLS AGAINST THE MODEL · each over the bill's own days, both priced by {P.card.name} · {ok.length} period{ok.length === 1 ? "" : "s"} compared{out.length ? ` · ${out.length} outside the run: ${out.map((x) => `${x.bill.periodStart} – ${x.bill.periodEnd} (${Math.round(x.hours / 24)} of ${Math.round(x.needed / 24)} days)`).join(", ")}` : ""}</div>
      <div className="runGraphHead dim">weather: {pairWords(P)}</div>
      <table className="bomCostTable">
        <thead><tr><th>bill period</th><th className="num">days</th><th className="num">bill kWh (net)</th><th className="num">model kWh (net)</th><th className="num">Δ kWh</th>
          <th className="num">bill kW</th><th className="num">model kW</th><th className="num">bill priced</th><th className="num">model priced</th><th className="num">Δ $</th><th className="num">as billed</th></tr></thead>
        <tbody>
          {P.paired.map((x, i) => (
            <tr key={`${x.bill.periodStart}-${i}`} className={x.covered ? "" : "dim"} title={x.covered ? "" : "the run does not hold every day of this period — left out of the totals"}>
              <td>{x.bill.periodStart} – {x.bill.periodEnd}</td><td className="num">{x.bill.days || Math.round(x.needed / 24)}</td>
              <td className="num">{k0(net(x.billLine))}</td><td className="num">{k0(net(x.model))}</td><td className="num">{pct(net(x.model), net(x.billLine))}</td>
              <td className="num">{x.billLine.peakKw === null ? "—" : x.billLine.peakKw.toFixed(2)}</td><td className="num">{x.model.peakKw === null ? "—" : x.model.peakKw.toFixed(2)}</td>
              <td className="num">{usd(x.billLine.total)}</td><td className="num">{usd(x.model.total)}</td><td className="num">{pct(x.model.total, x.billLine.total)}</td>
              <td className="num">{x.bill.costUsd === null ? "—" : usd(x.bill.costUsd)}</td>
            </tr>
          ))}
          <tr className="sum"><td>the {ok.length} periods compared</td><td className="num">{k0(sum((x) => x.bill.days || x.needed / 24))}</td>
            <td className="num">{k0(sum((x) => net(x.billLine)))}</td><td className="num">{k0(sum((x) => net(x.model)))}</td><td className="num">{pct(sum((x) => net(x.model)), sum((x) => net(x.billLine)))}</td><td></td><td></td>
            <td className="num">{usd(sum((x) => x.billLine.total))}</td><td className="num">{usd(sum((x) => x.model.total))}</td><td className="num">{pct(sum((x) => x.model.total), sum((x) => x.billLine.total))}</td>
            <td className="num">{billed ? usd(sum((x) => x.bill.costUsd ?? 0)) : "—"}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

export function CostTable({ title, lines, engine, engineAnnual, billed, pv = true }: { title: string; lines: BillLine[]; engine?: number[] | null; engineAnnual?: number | null; billed?: Array<number | null>;
  /** a renewable system: the kWh sent out and the credit bank are shown (2026-10-23) */ pv?: boolean }): ReactNode {
  const sum = (f: (l: BillLine) => number | null): number => lines.reduce((t, l) => t + (f(l) ?? 0), 0);
  return (
    <div className="bomTableWrap">
      <div className="runGraphHead">{title}</div>
      <table className="bomCostTable">
        <thead><tr><th>month</th><th className="num">kWh in</th>{pv && <><th className="num">kWh out</th><th className="num">credit kWh</th></>}<th className="num">billed kWh</th><th className="num">peak kW</th>
          <th className="num">access</th><th className="num">delivery</th><th className="num">demand</th><th className="num">supply</th><th className="num">PCA</th><th className="num">total</th>
          {engine && <th className="num">Simulated</th>}{billed && <th className="num">as billed</th>}</tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={`${l.key}-${i}`} title={l.notes.join(" · ")} className={l.surplus ? "surplus" : ""}>
              <td>{l.label}</td><td className="num">{k0(l.kwhIn)}</td>{pv && <><td className="num">{k0(l.kwhOut)}</td><td className="num">{l.creditOut > 0 || l.creditApplied > 0 ? `${k0(l.creditApplied)} used · ${k0(l.creditOut)} banked` : "—"}</td></>}
              <td className="num">{k0(l.billedKwh)}</td><td className="num">{l.peakKw === null ? "—" : l.peakKw.toFixed(2)}</td>
              <td className="num">{usd(l.access)}</td><td className="num">{usd(l.delivery)}</td><td className="num">{l.demand === null ? "not stated" : usd(l.demand)}</td><td className="num">{usd(l.supply)}</td>
              <td className="num">{l.pca === null ? "not typed" : usd(l.pca)}</td><td className="num"><b>{usd(l.total)}</b></td>
              {engine && <td className="num">{engine[l.month - 1] !== undefined ? usd(engine[l.month - 1]!) : "—"}</td>}{billed && <td className="num">{billed[i] !== null && billed[i] !== undefined ? usd(billed[i]!) : "—"}</td>}
            </tr>
          ))}
          <tr className="sum"><td>the year</td><td className="num">{k0(sum((l) => l.kwhIn))}</td>{pv && <><td className="num">{k0(sum((l) => l.kwhOut))}</td><td></td></>}<td className="num">{k0(sum((l) => l.billedKwh))}</td><td></td>
            <td className="num">{usd(sum((l) => l.access))}</td><td className="num">{usd(sum((l) => l.delivery))}</td><td className="num">{usd(sum((l) => l.demand))}</td><td className="num">{usd(sum((l) => l.supply))}</td>
            <td className="num">{usd(sum((l) => l.pca))}</td><td className="num"><b>{usd(sum((l) => l.total))}</b></td>
            {/* the engine's own year, not its cent-rounded months summed (2026-10-21: three prices for one year) */}
            {engine && <td className="num">{usd(engineAnnual ?? engine.reduce((t, v) => t + v, 0))}</td>}{billed && <td className="num">{usd(billed.reduce<number>((t, v) => t + (v ?? 0), 0))}</td>}</tr>
        </tbody>
      </table>
    </div>
  );
}

/** THE FRAME below the view: three rails, a card each */
export function BomFrame({ rail, onRail, sel, onSel, cards, weather, imports }: {
  rail: BomRail; onRail: (r: BomRail) => void; sel: BomCardSel | null; onSel: (s: BomCardSel | null) => void;
  cards: Array<{ card: TariffCard; applied: boolean }>; weather: { name: string; line: string } | null; imports: Array<{ sha256: string; name: string; rows: number }>;
}): ReactNode {
  const on = (r: BomRail, id: string): boolean => sel?.rail === r && sel.id === id;
  return (
    <div className="asmBench zoneFrame bomFrame">
      <div className="asmRail">
        {BOM_RAILS.map((r) => <button key={r} className={`asmRailBtn${rail === r ? " on" : ""}`} style={{ borderLeftColor: RAIL_COLOR[r] }} onClick={() => onRail(r)}>{r}</button>)}
      </div>
      <div className="bomCards">
        {rail === "UTILITY" && cards.map(({ card, applied }) => (
          <button key={card.id} className={`bomCard${on("UTILITY", card.id) ? " sel" : ""}${card.status !== "in force" ? " pending" : ""}`} onClick={() => onSel(on("UTILITY", card.id) ? null : { rail: "UTILITY", id: card.id })}>
            <b>{card.name}</b><span>{card.status === "in force" ? `in force · ${card.effective}` : `${card.status} · ${card.effective}`}</span><span className={applied ? "src-user" : "muted"}>{applied ? (card.sample ? "✓ in use — the sample, until you apply a card of your own" : "✓ applied — in the run's IDF") : card.status === "in force" ? "not applied" : "cannot be applied: no published rates"}</span>
          </button>
        ))}
        {rail === "WEATHER" && (
          <>
            <button className={`bomCard${on("WEATHER", "current") ? " sel" : ""}`} onClick={() => onSel(on("WEATHER", "current") ? null : { rail: "WEATHER", id: "current" })}>
              <b>{weather?.name ?? "no weather file"}</b><span>{weather?.line ?? "pick one on BEM › SITE"}</span>
            </button>
            <button className={`bomCard pending${on("WEATHER", "amy") ? " sel" : ""}`} onClick={() => onSel(on("WEATHER", "amy") ? null : { rail: "WEATHER", id: "amy" })}>
              <b>the actual weather</b><span>NOAA station hours + Open-Meteo sun and sky</span><span className="muted">for the bills' period — made here, picked on SITE</span>
            </button>
          </>
        )}
        {rail === "BILLS" && (imports.length ? imports.map((i) => (
          <button key={i.sha256} className={`bomCard${on("BILLS", i.sha256) ? " sel" : ""}`} onClick={() => onSel(on("BILLS", i.sha256) ? null : { rail: "BILLS", id: i.sha256 })}>
            <b>{i.name}</b><span>{i.rows} rows</span>
          </button>
        )) : <div className="muted bomEmpty" title="Import bills CSV… in the column">no bills imported</div>)}
      </div>
    </div>
  );
}

/** THE COLUMN's card: a tariff's every charge with its citation, the PCA typed from a bill, the net metering period's month, Apply */
export function TariffDetails({ card, ledger, onApply, onRemove, busy, billedPca = {} }: { card: TariffCard; ledger: BomLedger["tariff"] | undefined; busy: boolean;
  /** the PCA each bill prints, by the month it prices (2026-10-09) — read only here, typed on the bill */
  billedPca?: Record<string, number>;
  onApply: (t: { pca?: PcaRuling; nemStartMonth: number }) => void; onRemove: () => void }): ReactNode {
  const applied = ledger?.card === card.id;
  const [pcaAll, setPcaAll] = useState<string>(applied && ledger?.pca?.all !== undefined ? String(+(ledger.pca.all * 100).toFixed(5)) : "");
  const [byMonth, setByMonth] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(applied ? ledger?.pca?.byMonth ?? {} : {}).map(([k, v]) => [k, String(+(v * 100).toFixed(5))])));
  const [start, setStart] = useState<number>(applied ? ledger?.nemStartMonth ?? 1 : 1);
  const C = card.charges;
  const cents = (s: string): number | undefined => { const v = Number(s); return s.trim() !== "" && Number.isFinite(v) ? v / 100 : undefined; };
  const ruling = (): { pca?: PcaRuling; nemStartMonth: number } => {
    const all = cents(pcaAll), bm = Object.fromEntries(Object.entries(byMonth).map(([k, v]) => [k, cents(v)]).filter(([, v]) => v !== undefined)) as Record<string, number>;
    const pca: PcaRuling = {}; if (all !== undefined) pca.all = all; if (Object.keys(bm).length) pca.byMonth = bm;
    return { ...(Object.keys(pca).length ? { pca } : {}), nemStartMonth: start };
  };
  return (
    <div className="sysSettings bomDetails">
      <div className="barHead">{card.name}</div>
      <div className="kv"><span>status</span><b className={card.status === "in force" ? "src-file" : "src-warn"}>{card.status} · {card.effective}</b></div>
      {card.note && <div className="idfInfo">{card.note}</div>}
      {!C && <div className="src-warn">no rates on this card — it cannot be applied until the schedule is published</div>}
      {C && (
        <>
          <table className="pvFields bomCharges"><tbody>
            {([["access", C.accessUsdMonth], ["energy delivery", C.deliveryUsdKwh], ["demand delivery", C.demandUsdKw], ["supply Jun–Sep", C.supplySummerUsdKwh], ["supply Oct–May", C.supplyWinterUsdKwh]] as const).map(([k, c]) => (
              <tr key={k} title={`${c.cite} — ${c.url}`}><td>{k}</td><td className="num src-file">{c.unit.startsWith("$/kWh") ? `${(c.value * 100).toFixed(3)} ¢/kWh` : `$${c.value.toFixed(2)} ${c.unit.replace("$", "")}`}</td><td className="muted">{c.cite}</td></tr>
            ))}
          </tbody></table>
          {card.demandWindow && <div className="idfInfo">billing demand: {card.demandWindow.cite}</div>}
          {card.minimum && <div className="idfInfo">minimum: {card.minimum.cite}</div>}
          {/* a card with no power cost adjustment (the Sample) has nothing to type here */}
          {card.pca && <>
          <div className="stepHead">power cost adjustment — typed from a bill</div>
          <div className="idfInfo">{card.pca?.cite}</div>
          <table className="pvFields"><tbody>
            <tr><td title="one PCA for every month, ¢/kWh (a credit is negative)">every month ¢/kWh</td><td><input type="text" className="numIn" value={pcaAll} placeholder="from a bill" onChange={(e) => setPcaAll(e.target.value)} /></td></tr>
          </tbody></table>
          {Object.keys(billedPca).length > 0 && (
            <div className="idfInfo">from your bills (typed on each bill, these months price with it): {Object.entries(billedPca).sort().map(([m, v]) => `${m} ${(v * 100).toFixed(3)} ¢`).join(" · ")}</div>
          )}
          <details className="bomPcaMonths"><summary>by month (overrides the one value)</summary>
            <table className="pvFields"><tbody>
              {MONTHS.map((m, i) => <tr key={m}><td>{m} ¢/kWh</td><td><input type="text" className="numIn" value={byMonth[String(i + 1)] ?? ""} placeholder="—" onChange={(e) => setByMonth((b) => ({ ...b, [String(i + 1)]: e.target.value }))} /></td></tr>)}
            </tbody></table>
          </details>
          </>}
          {card.netMetering && (
            <>
              <div className="stepHead">net metering · {card.netMetering.schedule}</div>
              {card.netMetering.rules.map((r, i) => <div key={i} className="idfInfo">· {r}</div>)}
              <table className="pvFields"><tbody>
                <tr><td title="the 12-month net metering period opens with the first meter reading after the PV's interconnection">period opens in</td><td>
                  <select value={start} onChange={(e) => setStart(Number(e.target.value))}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
                </td></tr>
              </tbody></table>
            </>
          )}
          <div className="sysApplyRow">
            <button className="apply" disabled={busy || card.status !== "in force"} onClick={() => onApply(ruling())} title="the card goes to the BOM ledger and into the run's IDF as the engine's UtilityCost objects; Run again to price the year">{applied ? "Apply changes" : "Apply this tariff"}</button>
            {applied && <button className="qaBtn" disabled={busy} onClick={onRemove}>remove</button>}
          </div>
        </>
      )}
    </div>
  );
}

/** THE WEATHER CARD'S COLUMN (2026-10-07): the actual weather for the bills' period — or any period the archive reaches — made in the app
 *  from NOAA's station hours and Open-Meteo's sun and sky, saved into Weather/; picked on BEM › SITE like any file, never applied here */
export function WeatherMaker({ bills, site, template, station }: { bills: BillRow[]; site: { latitude: number; longitude: number } | null; template?: string; station?: AmyStation }): ReactNode {
  const span = bills.length ? { a: bills.reduce((m, b) => (b.periodStart < m ? b.periodStart : m), bills[0]!.periodStart), b: bills.reduce((m, b) => (b.periodEnd > m ? b.periodEnd : m), bills[0]!.periodEnd) } : null;
  // without bills: the last twelve whole months the archive reaches
  const last = latestEnd(), lastMonthEnd = new Date(Date.UTC(Number(last.slice(0, 4)), Number(last.slice(5, 7)) - 1, 0)).toISOString().slice(0, 10);
  const yearBefore = `${Number(lastMonthEnd.slice(0, 4)) - 1}-${String(Number(lastMonthEnd.slice(5, 7)) % 12 + 1).padStart(2, "0")}-01`.replace(/^(\d{4})-01-01$/, (_, y) => `${Number(y) + 1}-01-01`);
  const [start, setStart] = useState(span?.a ?? yearBefore);
  const [end, setEnd] = useState(span ? (span.b > last ? last : span.b) : lastMonthEnd);
  const [busy, setBusy] = useState(false);
  const [say, setSay] = useState("");
  const [done, setDone] = useState<{ name: string; counts: AmyCounts; ddy: boolean; station?: { id: string; name: string; km: number } } | { error: string } | null>(null);
  const go = async (): Promise<void> => {
    if (!site) return;
    setBusy(true); setDone(null);
    const r = await makeActualWeather({ start, end, lat: Number(site.latitude.toFixed(4)), lon: Number(site.longitude.toFixed(4)), template, station, onProgress: setSay });
    setDone(r); setBusy(false); setSay("");
  };
  return (
    <>
      <div className="idfInfo">The weather the bills were metered under: NOAA NCEI's hourly readings at {station?.mode === "pinned" ? `station ${station.name ?? station.id} (${station.id}), pinned by the project's data sources` : "the reporting station nearest the site"} (GHCNh, CC0, no key) and the Open-Meteo archive's sun, sky and rain at the site's own position (no key; Weather data by Open-Meteo.com, CC BY 4.0 — its free API is for non-commercial use only) — gaps of 6 h or less drawn by a line, longer ones from the archive, every filled hour counted in the file. The archive reaches {last}.</div>
      {span && <div className="idfInfo">your bills run {span.a} – {span.b}{span.b > last ? ` — the archive does not reach ${span.b} yet` : ""}</div>}
      <table className="pvFields"><tbody>
        <tr><td>from</td><td><input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} /></td></tr>
        <tr><td>to</td><td><input type="date" value={end} min={start} max={last} onChange={(e) => setEnd(e.target.value)} /></td></tr>
      </tbody></table>
      <div className="sysApplyRow">
        <button className="apply" disabled={busy || !site || !start || !end || end < start} onClick={() => void go()} title="fetched once into data/cache/weather, converted, saved into Weather/ — nothing in the model changes until you pick it on BEM › SITE">{busy ? say || "making …" : "Make the weather file"}</button>
      </div>
      {!site && <div className="src-warn">the file states no position — locate the site on BEM › SITE first</div>}
      {done && "error" in done && <div className="src-warn">{done.error}</div>}
      {done && !("error" in done) && (
        <>
          <div className="idfInfo src-user">saved: {done.name}{done.station ? ` · NOAA station ${done.station.name} (${done.station.id}), ${Number.isFinite(done.station.km) ? `${done.station.km.toFixed(0)} km from the site` : "pinned by the project's data sources"}` : ""}{done.ddy ? " (the design days copied beside it)" : ""} — pick it on BEM › SITE › weather file, Apply, and Run; the comparison then reads the run's own dates</div>
          {Object.entries(done.counts.fields).map(([k, c]) => <div key={k} className="idfInfo">{k}: {c.station} h the station · {c.line} h a line · {c.grid} h the archive · {c.missing} h missing</div>)}
        </>
      )}
    </>
  );
}
