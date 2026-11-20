// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE PACKAGE'S GATE: pnpm gate <project folder>. It clones the project into a scratch projects folder (an APFS clone where the
// system offers one — instant, no extra space), then proves on the clone:
//   1. the package knows the schemas the program writes (the numbers read from the program's own source);
//   2. every tool answers, each read tool against an independent reading of the same file (raw SQL, the engine's own CSV);
//   3. every refusal holds — a path outside the folder, an unknown ledger kind or section, a run that does not exist, a newer schema;
//   4. THE PROJECT'S FILES ARE BYTE-IDENTICAL after every call (every file's sha256 before and after).
// The original project is only read, to clone it. Exit 1 on any ✗.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { Projects, Refusal, KNOWN_SCHEMA, sql } from "../src/project.js";
import { Tools, type Reply } from "../src/tools.js";
import { parseTabularCsv } from "../../program/src/modules/bem/core/eplusTables.js";
import { preview } from "../src/preview.js";
import { engines } from "../src/environment.js";

const src = process.argv[2];
if (!src || !fs.existsSync(path.join(src, "project.sqlite"))) { console.error("usage: pnpm gate <project folder holding project.sqlite>"); process.exit(2); }
let ok = true;
const say = (good: boolean, line: string): void => { if (!good) ok = false; console.log(`${good ? "✓" : "✗"} ${line}`); };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROGRAM = path.resolve(HERE, "..", "..", "program");

// 1 · the schemas, read from the program's source
const lit = (file: string, re: RegExp): number[] => [...fs.readFileSync(path.join(PROGRAM, file), "utf8").matchAll(re)].map((m) => Number(m[1]));
const dbLits = lit("src/core/db.ts", /schema_version: "(\d+)"/g);
const programs = { ifc: dbLits[0], idf: dbLits[1], bem: lit("src/modules/bem/core/bemDb.ts", /schema_version: "(\d+)"/g)[0], bom: lit("src/modules/bom/core/bomDb.ts", /schema_version: "(\d+)"/g)[0],
  project: lit("electron/projectStore.cjs", /SCHEMA_VERSION = (\d+)/g)[0], materials: lit("src/modules/bem/core/materialsDb.ts", /MATERIALS_SCHEMA = "(\d+)"/g)[0] };
const schemasAgree = (Object.keys(KNOWN_SCHEMA) as Array<keyof typeof KNOWN_SCHEMA>).every((k) => programs[k] === KNOWN_SCHEMA[k]);
say(schemasAgree, `SCHEMAS the package knows ${JSON.stringify(KNOWN_SCHEMA)} = the program writes ${JSON.stringify(programs)}`);

