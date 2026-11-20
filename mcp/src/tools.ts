// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE READ TOOLS (the first tool set, plan doc "BIM-BEM-BOM MCP package — the first tool set", 2026-11-17; the user's
// "proceed as recommended", 2026-11-20). Each tool is a plain async function of named arguments, so the gate calls exactly what
// the MCP server calls. Every number comes from the program's own query functions over the project's own files — never a second
// implementation — and every reply names what it read (the file, its content sha, when it was written), so an assistant cannot
// pass an old result off as a current one. Nothing here writes anything.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "sql.js";
import { Projects, Refusal, projectDb, dataDb, needDb, rows, hasTable, openIfcSha, type ReadFrom } from "./project.js";
import { readMeta, checkChain, formatChain } from "../../program/src/core/stale.js";
import { queryWallQA, queryVoidQA, queryVoidRulings } from "../../program/src/core/db.js";
import {
  queryRuns, queryEndUses, queryFuelPeaks, queryResults, queryMonthlyMeters, queryMonthlyByZone, querySizingDetails,
  queryBemZones, queryRooms, queryConstructions, queryChecks, querySystemQa, querySettings, queryNotEmitted, type BemRun,
} from "../../program/src/modules/bem/core/bemDb.js";
import { decodeTime, J_PER_KWH } from "../../program/src/modules/bem/core/eplusSql.js";
import { queryBills, queryCalibration } from "../../program/src/modules/bom/core/bomDb.js";
import { parseExplain } from "../../program/src/explain/explainParse.js";
import { preview, type Change } from "./preview.js";
import { runScenario } from "./scenario.js";
import { propose, listProposals } from "./propose.js";

export interface Reply { result: unknown; read: ReadFrom[] }
const LEDGER_KINDS = ["corrections", "bem", "bom"] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];
const kwh = (j: number): number => Math.round((j / J_PER_KWH) * 10) / 10;
const r1 = (v: number): number => Math.round(v * 10) / 10;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

export class Tools {
  constructor(readonly projects: Projects) {}

  async list_projects(): Promise<Reply> {
    const result = this.projects.list().map((name) => {
      const dir = path.join(this.projects.root, name);
      const ifc = fs.existsSync(path.join(dir, "ifc")) ? fs.readdirSync(path.join(dir, "ifc")).filter((f) => /\.ifc$/i.test(f)).sort() : [];
      const built = (["ifc", "idf", "bem", "bom"] as const).filter((d) => fs.existsSync(path.join(dir, "data", `${d}.db`)));
      return { name, folder: dir, ifcFiles: ifc, derivedBuilt: built, lastWritten: fs.statSync(path.join(dir, "project.sqlite")).mtime.toISOString() };
    });
    return { result, read: [{ file: this.projects.root, contentSha256: null, modified: fs.statSync(this.projects.root).mtime.toISOString() }] };
  }

  async project_summary(a: { project: string }): Promise<Reply> {
    const dir = this.projects.folder(a.project);
    const p = await projectDb(dir);
    const meta = Object.fromEntries(rows(p.db, "SELECT key, value FROM meta").map((r) => [String(r.key), String(r.value)]));
    let sources: unknown = null;
    try { sources = meta.sources ? JSON.parse(meta.sources) : null; } catch { sources = meta.sources; }
    const versions = rows(p.db, "SELECT sha, project_id, parent_sha, made_by, file_name, created_at, note FROM versions ORDER BY created_at");
    const projects = rows(p.db, "SELECT id, name, long_name FROM projects");
    const dbs = { ifc: await dataDb(dir, "ifc"), idf: await dataDb(dir, "idf"), bem: await dataDb(dir, "bem"), bom: await dataDb(dir, "bom"), materials: await dataDb(dir, "materials") };
    const chain = checkChain({ ifc: dbs.ifc && readMeta(dbs.ifc.db), idf: dbs.idf && readMeta(dbs.idf.db), bem: dbs.bem && readMeta(dbs.bem.db), bom: dbs.bom && readMeta(dbs.bom.db), materials: dbs.materials && readMeta(dbs.materials.db) });
    const runs = dbs.bem ? queryRuns(dbs.bem.db) : [];
    const last = [...runs].reverse().find((r) => r.kind !== "calibration") ?? null;
    const openSha = await openIfcSha(dir);
    return {
      result: {
        name: meta.name ?? path.basename(dir), template: meta.template ?? null, openIfc: meta.open_ifc ?? null, openIfcSha256: openSha,
        lastBackup: meta.last_backup ?? null, sources, ifcProjects: projects,
        versions: versions.map((v) => ({ sha: v.sha, project: v.project_id, parent: v.parent_sha, madeBy: v.made_by, file: v.file_name, created: v.created_at, note: v.note, open: v.sha === openSha })),
        freshness: { links: chain.map((l) => ({ module: l.module, key: l.downstreamKey, state: l.state })), lines: formatChain(chain) },
        lastRun: last && runSummary(last),
        modelHasChangedSinceLastRun: last && dbs.bem ? (readMeta(dbs.bem.db).get("model_sha256") ?? null) !== (last.modelSha256 ?? null) : null,
      },
      read: [p.from, ...Object.values(dbs).filter(Boolean).map((d) => d!.from)],
    };
  }

