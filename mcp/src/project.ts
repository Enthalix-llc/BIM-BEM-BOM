// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// A PROJECT, READ AND NEVER WRITTEN (the user's ruling, 2026-11-17: a separate MCP package; the app stays AI-free). The package
// works on the projects folder it is started with and on nothing else: a project is a folder holding project.sqlite, and every
// file is read as bytes into sql.js, in memory — no handle is ever opened for writing, no database is ever exported back. A path
// outside the projects folder is refused, and so is a file written by a newer schema than this package knows (the numbers below
// are the program's own, checked against its source by the gate, so the two cannot drift apart unnoticed).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import crypto from "node:crypto";

/** the schema each file is written at by the program this package ships beside (core/db.ts, bemDb.ts, bomDb.ts, projectStore.cjs) */
export const KNOWN_SCHEMA = { project: 1, ifc: 3, idf: 16, bem: 8, bom: 1, materials: 7 } as const;
export type DbName = "ifc" | "idf" | "bem" | "bom" | "materials";

export class Refusal extends Error {}

let sqlP: Promise<SqlJsStatic> | null = null;
export function sql(): Promise<SqlJsStatic> {
  if (!sqlP) {
    const wasm = createRequire(import.meta.url).resolve("sql.js/dist/sql-wasm.wasm");
    sqlP = initSqlJs({ locateFile: () => wasm });
  }
  return sqlP;
}

/** what a reply says it read: the file, its content sha (the program's own stamp when it carries one) and when it was written */
export interface ReadFrom { file: string; contentSha256: string | null; modified: string }

/** one database held in memory, keyed by its path, size and mtime — read again only when the file changes */
interface Held { key: string; db: Database; from: ReadFrom }
const held = new Map<string, Held>();

export class Projects {
  readonly root: string;
  constructor(root: string) {
    this.root = fs.realpathSync(path.resolve(root));
    if (!fs.statSync(this.root).isDirectory()) throw new Refusal(`${root} is not a folder`);
  }

  /** a project by its folder name (or a path inside the projects folder); anything outside it is refused */
  folder(project: string): string {
    if (typeof project !== "string" || !project.trim()) throw new Refusal("name a project — list_projects lists them");
    const p = path.resolve(this.root, project);
    let real: string;
    try { real = fs.realpathSync(p); } catch { throw new Refusal(`no project "${project}" in ${this.root}`); }
    const rel = path.relative(this.root, real);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new Refusal(`"${project}" is outside the projects folder ${this.root} — refused`);
    if (!fs.existsSync(path.join(real, "project.sqlite"))) throw new Refusal(`"${project}" holds no project.sqlite — not a project`);
    return real;
  }

  /** every folder directly under the projects folder that holds a project.sqlite */
  list(): string[] {
    return fs.readdirSync(this.root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(this.root, d.name, "project.sqlite")))
      .map((d) => d.name).sort();
  }
}

const schemaOf = (db: Database): number | null => {
  const r = db.exec("SELECT value FROM meta WHERE key='schema_version'");
  const v = r[0]?.values[0]?.[0];
  return v === undefined || v === null ? null : Number(v);
};

/** open one file of a project read-only (bytes into memory); null when the file does not exist yet */
async function open(file: string, known: number, label: string): Promise<Held | null> {
  let st: fs.Stats;
  try { st = fs.statSync(file); } catch { return null; }
  const key = `${st.size}:${st.mtimeMs}`;
  const was = held.get(file);
  if (was && was.key === key) return was;
  if (was) { was.db.close(); held.delete(file); }
  const bytes = fs.readFileSync(file);
  const db = new (await sql()).Database(new Uint8Array(bytes));
  const schema = schemaOf(db);
  if (schema !== null && schema > known) {
    db.close();
    throw new Refusal(`${label} is schema ${schema}, newer than this package knows (${known}) — update the package beside the program`);
  }
  const c = db.exec("SELECT value FROM meta WHERE key='content_sha256'")[0]?.values[0]?.[0];
  const h: Held = { key, db, from: { file, contentSha256: c ? String(c) : crypto.createHash("sha256").update(bytes).digest("hex"), modified: st.mtime.toISOString() } };
  held.set(file, h);
  return h;
}

export async function projectDb(dir: string): Promise<{ db: Database; from: ReadFrom }> {
  const h = await open(path.join(dir, "project.sqlite"), KNOWN_SCHEMA.project, "project.sqlite");
  if (!h) throw new Refusal(`${dir} holds no project.sqlite`);
  return h;
}

/** a derived database in <project>/data; null when the app has not built it yet */
export async function dataDb(dir: string, name: DbName): Promise<{ db: Database; from: ReadFrom } | null> {
  return open(path.join(dir, "data", `${name}.db`), KNOWN_SCHEMA[name], `data/${name}.db`);
}

export async function needDb(dir: string, name: DbName): Promise<{ db: Database; from: ReadFrom }> {
  const h = await dataDb(dir, name);
  if (!h) throw new Refusal(`data/${name}.db does not exist yet — open the project in the app (${name === "bem" ? "a BEM tab builds it" : name === "bom" ? "BOM builds it" : name === "materials" ? "the app builds it at start" : "opening its IFC builds it"})`);
  return h;
}

/** rows of a query as objects */
export function rows(db: Database, q: string, params: Array<string | number> = []): Array<Record<string, unknown>> {
  const st = db.prepare(q);
  st.bind(params);
  const out: Array<Record<string, unknown>> = [];
  while (st.step()) out.push(st.getAsObject() as Record<string, unknown>);
  st.free();
  return out;
}

export const hasTable = (db: Database, t: string): boolean => (db.exec(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='${t.replace(/'/g, "")}'`)[0]?.values.length ?? 0) > 0;

/** the sha of the IFC the project has open: ifc.db's own word, else project.sqlite's open_ifc file hashed */
export async function openIfcSha(dir: string): Promise<string | null> {
  const ifc = await dataDb(dir, "ifc");
  const s = ifc?.db.exec("SELECT value FROM meta WHERE key='source_sha256'")[0]?.values[0]?.[0];
  return s ? String(s) : null;
}
