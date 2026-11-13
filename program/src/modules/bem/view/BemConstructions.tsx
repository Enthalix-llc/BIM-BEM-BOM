// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// CONSTRUCTIONS — the five sections the user set (2026-09-08): Roof (incl.
// skylights) · Wall · Window · Door · Floors (incl. ground-coupled), each
// header a summary, each row one TYPE the file names with what GOVERNS its
// construction — the code default, the file's stated U, a dataset
// construction, or a typed U / NFRC set — staged and applied with one
// counted button (the SITE pattern). THE FILE'S OWN WORD sits beside every
// row: its stated U, flagged when no opaque assembly could have it.

import { useEffect, useRef, useState } from "react";
import { sanitizeIdfName, codeCatalogue, catalogueKindOf, CODE_VT, ROOF_SHADE_REASON, ieccFor } from "../core/bemIdf.js";
import type { BemModelOutcome } from "../pipeline.js";
import type { BemLedger, ConstructionRuling, ConsSource, GroundRuling } from "../core/bemDb.js";
import { cFactor, slabPlan, slabFactors, groundMethodOf, DEFAULT_GROUND_METHOD, F_TABLE_CITE, C_TABLE_CITE , fFromTable, cFromTable, type GroundTable } from "../core/groundCoupling.js";
import type { Library } from "../core/idfLib.js";
import { windowNote } from "../core/idfLib.js";
import { TYPE_SECTIONS, SECTION_TITLES, type TypeRow, type TypeSection } from "../constructionTypes.js";
import { foldRows, layerSignature, sharesName, fenValues } from "../constructionTypes.js";
import { fmtArea, srcClass, NumInput, InfoTip } from "./bemUi.js";
import { GroundFacts, type DetailInput } from "./constructionDetail.js";
import { FenReference } from "./FenReference.js";
import { EnvelopeLosses } from "./EnvelopeLosses.js";
import type { GlazingProduct } from "../core/materialsDb.js";

const U_IP = 5.678263;
// NaN: the code's value is not on record (2026-10-15) — said, never a number
export const fmtU = (u: number | null, imperial: boolean): string => (u === null ? "—" : Number.isNaN(u) ? "not entered" : imperial ? `${(u / U_IP).toFixed(3)}` : `${u.toFixed(3)}`);

/** the dataset constructions a section may take: composites and the HOF sets for the opaque sections, the window constructs for glass */
function candidates(lib: Library | null, sec: TypeSection, glazed: boolean): Array<{ name: string; file: string; note: string }> {
  if (!lib) return [];
  const cons = lib.byClass.get("Construction") ?? [];
  const win = (o: { file: string }): boolean => o.file.startsWith("WindowConstructs");
  const pick = glazed || sec === "Window"
    ? cons.filter(win).map((o) => { const n = windowNote(o); return { name: o.name, file: o.file, note: n ? `U ${n.u.toFixed(2)} · SHGC ${n.shgc.toFixed(2)}${n.tvis !== null ? ` · VT ${n.tvis.toFixed(2)}` : ""}` : "" }; })
    : cons.filter((o) => !win(o) && (sec === "Wall" ? /Wall|Partition/i.test(o.name) : sec === "Roof" ? /Roof/i.test(o.name) : sec === "Ceiling" ? /Ceiling/i.test(o.name) : sec === "Floors" ? /Floor/i.test(o.name) : sec === "Door" ? /Wall|Partition/i.test(o.name) : true))
      .map((o) => ({ name: o.name, file: o.file, note: o.file.startsWith("Composite") ? "composite" : "HOF" }));
  return pick.sort((a, b) => a.name.localeCompare(b.name));
}

