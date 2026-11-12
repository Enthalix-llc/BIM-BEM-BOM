// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE ENGINE AS AN INSTRUMENT. Writes a geometry-only IDF from the rows read
// back out of idf.db — one BuildingSurface:Detailed per zone side of every
// surface a room or attic claimed, BOTH copies of an inter-zone surface,
// windows as subsurfaces where the engine can take them — so that EnergyPlus
// itself says what stops a run and what it merely notes (2026-09-03, the
// report in references/energyplus-ifc-direct.md). This is not the BEM
// module's IDF: constructions are one generic layer per category and the
// design days are placeholders. Every number the engine checks for GEOMETRY —
// winding, area, pairing, enclosure, subsurface containment — is the stored
// geometry, untouched.
//
// Frame. The store is web-ifc's Y-up metres. The file's project frame is
// (x, y, z) Z-up and web-ifc maps it to (x, z, -y); EnergyPlus is Z-up, so
// the way back is X = x, Y = -z, Z = y — a proper rotation, so winding is
// preserved. The engine takes the winding AS the outward normal (a reversed
// ring puts the sun on the wrong side and says nothing), so every ring is
// oriented here about the zone's OUTWARD normal and then asserted by Newell.

import { specialDayDate } from "./scheduleDays.js";
import type { IdfObject } from "./idfLib.js";
import { WIRED_SIZING_FACTOR } from "./epAssemble.js";
import { SCHEDULE_ROLES, ROLE_CONSUMER, CODE_DEFAULT_SCHEDULE, type ScheduleRole, type ScheduleProfile } from "./schedules.js";
import { layerR, parseIdfObjects } from "./idfLib.js";
import type { GroundRuling, EquipmentGroup } from "./bemDb.js";
import type { TariffCard, PcaRuling } from "../../bom/core/tariff.js";
import type { ResolvedSystems, ResolvedField } from "./bemSystems.js";
import { defaultSystemRows } from "./bemSystems.js";
import type { SystemSection } from "./mepFocus.js";
import { COIL_RATE, ZONE_BALANCE_VARIABLES, ERV_RATE_VARIABLES } from "./eplusSql.js";
import { wallPlanes, exposedEdges, perimeterOf, cFactor, groundDefaultsFor, slabPlan, slabFactors, groundMethodOf, assignKivaWalls, F_TABLE_CITE, type KivaFloorIn, type KivaWallIn } from "./groundCoupling.js";
import type { PlacedOpening } from "../../../core/placeOpenings.js";
import { envelopeOpenings, roofShadePolys, type OpeningAccount } from "./envelopeOpenings.js";
import { isVoidZone } from "../../../core/zones.js";
import type { ResolvedGains } from "./bemGains.js";
import { codeFor, type IeccRow, type IeccTable, energyCodeGap } from "./energyCodes.js";
import { isTree, isDeciduous, DECIDUOUS_TRANSMITTANCE, LEAF_ON_TRANSMITTANCE } from "../../../core/shadingSchedule.js";
import type { ResolvedPv } from "./pvArrays.js";
import { elaCm2, COEFF_SOURCE, type InfilRuling } from "./infiltration.js";

type V3 = [number, number, number];

export interface IdfFaceIn {
  /** the stored row's id in idf.db, so an emitted surface can name its row */
  id?: number;
  elementId: number;
  category: string;
  n: V3;
  outer: V3[];
  holes: V3[][];
  areaM2: number;
  grossAreaM2?: number;
  /** the pair gap the surface came from — a 12" concrete wall is not a 2×6 */
  thicknessM?: number;
  /** the site terrain's verdict when one was read: a below-grade part faces
   *  the earth; a slab's depth below grade decides whether it is on ground */
  grade?: "above" | "below" | null;
  gradeDepthM?: number | null;
  /** the room behind the surface (−n side) and the one it faces (+n) */
  space: string | null;
  spaceFacing: string | null;
  /** the IfcSpace each side came from BEFORE zone rulings — a zone of several
   *  rooms still names each room's own Space (2026-09-04) */
  spaceIfc?: string | null;
  spaceFacingIfc?: string | null;
  /** the windows and doors placed on this cell by their own geometry (idf.db.openings, 2026-09-08) */
  openings?: PlacedOpening[];
}

export interface IdfElementIn {
  globalId: string | null;
  isExternal: boolean | null;
  ifcClass: string;
  /** the element's name and its type (2026-09-08): what a per-type construction ruling is keyed by */
  name?: string | null;
  typeId?: number | null;
  /** a door's glass share as the file states it (idf.db schema 16, 2026-10-07): 0 solid, ≥ GLASS_DOOR_WHOLE a glass door, between
   *  a door SPLIT — the glass centred at the door's proportions (√f each way), the rest opaque; absent = whole by the verdict */
  glazingFraction?: number | null;
}

/** THE DOOR'S GLASS SHARE (the user's ruling, 2026-09-25): a stated fraction at or over this is a whole GlassDoor (a French door's
 *  frame is not split off — the user's word: "near 1 it is a GlassDoor"); under it and over 0 the door is split. A stated bound */
export const GLASS_DOOR_WHOLE = 0.9;

/** the split of a door's rectangle (four vertices, in the base's winding): the glass scaled about the centre by √f, and the opaque
 *  ring as four quadrilaterals between the two outlines — they tile the door, none overlaps the glass, each wound as the door */
export function splitDoor(ring: V3[], f: number): { glass: V3[]; frame: V3[][] } | null {
  if (ring.length !== 4 || !(f > 0 && f < 1)) return null;
  const c: V3 = [0, 1, 2].map((i) => ring.reduce((t, p) => t + p[i]!, 0) / 4) as V3;
  const k = Math.sqrt(f);
  const g = ring.map((p): V3 => [c[0] + (p[0] - c[0]) * k, c[1] + (p[1] - c[1]) * k, c[2] + (p[2] - c[2]) * k]);
  const frame = ring.map((p, i) => { const q = ring[(i + 1) % 4]!; return [p, q, g[(i + 1) % 4]!, g[i]!]; });
  return { glass: g, frame };
}

export interface IdfSite {
  latitude: number;
  longitude: number;
  elevationM: number;
}

export type Bc = "Outdoors" | "Ground" | "Surface" | "Adiabatic" | "GroundFCfactorMethod" | "Foundation";

export type Source = "file" | "dataset" | "code-default" | "user";
export interface Sourced<T> { value: T; source: Source }

export interface IdfSurfaceOut {
  name: string;
  /** the idf.db row this copy came from, and which side of it: 0 = the row's `space`, 1 = `space_facing` */
  idfSurfaceId: number | null;
  side: 0 | 1;
  elementId: number;
  zone: string;
  /** the zone on the other side of the row, when there is one */
  zoneFacing: string | null;
  bc: Bc;
  /** what decided the boundary: the file (IsExternal, the terrain, the rooms) or a default */
  bcSource: Source;
  type: "Wall" | "Floor" | "Ceiling" | "Roof";
  grossAreaM2: number;
  construction: string;
  constructionSource: Source;
  /** THE CODE DEFAULT this surface WOULD take, whatever governs (2026-09-16): the kind the writer's own rule decides for it — the
   *  PLAN's CODE column reads it, so a ruled type still names the code's construction beside its own */
  codeConstruction: string;
}
export interface IdfSubsurfaceOut { name: string; base: string; kind: "Window" | "Door" | "GlassDoor"; holeIndex: number; construction: string; constructionSource: Source; elementId?: number | null; /** the code default's kind (2026-09-16) */ codeConstruction: string; /** the area written (2026-10-01) */ areaM2?: number }
export interface IdfConstructionOut { name: string; kind: string; layers: string[]; uWm2k: number | null; uSource: Source }
/** a schedule ruled for a role and resolved against the library (2026-09-09): the profile carries the objects to emit */
export interface ResolvedSchedule { role: ScheduleRole; profile: ScheduleProfile; source: Source }
/** the schedule each role runs on, as written — the code default in words, or the emitted object with its 24-hour readings */
export interface IdfScheduleOut { role: ScheduleRole; name: string; file: string; cls: string; typeLimits: string | null; source: Source; weekday: number[] | null; weekend: number[] | null; blocks: number; inUse: boolean; note: string }
/** a room's gains as written (2026-09-13): the row bem.db's `rooms` table carries and the ZONES frame reads back */
export interface IdfRoomOut { room: string; zone: string; epName: string; floorM2: number; conditioned: boolean; people: Sourced<number>; peopleNote: string; lightsW: Sourced<number>; lightsNote: string; equipmentW: Sourced<number>;
  equipment: Array<{ id: string; name: string; group?: EquipmentGroup; wattsW: number; subcategory: string; latent: number; radiant: number; lost: number; schedule: string; source: Source; note: string }>; schedules: { occupancy: string | null; lighting: string | null; activity: string | null } }
export interface IdfZoneOut {
  name: string; epName: string;
  conditioned: Sourced<boolean>;
  heatingSetpointC: Sourced<number | null>;
  coolingSetpointC: Sourced<number | null>;
  infiltrationAch: Sourced<number>;
  /** a blower-door ruling's words (2026-10-08): the ACH50, the leakage area written and its coefficients; "" otherwise */
  infiltrationNote: string;
}

export interface IdfWriteReport {
  zones: number;
  zonesWithVolume: number;
  surfaces: number;
  byBc: Record<Bc, { count: number; areaM2: number }>;
  byType: Record<IdfSurfaceOut["type"], number>;
  interZonePairs: number;
  /** a surface whose two sides are one zone — the zone's own partition, not emitted */
  internalPartitions: number;
  windows: number;
  interiorDoors: number;
  /** by the file (2026-09-08): a hole matched to its placed opening is a glass door, an opaque door or a skylight; unmatched holes keep the window path */
  glassDoors: number;
  /** doors split by their stated glass share (2026-10-07): a GlassDoor + four opaque Doors each */
  splitDoors: number;
  exteriorDoors: number;
  skylights: number;
  unmatchedHoles: number;
  holesSkipped: { manyVertices: number; onFloorOrCeiling: number; onAdiabaticOrGround: number };
  /** EVERY EXTERIOR OPENING ACCOUNTED (user, 2026-10-01: "ALL EXTERIOR DOORS MUST BE INCLUDED ... NO EXCEPTION"): per
   *  window and door in an exterior wall or roof, the file's rectangle, what the model carries, and every square metre
   *  that is not written with its reason — envelopeOpenings.ts */
  openingAccounts: OpeningAccount[];
  /** subsurfaces with an edge ON their base's outline: an opening the carve
   *  cut through, half in each cell. Emitted; the engine's CHKSBS warns. */
  holesOnBaseEdge: number;
  /** the energy code's values the writer needs and the user's tables do not hold (energyCodeGap) — null when complete. A model with a
   *  gap is built for the tabs to read; it is never run */
  codeGap: string | null;
  /** surfaces given Ground on the site terrain's word: below-grade wall parts
   *  and slabs at or under the ground line */
  groundFromTerrain: { count: number; areaM2: number };
  /** cells with fewer than three vertices once vertices closer than 1 cm — the
   *  engine's input resolution — are one: slivers the engine would call
   *  degenerate; not emitted */
  belowResolution: { surfaces: number; areaM2: number };
  /** rows no zone claimed: the exterior-facing share is envelope area the
   *  model does not see; the interior share is material between solids */
  unclaimed: { surfaces: number; exteriorSurfaces: number; exteriorAreaM2: number; interiorAreaM2: number;
    exteriorByCategory: Record<string, number>;
    /** the exterior-facing share by element (2026-10-21): its name, category, area and height span, so the red box can say
     *  which walls they are and where they stand against the rooms */
    exteriorElements: Array<{ elementId: number; name: string; category: string; m2: number; zMinM: number; zMaxM: number }> };
  /** THE ROOF OUTSIDE CONDITIONED SPACE (user, 2026-10-01: "the roof area should be tracked by roof over conditioned area
   *  and roof outside of conditioned space providing shade"): a roof cell no zone claims — the eave band, a porch roof — is
   *  written as Shading:Building:Detailed over its own area (the outline less the rooms' cells it wraps), in convex pieces,
   *  so the engine shades the walls, windows and doors under it. `areaM2` must equal the cells' net area */
  roofShade: { cells: number; areaM2: number; surfaces: number; writtenM2: number };
  /** the shading surfaces written from the projected site files (2026-09-15): elements seen, surfaces written, how each element
   *  was taken (its triangles verbatim under the cap, its bounding box's six faces over it, a flat element left out), the trees */
  shading?: { elements: number; surfaces: number; verbatim: number; boxed: number; flat: number; trees: number; triangles: number; /** polygons the engine would call degenerate (< 3 vertices once those within its 1 cm are one, or under 1 cm²) — the file's own zero-area triangles, dropped and counted */ degenerate: number;
    /** the trees written opaque all year: under PixelCounting the engine ignores a transmittance schedule (its own Severe, measured 2026-09-15), so the deciduous schedule is written only under a method that honours it */ treesOpaque: boolean;
    /** PV panels written as their array's top face instead of their triangles (2026-10-02) */ pv?: number };
  /** the PV arrays written (2026-10-02): one Generator:PVWatts per panel on its top face */
  pv?: { panels: number; dcW: number; surfaces: string[]; generators: string[]; refused: string[] };
  /** the Meter:Custom written per Meter card (2026-10-23): its zones, the units it took whole, what it could not take — named, never dropped */
  meters?: Array<{ name: string; emitted: string; zones: string[]; units: string[]; parts: number; left: string[] }>;
  /** the tariff written (2026-10-03): its card, the meter it prices, net metering or not, the PCA when one value was typed */
  tariff?: { card: string; meter: string; net: boolean; pca: number | null };
  /** stored rings wound clockwise about their own stored normal (informational) */
  storedRingsReversed: number;
  /** emitted rings whose Newell normal does not point out of their zone — must be 0 */
  windingViolations: number;
  northAxisDeg: number;
  out: IdfSurfaceOut[];
  subsurfaces: IdfSubsurfaceOut[];
  constructions: IdfConstructionOut[];
  /** a material or construction the namer had to rename (`#2`) — honoured, not silent (2026-09-08) */
  nameCollisions: Array<{ wanted: string; got: string }>;
  /** every zone as written, each value with its source */
  zoneRows: IdfZoneOut[];
  /** the schedule each role runs on (2026-09-09) */
  schedules: IdfScheduleOut[];
  /** every room's gains as written (2026-09-13) */
  rooms: IdfRoomOut[];
  /** the systems the model runs on, per subsection (2026-09-10): the ruled ones as emitted, a default row for each subsection with no ruling */
  systems: IdfSystemOut[];
  /** the rows the writer refused, by idf.db row id and reason — the refusal rule as rows */
  notEmitted: Array<{ idfSurfaceId: number | null; reason: string }>;
  /** the dressing: which constructions were used where, and the defaults taken */
  model: {
    envelope: IdfModel["envelope"];
    /** the climate zone the code default read (2026-09-16); unset = zone 4 assumed */
    climateZone?: string;
    /** the code the default read (2026-09-29): an edition or a state adoption id; unset = the 2018 IECC */
    energyCode?: string;
    idealLoads: boolean;
    conditionedZones: string[];
    unconditionedZones: string[];
    /** floors given Ground because they are the model's lowest floor with nothing below — a default */
    groundFloorsDefault: { count: number; areaM2: number };
    constructionAreaM2: Record<string, number>;
    /** the sizing objects written: a Sizing:Zone per conditioned zone, a Space per IfcSpace (2026-09-04) */
    sizing: { zones: number; spaces: number };
    /** every zone's Spaces as written — one per IfcSpace the zone's surfaces came from */
    spacesByZone: Record<string, string[]>;
  };
  /** THE VOID RULINGS AS WRITTEN (2026-09-18): the voids the user put inside the envelope, the roofs and ceilings that changed
   *  because of it, and the answers that write NOTHING here because they are geometry — carried and named, never silent */
  voids: { ruled: number; inside: number; ventedAttic: number; roofsInsulated: number; ceilingsInterior: number; conditioned: string[];
    notWritten: Array<{ space: string; answer: string; reason: string }> };
  /** the ground coupling as written (2026-09-08): the method, the objects, the exposed perimeter read from the rows */
  ground: { method: "ground" | "fcfactor" | "kiva"; slab: string; kivaUnplaced: string[]; floors: number; walls: number; kivaObjects: number;
    /** THE TURN-UP AT THE SLAB EDGE (2026-10-12): Kiva slabs given a custom block, and those whose edge meets their walls' own layers */
    turnUp: { blocks: number; viaWalls: number }; exposedM: number; perimeterM: number;
    fFactor: string; cFactor: string; wallsWithoutFloor: number; segments: number; exposedSegments: number;
    /** F-factor cells the engine cannot take — A / (P_exp · F) under the films plus its 0.15 m concrete (0.242 m²K/W, Eng. Ref. 3.221–3.223) — left on Ground, counted */
    tooSmallForF: number };
}

const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const neg = (a: V3): V3 => [-a[0], -a[1], -a[2]];

/** Newell's area vector: the ring's normal by the right-hand rule, twice its area */
function newell(ring: V3[]): V3 {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [x, y, z];
}

/** The ring counter-clockwise seen from OUTSIDE (from the +nOut side), starting
 *  at the upper-left corner — GlobalGeometryRules UpperLeftCorner /
 *  Counterclockwise, the same reading the inspectors print. */
function orient(nOut: V3, ring: V3[]): V3[] {
  const up: V3 = Math.abs(nOut[1]) > 0.99 ? [0, 0, -1] : [0, 1, 0];
  const d = dot(up, nOut);
  const vl = Math.hypot(up[0] - d * nOut[0], up[1] - d * nOut[1], up[2] - d * nOut[2]) || 1;
  const v: V3 = [(up[0] - d * nOut[0]) / vl, (up[1] - d * nOut[1]) / vl, (up[2] - d * nOut[2]) / vl];
  const u: V3 = [v[1] * nOut[2] - v[2] * nOut[1], v[2] * nOut[0] - v[0] * nOut[2], v[0] * nOut[1] - v[1] * nOut[0]];
  const uv = ring.map((p): [number, number] => [dot(p, u), dot(p, v)]);
  let twice = 0;
  for (let i = 0; i < uv.length; i++) { const a = uv[i]!, b = uv[(i + 1) % uv.length]!; twice += a[0] * b[1] - b[0] * a[1]; }
  const r = twice < 0 ? [...ring].reverse() : [...ring];
  const proj = twice < 0 ? [...uv].reverse() : uv;
  let start = 0, best = Infinity;
  for (let i = 0; i < proj.length; i++) {
    const score = proj[i]![0] - proj[i]![1];
    if (score < best - 1e-9) { best = score; start = i; }
  }
  return [...r.slice(start), ...r.slice(0, start)];
}

/** web-ifc Y-up → EnergyPlus Z-up (the file's own project frame) */
/** the variable the exterior surfaces' design-day temperatures are read from (2026-10-08) */
export const SURFACE_TEMP_VARIABLE = "Surface Outside Face Temperature";
/** and the INSIDE faces' (2026-11-04): a room's air model (BOM › CFD) holds its walls at these on the design hour */
export const SURFACE_INSIDE_TEMP_VARIABLE = "Surface Inside Face Temperature";
const toEp = (p: V3): V3 => [p[0], -p[2], p[1]];
// a coordinate to 0.1 mm with its trailing zeros dropped — and a plain zero KEPT (2026-09-15: the strip took the lone "0" with it and a
// flat shading element at the ground line went out with an empty z, which the engine refused; no building vertex had ever sat at 0)
const fmt = (x: number): string => (Math.abs(x) < 5e-5 ? "0" : x.toFixed(4).replace(/\.?0+$/, "") || "0");
/** THE SHADING CAPS (2026-09-15), stated: an element over this many triangles is written as its bounding box's six faces; one
 *  under this height (m) is flat on the ground and left out */
export const SHADING_TRI_CAP = 60;
export const SHADING_MIN_HEIGHT_M = 0.3;

const vertsOf = (ring: V3[]): string =>
  ring.map((p) => { const q = toEp(p); return `    ${fmt(q[0])}, ${fmt(q[1])}, ${fmt(q[2])}`; }).join(",\n");

/** the name rule, for the screen's preview of what the IDF will carry: no commas, semicolons or bangs, whitespace collapsed, 90 chars */
export const sanitizeIdfName = (want: string): string => want.replace(/[,;!]/g, "_").replace(/\s+/g, " ").trim().slice(0, 90);
/** an EnergyPlus name: no commas, semicolons or bangs; ≤ 100 chars; unique case-insensitively */
function namer(): (want: string) => string {
  const used = new Set<string>();
  return (want) => {
    const base = sanitizeIdfName(want);
    let name = base, k = 2;
    while (used.has(name.toLowerCase())) name = `${base}#${k++}`;
    used.add(name.toLowerCase());
    return name;
  };
}

/** how many vertices the engine will keep: it drops one closer than 1 cm to its predecessor */
function distinctAt1cm(ring: V3[]): number {
  let n = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) >= 0.01) n++;
  }
  return n;
}

/** how many of a hole's vertices lie on the outer ring's edges (within 0.1 mm) */
function onOutline(hole: V3[], outer: V3[]): number {
  let k = 0;
  for (const p of hole) {
    let on = false;
    for (let i = 0; i < outer.length && !on; i++) {
      const a = outer[i]!, b = outer[(i + 1) % outer.length]!;
      const ab: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ap: V3 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
      const l2 = dot(ab, ab); if (l2 < 1e-12) continue;
      const t = Math.max(0, Math.min(1, dot(ap, ab) / l2));
      on = Math.hypot(ap[0] - t * ab[0], ap[1] - t * ab[1], ap[2] - t * ab[2]) < 1e-4;
    }
    if (on) k++;
  }
  return k;
}

