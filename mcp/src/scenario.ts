// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// RUN A SCENARIO (release 3): a year in EnergyPlus on the model as it would be with one ruling changed — or, with no change, on the
// model as it stands — beside the project's last run. The model is the preview's (preview.ts: built the way the app's Apply builds
// it, in memory); it is run the way the app's RUN runs it (pipeline.ts runBemPipeline: the same report units, `-x` when the templates
// expand, the same reading of eplusout.sql). The ONE place this package writes is the scenario's own run folder,
// <project>/cache/mcp/runs/<stamp>/ — never idf.db, bem.db, the ledgers or the app's runs; the newest few are kept, the rest removed
// by this package alone. The project's model is unchanged; only you apply a ruling, in the app.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { withReportUnits, parseIdfObjects, zoneEquipmentZones } from "../../program/src/modules/bem/core/idfLib.js";
import { readRunSql, type RunResults } from "../../program/src/modules/bem/core/eplusSql.js";
import { parseErr } from "../../program/src/modules/bem/core/eplusErr.js";
import { openBemDb, writeRun, queryRuns, type BemRun } from "../../program/src/modules/bem/core/bemDb.js";
import { Refusal, sql, dataDb, needDb, type ReadFrom } from "./project.js";
import { engines } from "./environment.js";
import { preview, type Change } from "./preview.js";
import { results, runSummary } from "./tools.js";

/** scenario runs kept in cache/mcp/runs; an older one is removed when a new one is made */
export const KEEP_RUNS = 5;
const KILL_MS = 15 * 60 * 1000;   // the app's own limit on a run
export const SCENARIO_DIR = path.join("cache", "mcp", "runs");

const r1 = (x: number): number => Math.round(x * 10) / 10;

function runEngine(exe: string, args: string[], cwd: string, onLine: (l: string) => void): Promise<{ exitCode: number | null; seconds: number; error: string | null }> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const sa = engines.spawnArgs(exe, args);
    const child = spawn(sa.exe, sa.args, { cwd, shell: sa.shell });
    let buf = "";
    const onData = (d: Buffer): void => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/); buf = lines.pop() ?? "";
      for (const l of lines) if (l.trim()) onLine(l);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    const killer = setTimeout(() => { child.kill("SIGKILL"); onLine("killed after 15 minutes"); }, KILL_MS);
    child.on("close", (code) => { clearTimeout(killer); resolve({ exitCode: code, seconds: (Date.now() - t0) / 1000, error: null }); });
    child.on("error", (e) => { clearTimeout(killer); resolve({ exitCode: null, seconds: (Date.now() - t0) / 1000, error: String(e) }); });
  });
}

/** only this package's own scenario folders are removed: names it makes (a stamp), under cache/mcp/runs, beyond the newest KEEP_RUNS */
function prune(root: string): string[] {
  const mine = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && /^\d{8}T\d{6}Z?(-\d+)?$/.test(d.name)).map((d) => d.name).sort();
  const gone = mine.slice(0, Math.max(0, mine.length - KEEP_RUNS));
  for (const g of gone) fs.rmSync(path.join(root, g), { recursive: true, force: true });
  return gone;
}

