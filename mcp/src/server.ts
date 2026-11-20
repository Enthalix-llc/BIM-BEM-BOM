// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE MCP SERVER (stdio): an assistant's client starts it as a local process with the projects folder as its one argument —
//   tsx src/server.ts ~/Documents/Enthalix/Projects
// No network port. Every tool reads, but run_scenario (its own run folder, cache/mcp/runs) and propose_ruling (a file in inbox/); the tools are fixed, take named arguments checked here, and
// run no code, shell command or SQL they are handed. The app itself ships none of this (the user's ruling, 2026-11-17).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Projects, Refusal } from "./project.js";
import { Tools, LEDGER_KINDS, type Reply } from "./tools.js";
import { PREVIEW_SECTIONS } from "./preview.js";
import { PROPOSAL_SECTIONS } from "../../program/src/modules/bem/core/proposals.js";

const root = process.argv[2];
if (!root) { process.stderr.write("usage: bim-bem-bom-mcp <projects folder>\n"); process.exit(2); }
const tools = new Tools(new Projects(root));
const server = new McpServer({ name: "bim-bem-bom", version: "0.4.0" });

const project = z.string().describe("the project's folder name, as list_projects gives it");
const ro = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

async function answer(f: () => Promise<Reply>): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const r = await f();
    return { content: [{ type: "text", text: JSON.stringify({ result: r.result, read: r.read }, null, 1) }] };
  } catch (e) {
    const refused = e instanceof Refusal;
    return { content: [{ type: "text", text: `${refused ? "refused" : "error"}: ${(e as Error).message}` }], isError: true };
  }
}

server.registerTool("list_projects", { description: "The projects in the projects folder: each one's folder, IFC files, which derived files the app has built, when last written.", inputSchema: {}, annotations: ro },
  () => answer(() => tools.list_projects()));
server.registerTool("project_summary", { description: "A project's IFC versions and lineage, its data sources, the freshness chain (ifc.db → idf.db → bem.db → bom.db), and its last run — and whether the model has changed since that run.", inputSchema: { project }, annotations: ro },
  (a) => answer(() => tools.project_summary(a)));
server.registerTool("census", { description: "What the model holds: IFC elements by class, rooms, zones (rooms and voids), zone surfaces by category with net and gross area, and what was not emitted to EnergyPlus and why.", inputSchema: { project }, annotations: ro },
  (a) => answer(() => tools.census(a)));
server.registerTool("wall_qa", { description: "The wall QA: one row per exposed exterior wall plane — its rooms, direction, lost length, and the four boundary verdicts with what each should meet. `filter` keeps rows whose element, name, rooms or direction contain it.", inputSchema: { project, filter: z.string().optional() }, annotations: ro },
  (a) => answer(() => tools.wall_qa(a)));
server.registerTool("void_qa", { description: "Each attic or floor cavity the program built, what closes it above and below, its flags, and the user's ruling on where the insulation sits, if any.", inputSchema: { project }, annotations: ro },
  (a) => answer(() => tools.void_qa(a)));
server.registerTool("model_checks", { description: "The model's checks (ok, note, warning, failure, each with its fix in words), what the user must clear in the app before a run (clearBeforeRun — run_scenario refuses while any stands) and the system QA (each loop, air loop and zone against the eight rules).", inputSchema: { project }, annotations: ro },
  (a) => answer(() => tools.model_checks(a)));
server.registerTool("zones", { description: "Each thermal zone as written: its rooms, conditioned or not, thermostat setpoints (°C), infiltration, and each room's people, lights and equipment.", inputSchema: { project }, annotations: ro },
  (a) => answer(() => tools.zones(a)));
server.registerTool("constructions", { description: "Each construction written to the IDF with its layers, U (with films) and where it is used, and the user's rulings per IFC type.", inputSchema: { project }, annotations: ro },
  (a) => answer(() => tools.constructions(a)));
server.registerTool("run_results", { description: "A run's results from bem.db (the latest design run unless `run` names a stamp): heating and cooling, end uses by fuel (kWh), peaks, unmet hours per zone, monthly meters, the coils' sizing.", inputSchema: { project, run: z.string().optional().describe("a run stamp, e.g. 20261120T153550") }, annotations: ro },
  (a) => answer(() => tools.run_results(a)));
server.registerTool("bom_results", { description: "The utility bills against the model's run, and the ASHRAE Guideline 14 figures with the verdict and its caveats.", inputSchema: { project }, annotations: ro },
  (a) => answer(() => tools.bom_results(a)));
