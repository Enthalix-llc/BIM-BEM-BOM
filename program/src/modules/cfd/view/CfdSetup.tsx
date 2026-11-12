// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// A ROOM SET UP FOR CFD, ON ITS PLAN (the user, 2026-11-10: "we need a plan view when cfd is set up for a space so we can identify
// where the terminals are located, and provide a way to add terminals (floor/wall/ceiling) and set their airflows … use the central
// view when a space is set for cfd for the floor plan, and the frame below the view for setting the other items"). The room drawn
// from above, to scale, north up — its walls, doors, the terminals of the MEP file and the ones added, each at its size, coloured
// by role, named and labelled with its flow; a terminal past a wall drawn red. Floor and ceiling terminals are added by a click on
// the plan, wall terminals on the wall's elevation (opened by clicking the wall); a terminal is dragged to move it, right-clicked to
// remove (an added one) or switch off (the file's). The frame below holds the rest, tab by tab. Everything is saved as it is set,
// into the project's BOM ledger (cfdChoicesStore.ts).

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CfdOffer, TerminalOffer } from "../core/cfdPrep.js";
import { terminalBox, wallClearance, faceLabel, touchesRoom } from "../core/cfdPrep.js";
import type { RoomFace, TerminalRole, DoorMode } from "../core/cfdCase.js";
import { addedAsOffer, casesFrom, choicesFor, estimateCells, fromTemp, STOP_CHOICE_DEFAULT, type FromChoice, type AddedTerminal, type CfdCase, type CfdChoices, type StopChoice, type TermChoice } from "../core/cfdChoices.js";
import type { Machine } from "../core/cfdParallel.js";
import { loadChoices, saveChoices } from "./cfdChoicesStore.js";
import { useProcessorChoice } from "./CfdProcessors.js";
import { fmtPower, fmtTemp, NumInput } from "../../bem/view/bemUi.js";
import { CfdSetup3d } from "./CfdSetup3d.js";
/** the air LEAVING the room is negative (the user, 2026-11-10: "exhaust and return air flows should be negative") */
const OUTWARD = (r: string): boolean => r === "return" || r === "exhaust";
import { addTerminal, axisOf, editTerminal, hostOf, ROLE_COLOUR, ROLE_WORD, roleWords, wallSize, wallWH, type Host } from "./cfdSetupShared.js";

type V3 = [number, number, number];
const IN = 0.0254;

/** one terminal as the plan and the table see it — the file's or an added one */
export interface SetupTerminal {
  key: string; source: "file" | "added"; name: string; label: string; role: TerminalRole | ""; cfm: number | null; use: boolean; from: FromChoice;
  face: number; host: Host; box: { lo: V3; hi: V3 }; size: [number, number]; offer: TerminalOffer;
}

export interface CfdSetupIn { space: string; faces: RoomFace[]; idf: string; offer: CfdOffer; engine: { exe: string | null; version: string | null; why: string | null } | null; machine: Machine | null }

/** THE SETUP'S STATE, shared by the plan (the view) and the frame: the choices, saved into the ledger at every change */
export function useCfdSetup(inp: CfdSetupIn | null) {
  // THE CHOICES ARE THE ROOM'S THEY WERE READ FOR (2026-11-11, the user: switching Bed 1 ↔ Great crashed the program): the first
  // render after a room change still held the other room's choices, and its terminals read a term that is not there. Each set is
  // kept with the input it was read for, and a render for another input reads none until its own are read.
  const [held, setHeld] = useState<{ inp: CfdSetupIn; c: CfdChoices } | null>(null);
  const choices = held && held.inp === inp ? held.c : null;
  const setChoices = (f: (c: CfdChoices | null) => CfdChoices | null): void => setHeld((h) => { if (!h || h.inp !== inp) return h; const n = f(h.c); return n ? { inp: h.inp, c: n } : null; });
  const [peaks, setPeaks] = useState<Record<string, boolean>>({ heating: true, cooling: true });
  const [procs, setProcs] = useState<number | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => { setHeld(inp ? { inp, c: choicesFor(inp.offer, loadChoices(inp.space) ?? {}) } : null); setSel(null); setProcs(null); }, [inp]);
  const update = (f: (c: CfdChoices) => CfdChoices): void => setChoices((c) => { if (!c || !inp) return c; const n = f(c); saveChoices(inp.space, n); return n; });
  const terminals: SetupTerminal[] = useMemo(() => {
    if (!inp || !choices) return [];
    const file = inp.offer.terminals.map((t): SetupTerminal | null => {
      const c = choices.terms[String(t.id)];
      if (!c) return null;
      const face = c.face ?? t.face;
      return { key: `f${t.id}`, source: "file", name: t.name, label: c.label?.trim() || t.name, role: c.role, cfm: c.cfm, use: c.use, from: { from: c.from, fromC: c.fromC }, face, host: hostOf(inp.faces[face]), box: terminalBox(t, c.size, c.nudge, inp.faces, c.face), size: c.size, offer: t };
    });
    const added = (choices.added ?? []).map((a): SetupTerminal => {
      const o = addedAsOffer(a, inp.faces);
      return { key: a.id, source: "added", name: a.label, label: a.label, role: a.role, cfm: a.cfm, use: a.use, from: { from: a.from, fromC: a.fromC }, face: a.face, host: a.host, box: terminalBox(o, a.size, [0, 0, 0], inp.faces, a.face), size: a.size, offer: o };
    });
    return [...file.filter((t): t is SetupTerminal => t != null), ...added];
  }, [inp, choices]);
  const cases: CfdCase[] = useMemo(() => (inp && choices ? casesFrom(inp.offer, choices, { space: inp.space, faces: inp.faces, idf: inp.idf }, peaks) : []), [inp, choices, peaks]);
  const refusals = inp ? [...inp.offer.refusals, ...(inp.engine && !inp.engine.exe ? [inp.engine.why ?? "OpenFOAM not found"] : []), ...cases.flatMap((c) => c.out.refusals.map((r) => `${c.peak}: ${r}`))] : [];
  const cells = inp && choices ? estimateCells(inp.faces, choices.meshM) : 0;
  // EACH TERMINAL'S OWN ISSUES (2026-11-11, the user: "The 'Not ready to run' issues need to be shown on the Terminals subtab …
  // red line outline for the terminals with issues (with hover tooltip explaining the issue)"): the run's refusals that name the
  // terminal (each case names it by its label), said once when both peaks say the same, and a supply left on with no flow —
  // which the run leaves out without a word
  const issues = new Map<string, string[]>();
  for (const t of terminals) {
    const name = t.label.trim() || t.key, said = new Map<string, string[]>();
    for (const c of cases) for (const r of c.out.refusals) if (r.startsWith(`${name}:`) || r.startsWith(`${name} does not touch`)) said.set(r, [...(said.get(r) ?? []), c.peak]);
    const list = [...said].map(([r, pk]) => (pk.length < cases.length ? `${pk.join(" + ")}: ${r}` : r));
    if (t.use && t.role === "supply" && !((t.cfm ?? 0) > 0)) list.push(`${name}: a supply with no flow is left out of the run — type its flow, or switch it off`);
    if (list.length) issues.set(t.key, list);
  }
  return { inp, choices, update, peaks, setPeaks, procs, setProcs, sel, setSel, terminals, cases, refusals, cells, issues };
}
export type CfdSetupState = ReturnType<typeof useCfdSetup>;


