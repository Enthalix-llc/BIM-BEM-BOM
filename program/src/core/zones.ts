// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// ZONES BEYOND THE FILE'S ROOMS. Two things the user rules on that the IFC
// never modelled as an IfcSpace:
//
//  · ATTICS — the air over a room's ceiling up to the roof (or the floor
//    structure above, for a dropped ceiling under the storey above). The user
//    stated the model: "use these ceilings (as floors) to create attic voids
//    above them" (2026-09-02). An attic is the column over the room's OWN
//    ceiling footprint, read from the carved ceiling cells, closed at the
//    top by the roof and floor planes the file states over that footprint.
//    Built as a solid — bottom, sides, top — it is carved like any room.
//  · RULINGS — a room merged into another (the stair and the Studio Corridor
//    into Great), an attic joined to another attic. A relabeling; a surface
//    whose two sides end up in one zone is that zone's internal partition.

import polygonClipping from "polygon-clipping";

type V3 = [number, number, number];
type Ring2 = Array<[number, number]>;
type MP = Ring2[][];

export interface ZoneFaceIn {
  elementId: number;
  category: string;
  n: V3;
  outer: V3[];
  areaM2: number;
  space: string | null;
  spaceFacing: string | null;
}

export interface AtticSolid {
  name: string;
  /** what CLOSES it, read from the plane above: a roof = an attic, a floor = the cavity in a floor assembly */
  kind: "attic" | "interstitial";
  colorIndex: number;
  faces: Array<{ n: V3; outer: V3[] }>;
  room: string;
  ceilingY: number;
  footprintM2: number;
  /** plan area of the roof and floor pieces found over the footprint */
  topM2: number;
  topIds: number[];
}

export interface AtticReport {
  attics: AtticSolid[];
  /** rooms with a ceiling whose top nothing covers: no attic to make */
  uncovered: Array<{ room: string; footprintM2: number; topM2: number }>;
  /** sloped ceiling finishes lying under their roof — cathedral, no attic */
  cathedral: Array<{ room: string; areaM2: number }>;
}

const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const plan = (p: V3): [number, number] => [p[0], p[2]];
function ringArea2(r: Ring2): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) { const p = r[i]!, q = r[(i + 1) % r.length]!; a += p[0] * q[1] - q[0] * p[1]; }
  return Math.abs(a / 2);
}
function mpArea(mp: MP): number {
  let a = 0;
  for (const poly of mp) { const [o, ...hs] = poly; if (o) a += ringArea2(o); for (const h of hs) a -= ringArea2(h); }
  return a;
}
/** polygon-clipping repeats a ring's first point at its end; a stored loop does not */
const open = (r: Ring2): Ring2 => (r.length > 1 && r[0]![0] === r[r.length - 1]![0] && r[0]![1] === r[r.length - 1]![1] ? r.slice(0, -1) : r);

/** THE NAME A BUILT VOID CARRIES (user, 2026-09-19: "can we label the interstitial floor zones as
 *  'Interstitial floor' rather than 'Attic'?"). Which one it gets is READ, not chosen: the plane that
 *  CLOSES the void — a ROOF over it is an attic, a FLOOR over it is the cavity inside a floor assembly,
 *  the same fact the VOID QA reports as its `interstitial` flag, and the file separates the two itself
 *  (every cavity reads a gap of exactly the joist depth against 1.1–9.0 ft on the attics).
 *  THE PREFIX IS A LABEL ONLY: everything that treated an `Attic –` zone as a void still does, through
 *  `isVoidZone` — a rename must not move the physics. What a void IS, and where its insulation sits,
 *  is the user's ruling in the VOID QA dialog, not a word in its name. */
export const isVoidZone = (zone: string | null | undefined): boolean =>
  !!zone && (/^Attic\b/i.test(zone) || /^Interstitial floor\b/i.test(zone));
/** the room a built void stands over, from its name — the disambiguating suffix dropped (a metre height
 *  on names made before 2026-09-19, an ordinal since) */
