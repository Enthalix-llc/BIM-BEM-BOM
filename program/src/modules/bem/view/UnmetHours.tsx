// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// RUN › UNMET HOURS (user, 2026-11-22): the VIEW is the model, each conditioned zone's spaces painted by how far the zone's air missed its
// setpoint — blue too cold, red too hot, deeper the further — over a window the timeline under the model sets (a month, a day, an hour),
// the colour the window's WORST hour. The FRAME is the table: each conditioned zone with its spaces, its setpoints and its hours not met
// month by month; a row selects the zone (⌘/Ctrl adds), a month cell moves the timeline there, a double-click on a side's row drops its
// hours by whole degrees of divergence (1°, 2° …) and a double-click rolls them up. Unconditioned zones are not listed, only named.
import { useState, type ReactNode } from "react";
import type { BemOutcome } from "../pipeline.js";
import { binsOf, dateOfHour, runMonths, sideHours, windowValue, type ZoneDivergence } from "../core/zoneDivergence.js";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export type UnmetScale = "month" | "day" | "hour";
export interface UnmetAt { scale: UnmetScale; i: number }

/** the hours [a, b) the timeline's window covers */
export function unmetWindow(at: UnmetAt, start: [number, number, number] | undefined, hours: number): [number, number] {
  if (at.scale === "hour") return [at.i, at.i + 1];
  if (at.scale === "day") { const a = Math.floor(at.i / 24) * 24; return [a, a + 24]; }
  const mo = runMonths(start, hours).find((m) => at.i >= m.a && at.i < m.b);
  return mo ? [mo.a, mo.b] : [0, hours];
}

/** each conditioned zone's colour value over the window, °C signed, keyed by the engine's (UPPERCASE) name */
export function unmetValues(zs: ZoneDivergence[], at: UnmetAt): Map<string, number> {
  const z0 = zs[0];
  if (!z0) return new Map();
  const [a, b] = unmetWindow(at, z0.start, z0.div.length);
  return new Map(zs.map((z) => [z.zone, windowValue(z, a, b)] as const));
}

/** the timeline's first window: the month holding the most hours not met */
export function firstUnmetAt(zs: ZoneDivergence[]): UnmetAt {
  const z0 = zs[0];
  if (!z0) return { scale: "month", i: 0 };
  const ms = runMonths(z0.start, z0.div.length);
  let best = 0, bestH = -1;
  ms.forEach((m, k) => { let h = 0; for (const z of zs) for (let i = m.a; i < m.b; i++) h += Math.abs(z.unmet[i] ?? 0); if (h > bestH) { bestH = h; best = k; } });
  return { scale: "month", i: ms[best]?.a ?? 0 };
}

const monthLabel = (m: { y: number; m: number }, spanYears: boolean): string => `${MON[m.m - 1]}${spanYears ? ` ${String(m.y).slice(2)}` : ""}`;
const fmtHourOf = (h: number): string => `${String(h - 1).padStart(2, "0")}:00–${String(h).padStart(2, "0")}:00`;

