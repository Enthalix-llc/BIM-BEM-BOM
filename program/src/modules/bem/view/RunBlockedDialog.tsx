// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
// WHY THE RUN CANNOT GO (user, 2026-10-16: "pop up a dialog box stating that the run can't occur because …, which clears when the
// issues are resolved"): opened by Run EnergyPlus when something stands in the way; each reason with the tab where it is resolved.
// It does not cover the screen, so the tabs stay usable while it is open, and it closes itself once the list is empty.

import { useEffect } from "react";
import type { TabId } from "../../../shell/registry.js";

// A SIDE LEFT OFF (user, 2026-11-03: "a QA that identifies spaces that have their heating and cooling unchecked … should allow for
// a checkbox to approve the lack of heating and/or cooling"): such a block carries one checkbox per side; ticking it saves the
// approval and the block goes once the model is rebuilt.
export interface RunBlock { what: string; how: string; tab?: TabId; approve?: { label: string; onApprove: () => void } }

export function RunBlockedDialog(p: { blocks: RunBlock[]; tabLabel: (t: TabId) => string; onGo: (t: TabId) => void; onClose: () => void; busy?: boolean }): React.ReactElement {
  useEffect(() => { const h = (e: KeyboardEvent): void => { if (e.key === "Escape") p.onClose(); }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [p]);
  return (
    <div className="dialog runBlocked" role="alertdialog" aria-label="the run cannot occur">
      <div className="dialogHead">EnergyPlus cannot run yet, because:</div>
      <ul>
        {p.blocks.map((b, i) => (
          <li key={i}>
            <span className="bad">{b.what}</span>
            <div className="muted">{b.how}{b.tab && <> · <button className="chip" onClick={() => p.onGo(b.tab!)}>go to {p.tabLabel(b.tab)}</button></>}</div>
            {b.approve && <label className="runApprove" title="the model runs with this side off; the approval is saved with the project and shown in RUN › checks, where it can be taken back">
              <input type="checkbox" checked={false} disabled={p.busy} onChange={b.approve.onApprove} /> {b.approve.label}</label>}
          </li>
        ))}
      </ul>
      <div className="muted">This box closes by itself when nothing is left in the way; then Run EnergyPlus again.</div>
      <div className="allRow"><span style={{ flex: 1 }} /><button className="qaBtn" onClick={p.onClose}>Close</button></div>
    </div>
  );
}
