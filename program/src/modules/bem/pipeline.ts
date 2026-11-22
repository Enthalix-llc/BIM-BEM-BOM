// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE APP'S RUN IS THE GATE'S RUN. This is the renderer's orchestration of
// the same core functions the developers' test gates call, in the same order: open
// idf.db FROM ITS BYTES (never BIM's memory), read the weather, build the
// model from the ledger, write the IDF, write the MODEL into bem.db without
// a run (2026-09-04: every tab reads the model back from the file), and —
// when asked — hand the IDF to the engine through Electron (which only
// moves bytes and spawns), read the engine's own database back, and write
// the run beside the model. `pnpm gate:bem data/idf.db --compare
// data/bem/runs/<stamp>/in.idf` must print IDENTICAL.

import type { ZoneDivergence } from "./core/zoneDivergence.js";
import type { CountyZoneRead } from "../../core/climateZone.js";
import { parseIdfObjects, zoneEquipmentZones, withReportUnits, type Library } from "./core/idfLib.js";
import type { EpSchema } from "./core/epSchema.js";
import type { CheckRow } from "./core/modelChecks.js";
import type { SqlJsStatic, Database } from "sql.js";
import { readBemInput, type BemInput } from "./core/bemInput.js";
import { writeIdf, idfVersionOf, type IdfModel, type IdfWriteReport, type Source } from "./core/bemIdf.js";
import { systemQa } from "./core/systemQa.js";
import { readWeather, DEFAULT_EPW, type WeatherRead } from "./core/weather.js";
import { commitModel, buildFromStore, holdsModel, proveStore, weatherOfStore, type ModelWeather, type ModelInputs } from "./core/modelStore.js";
import { stampIdfContentSha } from "../../core/stale.js";
import { buildModel, DEFAULT_MODEL, type BuiltModel, type BemSetting } from "./core/bemModel.js";
import { readRunSql, type RunResults, type EndUseCell, type FuelPeak, type SizingDetail, type ComponentLoad } from "./core/eplusSql.js";
import { parseErr, type ErrSummary } from "./core/eplusErr.js";
import { groundMethodOf, kivaReadsWeather, fFactor, cFactor } from "./core/groundCoupling.js";
import { RECORD_FILES, runSummary } from "./core/runRecord.js";
import {
  openBemDb, writeModel, writeRun, stampBemContentSha, queryBemSurfaces, queryNotEmitted, queryResults, queryResultRows, queryDailyMeters, queryHourly, queryTariffs, provenanceCensus,
  queryEndUses, queryFuelPeaks, querySizingDetails, queryDesignSurfaceTemps, queryCoilRates, queryComponentLoads, queryZoneBalance, queryMonthlyMeters, queryMonthlyByZone, queryZoneDivergence,
  querySettings, queryBemZones, queryConstructions, querySchedules, querySystems, querySystemQa, queryChecks, queryRooms, queryRuns,
  type BemLedger, type BemRun, type BemSurfaceRow,
} from "./core/bemDb.js";

/** the model as read back from bem.db after it was written — no run needed */
export interface BemModelOutcome {
  input: BemInput;
  /** idf.db's meta after the build — a commit restamps its content sha (2026-10-07) */
  idfMeta?: Map<string, string>;
  /** the model as idf.db holds it: when committed, how many library objects, whether this build committed */
  modelStore?: { committedAt: string; libraryCount: number; committed: boolean };
  built: BuiltModel;
  weather: WeatherRead | null;
  report: IdfWriteReport;
  idf: string;
  /** read back from bem.db's own bytes — what the tabs draw */
  settings: BemSetting[];
  zones: ReturnType<typeof queryBemZones>;
  constructions: ReturnType<typeof queryConstructions>;
  /** the schedule each role runs on, read back (2026-09-09) */
  schedules: ReturnType<typeof querySchedules>;
  /** the systems the model runs on, read back (2026-09-10): the ruled ones as emitted, a default row per subsection without a ruling */
  systems: ReturnType<typeof querySystems>;
  /** the system QA read back (2026-09-12): one row per loop, air loop and zone, the eight rules' verdicts and what is missing */
  systemQa: ReturnType<typeof querySystemQa>;
  /** THE CHECKS (2026-10-06): every question asked of the build and its answer, read back from bem.db */
  checks: ReturnType<typeof queryChecks>;
  /** every room's gains as written (2026-09-13), read back — the ZONES frame's rows */
  rooms: ReturnType<typeof queryRooms>;
  surfaces: BemSurfaceRow[];
  notEmitted: Map<number, string>;
  census: Record<Source, number>;
  bemMeta: Map<string, string>;
  modelSha: string;
  /** the idf.db content this model was built from */
  sourceIdfSha: string;
  runs: BemRun[];
}

/** what a zone or a space demands: the DESIGN load at its design day (the
 *  engine's sizing summary) and its PEAK rate over the weather year (the
 *  monthly maxima) — W here, the user's units at the eye */
