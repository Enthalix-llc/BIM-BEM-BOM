// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// EXPLAIN (user, 2026-10-15): with the top bar's Explain on, a mouse resting on a section's header opens a dialog that says what
// the section is; resting on another header replaces the text. The dialog is non-modal, moved by its title bar, resized by its
// corner, scrolls, and closes by its button or Esc. One listener on the document recognises the headers by the class names the
// window already uses — no component carries anything for it, and a click on a header still does what it always did.
//
// IN A WINDOW OF ITS OWN (user, 2026-10-15: "moved out of the program window … a 2nd monitor"): when the main process offers
// one (window.explainWin), the text goes to that floating window, which moves to any screen; the dialog inside the page below
// is the fallback, for a main process without it.

import { useEffect, useRef, useState } from "react";
import { EXPLAIN } from "./explainText";
import { findExplain, headerText, type ExplainEntry } from "./explainParse";

/** the headers, innermost first; `scoped` entries may be limited to the current tab; `whole` — the region is its own header, so
 *  the dialog is titled by the region alone, not by everything written in it */
const RULES: Array<{ region: string; sel: string; scoped: boolean; whole?: boolean }> = [
  { region: "Right column", sel: ".editCol .editTabs > button, .editCol .subTabs > button", scoped: false },
  { region: "Right column", sel: ".editCol .stepHead, .editCol .barHead, .editCol .qaBtn.sec", scoped: true },
  { region: "Frame", sel: ".inspector h4, .inspector .asmRailBtn", scoped: false },
  { region: "View", sel: ".viewsCol > .viewTabs > button", scoped: false },
  { region: "Levels and spaces", sel: ".tree .treeHead", scoped: false, whole: true },
  { region: "Rail", sel: ".rail", scoped: false, whole: true },
  { region: "Top bar", sel: ".topbar", scoped: false, whole: true },
  { region: "Alignment", sel: ".alignDialog .dialogHead", scoped: false, whole: true },
];

const DWELL_MS = 300;
const MIN_W = 260, MIN_H = 160;
const BOX_KEY = "bim-explain-box";

interface Box { x: number; y: number; w: number; h: number }
interface Shown { entry: ExplainEntry | null; region: string; header: string }

const titleOf = (s: Shown): string =>
  s.entry && s.entry.match !== "*" ? `${s.region} › ${s.entry.title}` : s.header ? `${s.region} · ${s.header}` : s.region;
const htmlOf = (s: Shown): string =>
  s.entry ? s.entry.html : "<p>No explanation is written for this section yet — add one to <code>src/explain/explain.md</code>.</p>";

const readBox = (): Box => {
  const fallback = { x: Math.max(16, window.innerWidth - 440), y: 96, w: 400, h: 340 };
  try {
    const v = JSON.parse(window.localStorage.getItem(BOX_KEY) ?? "null") as Partial<Box> | null;
    if (v && [v.x, v.y, v.w, v.h].every((n) => typeof n === "number" && Number.isFinite(n))) return clampBox(v as Box);
  } catch { /* the default stands */ }
  return fallback;
};
const clampBox = (b: Box): Box => {
  const w = Math.min(Math.max(b.w, MIN_W), window.innerWidth - 16), h = Math.min(Math.max(b.h, MIN_H), window.innerHeight - 16);
  return { w, h, x: Math.min(Math.max(b.x, 0), window.innerWidth - w), y: Math.min(Math.max(b.y, 0), window.innerHeight - h) };
};

function hit(target: EventTarget | null): { el: Element; region: string; scoped: boolean; whole: boolean } | null {
  if (!(target instanceof Element) || target.closest(".explainBox")) return null;
  for (const r of RULES) { const el = target.closest(r.sel); if (el) return { el, region: r.region, scoped: r.scoped, whole: !!r.whole }; }
  return null;
}

/** `scope` is the current tab as the texts name it: BIM, SITE, CONSTRUCTIONS, SCHEDULES, ZONES, SYSTEMS, RUN, BOM */
export function ExplainLayer(p: { on: boolean; scope: string }): React.ReactElement | null {
  const [shown, setShown] = useState<Shown | null>(null);
  const [box, setBox] = useState<Box>(readBox);
  const scopeRef = useRef(p.scope);
  scopeRef.current = p.scope;

  useEffect(() => { try { window.localStorage.setItem(BOX_KEY, JSON.stringify(box)); } catch { /* view state only */ } }, [box]);
  useEffect(() => { document.body.classList.toggle("explaining", p.on); if (!p.on) { setShown(null); void window.explainWin?.hide(); } }, [p.on]);

  useEffect(() => {
    if (!p.on) return;
    let timer = 0;
    let hovered: Element | null = null;
    const mark = (el: Element | null): void => { hovered?.classList.remove("explainHover"); hovered = el; el?.classList.add("explainHover"); };
    const over = (e: MouseEvent): void => {
      const h = hit(e.target);
      if ((e.target as Element | null)?.closest?.(".explainBox")) return;
      if (h?.el === hovered) return;
      window.clearTimeout(timer);
      mark(h?.el ?? null);
      if (!h) return;
      timer = window.setTimeout(() => {
        const header = h.whole ? "" : headerText(h.el.textContent ?? "");
        const s: Shown = { entry: findExplain(EXPLAIN, h.region, h.whole ? "" : header, h.scoped ? scopeRef.current : ""), region: h.region, header };
        if (window.explainWin) void window.explainWin.show(titleOf(s), htmlOf(s)); else setShown(s);
      }, DWELL_MS);
    };
    const key = (e: KeyboardEvent): void => { if (e.key === "Escape") { setShown(null); void window.explainWin?.hide(); } };
    document.addEventListener("mouseover", over);
    window.addEventListener("keydown", key);
    return () => { window.clearTimeout(timer); mark(null); document.removeEventListener("mouseover", over); window.removeEventListener("keydown", key); };
  }, [p.on]);

  /** a drag of the title bar moves the box; of the corner grip, resizes it — the window's own pointer listeners, as the grips do */
  const drag = (e: React.PointerEvent, mode: "move" | "size"): void => {
    if ((e.target as Element).closest("button")) return;
    e.preventDefault();
    const start = { px: e.clientX, py: e.clientY, ...box };
    const move = (m: PointerEvent): void => {
      const dx = m.clientX - start.px, dy = m.clientY - start.py;
      setBox(clampBox(mode === "move" ? { ...start, x: start.x + dx, y: start.y + dy } : { ...start, w: start.w + dx, h: start.h + dy }));
    };
    const up = (): void => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); document.body.style.cursor = ""; };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    document.body.style.cursor = mode === "move" ? "move" : "nwse-resize";
  };

  if (!p.on || !shown) return null;
  const title = titleOf(shown);
  return (
    <div className="explainBox" role="dialog" aria-label={`Explain: ${title}`} style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>
      <div className="explainHead" onPointerDown={(e) => drag(e, "move")} title="drag to move">
        <span className="explainTitle">{title}</span>
        <button onClick={() => setShown(null)} title="close (Esc) — the next header you rest on opens it again">Close</button>
      </div>
      <div className="explainBody">
        <div dangerouslySetInnerHTML={{ __html: htmlOf(shown) }} />
      </div>
      <div className="explainGrip" onPointerDown={(e) => drag(e, "size")} title="drag to resize" />
    </div>
  );
}
