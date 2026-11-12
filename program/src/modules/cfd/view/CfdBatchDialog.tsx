// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// RUN SEVERAL ROOMS (the user, 2026-11-04: "a need for full project (or a subset) analysis to be conducted as multiple rooms
// conducted in parallel"): every room of the model, each with the setup made for it in Set up and run CFD… (its terminals' roles and
// flows, its doors — only the user can say those, so a room never set up is listed and not run), the peaks picked, and the plan
// for this machine — how many rooms side by side, how many processes each, about how long. The runs go to OpenFOAM together; the
// runner holds each until its processes fit.

import { useMemo, useState, type ReactNode } from "react";
import type { CfdOffer } from "../core/cfdPrep.js";
import type { RoomFace } from "../core/cfdCase.js";
import { casesFrom, choicesFor, estimateCells, type CfdCase } from "../core/cfdChoices.js";
import { usableCores, type Machine, type Plan } from "../core/cfdParallel.js";
import { loadChoices } from "./cfdChoicesStore.js";
import { useProcessorChoice } from "./CfdProcessors.js";

export interface BatchJob { space: string; case: CfdCase; cells: number }
interface Row { space: string; faces: RoomFace[]; why: string | null; cases: CfdCase[]; cells: number; setUp: boolean }

export function CfdBatchDialog({ inline, rooms, idf, offerOf, engine, machine, onRun, onCancel, onSetUp }: {
  /** drawn in the frame below the view (2026-11-11: the spaces picked with Spaces · Select), not as a dialog */
  inline?: boolean;
  rooms: Array<{ space: string; faces: RoomFace[] }>;
  idf: string;
  offerOf: (space: string, faces: RoomFace[]) => CfdOffer;
  engine: { exe: string | null; version: string | null; why: string | null } | null;
  machine: Machine | null;
  onRun: (jobs: BatchJob[], plan: Plan) => void;
  onCancel: () => void;
  onSetUp: (space: string) => void;
}): ReactNode {
  const [peaks, setPeaks] = useState<Record<string, boolean>>({ heating: true, cooling: true });
  const [procs, setProcs] = useState<number | null>(null);
  const offers = useMemo(() => new Map(rooms.map((r) => [r.space, offerOf(r.space, r.faces)])), [rooms, offerOf]);
  const rows: Row[] = useMemo(() => rooms.map((r) => {
    const offer = offers.get(r.space)!, saved = loadChoices(r.space);
    // A ROOM WITH NO MEP TERMINAL is set up like any other (2026-11-12): its terminals are placed by hand on its plan
    if (!saved) return { space: r.space, faces: r.faces, why: offer.terminals.length ? "not set up — set it up once (Set up…, or click it in the left column)" : "not set up — the MEP file places no air terminal in it: place them on its plan (Set up…)", cases: [], cells: 0, setUp: false };
    const ch = choicesFor(offer, saved);
    const cases = casesFrom(offer, ch, { space: r.space, faces: offer.faces, idf }, peaks);
    const ref = [...offer.refusals, ...cases.flatMap((c) => c.out.refusals.map((x) => `${c.peak}: ${x}`))];
    return { space: r.space, faces: r.faces, why: ref[0] ?? (cases.length ? null : "no design peak picked that bem.db holds"), cases, cells: estimateCells(offer.faces, ch.meshM), setUp: true };
  }).sort((a, b) => Number(!!a.why) - Number(!!b.why) || a.space.localeCompare(b.space)), [rooms, offers, peaks, idf]);
  const ready = rows.filter((r) => !r.why);
  const [pick, setPick] = useState<Record<string, boolean>>(() => Object.fromEntries(ready.map((r) => [r.space, true])));
  const jobs: BatchJob[] = ready.filter((r) => pick[r.space] ?? true).flatMap((r) => r.cases.map((c) => ({ space: r.space, case: c, cells: r.cells })));
  const { node: procNode, plan } = useProcessorChoice({ machine, jobs: jobs.map((j) => ({ key: `${j.space} · ${j.case.peak}`, cells: j.cells, iterations: j.case.input.iterations ?? 11000 })), procs, onProcs: setProcs });
  const engineWhy = engine && !engine.exe ? engine.why ?? "OpenFOAM not found" : null;
  // MORE RUNS THAN PROCESSORS (2026-11-11, the user: "if selected spaces exceed available processors, then note serial processing
  // is required"): every run takes at least one process, so the runs past the machine's usable processors wait their turn
  const cores = machine ? usableCores(machine) : null;
  const spaces = new Set(jobs.map((j) => j.space)).size;
  const serial = cores != null && jobs.length > cores
    ? `${spaces} space${spaces === 1 ? "" : "s"} selected (${jobs.length} runs) exceed the ${cores} processors available — serial processing is required: ${cores} run at a time at most, one process each, the rest wait their turn`
    : null;
  const body = (
      <>
        {!inline && <div className="dialogHead">Run CFD · several rooms</div>}
        <div className="muted">each space with the choices last made in its setup — a space not yet set up is listed and left out</div>

        <div className="dialogHead">THE PEAKS</div>
        <div className="cfdRow">
          {(["heating", "cooling"] as const).map((pk) => <label key={pk}><input type="checkbox" checked={peaks[pk]} onChange={(e) => setPeaks({ ...peaks, [pk]: e.target.checked })} /> {pk} </label>)}
        </div>

        <div className="dialogHead">THE ROOMS <span className="muted">— {ready.length} ready of {rows.length}</span>
          {ready.length > 0 && <> · <button className="qaBtn" onClick={() => setPick(Object.fromEntries(ready.map((r) => [r.space, true])))}>all</button> <button className="qaBtn" onClick={() => setPick(Object.fromEntries(ready.map((r) => [r.space, false])))}>none</button></>}
        </div>
        <div className="cfdBatchList">
          {rows.map((r) => (
            <div key={r.space} className={`cfdRow${r.why ? " off" : ""}`}>
              <input type="checkbox" disabled={!!r.why} checked={!r.why && (pick[r.space] ?? true)} onChange={(e) => setPick({ ...pick, [r.space]: e.target.checked })} />
              <b>{r.space}</b>
              {r.why
                ? <span className="muted"> · {r.why}{r.setUp || r.why.startsWith("not set up") ? <> · <button className="qaBtn" onClick={() => onSetUp(r.space)}>Set up…</button></> : null}</span>
                : <span className="muted"> · {r.cases.map((c) => c.peak).join(" + ")} · about {r.cells.toLocaleString()} cells · {(r.cases[0]!.input.iterations ?? 11000).toLocaleString()} iterations</span>}
            </div>
          ))}
        </div>

        <div className="dialogHead">THE PROCESSORS <span className="muted">— {jobs.length} run{jobs.length === 1 ? "" : "s"}: one room on many processors, several side by side, or serial</span></div>
        {serial && <div className="cfdCaution">⚠ {serial}</div>}
        {procNode}
        {engineWhy && <div className="cfdRefusals"><div>✗ {engineWhy}</div></div>}
        <div className="allRow cfdButtons">
          <button className="qaBtn" onClick={onCancel}>Cancel</button>
          <button className="qaBtn cfdGo" disabled={!jobs.length || !!engineWhy} onClick={() => plan ? onRun(jobs, plan) : onRun(jobs, { slots: 1, procs: 1, jobs: jobs.map((j, i) => ({ key: String(i), procs: 1, slot: 0, seconds: 0 })), seconds: 0, memGB: 0, notes: [] })}>Run {jobs.length} case{jobs.length === 1 ? "" : "s"}</button>
        </div>
      </>
  );
  if (inline) return <div className="cfdBatchFrame">{body}</div>;
  return (
    <div className="menuScrim dialogScrim" onPointerDown={onCancel}>
      <div className="dialog cfdDialog" role="dialog" aria-label="run CFD in several rooms" onPointerDown={(e) => e.stopPropagation()}>{body}</div>
    </div>
  );
}
