// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE VIEW TOOLS (user, 2026-09-08: "scroll, rotate, typical view tools for
// plan views"): the standard views of a model — the plan (the project grid's
// north up), the plan with TRUE north up, the isometric from the true south-east
// (2026-11-20: the four grid elevations removed), fit — a zoom step each way,
// and what the left drag does (orbit, or pan to scroll a plan; the right drag
// always pans, the wheel always zooms). They sit in the tab strip BESIDE the
// view, never over it (the 2026-09-02 ruling), and drive the ONE camera the
// panes share, so whichever view is shown answers.

import type { DragMode, ViewPreset } from "./ifcPane.js";

const PRESETS: ReadonlyArray<readonly [ViewPreset, string]> = [
  ["plan", "look straight down — the plan, the project grid's north up (the layout reference)"],
  ["trueN", "look straight down — the plan turned so TRUE north is up (the file's TrueNorth, as the sun uses it)"],
  ["iso", "from the true south-east, above — the isometric, read against true north"],
  ["fit", "frame the whole model from where the camera stands"],
];

export function ViewTools(p: { drag: DragMode; onDrag: (m: DragMode) => void; onView: (v: ViewPreset) => void; onZoom: (step: number) => void }): React.ReactElement {
  return (
    <div className="viewTools">
      {PRESETS.map(([k, t]) => <button key={k} onClick={() => p.onView(k)} title={t}>{k === "trueN" ? "true N" : k}</button>)}
      <span className="sep" />
      <button onClick={() => p.onZoom(-0.25)} title="zoom out — the wheel does the same">−</button>
      <button onClick={() => p.onZoom(0.25)} title="zoom in — the wheel does the same">+</button>
      <span className="sep" />
      <button className={p.drag === "orbit" ? "on" : ""} onClick={() => p.onDrag("orbit")} title="a left drag orbits the model (a right drag always pans)">orbit</button>
      <button className={p.drag === "pan" ? "on" : ""} onClick={() => p.onDrag("pan")} title="a left drag pans — scroll the plan (a right drag always pans)">pan</button>
    </div>
  );
}
