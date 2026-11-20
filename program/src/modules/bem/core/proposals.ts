// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// A PROPOSAL (2026-11-20): a ruling an assistant suggests, left as a plain JSON file in the project's inbox/ — never written into the
// rulings. The app reads it with this code (deterministic, no AI), shows it with its reason and what it was measured against, and
// the user STAGES it on the tab it belongs to (as if they had made the change themselves; the tab's own Apply writes it) or REJECTS
// it (the file moves to inbox/rejected/, so the assistant can read that it was turned down). The format is defined here once: the
// separate MCP package writes it with this module, the app reads it with this module.

/** the BEM ruling sections a tab stages in the app; a proposal names one of these */
export const PROPOSAL_SECTIONS = ["site", "constructions", "ground", "schedules", "holidays", "gains"] as const;
export type ProposalSection = (typeof PROPOSAL_SECTIONS)[number];
export const PROPOSAL_FORMAT = "bim-bem-bom proposal 1";

/** the tab where each section is staged and applied */
export const PROPOSAL_TAB: Record<ProposalSection, "bem-site" | "bem-constructions" | "bem-schedules" | "bem-zones"> = {
  site: "bem-site", constructions: "bem-constructions", ground: "bem-constructions", schedules: "bem-schedules", holidays: "bem-schedules", gains: "bem-zones",
};

export interface Proposal {
  format: typeof PROPOSAL_FORMAT;
  /** the file's own name, without .json — a stamp */
  id: string;
  /** the change, in the ledger's own words: a section, a key in it (none = the whole section), the value (null removes the key) */
  change: { section: ProposalSection; key?: string; value: unknown };
  /** the assistant's reason, in words */
  reason: string;
  /** who made it and when, and what it was measured against: the open IFC's sha (whose rulings it changes) and idf.db's content sha */
  made: { at: string; by: string; ifcSha256: string | null; idfContentSha256: string | null };
  /** the preview: what the change does to the model, as the package measured it */
  preview?: { identical: boolean; noEffect?: string | null; objects?: { added: number; removed: number; changed: number }; settingsChanged?: Array<{ key: string; was: string | null; now: string | null }>; checksNew?: string[]; notHonoured?: string[] };
  /** a scenario run with this change, when one was: its year beside the project's last run */
  scenario?: { stamp: string; completed: boolean; fatal: number; severe: number; heatingKwh: number | null; coolingKwh: number | null; lastRun: string | null; heatingKwhLast: number | null; coolingKwhLast: number | null; against: string };
}

export type ProposalRead = { ok: true; proposal: Proposal } | { ok: false; id: string; problem: string };

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/** a proposal file read and checked; anything it cannot be is said, never guessed */
export function readProposal(id: string, text: string): ProposalRead {
  let j: unknown;
  try { j = JSON.parse(text); } catch (e) { return { ok: false, id, problem: `not JSON: ${e instanceof Error ? e.message : String(e)}` }; }
  if (!isObj(j)) return { ok: false, id, problem: "not an object" };
  if (j.format !== PROPOSAL_FORMAT) return { ok: false, id, problem: `format "${String(j.format)}" — this program reads "${PROPOSAL_FORMAT}"` };
  const c = j.change;
  if (!isObj(c)) return { ok: false, id, problem: "no change" };
  if (!PROPOSAL_SECTIONS.includes(c.section as ProposalSection)) return { ok: false, id, problem: `section "${String(c.section)}" is not one a tab stages (${PROPOSAL_SECTIONS.join(", ")})` };
  if (c.key !== undefined && typeof c.key !== "string") return { ok: false, id, problem: "the key is not text" };
  if (!("value" in c)) return { ok: false, id, problem: "the change has no value (null removes the key)" };
  if (typeof j.reason !== "string" || !j.reason.trim()) return { ok: false, id, problem: "no reason given" };
  const m = j.made;
  if (!isObj(m) || typeof m.at !== "string") return { ok: false, id, problem: "no record of when it was made" };
  return { ok: true, proposal: { ...(j as unknown as Proposal), id } };
}

/** the stage of one section with the change made: a key set (or removed by null), or the whole section replaced */
export function stagedWith<T>(current: T, change: Proposal["change"]): T {
  if (change.key === undefined) {
    if (change.value !== null) return change.value as T;
    return (change.section === "holidays" || change.section === "ground" || change.section === "site" ? null : {}) as T;
  }
  const next = { ...((current ?? {}) as Record<string, unknown>) };
  if (change.value === null) delete next[change.key]; else next[change.key] = change.value;
  return next as T;
}

/** the change in a line of words */
export function describeChange(c: Proposal["change"]): string {
  const v = c.value === null ? "removed (back to the default)" : JSON.stringify(c.value);
  return `${c.section}${c.key !== undefined ? ` › ${c.key}` : ""}: ${v.length > 160 ? `${v.slice(0, 157)}…` : v}`;
}
