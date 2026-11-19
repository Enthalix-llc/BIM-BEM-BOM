// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// A FILE'S ORIENTATION AND LOCATION, WRITTEN INTO THE IFC ITSELF (the user's rulings, 2026-11-19: "the alignment should be
// natively recorded in the ifc files"; "our process for accommodating rotation/relocation should be similar to BIM programs").
// As a BIM program does, no vertex is touched: a file states where it sits and which way is north in two places — its IfcSite's
// placement (every element hangs from it) and the TrueNorth of its geometric representation context — and those two are what
// this rewrites. The discipline is ifcStepDelete's: a STEP file is one entity per line; new lines are appended before the DATA
// section ends, two references are repointed, every other byte is kept, and the write is REFUSED when the file is not placed under
// one IfcSite (an element whose placement does not hang from it would be left behind).
//
// Coordinates here are the FILE's: IFC axes (Z up) in the file's own length unit.

export interface StepFrame {
  /** the IfcSite's absolute placement, row-major 4×4, translation in the file's length unit */
  site: number[][];
  /** the TrueNorth the model context states, IFC (x, y); (0, 1) when it states none */
  trueNorth: [number, number];
  /** metres per file length unit (FOOT 0.3048) */
  lengthScale: number;
  /** the IfcSite's express id and its IfcLocalPlacement's */
  siteId: number;
  placementId: number;
}

export interface PlaceReport {
  ok: boolean;
  /** why the write was refused, in words */
  refused: string | null;
  /** the lines added and the lines rewritten (express ids) */
  added: number[];
  rewritten: number[];
  lineEnding: "\r\n" | "\n";
}

const HEAD = /^#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(/;

/** the top-level arguments of an entity line's attribute list (after the opening parenthesis), split on commas outside parentheses
 *  and string literals; the closing ");" is dropped */
export function argsOf(line: string): string[] {
  const m = HEAD.exec(line);
  if (!m) return [];
  const body = line.slice(m[0].length).replace(/\)\s*;\s*$/, "");
  const out: string[] = [];
  let cur = "", depth = 0, str = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (str) { cur += c; if (c === "'") str = false; continue; }
    if (c === "'") { str = true; cur += c; continue; }
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

const refOf = (a: string | undefined): number | null => (a && /^#\d+$/.test(a) ? Number(a.slice(1)) : null);
const numsOf = (a: string | undefined): number[] => (a ?? "").replace(/^\(|\)$/g, "").split(",").filter((s) => s.trim() !== "").map((s) => Number(s.trim()));

/** a STEP real: always a decimal point, an upper-case exponent; −0 and dust written as 0. */
export function stepReal(v: number): string {
  if (!Number.isFinite(v)) throw new Error(`not a number: ${v}`);
  if (Math.abs(v) < 1e-12) return "0.";
  let s = String(v);
  if (s.includes("e")) {
    const [m, e] = s.split("e");
    s = `${m!.includes(".") ? m : `${m}.`}E${e}`;
  } else if (!s.includes(".")) s = `${s}.`;
  return s;
}

interface Index { lines: string[]; lineOf: Map<number, number>; typeOf: Map<number, string>; maxId: number; lineEnding: "\r\n" | "\n" }

function index(text: string): Index {
  const lineEnding: "\r\n" | "\n" = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(lineEnding);
  const lineOf = new Map<number, number>(), typeOf = new Map<number, string>();
  let maxId = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = HEAD.exec(lines[i]!);
    if (!m) continue;
    const id = Number(m[1]);
    lineOf.set(id, i); typeOf.set(id, m[2]!.toUpperCase());
    if (id > maxId) maxId = id;
  }
  return { lines, lineOf, typeOf, maxId, lineEnding };
}

const lineOfId = (ix: Index, id: number | null): string | null => (id === null ? null : ix.lines[ix.lineOf.get(id) ?? -1] ?? null);
const idsOfType = (ix: Index, t: string): number[] => [...ix.typeOf].filter(([, ty]) => ty === t).map(([id]) => id);

/** the file's length unit in metres, read from its IfcUnitAssignment (an SI unit with its prefix, or a conversion-based unit by its
 *  IfcMeasureWithUnit); 1 when the file states none */