const nKey = (n: V3): string => `${n[0].toFixed(3)}|${n[1].toFixed(3)}|${n[2].toFixed(3)}`;

/** the weather the run is driven by: SizingPeriod:DesignDay objects taken
 *  VERBATIM from the weather file's .ddy (the file's own design conditions,
 *  never invented here) and whether to run the weather file's year too */
export interface IdfWeather {
  designDayIdf: string[];
  /** the .ddy stated no valid cooling design day: take the weather file's own
   *  extreme summer week as the summer sizing period instead */
  summerFromWeatherFile: boolean;
  runYear: boolean;
  epwName: string;
  /** AN ACTUAL YEAR (2026-10-07): the weather file's own first and last days, with their years — the run goes over exactly them, the
   *  calendar (weekdays, the year's own days) the bills were metered under; absent = a typical year, the SITE run period, no year */
  amy?: { begin: [number, number, number]; end: [number, number, number] } | null;
}

/** What the model is dressed in. `generic` is the geometry smoke test: one
 *  layer per category, no HVAC. `irc2018cz4` is the 2018 IRC prescriptive
 *  envelope for climate zone 4 (Table N1102.1.2 / the U-factor alternative
 *  N1102.1.4) — DEFAULT VALUES the user asked for (2026-09-03), stated in the
 *  census, never read from the file — with ideal-loads HVAC in every
 *  conditioned zone at the code's thermostat (72 / 75 °F, the IECC R405 standard reference design) and
 *  the IRC air-leakage limit (3 ACH50) as infiltration. No internal gains,
 *  no mechanical ventilation: the envelope and the weather, nothing else. */
/** a zone's overrides; `heat` / `cool` false (2026-09-14) = that side of the thermostat switched off on the Zone card — its setpoint is put out of reach */
export interface ZoneOverride { conditioned?: boolean; heatingSetpointC?: number; coolingSetpointC?: number; infiltrationAch?: number; heat?: boolean; cool?: boolean;
  /** THE ZONE CARD'S INFILTRATION (2026-10-08): a constant ACH, or the blower-door ACH50 written as an effective leakage area */
  infiltration?: InfilRuling }
/** A SIDE OUT OF REACH (user, 2026-09-14: "cooling checked off means no cooling"): a side the equipment cannot serve, or the Zone card switched
 *  off, keeps a setpoint the zone can never cross — the shape the unit heater has had since 2026-09-11, when a heating-only thermostat made the
 *  engine skip sizing its zone. Nothing calls for that side and no unmet hours count on it. */
export const OUT_OF_REACH = { coolC: 50, heatC: -50 } as const;
/** the site and simulation settings as resolved by buildModel (SITE tab, 2026-09-04):
 *  each a ruling from the ledger, the weather file's word, or the code default */
export interface IdfSiteSettings {
  /** the Building North Axis when ruled; unset = from the file's TrueNorth */
  northAxisDeg?: number;
  timestep: number;
  shadowCalculation: string;
  terrain: string;
  solarDistribution: string;
  runPeriod: { begin: [number, number]; end: [number, number] };
  /** twelve monthly ground temperatures under the building surfaces */
  groundTempsC: number[];
  /** the F/C-factor method's twelve temperatures (the EPW's 0.5 m row when it has one; the engine's 13 °C otherwise) */
  fcfactorGroundTempsC?: number[];
  /** the position ruled on the map (2026-09-07); unset = the IfcSite's */
  location?: { latitude: number; longitude: number; elevationM: number };
  /** the time zone the weather file states (2026-09-15); unset = the longitude's */
  timeZone?: number;
}
/** the five sections of the CONSTRUCTIONS tab (2026-09-08), by the type's class */
export type ConsSection = "roof" | "wall" | "window" | "door" | "floor";
/** a type's construction as RESOLVED from a ruling (bemModel.ts): the objects to emit once
 *  (dataset materials verbatim, or a NoMass / SimpleGlazingSystem built from a stated U),
 *  the layer names outside / top first, the U with its source */
/** a bridged layer as resolved (2026-09-08): its parts, the method, and the R that resulted — what the screen's sub-item rows and the gate read */
export interface ResolvedParts { seq: number; method: "parallel-path" | "isothermal-planes"; rEff: number; rParallel: number; rIsothermal: number; parts: Array<{ name: string; fraction: number; rSi: number }> }
export interface ResolvedConstruction {
  key: string; typeId: number; section: ConsSection; source: Source; label: string;
  /** the Construction's name in the IDF: the user's, else the type's own name — the namer sanitises it */
  name?: string;
  /** an alias: the type whose construction this one takes */
  sameAs?: string;
  objects: IdfObject[]; layers: string[];
  uWm2k: number | null; shgc?: number; vt?: number;
  frame?: IdfObject | null;
  /** the file's layers left out, by number and name (no material picked) — named, never silent */
  dropped?: string[];
  /** the file's layers the user DELETED (2026-09-09) — named in the setting, never silent */
  struck?: string[];
  parts?: ResolvedParts[];
}
/** a system as written (2026-09-10) — the row bem.db's `systems` table carries and the SYSTEMS tab reads back */
export interface IdfSystemOut { id: string; section: SystemSection; kind: string; label: string; source: Source; zones: string[]; objects: number; objectNames: string[];
  fields: Array<{ obj: string; key: string; label: string; value: string; source: Source; units: string | null }>; refused: string[]; note: string }
/** a projected site file's element as idf.db holds it (the ruled shading set), its triangles in the house frame, Y-up metres */
export interface ShadingElementIn { expressId: number; file: string; name: string; ifcClass: string; tris: V3[][] }

/** THE IDF'S VERSION (2026-09-23): the engine that runs the file states it — the program follows whichever EnergyPlus is installed.
 *  Without an engine the file states the version the writer was last verified against (the gate on 26.1.0, 2026-09-23) */
export const IDF_VERSION_VERIFIED = "26.1";
/** "EnergyPlus, Version 26.1.0-6f2e40d102" (or "26.1") → "26.1"; null when no version can be read */
export const idfVersionOf = (engineVersion: string | null | undefined): string | null => { const m = /(\d+)\.(\d+)/.exec(engineVersion ?? ""); return m ? `${m[1]}.${m[2]}` : null; };

export interface IdfModel {
  envelope: "generic" | "irc2018cz4";
  idealLoads: boolean;
  /** the IDF's Version object: the installed engine's major.minor (unset = IDF_VERSION_VERIFIED) */
  version?: string;
  /** THE CLIMATE ZONE THE CODE DEFAULT READS (2026-09-16): the county's, from the location; unset = zone 4 assumed (the row the app always carried) */
  climateZone?: string;
  /** THE ENERGY CODE THE DEFAULT READS (2026-09-29): an edition ("IECC-2018") or a state adoption's id; unset = the 2018 IECC */
  energyCode?: string;
  /** THE SHADING SURFACES (user, 2026-09-15, S6): the projected files' elements, written as Shading:Building:Detailed */
  shading?: ShadingElementIn[];
  /** ELECTRICAL › GENERATION (2026-10-02): the PV panels as PVWatts arrays on their own top faces; null / absent = no PV */
  pv?: ResolvedPv | null;
  /** ELECTRICAL › METERS (user, 2026-10-23): each Meter card's zones — a Meter:Custom of their loads and the units that serve them */
  meters?: Array<{ name: string; zones: string[] }>;
  /** BOM › UTILITY (2026-10-03): the tariff applied — the card's charges as the engine's UtilityCost objects; absent = energy only */
  tariff?: { card: TariffCard; pca?: PcaRuling } | null;
  /** the user's rulings per zone (the BEM ledger); anything unset is the code default */
  zones?: Record<string, ZoneOverride>;
  /** unset = the code defaults the writer always used */
  site?: IdfSiteSettings;
  /** the RULED types' constructions, by type id (2026-09-08); a type absent here takes the code default */
  constructions?: Map<number, ResolvedConstruction>;
  /** A VEGETATED ROOF (user, 2026-10-16: "If it is a green roof, then we need to create a definition for the energyplus model"): the roof
   *  types whose outermost layer the file names as planting or soil, by type id — the soil's thickness and the layer's name as the file
   *  states them. Written as the engine's ecoroof (Material:RoofVegetation) over the code's insulation */
  vegetated?: Map<number, { soilM: number; material: string; typeName: string | null }>;
  /** a door type's TYPED glass share, by type id (2026-10-07) — honoured exactly: 1 whole glass, 0 solid, between split */
  doorGlass?: Map<number, number>;
  /** how the ground-coupled surfaces are modelled (slice 4): unset = plain Ground */
  ground?: GroundRuling;
  /** the schedules ruled per role (2026-09-09), each one of the engine's own objects; a role absent here runs on the writer's default */
  schedules?: Map<ScheduleRole, ResolvedSchedule>;
  /** the user's holidays (SCHEDULES › Holiday, 2026-10-02), days of the year — written as RunPeriodControl:SpecialDays */
  holidays?: number[];
  /** the SYSTEMS rulings resolved (2026-09-10): the objects to emit, the zones they take from ideal loads, the sizing flags; unset = ideal loads everywhere */
  systems?: ResolvedSystems;
  /** the library schedules the systems' fields name by marker (2026-09-14), read into their profiles — emitted once ahead of the systems */
  systemSchedules?: Array<{ profile: ScheduleProfile }>;
  /** the internal gains per room (2026-09-13): People, Lights, ElectricEquipment on every room's Space; unset = none written */
  gains?: ResolvedGains;
  /** THE VOID RULINGS (user, 2026-09-18): per void, WHICH PLANE CARRIES THE INSULATION — the file does not say, and the
   *  answer decides the whole envelope there. Unset, or a void with no ruling, the void is INSIDE the envelope: the roof
   *  over it carries the insulation and the ceiling under it is interior drywall (the project's ruling, 2026-09-20). The
   *  vented attic — a bare deck over it, the insulation on the ceiling — is the answer "insulation at the ceiling". */
  voidRulings?: Map<string, VoidRulingIn>;
}

/** one void's answer as the writer reads it (idf.db's `void_rulings`, the corrections ledger's `voids`) */
export interface VoidRulingIn {
  /** roof · ceiling · not-a-space — and, for a covered roof, make-a-void · shade, which are GEOMETRY and are refused here by name */
  answer: string;
  /** "it opens into conditioned space (a transfer grille)" — the user's word on every void in this project */
  grille: boolean;
}

/** a zone is conditioned unless it is an attic, a crawl space or a garage —
 *  a default by name, the file stating nothing about conditioning */
export const isConditioned = (zone: string): boolean => !isVoidZone(zone) && !/crawl|garage/i.test(zone);

const R_IP = 0.17611;   // m²K/W per h·ft²·°F/Btu
const U_IP = 5.678263;  // W/m²K per Btu/h·ft²·°F
/** THE ENERGY CODE'S ROW (2026-09-16; since 2026-09-29 read from references/energy-codes/ through energyCodes.ts, by edition and by
 *  a state's adoption): the U-factor alternative (assembly U WITH air films), the fenestration SHGC, the slab R and depth, the
 *  air-leakage limit and the reference thermostat — the user's own tables (energyCodes.ts). SHGC "NR" is null, never invented — the
 *  writer keeps 0.40 as a stated default where the code requires none */
export type { IeccRow, IeccTable } from "./energyCodes.js";
/** the code's row for a climate zone and a code (an edition id or a state adoption's; unset = the 2018 IECC): "4A" → zone 4's; Marine
 *  4 → the "5 and Marine 4" row; "8" → "7 and 8"; a zone the table does not know (or none) → zone 4's, said so in `note` */
/** a setpoint as the IDF writes it: two decimals where the value has them — the code's 72 / 75 °F is 22.22 / 23.89 °C, and one
 *  decimal would write 71.96 / 75.02 °F; a whole or one-decimal value keeps one ("20.0", "50.0") */
export function setC(c: number): string { const r = Math.round(c * 100) / 100; return r.toFixed(Number.isInteger(Math.round(r * 10 * 1e6) / 1e6) ? 1 : 2); }
export function ieccFor(zone: string | null | undefined, code?: string | null): ReturnType<typeof codeFor> {
  return codeFor(code, zone);
}
/** the code-default constructions the writer knows, by section — what the CONSTRUCTIONS column names as "code"; the names carry the
 *  zone's own U (the U SELF-CHECK reads it back from the name) */
/** a code default's kind as the writer names it → its catalogue row's kind: the method's suffix and, for a slab, where its insulation lies
 *  (2026-10-10) are the model's, not the code's */
export function catalogueKindOf(kind: string): string {
  return kind.replace(/ \((Kiva|not modelled by a constant ground temperature)\)$/, "").replace(/^(slab on grade R-[\d.]+) (under the full slab|at the edge, .*)$/, "$1");
}
export function dressKinds(zone: string | null | undefined, code?: string | null): Record<ConsSection, string[]> {
  const t = ieccFor(zone, code);
  const shgc = (t.fenestrationSHGC ?? 0.40).toFixed(2);
  return {
    wall: [`IRC frame wall U${t.frameWallU.toFixed(3)}`, `IRC basement wall U${t.basementWallU.toFixed(3)}`, "interior partition"],
    roof: [`IRC ceiling U${t.ceilingU.toFixed(3)} (cathedral roof)`, "roof deck over attic", `IRC ceiling U${t.ceilingU.toFixed(3)} (attic floor)`, "interior ceiling"],
    floor: [t.slabR > 0 ? `slab on grade R-${t.slabR}` : "slab on grade (uninsulated)", `IRC floor U${t.floorU.toFixed(3)}`, "interior floor"],
    window: [`IRC fenestration U${t.fenestrationU.toFixed(2)} SHGC${shgc}`, `IRC skylight U${t.skylightU.toFixed(2)} SHGC${shgc}`],
    door: [`IRC door U${t.fenestrationU.toFixed(2)}`, "interior door"],
  };
}
/** THE CODE CATALOGUE (2026-09-16, the user's ruling 2: "just list the nominal U-value and/or SHGC as applicable"): every code kind
 *  the writer knows with the TABLE's nominal U (W/m²K; the writer's construction reproduces it — the U SELF-CHECK and the gate's
 *  CODE COLUMN line read both), the SHGC where one applies, and its layers in words — for a kind the model never wrote (every
 *  cell of that kind ruled), the CODE column still has its name and number; a kind the code gives no U (a partition, a roof deck
 *  over an attic, a slab stated as an R) says so */
/** the VT the code-default glazing is written with: the IECC states no visible transmittance, and a SimpleGlazingSystem
 *  needs a number — a STATED DEFAULT, said so wherever it is shown (the views read it from here, never a literal) */
export const CODE_VT = 0.5;
export interface CodeKindEntry { kind: string; section: ConsSection; uWm2k: number | null; shgc: number | null; vt: number | null; layers: string }
export function codeCatalogue(zone: string | null | undefined, code?: string | null): CodeKindEntry[] {
  const t = ieccFor(zone, code), k = dressKinds(zone, code), ip = (u: number): number => u * U_IP, shgc = t.fenestrationSHGC ?? 0.40;
  return [
    { kind: k.wall[0]!, section: "wall", uWm2k: ip(t.frameWallU), shgc: null, vt: null, layers: "cavity insulation to the code's U + gypsum board 12.7 mm" },
    { kind: k.wall[1]!, section: "wall", uWm2k: ip(t.basementWallU), shgc: null, vt: null, layers: "wall insulation to the code's U + concrete 200 mm" },
    { kind: k.wall[2]!, section: "wall", uWm2k: null, shgc: null, vt: null, layers: "gypsum board · air 0.18 · gypsum board — not the thermal envelope, no code U" },
    { kind: k.roof[0]!, section: "roof", uWm2k: ip(t.ceilingU), shgc: null, vt: null, layers: "built-up asphalt roofing 9.5 mm + roof insulation to the code's U + gypsum board 12.7 mm — a standard flat roof" },
    { kind: k.roof[1]!, section: "roof", uWm2k: null, shgc: null, vt: null, layers: "shingles · plywood 19 mm — the attic floor under it carries the code's U" },
    { kind: k.roof[2]!, section: "roof", uWm2k: ip(t.ceilingU), shgc: null, vt: null, layers: "ceiling insulation to the code's U + gypsum board 12.7 mm" },
    { kind: k.roof[3]!, section: "roof", uWm2k: null, shgc: null, vt: null, layers: "air 0.18 · gypsum board 12.7 mm — a ceiling under a void the user ruled INSIDE the envelope: the roof over it carries the insulation, so this is not the thermal envelope and has no code U" },
    { kind: k.floor[0]!, section: "floor", uWm2k: null, shgc: null, vt: null, layers: t.slabR > 0 ? `slab edge insulation R-${t.slabR} to ${t.slabDepthFt} ft (R402.2.10: from the top of the slab, vertical, under the slab or out from the building) + concrete 100 mm — the code states an R and a distance, not a U; where it lies and how the engine takes it are ruled in the Floors section` : "concrete 100 mm, no insulation — the code requires none in this zone" },
    { kind: k.floor[1]!, section: "floor", uWm2k: ip(t.floorU), shgc: null, vt: null, layers: "floor insulation to the code's U + plywood 19 mm" },
    { kind: k.floor[2]!, section: "floor", uWm2k: null, shgc: null, vt: null, layers: "gypsum board · air 0.18 · plywood 19 mm — not the thermal envelope, no code U" },
    { kind: k.window[0]!, section: "window", uWm2k: ip(t.fenestrationU), shgc, vt: CODE_VT, layers: "one SimpleGlazingSystem at the code's U and SHGC" },
    { kind: k.window[1]!, section: "window", uWm2k: ip(t.skylightU), shgc, vt: CODE_VT, layers: "one SimpleGlazingSystem at the code's skylight U and SHGC" },
    { kind: k.door[0]!, section: "door", uWm2k: ip(t.fenestrationU), shgc: null, vt: null, layers: "one NoMass layer at the code's fenestration U less the films" },
    { kind: k.door[1]!, section: "door", uWm2k: null, shgc: null, vt: null, layers: "door wood 45 mm — an interior door, no code U" },
  ];
}

/** WHAT A UNIT'S ELECTRICITY IS REPORTED AS (2026-10-23, the meters): each written class's own electricity variables. A template's parts
 *  are named by the engine's expansion for its zone ("APT A PTHP HEATING COIL" — read from a run's eplusout.mtd); a class not listed
 *  that runs on electricity is NAMED as not taken, so its use stays on the building's total and the meter says so */
const ELEC_PARTS: Array<[RegExp, string[]]> = [
  [/^Fan:/, ["Fan Electricity Energy"]],
  [/^Coil:Heating:DX:/, ["Heating Coil Electricity Energy", "Heating Coil Defrost Electricity Energy", "Heating Coil Crankcase Heater Electricity Energy"]],
  [/^Coil:Heating:Electric/, ["Heating Coil Electricity Energy"]],
  [/^Coil:Cooling:DX/, ["Cooling Coil Electricity Energy"]],
  [/^Coil:Heating:WaterToAirHeatPump:/, ["Heating Coil Electricity Energy"]],
  [/^Coil:Cooling:WaterToAirHeatPump:/, ["Cooling Coil Electricity Energy"]],
  [/^Pump:/, ["Pump Electricity Energy"]],
  [/^ZoneHVAC:Baseboard:\w+:Electric$/, ["Baseboard Electricity Energy"]],
];
const TEMPLATE_PARTS: Record<string, (z: string) => Array<[string, string]>> = {
  "HVACTemplate:Zone:PTHP": (z) => [[`${z} PTHP Heating Coil`, "Heating Coil Electricity Energy"], [`${z} PTHP Heating Coil`, "Heating Coil Defrost Electricity Energy"], [`${z} PTHP Heating Coil`, "Heating Coil Crankcase Heater Electricity Energy"],
    [`${z} PTHP Cooling Coil`, "Cooling Coil Electricity Energy"], [`${z} PTHP Supp Heating Coil`, "Heating Coil Electricity Energy"], [`${z} PTHP Supply Fan`, "Fan Electricity Energy"]],
  "HVACTemplate:Zone:PTAC": (z) => [[`${z} PTAC Heating Coil`, "Heating Coil Electricity Energy"], [`${z} PTAC Cooling Coil`, "Cooling Coil Electricity Energy"], [`${z} PTAC Supply Fan`, "Fan Electricity Energy"]],
};
/** an object's electricity parts (key, variable); [] when it uses none; null when it may and cannot be named */
function electricParts(cls: string, emitted: string): Array<[string, string]> | null {
  const t = TEMPLATE_PARTS[cls];
  if (t) return t(emitted);
  if (/^HVACTemplate:(Zone|System):/.test(cls)) return /IdealLoadsAirSystem$/.test(cls) ? [] : null;
  const e = ELEC_PARTS.find(([re]) => re.test(cls));
  if (e) return e[1].map((v) => [emitted, v]);
  return /^(Fan|Pump|Humidifier|WaterHeater|ZoneHVAC:Baseboard|HeatPump|Chiller|Boiler:.*Electric)/.test(cls) ? null : [];
}

