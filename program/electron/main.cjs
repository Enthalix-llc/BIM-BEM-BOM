// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
// Minimal Electron main: one window, two IPC handlers (open IFC, save DB).
// No server, no native modules — sql.js keeps the ABI class of pain out.
const { app, BrowserWindow, ipcMain, dialog, net, shell, Menu, crashReporter, session } = require("electron");
const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const engines = require("./engineLocate.cjs");   // the engine and the weather files, found one way for the app and the gate (2026-09-23)
const projectStore = require("./projectStore.cjs");   // the ledgers by project and version, with their lineage (2026-09-30)
const explainWindow = require("./explainWindow.cjs");   // the Explain help in a window of its own, for a second monitor (2026-10-15)

// <repo>/data — the module contract's output location. INSTALLED (2026-10-20, the installers for macOS, Windows and Linux): the app's
// own folder is read-only (inside the .app, under Program Files, in an AppImage), so the user's files — data/ and Weather/ — live in
// the app-data folder beside projects.sqlite, and the shipped references and samples are read from the install's resources folder.
// ENTHALIX_HOME names another folder for all of them (a test run, a portable copy)
const HOME_DIR = process.env.ENTHALIX_HOME ? path.resolve(process.env.ENTHALIX_HOME) : null;
if (HOME_DIR) app.setPath("userData", path.join(HOME_DIR, "chromium"));   // the window's own storage goes there too
// installed, the window's storage stays in the Enthalix folder it has used since 0.1.0, whatever the product is called (BIM-BEM-BOM
// since 2026-10-26), so a rename never resets the views a user set up
else if (app.isPackaged) app.setPath("userData", path.join(app.getPath("appData"), "Enthalix"));
const REPO_DIR = HOME_DIR ?? (app.isPackaged ? path.join(app.getPath("appData"), "Enthalix") : path.resolve(__dirname, "..", ".."));
const SHIPPED_DIR = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, "..", "..");
const DATA_DIR = path.join(REPO_DIR, "data");
// <repo>/Weather — the project's weather files (the user's ruling, 2026-09-22): searched first, and where a download lands
const WEATHER_DIR = path.join(REPO_DIR, "Weather");

// A FAILED SAVE IS NEVER SILENT (2026-09-23): on 2026-09-18 the ledgers' writes failed for hours with only the SYSTEMS column
// saying so. Every write of a user file reports a failure to every window (a banner on every tab)
const broadcast = (status) => { for (const w of BrowserWindow.getAllWindows()) { try { w.webContents.send("app:save-status", { ...status, at: new Date().toISOString() }); } catch { /* window gone */ } } };
// THE PROJECT STORE (2026-09-30, the user's rulings): projects.sqlite in the OS's per-user app-data folder — the path
// Electron gives on every platform (macOS ~/Library/Application Support, Windows %APPDATA%, Linux ~/.config), writable
// without admin rights and untouched by an update or a reinstall; never the install folder. Its own folder, Enthalix,
// the same in development and installed — beside Chromium's userData, which is NOT moved: the renderer's local storage
// (the view settings, the stage journal) lives there, and moving it would reset them on the first launch.
const STORE_FILE = path.join(HOME_DIR ?? path.join(app.getPath("appData"), "Enthalix"), "projects.sqlite");
let projects = null;   // opened before the first window (openProjects), so every ledger handler finds it
async function openProjects() {
  const initSqlJs = require("sql.js");
  const dist = path.dirname(require.resolve("sql.js"));
  const SQL = await initSqlJs({ locateFile: (f) => path.join(dist, f) });
  projects = projectStore.openStore(STORE_FILE, SQL);
  // the ledgers written under data/ before the store existed come in once — READ, never moved or deleted
  const m = projects.migrateFromFiles(DATA_DIR);
  if (!m.already) console.log(`[bim] project store ${STORE_FILE}: migrated ${m.imported.length} ledgers from data/ (${m.imported.join(", ") || "none"}), history ${m.history}${m.problems.length ? `, problems: ${m.problems.join("; ")}` : ""}`);
}
/** a user file written: a failure named to the windows, then thrown as before */
function saveUser(what, write) {
  try { return write(); }
  catch (e) { broadcast({ kind: "save", ok: false, what, error: e instanceof Error ? e.message : String(e) }); throw e; }
}
const REF_IFC = path.join(SHIPPED_DIR, "references", "ifc");
const REF_DIR = path.join(SHIPPED_DIR, "references");

