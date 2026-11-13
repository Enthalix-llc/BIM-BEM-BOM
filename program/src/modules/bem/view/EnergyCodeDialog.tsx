// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
// THE ENERGY CODE, CONFIRMED (user, 2026-09-29: "a user dialog box to confirm applicable code (which should be based on state
// requirements) as per year of reference (current with past issues listed — for example 'applicable for 6/2018 to 6/2021')"): the
// project's state from the county lookup, the CLIMATE ZONE the user reads for the county in the code's own table, a permit
// (application) date that decides which of the state's adoptions applies, the model codes below them, and what the pick changes in
// this zone before it is staged. The codes and their values are the user's own tables (tables/energy-codes/): no code table ships
// with the program. Nothing is assumed: a state with no adoption on record says so, and with no table at all the dialog says how to
// enter one.

import { useEffect, useState } from "react";
import { ENERGY_CODE_DATA, adoptionsFor, codeFor, resolveCode } from "../core/energyCodes.js";
import { ZONE_TABLE_URL } from "../../../core/climateZone.js";
import { PNNL_NOTICE } from "../core/energyCodes.js";
import { energyCodeLinks } from "../../../core/localSearch.js";
import type { EnergyCodeRuling } from "../core/bemDb.js";

const today = (): string => new Date().toISOString().slice(0, 10);
/** 2021-07-01 → 7/1/2021 */
const md = (d: string): string => { const [y, m, dd] = d.split("-"); return `${Number(m)}/${Number(dd)}/${y}`; };
const U_IP = 5.678263;

/** the factors the writer uses, as they are shown (U in the user's units; the others as the code states them) */
const SHOWN: { key: string; label: string; kind: "u" | "shgc" | "r" | "ach" | "f" }[] = [
  { key: "ceilingU", label: "ceiling / roof U", kind: "u" }, { key: "frameWallU", label: "frame wall U", kind: "u" },
  { key: "basementWallU", label: "basement wall U", kind: "u" }, { key: "floorU", label: "floor U", kind: "u" },
  { key: "fenestrationU", label: "window U", kind: "u" }, { key: "skylightU", label: "skylight U", kind: "u" },
  { key: "fenestrationSHGC", label: "window SHGC", kind: "shgc" }, { key: "slabR", label: "slab R", kind: "r" },
  { key: "ach50", label: "air leakage", kind: "ach" }, { key: "heatingSetpointC", label: "thermostat heat", kind: "f" }, { key: "coolingSetpointC", label: "thermostat cool", kind: "f" },
];

