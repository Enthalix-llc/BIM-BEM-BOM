// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// PROPOSE A RULING (release 4): the change left as a proposal file in the project's inbox/, in the program's own format
// (program/src/modules/bem/core/proposals.ts — the app reads it with the same module). Nothing is applied: the app shows the
// proposal, and the user stages it on its tab (the tab's own Apply writes it) or rejects it. The proposal carries the assistant's
// reason, what it was measured against (the open IFC's sha, idf.db's content sha), the preview, and a scenario run with the same
// change when one is named. The package writes the inbox/ file and nothing else of the project.
import fs from "node:fs";
import path from "node:path";
import { PROPOSAL_FORMAT, PROPOSAL_SECTIONS, PROPOSAL_TAB, readProposal, type Proposal, type ProposalSection } from "../../program/src/modules/bem/core/proposals.js";
import { Refusal, needDb, openIfcSha, type ReadFrom } from "./project.js";
import { preview, type Change } from "./preview.js";
import { SCENARIO_DIR } from "./scenario.js";

export const MAX_PENDING = 50;
const BY = "an assistant, through bim-bem-bom-mcp";

const stampNow = (): string => new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
const sameChange = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export async function propose(dir: string, change: Change, reason: string, scenarioStamp?: string): Promise<{ result: Record<string, unknown>; read: ReadFrom[]; file: string }> {
  if (!change || !PROPOSAL_SECTIONS.includes(change.section as ProposalSection))
    throw new Refusal(`"${String(change?.section)}" is not a section a tab stages in the app — a proposal is one of ${PROPOSAL_SECTIONS.join(", ")}`);
  if (typeof reason !== "string" || !reason.trim()) throw new Refusal("give the reason, in words — the user reads it before staging");
  if (reason.length > 4000) throw new Refusal("the reason is over 4,000 characters — say it shorter");
  const inbox = path.join(dir, "inbox");
  const pending = fs.existsSync(inbox) ? fs.readdirSync(inbox).filter((f) => f.endsWith(".json")).length : 0;
  if (pending >= MAX_PENDING) throw new Refusal(`the inbox already holds ${pending} proposals waiting for the user — no more until some are staged or rejected`);

  const pv = await preview(dir, change);
  const idf = await needDb(dir, "idf");
  const ifcSha = await openIfcSha(dir);
  const r = pv.result as { identical: boolean; noEffect?: string; objects: { added: number; removed: number; changed: number }; settingsChanged: Array<{ key: string; was: string | null; now: string | null }>; checksNew: string[]; notHonoured: string[] };

  let scenario: Proposal["scenario"];
  const read: ReadFrom[] = [...pv.read];
  if (scenarioStamp) {
    if (!/^\d{8}T\d{6}(-\d+)?$/.test(scenarioStamp)) throw new Refusal(`"${scenarioStamp}" is not a scenario's stamp`);
    const f = path.join(dir, SCENARIO_DIR, scenarioStamp, "summary.json");
    if (!fs.existsSync(f)) throw new Refusal(`no scenario ${scenarioStamp} in ${SCENARIO_DIR} — run_scenario names its stamp (the newest 5 are kept)`);
    const s = JSON.parse(fs.readFileSync(f, "utf8")) as { change: unknown; idfContentSha256: string | null } & NonNullable<Proposal["scenario"]>;
    if (!sameChange(s.change, change)) throw new Refusal(`scenario ${scenarioStamp} was run with another change — run_scenario with this one first`);
    if (s.idfContentSha256 && idf.from.contentSha256 && s.idfContentSha256 !== idf.from.contentSha256) throw new Refusal(`scenario ${scenarioStamp} was run on an earlier model — run it again`);
    read.push({ file: f, contentSha256: null, modified: fs.statSync(f).mtime.toISOString() });
    scenario = { stamp: scenarioStamp, completed: s.completed, fatal: s.fatal, severe: s.severe, heatingKwh: s.heatingKwh, coolingKwh: s.coolingKwh, lastRun: s.lastRun, heatingKwhLast: s.heatingKwhLast, coolingKwhLast: s.coolingKwhLast, against: s.against };
  }

  fs.mkdirSync(inbox, { recursive: true });
  let id = stampNow();
  for (let n = 2; fs.existsSync(path.join(inbox, `${id}.json`)); n++) id = `${id.replace(/-\d+$/, "")}-${n}`;
  const proposal: Proposal = {
    format: PROPOSAL_FORMAT, id, change: change as Proposal["change"], reason: reason.trim(),
    made: { at: new Date().toISOString(), by: BY, ifcSha256: ifcSha, idfContentSha256: idf.from.contentSha256 },
    preview: { identical: r.identical, noEffect: r.noEffect ?? null, objects: r.objects && { added: r.objects.added, removed: r.objects.removed, changed: r.objects.changed }, settingsChanged: r.settingsChanged, checksNew: r.checksNew, notHonoured: r.notHonoured },
    ...(scenario ? { scenario } : {}),
  };
  const text = JSON.stringify(proposal, null, 1);
  const check = readProposal(id, text);   // what the app will read — refused here before it is written, never found broken there
  if (!check.ok) throw new Refusal(`the proposal would not read in the app: ${check.problem}`);
  const file = path.join(inbox, `${id}.json`);
  fs.writeFileSync(file, text, { flag: "wx" });
  return {
    file,
    read,
    result: {
      proposal: id, file: path.relative(dir, file),
      stagedOn: PROPOSAL_TAB[change.section as ProposalSection],
      preview: proposal.preview, ...(scenario ? { scenario } : {}),
      ...(r.identical ? { caution: "this change has no effect on the model as it stands — the user will see that said" } : {}),
      note: "left in the project's inbox for the user. Nothing is applied: they stage it on its tab and Apply it there, or reject it. `proposals` reads what became of it.",
    },
  };
}

/** the proposals in the inbox: waiting, staged by the user, rejected by the user */
export function listProposals(dir: string): Record<string, unknown> {
  const inbox = path.join(dir, "inbox");
  const of = (sub: string): Array<Record<string, unknown>> => {
    const d = path.join(inbox, sub);
    if (!fs.existsSync(d)) return [];
    return fs.readdirSync(d).filter((f) => f.endsWith(".json")).sort().map((f) => {
      const p = readProposal(f.slice(0, -5), fs.readFileSync(path.join(d, f), "utf8"));
      return p.ok ? { id: p.proposal.id, at: p.proposal.made.at, change: p.proposal.change, reason: p.proposal.reason } : { id: p.id, problem: p.problem };
    });
  };
  const waiting = of(""), staged = of("staged"), rejected = of("rejected");
  return { waiting, staged, rejected, note: "staged = the user put it in the tab's stage (whether they then applied it, `rulings` shows); rejected = the user turned it down" };
}
