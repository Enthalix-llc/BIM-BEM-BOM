// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// RUN — the model as written (read back from bem.db), validation without a
// run, the engine, the results and the lens. A result belongs to the model
// it was run on: when the model's sha has moved since the last run the
// results say so rather than pretending. HONESTY (2026-09-15, the tab
// review, the user's R1 / R2 / S10): the results read EVERY fuel, never the
// District columns alone; what the tabs hold staged and this model lacks is
// counted here; the sizing reports the run writes are read back per unit;
// every section is a roll-up whose number stays on the screen when folded.

import { perRun } from "../core/runCalendar.js";
import { CHECK_RULES, type ZoneSide } from "../core/modelChecks.js";
import type { BemOutcome, BemModelOutcome } from "../pipeline.js";
import type { Lens, Legend } from "../core/bemPaint.js";
import { KV, Fold, fmtPower, fmtEnergyArea, fmtFlowAir, fmtFlowWater, baseName, engineName } from "./bemUi.js";
import { decodeTime } from "../core/eplusSql.js";
import { endUseTable, fuelShort, fuelLabel, coilRows, unitRows, designStamp, designDayShort, structurePeaks, type StructurePeakSide } from "./runResults.js";
import { hourDate } from "../core/runCalendar.js";
import { EnvelopeLosses } from "./EnvelopeLosses.js";

export interface BemRunProps {
  /** BOM › UTILITY, where a tariff is applied (the user, 2026-09-24 and 2026-10-02: a notice at the Run button when costs are not set) */
  onCosts?: () => void;
  model: BemModelOutcome | null;
  bem: BemOutcome | null;
  /** the sheet's cards written as units (2026-10-11): each a structure whose units are summed at their coincident peak */
  structures?: Array<{ name: string; units: string[]; unitZones?: Record<string, string[]> }>;
  engine: { exe: string; version: string; others?: Array<{ version: string }> } | null | undefined;
  idfReady: boolean;
  running: boolean;
  lastLine: string;
  validation: string | null;
  lens: Lens;
  legend: Legend | null;
  imperial: boolean;
  /** what the tabs hold STAGED that the model RUN describes lacks — in words, or null when nothing is */
  stagedNote: string | null;
  onValidate: () => void;
  onRun: () => void;
  onLens: (l: Lens) => void;
  onDock: (d: "bem-results" | "bem-run") => void;
  isOpen: (d: string) => boolean;
  /** the printed report (RunReport): the results and both graphs, through the system print dialog — Save as PDF is in it */
  onPrint: () => void;
  /** a side left off on a Zone card, approved or taken back (2026-11-03) */
  onApproveSide: (zone: string, side: ZoneSide, on: boolean) => void;
  busy: boolean;
}

const STORE = "bem-run-folds";
const k0 = (v: number): string => v.toLocaleString(undefined, { maximumFractionDigits: 0 });

