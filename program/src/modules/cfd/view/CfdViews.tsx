// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// BOM › CFD's frame (under the view) and column (right): what cfd.db holds for the run picked — the frame the room's
// air drawn as slices, the speeds and the openings' flows, each its own tab; the column the room's assessment, every
// number with the limit it is read against.

import { useEffect, useRef, type ReactNode } from "react";
import type { Metric, Slice } from "../core/cfdMetrics.js";
import type { OpeningRow, RunRow } from "../core/cfdDb.js";
import { fmtTemp } from "../../bem/view/bemUi.js";

export type CfdFrameTab = "SUPPLY AIR" | "SECTION" | "PLAN 0.1 m" | "PLAN 1.1 m" | "SPEEDS" | "OPENINGS";
export const CFD_FRAME_TABS: CfdFrameTab[] = ["SUPPLY AIR", "SECTION", "PLAN 0.1 m", "PLAN 1.1 m", "SPEEDS", "OPENINGS"];
export type SliceField = "T" | "speed" | "age";

export interface CfdShown { run: RunRow; metrics: Metric[]; openings: OpeningRow[]; slices: Slice[]; walls: Array<{ name: string; area: number; tC: number | null; heatW: number | null }> }

/** a metric's value in the user's units */
export function fmtMetric(m: { value: number; unit: string }, imperial: boolean): string {
  const v = m.value;
  if (!Number.isFinite(v)) return "—";
  switch (m.unit) {
    case "°C": return fmtTemp(v, imperial, imperial ? 1 : 2);
    case "K": return imperial ? `${(v * 1.8).toFixed(2)} °F` : `${v.toFixed(2)} K`;
    case "m/s": return imperial ? `${(v * 196.85).toFixed(0)} fpm` : `${v.toFixed(3)} m/s`;
    case "s": return `${(v / 60).toFixed(1)} min`;
    case "cfm": return imperial ? `${v.toFixed(1)} cfm` : `${(v * 0.471947).toFixed(1)} L/s`;
    case "m³": return imperial ? `${(v * 35.3147).toFixed(0)} ft³` : `${v.toFixed(1)} m³`;
    case "%": return `${v.toFixed(1)} %`;
    case "": return Number.isInteger(v) ? v.toLocaleString() : v.toFixed(2);
    default: return `${v.toFixed(2)} ${m.unit}`;
  }
}

const RAMP: Record<SliceField, Array<[number, number, number]>> = {
  T: [[44, 111, 214], [242, 242, 242], [216, 64, 42]],
  speed: [[68, 1, 84], [33, 145, 140], [253, 231, 37]],
  age: [[252, 253, 191], [183, 55, 121], [0, 0, 4]],
};
function ramp(f: SliceField, t: number): [number, number, number] {
  const r = RAMP[f], x = Math.min(1, Math.max(0, t)) * (r.length - 1), i = Math.min(r.length - 2, Math.floor(x)), u = x - i;
  return [0, 1, 2].map((k) => Math.round(r[i]![k]! + (r[i + 1]![k]! - r[i]![k]!) * u)) as [number, number, number];
}

function sliceRange(s: Slice, f: SliceField): [number, number] {
  const a = f === "T" ? s.T : f === "speed" ? s.speed : s.age;
  let lo = Infinity, hi = -Infinity;
  for (const v of a) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (f === "speed") return [0, Math.min(hi, 0.5)];
  return [lo, hi];
}

