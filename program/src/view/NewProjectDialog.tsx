// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// NEW PROJECT (2026-11-12, the user: "a self-contained project … copied in through selection process (this leaves the original in place
// as is while allowing for copy to be edited)"): a project is a folder made from a TEMPLATE — the standard one, or one of the user's own —
// with the IFC files the user picks COPIED into its ifc/. The originals are never touched. Create opens the new project. The folder
// is named for the building's IFC file (the user may type another name).

import { useEffect, useState } from "react";

const base = (p: string): string => p.split(/[\\/]/).pop() ?? p;

export function NewProjectDialog(p: { ifc: string | null; siblings: string[]; onCreated: (info: ProjectNow) => void; onCancel: () => void }): React.ReactElement {
  const [tpls, setTpls] = useState<Array<{ id: string; name: string; shipped: boolean }>>([]);
  const [tpl, setTpl] = useState<string | null>(null);
  const [dirRoot, setDirRoot] = useState("");
  const [name, setName] = useState(p.ifc ? base(p.ifc).replace(/\.ifc$/i, "") || "New project" : "New project");
  const [ifcs, setIfcs] = useState<Array<{ path: string; on: boolean }>>([...(p.ifc ? [{ path: p.ifc, on: true }] : []), ...p.siblings.map((s) => ({ path: s, on: true }))]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void window.projectFolder.templates().then((t) => {
      setTpls(t.templates);
      setTpl(t.defaultTemplate && t.templates.some((x) => x.id === t.defaultTemplate) ? t.defaultTemplate : t.templates.find((x) => x.shipped && /standard$/i.test(x.id))?.id ?? t.templates[0]?.id ?? null);
      setDirRoot(t.projectsDir);
    });
    const h = (e: KeyboardEvent): void => { if (e.key === "Escape") p.onCancel(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const safe = name.trim().replace(/[\\/:*?"<>|]/g, "-");
  const dir = dirRoot && safe ? `${dirRoot.replace(/[\\/]+$/, "")}/${safe}` : "";
  const chosen = ifcs.filter((x) => x.on).map((x) => x.path);
  const addIfc = async (): Promise<void> => {
    const picked = await window.bim.openIfc();
    if (picked && !ifcs.some((x) => x.path === picked.path)) setIfcs([...ifcs, { path: picked.path, on: true }]);
  };
  const create = async (): Promise<void> => {
    setBusy(true); setErr(null);
    try { const info = await window.projectFolder.create({ dir, name: name.trim(), template: tpl, ifcs: chosen }); if (info) p.onCreated(info); }
    catch (e) { setErr(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e)); }
    finally { setBusy(false); }
  };
  return (
    <>
      <div className="menuScrim dialogScrim" onPointerDown={p.onCancel} />
      <div className="dialog newProject" role="dialog" aria-label="New project">
        <div className="dialogHead">new project</div>
        <div className="idfInfo">A project is a folder holding everything it uses: its rulings (project.sqlite), its IFC files, weather, tables, library and results. The IFC files you pick are <b>copied</b> into it; the originals stay as they are. A file you worked on before project folders (0.3.0 and earlier) brings its rulings, history, libraries, bill imports and weather with it.</div>
        <label className="lensRow">name <input value={name} onChange={(e) => setName(e.target.value)} autoFocus style={{ flex: 1 }} /></label>
        <div className="lensRow">folder <code style={{ flex: 1 }}>{dir || "—"}</code>
          <button className="qaBtn" onClick={() => void window.projectFolder.pickFolder("Where the project folder goes", dirRoot).then((d) => { if (d) setDirRoot(d); })}>Choose…</button></div>
        <label className="lensRow">template <select value={tpl ?? ""} onChange={(e) => setTpl(e.target.value || null)}>
          {tpls.map((t) => <option key={t.id} value={t.id}>{t.name}{t.shipped ? " (shipped)" : " (yours)"}</option>)}
        </select></label>
        <div className="stepHead">IFC files to copy in</div>
        {ifcs.length === 0 && <div className="muted">none yet — add the building's IFC</div>}
        {ifcs.map((x, i) => (
          <label key={x.path} className="lensRow" title={x.path}>
            <input type="checkbox" checked={x.on} onChange={(e) => setIfcs(ifcs.map((y, j) => (j === i ? { ...y, on: e.target.checked } : y)))} /> {base(x.path)}
            {i === 0 && p.ifc && <span className="muted"> · the building</span>}
          </label>
        ))}
        <button className="qaBtn" onClick={() => void addIfc()}>Add an IFC file…</button>
        {err && <div className="bad">{err}</div>}
        <div className="allRow">
          <button className="apply" disabled={busy || !dir || !chosen.length || !tpl} onClick={() => void create()}>{busy ? "copying…" : "Create the project"}</button>
          <button className="qaBtn" onClick={p.onCancel}>cancel</button>
        </div>
      </div>
    </>
  );
}
