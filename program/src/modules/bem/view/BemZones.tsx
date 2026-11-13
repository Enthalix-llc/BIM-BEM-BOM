// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// ZONES — the grid: what each zone runs on, one row per zone, every cell in
// its source's colour, read back from bem.db. In this slice a reading; the
// inputs, the staged Apply and the gains columns come next. A row click
// selects the zone in the ZONES view; the selected row is lit.

import type { BemModelOutcome } from "../pipeline.js";
import type { Lens, Legend } from "../core/bemPaint.js";
import { type Assembly, type ZoneAssign, type CompiledAssembly, NODE_LABEL, isAssignable, isAirLoop, patchNode, TERMINAL_CLASSES, defaultTerminalFor } from "../core/assembly.js";
import { srcClass, fmtTemp, LensPicker, NumInput, InfoTip } from "./bemUi.js";
import { zoneColor } from "./SystemsAssembly.js";
import { ZoneSides } from "./ComponentSettings.js";
import { ieccFor } from "../core/bemIdf.js";
import { INFIL_FIELD, INFIL_ROW_FIELD, COEFF_SOURCE, ELA, elaCm2, type InfilMethod, type InfilTable } from "../core/infiltration.js";
import type { AsmNode } from "../core/assembly.js";
import type { TransferPath } from "../core/transferAir.js";
import { TransferAir } from "./TransferAir.js";

/** THE ZONE'S INFILTRATION (user, 2026-10-08: "build it into Zones"): the code's rate until typed, a constant ACH (the garage's
 *  door openings), or the blower-door ACH50 — written as the engine's effective leakage area, driven by the weather each hour */