function SliceImage({ s, field, imperial, picker }: { s: Slice; field: SliceField; imperial: boolean; picker: ReactNode }): ReactNode {
  const ref = useRef<HTMLCanvasElement>(null);
  const [lo, hi] = sliceRange(s, field);
  // the section reads with the drawing's north (the model's −z) at the left, as the Bed 1 report drew it; a plan with north up
  // u runs left to right as stored (a section's z: drawing north, the model's −z, at the left; a plan's x: east at the right);
  // a section's v is up, a plan's v is z — drawn with north (−z) at the top
  const flipU = false, flipV = s.axis === 1;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = s.nu; c.height = s.nv;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(s.nu, s.nv);
    const a = field === "T" ? s.T : field === "speed" ? s.speed : s.age;
    for (let b = 0; b < s.nv; b++) for (let u = 0; u < s.nu; u++) {
      const v = a[b * s.nu + u]!;
      const px = flipU ? s.nu - 1 - u : u, py = flipV ? b : s.nv - 1 - b;
      const o = 4 * (py * s.nu + px);
      if (!Number.isFinite(v)) { img.data[o + 3] = 0; continue; }
      const [r, g, bl] = ramp(field, (v - lo) / (hi - lo || 1));
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = bl; img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [s, field, lo, hi, flipU, flipV]);
  const fmt = (v: number): string => (field === "T" ? fmtTemp(v, imperial) : field === "speed" ? fmtMetric({ value: v, unit: "m/s" }, imperial) : `${(v / 60).toFixed(1)} min`);
  const axisName = (a: number): string => (a === 0 ? "east →" : a === 1 ? "up ↑" : "north");
  return (
    <div className="cfdSlice">
      <div className="cfdSliceSide">
        {picker}
        <div className="cfdLegend">
          <span>{fmt(lo)}</span>
          <div className={`cfdRamp cfdRamp-${field}`} />
          <span>{fmt(hi)}{field === "speed" ? " and over" : ""}</span>
        </div>
        <div className="muted">{s.axis === 1 ? `plan at ${s.plane.replace("plan ", "")} above the floor · north up` : `section across the room through the supply openings (${s.axis === 0 ? "x" : "z"} ${s.at.toFixed(2)} m) · drawing north at left`} · the 5 cm grid the arrows were traced on</div>
      </div>
      <canvas ref={ref} style={{ aspectRatio: `${s.nu} / ${s.nv}` }} />
    </div>
  );
}

export function CfdFrame({ shown, tab, onTab, field, onField, imperial, supply }: { shown: CfdShown | null; tab: CfdFrameTab; onTab: (t: CfdFrameTab) => void; field: SliceField; onField: (f: SliceField) => void; imperial: boolean; supply: ReactNode }): ReactNode {
  const slice = shown?.slices.find((s) => (tab === "SECTION" ? s.plane === "section" : s.plane === tab.toLowerCase()));
  return (
    <div className="asmBench zoneFrame cfdFrame">
      <div className="asmRail">
        {CFD_FRAME_TABS.map((t) => <button key={t} className={`asmRailBtn${tab === t ? " on" : ""}`} onClick={() => onTab(t)}>{t}</button>)}
      </div>
      <div className="cfdFrameBody">
        {tab === "SUPPLY AIR" && supply}
        {!shown && tab !== "SUPPLY AIR" && <div className="muted">no run of this space — a space marked ↑H / ↓C in LEVELS · SPACES has results; click a space with no run to set it up</div>}
        {shown && slice && (
          <SliceImage s={slice} field={field} imperial={imperial} picker={
            <div className="cfdFieldPick">
              {(["T", "speed", "age"] as SliceField[]).map((f) => <button key={f} className={field === f ? "on" : ""} onClick={() => onField(f)}>{f === "T" ? "temperature" : f === "speed" ? "air speed" : "age of air"}</button>)}
            </div>} />
        )}
        {shown && tab === "SPEEDS" && shown.run.speedHist && <SpeedBars hist={shown.run.speedHist} imperial={imperial} />}
        {shown && tab === "OPENINGS" && <OpeningBars openings={shown.openings} imperial={imperial} />}
      </div>
    </div>
  );
}

function SpeedBars({ hist, imperial }: { hist: { edges: number[]; pct: number[] }; imperial: boolean }): ReactNode {
  const max = Math.max(...hist.pct, 1);
  const lab = (v: number): string => (v > 100 ? "" : imperial ? `${(v * 196.85).toFixed(0)}` : v.toFixed(2));
  return (
    <div className="cfdBars">
      <div className="muted">share of the occupied zone's volume by air speed ({imperial ? "fpm" : "m/s"}) — the line at 0.2 m/s</div>
      {hist.pct.map((p, i) => (
        <div key={i} className={`cfdBar${hist.edges[i]! >= 0.2 ? " over" : ""}`}>
          <span className="cfdBarLab">{lab(hist.edges[i]!)}{hist.edges[i + 1]! > 100 ? " +" : `–${lab(hist.edges[i + 1]!)}`}</span>
          <span className="cfdBarFill" style={{ width: `${(100 * p) / max}%` }} />
          <span className="cfdBarVal">{p.toFixed(1)} %</span>
        </div>
      ))}
    </div>
  );
}