export function BemRun(p: BemRunProps): React.ReactElement {
  const m = p.model, b = p.bem;
  // BEM's own runs: the model on its own weather — BOM's calibration runs are listed there (2026-10-09)
  const designRuns = (m?.runs ?? []).filter((r) => r.kind !== "calibration");
  const area = b?.facility.conditionedAreaM2 ?? 0;
  const perM2 = (kwh: number): string => (area > 0 ? ` (${fmtEnergyArea(kwh, area, p.imperial)})` : "");
  const stale = !!(b && m && b.run.modelSha256 && b.run.modelSha256 !== m.modelSha);
  // the Severe "is a casting surface and is non-convex" lines: what polygon clipping could not use (2026-10-20)
  const noShadow = (b?.err.groups ?? []).filter((g) => g.kind === "Severe" && /casting surface and is non-convex/.test(g.key)).reduce((n, g) => n + g.count, 0);
  const needs = [!b ? "no run yet" : null, b && (!b.run.completed || b.run.fatal > 0) ? "the last run did not complete" : null, stale ? "the model has changed since the last run" : null, p.stagedNote ? "rulings staged on a tab are not applied — Apply them, then Run" : null].filter((x): x is string => !!x);
  const bc = (k: string): number => m ? m.surfaces.filter((s) => s.bc === k).length : 0;
  const eu = b ? endUseTable(b.endUses) : null;
  const fuelPeakTotal = (fuel: string): number => b?.fuelPeaks.find((f) => f.fuel === fuel && f.row === "Total End Uses")?.w ?? 0;
  const fuelsWithPeak = b ? [...b.fuelPeakTimes.keys()].filter((f) => fuelPeakTotal(f) > 0) : [];
  const coils = b ? coilRows(b.sizingDetails) : [];
  const units = unitRows(coils);
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const yearStamp = (i: number): string => { const [, mo, d, h] = hourDate(b?.hourly?.[0]?.start, i); return `${d} ${MON[mo - 1]} ${String(h + 1).padStart(2, "0")}:00 (the hour ending)`; };
  const structures = b && coils.length ? structurePeaks(p.structures ?? [], coils, b.coilRates ?? { design: [], year: [] }, yearStamp).filter((s) => s.design.heating || s.design.cooling || s.year.heating || s.year.cooling) : [];
  const offCoils = units.flatMap((u) => u.none);
  // the zones' design loads, heating and cooling apart, each with the air flow it asks for (user, 2026-10-02)
  const zoneLoads = b ? b.report.zoneRows.filter((z) => z.conditioned.value).flatMap((z) => { const l = b.loads.zones.get(z.name.toUpperCase()); return l ? [{ name: z.name, l }] : []; }) : [];
  const pw = (w: number): string => fmtPower(w, p.imperial), air = (m3s: number | null | undefined): string => (m3s && m3s > 0 ? fmtFlowAir(m3s, p.imperial) : "—");
  const idealSystems = b ? new Set(b.sizingDetails.filter((s) => s.kind === "component" && s.cls === "ZoneHVAC:IdealLoadsAirSystem").map((s) => s.subject)).size : 0;
  const runEpw = b ? baseName(b.run.epw).replace(/\.epw$/i, "") : "";
  const modelEpw = m?.weather?.epwName ?? "—";
  return (
    <div className="idfBar bemCol">
      <EnvelopeLosses report={m?.report} imperial={p.imperial} />
      <Fold id="model" store={STORE} head="the model, as written" summary={m ? `${m.zones.length} zones · ${m.surfaces.length} surfaces · ${m.idf.split("\n").length.toLocaleString()} lines · model ${m.modelSha.slice(0, 12)}` : "no model yet"}>
        {!m && <div className="idfInfo">no model yet — build the envelope, then open a BEM tab</div>}
        {m && (
          <>
            <KV k="zones" v={`${m.zones.length} · ${m.zones.filter((z) => z.conditioned).length} conditioned`} />
            <KV k="surfaces" v={`${m.surfaces.length} — outdoors ${bc("Outdoors")} · ground ${bc("Ground")} · inter-zone ${bc("Surface")} · adiabatic ${bc("Adiabatic")} · not emitted ${m.notEmitted.size}`} />
            <KV k="constructions" v={`${m.constructions.filter((c) => !/ reversed$/.test(c.name)).length}`} />
            <KV k="in.idf" v={`${m.idf.split("\n").length.toLocaleString()} lines · model ${m.modelSha.slice(0, 12)}`} />
            <KV k="values" v={`file ${m.census.file} · code default ${m.census["code-default"]} · user ${m.census.user}`} />
            <button className="qaBtn" onClick={p.onValidate} disabled={p.running || p.engine === null}>Validate (--convert-only)</button>
            {p.validation && <div className="idfInfo runLine">{p.validation}</div>}
          </>
        )}
      </Fold>
      {/* THE CHECKS (the user, 2026-10-06): every question asked of the model as built, the answers kept in bem.db — what to look at first */}
      {m && (() => {
        const ck = m.checks, open = ck.filter((c) => c.verdict === "fail" || c.verdict === "warn"), notes = ck.filter((c) => c.verdict === "note");
        const rules = [...new Set(ck.map((c) => c.rule))];
        return (
          <Fold id="checks" store={STORE} head="checks — the model as built" summary={ck.length ? (open.length ? `${open.length} to look at · ${notes.length} noted · ${rules.length} rules` : `all ${rules.length} rules pass${notes.length ? ` · ${notes.length} noted` : ""}`) : "not checked — rebuild the model"}>
            <div className="qaPanel" title={`each build asks the same questions of the model and keeps every answer in bem.db's checks table:\n${rules.map((r) => `${r}: ${CHECK_RULES[r] ?? ""}`).join("\n")}`}><table><tbody>
              {[...open, ...notes, ...ck.filter((c) => c.verdict === "ok")].map((c, i) => (
                <tr key={i} title={`${c.rule}: ${CHECK_RULES[c.rule] ?? ""}${c.fix ? `\nchanged in ${c.fix}` : ""}`}>
                  <td className={c.verdict === "fail" || c.verdict === "warn" ? "src-warn" : c.verdict === "note" ? "src-code" : "muted"}>{c.verdict === "ok" ? "✓" : c.verdict === "note" ? "note" : c.verdict === "fail" ? "✗" : "!"}</td>
                  <td>{c.subject}</td><td>{c.text}{c.fix && c.verdict !== "ok" ? <span className="muted"> — {c.fix}</span> : null}
                    {c.sides && c.sides.off.map((side) => (
                      <label key={side} className="runApprove" title="ticked, the model runs with this side off; unticked, the run stops until it is switched on or approved">
                        <input type="checkbox" checked={c.sides!.approved.includes(side)} disabled={p.busy} onChange={(e) => p.onApproveSide(c.subject, side, e.target.checked)} /> approve: {c.subject} runs without {side}</label>
                    ))}</td>
                </tr>
              ))}
            </tbody></table></div>
          </Fold>
        );
      })()}
      <Fold id="run" store={STORE} head="run" summary={`${p.engine ? p.engine.version.replace(/^EnergyPlus, /, "") : "no engine"} · ${modelEpw}${b ? ` · last run ${b.run.completed ? "completed" : "did not complete"} F/S/W ${b.run.fatal}/${b.run.severe}/${b.run.warning}` : ""}`}>
        <KV k="engine" v={p.engine === undefined ? "…" : p.engine ? engineName(p.engine.version) : "NOT FOUND — install EnergyPlus (see SETUP.md)"} />
        {p.engine?.others?.length ? <KV k="also installed" v={`${p.engine.others.map((o) => o.version.replace(/^EnergyPlus, /, "")).join(" · ")} — the newest is used unless ENERGYPLUS names one`} /> : null}
        <KV k="weather" src={m?.settings.find((s) => s.key === "weather_epw")?.source} v={modelEpw} />
        {p.stagedNote && <div className="idfInfo src-user" title="the model RUN describes is rebuilt from the APPLIED ledger; a ruling staged on a tab and not yet applied is not in it">{p.stagedNote}</div>}
        {/* ENERGY COSTS (the user's rulings, 2026-09-24 and 2026-10-02): said AT the Run button, before a run — a notice with the
            way to BOM, never a prompt; the run is never blocked */}
        {m && (m.built.model.tariff?.card.charges
          ? <div className="idfInfo src-user" title="the applied tariff, held in idf.db with the model: the engine prices the year">costs: {m.built.model.tariff.card.name ?? m.built.model.tariff.card.id} — the run prices the year</div>
          : <div className="idfInfo costNote" title="no tariff is applied in BOM › UTILITY, so the run reports energy only">⚠ energy costs not set — this run reports energy only{p.onCosts && <> · <button className="chip" onClick={p.onCosts}>set them in BOM › UTILITY</button></>}</div>)}
        {/* ACTION NEEDED (user, 2026-10-10: "track any upstream changes so that the Run EnergyPlus button background changes to red"): no
            run yet, the model changed since the last run (any applied ruling, the file, the weather, the materials — all move the model's
            sha), or rulings staged on a tab and not yet applied */}
        {/* THE CODE'S VALUES INCOMPLETE (2026-10-15): the model is built for the tabs, but never run — the gap named, and where to enter it */}
        {m?.report.codeGap && <div className="idfInfo bad" title="the default constructions, the infiltration and the reference thermostat are the code's values — none is invented">cannot run: {m.report.codeGap}</div>}
        <button className={`apply${needs.length && !p.running ? " needsRun" : ""}`} onClick={p.onRun} disabled={p.running}
          title={needs.length ? `action needed: ${needs.join(" · ")}` : "the last run is of the model as it stands"}>
          {p.running ? "running…" : "Run EnergyPlus"}
        </button>
        {(p.running || p.lastLine) && <div className="idfInfo runLine">{p.lastLine}</div>}
        {b && (
          <KV k="engine said" v={<span className={b.run.fatal || b.run.severe ? "bad" : "ok"}>
            {b.run.completed ? "completed" : "did not complete"} · Fatal {b.run.fatal} · Severe {b.run.severe} · Warning {b.run.warning} · {b.run.seconds.toFixed(0)} s
          </span>} />
        )}
        {/* NO GRAPHICS CARD (2026-10-20, the CI runners, a virtual machine, a remote desktop): EnergyPlus said "No GPU found (required for
            PixelCounting)" and cast the shadows by polygon clipping instead — said here, never left to the run log */}
        {b?.err.noGpuShadows && <div className="idfInfo bad" title="SITE › simulation › shadows asks for PixelCounting, which needs a graphics card (OpenGL). Without one EnergyPlus uses polygon clipping, which cannot use a non-convex surface to cast shadows and reports each as a Severe error; the year's heating and cooling come out a little different from a run on a computer with a graphics card">
          no graphics card: EnergyPlus cast the shadows by polygon clipping, not PixelCounting{noShadow ? ` — ${noShadow} non-convex surface${noShadow === 1 ? "" : "s"} cast no shadow (Severe)` : ""}; results differ slightly from a computer with one
        </div>}
        {b && <button className={`qaBtn${p.isOpen("bem-run") ? " on" : ""}`} onClick={() => p.onDock("bem-run")}>run log</button>}
      </Fold>
      <Fold id="energy" store={STORE} head="results — annual, by fuel" summary={b ? `heating ${k0(b.facility.heatingKwh)} · cooling ${k0(b.facility.coolingKwh)} kWh${perRun(b.hourly)}${eu && eu.fuels.includes("Electricity") ? ` · electricity ${k0(eu.fuelTotal("Electricity"))} kWh` : ""}${stale ? " · from an earlier model" : ""}` : "no run yet"}>
        {!b && <div className="idfInfo">no run yet</div>}
        {b && eu && (
          <>
            <div className="idfInfo" title="the run's own epoch: its stamp, the weather file it ran with and the engine that ran it">run {b.stamp} · {runEpw || "design days only"} · {engineName(b.run.energyplusVersion)}</div>
            {stale && <div className="idfInfo src-user">from model {String(b.run.modelSha256).slice(0, 12)} — the model has changed since; run again for the current one</div>}
            {/* COSTS (2026-10-03): the tariff BOM › UTILITY applied, as the engine priced the year — or said that there is none */}
            {b.tariffs?.length
              ? b.tariffs.map((t) => <KV key={t.name} k="costs included" src="user" v={`${t.name} · $${t.annualUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/yr as the engine priced it — BOM › UTILITY carries the net-metering credits and the bills`} />)
              : <KV k="costs" v="not set — this run reports energy only; apply a tariff in BOM › UTILITY" />}
            <KV k="heating" title="the End Uses Heating row summed over every fuel — the ideal-loads zones' district heating and a real system's electricity or fuel alike" v={`${k0(b.facility.heatingKwh)} kWh${perRun(b.hourly)}${perM2(b.facility.heatingKwh)}`} />
            <KV k="cooling" title="the End Uses Cooling row summed over every fuel" v={`${k0(b.facility.coolingKwh)} kWh${perRun(b.hourly)}${perM2(b.facility.coolingKwh)}`} />
            {eu.fuels.length > 0 && (
              <div className="qaPanel" style={{ maxHeight: "none" }}>
                <table>
                  <thead><tr><th>end use · kWh</th>{eu.fuels.map((f) => <th key={f} title={fuelLabel(f)}>{fuelShort(f)}</th>)}</tr></thead>
                  <tbody>
                    {eu.rows.map((r) => (
                      <tr key={r}><td>{r.toLowerCase()}</td>{eu.fuels.map((f) => { const v = eu.at(r, f); return <td key={f}>{v === null ? "" : k0(v)}</td>; })}</tr>
                    ))}
                  </tbody>
                  <tfoot><tr><td><b>total</b></td>{eu.fuels.map((f) => <td key={f}><b>{k0(eu.fuelTotal(f))}</b></td>)}</tr></tfoot>
                </table>
              </div>
            )}
            {(m?.report.meters?.length ?? 0) > 0 && (() => {
              // THE METERS (user, 2026-10-23): each Meter card's year, and what no meter holds — the building's total less theirs; a
              // meter's unit left on the building (serving zones on two meters, its parts not named) said beside it
              const yr = (nm: string): number | null => { const k = [...b.monthlyMeters.keys()].find((x) => x.toUpperCase() === nm.toUpperCase()); return k ? b.monthlyMeters.get(k)!.reduce((t, v) => t + v, 0) : null; };
              const fac = yr("Electricity:Facility"), rows = m!.report.meters!.map((x) => ({ ...x, kwh: x.emitted ? yr(x.emitted) : null }));
              const sum = rows.reduce((t, x) => t + (x.kwh ?? 0), 0);
              return (
                <div className="qaPanel runLoads">
                  <table>
                    <thead><tr><th>meter</th><th title="the Meter:Custom's year, kWh">kWh</th><th>zones · units</th></tr></thead>
                    <tbody>
                      {rows.map((x) => <tr key={x.name} title={x.left.join("\n")}><td>{x.name}</td><td>{x.kwh === null ? "not in this run — Run again" : k0(x.kwh)}</td><td>{x.zones.join(", ")}{x.units.length ? ` · ${x.units.join(", ")}` : ""}{x.left.length ? ` · ${x.left.length} not on it (hover)` : ""}</td></tr>)}
                      {fac !== null && <tr className="muted" title="Electricity:Facility less the meters: what is on no meter — exterior lights, shared equipment, a unit serving zones on two meters"><td>on no meter</td><td>{k0(fac - sum)}</td><td>the building's total {k0(fac)} less the meters</td></tr>}
                    </tbody>
                  </table>
                </div>
              );
            })()}
            <KV k="unmet" v={`${b.facility.unmetHeatingH.toFixed(0)} h heating · ${b.facility.unmetCoolingH.toFixed(0)} h cooling`} />
            <KV k="conditioned" v={p.imperial ? `${(area * 10.7639).toFixed(0)} ft²` : `${area.toFixed(1)} m²`} />
            <button className={`qaBtn${p.isOpen("bem-results") ? " on" : ""}`} onClick={() => p.onDock("bem-results")} title="the frame under the view: the annual end uses, the months, the loads, the units' sizing and the zones — each as a table or a chart">results — tables and charts</button>
            <button className="qaBtn" onClick={p.onPrint} title="the full report — the run, the annual and monthly results, the Annual graph with every series, the Peak heating and cooling graphs, the zones and the sizing — through the system print dialog (Save as PDF is in it)">Print / Save PDF…</button>
          </>
        )}
      </Fold>
      <Fold id="peaks" store={STORE} head="peak demand and design loads" summary={b ? (fuelsWithPeak.length ? fuelsWithPeak.map((f) => `${fuelShort(f)} ${fmtPower(fuelPeakTotal(f), p.imperial)} at ${decodeTime(b.fuelPeakTimes.get(f) ?? 0)}`).join(" · ") : "no peak read") : "no run yet"}>
        {!b && <div className="idfInfo">no run yet</div>}
        {b && (
          <>
            {fuelsWithPeak.map((f) => {
              const share = (row: string): number => b.fuelPeaks.find((x) => x.fuel === f && x.row === row)?.w ?? 0;
              const parts = ["Heating", "Cooling", "Fans", "Pumps", "Interior Lighting", "Interior Equipment"].filter((r) => share(r) > 0).map((r) => `${r.toLowerCase()} ${fmtPower(share(r), p.imperial)}`);
              return <KV key={f} k={fuelShort(f)} title={`${fuelLabel(f)}: its own coincident peak over the weather year (Demand End Use Components Summary) and the rows' share at that moment`}
                v={`${fmtPower(fuelPeakTotal(f), p.imperial)} at ${decodeTime(b.fuelPeakTimes.get(f) ?? 0)}${parts.length ? ` — ${parts.join(" · ")}` : ""}`} />;
            })}
            {zoneLoads.length > 0 && (
              <div className="qaPanel runLoads" title="each zone's sensible design load at its design day and the supply air it asks for (HVAC Sizing Summary: Calculated Design Load, Calculated Design Air Flow) — heating and cooling apart; the unit serving it is sized with the sizing factor on top">
                <table>
                  <thead><tr><th>zone</th><th>heating</th><th>air</th><th>cooling</th><th>air</th></tr></thead>
                  <tbody>{zoneLoads.map(({ name, l }) => (
                    <tr key={name}>
                      <td>{name}</td>
                      <td title={`${designDayShort(l.heatingDay)} · ${decodeTime(l.heatingDayTime)}`}>{pw(l.designHeatingW)}</td><td>{air(l.designHeatingFlowM3s)}</td>
                      <td title={`${designDayShort(l.coolingDay)} · ${decodeTime(l.coolingDayTime)}`}>{pw(l.designCoolingW)}</td><td>{air(l.designCoolingFlowM3s)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            <KV k="design loads" title="Σ of the zones' design loads at the design days (HVAC Sizing Summary) — non-coincident, the zone's sensible load with no ventilation or system effects"
              v={`Σ zones heating ${fmtPower(b.loads.facility.sumDesignHeatingW, p.imperial)} · cooling ${fmtPower(b.loads.facility.sumDesignCoolingW, p.imperial)} · ${b.loads.zones.size} zones, ${b.loads.spaces.size} spaces`} />
          </>
        )}
      </Fold>
      <Fold id="sizing" store={STORE} head="unit sizing — the engine's own reports" summary={b ? (coils.length ? `${units.length} units · ${coils.length - offCoils.length} coils sized` : idealSystems ? `ideal loads on ${idealSystems} zones — no unit to size` : "nothing sized") : "no run yet"}>
        {!b && <div className="idfInfo">no run yet</div>}
        {b && coils.length === 0 && <div className="idfInfo">{idealSystems ? `ideal loads on ${idealSystems} zones — the engine sized no coil, fan or pump (ComponentSizingSummary holds the ideal-loads systems alone)` : "the run wrote no sizing rows"}</div>}
        {b && coils.length > 0 && (
          <>
            <div className="idfInfo" title="CoilSizingDetails, the coils grouped by unit: each coil's gross capacity at its design day and its air flow — the numbers a unit is picked from; the full table is in the frame under SYSTEMS">per unit — the load at its design-day peak, heating and cooling, with the air; the coil as sized</div>
            <div className="qaPanel runLoads">
              <table>
                <thead><tr><th>unit</th><th title="the heating load the unit met at its design-day peak">heating</th><th>air</th><th title="the cooling load (total) at its design-day peak">cooling</th><th>air</th><th title="the coil capacity the engine sized — a variable-speed heat pump's two coils take one size, the larger side's">coil</th></tr></thead>
                <tbody>{units.map((u) => {
                  const tip = (c: typeof u.heating): string => (c ? `${c.name} · ${c.type}${c.day ? ` · ${designDayShort(c.day)} at ${designStamp(c.time)}` : ""}${c.peakSensibleW !== null && /Cooling/i.test(c.type) ? ` · sensible ${pw(c.peakSensibleW)}` : ""} · coil ${c.capacityW !== null ? pw(c.capacityW) : "—"}` : "no coil");
                  return (
                    <tr key={u.unit} title={u.zones ? `serves ${u.zones}` : undefined}>
                      <td>{u.unit}</td>
                      <td title={tip(u.heating)}>{u.heating?.peakW ? pw(u.heating.peakW) : "—"}</td><td>{air(u.heating?.airM3s)}</td>
                      <td title={tip(u.cooling)}>{u.cooling?.peakW ? pw(u.cooling.peakW) : "—"}</td><td>{air(u.cooling?.airM3s)}</td>
                      <td title={`heating coil ${u.heating?.capacityW ? pw(u.heating.capacityW) : "—"} · cooling coil ${u.cooling?.capacityW ? pw(u.cooling.capacityW) : "—"}`}>{pw(Math.max(u.heating?.capacityW ?? 0, u.cooling?.capacityW ?? 0))}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
            {structures.length > 0 && (
              <>
                <div className="idfInfo" title="the engine writes the house as a unit per thermostat zone (one controlling thermostat per unitary heat pump); the system's real equipment meets the zones TOGETHER, so its size is the instant their summed load is largest — each unit's row is its load AT that instant, not its own peak">system peak — each system's units summed at the instant they peak together; the zones' loads at that instant</div>
                {structures.map((st) => {
                  const cell = (sd: StructurePeakSide | null, u: string): string => { const r = sd?.byUnit.find((x) => x.unit === u); return r ? pw(r.w) : "—"; };
                  const tipU = (sd: StructurePeakSide | null, u: string): string => { const r = sd?.byUnit.find((x) => x.unit === u); return r ? `at the system's peak ${pw(r.w)} · its own peak ${pw(r.ownPeakW)}` : ""; };
                  return (
                    <div key={st.name} className="qaPanel runLoads">
                      <table>
                        <thead><tr><th>{st.name}</th><th title="on the winter design day, at each zone timestep — the sizing basis">heating</th><th title="on the summer design day, the coils' total (sensible + latent)">cooling</th></tr></thead>
                        <tbody>
                          {st.units.map((u) => {
                            const z = st.design.heating?.byUnit.find((x) => x.unit === u)?.zones ?? st.design.cooling?.byUnit.find((x) => x.unit === u)?.zones ?? "";
                            return <tr key={u} title={z ? `serves ${z}` : undefined}><td>{u}</td><td title={tipU(st.design.heating, u)}>{cell(st.design.heating, u)}</td><td title={tipU(st.design.cooling, u)}>{cell(st.design.cooling, u)}</td></tr>;
                          })}
                          <tr className="sum"><td><b>System Peak</b></td>
                            <td title={st.design.heating?.at}><b>{st.design.heating ? pw(st.design.heating.w) : "—"}</b></td>
                            <td title={st.design.cooling?.at}><b>{st.design.cooling ? pw(st.design.cooling.w) : "—"}</b></td></tr>
                          <tr className="muted"><td>at</td><td>{st.design.heating?.at.replace(" design day", "") ?? "—"}</td><td>{st.design.cooling?.at.replace(" design day", "") ?? "—"}</td></tr>
                          <tr className="muted" title="the same sum over the weather year, by the hour — an hourly average, so it reads below a timestep peak"><td>weather-year peak</td>
                            <td title={st.year.heating?.at}>{st.year.heating ? `${pw(st.year.heating.w)} · ${st.year.heating.at.replace(" (the hour ending)", "")}` : "—"}</td>
                            <td title={st.year.cooling?.at}>{st.year.cooling ? `${pw(st.year.cooling.w)} · ${st.year.cooling.at.replace(" (the hour ending)", "")}` : "—"}</td></tr>
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </>
            )}
            {b && coils.length > 0 && structures.length === 0 && (p.structures ?? []).length > 0 && <div className="idfInfo">system peak — this run carries no coil rates; Run again to sum each system's units at their coincident peak</div>}
            {units.flatMap((u) => u.others.map((c) => (
              <KV key={c.name} k={c.kind} title={`${c.name} · ${c.type}`} v={`${u.unit}: ${c.capacityW !== null ? pw(c.capacityW) : "—"}${c.waterM3s !== null && c.waterM3s > 0 ? ` · ${fmtFlowWater(c.waterM3s, p.imperial)}` : ""}`} />
            )))}
            {offCoils.length > 0 && <div className="idfInfo" title={offCoils.map((c) => c.name).join(" · ")}>supplemental heat: none — switched off on {offCoils.length === 1 ? "the card" : `${offCoils.length} cards`} (the class requires the coil; it is written at 0 W, never available)</div>}
          </>
        )}
      </Fold>
      {m && designRuns.length > 0 && (
        <Fold id="runs" store={STORE} head={`runs — ${designRuns.length}`} defaultOpen={false} summary={`last ${designRuns[designRuns.length - 1]?.stamp ?? ""}`}>
          <div className="qaPanel">
            <table>
              <thead><tr><th>stamp</th><th>weather</th><th>engine</th><th>F/S/W</th><th>s</th><th>model</th></tr></thead>
              <tbody>
                {[...designRuns].reverse().map((r) => (
                  <tr key={r.stamp} className={r.modelSha256 === m.modelSha ? "" : "bad"} title={r.modelSha256 === m.modelSha ? "run on the current model" : "run on an earlier model"}>
                    <td>{r.stamp}</td><td>{(r.epw ?? "").split(/[\\/]/).pop()?.replace(/\.epw$/i, "")}</td>
                    <td>{(r.energyplusVersion || "").replace(/^EnergyPlus, Version /, "").split(",")[0]?.split("-")[0] ?? ""}</td>
                    <td>{r.fatal}/{r.severe}/{r.warning}</td><td>{r.seconds.toFixed(0)}</td><td>{(r.modelSha256 ?? "").slice(0, 8) || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Fold>
      )}
    </div>
  );
}
