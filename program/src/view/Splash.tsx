// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE SPLASH PAGE (user, 2026-10-10: "Upon program startup, we need a splash page for identification of program identifying purpose and
// indented users, license identification with bullet points, overview of program (organization, data inputs, and limitations) with Click to
// proceed button"). Shown once per launch of the app — a page reload in the same window (a merge, a dev reload) does not show it again —
// over the app, which loads behind it.

import { projectBadge } from "../core/projectSources.js";
import { useEffect, useState, type ReactNode } from "react";

const SEEN = "bim-splash-seen";

function seen(): boolean {
  try { return window.sessionStorage.getItem(SEEN) === "1"; } catch { return false; }
}

export function Splash(): ReactNode {
  const [open, setOpen] = useState(() => !seen());
  const proceed = (): void => {
    try { window.sessionStorage.setItem(SEEN, "1"); } catch { /* shown again next load — harmless */ }
    setOpen(false);
  };
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent): void => { if (e.key === "Enter") proceed(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open]);
  if (!open) return null;
  return (
    <div className="splashScrim">
      <div className="splash" role="dialog" aria-labelledby="splashTitle">
        <h1 id="splashTitle" className="splashName">
          {/* the mark (2026-10-20): a building in three strokes, one per module — the tower BOM's amber, the wing BIM's blue, the ground BEM's teal */}
          <svg viewBox="80 20 380 476" width="34" height="42" aria-hidden="true">
            <polygon fill="var(--accent-bom)" points="160,440 86,104 312,22 312,440 286,440 282,58 122,128 192,440" />
            <polygon fill="var(--accent-bim)" points="324,128 440,222 378,440 350,440 404,244 324,176" />
            <path fill="var(--accent-bem)" d="M88,462 Q270,436 450,462 L450,476 Q270,456 92,492 Z" />
          </svg>
          BIM-BEM-BOM
          {projectBadge() && <span className="houseMark" title={`the open project, ${window.projectNow?.name ?? ""}, carries this mark`}>{projectBadge()}</span>}
        </h1>
        <div className="splashSub">Building Information Model · Building Energy Model · Building Operations Model · where the model meets the meter · by Enthalix LLC · public preview</div>

        <section>
          <h2>Purpose</h2>
          <p>Turns a building's IFC model into an EnergyPlus energy model, runs it, and compares its results — priced by your utility's own
            tariff — with the building's metered bills and its measured solar production.</p>
          <h2>Intended users</h2>
          <ul>
            <li>Energy modelers and mechanical engineers building EnergyPlus models from an architect's IFC file</li>
            <li>Architects and designers checking an envelope's energy performance against the energy code</li>
            <li>Researchers, students and building owners comparing a model with utility bills and PV production</li>
          </ul>
        </section>

        <section>
          <h2>License</h2>
          <ul>
            <li>Copyright 2026 Enthalix LLC, licensed under the <b>Apache License, Version 2.0</b> (the LICENSE and NOTICE files)</li>
            <li>You may use, copy, modify and distribute it, in source or binary form, for any purpose, commercial use included</li>
            <li>A redistribution carries the license and the NOTICE, and a modified file says it was changed</li>
            <li>Each contributor grants a patent license; it ends for anyone who brings a patent claim over the work</li>
            <li>"Enthalix" and its logo are trademarks of Enthalix LLC; the license grants no right to use them (TRADEMARKS.md)</li>
            <li>Provided "AS IS", without warranties or conditions of any kind, and with no liability for damages</li>
            <li>Powered by EnergyPlus, installed separately under its own license; BIM-BEM-BOM is not affiliated with or endorsed by the US
              Department of Energy. Every other component and data source keeps its own terms — THIRD-PARTY-NOTICES.md. The Open-Meteo
              archive's free API is for non-commercial use only</li>
            <li><b>Data owned by others:</b> BIM-BEM-BOM ships no material, standard or product data belonging to others. The materials
              library is built on your computer — the ASHRAE Handbook of Fundamentals (2005) materials read from your own EnergyPlus
              installation, the openstudio-standards catalogue (rows citing California Title 24-2013) downloaded once. Those numbers
              belong to their publishers, and so does any standard, code or product value you type in: using them in your work may
              require your own copy or license from the publisher. Enthalix grants no right to them</li>
          </ul>
        </section>

        <section>
          <h2>Overview</h2>
          <h3>Organization</h3>
          <ul>
            <li>One window: the module rail at the far left (BIM · BEM · BOM); beside it the LEVELS · SPACES column, listing the building's
              levels and their spaces, to the left of the main view; the view in the centre, a frame of cards under it, and the selected
              module's tabs and details in the right column</li>
            <li><b>BIM</b> reads the IFC and collapses each assembly to the single plane EnergyPlus takes, carved by room → <code>idf.db</code></li>
            <li><b>BEM</b> builds the energy model — site and weather, constructions, schedules, zones, systems — and runs EnergyPlus → <code>bem.db</code></li>
            <li><b>BOM</b> prices the run by your tariff, takes your bills and PV production, and runs the calibration year → <code>bom.db</code></li>
            <li>Each module reads the file before it; every derived file carries the hash of what it was built from, so a stale result is
              marked. Your decisions are kept in ledgers tied to the IFC file and saved as you work</li>
          </ul>
          <h3>What you provide</h3>
          <ul>
            <li>The building's IFC file, and IFC files beside it for the site's terrain and shading</li>
            <li>EnergyPlus, installed separately — run <code>pnpm setup:check</code> to see what is installed and what is missing (SETUP.md)</li>
            <li>A weather file from EnergyPlus's weather repository (picked on the map in BEM › SITE), or one you obtained</li>
            <li>The energy code your project is under: its climate zone for your county and its values, read from the code's own text
              (free to read at codes.iccsafe.org) — until then, the DOE/PNNL prototype values for IECC 2006–2024 that ship with BIM-BEM-BOM</li>
            <li>Materials: EnergyPlus's datasets, the openstudio-standards catalogue, and your own entries — the right to use the
              publishers' numbers is yours to obtain (see License, Data owned by others)</li>
            <li>Your utility's tariff, transcribed from its published schedule; your bills (typed or CSV) and a PV production export</li>
          </ul>
          <h3>Limitations</h3>
          <ul>
            <li>The program reads what the file states and derives nothing: where the file is silent a code default governs and is
              labeled as one, and geometry it cannot merge is reported, never repaired in silence</li>
            <li>Results are simulation estimates — not a guarantee of energy use or cost, and not code-compliance documentation</li>
            <li>Calibration follows ASHRAE Guideline 14's statistics; a typical-year run cannot calibrate, and the actual year's sun is an
              estimate checked against the measured PV</li>
            <li>The tariff arithmetic covers a residential schedule with net metering (see references/tariffs/README.md)</li>
            <li>A public preview, tried on few buildings: developed on macOS; the Windows and Linux builds are run automatically on every change</li>
          </ul>
        </section>

        <div className="splashFoot">
          <button className="apply" autoFocus onClick={proceed}>Click to proceed</button>
        </div>
      </div>
    </div>
  );
}