export function lengthScaleOf(ix: Index): number {
  const PREFIX: Record<string, number> = { EXA: 1e18, PETA: 1e15, TERA: 1e12, GIGA: 1e9, MEGA: 1e6, KILO: 1e3, HECTO: 1e2, DECA: 10, DECI: 0.1, CENTI: 0.01, MILLI: 1e-3, MICRO: 1e-6, NANO: 1e-9 };
  const scaleOf = (id: number | null, depth = 0): number | null => {
    const l = lineOfId(ix, id);
    if (!l || depth > 4) return null;
    const ty = ix.typeOf.get(id!), a = argsOf(l);
    if (ty === "IFCSIUNIT") {
      if (!a[1]?.includes("LENGTHUNIT")) return null;
      const p = /^\.([A-Z]+)\.$/.exec(a[2] ?? "")?.[1];
      return p ? (PREFIX[p] ?? 1) : 1;
    }
    if (ty === "IFCCONVERSIONBASEDUNIT" || ty === "IFCCONVERSIONBASEDUNITWITHOFFSET") {
      if (!a[1]?.includes("LENGTHUNIT")) return null;
      const mw = lineOfId(ix, refOf(a[3]));
      if (!mw) return null;
      const ma = argsOf(mw);
      const v = Number(/\(([^()]*)\)/.exec(ma[0] ?? "")?.[1]);
      const base = scaleOf(refOf(ma[1]), depth + 1) ?? 1;
      return Number.isFinite(v) ? v * base : null;
    }
    return null;
  };
  for (const ua of idsOfType(ix, "IFCUNITASSIGNMENT")) {
    for (const r of (argsOf(lineOfId(ix, ua)!)[0] ?? "").replace(/[()]/g, "").split(",")) {
      const s = scaleOf(refOf(r.trim()));
      if (s !== null) return s;
    }
  }
  return 1;
}

const direction = (ix: Index, id: number | null, dflt: number[]): number[] => {
  const l = lineOfId(ix, id);
  if (!l) return dflt;
  const v = numsOf(argsOf(l)[0]);
  return v.length >= 2 ? [v[0]!, v[1]!, v[2] ?? 0] : dflt;
};
const norm = (v: number[]): number[] => { const n = Math.hypot(...v) || 1; return v.map((x) => x / n); };
const cross = (a: number[], b: number[]): number[] => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];

/** the matrix of an IfcAxis2Placement3D (row-major 4×4, the file's units) */
function axisMatrix(ix: Index, id: number | null): number[][] {
  const l = lineOfId(ix, id);
  const a = l ? argsOf(l) : [];
  const loc = lineOfId(ix, refOf(a[0]));
  const p = loc ? numsOf(argsOf(loc)[0]) : [0, 0, 0];
  const z = norm(direction(ix, refOf(a[1]), [0, 0, 1]));
  let x = direction(ix, refOf(a[2]), [1, 0, 0]);
  // x made perpendicular to z (as IFC's own rule does), then y = z × x
  const d = x[0]! * z[0]! + x[1]! * z[1]! + x[2]! * z[2]!;
  x = norm([x[0]! - d * z[0]!, x[1]! - d * z[1]!, x[2]! - d * z[2]!]);
  const y = cross(z, x);
  return [[x[0]!, y[0]!, z[0]!, p[0] ?? 0], [x[1]!, y[1]!, z[1]!, p[1] ?? 0], [x[2]!, y[2]!, z[2]!, p[2] ?? 0], [0, 0, 0, 1]];
}

/** the contexts whose TrueNorth is the file's (IfcGeometricRepresentationContext proper, never a sub-context) */
const contextsOf = (ix: Index): number[] => idsOfType(ix, "IFCGEOMETRICREPRESENTATIONCONTEXT");

/** why a file's placement cannot be rewritten (null when it can): one IfcSite, placed by a top-level IfcLocalPlacement that is the
 *  file's ONLY top-level placement — so every element hangs from it */
function refusal(ix: Index): string | null {
  const sites = idsOfType(ix, "IFCSITE");
  if (sites.length === 0) return "no IfcSite in this file";
  if (sites.length > 1) return `${sites.length} IfcSites — only a file with one IfcSite can be placed`;
  const pl = refOf(argsOf(lineOfId(ix, sites[0]!)!)[5]);
  if (pl === null || ix.typeOf.get(pl) !== "IFCLOCALPLACEMENT") return "its IfcSite has no IfcLocalPlacement";
  const tops = idsOfType(ix, "IFCLOCALPLACEMENT").filter((id) => argsOf(lineOfId(ix, id)!)[0] === "$");
  if (tops.length !== 1 || tops[0] !== pl)
    return `${tops.length} top-level placements — only a file placed under one IfcSite can be moved (an element not under it would be left behind)`;
  if (contextsOf(ix).length === 0) return "no geometric representation context to carry the true north";
  return null;
}

/** the file's frame as it states it — its IfcSite's placement, its TrueNorth, its length unit */
export function readStepFrame(text: string): StepFrame | { refused: string } {
  const ix = index(text);
  const why = refusal(ix);
  if (why) return { refused: why };
  const siteId = idsOfType(ix, "IFCSITE")[0]!;
  const placementId = refOf(argsOf(lineOfId(ix, siteId)!)[5])!;
  const site = axisMatrix(ix, refOf(argsOf(lineOfId(ix, placementId)!)[1]));
  let trueNorth: [number, number] = [0, 1];
  for (const c of contextsOf(ix)) {
    const a = argsOf(lineOfId(ix, c)!);
    const t = refOf(a[5]);
    if (t !== null) { const v = direction(ix, t, [0, 1]); trueNorth = [v[0]!, v[1]!]; break; }
  }
  return { site, trueNorth, lengthScale: lengthScaleOf(ix), siteId, placementId };
}

