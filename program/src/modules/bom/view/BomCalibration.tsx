// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE CALIBRATION RUN (user, 2026-10-09: "how can we create a calibration run when we don't have all inputs (weather and solar)?" and "an
// energyplus run for BOM customized for calibrated, and leave regular weather model energyplus run on BEM"). BOM's own run: the model as
// BEM holds it, on the ACTUAL YEAR the bills were metered under — the station's measured temperature, humidity and wind, the sun and sky
// estimated by the Open-Meteo archive — and the one estimated input CHECKED against the panels' own measured production (the Enphase
// daily export). The bills by their own dates; Consumption, Generation and Net each against the run's own meter; the verdict on
// Consumption and Net, the sun's check beside it. BEM's design run on the typical year is never touched.

import { useMemo, type ReactNode } from "react";
import type { BillRow } from "../core/csvRead.js";
import type { PvRead } from "../core/pvRead.js";
import { calibrationDays, calibrationPeriods, pairStats, verdictFor, sunEstimated, METERS, type HourSeries, type G14, type PairPeriod } from "../core/calibration.js";

export interface CalibrationRunView { stamp: string; epw: string | null; fatal: number; severe: number; warning: number; seconds: number; completed: boolean; hourly: HourSeries[]; epwKind: "TMY" | "AMY" | "unknown"; epwComment: string;
  /** the ground method the run took, in words (2026-11-21: Kiva cannot read an actual year that is not a calendar year) — null for a run made before */
  ground?: string | null }

const k0 = (v: number): string => Math.round(v).toLocaleString();
const pct = (billed: number | null, model: number): string => (billed === null || billed === 0 ? "" : `${(((model - billed) / Math.abs(billed)) * 100).toFixed(1)} %`);
const g14Line = (label: string, g: G14 | null, measured: string): ReactNode => (
  <div className="kv"><span>{label}</span><b>{g && Number.isFinite(g.cvrmsePct) ? `CVRMSE ${g.cvrmsePct.toFixed(1)} % · NMBE ${g.nmbePct.toFixed(1)} % · ${g.n} periods` : `— ${measured}`}</b></div>
);