/** the void INSIDE A FLOOR ASSEMBLY (closed above by a floor) — never a room's air, merged into its room or not: the ceiling
 *  under it is where the room ends (the user, 2026-11-10: "Basement rooms should stop at ceiling of basement spaces") */
export const isFloorCavity = (zone: string | null | undefined): boolean => !!zone && /^Interstitial floor\b/i.test(zone);
export const roomOfVoidZone = (zone: string): string =>
  zone.replace(/^(Attic|Interstitial floor)\s+–\s+/i, "").replace(/ \((\d+\.\d+ m|\d+)\)$/, "");

export function atticSolids(faces: ZoneFaceIn[], rooms: string[], colorBase = 100): AtticReport {
  const attics: AtticSolid[] = [];
  const uncovered: AtticReport["uncovered"] = [];
  const cathedral: AtticReport["cathedral"] = [];
  const tops = faces.filter((f) => (f.category === "roof" || f.category === "floor") && f.n[1] > 0.3);
  let k = 0;
  for (const room of rooms) {
    // the room's ceiling cells whose top nothing claims, grouped by height
    const all = faces.filter((f) => f.category === "ceiling" && f.space === room && !f.spaceFacing && f.n[1] > 0.5);
    const sloped = all.filter((f) => f.n[1] < 0.999);
    if (sloped.length) cathedral.push({ room, areaM2: sloped.reduce((t, f) => t + f.areaM2, 0) });
    const cells = all.filter((f) => f.n[1] >= 0.999);
    if (cells.length === 0) continue;
    const groups = new Map<number, ZoneFaceIn[]>();
    for (const c of cells) {
      const y = Math.round(c.outer[0]![1] * 50) / 50;      // 2 cm bins
      const g = groups.get(y); if (g) g.push(c); else groups.set(y, [c]);
    }
    for (const [, g] of [...groups].sort((a, b) => a[0] - b[0])) {
      const yCeil = g[0]!.outer[0]![1];
      let fp: MP = [];
      for (const c of g) {
        const ring = c.outer.map(plan);
        fp = fp.length ? (polygonClipping.union(fp as never, [[ring]] as never) as MP) : [[ring]];
      }
      const footprintM2 = mpArea(fp);
      if (footprintM2 < 0.05) continue;
      // the roof and floor pieces over it: the FIRST plane hit going up at each
      // plan point, never every plane above — a basement ceiling took both the
      // Main floor and the roof, claiming roof the Great room owns (measured:
      // rooms overlapping 22.6 → 939 m²). Candidates are taken from the lowest
      // up, each clipped to what is still uncovered.
      const topFaces: Array<{ n: V3; outer: V3[] }> = [];
      const topIds = new Set<number>();
      let topM2 = 0, yTop = yCeil;
      const topByCat = new Map<string, number>();      // what CLOSES it: a roof above is an attic, a floor above a floor cavity
      const fc = fp[0]?.[0] ? open(fp[0][0]) : [];
      const fcx = fc.reduce((s, p) => s + p[0], 0) / Math.max(1, fc.length), fcz = fc.reduce((s, p) => s + p[1], 0) / Math.max(1, fc.length);
      const cands = tops.map((t) => {
        const d = dot(t.n, t.outer[0]!);
        const yAt = (x: number, z: number): number => (d - t.n[0] * x - t.n[2] * z) / t.n[1];
        return { t, yAt, y0: yAt(fcx, fcz) };
      }).filter((c) => c.y0 > yCeil + 0.02).sort((a, b) => a.y0 - b.y0);
      let remaining: MP = fp;
      for (const c of cands) {
        if (mpArea(remaining) < 0.05) break;
        const pieces = polygonClipping.intersection([[c.t.outer.map(plan)]] as never, remaining as never) as MP;
        let took = false;
        for (const poly of pieces) {
          const o = open(poly[0]!);
          if (o.length < 3 || ringArea2(o) < 0.05) continue;
          const cx = o.reduce((s, p) => s + p[0], 0) / o.length, cz = o.reduce((s, p) => s + p[1], 0) / o.length;
          if (c.yAt(cx, cz) <= yCeil + 0.02) continue;
          const outer: V3[] = o.map(([x, z]) => [x, c.yAt(x, z), z]);
          for (const q of outer) yTop = Math.max(yTop, q[1]);
          topFaces.push({ n: c.t.n, outer });
          const a2 = mpArea([poly]);
          topM2 += a2;                             // holes subtracted: a stair opening is not attic floor
          topByCat.set(c.t.category, (topByCat.get(c.t.category) ?? 0) + a2);
          topIds.add(c.t.elementId);
          took = true;
        }
        if (took) remaining = polygonClipping.difference(remaining as never, pieces as never) as MP;
      }
      if (topM2 < 0.5 * footprintM2) { uncovered.push({ room, footprintM2, topM2 }); continue; }
      // bottom and sides: the footprint at the ceiling, each side up to the
      // top plane over its own ends — never past it, or the sides claim the
      // walls of the storey above (measured: a basement attic's sides took
      // the Great room's walls, overlap 22.6 → 603 m²)
      const solid: Array<{ n: V3; outer: V3[] }> = [...topFaces];
      const taken = cands.filter((c) => topIds.has(c.t.elementId));
      const yTopAt = (x: number, z: number): number => {
        let y = Infinity;
        for (const c of taken) { const v = c.yAt(x, z); if (v > yCeil + 0.02 && v < y) y = v; }
        return Number.isFinite(y) ? y : yTop;
      };
      for (const poly of fp) {
        const o = open(poly[0]!);
        if (o.length < 3) continue;
        solid.push({ n: [0, -1, 0], outer: o.map(([x, z]) => [x, yCeil, z]) });
        const cx = o.reduce((s, p) => s + p[0], 0) / o.length, cz = o.reduce((s, p) => s + p[1], 0) / o.length;
        for (let i = 0; i < o.length; i++) {
          const a = o[i]!, b = o[(i + 1) % o.length]!;
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (len < 1e-3) continue;
          let n: V3 = [(b[1] - a[1]) / len, 0, -(b[0] - a[0]) / len];
          const mx = (a[0] + b[0]) / 2 - cx, mz = (a[1] + b[1]) / 2 - cz;
          if (n[0] * mx + n[2] * mz < 0) n = [-n[0], 0, -n[2]];
          // a side with no height is not a face: a degenerate ring makes the
          // clipper's union throw and the partition lose its identity
          // (measured: Δ 30 m² on two Office walls)
          const ya = Math.max(yTopAt(a[0], a[1]), yCeil), yb = Math.max(yTopAt(b[0], b[1]), yCeil);
          if (ya - yCeil < 0.01 && yb - yCeil < 0.01) continue;
          solid.push({ n, outer: [[a[0], yCeil, a[1]], [b[0], yCeil, b[1]], [b[0], Math.max(yb, yCeil + 0.01), b[1]], [a[0], Math.max(ya, yCeil + 0.01), a[1]]] });
        }
      }
      const kind: AtticSolid["kind"] = (topByCat.get("floor") ?? 0) > (topByCat.get("roof") ?? 0) ? "interstitial" : "attic";
      const label = kind === "interstitial" ? "Interstitial floor" : "Attic";
      // the NAME carries no unit (user, 2026-09-19: "we need a QA to assure units are consistent. In BIM
      // Spaces the Attic Great is listed a 14.89 m"). A zone name is an IDENTIFIER — it travels into
      // idf.db, the IDF and the ledger's own keys — so it cannot follow the units toggle, and a metre
      // height in it is a number the user never asked to read. The suffix is added only where it is
      // needed, below: two voids OF THE SAME KIND over one room, told apart by an ordinal.
      attics.push({ name: `${label} – ${room}`, kind, colorIndex: colorBase + k++, faces: solid, room, ceilingY: yCeil, footprintM2, topM2, topIds: [...topIds] });
    }
  }
  // two voids of the SAME KIND over one room need telling apart; the prefix already separates an attic
  // from an interstitial floor, so most files need no suffix at all. Ordinal by ceiling height, lowest
  // first — deterministic, and free of any unit.
  const byName = new Map<string, AtticSolid[]>();
  for (const a of attics) (byName.get(a.name) ?? byName.set(a.name, []).get(a.name)!).push(a);
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    group.sort((x, y) => x.ceilingY - y.ceilingY);
    group.forEach((a, i) => { a.name = `${a.name} (${i + 1})`; });
  }
  return { attics, uncovered, cathedral };
}