function ZoneInfiltration(p: { node: AsmNode; volumeM3: number | null; codeAch: number; codeAch50: number; codeLabel: string; onPatch: (f: (n: AsmNode) => AsmNode) => void; table?: InfilTable | null }): React.ReactElement {
  const f = p.node.fields ?? {};
  const method: InfilMethod = f[INFIL_FIELD.method] === "ach" || f[INFIL_FIELD.method] === "ach50" ? (f[INFIL_FIELD.method] as InfilMethod) : "code";
  const num = (k: string): number | null => (typeof f[k] === "number" ? (f[k] as number) : null);
  const set = (patch: Record<string, string | number | undefined>): void => p.onPatch((x) => {
    const g: Record<string, string | number> = { ...(x.fields ?? {}) } as Record<string, string | number>;
    for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete g[k]; else g[k] = v; }
    const m = { ...x }; if (Object.keys(g).length) m.fields = g as AsmNode["fields"]; else delete m.fields; return m;
  });
  const setMethod = (m: InfilMethod): void => set(m === "code"
    ? { [INFIL_FIELD.method]: undefined, [INFIL_FIELD.ach]: undefined, [INFIL_FIELD.ach50]: undefined, [INFIL_FIELD.cs]: undefined, [INFIL_FIELD.cw]: undefined }
    : { [INFIL_FIELD.method]: m });
  const ach = num(INFIL_FIELD.ach), ach50 = num(INFIL_FIELD.ach50), cs = num(INFIL_FIELD.cs), cw = num(INFIL_FIELD.cw);
  const ela = method === "ach50" && ach50 && p.volumeM3 ? elaCm2(ach50, p.volumeM3) : null;
  return (
    <div className="zoneStat" title="what leaks through this zone's envelope — typed here, the one place; Save writes it with the sheet">
      <span className="muted">infiltration</span>
      <select className={method === "code" ? "src-code" : "src-user"} value={method} onChange={(e) => setMethod(e.target.value as InfilMethod)} onClick={(e) => e.stopPropagation()}>
        <option value="code">the code's {p.codeAch.toFixed(2)} ACH</option>
        <option value="ach50">blower door · ACH50</option>
        <option value="ach">constant · ACH</option>
      </select>
      {method === "code" && <span className="muted">{p.codeLabel}</span>}
      {method === "ach" && <>
        <NumInput className={ach === null ? "src-code" : "src-user"} value={ach} placeholder={p.codeAch.toFixed(2)} onValue={(v) => set({ [INFIL_FIELD.ach]: v ?? undefined })} digits={3} min={0} /> ACH
        <span className="muted">every hour the same — ZoneInfiltration:DesignFlowRate{ach === null ? " · type the rate; until then the code's is written" : ""}</span>
      </>}
      {method === "ach50" && <>
        <NumInput className={ach50 === null ? "src-code" : "src-user"} value={ach50} placeholder={String(p.codeAch50)} onValue={(v) => set({ [INFIL_FIELD.ach50]: v ?? undefined })} digits={2} min={0} title="air changes an hour at 50 Pa — the blower-door test's number (the code's limit until tested)" /> ACH50
        {p.table && (() => {
          // A TABLE THE PROJECT NAMES (2026-11-12): storeys and shelter pick its row and FILL Cs and Cw — the numbers stay the card's
          const t = p.table, st = String(num(INFIL_ROW_FIELD.stories) ?? ""), sh = String(num(INFIL_ROW_FIELD.shelter) ?? "");
          const fill = (stories: string, shelter: string): void => { const cs2 = t.stack[stories], cw2 = t.wind[shelter]?.[stories]; set({ [INFIL_ROW_FIELD.stories]: Number(stories) || undefined, [INFIL_ROW_FIELD.shelter]: Number(shelter) || undefined, ...(cs2 !== undefined && cw2 !== undefined ? { [INFIL_FIELD.cs]: cs2, [INFIL_FIELD.cw]: cw2 } : {}) }); };
          return <>
            <label title={`the storeys the house's air column spans — the stack coefficient's row (${t.cite})`}>storeys <select value={st} onChange={(e) => fill(e.target.value, sh)} onClick={(e) => e.stopPropagation()}><option value="">—</option>{Object.keys(t.stack).map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
            <label title={`the wind's shielding (${t.cite})${sh && t.shelterWords?.[sh] ? ` — ${t.shelterWords[sh]}` : ""}`}>shelter <select value={sh} onChange={(e) => fill(st, e.target.value)} onClick={(e) => e.stopPropagation()}><option value="">—</option>{Object.keys(t.wind).map((n) => <option key={n} value={n} title={t.shelterWords?.[n]}>{n}</option>)}</select></label>
          </>;
        })()}
        <label title={`the stack coefficient, (L/s)²/(cm⁴·K) — EnergyPlus requires it and has no default: ${COEFF_SOURCE}`}>Cs <NumInput className={cs === null ? "bad" : "src-user"} value={cs} onValue={(v) => set({ [INFIL_FIELD.cs]: v ?? undefined })} digits={6} min={0} /></label>
        <label title={`the wind coefficient, (L/s)²/(cm⁴·(m/s)²) — by the house's storeys and its shelter: ${COEFF_SOURCE}`}>Cw <NumInput className={cw === null ? "bad" : "src-user"} value={cw} onValue={(v) => set({ [INFIL_FIELD.cw]: v ?? undefined })} digits={6} min={0} /></label>
        <InfoTip text={`ZoneInfiltration:EffectiveLeakageArea — the flow each hour = A × √(Cs·ΔT + Cw·U²): the indoor-outdoor ΔT drives the stack, the wind the rest, so a mild calm hour leaks little and a cold windy one more. A, the effective leakage area at ${ELA.refPa} Pa, from the ACH50 and the zone's volume (ASHRAE Fundamentals ch. 16, n ${ELA.n}, C_D ${ELA.cd}): 0.354 cm² per cfm50. Cs and Cw as typed — ${COEFF_SOURCE}. Until both are typed the model is not written.`} />
        <span className="muted">{ach50 === null ? "type the ACH50; until then the code's rate is written" : ela !== null ? `→ ${ela.toFixed(0)} cm² (${(ela / 6.4516).toFixed(1)} in²) leakage area` : "the zone has no volume — the code's rate is written"}</span>
      </>}
    </div>
  );
}