/** the point on a face's plane under a plan point (x, z) — y solved from the plane */
function onFace(f: RoomFace, x: number, z: number): V3 {
  const o = f.outer[0]!;
  const y = Math.abs(f.n[1]) > 1e-6 ? o[1] - (f.n[0] * (x - o[0]) + f.n[2] * (z - o[2])) / f.n[1] : o[1];
  return [x, y, z];
}
function inPlan(f: RoomFace, x: number, z: number): boolean {
  let inside = false; const r = f.outer;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = [r[i]![0], r[i]![2]], [xj, zj] = [r[j]![0], r[j]![2]];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
/** a wall face's plan segment */
function wallSeg(f: RoomFace): [[number, number], [number, number]] {
  const t = [-f.n[2], f.n[0]], us = f.outer.map((p) => p[0] * t[0]! + p[2] * t[1]!);
  const i0 = us.indexOf(Math.min(...us)), i1 = us.indexOf(Math.max(...us));
  return [[f.outer[i0]![0], f.outer[i0]![2]], [f.outer[i1]![0], f.outer[i1]![2]]];
}
const distSeg = (p: [number, number], [a, b]: [[number, number], [number, number]]): number => {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
};


/** THE PLAN — the view while a room is set up */
export function CfdSetupPlan({ s, imperial }: { s: CfdSetupState; imperial: boolean }): ReactNode {
  const [tool, setTool] = useState<"select" | Host | "path">("select");
  // PLAN OR 3-D (2026-11-10, the user: "Can we use a 3d model for locating the terminals?") — remembered, the plan kept
  const [in3d, setIn3d] = useState<boolean>(() => { try { return localStorage.getItem("bim-cfd-setup-3d") === "1"; } catch { return false; } });
  const show3d = (on: boolean): void => { setIn3d(on); setWallFace(null); try { localStorage.setItem("bim-cfd-setup-3d", on ? "1" : "0"); } catch { /* view state only */ } };
  const [wallFace, setWallFace] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ key: string; x: number; z: number } | null>(null);
  const inp = s.inp, ch = s.choices;
  if (!inp || !ch) return <div className="cfdPlanEmpty muted">click a space in LEVELS · SPACES to set it up</div>;
  const faces = inp.faces;
  const pts = faces.flatMap((f) => f.outer);
  const x0 = Math.min(...pts.map((p) => p[0])) - 0.6, x1 = Math.max(...pts.map((p) => p[0])) + 0.6;
  const z0 = Math.min(...pts.map((p) => p[2])) - 0.6, z1 = Math.max(...pts.map((p) => p[2])) + 0.6;
  const floorY = Math.min(...faces.filter((f) => hostOf(f) === "floor").flatMap((f) => f.outer.map((p) => p[1])));
  const len = (m: number): string => (imperial ? `${(m / 0.3048).toFixed(1)} ft` : `${m.toFixed(2)} m`);
  const flow = (c: number | null): string => (c == null ? "free" : imperial ? `${c.toFixed(0)} cfm` : `${(c * 0.471947).toFixed(0)} L/s`);
  const toPlan = (e: { clientX: number; clientY: number }): [number, number] => {
    const el = svg.current!, m = el.getScreenCTM()!.inverse(), p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
    return [p.x, p.y];
  };
  const fs = 0.14; // the label size, m
  // red: past a wall, or touching no face of the room at all (an opening onto nothing — 2026-11-10)
  const offFace = (t: SetupTerminal): boolean => t.use && !touchesRoom(faces, t.box);
  const outside = (t: SetupTerminal): boolean => {
    if (offFace(t)) return true;
    if (t.host === "wall") return false;
    const cl = wallClearance(faces, t.box);
    return Object.values(cl).some((v) => v != null && v < -0.005);
  };
  const add = (host: Host, face: number, c: V3): void => addTerminal(s, faces, host, face, c);
  const click = (e: React.MouseEvent): void => {
    if (drag.current) return;
    const [x, z] = toPlan(e);
    if (tool === "floor" || tool === "ceiling") {
      // the face under the point: a floor face, or the LOWEST ceiling or roof over it (a stepped ceiling has several)
      const cands = faces.map((f, i) => ({ f, i })).filter(({ f }) => hostOf(f) === tool && inPlan(f, x, z));
      const pick = tool === "floor" ? cands[0] : cands.sort((a, b) => onFace(a.f, x, z)[1] - onFace(b.f, x, z)[1])[0];
      if (pick) add(tool, pick.i, onFace(pick.f, x, z));
      return;
    }
    if (tool === "wall") {
      const walls = faces.map((f, i) => ({ f, i })).filter(({ f }) => hostOf(f) === "wall").map((w) => ({ ...w, d: distSeg([x, z], wallSeg(w.f)) })).sort((a, b) => a.d - b.d);
      if (walls[0] && walls[0].d < 0.5) setWallFace(walls[0].i);
      return;
    }
    s.setSel(null);
  };
  const down = (e: React.PointerEvent, t: SetupTerminal): void => {
    if (e.button !== 0) return;
    e.stopPropagation();
    s.setSel(t.key);
    if (tool !== "select") return;
    const [x, z] = toPlan(e);
    drag.current = { key: t.key, x, z };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const move = (e: React.PointerEvent): void => {
    const d = drag.current;
    if (!d) return;
    const [x, z] = toPlan(e);
    let dx = x - d.x, dz = z - d.z;
    const t = s.terminals.find((q) => q.key === d.key);
    if (!t || (Math.abs(dx) < 1e-4 && Math.abs(dz) < 1e-4)) return;
    if (t.host === "wall") { const f = faces[t.face]!, tx = -f.n[2], tz = f.n[0], along = dx * tx + dz * tz; dx = along * tx; dz = along * tz; }
    drag.current = { ...d, x, z };
    editTerminal(s, t.key, {
      file: (c) => ({ ...c, nudge: [c.nudge[0] + dx, c.nudge[1], c.nudge[2] + dz] }),
      added: (a) => { const f = faces[a.face]!; const p: V3 = a.host === "wall" ? [a.c[0] + dx, a.c[1], a.c[2] + dz] : onFace(f, a.c[0] + dx, a.c[2] + dz); return { ...a, c: p }; },
    });
  };
  const up = (): void => { window.setTimeout(() => { drag.current = null; }, 0); };
  const ctx = (e: React.MouseEvent, t: SetupTerminal): void => {
    e.preventDefault(); e.stopPropagation();
    if (t.source === "added") { if (window.confirm(`Remove "${t.label}"?`)) s.update((c) => ({ ...c, added: (c.added ?? []).filter((a) => a.id !== t.key) })); }
    else editTerminal(s, t.key, { file: (c) => ({ ...c, use: !c.use }) });
  };
  return (
    <div className="cfdSetupPlan">
      <div className="cfdPlanTools">
        <b>{inp.space}</b> ·
        <button className={in3d ? "" : "on"} onClick={() => show3d(false)} title="the room from above, north up, to scale">plan</button>
        <button className={in3d ? "on" : ""} onClick={() => show3d(true)} title="the room's own solid in 3-D, seen into from any side: click a face to add a terminal, drag one along its face">3-D</button> ·
        {in3d && <>
          <button className={tool === "select" ? "on" : ""} onClick={() => setTool("select")} title="click a terminal to select it, drag it along its face, right-click to remove an added one or switch off one of the file's">select / move</button>
          <button className={tool !== "select" && tool !== "path" ? "on" : ""} onClick={() => setTool("floor")} title="click any face of the room — floor, wall, sloped ceiling — to add a terminal there">+ on a face</button>
          <button className={tool === "path" ? "on" : ""} onClick={() => setTool("path")} title="an open path to another room — the top of a stair, an archway: click the face it opens in; it is free (air goes out or in as the pressure finds), its size yours to type in TERMINALS">+ open path</button>
        </>}
        {!in3d && (["select", "floor", "ceiling", "wall"] as const).map((k) => (
          <button key={k} className={tool === k ? "on" : ""} onClick={() => { setTool(k); if (k !== "wall") setWallFace(null); }}
            title={k === "select" ? "click a terminal to select it, drag to move it, right-click to remove an added one or switch off one of the file's" : k === "wall" ? "click a wall to open its elevation, then click where the grille goes" : `click the ${k} where the terminal goes`}>
            {k === "select" ? "select / move" : `+ ${k}`}
          </button>
        ))}
        <span className="muted"> · {s.terminals.filter((t) => t.use).length} terminals in use · drawn to scale</span>
        {inp.offer.enclosure && (() => {
          // THE ROOM ON THE IDF DB MODEL (2026-11-10): its enclosure in idf.db — closed, its volume beside the room the file draws
          const e = inp.offer.enclosure, vol = (m3: number): string => (imperial ? `${(m3 * 35.3147).toFixed(0)} ft³` : `${m3.toFixed(1)} m³`), ar = (m2: number): string => (imperial ? `${(m2 * 10.7639).toFixed(0)} ft²` : `${m2.toFixed(1)} m²`);
          if (e.refused) return <span className="cfdOnModel warn" title={`the room is used as the file draws it (its IfcSpace solid, as ruled): ${e.refused}`}> · the room as drawn — {e.refused}</span>;
          const share = e.areaM2 > 0 ? e.onRowsM2 / e.areaM2 : 0;
          const tip = [`the room's enclosure in idf.db: its own ${e.rows} surfaces (the room on one side), each at its element's room-side face — ${e.planes} planes, ${e.cells} cells`,
            `closed · ${vol(e.volumeM3)}; the room as the file draws it ${vol(e.drawnVolumeM3)}`,
            `of its ${ar(e.areaM2)} of surface: ${ar(e.onRowsM2)} on its own idf.db surfaces · ${ar(e.drawnM2)} on a face of the room as drawn, where the model draws none${e.boxM2 > 1e-3 ? ` · ${ar(e.boxM2)} on no plane` : ""} · the rest closes gaps between its surfaces, on their own planes`,
            ...e.notes].join("\n");
          return <span className={share < 0.75 ? "cfdOnModel warn" : "cfdOnModel"} title={tip}> · on the IDF DB model: closed · {vol(e.volumeM3)} <span className="muted">(as drawn {vol(e.drawnVolumeM3)})</span> · {Math.round(100 * share)} % on its own surfaces</span>;
        })()}
      </div>
      {in3d ? <div className="cfdPlanBody"><CfdSetup3d s={s} imperial={imperial} tool={tool === "select" ? "select" : tool === "path" ? "path" : "add"} /></div> : <div className="cfdPlanBody">
        <svg ref={svg} viewBox={`${x0} ${z0} ${x1 - x0} ${z1 - z0}`} preserveAspectRatio="xMidYMid meet" className={`cfdPlanSvg tool-${tool}`}
          onClick={click} onPointerMove={move} onPointerUp={up}>
          {/* the floor, the ceilings over it outlined, the walls as the room's edge */}
          {faces.map((f, i) => hostOf(f) === "floor" && <polygon key={`fl${i}`} points={f.outer.map((p) => `${p[0]},${p[2]}`).join(" ")} className="cfdFloor" />)}
          {faces.map((f, i) => hostOf(f) === "ceiling" && <polygon key={`ce${i}`} points={f.outer.map((p) => `${p[0]},${p[2]}`).join(" ")} className="cfdCeil" />)}
          {faces.map((f, i) => { if (hostOf(f) !== "wall") return null; const [a, b] = wallSeg(f); return <line key={`w${i}`} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className={`cfdWall${wallFace === i ? " on" : ""}`} />; })}
          {inp.offer.doors.map((d, i) => { const xs = d.quad.map((p) => p[0]), zs = d.quad.map((p) => p[2]); const c = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2]; const mode = ch.doors[String(d.elementId)]?.mode ?? "sealed";
            return <g key={`d${i}`}><line x1={Math.min(...xs)} y1={Math.min(...zs)} x2={Math.max(...xs)} y2={Math.max(...zs)} className={`cfdDoor ${mode}`} /><text x={c[0]} y={c[1]! - 0.08} fontSize={fs * 0.8} className="cfdPlanText muted">door · {mode}</text></g>; })}
          {s.terminals.map((t) => {
            const lo = t.box.lo, hi = t.box.hi, w = Math.max(0.04, hi[0] - lo[0]), h = Math.max(0.04, hi[2] - lo[2]);
            const bad = outside(t), on = s.sel === t.key, iss = s.issues.get(t.key);
            return (
              <g key={t.key} className={`cfdTerm ${t.host}${t.use ? "" : " off"}${on ? " sel" : ""}${bad ? " bad" : ""}${iss ? " issue" : ""}`} onPointerDown={(e) => down(e, t)} onContextMenu={(e) => ctx(e, t)}>
                {iss && <title>{iss.map((x) => `✗ ${x}`).join("\n")}</title>}
                <rect x={lo[0]} y={lo[2]} width={w} height={h} fill={ROLE_COLOUR[t.role]} />
                <text x={lo[0] + w / 2} y={lo[2] - 0.06} fontSize={fs} textAnchor="middle" className="cfdPlanText">{t.label}</text>
                <text x={lo[0] + w / 2} y={hi[2] + fs + 0.02} fontSize={fs * 0.85} textAnchor="middle" className="cfdPlanText muted">{roleWords(t.role, t.from.from)} · {flow(t.cfm == null ? null : OUTWARD(t.role) ? -Math.abs(t.cfm) : t.cfm)}{t.host === "wall" ? ` · ${len((lo[1] + hi[1]) / 2 - floorY)} up` : ""}{bad ? (offFace(t) ? " · OFF ITS FACE" : " · PAST A WALL") : ""}</text>
              </g>
            );
          })}
          <g transform={`translate(${x1 - 0.35},${z0 + 0.45})`}><line x1={0} y1={0.25} x2={0} y2={-0.2} className="cfdNorth" /><text x={0} y={-0.25} fontSize={fs} textAnchor="middle" className="cfdPlanText">N</text></g>
        </svg>
        {wallFace != null && faces[wallFace] && <WallElevation faces={faces} face={wallFace} floorY={floorY} s={s} imperial={imperial} placing={tool === "wall"}
          onPlace={(c, fi) => add("wall", fi, c)} onClose={() => setWallFace(null)} />}
      </div>}
      <div className="cfdPlanLegend muted">
        {(["supply", "return", "transfer", "transfer-in", "exhaust"] as const).map((r) => <span key={r}><i style={{ background: ROLE_COLOUR[r] }} /> {ROLE_WORD[r]}</span>)}
        {in3d ? <span>· each face drawn from inside the room · <b className="bad">red</b> edges: touching no face · amber edges: selected</span> : <span>· floor solid · ceiling dashed · wall a bar on its wall · <b className="bad">red</b> past a wall · grey dashed: switched off</span>}
      </div>
    </div>
  );
}

