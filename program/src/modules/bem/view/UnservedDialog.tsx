// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// A ZONE NO SYSTEM SERVES, ASKED (user, 2026-11-20): a click on its red check row on RUN opens this dialog with the two answers —
// "Conditioned default district heat/cool" (the ideal-loads stand-in, reported as district heating and cooling) or "Unconditioned
// with load transfer to adjoining spaces" (no heating or cooling of its own; it floats, inside the envelope, and what passes through
// its walls and floors is its neighbours' load). The choice is written to the rulings and the model rebuilt; the row turns white.
import { useEffect } from "react";
import type { UnservedChoice } from "../core/bemDb.js";

export interface UnservedAsk { zone: string; choice: UnservedChoice | null; at: string | null; rooms: string[] }

export function UnservedDialog(p: { ask: UnservedAsk; busy: boolean; onChoose: (zone: string, choice: UnservedChoice) => void; onCancel: () => void }): React.ReactElement {
  useEffect(() => {
    const k = (e: KeyboardEvent): void => { if (e.key === "Escape") p.onCancel(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [p]);
  const { zone, choice, rooms } = p.ask;
  const opt = (c: UnservedChoice, label: string, what: string): React.ReactElement => (
    <button className={`qaBtn unservedOpt${choice === c ? " on" : ""}`} disabled={p.busy} onClick={() => p.onChoose(zone, c)}>
      <b>{label}</b>{choice === c ? " · your choice" : ""}<br /><span className="muted">{what}</span>
    </button>
  );
  return (
    <div className="menuScrim dialogScrim" onPointerDown={p.onCancel}>
      <div className="dialog unservedDialog" role="dialog" aria-label={`how ${zone} is modelled`} onPointerDown={(e) => e.stopPropagation()}>
        <div className="dialogHead">{zone} — conditioned, and no system on the sheet serves it</div>
        <div className="muted">{rooms.length && !(rooms.length === 1 && rooms[0] === zone) ? `rooms: ${rooms.join(", ")} · ` : ""}no Zone card on the SYSTEMS sheet holds it. How should the model treat it?</div>
        {opt("conditioned", "Conditioned default district heat/cool", "held at the thermostat's setpoints by the program's stand-in (ideal loads), reported as district heating and cooling — no equipment of the house")}
        {opt("float", "Unconditioned with load transfer to adjoining spaces", "no heating or cooling of its own; its temperature floats, it stays inside the envelope, and what passes through its walls and floors is a load on the spaces next to it")}
        <div className="allRow"><span className="muted">to serve it with the house's equipment instead, put it in a Zone card on SYSTEMS › MECHANICAL</span><span style={{ flex: 1 }} /><button className="qaBtn" onClick={p.onCancel}>Cancel</button></div>
      </div>
    </div>
  );
}