export function BemZones(p: { model: BemModelOutcome | null; selectedZone: string | null; onZone: (z: string | null) => void; imperial: boolean;
  /** a Cs/Cw table the project's data sources name (2026-11-12) — fills the Zone card's coefficients */
  infilTable?: InfilTable | null;
  lens: Lens; legend: Legend | null; hasRun: boolean; onLens: (l: Lens) => void;
  /** the SYSTEMS assembly's components and the zones' assignment to them (user, 2026-09-10: zones are assigned here, not drawn on the sheet) */
  assembly: Assembly; assign: ZoneAssign; onAssign: (zone: string, ids: string[]) => void; pending: number; onApply: () => void; onRevert: () => void; busy: boolean;
  /** ZONES BY LEVEL (2026-10-16): one zone per level, holding the level's rooms in no zone — staged */
  onByLevel?: () => void;
  /** THE ZONES DRAWN ON THE SHEET (2026-09-10): each with its rooms and its thermostat, edited on its node */
  compiled: CompiledAssembly; onAssembly: (a: Assembly) => void;
  /** THE FRAME'S SUBJECT (2026-09-13): a room's name under a zone's card selects it; the gains staged in the frame apply here */
  selectedSpace: string | null; onSpace: (room: string, zone: string) => void; gainPending: number; onApplyGains: () => void; onRevertGains: () => void;
  /** A ROOM IS A BEDROOM (the user, 2026-10-07): the tick, as staged with the gains (Apply gains saves it); the one place it is said */
  isBedroom: (room: string) => boolean; onBedroom: (room: string, on: boolean) => void;
  /** TRANSFER AIR THROUGH A VOID (2026-11-11): the paths as staged with the gains, and a room's design air flow from the last run */
  transfers: TransferPath[]; onTransfers: (t: TransferPath[]) => void; designFlow?: (room: string) => { heating: number; cooling: number } | null }): React.ReactElement {
  const m = p.model;
  const tempIn = (c: number | undefined, dflt: number): number => Number(((p.imperial ? (c ?? dflt) * 9 / 5 + 32 : c ?? dflt)).toFixed(1));
  const heldBy = p.compiled.roomZone;
  if (!m) return <div className="idfBar bemCol"><div className="idfInfo">no model yet — build the envelope, then open a BEM tab</div></div>;
  // the code table the model reads (its zone, its edition) — never a number written here
  const code = ieccFor(m.built.model.climateZone, m.built.model.energyCode);
  const rows = [...m.zones].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "room" ? -1 : 1));
  const cond = rows.filter((z) => z.conditioned).length;
  const fV = (v: number): string => (p.imperial ? `${(v * 35.3147).toFixed(0)} ft³` : `${v.toFixed(1)} m³`);
  // what a zone is assigned to (user, 2026-09-10): zone equipment or an air TERMINAL — an air loop serves through its terminals
  const nodeLabel = (id: string): string => { const n = p.assembly.nodes.find((x) => x.id === id); return n ? n.label ?? NODE_LABEL[n.kind] : id; };
  const onLoop = (id: string): string => { const l = p.assembly.edges.filter((e) => e.from === id || e.to === id).map((e) => p.assembly.nodes.find((x) => x.id === (e.from === id ? e.to : e.from))).find((x) => x && isAirLoop(x.kind)); return l ? ` · on ${nodeLabel(l.id)}` : ""; };
  const systems = p.assembly.nodes.filter((n) => isAssignable(n.kind) && n.kind !== "exhaust" && n.kind !== "wholehouse");
  const fans = p.assembly.nodes.filter((n) => n.kind === "exhaust");
  const sysOf = (z: string): string => (p.assign[z] ?? []).find((id) => systems.some((n) => n.id === id)) ?? "";
  const fanOf = (z: string): string => (p.assign[z] ?? []).find((id) => fans.some((n) => n.id === id)) ?? "";
  const setSys = (z: string, id: string): void => p.onAssign(z, [...(p.assign[z] ?? []).filter((x) => !systems.some((n) => n.id === x)), ...(id ? [id] : [])]);
  const setFan = (z: string, id: string): void => p.onAssign(z, [...(p.assign[z] ?? []).filter((x) => !fans.some((n) => n.id === x)), ...(id ? [id] : [])]);
  const applied = new Map(m.systems.filter((r) => r.source !== "code-default").flatMap((r) => r.zones.map((z) => [z, r.id] as const)));
  return (
    <div className="idfBar bemCol">
      <LensPicker lens={p.lens} legend={p.legend} hasRun={p.hasRun} onLens={p.onLens} imperial={p.imperial} />
      <div className="allRow">
        <button className="apply" disabled={p.pending === 0 || p.busy} onClick={p.onApply} title="the zone assignments and the SYSTEMS sheet are one thing: Save writes both into idf.db's system_* tables and the ledger keyed to this file, and rebuilds the model">
          {p.pending === 0 ? "✓ saved — no changes" : `Save · ${p.pending} change${p.pending > 1 ? "s" : ""}`}
        </button>
        {p.pending > 0 && <button className="chip" onClick={p.onRevert}>revert</button>}
        {p.onByLevel && <button className="qaBtn" disabled={p.busy} onClick={p.onByLevel} title="one zone per level, named for it, holding the level's rooms that are in no zone yet — the attics stay their own zones. Staged: Save keeps it, revert drops it">Zones by level</button>}
        <span className="muted">{systems.length ? `${systems.length} zone equipment or terminal${systems.length === 1 ? "" : "s"} on the SYSTEMS sheet` : "no zone equipment or terminal on the SYSTEMS sheet — every conditioned zone runs on ideal loads"}{fans.length ? ` · ${fans.length} exhaust fan${fans.length === 1 ? "" : "s"}` : ""}</span>
      </div>
      <div className="allRow">
        <button className="apply" disabled={p.gainPending === 0 || p.busy} onClick={p.onApplyGains} title="the gains ruled in the frame below the view — by zone and by room — into the ledger keyed to this file; the model rebuilds">{p.gainPending === 0 ? "✓ gains applied — nothing staged" : `Apply · ${p.gainPending} gain ruling${p.gainPending > 1 ? "s" : ""}`}</button>
        {p.gainPending > 0 && <button className="chip" onClick={p.onRevertGains}>revert</button>}
        <InfoTip text="People, Lights and ElectricEquipment on every conditioned room by default (BAHSP 2014, the file's fixtures, the engine's example) — edited per zone or per room in the frame below the view" />
      </div>
      <div className="idfInfo">
        <span title="the code's thermostat and infiltration — every zone's until typed on its card">{cond} of {rows.length} zones conditioned</span> · thermostat <span className="src-code" title={code.cites.heatingSetpointC}>{fmtTemp(code.heatingSetpointC, p.imperial, 0)} / {fmtTemp(code.coolingSetpointC, p.imperial, 0)}</span> · infiltration <span className="src-code">{Number.isNaN(code.ach50) ? "not entered" : `${(code.ach50 / 20).toFixed(2)} ACH`}</span>
        <InfoTip text={`conditioned by name (attics, crawl spaces and garages are not) · thermostat ${fmtTemp(code.heatingSetpointC, p.imperial, 0)} / ${fmtTemp(code.coolingSetpointC, p.imperial, 0)}, the code's — ${code.cites.heatingSetpointC} (your ruling, 2026-10-07) · infiltration ${code.ach50} ACH50 (${code.edition.label}, climate zone ${code.zone}, the code table's row ${code.row}) ÷ 20 = ${(code.ach50 / 20).toFixed(2)} ACH — ACH ≈ ACH50 / N with N ≈ 20, Sherman (1987), 'Estimation of infiltration from leakage and climate indicators', Energy and Buildings 10: the LBL rule of thumb for a low-rise house in a mild climate; 0.5 ACH on an unconditioned zone is a stated default · gains on every conditioned room by default (the frame below the view) · no ventilation until ruled`} />
      </div>
      {p.compiled.zones.length > 0 && (
        <div className="zoneCards">
          <div className="barHead">ZONES ON THE SYSTEMS SHEET<InfoTip text="each holds its rooms as ONE thermal zone (a Space each); a unit's Air out into its Air in serves it through the damper the zone carries (its setting on the sheet), zone equipment joins by Loc; the T is the zone's thermostat" /></div>
          {p.compiled.zones.map((z) => {
            const node = p.assembly.nodes.find((x) => x.id === z.id);
            const refused = p.compiled.refusals.filter((r) => r.node === z.id).map((r) => r.text);
            const sideOff = p.compiled.cautions.filter((r) => r.node === z.id && /switched off on this Zone card/.test(r.text)).map((r) => r.text);
            const fed = z.fedBy ? nodeLabel(z.fedBy) : null;
            // the control the zone's unit is under (2026-09-13): the thermostat's words and the damper follow it
            const unit = p.compiled.hvac.find((h) => h.zones.includes(z.name)) ?? null, fw = unit?.wired ?? null, sp = fw?.control === "SetPoint";
            // ONE HEAT PUMP PER THERMOSTAT (2026-09-13): the zone's own unit, named card + zone, when its card was split
            const ownUnit = unit && z.fedBy && p.compiled.splitIds?.[z.fedBy] ? unit.id : null;
            const damper = fw ? (z.terminal?.cls ?? defaultTerminalFor(fw.parent)) : null;
            return (
              <div key={z.id} className={`zoneCard${z.name === p.selectedZone ? " sel" : ""}`} style={{ borderLeftColor: zoneColor(z.id) }}>
                <div className="zoneHead" onClick={() => p.onZone(z.name === p.selectedZone ? null : z.name)}><b style={{ color: zoneColor(z.id) }}>{z.name}</b> <span className="muted">· {z.rooms.length} room{z.rooms.length === 1 ? "" : "s"} · {fed ? <span className="src-user">served by {fed}{ownUnit ? ` · its own unit ${ownUnit}` : ""}{z.fans.length ? ` · exhaust ${z.fans.map(nodeLabel).join(", ")}` : ""}</span> : <span className="src-code">ideal loads — connect a terminal or zone equipment to its Air in on the sheet</span>}</span></div>
                <div className="zoneRooms">{z.rooms.map((r) => <span key={r} className={`asmPill clickable${r === p.selectedSpace ? " sel" : ""}`} title="select this room: its cells light in the model and the frame below the view reads it" onClick={(e) => { e.stopPropagation(); p.onSpace(r, z.name); }}>{r}</span>)}{!z.rooms.length && <span className="src-warn">no rooms — drag rooms from LEVELS · SPACES onto the zone on the sheet</span>}</div>
                {/* THE BEDROOMS (2026-10-07): a tick per room — the people, the ventilation rate and the hot-water use count them */}
                {z.rooms.some((r) => !/^(attic|interstitial)\b/i.test(r)) && <div className="zoneBeds" title="a bedroom counts in the occupants (BAHSP 2014), the whole-house ventilation rate (ASHRAE 62.2: bedrooms + 1) and the hot-water use of the dwelling card that serves it (30 + 10 × bedrooms gal/day) — ticked here, the one place; unticked rooms named &quot;Bed n&quot; start ticked">
                  <span className="muted">bedrooms:</span>{z.rooms.filter((r) => !/^(attic|interstitial)\b/i.test(r)).map((r) => (
                    <label key={r} className={p.isBedroom(r) ? "src-user" : "muted"}><input type="checkbox" checked={p.isBedroom(r)} onChange={(e) => p.onBedroom(r, e.target.checked)} />{r}</label>
                  ))}
                </div>}
                {node?.thermostat === false && <div className="muted">thermostat <span className="src-code">off</span> — {sp ? `served at minimum flow, no thermostat: its damper holds its minimum and it reports no demand to ${fed}` : "served, not controlled: the zone takes what the unit's supply gives"} (switch it on with the T on the sheet)</div>}
                {node?.thermostat !== false && fw && <div className="muted">thermostat <span className="src-user">on</span> — {sp ? `reports its demand to ${fed}; the zone with the highest demand sets the supply setpoint, the zones' vote sets the mode` : fw.controlZone === z.name ? (ownUnit ? `its own unit ${ownUnit} follows it — one heat pump per thermostat (the note on the card)` : `${fed}'s control zone (${fw.control ?? "Load"} control follows one thermostat)`) : `a second thermostat on ${fed}, which follows ${fw.controlZone || "another zone"} — set its control to SetPoint for a thermostat in every zone`}</div>}
                {damper && <div className="muted">damper: {TERMINAL_CLASSES.find((t) => t.cls === damper)?.label ?? damper} <span className="src-code">{damper}</span>{z.terminal?.cls ? "" : " (the unit's default; the Zone's setting on the sheet)"}</div>}
                {node?.thermostat !== false && <div className="zoneStat">
                  {node && <ZoneSides node={node} feeder={unit} imperial={p.imperial} compact onPatch={(f) => p.onAssembly(patchNode(p.assembly, z.id, f))} />}
                  <span className="muted">the code's thermostat {fmtTemp(code.heatingSetpointC, p.imperial, 0)} / {fmtTemp(code.coolingSetpointC, p.imperial, 0)} until typed · a side unchecked is put out of reach so nothing calls for it</span>
                </div>}
                {node && <ZoneInfiltration node={node} volumeM3={m.zones.find((q) => q.name === z.name)?.volumeM3 ?? null} codeAch={code.ach50 / 20} codeAch50={code.ach50} codeLabel={`${code.ach50} ACH50 (${code.edition.label}) ÷ 20, every hour the same`} onPatch={(f) => p.onAssembly(patchNode(p.assembly, z.id, f))}  table={p.infilTable} />}
                {refused.length > 0 && <div className="src-warn">refused: {refused.join(" · ")}</div>}
                {sideOff.length > 0 && <div className="src-warn">⚠ {sideOff.join(" · ")}</div>}
              </div>
            );
          })}
        </div>
      )}
      <TransferAir rooms={m.rooms} paths={p.transfers} onPaths={p.onTransfers} imperial={p.imperial} designFlow={p.designFlow} />
      <div className="qaPanel">
        <table>
          <thead><tr><th>zone</th><th>kind</th><th>volume</th><th>cond.</th><th title="the SAVED model's heating setpoint — it changes when the sheet is saved and the model rebuilt; the zone's card above is where it is typed">saved heat</th><th title="the SAVED model's cooling setpoint — it changes on Save">saved cool</th><th>infil ACH</th><th>system</th>{fans.length > 0 && <th>exhaust</th>}</tr></thead>
          <tbody>
            {rows.map((z) => (
              <tr key={z.name} className={z.name === p.selectedZone ? "sel" : ""} onClick={() => p.onZone(z.name === p.selectedZone ? null : z.name)}>
                <td>{z.name}</td>
                <td>{z.kind}</td>
                <td>{fV(z.volumeM3)}</td>
                <td title={`${z.conditionedSource === "user" ? "taken by a ruled system" : "by the zone's name (attics, crawl spaces and garages are not)"} — a per-zone conditioning ruling exists in the ledger and no screen writes it yet (the tab review, ZONES item 2)`}>{z.conditioned ? "yes" : "no"}</td>
                <td className={srcClass(z.setpointSource)}>{z.heatingSetpointC !== null ? fmtTemp(z.heatingSetpointC, p.imperial, 0) : ""}</td>
                <td className={srcClass(z.setpointSource)}>{z.coolingSetpointC !== null ? fmtTemp(z.coolingSetpointC, p.imperial, 0) : ""}</td>
                <td className={srcClass(z.infiltrationSource as "user")} title={z.infiltrationNote ? `the SAVED model: ${z.infiltrationNote} — the hourly rate follows the weather; RUN reads it` : `the SAVED model's constant rate — ${z.infiltrationSource === "user" ? "typed on the zone's card" : `${code.ach50} ACH50 ÷ 20 (Sherman 1987, the N-factor rule of thumb); 0.5 for a zone outside the envelope`} — typed on the zone's card above`}>{z.infiltrationNote ? `${z.infiltrationNote.split(" ")[0]} ACH50` : z.infiltrationAch === null ? "not entered" : z.infiltrationAch.toFixed(2)}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  {heldBy[z.name] ? <span className="src-user" title="this room is held by a zone drawn on the sheet; what connects to that zone serves it">in {heldBy[z.name]}</span> : systems.length ? (
                    <select className={srcClass(sysOf(z.name) ? "user" : "code-default")} value={sysOf(z.name)} onChange={(e) => setSys(z.name, e.target.value)} title={applied.has(z.name) ? `applied: ${applied.get(z.name)}` : "applied: ideal loads (the code default)"}>
                      <option value="">{z.conditioned ? "ideal loads" : "none"}</option>
                      {systems.map((n) => <option key={n.id} value={n.id}>{n.label ?? NODE_LABEL[n.kind]}{n.kind === "terminal" ? onLoop(n.id) : ""}</option>)}
                    </select>
                  ) : <span className="src-code">{z.conditioned ? "ideal loads" : "—"}</span>}
                </td>
                {fans.length > 0 && <td onClick={(e) => e.stopPropagation()}>
                  <select className={srcClass(fanOf(z.name) ? "user" : "code-default")} value={fanOf(z.name)} onChange={(e) => setFan(z.name, e.target.value)}>
                    <option value="">—</option>
                    {fans.map((n) => <option key={n.id} value={n.id}>{n.label ?? NODE_LABEL[n.kind]}</option>)}
                  </select>
                </td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="idfInfo">values: file {m.census.file} · code default {m.census["code-default"]} · user {m.census.user}</div>
    </div>
  );
}
