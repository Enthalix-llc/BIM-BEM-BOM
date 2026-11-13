// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// SITE — the first editable BEM tab (user, 2026-09-04). What the IfcSite
// states, what the weather file says about itself, the .ddy's design days,
// the run period, the ground temperatures, the simulation settings: every
// value read back from bem.db with its source, and the ones the user may
// rule on staged here and applied with one counted button into the BEM
// ledger. Nothing is computed for the model on this screen; a distance is
// a number the user reads.

import { SourcesSection } from "./SourcesSection.js";
import type { ProjectSources } from "../../../core/projectSources.js";
import { useEffect, useState } from "react";
import type { BemModelOutcome } from "../pipeline.js";
import type { SiteRuling } from "../core/bemDb.js";
import { resolveCode, PNNL_NOTICE } from "../core/energyCodes.js";
import { EnergyCodeDialog } from "./EnergyCodeDialog.js";
import { EnergyCodeEditor } from "./EnergyCodeEditor.js";
import type { CountyZoneRead } from "../../../core/climateZone.js";
import { ENGINE_DEFAULTS, CODE_DEFAULTS, SHADOW_METHODS, TERRAINS, SOLAR_DISTRIBUTIONS } from "../core/bemModel.js";
import { KV, Fold, Step, baseName, fmtTemp, fmtLen, fmtSpeed, srcClass } from "./bemUi.js";
import { GEOKISS, estimateGroundTemps, groundInputsFromAir, ftToM } from "../core/groundTemp.js";
import type { ProjectElevation } from "../../../core/levels.js";
import { MONTH_NAMES, fmtHour, northAxisFromTrueNorth, type SunPosition } from "../../../core/sun.js";
import { DEFAULT_EPW } from "../core/weather.js";
import type { SiteFocus, Located } from "./SiteViews.js";

export interface BemSiteProps {
  model: BemModelOutcome | null;
  /** THE PROJECT'S DATA SOURCES (2026-11-12): its own record (null = the template), the template in force, and Save */
  sources?: { own: ProjectSources | null; template: ProjectSources; onSave: (next: ProjectSources | null) => void };
  /** the energy code's values saved in Edit values… (2026-10-15): the app reads the project's code tables again and rebuilds the model */
  onCodesSaved?: () => void;
  /** the project's code-table folder (its data sources) */
  codeTables?: string;
  /** the county the location in force falls in, with its state and IECC zone (2026-09-29: the code dialog reads the state) */
  county?: CountyZoneRead | null;
  site: { latitude: number; longitude: number; elevationM: number } | null;
  /** THE PROJECT ELEVATION (user, 2026-09-07): the lowest occupied level, with the IfcSite's own number beside it */
  elevation: ProjectElevation | null;
  trueNorth: [number, number] | null;
  /** the weather file in force (the ledger's, else the default) */
  epw: string | null;
  /** the engine's own WeatherData files */
  epwList: string[];
  ruling: SiteRuling;
  busy: boolean;
  imperial: boolean;
  onEpw: (path: string | null) => void;
  onPickEpw: () => void;
  onApply: (site: SiteRuling) => void;
  /** the stage as the ledger kept it across a restart, and every change to it (2026-09-09) */
  staged?: SiteRuling;
  onStage?: (site: SiteRuling) => void;
  /** THE SUN in the view (2026-09-05): wall-clock in the weather file's zone; view state, never a ruling */
  sun: SunClock;
  onSun: (s: SunClock) => void;
  cycle: SunCycle;
  onCycle: (c: SunCycle) => void;
  /** deciduous tree modelling: on, a tree's opacity cycles with the month; off, every tree gives full shade */
  deciduous: boolean;
  onDeciduous: (on: boolean) => void;
  /** solar intensity: the exterior surfaces painted by the irradiance on them at the clock's hour, from the weather file's row */
  intensity: boolean;
  onIntensity: (on: boolean) => void;
  sunInfo: SunPosition | null;
  timeZone: number | null;
  siteWord: string;
  /** THE VIEW (user, 2026-09-07): the model by default; the map while locating; the stations while choosing a weather file */
  focus: SiteFocus;
  onFocus: (f: SiteFocus) => void;
  /** SOLAR STUDIES: on, the terrain, the shading elements and the sun are the view; off, the default view */
  solar: boolean;
  onSolar: (on: boolean) => void;
  /** the address the file states (IfcPostalAddress, else IfcProject.LongName) */
  address: string | null;
  /** a position picked under the map — staged here, applied with the column's one button */
  locPick: { loc: Located | null; seq: number } | null;
}