export function BemConstructions(p: {
  /** the selected floor on the ground: its facts beside the Floors rulings (2026-10-12, moved out of the DETAIL view) */
  groundFacts?: { g: NonNullable<DetailInput["ground"]>; label: string };
  model: BemModelOutcome | null; imperial: boolean; rows: TypeRow[];
  ledger: BemLedger | null; library: Library | null; libCensus: string;
  /** the staged rulings, shared with the options table under the view */
  stage: Record<string, ConstructionRuling>; onStage: (key: string, r: ConstructionRuling | undefined) => void; onRevert: () => void;
  /** the ground-coupling method as staged (slice 4): plain Ground, the F/C-factor method, or Kiva */
  ground: GroundRuling | undefined; onGround: (g: GroundRuling | undefined) => void;
  /** an F/C table the project's data sources name (2026-11-12) — fills the F and C */
  groundTable?: GroundTable | null;
  onApply: (constructions: Record<string, ConstructionRuling>, ground: GroundRuling | undefined) => void; busy: boolean;
  /** the selected type (section|name) — a row click selects it: its cells light, the DETAIL pane and the options read it */
  selected: string | null; onSelect: (key: string | null) => void;
  paint: "type" | "source"; onPaint: (p: "type" | "source") => void;
  /** the window rows of the fenestration datasets, for the Window schedule's Reference (2026-10-01); null until read */
  windowProducts?: GlazingProduct[] | null;
  /** the door rows of the fenestration datasets, for a glazed Door row's Reference (2026-10-01) */
  doorProducts?: GlazingProduct[] | null;
  /** New… from a Window row's Reference: the fenestration dialog for that type */
  onFenNew?: (key: string, label: string, unitAreaM2: number | null, count: number, section: "window" | "door") => void;
  /** a Door row's right-click (user, 2026-10-01: "The garage doors are actually glass type and not opaque"): every door of the type
   *  ruled glass (true) or opaque (false), or back to the file's word (null) — the per-door glazing ruling, kept in the corrections ledger */
  onDoorGlazing?: (elementIds: number[], glazed: boolean | null) => void;
  /** how many of these doors carry the user's glazing ruling */
  doorGlazingRuled?: (elementIds: number[]) => number;
}): React.ReactElement {
  const m = p.model;
  const applied = p.ledger?.constructions ?? {};
  const stage = p.stage;
  // COMBINED TYPES (user, 2026-09-09): the types combined into another fold into its row — elements and gross area summed
  const { rows: folded, members } = foldRows(p.rows, stage);
  const [menu, setMenu] = useState<{ x: number; y: number; row: TypeRow } | null>(null);
  const [combine, setCombine] = useState<{ target: TypeRow; checked: Set<string> } | null>(null);
  /** a type's own name: the one the user typed, else the file's label — never the shared code default's construction */
  const ownName = (r: TypeRow): string => (stage[r.key]?.name && stage[r.key]!.source !== "sameAs" ? stage[r.key]!.name! : r.label);
  const combinable = (target: TypeRow): TypeRow[] => p.rows.filter((o) => o.section === target.section && o.key !== target.key && !(stage[o.key]?.combined && stage[o.key]?.sameAs && stage[o.key]!.sameAs !== target.key) && !members.get(o.key));
  const openCombine = (target: TypeRow): void => {
    const sig = layerSignature(target);
    // pre-checked: a type ALREADY SET TO MATCH this one (an alias to it, applied or staged — the user, 2026-09-09: "eight row
    // was changed to match that type … did not combine"), and a type whose file layer set is identical
    const pre = new Set(combinable(target).filter((o) => stage[o.key]?.sameAs === target.key || (sig && layerSignature(o) === sig)).map((o) => o.key));
    setCombine({ target, checked: pre }); setMenu(null);
  };
  const doCombine = (): void => {
    if (!combine) return;
    for (const o of combinable(combine.target)) {
      const st = stage[o.key];
      const was = !!st?.combined && st.sameAs === combine.target.key;
      if (combine.checked.has(o.key)) { if (!was) p.onStage(o.key, { source: "sameAs", sameAs: combine.target.key, combined: true, ...(st?.sameAs === combine.target.key && st.name ? { name: st.name } : {}) }); }
      else if (was) p.onStage(o.key, undefined);
    }
    setCombine(null);
  };
  const uncombine = (target: TypeRow): void => { for (const mm of members.get(target.key) ?? []) p.onStage(mm.key, undefined); setMenu(null); };
  // the open sections are remembered (bim-cons-sections); the section holding the selected type opens on SELECTION
  // CHANGE only (a collapse by hand holds), and the row scrolls into view once per selection (user, 2026-09-08)
  const [open, setOpen] = useState<Set<string>>(() => { try { const v = JSON.parse(window.localStorage.getItem("bim-cons-sections") ?? "") as string[]; return new Set(Array.isArray(v) ? v : ["Wall"]); } catch { return new Set(["Wall"]); } });
  useEffect(() => { window.localStorage.setItem("bim-cons-sections", JSON.stringify([...open])); }, [open]);
  useEffect(() => { const sec = p.selected?.split("|")[0]; if (sec) setOpen((o) => (o.has(sec) ? o : new Set([...o, sec]))); }, [p.selected]);
  const scrolled = useRef<string | null>(null);
  const toggle = (s: string): void => setOpen((o) => { const n = new Set(o); if (n.has(s)) n.delete(s); else n.add(s); return n; });
  /** the Construction's name in the IDF as it stands: typed, the alias target's, the type's own name sanitised, or the shared code default */
  const idfNameOf = (r: TypeRow, st: ConstructionRuling | undefined, setting: { value: string } | undefined): string => {
    if (st?.name && st.source !== "code") return st.name;
    if (st?.source === "sameAs" && st.sameAs) return stage[st.sameAs]?.name ?? sanitizeIdfName(st.sameAs);
    if (st && st.source !== "code") return sanitizeIdfName(r.key);
    void setting;
    const shared = r.constructions.length ? `${r.constructions[0]}${r.constructions.length > 1 ? ` (+${r.constructions.length - 1})` : ""} · shared code default` : "code default";
    return st?.name ? `${st.name} · code default` : shared;   // a name under the code default is the type's label; the IDF takes it once ruled
  };
  const set = p.onStage;
  const keys = new Set([...Object.keys(stage), ...Object.keys(applied)]);
  const groundMoved = JSON.stringify(p.ground ?? null) !== JSON.stringify(p.ledger?.ground ?? null);
  const pending = [...keys].filter((k) => JSON.stringify(stage[k]) !== JSON.stringify(applied[k])).length + (groundMoved ? 1 : 0);
  const gMethod = groundMethodOf(p.ground);
  const codeT = ieccFor(p.model?.built.model.climateZone, p.model?.built.model.energyCode);   // the slab by the model's zone and edition, the code table's
  const sp = slabPlan(p.ground, codeT), sfx = slabFactors(sp, p.ground?.fIp), cF = cFactor(p.ground?.wallR ?? 10, p.ground?.cIp);
  /** one field of the ground ruling: a value equal to the default is dropped, an empty ruling is none */
  const setGround = (patch: Partial<GroundRuling>): void => {
    const next: GroundRuling = { ...(p.ground ?? {}), ...patch };
    if (next.method === DEFAULT_GROUND_METHOD) delete next.method;
    if (next.slabExtent === "edge") delete next.slabExtent;
    for (const k of Object.keys(next) as Array<keyof GroundRuling>) if (next[k] === undefined) delete next[k];
    p.onGround(Object.keys(next).length ? next : undefined);
  };
  const lenAt = (m: number): number => (p.imperial ? m / 0.3048 : m), lenSi = (v: number): number => (p.imperial ? v * 0.3048 : v);
  const rAt = (r: number): number => (p.imperial ? r : r / 5.678263), rIp = (v: number): number => (p.imperial ? v : v * 5.678263);
  const uUnit = p.imperial ? "Btu/h·ft²·°F" : "W/m²K";
  const toSi = (v: number): number => (p.imperial ? v * U_IP : v);
  const fromSi = (v: number): number => (p.imperial ? v / U_IP : v);
  const settingOf = (key: string): { value: string; source: string } | undefined => m?.settings.find((s) => s.key === `construction:${key}`);
  // THE WINDOW SCHEDULE (user, 2026-09-18: the window list "shown as a single row each, with columns arranged: ID,
  // Reference, Count, Area, U, SHGC, VT"). The three numbers come from `fenValues` — the one rule the DETAIL frame
  // reads too — so the schedule and the view can never disagree: the ruling's set, else the construction the model
  // wrote, else the code default's row. A set the user has staged and not applied reads in their colour and says so.
  const catalogue = codeCatalogue(m?.built.model.climateZone, m?.built.model.energyCode);
  // CODE U (user, 2026-09-29: "the column should be labeled Code U" — the code defines code values): the energy code's own U for
  // the construction the type's cells take under the code default, from the table for the code and zone ruled on SITE
  const codeLabel = (m?.settings.find((x) => x.key === "energy_code")?.value ?? "2018 IECC").split(" · ")[0];
  const codeUOf = (r: TypeRow): { u: number | null; kind: string } => { const kind = catalogueKindOf(r.codeConstructions[0]?.kind ?? ""); return { u: catalogue.find((x) => x.kind === kind)?.uWm2k ?? null, kind }; };
  const codeCell = (r: TypeRow): React.ReactElement => { const c = codeUOf(r); return <td className={`num ${c.u === null ? "muted" : "src-code"}`} title={c.u === null ? `${c.kind || "no code construction"} — the code gives it no U` : `${codeLabel}: ${c.kind} — U ${fmtU(c.u, p.imperial)} ${uUnit}, the assembly with films`}>{c.u === null ? "—" : fmtU(c.u, p.imperial)}</td>; };
  const noteOf = (l: { file: string; name: string }): { u: number; shgc: number; tvis: number | null } | null => { const o = p.library?.byName.get(l.name); return o ? windowNote(o) : null; };
  const fenOf = (r: TypeRow, st: ConstructionRuling | undefined, glazed: boolean): ReturnType<typeof fenValues> => {
    const resolved = r.typeId !== null ? m?.built.model.constructions?.get(r.typeId) ?? null : null;
    const kind = catalogueKindOf(r.codeConstructions[0]?.kind ?? "");
    const e = catalogue.find((x) => x.kind === kind);
    return fenValues(st, resolved, e ? { name: e.kind, uWm2k: r.uWm2k ?? e.uWm2k, shgc: e.shgc, vt: e.vt } : { name: r.constructions[0] ?? "code default", uWm2k: r.uWm2k, shgc: null, vt: null }, noteOf, glazed);
  };
  const unresolved = m?.built.unresolvedConstructions ?? [];
  return (
    <div className="idfBar bemCol">
      <EnvelopeLosses report={m?.report} imperial={p.imperial} />
      {!p.library && <div className="idfInfo bad">library: no engine found — a library ruling cannot resolve</div>}
      <label className="lensRow">painted by
        <select value={p.paint} onChange={(e) => p.onPaint(e.target.value as "type" | "source")}>
          <option value="type">the file's type — one colour each</option>
          <option value="source">what governs — code blue · file grey · library teal · ruled amber</option>
        </select>
        <InfoTip text={`what governs each type's construction: code (the energy code chosen on SITE, its table's row for the county's climate zone — ${(m?.settings.find((x) => x.key === "energy_code")?.value ?? "2018 IECC").split(" · ")[0]} here; nominal assembly U with films), the assembly (the file's drawn layers with materials you pick), library (the engine's own datasets, emitted verbatim), or a typed U. U in ${uUnit}.${p.library ? ` library: ${p.libCensus}` : ""}`} />
      </label>
      {menu && (
        <>
          <div className="menuScrim" onPointerDown={() => setMenu(null)} />
          <div className="ctxMenu" style={{ left: menu.x, top: menu.y }}>
            <div className="ctxHead">{ownName(menu.row)}{stage[menu.row.key]?.name ? ` · IFC: ${menu.row.label}` : ""}</div>
            <button onClick={() => openCombine(menu.row)} title="other types of this section take this type's construction and fold into its row — elements and gross area summed; identical layer sets pre-checked">Combine types into this one…</button>
            {menu.row.kind === "door" && p.onDoorGlazing && (() => {
              const r = menu.row, ruled = p.doorGlazingRuled?.(r.elements) ?? 0, n = r.elements.length;
              const rule = (g: boolean | null): void => { p.onDoorGlazing!(r.elements, g); setMenu(null); };
              return <>
                <button disabled={r.glazed === true} onClick={() => rule(true)} title={`all ${n} door${n === 1 ? "" : "s"} of this type become glass doors: written as GlassDoor, their U, SHGC and VT from the Reference`}>Type: glass door{r.glazed === true ? " ✓" : ""}</button>
                <button disabled={r.glazed === false} onClick={() => rule(false)} title={`all ${n} door${n === 1 ? "" : "s"} of this type become opaque doors: written as Door, a U alone`}>Type: opaque door{r.glazed === false ? " ✓" : ""}</button>
                {ruled > 0 && <button onClick={() => rule(null)} title="drop your ruling: the file's word, or the type name's, decides again">Restore the file's word ({ruled} of {n} ruled by you)</button>}
              </>;
            })()}
            {members.get(menu.row.key) && <button onClick={() => uncombine(menu.row)} title="the combined types become rows again, on the code default">Uncombine (restore {members.get(menu.row.key)!.length} row{members.get(menu.row.key)!.length === 1 ? "" : "s"})</button>}
          </div>
        </>
      )}
      {combine && (() => {
        const cands = combinable(combine.target);
        const sig = layerSignature(combine.target);
        const chosen = cands.filter((o) => combine.checked.has(o.key));
        const el = combine.target.elements.length + chosen.reduce((t, o) => t + o.elements.length, 0);
        const gr = combine.target.grossM2 + chosen.reduce((t, o) => t + o.grossM2, 0);
        const toggle = (k: string): void => setCombine((c) => { if (!c) return c; const n = new Set(c.checked); if (n.has(k)) n.delete(k); else n.add(k); return { ...c, checked: n }; });
        return (
          <div className="qaPanel steps combine">
            <p><b>Combine into «{ownName(combine.target)}»</b>{stage[combine.target.key]?.name ? <span className="muted"> · IFC: {combine.target.label}</span> : null} ({SECTION_TITLES[combine.target.section]} · {combine.target.elements.length} el · {fmtArea(combine.target.grossM2, p.imperial)}). A checked type takes this type's construction — an alias in the ledger, marked combined — and folds into its row, elements and gross area summed. Identical layer sets are pre-checked; a shared name is a hint, never a verdict. A checked type's own ruling, if it had one, is replaced.</p>
            <table className="spaceTable typeTable">
              <thead><tr><th /><th>type</th><th className="num">el</th><th className="num">gross</th><th>layers against this one</th><th>governs now</th></tr></thead>
              <tbody>
                {cands.map((o) => { const same = !!sig && layerSignature(o) === sig; const shares = sharesName(o.label, combine.target.label); return (
                  <tr key={o.key} className={combine.checked.has(o.key) ? "sel" : ""} onClick={() => toggle(o.key)}>
                    <td><input type="checkbox" checked={combine.checked.has(o.key)} onChange={() => toggle(o.key)} onClick={(e) => e.stopPropagation()} /></td>
                    <td className="wrap">{ownName(o)}{stage[o.key]?.name ? <span className="muted"> · IFC: {o.label}</span> : null}</td>
                    <td className="num">{o.elements.length}</td>
                    <td className="num">{fmtArea(o.grossM2, p.imperial)}</td>
                    <td className={stage[o.key]?.sameAs === combine.target.key ? "ok" : same ? "ok" : shares ? "src-dataset" : "muted"}>{stage[o.key]?.sameAs === combine.target.key ? "set to match this type" : same ? "identical layers" : shares ? "shares the name" : o.layers.length ? "different" : "no layers stated"}</td>
                    <td className={srcClass(stage[o.key] ? (stage[o.key]!.source === "sameAs" ? "user" : stage[o.key]!.source === "library" ? "dataset" : stage[o.key]!.source === "file" ? "file" : "user") : "code-default")}>{stage[o.key] ? (stage[o.key]!.sameAs ? `same as ${stage[o.key]!.sameAs}` : stage[o.key]!.source) : "code default"}</td>
                  </tr>); })}
                {cands.length === 0 && <tr><td colSpan={6} className="muted">no other type in this section to combine</td></tr>}
              </tbody>
            </table>
            <div className="allRow">
              <button className="apply" disabled={chosen.length === 0 && !cands.some((o) => stage[o.key]?.combined && stage[o.key]?.sameAs === combine.target.key)} onClick={doCombine}>Combine {chosen.length} → one row · {el} el · {fmtArea(gr, p.imperial)} — then Apply</button>
              <button onClick={() => setCombine(null)}>cancel</button>
            </div>
          </div>
        );
      })()}
      {TYPE_SECTIONS.map((sec) => {
        // THIS TAB IS THE ENERGY MODEL'S CONSTRUCTIONS, AND NOTHING ELSE (user, 2026-09-20, asked twice: "why are we
        // carrying 7895 sf of ceiling if it has no energy impact?" · "why are we carrying something that will not be
        // modeled in energyplus?"). A type NO surface of which reaches the IDF is not a construction this model uses —
        // on this file the Floors section carried four: Floor:Deck 944 ft², a stair landing 106, two ramps 94, every
        // one of them with a governs select and a U to rule that did nothing. They are OFF the list; the record of them
        // is bem.db's `not_emitted` and the gate's census, and one muted line at the foot of the section names them,
        // because absent without a word is the one thing this project does not do.
        const inModel = (r: TypeRow): boolean => r.modelM2 > 0.01;
        const all = p.rows.filter((r) => r.section === sec && inModel(r));
        const rows = folded.filter((r) => r.section === sec && inModel(r));
        const unused = folded.filter((r) => r.section === sec && !inModel(r));
        // THE AREA STATED IS WHAT REACHES THE IDF (user, 2026-09-20), never the file's gross over every cell
        const gross = rows.reduce((t, r) => t + r.modelM2, 0);
        // the roof outside conditioned space, written as shading (user, 2026-10-01): stated beside the roof over conditioned space
        const shade = folded.filter((r) => r.section === sec).reduce((t, r) => t + r.notEmitted.filter((n) => n.reason === ROOF_SHADE_REASON).reduce((q, n) => q + n.m2, 0), 0);
        const ruledN = rows.filter((r) => stage[r.key]).length;
        const on = open.has(sec);
        // THE SCHEDULE LAYOUT — Window and Door (user, 2026-09-18: "provide same approach with doors, but there is a mixture
        // of materials (solid doors) and fenestration"): a door row says which it is and reads SHGC · VT as none when it is
        // solid. THE CODE DEFINES CODE VALUES (user, 2026-09-29): the IFC's stated U (Revit's export) is not shown and cannot govern
        const sched = sec === "Window" || sec === "Door";
        const allGlass = sec === "Window";
        // a row whose Reference is the fenestration list: every window, and a door the file makes glass (user, 2026-10-01)
        const fenRowOf = (r: TypeRow): boolean => allGlass || (sec === "Door" && r.glazed === true);
        const fenPeers = new Set(rows.filter(fenRowOf).map((r) => r.key));
        return (
          <div key={sec}>
            <button className={`qaBtn sec${on ? " on" : ""}`} onClick={() => toggle(sec)} title="the types the file names in this section">
              {on ? "▾" : "▸"} {SECTION_TITLES[sec]} · {all.length} type{all.length === 1 ? "" : "s"}{rows.length < all.length ? ` · ${rows.length} rows` : ""} · {fmtArea(gross, p.imperial)}{shade > 0.01 ? ` over conditioned space · ${fmtArea(shade, p.imperial)} outside it, as shade` : ""}{ruledN ? ` · ruled ${ruledN}` : ""}{sec === "Floors" ? ` · coupling: ${gMethod}${p.ground ? " (ruled)" : " (code)"}` : ""}
            </button>
            {on && (
              <div className="secBody qaPanel">
                {sec === "Floors" && (
                  <div className="groundRule">
                    <label className="lensRow" title="how every surface on the ground is modelled — the slabs at or under the ground line and the wall parts below grade, both the site model's word">ground coupling
                      <select className={srcClass(p.ground?.method ? "user" : "code-default")} value={gMethod} onChange={(e) => setGround({ method: e.target.value as GroundRuling["method"] })}>
                        <option value="kiva">Kiva — the 2-D foundation model, the insulation where it lies (the default: actual performance)</option>
                        <option value="fcfactor">F/C-factor — ASHRAE 90.1: the slab by area and EXPOSED perimeter, the wall by height</option>
                        <option value="ground">Ground — a constant ground temperature under each surface (cannot place an edge strip)</option>
                      </select>
                    </label>
                    <label className="lensRow" title="where the slab's insulation lies. R402.2.10: from the top of the slab, extended to the table's distance by any combination of vertical insulation, insulation extending under the slab, or insulation extending out from the building">slab insulation
                      <select className={srcClass(p.ground?.slabExtent ? "user" : "code-default")} value={sp.extent} onChange={(e) => setGround({ slabExtent: e.target.value as "edge" | "full" })}>
                        <option value="edge">under the slab at the edge — the distance in from the wall's inside face</option>
                        <option value="full">under the full slab</option>
                      </select>
                      <span>R</span><NumInput className={`numIn ${p.ground?.slabR !== undefined ? "src-user" : "src-code"}`} digits={2} value={rAt(sp.r)} onValue={(v) => setGround({ slabR: v === null ? undefined : rIp(v) })} title={p.imperial ? "h·ft²·°F/Btu (blank = the code's)" : "RSI m²K/W (blank = the code's)"} />
                      {sp.extent === "edge" && <><span>{p.imperial ? "ft" : "m"} under the slab</span><NumInput className={`numIn ${p.ground?.slabDepthM !== undefined ? "src-user" : "src-code"}`} digits={2} value={lenAt(sp.distM)} onValue={(v) => setGround({ slabDepthM: v === null ? undefined : lenSi(v) })} title="measured in from the foundation wall's inside face (blank = the code's distance)" /></>}
                    </label>
                    <div className="idfInfo">code: <span className="src-code">{sp.codeR > 0 ? `R-${sp.codeR} to ${+lenAt(sp.codeDistM).toFixed(2)} ${p.imperial ? "ft" : "m"}` : "no slab insulation required"} ({codeT.edition.label.replace(/ \(.*\)$/, "")}, zone {codeT.zone}, Table R402.1.2)</span></div>
                    {gMethod === "fcfactor" && <div className="lensRow" title="ASHRAE 90.1 Appendix A prints the F-factor of a slab (Table A6.3.1, by where the insulation lies, its R and its distance) and the C-factor of a below-grade wall (Table A4.2.1, by its R). The standard's tables do not ship with BIM-BEM-BOM: read your assemblies' rows in your copy and type them — the F/C method is refused until both are typed.">
                      <span>F-factor</span><NumInput className={`numIn ${p.ground?.fIp !== undefined ? "src-user" : "bad"}`} digits={3} value={p.ground?.fIp ?? null} onValue={(v) => setGround({ fIp: v === null ? undefined : v })} title="the slab's F-factor, Btu/h·ft·°F, from ASHRAE 90.1 Table A6.3.1" />
                      <span>Btu/h·ft·°F · C-factor</span><NumInput className={`numIn ${p.ground?.cIp !== undefined ? "src-user" : "bad"}`} digits={3} value={p.ground?.cIp ?? null} onValue={(v) => setGround({ cIp: v === null ? undefined : v })} title="the below-grade walls' C-factor, Btu/h·ft²·°F, from ASHRAE 90.1 Table A4.2.1" />
                      <span>Btu/h·ft²·°F</span> <InfoTip text={`${F_TABLE_CITE}. ${C_TABLE_CITE}. As typed: F ${sfx.placed.entry}, C ${cF.entry}.`} />
                      {p.groundTable && (() => {
                        // A TABLE THE PROJECT NAMES (2026-11-12): its rows for this slab and these walls FILL the two numbers — still the user's
                        const t = p.groundTable, f = fFromTable(t, sp.r, sp.distM, sp.extent === "full" ? "full" : "horizontal"), c = cFromTable(t, p.ground?.wallR ?? 10);
                        return <button className="qaBtn" title={`${t.fCite} · ${t.cCite} — the rows at or under this slab's R and distance and the walls' R, never interpolated`}
                          onClick={() => setGround({ fIp: f.ip, ...(c ? { cIp: c.ip } : {}) })}>from the table: F {f.ip} ({f.entry}){c ? ` · C ${c.ip} (${c.entry})` : ""}</button>;
                      })()}
                    </div>}
                    <div className="idfInfo muted">{gMethod === "kiva" ? (sp.extent === "edge" ? `EnergyPlus: Foundation:Kiva interior horizontal XPS R-${sp.r}, ${+lenAt(sp.distM).toFixed(2)} ${p.imperial ? "ft" : "m"} in from the wall's inside face, right under the slab; the slab concrete alone; the walls' own constructions (insulated inside); the engine's own soil` : `EnergyPlus: Foundation:Kiva, the R-${sp.r} as a layer under the whole slab in its construction; the walls' own constructions`) : gMethod === "fcfactor" ? `EnergyPlus: Construction:FfactorGroundFloor at F ${sfx.placed.ip} (the placement's row) and CfactorUndergroundWall at C ${cF.ip}; the exposed perimeter read from the model` : sp.extent === "edge" ? "EnergyPlus: a constant ground temperature — the edge strip is NOT modelled; the slab is concrete alone" : `EnergyPlus: a constant ground temperature, R-${sp.r} under the full slab`}</div>
                    {p.groundFacts && <GroundFacts g={p.groundFacts.g} label={p.groundFacts.label} imperial={p.imperial} />}
                  </div>
                )}
                <table className={sched ? "typeSched" : undefined}>
                  <thead><tr>{sched ? (
                    <>
                      <th title="the type as the file names it — the ID this model carries; a door says whether the file makes it glass or solid; the IDF name and the rename are in the DETAIL head">ID</th>
                      <th title="what the values reference: the code default, a certified product, a dataset construction, or another type">Reference</th>
                      <th className="num" title="how many of this type the file places">count</th>
                      <th className="num" title="the area of this type THE IDF CARRIES — the openings a subsurface was written for. One the writer could not place is not counted here; the cell says so.">area</th>
                      <th className="num" title={`U, ${uUnit}, whole product with films — the reference's number; the code default's until the type is ruled`}>U</th>
                      <th className="num" title="solar heat gain coefficient — the reference's number; the code default's until the type is ruled; none on a solid door, which has no glass">SHGC</th>
                      <th className="num" title="visible transmittance — blank when a certified rating publishes none (the engine estimates it); none on a solid door">VT</th>
                      {!allGlass && <th className="num" title={`the energy code's U for this type (${codeLabel}, the table's row for the county's zone) — the requirement, whatever governs the model`}>Code U</th>}
                    </>
                  ) : (
                    <>
                      <th>type</th><th className="num">el</th><th className="num" title="the area of this type THE IDF CARRIES — the surfaces the writer emitted, which is what the energy model sees. Cells no zone claimed (an eave overhang, a plane over no room) and cells dropped as an internal partition are not in the model and are not counted here; the cell says how much and why.">area</th><th>governs</th><th className="num" title="the MODEL's U for this type's cells: 1/(ΣR + the films the engine adds) of the construction they carry — the ruled stack's, or the code default's">U</th><th className="num" title={`the energy code's U for this type (${codeLabel}, the table's row for the county's zone) — the requirement, whatever governs the model`}>Code U</th>
                    </>
                  )}</tr></thead>
                  <tbody>
                    {rows.map((r) => {
                      const st = stage[r.key];
                      const gov: ConsSource = st?.source === "sameAs" && !st.sameAs ? "code" : st?.source ?? "code";   // an empty "same as" is the code default
                      const setting = settingOf(r.key);
                      const glazed = r.kind === "window" || (r.kind === "door" && r.glazed === true);
                      const cands = gov === "library" ? candidates(p.library, sec, glazed) : [];
                      const isSel = p.selected === `${r.section}|${r.key}`;
                      // THE WINDOW SCHEDULE'S REFERENCE (user, 2026-10-01): a searchable list of window products — the code
                      // default, what this project already uses, every fenestration dataset row — never an alias to another row
                      const fenRow = fenRowOf(r);
                      const fenSec = allGlass ? "window" : "door";
                      const refCell = fenRow ? (
                          <td className="wrap"><FenReference rowKey={r.key} st={st} stage={stage} products={(allGlass ? p.windowProducts : p.doorProducts) ?? null} imperial={p.imperial}
                            section={fenSec} peers={fenPeers}
                            onStage={(ru) => set(r.key, ru)} onNew={p.onFenNew ? () => p.onFenNew!(r.key, st?.name ?? r.label, r.elements.length ? r.grossM2 / r.elements.length : null, r.elements.length, fenSec) : undefined} /></td>
                      ) : (
                          <td className="wrap">
                            <select className={srcClass(gov === "code" ? "code-default" : gov === "file" ? "file" : gov === "library" || gov === "layers" ? "dataset" : "user")} value={gov} onClick={(e) => e.stopPropagation()}
                              onChange={(e) => { const v = e.target.value as ConsSource; set(r.key, v === "code" ? undefined : v === "u" ? { source: "u", uWm2k: st?.uWm2k ?? (r.uWm2k ?? 1), shgc: glazed ? st?.shgc ?? 0.4 : undefined, vt: glazed ? st?.vt ?? 0.5 : undefined } : v === "layers" ? { ...(st?.source === "layers" ? st : {}), source: "layers", layers: st?.layers ?? r.layers.filter((l) => !l.part).map((l, i) => ({ seq: i, material: l.material })), outsideFirst: st?.outsideFirst ?? true } : v === "sameAs" ? { source: "sameAs", sameAs: st?.sameAs } : { source: v, library: st?.library }); }}>
                              {/* SIMPLIFIED (user, 2026-09-16): code · the IFC's stated U · the assembly, edited in DETAIL · same as; a dataset
                                  construction or a U / NFRC set is chosen in the DETAIL frame and reads here only while it governs */}
                              <option value="code">code default</option>
                              <option value="layers" disabled={!r.layers.some((l) => !l.part)}>the assembly (edit in DETAIL)</option>
                              {/* NO ALIAS ON A DOOR (user, 2026-10-01: "Glazed doors must follow window approach, using Reference for point of
                                  assigning U, SHGC and VT"): a door's values come from its Reference — an older "same as" reads here, not offered */}
                              {(sec !== "Door" || gov === "sameAs") && <option value="sameAs" disabled={sec === "Door"}>{sec === "Door" ? "same as… — not offered on a door: choose another" : "same as…"}</option>}
                              {gov === "library" && <option value="library">a dataset construction (DETAIL)</option>}
                              {gov === "u" && <option value="u">{st?.product?.name ?? (glazed ? "NFRC values (DETAIL)" : "a typed U (DETAIL)")}</option>}
                            </select>
                            {gov === "library" && (
                              <select className="src-dataset" value={st?.library?.name ?? ""} onClick={(e) => e.stopPropagation()} onChange={(e) => { const c = cands.find((x) => x.name === e.target.value); set(r.key, { source: "library", library: c ? { file: c.file, name: c.name } : undefined }); }}>
                                <option value="">— choose —</option>
                                {cands.map((c) => <option key={c.name} value={c.name}>{c.name}{c.note ? ` · ${c.note}` : ""}</option>)}
                              </select>
                            )}
                            {gov === "u" && !sched && (
                              <span className="allRow" onClick={(e) => e.stopPropagation()}>
                                <NumInput className="src-user" style={{ width: 64 }} digits={3} min={0.001} value={fromSi(st?.uWm2k ?? 1)} title={`U, ${uUnit}, with films`}
                                  onValue={(v) => { if (v !== null && v > 0 && Math.abs(toSi(v) - (st?.uWm2k ?? 1)) > 1e-6) { const { product: _drop, ...typed } = st!; set(r.key, { ...typed, source: "u", uWm2k: toSi(v) }); } }} />
                                {glazed && <NumInput className="src-user" style={{ width: 52 }} digits={2} min={0.01} max={0.99} value={st?.shgc ?? 0.4} title="SHGC" onValue={(v) => { if (v !== null && Math.abs(v - (st?.shgc ?? 0.4)) > 1e-6) { const { product: _drop, ...typed } = st!; set(r.key, { ...typed, source: "u", shgc: v }); } }} />}
                                {glazed && <NumInput className="src-user" style={{ width: 52 }} digits={2} min={0.01} max={0.99} value={st?.vt ?? 0.5} title="visible transmittance" onValue={(v) => { if (v !== null) set(r.key, { ...st!, source: "u", vt: v }); }} />}
                                {/* A GLAZING PRODUCT (2026-09-16): the numbers are the product's — an NFRC rating (Marvin Elevate) or the user's reference list; a number typed over them makes the set the user's */}
                                {st?.product && <span className={st.product.source === "marvin" ? "src-dataset" : "src-user"} title={`the numbers are the product's — ${st.product.source === "marvin" ? "an NFRC whole-product rating (Marvin Elevate)" : "the user's reference list (derived by Claude Opus; typical, uncertified)"}; typing one makes the set yours`}> · {st.product.name}{st.vt === undefined ? " · VT not published, blank" : ""}</span>}
                              </span>
                            )}
                          </td>
                      );
                      return (
                        <tr key={r.key} ref={(el) => { if (isSel && el && scrolled.current !== p.selected) { scrolled.current = p.selected; el.scrollIntoView({ block: "nearest" }); } }} className={`${isSel ? "sel" : ""}${st ? " src-user" : ""}`} onClick={() => p.onSelect(isSel ? null : `${r.section}|${r.key}`)} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, row: r }); }} title={r.layers.length ? `the file's layers: ${r.layers.map((l) => `${l.part ? `${l.part}: ` : ""}${l.material}${l.thicknessM !== null ? ` ${(l.thicknessM * (p.imperial ? 39.3701 : 1000)).toFixed(p.imperial ? 2 : 0)} ${p.imperial ? "in" : "mm"}` : ""}`).join(" · ")}` : "the file states no layers for this type"}>
                          <td className="wrap">
                            {/* ONE NAME (user, 2026-09-29: "why are we showing IDF and IFC labels?"): the rename when there is one, else the
                                file's type name; both in the tooltip. The alias is the governs column's "same as…" */}
                            <span className={`typeName ${st?.name || st?.source === "sameAs" ? "src-user" : "src-file"}`} title={`IFC: ${r.label}\nIDF: ${idfNameOf(r, st, setting)}\nrename in the DETAIL head`}>{st?.name && st.source !== "code" && st.source !== "sameAs" ? st.name : st?.source === "sameAs" && !fenRow ? idfNameOf(r, st, setting) : st?.source === "sameAs" ? r.label : st?.name ?? r.label}</span>
                            {/* the alias select is not offered for windows or glass doors (user, 2026-10-01: "should not be used to assign U,
                                SHGC and VT, and should not have a dropdown") — their values come from the Reference alone */}
                            {gov === "sameAs" && !fenRow && sec !== "Door" && (
                              <select className="src-user alias" value={st?.sameAs ?? ""} onClick={(e) => e.stopPropagation()} onChange={(e) => set(r.key, { source: "sameAs", sameAs: e.target.value || undefined })} title="this type takes the chosen type's construction — an alias, the file's grouping untouched">
                                <option value="">— same as which {sec.toLowerCase()} type —</option>
                                {/* BY THE NAME THE USER GAVE (2026-09-09: "the drop down list did not update to include new types, as in Concrete siding
                                    on wood studs"): a ruled type reads its IDF name with the IFC name beside, ruled types first; an unruled one (the shared
                                    code default) cannot be aliased and is greyed */}
                                {rows.filter((o) => o.key !== r.key && stage[o.key]?.sameAs !== r.key)
                                  .map((o) => { const os = stage[o.key]; const ruled = !!os && os.source !== "sameAs" && os.source !== "code"; const name = os?.name && os.source !== "code" ? os.name : null; return { o, os, ruled, name }; })
                                  .sort((a, b) => Number(b.ruled) - Number(a.ruled))
                                  .map(({ o, os, ruled, name }) => <option key={o.key} value={o.key} disabled={!ruled}>= {name ?? o.label}{name ? ` (IFC: ${o.label})` : ""}{ruled ? ` · ${os!.source === "layers" ? "the file's layers" : os!.source === "library" ? "a dataset construction" : os!.source === "u" ? "a typed U" : "the IFC's stated U"}` : " — code default, cannot be aliased"}</option>)}
                              </select>
                            )}
                            {members.get(r.key) && <span className="src-user" title={`combined into this row (right-click: uncombine):\n${members.get(r.key)!.map((mm) => `${mm.label} · ${mm.elements.length} el · ${fmtArea(mm.grossM2, p.imperial)}`).join("\n")}`}> +{members.get(r.key)!.length} combined</span>}
                            {r.kind === "ceiling" ? <span className="muted"> · ceiling</span> : null}{!allGlass && (r.kind === "window" || r.kind === "door") && r.glazed !== null ? <span className="muted"> · {r.glazed ? "glass" : "opaque"}</span> : null}
                            {/* A DOOR'S GLASS SHARE (the user, 2026-10-07: "there are 100% commercial glass doors, so setting the percentage is
                                an item needed"): typed per type, it rides with the type whatever its Reference; blank = the door whole as the file
                                makes it (glass 100 %, solid 0 %) */}
                            {r.kind === "door" && <span className="muted" onClick={(e) => e.stopPropagation()}
                              title={"the glass share of this door type, %: 100 writes the whole opening as glass (a GlassDoor), 0 as a solid Door; between, the door is split — the glass centred at the door's proportions and four solid pieces round it, each part taking the construction of its kind (the Reference's where it is of that kind, else the code default's)\nblank: the file's — " + (r.glazed ? "a glass door, the whole opening glass (100 %)" : "a solid door (0 %)") + "\nan NFRC rating is whole-product (its frame included): such a door at 100 % already carries its frame"}>
                              {" · glass "}<NumInput className={srcClass(st?.glassShare !== undefined ? "user" : "file")} style={{ width: 40 }} digits={0} min={0} max={100}
                                value={st?.glassShare !== undefined ? Math.round(st.glassShare * 100) : null} placeholder={r.glazed ? "100" : "0"}
                                onValue={(v) => p.onStage(r.key, { ...(st ?? { source: "code" as const }), glassShare: v === null ? undefined : Math.min(100, Math.max(0, v)) / 100 })} /> %</span>}
                          </td>
                          {sched && refCell}
                          <td className="num">{r.elements.length}</td>
                          <td className="num" title={r.notEmitted.length
                            ? `${fmtArea(r.modelM2, p.imperial)} of this type is in the IDF.\nNOT in the model, and not counted here (net area):\n${r.notEmitted.map((n) => `  ${fmtArea(n.m2, p.imperial)} · ${n.cells} cell${n.cells === 1 ? "" : "s"} — ${n.reason}`).join("\n")}\nThe file's own gross over every cell of the type is ${fmtArea(r.grossM2, p.imperial)}; summing that counts a claimed cell twice, since a remainder's outer ring encloses it.`
                            : `${fmtArea(r.modelM2, p.imperial)} — every cell of this type is in the IDF`}>{fmtArea(r.modelM2, p.imperial)}</td>
                          {!sched && refCell}
                          {sched && (() => {
                            // the values the type carries — the ruling's, else the model's, else the code default's row
                            const fv = fenOf(r, st, glazed);
                            const stagedNow = fv.from === "ruling" && JSON.stringify(st) !== JSON.stringify(applied[r.key]);
                            const cls = `num ${srcClass(fv.source)}`;
                            const why = fv.from === "ruling" ? `${fv.name}${stagedNow ? " — STAGED: the model still has the applied set until Apply" : ""}` : fv.from === "model" ? `the construction the model wrote: ${fv.name}` : `the code default: ${fv.name}`;
                            // a SOLID door has no glass: SHGC and VT do not apply, and the cell says so rather than borrowing the glazed default
                            const solid = !glazed ? `${r.glazed === false ? "solid" : "not glazed"}: no glass, so SHGC and VT do not apply — the code gives an exterior door the fenestration U alone` : null;
                            return (
                              <>
                                <td className={cls} title={`${r.uMixed && fv.from !== "ruling" ? `area-weighted over ${r.uByCons?.length ?? 0} constructions\n` : ""}${why}`}>{r.uMixed && fv.from !== "ruling" ? "~" : ""}{fmtU(fv.u, p.imperial)}</td>
                                <td className={solid ? "num muted" : cls} title={solid ?? why}>{fv.shgc === null ? "—" : fv.shgc.toFixed(2)}</td>
                                <td className={solid || fv.vtBlank ? "num muted" : cls} title={solid ?? (fv.vtBlank ? `${fv.name} publishes no VT: the field is left blank and the engine estimates it` : fv.from === "code" ? `VT ${CODE_VT} — a stated default: the code states none, and a SimpleGlazingSystem needs a number` : why)}>{fv.vt === null ? (fv.vtBlank ? "blank" : "—") : fv.vt.toFixed(2)}</td>
                                {!allGlass && codeCell(r)}
                              </>
                            );
                          })()}
                          {!sched && (<>
                          <td className={`num ${srcClass(setting?.source ?? "code-default")}`} title={`${r.uMixed ? `area-weighted over ${r.uByCons?.length ?? 0} constructions: ${(r.uByCons ?? []).map((x) => `${x.name} ${x.uWm2k === null ? "—" : fmtU(x.uWm2k, p.imperial)} (${fmtArea(x.m2, p.imperial)})`).join(" · ")}\n` : ""}${setting?.value ?? "the code default"}`}>{r.uMixed ? "~" : ""}{fmtU(r.uWm2k, p.imperial)}</td>
                          {codeCell(r)}
                          </>)}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {unused.length > 0 && (
                  <p className="muted" title={`no surface of these reaches the IDF, so there is no construction to rule and no energy to model. What the file draws and where it went:\n${unused.map((u) => `  ${u.label} · ${u.elements.length} el · ${fmtArea(u.grossM2, p.imperial)} drawn — ${u.notEmitted.map((n) => `${fmtArea(n.m2, p.imperial)} ${n.reason}`).join(", ") || "not written"}`).join("\n")}`}>
                    {unused.length} type{unused.length === 1 ? "" : "s"} the model does not use ({fmtArea(unused.reduce((q, u) => q + u.grossM2, 0), p.imperial)} drawn): {unused.map((u) => u.label).join(" · ")}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
      {unresolved.length > 0 && <div className="idfInfo bad">not honoured (the code default used): {unresolved.join(" · ")}</div>}
      <div className="allRow">
        <button className="apply" disabled={pending === 0 || p.busy || !m} onClick={() => p.onApply(stage, p.ground)} title="the staged construction rulings go to the BEM ledger and the model is rebuilt; RUN says the model moved">
          {pending === 0 ? "✓ applied — nothing staged" : `Apply ${pending} ruling${pending > 1 ? "s" : ""}`}
        </button>
        {pending > 0 && <button onClick={p.onRevert}>revert</button>}
      </div>
      {m && <div className="idfInfo">values: file {m.census.file} · dataset {m.census.dataset} · code default {m.census["code-default"]} · user {m.census.user} · model {m.modelSha.slice(0, 12)}</div>}
    </div>
  );
}