/** THE TIMELINE AND THE LEGEND, under the model in the view */
export function UnmetTimeline(p: { zs: ZoneDivergence[]; span: number; at: UnmetAt; onAt: (a: UnmetAt) => void; imperial: boolean; names: Map<string, string> }): ReactNode {
  const z0 = p.zs[0];
  if (!z0) return null;
  const hours = z0.div.length, ms = runMonths(z0.start, hours), spanYears = ms.length > 0 && ms[0]!.y !== ms[ms.length - 1]!.y;
  const deg = (c: number): string => `${(Math.abs(c) * (p.imperial ? 1.8 : 1)).toFixed(1)} ${p.imperial ? "°F" : "°C"}`;
  const [a, b] = unmetWindow(p.at, z0.start, hours);
  const d0 = dateOfHour(z0.start, a);
  const label = p.at.scale === "month" ? `${MON[d0.m - 1]} ${d0.y}` : p.at.scale === "day" ? `${MON[d0.m - 1]} ${d0.d}, ${d0.y}` : `${MON[d0.m - 1]} ${d0.d}, ${d0.y} · ${fmtHourOf(d0.h)}`;
  const n = p.at.scale === "month" ? ms.length : p.at.scale === "day" ? Math.ceil(hours / 24) : hours;
  const v = p.at.scale === "month" ? Math.max(0, ms.findIndex((m) => p.at.i >= m.a && p.at.i < m.b)) : p.at.scale === "day" ? Math.floor(p.at.i / 24) : p.at.i;
  const to = (k: number): void => { const kk = Math.max(0, Math.min(n - 1, k)); p.onAt({ scale: p.at.scale, i: p.at.scale === "month" ? ms[kk]!.a : p.at.scale === "day" ? kk * 24 : kk }); };
  const worst = p.zs.map((z) => ({ z, v: windowValue(z, a, b) })).filter((x) => Math.abs(x.v) > 0).sort((x, y) => Math.abs(y.v) - Math.abs(x.v));
  let hrs = 0; for (const z of p.zs) for (let i = a; i < b; i++) hrs += Math.abs(z.unmet[i] ?? 0);
  return (
    <div className="unmetTimeline" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <b title="each conditioned zone's spaces take the zone's colour — EnergyPlus reports the air per zone. The colour is the window's worst hour: the zone's mean air in that hour less the setpoint it missed. Unconditioned zones are grey">
        divergence from setpoint · {label} · the window's worst hour
      </b>
      <div className="legendBar unmetDiv" />
      <div className="legendEnds"><span>{deg(p.span)} too cold</span><span>met</span><span>{deg(p.span)} too hot</span></div>
      <div className="unmetScale">
        {(["month", "day", "hour"] as const).map((s) => <button key={s} className={p.at.scale === s ? "on" : ""} onClick={() => p.onAt({ scale: s, i: p.at.i })} title={`step the model a ${s} at a time — the window keeps its place in the year`}>{s}</button>)}
        <button onClick={() => to(v - 1)} disabled={v <= 0} title={`the ${p.at.scale} before`}>‹</button>
        <input type="range" min={0} max={n - 1} value={v} onChange={(e) => to(Number(e.target.value))} title={`${p.at.scale} ${v + 1} of ${n}`} />
        <button onClick={() => to(v + 1)} disabled={v >= n - 1} title={`the ${p.at.scale} after`}>›</button>
      </div>
      <span className="muted">
        {worst.length ? `${hrs < 10 ? hrs.toFixed(1) : hrs.toFixed(0)} zone-hours not met · ${worst.slice(0, 4).map((x) => `${p.names.get(x.z.zone) ?? x.z.zone} ${x.v < 0 ? "−" : "+"}${deg(x.v)}`).join(" · ")}${worst.length > 4 ? ` · ${worst.length - 4} more` : ""}`
          : "every conditioned zone met its setpoints in this window"}
      </span>
    </div>
  );
}

