// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE PROCESSORS, AS CHOICES (the user, 2026-11-10: "offering up to the user to conduct single room parallel processing or
// multiple rooms parallel processing (using 1 or more processors per room)"): this machine read, then every way to spend its
// cores on the runs asked for — one room split across many, several side by side on a share each, or serial — each with about
// how long it takes, the suggestion marked, a share typed if none of them fits. The times are Bed 1's on the M5 Ultra
// (2026-11-04) until this machine has finished a run, then corrected by its own (cfdParallel.machineFactor).

import { useState, type ReactNode } from "react";
import { machineFactor, machineLine, planOptions, usableCores, type Job, type Machine, type Plan, type Timing } from "../core/cfdParallel.js";

const TIMINGS = "bim-cfd-timings";
/** this machine's finished runs (this window's storage: a machine's own measurement, nothing a project needs) */
export function loadTimings(): Timing[] { try { const t = window.localStorage.getItem(TIMINGS); return t ? (JSON.parse(t) as Timing[]) : []; } catch { return []; } }
export function addTiming(t: Timing): void { try { window.localStorage.setItem(TIMINGS, JSON.stringify([...loadTimings(), t].slice(-20))); } catch { /* a convenience */ } }

/** minutes in words */
export const fmtMinutes = (s: number): string => (s < 90 ? `${Math.max(1, Math.round(s / 60))} min` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);

/** where the times come from, in words */
export function timingWords(): string {
  const { factor, runs } = machineFactor(loadTimings());
  return runs
    ? `times from this machine's own ${runs} finished run${runs === 1 ? "" : "s"} (×${factor.toFixed(2)} on the reference measurement, a 110 m³ bedroom)`
    : "times scaled from a measured 110 m³ bedroom on a 30-core Mac (2026-11-04) — this machine's first finished run corrects them";
}

export function useProcessorChoice({ machine, jobs, procs, onProcs }: {
  machine: Machine | null;
  jobs: Job[];
  /** the share picked, or null for the suggestion */
  procs: number | null;
  onProcs: (n: number | null) => void;
}): { node: ReactNode; plan: Plan | null } {
  const [typed, setTyped] = useState("");
  if (!machine) return { node: <div className="muted">the machine could not be read — the runs go serial, one at a time</div>, plan: null };
  if (!jobs.length) return { node: <div className="muted">this machine: {machineLine(machine)} · pick what to run first</div>, plan: null };
  const { factor } = machineFactor(loadTimings());
  const opts = planOptions(machine, jobs, factor);
  const chosen = opts.find((o) => (procs == null ? o.suggested : o.procs === procs));
  // a share typed that is not one of the choices still plans
  const plan = chosen?.plan ?? opts.find((o) => o.suggested)!.plan;
  const custom = procs != null && !opts.some((o) => o.procs === procs);
  const node = (
    <>
      <div className="muted">this machine: {machineLine(machine)} · {timingWords()}</div>
      <table className="cfdPlans">
        <tbody>
          {opts.map((o) => (
            <tr key={o.procs} className={(procs == null ? o.suggested : o.procs === procs) ? "on" : ""} onClick={() => onProcs(o.suggested ? null : o.procs)}>
              <td><input type="radio" readOnly checked={procs == null ? o.suggested : o.procs === procs} /></td>
              <td>{o.words}</td>
              <td className="num">about {fmtMinutes(o.plan.seconds)}</td>
              <td className="muted">{o.suggested ? "suggested" : ""}{o.plan.notes.length ? ` · ${o.plan.notes.join(" · ")}` : ""}</td>
            </tr>
          ))}
          <tr className={custom ? "on" : ""}>
            <td><input type="radio" readOnly checked={custom} /></td>
            <td colSpan={3}>
              another share: <input className="num" value={custom ? String(procs) : typed} placeholder="n" onChange={(e) => {
                setTyped(e.target.value);
                const n = Math.round(+e.target.value);
                if (n >= 1) onProcs(Math.min(usableCores(machine), n));
              }} /> processes per run{custom ? ` · ${plan.slots} at a time · about ${fmtMinutes(plan.seconds)}` : ""}
            </td>
          </tr>
        </tbody>
      </table>
    </>
  );
  return { node, plan };
}
