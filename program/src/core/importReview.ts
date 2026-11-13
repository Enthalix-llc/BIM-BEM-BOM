// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
/**
 * THE IFC IMPORT REVIEW (2026-11-13; the user's rulings of 2026-11-05 and 2026-11-07). Every new version of a project's IFC is
 * compared with the version before it (core/ifcChanges.ts), and every difference is put to the user ONCE: accept (the file's
 * value is the new reference) · ignore (the IFC is not to be edited from here for this item) · revise (the IFC is to be changed
 * back — offered once BIMedit reads the request; slice 3). The word is kept per project, by subject and field, with the file's
 * value it was given on: the same value on a later import is not asked again; a NEW value is (decision 1, 2026-11-07). The rows
 * group by the IFC class (decision 2), and "accept all" is offered only for rows no ruling of the user's rides on. Nothing here
 * changes the model: idf.db is rebuilt from the file and the user's ledgers as before; a ruling the file changed under is kept or
 * dropped by the same choice ("ignore" keeps it, "accept" takes the file's word).
 */
import type { Change, FileDiff, RulingCase } from "./ifcChanges.js";

export type ImportChoice = "accept" | "ignore" | "revise";
export const IMPORT_CHOICE_LABEL: Record<ImportChoice, string> = { accept: "accept the file's", ignore: "ignore", revise: "revise the IFC" };

/** one stored word (projects.sqlite import_rulings) */
export interface ImportRuling {
  subjectKind: "element" | "type" | "space";
  /** an element's or a room's GlobalId (or #id when the file states none), a type's name */
  subjectKey: string;
  field: string;
  /** the file's value the word was given on — a hash for geometry */
  fileValue: string;
  choice: ImportChoice;
  scope?: string | null;
  requestId?: string | null;
  versionSha: string;
  at: string;
}

export interface ReviewRow {
  /** `${what}:${key}|${field}` */
  id: string;
  subjectKind: ImportRuling["subjectKind"];
  subjectKey: string;
  field: string;
  /** the change's kind and its words for this field */
  kind: Change["kind"];
  text: string;
  fileValue: string;
  label: string;
  /** the group it is shown in: the element's IFC class, "types", "rooms" */
  group: string;
  nextId: number | null;
  /** the user's rulings (from the ledgers) this difference CHANGES — accept drops them, ignore keeps them */
  caseIds: string[];
  /** the stored word on this subject and field, if any */
  prior: ImportRuling | null;
  /** ask: never ruled · quiet: ruled on this very value · again: ruled on another value, and the file moved on */
  state: "ask" | "quiet" | "again";
}

const groupOf = (c: Change): string => (c.what === "type" ? "types" : c.what === "space" ? "rooms" : c.ifcClass ?? "elements");
const textOf = (c: Change, f: Change["fields"][number]): string => {
  if (f.field === "presence") return c.kind === "added" ? "new in the file" : "not in the file any more";
  return c.diffs.find((d) => d.startsWith(`${f.field} `) || d.startsWith(`${f.field}:`)) ?? `${f.field} changed`;
};

/** the rows to review: one per field of every difference, with what the user said before */
export function reviewRows(diff: FileDiff, cases: RulingCase[], rulings: ImportRuling[]): ReviewRow[] {
  const prior = new Map(rulings.map((r) => [`${r.subjectKind}:${r.subjectKey}|${r.field}`, r]));
  const out: ReviewRow[] = [];
  for (const c of diff.changes) {
    const on = `${c.what}:${c.key}`;
    const caseIds = cases.filter((k) => k.verdict === "changed" && (k.on ?? []).includes(on)).map((k) => k.id);   // a ruling whose subject is GONE cannot be kept — it is dropped and named apart
    for (const f of c.fields ?? []) {
      const id = `${on}|${f.field}`;
      const p = prior.get(id) ?? null;
      out.push({
        id, subjectKind: c.what, subjectKey: c.key, field: f.field, kind: c.kind, text: textOf(c, f), fileValue: f.next, label: c.label,
        group: groupOf(c), nextId: c.what === "element" ? c.nextId : null, caseIds, prior: p,
        state: !p ? "ask" : p.fileValue === f.next ? "quiet" : "again",
      });
    }
  }
  return out;
}

/** the rows by group, the groups in a stable order (elements by class name, then types, then rooms) */
export function reviewGroups(rows: ReviewRow[]): Array<{ group: string; rows: ReviewRow[] }> {
  const by = new Map<string, ReviewRow[]>();
  for (const r of rows) (by.get(r.group) ?? by.set(r.group, []).get(r.group)!).push(r);
  const rank = (g: string): number => (g === "types" ? 1 : g === "rooms" ? 2 : 0);
  return [...by.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0])).map(([group, rs]) => ({ group, rows: rs }));
}

/** the case ids the review's choices take the file's word on: a ruling rides a difference the user ACCEPTED */
export function takenCases(rows: ReviewRow[], choice: Map<string, ImportChoice>): Set<string> {
  const out = new Set<string>();
  for (const r of rows) if (choice.get(r.id) === "accept") for (const k of r.caseIds) out.add(k);
  return out;
}

/** the words to store for the rows the user chose on */
export function rulingsToSave(rows: ReviewRow[], choice: Map<string, ImportChoice>, versionSha: string, at: string): ImportRuling[] {
  const out: ImportRuling[] = [];
  for (const r of rows) {
    const c = choice.get(r.id);
    if (!c) continue;
    out.push({ subjectKind: r.subjectKind, subjectKey: r.subjectKey, field: r.field, fileValue: r.fileValue, choice: c, scope: null, requestId: null, versionSha, at });
  }
  return out;
}

export function formatReview(rows: ReviewRow[]): string {
  const n = (s: ReviewRow["state"]): number => rows.filter((r) => r.state === s).length;
  return `IMPORT REVIEW: ${rows.length} differences — to ask ${n("ask")} · asked again (the file moved on) ${n("again")} · quiet (ruled on this value) ${n("quiet")} · beside a ruling of yours ${rows.filter((r) => r.caseIds.length).length}`;
}