  async census(a: { project: string }): Promise<Reply> {
    const dir = this.projects.folder(a.project);
    const ifc = await needDb(dir, "ifc"), idf = await needDb(dir, "idf"), bem = await dataDb(dir, "bem");
    const byClass = rows(ifc.db, "SELECT ifc_class AS cls, count(*) AS n FROM elements GROUP BY ifc_class ORDER BY n DESC");
    const rooms = rows(ifc.db, "SELECT count(*) AS n FROM spaces")[0]?.n ?? 0;
    const surf = rows(idf.db, "SELECT category, count(*) AS n, sum(area_m2) AS net, sum(gross_area_m2) AS gross FROM surfaces GROUP BY category ORDER BY gross DESC");
    const zones = rows(idf.db, "SELECT kind, count(*) AS n FROM zones GROUP BY kind");
    let notEmitted: Array<{ reason: string; surfaces: number; netM2: number }> = [];
    if (bem) {
      const area = new Map(rows(idf.db, "SELECT id, area_m2 FROM surfaces").map((r) => [Number(r.id), Number(r.area_m2)]));
      const by = new Map<string, { n: number; a: number }>();
      for (const [id, reason] of queryNotEmitted(bem.db)) { const b = by.get(reason) ?? { n: 0, a: 0 }; b.n++; b.a += area.get(id) ?? 0; by.set(reason, b); }
      notEmitted = [...by].map(([reason, b]) => ({ reason, surfaces: b.n, netM2: r1(b.a) })).sort((x, y) => y.netM2 - x.netM2);
    }
    const totals = surf.reduce<{ n: number; net: number; gross: number }>((t, s) => ({ n: t.n + Number(s.n), net: t.net + Number(s.net), gross: t.gross + Number(s.gross) }), { n: 0, net: 0, gross: 0 });
    return {
      result: {
        elementsByClass: byClass.map((r) => ({ ifcClass: r.cls, elements: r.n })), rooms,
        zonesByKind: Object.fromEntries(zones.map((z) => [String(z.kind), Number(z.n)])),
        zoneSurfaces: { count: totals.n, netM2: r1(totals.net), grossM2: r1(totals.gross), byCategory: surf.map((s) => ({ category: s.category, surfaces: s.n, netM2: r1(Number(s.net)), grossM2: r1(Number(s.gross)) })) },
        notEmitted: bem ? notEmitted : "bem.db not built yet",
        note: "net = with openings taken out (the area identity the program holds against the file's triangles); gross = the outer ring, what EnergyPlus takes for a base surface",
      },
      read: [ifc.from, idf.from, ...(bem ? [bem.from] : [])],
    };
  }