export function writeIdf(
  faces: IdfFaceIn[],
  elements: Map<number, IdfElementIn>,
  zoneVolumesM3: Map<string, number>,
  site: IdfSite | null,
  trueNorth: [number, number] | null,
  sourceName: string,
  weather: IdfWeather | null = null,
  model: IdfModel = { envelope: "generic", idealLoads: false },
): { idf: string; report: IdfWriteReport } {
  const name = namer();
  const L: string[] = [];
  const obj = (type: string, ...fields: Array<string | number>): void => {
    L.push(`${type},\n` + fields.map((f) => `    ${f}`).join(",\n") + ";\n");
  };

  // ── the building's grid against the file's true north. TrueNorth is the
  //    direction of true north in the project's (x, y); EnergyPlus wants the
  //    project +Y's bearing clockwise from true north. web-ifc's plan (x, z)
  //    has z = −y, so (tx, tz) → (tx, −tz) is the file's own pair again.
  let northAxis = 0;
  if (trueNorth) {
    const tx = trueNorth[0], ty = -trueNorth[1];
    const bearingOfTrueNorth = (Math.atan2(tx, ty) * 180) / Math.PI;   // clockwise from +Y
    northAxis = ((-bearingOfTrueNorth % 360) + 360) % 360;
  }
  const site$: IdfSiteSettings = model.site ?? {
    timestep: 4, shadowCalculation: "PixelCounting", terrain: "Suburbs", solarDistribution: "FullExterior",
    runPeriod: { begin: [1, 1], end: [12, 31] }, groundTempsC: Array(12).fill(18),
  };
  if (site$.northAxisDeg !== undefined) northAxis = site$.northAxisDeg;

  L.push(`! Geometry smoke test written from idf.db (${sourceName}) — the engine as an instrument.\n` +
    `! Not the BEM deliverable: one generic construction per category, placeholder design days.\n` +
    `! Frame: X = x, Y = -z, Z = y of the store (web-ifc Y-up metres -> the file's Z-up project frame).\n`);
  obj("Version", model.version ?? IDF_VERSION_VERIFIED);
  // zone sizing on with ideal loads: the engine's own design loads per zone
  // and per space at the design days (user, 2026-09-04) — it needs a
  // Sizing:Zone per zone, which the template expansion does not write
  // (measured: 0 in the expanded file), so the writer emits them below
  // a ruled System:* is autosized by the engine's own system sizing, a plant by its plant sizing (2026-09-10) — the flags move only under a ruling
  obj("SimulationControl", model.idealLoads ? "Yes" : "No", model.systems?.needSystemSizing ? "Yes" : "No", model.systems?.needPlantSizing ? "Yes" : "No", "Yes", weather?.runYear ? "Yes" : "No", "No", "1");
  obj("Building", name(sourceName.replace(/\.[^.]+$/, "")), northAxis.toFixed(2), site$.terrain, "0.04", "0.4",
    site$.solarDistribution, "25", "6");
  // a GREEN ROOF wants at least 12 timesteps an hour (the IDD's note on Timestep; the engine warns "CalcEcoRoof: Too few time steps
  // per hour for stability") — raised to 12 when the file has one, and said in the IDF
  const ecoTs = model.vegetated?.size && site$.timestep < 12 ? 12 : null;
  if (ecoTs) L.push(`! Timestep ${site$.timestep} raised to ${ecoTs}: a vegetated roof (Material:RoofVegetation) wants at least 12 per hour`);
  obj("Timestep", String(ecoTs ?? site$.timestep));
  // the space heat balance for sizing: the Space Sensible tables of the sizing summary
  obj("ZoneAirHeatBalanceAlgorithm", "ThirdOrderBackwardDifference", model.idealLoads ? "Yes" : "No", "No");
  // Relative, with every zone at the origin and no relative north: the ONLY
  // way the Building North Axis is applied. Under World coordinates the
  // engine leaves the vertices as given and the Laundry east wall read 90°
  // with a 22° axis stated (measured 2026-09-03); Relative reads 112°, ESE,
  // the QA's own true-north compass.
  obj("GlobalGeometryRules", "UpperLeftCorner", "Counterclockwise", "Relative");
  // pixel counting has no convexity rule: the carve's L-shaped cells cast
  // shadows too. Polygon clipping raised 28 Severes for non-convex casters
  // on this file; pixel counting raised none (2.3 s against 0.9 s). Needs a
  // GPU; the engine falls back to polygon clipping with a warning without one.
  obj("ShadowCalculation", site$.shadowCalculation, "Periodic", "20", "15000", "SutherlandHodgman", "512",
    "SimpleSkyDiffuseModeling", "No", "No", "No");
  obj("Output:Diagnostics", "DisplayExtraWarnings");
  obj("Output:Surfaces:List", "Details");
  // THE RESULTS ARE READ FROM THE ENGINE'S OWN DATABASE: eplusout.sql, opened
  // with sql.js like every other file in the contract. The dictionary is the
  // engine's own list of what it can report (an unknown name is a warning,
  // not a stop). Monthly and run-period frequencies keep the file small;
  // hourly comes with its own milestone.
  // the tables in the sql stay in SI (kWh for energy) whatever units the HTML report is written in (2026-10-11: the report follows Show
  // Imperial at run time; the app's readers read the sql)
  obj("Output:SQLite", "SimpleAndTabular", "JtoKWH");
  obj("Output:VariableDictionary", "IDF");
  obj("Output:Variable", "*", "Zone Mean Air Temperature", "Monthly");
  obj("Output:Variable", "*", "Zone Infiltration Sensible Heat Loss Energy", "Monthly");
  obj("Output:Variable", "*", "Surface Inside Face Conduction Heat Transfer Energy", "Monthly");
  obj("Output:Variable", "*", "Surface Outside Face Conduction Heat Transfer Energy", "Monthly");
  obj("Output:Variable", "*", "Surface Window Heat Gain Energy", "Monthly");
  obj("Output:Variable", "*", "Surface Window Heat Loss Energy", "Monthly");
  // THE OUTSIDE FACE TEMPERATURES ON THE DESIGN DAYS (user, 2026-10-08: "can the energyplus produce exterior surface temperatures at peak
  // loads? … mapped onto the exterior surfaces" — the Great room's south roof under the panels against the Bed 1 roof). Every surface's
  // outside face, each hour, ONLY on the design days the zones' peaks come from: the output's own schedule is 1 on a SummerDesignDay or
  // WinterDesignDay and 0 on every day of the weather run, so the year adds nothing to the results file
  const ddOnly = name("design days only");
  obj("Schedule:Compact", ddOnly, "", "Through: 12/31", "For: SummerDesignDay WinterDesignDay", "Until: 24:00", "1", "For: AllOtherDays", "Until: 24:00", "0");
  obj("Output:Variable", "*", SURFACE_TEMP_VARIABLE, "Hourly", ddOnly);
  // the inside faces too (user, 2026-11-03: "we will need to pick up interior surface temperatures for roof, walls, door and windows") —
  // a room's CFD case holds each wall, window and door at its inside face temperature of the design hour
  obj("Output:Variable", "*", SURFACE_INSIDE_TEMP_VARIABLE, "Hourly", ddOnly);
  // THE STRUCTURE'S PEAK (user, 2026-10-11: "each structure to sum the loads for each zone at each structure's peak load … so we can make
  // sure the structure's actual equipment is sized correctly"): every coil's rate at each zone timestep on the design days (the sizing
  // basis) and by the hour over the weather year — the house's per-zone units summed at the instant they peak TOGETHER
  // the outdoor dry-bulb by the hour (user, 2026-10-03: RUN plots the outside high, low and average) — the engine's own reading of the
  // run's weather file, so the temperature lines are the weather the energy lines ran on
  obj("Output:Variable", "Environment", "Site Outdoor Air Drybulb Temperature", "Hourly");
  // the position: the IfcSite's, or the one the user located on the map
  const loc = site$.location ?? site;
  if (loc) {
    obj("Site:Location", name("site"), loc.latitude.toFixed(4), loc.longitude.toFixed(4),
      (site$.timeZone ?? Math.round(loc.longitude / 15)).toString(), loc.elevationM.toFixed(1));
  }
  if (weather && weather.designDayIdf.length) {
    L.push(`! design days from ${weather.epwName}'s .ddy, verbatim\n`);
    for (const dd of weather.designDayIdf) L.push(dd.trim() + "\n");
  } else {
    // placeholder design days — the run needs a sizing period to exist at all
    obj("SizingPeriod:DesignDay", "smoke winter", "1", "21", "WinterDesignDay", "-7.0", "0.0", "DefaultMultipliers", "",
      "Wetbulb", "-7.0", "", "", "", "", "101325", "4.0", "0", "No", "No", "No", "ASHRAEClearSky", "", "", "", "", "0.0");
    obj("SizingPeriod:DesignDay", "smoke summer", "7", "21", "SummerDesignDay", "34.0", "10.0", "DefaultMultipliers", "",
      "Wetbulb", "24.0", "", "", "", "", "101325", "3.5", "230", "No", "No", "No", "ASHRAEClearSky", "", "", "", "", "1.0");
  }
  if (weather?.summerFromWeatherFile) {
    obj("SizingPeriod:WeatherFileConditionType", name(`${weather.epwName} extreme summer week`), "SummerExtreme", "Monday", "No", "Yes");
  }
  if (weather?.runYear && weather.amy) {
    const b = weather.amy.begin, e = weather.amy.end;
    obj("RunPeriod", name(`actual weather ${b.join("-")} to ${e.join("-")}`),
      String(b[1]), String(b[2]), String(b[0]), String(e[1]), String(e[2]), String(e[0]), "", "Yes", "Yes", "No", "Yes", "Yes");
    for (const n of model.holidays ?? []) obj("RunPeriodControl:SpecialDays", name(`holiday ${specialDayDate(n)}`), specialDayDate(n), "1", "Holiday");
  } else if (weather?.runYear) {
    const rp = site$.runPeriod;
    obj("RunPeriod", name(`${weather.epwName} ${rp.begin[0] === 1 && rp.begin[1] === 1 && rp.end[0] === 12 && rp.end[1] === 31 ? "year" : `${rp.begin[0]}-${rp.begin[1]} to ${rp.end[0]}-${rp.end[1]}`}`),
      String(rp.begin[0]), String(rp.begin[1]), "", String(rp.end[0]), String(rp.end[1]), "", "", "Yes", "Yes", "No", "Yes", "Yes");
    // THE USER'S HOLIDAYS (2026-10-02): every schedule the engine reads takes its Holiday rule on these days
    for (const n of model.holidays ?? []) obj("RunPeriodControl:SpecialDays", name(`holiday ${specialDayDate(n)}`), specialDayDate(n), "1", "Holiday");
  }

  // ── CONSTRUCTIONS. A library of layer lists, outside → inside, registered
  //    on first use; an inter-zone pair's second copy takes the reversed list,
  //    as the engine requires. Generic: one layer per category. IRC: the
  //    2018 prescriptive envelope for climate zone 4, assembly U-factors with
  //    films, so each NoMass layer is the assembly R less the films and the
  //    real layers beside it (the engine adds films itself).
  const materials = new Map<string, string>();
  const rOfMat = new Map<string, number | null>();      // each material's own R, so every construction's U comes from its stack
  /** a name the namer had to change is RECORDED for materials and constructions (a `#2` is honoured, never silent) */
  const collisions: Array<{ wanted: string; got: string }> = [];
  const named = (want: string): string => { const got = name(want); if (got.toLowerCase() !== sanitizeIdfName(want).toLowerCase()) collisions.push({ wanted: sanitizeIdfName(want), got }); return got; };
  const material = (key: string, def: () => void, rSi: number | null): string => {
    let mn = materials.get(key);
    if (!mn) { mn = named(key); materials.set(key, mn); rOfMat.set(mn, rSi); def(); }
    return mn;
  };
  const fieldsOf = new Map<string, string>();           // what was emitted under a name: two sources may share one name with different numbers
  const mass = (key: string, rough: string, thick: number, k: number, rho: number, cp: number): string =>
    material(key, () => obj("Material", materials.get(key)!, rough, thick.toFixed(4), k.toFixed(3), rho.toFixed(0), cp.toFixed(0), "0.9", "0.7", "0.7"), thick / k);
  const nomass = (key: string, rSi: number): string =>
    material(key, () => obj("Material:NoMass", materials.get(key)!, "MediumRough", rSi.toFixed(3), "0.9", "0.7", "0.7"), rSi);
  /** the same R as a REGULAR material — XPS at 0.029 W/m·K, its thickness R × k — for the surfaces Kiva models,
   *  which may carry no Material:NoMass (the engine's rule) */
  const xps = (key: string, rSi: number): string => mass(`${key} as XPS`, "MediumRough", Math.max(0.003, rSi * 0.029), 0.029, 35, 1400);
  const noMassR = new Map<string, number>();   // emitted NoMass names → R, so a ruled stack can be made Kiva-safe
  /** a dataset object (or one the resolver built), emitted once, its fields verbatim */
  const libMat = (o: IdfObject): string => {
    const sig = `${o.cls}|${o.fields.slice(1).join("|")}`;
    // the same name from another source with other numbers is another material, named for its source — never silently the first
    const key = fieldsOf.has(o.name) && fieldsOf.get(o.name) !== sig ? `${o.name} (${o.file.replace(/^materials:/, "").replace(/\.idf$/, "")})` : o.name;
    if (!fieldsOf.has(key)) fieldsOf.set(key, sig);
    const n = material(key, () => { if (o.file === "built" && o.note) L.push(`! ${o.note}`); obj(o.cls, materials.get(key)!, ...o.fields.slice(1)); }, layerR(o));
    if (o.cls === "Material:NoMass" || o.cls === "Material:AirGap") noMassR.set(n, layerR(o) ?? 0.1);
    return n;
  };
  const gypsum = (): string => mass("gypsum board 12.7 mm", "Smooth", 0.0127, 0.16, 800, 1090);
  const builtUp = (): string => mass("built-up roofing 9.5 mm", "Rough", 0.0095, 0.16, 1120, 1460);
  /** THE ENGINE'S VEGETATED ROOF (Material:RoofVegetation), its plant and soil properties those of the engine's own example
   *  (ExampleFiles/EcoroofOrlando.idf, BaseEco) — the soil's thickness the file's; the Simple moisture diffusion, which the engine
   *  advises when Advanced would need more than its 60 timesteps an hour; then an EPDM membrane, the insulation to the code's
   *  U (the soil's and the membrane's R taken out), gypsum. The engine wants the vegetated layer outermost */
  const greenRoof = (soilM: number): string[] => {
    const soil = Math.max(0.05, Math.min(0.7, soilM)), kSoil = 0.4;
    const veg = material(`green roof vegetation ${(soil * 1000).toFixed(0)} mm soil`, () => obj("Material:RoofVegetation", materials.get(`green roof vegetation ${(soil * 1000).toFixed(0)} mm soil`)!,
      "0.5", "5", "0.2", "0.95", "180", "green roof soil", "MediumSmooth", soil.toFixed(4), kSoil.toFixed(2), "641", "1100", "0.95", "0.8", "0.7", "0.4", "0.01", "0.2", "Simple"), soil / kSoil);
    const epdm = mass("EPDM membrane 6 mm", "Smooth", 0.006, 0.25, 1150, 2000);
    return [veg, epdm, nomass("roof insulation under a green roof", Math.max(0.1, rOf(irc.ceilingU) - FILM.ceiling - soil / kSoil - 0.006 / 0.25 - R_GYP)), gypsum()];
  };
  const plywood = (): string => mass("plywood 19 mm", "MediumSmooth", 0.019, 0.12, 540, 1210);
  const concrete = (thick: number): string => mass(`concrete ${(thick * 1000).toFixed(0)} mm`, "MediumRough", thick, 1.7, 2300, 900);
  const constructions = new Map<string, string>();
  const consSource = new Map<string, Source>();
  const FILM = { wall: 0.15, ceiling: 0.14, floor: 0.21 };            // m²K/W, in + out, what the engine adds — ASHRAE HOF "Surface Conductances and Resistances for Air": still air 0.12 / 0.11 / 0.16 in, 15 mph 0.03 out (idfLib.ts FILMS has the table)
  /** register a construction once; its U is 1 / (ΣR of its own layers + the films) unless stated (a glazing's) —
   *  the IRC kinds reproduce the number they are named for, which the gate checks */
  const construction = (key: string, layers: () => string[], film: number, stated: { u: number | null; source: Source } | null = null): string => {
    let cn = constructions.get(key);
    if (!cn) {
      cn = named(key); constructions.set(key, cn);
      const ls = layers();
      obj("Construction", cn, ...ls);
      let u: number | null = stated?.u ?? null;
      if (u === null) {
        let r = 0, known = true;
        for (const l of ls) { const x = rOfMat.get(l); if (x === null || x === undefined) known = false; else r += x; }
        u = known && ls.length ? 1 / (r + film) : null;
      }
      const source: Source = stated?.source ?? "code-default";
      consSource.set(cn, source);
      consList.push({ name: cn, kind: key.replace(/ reversed$/, ""), layers: ls, uWm2k: u, uSource: source });
    }
    return cn;
  };
  /** the same layers in the other order, for the other copy of a pair */
  const reversedOf = new Map<string, string>();
  const layerLists = new Map<string, string[]>();
  const constructionRev = (key: string, layers: string[], film: number, stated: { u: number | null; source: Source } | null = null): [string, string] => {
    const fwd = construction(key, () => layers, film, stated);
    layerLists.set(fwd, layers);
    let rev = reversedOf.get(fwd);
    if (!rev) {
      const sym = layers.every((l, i) => l === layers[layers.length - 1 - i]);
      rev = sym ? fwd : construction(`${key} reversed`, () => [...layers].reverse(), film, stated);
      reversedOf.set(fwd, rev);
    }
    return [fwd, rev];
  };
  /** a RULED type's construction (2026-09-08): its objects emitted once, its layers far side first for
   *  the copy that asks — outside / top first is the resolver's order; a Floor copy sees its zone above,
   *  so the stack turns; the frame, when ruled, emitted once */
  const frames = new Map<string, string>();
  const ruled = (rc: ResolvedConstruction, type: IdfSurfaceOut["type"], kivaBound = false): { kind: string; layers: string[]; film: number; stated: { u: number | null; source: Source } } => {
    for (const o of rc.objects) libMat(o);
    let ordered = rc.layers.map((n) => materials.get(n)).filter((n): n is string => !!n);
    // Kiva takes regular materials only: a NoMass layer in a ruled stack becomes XPS of the same R
    if (kivaBound) ordered = ordered.map((n) => (noMassR.has(n) ? xps(n, noMassR.get(n)!) : n));
    const film = rc.section === "roof" ? FILM.ceiling : rc.section === "floor" ? FILM.floor : FILM.wall;
    // the Construction's name: the user's, else the type's own (2026-09-08) — the label stays the settings' word
    const kind = rc.name ?? rc.label;
    return { kind: kivaBound ? `${kind} (Kiva)` : kind, layers: type === "Floor" ? [...ordered].reverse() : ordered, film, stated: { u: rc.uWm2k, source: rc.source } };
  };
  const frameOf = (rc: ResolvedConstruction): string => {
    if (!rc.frame) return "";
    let fn = frames.get(rc.frame.name);
    if (!fn) { fn = name(rc.frame.name); frames.set(rc.frame.name, fn); obj(rc.frame.cls, fn, ...rc.frame.fields.slice(1)); }
    return fn;
  };
  // THE CODE'S ROW FOR THE ZONE (2026-09-16): the zone the user entered for the county; zone 4's row when none is entered — the names
  // carry the row's U. A row the user's tables leave incomplete is REFUSED here, before a line is written: no value is invented
  const irc = ieccFor(model.climateZone, model.energyCode);
  // A ROW THE USER'S TABLES LEAVE INCOMPLETE (2026-10-15): the model is still built, so ZONES, SCHEDULES and SYSTEMS can be worked on
  // before a code is entered; the gap is named on the report, and the RUN (and the IDF written out) refuses it — no value is invented
  const codeGap = energyCodeGap(irc);
  // THE SLAB'S INSULATION (2026-10-10): the method (Kiva unless ruled) and where the insulation lies — at the edge, the code's distance under
  // the slab from the wall's inside face, or under the full slab — read before any construction is dressed
  const gm = groundMethodOf(model.ground);
  const slab = slabPlan(model.ground, irc);
  const ftOf = (m: number): string => `${+(m / 0.3048).toFixed(2)} ft`;
  const kinds = dressKinds(model.climateZone, model.energyCode);
  const rOf = (uIp: number): number => 1 / (uIp * U_IP);
  // per zone: the user's ruling when there is one, the code default otherwise
  const ov = (z: string): ZoneOverride => model.zones?.[z] ?? {};
  // a zone a ruled SYSTEM takes (2026-09-10) is conditioned by that ruling, whatever the name or the ZONES ledger say
  const taken = (z: string): boolean => model.systems?.zoneSystem.has(z) ?? false;
  // THE VOID RULINGS (user, 2026-09-18), read once. `inside` means the user put the void INSIDE the thermal envelope —
  // the insulation is at the roof, or the space is a cavity in the floor assembly — which is what decides both of its
  // planes below. `make-a-void` and `shade` answer a GEOMETRY question (a roof with another roof over it and no space
  // between); no construction follows from them, so they are carried and NAMED, never quietly applied.
  const voidRule = (z: string | null | undefined): VoidRulingIn | undefined => (z ? model.voidRulings?.get(z) : undefined);
  // THE PROJECT'S RULING (the user, 2026-09-18 and again in full on 2026-09-20: "ALL ROOFS ARE INSULATED, SO ANY VOID
  // BELOW IT IS INTERIOR"): a void this app builds is INSIDE the thermal envelope, and the vented attic — the insulation
  // on the ceiling with a bare deck over it — is the EXCEPTION the user has to rule ("insulation at the ceiling"). It
  // was the other way round until now, so every void nobody had clicked came out vented: a model error here, because
  // the ceiling under a void is DRYWALL — the void's floor and the room's ceiling — and insulating it insulates one
  // heat path twice while leaving the roof above it bare.
  const voidVented = (z: string | null | undefined): boolean => voidRule(z)?.answer === "ceiling";
  const voidInside = (z: string | null | undefined): boolean => !!z && isVoidZone(z) && !voidVented(z);
  const voidGeometryOnly = [...(model.voidRulings ?? new Map<string, VoidRulingIn>())].filter(([, r]) => r.answer === "make-a-void" || r.answer === "shade");
  const condOf = (z: string): boolean => taken(z) || (ov(z).conditioned ?? voidCond(z) ?? isConditioned(z));
  /** INSIDE THE THERMAL ENVELOPE — the test the envelope's constructions ask, and NOT `conditioned`, which is about HVAC:
   *  a sealed void inside the envelope has no thermostat and is still inside. A crawl space or a garage is outside it,
   *  as `isConditioned` has always said. */
  const insideEnvelope = (z: string | null): boolean => !!z && (condOf(z) || voidInside(z));
  /** a void the user ruled: a transfer grille into conditioned space, or a cavity inside the floor assembly, is CONDITIONED —
   *  a stated modelling choice for "it opens into conditioned space", said in the zone's setting; a sealed void inside the
   *  envelope is left unconditioned and floats between its own surfaces, which is what it does */
  function voidCond(z: string): boolean | undefined {
    const r = voidRule(z); if (!r) return undefined;
    if (r.answer === "not-a-space") return true;
    if (r.answer === "roof" && r.grille) return true;
    if (r.answer === "ceiling") return false;                    // a vented attic is outside the envelope, grille or not
    return undefined;
  }
  const heatOf = (z: string): number => ov(z).heatingSetpointC ?? irc.heatingSetpointC;
  const coolOf = (z: string): number => ov(z).coolingSetpointC ?? irc.coolingSetpointC;
  // the two sides (2026-09-14): what the zone's equipment can do (the resolver's word) and what the Zone card switched off
  const capOf = (z: string): { heat: boolean; cool: boolean } => model.systems?.zoneCapability?.get(z) ?? { heat: true, cool: true };
  const heats = (z: string): boolean => capOf(z).heat && ov(z).heat !== false;
  const cools = (z: string): boolean => capOf(z).cool && ov(z).cool !== false;
  // ACH ≈ ACH50 / N, N ≈ 20 — Sherman, M. H. (1987), "Estimation of infiltration from leakage and climate indicators", Energy and Buildings 10(1):
  // 81–86, the LBL rule of thumb (N 20 for a one-storey house in a mild climate; a two-storey house in a cold one reads ~14): a stated
  // default for this climate zone. 0.5 ACH for an unconditioned zone (an attic, a crawl space, the garage) is a stated default.
  // 0.5 ACH is what a VENTED attic, a crawl space or a garage exchanges with outdoors; a void INSIDE the envelope takes
  // the envelope's own rate, since its air is the house's (2026-09-20: the 0.5 was the external venting this project has not got)
  const infOf = (z: string): InfilRuling | undefined => ov(z).infiltration;
  const achOf = (z: string): number => { const r = infOf(z); return r?.method === "ach" ? r.ach : ov(z).infiltrationAch ?? (insideEnvelope(z) ? irc.ach50 / 20 : 0.5); };
  /** a blower-door ruling written as ZoneInfiltration:EffectiveLeakageArea — null when the zone has no volume to turn ACH50 into a flow */
  const elaOf = (z: string): { cm2: number; cs: number; cw: number; ach50: number; note: string } | null => {
    const r = infOf(z), v = zoneVolumesM3.get(z);
    if (r?.method !== "ach50" || !v || v <= 0) return null;
    if (r.cs === undefined || r.cw === undefined) throw new Error(`zone ${z}: the blower-door ruling needs the stack and wind coefficients (Cs, Cw) typed on its Zone card — ${COEFF_SOURCE}`);
    const cm2 = elaCm2(r.ach50, v), cs = r.cs, cw = r.cw;
    return { cm2, cs, cw, ach50: r.ach50, note: `${r.ach50} ACH50 × ${v.toFixed(1)} m³ → effective leakage area ${cm2.toFixed(0)} cm² at 4 Pa · Cs ${cs} · Cw ${cw} as typed` };
  };
  const src = (set: boolean): Source => (set ? "user" : "code-default");
  const consList: IdfConstructionOut[] = [];
  const R_GYP = 0.0127 / 0.16, R_BUR = 0.0095 / 0.16, R_PLY = 0.019 / 0.12, R_CONC200 = 0.2 / 1.7;
  interface Dress { kind: string; layers: string[]; film: number; stated?: { u: number | null; source: Source }; /** the code default's kind this surface would take, whatever governs (2026-09-16) */ code: string }
  /** THE CODE DEFAULT for a surface, its layers LAZY (2026-09-16): the kind is decided for EVERY surface — a ruled one too, so the
   *  PLAN's CODE column can name it — and the materials are made only when the code construction is actually written. A thunk makes
   *  exactly the materials the code path always made, in the same order (the material helper emits on first use, and the standing
   *  IDF is byte-identical) */
  const codeDress = (cat: string, bc: Bc, zoneA: string, zoneB: string | null, thick: number, type: IdfSurfaceOut["type"], kivaBound: boolean): { kind: string; layers: () => string[]; film: number } => {
    // a surface Kiva models carries its insulation as a regular material (the engine's rule), the same R
    const insul = kivaBound ? xps : nomass;
    if (model.envelope === "generic") {
      const g: Record<string, [string, number, number, number, number]> = {
        exteriorWall: ["Rough", 0.20, 0.5, 800, 1000], interiorWall: ["MediumSmooth", 0.12, 0.3, 600, 1000],
        roof: ["Rough", 0.25, 0.4, 700, 1000], floor: ["MediumRough", 0.20, 1.0, 1400, 1000], ceiling: ["Smooth", 0.02, 0.16, 800, 1090],
      };
      const [r, th, k, rho, cp] = g[cat] ?? g.interiorWall!;
      return { kind: `generic ${cat}`, layers: () => [mass(`generic ${cat} layer`, r, th, k, rho, cp)], film: FILM.wall };
    }
    const inA = insideEnvelope(zoneA), inB = zoneB ? insideEnvelope(zoneB) : false;
    if (cat === "exteriorWall" || (cat === "interiorWall" && bc !== "Surface") || (cat === "interiorWall" && inA !== inB)) {
      // the thermal envelope: a frame wall, or a concrete wall by its thickness
      if (thick >= 0.25) return { kind: `${kinds.wall[1]}${kivaBound ? " (Kiva)" : ""}`, layers: () => [insul("basement wall insulation", rOf(irc.basementWallU) - FILM.wall - R_CONC200), concrete(0.2)], film: FILM.wall };
      return { kind: `${kinds.wall[0]}${kivaBound ? " (Kiva)" : ""}`, layers: () => [insul("frame wall cavity", rOf(irc.frameWallU) - FILM.wall - R_GYP), gypsum()], film: FILM.wall };
    }
    if (cat === "interiorWall") return { kind: kinds.wall[2]!, layers: () => [gypsum(), nomass("partition air 0.18", 0.18), gypsum()], film: FILM.wall };
    if (cat === "roof") {
      // a roof over a void the user put INSIDE the envelope carries the insulation, as any other roof does; over a void
      // they ruled a vented attic (or left unruled) it is the bare deck the vented convention wants
      if (voidVented(zoneA) || voidVented(zoneB)) return { kind: kinds.roof[1]!, layers: () => [nomass("shingles", 0.08), plywood()], film: FILM.ceiling };
      // A STANDARD FLAT ROOF (user, 2026-10-16: "Assume a standard flat roof if not clarified or defined (asphalt)"): a built-up asphalt
      // membrane outside (ASHRAE HOF 2005 F13 built-up roofing 9.5 mm), the insulation to the code's U, gypsum inside — the U unchanged
      return { kind: kinds.roof[0]!, layers: () => [builtUp(), nomass("roof insulation", rOf(irc.ceilingU) - FILM.ceiling - R_GYP - R_BUR), gypsum()], film: FILM.ceiling };
    }
    // a ceiling under a void inside the envelope is an INTERIOR surface: the insulation is on the roof above it, and
    // insulating both planes would insulate the same heat path twice
    if (cat === "ceiling") {
      // THE R-38 CEILING BELONGS TO A TRUE VENTED ATTIC AND TO NOTHING ELSE (the user, 2026-09-20: "WHERE ARE YOU GETTING
      // THIS R-38 ceiling attic floor for any space except a true vented attic? Why would a crawl space have an r38
      // ceiling?"). A first cut of this change gave it to any ceiling whose two sides straddled the envelope — a garage,
      // a crawl space — which is the same error in a new place: there is no attic there and no reason for R-38. A ceiling
      // is the thermal barrier under a VENTED ATTIC, and nowhere else; every other ceiling is what the file draws,
      // drywall on furring, an interior plane. (Measured on this file: every ceiling cell is bc Surface — no ceiling
      // here is an envelope surface at all, and the gate asserts it.)
      if (voidVented(zoneA) || voidVented(zoneB)) return { kind: kinds.roof[2]!, layers: () => [nomass("ceiling insulation", rOf(irc.ceilingU) - FILM.ceiling - R_GYP), gypsum()], film: FILM.ceiling };
      return { kind: kinds.roof[3]!, layers: () => [nomass("ceiling air 0.18", 0.18), gypsum()], film: FILM.ceiling };
    }
    // floors: seen from the first copy, whose zone is above when the type is Floor
    // a slab: the zone's R under the slab (the code means the perimeter), none where the code requires none (zones 1–3)
    // a slab: under the FULL slab its R is a layer of the slab's own construction; at the EDGE the slab is concrete alone and the strip is
    // Kiva's interior horizontal insulation (or, under the F-factor method, the table's horizontal row) — a constant ground temperature cannot
    // place a strip, and says so in the slab's name rather than insulating the whole slab for it
    if (bc === "Ground") {
      if (slab.r <= 0) return { kind: `slab on grade (uninsulated)${kivaBound ? " (Kiva)" : ""}`, layers: () => [concrete(0.1)], film: FILM.floor };
      if (slab.extent === "full") return { kind: `slab on grade R-${slab.r} under the full slab${kivaBound ? " (Kiva)" : ""}`, layers: () => [insul(`slab insulation R-${slab.r}`, slab.r * R_IP), concrete(0.1)], film: FILM.floor };
      return { kind: `slab on grade R-${slab.r} at the edge, ${ftOf(slab.distM)} under the slab${kivaBound ? " (Kiva)" : gm === "ground" ? " (not modelled by a constant ground temperature)" : ""}`, layers: () => [concrete(0.1)], film: FILM.floor };
    }
    const insulated = bc === "Outdoors" || (bc === "Surface" && inA !== inB);
    // the insulation and the plywood are made first for every floor off the ground, an interior one included — as the code path
    // always did (the IDF's material order holds)
    const floorMats = (): { below: string[]; above: string[] } => { const ins = nomass("floor insulation", rOf(irc.floorU) - FILM.floor - R_PLY); return { below: [ins, plywood()], above: [plywood(), ins] }; };
    if (insulated) return { kind: kinds.floor[1]!, layers: () => { const m = floorMats(); return type === "Floor" ? m.below : m.above; }, film: FILM.floor };
    return { kind: kinds.floor[2]!, layers: () => { floorMats(); return type === "Floor" ? [gypsum(), nomass("floor air 0.18", 0.18), plywood()] : [plywood(), nomass("floor air 0.18", 0.18), gypsum()]; }, film: FILM.floor };
  };
  /** the construction for a surface, seen from its FIRST copy: layers run from the far side to that copy's zone. A RULED type
   *  answers first (2026-09-08); the code default's kind rides beside it either way */
  const dress = (cat: string, bc: Bc, zoneA: string, zoneB: string | null, thick: number, type: IdfSurfaceOut["type"], typeId: number | null | undefined, kivaBound = false): Dress => {
    const cd = codeDress(cat, bc, zoneA, zoneB, thick, type, kivaBound);
    const rc = typeId !== null && typeId !== undefined ? model.constructions?.get(typeId) : undefined;
    if (rc) return { ...ruled(rc, type, kivaBound), code: cd.kind };
    // the file's GREEN ROOF, unruled: the engine's vegetated roof outside, the code's insulation under it, the U the code's
    const veg = cat === "roof" && bc === "Outdoors" && typeId !== null && typeId !== undefined ? model.vegetated?.get(typeId) : undefined;
    if (veg) return { kind: `green roof · ${kinds.roof[0]!}`, layers: greenRoof(veg.soilM), film: FILM.ceiling, code: cd.kind };
    return { kind: cd.kind, layers: cd.layers(), film: cd.film, code: cd.kind };
  };
  // the code-default glazing and doors; a skylight and an exterior door register on first use so an
  // IDF without them does not carry them (2026-09-08: fenestration U 0.32 — 2018; 0.35 was 2015's)
  let glazing: string, door: string;
  let skylightCons: () => string, extDoorCons: () => string;
  if (model.envelope === "generic") {
    obj("WindowMaterial:SimpleGlazingSystem", name("smoke glazing layer"), "2.0", "0.4", "0.6");
    glazing = construction("smoke glazing", () => ["smoke glazing layer"], FILM.wall, { u: 2.0, source: "code-default" });
    door = construction("smoke door", () => [mass("door wood 45 mm", "MediumSmooth", 0.045, 0.15, 600, 1200)], FILM.wall);
    skylightCons = () => glazing; extDoorCons = () => door;
  } else {
    // the SHGC: the zone's, or 0.40 kept as a stated default where the code requires none (NR, zones 5–8 and Marine 4)
    const shgc = irc.fenestrationSHGC ?? 0.40;
    const gl = kinds.window[0]!;
    obj("WindowMaterial:SimpleGlazingSystem", name(`${gl} layer`), (irc.fenestrationU * U_IP).toFixed(3), shgc.toFixed(2), CODE_VT.toFixed(1));
    glazing = construction(gl, () => [`${gl} layer`], FILM.wall, { u: irc.fenestrationU * U_IP, source: "code-default" });
    door = construction("interior door", () => [mass("door wood 45 mm", "MediumSmooth", 0.045, 0.15, 600, 1200)], FILM.wall);
    skylightCons = () => {
      const sk = kinds.window[1]!;
      if (!constructions.has(sk)) obj("WindowMaterial:SimpleGlazingSystem", name(`${sk} layer`), (irc.skylightU * U_IP).toFixed(3), shgc.toFixed(2), CODE_VT.toFixed(1));
      return construction(sk, () => [`${sk} layer`], FILM.ceiling, { u: irc.skylightU * U_IP, source: "code-default" });
    };
    // an opaque exterior door is vertical fenestration in the code: the fenestration U, less the films, as one layer
    extDoorCons = () => construction(kinds.door[0]!, () => [nomass("exterior door", rOf(irc.fenestrationU) - FILM.wall)], FILM.wall);
  }
  /** the placed opening whose rectangle holds a hole's centroid, in the cell's plane — the file's word on what the hole is */
  const openingOf = (f: IdfFaceIn, hole: V3[]): PlacedOpening | null => {
    if (!f.openings?.length) return null;
    const c: V3 = [0, 0, 0];
    for (const p of hole) { c[0] += p[0] / hole.length; c[1] += p[1] / hole.length; c[2] += p[2] / hole.length; }
    const ax = Math.abs(f.n[0]), ay = Math.abs(f.n[1]), az = Math.abs(f.n[2]);
    const [u, v]: [0 | 1 | 2, 0 | 1 | 2] = ax >= ay && ax >= az ? [1, 2] : ay >= az ? [0, 2] : [0, 1];
    let best: PlacedOpening | null = null, bestD = 0.3;
    for (const o of f.openings) {
      const q = o.quad;
      let inside = false;
      for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
        const a = q[i]!, b = q[j]!;
        if ((a[v] > c[v]) !== (b[v] > c[v]) && c[u] < ((b[u] - a[u]) * (c[v] - a[v])) / (b[v] - a[v]) + a[u]) inside = !inside;
      }
      if (inside) return o;
      const qc: V3 = [0, 0, 0];
      for (const p of q) { qc[0] += p[0] / q.length; qc[1] += p[1] / q.length; qc[2] += p[2] / q.length; }
      const d = Math.hypot(qc[0] - c[0], qc[1] - c[1], qc[2] - c[2]);
      if (d < bestD) { bestD = d; best = o; }
    }
    return best;
  };

  // ── zones: every name a claimed surface carries, rooms and attics alike
  const zoneNames = [...new Set(faces.flatMap((f) => [f.space, f.spaceFacing]).filter((z): z is string => !!z))].sort();
  const zoneEp = new Map<string, string>();
  let zonesWithVolume = 0;
  for (const z of zoneNames) {
    const zn = name(z);
    zoneEp.set(z, zn);
    const vol = zoneVolumesM3.get(z);
    if (vol && vol > 0) zonesWithVolume++;
    obj("Zone", zn, "0", "0", "0", "0", "1", "1", "autocalculate", vol && vol > 0 ? vol.toFixed(3) : "autocalculate",
      "autocalculate", "", "", "Yes");
  }

  // ── spaces: one Space per IfcSpace a zone's surfaces came from, named by
  //    the room; with no zone rulings each zone holds exactly its own room.
  //    The engine accepted a Space named as its zone (measured 2026-09-04).
  const spacesOf = new Map<string, Map<string, string>>();
  const spaceEpOf = (zone: string, ifc: string): string => {
    const m = spacesOf.get(zone) ?? new Map<string, string>();
    let ep = m.get(ifc);
    // a zone's own room keeps the zone's name — the namer would make it "room#2";
    // a room ruled into another zone, or an attic, is named as itself
    if (!ep) { ep = ifc === zone ? zoneEp.get(zone)! : name(ifc); m.set(ifc, ep); spacesOf.set(zone, m); }
    return ep;
  };

  // ── surfaces. Names: <GlobalId>-<segment>.<cell>~<zone>, the segment being
  //    the element's plane in a stable order (the inspectors' convention),
  //    the cell its ordinal on that plane.
  const segOf = new Map<number, string[]>();
  for (const f of faces) {
    const keys = segOf.get(f.elementId) ?? [];
    if (!keys.includes(nKey(f.n))) { keys.push(nKey(f.n)); segOf.set(f.elementId, keys); }
  }
  for (const keys of segOf.values()) keys.sort();
  const cellCount = new Map<string, number>();

  const report: IdfWriteReport = {
    codeGap,
    zones: zoneNames.length, zonesWithVolume, surfaces: 0,
    byBc: { Outdoors: { count: 0, areaM2: 0 }, Ground: { count: 0, areaM2: 0 }, Surface: { count: 0, areaM2: 0 }, Adiabatic: { count: 0, areaM2: 0 }, GroundFCfactorMethod: { count: 0, areaM2: 0 }, Foundation: { count: 0, areaM2: 0 } },
    byType: { Wall: 0, Floor: 0, Ceiling: 0, Roof: 0 },
    roofShade: { cells: 0, areaM2: 0, surfaces: 0, writtenM2: 0 },
    interZonePairs: 0, internalPartitions: 0, windows: 0, interiorDoors: 0, glassDoors: 0, splitDoors: 0, exteriorDoors: 0, skylights: 0, unmatchedHoles: 0, openingAccounts: [],
    holesSkipped: { manyVertices: 0, onFloorOrCeiling: 0, onAdiabaticOrGround: 0 },
    holesOnBaseEdge: 0,
    groundFromTerrain: { count: 0, areaM2: 0 },
    belowResolution: { surfaces: 0, areaM2: 0 },
    unclaimed: { surfaces: 0, exteriorSurfaces: 0, exteriorAreaM2: 0, interiorAreaM2: 0, exteriorByCategory: {}, exteriorElements: [] },
    storedRingsReversed: 0, windingViolations: 0, northAxisDeg: northAxis, out: [],
    subsurfaces: [], constructions: consList, notEmitted: [], nameCollisions: collisions, schedules: [], systems: [], rooms: [],
    zoneRows: zoneNames.map((z): IdfZoneOut => ({
      name: z, epName: zoneEp.get(z)!,
      conditioned: { value: condOf(z), source: src(ov(z).conditioned !== undefined || taken(z)) },
      heatingSetpointC: condOf(z) && model.idealLoads && heats(z) ? { value: heatOf(z), source: src(ov(z).heatingSetpointC !== undefined) } : { value: null, source: "code-default" as Source },
      coolingSetpointC: condOf(z) && model.idealLoads && cools(z) ? { value: coolOf(z), source: src(ov(z).coolingSetpointC !== undefined) } : { value: null, source: "code-default" as Source },
      infiltrationAch: { value: model.envelope === "generic" || elaOf(z) ? 0 : achOf(z), source: src(ov(z).infiltrationAch !== undefined || !!infOf(z)) },
      infiltrationNote: model.envelope === "generic" ? "" : elaOf(z)?.note ?? (infOf(z)?.method === "ach50" ? "ACH50 ruled, but the zone has no volume to turn it into a flow — the code default written" : ""),
    })),
    model: { envelope: model.envelope, climateZone: model.climateZone, energyCode: model.energyCode, idealLoads: model.idealLoads,
      conditionedZones: zoneNames.filter(condOf), unconditionedZones: zoneNames.filter((z) => !condOf(z)),
      sizing: { zones: 0, spaces: 0 }, spacesByZone: {},
      groundFloorsDefault: { count: 0, areaM2: 0 }, constructionAreaM2: {} },
    ground: { method: groundMethodOf(model.ground), slab: "", kivaUnplaced: [], floors: 0, walls: 0, kivaObjects: 0, turnUp: { blocks: 0, viaWalls: 0 }, exposedM: 0, perimeterM: 0, fFactor: "", cFactor: "", wallsWithoutFloor: 0, segments: 0, exposedSegments: 0, tooSmallForF: 0 },
    voids: {
      ruled: model.voidRulings?.size ?? 0,
      inside: zoneNames.filter((z) => isVoidZone(z) && !voidVented(z)).length,
      ventedAttic: [...(model.voidRulings ?? new Map<string, VoidRulingIn>())].filter(([, r]) => r.answer === "ceiling").length,
      roofsInsulated: 0, ceilingsInterior: 0,
      conditioned: zoneNames.filter((z) => voidCond(z) === true),
      notWritten: voidGeometryOnly.map(([space, r]) => ({ space, answer: r.answer,
        reason: r.answer === "shade"
          ? "the roof above only shades this one — a shading surface, not a construction: no space lies between them and the writer builds none"
          : "the roof above closes a void over this one — a SPACE the carve never built: geometry, not a construction; nothing is written for it here" })),
    },
  };
  // ── GROUND COUPLING (2026-09-08): the method ruled for the model, the IRC defaults as its numbers,
  //    the exterior wall planes the exposure test reads, and — for Kiva — the one floor cell per zone
  //    its below-grade walls reference (the largest on the ground; every floor cell its own object)
  const KIVA_MIN_WALL_H = 0.1;   // m: a below-grade part thinner than this is not a wall Kiva can weight — stated, counted
  const gd = groundDefaultsFor(irc);   // the slab by the model's zone and edition (the code table), the wall's R a stated default
  const gr = { slabR: slab.r, slabDepthM: slab.distM, wallR: model.ground?.wallR ?? gd.wallR };
  const gSrc: Source = model.ground ? "user" : "code-default";
  const walls = gm === "ground" ? [] : wallPlanes(faces);
  const sf = slabFactors(slab, model.ground?.fIp), fF = sf.placed, cF = cFactor(gr.wallR, model.ground?.cIp);
  // THE F/C METHOD WRITES THE USER'S TYPED FACTORS — none typed, the model is refused, never written with an invented number
  if (gm === "fcfactor" && (!Number.isFinite(fF.wmK) || !Number.isFinite(cF.wm2K)))
    throw new Error(`the F/C-factor ground method needs the slab's F-factor and the below-grade walls' C-factor, typed on CONSTRUCTIONS › Floors from your copy of ASHRAE 90.1 Appendix A (Tables A6.3.1 and A4.2.1) — ${!Number.isFinite(fF.wmK) ? "F" : ""}${!Number.isFinite(fF.wmK) && !Number.isFinite(cF.wm2K) ? " and " : ""}${!Number.isFinite(cF.wm2K) ? "C" : ""} not entered; or choose Kiva`);
  report.ground.fFactor = `${fF.ip} Btu/h·ft·°F = ${fF.wmK.toFixed(3)} W/m·K (${fF.entry})`;
  report.ground.slab = `R-${slab.r} ${slab.extent === "full" ? "under the full slab" : `at the edge, ${ftOf(slab.distM)} under the slab from the wall's inside face`} · the code ${slab.codeR > 0 ? `R-${slab.codeR} to ${ftOf(slab.codeDistM)}` : "none"} · F as placed ${fF.ip} (${fF.entry}) · F of the code's assembly ${sf.code.ip} (${sf.code.entry}) — ${F_TABLE_CITE}`;
  report.ground.cFactor = `${cF.ip} Btu/h·ft²·°F = ${cF.wm2K.toFixed(3)} W/m²K (${cF.entry})`;
  /** a floor cell on the ground and the one zone over it: the side whose outward normal points DOWN is the
   *  ground side — a slab's kept plane is its top, so the room is the side it FACES (+n) and `space` is empty */
  const groundFloorZone = (f: IdfFaceIn): string | null => {
    if (f.category !== "floor" || f.gradeDepthM === undefined || f.gradeDepthM === null || f.gradeDepthM < -0.1) return null;
    if (f.space && !f.spaceFacing && f.n[1] < -0.5) return f.space;
    if (f.spaceFacing && !f.space && f.n[1] > 0.5) return f.spaceFacing;
    return null;
  };
  // KIVA'S WALLS EACH ON THE SLAB THEY STAND ON (2026-10-11; groundCoupling.assignKivaWalls): every floor cell on the ground that Kiva
  // can take (not a sliver — the stated bounds) and every below-grade wall part tall enough, matched within their zone, no floor given
  // more wall length than its own perimeter — the engine's rule, which a zone card merging rooms had broken
  const wallH = (f: IdfFaceIn): number => { const ys = f.outer.map((p) => p[1]); return Math.max(...ys) - Math.min(...ys); };
  const faceKey = new Map<IdfFaceIn, string>(faces.map((f, i) => [f, String(i)] as const));
  const keyFace = new Map<string, IdfFaceIn>(faces.map((f, i) => [String(i), f] as const));
  const kivaFloorFits = (f: IdfFaceIn): boolean => {
    const g = f.grossAreaM2 ?? f.areaM2, ex = perimeterOf(f.outer, exposedEdges(f.outer, walls)).exposedM;
    return g >= 0.25 && (ex <= 0 || g / ex >= 0.1);
  };
  const kivaFloorsIn: KivaFloorIn[] = [], kivaWallsIn: KivaWallIn[] = [];
  if (gm === "kiva") for (const f of faces) {
    const z = groundFloorZone(f);
    if (z && kivaFloorFits(f)) kivaFloorsIn.push({ key: faceKey.get(f)!, zone: z, ring: f.outer });
    if (f.category === "exteriorWall" && f.grade === "below" && f.space && !f.spaceFacing && f.outer.length >= 3 && wallH(f) >= KIVA_MIN_WALL_H) kivaWallsIn.push({ key: faceKey.get(f)!, zone: f.space, ring: f.outer });
  }
  const kivaAssign = assignKivaWalls(kivaFloorsIn, kivaWallsIn);
  report.ground.kivaUnplaced = kivaAssign.unplaced.map((u) => { const f = keyFace.get(u.key)!; return `#${f.elementId} [${f.space}] — ${u.why}`; });
  const kivaBoundOf = (f: IdfFaceIn, zone: string, bc: Bc, type: IdfSurfaceOut["type"]): boolean =>
    gm === "kiva" && bc === "Ground" && ((type === "Floor" && groundFloorZone(f) === zone) || (type === "Wall" && f.category === "exteriorWall" && !!kivaAssign.wallFloor.get(faceKey.get(f)!)));
  const kivaName = (f: IdfFaceIn): string => `kiva #${f.id ?? f.elementId}`;
  const kivaMade = new Map<string, string>();
  let kivaInsulation: string | null = null;
  const kivaSlabCons = new Map<string, string>();   // a wall-less Kiva slab → its floor's construction, for its turn-up's depth
  const kivaFor = (f: IdfFaceIn, hasWalls: boolean): string => {
    const kn = kivaName(f);
    const made = kivaMade.get(kn);
    if (made) return made;
    // the settings once, stated: the engine's soil, a zero-flux deep boundary 15 m down (its autocalculation put it 1.2 m down, above the insulation)
    if (!kivaMade.size) obj("Foundation:Kiva:Settings", "", "", "", "", "", "", "", "ZeroFlux", "15", "", "", "Hourly");
    const named = name(kn);
    kivaMade.set(kn, named);
    // THE EDGE STRIP AS INTERIOR HORIZONTAL INSULATION (2026-10-10): right under the slab (depth 0 from the slab's bottom), the distance in
    // from the wall's inside face — Kiva wants a Material with a thickness: XPS at 0.029 W/m·K. Never interior VERTICAL: Kiva measures that
    // from the foundation wall's TOP, the wall's own inside face, which the walls' constructions already insulate (this project: inside).
    // Under the full slab the insulation is a layer of the slab's construction and the object carries none
    // THE TURN-UP (user, 2026-10-12: "the below slab insulation turns up at perimeter wall"): the strip continues up the slab's edge to its
    // top. Kiva puts each instance's slab top its wall's height below the wall top and moves none of the custom blocks with it, so a block
    // lands at the edge only where that height is one number: a slab with NO walls (its slab top is the wall top, z 0) takes the block —
    // x −its thickness (inward of the wall's inside face), z 0, the slab's own thickness deep (filled in once the slab's construction is
    // written). A slab WITH walls takes none: Kiva runs each wall's own construction down past the slab to its bottom, so the slab edge
    // already meets the walls' layers — the inside insulation this project's below-grade walls carry
    const ins = (): string => (kivaInsulation ??= mass(`XPS R-${gr.slabR} (${(gr.slabR * R_IP * 0.029 * 1000).toFixed(0)} mm)`, "MediumRough", gr.slabR * R_IP * 0.029, 0.029, 35, 1400));
    const turnUp = slab.r > 0 && !hasWalls ? [ins(), `@@KIVA_TURNUP_DEPTH ${named}@@`, (-gr.slabR * R_IP * 0.029).toFixed(4), "0"] : [];
    if (slab.r > 0) { if (hasWalls) report.ground.turnUp.viaWalls++; else report.ground.turnUp.blocks++; }
    if (slab.extent === "edge" && slab.r > 0) {
      obj("Foundation:Kiva", named, "", ins(), "0", gr.slabDepthM.toFixed(3), "", "", "", "", "", "", "", hasWalls ? "0" : "0.2", "0", ...(turnUp.length ? ["", "", "", ...turnUp] : []));
    } else obj("Foundation:Kiva", named, "", "", "", "", "", "", "", "", "", "", "", hasWalls ? "0" : "0.2", "0", ...(turnUp.length ? ["", "", "", ...turnUp] : []));
    report.ground.kivaObjects++;
    return named;
  };
  // the model's lowest floor: a floor cell there with nothing below sits on
  // the ground — a default, counted, not a fact the file states
  const floorLow = (f: IdfFaceIn): number => Math.min(...f.outer.map((p) => p[1]));
  const lowestFloor = Math.min(...faces.filter((f) => f.category === "floor" && (f.space || f.spaceFacing)).map(floorLow));
  // EVERY EXTERIOR OPENING FROM ITS OWN RECTANGLE (2026-10-01): the cells a subsurface may stand on are the ones this loop
  // writes with an Outdoors side; the module says, for every other, why not — the same tests, in the same order
  const env = envelopeOpenings(faces, (f) => {
    if (!f.space && !f.spaceFacing) return "unclaimed by any zone";
    if (f.space && f.space === f.spaceFacing) return "internal partition (one zone on both sides)";
    if (f.space && f.spaceFacing) return "between two zones";
    if (distinctAt1cm(f.outer) < 3) return "below the engine's 1 cm resolution";
    if (f.category === "exteriorWall" && f.grade === "below") return "below grade (on the ground)";
    return null;
  });
  report.openingAccounts = env.accounts;
  // a roof cell outside conditioned space as shading polygons: its own area in convex pieces of 3 or 4 vertices, each
  // at the engine's resolution (vertices within 1 cm are one; a sliver under 1 cm² is dropped — counted in the identity)
  const roofPolys = (f: IdfFaceIn): V3[][] => roofShadePolys(f).filter((q) => distinctAt1cm(q) >= 3 && Math.hypot(...newell(q)) / 2 >= 1e-4);

  for (const f of faces) {
    const el = elements.get(f.elementId);
    const gid = el?.globalId ?? `#${f.elementId}`;
    const seg = (segOf.get(f.elementId)!.indexOf(nKey(f.n)) + 1);
    const ck = `${f.elementId}|${seg}`;
    const cell = (cellCount.get(ck) ?? 0) + 1;
    cellCount.set(ck, cell);
    if (dot(newell(f.outer), f.n) < 0) report.storedRingsReversed++;

    if (!f.space && !f.spaceFacing && f.category === "roof" && model.envelope !== "generic") {
      // roof outside conditioned space: shade, not envelope (the user's ruling, 2026-10-01)
      report.notEmitted.push({ idfSurfaceId: f.id ?? null, reason: ROOF_SHADE_REASON });
      const rs = report.roofShade;
      rs.cells++; rs.areaM2 += f.areaM2;
      roofPolys(f).forEach((poly, i) => { obj("Shading:Building:Detailed", name(`roof shade ${gid}-${seg}.${cell} p${i + 1}`), "", poly.length, vertsOf(poly).trimStart()); rs.surfaces++; rs.writtenM2 += Math.hypot(...newell(poly)) / 2; });
      continue;
    }
    if (!f.space && !f.spaceFacing) {
      report.unclaimed.surfaces++;
      report.notEmitted.push({ idfSurfaceId: f.id ?? null, reason: "unclaimed by any zone" });
      // exterior-facing: an exterior wall's or roof's kept face, or an external slab
      const exteriorFacing = f.category === "exteriorWall" || f.category === "roof" ||
        (f.category === "floor" && el?.isExternal === true);
      if (exteriorFacing) {
        report.unclaimed.exteriorSurfaces++; report.unclaimed.exteriorAreaM2 += f.areaM2;
        report.unclaimed.exteriorByCategory[f.category] = (report.unclaimed.exteriorByCategory[f.category] ?? 0) + f.areaM2;
        const ys = f.outer.map((q) => q[1]);
        const byEl = report.unclaimed.exteriorElements;
        const e = byEl.find((x) => x.elementId === f.elementId) ??
          byEl[byEl.push({ elementId: f.elementId, name: el?.name ?? `${el?.ifcClass ?? "element"} ${gid}`, category: f.category, m2: 0, zMinM: Infinity, zMaxM: -Infinity }) - 1]!;
        e.m2 += f.areaM2; e.zMinM = Math.min(e.zMinM, ...ys); e.zMaxM = Math.max(e.zMaxM, ...ys);
      }
      else report.unclaimed.interiorAreaM2 += f.areaM2;
      continue;
    }
    if (f.space && f.space === f.spaceFacing) { report.internalPartitions++; report.notEmitted.push({ idfSurfaceId: f.id ?? null, reason: "internal partition (one zone on both sides)" }); continue; }
    if (distinctAt1cm(f.outer) < 3) { report.belowResolution.surfaces++; report.belowResolution.areaM2 += f.areaM2; report.notEmitted.push({ idfSurfaceId: f.id ?? null, reason: "below the engine's 1 cm resolution" }); continue; }

    const sides: Array<{ zone: string; nOut: V3; other: string | null; ifc: string }> = [];
    if (f.space) sides.push({ zone: f.space, nOut: f.n, other: f.spaceFacing, ifc: f.spaceIfc ?? f.space });
    if (f.spaceFacing) sides.push({ zone: f.spaceFacing, nOut: neg(f.n), other: f.space, ifc: f.spaceFacingIfc ?? f.spaceFacing });
    const grown = env.base.get(f);
    const gross = grown ? Math.hypot(...newell(grown)) / 2 : f.grossAreaM2 ?? f.areaM2;
    const baseName = `${gid}-${seg}.${cell}`;
    const copyName = (zone: string): string => `${baseName}~${zone}`;
    const names = new Map<string, string>();
    for (const s of sides) names.set(s.zone, name(copyName(s.zone)));
    if (sides.length === 2) report.interZonePairs++;

    let pairCons: [string, string] | null = null;
    let pairCode = "";   // the code default's kind for the pair (2026-09-16)
    for (const s of sides) {
      let bc: Bc;
      let bcSource: Source = "file";       // the rooms, IsExternal, the terrain: the file's own word
      if (s.other) bc = "Surface";
      else if (f.category === "exteriorWall") bc = f.grade === "below" ? "Ground" : "Outdoors";
      else if (f.category === "roof") bc = "Outdoors";
      else if (f.category === "floor") {
        if (f.gradeDepthM !== undefined && f.gradeDepthM !== null) {
          // the terrain's word: a slab at or under the ground is on it
          bc = s.nOut[1] < 0 ? (f.gradeDepthM >= -0.1 ? "Ground" : "Outdoors") : "Adiabatic";
          if (bc === "Ground") { report.groundFromTerrain.count++; report.groundFromTerrain.areaM2 += f.areaM2; }
        } else if (el?.isExternal === true) bc = s.nOut[1] < 0 ? "Ground" : "Outdoors";
        else if (model.envelope !== "generic" && s.nOut[1] < 0 && floorLow(f) <= lowestFloor + 0.3) {
          bc = "Ground"; bcSource = "code-default"; report.model.groundFloorsDefault.count++; report.model.groundFloorsDefault.areaM2 += f.areaM2;
        } else { bc = "Adiabatic"; bcSource = "code-default"; }
      } else { bc = "Adiabatic"; bcSource = "code-default"; }
      if (bc === "Ground" && f.category === "exteriorWall") { report.groundFromTerrain.count++; report.groundFromTerrain.areaM2 += f.areaM2; }
      const type: IdfSurfaceOut["type"] =
        s.nOut[1] < -0.5 ? "Floor" : s.nOut[1] > 0.5 ? (bc === "Outdoors" ? "Roof" : "Ceiling") : "Wall";
      const ring = orient(s.nOut, grown ?? f.outer);
      if (dot(newell(ring), s.nOut) <= 0) report.windingViolations++;
      const sn = names.get(s.zone)!;
      const twin = s.other ? names.get(s.other)! : "";
      if (!pairCons) {
        const d = dress(f.category, bc, s.zone, s.other, f.thicknessM ?? 0, type, el?.typeId, kivaBoundOf(f, s.zone, bc, type));
        pairCons = constructionRev(d.kind, d.layers, d.film, d.stated ?? null);
        pairCode = d.code;
        report.model.constructionAreaM2[d.kind] = (report.model.constructionAreaM2[d.kind] ?? 0) + gross;
      }
      let cat = s === sides[0] ? pairCons[0] : pairCons[1];
      let bcObject = twin;
      // ── the ground-coupled surfaces under the ruled method (2026-09-08): a floor on the ground, a wall part below grade
      if (bc === "Ground" && gm !== "ground") {
        if (type === "Floor" && groundFloorZone(f) === s.zone) {
          const ex = exposedEdges(ring, walls);
          const per = perimeterOf(ring, ex);
          // the engine's own bound (Eng. Ref. 3.221–3.223): the fictitious layer R = A / (P_exp · F) − films 0.165 − concrete 0.077 must stay positive
          // and Kiva's two-dimensional floor is A / P_exp wide: a sliver cell (under 0.25 m², or narrower than 0.1 m) crashed the engine — stated bounds
          const fits = gm === "fcfactor" ? (per.exposedM <= 0 || gross / (per.exposedM * fF.wmK) - 0.242 > 0.01)
            : gm === "kiva" ? (gross >= 0.25 && (per.exposedM <= 0 || gross / per.exposedM >= 0.1)) : true;
          if (!fits) report.ground.tooSmallForF++;
          else {
            report.ground.floors++; report.ground.exposedM += per.exposedM; report.ground.perimeterM += per.totalM;
            report.ground.segments += ex.length; report.ground.exposedSegments += ex.filter(Boolean).length;
            if (gm === "fcfactor") {
              // the slab by its area and exposed perimeter: the standard's F for the IRC's R-10 to 2 ft
              cat = construction(`F-factor slab #${f.id ?? f.elementId}`, () => [], FILM.floor, { u: null, source: gSrc });
              L.pop();   // a Construction with no layers is not the object — the F-factor construction is
              obj("Construction:FfactorGroundFloor", cat, fF.wmK.toFixed(3), gross.toFixed(3), per.exposedM.toFixed(3));
              bc = "GroundFCfactorMethod";
            } else {
              bc = "Foundation";
              const wallLen = kivaAssign.floorWalls.get(faceKey.get(f)!) ?? 0;
              bcObject = kivaFor(f, wallLen > 0);
              if (!(wallLen > 0)) kivaSlabCons.set(bcObject, cat);
              // the exposed length as a TOTAL (a per-segment list must match the vertices the engine keeps after its 1 cm cleaning): at least
              // the walls' own lengths as Kiva measures them, so the weights sum to one, and never past the floor's own perimeter (the engine's cap)
              obj("SurfaceProperty:ExposedFoundationPerimeter", sn, "TotalExposedPerimeter", Math.min(per.totalM, Math.max(wallLen, per.exposedM)).toFixed(3));
            }
          }
        } else if (type === "Wall" && f.category === "exteriorWall") {
          report.ground.walls++;
          if (gm === "fcfactor") {
            const ys = f.outer.map((p) => p[1]);
            cat = construction(`C-factor wall #${f.id ?? f.elementId}`, () => [], FILM.wall, { u: null, source: gSrc });
            L.pop();
            obj("Construction:CfactorUndergroundWall", cat, cF.wm2K.toFixed(3), Math.max(0.01, Math.max(...ys) - Math.min(...ys)).toFixed(3));
            bc = "GroundFCfactorMethod";
          } else {
            const fk = kivaAssign.wallFloor.get(faceKey.get(f)!);
            if (fk) { bc = "Foundation"; bcObject = kivaFor(keyFace.get(fk)!, true); }
            else report.ground.wallsWithoutFloor++;   // no slab of its zone in reach, its slab's perimeter taken, or a sliver part: the wall stays on Ground, counted and named
          }
        }
      }
      obj("BuildingSurface:Detailed", sn, type, cat, zoneEp.get(s.zone)!, spaceEpOf(s.zone, s.ifc), bc, bcObject,
        bc === "Outdoors" ? "SunExposed" : "NoSun", bc === "Outdoors" ? "WindExposed" : "NoWind",
        "autocalculate", ring.length, vertsOf(ring).trimStart());
      report.surfaces++;
      report.byBc[bc].count++; report.byBc[bc].areaM2 += gross;
      report.byType[type]++;
      report.out.push({ name: sn, idfSurfaceId: f.id ?? null, side: s === sides[0] && f.space ? 0 : 1, elementId: f.elementId, zone: s.zone, zoneFacing: s.other, bc, bcSource, type, grossAreaM2: gross, construction: cat, constructionSource: consSource.get(cat) ?? "code-default" , codeConstruction: pairCode });

      // subsurfaces: the holes the carve kept on this cell — each matched to the window or door the
      // file placed there (2026-09-08): a window, a glass door, an opaque door, a skylight in a roof
      // the exterior openings this cell carries, from their own rectangles — the holes they cut are not read again
      const pieces = bc === "Outdoors" ? env.pieces.get(f) ?? [] : [];
      // a door whole glass: a share TYPED on CONSTRUCTIONS (1 glass, 0 solid — 2026-10-07), else the door's glass / solid verdict
      const glassWhole = (o: { elementId: number; glazed: boolean }): boolean => { const t = model.doorGlass?.get(elements.get(o.elementId)?.typeId ?? -1); return t !== undefined ? t >= 1 : o.glazed; };
      const covered = (k: number): boolean => bc === "Outdoors" && env.holeCovered(f, k);
      f.holes.forEach((h, k) => {
        if (covered(k)) return;
        if (h.length < 3 || h.length > 4) { if (s === sides[0]) report.holesSkipped.manyVertices++; return; }
        // a hole on an Outdoors cell that no opening covers is matched to none (it would otherwise borrow a neighbour's)
        const op = bc === "Outdoors" && !env.inPlane(f) ? openingOf(f, h) : null;
        const sky = type === "Roof" && op?.kind === "window";
        if (type !== "Wall" && !sky) { if (s === sides[0]) report.holesSkipped.onFloorOrCeiling++; return; }
        if (bc === "Adiabatic" || bc === "Ground" || bc === "Foundation" || bc === "GroundFCfactorMethod") { if (s === sides[0]) report.holesSkipped.onAdiabaticOrGround++; return; }
        const hr = orient(s.nOut, h);
        if (s === sides[0] && onOutline(h, f.outer) >= 2) report.holesOnBaseEdge++;
        if (bc === "Outdoors") {
          const rc = op ? model.constructions?.get(elements.get(op.elementId)?.typeId ?? -1) : undefined;
          const ruledCons = (): string => { const d = ruled(rc!, "Wall"); return construction(d.kind, () => d.layers, d.film, d.stated); };
          let kind: IdfSubsurfaceOut["kind"], cons: string;
          if (!op) { kind = "Window"; cons = glazing; report.unmatchedHoles++; }
          else if (op.kind === "window") { kind = "Window"; cons = rc ? ruledCons() : sky ? skylightCons() : glazing; if (sky) report.skylights++; }
          else if (glassWhole(op)) { kind = "GlassDoor"; cons = rc ? ruledCons() : glazing; report.glassDoors++; }
          else { kind = "Door"; cons = rc ? ruledCons() : extDoorCons(); report.exteriorDoors++; }
          const subCode = !op ? kinds.window[0]! : op.kind === "window" ? (sky ? kinds.window[1]! : kinds.window[0]!) : glassWhole(op) ? kinds.window[0]! : kinds.door[0]!;
          if (kind === "Window") report.windows++;
          const wn = name(`${sn}:${kind === "Window" ? "w" : "d"}${k + 1}`);
          obj("FenestrationSurface:Detailed", wn, kind, cons, sn, "", "autocalculate", rc ? frameOf(rc) : "", "1",
            hr.length, vertsOf(hr).trimStart());
          report.subsurfaces.push({ name: wn, base: sn, kind, holeIndex: k, construction: cons, constructionSource: consSource.get(cons) ?? "code-default", elementId: op?.elementId ?? null, codeConstruction: subCode });
        } else {
          // an opening in a partition: a door on both copies, each naming the other
          const dn = name(`${sn}:d${k + 1}`);
          obj("FenestrationSurface:Detailed", dn, "Door", door, sn,
            `${twin}:d${k + 1}`, "autocalculate", "", "1", hr.length, vertsOf(hr).trimStart());
          if (s === sides[0]) report.interiorDoors++;
          report.subsurfaces.push({ name: dn, base: sn, kind: "Door", holeIndex: k, construction: door, constructionSource: "code-default", codeConstruction: kinds.door[1]! });
        }
      });
      // the exterior openings from their own rectangles (2026-10-01), each piece put on this cell's own plane
      const dF = dot(f.n, f.outer[0]!);
      pieces.forEach((pc, i) => {
        const op = pc.op;
        const sky = type === "Roof" && op.kind === "window";
        const onPlane = pc.ring.map((p): V3 => { const e = dot(f.n, p) - dF; return [p[0] - f.n[0] * e, p[1] - f.n[1] * e, p[2] - f.n[2] * e]; });
        const hr = orient(s.nOut, onPlane);
        if (s === sides[0] && onOutline(onPlane, f.outer) >= 2) report.holesOnBaseEdge++;
        const rc = model.constructions?.get(elements.get(op.elementId)?.typeId ?? -1);
        const ruledCons = (): string => { const d = ruled(rc!, "Wall"); return construction(d.kind, () => d.layers, d.film, d.stated); };
        // A DOOR SPLIT BY ITS STATED GLASS SHARE (the user's ruling, 2026-09-25): the glass a GlassDoor centred at the door's
        // proportions, the rest four opaque Doors around it; the type's ruling (or the code default) on each part by its kind
        // a share TYPED on CONSTRUCTIONS (2026-10-07) is honoured exactly; a share the FILE states keeps the bound
        const typed = op.kind === "door" ? model.doorGlass?.get(elements.get(op.elementId)?.typeId ?? -1) : undefined;
        const fr = op.kind === "door" ? typed ?? elements.get(op.elementId)?.glazingFraction ?? null : null;
        const sp = fr !== null && fr > 0 && fr < (typed !== undefined ? 1 : GLASS_DOOR_WHOLE) ? splitDoor(hr, fr) : null;
        if (sp && fr !== null) {
          const k0 = f.holes.length + i;
          const gn = name(`${sn}:d${k0 + 1}`);
          // each part takes the construction of its kind: the type's ruling where it is of that kind (a glazing set has an SHGC),
          // else the code default's — the engine refuses a glazing construction on a Door and an opaque one on a GlassDoor
          const rcGlass = !!rc && rc.shgc !== undefined;
          const gCons = rc && rcGlass ? ruledCons() : glazing, dCons = rc && !rcGlass ? ruledCons() : extDoorCons();
          obj("FenestrationSurface:Detailed", gn, "GlassDoor", gCons, sn, "", "autocalculate", rc ? frameOf(rc) : "", "1", 4, vertsOf(sp.glass).trimStart());
          report.subsurfaces.push({ name: gn, base: sn, kind: "GlassDoor", holeIndex: k0, construction: gCons, constructionSource: consSource.get(gCons) ?? "code-default", elementId: op.elementId, codeConstruction: kinds.window[0]!, areaM2: pc.areaM2 * fr });
          sp.frame.forEach((q, j) => {
            const qn = name(`${sn}:d${k0 + 1}.${j + 1}`);
            obj("FenestrationSurface:Detailed", qn, "Door", dCons, sn, "", "autocalculate", "", "1", 4, vertsOf(q).trimStart());
            report.subsurfaces.push({ name: qn, base: sn, kind: "Door", holeIndex: k0, construction: dCons, constructionSource: consSource.get(dCons) ?? "code-default", elementId: op.elementId, codeConstruction: kinds.door[0]!, areaM2: (pc.areaM2 * (1 - fr)) / 4 });
          });
          report.glassDoors++; report.exteriorDoors++; report.splitDoors++;
          return;
        }
        let kind: IdfSubsurfaceOut["kind"], cons: string;
        if (op.kind === "window") { kind = "Window"; cons = rc ? ruledCons() : sky ? skylightCons() : glazing; if (sky) report.skylights++; report.windows++; }
        else if (glassWhole(op)) { kind = "GlassDoor"; cons = rc ? ruledCons() : glazing; report.glassDoors++; }
        else { kind = "Door"; cons = rc ? ruledCons() : extDoorCons(); report.exteriorDoors++; }
        const subCode = op.kind === "window" ? (sky ? kinds.window[1]! : kinds.window[0]!) : glassWhole(op) ? kinds.window[0]! : kinds.door[0]!;
        const k = f.holes.length + i;
        const wn = name(`${sn}:${kind === "Window" ? "w" : "d"}${k + 1}`);
        obj("FenestrationSurface:Detailed", wn, kind, cons, sn, "", "autocalculate", rc ? frameOf(rc) : "", "1",
          hr.length, vertsOf(hr).trimStart());
        report.subsurfaces.push({ name: wn, base: sn, kind, holeIndex: k, construction: cons, constructionSource: consSource.get(cons) ?? "code-default", elementId: op.elementId, codeConstruction: subCode, areaM2: pc.areaM2 });
      });
    }
  }
  // ── the air and the equipment: ideal loads at the code's thermostat
  //    thermostat in every conditioned zone; the IRC leakage limit as a
  //    constant infiltration (ACH50 / 20 — the LBL rule of thumb for this
  //    climate, a default), attics and crawl spaces leakier
  // ── THE RULED SCHEDULES (2026-09-09): the engine's own objects, verbatim, each once — the type limits first (the
  //    writer's own `fraction` reused by name: the datasets' Fraction is the same 0…1 continuous limit), then the days,
  //    the weeks, the schedule itself, cross-references following any rename the namer had to make. A role whose
  //    object does not exist yet (people, lights, equipment, ventilation) is recorded and NOT emitted.
  const lc = (x: string): string => x.trim().toLowerCase();
  const schedEmitted = new Map<string, string>();     // the schedule's name in the file → its emitted name
  const limitsEmitted = new Map<string, string>();
  const emitSchedule = (r: { profile: ScheduleProfile }): void => {
    const p = r.profile;
    if (schedEmitted.has(lc(p.name))) return;
    const renamed = new Map<string, string>();
    for (const o of p.chain) {
      if (o.cls === "ScheduleTypeLimits") {
        if (!limitsEmitted.has(lc(o.name))) { const n = named(o.name); limitsEmitted.set(lc(o.name), n); obj(o.cls, n, ...o.fields.slice(1)); }
        continue;
      }
      const n = named(o.name); renamed.set(lc(o.name), n);
      const hasLimits = o.cls !== "Schedule:Week:Compact" && o.cls !== "Schedule:Week:Daily";
      obj(o.cls, ...o.fields.map((f, i) => (i === 0 ? n : i === 1 && hasLimits ? (limitsEmitted.get(lc(f)) ?? f) : (renamed.get(lc(f)) ?? f))));
    }
    schedEmitted.set(lc(p.name), renamed.get(lc(p.name)) ?? p.name);
  };
  /** the emitted name of the schedule ruled for a role, null when the role runs on the writer's default */
  const schedName = (role: ScheduleRole): string | null => { const r = model.schedules?.get(role); return r ? (schedEmitted.get(lc(r.profile.name)) ?? null) : null; };
  let always: string | null = null, never: string | null = null;
  const ventUsed = model.systems?.list.some((s) => s.objects.some((o) => o.fields.some((f) => f.ref?.schedule === "ventilation"))) ?? false;
  const neverUsed = model.systems?.list.some((s) => s.objects.some((o) => o.fields.some((f) => f.ref?.schedule === "never"))) ?? false;
  if (model.envelope !== "generic") {
    const fraction = name("fraction");
    obj("ScheduleTypeLimits", fraction, "0", "1", "Continuous");
    limitsEmitted.set("fraction", fraction);
    always = name("always on");
    obj("Schedule:Constant", always, fraction, "1");
    // "always off" (2026-09-14): a constant 0 — what a supplemental heater switched off on its card runs on (its availability), the engine's own way
    if (neverUsed) { never = name("always off"); obj("Schedule:Constant", never, fraction, "0"); }
    for (const r of model.schedules?.values() ?? []) if (ROLE_CONSUMER[r.role] && (r.role !== "ventilation" || ventUsed)) emitSchedule(r);
    // the library schedules a component's inputs name (2026-09-14), each once
    for (const r of model.systemSchedules ?? []) emitSchedule(r);
    const infil = schedName("infiltration") ?? always;
    for (const z of zoneNames) {
      // the blower-door ruling (2026-10-08): one object on the ZONE — the engine shares it among the zone's spaces (measured)
      const ela = elaOf(z);
      if (ela) { obj("ZoneInfiltration:EffectiveLeakageArea", name(`${z} infiltration`), zoneEp.get(z)!, infil, ela.cm2.toFixed(1), String(ela.cs), String(ela.cw)); continue; }
      obj("ZoneInfiltration:DesignFlowRate", name(`${z} infiltration`), zoneEp.get(z)!, infil, "AirChanges/Hour", "", "", "",
        achOf(z).toFixed(3), "1", "0", "0", "0");
    }
    obj("Site:GroundTemperature:BuildingSurface", ...site$.groundTempsC.map((v) => v.toFixed(2).replace(/\.?0+$/, "")));
    if (gm === "fcfactor") obj("Site:GroundTemperature:FCfactorMethod", ...(site$.fcfactorGroundTempsC ?? Array(12).fill(13)).map((v: number) => v.toFixed(2).replace(/\.?0+$/, "")));
  }
  for (const [zone, m] of spacesOf) {
    report.model.spacesByZone[zone] = [...m.keys()];
    for (const ep of m.values()) { obj("Space", ep, zoneEp.get(zone)!, "autocalculate", "autocalculate", "autocalculate", "General"); report.model.sizing.spaces++; }
  }
  // ── THE INTERNAL GAINS (user, 2026-09-13): People, Lights and ElectricEquipment on every room's Space — the cited residential
  //    defaults, the zone's and the room's rulings on top (bemGains.ts); every schedule one of the engine's own, emitted once ahead;
  //    absolute levels, so bem.db's number is the IDF's; the meters asked for once
  const metersAsked = new Set<string>();
  // HOURLY too (user, 2026-10-03: RUN's time scale runs from a day of 24 hours to the year) — the day and week views read the hours
  const meter = (m: string): void => { if (metersAsked.has(m)) return; metersAsked.add(m); obj("Output:Meter", m, "Monthly"); obj("Output:Meter", m, "Daily"); obj("Output:Meter", m, "Hourly"); };
  const G = model.gains;
  if (G && model.envelope !== "generic") {
    for (const p of G.profiles) emitSchedule({ profile: p });
    const sName = (p: ScheduleProfile | null): string => (p ? (schedEmitted.get(lc(p.name)) ?? p.name) : "");
    const anyLimits = limitsEmitted.get("any number");
    let gainsWritten = false;
    for (const r of G.rooms) {
      const ep = spacesOf.get(r.zone)?.get(r.room);
      report.rooms.push({ room: r.room, zone: r.zone, epName: ep ?? "", floorM2: r.floorM2, conditioned: r.conditioned,
        people: { value: r.people.count, source: r.people.source }, peopleNote: r.people.note, lightsW: { value: r.lights.wattsW, source: r.lights.source }, lightsNote: r.lights.note,
        equipmentW: { value: r.equipment.reduce((t, e) => t + e.wattsW, 0), source: r.equipment.some((e) => e.source === "user") ? "user" : r.equipment.length ? "dataset" : "code-default" },
        equipment: r.equipment.map((e) => ({ id: e.id, name: e.name, group: e.group, wattsW: e.wattsW, subcategory: e.subcategory, latent: e.latent, radiant: e.radiant, lost: e.lost, schedule: e.scheduleName, source: e.source, note: e.note })),
        schedules: { occupancy: r.schedules.occupancy?.name ?? null, lighting: r.schedules.lighting?.name ?? null, activity: r.schedules.activity?.name ?? null } });
      if (!ep) continue;
      if (r.people.count > 0 && r.schedules.occupancy && r.schedules.activity) {
        let act = sName(r.schedules.activity);
        if (r.people.activitySource === "user" && anyLimits) { act = name(`${r.room} activity`); obj("Schedule:Constant", act, anyLimits, r.people.activityW.toFixed(2)); }
        obj("People", name(`${r.room} people`), ep, sName(r.schedules.occupancy), "People", r.people.count.toFixed(3), "", "", String(r.people.fractionRadiant), "autocalculate", act);
        gainsWritten = true;
      }
      if (r.lights.wattsW > 0 && r.schedules.lighting) { obj("Lights", name(`${r.room} lights`), ep, sName(r.schedules.lighting), "LightingLevel", r.lights.wattsW.toFixed(1), "", "", "0", "0.6", "0.2", "0", "InteriorLights"); gainsWritten = true; }
      for (const e of r.equipment) if (e.wattsW > 0 && e.schedule) { obj("ElectricEquipment", name(`${r.room} ${e.name}`), ep, sName(e.schedule), "EquipmentLevel", e.wattsW.toFixed(1), "", "", String(e.latent), String(e.radiant), String(e.lost), e.subcategory); gainsWritten = true; }
    }
    if (G.exterior?.schedule) { obj("Exterior:Lights", name("exterior lights"), sName(G.exterior.schedule), G.exterior.wattsW.toFixed(1), "AstronomicalClock", "Exterior-Lights"); gainsWritten = true; }
    if (gainsWritten) for (const m of ["InteriorLights:Electricity", "InteriorEquipment:Electricity", "ExteriorLights:Electricity", "Electricity:Facility"]) meter(m);
    // CAR CHARGING by its own end use (2026-10-03): RUN draws it apart from the other plug loads
    if (G.rooms.some((r) => r.equipment.some((e) => e.wattsW > 0 && e.schedule && e.subcategory === "Charging"))) meter("Charging:InteriorEquipment:Electricity");
  }
  // one thermostat per distinct setpoint pair: the code's 72 / 75 °F by default, the user's where ruled — a ruled
  // setpoint SCHEDULE (2026-09-09) takes every zone that has no constant of its own; a zone's own constant is kept.
  // Hoisted out of the ideal-loads block (2026-09-10): a ruled system's zones take the same thermostat.
  const tstats = new Map<string, string>();
  const heatS = schedName("heating-setpoint"), coolS = schedName("cooling-setpoint");
  // a side that is off (2026-09-14: the equipment cannot serve it, or the Zone card switched it off) takes the out-of-reach constant, never
  // the ruled schedule — the template's expansion writes the same two-setpoint control the unit heater has, and that side never calls
  const tstatOf = (z: string): string => {
    const hOn = heats(z), cOn = cools(z);
    const hs = hOn && ov(z).heatingSetpointC === undefined ? heatS : null, cs = cOn && ov(z).coolingSetpointC === undefined ? coolS : null;
    const hv = hOn ? setC(heatOf(z)) : setC(OUT_OF_REACH.heatC), cv = cOn ? setC(coolOf(z)) : setC(OUT_OF_REACH.coolC);
    const key = `${hs ?? hv}|${cs ?? cv}`;
    let tn = tstats.get(key);
    if (!tn) {
      const isRef = hOn && cOn && !hs && !cs && heatOf(z) === irc.heatingSetpointC && coolOf(z) === irc.coolingSetpointC;
      tn = name(isRef ? "code thermostat 72F 75F" : `thermostat ${hs ?? (hOn ? `${hv}C` : "no heating")} ${cs ?? (cOn ? `${cv}C` : "no cooling")}`);
      tstats.set(key, tn);
      obj("HVACTemplate:Thermostat", tn, hs ?? "", hs ? "" : hv, cs ?? "", cs ? "" : cv);
    }
    return tn;
  };
  const avail = schedName("hvac-availability");
  /** an object's fields in IDD order, the trailing blanks trimmed (never under the class's min-fields) */
  const trimmed = (vals: string[], minFields: number | null): string[] => {
    let n = vals.length;
    while (n > 0 && vals[n - 1] === "") n--;
    return vals.slice(0, Math.max(n, minFields ?? 0));
  };
  if (model.idealLoads) {
    // every conditioned zone a ruled system does not take (2026-09-10) keeps ideal loads; whole-house heat recovery
    // ruled in VENTILATION rides on the template's own outdoor-air fields, so those zones get the full field list
    const ideal = zoneNames.filter((z) => condOf(z) && !taken(z));
    // a zone on an EXPLICIT ideal-loads ruling (the assembly's node) gets its object from emitSystems and its Sizing:Zone here:
    // the expansion writes none for that template (measured 2026-09-04)
    const sizing = zoneNames.filter((z) => condOf(z) && (!taken(z) || model.systems?.zoneKind.get(z) === "HVACTemplate:Zone:IdealLoadsAirSystem"));
    const il = model.systems?.idealLoadsFields;
    for (const z of ideal) {
      if (il && il.length && model.systems?.idealLoadsOrder) {
        const byKey = new Map(il.map((f) => [f.key, f]));
        const order = model.systems.idealLoadsOrder;
        const vals = order.map((k) => k === "zone_name" ? zoneEp.get(z)! : k === "template_thermostat_name" ? tstatOf(z) : k === "system_availability_schedule_name" ? (avail ?? "") : (byKey.get(k)?.value ?? ""));
        obj("HVACTemplate:Zone:IdealLoadsAirSystem", ...trimmed(vals, null));
      } else obj("HVACTemplate:Zone:IdealLoadsAirSystem", zoneEp.get(z)!, tstatOf(z), ...(avail ? [avail] : []));
    }
    // a Sizing:Zone per conditioned zone on ideal loads. The supply conditions (14 / 40 °C,
    // 0.0085 / 0.008 kg/kg) size the design AIR FLOW only; the design LOAD the
    // sizing summary reports is the zone's sensible load, independent of them.
    // A zone on a ruled HVACTemplate gets its Sizing:Zone from the expansion (a second one is a Severe).
    for (const z of sizing) {
      obj("Sizing:Zone", zoneEp.get(z)!, "SupplyAirTemperature", "14", "", "SupplyAirTemperature", "40", "", "0.0085", "0.008",
        "", "", "", "DesignDay", "", "", "", "", "DesignDay");
      report.model.sizing.zones++;
    }
    // each zone's peak rate over the weather year, month by month with its stamp
    obj("Output:Table:Monthly", "zone peak loads", "2",
      "Zone Ideal Loads Supply Air Total Heating Rate", "Maximum", "Zone Ideal Loads Supply Air Total Cooling Rate", "Maximum");
    // the summary reports the app READS (2026-09-15): AllSummary had put the whole InitializationSummary — every surface's
    // .eio rows — into the sql, 159k cells and 183 MB once the 2,229 shading surfaces were in; the .eio file itself is still written
    // ZoneComponentLoadSummary (user, 2026-10-02: RUN's Peak graph stacks each zone's peak by load component) — per ZONE: the
    // FacilityComponentLoadSummary crashed EnergyPlus 26.1 writing its tables on this house (exit 139, measured), the zone one runs clean
    obj("Output:Table:SummaryReports", "AnnualBuildingUtilityPerformanceSummary", "DemandEndUseComponentsSummary", "ZoneComponentLoadSummary", "HVACSizingSummary", "ComponentSizingSummary", "CoilSizingDetails", "SystemSummary",
      "ClimaticDataSummary", "EnvelopeSummary", "SensibleHeatGainSummary", "ShadingSummary", ...(model.tariff?.card.charges ? ["TariffReport", "EconomicResultSummary"] : []));
    obj("OutputControl:Table:Style", "CommaAndHTML", "JtoKWH");
    obj("Output:Variable", "*", "Zone Ideal Loads Supply Air Total Heating Energy", "Monthly");
    obj("Output:Variable", "*", "Zone Ideal Loads Supply Air Total Cooling Energy", "Monthly");
    // every zone's heating and cooling WHATEVER serves it (2026-09-15): the ideal-loads pair is silent for a zone on
    // real equipment, so the zone table and the lens read this pair where that one is absent
    obj("Output:Variable", "*", "Zone Air System Sensible Heating Energy", "Monthly");
    obj("Output:Variable", "*", "Zone Air System Sensible Cooling Energy", "Monthly");
    obj("Output:Variable", "*", "Zone Heating Setpoint Not Met Time", "RunPeriod");
    obj("Output:Variable", "*", "Zone Cooling Setpoint Not Met Time", "RunPeriod");
    obj("Output:Meter", "DistrictHeatingWater:Facility", "Monthly");
    obj("Output:Meter", "DistrictCooling:Facility", "Monthly");
    // daily meters: the operations model sums them over BILL PERIODS, never months
    obj("Output:Meter", "DistrictHeatingWater:Facility", "Daily");
    obj("Output:Meter", "DistrictCooling:Facility", "Daily");
    // and by the hour (2026-10-03): RUN's day and week views
    obj("Output:Meter", "DistrictHeatingWater:Facility", "Hourly");
    obj("Output:Meter", "DistrictCooling:Facility", "Hourly");
  }
  // ── THE SHADING SURFACES (user, 2026-09-15, S6: "leave surface shading to EnergyPlus processes"): the projected site
  //    files' elements — the trees, the panels, the dock, the ties — written as Shading:Building:Detailed so the engine's own
  //    shadow calculation sees them (Building, not Site: the IDD says a Building shading surface "would move with relative
  //    geometry", and these triangles are in the HOUSE frame the zones' surfaces are in). Geometry is READ, never derived:
  //    an element under SHADING_TRI_CAP triangles is written triangle by triangle; one over it as the six faces of its
  //    bounding box, counted and named (an RPC tree is a 630-triangle placeholder mesh — a box in the engine's eyes); a
  //    flat element under SHADING_MIN_HEIGHT_M tall (a paver, a gravel bed) casts no shadow the house sees and is left out,
  //    counted. A tree carries the deciduous transmittance schedule (core/shadingSchedule.ts) as the object's second field;
  //    the engine shades from both faces of a shading surface, so a winding is not asked of it.
  report.shading = { elements: 0, surfaces: 0, verbatim: 0, boxed: 0, flat: 0, trees: 0, triangles: 0, degenerate: 0, treesOpaque: site$.shadowCalculation === "PixelCounting" };
  if (model.shading?.length && model.envelope !== "generic") {
    const sh = report.shading;
    // THE ENGINE'S OWN LIMIT (measured 2026-09-15, a Severe on the first clean year): "With PixelCounting Shading Calculation Method,
    // the shading surfaces will be treated as opaque" — a transmittance schedule is honoured under PolygonClipping alone, which
    // in turn warns on the carve's non-convex receiving cells. So under PixelCounting the trees go out OPAQUE all year (the
    // schedule is not written and the census says so); rule PolygonClipping on SITE and the deciduous schedule is written.
    const treesOpaque = sh.treesOpaque;
    // THE ENGINE'S RESOLUTION (2026-09-03, the same rule the building surfaces pass): vertices within 1 cm are one to it, and a
    // polygon left with fewer than three, or under 1 cm² (a tessellator's zero-area triangle — the dock's columns carry 62), is
    // "degenerate" and a Severe; measured on the first year: 63 such polygons stopped the run. Dropped here, counted.
    const near = (a: V3, b: V3): boolean => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 0.01;
    const cleanPoly = (poly: V3[]): V3[] | null => {
      const out: V3[] = [];
      for (const p of poly) { const q = out[out.length - 1]; if (!q || !near(p, q)) out.push(p); }
      while (out.length > 1 && near(out[0]!, out[out.length - 1]!)) out.pop();
      if (out.length < 3) return null;
      const nv: V3 = [0, 0, 0];
      for (let i = 0; i < out.length; i++) { const a = out[i]!, b = out[(i + 1) % out.length]!; nv[0] += (a[1] - b[1]) * (a[2] + b[2]); nv[1] += (a[2] - b[2]) * (a[0] + b[0]); nv[2] += (a[0] - b[0]) * (a[1] + b[1]); }
      return Math.hypot(nv[0], nv[1], nv[2]) / 2 < 1e-4 ? null : out;
    };
    const fr = limitsEmitted.get("fraction") ?? "";
    const compact = (values: number[]): string[] => {
      const ends = ["1/31", "2/28", "3/31", "4/30", "5/31", "6/30", "7/31", "8/31", "9/30", "10/31", "11/30", "12/31"];
      return values.flatMap((v, i) => [`Through: ${ends[i]}`, "For: AllDays", "Until: 24:00", String(v)]);
    };
    let deciduousSched: string | null = null, evergreenSched: string | null = null;
    const kindOf = (n: string): string => n.replace(/:\d+$/, "");
    const pvIds = new Set((model.pv?.panels ?? []).map((p) => `${p.file}|${p.expressId}`));
    for (const e of model.shading) {
      if (pvIds.has(`${e.file}|${e.expressId}`)) { sh.pv = (sh.pv ?? 0) + 1; continue; }
      sh.elements++; sh.triangles += e.tris.length;
      const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
      for (const t of e.tris) for (const p of t) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, p[k]!); hi[k] = Math.max(hi[k]!, p[k]!); }
      if (!Number.isFinite(lo[0]) || hi[1] - lo[1] < SHADING_MIN_HEIGHT_M) { sh.flat++; continue; }
      let sched = "";
      if (isTree(e.name) && treesOpaque) sh.trees++;
      else if (isTree(e.name)) {
        sh.trees++;
        if (isDeciduous(e.name)) { if (!deciduousSched) { deciduousSched = name("deciduous tree transmittance"); obj("Schedule:Compact", deciduousSched, fr, ...compact(DECIDUOUS_TRANSMITTANCE)); } sched = deciduousSched; }
        else { if (!evergreenSched) { evergreenSched = name("tree transmittance"); obj("Schedule:Compact", evergreenSched, fr, ...compact(Array<number>(12).fill(LEAF_ON_TRANSMITTANCE))); } sched = evergreenSched; }
      }
      let polys: V3[][];
      if (e.tris.length > SHADING_TRI_CAP) {
        sh.boxed++;
        const [x0, y0, z0] = lo, [x1, y1, z1] = hi;
        polys = [
          [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]],
          [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
          [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]],
        ];
      } else { sh.verbatim++; polys = e.tris; }
      const base = `${kindOf(e.name)} #${e.expressId}`;
      polys.forEach((raw, i) => {
        const poly = cleanPoly(raw);
        if (!poly) { sh.degenerate++; return; }
        obj("Shading:Building:Detailed", name(`${base} f${i + 1}`), sched, poly.length, vertsOf(poly).trimStart());
        sh.surfaces++;
      });
    }
  }
  // ── THE RULED SYSTEMS (2026-09-10): each one of the engine's own objects, its fields in IDD order as resolved, the
  //    references the writer alone can resolve (a zone's emitted name, its thermostat, the system object, the zone
  //    list, a schedule) filled here; every name through the namer; trailing blanks trimmed to the class's minimum
  /** each written system's electricity parts and the zones it serves — the meters read them (2026-10-23) */
  const sysParts: Array<{ label: string; zones: string[]; parts: Array<[string, string]>; unnamed: string[] }> = [];
  if (model.systems) {
    const emittedName = new Map<string, string>();
    const resolveRef = (f: ResolvedField): string => {
      const r = f.ref;
      if (!r) return f.value;
      if (r.zone) return zoneEp.get(r.zone) ?? f.value;
      if (r.thermostat) return tstatOf(r.thermostat);
      if (r.system) return emittedName.get(r.system) ?? f.value;
      if (r.zoneList) return emittedName.get(r.zoneList) ?? f.value;
      if (r.schedule === "always") return always ?? "";
      if (r.schedule === "never") return never ?? "";
      if (r.schedule === "ventilation") return schedName("ventilation") ?? "";
      if (r.schedule === "hvac-availability") return schedName("hvac-availability") ?? "";
      if (r.schedule && typeof r.schedule === "object") return schedEmitted.get(lc(r.schedule.name)) ?? "";
      return f.value;
    };
    for (const sys of model.systems.list) {
      const names: string[] = [];
      const fieldsOut: IdfSystemOut["fields"] = [];
      const parts: Array<[string, string]> = [], unnamed: string[] = [];
      for (const o of sys.objects) {
        const n = o.fields[0]?.key === "name" ? name(o.name) : o.name;   // an HVACTemplate:Zone:* object has no Name field: the zone is its key
        emittedName.set(o.name, n);
        names.push(n);
        const vals = o.fields.map((f, i) => (i === 0 && f.key === "name" ? n : resolveRef(f)));
        obj(o.cls, ...trimmed(vals, o.minFields));
        const ep = electricParts(o.cls, o.fields[0]?.key === "name" ? n : vals[0]!);
        if (ep) parts.push(...ep); else unnamed.push(`${o.cls} ${o.fields[0]?.key === "name" ? n : vals[0]}`);
        for (const [i, f] of o.fields.entries()) if (vals[i] !== "" && f.key !== "name") fieldsOut.push({ obj: n, key: f.key, label: f.label, value: vals[i]!, source: f.source, units: f.units });
      }
      report.systems.push({ id: sys.id, section: sys.section, kind: sys.kind, label: sys.label, source: sys.source, zones: sys.zones, objects: sys.objects.length, objectNames: names, fields: fieldsOut, refused: sys.refused, note: sys.note });
      sysParts.push({ label: sys.label, zones: sys.zones, parts, unnamed });
    }
    // A ZONE ON REAL ZoneHVAC EQUIPMENT OWNS ITS CONTROL (2026-09-11). An HVACTemplate zone gets its thermostat and its
    // Sizing:Zone from the expansion; a zone on a ZoneHVAC:* object gets neither, so both are written here. A unit heater is
    // HEATING ONLY — a garage is not cooled — so the control is ThermostatSetpoint:SingleHeating, and the setpoint defaults to
    // FREEZE PROTECTION (10 °C), not the IRC's 68 °F: an EUH in a garage is there to keep the pipes, not to make it a room.
    // The user's own setpoint for that zone, set on the Zone card or in ZONES, always wins.
    const realZones = [...(model.systems.zoneKind ?? new Map())].filter(([, k]) => !k.startsWith("HVACTemplate:"));
    if (realZones.length) {
      const tLimits = name("unit heater temperature"), cLimits = name("unit heater control type");
      obj("ScheduleTypeLimits", tLimits, "-60", "200", "Continuous", "Temperature");
      obj("ScheduleTypeLimits", cLimits, "0", "4", "Discrete", "Control");
      // THE CONTROL IS A DUAL SETPOINT, AND THAT IS A MODELLING DEVICE, STATED (measured 2026-09-11): a zone whose thermostat
      // offers only a heating setpoint is the ONE zone of 29 the engine refuses to size (no "Zone Sizing Information" row for
      // it), so every autosized part of its heater came out 0 W and the heater never ran all year. The zone is still heating
      // only — no cooling equipment is written for it — and the cooling setpoint is put out of reach at 50 °C so that nothing
      // can call for cooling that does not exist.
      const ctrl = name("unit heater control type is dual setpoint");
      obj("Schedule:Constant", ctrl, cLimits, "4");                       // 4 = DualSetpoint
      const noCool = name("cooling out of reach 50C");
      obj("Schedule:Constant", noCool, tLimits, String(OUT_OF_REACH.coolC));
      let noHeat: string | null = null;   // written the first time a zone's heating is switched off (2026-09-14)
      const setpoints = new Map<string, string>();
      // a setpoint constant once per value (2026-09-14): a zone with one side off shares the other side's constant with the zones that have both
      const constOf = new Map<string, string>();
      const constant = (label: string, value: string): string => { let n = constOf.get(label); if (!n) { n = name(label); obj("Schedule:Constant", n, tLimits, value); constOf.set(label, n); } return n; };
      // the outdoor-air specification a wired unit's zones are sized on (2026-09-13): the object the ruling emitted, by its emitted name
      const oaOf = (z: string): string => { const n = model.systems?.zoneOaSpec?.get(z); return n ? (emittedName.get(n) ?? n) : ""; };
      for (const [z, kind] of realZones) {
        // SERVED, NOT CONTROLLED (user, 2026-09-12): a zone whose card's T is off is fed by a unit that follows another zone and
        // gets no thermostat — the engine's own HeatPump.idf shape (three zones on one unit, one ZoneControl:Thermostat). Its
        // Sizing:Zone is still written, so its terminal and its share of the unit are sized to its own design load.
        if (model.systems.uncontrolledZones?.has(z)) {
          const wired = kind.startsWith("AirLoopHVAC:");
          obj("Sizing:Zone", zoneEp.get(z) ?? z, "SupplyAirTemperature", "14", "", "SupplyAirTemperature", "40", "", "0.0085", "0.008",
            oaOf(z), wired ? String(WIRED_SIZING_FACTOR.heating) : "", wired ? String(WIRED_SIZING_FACTOR.cooling) : "", "DesignDay", "", "", "", "", "DesignDay");
          report.model.sizing.zones++;
          continue;
        }
        // FREEZE PROTECTION BELONGS TO THE UNIT HEATER, NOT TO EVERY REAL SYSTEM (measured 2026-09-11): applied to a ducted
        // heat pump's zones it held them at 10 °C and put cooling out of reach, so the system delivered 37 kWh a year and
        // never cooled at all. A zone on a ducted system keeps the ordinary setpoints, as it would on ideal loads.
        const heater = kind === "ZoneHVAC:UnitHeater";
        const stated = ov(z).heatingSetpointC;
        // THE SIDES (user, 2026-09-14): a side the equipment cannot serve, or the Zone card switched off, is put out of reach — the shape the
        // unit heater has always had — so nothing calls for it, the zone still sizes, and no unmet hours count on that side
        const hOn = heats(z), cOn = !heater && cools(z);
        const c = hOn ? (heater ? stated ?? 10 : heatOf(z)) : OUT_OF_REACH.heatC;
        const cool = cOn ? coolOf(z) : null;
        const key = `${hOn ? setC(c) : "none"}|${cool === null ? "none" : setC(cool)}`;
        let tn = setpoints.get(key);
        if (!tn) {
          let sch: string;
          if (hOn) sch = constant(`${heater ? "unit heater" : "system"} setpoint ${setC(c)}C`, setC(c));
          else { if (!noHeat) { noHeat = name("heating out of reach -50C"); obj("Schedule:Constant", noHeat, tLimits, String(OUT_OF_REACH.heatC)); } sch = noHeat; }
          const coolSch = cool !== null ? constant(`system cooling setpoint ${setC(cool)}C`, setC(cool)) : noCool;
          tn = name(`${heater ? "unit heater" : "system"} thermostat ${key.replace("|", " ")}`);
          obj("ThermostatSetpoint:DualSetpoint", tn, sch, coolSch);
          setpoints.set(key, tn);
        }
        obj("ZoneControl:Thermostat", name(`${z} zone control`), zoneEp.get(z) ?? z, ctrl, "ThermostatSetpoint:DualSetpoint", tn);
        // and its own Sizing:Zone — the expansion writes none for a zone no template takes; a zone on a WIRED air-loop unit
        // carries the sizing margin (WIRED_SIZING_FACTOR: the engine's example's own, without which the variable-speed unit's
        // year ended in a Fatal — measured 2026-09-12)
        const wired = kind.startsWith("AirLoopHVAC:");
        obj("Sizing:Zone", zoneEp.get(z) ?? z, "SupplyAirTemperature", "14", "", "SupplyAirTemperature", "40", "", "0.0085", "0.008",
          oaOf(z), wired ? String(WIRED_SIZING_FACTOR.heating) : "", wired ? String(WIRED_SIZING_FACTOR.cooling) : "", "DesignDay", "", "", "", "", "DesignDay");
        report.model.sizing.zones++;
      }
    }
    // the changeover arbiter's EMS objects (2026-09-13): the .edd names the actuators, so a run PROVES they took — once, a unique object
    if (model.systems.list.some((s) => s.objects.some((o) => o.cls.startsWith("EnergyManagementSystem:")))) obj("Output:EnergyManagementSystem", "Verbose", "None", "ErrorsOnly");
    if (model.systems.list.some((s) => s.objects.length)) {
      // the ruled systems bill to electricity, unlike ideal loads (the district meters): asked for beside them
      for (const m of ["Electricity:Facility", "Heating:Electricity", "Cooling:Electricity", "Fans:Electricity", "HeatRejection:Electricity"]) meter(m);
    }
    // RUN's Annual graph (user, 2026-10-02): VENTILATION is the ventilation equipment alone — a ZoneVentilation fan meters to its own
    // end-use subcategory (measured on the engine's 5ZoneNightVent2: "Ventilation (simple):Fans:Electricity"), apart from a unit's
    // supply fan; RENEWABLE is what a generator produces. Each is asked for only when the model has one: a meter nothing feeds is a warning
    const allObjs = model.systems.list.flatMap((s) => s.objects);
    if (allObjs.some((o) => o.cls === "ZoneVentilation:DesignFlowRate")) meter("Ventilation (simple):Fans:Electricity");
    // THE STAND-ALONE ERVs (user, 2026-10-08: the Annual graph said "no ventilation equipment in model" — "This is not true"): each ERV's
    // fans meter to the card's own end-use subcategory ("ERV-H", "ERV-A"), asked for here so RUN's Ventilation line reads them
    const ervFans = new Set(allObjs.filter((o) => o.cls === "ZoneHVAC:EnergyRecoveryVentilator").flatMap((o) => [`${o.name} Sup Fan`, `${o.name} Exh Fan`]));
    for (const o of allObjs) if (o.cls.startsWith("Fan:") && ervFans.has(o.name)) {
      const sub = String(o.fields.find((f) => f.key === "end_use_subcategory")?.value ?? "");
      if (sub && sub.toLowerCase() !== "general") meter(`${sub}:Fans:Electricity`);
    }
    if (allObjs.some((o) => o.cls.startsWith("Generator:"))) meter("ElectricityProduced:Facility");
    // HOT WATER (user, 2026-10-03: RUN's occupant loads): the water heaters meter to the WaterSystems end use by their fuel
    const heaters = allObjs.filter((o) => o.cls.startsWith("WaterHeater:Stratified") || o.cls === "WaterHeater:Mixed");
    if (heaters.length) meter("WaterSystems:Electricity");
    if (heaters.some((o) => o.fields.some((f) => f.key === "heater_fuel_type" && f.value === "NaturalGas"))) meter("WaterSystems:NaturalGas");
    if (heaters.some((o) => o.fields.some((f) => f.key === "heater_fuel_type" && f.value === "Propane"))) meter("WaterSystems:Propane");
    // THE WELL PUMP by its own end use (2026-10-03): RUN's Domestic water
    if (allObjs.some((o) => o.cls === "Exterior:FuelEquipment" && o.fields.some((f) => f.key === "end_use_subcategory" && f.value === "Well Pump"))) meter("Well Pump:ExteriorEquipment:Electricity");
    for (const d of defaultSystemRows(model.systems)) report.systems.push({ ...d, objects: 0, objectNames: [], fields: [], refused: [] });
  }
  // ── ELECTRICAL › GENERATION — THE PV ARRAYS (user, 2026-10-02): one Generator:PVWatts per panel, on the panel's own top face as a
  //    shading surface (the engine reads its tilt, its azimuth from true north and its shade from it — the schema's note), listed
  //    on one load center through the PVWatts inverter, Baseload, a DC buss with the inverter (the engine's Generator_PVWatts.idf).
  //    Net metering (the user's ruling: no batteries) is accounted by the engine's own facility meters: produced, purchased,
  //    surplus sold, net — asked for here, priced by BOM › TARIFFS.
  if (model.pv?.panels.length) {
    const pv = model.pv, surfaces: string[] = [], generators: string[] = [], centreNames: string[] = [];
    // the sheet's load centers (2026-10-02), or the PV form's one over every panel — the same objects either way, the names the cards'
    const centres = pv.centres ?? [{ name: "PV load center", inverter: { name: "PV inverter", dcToAc: pv.dcToAc, efficiency: pv.inverterEfficiency }, arrays: [{ name: "", panels: pv.panels, moduleType: pv.moduleType, arrayType: pv.arrayType, systemLosses: pv.systemLosses }] }];
    for (const c of centres) {
      const gens: Array<{ gn: string; w: number }> = [];
      for (const a of c.arrays) for (const p of a.panels) {
        const sn = name(`PV ${p.kind} #${p.expressId}`), gn = name(`PVWatts ${p.kind} #${p.expressId}`);
        obj("Shading:Building:Detailed", sn, "", p.poly.length, vertsOf(p.poly).trimStart());
        obj("Generator:PVWatts", gn, "5", fmt(p.watts), a.moduleType.value, a.arrayType.value, fmt(a.systemLosses.value), "Surface", "", "", sn);
        surfaces.push(sn); generators.push(gn); gens.push({ gn, w: p.watts });
      }
      const list = name(pv.centres ? `${c.name} generators` : "PV generators"), inv = name(c.inverter.name), elc = name(c.name);
      obj("ElectricLoadCenter:Generators", list, ...gens.flatMap((g) => [g.gn, "Generator:PVWatts", fmt(g.w), "", ""]));
      obj("ElectricLoadCenter:Inverter:PVWatts", inv, fmt(c.inverter.dcToAc.value), fmt(c.inverter.efficiency.value));
      obj("ElectricLoadCenter:Distribution", elc, list, "Baseload", "0", "", "", "DirectCurrentWithInverter", inv);
      centreNames.push(list, inv, elc);
    }
    for (const m of ["Electricity:Facility", "ElectricityProduced:Facility", "ElectricityPurchased:Facility", "ElectricitySurplusSold:Facility", "ElectricityNet:Facility"]) meter(m);
    report.pv = { panels: pv.panels.length, dcW: pv.dcW, surfaces, generators, refused: pv.refused };
    const src = [pv.moduleType, pv.arrayType, pv.systemLosses, pv.dcToAc, pv.inverterEfficiency].some((x) => x.source === "user") ? "user" : "file";
    report.systems = report.systems.filter((r) => r.id !== "generation:default");
    report.systems.push({ id: "PV", section: "generation", kind: "Generator:PVWatts", label: `${pv.panels.length} × ${[...new Set(pv.panels.map((p) => p.kind))].join(", ")} · ${(pv.dcW / 1000).toFixed(2)} kW DC`, source: src, zones: [],
      objects: pv.panels.length * 2 + centreNames.length, objectNames: [...surfaces, ...generators, ...centreNames], fields: [], refused: pv.refused,
      note: pv.centres ? `the ELECTRICAL sheet: ${pv.centres.map((c) => `${c.name} ← ${c.inverter.name} ← ${c.arrays.map((a) => `${a.name} (${a.panels.length})`).join(", ")}`).join(" · ")} · one PVWatts array per panel on its own top face · net metering by the facility meters` : `one PVWatts array per panel on its own top face (tilt, azimuth and shade the engine's) · module ${pv.moduleType.value} (${pv.moduleType.why}) · ${pv.arrayType.value} · losses ${pv.systemLosses.value} · inverter ${pv.inverterEfficiency.value}, DC/AC ${pv.dcToAc.value} · net metering by the facility meters` });
  }
  // ── ELECTRICAL › METERS (user, 2026-10-23: "two meters … so that we can assign zones to each meter (Meter for Apt A and Meter for
  //    Apt B)"): a Meter:Custom per Meter card — each zone's own electricity meter (its lights and equipment) and the electricity parts of
  //    every unit that serves ONLY that meter's zones (the engine meters a unit to HVAC, never to a zone). A unit serving zones on two
  //    meters, or one whose parts cannot be named, stays on the building's total — named in the report, never dropped silently
  if (model.meters?.length) {
    report.meters = [];
    for (const m of model.meters) {
      const zs = new Set(m.zones), pairs: Array<[string, string]> = [], units: string[] = [], left: string[] = [];
      for (const z of m.zones) { const ep = zoneEp.get(z); if (ep) pairs.push(["", `Electricity:Zone:${ep}`]); else left.push(`${z}: no such zone in the model`); }
      for (const u of sysParts) {
        const on = u.zones.filter((z) => zs.has(z));
        if (!on.length) continue;
        if (on.length < u.zones.length) { left.push(`${u.label} also serves ${u.zones.filter((z) => !zs.has(z)).join(", ")} — on the building's total`); continue; }
        if (u.unnamed.length) left.push(`${u.label}: ${u.unnamed.join(", ")} not named — on the building's total`);
        if (u.parts.length) { pairs.push(...u.parts); units.push(u.label); }
      }
      if (!pairs.length) { left.push("nothing to meter"); report.meters.push({ name: m.name, emitted: "", zones: m.zones, units, parts: 0, left }); continue; }
      const mn = name(m.name);
      obj("Meter:Custom", mn, "Electricity", ...pairs.flat());
      meter(mn);
      report.meters.push({ name: m.name, emitted: mn, zones: m.zones, units, parts: pairs.length, left });
    }
    meter("Electricity:Facility");
  }
  // ── BOM › UTILITY — THE TARIFF (user, 2026-10-03: "utility costs included in both energyplus runs and utility bills"): the card's
  //    charges as the engine's own UtilityCost objects (ExampleFiles/5ZoneEconomicsTariffAndLifeCycleCosts.idf's form). The season by a
  //    schedule (1 = winter, 3 = summer: the card's summer months); the demand window by a time-of-use schedule (1 = peak in the card's
  //    hours, 3 = off-peak) and the clock hour (FullHour), the demand charge on the peak periods' demand. A house with a generator is
  //    priced NET (the engine's NetMetering on ElectricityNet:Facility, the minimum charge the access charge — a surplus month pays it
  //    alone); the engine banks no kWh credit, so BOM's own arithmetic (tariff.ts) carries them and says where the two differ.
  //    The PCA goes in only when typed as one value; per month it is BOM's alone.
  if (model.tariff?.card.charges && model.envelope !== "generic") {
    const T = model.tariff.card, C = T.charges!, net = !!model.pv?.panels.length;
    const usd = (v: number): string => String(Number(v.toPrecision(10)));
    const tn = name(T.id), lim = name("tariff period");
    obj("ScheduleTypeLimits", lim, "1", "4", "Discrete");
    const summer = T.summerMonths ?? [], blocks: string[] = [];
    const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    for (let m = 1; m <= 12; m++) {
      const v = summer.includes(m) ? 3 : 1, last = m === 12 || (summer.includes(m + 1) ? 3 : 1) !== v;
      if (last) blocks.push(`Through: ${m}/${DAYS[m - 1]}`, "For: AllDays", "Until: 24:00", String(v));
    }
    const season = name(`${T.id} season`), tou = name(`${T.id} demand window`);
    obj("Schedule:Compact", season, lim, ...blocks);
    const w = T.demandWindow!;
    obj("Schedule:Compact", tou, lim, "Through: 12/31", "For: AllDays", `Until: ${String(w.fromHour).padStart(2, "0")}:00`, "3", `Until: ${String(w.toHour).padStart(2, "0")}:00`, "1", "Until: 24:00", "3");
    // THE EXACT kWh (2026-10-21): the "kWh" choice converts J by 0.0000002778 (the IDD's own figure), 0.008 % over 1/3,600,000 — the
    // engine's tariff then billed a cent or so more a month than its own meter; UserDefined with the exact factors prices the meter as metered
    obj("UtilityCost:Tariff", tn, net ? "ElectricityNet:Facility" : "Electricity:Facility", "UserDefined", String(1 / 3_600_000), "0.001", tou, season, "", "FullHour", usd(C.accessUsdMonth.value), usd(C.accessUsdMonth.value), "", "", "", net ? "NetMetering" : "BuyFromUtility");
    obj("UtilityCost:Charge:Simple", name(`${T.id}-delivery`), tn, "totalEnergy", "Annual", "EnergyCharges", usd(C.deliveryUsdKwh.value));
    obj("UtilityCost:Charge:Simple", name(`${T.id}-supply-summer`), tn, "totalEnergy", "Summer", "EnergyCharges", usd(C.supplySummerUsdKwh.value));
    obj("UtilityCost:Charge:Simple", name(`${T.id}-supply-winter`), tn, "totalEnergy", "Winter", "EnergyCharges", usd(C.supplyWinterUsdKwh.value));
    obj("UtilityCost:Charge:Simple", name(`${T.id}-demand`), tn, "peakDemand", "Annual", "DemandCharges", usd(C.demandUsdKw.value));
    const pca = model.tariff.pca?.all;
    if (pca !== undefined) obj("UtilityCost:Charge:Simple", name(`${T.id}-PCA`), tn, "totalEnergy", "Annual", "Adjustment", usd(pca));
    report.tariff = { card: T.id, meter: net ? "ElectricityNet:Facility" : "Electricity:Facility", net, pca: pca ?? null };
  }
  for (const role of SCHEDULE_ROLES) {
    const r = model.schedules?.get(role), consumer = ROLE_CONSUMER[role];
    const emitted = r ? schedEmitted.get(lc(r.profile.name)) : undefined;
    report.schedules.push(r
      ? { role, name: r.profile.name, file: r.profile.file, cls: r.profile.cls, typeLimits: r.profile.typeLimits, source: r.source, weekday: r.profile.weekday, weekend: r.profile.weekend, blocks: r.profile.blocks,
          inUse: emitted !== undefined, note: emitted !== undefined ? `emitted as "${emitted}" · ${consumer}` : consumer ? `${consumer} is not written for this model` : "assigned — no object takes it until ZONES rules the gains; not emitted" }
      : { role, name: CODE_DEFAULT_SCHEDULE[role], file: "", cls: "", typeLimits: null, source: "code-default", weekday: null, weekend: null, blocks: 0, inUse: false, note: consumer ? `the default · ${consumer}` : "no object takes it yet" });
  }
  // WHAT THE VOID RULINGS ACTUALLY DID, read back from the surfaces AS WRITTEN (2026-09-18) — not from the intent above
  report.voids.roofsInsulated = report.out.filter((o) => o.type === "Roof" && o.codeConstruction === kinds.roof[0] && (voidInside(o.zone) || voidInside(o.zoneFacing))).length;
  report.voids.ceilingsInterior = report.out.filter((o) => o.codeConstruction === kinds.roof[3]).length;
  // the coils' rates (2026-10-11) — asked at the END, once every system is written, and only when the model writes a coil (ideal loads
  // have none, and an unknown variable is a question the engine cannot answer): at each zone timestep on the design days (the sizing
  // basis) and by the hour over the weather year — a structure's units summed at the instant they peak together
  // the turn-ups' depth, now every construction is written: the slab construction's own thickness (its materials' Thickness fields)
  if (kivaSlabCons.size) {
    const text = L.join("\n"), thick = new Map<string, number>(), layers = new Map<string, string[]>();
    for (const o of parseIdfObjects(text, "in.idf")) {
      if (o.cls === "Material" && o.fields[0]) thick.set(o.fields[0].toUpperCase(), Number(o.fields[2]));
      if (o.cls === "Construction" && o.fields[0]) layers.set(o.fields[0].toUpperCase(), o.fields.slice(1));
    }
    for (let i = 0; i < L.length; i++) L[i] = L[i]!.replace(/@@KIVA_TURNUP_DEPTH (.*?)@@/g, (_m, kn: string) => {
      const d = (layers.get((kivaSlabCons.get(kn) ?? "").toUpperCase()) ?? []).reduce((s, n) => s + (thick.get(n.toUpperCase()) ?? 0), 0);
      return (d > 0 ? d : 0.1016).toFixed(4);
    });
  }
  // a template's coils exist only once the engine expands it (2026-10-23: a PTHP sample ran with no coil rates, its Peak per system empty)
  if (L.some((l) => /^(Coil:(Heating|Cooling)|HVACTemplate:(System:|Zone:(PTHP|PTAC|WaterToAirHeatPump|FanCoil|VRF|Unitary|VAV|ConstantVolume|DualDuct)))/.test(l))) for (const v of [COIL_RATE.heating, COIL_RATE.cooling]) { obj("Output:Variable", "*", v, "Timestep", ddOnly); obj("Output:Variable", "*", v, "Hourly"); }
  // EACH ZONE'S AIR HEAT BALANCE ON THE DESIGN DAYS (user, 2026-10-11: "Peak conditioning heating and cooling charts do not make sense"):
  // the engine's Zone Component Load Summary splits a peak by its radiant-pulse method, and with Kiva foundations in the model that split
  // came out unbounded (the Basement's equipment +14.6 kW against a floor at −8.9 kW, the total unchanged). The zone air's own balance at
  // each zone timestep — every surface's convection, the convective gains, the outdoor air, the mixing, the zone equipment, the air's
  // storage — closes on the unit's supply (within 12 W on this house, measured) and is what PEAK draws
  for (const v of ZONE_BALANCE_VARIABLES) obj("Output:Variable", "*", v, "Timestep", ddOnly);
  if (L.some((l) => /^ZoneHVAC:EnergyRecoveryVentilator,/.test(l))) for (const v of ERV_RATE_VARIABLES) obj("Output:Variable", "*", v, "Timestep", ddOnly);
  return { idf: L.join("\n"), report };
}

