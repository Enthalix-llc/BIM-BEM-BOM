// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
/**
 * THE ALIGNMENT DIALOG (user, 2026-11-03): "a persistent dialog offering displacement and rotation tools to see added ifc model
 * before accepting its location … In the IFC load button, we should offer that same dialog for editing already loaded file as
 * 'Edit Alignment' with selection of ifc files for editing". It floats over the views without blocking them (orbit, pan and zoom go
 * on), and the file under it moves in the views as it is nudged; nothing is stored until Accept. Move in the user's units along the
 * project grid (east, north, up); turn in degrees about a PIVOT — a point of the house the user locks, which stays put however far
 * the file is turned. "Match a point" takes a point on the file and the house point it belongs on: the file moves there and that
 * point becomes the pivot.
 */
import { useState } from "react";
import { NO_ALIGN, moveBy, turnBy, setPivot, type FileAlign } from "../core/siteAlign";

const FT = 3.28083989501312;
const MOVE_STEPS_M = [0.001, 0.005, 0.01, 0.05, 0.1, 0.5];
const MOVE_STEPS_FT = [1 / 96, 1 / 48, 1 / 12, 0.25, 0.5, 1];   // ⅛″ · ¼″ · 1″ · 3″ · 6″ · 1 ft
const TURN_STEPS = [0.01, 0.05, 0.1, 0.25, 0.5, 1];
const store = (k: string, v: string): void => { try { window.localStorage.setItem(k, v); } catch { /* view state only */ } };
const read = (k: string): string | null => { try { return window.localStorage.getItem(k); } catch { return null; } };

export type AlignPick = null | "pivot" | "from" | "to";