export interface ZoneRulings {
  /** room → the zone it joins */
  spaces: Record<string, string>;
  /** attic or other named void → the zone it joins */
  voids: Record<string, string>;
}

export interface RulingReport {
  relabeled: number;
  /** surfaces whose two sides ended up in one zone — that zone's internal partitions */
  internal: number;
  unresolved: string[];
}

/** rename zones per the rulings, following chains (A → B → C), refusing cycles */
/** THE ONE RESOLVE RULE for a zone ruling: follow `a → b → c` to its end, a cycle refused and reported
 *  rather than looped. The face relabel and the ZONE LIST both go through this, so a merged zone's
 *  surfaces and its volume cannot disagree (2026-09-19). */
export function zoneResolver(
  rulings: ZoneRulings | undefined, onCycle: (z: string) => void = () => undefined,
): (z: string) => string {
  const map = { ...(rulings?.spaces ?? {}), ...(rulings?.voids ?? {}) };
  return (z: string): string => {
    const seen = new Set<string>();
    let cur = z;
    while (map[cur] && map[cur] !== cur) {
      if (seen.has(cur)) { onCycle(z); return z; }
      seen.add(cur); cur = map[cur]!;
    }
    return cur;
  };
}

export function applyZoneRulings<T extends { space?: string | null; spaceFacing?: string | null; spaceIfc?: string | null; spaceFacingIfc?: string | null }>(
  faces: T[], rulings: ZoneRulings | undefined,
): { out: T[]; report: RulingReport } {
  const unresolved: string[] = [];
  const resolve = zoneResolver(rulings, (z) => unresolved.push(z));
  let relabeled = 0, internal = 0;
  const out = faces.map((f) => {
    const a = f.space ? resolve(f.space) : f.space;
    const b = f.spaceFacing ? resolve(f.spaceFacing) : f.spaceFacing;
    if (a !== f.space || b !== f.spaceFacing) relabeled++;
    if (a && a === b) internal++;
    // the IfcSpace each side came from survives the relabel: a zone of
    // several rooms still names each room's own Space (2026-09-04)
    return { ...f, spaceIfc: f.spaceIfc ?? f.space ?? null, spaceFacingIfc: f.spaceFacingIfc ?? f.spaceFacing ?? null, space: a, spaceFacing: b };
  });
  return { out, report: { relabeled, internal, unresolved: [...new Set(unresolved)] } };
}