// CRASH RECOVERY (user, 2026-10-09: "This raises an issue with using electron for the final program as it fails on occasion"). Two
// failures measured: the page's renderer ran out of its 4 GB heap after ~16 h (V8 OOM), and Chromium's GPU process exited (exit_code=5),
// after which the IFC view drew nothing. The main process survives both: it reloads the page, which reopens the house it had open
// (App.tsx, sessionStorage), and tells it why. Chromium otherwise blocks WebGL for a page whose GPU process crashed — why a reload after
// one stayed blank on 2026-09-29 — so that block is switched off. Three crashes inside two minutes stop the reloading and say so.
app.disableDomainBlockingFor3DAPIs();
// THE CRASH'S OWN RECORD (2026-10-09): the GPU process exits every few minutes and macOS keeps no report of it — Electron's crash reporter
// writes a minidump of every crashed process to the app's crashDumps folder, NOT uploaded anywhere
crashReporter.start({ uploadToServer: false, compress: false });
console.error(`[bim] crash dumps (local only) → ${app.getPath("crashDumps")}`);
let mainWin = null;
let lastRecovery = null;
const crashTimes = [];
function recover(why) {
  const now = Date.now();
  crashTimes.push(now);
  while (crashTimes.length && now - crashTimes[0] > 120_000) crashTimes.shift();
  console.error(`[bim] ${why} — ${crashTimes.length > 3 ? "NOT reloading: four crashes inside two minutes" : "reloading the page"}`);
  if (!mainWin || mainWin.isDestroyed()) return;
  if (crashTimes.length > 3) {
    void mainWin.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(`<body style="background:#0f1117;color:#e6e6e6;font:14px system-ui;padding:40px"><h2>BIM-BEM-BOM stopped reloading</h2><p>The page crashed four times inside two minutes (last: ${why}). Your rulings and drafts are on disk. Quit and start the app again.</p></body>`));
    return;
  }
  lastRecovery = { at: new Date().toISOString(), why };
  setTimeout(() => { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.reload(); }, 800);
}
app.on("child-process-gone", (_e, d) => { if (d.type === "GPU" && d.reason !== "clean-exit") recover(`the GPU process exited (${d.reason}, exit ${d.exitCode})`); });
ipcMain.handle("bim:last-recovery", () => { const r = lastRecovery; lastRecovery = null; return r; });

