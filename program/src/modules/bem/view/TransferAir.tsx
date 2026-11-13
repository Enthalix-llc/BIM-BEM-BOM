// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// ZONES › TRANSFER AIR (2026-11-11, the user: "indicate spaces that feed unconditioned unoccupied space and spaces that receive
// transfer air from the unconditioned unoccupied space … the air supplied should match actual flow, which at this point is an
// expected air balance"): one row per path — the room that feeds, the void it goes through, the room that receives, the flow —
// staged with the gains (Apply gains writes them). Each path is checked here as it is typed, by the one rule the model uses.

import { resolveTransfers, type TransferPath } from "../core/transferAir.js";
import { NumInput, InfoTip } from "./bemUi.js";

const LS = 0.471947;

export function TransferAir(p: { rooms: Array<{ room: string; zone: string; conditioned: boolean; people: number }>; paths: TransferPath[]; onPaths: (t: TransferPath[]) => void; imperial: boolean;
  /** the engine's design air flow for a room (its sizing, m³/s) — shown beside the flow typed, a reference and never the flow */
  designFlow?: (room: string) => { heating: number; cooling: number } | null }): React.ReactElement {
  const fu = p.imperial ? "cfm" : "L/s", at = (cfm: number): number => (p.imperial ? cfm : cfm * LS), fromU = (v: number): number => (p.imperial ? v : v / LS);
  const rooms = [...p.rooms].sort((a, b) => a.room.localeCompare(b.room));
  // the voids a path may go through: unconditioned and unoccupied — the rest are rooms that feed or receive
  const voids = rooms.filter((r) => !r.conditioned && !(r.people > 0));
  const check = resolveTransfers(p.paths, p.rooms);
  const refusalOf = (t: TransferPath): string | undefined => check.unresolved.find((u) => u.startsWith(`transfer air ${t.from} → ${t.via} → ${t.to}:`));
  const set = (i: number, patch: Partial<TransferPath>): void => p.onPaths(p.paths.map((t, k) => (k === i ? { ...t, ...patch } : t)));
  const flow = (m3s: number): string => (p.imperial ? `${(m3s / 0.000471947443).toFixed(0)}` : `${(m3s * 1000).toFixed(0)}`);
  // per room, what it sends out by its paths and what it receives
  const sent = new Map<string, number>(), got = new Map<string, number>(), through = new Map<string, number>();
  for (const t of p.paths) if (t.cfm > 0) { sent.set(t.from, (sent.get(t.from) ?? 0) + t.cfm); got.set(t.to, (got.get(t.to) ?? 0) + t.cfm); through.set(t.via, (through.get(t.via) ?? 0) + t.cfm); }
  const sel = (v: string, on: (x: string) => void, list: typeof rooms, blank: string): React.ReactElement =>
    <select className={v ? "src-user" : "src-warn"} value={v} onChange={(e) => on(e.target.value)} onClick={(e) => e.stopPropagation()}>
      <option value="">{blank}</option>{list.map((r) => <option key={r.room} value={r.room}>{r.room}{r.zone !== r.room ? ` (${r.zone})` : ""}</option>)}
    </select>;
  return (
    <div className="zoneCards">
      <div className="barHead">TRANSFER AIR THROUGH A VOID<InfoTip text={`a room's air through an unconditioned, unoccupied space (an attic) into another room — written as two ZoneMixing objects at the flow typed: the void receives the first room's air, the second room the void's (the engine moves heat into the RECEIVING zone only; the void's air in equals its air out). The flow is the expected air balance: what the room's supply sends this way. The engine mixes zones, so the void must be a zone of its own — an attic on a room's Zone card is that room's air, and the path is refused until it is taken off the card. Apply gains writes the paths.`} /></div>
      {!p.paths.length && <div className="muted">no transfer air — add a path for each grille path through an attic</div>}
      {p.paths.map((t, i) => {
        const why = refusalOf(t), df = t.from && p.designFlow ? p.designFlow(t.from) : null;
        return (
          <div key={i} className="zoneStat" style={{ flexWrap: "wrap" }}>
            {sel(t.from, (x) => set(i, { from: x }), rooms.filter((r) => r.conditioned), "— the room it leaves —")}
            <span className="muted">→</span>
            {sel(t.via, (x) => set(i, { via: x }), voids, "— the void it crosses —")}
            <span className="muted">→</span>
            {sel(t.to, (x) => set(i, { to: x }), rooms.filter((r) => r.conditioned), "— the room it enters —")}
            <NumInput className={t.cfm > 0 ? "src-user" : "src-warn"} value={t.cfm > 0 ? Number(at(t.cfm).toFixed(1)) : null} placeholder="type" digits={1} min={0} onValue={(v) => set(i, { cfm: v && v > 0 ? fromU(v) : 0 })}
              title="the expected air balance: what the first room's supply sends through this grille path (its supply less what it returns or exhausts itself)" /> {fu}
            <button className="chip" onClick={() => p.onPaths(p.paths.filter((_, k) => k !== i))}>remove</button>
            {df && <span className="muted" title="the engine's own design air flow for the room at its design days (the HVAC Sizing Summary) — what its sensible load asks for under ideal loads, not the system's supply: a reference beside the balance you type">{t.from}'s design air flow {flow(df.heating)} / {flow(df.cooling)} {fu} (heating / cooling)</span>}
            {why ? <div className="src-warn" style={{ flexBasis: "100%" }}>✗ {why.replace(/^transfer air [^:]*: /, "")}</div> : null}
          </div>
        );
      })}
      <div className="allRow">
        <button className="qaBtn" onClick={() => p.onPaths([...p.paths, { from: "", via: "", to: "", cfm: 0 }])}>+ a path</button>
        <span className="muted">{voids.length} unconditioned, unoccupied space{voids.length === 1 ? "" : "s"} a path may cross</span>
      </div>
      {through.size > 0 && <div className="muted">
        {[...through].map(([v, c]) => `${v}: ${at(c).toFixed(0)} ${fu} in = out`).join(" · ")}
        {" · "}{[...sent].map(([r, c]) => `${r} sends ${at(c).toFixed(0)}`).join(" · ")}{" · "}{[...got].map(([r, c]) => `${r} receives ${at(c).toFixed(0)}`).join(" · ")} {fu}
      </div>}
    </div>
  );
}