  async wall_qa(a: { project: string; filter?: string }): Promise<Reply> {
    const dir = this.projects.folder(a.project);
    const idf = await needDb(dir, "idf");
    const names = new Map(rows(idf.db, "SELECT id, name FROM elements").map((r) => [Number(r.id), String(r.name ?? "")]));
    const f = a.filter?.toLowerCase().trim();
    const all = queryWallQA(idf.db);
    const out = all.map((w) => ({ element: `#${w.elementId}`, name: names.get(w.elementId) ?? "", rooms: w.spaces, facing: w.facing, lostLengthM: r3(w.lostLengthM), worstGapM: r3(w.worstGapM),
      openBoundaries: w.openCount, boundaries: w.boundaries.map((b) => ({ edge: b.name, state: b.state, gapM: r3(b.gapM), shouldMeet: b.meets })) }))
      .filter((w) => !f || `${w.element} ${w.name} ${w.rooms} ${w.facing}`.toLowerCase().includes(f));
    return { result: { planes: all.length, shown: out.length, note: "one row per exposed exterior wall plane; facing is the project grid's compass, not true north", rows: out }, read: [idf.from] };
  }

  async void_qa(a: { project: string }): Promise<Reply> {
    const dir = this.projects.folder(a.project);
    const idf = await needDb(dir, "idf");
    const rulings = new Map(queryVoidRulings(idf.db).map((r) => [r.space, r]));
    const out = queryVoidQA(idf.db).map((v) => ({ ...v, ruling: rulings.get(v.name) ?? null }));
    return { result: { spaces: out.length, ruled: out.filter((v) => v.ruling).length, rows: out }, read: [idf.from] };
  }

  async model_checks(a: { project: string }): Promise<Reply> {
    const dir = this.projects.folder(a.project);
    const bem = await needDb(dir, "bem");
    const checks = queryChecks(bem.db);
    const count = (v: string): number => checks.filter((c) => c.verdict === v).length;
    const qa = querySystemQa(bem.db);
    return {
      result: {
        checks: { ok: count("ok"), note: count("note"), warn: count("warn"), fail: count("fail"), rows: checks.map((c) => ({ rule: c.rule, subject: c.subject, verdict: c.verdict, text: c.text, fix: c.fix })) },
        systemQa: { rows: qa.length, withGaps: qa.filter((r) => r.gaps > 0).length, detail: qa },
      },
      read: [bem.from],
    };
  }

  async zones(a: { project: string }): Promise<Reply> {
    const dir = this.projects.folder(a.project);
    const bem = await needDb(dir, "bem");
    const rooms = queryRooms(bem.db);
    const out = queryBemZones(bem.db).map((z) => ({
      ...z, volumeM3: r1(z.volumeM3),
      rooms: rooms.filter((r) => r.zone === z.name || r.epName === z.epName).map((r) => ({ room: r.room, floorM2: r1(r.floorM2), conditioned: r.conditioned, people: r3(r.people), lightsW: r1(r.lightsW), equipmentW: r1(r.equipmentW) })),
    }));
    return { result: { zones: out.length, conditioned: out.filter((z) => z.conditioned).length, note: "setpoints in °C, volumes in m³, floor areas in m² — the program's stored units", rows: out }, read: [bem.from] };
  }

  async constructions(a: { project: string }): Promise<Reply> {
    const dir = this.projects.folder(a.project);
    const bem = await needDb(dir, "bem");
    const use = new Map(rows(bem.db, "SELECT construction AS c, count(*) AS n, sum(gross_area_m2) AS a FROM surfaces GROUP BY construction").map((r) => [String(r.c), { n: Number(r.n), a: Number(r.a) }]));
    const subs = hasTable(bem.db, "subsurfaces") ? new Map(rows(bem.db, "SELECT construction AS c, count(*) AS n FROM subsurfaces GROUP BY construction").map((r) => [String(r.c), Number(r.n)])) : new Map<string, number>();
    const cons = queryConstructions(bem.db).map((c) => ({ ...c, uWm2k: c.uWm2k === null ? null : r3(c.uWm2k), surfaces: use.get(c.name)?.n ?? 0, grossM2: r1(use.get(c.name)?.a ?? 0), subsurfaces: subs.get(c.name) ?? 0 }));
    const led = await this.ledger(dir, "bem");
    const ruled = led.json && typeof led.json === "object" ? (led.json as { constructions?: Record<string, { source?: string; name?: string; sameAs?: string }> }).constructions ?? {} : {};
    return {
      result: {
        constructions: cons, rulings: Object.entries(ruled).map(([type, r]) => ({ type, governs: r.source ?? null, name: r.name ?? null, sameAs: r.sameAs ?? null })),
        note: "U includes the surface films (1 / (ΣR + films)), W/m²K; a ruling is keyed by the IFC type's name",
      },
      read: [bem.from, ...led.read],
    };
  }

