// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// bom.db — THE OPERATIONS MODEL'S FILE. What the house is metered at (the
// bills, read from their CSV), what weather the comparison ran under, and
// the one statistic. Bills are READ facts, so bom.db is rebuilt from the
// raw imports (copied under data/bom/imports/, listed in the ledger with the
// user's column map) — the same "rebuild from scratch, replay the ledger"
// discipline as idf.db. Two hashes: `inputs_sha256` over what flows UP to
// BEM (nothing yet: schedules, tariff, PV come with M4) and `content_sha256`
// over everything a reader sees.

import type { Database, SqlJsStatic } from "sql.js";
import type { BillRow } from "./csvRead.js";
import type { PeriodResult, G14, Verdict } from "./calibration.js";
import { sha256Hex } from "../../../core/sha256.js";
import { lineFigures, statementTotal, statementDays, type StatementsLedger } from "./statement.js";

export interface BomLedger {
  sourceIfcSha256: string;
  savedAt: string;
  imports: Array<{ sha256: string; name: string; kind: "bills"; columnMap: Record<string, string | undefined>; rows: number }>;
  /** bill periods the user excluded, by account + start */
  excluded: string[];
  meterMap: Record<string, string[]>;
  /** THE TARIFF APPLIED (2026-10-03): a card of references/tariffs/*.json by id, the PCA as typed from a bill ($/kWh — one value or
   *  per month), and the month the 12-month net metering period opens (1–12; the interconnection's first meter reading) */
  tariff?: { card: string; pca?: { all?: number; byMonth?: Record<string, number> }; nemStartMonth?: number; appliedAt: string };
  /** THE BILLS AS PRINTED (2026-10-09): the formats and every statement typed by hand (core/statement.ts) */
  statements?: StatementsLedger;
  /** THE CALIBRATION RUN (2026-10-09): the day the PV was connected, and the panels' measured production as imported (data/bom/imports/) */
  calibration?: { pvOn?: string; pv?: { sha256: string; name: string } };
  /** A ROOM'S CFD SETUP (2026-11-10, moved from the window's storage): per room the terminals' names, roles, flows, sizes and places,
   *  the terminals added, the doors, the setpoints, the supply air, the mesh and iterations — the user's design work, backed up with
   *  the other rulings. What each RUN used is recorded in cfd.db beside its result. (The shape is cfd/core/cfdChoices' CfdChoices.) */
  cfd?: { rooms: Record<string, unknown> };
}