/** a wall, face on — where a wall grille goes and at what height */
function WallElevation({ faces, face, floorY, s, imperial, placing, onPlace, onClose }: { faces: RoomFace[]; face: number; floorY: number; s: CfdSetupState; imperial: boolean; placing: boolean; onPlace: (c: V3, face: number) => void; onClose: () => void }): ReactNode {
  const svg = useRef<SVGSVGElement>(null);
  const f = faces[face]!;
  const t: [number, number] = [-f.n[2], f.n[0]], d = f.outer[0]![0] * f.n[0] + f.outer[0]![2] * f.n[2];
  const uv = (p: V3): [number, number] => [p[0] * t[0] + p[2] * t[1], p[1]];
  // the WHOLE wall: every face of the room in this one plane (a wall is often split by height — measured on Bed 1's east wall)
  const set = faces.map((g, i) => ({ g, i })).filter(({ g }) => hostOf(g) === "wall" && g.n[0] * f.n[0] + g.n[2] * f.n[2] > 0.999 && Math.abs(g.outer[0]![0] * f.n[0] + g.outer[0]![2] * f.n[2] - d) < 0.01);
  const rings = set.map(({ g, i }) => ({ i, r: g.outer.map(uv) }));
  const ring = rings.flatMap((x) => x.r), us = ring.map((q) => q[0]), ys = ring.map((q) => q[1]);
  const inRing = (r: Array<[number, number]>, u: number, y: number): boolean => { let k = false; for (let a = 0, b = r.length - 1; a < r.length; b = a++) { const [ua, ya] = r[a]!, [ub, yb] = r[b]!; if ((ya > y) !== (yb > y) && u < ((ub - ua) * (y - ya)) / (yb - ya) + ua) k = !k; } return k; };
  const u0 = Math.min(...us) - 0.3, u1 = Math.max(...us) + 0.3, y0 = Math.min(...ys) - 0.3, y1 = Math.max(...ys) + 0.3;
  const len = (m: number): string => (imperial ? `${(m / 0.3048).toFixed(1)} ft` : `${m.toFixed(2)} m`);
  const click = (e: React.MouseEvent): void => {
    if (!placing) return;
    const m = svg.current!.getScreenCTM()!.inverse(), p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
    const u = p.x, y = -p.y;
    const hit = rings.find((x) => inRing(x.r, u, y));
    if (!hit) return;
    onPlace([u * t[0] + d * f.n[0], y, u * t[1] + d * f.n[2]], hit.i);
  };
  const on = s.terminals.filter((q) => q.host === "wall" && set.some((x) => x.i === q.face));
  return (
    <div className="cfdElevation">
      <div className="cfdPlanTools"><b>{faceLabel(f).replace(/ \(.*/, "")}</b> · {rings.length} face{rings.length === 1 ? "" : "s"} in this plane · seen from inside the room · {placing ? "click where the grille goes" : "pick + wall to add"} <button onClick={onClose}>close</button></div>
      <svg ref={svg} viewBox={`${u0} ${-y1} ${u1 - u0} ${y1 - y0}`} preserveAspectRatio="xMidYMid meet" className="cfdPlanSvg" onClick={click}>
        {rings.map((x) => <polygon key={x.i} points={x.r.map((q) => `${q[0]},${-q[1]}`).join(" ")} className="cfdFloor" />)}
        <line x1={u0} y1={-floorY} x2={u1} y2={-floorY} className="cfdNorth" />
        {on.map((q) => { const a = uv(q.box.lo), b = uv(q.box.hi), lo: [number, number] = [Math.min(a[0], b[0]), Math.min(a[1], b[1])], hi: [number, number] = [Math.max(a[0], b[0]), Math.max(a[1], b[1])];
          return <g key={q.key} className={`cfdTerm wall${s.sel === q.key ? " sel" : ""}`} onClick={(e) => { e.stopPropagation(); s.setSel(q.key); }}>
            <rect x={lo[0]} y={-hi[1]} width={hi[0] - lo[0]} height={hi[1] - lo[1]} fill={ROLE_COLOUR[q.role]} />
            <text x={(lo[0] + hi[0]) / 2} y={-hi[1] - 0.05} fontSize={0.12} textAnchor="middle" className="cfdPlanText">{q.label} · {len((lo[1] + hi[1]) / 2 - floorY)} up</text>
          </g>; })}
      </svg>
    </div>
  );
}

/** THE FRAME'S TABS while a room is set up */
export type SetupTab = "TERMINALS" | "DOORS" | "SUPPLY AIR" | "SOLVE" | "PROCESSORS" | "RUN";
export const SETUP_TABS: SetupTab[] = ["TERMINALS", "DOORS", "SUPPLY AIR", "SOLVE", "PROCESSORS", "RUN"];

export function CfdSetupFrame({ s, tab, onTab, imperial, supply, onRun }: { s: CfdSetupState; tab: SetupTab; onTab: (t: SetupTab) => void; imperial: boolean; supply: ReactNode; onRun: (cases: CfdCase[], np: number) => void }): ReactNode {
  const { node: procNode, plan } = useProcessorChoice({ machine: s.inp?.machine ?? null, jobs: s.cases.map((c) => ({ key: c.peak, cells: s.cells, iterations: s.choices?.iterations ?? 11000 })), procs: s.procs, onProcs: s.setProcs });
  if (!s.inp || !s.choices) return <div className="muted">click a space in LEVELS · SPACES to set it up</div>;
  const inp = s.inp, ch = s.choices;
  const L = (m: number): string => (imperial ? (m / IN).toFixed(2) : (m * 1000).toFixed(0));
  const fromL = (v: number | null): number => (v == null ? 0 : imperial ? v * IN : v / 1000);
  const lu = imperial ? "in" : "mm";
  const fu = imperial ? "cfm" : "L/s";
  const cautions = [...new Set(s.cases.flatMap((c) => c.out.cautions))];
  const status = s.refusals.length
    ? <div className="cfdRefusals"><b>Not ready to run — {s.refusals.length} thing{s.refusals.length === 1 ? "" : "s"} to settle:</b>{s.refusals.map((r, i) => <div key={i}>✗ {r}</div>)}</div>
    : s.cases.length ? <div className="cfdReady">✓ ready to run — {s.cases.map((c) => c.peak).join(" and ")}</div> : null;
  const floorY = Math.min(...inp.faces.filter((f) => hostOf(f) === "floor").flatMap((f) => f.outer.map((p) => p[1])));
  return (
    <div className="asmBench zoneFrame cfdFrame">
      <div className="asmRail">
        {SETUP_TABS.map((t) => <button key={t} className={`asmRailBtn${tab === t ? " on" : ""}${t === "RUN" && s.refusals.length ? " warn" : ""}`} onClick={() => onTab(t)}>{t}</button>)}
      </div>
      <div className="cfdFrameBody">
        {tab === "TERMINALS" && <>
          {s.refusals.length > 0 && status}
          <div className="muted">the room's air terminals — the MEP file's and the ones you add on the plan; a name, a role and a flow are yours: a supply's flow is needed; a transfer grille is OUT (this room's air leaves by it, free) or IN (the next room's air comes back by it — type the flow, the next room's supply that returns this way, and pick the room it comes from: the air enters at that room's temperature); a return's or an exhaust's may be set (blank, it is free), and at least one opening must stay free. The size is the grille's face: the file's default is the whole fitting, often larger — type the real one.</div>
          <table className="cfdTerms">
            <thead><tr><th /><th>name</th><th>on</th><th>role</th><th>{fu}</th><th title="the other room of a transfer grille and its temperature at each peak — a transfer OUT names the room this room's air goes to (its temperature is taken for any air that comes back in by the grille); a transfer IN names the room the air comes from (it enters at that temperature). Blank temperature: the room's thermostat at that peak (its zone's setpoint in the run); type one to set it yourself">transfer (room · {imperial ? "°F" : "°C"})</th><th title="width × height (along the face)">size ({lu})</th><th title="floor and ceiling terminals: the clearance to the walls, N · S · E · W (negative: past the wall) · wall terminals: the centre's height above the floor">place ({lu})</th><th /></tr></thead>
            <tbody>
              {s.terminals.map((t) => {
                const f = inp.faces[t.face]!;
                const wh = t.host === "wall" ? wallWH(f, t.size) : t.size;
                const setWH = (w: number, h: number): void => { const sz: [number, number] = t.host === "wall" ? wallSize(f, w, h) : [w, h]; editTerminal(s, t.key, { file: (c) => ({ ...c, size: sz }), added: (a) => ({ ...a, size: sz }) }); };
                const cl = t.host === "wall" ? null : wallClearance(inp.faces, t.box);
                const ax = axisOf(f);
                if (cl && ax === 2) { cl.north = null; cl.south = null; }
                if (cl && ax === 0) { cl.east = null; cl.west = null; }
                const setCl = (dir: "north" | "south" | "east" | "west", v: number | null): void => {
                  const now = cl?.[dir]; if (now == null || v == null) return;
                  const dd = fromL(v) - now, n: V3 = [0, 0, 0];
                  if (dir === "north") n[2] += dd; else if (dir === "south") n[2] -= dd; else if (dir === "east") n[0] -= dd; else n[0] += dd;
                  editTerminal(s, t.key, { file: (c) => ({ ...c, nudge: [c.nudge[0] + n[0], c.nudge[1], c.nudge[2] + n[2]] }), added: (a) => ({ ...a, c: [a.c[0] + n[0], a.c[1], a.c[2] + n[2]] }) });
                };
                const height = (t.box.lo[1] + t.box.hi[1]) / 2 - floorY;
                return (
                  <tr key={t.key} className={`${t.use ? "" : "off"}${s.sel === t.key ? " sel" : ""}${s.issues.has(t.key) ? " issue" : ""}`} onClick={() => s.setSel(t.key)}
                    title={`${s.issues.has(t.key) ? `${s.issues.get(t.key)!.map((x) => `✗ ${x}`).join("\n")}\n\n` : ""}${t.source === "file" ? `the MEP file's ${t.name}` : "added by you on the plan"}`}>
                    <td><input type="checkbox" checked={t.use} onChange={(e) => editTerminal(s, t.key, { file: (c) => ({ ...c, use: e.target.checked }), added: (a) => ({ ...a, use: e.target.checked }) })} /></td>
                    <td><input className="cfdName" value={t.label} onChange={(e) => editTerminal(s, t.key, { file: (c) => ({ ...c, label: e.target.value }), added: (a) => ({ ...a, label: e.target.value }) })} />{t.source === "file" && t.label !== t.name ? <div className="muted cfdSmall">{t.name}</div> : t.source === "added" ? <div className="muted cfdSmall">added · {t.host}</div> : null}</td>
                    <td>{t.source === "file"
                      ? <select value={t.face} onChange={(e) => editTerminal(s, t.key, { file: (c) => ({ ...c, face: +e.target.value, nudge: [0, 0, 0] }) })}>{t.offer.candidates.map((cf) => <option key={cf.face} value={cf.face}>{cf.label}</option>)}{t.offer.candidates.some((cf) => cf.face === t.face) ? null : <option value={t.face}>{faceLabel(f)} (placed in 3-D)</option>}</select>
                      : <span className="muted">{faceLabel(f)}</span>}</td>
                    <td><select value={t.role} onChange={(e) => editTerminal(s, t.key, { file: (c) => ({ ...c, role: e.target.value as TerminalRole | "" }), added: (a) => ({ ...a, role: e.target.value as TerminalRole | "" }) })}>
                      <option value="">—</option><option value="supply">supply</option><option value="return">return</option><option value="transfer">transfer out (free)</option><option value="transfer-in">transfer in (from the next room)</option><option value="exhaust">exhaust</option>
                    </select></td>
                    <td><NumInput className="num" disabled={t.role === "transfer" || t.role === ""} title={t.role === "supply" ? "the supply's flow" : t.role === "transfer-in" ? "the next room's air that comes back through this grille — its supply, less what it returns or exhausts itself; it enters at that room's temperature (the from column)" : t.role === "transfer" ? "a transfer grille out is free: the air the room does not return leaves by it" : "a return's flow, if the system sets it — blank, it is free and takes what the others do not"} placeholder={t.role === "supply" || t.role === "transfer-in" ? "type" : "free"} value={t.cfm == null ? null : (OUTWARD(t.role) ? -Math.abs(t.cfm) : t.cfm) * (imperial ? 1 : 0.471947)} onValue={(v) => { const typed = v == null ? null : imperial ? v : v / 0.471947; const cfm = typed == null || typed === 0 ? null : OUTWARD(t.role) ? -Math.abs(typed) : Math.abs(typed); editTerminal(s, t.key, { file: (c) => ({ ...c, cfm }), added: (a) => ({ ...a, cfm }) }); }} /></td>
                    <td>{t.role === "transfer-in" || t.role === "transfer" ? (() => {
                      // WHERE TRANSFER AIR COMES FROM (2026-11-11, the user: "Transfer air should be the room temperature from which it
                      // transfers from"): the room, then per peak its thermostat (placeholder) or a temperature typed over it
                      const setFrom = (fc: FromChoice): void => editTerminal(s, t.key, { file: (c) => ({ ...c, ...fc }), added: (a) => ({ ...a, ...fc }) });
                      const toU = (c: number): number => (imperial ? c * 1.8 + 32 : c), fromU = (v: number): number => (imperial ? (v - 32) / 1.8 : v);
                      // the direction said beside the room (2026-11-11, the user: "the transfer out terminal doesn't identify which space it transfers to")
                      return <>
                        <span className="muted">{t.role === "transfer" ? "to" : "from"} </span>
                        <select value={t.from.from ?? ""} className={t.role === "transfer-in" && !t.from.from && !inp.offer.peaks.every((p) => t.from.fromC?.[p.peak] != null) ? "bad" : ""} onChange={(e) => setFrom({ from: e.target.value || null })}>
                          <option value="">{t.role === "transfer-in" ? "— pick the room it comes from —" : "— pick the room it goes to —"}</option>
                          {inp.offer.rooms.map((r) => <option key={r.space} value={r.space}>{r.space}{r.zone !== r.space ? ` (${r.zone})` : ""}{r.conditioned ? "" : " · unconditioned"}</option>)}
                        </select>
                        {inp.offer.peaks.map((p) => { const ft = fromTemp(inp.offer, { from: t.from.from }, p.peak); const typed = t.from.fromC?.[p.peak] ?? null;
                          return <NumInput key={p.peak} className={`num${t.role === "transfer-in" && typed == null && ft.c == null ? " bad" : ""}`} digits={1} title={`${p.peak}: ${typed != null ? "typed" : ft.why}`} placeholder={ft.c != null ? toU(ft.c).toFixed(1) : p.peak[0]} value={typed == null ? null : toU(typed)} onValue={(v) => setFrom({ fromC: { ...(t.from.fromC ?? {}), [p.peak]: v == null ? null : fromU(v) } })} />; })}
                      </>; })() : <span className="muted">—</span>}</td>
                    <td><NumInput className="num" digits={2} value={+L(wh[0])} onValue={(v) => v && setWH(fromL(v), wh[1])} /> × <NumInput className="num" digits={2} value={+L(wh[1])} onValue={(v) => v && setWH(wh[0], fromL(v))} /></td>
                    <td>{cl ? (["north", "south", "east", "west"] as const).map((dname) => <NumInput key={dname} className={`num${cl[dname] != null && cl[dname]! < 0 ? " bad" : ""}`} digits={2} disabled={cl[dname] == null} title={cl[dname] == null ? `no ${dname} wall beside it` : `${dname}: type the clearance to move it`} value={cl[dname] == null ? null : +L(cl[dname]!)} onValue={(v) => setCl(dname, v)} />)
                      : <><NumInput className="num" digits={2} value={+L(height)} onValue={(v) => { if (v == null) return; const dd = fromL(v) - height; editTerminal(s, t.key, { file: (c) => ({ ...c, nudge: [c.nudge[0], c.nudge[1] + dd, c.nudge[2]] }), added: (a) => ({ ...a, c: [a.c[0], a.c[1] + dd, a.c[2]] }) }); }} /> <span className="muted">up</span></>}</td>
                    <td>{t.source === "added" && <button className="qaBtn" onClick={(e) => { e.stopPropagation(); s.update((c) => ({ ...c, added: (c.added ?? []).filter((a) => a.id !== t.key) })); }}>remove</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {(() => {
            // THE AIR BALANCE (2026-11-10, the user: "a summary cfm box to account for exhaust/return and supply air … exhaust and return
            // air flows should be negative"): every terminal on, signed — in +, out −; the free openings take what is left, and it sums to 0
            const on = s.terminals.filter((t) => t.use && t.role);
            const fl = (cfm: number): string => (imperial ? `${cfm > 0 ? "+" : cfm < 0 ? "−" : ""}${Math.abs(cfm).toFixed(0)}` : `${cfm > 0 ? "+" : cfm < 0 ? "−" : ""}${Math.abs(cfm * 0.471947).toFixed(1)}`);
            const isFree = (t: SetupTerminal): boolean => t.role === "transfer" || (OUTWARD(t.role) && !t.cfm);
            const signed = (t: SetupTerminal): number => (OUTWARD(t.role) ? -Math.abs(t.cfm ?? 0) : Math.abs(t.cfm ?? 0));
            const fixed = on.filter((t) => !isFree(t));
            const net = fixed.reduce((x, t) => x + signed(t), 0);
            const free = on.filter(isFree);
            const doorsFree = inp.offer.doors.filter((d) => ch.doors[String(d.elementId)]?.mode !== "sealed");
            const nFree = free.length + doorsFree.length;
            const group = (r: string): string => (r === "supply" ? "supply" : r === "transfer-in" ? "transfer in" : r === "return" ? "return" : r === "exhaust" ? "exhaust" : r);
            // the same grille drawn twice in the MEP file: two terminals on, their centres within 0.3 m
            const ctr = (t: SetupTerminal): V3 => [0, 1, 2].map((i) => (t.box.lo[i]! + t.box.hi[i]!) / 2) as V3;
            const twins: string[] = [];
            on.forEach((a, i) => on.slice(i + 1).forEach((b) => { const p = ctr(a), q = ctr(b); const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); if (d < 0.3) twins.push(`${a.label} and ${b.label} (${L(d)} ${lu} apart)`); }));
            const byGroup = ["supply", "transfer-in", "return", "exhaust"].map((r) => ({ r, ts: fixed.filter((t) => t.role === r) })).filter((g) => g.ts.length);
            return <>
              <table className="cfdBalance">
                <thead><tr><th>air balance</th><th>{fu}</th></tr></thead>
                <tbody>
                  {byGroup.map((g) => <tr key={g.r} title={g.ts.map((t) => `${t.label} ${fl(signed(t))}`).join("\n")}><td>{group(g.r)} <span className="muted">· {g.ts.length}</span></td><td className="num">{fl(g.ts.reduce((x, t) => x + signed(t), 0))}</td></tr>)}
                  <tr className={nFree ? "" : "bad"} title={nFree ? `${[...free.map((t) => t.label), ...doorsFree.map((d) => d.name)].join(", ")}${nFree > 1 ? " — split between them by the pressure the solver finds" : ""}` : "no free opening: leave one return, a transfer out or a door free"}>
                    <td>free openings <span className="muted">· {nFree ? `${free.length ? `${free.length} terminal${free.length === 1 ? "" : "s"}` : ""}${free.length && doorsFree.length ? " + " : ""}${doorsFree.length ? `${doorsFree.length} door${doorsFree.length === 1 ? "" : "s"}` : ""}` : "none"}</span></td>
                    <td className="num">{nFree ? fl(-net) : "—"}</td></tr>
                  <tr className={`sum${nFree || Math.abs(net) < 0.5 ? "" : " bad"}`}><td>net</td><td className="num">{nFree ? fl(0) : fl(net)}</td></tr>
                </tbody>
              </table>
              {!nFree && Math.abs(net) >= 0.5 && <div className="bad">{fl(net)} {fu} unaccounted and no free opening — at a steady state what comes in must leave: clear one return's flow (it then takes the rest), or switch a transfer grille to out</div>}
              {nFree > 0 && net < 0 && <div className="bad">the set flows out exceed the flows in by {fl(-net).replace("+", "")} {fu} — the free openings would have to bring air IN</div>}
              {twins.map((w, i) => <div key={i} className="cfdCaution">⚠ {w}: the same grille drawn twice in the MEP file? Both are open in the run — switch one off</div>)}
            </>;
          })()}
          {!s.terminals.length && <div className="muted">the MEP file places no air terminal in {inp.space} — add one on the plan (+ floor, + ceiling, + wall)</div>}
        </>}
        {tab === "DOORS" && <>
          <div className="muted">the file's doors on {inp.space}'s faces that the energy model does not write as the room's own — how each is during the run</div>
          {!inp.offer.doors.length && <div className="muted">no other door of the file on {inp.space}'s faces</div>}
          {inp.offer.doors.map((d) => {
            const id = String(d.elementId), c = ch.doors[id]!;
            return (
              <div key={id} className="cfdRow">
                {d.name} · {L(d.widthM)} {lu} wide{d.isExternal ? <span className="muted"> · the file says external</span> : null} ·{" "}
                <select value={c.mode} onChange={(e) => s.update((cc) => ({ ...cc, doors: { ...cc.doors, [id]: { ...c, mode: e.target.value as DoorMode } } }))}>
                  <option value="sealed">closed, sealed</option><option value="undercut">closed, with an undercut</option><option value="open">open</option>
                </select>
                {c.mode === "undercut" && <> · undercut <NumInput className="num" digits={2} value={c.undercutM == null ? null : +L(c.undercutM)} placeholder="type" onValue={(v) => s.update((cc) => ({ ...cc, doors: { ...cc.doors, [id]: { ...c, undercutM: v == null ? null : fromL(v) } } }))} /> {lu}</>}
              </div>
            );
          })}
          {/* THE FLOOR OPENINGS (2026-11-10): where the file draws no floor under the room — a stair well — closed (as the room's solid
              draws it) or open (an opening of its own, free: air goes down or comes up as the pressure finds) */}
          {(inp.offer.floorOpenings ?? []).length > 0 && <div className="dialogHead">OPENINGS IN THE FLOOR — where the file draws no floor under {inp.space}</div>}
          {(inp.offer.floorOpenings ?? []).map((o) => {
            const id = `open:${o.key}`, isOpen = (ch.added ?? []).some((a) => a.id === id);
            const w = o.hi[0] - o.lo[0], d = o.hi[1] - o.lo[1];
            const set = (open: boolean): void => s.update((cc) => {
              const rest = (cc.added ?? []).filter((a) => a.id !== id);
              if (!open) return { ...cc, added: rest };
              const a: AddedTerminal = { id, label: `floor opening${o.below.length ? ` to ${o.below.join(" + ")}` : ""}`, host: "floor", face: o.face, c: [(o.lo[0] + o.hi[0]) / 2, o.y, (o.lo[1] + o.hi[1]) / 2], size: [w, d], role: "transfer", cfm: null, use: true, from: o.below.length === 1 ? o.below[0] : null };
              return { ...cc, added: [...rest, a] };
            });
            return (
              <div key={o.key} className="cfdRow" title={`the room's floor here has no floor or ceiling of the model under it within 0.6 m — the room's solid is drawn across it. Open, the opening is the box around it (${(o.areaM2 / (w * d) * 100).toFixed(0)} % of the box is the opening itself); its size can be typed in TERMINALS`}>
                {L(w)} × {L(d)} {lu} · {imperial ? `${(o.areaM2 * 10.7639).toFixed(1)} ft²` : `${o.areaM2.toFixed(2)} m²`} · {o.below.length ? <>over {o.below.join(", ")}</> : <span className="muted">no room of the model under it</span>} ·{" "}
                <select value={isOpen ? "open" : "closed"} onChange={(e) => set(e.target.value === "open")}>
                  <option value="closed">closed (as the room's solid draws it)</option><option value="open">open — a path (free)</option>
                </select>
              </div>
            );
          })}
        </>}
        {tab === "SUPPLY AIR" && supply}
        {tab === "SOLVE" && <>
          <div className="cfdRow">mesh <NumInput className="num" digits={2} value={+L(ch.meshM)} onValue={(v) => v && s.update((c) => ({ ...c, meshM: Math.max(0.02, fromL(v)) }))} /> {lu} <span className="muted">(refined 8× at the terminals) · about {s.cells.toLocaleString()} cells</span></div>
          {(() => {
            const st = ch.stop ?? STOP_CHOICE_DEFAULT, set = (p: Partial<StopChoice>): void => s.update((c) => ({ ...c, stop: { ...(c.stop ?? STOP_CHOICE_DEFAULT), ...p } }));
            return <>
              <label className="cfdRow"><input type="checkbox" checked={st.on} onChange={(e) => set({ on: e.target.checked })} /> <b>stop when the room settles</b> <span className="muted">— the room's mean air temperature, its mean air speed and the air leaving by the outlets, each averaged over the last 1,000 iterations, compared with the 1,000 before; the run ends when none moved more than the tolerance (the speed: 2 % of its mean)</span></label>
              {st.on && <div className="cfdRow">
                tolerance <NumInput className="num" digits={2} value={imperial ? st.tolK * 1.8 : st.tolK} onValue={(v) => v && v > 0 && set({ tolK: imperial ? v / 1.8 : v })} /> {imperial ? "°F" : "K"}
                {" · "}not before <NumInput className="num" digits={0} value={st.minIterations} onValue={(v) => v && set({ minIterations: Math.max(1000, Math.round(v)) })} /> iterations
                {" · "}at most <NumInput className="num" digits={0} value={ch.iterations} onValue={(v) => v && s.update((c) => ({ ...c, iterations: Math.max(st.minIterations + 2000, Math.round(v)) }))} /> <span className="muted">(the cap — a run that reaches it is kept, marked "did not settle" with the change it still had)</span>
              </div>}
              {!st.on && <div className="cfdRow">iterations <NumInput className="num" digits={0} value={ch.iterations} onValue={(v) => v && s.update((c) => ({ ...c, iterations: Math.max(100, Math.round(v)) }))} /> <span className="muted">(a fixed count; the fields averaged over the last 3,000)</span></div>}
              {!st.on && ch.iterations < 11000 && <div className="bad">{ch.iterations.toLocaleString()} iterations: a measured 110 m³ bedroom's flow settled only after about 8,000 (2026-11-03) — a shorter run checks the set-up, it is not the room's answer</div>}
              <div className="muted">the fields are averaged over the last 3,000 iterations, wherever the run ends</div>
            </>;
          })()}
        </>}
        {tab === "PROCESSORS" && <><div className="muted">{s.cases.length > 1 ? `both peaks, about ${s.cells.toLocaleString()} cells each` : `about ${s.cells.toLocaleString()} cells`}; the app stays usable meanwhile</div>{procNode}</>}
        {tab === "RUN" && <>
          {status}
          {cautions.map((c, i) => <div key={i} className="cfdCaution">⚠ {c}</div>)}
          <div className="dialogHead">THE PEAKS</div>
          {inp.offer.peaks.map((p) => (
            <label key={p.peak} className="cfdRow">
              <input type="checkbox" checked={!!s.peaks[p.peak]} onChange={(e) => s.setPeaks({ ...s.peaks, [p.peak]: e.target.checked })} />
              <b>{p.peak}</b> · {p.label} · {fmtPower(p.loadW, imperial)} · outdoor {p.outdoorC != null ? fmtTemp(p.outdoorC, imperial) : "—"} · {p.insideC.size} inside temperatures
              {(() => { const c = s.cases.find((x) => x.peak === p.peak); const sp = c?.out.info.supply_c; return typeof sp === "number" ? <span className="muted"> → supply {fmtTemp(sp, imperial)}{c?.input.supplyC != null ? " (the system's)" : " (from the load)"}</span> : null; })()}
            </label>
          ))}
          {(() => { const notes = s.cases.flatMap((c) => c.out.notes.map((n) => `${c.peak}: ${n}`)); return notes.length ? (
            <details className="cfdNotes"><summary className="muted">{notes.length} note{notes.length === 1 ? "" : "s"} on how the cases are written</summary>{notes.map((n, i) => <div key={i} className="muted">· {n}</div>)}</details>) : null; })()}
          <div className="allRow cfdButtons">
            <button className="qaBtn cfdGo" disabled={s.refusals.length > 0 || !s.cases.length} onClick={() => onRun(s.cases, plan?.procs ?? 1)} title={s.refusals.length ? "the list above says what is missing" : "write the case and run OpenFOAM"}>
              Run {s.cases.length === 2 ? "both peaks" : s.cases[0]?.peak ?? ""}{plan ? ` · ${plan.procs} process${plan.procs === 1 ? "" : "es"}` : ""}
            </button>
          </div>
        </>}
        {tab !== "RUN" && s.refusals.length > 0 && <div className="muted cfdSmall">⚠ {s.refusals.length} thing{s.refusals.length === 1 ? "" : "s"} to settle before the run — see RUN</div>}
      </div>
    </div>
  );
}