export async function runScenario(dir: string, change: Change | null, onLine: (l: string) => void = () => {}): Promise<{ result: Record<string, unknown>; read: ReadFrom[]; results: RunResults | null; idf: string }> {
  const eng = engines.findEngine();
  if (!eng) throw new Refusal("no EnergyPlus installed — a scenario is a year in the engine");
  const pv = await preview(dir, change);
  const { after } = pv;
  // THE CHECKS CLEARED FIRST (the user, 2026-11-20: "the MCP should see the checks for clearing before allowing a run"): what the app
  // stops a run on, read from the model's own checks, and every question the user has not yet answered — each named with where it is cleared
  if (after.runBlocks.length) throw new Refusal(`a run waits on ${after.runBlocks.length} check${after.runBlocks.length === 1 ? "" : "s"} only the user can clear, in the app: ${after.runBlocks.map((b) => `${b.what} (${b.how})`).join(" · ")}`);
  if (!after.weather) throw new Refusal("the model holds no weather file — choose the project's weather on BEM › SITE and Apply, in the app");

  // the project's last design run, and the report units it was written in (its own in.idf, in the app's run folder)
  const bem = await dataDb(dir, "bem");
  const read: ReadFrom[] = [...pv.read, ...(bem ? [bem.from] : [])];
  const runs = bem ? queryRuns(bem.db) : [];
  const last = [...runs].reverse().find((r) => r.kind !== "calibration") ?? null;
  const lastIdfFile = last ? path.join(dir, "data", "bem", "runs", last.stamp, "in.idf") : null;
  const lastIdf = lastIdfFile && fs.existsSync(lastIdfFile) ? fs.readFileSync(lastIdfFile, "utf8") : null;
  // the last run is the same model when the model AS IT STANDS (without this change) is its in.idf, in either report units
  const units: "si" | "ip" = lastIdf !== null && withReportUnits(pv.idfNow, "ip") === lastIdf ? "ip" : "si";
  const idf = withReportUnits(after.idf, units);
  const weatherName = path.basename(after.weather.path);
  const sameModel = lastIdf === null ? null : withReportUnits(pv.idfNow, units) === lastIdf;
  const sameWeather = last?.epw ? path.basename(last.epw) === weatherName : null;

  // the scenario's own folder, by its real path (the app's rule: EnergyPlus takes a linked folder and its real one for two places)
  const root = path.join(dir, SCENARIO_DIR);
  fs.mkdirSync(root, { recursive: true });
  let stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
  for (let n = 2; fs.existsSync(path.join(root, stamp)); n++) stamp = `${stamp.replace(/-\d+$/, "")}-${n}`;
  fs.mkdirSync(path.join(root, stamp));
  const runDir = fs.realpathSync(path.join(root, stamp));
  const idfPath = path.join(runDir, "in.idf"), epwPath = path.join(runDir, "in.epw");
  fs.writeFileSync(idfPath, idf);
  fs.writeFileSync(epwPath, after.weather.epw);
  fs.writeFileSync(path.join(runDir, "change.json"), JSON.stringify({ change, weather: after.weather.path, engine: eng.version, units }, null, 1));
  onLine(`writing in.idf (${(idf.length / 1e3).toFixed(0)} kB) · EnergyPlus ${eng.version} · weather ${weatherName}`);
  const res = await runEngine(eng.exe, [...(after.expand ? ["-x"] : []), "-w", epwPath, "-d", runDir, idfPath], runDir, onLine);
  const errFile = path.join(runDir, "eplusout.err");
  const err = parseErr(fs.existsSync(errFile) ? fs.readFileSync(errFile, "utf8") : (res.error ?? "no eplusout.err"));
  const run: BemRun = { stamp, dir: runDir, epw: after.weather.path, exitCode: res.exitCode, completed: err.completed, fatal: err.fatal, severe: err.severe, warning: err.warning,
    seconds: res.seconds, energyplusVersion: eng.version, kind: "design" };

  // read as the app reads a run (the same readRunSql, with the run's own heat pump water heaters, unit heaters and ERVs), written into
  // an in-memory bem.db and read back through the same queries run_results uses, so the two sides compare like for like
  const SQL = await sql();
  let rr: RunResults | null = null;
  const sqlFile = path.join(runDir, "eplusout.sql");
  if (fs.existsSync(sqlFile)) {
    const hpwhZones = new Map<string, string>(), unitHeaters = new Map<string, string>();
    for (const o of parseIdfObjects(idf, "in.idf")) {
      if (o.cls === "WaterHeater:HeatPump:WrappedCondenser" && o.fields[20] && o.fields[14]) hpwhZones.set(o.fields[20].toUpperCase(), o.fields[14].toUpperCase());
      if (o.cls === "ZoneHVAC:UnitHeater" && o.fields[8]) unitHeaters.set(o.fields[8].toUpperCase(), o.fields[0]!.toUpperCase());
    }
    const rdb = new SQL.Database(new Uint8Array(fs.readFileSync(sqlFile)));
    rr = readRunSql(rdb, { hpwhZones, unitHeaters, ervZones: zoneEquipmentZones(idf, "ZoneHVAC:EnergyRecoveryVentilator") });
    rdb.close();
  }
  const mem = openBemDb(SQL, null);
  writeRun(mem, run, rr);
  const scenario: Record<string, unknown> = { run: { ...runSummary(run), folder: path.relative(dir, runDir) }, ...results(mem, stamp, false) };
  mem.close();
  const before: Record<string, unknown> | null = last && bem ? { run: runSummary(last), ...results(bem.db, last.stamp, false) } : null;

  const fa = before?.facility as Record<string, number | string | null> | null | undefined, fb = scenario.facility as Record<string, number | string | null> | null;
  const facilityDelta = fa && fb ? Object.fromEntries(Object.keys(fb).filter((k) => typeof fa[k] === "number" && typeof fb[k] === "number").map((k) => [k, r1((fb[k] as number) - (fa[k] as number))])) : null;
  const ea = (before?.endUsesByFuel ?? {}) as Record<string, Record<string, number>>, eb = scenario.endUsesByFuel as Record<string, Record<string, number>>;
  const endUseDelta: Record<string, Record<string, number>> = {};
  for (const fuel of new Set([...Object.keys(ea), ...Object.keys(eb)]))
    for (const row of new Set([...Object.keys(ea[fuel] ?? {}), ...Object.keys(eb[fuel] ?? {})])) {
      const d = r1((eb[fuel]?.[row] ?? 0) - (ea[fuel]?.[row] ?? 0));
      if (d !== 0) (endUseDelta[fuel] ??= {})[row] = d;
    }
  // the scenario's summary beside its files: what propose_ruling reads to carry this year in a proposal (the change must be the same)
  const against = before === null ? "the project has no run yet — run it in the app (RUN) to compare against"
    : `the project's last run ${last!.stamp}: ${sameModel === null ? "its in.idf is not on disk, so whether it is the same model is not known" : sameModel ? `the same model as this scenario's without the change, byte for byte${change ? " — the difference is this change alone" : ""}` : "a DIFFERENT model (the project changed since that run, besides this change)"}; ${sameWeather === null ? "its weather not recorded" : sameWeather ? "the same weather" : `other weather (${path.basename(last!.epw ?? "")})`}`;
  const facOf = (x: Record<string, unknown> | null, k: string): number | null => { const f = x?.facility as Record<string, unknown> | null | undefined; return typeof f?.[k] === "number" ? (f[k] as number) : null; };
  fs.writeFileSync(path.join(runDir, "summary.json"), JSON.stringify({
    change, idfContentSha256: (await needDb(dir, "idf")).from.contentSha256, completed: err.completed, fatal: err.fatal, severe: err.severe,
    heatingKwh: facOf(scenario, "heatingKwh"), coolingKwh: facOf(scenario, "coolingKwh"), lastRun: last?.stamp ?? null,
    heatingKwhLast: facOf(before, "heatingKwh"), coolingKwhLast: facOf(before, "coolingKwh"), against,
  }, null, 1));
  const removed = prune(root);

  return {
    idf, results: rr,
    read,
    result: {
      change,
      engine: { completed: err.completed, fatal: err.fatal, severe: err.severe, warning: err.warning, exitCode: res.exitCode, seconds: r1(res.seconds), ...(res.error ? { error: res.error } : {}) },
      ...(err.completed && err.fatal === 0 ? {} : { stopped: `the engine did not finish cleanly — read ${path.relative(dir, errFile)}` }),
      model: { noEffect: pv.result.noEffect ?? null, objects: pv.result.objects, settingsChanged: pv.result.settingsChanged, notHonoured: pv.result.notHonoured, storeProof: pv.result.storeProof },
      scenario,
      lastRun: before,
      against,
      facilityDelta, endUseDeltaKwh: endUseDelta,
      ...(pv.result.alsoCarried ? { alsoCarried: pv.result.alsoCarried } : {}),
      stamp,
      kept: `${path.relative(dir, runDir)} — this package's own folder; the newest ${KEEP_RUNS} are kept${removed.length ? `, ${removed.length} older removed` : ""}`,
      note: "a what-if year run beside the project, nothing of the project changed. propose_ruling with this stamp carries this year in a proposal; only the user applies a ruling, in the app.",
    },
  };
}
