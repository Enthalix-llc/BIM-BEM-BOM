// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE PROJECT STORE (2026-09-30). The user: "assure that specific project ledgers are tracked (and saved) against a supplied
// ifc file … a label (an internal unique tracking id) carried for stored matching retrieval, that can support branching for
// incremental ifc edits" — and, on the storage: "git should not be required … a local db so long as it is universal (not
// hardware or operating system based) and installs in an assured location". Their rulings: the PROJECT is the IfcProject
// GlobalId (read from the file, never written); a VERSION is the file's sha256; the LINEAGE — which version a version came
// from, and how — is recorded here, so two versions made from one parent are two branches; the store is ONE SQLite file,
// projects.sqlite, in the OS's per-user app-data folder (main.cjs sets it; the gate passes a scratch path).
//
// SQLite through sql.js (pure WebAssembly, the app's own: no native module, the file format the same on every platform).
// The database lives in memory and is written ATOMICALLY on every change (a temp file renamed over it — a crash mid-write
// never leaves a truncated store). The three ledgers — the corrections, the BEM rulings, the BOM ledger — keep the JSON the
// app, the gates and the carry already read; each save keeps the previous JSON in `ledger_history`, the last 30 per ledger
// (the rule ledgerStore.cjs kept on disk since 2026-09-10). A CommonJS module: main.cjs requires it, the gate tests it.
const fs = require("node:fs");
const path = require("node:path");
const { renameRetry } = require("./fsRetry.cjs");   // Windows holds a file open for a moment (2026-10-20)

const SCHEMA_VERSION = 1;
const KINDS = ["corrections", "bem", "bom"];
const HISTORY_KEEP = 30;

const DDL = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
-- a project: the IfcProject GlobalId the file states, its name and long name as the file states them
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT, long_name TEXT, created_at TEXT NOT NULL);
-- a version: one exact IFC file by its sha256; parent_sha the version it was made from (null: a root); made_by how
-- (opened · carried · bimedit · delete-from-ifc · migrated); index_json the FileIndex (core/ifcChanges.ts) the lookup and the
-- carry compare, so no old ifc.db is needed; project_id null only for a migrated ledger whose file has not been opened yet
CREATE TABLE IF NOT EXISTS versions (
  sha TEXT PRIMARY KEY, project_id TEXT, parent_sha TEXT, made_by TEXT NOT NULL, note TEXT,
  file_name TEXT, file_path TEXT, created_at TEXT NOT NULL, index_json TEXT);