async function createWindow() {
  const win = new BrowserWindow({
    width: 1720,
    height: 980,
    backgroundColor: "#0f1117",
    autoHideMenuBar: true,   // Windows and Linux: the menu bar shows with Alt, as the macOS menu stays in the system bar
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
    },
  });
  // CUT · COPY · PASTE on a right-click in any text field (user, 2026-09-08: "it won't allow for pasting of that url") —
  // Electron gives a window no context menu of its own; the keyboard shortcuts come from the default application menu
  mainWin = win;
  // A LINK OPENS IN THE USER'S OWN BROWSER, never in a window of the app's: a page asking for a new window (a target="_blank" link — the
  // code's text, a source cited) gets the user's browser for http(s) and nothing else; the app's page never navigates away from itself
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) void shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (ev, url) => { if (!url.startsWith(DEV_URL) && !url.startsWith("file:") && !url.startsWith("data:")) { ev.preventDefault(); if (/^https?:\/\//i.test(url)) void shell.openExternal(url); } });
  win.on("closed", () => explainWindow.closeWithApp());
  win.webContents.on("render-process-gone", (_e, d) => { if (d.reason !== "clean-exit") recover(`the page's renderer exited (${d.reason}, exit ${d.exitCode})`); });
  win.webContents.on("context-menu", (_ev, params) => {
    if (!params.isEditable) return;
    Menu.buildFromTemplate([{ role: "cut" }, { role: "copy" }, { role: "paste" }, { type: "separator" }, { role: "selectAll" }]).popup({ window: win });
  });
  // THE WINDOW NEVER SHOWS A BUILD IT WAS NOT ASKED FOR (2026-09-17, the user: a silent fall back to an old
  // dist/ is the issue, and catching it is what matters). Packaged, the bundle beside the app IS the app.
  // Unpackaged — `pnpm dev` — the dev server is the ONLY source: if it never answers, the window SAYS so and
  // loads nothing, rather than presenting whatever dist/ happens to hold (here: a bundle from 2026-09-04).
  if (app.isPackaged) { await win.loadFile(path.join(__dirname, "..", "dist", "index.html")); return; }
  const started = Date.now();
  let lastErr = "";
  for (let i = 0; i < DEV_TRIES; i++) {
    try { await win.loadURL(DEV_URL); return; } catch (e) { lastErr = String(e && e.message ? e.message : e); await new Promise((r) => setTimeout(r, DEV_WAIT_MS)); }
  }
  const secs = Math.round((Date.now() - started) / 1000);
  const bundle = bundleStamp();
  console.error(`[bim] the dev server at ${DEV_URL} never answered in ${secs}s (${lastErr}) — NOTHING was loaded; the built bundle (${bundle}) was NOT used`);
  await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(devDownPage(secs, lastErr, bundle)));
}

// BIM_DEV_URL / BIM_DEV_TRIES exist so this refusal can be EXERCISED (point it at a dead port), never to change
// what a normal run does.
const DEV_URL = process.env.BIM_DEV_URL || "http://localhost:5190";
const DEV_TRIES = Number(process.env.BIM_DEV_TRIES) > 0 ? Number(process.env.BIM_DEV_TRIES) : 40;
const DEV_WAIT_MS = 500;

// What dist/ holds, in words — so a message about the build that was REFUSED can name its date.
function bundleStamp() {
  try {
    const st = fs.statSync(path.join(__dirname, "..", "dist", "index.html"));
    const days = Math.floor((Date.now() - st.mtimeMs) / 86400000);
    return `built ${new Date(st.mtimeMs).toLocaleString()}${days >= 1 ? ` — ${days} day${days === 1 ? "" : "s"} old` : ""}`;
  } catch { return "no built bundle on this machine"; }
}

// The window's own account of the failure. It loads no app code at all: an empty window that says why is
// honest, and an old build that looks like the app is not.
function devDownPage(secs, lastErr, bundle) {
  const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  return `<!doctype html><meta charset="utf-8"><title>BIM-BEM-BOM — the dev server did not answer</title>
<style>body{margin:0;background:#0f1117;color:#e6e8ee;font:14px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;padding:40px}
h1{font-size:18px;margin:0 0 18px;color:#e9b44c}code{color:#7fd1c0}p{max-width:70ch;margin:0 0 12px}
.b{border-left:3px solid #e9b44c;padding-left:14px;margin:18px 0}</style>
<h1>The app did not start — the dev server never answered</h1>
<div class="b">
<p>Tried <code>${esc(DEV_URL)}</code> ${DEV_TRIES} times over ${esc(secs)}s. Last error: <code>${esc(lastErr || "none reported")}</code>.</p>
<p><b>Nothing was loaded.</b> The built bundle in <code>dist/</code> (${esc(bundle)}) was deliberately NOT used: an old build that looks like the app is worse than an empty window.</p>
</div>
<p>Start the dev server from <code>program/</code>:</p>
<p><code>${process.platform === "win32" ? "pnpm dev" : "env -u ELECTRON_RUN_AS_NODE pnpm dev"}</code></p>
<p>Then reload this window (${process.platform === "darwin" ? "⌘R" : "Ctrl+R"}).</p>`;
}

ipcMain.handle("bim:open-ifc", async () => {
  const res = await dialog.showOpenDialog({
    title: "Open IFC",
    defaultPath: REF_IFC,
    filters: [{ name: "IFC", extensions: ["ifc"] }],
    properties: ["openFile"],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  const p = res.filePaths[0];
  const bytes = fs.readFileSync(p);
  return { name: path.basename(p), path: p, bytes };
});

// THE SITE MODEL beside the house: `_Site.ifc` in the same folder, read only
// if it exists — the terrain that says where the ground is.
ipcMain.handle("bim:read-sibling", async (_ev, p, name) => {
  const sib = path.join(path.dirname(p), name);
  try { return { name, path: sib, bytes: fs.readFileSync(sib) }; } catch { return null; }
});

// EVERY IFC BESIDE THE HOUSE (user, 2026-09-07): the site model, a shade model
// (the MEP file's PV panels) — listed for the SITE table; the user rules which
// are projected into the model
ipcMain.handle("bim:list-siblings", async (_ev, p) => {
  const dir = path.dirname(p);
  try {
    return fs.readdirSync(dir).filter((f) => /\.ifc$/i.test(f) && path.join(dir, f) !== p).sort()
      .map((f) => ({ name: f, path: path.join(dir, f), bytes: fs.statSync(path.join(dir, f)).size }));
  } catch { return []; }
});

ipcMain.handle("bim:save-db", async (_ev, name, bytes) => {
  const write = () => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const p = path.join(DATA_DIR, name);
    fs.writeFileSync(p, Buffer.from(bytes));
    return p;
  };
  // the hand-typed materials and windows are the user's own; a .db is derived — its failure is named, its bytes not backed up
  if (name === "materials-user.json") return saveUser("materials and windows typed by hand", write);
  if (name === "schedules-user.idf") return saveUser("your schedules", write);
  if (name === "calendars-user.json") return saveUser("your holiday lists and seasons", write);
  try { return write(); } catch (e) { broadcast({ kind: "save", ok: false, what: name, error: e instanceof Error ? e.message : String(e) }); throw e; }
});

// THE CORRECTIONS LEDGER. Step rulings and hand extensions are the user's
// decisions about ONE source file, so they live in a sidecar keyed by that
// file's sha256 — never inside idf.db, which is rebuilt from scratch and
// overwritten by the next file opened. Reapplied on every load of that file.
// Since 2026-09-30 every ledger lives in the project store (projects.sqlite), keyed by the file's sha as before.
ipcMain.handle("bim:load-corrections", async (_ev, sha) => projects.loadLedger("corrections", sha));
ipcMain.handle("bim:save-corrections", async (_ev, sha, json) => saveUser("BIM corrections", () => { projects.saveLedger("corrections", sha, json); return STORE_FILE; }));

// WRITING THE IFC BACK. A deletion the user rules on is written into the
// source file itself — lossless: the renderer rewrites only the lines the
// deletion touches and every other byte is preserved. The previous bytes are
// kept beside the file first, so a ruling is never a one-way door.
ipcMain.handle("bim:write-ifc", async (_ev, p, bytes) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `${p}.${stamp}.bak`;
  fs.copyFileSync(p, backup);
  fs.writeFileSync(p, Buffer.from(bytes));
  return { path: p, backup };
});

// ── THE BEM MODULE's needs: read the contract file, pick and read the
//    weather, keep its own ledger, and RUN THE ENGINE — a child process whose
//    stdout streams to the renderer as progress. The renderer writes the IDF
//    through the same functions the gate uses; main only moves bytes and
//    spawns. Run folders: data/bem/runs/<stamp>/.
const { unzipSync } = require("fflate");
const { spawn, spawnSync } = require("node:child_process");
// a path under a folder, never beside it: "data-other/x" starts with "data" but is outside it, so the separator is part of the test
const inside = (dir, r) => r === dir || r.startsWith(dir + path.sep);
const within = (p) => { const r = path.resolve(DATA_DIR, p); if (!inside(DATA_DIR, r)) throw new Error("outside data/"); return r; };
ipcMain.handle("bem:read-data-file", async (_ev, rel) => {
  try { return fs.readFileSync(within(rel)); } catch { return null; }
});
// THE ENERGY CODE'S VALUES, as the user types them in SITE › energy code › Edit values (2026-10-15): written to data/energy-codes/
// under the template's names only; the file it replaces is kept beside it first (*.csv.<stamp>.bak) — the user's own table
const ENERGY_CODE_NAMES = new Set(["editions.csv", "values.csv", "state-adoptions.csv", "state-overrides.csv"]);
ipcMain.handle("bem:save-energy-codes", async (_ev, files) => saveUser("your energy code values", () => {
  const dir = path.join(DATA_DIR, "energy-codes");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const written = [];
  for (const [name, text] of Object.entries(files)) {
    if (!ENERGY_CODE_NAMES.has(name) || typeof text !== "string") throw new Error(`not an energy-code file: ${name}`);
    const p = path.join(dir, name);
    if (fs.existsSync(p)) { if (fs.readFileSync(p, "utf8") === text) continue; fs.copyFileSync(p, `${p}.${stamp}.bak`); }
    fs.writeFileSync(p, text);
    written.push(p);
  }
  return written;
}));
// a text file under references/ — the user's reference lists (references/materials/*.csv, 2026-09-16); nothing outside it
ipcMain.handle("bem:read-reference", async (_ev, rel) => {
  try { const r = path.resolve(REF_DIR, rel); if (!inside(REF_DIR, r)) throw new Error("outside references/"); return fs.readFileSync(r, "utf8"); } catch { return null; }
});
ipcMain.handle("bem:read-text", async (_ev, p) => {
  try { return fs.readFileSync(p, "utf8"); } catch { return null; }
});
ipcMain.handle("bem:exists", async (_ev, p) => fs.existsSync(p));
ipcMain.handle("bem:pick-epw", async () => {
  const res = await dialog.showOpenDialog({
    title: "Choose a weather file",
    defaultPath: WEATHER_DIR,
    filters: [{ name: "EnergyPlus weather", extensions: ["epw"] }],
    properties: ["openFile"],
  });
  return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0];
});
ipcMain.handle("bem:load-decisions", async (_ev, sha) => projects.loadLedger("bem", sha));
ipcMain.handle("bem:save-decisions", async (_ev, sha, json) => saveUser("BEM rulings", () => { projects.saveLedger("bem", sha, json); return STORE_FILE; }));
// the same write, SYNCHRONOUS — the renderer's last word on pagehide, so a reload or a quit inside the debounce loses nothing
ipcMain.on("bem:save-decisions-sync", (ev, sha, json) => {
  try { ev.returnValue = saveUser("BEM rulings", () => { projects.saveLedger("bem", sha, json); return STORE_FILE; }); } catch (e) { ev.returnValue = null; console.error(e); }
});
// THE PREVIOUS VERSIONS of a ledger (2026-09-10): listed newest first, read one at a time — never deleted from here.
// An entry's `path` is its reference in the store (db:<id>), the shape the renderer has always passed back
ipcMain.handle("bem:list-decisions-history", async (_ev, sha) => projects.listHistory("bem", sha));
ipcMain.handle("bem:read-decisions-history", async (_ev, sha, p) => projects.readHistory("bem", sha, p));
/** THE ENGINE (2026-09-23): the pin ($ENERGYPLUS), else the NEWEST install — engineLocate.cjs, the gate's own rule */
let engineCache = null;
const findEnergyPlus = () => (engineCache ??= engines.findEngine())?.exe ?? null;
ipcMain.handle("bem:engine", async () => {
  engineCache = engines.findEngine();
  if (!engineCache) return null;
  // the install directory beside the binary: DataSets, WeatherData, the schema; the other installs named; where weather is looked for
  return { ...engineCache, weatherDirs: engines.weatherDirs(REPO_DIR, engineCache) };
});
// A WEATHER FILE BY NAME (2026-09-23): a path that no longer exists (a ledger written on another machine or for another
// install) resolves to the first of Weather/, the engine's WeatherData, the other installs', data/weather/* holding its name
ipcMain.handle("bem:resolve-epw", async (_ev, p) => engines.resolveEpw(p, engines.weatherDirs(REPO_DIR, engineCache ??= engines.findEngine())));
ipcMain.handle("bem:list-dir", async (_ev, dir, ext) => {
  try { return fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(String(ext).toLowerCase())).sort().map((f) => path.join(dir, f)); }
  catch { return []; }
});
// THE WEB, READ ONCE AND CACHED (2026-09-07): the weather-station listing (EnergyPlus's weather repository), the catalogue and the
// station files land under data/cache and are read
// from there until the user asks for a fresh one. The main process fetches so
// the renderer's origin never meets a CORS refusal.
const UA = "BIM-BEM-BOM/0.1 (Electron desktop; +https://github.com/Enthalix-llc/BIM-BEM-BOM)";   // the app and a contact, as OSMF and Wikimedia ask; never the user's e-mail
ipcMain.handle("bem:fetch-cached", async (_ev, url, cacheName, maxAgeDays) => {
  const dir = path.join(DATA_DIR, "cache");
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, String(cacheName).replace(/[^a-z0-9._-]/gi, "_"));
  try {
    const st = fs.statSync(p);
    if (maxAgeDays === undefined || maxAgeDays === null || (Date.now() - st.mtimeMs) / 86400000 <= maxAgeDays) {
      return { text: fs.readFileSync(p, "utf8"), cached: true, savedAt: st.mtime.toISOString(), path: p };
    }
  } catch { /* not cached yet */ }
  try {
    const res = await net.fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) return { error: `HTTP ${res.status} from ${url}` };
    const text = await res.text();
    fs.writeFileSync(p, text);
    return { text, cached: false, savedAt: new Date().toISOString(), path: p };
  } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
});
// GENERAL SEARCH IN THE BROWSER (user, 2026-09-08: "a web browser is opened with search tab prefilled"): the
// user's own browser, http(s) only — nothing else is opened from here
ipcMain.handle("bem:open-external", async (_ev, url) => {
  const u = String(url);
  if (!/^https?:\/\//i.test(u)) return { error: "only an http(s) URL is opened" };
  try { await shell.openExternal(u); return { ok: true }; } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
});
// LOOK-UPS IN THE USER'S OWN BROWSER: a material search (BCL's site, the web) opens in the user's own browser, under the user's own
// access to each site — the numbers come back by hand, with the page's URL. http(s) only.
ipcMain.handle("bem:open-browser", async (_ev, url) => {
  const u = String(url);
  if (!/^https?:\/\//i.test(u)) return { error: "only an http(s) URL is opened" };
  try { await shell.openExternal(u); return { ok: true }; } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
});
// AN ADDRESS → A POSITION: OpenStreetMap's Nominatim, no key; the answers are candidates the user picks from, never applied
// unasked. The OSMF Nominatim usage policy (read 2026-10-14) asks three things of an app, all kept here: at most one request a
// second (requests wait their turn), results cached on this side (data/cache/geocode/, 30 days), and the service switchable
// without a software update — data/settings.json { "geocoderUrl": "https://…/search" } names any Nominatim-compatible server.
const GEOCODER_DEFAULT = "https://nominatim.openstreetmap.org/search";
function geocoderUrl() {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "settings.json"), "utf8"));
    if (s && typeof s.geocoderUrl === "string" && /^https:\/\//i.test(s.geocoderUrl)) return s.geocoderUrl;
  } catch { /* no settings file: the default */ }
  return GEOCODER_DEFAULT;
}
let geocodeTurn = Promise.resolve(), geocodeLast = 0;
ipcMain.handle("bem:geocode", async (_ev, query) => {
  const q = String(query).trim(), base = geocoderUrl();
  const key = crypto.createHash("sha1").update(`${base}\n${q.toLowerCase()}`).digest("hex").slice(0, 20);
  const cacheFile = path.join(DATA_DIR, "cache", "geocode", `${key}.json`);
  try { const st = fs.statSync(cacheFile); if ((Date.now() - st.mtimeMs) / 86400000 <= 30) return { results: JSON.parse(fs.readFileSync(cacheFile, "utf8")) }; } catch { /* not cached yet */ }
  const mine = geocodeTurn.then(async () => { const wait = geocodeLast + 1100 - Date.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait)); });
  geocodeTurn = mine.catch(() => {});
  await mine;
  geocodeLast = Date.now();
  try {
    const res = await net.fetch(`${base}?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`, { headers: { "User-Agent": UA, "Accept-Language": "en" } });
    if (!res.ok) return { error: `HTTP ${res.status} from the geocoder (${new URL(base).host})` };
    const rows = await res.json();
    const results = (Array.isArray(rows) ? rows : []).map((r) => ({ name: String(r.display_name ?? ""), latitude: Number(r.lat), longitude: Number(r.lon), kind: String(r.type ?? "") })).filter((r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude));
    try { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(results)); } catch { /* an unwritable cache only costs a repeat request */ }
    return { results };
  } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
});
// A WEATHER FILE FROM THE WEB: the zip (epw + ddy + stat inside) is unpacked
// into Weather/; the epw's path comes back to be chosen like any installed file
ipcMain.handle("bem:download-weather", async (_ev, url) => {
  const stem = path.basename(String(url)).replace(/\.zip$/i, "").replace(/[^a-z0-9._-]/gi, "_");
  // THE DOWNLOAD LANDS IN Weather/ (2026-09-23): the epw, ddy and stat beside the project's other weather files; the zip in data/cache
  const epwOf = () => { try { const f = fs.readdirSync(WEATHER_DIR).find((x) => x.toLowerCase() === `${stem.toLowerCase()}.epw`); return f ? path.join(WEATHER_DIR, f) : null; } catch { return null; } };
  const have = epwOf();
  if (have) return { epw: have, dir: WEATHER_DIR, cached: true };
  try {
    fs.mkdirSync(WEATHER_DIR, { recursive: true });
    const cache = path.join(DATA_DIR, "cache");
    fs.mkdirSync(cache, { recursive: true });
    const res = await net.fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) return { error: `HTTP ${res.status} from ${url}` };
    const zip = path.join(cache, `${stem}.zip`);
    fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
    // unpacked here, not by a system tool (2026-10-20: Windows has no unzip): the epw, ddy and stat only, by their plain file names
    try {
      const out = unzipSync(new Uint8Array(fs.readFileSync(zip)), { filter: (f) => /\.(epw|ddy|stat)$/i.test(f.name) });
      for (const [name, bytes] of Object.entries(out)) {
        const base = name.split(/[\\/]/).pop();
        if (base && /^[^<>:"|?*]+$/.test(base)) fs.writeFileSync(path.join(WEATHER_DIR, base), bytes);
      }
    } catch (e) { return { error: `could not unpack ${path.basename(zip)}: ${e instanceof Error ? e.message : String(e)}` }; }
    const epw = epwOf();
    return epw ? { epw, dir: WEATHER_DIR, cached: false } : { error: "no .epw inside the zip" };
  } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
});
// AN ACTUAL-WEATHER FILE MADE IN THE APP (2026-10-07: "How can we fill out the weather with real data?"): the renderer converts NOAA's
// station hours and Open-Meteo's sun and sky (fetched through bem:fetch-cached) and hands the EPW here; it lands in Weather/ beside the
// typical-year file whose .ddy it copies. A plain file name only — nothing is written outside Weather/
ipcMain.handle("bem:save-weather", async (_ev, stem, epwText, ddyFrom) => {
  const s = String(stem);
  if (!/^[A-Za-z0-9._-]+$/.test(s)) return { error: "the weather file's name holds characters a file name cannot" };
  try {
    fs.mkdirSync(WEATHER_DIR, { recursive: true });
    const epw = path.join(WEATHER_DIR, `${s}.epw`);
    fs.writeFileSync(epw, String(epwText));
    let ddy = false;
    const src = ddyFrom ? path.resolve(String(ddyFrom)) : null;
    if (src && path.dirname(src) === WEATHER_DIR && /\.ddy$/i.test(src) && fs.existsSync(src)) { fs.copyFileSync(src, path.join(WEATHER_DIR, `${s}.ddy`)); ddy = true; }
    return { epw, ddy };
  } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
});
const runDir = (stamp) => within(path.join("bem", "runs", stamp));
ipcMain.handle("bem:run", async (ev, opts) => {
  const exe = opts.exe || findEnergyPlus();
  if (!exe) return { exitCode: null, seconds: 0, dir: null, error: "no energyplus found" };
  fs.mkdirSync(runDir(opts.stamp), { recursive: true });
  // the folder by its REAL path (2026-10-20): reached through a link (macOS /var → /private/var, a Windows junction) EnergyPlus takes its
  // input folder and its output folder for two places, links in.idf into the second and stops on "create_symlink: File exists"
  const dir = fs.realpathSync(runDir(opts.stamp));
  const idfPath = path.join(dir, "in.idf");
  fs.writeFileSync(idfPath, opts.idf);
  const args = [...(opts.expand ? ["-x"] : []), ...(opts.epw ? ["-w", opts.epw] : ["-D"]), "-d", dir, idfPath];
  const t0 = Date.now();
  return await new Promise((resolve) => {
    const sa = engines.spawnArgs(exe, args);   // a pinned .bat or .cmd runs through the shell on Windows
    const child = spawn(sa.exe, sa.args, { cwd: dir, shell: sa.shell });
    const send = (text) => { try { ev.sender.send("bem:progress", { stamp: opts.stamp, text }); } catch { /* window gone */ } };
    let buf = "";
    const onData = (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/); buf = lines.pop() ?? "";
      for (const l of lines) if (l.trim()) send(l);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    const killer = setTimeout(() => { child.kill("SIGKILL"); send("killed after 15 minutes"); }, 15 * 60 * 1000);
    child.on("close", (code) => {
      clearTimeout(killer);
      if (buf.trim()) send(buf);
      resolve({ exitCode: code, seconds: (Date.now() - t0) / 1000, dir, error: null });
    });
    child.on("error", (err) => { clearTimeout(killer); resolve({ exitCode: null, seconds: (Date.now() - t0) / 1000, dir, error: String(err) }); });
  });
});
ipcMain.handle("bem:read-run-file", async (_ev, stamp, name) => {
  try { return fs.readFileSync(path.join(runDir(stamp), path.basename(name))); } catch { return null; }
});
/** THE ENGINE'S REPORT ON PAPER (user, 2026-10-08: "the energyplus report needs to be printable and savable in pdf"): the run's own
 *  eplustbl.htm loaded in a hidden window with no scripts, then printed through the system's dialog or written as a PDF where the user picks */
ipcMain.handle("bem:report-out", async (_ev, stamp, mode, title) => {
  const file = path.join(runDir(stamp), "eplustbl.htm");
  if (!fs.existsSync(file)) return { error: `run ${stamp} has no eplustbl.htm` };
  const w = new BrowserWindow({ show: false, width: 1100, height: 1400, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false } });
  try {
    await w.loadFile(file);
    const name = String(title || `EnergyPlus report ${stamp}`).replace(/[\\/:*?"<>|]/g, "-");
    if (mode === "pdf") {
      const r = await dialog.showSaveDialog({ title: "Save the EnergyPlus report as PDF", defaultPath: path.join(app.getPath("documents"), `${name}.pdf`), filters: [{ name: "PDF", extensions: ["pdf"] }] });
      if (r.canceled || !r.filePath) return { canceled: true };
      const pdf = await w.webContents.printToPDF({ printBackground: true, pageSize: "Letter", margins: { marginType: "default" } });
      fs.writeFileSync(r.filePath, pdf);
      return { saved: r.filePath };
    }
    const ok = await new Promise((resolve) => w.webContents.print({ printBackground: true }, (success, why) => resolve(success ? { printed: true } : { canceled: true, why })));
    return ok;
  } catch (e) { return { error: String(e) }; } finally { w.destroy(); }
});
/** `--convert-only`: the IDD parse without a run — the validator */
ipcMain.handle("bem:validate", async (_ev, idf) => {
  const exe = findEnergyPlus();
  if (!exe) return { ok: false, err: "no energyplus found" };
  fs.mkdirSync(within(path.join("bem", "validate")), { recursive: true });
  const dir = fs.realpathSync(within(path.join("bem", "validate")));   // its real path, as for a run
  const idfPath = path.join(dir, "in.idf");
  fs.writeFileSync(idfPath, idf);
  const sa = engines.spawnArgs(exe, ["--convert-only", "-d", dir, idfPath]);
  const res = spawnSync(sa.exe, sa.args, { encoding: "utf8", timeout: 120000, shell: sa.shell });
  let err = "";
  try { err = fs.readFileSync(path.join(dir, "eplusout.err"), "utf8"); } catch { err = `${res.stdout}\n${res.stderr}`; }
  return { ok: res.status === 0, err };
});

// ── THE BOM MODULE: a bill is a file the user picks; the raw import is
//    copied under data/bom/imports/ so bom.db can be rebuilt from it, and
//    the module's ledger lives beside it keyed to the IFC's sha
ipcMain.handle("bom:pick-csv", async () => {
  const res = await dialog.showOpenDialog({ title: "Import a utility bill CSV", filters: [{ name: "CSV", extensions: ["csv", "txt"] }], properties: ["openFile"] });
  if (res.canceled || res.filePaths.length === 0) return null;
  const p = res.filePaths[0];
  return { name: path.basename(p), path: p, text: fs.readFileSync(p, "utf8") };
});
ipcMain.handle("bom:save-import", async (_ev, sha12, ext, text) => {
  const dir = path.join(DATA_DIR, "bom", "imports");
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `${sha12}.${ext.replace(/[^a-z0-9]/gi, "")}`);
  return saveUser("bills imported", () => { fs.writeFileSync(p, text); return p; });
});
ipcMain.handle("bom:read-import", async (_ev, sha12, ext) => {
  try { return fs.readFileSync(path.join(DATA_DIR, "bom", "imports", `${sha12}.${ext}`), "utf8"); } catch { return null; }
});
ipcMain.handle("bom:load-ledger", async (_ev, sha) => projects.loadLedger("bom", sha));
ipcMain.handle("bom:save-ledger", async (_ev, sha, json) => saveUser("BOM ledger", () => { projects.saveLedger("bom", sha, json); return STORE_FILE; }));

// THE PROJECTS AND THEIR VERSIONS (2026-09-30): the lookup on open, the lineage, export and import
ipcMain.handle("project:info", async () => ({ file: STORE_FILE, projects: projects.projects(), unassigned: projects.unassigned() }));
ipcMain.handle("project:version", async (_ev, sha) => projects.version(sha));
ipcMain.handle("project:versions", async (_ev, projectId) => projects.versions(projectId));
ipcMain.handle("project:version-index", async (_ev, sha) => projects.versionIndex(sha));
ipcMain.handle("project:unassigned", async () => projects.unassigned());
ipcMain.handle("project:register-version", async (_ev, v) => saveUser("project version", () => projects.registerVersion(v)));
ipcMain.handle("project:export", async (_ev, projectId, suggested) => {
  const r = await dialog.showSaveDialog({ title: "Export the project", defaultPath: suggested || `${projectId}.bimproject`, filters: [{ name: "BIM-BEM-BOM project", extensions: ["bimproject"] }] });
  if (r.canceled || !r.filePath) return null;
  return { file: r.filePath, ...projects.exportProject(projectId, r.filePath) };
});
ipcMain.handle("project:import", async () => {
  const r = await dialog.showOpenDialog({ title: "Import a project", filters: [{ name: "BIM-BEM-BOM project", extensions: ["bimproject"] }], properties: ["openFile"] });
  if (r.canceled || !r.filePaths.length) return null;
  return saveUser("project imported", () => ({ file: r.filePaths[0], ...projects.importProject(r.filePaths[0]) }));
});

explainWindow.register(app, () => mainWin);
app.whenReady().then(async () => {
  try { await openProjects(); }
  catch (e) {
    // no store, no ledgers: say so plainly and load nothing rather than run with rulings that cannot be saved
    dialog.showErrorBox("BIM-BEM-BOM — the project store could not be opened", `${STORE_FILE}\n\n${e instanceof Error ? e.message : String(e)}`);
    app.quit(); return;
  }
  // THE MAP TILES name the app (OSMF tile usage policy: "a clear, unique User-Agent string that names your app"): the tile images are
  // requested by the page, so their User-Agent is set here
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ["https://tile.openstreetmap.org/*"] }, (d, cb) => cb({ requestHeaders: { ...d.requestHeaders, "User-Agent": UA } }));
  void createWindow();
});
app.on("window-all-closed", () => app.quit());
