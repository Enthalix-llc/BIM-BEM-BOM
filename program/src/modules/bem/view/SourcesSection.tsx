// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// BEM › SITE › DATA SOURCES (2026-11-12, the user: "a project related file that can identify what the various data sources for the
// project are … with a new project the file would start with a template"): the project's record of where its data comes from, one row
// per source, each changeable; Save writes the project's own record (applied at once, as the weather file is), "use the template"
// drops it so the template in force reads again. A table a source names is a file in the home folder the user supplies.

import { useEffect, useState } from "react";
import { readSources, sourceRows, type ProjectSources } from "../../../core/projectSources.js";

export function SourcesSection(p: {
  /** the project's own record, or null when it reads the template */
  own: ProjectSources | null;
  template: ProjectSources;
  busy: boolean;
  onSave: (next: ProjectSources | null) => void;
}): React.ReactElement {
  const inForce = p.own ?? p.template;
  const [edit, setEdit] = useState<ProjectSources | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  useEffect(() => { setEdit(null); setProblems([]); }, [JSON.stringify(inForce)]);   // eslint-disable-line react-hooks/exhaustive-deps
  const d = edit ?? inForce;
  const set = (patch: Partial<ProjectSources>): void => setEdit({ ...d, ...patch });
  const lines = (v: string): string[] => v.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const changed = !!edit && JSON.stringify(edit) !== JSON.stringify(inForce);
  return (
    <div className="sourcesSection">
      <div className="idfInfo">
        {p.own ? <>this project's own record <span className="muted">(started from the {p.own.template} template)</span></> : <>the <b>{p.template.template}</b> template — the project has no record of its own yet</>}
      </div>
      {!edit && (
        <table className="kvTable"><tbody>
          {sourceRows(inForce).map((r) => <tr key={r.key}><td className="muted">{r.label}</td><td className={p.own ? "src-user" : "src-code"}>{r.value}</td></tr>)}
        </tbody></table>
      )}
      {edit && (
        <div className="sourcesEdit">
          <label>weather station map <select value={d.weatherListing} onChange={(e) => set({ weatherListing: e.target.value as ProjectSources["weatherListing"] })}>
            <option value="energyplus">EnergyPlus's weather repository</option><option value="onebuilding-tmyx-usa">climate.onebuilding.org · USA TMYx</option></select></label>
          <label>actual-year station <select value={d.amyStation.mode} onChange={(e) => set({ amyStation: e.target.value === "nearest" ? { mode: "nearest" } : { mode: "pinned", id: "" } })}>
            <option value="nearest">the nearest that reports hourly</option><option value="pinned">a station pinned by its GHCNh id</option></select></label>
          {d.amyStation.mode === "pinned" && <div className="lensRow">
            <input placeholder="GHCNh id, e.g. USW00012345" value={d.amyStation.id} onChange={(e) => set({ amyStation: { ...d.amyStation, mode: "pinned", id: e.target.value } as ProjectSources["amyStation"] })} />
            <input placeholder="its name" value={d.amyStation.name ?? ""} onChange={(e) => set({ amyStation: { ...d.amyStation, mode: "pinned", name: e.target.value || undefined } as ProjectSources["amyStation"] })} />
            <input placeholder="file name before _AMY_ (optional)" value={d.amyStation.fileStem ?? ""} onChange={(e) => set({ amyStation: { ...d.amyStation, mode: "pinned", fileStem: e.target.value || undefined } as ProjectSources["amyStation"] })} />
          </div>}
          <label><input type="checkbox" checked={d.energyCodes.shipped} onChange={(e) => set({ energyCodes: { ...d.energyCodes, shipped: e.target.checked } })} /> the DOE/PNNL prototype code values shipped with the program</label>
          <label>your code tables (folder) <input value={d.energyCodes.tables ?? ""} placeholder="tables/energy-codes" onChange={(e) => set({ energyCodes: { ...d.energyCodes, tables: e.target.value.trim() || undefined } })} /></label>
          <label>climate zone <select value={d.climateZone.mode} onChange={(e) => set({ climateZone: e.target.value === "typed" ? { mode: "typed" } : { mode: "county-table", file: "" } })}>
            <option value="typed">typed with the energy code</option><option value="county-table">a county table</option></select></label>
          {d.climateZone.mode === "county-table" && <input placeholder="a file in the home folder, or an https URL" value={d.climateZone.file ?? d.climateZone.url ?? ""}
            onChange={(e) => { const v = e.target.value.trim(); set({ climateZone: /^https:\/\//i.test(v) ? { mode: "county-table", url: v } : { mode: "county-table", file: v } }); }} />}
          {(["infiltration", "groundFactors"] as const).map((k) => (
            <label key={k}>{k === "infiltration" ? "infiltration Cs, Cw" : "F/C ground factors"} <select value={d[k].mode} onChange={(e) => set({ [k]: e.target.value === "typed" ? { mode: "typed" } : { mode: "table", file: "" } } as Partial<ProjectSources>)}>
              <option value="typed">typed by hand</option><option value="table">a table file</option></select>
              {d[k].mode === "table" && <input placeholder="a JSON file in the home folder" value={(d[k] as { file?: string }).file ?? ""} onChange={(e) => set({ [k]: { mode: "table", file: e.target.value } } as Partial<ProjectSources>)} />}
            </label>
          ))}
          <label>material reference lists (one CSV a line) <textarea rows={2} value={d.referenceLists.join("\n")} onChange={(e) => set({ referenceLists: lines(e.target.value) })} /></label>
          <label>their datasets (JSON) <input value={d.referenceManifest ?? ""} onChange={(e) => set({ referenceManifest: e.target.value.trim() || undefined })} /></label>
          <label><input type="checkbox" checked={d.tariffs.sample} onChange={(e) => set({ tariffs: { ...d.tariffs, sample: e.target.checked } })} /> the Sample tariff card</label>
          <label>tariff card files (one a line) <textarea rows={2} value={d.tariffs.files.join("\n")} onChange={(e) => set({ tariffs: { ...d.tariffs, files: lines(e.target.value) } })} /></label>
          {problems.length > 0 && <div className="bad">{problems.join(" · ")}</div>}
        </div>
      )}
      <div className="allRow">
        {!edit && <button className="qaBtn" disabled={p.busy} onClick={() => setEdit(structuredClone(inForce))}>Change…</button>}
        {edit && <button className="apply" disabled={p.busy || !changed} onClick={() => {
          const r = readSources(edit, inForce);
          if (r.problems.length) { setProblems(r.problems); return; }
          p.onSave({ ...r.sources, template: inForce.template });
        }}>Save for this project</button>}
        {edit && <button className="qaBtn" onClick={() => { setEdit(null); setProblems([]); }}>cancel</button>}
        {p.own && !edit && <button className="qaBtn" disabled={p.busy} title={`drop this project's record — the ${p.template.template} template reads again`} onClick={() => p.onSave(null)}>use the {p.template.template} template</button>}
      </div>
    </div>
  );
}