export function BomCalibration(p: {
  bills: BillRow[];
  span: { a: string; b: string } | null;
  /** the archive's last day: a run cannot reach past it */
  archiveEnd: string;
  pvOn: string; onPvOn: (iso: string) => void;
  pv: { name: string; read: PvRead } | null; onImportPv: () => void;
  /** the building has a PV or other renewable system (user, 2026-10-23): without one, no PV input or value is shown */
  hasPv?: boolean;
  run: CalibrationRunView | null; busy: string; onRun: () => void;
  /** run on the user's own actual-year EPW — for paid work, where the Open-Meteo archive's free API may not be used */
  onRunOwn: () => void;
}): ReactNode {
  const days = useMemo(() => (p.run ? calibrationDays(p.run.hourly, p.pvOn || null) : null), [p.run, p.pvOn]);
  const pvMap = useMemo(() => (p.pv ? new Map(p.pv.read.days.map((d) => [d.date, d.kwh] as const)) : undefined), [p.pv]);
  const periods: PairPeriod[] = useMemo(() => (days ? calibrationPeriods(p.bills, days, pvMap, p.pvOn || null) : []), [days, p.bills, pvMap, p.pvOn]);
  const st = useMemo(() => pairStats(periods), [periods]);
  const verdict = p.run && st.net ? verdictFor(st.net, {
    basis: "bill periods", epwKind: p.run.epwKind, metersInRun: p.run.hourly.some((h) => h.name.toUpperCase() === METERS.facility.toUpperCase()),
    uncovered: periods.filter((x) => !x.covered).length, estimatedSun: sunEstimated(p.run.epwComment), also: st.consumption ? [st.consumption] : [], pvCheck: st.pv,
  }) : null;
  const end = p.span ? (p.span.b > p.archiveEnd ? p.archiveEnd : p.span.b) : "";
  const pvSpan = p.pv?.read.days.length ? `${p.pv.read.days[0]!.date} – ${p.pv.read.days[p.pv.read.days.length - 1]!.date}` : "";
  return (
    <div className="calRun" title="BOM's own run: the model as BEM holds it, on the actual year the bills were metered under — the station's measured temperature, humidity and wind, the sun and sky estimated by the Open-Meteo archive and checked against your panels' measured production. BEM's run on the typical year is not touched.">
      <div className="kv"><span>bills</span><b>{p.span ? `${p.bills.length} · ${p.span.a} – ${p.span.b}` : "none with dates — type the bills above"}</b></div>
      {p.span && p.span.b > p.archiveEnd && <div className="src-warn">the weather archive reaches {p.archiveEnd}: the run ends there and a later bill is left uncovered</div>}
      {p.hasPv !== false && <>
      <label className="lensRow" title="the day the PV was connected (the first meter reading with generation): before it a day is the house without PV — its own use bought, nothing sold or made">
        PV connected <input type="date" value={p.pvOn} onChange={(e) => p.onPvOn(e.target.value)} />
      </label>
      <div className="allRow">
        <button className="qaBtn" onClick={p.onImportPv} disabled={!!p.busy} title="the Enphase (Enlighten) daily production report as a CSV — a date column and an energy produced column whose unit (Wh, kWh) its header states">Import PV production CSV…</button>
        {p.pv && <span className="idfInfo">{p.pv.name} · {p.pv.read.days.length} days {pvSpan} · {p.pv.read.energyColumn}{p.pv.read.problems.length ? ` · ${p.pv.read.problems.length} rows not read` : ""}</span>}
      </div>
      {p.pv?.read.problems.length ? <div className="idfInfo" title={p.pv.read.problems.join("\n")}>not read: {p.pv.read.problems.slice(0, 2).join("; ")}{p.pv.read.problems.length > 2 ? " …" : ""}</div> : null}
      </>}
      <div className="allRow">
        <button className="apply" disabled={!p.span || !!p.busy} onClick={p.onRun} title={`makes (or reuses) the actual-year weather for ${p.span ? `${p.span.a} – ${end}` : "the bills' dates"} and runs the model on it — about a minute`}>{p.busy ? "…" : "Run the calibration year"}</button>
        <button className="qaBtn" disabled={!p.span || !!p.busy} onClick={p.onRunOwn} title="run the model on an actual-year weather file you obtained yourself (a .epw covering the bills' dates) — for paid work, where Open-Meteo's free archive may not be used">Run on my own weather file…</button>
        {p.busy && <span className="idfInfo">{p.busy}</span>}
      </div>
      <div className="idfInfo caveat">The made file's sun and sky come from the Open-Meteo archive (Weather data by <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo.com</a>, CC BY 4.0): its free API is for <b>non-commercial use only</b>. For paid work use a source whose terms allow it — NOAA's station hours are free for any use — and run on your own file.</div>
      {p.run && (
        <>
          <div className="idfInfo">run {p.run.stamp} · {(p.run.epw ?? "").split(/[\\/]/).pop()?.replace(/\.epw$/i, "")} · {p.run.completed ? "completed" : "DID NOT COMPLETE"} · Fatal {p.run.fatal} · Severe {p.run.severe} · Warning {p.run.warning} · {p.run.seconds.toFixed(0)} s</div>
          {p.run.ground && <div className="idfInfo" title="the ground coupling this run wrote. EnergyPlus's Kiva foundations read a weather file by calendar day from its first row, so an actual year that is not 1 January to 31 December runs on the F/C-factor method with the F and C typed on BEM › CONSTRUCTIONS › Floors">ground: {p.run.ground}</div>}
          {verdict && (
            <>
              <div className="kv"><span>verdict</span><b className={verdict.verdict === "calibrated" ? "ok" : verdict.verdict === "not calibrated" ? "bad" : ""}>{verdict.verdict === "comparison" ? "comparison, not calibration" : verdict.verdict}</b></div>
              {verdict.notes.map((n, i) => <div key={i} className="idfInfo">{n}</div>)}
              {verdict.caveats.map((c, i) => <div key={i} className="idfInfo caveat">{verdict.verdict === "withheld" ? "withheld: " : ""}{c}</div>)}
            </>
          )}
          <div className="idfInfo">Guideline 14, bill periods: CVRMSE ≤ {verdict?.limitCvrmse ?? 15} %, |NMBE| ≤ {verdict?.limitNmbe ?? 5} % — the verdict on Consumption and Net</div>
          {g14Line("Consumption", st.consumption, "the bills state no generation")}
          {p.hasPv !== false && g14Line("Generation", st.generation, "the bills state no generation")}
          {g14Line("Net", st.net, "")}
          {p.hasPv !== false && g14Line("PV measured", st.pv, p.pv ? "no bill period wholly in the export after the connection" : "import the PV production CSV")}
          <table className="calTable">
            <thead><tr><th>period</th><th className="num" title="delivered by the grid: the bill's Consumption against the run's ElectricityPurchased">cons. bill</th><th className="num">model</th><th className="num">Δ</th>
              {p.hasPv !== false && <><th className="num" title="sent to the grid: the bill's Generation against ElectricitySurplusSold">gen. bill</th><th className="num">model</th></>}
              <th className="num" title="the bill's Net against ElectricityNet">net bill</th><th className="num">model</th><th className="num">Δ</th>
              {p.hasPv !== false && <><th className="num" title="your panels' measured production against the run's ElectricityProduced, over the days the export holds">PV meas.</th><th className="num">model</th></>}</tr></thead>
            <tbody>
              {periods.map((x) => (
                <tr key={`${x.bill.periodStart}|${x.bill.line}`} className={x.covered ? "" : "muted"} title={x.covered ? "" : `the run covers ${x.daysCovered} of the period's ${x.days} days`}>
                  <td>{x.bill.periodStart.slice(5)} – {x.bill.periodEnd.slice(5)}</td>
                  <td className="num">{x.consumption.billed === null ? "—" : k0(x.consumption.billed)}</td><td className="num">{k0(x.consumption.model)}</td><td className="num">{pct(x.consumption.billed, x.consumption.model)}</td>
                  {p.hasPv !== false && <><td className="num">{x.generation.billed === null ? "—" : k0(x.generation.billed)}</td><td className="num">{k0(x.generation.model)}</td></>}
                  <td className="num">{k0(x.net.billed)}</td><td className="num">{k0(x.net.model)}</td><td className="num">{pct(x.net.billed, x.net.model)}</td>
                  {p.hasPv !== false && <><td className="num">{x.pv ? k0(x.pv.measured) : ""}</td><td className="num">{x.pv ? k0(x.pv.model) : ""}</td></>}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