/** the reason a roof cell outside conditioned space is not a building surface — it is written as shading (2026-10-01) */
export const ROOF_SHADE_REASON = "outside conditioned space — written as shading (an eave, a porch roof)";

export function formatIdfWrite(r: IdfWriteReport): string[] {
  const bc = (k: Bc): string => `${k} ${r.byBc[k].count} (${r.byBc[k].areaM2.toFixed(1)} m²)`;
  return [
    `  IDF WRITTEN FROM idf.db (the engine as an instrument): ${r.zones} zones (${r.zonesWithVolume} with a volume from the file's solid) · ` +
      `${r.surfaces} surfaces = ${bc("Outdoors")} · ${bc("Ground")} · ${bc("Surface")} · ${bc("Adiabatic")}`,
    `    types: wall ${r.byType.Wall} · floor ${r.byType.Floor} · ceiling ${r.byType.Ceiling} · roof ${r.byType.Roof} · ` +
      `inter-zone pairs ${r.interZonePairs} · internal partitions (one zone both sides) not emitted ${r.internalPartitions}`,
    `    subsurfaces: windows ${r.windows} · glass doors ${r.glassDoors} · exterior doors ${r.exteriorDoors} · skylights ${r.skylights} · holes matched to no placed opening (kept as windows) ${r.unmatchedHoles} · interior door pairs ${r.interiorDoors} · holes NOT emitted: ` +
      `${r.holesSkipped.manyVertices} with 5+ vertices (a ruling each), ${r.holesSkipped.onFloorOrCeiling} in floors/ceilings (stair openings: AirBoundary or a ruling), ` +
      `${r.holesSkipped.onAdiabaticOrGround} on adiabatic/ground bases · emitted with an edge ON the base's outline (an opening the carve cut through) ${r.holesOnBaseEdge}`,
    `    below the engine's 1 cm resolution, NOT emitted: ${r.belowResolution.surfaces} cells, ${r.belowResolution.areaM2.toFixed(3)} m²`,
    `    ROOF OUTSIDE CONDITIONED SPACE (shade): ${r.roofShade.cells} cells, ${r.roofShade.areaM2.toFixed(2)} m² → ${r.roofShade.surfaces} Shading:Building:Detailed, ${r.roofShade.writtenM2.toFixed(2)} m² written`,
    (() => {
      // EVERY EXTERIOR OPENING (2026-10-01): the file's rectangle against what the model carries, every loss named
      const A = r.openingAccounts, sum = (f: (x: OpeningAccount) => number): number => A.reduce((t, x) => t + f(x), 0);
      const lost = A.filter((x) => x.losses.reduce((t, l) => t + l.m2, 0) > 0.005);
      return `    EXTERIOR OPENINGS (from their own rectangles): ${A.length} — windows ${A.filter((x) => x.op.kind === "window").length} · doors ${A.filter((x) => x.op.kind !== "window").length} · ` +
        `the file's rectangles ${sum((x) => x.placedM2).toFixed(2)} m² = written ${sum((x) => x.emittedM2).toFixed(2)} + overlapping another opening ${sum((x) => x.overlapM2).toFixed(2)} + the rectangle past what was cut ${sum((x) => x.overWallM2).toFixed(2)} + NOT IN THE MODEL ${sum((x) => x.losses.reduce((t, l) => t + l.m2, 0)).toFixed(2)}` +
        (lost.length ? ` — ${lost.map((x) => `${x.op.name.split(":").slice(0, 2).join(":")} ${x.losses.map((l) => `${l.m2.toFixed(2)} m² ${l.reason}`).join(", ")}`).join(" · ")}` : "");
    })(),
    `    unclaimed by any zone, NOT emitted: ${r.unclaimed.surfaces} surfaces — EXTERIOR-FACING ${r.unclaimed.exteriorSurfaces} surfaces, ${r.unclaimed.exteriorAreaM2.toFixed(1)} m² ` +
      `(envelope the model does not see: ${Object.entries(r.unclaimed.exteriorByCategory).map(([c, a]) => `${c} ${a.toFixed(1)}`).join(", ")}) · ` +
      `interior ${r.unclaimed.interiorAreaM2.toFixed(1)} m² (material between solids, belongs to no zone)`,
    `    model: ${r.model.envelope === "generic" ? "generic one-layer constructions" : (() => { const t = ieccFor(r.model.climateZone, r.model.energyCode); return `${t.edition.label.replace(/ \(.*\)$/, "")} climate zone ${t.zone} envelope, the table's row ${t.row} (assembly U with films: frame wall ${t.frameWallU.toFixed(3)}, basement wall ${t.basementWallU.toFixed(3)}, ceiling ${t.ceilingU.toFixed(3)}, floor ${t.floorU.toFixed(3)}, fenestration ${t.fenestrationU.toFixed(2)} / SHGC ${(t.fenestrationSHGC ?? 0.40).toFixed(2)}${t.fenestrationSHGC === null ? " (NR — 0.40 kept)" : ""}, slab ${t.slabR > 0 ? `R-${t.slabR}` : "uninsulated"}; ${t.ach50} ACH50 → ${(t.ach50 / 20).toFixed(2)} ACH)`; })()} · ` +
      `${r.model.idealLoads ? `ideal loads at 72/75 °F in ${r.model.conditionedZones.length} conditioned zones; unconditioned: ${r.model.unconditionedZones.join(", ")}` : "no HVAC"}` +
      (r.model.groundFloorsDefault.count ? ` · ${r.model.groundFloorsDefault.count} lowest floors given Ground by default (${r.model.groundFloorsDefault.areaM2.toFixed(1)} m²)` : "") +
      (r.groundFromTerrain.count ? ` · ${r.groundFromTerrain.count} surfaces given Ground on the terrain's word (${r.groundFromTerrain.areaM2.toFixed(1)} m²)` : ""),
    `    constructions by gross area: ` + Object.entries(r.model.constructionAreaM2).sort((a, b) => b[1] - a[1]).map(([k, a]) => `${k} ${a.toFixed(0)}`).join(" · "),
    `    winding: ${r.storedRingsReversed} stored rings were clockwise about their own normal (re-wound) · ` +
      `emitted rings pointing into their zone ${r.windingViolations} ${r.windingViolations === 0 ? "✓" : "✗ REVERSED"} · Building North Axis ${r.northAxisDeg.toFixed(1)}° from the file's TrueNorth`,
  ];
}