CREATE INDEX IF NOT EXISTS versions_project ON versions (project_id);
-- the ledgers, one row per version and kind, the JSON as the app writes it
CREATE TABLE IF NOT EXISTS ledgers (sha TEXT NOT NULL, kind TEXT NOT NULL, json TEXT NOT NULL, saved_at TEXT NOT NULL, PRIMARY KEY (sha, kind));
CREATE TABLE IF NOT EXISTS ledger_history (id INTEGER PRIMARY KEY AUTOINCREMENT, sha TEXT NOT NULL, kind TEXT NOT NULL, json TEXT NOT NULL, saved_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS history_ledger ON ledger_history (sha, kind, id);
-- THE IMPORT RULINGS (2026-11-13, the IFC import review): the user's word on one difference between a new IFC and the version
-- before it — accept (the file's value is the new reference) · ignore (never edited from here; asked again when the file's value
-- changes) · revise (the IFC is to be changed back) — keyed by the subject (an element's or a room's GlobalId, a type's name)
-- and the field, per project, so it outlives any one file. It records decisions and holds no model values
CREATE TABLE IF NOT EXISTS import_rulings (
  project_id TEXT NOT NULL, subject_kind TEXT NOT NULL, subject_key TEXT NOT NULL, field TEXT NOT NULL,
  file_value TEXT NOT NULL, choice TEXT NOT NULL, scope TEXT, request_id TEXT, version_sha TEXT NOT NULL, at TEXT NOT NULL,
  PRIMARY KEY (project_id, subject_kind, subject_key, field));
`;

const nowIso = () => new Date().toISOString();
const checkKind = (kind) => { if (!KINDS.includes(kind)) throw new Error(`projectStore: no ledger kind "${kind}" (${KINDS.join(", ")})`); };
const checkSha = (sha) => { if (!/^[0-9a-f]{64}$/.test(String(sha))) throw new Error(`projectStore: "${sha}" is not a sha256`); };
/** a history entry travels to the renderer as a `path` (the shape ledgerStore.cjs gave it): db:<id> */
const HISTORY_REF = /^db:(\d+)$/;

/** open (or create) the store at `file`; `SQL` is an initialised sql.js module */
function openStore(file, SQL) {
  let db;
  const existed = fs.existsSync(file);
  db = existed ? new SQL.Database(fs.readFileSync(file)) : new SQL.Database();
  db.exec(DDL);
  const one = (sql, params) => { const s = db.prepare(sql); try { s.bind(params || []); return s.step() ? s.getAsObject() : null; } finally { s.free(); } };
  const all = (sql, params) => { const s = db.prepare(sql); const out = []; try { s.bind(params || []); while (s.step()) out.push(s.getAsObject()); } finally { s.free(); } return out; };
  const run = (sql, params) => { db.run(sql, params || []); };
  const schema = one("SELECT value FROM meta WHERE key = 'schema_version'");
  if (schema && Number(schema.value) > SCHEMA_VERSION) throw new Error(`projectStore: ${file} is schema ${schema.value}, newer than this program's ${SCHEMA_VERSION}`);
  run("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)", [String(SCHEMA_VERSION)]);

  /** the whole database to disk, atomically */
  function flush() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, Buffer.from(db.export()));
    renameRetry(tmp, file);
  }
  if (!existed) flush();

  function loadLedger(kind, sha) {
    checkKind(kind);
    const r = one("SELECT json FROM ledgers WHERE sha = ? AND kind = ?", [String(sha), kind]);
    return r ? JSON.parse(r.json) : null;
  }
  /** write a ledger; the previous JSON into its history (the last 30 kept); a version row made if the sha has none */
  function saveLedger(kind, sha, json) {
    checkKind(kind); checkSha(sha);
    const text = JSON.stringify(json, null, 2);
    const prev = one("SELECT json, saved_at FROM ledgers WHERE sha = ? AND kind = ?", [sha, kind]);
    if (prev && prev.json === text) return { sha, kind, unchanged: true };
    const at = nowIso();
    if (prev) {
      run("INSERT INTO ledger_history (sha, kind, json, saved_at) VALUES (?, ?, ?, ?)", [sha, kind, prev.json, prev.saved_at]);
      run(`DELETE FROM ledger_history WHERE sha = ? AND kind = ? AND id NOT IN
           (SELECT id FROM ledger_history WHERE sha = ? AND kind = ? ORDER BY id DESC LIMIT ${HISTORY_KEEP})`, [sha, kind, sha, kind]);
    }
    run("INSERT OR REPLACE INTO ledgers (sha, kind, json, saved_at) VALUES (?, ?, ?, ?)", [sha, kind, text, at]);
    if (!one("SELECT sha FROM versions WHERE sha = ?", [sha])) {
      const src = json && typeof json === "object" ? json : {};
      run("INSERT INTO versions (sha, made_by, file_name, created_at) VALUES (?, 'opened', ?, ?)", [sha, src.sourceName ?? null, at]);
    }
    flush();
    return { sha, kind, savedAt: at };
  }
  /** a ledger's previous versions, newest first — { stamp, at, path: "db:<id>", bytes } as ledgerStore.cjs listed files */
  function listHistory(kind, sha) {
    checkKind(kind);
    return all("SELECT id, saved_at, length(json) AS bytes FROM ledger_history WHERE sha = ? AND kind = ? ORDER BY id DESC", [String(sha), kind])
      .map((r) => ({ stamp: String(r.id), at: r.saved_at, path: `db:${r.id}`, bytes: r.bytes }));
  }
  function readHistory(kind, sha, ref) {
    const m = HISTORY_REF.exec(String(ref));
    if (!m) return null;
    const r = one("SELECT json FROM ledger_history WHERE id = ? AND sha = ? AND kind = ?", [Number(m[1]), String(sha), kind]);
    return r ? JSON.parse(r.json) : null;
  }

  /** a project as the file states it; created on first sight, its name and long name kept current */
  function ensureProject(id, name, longName) {
    if (!id) throw new Error("projectStore: a project needs the IfcProject GlobalId");
    const r = one("SELECT id FROM projects WHERE id = ?", [id]);
    if (r) run("UPDATE projects SET name = COALESCE(?, name), long_name = COALESCE(?, long_name) WHERE id = ?", [name ?? null, longName ?? null, id]);
    else run("INSERT INTO projects (id, name, long_name, created_at) VALUES (?, ?, ?, ?)", [id, name ?? null, longName ?? null, nowIso()]);
  }
  /** record a version: creates it, or fills what an earlier, thinner record left empty (a migrated ledger learns its
   *  project; a version first seen without a parent learns it). A parent already recorded is never replaced silently —
   *  `reparent: true` says the user chose another. A version cannot be its own ancestor. */
  function registerVersion(v) {
    checkSha(v.sha);
    if (v.projectId) ensureProject(v.projectId, v.projectName, v.projectLongName);
    if (v.parentSha) {
      checkSha(v.parentSha);
      if (v.parentSha === v.sha) throw new Error("projectStore: a version cannot be its own parent");
      for (let a = v.parentSha, n = 0; a && n < 10000; n++) { if (a === v.sha) throw new Error("projectStore: that parent descends from this version — a cycle"); a = one("SELECT parent_sha FROM versions WHERE sha = ?", [a])?.parent_sha ?? null; }
    }
    const idx = v.index === undefined ? undefined : v.index === null ? null : JSON.stringify(v.index);
    const cur = one("SELECT * FROM versions WHERE sha = ?", [v.sha]);
    if (!cur) {
      run(`INSERT INTO versions (sha, project_id, parent_sha, made_by, note, file_name, file_path, created_at, index_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [v.sha, v.projectId ?? null, v.parentSha ?? null, v.madeBy ?? "opened", v.note ?? null, v.fileName ?? null, v.filePath ?? null, nowIso(), idx ?? null]);
    } else {
      if (v.projectId && cur.project_id && cur.project_id !== v.projectId) throw new Error(`projectStore: version ${v.sha.slice(0, 12)} is of project ${cur.project_id}, not ${v.projectId}`);
      const parent = v.parentSha && (!cur.parent_sha || v.reparent) ? v.parentSha : cur.parent_sha;
      // how it was made: a thin record ("opened" by a first save, "migrated") takes the word given; a real one stays,
      // unless the parent was just set or chosen anew, which is when the word describes the new link
      const madeBy = v.madeBy && (["opened", "migrated"].includes(cur.made_by) || (v.parentSha && parent === v.parentSha && parent !== cur.parent_sha)) ? v.madeBy : cur.made_by;
      run(`UPDATE versions SET project_id = COALESCE(project_id, ?), parent_sha = ?, made_by = ?, note = COALESCE(?, note),
           file_name = COALESCE(?, file_name), file_path = COALESCE(?, file_path), index_json = COALESCE(?, index_json) WHERE sha = ?`,
        [v.projectId ?? null, parent, madeBy, v.note ?? null, v.fileName ?? null, v.filePath ?? null, idx ?? null, v.sha]);
    }
    flush();
    return version(v.sha);
  }
  const shape = (r) => r && ({ sha: r.sha, projectId: r.project_id, parentSha: r.parent_sha, madeBy: r.made_by, note: r.note, fileName: r.file_name, filePath: r.file_path, createdAt: r.created_at, hasIndex: r.index_json != null,
    ledgers: all("SELECT kind FROM ledgers WHERE sha = ?", [r.sha]).map((x) => x.kind) });
  function version(sha) { return shape(one("SELECT * FROM versions WHERE sha = ?", [String(sha)])); }
  function versionIndex(sha) { const r = one("SELECT index_json FROM versions WHERE sha = ?", [String(sha)]); return r && r.index_json ? JSON.parse(r.index_json) : null; }
  /** a project's versions, oldest first — the lineage is each one's parentSha */
  function versions(projectId) { return all("SELECT * FROM versions WHERE project_id = ? ORDER BY created_at, sha", [projectId]).map(shape); }
  function project(id) { const r = one("SELECT * FROM projects WHERE id = ?", [id]); return r && { id: r.id, name: r.name, longName: r.long_name, createdAt: r.created_at }; }
  function projects() { return all("SELECT * FROM projects ORDER BY created_at").map((r) => ({ id: r.id, name: r.name, longName: r.long_name, createdAt: r.created_at })); }
  /** versions whose file was never opened since they were migrated: their project is not known yet */
  function unassigned() { return all("SELECT * FROM versions WHERE project_id IS NULL ORDER BY created_at").map(shape); }

  /** THE MIGRATION: every ledger file under data/ (and its history/) into the store, once. The files are READ, never
   *  moved or deleted — they stay where they were, the user's. A carry record in a ledger names the version it came from. */
  function migrateFromFiles(dataDir) {
    const done = one("SELECT value FROM meta WHERE key = 'migrated_from_files'");
    if (done) return { already: done.value, imported: [], history: 0 };
    const dirs = { corrections: path.join(dataDir, "corrections"), bem: path.join(dataDir, "bem", "decisions"), bom: path.join(dataDir, "bom") };
    const imported = []; let history = 0; const problems = [];
    const iso = (stamp) => stamp.replace(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z(?:-\d+)?$/, "$1T$2:$3:$4.$5Z");
    for (const kind of KINDS) {
      let names = [];
      try { names = fs.readdirSync(dirs[kind]).filter((n) => /^[0-9a-f]{64}\.json$/.test(n)); } catch { /* none */ }
      for (const n of names) {
        const sha = n.slice(0, 64), file = path.join(dirs[kind], n);
        let text;
        try { text = JSON.stringify(JSON.parse(fs.readFileSync(file, "utf8")), null, 2); } catch (e) { problems.push(`${kind}/${n}: ${e.message}`); continue; }
        // the history first, oldest first, so the ids run in time order
        let hist = [];
        try { hist = fs.readdirSync(path.join(dirs[kind], "history")).filter((h) => h.startsWith(`${sha}.`) && h.endsWith(".json")).sort(); } catch { /* none */ }
        for (const h of hist.slice(-HISTORY_KEEP)) {
          try { const t = JSON.stringify(JSON.parse(fs.readFileSync(path.join(dirs[kind], "history", h), "utf8")), null, 2); run("INSERT INTO ledger_history (sha, kind, json, saved_at) VALUES (?, ?, ?, ?)", [sha, kind, t, iso(h.slice(65, -5))]); history++; }
          catch (e) { problems.push(`${kind}/history/${h}: ${e.message}`); }
        }
        const obj = JSON.parse(text);
        run("INSERT OR REPLACE INTO ledgers (sha, kind, json, saved_at) VALUES (?, ?, ?, ?)", [sha, kind, text, obj.savedAt || fs.statSync(file).mtime.toISOString()]);
        const from = obj.carried?.fromSha || obj.carriedFrom?.fromSha || null;
        const cur = one("SELECT parent_sha FROM versions WHERE sha = ?", [sha]);
        if (!cur) run("INSERT INTO versions (sha, parent_sha, made_by, note, file_name, created_at) VALUES (?, ?, 'migrated', ?, ?, ?)",
          [sha, from && from !== sha ? from : null, `from data/ on ${nowIso().slice(0, 10)}`, obj.sourceName ?? null, obj.savedAt || nowIso()]);
        else if (!cur.parent_sha && from && from !== sha) run("UPDATE versions SET parent_sha = ? WHERE sha = ?", [from, sha]);
        imported.push(`${kind}/${sha.slice(0, 12)}`);
      }
    }
    run("INSERT OR REPLACE INTO meta (key, value) VALUES ('migrated_from_files', ?)", [`${nowIso()} · ${dataDir}`]);
    flush();
    return { imported, history, problems };
  }

  /** EXPORT a project as one file (a SQLite database of the same schema holding that project alone) — to move machines or
   *  keep a copy; IMPORT merges one back: versions and ledgers it lacks are added, a ledger it has is kept unless the file's
   *  is newer (by its saved time), the replaced one into its history */
  function exportProject(projectId, outFile) {
    const out = new SQL.Database();
    out.exec(DDL);
    out.run("INSERT INTO meta (key, value) VALUES ('schema_version', ?), ('exported', ?)", [String(SCHEMA_VERSION), `${nowIso()} · project ${projectId}`]);
    const p = one("SELECT * FROM projects WHERE id = ?", [projectId]);
    if (!p) throw new Error(`projectStore: no project ${projectId}`);
    out.run("INSERT INTO projects VALUES (?, ?, ?, ?)", [p.id, p.name, p.long_name, p.created_at]);
    const shas = all("SELECT * FROM versions WHERE project_id = ?", [projectId]);
    for (const v of shas) {
      out.run("INSERT INTO versions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [v.sha, v.project_id, v.parent_sha, v.made_by, v.note, v.file_name, v.file_path, v.created_at, v.index_json]);
      for (const l of all("SELECT * FROM ledgers WHERE sha = ?", [v.sha])) out.run("INSERT INTO ledgers VALUES (?, ?, ?, ?)", [l.sha, l.kind, l.json, l.saved_at]);
      for (const h of all("SELECT * FROM ledger_history WHERE sha = ? ORDER BY id", [v.sha])) out.run("INSERT INTO ledger_history (sha, kind, json, saved_at) VALUES (?, ?, ?, ?)", [h.sha, h.kind, h.json, h.saved_at]);
    }
    for (const r of all("SELECT * FROM import_rulings WHERE project_id = ?", [projectId])) out.run("INSERT INTO import_rulings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [r.project_id, r.subject_kind, r.subject_key, r.field, r.file_value, r.choice, r.scope, r.request_id, r.version_sha, r.at]);
    const tmp = `${outFile}.tmp`;
    fs.writeFileSync(tmp, Buffer.from(out.export()));
    renameRetry(tmp, outFile);
    out.close();
    return { project: projectId, versions: shas.length };
  }
  function importProject(inFile) {
    const src = new SQL.Database(fs.readFileSync(inFile));
    const q = (sql, params) => { const s = src.prepare(sql); const o = []; s.bind(params || []); while (s.step()) o.push(s.getAsObject()); s.free(); return o; };
    const counts = { projects: 0, versions: 0, ledgers: 0, kept: 0, history: 0, importRulings: 0 };
    try {
      for (const p of q("SELECT * FROM projects")) { if (!one("SELECT id FROM projects WHERE id = ?", [p.id])) { run("INSERT INTO projects VALUES (?, ?, ?, ?)", [p.id, p.name, p.long_name, p.created_at]); counts.projects++; } }
      for (const v of q("SELECT * FROM versions")) {
        if (!one("SELECT sha FROM versions WHERE sha = ?", [v.sha])) { run("INSERT INTO versions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [v.sha, v.project_id, v.parent_sha, v.made_by, v.note, v.file_name, v.file_path, v.created_at, v.index_json]); counts.versions++; }
      }
      for (const l of q("SELECT * FROM ledgers")) {
        const cur = one("SELECT json, saved_at FROM ledgers WHERE sha = ? AND kind = ?", [l.sha, l.kind]);
        if (!cur) { run("INSERT INTO ledgers VALUES (?, ?, ?, ?)", [l.sha, l.kind, l.json, l.saved_at]); counts.ledgers++; }
        else if (cur.json !== l.json && l.saved_at > cur.saved_at) {
          run("INSERT INTO ledger_history (sha, kind, json, saved_at) VALUES (?, ?, ?, ?)", [l.sha, l.kind, cur.json, cur.saved_at]);
          run("UPDATE ledgers SET json = ?, saved_at = ? WHERE sha = ? AND kind = ?", [l.json, l.saved_at, l.sha, l.kind]); counts.ledgers++;
        } else counts.kept++;
      }
      for (const h of q("SELECT * FROM ledger_history ORDER BY id")) {
        if (!one("SELECT id FROM ledger_history WHERE sha = ? AND kind = ? AND saved_at = ? AND json = ?", [h.sha, h.kind, h.saved_at, h.json])) { run("INSERT INTO ledger_history (sha, kind, json, saved_at) VALUES (?, ?, ?, ?)", [h.sha, h.kind, h.json, h.saved_at]); counts.history++; }
      }
      // an import ruling the store lacks is added; one it has is kept unless the file's is newer
      const hasIr = q("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'import_rulings'").length > 0;
      for (const r of hasIr ? q("SELECT * FROM import_rulings") : []) {
        const cur = one("SELECT at FROM import_rulings WHERE project_id = ? AND subject_kind = ? AND subject_key = ? AND field = ?", [r.project_id, r.subject_kind, r.subject_key, r.field]);
        if (!cur || r.at > cur.at) { run("INSERT OR REPLACE INTO import_rulings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [r.project_id, r.subject_kind, r.subject_key, r.field, r.file_value, r.choice, r.scope, r.request_id, r.version_sha, r.at]); counts.importRulings++; }
      }
    } finally { src.close(); }
    flush();
    return counts;
  }
  /** the import rulings of a project, and their upsert (one row per subject and field: the latest word wins) */
  const IMPORT_CHOICES = ["accept", "ignore", "revise"];
  function importRulings(projectId) {
    return all("SELECT * FROM import_rulings WHERE project_id = ? ORDER BY subject_kind, subject_key, field", [String(projectId)])
      .map((r) => ({ subjectKind: r.subject_kind, subjectKey: r.subject_key, field: r.field, fileValue: r.file_value, choice: r.choice, scope: r.scope, requestId: r.request_id, versionSha: r.version_sha, at: r.at }));
  }
  function saveImportRulings(projectId, rows) {
    if (!projectId) throw new Error("projectStore: an import ruling needs a project");
    for (const r of rows) {
      if (!IMPORT_CHOICES.includes(r.choice)) throw new Error(`projectStore: no import choice "${r.choice}" (${IMPORT_CHOICES.join(", ")})`);
      if (!["element", "type", "space"].includes(r.subjectKind) || !r.subjectKey || !r.field) throw new Error("projectStore: an import ruling names its subject and field");
      run(`INSERT OR REPLACE INTO import_rulings (project_id, subject_kind, subject_key, field, file_value, choice, scope, request_id, version_sha, at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [String(projectId), r.subjectKind, String(r.subjectKey), String(r.field), String(r.fileValue ?? ""), r.choice, r.scope ?? null, r.requestId ?? null, String(r.versionSha ?? ""), r.at || nowIso()]);
    }
    flush();
    return importRulings(projectId).length;
  }
  /** THE PROJECT'S OWN RECORD (2026-11-12, a project is a folder): its name, the template it started from, its data-sources record
   *  (JSON) and the IFC it last had open — kept in meta, beside the schema version */
  function getMeta(key) { const r = one("SELECT value FROM meta WHERE key = ?", [String(key)]); return r ? String(r.value) : null; }
  function setMeta(key, value) { if (value === null || value === undefined) run("DELETE FROM meta WHERE key = ?", [String(key)]); else run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", [String(key), String(value)]); flush(); }
  /** every ledger as a file: projects/<project or unassigned>/<sha>/<kind>.json */
  function ledgerFiles() {
    return all("SELECT l.sha, l.kind, l.json, v.project_id FROM ledgers l LEFT JOIN versions v ON v.sha = l.sha ORDER BY l.sha, l.kind")
      .map((r) => ({ rel: path.join("projects", r.project_id || "unassigned", r.sha, `${r.kind}.json`), bytes: Buffer.from(r.json) }));
  }

  return { file, flush, loadLedger, saveLedger, listHistory, readHistory, ensureProject, registerVersion, version, versionIndex, versions, project, projects, unassigned, migrateFromFiles, exportProject, importProject, ledgerFiles, getMeta, setMeta, importRulings, saveImportRulings, close: () => db.close() };
}

module.exports = { openStore, SCHEMA_VERSION, KINDS, HISTORY_KEEP };