// the clone
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "bbb-mcp-gate-"));
const name = path.basename(path.resolve(src));
const dir = path.join(scratch, name);
const t0 = Date.now();
fs.cpSync(path.resolve(src), dir, { recursive: true, mode: fs.constants.COPYFILE_FICLONE });
console.log(`  cloned ${src} → ${dir} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

function hashTree(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out.set(path.relative(root, p), crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"));
    }
  };
  walk(root);
  return out;
}
const before = hashTree(dir);
console.log(`  ${before.size} files hashed before any call`);

const tools = new Tools(new Projects(scratch));
const SQL = await sql();
const raw = (file: string): import("sql.js").Database => new SQL.Database(new Uint8Array(fs.readFileSync(path.join(dir, "data", file))));
const count = (db: import("sql.js").Database, q: string): number => Number(db.exec(q)[0]?.values[0]?.[0] ?? 0);
const call = async (label: string, f: () => Promise<Reply>): Promise<Reply | null> => {
  try {
    const r = await f();
    say(Array.isArray(r.read) && r.read.every((x) => typeof x.file === "string" && "contentSha256" in x), `${label} answers and names what it read (${r.read.length} file${r.read.length === 1 ? "" : "s"})`);
    return r;
  } catch (e) { say(false, `${label} threw: ${(e as Error).message}`); return null; }
};
const refused = async (label: string, f: () => Promise<unknown>, want: RegExp): Promise<void> => {
  try { await f(); say(false, `REFUSAL ${label}: not refused`); }
  catch (e) { say(e instanceof Refusal && want.test((e as Error).message), `REFUSAL ${label}: "${(e as Error).message}"`); }
};

// 2 · every tool, against an independent reading
const lp = await call("list_projects", () => tools.list_projects());
say(!!lp && (lp.result as Array<{ name: string }>).some((p) => p.name === name), `list_projects lists "${name}"`);
const sum = await call("project_summary", () => tools.project_summary({ project: name }));
const fresh = (sum?.result as { freshness?: { lines: string[] } } | undefined)?.freshness?.lines ?? [];
console.log(fresh.map((l) => `    ${l}`).join("\n"));

const idf = raw("idf.db"), bem = raw("bem.db");
const cen = await call("census", () => tools.census({ project: name }));
const zs = (cen?.result as { zoneSurfaces: { count: number; netM2: number } } | undefined)?.zoneSurfaces;
const rawNet = Number(idf.exec("SELECT sum(area_m2) FROM surfaces")[0]?.values[0]?.[0] ?? 0);
say(!!zs && zs.count === count(idf, "SELECT count(*) FROM surfaces") && Math.abs(zs.netM2 - rawNet) < 0.1, `census: ${zs?.count} zone surfaces, net ${zs?.netM2} m² = idf.db's own ${count(idf, "SELECT count(*) FROM surfaces")} / ${rawNet.toFixed(1)}`);

const wq = await call("wall_qa", () => tools.wall_qa({ project: name }));
const wqr = wq?.result as { planes: number; shown: number } | undefined;
say(!!wqr && wqr.planes === count(idf, "SELECT count(*) FROM wall_qa") && wqr.shown === wqr.planes, `wall_qa: ${wqr?.planes} planes = idf.db wall_qa rows`);
const room = String(idf.exec("SELECT spaces FROM wall_qa WHERE spaces <> '' LIMIT 1")[0]?.values[0]?.[0] ?? "").split(/\s*\+\s*|,\s*/)[0] ?? "";
const wqf = await tools.wall_qa({ project: name, filter: room }).catch(() => null);
const want = count(idf, `SELECT count(*) FROM wall_qa WHERE spaces LIKE '%${room.replace(/'/g, "")}%'`);
say(!!wqf && room !== "" && (wqf.result as { shown: number }).shown >= want && (wqf.result as { shown: number }).shown < (wqr?.planes ?? 0), `wall_qa filter "${room}" narrows to ${(wqf?.result as { shown: number } | undefined)?.shown} of ${wqr?.planes} (the rooms column alone holds it on ${want})`);

const vq = await call("void_qa", () => tools.void_qa({ project: name }));
say(!!vq && (vq.result as { spaces: number }).spaces === count(idf, "SELECT count(*) FROM void_qa"), `void_qa: ${(vq?.result as { spaces: number } | undefined)?.spaces} spaces, ${(vq?.result as { ruled: number } | undefined)?.ruled} ruled = idf.db void_qa rows`);

const mc = await call("model_checks", () => tools.model_checks({ project: name }));
const c = (mc?.result as { checks: { ok: number; note: number; warn: number; fail: number } } | undefined)?.checks;
say(!!c && c.ok + c.note + c.warn + c.fail === count(bem, "SELECT count(*) FROM checks"), `model_checks: ok ${c?.ok} · note ${c?.note} · warn ${c?.warn} · fail ${c?.fail} = bem.db checks rows`);

const zo = await call("zones", () => tools.zones({ project: name }));
say(!!zo && (zo.result as { zones: number }).zones === count(bem, "SELECT count(*) FROM zones"), `zones: ${(zo?.result as { zones: number } | undefined)?.zones} (${(zo?.result as { conditioned: number } | undefined)?.conditioned} conditioned) = bem.db zones rows`);

const co = await call("constructions", () => tools.constructions({ project: name }));
const cons = (co?.result as { constructions: Array<{ surfaces: number }> } | undefined)?.constructions ?? [];
say(cons.length === count(bem, "SELECT count(*) FROM constructions") && cons.reduce((s, x) => s + x.surfaces, 0) === count(bem, "SELECT count(*) FROM surfaces WHERE construction IN (SELECT name FROM constructions)"),
  `constructions: ${cons.length} = bem.db constructions; their surfaces add up to bem.db's`);

const rr = await call("run_results", () => tools.run_results({ project: name }));
const rres = rr?.result as { run: { stamp: string }; facility: { heatingKwh: number; coolingKwh: number } | null; endUsesByFuel: Record<string, Record<string, number>> } | undefined;
if (rres?.facility) {
  const byRow = (row: string): number => Object.values(rres.endUsesByFuel).reduce((s, f) => s + (f[row] ?? 0), 0);
  say(Math.abs(byRow("Heating") - rres.facility.heatingKwh) < 0.5 && Math.abs(byRow("Cooling") - rres.facility.coolingKwh) < 0.5,
    `run_results ${rres.run.stamp}: heating ${rres.facility.heatingKwh} · cooling ${rres.facility.coolingKwh} kWh = Σ the End Uses row over every fuel`);
  // the engine's own tables, read by a different route (the CSV, not eplusout.sql)
  const runDir = String(bem.exec(`SELECT dir FROM runs WHERE stamp='${rres.run.stamp.replace(/'/g, "")}'`)[0]?.values[0]?.[0] ?? "");
  const csv = path.join(runDir, "eplustbl.csv");
  if (fs.existsSync(csv)) {
    const t = parseTabularCsv(fs.readFileSync(csv, "utf8")).find((x) => x.name === "End Uses");
    const toKwh = (h: string): number => (/\[kWh\]/.test(h) ? 1 : /\[kBtu\]/.test(h) ? 1 / 3.412142 : /\[GJ\]/.test(h) ? 277.7778 : NaN);
    const csvRow = (row: string): number => { const r = t?.rows.get(row); return r ? t!.header.reduce((s, h, i) => (i >= 2 && Number.isFinite(toKwh(h)) ? s + Number(r[i] ?? 0) * toKwh(h) : s), 0) : NaN; };
    const dh = csvRow("Heating"), dc = csvRow("Cooling");
    say(Math.abs(dh - rres.facility.heatingKwh) / rres.facility.heatingKwh < 0.002 && Math.abs(dc - rres.facility.coolingKwh) / rres.facility.coolingKwh < 0.002,
      `run_results vs the run's own eplustbl.csv (${t?.header[2] ?? "?"}): heating ${dh.toFixed(1)} · cooling ${dc.toFixed(1)} kWh (within 0.2 % — the CSV prints rounded IP units)`);
  } else console.log(`  · the run's eplustbl.csv is not on disk (${csv}) — the CSV comparison skipped`);
} else say(false, "run_results: no facility results");

const hasBom = fs.existsSync(path.join(dir, "data", "bom.db"));
if (hasBom) {
  const br = await call("bom_results", () => tools.bom_results({ project: name }));
  const bom = raw("bom.db");
  say(!!br && (br.result as { bills: number }).bills === count(bom, "SELECT count(*) FROM bills"), `bom_results: ${(br?.result as { bills: number } | undefined)?.bills} bills = bom.db bills rows`);
}
for (const kind of ["corrections", "bem", "bom"] as const) {
  const r = await call(`rulings ${kind}`, () => tools.rulings({ project: name, kind }));
  const secs = (r?.result as { sections?: Array<{ key: string }> } | undefined)?.sections;
  if (secs?.length) {
    const one = await tools.rulings({ project: name, kind, key: secs[0]!.key }).catch(() => null);
    say(!!one && (one.result as { key: string }).key === secs[0]!.key, `rulings ${kind}: ${secs.length} sections; "${secs[0]!.key}" read whole`);
  }
}
const ex = await call("explain", () => tools.explain({ topic: "wall QA" }));
say(((ex?.result as { entries: unknown[] } | undefined)?.entries.length ?? 0) > 0, `explain "wall QA": ${(ex?.result as { entries: unknown[] } | undefined)?.entries.length} entries from explain.md`);
const lr = await call("list_runs", () => tools.list_runs({ project: name }));
const lrr = lr?.result as { runs: number; rows: Array<{ stamp: string }> } | undefined;
say(!!lrr && lrr.runs >= count(bem, "SELECT count(*) FROM runs"), `list_runs: ${lrr?.runs} runs (bem.db ${count(bem, "SELECT count(*) FROM runs")})`);
if (lrr && lrr.rows.length >= 2) {
  const a = lrr.rows[lrr.rows.length - 2]!.stamp, b = lrr.rows[lrr.rows.length - 1]!.stamp;
  const cr = await call("compare_runs", () => tools.compare_runs({ project: name, a, b }));
  console.log(`    ${a} → ${b}: Δ ${JSON.stringify((cr?.result as { facilityDeltaBminusA: unknown } | undefined)?.facilityDeltaBminusA)}`);
  const same = await tools.compare_runs({ project: name, a: b, b }).catch(() => null);
  const d = (same?.result as { facilityDeltaBminusA: Record<string, number> | null } | undefined)?.facilityDeltaBminusA;
  say(!!d && Object.values(d).every((v) => v === 0), "compare_runs of a run with itself: every difference 0");
}

// PREVIEW (release 2): no change reproduces the model as it stands to the byte (the package builds as the app builds); a real change
// is seen, proven by the store as the app's Apply proves it, and the project untouched (part 4)
if (engines.findEngine()) {
  const t1 = Date.now();
  const none = await preview(dir, null);
  say(none.idfNow === none.idfAfter, `PREVIEW with no change: the IDF an Apply would write = the model as it stands, ${none.idfNow.split("\n").length} lines, byte for byte (${Date.now() - t1} ms)`);
  say(/the app's own idf-db check/.test(String(none.result.storeProof)), `PREVIEW store proof (no change): ${String(none.result.storeProof).slice(0, 60)}…`);
  const types = idf.exec("SELECT DISTINCT t.name FROM element_types t JOIN elements e ON e.type_id = t.id WHERE t.ifc_class LIKE '%WINDOW%' AND t.name IS NOT NULL ORDER BY t.name")[0]?.values.map((v) => String(v[0])) ?? [];
  const led = await tools.rulings({ project: name, kind: "bem", key: "constructions" });
  const ruled = (led.result as { value: Record<string, { source?: string; sameAs?: string }> }).value ?? {};
  const target = types.find((t) => !ruled[t]?.sameAs) ?? types[0];
  if (target) {
    const pr = await call(`preview_ruling (a window type "${target}" at U 1.234, SHGC 0.22)`, () => tools.preview_ruling({ project: name, change: { section: "constructions", key: target, value: { source: "u", uWm2k: 1.234, shgc: 0.22, vt: 0.44 } } }));
    const o = (pr?.result as { objects: { added: number; removed: number; changed: number }; settingsChanged: Array<{ key: string; now: string | null }>; storeProof: string; identical: boolean } | undefined);
    const set = o?.settingsChanged.find((x) => x.key === `construction:${target}`);
    say(!!o && !o.identical && /1\.234/.test(set?.now ?? ""), `PREVIEW sees the change: objects +${o?.objects.added} −${o?.objects.removed} ~${o?.objects.changed}, the type's setting now "${(set?.now ?? "").slice(0, 70)}"`);
    say(!!o && /the app's own idf-db check/.test(o.storeProof), "PREVIEW store proof (the change): the committed idf.db reproduces the live build to the byte");
  } else say(false, "PREVIEW: no window type in the file to change");
  // removing a zone ruling the app does not hold cannot move the model: the answer must say so in words, never an empty diff alone
  const zr = (await tools.rulings({ project: name, kind: "bem", key: "zones" })).result as { value: Record<string, unknown> };
  const zone = (idf.exec("SELECT name FROM zones ORDER BY name")[0]?.values ?? []).map((v) => String(v[0])).find((z) => !(z in (zr.value ?? {}))) ?? "";
  const nz = await tools.preview_ruling({ project: name, change: { section: "zones", key: zone, value: null } });
  const nzr = nz.result as { noEffect?: string; identical?: boolean };
  say(nzr.identical === true && !!nzr.noEffect, `PREVIEW removing "${zone}"'s zone ruling (none held) → identical, and said: "${(nzr.noEffect ?? "").slice(0, 60)}…"`);
} else console.log("  · PREVIEW skipped — no EnergyPlus installed (the engine's datasets are what a ruling resolves against)");

// 3 · the refusals
await refused("a path outside the projects folder", () => tools.census({ project: "../.." }), /outside the projects folder|no project/);
await refused("an absolute path elsewhere", () => tools.census({ project: os.homedir() }), /outside the projects folder|no project/);
await refused("a folder that is not a project", () => tools.census({ project: "data" }), /no project|not a project|outside/);
await refused("an unknown ledger kind", () => tools.rulings({ project: name, kind: "secrets" as never }), /no ledger kind/);
await refused("an unknown ledger section", () => tools.rulings({ project: name, kind: "bem", key: "no-such-section" }), /has no section/);
await refused("a preview of the weather (a file, not in this release)", () => tools.preview_ruling({ project: name, change: { section: "weather" as never, value: { epw: "x.epw" } } }), /not a BEM ruling a preview may change/);
await refused("a preview of a zone the model lacks", () => tools.preview_ruling({ project: name, change: { section: "zones", key: "No Such Zone", value: { conditioned: true } } }), /no zone "No Such Zone"/);
await refused("a preview of a type the file lacks", () => tools.preview_ruling({ project: name, change: { section: "constructions", key: "No:Such Type", value: { source: "code" } } }), /no IFC type/);
await refused("a preview with no value", () => tools.preview_ruling({ project: name, change: { section: "site", value: undefined } }), /needs a value/);
await refused("a run that does not exist", () => tools.run_results({ project: name, run: "19000101T000000" }), /no run/);
// a newer schema: a second scratch project whose idf.db claims a schema past the package's
{
  const other = path.join(scratch, "newer-schema");
  fs.mkdirSync(path.join(other, "data"), { recursive: true });
  fs.copyFileSync(path.join(dir, "project.sqlite"), path.join(other, "project.sqlite"));
  const db = new SQL.Database();
  db.run("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
  db.run("INSERT INTO meta VALUES ('schema_version', ?)", [String(KNOWN_SCHEMA.idf + 1)]);
  fs.writeFileSync(path.join(other, "data", "idf.db"), db.export());
  fs.copyFileSync(path.join(dir, "data", "ifc.db"), path.join(other, "data", "ifc.db"));
  await refused("a file of a newer schema", () => tools.census({ project: "newer-schema" }), /newer than this package knows/);
}

// the server itself, over stdio, as an assistant's client starts it
{
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const tsx = path.resolve(HERE, "..", "node_modules", ".bin", "tsx");
  const client = new Client({ name: "gate", version: "0" });
  await client.connect(new StdioClientTransport({ command: tsx, args: [path.resolve(HERE, "..", "src", "server.ts"), scratch], stderr: "pipe" }));
  const listed = (await client.listTools()).tools;
  const names = listed.map((t) => t.name).sort();
  const want = ["bom_results", "census", "compare_runs", "constructions", "explain", "list_projects", "list_runs", "model_checks", "preview_ruling", "project_summary", "rulings", "run_results", "void_qa", "wall_qa", "zones"];
  say(JSON.stringify(names) === JSON.stringify(want) && listed.every((t) => t.annotations?.readOnlyHint === true), `SERVER over stdio: ${names.length} tools listed, every one marked read-only`);
  const r = await client.callTool({ name: "run_results", arguments: { project: name } }) as { content: Array<{ text: string }>; isError?: boolean };
  const heat = (JSON.parse(r.content[0]!.text) as { result: { facility: { heatingKwh: number } } }).result.facility.heatingKwh;
  say(!r.isError && heat === rres?.facility?.heatingKwh, `SERVER run_results over stdio: heating ${heat} kWh, the same as the direct call`);
  const bad = await client.callTool({ name: "census", arguments: { project: "../.." } }) as { content: Array<{ text: string }>; isError?: boolean };
  say(bad.isError === true && /^refused: /.test(bad.content[0]!.text), `SERVER refusal over stdio: "${bad.content[0]!.text.slice(0, 60)}…"`);
  await client.close();
}

// 4 · nothing written
const after = hashTree(dir);
const changed = [...before].filter(([f, h]) => after.get(f) !== h).map(([f]) => f);
const added = [...after.keys()].filter((f) => !before.has(f));
say(changed.length === 0 && added.length === 0 && after.size === before.size, `THE PROJECT'S FILES BYTE-IDENTICAL after every call: ${before.size} files, changed ${changed.length}, added ${added.length}${changed.length ? ` (${changed.slice(0, 5).join(", ")})` : ""}`);

fs.rmSync(scratch, { recursive: true, force: true });
console.log(ok ? "gate:mcp ✓" : "gate:mcp ✗");
process.exit(ok ? 0 : 1);