/** THE TABLE, in the frame under the view */
export function UnmetHoursFrame(p: { bem: BemOutcome; imperial: boolean; selected: string[]; onSelect: (zone: string, add: boolean) => void; onMonth: (hour: number) => void }): ReactNode {
  const { bem, imperial } = p;
  const [open, setOpen] = useState<Set<string>>(new Set());
  const up = (s: string): string => s.toUpperCase();
  const zs = bem.zoneDivergence ?? [];
  const byZone = new Map(zs.map((z) => [z.zone, z] as const));
  const z0 = zs[0];
  const ms = z0 ? runMonths(z0.start, z0.div.length) : MON.map((_, k) => ({ y: 0, m: k + 1, a: 0, b: 0 }));
  const spanYears = ms.length > 0 && ms[0]!.y !== ms[ms.length - 1]!.y;
  const hourly = zs.length > 0;
  const byMonth = hourly || bem.monthlyUnmet.heating.size + bem.monthlyUnmet.cooling.size > 0;
  const degScale = imperial ? 1.8 : 1, du = imperial ? "°F" : "°C";
  const zones = bem.zones.filter((z) => z.conditioned);
  const unconditioned = bem.zones.filter((z) => !z.conditioned).map((z) => z.name);
  const temp = (c: number | null): string => (c === null ? "—" : imperial ? `${(c * 9 / 5 + 32).toFixed(0)} °F` : `${c.toFixed(1)} °C`);
  const hrs = (v: number): string => (v < 0.05 ? "" : v < 10 ? v.toFixed(1) : v.toFixed(0));
  type Row = { side: "heating" | "cooling"; setC: number | null; months: number[] | null; total: number };
  const groups = zones.map((z) => {
    const dv = byZone.get(up(z.epName)) ?? byZone.get(up(z.name));
    const spaces = bem.rooms.filter((r) => r.zone === z.name && r.conditioned).map((r) => r.room);
    const rows: Row[] = (["heating", "cooling"] as const).map((side) => {
      if (dv) { const s = sideHours(dv, side, ms); return { side, setC: side === "heating" ? z.heatingSetpointC : z.coolingSetpointC, months: s.months, total: s.year }; }
      const months = bem.monthlyUnmet[side].get(up(z.epName)) ?? bem.monthlyUnmet[side].get(up(z.name)) ?? null;
      const total = months ? months.reduce((t, v) => t + v, 0) : bem.unmetYear[side].get(up(z.epName)) ?? bem.unmetYear[side].get(up(z.name)) ?? 0;
      return { side, setC: side === "heating" ? z.heatingSetpointC : z.coolingSetpointC, months, total };
    }).filter((r) => r.total >= 0.05);
    return { zone: z.name, dv, spaces: spaces.length ? spaces : [z.name], rows, worst: Math.max(0, ...rows.map((r) => r.total)) };
  });
  const hit = groups.filter((g) => g.rows.length).sort((a, b) => b.worst - a.worst);
  const met = groups.filter((g) => !g.rows.length).map((g) => g.zone);
  const sum = (side: "heating" | "cooling"): number => hit.reduce((t, g) => t + (g.rows.find((r) => r.side === side)?.total ?? 0), 0);
  const toggle = (k: string): void => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  return (
    <div className="unmetView">
      <div className="runGraphNote">
        run {bem.stamp} — the hours each conditioned zone's air stood below its heating setpoint or above its cooling setpoint by more than
        the engine's tolerance (0.2 °C = 0.36 °F, OutputControl:ReportingTolerances' default). A row selects its zone in the model (⌘/Ctrl
        adds); a month moves the timeline there; double-click a heating or cooling row to drop its hours by whole {du} of divergence,
        double-click again to roll them up. Unconditioned zones are not listed{unconditioned.length ? ` (${unconditioned.length}: ${unconditioned.join(", ")})` : ""}.
        {!hourly && <span className="runStale"> This run holds no hourly temperatures — Run again for the colours, the timeline and the drill-down.</span>}
      </div>
      {hit.length === 0 ? <div className="runGraphNote">every conditioned zone met its setpoints every hour of the run</div> : (
        <table className="runSums unmetTable">
          <thead><tr><th>zone · its spaces</th><th>side</th><th className="num">setpoint</th>
            {byMonth && ms.map((m, k) => <th key={k} className="num">{monthLabel(m, spanYears)}</th>)}<th className="num">year, h</th></tr></thead>
          <tbody>
            {hit.flatMap((g) => g.rows.flatMap((r, i) => {
              const key = `${g.zone}|${r.side}`, sel = p.selected.includes(g.zone), drill = open.has(key) && !!g.dv;
              const out = [
                <tr key={key} className={`${i === 0 ? "first" : ""}${sel ? " sel" : ""}${g.dv ? " drillable" : ""}`}
                  onClick={(e) => p.onSelect(g.zone, e.metaKey || e.ctrlKey)} onDoubleClick={() => g.dv && toggle(key)}
                  title={g.dv ? (drill ? "double-click to roll the degrees up" : `double-click to drop the ${r.side} hours by whole ${du} of divergence`) : "run again for the drill-down by degree"}>
                  <td className="zoneCell">{i === 0 && <><b>{g.zone}</b><span className="spaces">{g.spaces.join(", ")}</span></>}</td>
                  <td className={r.side === "heating" ? "heat" : "cool"}>{g.dv ? (drill ? "▾ " : "▸ ") : ""}{r.side}</td>
                  <td className="num">{temp(r.setC)}</td>
                  {byMonth && ms.map((m, k) => <td key={k} className={`num${(r.months?.[k] ?? 0) >= 0.05 ? " hit" : ""}`} onClick={() => hourly && p.onMonth(m.a)}>{hrs(r.months?.[k] ?? 0)}</td>)}
                  <td className="num"><b>{hrs(r.total)}</b></td>
                </tr>,
              ];
              if (drill && g.dv) for (const bin of binsOf(g.dv, r.side, ms, degScale)) out.push(
                <tr key={`${key}|${bin.from}`} className={`bin ${r.side === "heating" ? "heat" : "cool"}`} onDoubleClick={() => toggle(key)} onClick={(e) => p.onSelect(g.zone, e.metaKey || e.ctrlKey)}>
                  <td /><td className="binLabel" colSpan={2}>{bin.from === 0 ? `under 1 ${du}` : `${bin.from}–${bin.from + 1} ${du}`} {r.side === "heating" ? "too cold" : "too hot"}</td>
                  {ms.map((m, k) => <td key={k} className={`num${bin.months[k]! >= 0.05 ? " hit" : ""}`} onClick={() => p.onMonth(m.a)}>{hrs(bin.months[k]!)}</td>)}
                  <td className="num">{hrs(bin.year)}</td>
                </tr>);
              return out;
            }))}
          </tbody>
        </table>
      )}
      {hit.length > 0 && <div className="runGraphNote">Σ over the zones listed: heating {hrs(sum("heating")) || "0"} h · cooling {hrs(sum("cooling")) || "0"} h — zone-hours, not the facility's (the engine's facility count is {bem.facility.unmetHeatingH.toFixed(1)} h heating · {bem.facility.unmetCoolingH.toFixed(1)} h cooling, occupied hours with any zone unmet). A degree band holds the hours whose MEAN air missed the setpoint by that much; "under 1" also holds hours the engine counts as not met inside the hour while the hour's mean stood on the setpoint's right side.</div>}
      {met.length > 0 && <div className="runGraphNote">met every hour: {met.join(", ")}</div>}
    </div>
  );
}