  async run_results(a: { project: string; run?: string }): Promise<Reply> {
    const dir = this.projects.folder(a.project);
    const bem = await needDb(dir, "bem");
    const run = pickRun(queryRuns(bem.db), a.run);
    return { result: { run: runSummary(run), ...results(bem.db, run.stamp, true) }, read: [bem.from] };
  }

  async bom_results(a: { project: string }): Promise<Reply> {
    const dir = this.projects.folder(a.project);
    const bom = await needDb(dir, "bom");
    const bills = queryBills(bom.db);
    return { result: { bills: bills.length, rows: bills.map(({ line: _l, ...b }) => b), calibration: queryCalibration(bom.db) }, read: [bom.from] };
  }

  /** the applied (and staged) rulings the app holds for the open IFC; a `key` narrows to one section of the ledger */
  async rulings(a: { project: string; kind: LedgerKind; key?: string }): Promise<Reply> {
    if (!LEDGER_KINDS.includes(a.kind)) throw new Refusal(`no ledger kind "${a.kind}" — one of ${LEDGER_KINDS.join(", ")}`);
    const dir = this.projects.folder(a.project);
    const led = await this.ledger(dir, a.kind);
    if (!led.json) return { result: { kind: a.kind, ifcSha256: led.sha, savedAt: null, note: "no ledger of this kind for the open IFC — nothing ruled" }, read: led.read };
    const j = led.json as Record<string, unknown>;
    if (a.key) {
      if (!(a.key in j)) throw new Refusal(`the ${a.kind} ledger has no section "${a.key}" — it holds ${Object.keys(j).join(", ")}`);
      return { result: { kind: a.kind, ifcSha256: led.sha, savedAt: led.savedAt, key: a.key, value: j[a.key] }, read: led.read };
    }
    const sections = Object.entries(j).map(([k, v]) => ({ key: k, size: JSON.stringify(v ?? null).length, entries: v && typeof v === "object" ? Object.keys(v as object).length : null }));
    return { result: { kind: a.kind, ifcSha256: led.sha, savedAt: led.savedAt, sections, note: "name a key to read that section whole; `staged` holds what waits on an Apply in the app" }, read: led.read };
  }

  async explain(a: { topic: string }): Promise<Reply> {
    const file = fileURLToPath(new URL("../../program/src/explain/explain.md", import.meta.url));
    const text = fs.readFileSync(file, "utf8");
    const q = a.topic.toLowerCase().trim();
    if (!q) throw new Refusal("name a topic — a field, a check, a tab or a method");
    const hits = parseExplain(text).filter((e) => `${e.title} ${e.region} ${e.scope ?? ""}`.toLowerCase().includes(q) || plain(e.html).toLowerCase().includes(q))
      .sort((x, y) => Number(y.title.toLowerCase().includes(q)) - Number(x.title.toLowerCase().includes(q))).slice(0, 8);
    return { result: { topic: a.topic, entries: hits.map((e) => ({ region: e.region, tab: e.scope, title: e.title, text: plain(e.html) })) }, read: [{ file, contentSha256: null, modified: fs.statSync(file).mtime.toISOString() }] };
  }

  /** every run bem.db holds, and every run record in record/ (which survives a rebuilt bem.db) */
  async list_runs(a: { project: string }): Promise<Reply> {
    const dir = this.projects.folder(a.project);
    const bem = await dataDb(dir, "bem");
    const runs = bem ? queryRuns(bem.db) : [];
    const recDir = path.join(dir, "record");
    const records = fs.existsSync(recDir) ? fs.readdirSync(recDir).filter((d) => fs.existsSync(path.join(recDir, d, "summary.json"))).sort() : [];
    const stamps = [...new Set([...runs.map((r) => r.stamp), ...records])].sort();
    const result = stamps.map((s) => {
      const r = runs.find((x) => x.stamp === s);
      return { stamp: s, kind: r?.kind ?? null, completed: r ? r.completed : null, fatal: r?.fatal ?? null, severe: r?.severe ?? null, modelSha256: r?.modelSha256 ?? null, inBemDb: !!r, record: records.includes(s) };
    });
    return { result: { runs: result.length, rows: result }, read: bem ? [bem.from] : [] };
  }