export function AlignDialog(p: {
  files: string[]; file: string; onFile: (name: string) => void;
  draft: FileAlign; applied: FileAlign; onDraft: (a: FileAlign) => void;
  pick: AlignPick; onPick: (mode: AlignPick) => void;
  imperial: boolean; busy: boolean; note: string | null; fileWord: string | null;
  onAccept: () => void; onCancel: () => void;
}): React.ReactElement {
  const u = p.imperial ? FT : 1, lu = p.imperial ? "ft" : "m";
  const steps = p.imperial ? MOVE_STEPS_FT : MOVE_STEPS_M;
  const [moveIx, setMoveIx] = useState(() => { const n = Number(read(`bim-align-move-${lu}`)); return Number.isInteger(n) && n >= 0 && n < 6 ? n : 2; });
  const [turnIx, setTurnIx] = useState(() => { const n = Number(read("bim-align-turn")); return Number.isInteger(n) && n >= 0 && n < 6 ? n : 1; });
  const step = steps[moveIx]!, tstep = TURN_STEPS[turnIx]!;
  // the dialog is dragged by its head, so it never sits on what is being aligned; where it was left is kept
  const [pos, setPos] = useState<{ x: number; y: number }>(() => { try { const v = JSON.parse(read("bim-align-pos") ?? "") as { x: number; y: number }; if (Number.isFinite(v.x) && Number.isFinite(v.y)) return v; } catch { /* default */ } return { x: 290, y: 120 }; });
  const drag = (ev: React.PointerEvent): void => {
    if ((ev.target as HTMLElement).closest("select")) return;
    ev.preventDefault();
    const x0 = ev.clientX - pos.x, y0 = ev.clientY - pos.y;
    let last = pos;
    const move = (e: PointerEvent): void => { last = { x: Math.max(0, Math.min(window.innerWidth - 120, e.clientX - x0)), y: Math.max(0, Math.min(window.innerHeight - 40, e.clientY - y0)) }; setPos(last); };
    const up = (): void => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); store("bim-align-pos", JSON.stringify(last)); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  const stepLabel = (m: number): string => (p.imperial ? (m >= 1 ? `${m} ft` : `${+(m * 12).toFixed(3)}″`) : m >= 1 ? `${m} m` : `${+(m * 1000).toFixed(1)} mm`);
  const d = p.draft;
  const changed = JSON.stringify({ ...d, at: 0 }) !== JSON.stringify({ ...p.applied, at: 0 });
  // the move along the project grid: x east, −z north, y up — a nudge moves the file by exactly the step in the house frame
  const nudge = (ax: 0 | 1 | 2, sign: 1 | -1): void => {
    const m: [number, number, number] = [0, 0, 0];
    m[ax] = (sign * step) / u;
    p.onDraft(moveBy(d, m));
  };
  const typed = (ax: "dx" | "dy" | "dz", v: string, flip = false): void => {
    const n = Number(v);
    if (!Number.isFinite(n)) return;
    p.onDraft({ ...d, [ax]: (flip ? -n : n) / u });
  };
  const fmt = (m: number): string => (m * u).toFixed(p.imperial ? 3 : 4);
  const row = (label: string, ax: 0 | 1 | 2, key: "dx" | "dy" | "dz", flip: boolean, minus: string, plus: string): React.ReactElement => (
    <div className="alignRow">
      <span className="alignLab">{label}</span>
      <button onClick={() => nudge(ax, flip ? 1 : -1)} title={`move the file ${minus} by ${stepLabel(step)}`}>−</button>
      <input key={`${key}${d[key]}`} defaultValue={fmt(flip ? -d[key] : d[key])} onBlur={(e) => typed(key, e.target.value, flip)} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        title={`how far the file's point now at the pivot has moved ${plus}, ${lu} — type a value and press Enter`} />
      <button onClick={() => nudge(ax, flip ? -1 : 1)} title={`move the file ${plus} by ${stepLabel(step)}`}>+</button>
      <span className="ctxDim">{lu}</span>
    </div>
  );
  const pickWord = p.pick === "pivot" ? "click the point the file turns about (on the house or on the file)"
    : p.pick === "from" ? "1 of 2 — click a point ON THE FILE (it is drawn lit)"
    : p.pick === "to" ? "2 of 2 — click where that point belongs ON THE HOUSE" : null;
  return (
    <div className="alignDialog" role="dialog" aria-label="Edit alignment" style={{ left: pos.x, top: pos.y }}>
      <div className="dialogHead" onPointerDown={drag} title="drag to move the dialog">ALIGNMENT ·{" "}
        <select value={p.file} disabled={p.busy || changed} onChange={(e) => p.onFile(e.target.value)} title={changed ? "Accept or Cancel this file's changes first" : "the linked file to place"}>
          {p.files.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>
      <div className="ctxDim">turned first by its own TrueNorth against the house's; then placed here. The file moves in the views as you nudge it — nothing is kept until Accept.</div>
      <div className="alignSec">MOVE <span className="ctxDim">· step</span>{" "}
        <select value={moveIx} onChange={(e) => { const n = Number(e.target.value); setMoveIx(n); store(`bim-align-move-${lu}`, String(n)); }}>
          {steps.map((s, i) => <option key={i} value={i}>{stepLabel(s)}</option>)}
        </select>
      </div>
      {row("East", 0, "dx", false, "west", "east")}
      {row("North", 2, "dz", true, "south", "north")}
      {row("Up", 1, "dy", false, "down", "up")}
      <div className="alignSec">TURN <span className="ctxDim">· step</span>{" "}
        <select value={turnIx} onChange={(e) => { const n = Number(e.target.value); setTurnIx(n); store("bim-align-turn", String(n)); }}>
          {TURN_STEPS.map((s, i) => <option key={i} value={i}>{s}°</option>)}
        </select>
      </div>
      <div className="alignRow">
        <span className="alignLab">Turn</span>
        <button onClick={() => p.onDraft(turnBy(d, -tstep))} title={`turn the file ${tstep}° counter-clockwise (seen from above) about the pivot`}>⟲</button>
        <input key={`deg${d.deg}`} defaultValue={d.deg.toFixed(3)} onBlur={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) p.onDraft({ ...d, deg: n }); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          title="degrees clockwise seen from above, about the pivot — type a value and press Enter" />
        <button onClick={() => p.onDraft(turnBy(d, tstep))} title={`turn the file ${tstep}° clockwise (seen from above) about the pivot`}>⟳</button>
        <span className="ctxDim">° CW</span>
      </div>
      <div className="alignSec">PIVOT <span className="ctxDim">· locked at East {fmt(d.px)} · North {fmt(-d.pz)} {lu}</span></div>
      <div className="alignRow">
        <button className={p.pick === "pivot" ? "on" : ""} disabled={p.busy} onClick={() => p.onPick(p.pick === "pivot" ? null : "pivot")}
          title="lock the turn's centre: click a point in the IFC view — a point the file and the house share keeps them together as you turn">Pick pivot…</button>
        <button className={p.pick === "from" || p.pick === "to" ? "on" : ""} disabled={p.busy} onClick={() => p.onPick(p.pick === "from" || p.pick === "to" ? null : "from")}
          title="click a point on the file, then the house point it belongs on: the file moves there, and that point becomes the locked pivot">Match a point…</button>
        <button disabled={p.busy} onClick={() => p.onDraft(setPivot(d, 0, 0))} title="the house's own origin as the pivot (the file stays where it is)">origin</button>
      </div>
      {pickWord && <div className="alignPick">{pickWord} · <button onClick={() => p.onPick(null)}>cancel</button></div>}
      {p.note && <div className="ctxDim">{p.note}</div>}
      {p.fileWord && <div className="ctxDim alignWord" title={p.fileWord}>{p.fileWord}</div>}
      <div className="alignRow alignEnd">
        <button disabled={p.busy} onClick={() => p.onDraft({ ...NO_ALIGN })} title="back to the file's own TrueNorth turn alone (the pivot to the house's origin) — Accept keeps it">Reset</button>
        <span style={{ flex: 1 }} />
        <button disabled={p.busy} onClick={p.onCancel} title={changed ? "close, and put the file back where it was" : "close"}>{changed ? "Cancel" : "Close"}</button>
        <button className="accept" disabled={p.busy} onClick={p.onAccept} title="keep this placement: the files are projected again, ifc.db stores the move and the turn, idf.db is rebuilt">Accept</button>
      </div>
    </div>
  );
}
