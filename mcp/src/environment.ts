// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE APP'S BUILD ENVIRONMENT, FOR ONE PROJECT, IN MEMORY (release 2, preview_ruling). What the app reads at start before it builds
// a model, read here the same way, from the same places, through the same core functions: the project's energy-code tables (and
// the program's shipped DOE/PNNL values when the project's sources say so), the engine's datasets, schedules and curves beside the
// engine in force, the project's own schedules (library/), materials.db's rows, the engine's schema and version. Read only.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readSources, DEFAULT_CODE_TABLES, type ProjectSources } from "../../program/src/core/projectSources.js";
import { parseEnergyCodes, mergeEnergyCodes, setEnergyCodeData, ENERGY_CODE_FILES } from "../../program/src/modules/bem/core/energyCodes.js";
import { LIB_FILES, CURVE_FILES, parseLibrary, parseCurveFile, type Library } from "../../program/src/modules/bem/core/idfLib.js";
import { SCHEDULE_FILES, parseScheduleObjects } from "../../program/src/modules/bem/core/schedules.js";
import { USER_SCHEDULE_FILE, readUserFile, withUserSchedules } from "../../program/src/modules/bem/core/scheduleEdit.js";
import { withMaterials, queryMaterials } from "../../program/src/modules/bem/core/materialsDb.js";
import { parseEpSchema, SCHEMA_FILE, IDD_FILE, type EpSchema } from "../../program/src/modules/bem/core/epSchema.js";
import { DEFAULT_MODEL } from "../../program/src/modules/bem/core/bemModel.js";
import { idfVersionOf, type IdfModel } from "../../program/src/modules/bem/core/bemIdf.js";
import { Refusal, dataDb, projectDb, type ReadFrom } from "./project.js";

const PROGRAM = fileURLToPath(new URL("../../program/", import.meta.url));
const req = createRequire(import.meta.url);
/** the one way the app and the gates find the engine (electron/engineLocate.cjs) */
export const engines = req(path.join(PROGRAM, "electron", "engineLocate.cjs")) as {
  findEngine: () => { exe: string; dir: string; version: string; majorMinor: string | null; others?: Array<{ dir: string }> } | null;
  weatherDirs: (root: string, engine: unknown) => string[];
  resolveEpw: (p: string, dirs: string[]) => string | null;
  spawnArgs: (exe: string, args: string[]) => { exe: string; args: string[]; shell: boolean };
};

export interface BuildEnv {
  sources: ProjectSources;
  library: Library | null;
  schema: EpSchema | null;
  model: IdfModel;
  engine: { dir: string; version: string } | null;
  read: ReadFrom[];
  notes: string[];
}

const stamp = (file: string): ReadFrom => ({ file, contentSha256: null, modified: fs.statSync(file).mtime.toISOString() });
const text = (file: string): string | null => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);

/** the data sources the project's record names (the app's sourcesNow(): its own record, else the standard) */
export async function sourcesOfProject(dir: string): Promise<ProjectSources> {
  const p = await projectDb(dir);
  const raw = p.db.exec("SELECT value FROM meta WHERE key='sources'")[0]?.values[0]?.[0];
  let json: unknown = null;
  try { json = raw ? JSON.parse(String(raw)) : null; } catch { json = null; }
  return readSources(json).sources;
}

/** a path the sources name, read under the project folder only (the app's readHomeFile) */
function homeFile(dir: string, rel: string): string | null {
  const p = path.resolve(dir, rel);
  const r = path.relative(dir, p);
  if (r.startsWith("..") || path.isAbsolute(r)) throw new Refusal(`the project's sources name ${rel}, outside the project folder — refused`);
  return text(p);
}

/** load the environment; the energy-code data is put in force for the build that follows (the core holds it in one place, as the app does) */
export async function buildEnv(dir: string): Promise<BuildEnv> {
  const read: ReadFrom[] = [], notes: string[] = [];
  const sources = await sourcesOfProject(dir);
  const codeDir = sources.energyCodes.tables ?? DEFAULT_CODE_TABLES;
  const csv = (rel: string): string => homeFile(dir, `${codeDir}/${rel.split("/").pop()}`) ?? "";
  const own = parseEnergyCodes({ editions: csv(ENERGY_CODE_FILES.editions), values: csv(ENERGY_CODE_FILES.values), adoptions: csv(ENERGY_CODE_FILES.adoptions), overrides: csv(ENERGY_CODE_FILES.overrides) });
  const pnnl = (f: string): string => fs.readFileSync(path.join(PROGRAM, "src", "modules", "bem", "reference", f), "utf8");
  setEnergyCodeData(sources.energyCodes.shipped ? mergeEnergyCodes(own, parseEnergyCodes({ editions: pnnl("pnnl-editions.csv"), values: pnnl("pnnl-values.csv"), adoptions: "", overrides: "" })) : own);
  notes.push(`energy codes: ${codeDir}${sources.energyCodes.shipped ? " + the program's DOE/PNNL values" : ""}`);

  const eng = engines.findEngine();
  let library: Library | null = null, schema: EpSchema | null = null;
  if (eng) {
    const files = LIB_FILES.map((f) => ({ file: f, text: text(path.join(eng.dir, "DataSets", f)) ?? "" })).filter((f) => f.text);
    const sched = SCHEDULE_FILES.flatMap((f) => { const t = text(path.join(eng.dir, f.path)); return t ? parseScheduleObjects(t, f.path) : []; });
    const curves = CURVE_FILES.flatMap((f) => { const t = text(path.join(eng.dir, f.path)); return t ? parseCurveFile(t, f) : []; });
    const mineFile = path.join(dir, "library", USER_SCHEDULE_FILE);
    const mine = readUserFile(text(mineFile));
    if (fs.existsSync(mineFile)) read.push(stamp(mineFile));
    library = files.length ? withUserSchedules(parseLibrary(files, [...sched, ...curves]), mine.objects) : null;
    const s = text(path.join(eng.dir, SCHEMA_FILE));
    schema = s ? parseEpSchema(s, undefined, text(path.join(eng.dir, IDD_FILE))) : null;
    notes.push(`engine: ${eng.version} at ${eng.dir}`);
  } else notes.push("no EnergyPlus found — the library and the schema are not read; a ruling naming one of the engine's objects cannot resolve");
  const mat = await dataDb(dir, "materials");
  if (mat && library) { library = withMaterials(library, queryMaterials(mat.db)); read.push(mat.from); }
  const model: IdfModel = { ...DEFAULT_MODEL, version: idfVersionOf(eng?.version) ?? DEFAULT_MODEL.version };
  return { sources, library, schema, model, engine: eng ? { dir: eng.dir, version: eng.version } : null, read, notes };
}
