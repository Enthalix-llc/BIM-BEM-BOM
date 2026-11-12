// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// SUPPLY AIR (the user, 2026-11-10: "a frame listing of expected supply temperature (heating in heating view and cooling in
// cooling view) picked up from mechanical system definition with an option to adjust for duct gain or loss. The cfd model should
// use this value when running the simulation"): the system's own supply temperature for the room's zone and peak (cfdPrep's
// supplyOf: typed on the unit's card, else the unit as sized, else the zone as sized), a duct gain or loss typed on top, and the
// temperature the next Run CFD… uses — saved with the room's other CFD choices. What the last run used is read from cfd.db.

import type { ReactNode } from "react";
import type { CfdOffer } from "../core/cfdPrep.js";
import { supplyUsed, type CfdChoices, type SupplyChoice } from "../core/cfdChoices.js";
import { fmtPower, fmtTemp, NumInput } from "../../bem/view/bemUi.js";

const RHO = 1.2, CP = 1006, CFM = 0.000471947;

export function SupplyAirPanel({ space, peak, offer, why, saved, lastRunC, imperial, onChange, onSetpoint }: {
  space: string | null; peak: "heating" | "cooling";
  offer: CfdOffer | null; why: string | null;
  saved: Partial<CfdChoices> | null;
  /** the supply temperature the latest run of this room and peak used, °C */
  lastRunC: number | null;
  imperial: boolean;
  onChange: (peak: "heating" | "cooling", s: SupplyChoice) => void;
  /** the room's setpoint for the run, typed — null back to the zone's thermostat */
  onSetpoint: (peak: "heating" | "cooling", c: number | null) => void;
}): ReactNode {
  if (!space) return <div className="muted">pick a space in LEVELS · SPACES</div>;
  if (!offer) return <div className="muted">{why ?? `reading ${space}'s system…`}</div>;
  const src = offer.supply[peak], pk = offer.peaks.find((p) => p.peak === peak);
  const sc: SupplyChoice = saved?.supply?.[peak] ?? { system: true, ductK: 0 };
  const used = supplyUsed(offer, saved ?? {}, peak);
  // the flow saved for the room (its supply terminals' cfm), for the load the temperature delivers
  const cfm = Object.values(saved?.terms ?? {}).filter((t) => t.use && t.role === "supply").reduce((s, t) => s + (t.cfm ?? 0), 0);
  const typedSp = saved?.setpoints?.[peak];
  const thermostat = pk?.setpointC ?? null;
  const setpoint = typedSp ?? thermostat;
  const typedDiffers = typedSp != null && (thermostat == null || Math.abs(typedSp - thermostat) > 1e-6);
  const balanceC = pk && setpoint != null && cfm > 0 ? setpoint + (peak === "heating" ? 1 : -1) * pk.loadW / (RHO * CP * cfm * CFM) : null;
  const delivered = used && setpoint != null && cfm > 0 ? RHO * CP * cfm * CFM * Math.abs(used.c - setpoint) : null;
  const dK = (k: number): string => (imperial ? `${(k * 1.8).toFixed(1)} °F` : `${k.toFixed(1)} K`);
  return (
    <div className="cfdSupply">
      <div className="muted">the air the system delivers to {space} at the {peak} peak — Run CFD… uses the temperature below</div>
      <table className="cfdSupplyTable"><tbody>
        <tr><td>setpoint</td><td>
          {/* the zone's thermostat (ZONES), the room held at it in the run; typed here for this run alone (2026-11-10) */}
          <NumInput className="num" digits={imperial ? 1 : 2} value={setpoint == null ? null : imperial ? setpoint * 1.8 + 32 : setpoint} onValue={(n) => onSetpoint(peak, n == null ? null : imperial ? (n - 32) / 1.8 : n)} />
          {imperial ? " °F" : " °C"} <span className="muted">· the zone's thermostat {thermostat != null ? fmtTemp(thermostat, imperial) : "—"} ({offer.zone ?? space}, ZONES){typedDiffers ? " · typed for CFD" : ""}</span>
          {typedDiffers && <> <button className="qaBtn" onClick={() => onSetpoint(peak, null)} title="back to the zone's thermostat">thermostat</button></>}
        </td></tr>
        <tr><td>the system</td><td>{src ? <><b>{fmtTemp(src.c, imperial)}</b> <span className="muted">· {src.from}</span></> : <span className="muted">the model states no {peak} supply temperature for {offer.zone ?? space}'s zone</span>}</td></tr>
        <tr><td>duct</td><td>
          <NumInput className="num" digits={1} disabled={!src || !sc.system} value={imperial ? sc.ductK * 1.8 : sc.ductK}
            onValue={(v) => onChange(peak, { ...sc, ductK: v == null ? 0 : imperial ? v / 1.8 : v })} />
          {imperial ? " °F" : " K"} <span className="muted">gain (+) or loss (−) between the unit and the register — {peak === "heating" ? "a heating duct through unconditioned space loses (−)" : "a cooling duct through a warm attic gains (+)"}</span>
        </td></tr>
        <tr><td>used in the run</td><td>
          <label><input type="checkbox" disabled={!src} checked={!!src && sc.system} onChange={(e) => onChange(peak, { ...sc, system: e.target.checked })} /> the system's supply{sc.ductK ? ` ${sc.ductK > 0 ? "+" : "−"} ${dK(Math.abs(sc.ductK))}` : ""}</label>
          {" → "}<b>{used ? fmtTemp(used.c, imperial) : balanceC != null ? fmtTemp(balanceC, imperial) : "—"}</b>
          {!used && <span className="muted"> · {balanceC != null ? "the temperature that delivers the design load at the flow typed" : "type the room's supply flows in Run CFD… first"}</span>}
        </td></tr>
        {pk && <tr><td>the load</td><td>
          design {fmtPower(pk.loadW, imperial)}{cfm > 0 ? ` · at ${cfm.toFixed(0)} cfm` : ""}
          {delivered != null && <> · this supply delivers about {fmtPower(delivered, imperial)} ({((100 * delivered) / Math.max(1, pk.loadW)).toFixed(0)} %){Math.abs(delivered - pk.loadW) > 0.05 * pk.loadW ? <span className="muted"> — the room will settle {(delivered > pk.loadW) === (peak === "heating") ? "above" : "below"} its setpoint</span> : null}</>}
        </td></tr>}
        <tr><td>the last run</td><td>{lastRunC != null ? <>{fmtTemp(lastRunC, imperial)} <span className="muted">· what cfd.db's latest {peak} run of {space} used</span></> : <span className="muted">none</span>}</td></tr>
      </tbody></table>
    </div>
  );
}