const DDL = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS imports (sha256 TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, rows INTEGER NOT NULL, column_map TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bills (
  account TEXT NOT NULL, fuel TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL, days INTEGER NOT NULL,
  measured REAL NOT NULL, unit TEXT NOT NULL, cost_usd REAL, demand_kw REAL, import_sha256 TEXT NOT NULL, source TEXT NOT NULL,
  excluded INTEGER NOT NULL DEFAULT 0, modelled REAL, covered INTEGER, received_kwh REAL,
  PRIMARY KEY (account, period_start)
);
CREATE TABLE IF NOT EXISTS statements (
  id TEXT PRIMARY KEY, format TEXT NOT NULL, meter TEXT NOT NULL, service TEXT NOT NULL, period_from TEXT NOT NULL, period_to TEXT NOT NULL,
  days INTEGER, billing_date TEXT, consumption_kwh REAL, generation_kwh REAL, net_kwh REAL, net_kw REAL,
  bank_before REAL, bank_used REAL, bank_after REAL, total_usd REAL NOT NULL, open_lines INTEGER NOT NULL, stated_usd REAL
);
CREATE TABLE IF NOT EXISTS statement_charges (
  statement TEXT NOT NULL, seq INTEGER NOT NULL, grp TEXT NOT NULL, label TEXT NOT NULL, basis TEXT NOT NULL,
  qty REAL, unit TEXT, rate REAL, amount REAL, carried INTEGER NOT NULL, estimated INTEGER NOT NULL, PRIMARY KEY (statement, seq)
);
CREATE TABLE IF NOT EXISTS meter_map (fuel TEXT PRIMARY KEY, meters TEXT NOT NULL, source TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS run_request (begin TEXT, end TEXT, epw_name TEXT, epw_sha256 TEXT, epw_kind TEXT, source TEXT);
CREATE TABLE IF NOT EXISTS calibration (
  run_stamp TEXT NOT NULL, fuel TEXT NOT NULL, basis TEXT NOT NULL, n INTEGER NOT NULL, p INTEGER NOT NULL,
  mean_measured REAL, cvrmse_pct REAL, nmbe_pct REAL, limit_cvrmse REAL NOT NULL, limit_nmbe REAL NOT NULL,
  verdict TEXT NOT NULL, caveats TEXT NOT NULL, PRIMARY KEY (run_stamp, fuel)
);
`;

function putMeta(db: Database, key: string, value: string): void {
  db.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", [key, value]);
}

export function buildBomDb(
  SQL: SqlJsStatic,
  meta: { sourceIfcSha256: string; sourceIdfSha256: string; sourceBemSha256: string; sourceName: string },
): Database {
  const db = new SQL.Database();
  db.run(DDL);
  for (const [k, v] of Object.entries({
    schema_version: "1",
    source_name: meta.sourceName,
    source_ifc_sha256: meta.sourceIfcSha256,
    source_idf_sha256: meta.sourceIdfSha256,
    source_bem_sha256: meta.sourceBemSha256,
    created_at: new Date().toISOString(),
  })) putMeta(db, k, v);
  return db;
}

export function writeImport(db: Database, imp: { sha256: string; kind: string; name: string; rows: number; columnMap: unknown }): void {
  db.run("INSERT OR REPLACE INTO imports VALUES (?, ?, ?, ?, ?)", [imp.sha256, imp.kind, imp.name, imp.rows, JSON.stringify(imp.columnMap)]);
}

export function writeBills(db: Database, bills: BillRow[], importSha256: string, excluded: Set<string>, periods: PeriodResult[] | null): void {
  const modelled = new Map(periods?.map((p) => [`${p.bill.account}|${p.bill.periodStart}`, p]) ?? []);
  const put = db.prepare("INSERT OR REPLACE INTO bills VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  db.run("BEGIN");
  for (const b of bills) {
    const key = `${b.account}|${b.periodStart}`;
    const pr = modelled.get(key);
    put.run([b.account, b.fuel, b.periodStart, b.periodEnd, b.days, b.measured, b.unit, b.costUsd, b.demandKw, importSha256, "file",
      excluded.has(key) ? 1 : 0, pr ? pr.modelledKwh : null, pr ? (pr.covered ? 1 : 0) : null, b.receivedKwh ?? null]);
  }
  db.run("COMMIT");
  put.free();
}

export function writeStatements(db: Database, led: StatementsLedger | undefined): void {
  if (!led) return;
  const st = db.prepare("INSERT OR REPLACE INTO statements VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const ch = db.prepare("INSERT OR REPLACE INTO statement_charges VALUES (?,?,?,?,?,?,?,?,?,?,?)");
  db.run("BEGIN");
  for (const s of led.bills) {
    const t = statementTotal(s), groupLabel = new Map(s.groups.map((g) => [g.id, g.label]));
    st.run([s.id, s.format, s.meter, s.service, s.from, s.to, statementDays(s), s.billingDate || null, s.usage.consumption.kwh, s.usage.generation.kwh,
      s.usage.net.kwh, s.usage.net.kw, s.bank.before, s.bank.used, s.bank.after, t.total, t.open, s.stated]);
    s.lines.forEach((l, k) => {
      const f = lineFigures(l, s);
      ch.run([s.id, k, groupLabel.get(l.group) ?? l.group, l.label, l.basis, f.qty, f.unit || null, l.rate, f.amount, l.carried ? 1 : 0, l.estimated ? 1 : 0]);
    });
  }
  db.run("COMMIT");
  st.free(); ch.free();
}

export function writeMeterMap(db: Database, map: Record<string, string[]>, source: string): void {
  db.run("DELETE FROM meter_map");
  for (const [fuel, meters] of Object.entries(map)) db.run("INSERT INTO meter_map VALUES (?, ?, ?)", [fuel, JSON.stringify(meters), source]);
}

export function writeRunRequest(db: Database, r: { begin: string; end: string; epwName: string; epwSha256: string; epwKind: string; source: string }): void {
  db.run("DELETE FROM run_request");
  db.run("INSERT INTO run_request VALUES (?, ?, ?, ?, ?, ?)", [r.begin, r.end, r.epwName, r.epwSha256, r.epwKind, r.source]);
}

export function writeCalibration(db: Database, runStamp: string, fuel: string, g: G14, v: Verdict): void {
  db.run("INSERT OR REPLACE INTO calibration VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", [
    runStamp, fuel, v.basis, g.n, g.p, g.meanMeasured, Number.isFinite(g.cvrmsePct) ? g.cvrmsePct : null, Number.isFinite(g.nmbePct) ? g.nmbePct : null,
    v.limitCvrmse, v.limitNmbe, v.verdict, JSON.stringify([...v.caveats, ...v.notes]),
  ]);
}

export interface BillOut extends BillRow { excluded: boolean; modelledKwh: number | null; covered: boolean | null; importSha256: string }
export function queryBills(db: Database): BillOut[] {
  const out: BillOut[] = [];
  const st = db.prepare("SELECT account, fuel, period_start, period_end, days, measured, unit, cost_usd, demand_kw, import_sha256, excluded, modelled, covered, received_kwh FROM bills ORDER BY period_start");
  while (st.step()) {
    const r = st.get() as [string, string, string, string, number, number, string, number | null, number | null, string, number, number | null, number | null, number | null];
    out.push({ account: r[0], fuel: r[1], periodStart: r[2], periodEnd: r[3], days: r[4], measured: r[5], unit: r[6], costUsd: r[7], demandKw: r[8],
      importSha256: r[9], excluded: r[10] === 1, modelledKwh: r[11], covered: r[12] === null ? null : r[12] === 1, receivedKwh: r[13], line: 0 });
  }
  st.free();
  return out;
}
export interface CalibrationOut { runStamp: string; fuel: string; basis: string; n: number; p: number; meanMeasured: number | null; cvrmsePct: number | null; nmbePct: number | null; limitCvrmse: number; limitNmbe: number; verdict: string; caveats: string[] }
export function queryCalibration(db: Database): CalibrationOut[] {
  const out: CalibrationOut[] = [];
  const st = db.prepare("SELECT run_stamp, fuel, basis, n, p, mean_measured, cvrmse_pct, nmbe_pct, limit_cvrmse, limit_nmbe, verdict, caveats FROM calibration");
  while (st.step()) {
    const r = st.get() as [string, string, string, number, number, number | null, number | null, number | null, number, number, string, string];
    out.push({ runStamp: r[0], fuel: r[1], basis: r[2], n: r[3], p: r[4], meanMeasured: r[5], cvrmsePct: r[6], nmbePct: r[7], limitCvrmse: r[8], limitNmbe: r[9], verdict: r[10], caveats: JSON.parse(r[11]) as string[] });
  }
  st.free();
  return out;
}

/** the two hashes: the inputs that flow up to BEM, and everything */
export function stampBomShas(db: Database): { inputs: string; content: string } {
  const lines = (sql: string): string[] => {
    const r = db.exec(sql);
    return r.length ? r[0]!.values.map((row) => row.map((v) => (v === null ? "" : String(v))).join("|")) : [];
  };
  const inputs = [
    ...lines("SELECT fuel, meters FROM meter_map ORDER BY fuel"),
    ...lines("SELECT begin, end, epw_name, epw_sha256, epw_kind FROM run_request"),
  ].join("\n");
  const content = [inputs,
    ...lines("SELECT account, fuel, period_start, period_end, measured, unit, cost_usd, excluded, modelled, covered FROM bills ORDER BY account, period_start"),
    // a net meter's received kWh (hand-entered bills, 2026-10-08) — only where stated, so a file without them hashes as before
    ...lines("SELECT account, period_start, received_kwh, demand_kw FROM bills WHERE received_kwh IS NOT NULL ORDER BY account, period_start"),
    ...lines("SELECT run_stamp, fuel, n, cvrmse_pct, nmbe_pct, verdict FROM calibration ORDER BY run_stamp, fuel"),
    ...lines("SELECT * FROM statements ORDER BY period_from, id"),
    ...lines("SELECT * FROM statement_charges ORDER BY statement, seq"),
  ].join("\n");
  const i = sha256Hex(inputs), c = sha256Hex(content);
  putMeta(db, "inputs_sha256", i);
  putMeta(db, "content_sha256", c);
  return { inputs: i, content: c };
}