export interface SunClock { month: number; day: number; hour: number }
/** the solar study's continuous run (user, 2026-09-05: a checkbox starts and stops it):
 *  the hour through the day and / or the day through the year, at a speed */
export interface SunCycle { run: boolean; day: boolean; year: boolean; speed: 1 | 2 | 4 }

const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
/** THE ROLL-UPS (user, 2026-09-15, S10): every SITE section folds behind its head, remembered here */
const STORE = "bem-site-folds";

const BUILDING_TYPES: ReadonlyArray<readonly [string, string]> = [["residential", "Residential"], ["commercial", "Commercial"], ["industrial", "Industrial"], ["healthcare", "Healthcare"], ["laboratory", "Laboratory"], ["other", "Other"]];
const BUILDING_TYPE_TIP = "Only Residential is active now — the other types are greyed until they are built. The type decides the inputs that follow: Residential, for example, marks bedrooms (on ZONES), which set the whole-house ventilation rate (ASHRAE 62.2: bedrooms + 1), the occupants and the hot-water use.";

export function BemSite(p: BemSiteProps): React.ReactElement {
  const m = p.model;
  const setting = (k: string): { value: string; source: string } | undefined => m?.settings.find((s) => s.key === k);
  const [stage, setStage] = useState<SiteRuling>(p.staged ?? p.ruling);
  const [showDays, setShowDays] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [codeEdit, setCodeEdit] = useState(false);
  const [groundText, setGroundText] = useState("");
  useEffect(() => { setStage(p.staged ?? p.ruling); }, [p.ruling, p.staged]);
  useEffect(() => { p.onStage?.(stage); }, [stage]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (p.locPick) setStage((s) => { const n = { ...s }; if (p.locPick!.loc) n.location = p.locPick!.loc; else delete n.location; return n; }); }, [p.locPick?.seq]); // eslint-disable-line react-hooks/exhaustive-deps
  const w = m?.weather ?? null, h = w?.header ?? null;
  const set = <K extends keyof SiteRuling>(k: K, v: SiteRuling[K] | undefined): void => setStage((s) => { const n = { ...s }; if (v === undefined) delete n[k]; else n[k] = v; return n; });
  const keys = ["designDays", "runPeriod", "groundTemp", "northAxisDeg", "timestep", "shadowCalculation", "terrain", "solarDistribution", "location", "energyCode"] as const;
  const pending = keys.filter((k) => JSON.stringify(stage[k]) !== JSON.stringify(p.ruling[k])).length;
  const groundMode = stage.groundTemp ? ("from" in stage.groundTemp ? stage.groundTemp.from : "values") : "constant";
  const groundNow = setting("ground_temp_c")?.value.split(" ").map(Number) ?? Array(12).fill(CODE_DEFAULTS.groundTempC);
  const dist = setting("epw_distance_km")?.value;
  const src = (k: string): string | undefined => setting(k)?.source;
  // the placeholder is the FILE's axis (its TrueNorth), never the axis after the ruling (the tab review, SITE item 4)
  const northAxisFile = p.trueNorth ? northAxisFromTrueNorth(p.trueNorth) : null;
  // THE GROUND STRIP SHOWS THE STAGED PICK (user, 2026-09-15, S5: "changing the depth has no impact") — the applied numbers under it when they differ
  const groundInputs = groundInputsFromAir(h?.monthlyDryBulbC, h?.annualDryBulbC);
  const groundStaged = ((): { vals: number[]; src: string; word: string } => {
    const gt = stage.groundTemp;
    if (!gt) return { vals: Array(12).fill(CODE_DEFAULTS.groundTempC), src: "code-default", word: `${fmtTemp(CODE_DEFAULTS.groundTempC, p.imperial, 0)} constant` };
    if ("values" in gt) return { vals: gt.values, src: "user", word: "twelve values" };
    if (gt.from.startsWith("estimate:")) { const ft = Number(gt.from.slice(9)); return groundInputs ? { vals: estimateGroundTemps(groundInputs, ftToM(ft)), src: "dataset", word: `estimated at ${ft} ft` } : { vals: groundNow, src: "code-default", word: "estimate — no weather rows read" }; }
    const d = Number(gt.from.slice(4)); const g = h?.ground.find((x) => Math.abs(x.depthM - d) < 1e-6);
    return g ? { vals: g.monthsC, src: "file", word: `the EPW at ${fmtLen(d, p.imperial, 1)}` } : { vals: groundNow, src: "code-default", word: "a depth the file does not state" };
  })();
  const groundDiffers = groundStaged.vals.some((v, i) => Math.abs(v - (groundNow[i] ?? NaN)) > 0.05);
  const tempStrip = (vals: number[]): string => vals.map((x) => (p.imperial ? (x * 9 / 5 + 32).toFixed(0) : x.toFixed(1))).join(" ");
  return (
    <div className="idfBar bemCol">
      {/* THE BUILDING TYPE (user, 2026-10-15): it decides the inputs that follow — Residential alone is built; the others are named,
          greyed, and say so. View only: nothing is ruled or written until a second type exists. */}
      <Step head="building type">
        <label className="lensRow" title={BUILDING_TYPE_TIP}>
          type
          <select value="residential" onChange={() => { /* only Residential is active */ }} title={BUILDING_TYPE_TIP}>
            {BUILDING_TYPES.map(([v, label]) => <option key={v} value={v} disabled={v !== "residential"}>{label}{v !== "residential" ? " — not yet available" : ""}</option>)}
          </select>
        </label>
      </Step>
      {/* FOLDED, THE POSITION IS ROLLED UP (user, 2026-10-27: "roll up the lat and lon coordinates when the location bar ... is
          clicked", so a real house can be shown as an example without disclosing where it is): the summary says a position is stated,
          never the numbers; unfolding shows them */}
      {p.sources && <Fold id="sources" store={STORE} head="data sources — where this project's data comes from" summary={p.sources.own ? "this project's own record" : `the ${p.sources.template.template} template`}>
        <SourcesSection own={p.sources.own} template={p.sources.template} busy={p.busy} onSave={p.sources.onSave} />
      </Fold>}
      <Fold id="location" store={STORE} head="location — the IfcSite" summary={p.site ? `position stated${stage.location ? " · located on the map" : ""} — unfold to show` : "not stated"}>
        <KV k="site" src="file" v={p.site ? `lat ${p.site.latitude.toFixed(4)} · lon ${p.site.longitude.toFixed(4)}` : "not stated"} />
        <KV k="project elev" src="file" title="the project's elevation is set by its lowest occupied level (elevators and shafts are not occupied space — the user's rule); the IfcSite's own RefElevation is shown beside it; the weather station's elevation is its own, under the weather file"
          v={p.elevation ? `${fmtLen(p.elevation.elevM, p.imperial)} — ${p.elevation.from}${p.elevation.siteRefM !== null ? ` · IfcSite.RefElevation states ${fmtLen(p.elevation.siteRefM, p.imperial, 1)}` : ""}` : "—"} />
        <KV k="address" src="file" v={p.address ?? "not stated"} />
        {stage.location && <KV k="located" src="user" v={`lat ${stage.location.latitude.toFixed(4)} · lon ${stage.location.longitude.toFixed(4)}${stage.location.label ? ` — ${stage.location.label}` : ""}`} />}
        <div className="allRow">
          <button className={`qaBtn${p.focus === "location" ? " on" : ""}`} onClick={() => p.onFocus(p.focus === "location" ? "model" : "location")}
            title="the view becomes Google Maps on the site's position, with an address locator under it">{p.focus === "location" ? "▾ the map is the view" : "locate on the map…"}</button>
          {stage.location && <button className="qaBtn" onClick={() => set("location", undefined)}>back to the file's</button>}
        </div>
        <KV k="true north" src="file" v={p.trueNorth ? `(${p.trueNorth[0].toFixed(4)}, ${p.trueNorth[1].toFixed(4)})` : "not stated"} />
        <label className="lensRow" title="Building North Axis: +Y of the project grid, clockwise from true north — from the file's TrueNorth unless ruled">
          north axis °
          <input type="number" step="0.1" className={srcClass(src("north_axis_deg"))} value={stage.northAxisDeg ?? ""} placeholder={northAxisFile !== null ? northAxisFile.toFixed(1) : "from the file"}
            onChange={(e) => set("northAxisDeg", e.target.value === "" ? undefined : Number(e.target.value))} />
        </label>
        {/* THE ENERGY CODE (user, 2026-09-16: "a dropdown approach, which for now is 2018 IECC, and use the location to determine zone (list beside the
            IECC dropdown box)"): the code the CONSTRUCTIONS code default reads; the zone is the county's, from the position in force, never typed */}
        {/* THE CODE CONFIRMED (user, 2026-09-29): the adoption or edition in force for the model, with [Choose…] — the dialog offers the
            state's adoptions by permit date and the model codes; a code of another state than the location's reads in amber */}
        {(() => {
          const cur = typeof stage.energyCode === "string" ? { adoption: stage.energyCode } : stage.energyCode;
          const r = resolveCode(cur?.adoption ?? null);
          const moved = !!r.adoption && !!p.county?.state && r.adoption.state.toUpperCase() !== p.county.state.toUpperCase();
          return (
            <div className="lensRow" title="the code whose prescriptive tables the code default reads — the IRC's chapter 11 carries the IECC's residential tables; the climate zone is the county's, read from the location in force">
              energy code <b className={moved ? "bad" : srcClass(cur ? "user" : "code-default")} title={r.edition.shipped ? PNNL_NOTICE : undefined}>{r.adoption?.label ?? r.edition.label}</b>
              {cur?.referenceDate ? <span className="muted"> · permit date {cur.referenceDate}</span> : <span className="muted"> · not confirmed — the app's default</span>}
              <span className="src-dataset"> · zone {p.county?.zone || "not read"}{p.county?.state ? ` (${p.county.state})` : ""}</span>
              {" "}<button className="qaBtn" onClick={() => setCodeOpen(true)}>Choose…</button>
              {r.edition.id === "none" && <div className="bad">no energy code is on record — Choose… › Edit values… to enter the one your project is under; the model is built, but cannot run without it</div>}
              {moved && <div className="bad">the location is in {p.county!.state}; this is {r.adoption!.state}'s code — confirm the code</div>}
            </div>
          );
        })()}
        {codeEdit && (() => { const cur = typeof stage.energyCode === "string" ? { adoption: stage.energyCode } : stage.energyCode; const r = resolveCode(cur?.adoption ?? null);
          return <EnergyCodeEditor tables={p.codeTables ?? "tables/energy-codes"} zone={cur?.climateZone ?? p.county?.zone ?? null} edition={r.edition.id === "none" ? null : r.edition.id} imperial={p.imperial}
            onSaved={() => { setCodeEdit(false); p.onCodesSaved?.(); }} onCancel={() => setCodeEdit(false)} />; })()}
        {codeOpen && <EnergyCodeDialog state={p.county?.state || null} county={p.county?.county || null} zone={p.county?.zone || null} imperial={p.imperial}
          current={typeof stage.energyCode === "string" ? { adoption: stage.energyCode } : stage.energyCode}
          onUse={(v) => { set("energyCode", v); setCodeOpen(false); }} onCancel={() => setCodeOpen(false)} onEdit={() => { setCodeOpen(false); setCodeEdit(true); }} />}
        <KV k="climate zone" src="dataset" title="by county: the IECC and ASHRAE 169 assign zones by county — the site's county from the Census boundaries, the county's zone from the DOE Building America table, both cached under data/cache"
          v={<>{setting("climate_zone_county")?.value ?? "county not read yet"} <span className="src-file">· the .ddy states {w?.climateZone ?? "nothing"}</span> <span className={srcClass(src("climate_zone_code"))}>· the code default reads {setting("climate_zone_code")?.value ?? "zone 4's row (assumed)"}</span></>} />
      </Fold>

      <Fold id="weather" store={STORE} head="weather file" summary={h ? `${baseName(p.epw ?? DEFAULT_EPW).replace(/\.epw$/i, "")} · ${h.station}` : baseName(p.epw ?? DEFAULT_EPW)}>
        <label className="lensRow" title="EPW — the EnergyPlus Weather file: 8,760 hourly rows of a typical or an actual year with a header stating the station, its position, the ground temperatures and the holidays; its .ddy sibling carries the ASHRAE design days, its .stat the statistics">
          weather file
          <select className={srcClass(src("weather_epw"))} value={p.epw ?? ""} disabled={p.busy} onChange={(e) => p.onEpw(e.target.value || null)}>
            <option value="">{baseName(DEFAULT_EPW)} (the default)</option>
            {p.epwList.map((f) => <option key={f} value={f}>{baseName(f)}</option>)}
            {p.epw && !p.epwList.includes(p.epw) && <option value={p.epw}>{baseName(p.epw)}</option>}
          </select>
        </label>
        <div className="allRow">
          <button className={`qaBtn${p.focus === "weather" ? " on" : ""}`} onClick={() => p.onFocus(p.focus === "weather" ? "model" : "weather")}
            title="Find a weather file: the view becomes a map of every available station (EnergyPlus's weather repository, energyplus.net/weather) with the list under it; click a station to use its newest file, downloaded once when it is not installed">{p.focus === "weather" ? "▾ finding on the map" : "Find…"}</button>
          <button className="qaBtn" onClick={p.onPickEpw} disabled={p.busy} title="Browse: the file dialog for an EPW anywhere on disk — the pick is used at once (not staged) and the .ddy and .stat beside it are read">Browse…</button>
        </div>
        {h && (
          <>
            <KV k="the file says" src="file" v={`${h.station} ${h.stateCountry} · WMO ${h.wmo}`} />
            <KV k="its position" src="file" v={h.latitude !== null ? `lat ${h.latitude} · lon ${h.longitude}${dist ? ` · ${p.imperial ? `${(Number(dist) * 0.621371).toFixed(1)} mi` : `${dist} km`} from the site` : ""}` : "not stated"} />
            <KV k="station elev" src="file" title="the weather station's own elevation, from the EPW's LOCATION line — not the project's" v={h.elevationM !== null ? `${fmtLen(h.elevationM, p.imperial, 0)}` : "not stated"} />
            <KV k="kind" src="file" v={h.kind === "TMY" ? `typical year: ${h.years.length} source years ${h.years[0]}–${h.years[h.years.length - 1]} · ${h.hours} h` : h.kind === "AMY" ? `actual year ${h.years.join("–")} · ${h.hours} h` : "no data rows read"} />
            <KV k="data period" src="file" v={h.dataPeriod || "—"} />
          </>
        )}
        {!h && <div className="idfInfo">the weather file has not been read yet — build the model (open a BEM tab with idf.db built)</div>}
      </Fold>

      <Fold id="days" store={STORE} head={`design days — the .ddy states ${w ? w.days.length : "?"}`} summary={w ? w.picked.map((x) => x.replace(/ \(.*\)$/, "")).join(" · ") : "placeholders"}>
        <KV k="in use" src={src("design_days")} title="the sizing periods the IDF carries: the coldest and the hottest valid design day of the .ddy beside the EPW unless you tick others below"
          v={w ? w.picked.map((x) => x.replace(/\((-?\d+(?:\.\d+)?) °C\)/g, (_m, c) => `(${fmtTemp(Number(c), p.imperial)})`)).join(" · ") : "placeholders"} />
        {w && <button className={`qaBtn sec${showDays ? " on" : ""}`} onClick={() => setShowDays((v) => !v)}
          title="the .ddy beside the EPW states one SizingPeriod:DesignDay per ASHRAE design condition — heating at 99.6 % and 99 %, cooling by dry-bulb, wet-bulb, dew-point and enthalpy at 0.4 / 1 / 2 %, and the monthly ones; a day is unusable when its humidity condition names a wet-bulb or dew-point the file leaves empty (a tide gauge's .ddy) — the engine stops on it">
          {showDays ? "▾" : "▸"} Select design days — {w.days.length} in the .ddy · {w.invalid} unusable{w.invalid ? " — missing the humidity the engine needs" : ""}</button>}
        {showDays && w && (
          <div className="qaPanel">
            <table>
              <thead><tr><th></th><th>name</th><th>date</th><th>type</th><th>max DB</th><th>humidity</th><th>wind</th></tr></thead>
              <tbody>
                {w.days.map((d) => {
                  const chosen = stage.designDays ? stage.designDays.includes(d.name) : w.picked.some((x) => x.startsWith(d.name));
                  return (
                    <tr key={d.name} className={d.valid ? "" : "bad"} title={d.valid ? d.text : "the engine refuses this object: no wet-bulb or no dry-bulb"}>
                      <td><input type="checkbox" checked={chosen} disabled={!d.valid} onChange={(e) => {
                        const cur = stage.designDays ?? w.days.filter((x) => w.picked.some((y) => y.startsWith(x.name))).map((x) => x.name);
                        const next = e.target.checked ? [...cur, d.name] : cur.filter((n) => n !== d.name);
                        set("designDays", next);
                      }} /></td>
                      <td>{d.name}</td><td>{d.month}/{d.day}</td><td>{d.type.replace(/DesignDay$/, "")}</td>
                      <td>{d.maxDbC !== null ? fmtTemp(d.maxDbC, p.imperial) : "—"}</td>
                      <td>{d.humidity.replace(/^(Wetbulb|Dewpoint) (-?\d+(?:\.\d+)?)$/i, (_m, kind, c) => `${kind} ${fmtTemp(Number(c), p.imperial)}`)}</td>
                      <td>{d.windMs !== null ? fmtSpeed(d.windMs, p.imperial) : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {stage.designDays && <button className="qaBtn" onClick={() => set("designDays", undefined)}>back to the coldest and the hottest</button>}
          </div>
        )}
      </Fold>

      <Fold id="period" store={STORE} head="run period" summary={`${stage.runPeriod?.begin[0] ?? 1}/${stage.runPeriod?.begin[1] ?? 1} – ${stage.runPeriod?.end[0] ?? 12}/${stage.runPeriod?.end[1] ?? 31}`}>
        <label className="lensRow">
          from m/d
          <input type="number" min={1} max={12} className={srcClass(src("run_period"))} value={stage.runPeriod?.begin[0] ?? 1} onChange={(e) => set("runPeriod", { begin: [Number(e.target.value), stage.runPeriod?.begin[1] ?? 1], end: stage.runPeriod?.end ?? [12, 31] })} />
          <input type="number" min={1} max={31} className={srcClass(src("run_period"))} value={stage.runPeriod?.begin[1] ?? 1} onChange={(e) => set("runPeriod", { begin: [stage.runPeriod?.begin[0] ?? 1, Number(e.target.value)], end: stage.runPeriod?.end ?? [12, 31] })} />
          to
          <input type="number" min={1} max={12} className={srcClass(src("run_period"))} value={stage.runPeriod?.end[0] ?? 12} onChange={(e) => set("runPeriod", { begin: stage.runPeriod?.begin ?? [1, 1], end: [Number(e.target.value), stage.runPeriod?.end[1] ?? 31] })} />
          <input type="number" min={1} max={31} className={srcClass(src("run_period"))} value={stage.runPeriod?.end[1] ?? 31} onChange={(e) => set("runPeriod", { begin: stage.runPeriod?.begin ?? [1, 1], end: [stage.runPeriod?.end[0] ?? 12, Number(e.target.value)] })} />
          {stage.runPeriod && <button className="qaBtn" onClick={() => set("runPeriod", undefined)}>whole year</button>}
        </label>
      </Fold>

      <Fold id="ground" store={STORE} head="ground temperature under the building surfaces" summary={<span className={srcClass(groundStaged.src)}>{groundStaged.word} · {tempStrip(groundStaged.vals)}</span>}>
        <label className="lensRow" title="Site:GroundTemperature:BuildingSurface — twelve monthly temperatures under every surface whose outside is Ground (the basement slab and walls, the crawl slab) under the constant ground method; the F-factor and Kiva methods (CONSTRUCTIONS) bring their own">
          from
          <select className={srcClass(groundStaged.src)} value={groundMode} onChange={(e) => {
            const v = e.target.value;
            if (v === "constant") set("groundTemp", undefined);
            else if (v === "values") { set("groundTemp", { values: groundStaged.vals }); setGroundText(tempStrip(groundStaged.vals)); }
            else set("groundTemp", { from: v });
          }}>
            <option value="constant">{fmtTemp(CODE_DEFAULTS.groundTempC, p.imperial, 0)} constant — the IDD's rule: 2 °C under the indoor 20 °C</option>
            {(h?.ground ?? []).map((g) => <option key={g.depthM} value={`epw:${g.depthM}`}>the EPW's undisturbed ground at {fmtLen(g.depthM, p.imperial, 1)} — the IDD cautions against it</option>)}
            {groundInputs && GEOKISS.depthsFt.map((ft) => <option key={ft} value={`estimate:${ft}`}>estimated at {ft} ft from the air temperatures — geokiss, under investigation</option>)}
            <option value="values">twelve values…</option>
          </select>
        </label>
        {groundMode.startsWith("epw:") && <div className="idfInfo src-user" title="the memo on Site:GroundTemperature:BuildingSurface in the engine's own IDD">the IDD cautions: "Do not use the undisturbed ground temperatures from the weather data. These values are too extreme for the soil under a conditioned building." — a comparison, not a recommendation</div>}
        {groundMode.startsWith("estimate:") && groundInputs && (
          <div className="idfInfo" title={GEOKISS.source}>
            the spreadsheet's SoilTemp (Kusuda–Achenbach, π 3.1416) with its inputs read from the weather file's rows — annual mean {fmtTemp(groundInputs.tavgC, p.imperial)} · amplitude {p.imperial ? `${(groundInputs.tampC * 1.8).toFixed(1)} °F` : `${groundInputs.tampC.toFixed(1)} K`} (half the swing of the monthly means) — and the sheet's own soil (α {GEOKISS.alphaFt2Day.toFixed(3)} ft²/day) and phase ({GEOKISS.dayToMin} days to the coldest surface). <b>Under investigation</b>: the sheet does not define its Max/Min air temperatures, and the IDD's caution above applies to any undisturbed temperature under a heated slab.
          </div>
        )}
        {groundMode === "values" && (
          <input className="src-user" value={groundText} placeholder={p.imperial ? "12 monthly °F" : "12 monthly °C"} onChange={(e) => {
            setGroundText(e.target.value);
            // typed in the units shown; the ruling is kept in °C, the engine's unit
            const vals = e.target.value.trim().split(/[\s,]+/).map(Number).map((x) => (p.imperial ? (x - 32) * 5 / 9 : x));
            if (vals.length === 12 && vals.every((x) => Number.isFinite(x))) set("groundTemp", { values: vals });
          }} />
        )}
        <div className={`monthStrip ${srcClass(groundStaged.src)}`} title={`${groundDiffers ? `staged: ${groundStaged.word} — Apply to move the model` : setting("ground_temp_from")?.value ?? ""}\na ground heat exchanger card writes its own ground model (Kusuda-Achenbach) from the same three parameters — the annual mean, the amplitude and the phase`}>
          {groundStaged.vals.map((v, i) => <span key={i}><i>{MONTHS[i]}</i>{p.imperial ? (v * 9 / 5 + 32).toFixed(0) : v.toFixed(1)}</span>)}
        </div>
        {groundDiffers && <div className="idfInfo" title={setting("ground_temp_from")?.value}>applied in the model: <span className={srcClass(src("ground_temp_c"))}>{tempStrip(groundNow)}</span> — Apply to move it</div>}
      </Fold>

      <Fold id="solar" store={STORE} head="solar studies — the view" summary={p.solar ? "on — the terrain, the shading elements and the sun" : "off — the model alone"}>
        <label className="allRow" title="on: the view is the model under its terrain with the site's shading elements and the sun, its shadows cast; off: the default SITE view — the model alone, the files beside the house listed under it">
          <input type="checkbox" checked={p.solar} onChange={(e) => p.onSolar(e.target.checked)} /> <b>Solar Studies</b>
        </label>
        {p.solar && (<>
        <div className="idfInfo">the sun over the IfcSite for a wall-clock hour{p.timeZone !== null ? ` (UTC${p.timeZone >= 0 ? "+" : ""}${p.timeZone}, the weather file's zone)` : " (zone from the longitude — no weather file read)"}; the shadows in the view are cast from it. {p.siteWord}</div>
        <div className="allRow">
          <select value={p.sun.month} onChange={(e) => p.onSun({ ...p.sun, month: Number(e.target.value) })}>
            {MONTH_NAMES.map((mn, i) => <option key={mn} value={i + 1}>{mn}</option>)}
          </select>
          <input type="number" min={1} max={31} value={p.sun.day} onChange={(e) => p.onSun({ ...p.sun, day: Math.max(1, Math.min(31, Number(e.target.value) || 1)) })} />
          <b>{fmtHour(p.sun.hour)}</b>
        </div>
        <input type="range" min={0} max={24} step={0.25} value={p.sun.hour} onChange={(e) => p.onSun({ ...p.sun, hour: Number(e.target.value) })} style={{ width: "100%" }} />
        <div className="allRow" title="run the sun continuously — through the day, through the year, or both — to watch the shading move (the predecessor's solar study)">
          <label><input type="checkbox" checked={p.cycle.run} onChange={(e) => p.onCycle({ ...p.cycle, run: e.target.checked })} /> run</label>
          <label><input type="checkbox" checked={p.cycle.day} onChange={(e) => p.onCycle({ ...p.cycle, day: e.target.checked })} /> through the day</label>
          <label><input type="checkbox" checked={p.cycle.year} onChange={(e) => p.onCycle({ ...p.cycle, year: e.target.checked })} /> through the year</label>
          <select value={p.cycle.speed} onChange={(e) => p.onCycle({ ...p.cycle, speed: Number(e.target.value) as SunCycle["speed"] })}>
            <option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option>
          </select>
        </div>
        <label className="allRow" title="on: a deciduous tree's opacity cycles with the month by the transmittance schedule — leaf-on 0.2 (the engine's example), leaf-off 0.8 (a stated default), April and October 0.5; off: every tree gives full shade all year">
          <input type="checkbox" checked={p.deciduous} onChange={(e) => p.onDeciduous(e.target.checked)} /> deciduous tree modelling — opacity cycles with the month; off, full shade
        </label>
        <label className="allRow" title="paint every exterior surface by the solar irradiance on it at the clock's hour: the weather file's direct-normal, diffuse and global radiation for that hour, put on the surface by its orientation (isotropic sky, albedo 0.2, unshaded) — the legend sits at the bottom centre of the view">
          <input type="checkbox" checked={p.intensity} onChange={(e) => p.onIntensity(e.target.checked)} /> solar intensity on exterior surfaces
        </label>
        {p.sunInfo && (
          <>
            <KV k="sun" v={p.sunInfo.altitudeDeg > 0 ? `${p.sunInfo.altitudeDeg.toFixed(1)}° up · ${p.sunInfo.azimuthDeg.toFixed(0)}° from true north` : "below the horizon"} />
            <KV k="day" v={`sunrise ${fmtHour(p.sunInfo.sunriseH)} · solar noon ${fmtHour(p.sunInfo.solarNoonH)} · sunset ${fmtHour(p.sunInfo.sunsetH)} · declination ${p.sunInfo.declinationDeg.toFixed(1)}°`} />
          </>
        )}
        </>)}
      </Fold>

      <Fold id="simulation" store={STORE} head="simulation" summary={`${stage.timestep ?? CODE_DEFAULTS.timestep}/h · ${stage.shadowCalculation ?? CODE_DEFAULTS.shadowCalculation} · ${stage.terrain ?? CODE_DEFAULTS.terrain} · ${stage.solarDistribution ?? CODE_DEFAULTS.solarDistribution}`}>
        <label className="lensRow" title={`the engine's own default is ${ENGINE_DEFAULTS.timestep} per hour; this app's code default ${CODE_DEFAULTS.timestep}`}>
          timesteps / h
          <input type="number" min={1} max={60} className={srcClass(src("timestep"))} value={stage.timestep ?? CODE_DEFAULTS.timestep} onChange={(e) => set("timestep", Number(e.target.value) === CODE_DEFAULTS.timestep ? undefined : Number(e.target.value))} />
        </label>
        <label className="lensRow" title={`EnergyPlus ShadowCalculation — how the engine finds what shades what: PixelCounting renders the shadows on the GPU and takes any polygon, but IGNORES a shading surface's transmittance (the engine's own Severe, 2026-09-15) — the site's trees are opaque all year under it; PolygonClipping honours the deciduous transmittance schedule and raised 28 Severes for the carve's L-shaped cells (measured 2026-09-03). Engine default ${ENGINE_DEFAULTS.shadowCalculation}.`}>
          shadows
          <select className={srcClass(src("shadow_calculation"))} value={stage.shadowCalculation ?? CODE_DEFAULTS.shadowCalculation} onChange={(e) => set("shadowCalculation", e.target.value === CODE_DEFAULTS.shadowCalculation ? undefined : e.target.value)}>
            {SHADOW_METHODS.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <label className="lensRow" title={`EnergyPlus Building.Terrain — the wind-speed profile that turns the station's 10 m wind into the wind at each surface's height, feeding the exterior convection coefficients and the wind term of infiltration and ventilation. The IDD's words: Country = flat open country · Suburbs = country towns and suburbs · City = city centre · Ocean = body of water (5 km) · Urban = urban / industrial / forest. Engine default ${ENGINE_DEFAULTS.terrain}. THE USER'S RULING (2026-09-15): Suburbs — the trees block the wind.`}>
          terrain
          <select className={srcClass(src("terrain"))} value={stage.terrain ?? CODE_DEFAULTS.terrain} onChange={(e) => set("terrain", e.target.value === CODE_DEFAULTS.terrain ? undefined : e.target.value)}>
            {TERRAINS.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <label className="lensRow" title={`EnergyPlus Building.SolarDistribution — how beam sun through the windows is spread over a zone's surfaces: MinimalShadowing (no exterior shadowing, all beam to the floor) · FullExterior (exterior shadowing computed, the beam onto the floor) · FullInteriorAndExterior (the beam projected onto the surfaces it hits — CONVEX zones only, and the carve's are not) · the two WithReflections variants add reflections from the ground and the shading surfaces. Engine default ${ENGINE_DEFAULTS.solarDistribution}. THE USER'S RULING (2026-09-15): FullExterior.`}>
          solar
          <select className={srcClass(src("solar_distribution"))} value={stage.solarDistribution ?? CODE_DEFAULTS.solarDistribution} onChange={(e) => set("solarDistribution", e.target.value === CODE_DEFAULTS.solarDistribution ? undefined : e.target.value)}>
            {SOLAR_DISTRIBUTIONS.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
      </Fold>

      <div className="allRow">
        <button className="apply" disabled={pending === 0 || p.busy || !m} onClick={() => p.onApply(stage)}
          title="the SITE rulings — design days, run period, ground temperature, north axis, timestep, shadows, terrain, solar distribution, a located position — are STAGED in this column and written to the BEM ledger (data/bem/decisions) by this one button, which counts what is waiting; the model is rebuilt and BEM reads stale until the next run. The weather file and a projected site file apply at once and are not staged.">
          {pending === 0 ? "✓ applied — nothing staged" : `Apply ${pending} setting${pending > 1 ? "s" : ""}`}
        </button>
        {pending > 0 && <button onClick={() => setStage(p.ruling)}>revert</button>}
      </div>
      {m && <div className="idfInfo">values: file {m.census.file} · code default {m.census["code-default"]} · user {m.census.user} · model {m.modelSha.slice(0, 12)}</div>}
    </div>
  );
}
