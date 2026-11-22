// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE LENS. The same stored idf.db rows pane 3 already draws, painted by a
// result read back from bem.db: a value per idf row, a colour per value.
// Rows the writer did not emit are grey — the refusal rule on screen. The
// builder and the pick map are untouched; a click under any lens still names
// a stored row (the view proves the DB).

import type { DbFaceRow } from "../../../core/db.js";
import type { BemSurfaceRow } from "./bemDb.js";

export type Lens = "none" | "zone-heating" | "zone-cooling" | "zone-heating-peak" | "zone-cooling-peak" | "zone-unmet" | "surface-conduction" | "window-net" | "surface-temp-summer" | "surface-temp-winter" | "zone" | "bc"
  /** RUN › UNMET HOURS (2026-11-22): each conditioned zone's divergence from its setpoint over the timeline's window, °C signed —
   *  blue too cold, red too hot, over a span fixed for the year; not in LENSES (it needs the window the view's timeline sets) */
  | "zone-divergence";

export const LENSES: Array<{ id: Lens; label: string; units: string }> = [
  { id: "none", label: "no lens — the stored colours", units: "" },
  { id: "zone", label: "zone", units: "" },
  { id: "bc", label: "boundary condition", units: "" },
  { id: "zone-heating", label: "zone heating, annual", units: "kWh" },
  { id: "zone-cooling", label: "zone cooling, annual", units: "kWh" },
  // THE ZONES' PEAKS (user, 2026-10-08: "If the intent is to show space loading, then both cooling and heating peaks per zone need to be
  // shown in a legend coloring"): the engine's zone sizing, the design day's peak — every lens's legend lists each zone's two peaks too
  { id: "zone-heating-peak", label: "zone heating peak, design day", units: "W" },
  { id: "zone-cooling-peak", label: "zone cooling peak, design day", units: "W" },
  { id: "zone-unmet", label: "zone hours setpoint not met", units: "h" },
  { id: "surface-conduction", label: "surface conduction, annual (into the zone +)", units: "kWh" },
  { id: "window-net", label: "window net gain, annual", units: "kWh" },
  // THE OUTSIDE FACES ON THE DESIGN DAYS (user, 2026-10-08: "exterior surface temperatures at peak loads … mapped onto the exterior
  // surfaces"): each exterior surface's outside face at the hour picked, cold blue to hot red
  { id: "surface-temp-summer", label: "exterior surface temperature, summer design day", units: "°C" },
  { id: "surface-temp-winter", label: "exterior surface temperature, winter design day", units: "°C" },
];

/** the colour scale (2026-10-08, the user: "for heating use red, and cooling use blue", intensity by the absolute value from 0) */
export type Ramp = "red" | "blue" | "temp" | "seq" | "div";
export const rampOf = (lens: Lens): Ramp =>
  lens === "zone-heating" || lens === "zone-heating-peak" ? "red" : lens === "zone-cooling" || lens === "zone-cooling-peak" ? "blue"
    : lens === "surface-temp-summer" || lens === "surface-temp-winter" ? "temp" : lens === "surface-conduction" || lens === "window-net" || lens === "zone-divergence" ? "div" : "seq";
export interface Legend { lens: Lens; ramp: Ramp; min: number; max: number; units: string; painted: number; unpainted: number; notEmitted: number;
  /** each zone in its colour with its design-day heating and cooling peaks (2026-10-08) — empty before a run */
  entries: Array<{ zone: string; color: number | null; value: number | null; heatW: number | null; coolW: number | null }>;
  /** THE EXTERIOR SURFACES' TEMPERATURES (user, 2026-10-08: "The exterior temperatures should be shown in table below view to establish
   *  what they are"): each exterior surface painted, its room, kind, facing from true north, tilt, gross area and its outside face °C */
  surfaces?: Array<{ epName: string; zone: string; room: string; type: string; azimuthDeg: number; facing: string; tiltDeg: number; areaM2: number; c: number; color: number }> }

const rgba = (r: number, g: number, b: number): number => (((r & 255) << 24) | ((g & 255) << 16) | ((b & 255) << 8) | 255) >>> 0;
const GREY = rgba(70, 74, 84);
const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));

