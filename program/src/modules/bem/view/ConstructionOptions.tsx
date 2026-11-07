// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE OPTIONS under the view (user, 2026-09-08: "related options in table
// below view"): for the selected type, every construction it could take —
// the code default, the file's stated U, the file's own layers, the dataset
// assemblies (a composite named by the stud layer's depth first), the 207
// window constructions with their stated U / SHGC / VT, and a typed U or
// NFRC set. A row click STAGES the ruling in the column; the staged one is
// lit. Candidates are the library's own words; the name-match per layer is
// a heuristic offered, never applied by itself.
//
// FOR A SELECTED LAYER (user, 2026-09-08, later: "the layers displayed in
// view must be selectable … with view table below showing options"): the
// pick, a search over materials.db, the name-matched candidates with their R
// at THIS thickness and their attributed source, the SUB-ITEMS sharing the
// placement (the batt between the studs, at the framing default with its
// source), a thickness override, a typed R, and the Internet search. A pick
// while the code default, the file or a library governs PROMOTES the ruling
// to the file's layers. A pick is the only staging; nothing here writes.
//
// THE PALETTE BY ROLE (user, 2026-09-16: "the layer editor should be … aware
// of the assembly and layer position … a culled material list"; "a clean UI
// approach, where materials are shown by row with detail specifics … in a tool
// tip"): a toolbar (the layer, its ROLE read from the file's word or its
// position, the source chips, a search, show all, the actions), the pick
// block, then ONE LINE PER MATERIAL — name, R at this thickness, a source
// badge — the numbers and the source in the row's tooltip. "Internet search"
// opens the in-app browser window; "add by hand" a dialog and a new row.

import { Fragment, useEffect, useRef, useState } from "react";
import type { TypeRow } from "../constructionTypes.js";
import { withLayers, type ConstructionRuling, type LayerPick } from "../core/bemDb.js";
import { resolveConstruction, stackR, windowNote, compositeFor, layerR, FILMS, type Library } from "../core/idfLib.js";
import { FRAMING_DEFAULTS, effectiveLayer, ruledStack } from "../core/bemModel.js";
import { KIND_LABELS, IP, keywordMatch, absStated, layerPickFor, resolveMaterialRef, nameGroup, SOURCE_CLASS_LABELS, resolveDataSets, dataSetKeyOf, dataSetGroups, inDataSet, DATASET_RIGHTS, type MaterialKind, type MaterialRow, type GlazingProduct, type MaterialSource, type SourceClass, type DataSetGroup, SECTION_KINDS } from "../core/materialsDb.js";
import { ROLES_BY_SECTION, ROLE_LABELS, roleOfLayer, rolesOfRow, sectionOfKind, type LayerRole } from "../core/layerRoles.js";
import { fmtArea, srcClass, NumInput } from "./bemUi.js";

const U_IP = 5.678263;
const R_IP = 0.1761102;

/** what the screen asks of materials.db — built by the app from the rows read back, re-read when `version` moves */
export interface MaterialsApi {
  version: number;
  byKey(key: string): MaterialRow | null;
  /** the name-matched candidates for a file layer (matchMaterials over materials.db) */
  candidates(layer: { material: string; thicknessM: number | null; category: string | null }, kind?: MaterialKind | null): MaterialRow[];
  /** a text over name · kind · source; massless rows only when `zero` */
  search(text: string, opts?: { kind?: string; zero?: boolean }): MaterialRow[];
  /** THE FENESTRATION DATASETS a track offers (2026-09-17): the engine's own window constructions, the reference
   *  list's generic sets and the manufacturers' NFRC ratings — read instead of the standard material rows */
  fenestration(section: "window" | "door" | "skylight"): GlazingProduct[];
  /** every row — the palette culls by role over all of them (a capped search would cull first) */
  all(): MaterialRow[];
  /** materials.db's own `sources` rows — their class (Open · Manufacturers · Yours) and short label (2026-09-17) */
  sources(): MaterialSource[];
}
/** a row's roles, read once per row object (the rows are replaced whole when materials.db moves) */
const ROLE_CACHE = new WeakMap<MaterialRow, LayerRole[]>();
/** a row's R across a layer of this thickness: a Material's t / k, a massless row's stated R */
export const rAt = (m: MaterialRow, thicknessM: number | null): number | null => (m.cls === "Material" ? (m.conductivityWmK && thicknessM ? thicknessM / m.conductivityWmK : null) : m.rSi);

/** the DataSet select's options (2026-09-18): one provider's single set as a plain row, a provider with several as a
 *  group headed by "All <provider>" — every label reads "<provider> - <set>", e.g. "Marvin - Essential" */
function dsetOptions(groups: DataSetGroup[]): React.ReactNode {
  return groups.map((g) => (g.sets.length === 1
    ? <option key={g.sets[0]!.key} value={g.sets[0]!.key}>{g.sets[0]!.label} ({g.sets[0]!.n})</option>
    : <optgroup key={g.provider} label={g.provider}>
        <option value={`provider:${g.provider}`}>All {g.provider} ({g.total})</option>
        {g.sets.map((d) => <option key={d.key} value={d.key}>{d.label} ({d.n})</option>)}
      </optgroup>));
}

