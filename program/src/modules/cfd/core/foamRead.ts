// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// OPENFOAM'S ASCII FILES, READ. A finished case is read from its own files — the mesh (constant/polyMesh: points, faces,
// owner, boundary) and a time folder's fields (internalField per cell, a patch's values per face) — never from a
// derived export. The solver writes binary; the runner converts the last time to ASCII first (foamFormatConvert,
// writeCellCentres, writeCellVolumes), so this reader takes ASCII only and refuses anything else by name.

export interface Patch { name: string; type: string; nFaces: number; startFace: number }

/** a scanner over one file's text: numbers, ints, and the punctuation OpenFOAM lists use */
class Scan {
  i = 0;
  constructor(readonly t: string) {}
  skipWs(): void {
    const t = this.t;
    for (;;) {
      const c = t.charCodeAt(this.i);
      if (c === 32 || c === 10 || c === 13 || c === 9) { this.i++; continue; }
      if (c === 47 && t.charCodeAt(this.i + 1) === 47) { const e = t.indexOf("\n", this.i); this.i = e < 0 ? t.length : e + 1; continue; }
      if (c === 47 && t.charCodeAt(this.i + 1) === 42) { const e = t.indexOf("*/", this.i + 2); this.i = e < 0 ? t.length : e + 2; continue; }
      return;
    }
  }
  expect(ch: string): void {
    this.skipWs();
    if (this.t[this.i] !== ch) throw new Error(`expected "${ch}" at ${this.i}, read "${this.t.slice(this.i, this.i + 20)}"`);
    this.i++;
  }
  num(): number {
    this.skipWs();
    const t = this.t, s = this.i;
    let j = s;
    for (;;) {
      const c = t.charCodeAt(j);
      // digits . + - e E
      if ((c >= 48 && c <= 57) || c === 46 || c === 43 || c === 45 || c === 101 || c === 69) { j++; continue; }
      break;
    }
    if (j === s) throw new Error(`expected a number at ${s}, read "${t.slice(s, s + 20)}"`);
    this.i = j;
    return +t.slice(s, j);
  }
}

/** the body after the FoamFile header: where the data starts */
function bodyStart(t: string): number {
  if (t.slice(0, 4000).includes("format      binary") || /format\s+binary\s*;/.test(t.slice(0, 4000)))
    throw new Error("the file is binary — the runner must convert it to ASCII first (foamFormatConvert)");
  const h = t.indexOf("FoamFile");
  if (h < 0) return 0;
  const e = t.indexOf("}", h);
  return e + 1;
}

/** a bare list file (points, owner, neighbour): `N ( … )` */
function listAfterHeader(t: string): Scan {
  const s = new Scan(t);
  s.i = bodyStart(t);
  return s;
}

export function readPoints(t: string): Float64Array {
  const s = listAfterHeader(t);
  const n = s.num();
  s.expect("(");
  const out = new Float64Array(3 * n);
  for (let k = 0; k < n; k++) { s.expect("("); out[3 * k] = s.num(); out[3 * k + 1] = s.num(); out[3 * k + 2] = s.num(); s.expect(")"); }
  return out;
}

export function readLabels(t: string): Int32Array {
  const s = listAfterHeader(t);
  const n = s.num();
  s.expect("(");
  const out = new Int32Array(n);
  for (let k = 0; k < n; k++) out[k] = s.num();
  return out;
}

/** faces as CSR: face k's points are idx[off[k] .. off[k+1]) */
export interface Faces { off: Int32Array; idx: Int32Array }

export function readFaces(t: string): Faces {
  const s = listAfterHeader(t);
  const n = s.num();
  s.expect("(");
  const off = new Int32Array(n + 1);
  let idx = new Int32Array(n * 4 + 16), m = 0;
  for (let k = 0; k < n; k++) {
    const c = s.num();
    s.expect("(");
    if (m + c > idx.length) { const g = new Int32Array(idx.length * 2 + c); g.set(idx); idx = g; }
    for (let j = 0; j < c; j++) idx[m++] = s.num();
    s.expect(")");
    off[k + 1] = m;
  }
  return { off, idx: idx.slice(0, m) };
}

export function readBoundary(t: string): Patch[] {
  const body = t.slice(bodyStart(t));
  const out: Patch[] = [];
  const re = /([A-Za-z0-9_.\-]+)\s*\{([^{}]*)\}/g;
  for (const m of body.matchAll(re)) {
    const f = (k: string): string | undefined => new RegExp(`\\b${k}\\s+([^;]+);`).exec(m[2]!)?.[1]?.trim();
    const nFaces = f("nFaces"), startFace = f("startFace");
    if (nFaces == null || startFace == null) continue;
    out.push({ name: m[1]!, type: f("type") ?? "", nFaces: +nFaces, startFace: +startFace });
  }
  return out;
}