/** the file with its IfcSite placed at `site` (row-major 4×4, the file's units; only a turn about Z and a move are written — the
 *  axis stays the file's own) and its TrueNorth set to `trueNorth` (IFC x, y) on every representation context. Lossless: the old
 *  placement lines are left as orphans (STEP permits them), new lines are appended, two kinds of line are repointed. */
export function placeInStep(text: string, frame: { site?: number[][]; trueNorth?: [number, number] }): { text: string; report: PlaceReport } {
  const ix = index(text);
  const report: PlaceReport = { ok: false, refused: null, added: [], rewritten: [], lineEnding: ix.lineEnding };
  const why = refusal(ix);
  if (why) { report.refused = why; return { text, report }; }
  const end = ix.lines.findIndex((l, i) => l.trim() === "ENDSEC;" && i > (ix.lineOf.get(ix.maxId) ?? 0));
  if (end < 0) { report.refused = "no end of the DATA section found"; return { text, report }; }
  const added: string[] = [];
  let next = ix.maxId;
  const add = (type: string, args: string): number => { next++; added.push(`#${next}=${type}(${args});`); report.added.push(next); return next; };
  const out = ix.lines.slice();
  if (frame.site) {
    const m = frame.site;
    const pt = add("IFCCARTESIANPOINT", `(${stepReal(m[0]![3]!)},${stepReal(m[1]![3]!)},${stepReal(m[2]![3]!)})`);
    const z = add("IFCDIRECTION", `(${stepReal(m[0]![2]!)},${stepReal(m[1]![2]!)},${stepReal(m[2]![2]!)})`);
    const x = add("IFCDIRECTION", `(${stepReal(m[0]![0]!)},${stepReal(m[1]![0]!)},${stepReal(m[2]![0]!)})`);
    const ax = add("IFCAXIS2PLACEMENT3D", `#${pt},#${z},#${x}`);
    const siteId = idsOfType(ix, "IFCSITE")[0]!;
    const pl = refOf(argsOf(lineOfId(ix, siteId)!)[5])!;
    const li = ix.lineOf.get(pl)!;
    out[li] = `#${pl}=IFCLOCALPLACEMENT($,#${ax});`;
    report.rewritten.push(pl);
  }
  if (frame.trueNorth) {
    const [tx, ty] = frame.trueNorth, n = Math.hypot(tx, ty);
    if (n < 1e-9) { report.refused = "a true north of zero length"; return { text, report }; }
    const tn = add("IFCDIRECTION", `(${stepReal(tx / n)},${stepReal(ty / n)})`);
    for (const c of contextsOf(ix)) {
      const li = ix.lineOf.get(c)!;
      const a = argsOf(ix.lines[li]!);
      while (a.length < 6) a.push("$");
      a[5] = `#${tn}`;
      out[li] = `#${c}=IFCGEOMETRICREPRESENTATIONCONTEXT(${a.join(",")});`;
      report.rewritten.push(c);
    }
  }
  out.splice(end, 0, ...added);
  // the guardrail: every line written refers only to lines that exist
  const ids = new Set([...ix.lineOf.keys(), ...report.added]);
  for (const l of [...added, ...report.rewritten.map((id) => out[ix.lineOf.get(id)!]!)])
    for (const r of l.slice(l.indexOf("(")).match(/#\d+/g) ?? []) if (!ids.has(Number(r.slice(1)))) { report.refused = `a written line refers to ${r}, which is not in the file`; return { text, report }; }
  report.ok = true;
  return { text: out.join(ix.lineEnding), report };
}

/** a turn about Z in degrees (anticlockwise seen from above, IFC's sense) read off a 4×4 */
export const turnOf = (m: number[][]): number => (Math.atan2(m[1]![0]!, m[0]![0]!) * 180) / Math.PI;
/** a TrueNorth (IFC x, y) as degrees anticlockwise from +Y */
export const northOf = (tn: [number, number]): number => (Math.atan2(-tn[0], tn[1]) * 180) / Math.PI;
/** a file's ROTATION TO TRUE NORTH: the turn that brings its model to true north — its IfcSite's turn less its stated true north
 *  (the MEP file −20.00°, the house −22.00°, the site −21.35°, measured on the originals 2026-11-19) */
export const rotationToTrueNorth = (f: StepFrame): number => {
  let r = turnOf(f.site) - northOf(f.trueNorth);
  while (r <= -180) r += 360;
  while (r > 180) r -= 360;
  return r;
};
