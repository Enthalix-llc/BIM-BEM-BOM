// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
/**
 * THE FILE CHANGED — the panel (2026-09-09), grown into THE IFC IMPORT REVIEW (2026-11-13; the user's rulings of 2026-11-05 and
 * 2026-11-07). Opened on load when a version differs from the one it came from: every difference, field by field, grouped by the
 * IFC class, each put to the user once — accept the file's · ignore — and kept for the project (core/importReview.ts). A word
 * given on the same value is not asked again; on a new value it is. A difference under one of the user's rulings is marked: accept
 * drops that ruling for the file's word, ignore keeps it. "Accept all" in a group touches only rows no ruling rides on. Rulings
 * whose subject is gone are dropped and named, as before. A panel in the editing column, never over the view: a row lights its
 * element in the views, so the choice is made looking at it.
 */
import { useState, type ReactElement } from "react";
import type { FileDiff, RulingCase, CarryRecord } from "../core/ifcChanges.js";
import { reviewGroups, IMPORT_CHOICE_LABEL, type ReviewRow, type ImportChoice } from "../core/importReview.js";

export interface FileChangesProps {
  prevName: string; prevSha: string; nextSha: string; prevAt: string;
  diff: FileDiff; cases: RulingCase[]; record: CarryRecord | null;
  rows: ReviewRow[];
  /** the user's word per row as it stands (staged), and as stored */
  choice: Map<string, ImportChoice>;
  saved: Map<string, ImportChoice>;
  busy: boolean;
  onChoose: (ids: string[], choice: ImportChoice | null) => void;
  onApply: () => void;
  onDismiss: () => void;
  onSelect: (elementId: number | null) => void;
}

export function FileChanges(p: FileChangesProps): ReactElement {
  const [showQuiet, setShowQuiet] = useState(false);
  const live = p.rows.filter((r) => r.state !== "quiet"), quiet = p.rows.filter((r) => r.state === "quiet");
  const groups = reviewGroups(showQuiet ? p.rows : live);
  const gone = p.cases.filter((c) => c.verdict === "gone"), carried = p.cases.filter((c) => c.verdict === "carried");
  const open = live.filter((r) => !p.choice.has(r.id)).length;
  const pending = p.rows.filter((r) => p.choice.get(r.id) !== p.saved.get(r.id)).length;
  const caseLabel = new Map(p.cases.map((c) => [c.id, `${c.ledger}/${c.kind}: ${c.label}`]));
  return (
    <div className="qaPanel steps changes">
      <p title={`Rule on each difference once. Accept makes the file's value the reference. Ignore leaves the IFC as it is; it is asked again only if the file's value moves on. A difference marked "your ruling" changes something you ruled on: accept drops your ruling for the file's value, ignore keeps it. Thermal values are not compared: they stay in the energy model's library.`}>
        <b>IFC import review.</b> <code>{p.nextSha.slice(0, 12)}</code> against <code>{p.prevSha.slice(0, 12)}</code> ({p.prevName}): {(100 * p.diff.overlap).toFixed(1)} % of GlobalIds in common, {p.diff.unchanged} elements unchanged{p.record ? `, ${carried.length} rulings carried` : ""}.
        Rule on each difference once: <b>accept</b> the file's value, or <b>ignore</b> it (asked again only if it moves on).
      </p>
      {groups.map((g) => {
        const free = g.rows.filter((r) => !r.caseIds.length && r.state !== "quiet");
        const toRule = g.rows.filter((r) => !p.choice.has(r.id) && r.state !== "quiet").length;
        return (
          <details key={g.group} open={g.rows.length <= 12}>
            <summary>
              <b>{g.group.replace(/^Ifc/, "")}</b> · {g.rows.length} difference{g.rows.length === 1 ? "" : "s"}
              {toRule > 0 && <span className="warn"> · {toRule} to rule on</span>}
              {free.length > 1 && <button className="qaBtn" disabled={p.busy} onClick={(e) => { e.preventDefault(); p.onChoose(free.map((r) => r.id), "accept"); }} title="accept the file's value on every row of this group that no ruling of yours rides on — the rest are decided one by one">accept all {free.length}</button>}
            </summary>
            {g.rows.map((r) => (
              <div key={r.id} className={`reviewRow${r.nextId !== null ? " clickable" : ""}`} onClick={() => { if (r.nextId !== null) p.onSelect(r.nextId); }} title={r.nextId !== null ? "select it in the views" : undefined}>
                <div className="reviewWhat">{r.label}</div>
                <div className={r.kind === "removed" ? "bad" : r.kind === "added" ? "src-user" : "muted"}>{r.text}</div>
                {r.caseIds.length > 0 && <div className="src-user">your ruling: {r.caseIds.map((k) => caseLabel.get(k) ?? k).join(" · ")}</div>}
                {r.state === "again" && r.prior && <div className="warn">asked again — the file's value moved on since you said "{IMPORT_CHOICE_LABEL[r.prior.choice]}"</div>}
                <select value={p.choice.get(r.id) ?? ""} className={p.choice.has(r.id) ? "src-user" : ""} disabled={p.busy} onClick={(e) => e.stopPropagation()}
                  onChange={(e) => p.onChoose([r.id], (e.target.value || null) as ImportChoice | null)}
                  title={r.caseIds.length ? "accept: your ruling is dropped and the file's value governs · ignore: your ruling is kept and replayed against the changed subject" : "accept: the file's value is the reference · ignore: the IFC is not edited from here for this; asked again if the file's value changes"}>
                  <option value="">— rule on it —</option>
                  <option value="accept">{IMPORT_CHOICE_LABEL.accept}</option>
                  <option value="ignore">{r.caseIds.length ? "ignore — keep my ruling" : IMPORT_CHOICE_LABEL.ignore}</option>
                </select>
              </div>
            ))}
          </details>
        );
      })}
      {live.length === 0 && <p className="muted">every difference was ruled on before, on these very values.</p>}
      {quiet.length > 0 && <label className="lensRow muted"><input type="checkbox" checked={showQuiet} onChange={(e) => setShowQuiet(e.target.checked)} /> show the {quiet.length} you ruled on before (same values)</label>}
      {gone.length > 0 && (
        <table>
          <thead><tr><th className="wrap">ruling dropped — its subject is gone from the file</th></tr></thead>
          <tbody>{gone.map((c) => <tr key={c.id}><td className="wrap bad">{c.ledger}/{c.kind}: {c.label}{c.why ? ` — ${c.why}` : ""}</td></tr>)}</tbody>
        </table>
      )}
      <div className="allRow">
        <button className="apply" disabled={!pending || p.busy} onClick={p.onApply} title="keep these words for the project, write the ledgers for this file and rebuild">
          {pending ? `Apply · ${pending} word${pending === 1 ? "" : "s"}${open ? ` · ${open} still to rule on` : ""}` : open ? `${open} to rule on` : p.record ? `✓ ruled — ${p.record.carried} carried · ${p.record.kept.length} kept · ${p.record.overwritten.length} overwritten · ${p.record.dropped.length} dropped` : "✓ ruled"}
        </button>
        <button onClick={p.onDismiss} disabled={p.busy} title="hide this panel; what you did not rule on is asked again the next time this version opens">dismiss</button>
      </div>
      {carried.length > 0 && <details><summary className="muted">{carried.length} rulings carried unchanged</summary><ul className="muted">{carried.map((c) => <li key={c.id}>{c.ledger}/{c.kind}: {c.label}</li>)}</ul></details>}
    </div>
  );
}
