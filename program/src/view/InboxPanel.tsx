// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE INBOX (2026-11-20): the proposals an assistant left in the project's inbox/, one line at the head of the editing column that
// opens to the list. Each proposal shows its reason, the change in the ledger's own words, what it was measured against (out of date
// when the model has changed since), the preview and any scenario the assistant ran. Stage puts it in its tab's stage — the tab's own
// Apply writes it; Reject moves the file to inbox/rejected/. The app reads; the assistant (a separate program) wrote.
import { useState, type ReactElement } from "react";
import { describeChange, PROPOSAL_TAB, type Proposal, type ProposalRead } from "../modules/bem/core/proposals";

export interface InboxPanelProps {
  reads: ProposalRead[];
  /** the open IFC's sha and idf.db's content sha now, to say whether a proposal was made on this model */
  ifcSha: string | null;
  idfSha: string | null;
  tabLabel: (tab: string) => string;
  onStage: (p: Proposal) => void;
  onReject: (id: string) => void;
  busy: boolean;
}

const kwh = (x: number | null): string => (x === null ? "—" : `${Math.round(x).toLocaleString()} kWh`);

export function InboxPanel(p: InboxPanelProps): ReactElement | null {
  const [open, setOpen] = useState(false);
  if (!p.reads.length) return null;
  const good = p.reads.filter((r): r is { ok: true; proposal: Proposal } => r.ok);
  return (
    <div className="inbox">
      <button className="qaBtn sec inboxHead" onClick={() => setOpen(!open)} title="proposals an assistant left in this project's inbox/ folder — nothing changes until you stage one and Apply it">
        {open ? "▾" : "▸"} {p.reads.length} proposal{p.reads.length === 1 ? "" : "s"} from the assistant
      </button>
      {open && (
        <div className="inboxList">
          {p.reads.map((r) => {
            if (!r.ok) return (
              <div key={r.id} className="inboxItem">
                <div className="muted">{r.id}: not read — {r.problem}</div>
                <button className="qaBtn" disabled={p.busy} onClick={() => p.onReject(r.id)}>Reject</button>
              </div>
            );
            const pr = r.proposal;
            const otherFile = !!pr.made.ifcSha256 && !!p.ifcSha && pr.made.ifcSha256 !== p.ifcSha;
            const stale = !otherFile && !!pr.made.idfContentSha256 && !!p.idfSha && pr.made.idfContentSha256 !== p.idfSha;
            const pv = pr.preview, sc = pr.scenario;
            return (
              <div key={pr.id} className="inboxItem">
                <div className="inboxReason">{pr.reason}</div>
                <div className="inboxChange"><code>{describeChange(pr.change)}</code></div>
                <div className="muted">
                  {new Date(pr.made.at).toLocaleString()} · {pr.made.by} · staged on {p.tabLabel(PROPOSAL_TAB[pr.change.section])}
                  {otherFile ? " · made for another version of the IFC — it cannot be staged here" : stale ? " · OUT OF DATE: the model has changed since it was measured" : " · measured on this model"}
                </div>
                {pv && (
                  <div className="muted">
                    preview: {pv.identical ? (pv.noEffect ?? "no effect on the model") : `IDF objects +${pv.objects?.added ?? 0} −${pv.objects?.removed ?? 0} ~${pv.objects?.changed ?? 0}`}
                    {pv.settingsChanged?.length ? ` · ${pv.settingsChanged.length} setting${pv.settingsChanged.length === 1 ? "" : "s"} changed` : ""}
                    {pv.notHonoured?.length ? ` · NOT HONOURED: ${pv.notHonoured.join("; ")}` : ""}
                    {pv.checksNew?.length ? ` · new checks: ${pv.checksNew.join("; ")}` : ""}
                  </div>
                )}
                {sc && (
                  <div className="muted">
                    a year run ({sc.completed && sc.fatal === 0 ? `Severe ${sc.severe}` : "did not finish cleanly"}): heating {kwh(sc.heatingKwh)} · cooling {kwh(sc.coolingKwh)}
                    {sc.lastRun ? ` — the last run ${sc.lastRun}: ${kwh(sc.heatingKwhLast)} · ${kwh(sc.coolingKwhLast)}` : ""} · {sc.against}
                  </div>
                )}
                <div className="inboxActs">
                  <button className="qaBtn" disabled={p.busy || otherFile || good.length === 0} onClick={() => p.onStage(pr)} title="put it in the tab's stage, as if you had made the change — the tab's own Apply writes it; you may edit it first">Stage</button>
                  <button className="qaBtn" disabled={p.busy} onClick={() => p.onReject(pr.id)} title="move it to inbox/rejected/, where the assistant can read that it was turned down">Reject</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