  /** two runs side by side: what they were built from, and their results — bem.db's when it holds the run, else the run record's summary */
  async compare_runs(a: { project: string; a: string; b: string }): Promise<Reply> {
    const dir = this.projects.folder(a.project);
    const bem = await dataDb(dir, "bem");
    const runs = bem ? queryRuns(bem.db) : [];
    const read: ReadFrom[] = bem ? [bem.from] : [];
    const side = (stamp: string): Record<string, unknown> => {
      const r = runs.find((x) => x.stamp === stamp);
      if (r && bem) return { source: "bem.db", run: runSummary(r), ...results(bem.db, stamp, false) };
      const f = path.join(dir, "record", stamp, "summary.json");
      if (!fs.existsSync(f)) throw new Refusal(`no run ${stamp} — list_runs lists them`);
      read.push({ file: f, contentSha256: null, modified: fs.statSync(f).mtime.toISOString() });
      return { source: "record", ...(JSON.parse(fs.readFileSync(f, "utf8")) as Record<string, unknown>) };
    };
    const A = side(a.a), B = side(a.b);
    const fa = A.facility as Record<string, number> | null | undefined, fb = B.facility as Record<string, number> | null | undefined;
    const delta = fa && fb ? Object.fromEntries(Object.keys(fa).filter((k) => typeof fa[k] === "number" && typeof fb[k] === "number").map((k) => [k, r1(fb[k]! - fa[k]!)])) : null;
    return { result: { a: A, b: B, facilityDeltaBminusA: delta, sameModel: (A.run as { modelSha256?: string } | undefined)?.modelSha256 === (B.run as { modelSha256?: string } | undefined)?.modelSha256 }, read };
  }

  /** the model as it would be with one BEM ruling changed — built as the app's Apply builds it, in memory; nothing written */
  async preview_ruling(a: { project: string; change: Change }): Promise<Reply> {
    const dir = this.projects.folder(a.project);
    if (!a.change) throw new Refusal("name the change: { section, key?, value }");
    const r = await preview(dir, a.change);
    return { result: r.result, read: r.read };
  }

  /** a year in EnergyPlus on the model with one ruling changed (or as it stands), beside the project's last run; written only into
   *  the scenario's own folder, cache/mcp/runs/<stamp>/ */
  async run_scenario(a: { project: string; change?: Change | null }, onLine?: (l: string) => void): Promise<Reply> {
    const dir = this.projects.folder(a.project);
    const r = await runScenario(dir, a.change ?? null, onLine);
    return { result: r.result, read: r.read };
  }

  /** the change left as a proposal in the project's inbox/ for the user to stage or reject in the app — nothing applied */
  async propose_ruling(a: { project: string; change: Change; reason: string; scenario?: string }): Promise<Reply> {
    const dir = this.projects.folder(a.project);
    const r = await propose(dir, a.change, a.reason, a.scenario);
    return { result: r.result, read: r.read };
  }

  /** the proposals in the inbox: waiting, staged by the user, rejected by the user */
  async proposals(a: { project: string }): Promise<Reply> {
    const dir = this.projects.folder(a.project);
    const inbox = path.join(dir, "inbox");
    return { result: listProposals(dir), read: fs.existsSync(inbox) ? [{ file: inbox, contentSha256: null, modified: fs.statSync(inbox).mtime.toISOString() }] : [] };
  }

  private async ledger(dir: string, kind: LedgerKind): Promise<{ json: unknown; sha: string | null; savedAt: string | null; read: ReadFrom[] }> {
    const p = await projectDb(dir);
    const sha = await openIfcSha(dir) ?? null;
    const read = [p.from];
    if (!sha) return { json: null, sha, savedAt: null, read };
    const r = rows(p.db, "SELECT json, saved_at FROM ledgers WHERE sha=? AND kind=?", [sha, kind])[0];
    return { json: r ? JSON.parse(String(r.json)) : null, sha, savedAt: r ? String(r.saved_at) : null, read };
  }
}