export function EnergyCodeDialog(p: {
  state: string | null; county: string | null; zone: string | null; current: EnergyCodeRuling | undefined; imperial: boolean;
  onUse: (r: EnergyCodeRuling | undefined) => void; onCancel: () => void;
  /** Edit values… (2026-10-16: moved here from SITE's row) — the code's values, typed or copied from a shipped edition */
  onEdit: () => void;
}): React.ReactElement {
  const [findOpen, setFindOpen] = useState(false);
  const [date, setDate] = useState(p.current?.referenceDate ?? today());
  // THE CLIMATE ZONE, as the user reads it for the county in the code's table ("4A") — typed here, kept with the code
  const [zone, setZone] = useState((p.current?.climateZone ?? p.zone ?? "").toUpperCase());
  const okZone = /^[0-8][ABC]?$/.test(zone.trim());
  const noTables = ENERGY_CODE_DATA.editions.length === 0;
  const ownEditions = ENERGY_CODE_DATA.editions.filter((e) => !e.shipped), shippedEditions = ENERGY_CODE_DATA.editions.filter((e) => e.shipped);
  // unconfirmed, the dialog opens on the state's adoption in force today — the proposal, never staged until Use
  const [pick, setPick] = useState<string>(() => p.current?.adoption ?? (p.state ? adoptionsFor(p.state, today()).find((a) => a.inForce && a.usable)?.id : undefined) ?? resolveCode(null).edition.id);
  useEffect(() => { const h = (e: KeyboardEvent): void => { if (e.key === "Escape") p.onCancel(); }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [p]);
  const okDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const rows = p.state && okDate ? adoptionsFor(p.state, date) : [];
  const inForce = rows.find((a) => a.inForce) ?? null;
  const now = codeFor(p.current?.adoption ?? null, p.zone), next = codeFor(pick, okZone ? zone : p.zone);
  const fmt = (t: typeof now, s: (typeof SHOWN)[number]): string => {
    const v = (t as unknown as Record<string, number | null>)[s.key];
    if (v === null || v === undefined) return s.kind === "shgc" ? "NR" : "—";
    if (Number.isNaN(v)) return "not entered";
    return s.kind === "u" ? (p.imperial ? v.toFixed(3) : (v * U_IP).toFixed(3)) : s.kind === "r" ? (v > 0 ? `R-${v}` : "none") : s.kind === "ach" ? `${v} ACH50` : s.kind === "f" ? (p.imperial ? `${(v * 1.8 + 32).toFixed(0)} °F` : `${v.toFixed(1)} °C`) : v.toFixed(2);
  };
  const pickLabel = resolveCode(pick).adoption?.label ?? resolveCode(pick).edition.label;
  const editionRow = (e: (typeof ENERGY_CODE_DATA.editions)[number]): React.ReactElement => (
    <tr key={e.id} className={pick === e.id ? "on" : ""} onClick={() => setPick(e.id)} title={e.shipped ? PNNL_NOTICE : undefined}>
      <td><input type="radio" checked={pick === e.id} onChange={() => setPick(e.id)} /></td>
      <td>{e.label}{e.id === resolveCode(null).edition.id ? <span className="muted"> · the default when none is ruled</span> : null}</td><td>{e.ircEquivalent}</td><td>—</td><td>—</td>
      <td>{e.sourceUrl ? <a href={e.sourceUrl} target="_blank" rel="noreferrer">read {e.readOn}</a> : "—"}</td>
    </tr>
  );
  return (
    <div className="menuScrim dialogScrim" onPointerDown={p.onCancel}>
      <div className="dialog codeDialog" role="dialog" aria-label="the energy code" onPointerDown={(e) => e.stopPropagation()}>
        <div className="dialogHead">the energy code for this project</div>
        {/* FIND (user, 2026-10-16: "add Find button on Choose button dialog, so the user can search locally for reference"): the code the
            state and county adopted, in the user's own browser; EDIT VALUES: a code of the user's own, or a shipped edition copied */}
        <div className="allRow">
          <button className="qaBtn" onClick={() => setFindOpen((x) => !x)} title="look up the energy code adopted where the site is — in your browser">Find…</button>
          <button className="qaBtn" onClick={p.onEdit} title="enter or correct a code's values — U-factors, SHGC, slab, air leakage, thermostat — as you read them in the code; or copy a DOE/PNNL edition into a code of your own">Edit values…</button>
          {findOpen && <span className="codeFind">{energyCodeLinks(p.state, p.county).map((l) => (
            <button key={l.url} className="chip" title={`${l.tip}\n${l.url}`} onClick={() => void window.bem.openBrowser(l.url)}>{l.label} ↗</button>
          ))}{!p.state && <span className="muted"> · the site is in no county yet — locate it on the map for the state's page</span>}</span>}
        </div>
        {!noTables && ownEditions.length === 0 && <div className="muted" style={{ margin: "6px 0 10px" }}>
          No code table of your own is on record: the DOE/PNNL prototype values that ship with BIM-BEM-BOM are offered below, by IECC edition. To use
          the code your project is under as the code states it, enter its values with Edit values… above.
        </div>}
        {noTables && <div className="bad" style={{ margin: "6px 0 10px" }}>
          No energy code is on record. BIM-BEM-BOM ships no code tables: a code is its publisher's. Read the code your project is under — the
          IECC is free to read (read-only) at <a href={ZONE_TABLE_URL} target="_blank" rel="noreferrer">codes.iccsafe.org</a> — and enter
          its values with <b>Edit values…</b> (kept in the project's <code>tables/energy-codes/</code>); the empty templates and how to fill them are in <code>references/energy-codes/README.md</code>.
          The app reads them when it starts.
        </div>}
        <div className="allRow">
          <label title="the IECC assigns every US county a zone (Table R301.1 residential, C301.1 commercial) — read your county's row in the code's table">climate zone <input value={zone} onChange={(e) => setZone(e.target.value.toUpperCase())} placeholder="e.g. 4A" style={{ width: 54 }} /></label>
          {!okZone && <span className="bad">enter the zone your county's row in the code's table states (a number 0–8 and its moisture letter)</span>}
          <a href={ZONE_TABLE_URL} target="_blank" rel="noreferrer" title="the code's climate-zone table, by state and county — free, read-only">read the code's county table</a>
        </div>
        <div className="allRow">
          <span>location: {p.state ? <b className="src-dataset">{p.county ? `${p.county} County, ` : ""}{p.state}</b> : <b className="bad">not placed in any county — the state is not known</b>} · climate zone in force <b className={p.zone ? "src-user" : "bad"}>{p.zone || "not entered (zone 4's row assumed until it is)"}</b></span>
          <label title="codes apply by the date the permit is applied for — the adoption in force on this date is the one that applies">permit (application) date <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        </div>
        <table className="codeTable">
          <thead><tr><th /><th>code</th><th>base</th><th>applicable</th><th>amended</th><th>source</th></tr></thead>
          <tbody>
            <tr className="grp"><td colSpan={6}>{p.state ? `${p.state}'s adoptions, newest first` : "the state's adoptions"}</td></tr>
            {rows.map((a) => (
              <tr key={a.id} className={`${pick === a.id ? "on" : ""}${a.usable ? "" : " off"}`} onClick={() => { if (a.usable) setPick(a.id); }} title={a.usable ? a.amendments : `${a.why}${a.amendments ? ` — ${a.amendments}` : ""}`}>
                <td><input type="radio" checked={pick === a.id} disabled={!a.usable} onChange={() => setPick(a.id)} /></td>
                <td>{a.label}{a.inForce ? <span className="src-user"> · in force on {md(date)}</span> : a.grace ? <span className="src-user"> · may still be used until {md(a.graceUntil!)} (the grace year)</span> : null}{!a.usable && <span className="muted"> · {a.why}</span>}</td>
                <td>{ENERGY_CODE_DATA.editions.find((e) => e.id === a.baseEdition)?.label ?? (a.baseEdition || "—")}</td>
                <td>{!a.from ? "date not stated" : a.to ? `${md(a.from)} to ${md(a.to)}` : `since ${md(a.from)}`}{a.scope && a.scope !== "statewide" ? ` · ${a.scope}` : ""}</td>
                <td title={a.amendments}>{a.amended ? "yes" : "no"}</td>
                <td>{a.sourceUrl ? <a href={a.sourceUrl} target="_blank" rel="noreferrer">read {a.readOn}</a> : "—"}</td>
              </tr>
            ))}
            {p.state && rows.length === 0 && <tr><td /><td colSpan={5} className="bad">no adoption of {p.state}'s is on record in the project's code tables — choose a model code below, or add the state's rows</td></tr>}
            {p.state && rows.length > 0 && !inForce && okDate && <tr><td /><td colSpan={5} className="bad">none of {p.state}'s adoptions on record was in force on {md(date)}</td></tr>}
            <tr className="grp"><td colSpan={6}>model codes, as published — not a state's law; for a study or a comparison</td></tr>
            {ownEditions.map((e) => editionRow(e))}
            {ownEditions.length === 0 && <tr><td /><td colSpan={5} className="muted">none of your own — Edit values… enters one</td></tr>}
            {shippedEditions.length > 0 && <tr className="grp"><td colSpan={6} title={PNNL_NOTICE}>DOE/PNNL residential prototype values, by IECC edition — shipped with BIM-BEM-BOM; not a state's law</td></tr>}
            {shippedEditions.map((e) => editionRow(e))}
          </tbody>
        </table>
        <div className="muted">what the code default reads in zone {next.zone} (row {next.row}{next.note ? `: ${next.note}` : ""}) — U in {p.imperial ? "Btu/h·ft²·°F" : "W/m²K"}; a changed value in amber:</div>
        <table className="codeTable preview">
          <thead><tr><th /><th>now</th><th>{pickLabel}</th></tr></thead>
          <tbody>{SHOWN.map((s) => { const a = fmt(now, s), b = fmt(next, s); return <tr key={s.key}><td>{s.label}</td><td>{a}</td><td className={a !== b ? "src-user" : ""} title={next.cites[s.key]}>{b}</td></tr>; })}</tbody>
        </table>
        <div className="allRow">
          <button className="apply" disabled={!okDate || !okZone || noTables} onClick={() => p.onUse({ adoption: pick, referenceDate: date, confirmedAt: new Date().toISOString(), climateZone: zone.trim() })}>Use {pickLabel}</button>
          {p.current && <button className="qaBtn" onClick={() => p.onUse(undefined)} title="clear the ruling — the table's default edition reads again, and the zone is no longer entered">clear</button>}
          <button className="qaBtn" onClick={p.onCancel}>cancel</button>
          <span className="muted">staged — Apply on SITE writes it; the constructions' code defaults follow</span>
        </div>
      </div>
    </div>
  );
}