function OpeningBars({ openings, imperial }: { openings: OpeningRow[]; imperial: boolean }): ReactNode {
  const max = Math.max(...openings.map((o) => o.cfm), 1);
  return (
    <div className="cfdBars">
      <div className="muted">the air through each opening — in (the supplies) and out; "reached" is the supply air whose streamline ends there within 40 m</div>
      {openings.map((o) => (
        <div key={o.name} className={`cfdBar ${o.dir}`}>
          <span className="cfdBarLab">{o.name} · {o.dir}</span>
          <span className="cfdBarFill" style={{ width: `${(100 * o.cfm) / max}%` }} />
          <span className="cfdBarVal">{fmtMetric({ value: o.cfm, unit: "cfm" }, imperial)}{o.tC != null ? ` · ${fmtTemp(o.tC, imperial)}` : ""}{o.reachedCfm != null ? ` · reached ${fmtMetric({ value: o.reachedCfm, unit: "cfm" }, imperial)}` : ""}</span>
        </div>
      ))}
    </div>
  );
}

const GROUPS: Array<[Metric["group"], string]> = [["room", "THE ROOM"], ["air", "THE AIR"], ["comfort", "COMFORT (indicative)"], ["flows", "FLOWS"], ["run", "THE RUN"]];

export function CfdColumn({ shown, runs, imperial, onPick }: { shown: CfdShown | null; runs: RunRow[]; imperial: boolean; onPick: (id: number) => void }): ReactNode {
  if (!runs.length) return <div className="muted">cfd.db holds no runs yet. Click a space in LEVELS · SPACES to set it up</div>;
  if (!shown) return <div className="muted">pick a space marked ↑H / ↓C in LEVELS · SPACES, or click a space to set it up</div>;
  const r = shown.run;
  const same = runs.filter((x) => x.space === r.space && x.peak === r.peak);
  const s = r.settings as Record<string, unknown>;
  return (
    <div className="cfdColumn">
      <h4>{r.space} · {r.peak} peak{r.designHour ? ` · ${r.designHour}` : ""}</h4>
      {(() => { const a = shown.metrics.find((m) => m.key === "averaged_from"); return a?.verdict === "warn" ? <div className="cfdNotSettled">⚠ not converged — {Number.isFinite(a.value) ? `averaged from iteration ${a.value.toLocaleString()}` : "no average kept"}: {a.limit}</div> : null; })()}
      <div className="muted">
        {r.iteration ? `iteration ${r.iteration}` : ""}{r.averaged ? " · fields averaged over the run's last window" : ""} · {r.cells.toLocaleString()} cells · {new Date(r.stamp).toLocaleString()}
        {typeof s.supply_c === "number" ? ` · supply ${fmtTemp(s.supply_c, imperial)}` : ""}{typeof s.outdoor_c === "number" ? ` · outdoor ${fmtTemp(s.outdoor_c, imperial)}` : ""}
      </div>
      {same.length > 1 && (
        <select value={r.id} onChange={(e) => onPick(+e.target.value)} title="the earlier runs of this space and peak are kept">
          {same.map((x) => <option key={x.id} value={x.id}>run {x.id} · {new Date(x.stamp).toLocaleString()}</option>)}
        </select>
      )}
      {GROUPS.map(([g, head]) => {
        const ms = shown.metrics.filter((m) => m.group === g);
        if (!ms.length) return null;
        return (
          <table key={g} className="cfdMetrics">
            <thead><tr><th colSpan={2}>{head}</th></tr></thead>
            <tbody>
              {ms.map((m) => (
                <tr key={m.key} title={m.limit ?? undefined}>
                  <td>{m.label}</td>
                  <td className={`num${m.verdict ? ` v-${m.verdict}` : ""}`}>{fmtMetric(m, imperial)}{m.verdict === "warn" ? " ⚠" : m.verdict === "ok" ? " ✓" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      })}
      <table className="cfdMetrics">
        <thead><tr><th colSpan={2}>THE SURFACES (as the run held them)</th></tr></thead>
        <tbody>
          {shown.walls.map((w) => (
            <tr key={w.name}><td>{w.name.replace(/^[a-z0-9]+_(?=[a-z])/i, "")}</td><td className="num">{w.tC != null ? fmtTemp(w.tC, imperial) : "—"}{w.heatW != null ? ` · ${Math.round(w.heatW)} W` : ""}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="cfdLimits muted">
        <b>What the run leaves out</b>: people, lights, equipment and infiltration (no gains in the room's air); the walls held at the
        EnergyPlus inside surface temperatures of the design hour; a steady solve averaged over its last iterations, not a transient.
        PMV/PPD are for a seated, awake person in 1 clo — indicative only for a sleeper.
        {r.ends ? ` Streamlines: ${r.lines ?? 0} traced, ${r.ends.out ?? 0} reached an outlet, ${r.ends.recirculating ?? 0} still circulating at 40 m, ${r.ends.stall ?? 0} stalled, ${r.ends.wall ?? 0} cornered.` : ""}
      </div>
    </div>
  );
}