/** blue (negative) through pale to red (positive): a diverging ramp about zero */
function diverging(t: number): number {
  // t in [-1, 1]
  if (t < 0) { const k = -t; return rgba(Math.round(235 - 165 * k), Math.round(240 - 120 * k), 245); }
  return rgba(245, Math.round(240 - 150 * t), Math.round(235 - 190 * t));
}
/** pale to amber: a sequential ramp from zero */
function sequential(t: number): number {
  return rgba(Math.round(236 + 19 * t), Math.round(232 - 90 * t), Math.round(220 - 200 * t));
}
/** pale to deep red (heating) and pale to deep blue (cooling): the intensity is the value over the largest, from zero */
function redRamp(t: number): number { return rgba(Math.round(250 - 50 * t), Math.round(228 - 200 * t), Math.round(220 - 195 * t)); }
function blueRamp(t: number): number { return rgba(Math.round(222 - 202 * t), Math.round(234 - 150 * t), Math.round(250 - 50 * t)); }
/** cold blue through pale to hot red: a temperature across its range */
function tempRamp(t: number): number { return diverging(t * 2 - 1); }
export const RAMP_CSS: Record<Ramp, string> = {
  red: "linear-gradient(90deg, rgb(250,228,220), rgb(200,28,25))", blue: "linear-gradient(90deg, rgb(222,234,250), rgb(20,84,200))",
  temp: "linear-gradient(90deg, rgb(70,120,245), rgb(235,240,245), rgb(245,90,45))",
  seq: "linear-gradient(90deg, rgb(236,232,220), rgb(255,142,20))", div: "linear-gradient(90deg, rgb(70,120,245), rgb(240,240,240), rgb(245,90,45))",
};
/** a categorical hue by golden angle, as the space overlay does */
export function categorical(i: number): number {
  const h = ((i * 137.508) % 360) / 360, s = 0.55, l = 0.55;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t: number): number => { t = (t + 1) % 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 0.5) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
  return rgba(Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255));
}