const plain = (html: string): string => html.replace(/<li>/g, "- ").replace(/<\/(p|li)>/g, "\n").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();

export function pickRun(runs: BemRun[], stamp?: string): BemRun {
  if (!runs.length) throw new Refusal("no run in bem.db yet — run the model in the app (RUN)");
  if (stamp) { const r = runs.find((x) => x.stamp === stamp); if (!r) throw new Refusal(`no run ${stamp} in bem.db — list_runs lists them`); return r; }
  return [...runs].reverse().find((r) => r.kind !== "calibration") ?? runs[runs.length - 1]!;
}

export function runSummary(r: BemRun): Record<string, unknown> {
  return { stamp: r.stamp, kind: r.kind ?? "design", weather: r.epw ? r.epw.split(/[\\/]/).pop() : null, engine: r.energyplusVersion, completed: r.completed, exitCode: r.exitCode,
    fatal: r.fatal, severe: r.severe, warning: r.warning, seconds: r.seconds, modelSha256: r.modelSha256 ?? null };
}

/** a run's results from bem.db: the facility, end uses by fuel, peaks, unmet hours per zone — and, in full, the monthly meters and the coils */
export function results(db: Database, stamp: string, full: boolean): Record<string, unknown> {
  const fac = queryResults(db, stamp, "facility", "heating");
  const f = (m: string): number | null => { const v = queryResults(db, stamp, "facility", m).get(""); return v === undefined ? null : v; };
  const facility = fac.size ? { heatingKwh: r1(f("heating") ?? 0), coolingKwh: r1(f("cooling") ?? 0), unmetHeatingH: f("unmet_heating"), unmetCoolingH: f("unmet_cooling"),
    peakHeatingW: f("peak_heating_w"), peakHeatingTime: timeOf(f("peak_heating_time")), peakCoolingW: f("peak_cooling_w"), peakCoolingTime: timeOf(f("peak_cooling_time")),
    conditionedAreaM2: f("conditioned_area"), totalAreaM2: f("total_area") } : null;
  const endUsesByFuel: Record<string, Record<string, number>> = {};
  for (const c of queryEndUses(db, stamp)) (endUsesByFuel[c.fuel] ??= {})[c.row] = r1(c.value);
  const { peaks, times } = queryFuelPeaks(db, stamp);
  const fuelPeaks = [...new Set(peaks.map((p) => p.fuel))].map((fuel) => ({ fuel, time: timeOf(times.get(fuel) ?? null), rowsW: Object.fromEntries(peaks.filter((p) => p.fuel === fuel).map((p) => [p.row, r1(p.w)])) }));
  const unmet = (m: string): Record<string, number> => Object.fromEntries([...(queryMonthlyByZone(db, stamp, m))].map(([z, v]) => [z, r1(v.reduce((s, x) => s + x, 0))]).filter(([, v]) => (v as number) > 0));
  const out: Record<string, unknown> = { facility, endUsesByFuel, endUseUnits: "kWh", fuelPeaks, unmetHoursByZone: { heating: unmet("Zone Heating Setpoint Not Met Time"), cooling: unmet("Zone Cooling Setpoint Not Met Time") } };
  if (full) {
    out.monthlyMetersKwh = Object.fromEntries([...queryMonthlyMeters(db, stamp)].map(([m, v]) => [m, v.map(kwh)]));
    out.coils = querySizingDetails(db, stamp).filter((s) => s.kind === "coil" && /Coil Final Gross Total Capacity|Coil Final Reference Air Volume Flow Rate|HVAC Name|Coil Type/.test(s.field))
      .reduce<Record<string, Record<string, unknown>>>((acc, s) => { (acc[s.subject] ??= {})[s.field] = s.value ?? s.text; return acc; }, {});
  }
  return out;
}

const timeOf = (n: number | null): string | null => (n === null || !Number.isFinite(n) ? null : decodeTime(n));
export { LEDGER_KINDS };