server.registerTool("rulings", { description: "The user's rulings the app holds for the open IFC, by ledger: corrections (geometry, zones, voids, shading), bem (constructions, schedules, systems, site…) or bom (bills, tariff). With no key, the sections and their sizes; with a key, that section whole.", inputSchema: { project, kind: z.enum(LEDGER_KINDS), key: z.string().optional() }, annotations: ro },
  (a) => answer(() => tools.rulings(a)));
server.registerTool("explain", { description: "The program's own help texts: what a field, check, tab or method means.", inputSchema: { topic: z.string() }, annotations: ro },
  (a) => answer(() => tools.explain(a)));
server.registerTool("list_runs", { description: "Every run of the project: those bem.db holds, and the run records kept in record/.", inputSchema: { project }, annotations: ro },
  (a) => answer(() => tools.list_runs(a)));
server.registerTool("compare_runs", { description: "Two runs side by side: the model each was run on, the weather and engine, and the results, with the facility's differences (b − a).", inputSchema: { project, a: z.string(), b: z.string() }, annotations: ro },
  (a) => answer(() => tools.compare_runs(a)));

server.registerTool("preview_ruling", {
  description: "The model as it would be with one BEM ruling changed, built the way the app's Apply builds it — in memory, nothing written: the IDF objects added, removed and changed, the settings changed, new checks and rulings not honoured. A change is a ruling in the ledger's own words: a section, an optional key in it, and the value (null removes it). Read the current value with `rulings` first. Only you apply a ruling, in the app.",
  inputSchema: { project, change: z.object({ section: z.enum(PREVIEW_SECTIONS), key: z.string().optional(), value: z.unknown() }) },
  annotations: ro,
}, (a) => answer(() => tools.preview_ruling(a as { project: string; change: { section: (typeof PREVIEW_SECTIONS)[number]; key?: string; value: unknown } })));

server.registerTool("run_scenario", {
  description: "Refused while the model has checks only the user can clear (model_checks lists them as clearBeforeRun: a zone side switched off, a PV array not written, a zone no system serves not yet answered). Otherwise a year in EnergyPlus on the model as it would be with one BEM ruling changed (the same change as preview_ruling), or with no change on the model as it stands — run the way the app's RUN runs it, and returned beside the project's last run: end uses by fuel, peaks, unmet hours, and the differences. Takes about as long as a run in the app (a minute or more); progress is sent as the engine works. Writes only the scenario's own folder, cache/mcp/runs/<stamp>/ (the newest 5 kept) — never the model, the rulings or the app's runs. Only you apply a ruling, in the app.",
  inputSchema: { project, change: z.object({ section: z.enum(PREVIEW_SECTIONS), key: z.string().optional(), value: z.unknown() }).optional() },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}, (a, extra) => {
  const token = extra._meta?.progressToken;
  let n = 0;
  const onLine = (l: string): void => {
    if (token === undefined) return;
    void extra.sendNotification({ method: "notifications/progress", params: { progressToken: token, progress: ++n, message: l.slice(0, 200) } }).catch(() => {});
  };
  return answer(() => tools.run_scenario(a as { project: string; change?: { section: (typeof PREVIEW_SECTIONS)[number]; key?: string; value: unknown } }, onLine));
});

server.registerTool("propose_ruling", {
  description: "Leave one BEM ruling as a PROPOSAL in the project's inbox/ for the user — nothing is applied. The app shows it with your reason, the preview and (when `scenario` names a run_scenario stamp made with the same change) that year beside the last run; the user stages it on its tab and applies it there, or rejects it. Sections a tab stages: site, constructions, ground, schedules, holidays, gains. Preview it first; say plainly why.",
  inputSchema: { project, change: z.object({ section: z.enum(PROPOSAL_SECTIONS), key: z.string().optional(), value: z.unknown() }), reason: z.string().describe("why, in words the user reads before staging it"), scenario: z.string().optional().describe("the stamp of a run_scenario made with this same change") },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}, (a) => answer(() => tools.propose_ruling(a as { project: string; change: { section: (typeof PROPOSAL_SECTIONS)[number]; key?: string; value: unknown }; reason: string; scenario?: string })));

server.registerTool("proposals", {
  description: "The proposals in the project's inbox: waiting for the user, staged by the user, and rejected by the user.",
  inputSchema: { project },
  annotations: ro,
}, (a) => answer(() => tools.proposals(a)));

await server.connect(new StdioServerTransport());