export function formatAttics(r: AtticReport, name: (id: number) => string = () => ""): string[] {
  const nAttic = r.attics.filter((a) => a.kind === "attic").length;
  const nInter = r.attics.length - nAttic;
  const out = [
    `  VOIDS BUILT over rooms' ceilings — ${r.attics.length}: ${nAttic} ATTIC (a roof closes it) · ${nInter} INTERSTITIAL FLOOR (a floor closes it — the cavity inside a floor assembly, the user's word 2026-09-19) · ${r.uncovered.length} ceilings with nothing over them`,
  ];
  for (const a of r.attics) {
    out.push(`    ${a.name.padEnd(28)} ceiling y ${a.ceilingY.toFixed(3)} · footprint ${a.footprintM2.toFixed(1)} m² · covered ${(100 * a.topM2 / a.footprintM2).toFixed(0)}% by ${a.topIds.map((id) => `#${id}${name(id)}`).join(", ")}`);
  }
  for (const u of r.uncovered) out.push(`    (no attic) ${u.room.padEnd(18)} footprint ${u.footprintM2.toFixed(1)} m² · covered ${(100 * u.topM2 / u.footprintM2).toFixed(0)}%`);
  if (r.cathedral.length) out.push(`    cathedral ceiling finishes under their roof, no attic: ` + r.cathedral.map((c) => `${c.room} ${c.areaM2.toFixed(1)} m²`).join(" · "));
  return out;
}