export interface ZoneLoads {
  designHeatingW: number; designCoolingW: number;
  designHeatingWm2: number; designCoolingWm2: number;
  /** the design air flow the zone's sensible load asks for at its design day (HVAC Sizing Summary, Calculated Design Air Flow) */
  designHeatingFlowM3s: number; designCoolingFlowM3s: number;
  heatingDay: string; coolingDay: string;
  heatingDayTime: number; coolingDayTime: number;
  peakHeatingW: number; peakHeatingTime: number;
  peakCoolingW: number; peakCoolingTime: number;
}

export interface LoadsRead {
  zones: Map<string, ZoneLoads>;
  spaces: Map<string, ZoneLoads>;
  facility: {
    /** the coincident peak under the weather year, with its stamp */
    peakHeatingW: number; peakHeatingTime: number; peakCoolingW: number; peakCoolingTime: number;
    /** Σ of the zones' design loads — non-coincident */
    sumDesignHeatingW: number; sumDesignCoolingW: number;
  };
}

export interface BemOutcome extends BemModelOutcome {
  loads: LoadsRead;
  stamp: string;
  run: BemRun;
  err: ErrSummary;
  results: RunResults | null;
  facility: { heatingKwh: number; coolingKwh: number; conditionedAreaM2: number; unmetHeatingH: number; unmetCoolingH: number };
  zoneHeating: Map<string, number>;
  zoneCooling: Map<string, number>;
  zoneUnmet: Map<string, number>;
  surfaceConduction: Map<string, number>;
  /** the exterior surfaces' outside face temperatures on the design days, 24 hours each (2026-10-08) — empty for a run made before */
  designSurfaceTemps: { summer: Map<string, number[]>; winter: Map<string, number[]> };
  /** every coil's rate (2026-10-11): the design days by minute, the weather year by the hour — a structure's coincident peak is summed from them */
  coilRates: ReturnType<typeof queryCoilRates>;
  windowNet: Map<string, number>;
  /** the run's daily meters — what the operations model sums over bill periods */
  daily: Array<{ name: string; month: number; day: number; value: number }>;
  /** the run's hourly meters and outdoor dry-bulb (2026-10-03), the latest run only — empty for a run made before */
  hourly: Array<{ name: string; units: string; values: number[]; start?: [number, number, number] }>;
  /** the tariffs the run priced (2026-10-03): the engine's year and months, $ — empty when no tariff was applied */
  tariffs: Array<{ name: string; annualUsd: number; monthlyUsd: number[] }>;
  /** THE END USES BY FUEL (2026-09-15): every non-zero row × fuel cell; each fuel's coincident peak and its time (MMDDHHMM) */
  endUses: EndUseCell[];
  fuelPeaks: FuelPeak[];
  fuelPeakTimes: Map<string, number>;
  /** the sizing reports — what a unit is picked from */
  sizingDetails: SizingDetail[];
  /** each zone's design-day peak by load component (2026-10-02) — the RUN tab's Peak graph */
  componentLoads: ComponentLoad[];
  /** each zone's design-day peak from its own air heat balance (2026-10-11); empty for a run made before */
  zoneBalance: ComponentLoad[];
  /** the facility's monthly meters (kWh) and every zone's monthly heating and cooling (kWh), the charts' rows */
  monthlyMeters: Map<string, number[]>;
  monthlyZoneHeating: Map<string, number[]>;
  monthlyZoneCooling: Map<string, number[]>;
  /** which variable a zone's heating and cooling were read from: the ideal-loads pair, or the zone air system's (real equipment) */
  zoneSource: Map<string, "ideal loads" | "air system">;
  /** every zone's hours with its heating or cooling setpoint not met, month by month (2026-11-21, RUN's UNMET HOURS); empty for a run
   *  made before — its year is in the per-zone totals (the engine's SystemSummary), kept beside as `unmetYear` */
  monthlyUnmet: { heating: Map<string, number[]>; cooling: Map<string, number[]> };
  /** each conditioned zone's hourly divergence from its setpoints (2026-11-22) — empty for a run before the hourly output was asked */
  zoneDivergence: ZoneDivergence[];
  unmetYear: { heating: Map<string, number>; cooling: Map<string, number> };
}

const J = 3.6e6;

export async function weatherFor(epw: string | null, ledger: BemLedger | null): Promise<WeatherRead | null> {
  const t = await weatherTextsFor(epw, ledger);
  return t ? weatherOfTexts(t, ledger) : null;
}
/** the weather file's TEXT (and its .ddy's), found by name (2026-09-23: a ledger written on the old machine names
 *  /Applications/EnergyPlus-25-2-0/WeatherData/…) — what a commit puts into idf.db */