/** a colour per idf row id for the given lens; rows with no bem surface are grey */
export function paintRows(
  rows: DbFaceRow[],
  surfaces: BemSurfaceRow[],
  values: { zone?: Map<string, number>; surface?: Map<string, number>; peaks?: Map<string, { heatW: number; coolW: number }>; span?: number },
  lens: Lens,
  /** the Building north axis (°): a surface's facing is read from true north (2026-10-08) */
  northAxisDeg = 0,
): { colorOf: (row: DbFaceRow) => number | null; legend: Legend } {
  const byRow = new Map<number, BemSurfaceRow[]>();
  for (const s of surfaces) {
    if (s.idfSurfaceId === null) continue;
    const a = byRow.get(s.idfSurfaceId) ?? [];
    a.push(s); byRow.set(s.idfSurfaceId, a);
  }
  const value = new Map<number, number>();
  const cat = new Map<number, string>();
  for (const r of rows) {
    if (r.id === undefined) continue;
    const ss = byRow.get(r.id);
    if (!ss || ss.length === 0) continue;
    const first = ss[0]!;
    if (lens === "zone") { cat.set(r.id, first.zone); continue; }
    if (lens === "bc") { cat.set(r.id, ss.map((s) => s.bc).sort().join("/")); continue; }
    if (lens === "zone-heating-peak" || lens === "zone-cooling-peak") {
      const p = values.peaks?.get(first.zone.toUpperCase());
      if (p) value.set(r.id, lens === "zone-heating-peak" ? p.heatW : p.coolW);
      continue;
    }
    if (lens === "zone-heating" || lens === "zone-cooling" || lens === "zone-unmet" || lens === "zone-divergence") {
      const v = values.zone?.get(first.zone.toUpperCase());
      if (v !== undefined) value.set(r.id, v);
      continue;
    }
    if (lens === "surface-temp-summer" || lens === "surface-temp-winter") {
      // the OUTSIDE face: an exterior surface only (a face on another zone, the ground or nothing has no outdoor face to show)
      const s0 = ss.find((s) => s.bc === "Outdoors");
      const v = s0 ? values.surface?.get(s0.epName.toUpperCase()) : undefined;
      if (v !== undefined && Number.isFinite(v)) value.set(r.id, v);
      continue;
    }
    if (lens === "surface-conduction" || lens === "window-net") {
      // one row, up to two copies: the value seen from the row's own zone (side 0), else the other
      const s0 = ss.find((s) => s.side === 0) ?? first;
      const v = values.surface?.get(s0.epName.toUpperCase());
      if (v !== undefined) value.set(r.id, v);
    }
  }
  const vals = [...value.values()];
  const ramp = rampOf(lens);
  // red and blue run from ZERO to the largest absolute value (2026-10-08); the others over the values' own range
  const min = ramp === "red" || ramp === "blue" ? 0 : vals.length ? Math.min(...vals) : 0;
  const max = ramp === "red" || ramp === "blue" ? (vals.length ? Math.max(...vals.map(Math.abs)) : 0) : vals.length ? Math.max(...vals) : 0;
  const cats = [...new Set(cat.values())].sort();
  const catIndex = new Map(cats.map((c, i) => [c, i]));
  const units = LENSES.find((l) => l.id === lens)?.units ?? "";
  const legend: Legend = { lens, ramp, min, max, units, painted: 0, unpainted: 0, notEmitted: 0, entries: [] };
  const shade = (v: number): number => {
    const t = max > min ? clamp01((ramp === "red" || ramp === "blue" ? Math.abs(v) - min : v - min) / (max - min)) : 0;
    return ramp === "red" ? redRamp(t) : ramp === "blue" ? blueRamp(t) : ramp === "temp" ? tempRamp(t) : sequential(t);
  };
  for (const r of rows) {
    if (r.id === undefined) continue;
    if (!byRow.has(r.id)) legend.notEmitted++;
    else if (value.has(r.id) || cat.has(r.id)) legend.painted++;
    else legend.unpainted++;
  }
  const colorOf = (row: DbFaceRow): number | null => {
    if (lens === "none") return null;
    if (row.id === undefined || !byRow.has(row.id)) return GREY;
    if (lens === "zone" || lens === "bc") { const c = cat.get(row.id); return c === undefined ? GREY : categorical(catIndex.get(c) ?? 0); }
    const v = value.get(row.id);
    if (v === undefined) return GREY;
    if (lens === "zone-divergence") return diverging(clamp01(Math.abs(v) / (values.span || 1)) * Math.sign(v));
    if (lens === "surface-conduction" || lens === "window-net") {
      const span = Math.max(Math.abs(min), Math.abs(max)) || 1;
      return diverging(clamp01(Math.abs(v) / span) * Math.sign(v));
    }
    return shade(v);
  };
  // the legend's zones: each emitted zone in the colour the lens gives it, with its two design-day peaks
  const zoneVal = (z: string): number | null => {
    const u = z.toUpperCase(), p = values.peaks?.get(u);
    if (lens === "zone-heating-peak") return p ? p.heatW : null;
    if (lens === "zone-cooling-peak") return p ? p.coolW : null;
    if (lens === "zone-heating" || lens === "zone-cooling" || lens === "zone-unmet" || lens === "zone-divergence") return values.zone?.get(u) ?? null;
    return null;
  };
  const zoneColor = (z: string): number | null => {
    if (lens === "zone") return categorical(catIndex.get(z) ?? 0);
    const v = zoneVal(z);
    if (lens === "zone-divergence") return v === null ? null : diverging(clamp01(Math.abs(v) / (values.span || 1)) * Math.sign(v));
    if (v === null || lens === "bc" || lens === "surface-conduction" || lens === "window-net" || ramp === "temp") return null;
    return shade(v);
  };
  const zones = [...new Set(surfaces.map((s) => s.zone))].sort();
  // the exterior surfaces' table (the temperature lenses): one line per surface painted, from its first stored row's normal — the stored
  // frame is y-up (x, y, z) → the engine's (x, −z, y); the azimuth clockwise from the project's +y, plus the north axis
  if (ramp === "temp") {
    const seen = new Map<string, NonNullable<Legend["surfaces"]>[number]>();
    const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    for (const r of rows) {
      if (r.id === undefined || !value.has(r.id)) continue;
      const s = (byRow.get(r.id) ?? []).find((x) => x.bc === "Outdoors");
      if (!s || seen.has(s.epName)) continue;
      const ex = r.n[0], ey = -r.n[2], ez = r.n[1];
      const tilt = (Math.acos(Math.max(-1, Math.min(1, ez))) * 180) / Math.PI;
      const az = (((Math.atan2(ex, ey) * 180) / Math.PI + northAxisDeg) % 360 + 360) % 360;
      const room = (s.side === 0 ? r.spaceIfc ?? r.space : r.spaceFacingIfc ?? r.spaceFacing) ?? s.zone;
      const v = value.get(r.id)!;
      seen.set(s.epName, { epName: s.epName, zone: s.zone, room: room ?? s.zone, type: s.type, azimuthDeg: az, facing: tilt < 10 ? "flat" : COMPASS[Math.round(az / 45) % 8]!, tiltDeg: tilt, areaM2: s.grossAreaM2, c: v, color: shade(v) });
    }
    legend.surfaces = [...seen.values()].sort((a, b) => a.zone.localeCompare(b.zone) || a.room.localeCompare(b.room) || a.type.localeCompare(b.type) || b.c - a.c);
  }
  legend.entries = zones.map((z) => { const p = values.peaks?.get(z.toUpperCase()); return { zone: z, color: zoneColor(z), value: zoneVal(z), heatW: p ? p.heatW : null, coolW: p ? p.coolW : null }; });
  return { colorOf, legend };
}