export type Field = { kind: "scalar"; n: number; data: Float64Array } | { kind: "vector"; n: number; data: Float64Array };

function readList(s: Scan, kind: "scalar" | "vector"): Float64Array {
  const n = s.num();
  s.expect("(");
  const w = kind === "scalar" ? 1 : 3;
  const out = new Float64Array(w * n);
  if (kind === "scalar") for (let k = 0; k < n; k++) out[k] = s.num();
  else for (let k = 0; k < n; k++) { s.expect("("); out[3 * k] = s.num(); out[3 * k + 1] = s.num(); out[3 * k + 2] = s.num(); s.expect(")"); }
  return out;
}

/** a field's internalField; a uniform one is expanded to `cells` values */
export function readInternal(t: string, cells?: number): Field {
  const b = bodyStart(t);
  const at = t.indexOf("internalField", b);
  if (at < 0) throw new Error("no internalField");
  const s = new Scan(t);
  s.i = at + "internalField".length;
  s.skipWs();
  if (t.startsWith("uniform", s.i)) {
    s.i += 7; s.skipWs();
    if (t[s.i] === "(") {
      s.i++; const v = [s.num(), s.num(), s.num()];
      const n = cells ?? 1, d = new Float64Array(3 * n);
      for (let k = 0; k < n; k++) d.set(v, 3 * k);
      return { kind: "vector", n, data: d };
    }
    const v = s.num(), n = cells ?? 1;
    return { kind: "scalar", n, data: new Float64Array(n).fill(v) };
  }
  const m = /nonuniform\s+List<(scalar|vector|symmTensor)>/.exec(t.slice(s.i, s.i + 80));
  if (!m) throw new Error(`internalField is neither uniform nor a nonuniform scalar/vector list: "${t.slice(s.i, s.i + 60)}"`);
  s.i += m.index + m[0].length;
  if (m[1] === "symmTensor") throw new Error("symmTensor fields are read with readSymmTensorTrace");
  const kind = m[1] as "scalar" | "vector";
  const data = readList(s, kind);
  return { kind, n: kind === "scalar" ? data.length : data.length / 3, data } as Field;
}

/** a symmTensor field (UPrime2Mean) as its trace per cell: xx + yy + zz */
export function readSymmTensorTrace(t: string): Float64Array {
  const at = t.indexOf("internalField", bodyStart(t));
  const s = new Scan(t);
  s.i = at + "internalField".length;
  const m = /nonuniform\s+List<symmTensor>/.exec(t.slice(s.i, s.i + 80));
  if (!m) throw new Error("not a nonuniform symmTensor field");
  s.i += m.index + m[0].length;
  const n = s.num();
  s.expect("(");
  const out = new Float64Array(n);
  for (let k = 0; k < n; k++) { s.expect("("); const xx = s.num(); s.num(); s.num(); const yy = s.num(); s.num(); const zz = s.num(); s.expect(")"); out[k] = xx + yy + zz; }
  return out;
}

/** one patch's face values from a field's boundaryField (`value nonuniform List<scalar> n ( … )`); null when the patch
 *  states a uniform value or none */
export function readPatchScalars(t: string, patch: string): Float64Array | null {
  const bf = t.indexOf("boundaryField", bodyStart(t));
  if (bf < 0) return null;
  const re = new RegExp(`(?:^|\\s)${patch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`, "g");
  re.lastIndex = bf;
  const m = re.exec(t);
  if (!m) return null;
  const close = t.indexOf("}", m.index + m[0].length);
  const v = t.indexOf("value", m.index + m[0].length);
  if (v < 0 || v > close) return null;
  const s = new Scan(t);
  s.i = v + 5;
  s.skipWs();
  if (t.startsWith("uniform", s.i)) { s.i += 7; return new Float64Array([s.num()]); }
  const l = /nonuniform\s+List<scalar>/.exec(t.slice(s.i, s.i + 60));
  if (!l) return null;
  s.i += l.index + l[0].length;
  return readList(s, "scalar");
}

/** the latest numeric time folder of a case, from a directory listing (not "0", and not "0.orig") */
export function latestTime(names: string[]): string | null {
  const times = names.filter((n) => /^\d+(\.\d+)?$/.test(n) && n !== "0");
  times.sort((a, b) => +a - +b);
  return times.pop() ?? null;
}