export async function weatherTextsFor(epw: string | null, ledger: BemLedger | null): Promise<ModelWeather | null> {
  const p = await window.bem.resolveEpw(epw ?? ledger?.weather?.epw ?? DEFAULT_EPW);
  if (!p) return null;
  const ddy = await window.bem.readText(p.replace(/\.epw$/i, ".ddy"));
  const text = await window.bem.readText(p);
  return text ? { path: p, epw: text, ddy: ddy ?? null } : null;
}
/** idf.db holds a weather file of the model's (a table, a row) */
const hasModelWeather = (db: Database): boolean => (db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='model_weather'")[0]?.values.length ?? 0) > 0
  && (db.exec("SELECT COUNT(*) FROM model_weather")[0]?.values[0]?.[0] as number) > 0;
export const weatherOfTexts = (t: ModelWeather, ledger: BemLedger | null): WeatherRead | null => weatherOfStore(t, ledger?.site?.designDays);

export interface BuildOpts {
  /** the APPLIED rulings — read only by a COMMIT (an Apply, or a file whose idf.db holds no model yet); the build reads idf.db's */
  ledger: BemLedger | null;
  /** an Apply: commit the ledger, the library objects it reads and the weather into idf.db before building from it */
  commit?: boolean;
  /** BOM › UTILITY's applied tariff (2026-10-03): written into the IDF as the engine's UtilityCost objects */
  tariff?: IdfModel["tariff"];
  epw: string | null;
  model?: IdfModel;
  readMeta: (db: Database) => Map<string, string>;
  engineVersion?: string;
  /** the site's county and its climate zone, read from the cached tables (2026-09-07) */
  zone?: CountyZoneRead | null;
  /** the engine's datasets, read once (2026-09-08): what a `library` ruling resolves against — with materials.db's rows beside them (`withMaterials`) */
  library?: Library | null;
  /** materials.db's content sha, recorded in bem.db so a saved material reads the model stale */
  materialsSha256?: string;
  /** the engine's schema, read once (2026-09-10): what a SYSTEMS ruling's fields resolve against */
  schema?: EpSchema | null;
}

/** the proof's row in the model's checks: a commit reproduced to the byte, or the first line it did not */
function modelStoreCheck(stored: ModelInputs, liveIdf: string | null, idf: string): CheckRow {
  const held = `${stored.libraryCount} library objects held as values, the weather ${stored.weather ? stored.weather.path.split(/[\\/]/).pop() : "none"}`;
  if (liveIdf === null) return { rule: "idf-db", subject: "the model", verdict: "ok", text: `written from idf.db alone — committed ${stored.committedAt} · ${held}`, fix: "" };
  const { diff: d } = proveStore(liveIdf, idf);
  return d
    ? { rule: "idf-db", subject: "the model", verdict: "fail", text: `idf.db does not reproduce the model: line ${d.line} reads "${d.now.trim()}" where the live libraries give "${d.was.trim()}"`, fix: "the program — report it" }
    : { rule: "idf-db", subject: "the model", verdict: "ok", text: `committed to idf.db and written from it alone, the IDF identical to the live libraries' (${idf.split("\n").length} lines) · ${held}`, fix: "" };
}

function readBack(again: Database, base: { input: BemInput; built: BuiltModel; weather: WeatherRead | null; report: IdfWriteReport; idf: string }, readMeta: BuildOpts["readMeta"]): BemModelOutcome {
  const bemMeta = readMeta(again);
  return {
    ...base,
    settings: querySettings(again),
    zones: queryBemZones(again),
    constructions: queryConstructions(again),
    schedules: querySchedules(again),
    systems: querySystems(again),
    systemQa: querySystemQa(again),
    checks: queryChecks(again),
    rooms: queryRooms(again),
    surfaces: queryBemSurfaces(again),
    notEmitted: queryNotEmitted(again),
    census: provenanceCensus(again),
    bemMeta,
    modelSha: bemMeta.get("model_sha256") ?? "",
    sourceIdfSha: bemMeta.get("source_idf_sha256") ?? "",
    runs: queryRuns(again),
  };
}

/** THE MODEL, written to bem.db and read back — no engine, no run. THE MODEL IS idf.db's (the user, 2026-10-06: "THE IDF DB MUST
 *  HOLD ALL INFORMATION REQUIRED FOR THE IDF ENERGYPLUS INPUT FILE!"): a COMMIT (every Apply, and once for a file whose idf.db holds
 *  no model yet) writes the applied rulings, the library objects the build reads, the weather and the climate zone into idf.db; the
 *  model is then built from idf.db ALONE, and the commit is proven — the IDF from idf.db must equal the live libraries' to the byte */
export async function buildBemModel(SQL: SqlJsStatic, opts: BuildOpts): Promise<BemModelOutcome> {
  const bytes = await window.bem.readDataFile("idf.db");
  if (!bytes) throw new Error("data/idf.db is not there — build the envelope first");
  let db = new SQL.Database(bytes);
  // the IDF states the version of the engine that will run it (2026-09-23) — the engine's, not the model's
  const base = opts.model ?? DEFAULT_MODEL;
  const model = { ...base, version: idfVersionOf(opts.engineVersion) ?? base.version };
  let liveIdf: string | null = null;
  if (opts.commit || !holdsModel(db)) {
    const ledger: BemLedger = opts.ledger ?? { sourceIfcSha256: "", savedAt: "", zones: {}, constructions: {} };
    // THE WEATHER A COMMIT TAKES (2026-11-20): the one named (the run's, else the rulings'); when none is named, the one idf.db already
    // holds — a commit never swaps the model's weather by itself (the house named none, and under the program's default the next Apply
    // would have run it on Golden, Colorado); only with neither does the program's default stand in, said in the checks
    const named = opts.epw ?? ledger.weather?.epw ?? null;
    const held = !named && hasModelWeather(db) ? (db.exec("SELECT path, epw, ddy FROM model_weather LIMIT 1")[0]?.values[0] ?? null) : null;
    const weatherT: ModelWeather | null = held ? { path: String(held[0]), epw: String(held[1]), ddy: held[2] == null ? null : String(held[2]) } : await weatherTextsFor(named, ledger);
    liveIdf = commitModel(db, { ledger, library: opts.library ?? null, weather: weatherT, zone: opts.zone ?? null, model, schema: opts.schema ?? null, tariff: opts.tariff ?? null });
    stampIdfContentSha(db);
    const out = db.export();
    db.close();
    await window.bim.saveDb("idf.db", out);
    db = new SQL.Database(out);
  }
  const idfMeta = opts.readMeta(db);
  const fromStore = buildFromStore(db, model, opts.schema ?? null)!;
  db.close();
  const { stored, input, built, weather } = fromStore;
  const mi = built.input;   // the zones drawn on the sheet merged (2026-09-10)
  const w = writeIdf(mi.faces, mi.elements, mi.zoneVolumesM3, mi.site, mi.trueNorth, mi.sourceIfcName, weather, built.model);
  built.checks.push(modelStoreCheck(stored, liveIdf, w.idf));
  // the program's default weather standing in for one the project never named — loud, never silent (2026-11-20)
  const heldName = stored.weather?.path.split(/[\\/]/).pop() ?? null;
  if (!opts.ledger?.weather?.epw && (heldName === null || heldName === DEFAULT_EPW))
    built.checks.push({ rule: "weather", subject: "the weather file", verdict: "warn", text: heldName ? `no weather file is named for this project — the program's default, ${DEFAULT_EPW}, is in the model` : "no weather file is named for this project and none is in the model", fix: "choose the project's weather file on BEM › SITE, then Apply" });
  // THE SYSTEM QA (2026-09-12) reads the IDF as written — the text the engine reads — and names what a loop, an air loop
  // or a zone is missing; it needs the schema to key the fields, and without one says nothing rather than guessing
  const qa = opts.schema ? systemQa(w.idf, opts.schema, { conditioned: w.report.zoneRows.filter((z) => z.conditioned.value).map((z) => z.epName) }) : [];
  // bem.db: the existing file's runs are kept; the model tables are replaced
  const prev = await window.bem.readDataFile("bem.db");
  const bdb = openBemDb(SQL, prev);
  writeModel(bdb, mi, w.report.zoneRows.map((z) => {
    const zr = mi.zones.find((q) => q.name === z.name);
    return { ...z, kind: zr?.kind ?? "room", volumeM3: zr?.volumeM3 ?? 0, volumeSource: zr?.volumeSource ?? "" };
  }), built.settings, w.report, { sourceName: "idf.db", engineVersion: opts.engineVersion, materialsSha256: opts.materialsSha256 }, qa, built.checks);
  stampBemContentSha(bdb);
  const out = bdb.export();
  bdb.close();
  await window.bim.saveDb("bem.db", out);
  const again = new SQL.Database(out);
  const res = readBack(again, { input, built, weather, report: w.report, idf: w.idf }, opts.readMeta);
  again.close();
  return { ...res, idfMeta, modelStore: { committedAt: stored.committedAt, libraryCount: stored.libraryCount, committed: liveIdf !== null } };
}

/** THE RUN RECORD (2026-11-20): the run's files and its summary kept in the project's record/<stamp>/ — what the model was built from read
 *  out of bem.db's own meta, as written; a failure to record is said, never fatal (the run itself is in bem.db) */
async function recordRun(db: Database, run: BemRun, results: RunResults | null, ledgerSavedAt: string | null, onProgress: (line: string) => void): Promise<void> {
  const meta = new Map<string, string>();
  for (const [k, v] of db.exec("SELECT key, value FROM meta")[0]?.values ?? []) meta.set(String(k), String(v));
  try {
    const r = await window.bem.writeRecord(run.stamp, RECORD_FILES, runSummary(run, results, {
      idfContentSha256: meta.get("source_idf_sha256") ?? null, ifcSha256: meta.get("source_ifc_sha256") ?? null,
      ledgerSavedAt, project: window.projectNow?.name ?? null }));
    if ("dir" in r) onProgress(`recorded in record/${run.stamp}/ — ${r.files.join(", ")} (${(r.bytes / 1e6).toFixed(1)} MB)${r.missing.length ? ` · not written by the engine: ${r.missing.join(", ")}` : ""}`);
    else if ("skipped" in r) onProgress(`not recorded: ${r.skipped}`);
    else onProgress(`the run record failed: ${r.error} — the run itself is in bem.db`);
  } catch (e) { onProgress(`the run record failed: ${e instanceof Error ? e.message : String(e)} — the run itself is in bem.db`); }
}

/** the whole run, from the file to bem.db */
export async function runBemPipeline(
  SQL: SqlJsStatic,
  opts: BuildOpts & { onProgress: (line: string) => void; reportUnits?: "si" | "ip" },
): Promise<BemOutcome> {
  const engine = await window.bem.engine();
  const m = await buildBemModel(SQL, { ...opts, engineVersion: engine?.version });
  // the code's values incomplete: the model is built for the tabs, never run (2026-10-15)
  if (m.report.codeGap) throw new Error(m.report.codeGap);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
  opts.onProgress(`writing in.idf (${(m.idf.length / 1e3).toFixed(0)} kB) · ${engine ? engine.version : "NO ENGINE FOUND"}`);
  const res = await window.bem.run({ stamp, idf: withReportUnits(m.idf, opts.reportUnits ?? "si"), epw: m.weather?.epw ?? null, expand: m.built.model.idealLoads });
  const errBytes = await window.bem.readRunFile(stamp, "eplusout.err");
  const errText = errBytes ? new TextDecoder().decode(errBytes) : (res.error ?? "no eplusout.err");
  const err = parseErr(errText);
  const run: BemRun = {
    stamp, dir: res.dir ?? "", epw: m.weather?.epw ?? null, exitCode: res.exitCode, completed: err.completed,
    fatal: err.fatal, severe: err.severe, warning: err.warning, seconds: res.seconds, energyplusVersion: engine?.version ?? "",
    modelSha256: m.modelSha,
  };
  let results: RunResults | null = null;
  const sqlBytes = await window.bem.readRunFile(stamp, "eplusout.sql");
  // each heat pump water heater's evaporator and the zone whose air it draws, from the run's own IDF (2026-10-07)
  const hpwhZones = new Map<string, string>();
  for (const o of parseIdfObjects(m.idf, "in.idf")) if (o.cls === "WaterHeater:HeatPump:WrappedCondenser" && o.fields[20] && o.fields[14]) hpwhZones.set(o.fields[20].toUpperCase(), o.fields[14].toUpperCase());
  // the unit heaters (2026-10-08): coil → unit, the run's peak read per unit
  const unitHeaters = new Map<string, string>();
  for (const o of parseIdfObjects(m.idf, "in.idf")) if (o.cls === "ZoneHVAC:UnitHeater" && o.fields[8]) unitHeaters.set(o.fields[8].toUpperCase(), o.fields[0]!.toUpperCase());
  // each zone's ERV (2026-10-11): its effect on the zone air is taken out of the unit's supply in the zone's balance
  const ervZones = zoneEquipmentZones(m.idf, "ZoneHVAC:EnergyRecoveryVentilator");
  if (sqlBytes) { const rdb = new SQL.Database(sqlBytes); results = readRunSql(rdb, { hpwhZones, unitHeaters, ervZones }); rdb.close(); }
  // the run beside the model in bem.db, saved, then READ BACK from its own bytes
  const prev = await window.bem.readDataFile("bem.db");
  const bdb = openBemDb(SQL, prev);
  writeRun(bdb, run, results);
  stampBemContentSha(bdb);
  const out = bdb.export();
  bdb.close();
  await window.bim.saveDb("bem.db", out);
  const again = new SQL.Database(out);
  await recordRun(again, run, results, opts.ledger?.savedAt ?? null, opts.onProgress);
  const base = readBack(again, m, opts.readMeta);
  const outcome = runOutcome(again, base, stamp, run, err, results);
  again.close();
  return outcome;
}

/** THE CALIBRATION RUN (user, 2026-10-09: "an energyplus run for BOM customized for calibrated, and leave regular weather model energyplus
 *  run on BEM"). The model as committed in idf.db — the same rulings, the same library values — run on the ACTUAL YEAR the bills were
 *  metered under (an EPW given by path, its RunPeriod the file's own dated span). Nothing of the model is written: bem.db gains the run
 *  alone, kind "calibration", with its hours; BEM's design run and its hours stay its own. */
export async function runCalibration(SQL: SqlJsStatic, opts: { epwPath: string; schema?: EpSchema | null; onProgress: (line: string) => void }): Promise<{ run: BemRun; err: ErrSummary; hourly: ReturnType<typeof queryHourly>; ground: string }> {
  const engine = await window.bem.engine();
  const bytes = await window.bem.readDataFile("idf.db");
  if (!bytes) throw new Error("data/idf.db is not there — build the envelope first");
  const texts = await weatherTextsFor(opts.epwPath, null);
  if (!texts) throw new Error(`the weather file ${opts.epwPath} could not be read`);
  const db = new SQL.Database(bytes);
  const model = { ...DEFAULT_MODEL, version: idfVersionOf(engine?.version) ?? DEFAULT_MODEL.version };
  const store = buildFromStore(db, model, opts.schema ?? null, texts);
  db.close();
  if (!store) throw new Error("idf.db holds no model yet — Apply on a BEM tab first");
  if (!store.weather?.amy) throw new Error(`${texts.path.split(/[\\/]/).pop()} is not an actual-year file — a calibration runs on the year the bills were metered under`);
  const mi = store.built.input;
  // THE GROUND ON AN ACTUAL YEAR (user's ruling, 2026-11-21): Kiva reads the weather file by calendar day from its first row
  // (groundCoupling.kivaReadsWeather) — on a year that is not 1 January to 31 December it reads the wrong days and the engine crashed.
  // That calibration run alone takes the F/C-factor method on the user's typed F and C; BEM's design run keeps Kiva
  const amy = store.weather.amy;
  const fmtD = (d: [number, number, number]): string => `${d[0]}-${String(d[1]).padStart(2, "0")}-${String(d[2]).padStart(2, "0")}`;
  let calModel = store.built.model;
  let ground = `${groundMethodOf(calModel.ground) === "kiva" ? "Kiva" : groundMethodOf(calModel.ground) === "fcfactor" ? "F/C-factor" : "constant ground temperature"} — as BEM's design run`;
  if (groundMethodOf(calModel.ground) === "kiva" && !kivaReadsWeather(amy)) {
    const g = calModel.ground;
    if (!Number.isFinite(fFactor(g?.fIp).wmK) || !Number.isFinite(cFactor(g?.wallR ?? 10, g?.cIp).wm2K))
      throw new Error(`the calibration year runs ${fmtD(amy.begin)} → ${fmtD(amy.end)}, not 1 January to 31 December, and EnergyPlus's Kiva foundations read a weather file by calendar day from its first row — on such a year they read the wrong days and the engine crashes. The calibration run therefore takes the F/C-factor ground method, which needs the slab's F-factor and the below-grade walls' C-factor typed on BEM › CONSTRUCTIONS › Floors (${!Number.isFinite(fFactor(g?.fIp).wmK) ? "F" : ""}${!Number.isFinite(fFactor(g?.fIp).wmK) && !Number.isFinite(cFactor(g?.wallR ?? 10, g?.cIp).wm2K) ? " and " : ""}${!Number.isFinite(cFactor(g?.wallR ?? 10, g?.cIp).wm2K) ? "C" : ""} not entered). BEM's design run keeps Kiva.`);
    calModel = { ...calModel, ground: { ...(g ?? {}), method: "fcfactor" } };
    ground = `F/C-factor (F ${g!.fIp} · C ${g!.cIp}) — Kiva cannot read a year from ${fmtD(amy.begin)}; BEM's design run keeps Kiva`;
  }
  const w = writeIdf(mi.faces, mi.elements, mi.zoneVolumesM3, mi.site, mi.trueNorth, mi.sourceIfcName, store.weather, calModel);
  if (w.report.codeGap) throw new Error(w.report.codeGap);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
  opts.onProgress(`calibration run · ${fmtD(amy.begin)} → ${fmtD(amy.end)} · ground ${ground.split(" — ")[0]} · ${(w.idf.length / 1e3).toFixed(0)} kB · ${engine ? engine.version : "NO ENGINE FOUND"}`);
  const res = await window.bem.run({ stamp, idf: w.idf, epw: store.weather.epw, expand: store.built.model.idealLoads });
  const errBytes = await window.bem.readRunFile(stamp, "eplusout.err");
  const err = parseErr(errBytes ? new TextDecoder().decode(errBytes) : (res.error ?? "no eplusout.err"));
  const prevBem = await window.bem.readDataFile("bem.db");
  const bdb = openBemDb(SQL, prevBem);
  const run: BemRun = { stamp, dir: res.dir ?? "", epw: store.weather.epw, exitCode: res.exitCode, completed: err.completed, fatal: err.fatal, severe: err.severe, warning: err.warning,
    seconds: res.seconds, energyplusVersion: engine?.version ?? "", modelSha256: (bdb.exec("SELECT value FROM meta WHERE key='model_sha256'")[0]?.values[0]?.[0] as string | undefined) ?? undefined, kind: "calibration" };
  let results: RunResults | null = null;
  const sqlBytes = await window.bem.readRunFile(stamp, "eplusout.sql");
  if (sqlBytes) { const rdb = new SQL.Database(sqlBytes); results = readRunSql(rdb); rdb.close(); }
  writeRun(bdb, run, results);
  // which ground method the run took, in words (scope "run": no result of the model's) — the calibration card says it
  bdb.run("INSERT INTO results VALUES (?,?,?,?,?,?,?,?)", [stamp, "run", "", 0, "ground_method", 1, "", ground]);
  stampBemContentSha(bdb);
  const out = bdb.export();
  bdb.close();
  await window.bim.saveDb("bem.db", out);
  const again = new SQL.Database(out);
  await recordRun(again, run, results, null, opts.onProgress);
  const hourly = queryHourly(again, stamp);
  again.close();
  return { run, err, hourly, ground };
}

/** the latest calibration run's hours, read back (no engine) */
export async function readLatestCalibration(SQL: SqlJsStatic): Promise<{ run: BemRun; hourly: ReturnType<typeof queryHourly>; ground: string | null } | null> {
  const bytes = await window.bem.readDataFile("bem.db");
  if (!bytes) return null;
  const db = new SQL.Database(bytes);
  try {
    const run = queryRuns(db).filter((r) => r.kind === "calibration").pop();
    if (!run) return null;
    const hourly = queryHourly(db, run.stamp);
    const ground = queryResultRows(db, run.stamp, "run", "ground_method")[0]?.origin ?? null;
    return hourly.length ? { run, hourly, ground } : null;
  } finally { db.close(); }
}

/** THE LAST RUN, READ BACK (user, 2026-09-04: the loads paint the zone model
 *  on load, not only after a run in this session). A result belongs to the
 *  model it was run on — RUN says when the model has moved since — but the
 *  last run's loads are the last word until a new run. From bem.db's own
 *  bytes; the engine is not touched. */
export async function readLatestRun(SQL: SqlJsStatic, model: BemModelOutcome): Promise<BemOutcome | null> {
  // BEM's last word is its latest DESIGN run — a calibration run (BOM, the actual year) never stands in for it
  const run = model.runs.filter((r) => r.kind !== "calibration").sort((x, y) => x.stamp.localeCompare(y.stamp)).pop();
  if (!run) return null;
  const bytes = await window.bem.readDataFile("bem.db");
  if (!bytes) return null;
  const db = new SQL.Database(bytes);
  try {
    if (queryResults(db, run.stamp, "facility", "heating").size === 0) return null;
    const errBytes = await window.bem.readRunFile(run.stamp, "eplusout.err");
    const err: ErrSummary = errBytes
      ? parseErr(new TextDecoder().decode(errBytes))
      : { ...parseErr(""), fatal: run.fatal, severe: run.severe, warning: run.warning, completed: run.completed };
    return runOutcome(db, model, run.stamp, run, err, null);
  } finally { db.close(); }
}

/** a run's results, read from bem.db beside the model they belong to */
function runOutcome(again: Database, base: BemModelOutcome, stamp: string, run: BemRun, err: ErrSummary, results: RunResults | null): BemOutcome {
  const facility = {
    heatingKwh: queryResults(again, stamp, "facility", "heating").get("") ?? 0,
    coolingKwh: queryResults(again, stamp, "facility", "cooling").get("") ?? 0,
    conditionedAreaM2: queryResults(again, stamp, "facility", "conditioned_area").get("") ?? 0,
    unmetHeatingH: queryResults(again, stamp, "facility", "unmet_heating").get("") ?? 0,
    unmetCoolingH: queryResults(again, stamp, "facility", "unmet_cooling").get("") ?? 0,
  };
  const kwh = (mm: Map<string, number>): Map<string, number> => new Map([...mm].map(([k, v]) => [k, v / J]));
  // a zone's heating and cooling: the ideal-loads pair where it serves the zone, else the zone air system's sensible
  // pair (real equipment, 2026-09-15) — the source per zone is kept so the table can say which
  const zoneHeating = kwh(queryResults(again, stamp, "zone", "Zone Ideal Loads Supply Air Total Heating Energy"));
  const zoneCooling = kwh(queryResults(again, stamp, "zone", "Zone Ideal Loads Supply Air Total Cooling Energy"));
  const zoneSource = new Map<string, "ideal loads" | "air system">();
  for (const k of zoneHeating.keys()) zoneSource.set(k, "ideal loads");
  for (const [k, v] of kwh(queryResults(again, stamp, "zone", "Zone Air System Sensible Heating Energy"))) if (!zoneHeating.has(k)) { zoneHeating.set(k, v); zoneSource.set(k, "air system"); }
  for (const [k, v] of kwh(queryResults(again, stamp, "zone", "Zone Air System Sensible Cooling Energy"))) if (!zoneCooling.has(k)) zoneCooling.set(k, v);
  const kwhRows = (mm: Map<string, number[]>): Map<string, number[]> => new Map([...mm].map(([k, a]) => [k, a.map((v) => v / J)]));
  const mzh = kwhRows(queryMonthlyByZone(again, stamp, "Zone Ideal Loads Supply Air Total Heating Energy")), mzc = kwhRows(queryMonthlyByZone(again, stamp, "Zone Ideal Loads Supply Air Total Cooling Energy"));
  for (const [k, a] of kwhRows(queryMonthlyByZone(again, stamp, "Zone Air System Sensible Heating Energy"))) if (!mzh.has(k)) mzh.set(k, a);
  for (const [k, a] of kwhRows(queryMonthlyByZone(again, stamp, "Zone Air System Sensible Cooling Energy"))) if (!mzc.has(k)) mzc.set(k, a);
  const fp = queryFuelPeaks(again, stamp);
  const zoneUnmet = new Map<string, number>();
  for (const [k, v] of queryResults(again, stamp, "zone", "unmet_heating")) zoneUnmet.set(k, v);
  for (const [k, v] of queryResults(again, stamp, "zone", "unmet_cooling")) zoneUnmet.set(k, (zoneUnmet.get(k) ?? 0) + v);
  const surfaceConduction = kwh(queryResults(again, stamp, "surface", "Surface Inside Face Conduction Heat Transfer Energy"));
  const gain = queryResults(again, stamp, "surface", "Surface Window Heat Gain Energy"), loss = queryResults(again, stamp, "surface", "Surface Window Heat Loss Energy");
  const windowNet = new Map<string, number>();
  for (const [k, v] of gain) windowNet.set(k, (v - (loss.get(k) ?? 0)) / J);
  const daily = queryDailyMeters(again, stamp);
  return { ...base, stamp, run, err, results, facility, zoneHeating, zoneCooling, zoneUnmet, surfaceConduction, windowNet, designSurfaceTemps: queryDesignSurfaceTemps(again, stamp), coilRates: queryCoilRates(again, stamp), daily, hourly: queryHourly(again, stamp), tariffs: queryTariffs(again, stamp), loads: readLoads(again, stamp),
    endUses: queryEndUses(again, stamp), fuelPeaks: fp.peaks, fuelPeakTimes: fp.times, sizingDetails: querySizingDetails(again, stamp), componentLoads: queryComponentLoads(again, stamp), zoneBalance: queryZoneBalance(again, stamp),
    monthlyMeters: kwhRows(queryMonthlyMeters(again, stamp)), monthlyZoneHeating: mzh, monthlyZoneCooling: mzc, zoneSource,
    monthlyUnmet: { heating: queryMonthlyByZone(again, stamp, "Zone Heating Setpoint Not Met Time"), cooling: queryMonthlyByZone(again, stamp, "Zone Cooling Setpoint Not Met Time") },
    zoneDivergence: queryZoneDivergence(again, stamp),
    unmetYear: { heating: queryResults(again, stamp, "zone", "unmet_heating"), cooling: queryResults(again, stamp, "zone", "unmet_cooling") } };
}

/** the design loads, the weather-year peaks and the facility peak, from bem.db's long table */
function readLoads(db: Database, stamp: string): LoadsRead {
  const scopeLoads = (scope: "zone" | "space"): Map<string, ZoneLoads> => {
    const q = (m: string): Map<string, number> => queryResults(db, stamp, scope, m);
    const none = (): Map<string, number> => new Map<string, number>();
    const dh = q("design_heating_w"), dc = q("design_cooling_w"), dhA = q("design_heating_wm2"), dcA = q("design_cooling_wm2");
    const dhf = q("design_heating_flow_m3s"), dcf = q("design_cooling_flow_m3s");
    const dht = q("design_heating_time"), dct = q("design_cooling_time");
    const dayOf = (m: string): Map<string, string> => new Map(queryResultRows(db, stamp, scope, m).map((r) => [r.key, r.origin.split(" · ")[1] ?? ""]));
    const hd = dayOf("design_heating_w"), cd = dayOf("design_cooling_w");
    const ph = scope === "zone" ? q("peak_heating_w") : none(), pc = scope === "zone" ? q("peak_cooling_w") : none();
    const pht = scope === "zone" ? q("peak_heating_time") : none(), pct = scope === "zone" ? q("peak_cooling_time") : none();
    const out = new Map<string, ZoneLoads>();
    for (const k of new Set([...dh.keys(), ...dc.keys(), ...ph.keys()])) {
      out.set(k, {
        designHeatingW: dh.get(k) ?? 0, designCoolingW: dc.get(k) ?? 0, designHeatingWm2: dhA.get(k) ?? 0, designCoolingWm2: dcA.get(k) ?? 0,
        designHeatingFlowM3s: dhf.get(k) ?? 0, designCoolingFlowM3s: dcf.get(k) ?? 0,
        heatingDay: hd.get(k) ?? "", coolingDay: cd.get(k) ?? "", heatingDayTime: dht.get(k) ?? 0, coolingDayTime: dct.get(k) ?? 0,
        peakHeatingW: ph.get(k) ?? 0, peakHeatingTime: pht.get(k) ?? 0, peakCoolingW: pc.get(k) ?? 0, peakCoolingTime: pct.get(k) ?? 0,
      });
    }
    return out;
  };
  const zones = scopeLoads("zone"), spaces = scopeLoads("space");
  const f = (m: string): number => queryResults(db, stamp, "facility", m).get("") ?? 0;
  let sumH = 0, sumC = 0;
  for (const z of zones.values()) { sumH += z.designHeatingW; sumC += z.designCoolingW; }
  return { zones, spaces, facility: {
    peakHeatingW: f("peak_heating_w"), peakHeatingTime: f("peak_heating_time"), peakCoolingW: f("peak_cooling_w"), peakCoolingTime: f("peak_cooling_time"),
    sumDesignHeatingW: sumH, sumDesignCoolingW: sumC,
  } };
}