export function ConstructionOptions(p: {
  row: TypeRow | null; library: Library | null; stage: ConstructionRuling | undefined; onStage: (key: string, r: ConstructionRuling | undefined) => void;
  imperial: boolean; code: { name: string; uWm2k: number | null } | null;
  /** the selected LAYER (its seq) — the table then reads the layer */
  layerSel: number | null; onLayer: (seq: number | null) => void;
  materials: MaterialsApi | null;
  /** the in-app browser window on a search for this layer's material (2026-09-16) */
  onBrowse?: (seq: number, q: string) => void;
  /** the add-by-hand dialog for this layer, the role pre-set (2026-09-16) */
  onHand?: (seq: number, role: LayerRole | null) => void;
  /** the dialog open on a layer: a placeholder row leads the list while a new material is typed */
  dialog?: { seq: number; editFrom: string | null; name: string } | null;
  /** edit a saved material: the hand form prefilled with the row, in the user's units */
  onEdit?: (seq: number, row: MaterialRow) => void;
  /** New on a window, a glazed door or a skylight: the fenestration dialog for a row of the user's own (2026-09-17) */
  onFenHand?: (key: string, label: string, section: "window" | "door" | "skylight") => void;
  /** edit… on a fenestration row of yours: the same dialog, prefilled, with Save and Delete (2026-09-17) */
  onFenEdit?: (key: string, label: string, row: GlazingProduct) => void;
  /** remove a saved row (hand, bcl) from materials.db by its key — remembered, never carried back */
  onRemove?: (key: string) => void;
}): React.ReactElement {
  const [filter, setFilter] = useState("");
  /** the Marvin subgroup's three narrowings (2026-09-16): the product type (defaulted from the file's type name), the divider, a glass filter */
  /** THE PALETTE (user, 2026-09-16): a row is SELECTED, then applied to the layer with the button at the top right — nothing lands
   *  on a click; the list is culled to the layer's category (its role), a search and "show all" widen it; the window manufacturer
   *  (General first, Marvin) is the glazed types' */
  const [palSel, setPalSel] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [showAll, setShowAll] = useState(false);
  // THE THREE FILTERS under the head row (2026-09-17, the user): where the numbers come from (Open · Manufacturers ·
  // Yours), which dataset within it, and the name's own group — read from materials.db's `sources` and `name_group`
  const [srcCls, setSrcCls] = useState<"all" | SourceClass>("all");
  const [dset, setDset] = useState("all");
  const [grp, setGrp] = useState("all");
  // THE FENESTRATION PALETTE's own filters and pick (2026-09-17): a window, a glazed door or a skylight reads the
  // fenestration table, never the standard material rows
  const [fSrc, setFSrc] = useState<"all" | SourceClass>("all");
  const [fDset, setFDset] = useState("all");
  const [fGrp, setFGrp] = useState("all");
  const [fGrpSet, setFGrpSet] = useState(false);
  const [fSel, setFSel] = useState<string | null>(null);
  const [fQ, setFQ] = useState("");
  useEffect(() => { setPalSel(null); setShowAll(false); setQ(""); }, [p.layerSel, p.row?.key]);
  const r = p.row;
  if (!r) return <div className="idfInfo" title="select a type in the column, or click a cell in the view">select a type for its options</div>;
  const fU = (u: number | null): string => (u === null ? "—" : p.imperial ? (u / U_IP).toFixed(3) : u.toFixed(3));
  const lib = p.library;
  const glazed = r.kind === "window" || (r.kind === "door" && r.glazed === true);
  const film = r.kind === "roof" || r.kind === "ceiling" ? FILMS.ceiling : r.kind === "floor" ? FILMS.floor : FILMS.wall;
  const st = p.stage;
  const gov = st?.source === "sameAs" && !st.sameAs ? "code" : st?.source ?? "code";   // an empty "same as" is the code default
  const fileLayers = r.layers.filter((l) => !l.part);
  const stud = fileLayers.find((l) => /lumber|stud/i.test(l.material));
  const composite = lib && stud ? compositeFor(lib, stud) : null;
  const cands = lib ? (lib.byClass.get("Construction") ?? []).filter((o) => glazed ? o.file.startsWith("WindowConstructs") : !o.file.startsWith("WindowConstructs") && (r.kind === "wall" ? /Wall|Partition/i.test(o.name) : r.kind === "floor" ? /Floor/i.test(o.name) : /Roof|Ceiling/i.test(o.name))) : [];
  const shown = glazed && filter ? cands.filter((o) => o.name.toLowerCase().includes(filter.toLowerCase())) : cands;
  const uRow = st?.source === "u" ? st : null;
  /** THE STACK AS RULED (2026-09-09): the file's layers joined to their picks by seq, the user's added layers in place, the deleted ones struck */
  const stack = ruledStack(fileLayers, st?.source === "layers" ? st.layers : undefined);
  const live = stack.filter((x) => !x.deleted);
  /** THE ONE WRITER: a patch on one layer stages the stack as the ruling (promoting from code / file / library) */
  const stageLayer = (seq: number, patch: Partial<LayerPick>): void => {
    const layers = stack.map((rl) => (rl.seq === seq ? (Object.fromEntries(Object.entries({ ...rl.pick, ...patch }).filter(([, v]) => v !== undefined)) as unknown as LayerPick) : rl.pick));
    p.onStage(r.key, withLayers(st, layers));
  };
  const fmtTh = (m: number | null): string => (m === null ? "—" : p.imperial ? `${(m * 39.3701).toFixed(m * 39.3701 < 0.1 && m > 0 ? 4 : 2).replace(/(\.\d{2}\d*?[1-9])0+$/, "$1")}″` : `${(m * 1000).toFixed(m * 1000 < 1 && m > 0 ? 2 : 0)} mm`);
  const fmtR = (x: number | null): string => (x === null ? "—" : p.imperial ? `R-${(x / R_IP).toFixed(1)}` : `${x.toFixed(2)} m²K/W`);
  /** the number alone, for a cell under the R header (user, 2026-09-16) */
  const fmtRn = (x: number | null): string => (x === null ? "—" : p.imperial ? (x / R_IP).toFixed(1) : x.toFixed(2));

  // ── the LAYER's options
  const sel = p.layerSel;
  const rl = sel !== null ? stack.find((x) => x.seq === sel && !x.deleted) ?? null : null;
  const fl = rl ? rl.file ?? { part: null, material: rl.pick.material, thicknessM: rl.pick.thicknessM ?? null, category: null } : null;
  if (fl && rl && sel !== null && p.materials) {
    const M = p.materials;
    const cur = rl.pick;
    const th = cur.thicknessM ?? fl.thicknessM ?? 0;
    const curRow = cur.ref && "key" in cur.ref ? M.byKey(cur.ref.key) : null;
    // THE CATEGORY (2026-09-16): the layer's role — read from the file's word, else the layer's position; the user's ruling wins; the
    // list is culled to it. The layer itself (its name, thickness, R, the assembly's ΣR and U) is read in the VIEW above, nowhere here
    const section = sectionOfKind(r.kind);
    const read = roleOfLayer(section, rl.position ?? 1, live.length, fl.material, fl.category, st?.outsideFirst ?? true);
    const role: LayerRole | null = cur.role ?? read.role;
    const roles = ROLES_BY_SECTION[section];
    const roleLabel = (x: LayerRole | null): string => (x ? roles.find((e) => e.role === x)?.label ?? ROLE_LABELS[x] : "—");
    const rolesOf = (m: MaterialRow): LayerRole[] => { let v = ROLE_CACHE.get(m); if (!v) { v = rolesOfRow(m.name, m.kind); ROLE_CACHE.set(m, v); } return v; };
    // THE LIST: the rows of this category (every row under "show all"; an open middle layer reads the section's kinds), a legacy
    // kind ruling narrowing it, then the search text; ORDER: the user's own rows, the reference list's keyword matches, the
    // name-matched candidates in their rank, the rest by name — 80 shown, the rest counted
    const isMine = (m: MaterialRow): boolean => m.sourceId === "hand" || m.sourceId === "bcl";
    const all = M.all();
    const base = showAll ? all : role ? all.filter((m) => rolesOf(m).includes(role)) : all.filter((m) => SECTION_KINDS[section === "ceiling" ? "roof" : section].includes(m.kind));
    const narrowed = cur.kind && !showAll ? base.filter((m) => m.kind === cur.kind) : base;
    // THE FILTERS (2026-09-17): the class of source, then the dataset within it, then the search text, then the name's
    // group — each dropdown lists what the ones before it leave, with its counts, so nothing offers an empty list
    const srcs = M.sources();
    const classOf = (m: MaterialRow): SourceClass => srcs.find((x) => x.id === m.sourceId)?.sourceClass ?? "open";
    // the MATERIAL datasets alone (2026-09-18): a provider that also publishes fenestration is a different dataset there
    const dsAll = resolveDataSets(srcs, "material");
    const keyOf = (m: MaterialRow): string => m.datasetKey ?? dataSetKeyOf(m.sourceId, "material");   // the ROW names its dataset (the catalogue splits by the standard it cites)
    const byClass = srcCls === "all" ? narrowed : narrowed.filter((m) => classOf(m) === srcCls);
    const dsets = dataSetGroups(dsAll, byClass.reduce((acc, m) => acc.set(keyOf(m), (acc.get(keyOf(m)) ?? 0) + 1), new Map<string, number>()));
    const dsetOk = dset !== "all" && (dset.startsWith("provider:") ? dsets.some((g) => `provider:${g.provider}` === dset) : dsets.some((g) => g.sets.some((d) => d.key === dset)));
    const byDset = dsetOk ? byClass.filter((m) => inDataSet(dset, keyOf(m), dsAll)) : byClass;
    const t = q.trim().toLowerCase();
    const byText = t ? byDset.filter((m) => `${m.name} ${m.kind} ${m.sourceRef} ${m.sourceId}`.toLowerCase().includes(t)) : byDset;
    const groupOf = (m: MaterialRow): string => m.nameGroup ?? nameGroup(m.name);
    const groups = [...byText.reduce((acc, m) => acc.set(groupOf(m), (acc.get(groupOf(m)) ?? 0) + 1), new Map<string, number>())].sort((a, b) => a[0].localeCompare(b[0]));
    const grpOk = grp !== "all" && groups.some(([g]) => g === grp);
    const pool = grpOk ? byText.filter((m) => groupOf(m) === grp) : byText;
    const classCount = (c: SourceClass): number => narrowed.filter((m) => classOf(m) === c).length;
    const cands = M.candidates({ material: fl.material, thicknessM: th > 0 ? th : fl.thicknessM, category: fl.category }, cur.kind ?? null);
    const candRank = new Map(cands.map((m, i) => [m.key, i] as const));
    const rank = (m: MaterialRow): number => (isMine(m) ? 0 : keywordMatch(m, fl.material) ? 1 : candRank.has(m.key) ? 2 : 3);
    const sorted = [...pool].sort((a, b) => rank(a) - rank(b) || (rank(a) === 2 ? candRank.get(a.key)! - candRank.get(b.key)! : 0) || a.name.localeCompare(b.name));
    const list = sorted.slice(0, 80), more = sorted.length - list.length;
    const saved = list.filter(isMine).length;   // the user's own rows, listed first
    /** A CLICK REPLACES THE LAYER (user, 2026-09-29: "selecting an item in the material option table … should insert values from
     *  MOT replacing the selected layer in MVT"): the row lands on the layer in the view — its name, its own thickness, its R — the
     *  view's foot re-sums ΣR + films → U, and a custom edit drafted on the layer is dropped; Apply assembly then writes the assembly */
    const insert = (m: MaterialRow): void => { stageLayer(sel, { ...layerPickFor(m, fl.thicknessM), custom: undefined }); setPalSel(m.key); };
    const badge = (m: MaterialRow): string => (isMine(m) ? "yours" : m.sourceId === "opus" ? "reference" : m.sourceId === "hof2005" ? "HOF" : m.sourceId === "osstd" ? "catalogue" : m.sourceId);
    /** a candidate's R at the thickness the layer would take: its own when it has mass, the stated R otherwise */
    const rOwn = (m: MaterialRow): number | null => rAt(m, m.cls === "Material" && m.thicknessM ? m.thicknessM : th);
    /** THE TOOLTIP (user, 2026-09-16): the row's numbers and its source, in the user's units, on hover */
    const tip = (m: MaterialRow): string => {
      const n = (v: number | null, ip: number, uSi: string, uIp: string, d = 3): string => (v === null ? "—" : p.imperial ? `${(v / ip).toFixed(d)} ${uIp}` : `${v.toFixed(d)} ${uSi}`);
      return [
        m.name,
        `${m.cls.replace(/^Material:?/, "") || "Material"} · ${KIND_LABELS[m.kind]} · category ${rolesOf(m).map(roleLabel).join(", ") || "—"}`,
        m.thicknessM !== null ? `thickness ${fmtTh(m.thicknessM)}${m.cls === "Material" && Math.abs(m.thicknessM - th) > 1e-4 ? " — the layer takes it" : ""}` : "no thickness of its own",
        m.cls === "Material" ? `k ${n(m.conductivityWmK, IP.kWmK, "W/m·K", "Btu·in/h·ft²·°F")} · ρ ${n(m.densityKgM3, IP.rho, "kg/m³", "lb/ft³", 1)} · cp ${n(m.specificHeatJKgK, IP.cp, "J/kg·K", "Btu/lb·°F", p.imperial ? 3 : 0)}` : `R stated ${fmtR(m.rSi)}`,
        `R ${fmtR(rOwn(m))} at ${fmtTh(m.cls === "Material" && m.thicknessM ? m.thicknessM : th)} · roughness ${m.roughness ?? "MediumRough (the engine's default)"}`,
        `${absStated(m).solar || absStated(m).thermal ? "" : "surface values are the engine's defaults — "}TE (thermal absorptance) ${m.thermalAbs ?? "0.9 (the engine's default)"} · SR ${(1 - (m.solarAbs ?? 0.7)).toFixed(2)} (solar absorptance ${m.solarAbs ?? "0.7, default"}) · visible absorptance ${m.visibleAbs ?? "0.7 (default)"}`,
        `source: ${m.sourceRef}`,
        DATASET_RIGHTS[keyOf(m)] ? `rights: ${DATASET_RIGHTS[keyOf(m)]}` : "",
        m.notes ? `notes: ${m.notes}` : "",
        m.keywords?.length ? `keywords: ${m.keywords.join("; ")}` : "",
      ].filter(Boolean).join("\n");
    };
    const dialogHere = p.dialog && p.dialog.seq === sel && !p.dialog.editFrom ? p.dialog : null;
    const origin = cur.role ? "your ruling" : read.from === "word" ? `read from the file's word "${fl.material}"` : read.from === "position" ? `read from its position (${rl.position} of ${live.length})` : "open: the file's word and the position say nothing — pick one, or search the whole section";
    return (
      <>
        {/* THE HEAD (user, 2026-09-16: "the lower frame must show material category with the table of materials shown below … apply
            button at top right of frame"): the category, a search, show all — and at the right the actions, Apply last */}
        {/* THE HEAD ROW (2026-09-17, the user: the buttons in line with the category, "show all" gone — it is an entry of
            the category select now): the category, the search, then Internet · New · Apply to layer n */}
        <div className="palBar">
          <span className="l">
            <select className={`layerPick ${showAll ? "" : cur.role ? "src-user" : "src-file"}`} value={showAll ? "*" : role ?? ""} title={`the category of material for layer ${rl.position} of this ${section} — ${origin}${read.flag && !cur.role ? ` · ${read.flag}` : ""} · every category lists all ${all.length} rows`}
              onChange={(e) => { const v = e.target.value as LayerRole | "" | "*"; if (v === "*") { setShowAll(true); return; } setShowAll(false); stageLayer(sel, { role: v && v !== read.role ? v : undefined }); }}>
              <option value="">— the category —</option>
              {roles.map((e) => <option key={e.role} value={e.role}>{e.label}{e.role === read.role ? " — as read" : ""}</option>)}
              <option value="*">— every category ({all.length}) —</option>
            </select>
            <input className="q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="search" title="a word of the name, the kind or the source" />
          </span>
          <span className="r">
            <button className="qaBtn" onClick={() => p.onBrowse?.(sel, fl.material)} title="a browser window beside the app on a search for this material (BCL, the web); the numbers come back through New">Internet</button>
            <button className="qaBtn" onClick={() => p.onHand?.(sel, role)} title="a new row for this layer: its numbers typed in a dialog in your units, with the page or document they came from as its source">New</button>
          </span>
        </div>
        {/* THE FILTERS (2026-09-17, the user): where the numbers come from, which dataset, and the name's own group —
            materials.db's `sources` classes and `name_group` column; each select lists what the ones before it leave */}
        <div className="palBar palFilters">
          <span className="l">
            <label title="where the numbers come from: Open — the libraries and standards (the EnergyPlus DataSets, openstudio-standards, the reference list) · Manufacturers — a maker's own published data · Custom — rows you typed or saved">Source
              <select value={srcCls} onChange={(e) => { setSrcCls(e.target.value as "all" | SourceClass); setDset("all"); }}>
                <option value="all">All ({narrowed.length})</option>
                {(["open", "manufacturer", "yours"] as SourceClass[]).map((c) => <option key={c} value={c}>{SOURCE_CLASS_LABELS[c]} ({classCount(c)})</option>)}
              </select>
            </label>
            <label title="the dataset within that class, as &quot;provider - set&quot; (EnergyPlus - ASHRAE HOF materials, Claude Opus - reference list, Typed by hand - your own materials). These are the MATERIAL datasets; a window or door type lists the fenestration ones. A provider with more than one set is a group you can take whole.">DataSet
              <select value={dsetOk ? dset : "all"} onChange={(e) => setDset(e.target.value)}>
                <option value="all">All ({byClass.length})</option>
                {dsetOptions(dsets)}
              </select>
            </label>
            <label title="the name's own group: its first word, a leading code or number taken with the word after it — Aluminum · F08 Metal · 10 PSF · Asphalt">Name
              <select value={grpOk ? grp : "all"} onChange={(e) => setGrp(e.target.value)}>
                <option value="all">All ({byText.length})</option>
                {groups.map(([g, n]) => <option key={g} value={g}>{g} ({n})</option>)}
              </select>
            </label>
          </span>
        </div>
        {/* THE LIST: one line per material — a click puts it on the layer; the numbers and the source in the tooltip. It scrolls
            under its own head, the bars above it fixed (user, 2026-09-29: "MOT headers … stay in position … when materials are scrolled") */}
        <div className="palScroll"><table className="spaceTable palTable">
          <thead><tr>
            <th title="the materials of this category, one per line — your own rows first, then the reference list's keyword matches, the name-matched candidates, the rest by name; click a row and it replaces the layer in the view above; hover a row for its numbers and its source; the search box and the three filters under the head narrow it, “every category” in the category select widens it">{list.length}{more ? ` of ${sorted.length}` : ""} {showAll ? "materials, every category" : role ? roleLabel(role).toLowerCase() : `materials a ${section} takes`}{t ? ` for "${q.trim()}"` : ""}{saved ? ` · ${saved} saved by you, first` : ""}</th>
            <th className="num" title="thermal resistance in your units — a material with mass at its own thickness (the layer takes that thickness), a massless one at its stated R; the layer's R in the view follows the pick — the number alone">R <span className="unit">{p.imperial ? "h·ft²·°F/Btu" : "m²K/W"}</span></th>
            <th className="abs" title="SR — the solar reflectance a product sheet states (CRRC, ENERGY STAR) = 1 − the engine's solar absorptance (0–1). Greyed when the row states none and the engine's 0.7 absorptance (SR 0.30) stands in, or when it is the catalogue's copy of the defaults. No dataset here measures SR for a generic material — a product's own sheet is the source (New)">SR</th>
            <th className="abs" title="TE — the thermal emittance a product sheet states (the engine's thermal absorptance, long-wave, 0–1): the surface's radiant exchange with the sky and the room. Greyed when the row states none and the engine's 0.9 stands in — or when a catalogue row carries exactly the engine's three defaults with no standard named (a copy of the defaults, not a measurement)">TE</th>
            <th className="src" title="who states the numbers: yours — a row you typed or edited; reference — the list derived by Claude Opus (typical handbook values, not product-certified); HOF — the EnergyPlus DataSets (ASHRAE HOF 2005); catalogue — openstudio-standards; the row's tooltip carries the exact reference">source</th>
          </tr></thead>
          <tbody>
            {dialogHere && <tr className="sel"><td>new material — {dialogHere.name || "typing…"}</td><td className="num">—</td><td className="abs">—</td><td className="abs">—</td><td className="src src-user">yours</td></tr>}
            {list.map((m) => (
              <tr key={m.key} className={palSel === m.key ? "sel" : curRow?.key === m.key ? "on" : ""} onClick={() => insert(m)} title={`${tip(m)}\n\nclick: this material replaces layer ${rl.position ?? ""} in the view`}>
                <td>{curRow?.key === m.key ? "● " : ""}{m.name}</td>
                <td className="num">{fmtRn(rOwn(m))}</td>
                {(() => { const st = absStated(m); return <>
                  <td className={`abs${st.solar ? "" : " muted"}`} title={st.solar ? undefined : "the engine's default absorptance 0.7 (SR 0.30) — the row states no reflectance of its own"}>{(1 - (m.solarAbs ?? 0.7)).toFixed(2)}</td>
                  <td className={`abs${st.thermal ? "" : " muted"}`} title={st.thermal ? undefined : "the engine's default 0.9 — the row states no emittance of its own"}>{(m.thermalAbs ?? 0.9).toFixed(2)}</td>
                </>; })()}
                <td className={`src ${srcClass(isMine(m) || m.sourceId === "opus" ? "user" : "dataset")}`}>{badge(m)}{palSel === m.key && p.onEdit && <> <button className="qaBtn mini" onClick={(e) => { e.stopPropagation(); p.onEdit!(sel, m); }} title="this row's numbers in the dialog, in your units — Save makes a row of yours and the layer takes it; a row of yours can be deleted there too">edit…</button></>}</td>
              </tr>
            ))}
            {more > 0 && <tr className="more"><td colSpan={5}>{more} more — search to narrow the list</td></tr>}
            {list.length === 0 && !dialogHere && <tr className="more"><td colSpan={5}>nothing here{t ? ` for "${q.trim()}"` : ""} — widen a filter, pick “every category”, or add a row with New</td></tr>}
          </tbody>
        </table></div>
      </>
    );
  }

  // ── THE FENESTRATION DATASETS (2026-09-17, the user: "windows carry different material data than standard materials
  //    — can we carry a Fenestration (Window · Door · Skylights) db DataSets table that is referenced in when windows /
  //    doors are selected (and not show standard Material db DataSets)"). One table in materials.db holds them: the
  //    engine's own window constructions (a pick is a library ruling, its objects emitted verbatim), the reference
  //    list's generic sets and the manufacturers' NFRC whole-product ratings (a pick is a U ruling carrying the
  //    product). The three filters are the layer palette's, over this table's own columns.
  if (glazed && p.materials) {
    const M = p.materials;
    const section = r.kind === "door" ? "door" : "window";
    const rows = M.fenestration(section);
    const srcs = M.sources();
    const classOf = (g: GlazingProduct): SourceClass => srcs.find((x) => x.id === g.sourceId)?.sourceClass ?? "open";
    // the FENESTRATION datasets alone (2026-09-18) — the engine's constructions, the generic sets, a maker's line, yours
    const dsAll = resolveDataSets(srcs, "fenestration");
    const keyOf = (g: GlazingProduct): string => dataSetKeyOf(g.sourceId, "fenestration");
    const byClass = fSrc === "all" ? rows : rows.filter((g) => classOf(g) === fSrc);
    const dsets = dataSetGroups(dsAll, byClass.reduce((acc, g) => acc.set(keyOf(g), (acc.get(keyOf(g)) ?? 0) + 1), new Map<string, number>()));
    const dsetOk = fDset !== "all" && (fDset.startsWith("provider:") ? dsets.some((x) => `provider:${x.provider}` === fDset) : dsets.some((x) => x.sets.some((d) => d.key === fDset)));
    const byDset = dsetOk ? byClass.filter((g) => inDataSet(fDset, keyOf(g), dsAll)) : byClass;
    const t = fQ.trim().toLowerCase();
    const byText = t ? byDset.filter((g) => `${g.name} ${g.productType} ${g.glassOption ?? ""} ${g.coating ?? ""} ${g.gas ?? ""} ${g.divider ?? ""} ${g.cpd ?? ""} ${g.sourceRef}`.toLowerCase().includes(t)) : byDset;
    const groups = [...byText.reduce((acc, g) => acc.set(g.nameGroup ?? nameGroup(g.name), (acc.get(g.nameGroup ?? nameGroup(g.name)) ?? 0) + 1), new Map<string, number>())].sort((a, b) => a[0].localeCompare(b[0]));
    // the product type the FILE's own type name names, pre-selected as the group until the user picks another
    // (the user's ruling of 2026-09-16: "product type pre-selected from the file's type name")
    const nameLabel = `${r.key} ${r.label}`.toLowerCase().replace(/[_-]+/g, " ");
    const defGrp = groups.map(([g]) => g).find((g) => g.split(/,\s*/).every((w) => nameLabel.includes(w.toLowerCase()))) ?? null;
    const grpNow = fGrpSet ? fGrp : defGrp ?? "all";
    const grpOk = grpNow !== "all" && groups.some(([g]) => g === grpNow);
    const pool = grpOk ? byText.filter((g) => (g.nameGroup ?? nameGroup(g.name)) === grpNow) : byText;
    const sorted = [...pool].sort((a, b) => a.sourceId.localeCompare(b.sourceId) || a.name.localeCompare(b.name));
    const list = sorted.slice(0, 200), more = sorted.length - list.length;
    const on = (g: GlazingProduct): boolean => (gov === "library" ? st?.library?.name === g.libName : gov === "u" ? st?.product?.key === g.key : false);
    const selRow = fSel ? rows.find((g) => g.key === fSel) ?? null : null;
    /** APPLY: a construction becomes a library ruling (the engine's objects, verbatim); a product a U ruling carrying it */
    const applyFen = (g: GlazingProduct | null): void => {
      if (!g) return;
      if (g.rowKind === "construction" && g.libFile && g.libName) p.onStage(r.key, { source: "library", library: { file: g.libFile, name: g.libName } });
      else p.onStage(r.key, { source: "u", uWm2k: g.uWm2k, shgc: g.shgc, vt: g.vt ?? undefined, product: { key: g.key, name: g.name, source: g.sourceId } });
      setFSel(null);
    };
    const badge = (g: GlazingProduct): string => (g.cpd ? `NFRC · ${g.cpd}` : g.sourceId === "opus" ? "reference" : g.sourceId === "epwin" ? "dataset" : g.sourceId === "hand" ? "yours" : g.sourceId);
    const what = (g: GlazingProduct): string => (g.rowKind === "construction"
      ? `${g.productType} · centre of glass, no frame`
      : `SHGC ${g.shgc.toFixed(2)}${g.panes ? ` · ${g.panes} pane${g.panes === 1 ? "" : "s"}` : ""}${g.coating ? ` · ${g.coating}` : ""}${g.gas ? ` · ${g.gas}` : ""}${g.divider ? ` · ${g.divider}` : ""}`);
    return (
      <>
        <div className="palBar">
          <span className="l">
            <span className="muted" title="a window, a glazed door or a skylight takes a whole assembly, not a stack of materials — this is the FENESTRATION table of materials.db: the engine's own window constructions, the reference list's generic sets and the manufacturers' NFRC ratings. The standard material rows are not offered here.">fenestration datasets · {r.kind === "door" ? "glazed door" : "window"}</span>
            <input className="q" value={fQ} onChange={(e) => setFQ(e.target.value)} placeholder="search" title="a word of the name, the glass option, the coating, the gas, the divider or the CPD" />
          </span>
          <span className="r">
            <button className="qaBtn" onClick={() => p.onBrowse?.(-1, `${r.label} ${r.kind === "door" ? "glazed door" : "window"} NFRC U-factor SHGC`)} title="a browser window beside the app on a search for this window or door — the numbers come back through New">Internet</button>
            <button className="qaBtn" onClick={() => p.onFenHand?.(r.key, st?.name ?? r.label, r.kind === "door" ? "door" : "window")} title="a fenestration row of your own: the label's whole-product U, SHGC and VT typed in a dialog, with the certificate or page they came from — this type takes it">New</button>
            <button className="apply mini" disabled={!selRow} onClick={() => applyFen(selRow)} title="the selected row lands on this type — a construction as the engine's own objects, a rating as its U, SHGC and VT with the product named; the view's Apply assembly then writes it">Apply to {st?.name ?? r.label}{selRow ? ` ← ${selRow.name.length > 30 ? `${selRow.name.slice(0, 28)}…` : selRow.name}` : ""}</button>
          </span>
        </div>
        <div className="palBar palFilters">
          <span className="l">
            <label title="where the numbers come from: Open — the engine's own window constructions and the reference list's generic sets · Manufacturers — a maker's NFRC whole-product ratings · Custom — rows you saved">Source
              <select value={fSrc} onChange={(e) => { setFSrc(e.target.value as "all" | SourceClass); setFDset("all"); setFGrpSet(false); }}>
                <option value="all">All ({rows.length})</option>
                {(["open", "manufacturer", "yours"] as SourceClass[]).map((c) => <option key={c} value={c}>{SOURCE_CLASS_LABELS[c]} ({rows.filter((g) => classOf(g) === c).length})</option>)}
              </select>
            </label>
            <label title="the dataset within that class, as &quot;provider - set&quot; (EnergyPlus - window constructions, Marvin - Elevate, Marvin - Essential, Claude Opus - generic glazing sets). These are the FENESTRATION datasets; a layer lists the material ones. A provider with more than one set is a group you can take whole.">DataSet
              <select value={dsetOk ? fDset : "all"} onChange={(e) => { setFDset(e.target.value); setFGrpSet(false); }}>
                <option value="all">All ({byClass.length})</option>
                {dsetOptions(dsets)}
              </select>
            </label>
            <label title="the name's own group — for a rating the product type (Awning, Casement, Sliding Door…), for a construction the name's head (Sgl, Dbl, Trp); the one the file's type name names is pre-selected and marked ✓">Name
              <select value={grpOk ? grpNow : "all"} onChange={(e) => { setFGrp(e.target.value); setFGrpSet(true); }}>
                <option value="all">All ({byText.length})</option>
                {groups.map(([g, n]) => <option key={g} value={g}>{g} ({n}){g === defGrp ? " ✓" : ""}</option>)}
              </select>
            </label>
          </span>
        </div>
        <div className="palScroll"><table className="spaceTable palTable">
          <thead><tr>
            <th title="the fenestration datasets this type can take, one per line — click a row to select it and Apply (top right), or double-click it; the row's tooltip carries its reference">{list.length}{more > 0 ? ` of ${sorted.length}` : ""} {r.kind === "door" ? "glazed-door" : "window"} rows{grpOk ? ` · ${grpNow}` : ""}</th>
            <th className="num" title="the whole-product U where a rating states it (the frame inside it), the centre-of-glass U for a construction — in your units">U <span className="unit">{p.imperial ? "Btu/h·ft²·°F" : "W/m²K"}</span></th>
            <th className="abs" title="solar heat gain coefficient (0–1): the share of the sun's heat that gets through">SHGC</th>
            <th className="abs" title="visible transmittance (0–1) — blank where the rating does not publish one; the engine estimates it">VT</th>
            <th className="src" title="dataset — the engine's own WindowConstructs; NFRC · CPD — a certified whole-product rating; reference — the list derived by Claude Opus (typical, uncertified)">source</th>
          </tr></thead>
          <tbody>
            {list.map((g) => (
              <tr key={g.key} className={fSel === g.key ? "sel" : on(g) ? "on" : ""} onClick={() => setFSel(fSel === g.key ? null : g.key)} onDoubleClick={() => applyFen(g)} title={`${g.name}\n${g.sourceRef}${g.notes ? `\n${g.notes}` : ""}${g.uIpMin !== null ? `\nU ${g.uIpMin}–${g.uIpMax} Btu/h·ft²·°F · SHGC ${g.shgcMin}–${g.shgcMax}` : ""}`}>
                <td>{on(g) ? "● " : ""}{g.name}<div className="muted">{what(g)}</div></td>
                <td className="num">{fU(g.uWm2k)}</td>
                <td className="abs">{g.shgc.toFixed(2)}</td>
                <td className="abs">{g.vt === null ? "—" : g.vt.toFixed(2)}</td>
                <td className={`src ${g.sourceId === "hand" || g.sourceId === "opus" ? "src-user" : "src-dataset"}`}>{badge(g)}{fSel === g.key && g.sourceId === "hand" && p.onFenEdit && <> <button className="qaBtn mini" onClick={(e) => { e.stopPropagation(); p.onFenEdit!(r.key, st?.name ?? r.label, g); }} title="this row's numbers in the dialog — Save keeps it (and the type takes it), Delete removes it">edit…</button></>}</td>
              </tr>
            ))}
            {more > 0 && <tr className="more"><td colSpan={5}>{more} more — narrow with a filter or the search</td></tr>}
            {list.length === 0 && <tr className="more"><td colSpan={5}>nothing here — widen a filter{t ? ` or clear "${fQ.trim()}"` : ""}</td></tr>}
          </tbody>
        </table></div>
        {/* the values typed by hand stay reachable: a U ruling with no product (2026-09-16's row, kept) */}
        <div className="palBar">
          <span className="l muted" title="state the label's whole-window numbers yourself — the frame is inside the U; a number typed over a product's clears the product">
            or type them:
            {" "}U <NumInput className={uRow && !uRow.product ? "src-user" : ""} style={{ width: 70 }} digits={3} min={0.001} value={uRow ? (p.imperial ? uRow.uWm2k! / U_IP : uRow.uWm2k!) : null} onValue={(v) => { if (v !== null && v > 0) { const base = uRow ? { ...uRow } : { source: "u" as const, shgc: 0.4, vt: 0.5 }; const { product: _drop, ...typed } = base as typeof base & { product?: unknown }; p.onStage(r.key, { ...typed, source: "u", uWm2k: (p.imperial ? U_IP : 1) * v }); } }} />
            {" "}SHGC <NumInput className={uRow && !uRow.product ? "src-user" : ""} style={{ width: 56 }} digits={2} min={0.01} max={0.99} value={uRow?.shgc ?? null} onValue={(v) => { if (v !== null && uRow) { const { product: _drop, ...typed } = uRow; p.onStage(r.key, { ...typed, shgc: v }); } }} />
            {" "}VT <NumInput className={uRow && !uRow.product ? "src-user" : ""} style={{ width: 56 }} digits={2} min={0.01} max={0.99} value={uRow?.vt ?? null} onValue={(v) => { if (v !== null && uRow) p.onStage(r.key, { ...uRow, vt: v }); }} />
            {uRow?.product ? ` · now: ${uRow.product.name}` : ""}
          </span>
        </div>
      </>
    );
  }

  // ── the TYPE's options
  return (
    <table className="spaceTable typeTable">
      <thead><tr><th>option for {r.label} · {fmtArea(r.grossM2, p.imperial)}</th><th>what it is</th><th className="num">U {p.imperial ? "Btu/h·ft²·°F" : "W/m²K"}</th><th>source</th></tr></thead>
      <tbody>
        <tr className={gov === "code" ? "sel" : ""} onClick={() => p.onStage(r.key, undefined)}><td>code default</td><td className="wrap">{p.code?.name ?? r.constructions.join(" · ") ?? "—"} — the energy code's row for the site's zone (SITE), nominal assembly U with films</td><td className="num">{fU(p.code?.uWm2k ?? r.uWm2k)}</td><td className="src-code">code-default</td></tr>
        {gov === "sameAs" && <tr className="sel"><td>same as…</td><td className="wrap">this type takes {st?.sameAs ? `"${st.sameAs}"` : "another type's"} construction — the target is chosen in the column</td><td /><td className="src-user">user</td></tr>}
        {fileLayers.length > 0 && lib && (
          <Fragment>
            <tr className={gov === "layers" ? "sel" : ""} onClick={() => p.onStage(r.key, withLayers(st, stack.map((x) => x.pick)))}>
              <td>the file's layers</td><td className="wrap">each layer at the file's thickness with the material picked for it — select a layer in the DETAIL view (a band, or a row under it) to pick{gov === "layers" ? "" : " — click, then select a layer"}</td>
              <td className="num">{(() => { if (gov !== "layers" || !p.materials) return "—"; const objs = live.map((x) => x.pick).map((q) => (q.ref ? resolveMaterialRef(lib, q.ref) : null)).filter((o): o is NonNullable<typeof o> => !!o); if (!objs.length) return "pick a layer"; const sr = stackR(objs); return sr.unknown.length || live.map((x) => x.pick).some((q) => q.parts) ? "see DETAIL" : fU(1 / (sr.rSi + film)); })()}</td>
              <td className="src-dataset">dataset</td>
            </tr>
            {gov === "layers" && live.map((rl) => {
              // one row per layer, the material picked from its name-matched candidates RIGHT HERE (user, 2026-09-08:
              // "selecting the material in the table should present options"); the row itself opens the layer's full options
              const l = rl.file ?? { part: null, material: rl.pick.material, thicknessM: rl.pick.thicknessM ?? null, category: null };
              const i = rl.seq, cur = rl.pick;
              const th = cur.thicknessM ?? l.thicknessM ?? 0;
              const M = p.materials;
              const curKey = cur.ref && "key" in cur.ref ? cur.ref.key : "";
              const curRow = curKey && M ? M.byKey(curKey) : null;
              const cands = M ? M.candidates({ material: l.material, thicknessM: th > 0 ? th : l.thicknessM, category: l.category }, cur.kind ?? null) : [];
              const listed = curRow && !cands.some((m) => m.key === curRow.key) ? [curRow, ...cands] : cands;
              const what = cur.parts?.length ? `${cur.parts.length} parts: ${cur.parts.map((x) => ("key" in x.ref ? (M?.byKey(x.ref.key)?.name ?? x.ref.key) : x.ref.name)).join(" + ")}` : cur.rSi && !cur.ref ? `R ${cur.rSi.toFixed(2)} typed` : null;
              return (
                <tr key={i} className={`sub${p.layerSel === i ? " sel" : ""}`} onClick={(e) => { e.stopPropagation(); p.onLayer(i); }} title="the layer's material; the row opens its full options (sub-items, thickness, a typed R, the Internet search)">
                  <td className="wrap">  ↳ {rl.position} · {l.material}{rl.added ? " (added)" : ""}{l.thicknessM !== null ? ` · ${fmtTh(th)}` : ""}</td>
                  <td className="wrap">
                    {what ? <span className="src-dataset">{what} </span> : null}
                    {M ? (
                      <select className={curRow?.sourceId === "hand" ? "src-user" : "src-dataset"} value={curKey} onClick={(e) => e.stopPropagation()}
                        onChange={(e) => { const v = e.target.value; if (v === "…more") p.onLayer(i); else if (v === "") stageLayer(i, { ref: undefined, parts: undefined, rSi: undefined, thicknessM: undefined }); else { const m = M.byKey(v); stageLayer(i, m ? layerPickFor(m, l.thicknessM) : { ref: { key: v }, parts: undefined, rSi: undefined }); } }}>
                        <option value="">— leave out —</option>
                        {listed.map((m) => <option key={m.key} value={m.key}>{m.name} · {fmtR(rAt(m, m.cls === "Material" && m.thicknessM ? m.thicknessM : th))} · {m.sourceId}</option>)}
                        <option value="…more">more options… (search, sub-items, thickness)</option>
                      </select>
                    ) : <span className="muted">materials.db not read</span>}
                  </td>
                  <td className="num">{curRow ? fmtR(rAt(curRow, th)) : cur.rSi && !cur.ref ? fmtR(cur.rSi) : "—"}</td>
                  <td className={`wrap ${curRow ? srcClass(curRow.sourceId === "hand" ? "user" : "dataset") : "muted"}`}>{curRow ? curRow.sourceRef.slice(0, 60) : "no material — left out"}</td>
                </tr>
              );
            })}
          </Fragment>
        )}
        {composite && (
          <tr className={gov === "library" && st?.library?.name === composite.name ? "sel" : ""} onClick={() => p.onStage(r.key, { source: "library", library: { file: composite.file, name: composite.name } })}>
            <td>{composite.name}</td><td className="wrap">the dataset's 1-D equivalent named by the file's stud layer ({stud?.material} {stud?.thicknessM !== null && stud ? `${(stud.thicknessM! * 39.3701).toFixed(1)}″` : ""})</td>
            <td className="num">{(() => { const res = resolveConstruction(lib!, composite.name); if (!res) return "—"; const sr = stackR(res.layers); return sr.unknown.length ? "—" : fU(1 / (sr.rSi + film)); })()}</td><td className="src-dataset">dataset</td>
          </tr>
        )}
        {/* THE MANUFACTURER (user, 2026-09-16: "a manufacturer dropdown for windows for creating subsets of windows/doors, with General being
            first offer and Marvin as second"): General is the engine's window constructions and the reference list's generic sets; Marvin the
            Elevate line's NFRC ratings */}
        {/* a glazed type reaches this table only when materials.db did not load: the engine's own window constructions, and no
            manufacturer's line — the Marvin subgroup and its product/divider/glass filters went with the fenestration track
            they were replaced by on 2026-09-17, unreachable ever since (2026-09-18) */}
        {glazed && cands.length > 0 && <tr className="sum"><td colSpan={4}>window constructions in the dataset ({shown.length} of {cands.length}) — filter: <input value={filter} onChange={(e) => setFilter(e.target.value)} onClick={(e) => e.stopPropagation()} placeholder="LoE, Arg, Trp…" /> · the manufacturers' ratings are in the fenestration datasets, which need materials.db</td></tr>}
        {shown.filter((o) => o.name !== composite?.name).slice(0, glazed ? 400 : 60).map((o) => {
          const note = windowNote(o);
          const res = note ? null : resolveConstruction(lib!, o.name);
          const u = note ? note.u : res ? (() => { const sr = stackR(res.layers); return sr.unknown.length ? null : 1 / (sr.rSi + film); })() : null;
          const on = gov === "library" && st?.library?.name === o.name;
          return (
            <tr key={o.name} className={on ? "sel" : ""} onClick={() => p.onStage(r.key, { source: "library", library: { file: o.file, name: o.name } })}>
              <td className="wrap">{o.name}</td><td className="wrap">{note ? `SHGC ${note.shgc.toFixed(2)}${note.tvis !== null ? ` · VT ${note.tvis.toFixed(2)}` : ""} · centre of glass, the dataset's note` : `${o.file.replace(/\.idf$/, "")} · ${o.fields.slice(1).filter(Boolean).length} layers`}</td>
              <td className="num">{fU(u)}</td><td className="src-dataset">dataset</td>
            </tr>
          );
        })}
        <tr className={gov === "u" ? "sel" : ""} onClick={() => { if (gov !== "u") p.onStage(r.key, { source: "u", uWm2k: r.uWm2k ?? 1, shgc: glazed ? 0.4 : undefined, vt: glazed ? 0.5 : undefined }); }}>
          <td>{glazed ? (uRow?.product ? <>{uRow.product.source === "marvin" ? "NFRC" : "reference list"} · <span className="wrap">{uRow.product.name}</span></> : "NFRC values…") : "a U value…"}</td>
          <td className="wrap">
            {gov === "u" && uRow ? (
              <span className="allRow" onClick={(e) => e.stopPropagation()}>
                {/* a number typed over a product's clears the product: the set is the user's then (2026-09-16) */}
                U <NumInput className={uRow.product ? "src-dataset" : "src-user"} style={{ width: 70 }} digits={3} min={0.001} value={p.imperial ? uRow.uWm2k! / U_IP : uRow.uWm2k!} onValue={(v) => { if (v !== null && v > 0 && Math.abs((p.imperial ? U_IP : 1) * v - uRow.uWm2k!) > 1e-6) { const { product: _drop, ...typed } = uRow; p.onStage(r.key, { ...typed, uWm2k: (p.imperial ? U_IP : 1) * v }); } }} />
                {glazed && <>SHGC <NumInput className={uRow.product ? "src-dataset" : "src-user"} style={{ width: 56 }} digits={2} min={0.01} max={0.99} value={uRow.shgc ?? 0.4} onValue={(v) => { if (v !== null && Math.abs(v - (uRow.shgc ?? 0.4)) > 1e-6) { const { product: _drop, ...typed } = uRow; p.onStage(r.key, { ...typed, shgc: v }); } }} /></>}
                {glazed && (uRow.product && uRow.vt === undefined
                  ? <span className="muted" title="Marvin publishes no VT; the field goes out blank and the engine estimates it — type one here to state it">VT not published (blank)</span>
                  : <>VT <NumInput className="src-user" style={{ width: 56 }} digits={2} min={0.01} max={0.99} value={uRow.vt ?? 0.5} onValue={(v) => { if (v !== null) p.onStage(r.key, { ...uRow, vt: v }); }} /></>)}
              </span>
            ) : glazed ? "the label's whole-window U, SHGC and VT — the frame is inside the U; no frame object" : "an assembly U with films, as one layer at 1/U − the films"}
          </td>
          <td className="num">{uRow ? fU(uRow.uWm2k ?? null) : "—"}</td>{uRow?.product ? <td className={uRow.product.source === "marvin" ? "src-dataset" : "src-user"}>{uRow.product.source === "marvin" ? "NFRC" : "reference list"}</td> : <td className="src-user">user</td>}
        </tr>
      </tbody>
    </table>
  );
}
