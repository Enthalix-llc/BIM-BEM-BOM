// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("bim", {
  openIfc: () => ipcRenderer.invoke("bim:open-ifc"),
  saveDb: (name, bytes) => ipcRenderer.invoke("bim:save-db", name, bytes),
  readSibling: (p, name) => ipcRenderer.invoke("bim:read-sibling", p, name),
  lastRecovery: () => ipcRenderer.invoke("bim:last-recovery"),
  listSiblings: (p) => ipcRenderer.invoke("bim:list-siblings", p),
  loadCorrections: (sha) => ipcRenderer.invoke("bim:load-corrections", sha),
  saveCorrections: (sha, json) => ipcRenderer.invoke("bim:save-corrections", sha, json),
  writeIfc: (p, bytes) => ipcRenderer.invoke("bim:write-ifc", p, bytes),
});
// the BEM module: the contract file, the weather, its ledger, the engine
contextBridge.exposeInMainWorld("bem", {
  readDataFile: (rel) => ipcRenderer.invoke("bem:read-data-file", rel),
  readText: (p) => ipcRenderer.invoke("bem:read-text", p),
  readReference: (rel) => ipcRenderer.invoke("bem:read-reference", rel),
  saveEnergyCodes: (files) => ipcRenderer.invoke("bem:save-energy-codes", files),
  exists: (p) => ipcRenderer.invoke("bem:exists", p),
  pickEpw: () => ipcRenderer.invoke("bem:pick-epw"),
  loadDecisions: (sha) => ipcRenderer.invoke("bem:load-decisions", sha),
  saveDecisions: (sha, json) => ipcRenderer.invoke("bem:save-decisions", sha, json),
  saveDecisionsSync: (sha, json) => ipcRenderer.sendSync("bem:save-decisions-sync", sha, json),
  listDecisionsHistory: (sha) => ipcRenderer.invoke("bem:list-decisions-history", sha),
  readDecisionsHistory: (sha, p) => ipcRenderer.invoke("bem:read-decisions-history", sha, p),
  engine: () => ipcRenderer.invoke("bem:engine"),
  listDir: (dir, ext) => ipcRenderer.invoke("bem:list-dir", dir, ext),
  resolveEpw: (p) => ipcRenderer.invoke("bem:resolve-epw", p),
  fetchCached: (url, cacheName, maxAgeDays) => ipcRenderer.invoke("bem:fetch-cached", url, cacheName, maxAgeDays),
  geocode: (q) => ipcRenderer.invoke("bem:geocode", q),
  openExternal: (url) => ipcRenderer.invoke("bem:open-external", url),
  openBrowser: (url) => ipcRenderer.invoke("bem:open-browser", url),
  downloadWeather: (url) => ipcRenderer.invoke("bem:download-weather", url),
  saveWeather: (stem, epwText, ddyFrom) => ipcRenderer.invoke("bem:save-weather", stem, epwText, ddyFrom),
  run: (opts) => ipcRenderer.invoke("bem:run", opts),
  readRunFile: (stamp, name) => ipcRenderer.invoke("bem:read-run-file", stamp, name),
  reportOut: (stamp, mode, title) => ipcRenderer.invoke("bem:report-out", stamp, mode, title),
  validate: (idf) => ipcRenderer.invoke("bem:validate", idf),
  onProgress: (cb) => {
    const h = (_ev, msg) => cb(msg);
    ipcRenderer.on("bem:progress", h);
    return () => ipcRenderer.removeListener("bem:progress", h);
  },
});
// BOM › CFD (2026-11-04): OpenFOAM found, a room's case run, the finished case read back from its run folder
contextBridge.exposeInMainWorld("cfd", {
  engine: (again) => ipcRenderer.invoke("cfd:engine", again),
  machine: () => ipcRenderer.invoke("cfd:machine"),
  run: (opts) => ipcRenderer.invoke("cfd:run", opts),
  cancel: (stamp) => ipcRenderer.invoke("cfd:cancel", stamp),
  read: (stamp, rel) => ipcRenderer.invoke("cfd:read", stamp, rel),
  list: (stamp, rel) => ipcRenderer.invoke("cfd:list", stamp, rel),
  exists: (stamp, rel) => ipcRenderer.invoke("cfd:exists", stamp, rel),
  settle: (stamp, n) => ipcRenderer.invoke("cfd:settle", stamp, n),
  settleNote: (stamp, json) => ipcRenderer.invoke("cfd:settle-note", stamp, json),
  onProgress: (cb) => {
    const h = (_ev, msg) => cb(msg);
    ipcRenderer.on("cfd:progress", h);
    return () => ipcRenderer.removeListener("cfd:progress", h);
  },
});
// the BOM module: the bills the user picks, the raw imports, its ledger
// every window hears a failed save (2026-09-23)
contextBridge.exposeInMainWorld("appStatus", {
  onSaveStatus: (cb) => { const h = (_e, s) => cb(s); ipcRenderer.on("app:save-status", h); return () => ipcRenderer.removeListener("app:save-status", h); },
});
contextBridge.exposeInMainWorld("bom", {
  pickCsv: () => ipcRenderer.invoke("bom:pick-csv"),
  saveImport: (sha12, ext, text) => ipcRenderer.invoke("bom:save-import", sha12, ext, text),
  readImport: (sha12, ext) => ipcRenderer.invoke("bom:read-import", sha12, ext),
  loadLedger: (sha) => ipcRenderer.invoke("bom:load-ledger", sha),
  saveLedger: (sha, json) => ipcRenderer.invoke("bom:save-ledger", sha, json),
});
// the Explain help in its own window (2026-10-15): the text of the header the mouse rests on, and closing it
contextBridge.exposeInMainWorld("explainWin", {
  show: (title, html) => ipcRenderer.invoke("explain:show", title, html),
  hide: () => ipcRenderer.invoke("explain:hide"),
});
// the project store (2026-09-30): projects by the IfcProject GlobalId, versions by sha, the lineage, export and import
contextBridge.exposeInMainWorld("projects", {
  info: () => ipcRenderer.invoke("project:info"),
  version: (sha) => ipcRenderer.invoke("project:version", sha),
  versions: (projectId) => ipcRenderer.invoke("project:versions", projectId),
  versionIndex: (sha) => ipcRenderer.invoke("project:version-index", sha),
  unassigned: () => ipcRenderer.invoke("project:unassigned"),
  registerVersion: (v) => ipcRenderer.invoke("project:register-version", v),
  exportProject: (projectId, suggested) => ipcRenderer.invoke("project:export", projectId, suggested),
  importProject: () => ipcRenderer.invoke("project:import"),
});
