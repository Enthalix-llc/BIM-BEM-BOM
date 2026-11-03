// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// bem.db — THE ENERGY MODEL'S FILE. What the BEM module decided and what the
// engine said, every value with its `source`: `file` (the IFC or the weather
// file states it), `code-default` (the 2018 IRC table, the IECC reference
// thermostat, the name rule for conditioning — defaults the census names) or
// `user` (the ledger). The rows a downstream module reads join to idf.db by
// the surface row id; the engine's numbers are stored in the engine's units
// and converted at the display edge.
//
// Everything hourly, and everything else the engine wrote, stays in the run
// folder beside eplusout.sql and is read there. bem.db holds what the views
// read: the model as run, the runs, and the results the paint and the tables
// need, in one long table keyed by scope / key / month / metric.

import type { CheckRow, ZoneSide } from "./modelChecks.js";
import type { ScheduleDays } from "./scheduleDays.js";
import type { DaySetDef } from "./scheduleParts.js";
import type { Database, SqlJsStatic } from "sql.js";
import type { SystemQaRow } from "./systemQa.js";
import type { BemInput } from "./bemInput.js";
import type { IdfWriteReport } from "./bemIdf.js";
import type { RunResults, EndUseCell, FuelPeak, SizingDetail, ComponentLoad } from "./eplusSql.js";
import { encodeTime, annualByKey, zoneOfKey, J_PER_KWH } from "./eplusSql.js";
import { sha256Hex } from "../../../core/sha256.js";
import type { MaterialRef, MaterialKind } from "./materialsDb.js";
import type { LayerRole } from "./layerRoles.js";
export type { MaterialRef };

import type { Source, Sourced } from "./bemIdf.js";
export type { Source, Sourced } from "./bemIdf.js";

/** THE BEM LEDGER: the user's decisions about one IFC, keyed to its sha —
 *  never to idf.db's bytes, which change on every rebuild */
/** THE ENERGY CODE (user, 2026-09-16): the code whose prescriptive tables the code default reads — an edition or a state's adoption from
 *  the user's own tables (data/energy-codes/). The climate zone is the user's reading of their county's row in the code's table */
export type EnergyCodeId = string;
/** THE CODE CONFIRMED (user, 2026-09-29): an edition ("IECC-2021") or a state's adoption from the user's tables (data/energy-codes/),
 *  the permit (application) date that decides which adoption applies, the climate zone the user read for the county ("4A"), and when
 *  the user confirmed it */
export interface EnergyCodeRuling { adoption: EnergyCodeId; referenceDate?: string; confirmedAt?: string; climateZone?: string }
/** the climate zone the user entered with the code ("" when none) */
export const climateZoneOf = (e: EnergyCodeRuling | EnergyCodeId | undefined): string => (typeof e === "object" && e?.climateZone ? e.climateZone : "");
/** the ruling's code id — the first days' ruling was the bare id string */
export const energyCodeIdOf = (e: EnergyCodeRuling | EnergyCodeId | undefined): EnergyCodeId | undefined => (typeof e === "string" ? e : e?.adoption);
export interface SiteRuling {
  /** the energy code the code default reads (2026-09-16; an object since 2026-09-29, a bare id string before); unset = 2018 IECC */
  energyCode?: EnergyCodeRuling | EnergyCodeId;
  /** design days by name (the .ddy's); unset = the coldest and the hottest valid */
  designDays?: string[];
  runPeriod?: { begin: [number, number]; end: [number, number] };
  /** ground temperatures: `epw:<depth m>` — one of the depths the EPW states; `estimate:<depth ft>` — the geokiss
   *  estimate at 3, 10 or 30 ft from the EPW's air temperatures (2026-09-15, under investigation); or twelve numbers */
  groundTemp?: { from: string } | { values: number[] };
  northAxisDeg?: number;
  timestep?: number;
  shadowCalculation?: string;
  terrain?: string;
  solarDistribution?: string;
  /** the site's position when the user located it on the map (2026-09-07);
   *  unset = the IfcSite's own. `label` is the address or the map's word */
  location?: { latitude: number; longitude: number; elevationM?: number; label?: string };
}
/** what governs a type's construction (2026-09-08): the code default, the file's stated U, a dataset
 *  construction emitted verbatim, the file's own layers each given a material, a typed U / NFRC set,
 *  or another type's construction (an alias — "select other", the user's ruling of 2026-09-08) */
export type ConsSource = "code" | "file" | "library" | "layers" | "u" | "sameAs";
/** a path through a layer's placement: the stud and the batt between the studs, each a fraction of the area (Σ = 1) */
export interface LayerPart { ref: MaterialRef; fraction: number }
/** one of the file's layers as ruled. Its IDENTITY is `seq`, the index among the file's non-part layers
 *  (type_layers.seq) — a pick without one is a legacy ruling matched by material name, each file layer claimed once */
export interface LayerPick {
  seq?: number;
  /** the file's material name — for the reader, and the legacy match */
  material: string;
  /** the old dataset pick, still honoured; `ref` wins when both are there */
  library?: { file: string; name: string };
  /** the pick: a materials.db row by key, or a dataset object by name */
  ref?: MaterialRef;
  /** a typed R → one NoMass layer, the user's */
  rSi?: number;
  /** overrides the file's thickness, the user's */
  thicknessM?: number;
  /** THE LAYER'S CATEGORY, ruled (user, 2026-09-08: "unable to change the second component to a Vapor Barrier"): what the
   *  layer IS — siding, air gap, vapour barrier … — when the file's name is not it; the candidates follow it. The file's name
   *  and position (`seq`) stay the layer's identity */
  kind?: MaterialKind;
  /** THE LAYER'S ROLE, ruled (user, 2026-09-16: the palette culled by the assembly and the layer's position): what the layer does
   *  in the assembly — roofing, cladding, barrier, sheathing, structure, insulation, air, the interior finish, the finish floor,
   *  ground contact — when the file's word or the position read it wrong; the palette's list follows it. `kind` (2026-09-08)
   *  stays for the older rulings, read only */
  role?: LayerRole;
  /** ALL the paths through this placement (stud 0.25 + batt 0.75); `ref` is ignored when present */
  parts?: LayerPart[];
  /** how the parts become one layer: the parallel-path method (ASHRAE HOF, wood framing) unless said otherwise */
  method?: "parallel-path" | "isothermal-planes";
  /** DELETED (user, 2026-09-09: "layer 5 needs to be deleted by user"): the file's layer struck — not drawn, not emitted;
   *  the file's word stays on the row for accounting and the layer can be restored */
  deleted?: true;
  /** ADDED (the same day): a layer the file lacks. `seq` is negative and unique within the ruling; `after` names the
   *  layer it follows from the outside (a seq; null or absent = outside everything); `material` is the user's word */
  added?: true;
  after?: number | null;
  /** A CUSTOM EDIT (user, 2026-09-29: "Create a custom edit … allows field values to be edited in MVT. When MV button is applied,
   *  any custom layer edits are saved"): the layer's name, R and reflectance typed in the DETAIL list over what its pick states — a
   *  DRAFT until Apply assembly, which saves it as a material of yours (`customLayerMaterial`) and puts that row's key in `ref` */
  custom?: LayerCustom;
}
/** what a custom edit may change: the name, the R at the layer's thickness (m²K/W), the solar reflectance SR and the thermal
 *  emittance TE (0–1 each; TE is the engine's thermal absorptance, added 2026-09-29) */
/** `source`: what the user typed in the MVT's source cell (2026-09-29) — the document, data sheet or page the numbers came from;
 *  a URL in it is kept as the row's URL */
export interface LayerCustom { name?: string; rSi?: number; refl?: number; te?: number; source?: string }
/** ONE WRITER for a layers ruling: the picks as the file's-layers ruling, promoted from code / file / library, the name kept */
export function withLayers(st: ConstructionRuling | undefined, layers: LayerPick[]): ConstructionRuling {
  return { ...(st?.source === "layers" ? st : {}), ...(st?.name ? { name: st.name } : {}), source: "layers", outsideFirst: st?.outsideFirst ?? true, layers };
}
/** the next seq for an added layer: negative, below every seq in use */
export const nextAddedSeq = (layers: LayerPick[]): number => Math.min(0, ...layers.map((l) => l.seq ?? 0)) - 1;
export interface ConstructionRuling {
  source: ConsSource;
  /** one dataset Construction, by file and name */
  library?: { file: string; name: string };
  /** "u": an assembly U with films; a window's NFRC U / SHGC / VT */
  uWm2k?: number; shgc?: number; vt?: number;
  /** "u" FROM A GLAZING PRODUCT (2026-09-16): the materials.db product the numbers were taken from — its key, its name (the
   *  SimpleGlazingSystem is named for it) and its source id (marvin: an NFRC rating; opus: the user's reference list); a
   *  number typed over the product's clears it; a product with no published VT leaves `vt` undefined and the field blank */
  product?: { key: string; name: string; source: string };
  /** "layers": the file's stack as ruled; the file's order is outside-first unless said otherwise */
  layers?: LayerPick[];
  outsideFirst?: boolean;
  /** windows on the layer track only: a WindowProperty:FrameAndDivider */
  frame?: { widthM: number; conductanceWm2k: number };
  /** the Construction's name in the IDF, typed in the DETAIL view; the writer's namer sanitises it (`, ; !` → `_`, 90 chars) */
  name?: string;
  /** "sameAs": the name of the type whose construction this type takes; every other field is ignored */
  sameAs?: string;
  /** COMBINED (user, 2026-09-09: "combining all exact types to the one selected for aggregating gross area and count,
   *  reducing rows"): this alias was made by the combine dialog — the column folds the type into its target's row */
  combined?: true;
  /** A DOOR'S GLASS SHARE, typed on CONSTRUCTIONS (the user, 2026-10-07: "there are 100% commercial glass doors, so setting the
   *  percentage is an item needed"), 0–1: 1 the whole opening a GlassDoor, 0 a solid Door, between the door split (the glass
   *  centred at √f each way, four solid pieces round it). It rides with the type whatever its Reference — a ruling of source
   *  "code" holding only this is the code default's construction with a typed share. Absent = the file's stated share, else the
   *  door's glass / solid verdict whole. */
  glassShare?: number;
}
/** how the ground-coupled surfaces are modelled (slice 4): plain Ground, the ASHRAE 90.1 F/C-factor method, or Kiva */
/** the ground coupling ruled (2026-09-08); since 2026-10-10 the slab insulation's extent too — at the edge (`slabDepthM` the distance in
 *  from the wall's inside face) or the full slab — and Kiva the default method */
/** `fIp` / `cIp`: the F-factor (Btu/h·ft·°F) and C-factor (Btu/h·ft²·°F) the F/C method writes — typed by the user from their own copy of
 *  ASHRAE 90.1 Appendix A (Tables A6.3.1 / A4.2.1); the standard's tables do not ship with the program */
export interface GroundRuling { method?: "ground" | "fcfactor" | "kiva"; slabR?: number; slabDepthM?: number; slabExtent?: "edge" | "full"; wallR?: number; fIp?: number; cIp?: number }
/** a schedule ruled for a role (2026-09-09): one of the engine's own objects, by file (its base name) and name */
export type { ScheduleRef, ScheduleRole } from "./schedules.js";
export type { SystemSection } from "./mepFocus.js";
import type { SystemSection } from "./mepFocus.js";
import type { Assembly, ZoneAssign } from "./assembly.js";

// ── THE SYSTEMS RULINGS (2026-09-10): per subsection of the SYSTEMS tab, what the model runs on — a kind that is one
//    of the engine's own objects, its fields by the epJSON snake name (a key absent = the engine's default, blank in
//    the IDF; "autosize" a string), the zones it takes, and where a value came from when it is not the user's:
//    the file's equipment (`from`, a type NAME read as a default — the glazedByName precedent) or a cited dataset.
//    Presence is the user's statement (HPXML): a ruling that is there is enabled; its absent fields default with a citation.
export type FieldValue = string | number;
export type SystemFields = Record<string, FieldValue>;
export interface FromFile { file: string; fileExpressId: number; name: string; system?: string }
export type HvacKind = "HVACTemplate:Zone:IdealLoadsAirSystem" | "HVACTemplate:Zone:PTHP" | "HVACTemplate:Zone:PTAC" | "HVACTemplate:Zone:BaseboardHeat"
  | "HVACTemplate:System:Unitary" | "HVACTemplate:System:UnitaryHeatPump:AirToAir" | "HVACTemplate:Zone:WaterToAirHeatPump"
  /** the engine offers no template for a unit heater, so an EUH is the real object set (user, 2026-09-11: the garage) */
  | "ZoneHVAC:UnitHeater"
  /** the ducted parents, written in full with their own air loop (2026-09-11) */
  | "AirLoopHVAC:UnitaryHeatPump:WaterToAir" | "AirLoopHVAC:UnitarySystem";
export const HVAC_KINDS: readonly HvacKind[] = ["HVACTemplate:Zone:IdealLoadsAirSystem", "HVACTemplate:Zone:PTHP", "HVACTemplate:Zone:PTAC", "HVACTemplate:Zone:BaseboardHeat",
  "HVACTemplate:System:Unitary", "HVACTemplate:System:UnitaryHeatPump:AirToAir", "HVACTemplate:Zone:WaterToAirHeatPump", "ZoneHVAC:UnitHeater", "AirLoopHVAC:UnitaryHeatPump:WaterToAir", "AirLoopHVAC:UnitarySystem"];
/** ONE hvac list serves Heating and Cooling (a heat pump is both); a zone is in at most one ruling; every other conditioned zone keeps ideal loads */
/** the plant a ruling stands on: the WSHP's mixed-water loop (boiler and tower stated or refused), and a hot-water loop with its boiler for a HotWater coil or baseboard — a loop shared by several rulings is emitted once, by its id */
export interface HvacPlant { loop?: SystemFields; boiler?: SystemFields; tower?: SystemFields; resources?: Array<"ground" | "reclaim" | "solar">; hotWater?: { id: string; loop?: SystemFields; boiler?: SystemFields; resources?: Array<"ground" | "reclaim" | "solar"> } }
export interface HvacRuling { id: string; kind: HvacKind; fields?: SystemFields; zoneFields?: SystemFields; plant?: HvacPlant; zones: string[]; from?: FromFile; note?: string;
  /** the dedicated outdoor-air system feeding this zone equipment (PTHP, PTAC, WSHP, baseboard take one; a System:* kind takes its own air) — emitted once by its id */
  doas?: { id: string; fields?: SystemFields };
  /** a COMPONENT card's air loop (2026-09-12): what the sheet compiled it to, which the generator writes in full — the parent, its
   *  fan and coils, the terminal per zone, the loop its water side stands on */
  wired?: WiredAirLoop }
/** one part of a wired system: an EnergyPlus class and the user's fields on it */
export interface WiredPart { cls: string; fields?: SystemFields }
export interface WiredAirLoop {
  /** AirLoopHVAC:UnitarySystem · AirLoopHVAC:UnitaryHeatPump:WaterToAir */
  parent: string;
  fan: WiredPart; cooling: WiredPart; heating: WiredPart; supplemental?: WiredPart;
  /** the zone whose thermostat the unit follows */
  controlZone: string;
  terminals: Array<{ zone: string; cls: string; fields?: SystemFields }>;
  /** the loop ruling its coils' water side stands on (LoopRuling.id) */
  loop?: string;
  /** the zones served WITHOUT a thermostat (their Zone card's T off, 2026-09-12): fed through their terminals, not controlled — no ZoneControl:Thermostat is written for them */
  uncontrolled?: string[];
  /** SingleZoneVAV asks for the control zone on the parent; Load is the default; SetPoint (2026-09-13) is the multi-thermostat shape */
  control?: string;
  /** SETPOINT CONTROL (2026-09-13): the supply-air setpoint PER MODE — reset to the neediest zone (Warmest on the cooling coil's outlet,
   *  Coldest on the heating coil's and the unit's) unless the card states a supply temperature for the mode (the user's controller,
   *  the same evening: "setpoints per mode"), which the generator holds with a Scheduled manager on a constant */
  setpoints?: { cooling: "Warmest" | "Scheduled"; heating: "Coldest" | "Scheduled"; coolingSupplyC?: number; heatingSupplyC?: number };
  /** THE CHANGEOVER between heating and cooling on the zones' AGGREGATE demand (user, 2026-09-13): the engine's own four words
   *  (its zoning unit's priority_control_mode), transcribed into an EMS program — ZonePriority the larger count of zones calling
   *  (the default: the user's "zone voting", a tie to the larger total, then heating), LoadPriority the larger total load,
   *  Cooling/HeatingPriority that mode whenever any zone calls; and the unit STOPS while no zone calls (the loop forced off) */
  changeover?: "LoadPriority" | "ZonePriority" | "CoolingPriority" | "HeatingPriority";
  /** THE CONVERGENCE of the parent's part-load iteration (user, 2026-09-14): a card written as one unit per thermostat takes 1/n on every
   *  unit — the reciprocal of the number of identical units, the user's way of modelling one multizone unit's response — unless the
   *  card types its own; a single unit keeps the engine's default (0.001) */
  convergence?: number;
  /** THE OUTDOOR-AIR CORE (user, 2026-09-13: "a heat reclaim unit for outside air, with a static media exchanger and not a separate
   *  conditioning process"): a HeatExchanger:AirToAir:SensibleAndLatent whose supply outlet runs to the unit's OA in — the generator
   *  writes the outdoor-air system ahead of the unit (the core first, then the mixer, the controller, the outdoor node) and the
   *  outdoor-air specification the zones are sized on; the rate is the resolver's (ASHRAE 62.2 per floor area) */
  /** `coreId` the core card the outdoor air runs through (2026-10-07) — every unit it feeds shares that card's rated flow; `minM3s` this
   *  unit's share of it, the controller's minimum and the core's nominal flow */
  oa?: { core: WiredPart; coreId?: string; perAreaM3sM2?: number; minM3s?: number; citation?: string;
    /** A RATED ERV IS ITS OWN UNIT (user, 2026-10-07: "I set the ERV to be continuous … When the conditioning heat pumps cycle, the erv
     *  still runs"; "There should be no EA or OA adjustment to the conditioning heat pump"): each zone's share of the rated flow, m³/s —
     *  a ZoneHVAC:EnergyRecoveryVentilator per zone on the card's schedule, the unit itself with no outdoor-air system */
    zoneM3s?: Record<string, number>;
    /** the core card's name on the sheet (its ID, else its label) — the ERV's fans report under it (user, 2026-10-07: "seperate the House and ADU ERVs") */
    cardName?: string };
}
/** a FLUID LOOP compiled from the sheet (2026-09-12): a water ring through a pump, its producers and its consumers, or an
 *  explicit PlantLoop / CondenserLoop card with them on its sides — written in full by the generator */
export interface LoopRuling {
  id: string; cls: "CondenserLoop" | "PlantLoop"; fields?: SystemFields;
  pump: WiredPart;
  producers: Array<{ cls: string; name: string; fields?: SystemFields }>;
  /** the hvac rulings whose water side is on this loop's demand side */
  consumers: string[];
}
export interface VentilationRuling {
  /** whole-house: a ZoneVentilation:DesignFlowRate on the conditioned zones at the ASHRAE 62.2 / ANSI 301 rate, or heat recovery through the templates' own outdoor-air fields */
  wholeHouse?: { kind: "Exhaust" | "Intake" | "Balanced" | "HeatRecovery"; fields?: SystemFields; bedrooms?: number; cfaM2?: number; recovery?: "Sensible" | "Enthalpy"; from?: FromFile;
    /** the zones on the list when the assembly connects some; absent = every conditioned zone */
    zones?: string[] };
  /** local exhaust per zone (kitchen, baths), on the SCHEDULES ventilation role */
  local?: Array<{ id: string; zone: string; cfm?: number; from?: FromFile }>;
}
export interface PowerRuling { equipment: Array<{ id: string; zone: string | null; name: string; fields?: SystemFields; schedule?: ScheduleRef; subcategory: string; source: "dataset" | "file" | "user"; from?: FromFile; enabled: boolean }> }
export interface LightingRuling { method: "fixtures" | "wattsPerArea"; perZone?: Record<string, { wattsW?: number; wm2?: number }>; exterior?: { wattsW?: number; enabled: boolean }; fields?: SystemFields }
export interface GenerationRuling {
  /** THE ELECTRICAL SHEET (user, 2026-10-02: "assembled like the mechanical systems"): the arrays, inverters, load centres and the
   *  utility the user drew; when present it governs, and `pv` (the form it replaced) is not read */
  assembly?: Assembly;
  pv?: { enabled: boolean; fields?: SystemFields; arrays?: Array<{ idfSurfaceId: number; panels: number; dcW?: number }>; from?: FromFile };
  storage?: { enabled: boolean; fields?: SystemFields; from?: FromFile };
  generator?: { listed: true };
}
export interface DhwRuling {
  /** THE PLUMBING SHEET (user, 2026-10-02: water heaters — heat pump, electric, gas — each in a room, and the hot-water use the code
   *  states): the cards and lines the user drew; when present it governs (plumbSheet.ts → dhwWrite.ts) */
  assembly?: Assembly;
  kind?: "WaterHeater:Mixed" | "WaterHeater:HeatPump:WrappedCondenser"; fields?: SystemFields; tankFields?: SystemFields; coilFields?: SystemFields; zone?: string | null;
  fixtures?: Array<{ group: "showers" | "baths" | "sinks" | "dishwasher" | "clothesWasher"; enabled: boolean; peakM3s?: number; zone?: string | null; schedule?: ScheduleRef }>; from?: FromFile }
export interface WaterRuling { mains?: { method: "CorrelationFromWeatherFile" | "Correlation"; fields?: SystemFields }; meters: boolean }
export interface SystemsRuling {
  /** the MECHANICAL assembly (2026-09-10): the nodes and connectors the user drew; `hvac` and `ventilation` are COMPILED from it (assembly.ts) and are what the writer reads */
  assembly?: Assembly;
  /** zone → the assembly's node ids serving it (the ZONES tab's word; a from-file node pre-fills it from its ducts) */
  assign?: ZoneAssign;
  hvac?: HvacRuling[]; ventilation?: VentilationRuling; power?: PowerRuling; lighting?: LightingRuling; generation?: GenerationRuling; dhw?: DhwRuling; water?: WaterRuling;
  /** the fluid loops the sheet's component cards compile to (2026-09-12), written in full by the generator */
  loops?: LoopRuling[] }
import type { ScheduleRef, ScheduleRole } from "./schedules.js";
/** THE GAINS (user, 2026-09-13, evening: "emit by default, but zone then individual room can be edited — if by zone, all related
 *  spaces in the zone receive the settings"): a ruling per ZONE (every room of the zone takes it, an absolute count or W by floor
 *  share) or per ROOM (overrides its zone's); absent = the cited residential default (bemGains.ts). `none` is a ruling of zero. */
export interface GainEquipmentRow { id: string; name: string; wattsW?: number; wm2?: number; subcategory: string; latent?: number; radiant?: number; lost?: number; schedule?: ScheduleRef; enabled: boolean;
  /** the equipment group the row belongs to (2026-10-03); absent = the example's own row's group, else "other" */
  group?: EquipmentGroup }
export type EquipmentGroup = "cooking" | "refrigeration" | "dishwasher" | "laundry" | "charging" | "entertainment" | "work" | "other";
export interface GainRuling {
  people?: { count?: number; perAreaM2?: number; activityW?: number; fractionRadiant?: number; none?: true };
  lights?: { wattsW?: number; wm2?: number; fixtures?: true; none?: true };
  equipment?: GainEquipmentRow[];
  /** A ROOM IS A BEDROOM (the user, 2026-10-07: "Please add bedroom checkbox per room in Zones" — the ADU is a bedroom), ticked on
   *  ZONES for a room; absent = by its name ("Bed n"). The ONE place a bedroom is said: the people, the ventilation rate and the
   *  hot-water use all count these */
  bedroom?: boolean;
}
export interface GainRulings { zones?: Record<string, GainRuling>; rooms?: Record<string, GainRuling> }
export interface BemLedger {
  sourceIfcSha256: string;
  savedAt: string;
  weather?: { epw: string };
  /** the SITE tab's rulings (2026-09-04) */
  site?: SiteRuling;
  zones: Record<string, { conditioned?: boolean; heatingSetpointC?: number; coolingSetpointC?: number; infiltrationAch?: number }>;
  /** the CONSTRUCTIONS tab's rulings (2026-09-08), keyed by the type's name as the file states it */
  constructions: Record<string, ConstructionRuling>;
  ground?: GroundRuling;
  /** the SCHEDULES tab's rulings (2026-09-09): per role, one of the engine's own schedules; a role absent here runs on the code default */
  schedules?: Partial<Record<ScheduleRole, ScheduleRef>>;
  /** THE RETIRED DAY PARTS (2026-10-02, retired 2026-10-05 for the editor's buttons): read only — its holiday set stands
   *  until `holidays` is ruled; its picks are named as no longer applied */
  scheduleDays?: ScheduleDays;
  /** THE PROJECT'S HOLIDAY LIST (2026-10-05): the engine's RunPeriodControl:SpecialDays — every schedule's Holiday profile
   *  runs on these days; null = none ruled (the retired calendar's set, if any, is replaced by none) */
  holidays?: DaySetDef | null;
  /** THE PROJECT'S COPIES of the user's own schedules it runs on (2026-10-05, the user: "the project database must save
   *  the schedules for the project"): name (lower case) → the IDF text of the schedule and its type limits, as applied.
   *  A ruling naming one of the user's schedules resolves to this copy — a later re-save in another project never moves it */
  scheduleCopies?: Record<string, string>;
  /** the SYSTEMS tab's rulings (2026-09-10), per subsection; absent = the code default */
  systems?: SystemsRuling;
  /** the ZONES tab's gain rulings (2026-09-13), by zone and by room; absent = the cited residential defaults on every conditioned room */
  gains?: GainRulings;
  /** A SIDE LEFT OFF, APPROVED (user, 2026-11-03: "that qa should allow for a checkbox to approve the lack of heating and/or
   *  cooling"): by the Zone card's name, when the user approved its heating / cooling switched off. An approved side does not
   *  stop the run; a side switched back on makes its approval moot (it is kept, and read again if the side goes off) */
  sideApprovals?: Record<string, { heating?: string; cooling?: string }>;
  /** STAGED, NOT YET APPLIED (2026-09-09): what the CONSTRUCTIONS and SITE
   *  tabs hold on their Apply buttons, written as it is staged so a restart
   *  keeps the user's work (the user, 2026-09-09: "the idf db changes were
   *  not retained" — a stage that lived only in the process) */
  staged?: { at: string; constructions?: Record<string, ConstructionRuling>; ground?: GroundRuling; site?: SiteRuling; schedules?: Partial<Record<ScheduleRole, ScheduleRef>>; holidays?: DaySetDef | null; systems?: SystemsRuling; gains?: GainRulings };
  /** THE FILE CHANGED: carried from an earlier version of the file (core/ifcChanges.ts) */
  carriedFrom?: { fromSha: string; fromName: string; at: string; carried: number; kept: string[]; overwritten: string[]; dropped: string[] };
}

export interface BemZoneRow {
  name: string;
  epName: string;
  kind: "room" | "attic";
  volumeM3: number;
  volumeSource: string;
  conditioned: Sourced<boolean>;
  heatingSetpointC: Sourced<number | null>;
  coolingSetpointC: Sourced<number | null>;
  infiltrationAch: Sourced<number>;
  /** a blower-door ruling's words (2026-10-08); "" for a constant ACH */
  infiltrationNote?: string;
}

export interface BemRun {
  stamp: string;
  dir: string;
  epw: string | null;
  exitCode: number | null;
  completed: boolean;
  fatal: number;
  severe: number;
  warning: number;
  seconds: number;
  energyplusVersion: string;
  /** the model (meta.model_sha256) this run was run on */
  modelSha256?: string;
  /** "design" — BEM's run on the model's own weather; "calibration" — BOM's run of the same model on the actual year the bills were
   *  metered under (2026-10-09). Each kind keeps its own hours; the latest design run is BEM's last word, never a calibration one */
  kind?: "design" | "calibration";
}

const DDL = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, source TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS zones (
  name TEXT PRIMARY KEY, ep_name TEXT NOT NULL, kind TEXT NOT NULL,
  volume_m3 REAL, volume_source TEXT NOT NULL,
  conditioned INTEGER NOT NULL, conditioned_source TEXT NOT NULL,
  heating_setpoint_c REAL, cooling_setpoint_c REAL, setpoint_source TEXT,
  infiltration_ach REAL, infiltration_source TEXT NOT NULL,
  infiltration_note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS constructions (name TEXT PRIMARY KEY, kind TEXT NOT NULL, layers TEXT NOT NULL, u_w_m2k REAL, u_source TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS schedules (role TEXT PRIMARY KEY, name TEXT NOT NULL, file TEXT NOT NULL, cls TEXT NOT NULL, type_limits TEXT, source TEXT NOT NULL, weekday TEXT, weekend TEXT, blocks INTEGER NOT NULL, in_use INTEGER NOT NULL, note TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS systems (id TEXT PRIMARY KEY, section TEXT NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL, source TEXT NOT NULL, zones TEXT NOT NULL, objects INTEGER NOT NULL, object_names TEXT NOT NULL, fields TEXT NOT NULL, refused TEXT NOT NULL, note TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS system_qa (subject TEXT NOT NULL, kind TEXT NOT NULL, cls TEXT NOT NULL, gaps INTEGER NOT NULL, checks TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS checks (rule TEXT NOT NULL, subject TEXT NOT NULL, verdict TEXT NOT NULL, text TEXT NOT NULL, fix TEXT NOT NULL, data TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS rooms (
  room TEXT PRIMARY KEY, zone TEXT NOT NULL, ep_name TEXT NOT NULL, floor_m2 REAL NOT NULL, conditioned INTEGER NOT NULL,
  people REAL NOT NULL, people_source TEXT NOT NULL, people_note TEXT NOT NULL,
  lights_w REAL NOT NULL, lights_source TEXT NOT NULL, lights_note TEXT NOT NULL,
  equipment_w REAL NOT NULL, equipment_source TEXT NOT NULL, equipment TEXT NOT NULL, schedules TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS surfaces (
  ep_name TEXT PRIMARY KEY, idf_surface_id INTEGER, element_id INTEGER NOT NULL, global_id TEXT,
  zone TEXT NOT NULL, zone_facing TEXT, side INTEGER NOT NULL,
  type TEXT NOT NULL, bc TEXT NOT NULL, bc_source TEXT NOT NULL,
  construction TEXT NOT NULL, construction_source TEXT NOT NULL, gross_area_m2 REAL NOT NULL,
  code_construction TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS surfaces_idf ON surfaces(idf_surface_id);
CREATE TABLE IF NOT EXISTS subsurfaces (ep_name TEXT PRIMARY KEY, base_ep_name TEXT NOT NULL, kind TEXT NOT NULL, hole_index INTEGER NOT NULL, construction TEXT NOT NULL, construction_source TEXT NOT NULL, code_construction TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS not_emitted (idf_surface_id INTEGER, reason TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS runs (
  stamp TEXT PRIMARY KEY, dir TEXT NOT NULL, epw TEXT, exit_code INTEGER, completed INTEGER,
  fatal INTEGER, severe INTEGER, warning INTEGER, seconds REAL, energyplus_version TEXT,
  model_sha256 TEXT
);
CREATE TABLE IF NOT EXISTS results (
  stamp TEXT NOT NULL, scope TEXT NOT NULL, key TEXT NOT NULL, month INTEGER NOT NULL,
  metric TEXT NOT NULL, value REAL NOT NULL, units TEXT NOT NULL, origin TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS results_k ON results(stamp, scope, metric, month);
CREATE TABLE IF NOT EXISTS engine_surfaces (
  stamp TEXT NOT NULL, ep_name TEXT NOT NULL, class TEXT, area_m2 REAL, gross_area_m2 REAL, azimuth_deg REAL, tilt_deg REAL, zone_ep_name TEXT
);
CREATE TABLE IF NOT EXISTS sizing (
  stamp TEXT NOT NULL, kind TEXT NOT NULL, cls TEXT NOT NULL, subject TEXT NOT NULL, field TEXT NOT NULL, value REAL, text TEXT, units TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sizing_k ON sizing(stamp, kind, subject);
CREATE TABLE IF NOT EXISTS hourly (stamp TEXT NOT NULL, name TEXT NOT NULL, units TEXT NOT NULL, vals TEXT NOT NULL, start TEXT);
`;

function putMeta(db: Database, key: string, value: string): void {
  db.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", [key, value]);
}

/** bem.db opened from its bytes, or a fresh one; the DDL is idempotent and
 *  an older file gains what it lacks (runs.model_sha256, schema 2) */
export function openBemDb(SQL: SqlJsStatic, bytes: Uint8Array | null): Database {
  const db = new SQL.Database(bytes ?? undefined);
  db.run(DDL);
  const cols = (db.exec("PRAGMA table_info(runs)")[0]?.values ?? []).map((r) => String(r[1]));
  if (!cols.includes("model_sha256")) db.run("ALTER TABLE runs ADD COLUMN model_sha256 TEXT");
  if (!cols.includes("kind")) db.run("ALTER TABLE runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'design'");
  // schema 8 (2026-09-16): the code default per surface and subsurface — an older file opened for a write gains the column (the
  // app opens the previous file's bytes to keep its runs; CREATE IF NOT EXISTS leaves an old table as it was)
  for (const t of ["surfaces", "subsurfaces"]) {
    const c = (db.exec(`PRAGMA table_info(${t})`)[0]?.values ?? []).map((r) => String(r[1]));
    if (!c.includes("code_construction")) db.run(`ALTER TABLE ${t} ADD COLUMN code_construction TEXT NOT NULL DEFAULT ''`);
  }
  // 2026-10-07: an hourly series' first day (an actual-year run need not start on Jan 1)
  const hc = (db.exec("PRAGMA table_info(hourly)")[0]?.values ?? []).map((r) => String(r[1]));
  if (!hc.includes("start")) db.run("ALTER TABLE hourly ADD COLUMN start TEXT");
  // 2026-10-08: a blower-door ruling's words per zone (its leakage area and coefficients)
  const zc = (db.exec("PRAGMA table_info(zones)")[0]?.values ?? []).map((r) => String(r[1]));
  if (!zc.includes("infiltration_note")) db.run("ALTER TABLE zones ADD COLUMN infiltration_note TEXT NOT NULL DEFAULT ''");
  // 2026-11-03: a check's own facts as JSON (a zone-sides row: the sides switched off, those approved, the zone's rooms)
  const kc = (db.exec("PRAGMA table_info(checks)")[0]?.values ?? []).map((r) => String(r[1]));
  if (!kc.includes("data")) db.run("ALTER TABLE checks ADD COLUMN data TEXT NOT NULL DEFAULT ''");
  return db;
}

/** THE MODEL WITHOUT A RUN (2026-09-04): the model tables replaced, the runs
 *  and their results kept, so every tab reads the model back from the file
 *  and a run can say which model it belongs to (meta.model_sha256) */
export function writeModel(
  db: Database,
  input: BemInput,
  zones: BemZoneRow[],
  settings: Array<{ key: string; value: string; source: Source }>,
  written: IdfWriteReport,
  meta: { sourceName: string; engineVersion?: string; materialsSha256?: string },
  /** the system QA read from the IDF as written (2026-09-12): one row per loop, air loop and zone, the eight rules' verdicts */
  qa: SystemQaRow[] = [],
  /** THE CHECKS (2026-10-06): every question asked of the build and its answer, the passes too */
  checks: CheckRow[] = [],
): string {
  for (const t of ["settings", "zones", "constructions", "schedules", "systems", "system_qa", "checks", "rooms", "surfaces", "subsurfaces", "not_emitted"]) db.run(`DELETE FROM ${t}`);
  // a zone's infiltration may be NOT ENTERED (2026-10-15: the code's ACH50 not on record — the model is built, never run): a file made
  // before then holds the column NOT NULL; the table is the model's, rewritten on every build, so it is made again as the DDL states
  const zDdl = (db.exec("SELECT sql FROM sqlite_master WHERE name='zones'")[0]?.values[0]?.[0] as string | undefined) ?? "";
  if (/infiltration_ach REAL NOT NULL/.test(zDdl)) { db.run("DROP TABLE zones"); db.run(DDL); }
  for (const [k, v] of Object.entries({
    schema_version: "8",
    source_name: meta.sourceName,
    source_idf_sha256: input.contentSha256,
    source_ifc_sha256: input.sourceIfcSha256,
    source_ifc_name: input.sourceIfcName,
    source_bom_inputs_sha256: "",
    source_materials_sha256: meta.materialsSha256 ?? "",
    engine_version: meta.engineVersion ?? "",
    created_at: new Date().toISOString(),
  })) putMeta(db, k, v);
  fillModel(db, input, zones, settings, written);
  const qput = db.prepare("INSERT INTO system_qa VALUES (?,?,?,?,?)");
  for (const r of qa) qput.run([r.subject, r.kind, r.cls, r.gaps, JSON.stringify(r.checks)]);
  qput.free();
  const cput = db.prepare("INSERT INTO checks (rule, subject, verdict, text, fix, data) VALUES (?,?,?,?,?,?)");
  for (const r of checks) cput.run([r.rule, r.subject, r.verdict, r.text, r.fix, r.sides ? JSON.stringify({ sides: r.sides }) : ""]);
  cput.free();
  const sha = modelSha(db);
  putMeta(db, "model_sha256", sha);
  return sha;
}

/** the model tables' own hash: what a run was run on */
export function modelSha(db: Database): string {
  const lines: string[] = [];
  const dump = (sql: string): void => {
    const r = db.exec(sql);
    if (r.length) for (const row of r[0]!.values) lines.push(row.map((v) => (v === null ? "" : String(v))).join("|"));
  };
  dump("SELECT key, value, source FROM settings ORDER BY key");
  dump("SELECT name, ep_name, kind, volume_m3, conditioned, heating_setpoint_c, cooling_setpoint_c, infiltration_ach FROM zones ORDER BY name");
  // a blower-door ruling's words — only the zones that carry one, so a model without one hashes as before (2026-10-08)
  dump("SELECT name, infiltration_note FROM zones WHERE infiltration_note <> '' ORDER BY name");
  dump("SELECT name, kind, layers, u_w_m2k FROM constructions ORDER BY name");
  dump("SELECT role, name, file, in_use FROM schedules ORDER BY role");
  dump("SELECT id, section, kind, zones, fields FROM systems ORDER BY id");
  dump("SELECT room, zone, ep_name, floor_m2, conditioned, people, lights_w, equipment_w, equipment FROM rooms ORDER BY room");
  dump("SELECT ep_name, idf_surface_id, zone, zone_facing, side, type, bc, construction, gross_area_m2, code_construction FROM surfaces ORDER BY ep_name");
  return sha256Hex(lines.join("\n"));
}

/** the model as it was written: the zones with their sources, the surfaces
 *  the writer emitted with their row ids, and the rows it refused */
export function buildBemDb(
  SQL: SqlJsStatic,
  input: BemInput,
  zones: BemZoneRow[],
  settings: Array<{ key: string; value: string; source: Source }>,
  written: IdfWriteReport,
  meta: { sourceName: string; engineVersion?: string; materialsSha256?: string },
): Database {
  const db = openBemDb(SQL, null);
  writeModel(db, input, zones, settings, written, meta);
  return db;
}

function fillModel(
  db: Database,
  input: BemInput,
  zones: BemZoneRow[],
  settings: Array<{ key: string; value: string; source: Source }>,
  written: IdfWriteReport,
): void {
  const sput = db.prepare("INSERT INTO settings VALUES (?, ?, ?)");
  for (const s of settings) sput.run([s.key, s.value, s.source]);
  sput.free();
  const zput = db.prepare("INSERT INTO zones VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
  db.run("BEGIN");
  for (const z of zones) {
    zput.run([z.name, z.epName, z.kind, z.volumeM3, z.volumeSource,
      z.conditioned.value ? 1 : 0, z.conditioned.source,
      z.heatingSetpointC.value, z.coolingSetpointC.value, z.heatingSetpointC.source,
      z.infiltrationAch.value, z.infiltrationAch.source, z.infiltrationNote ?? ""]);
  }
  db.run("COMMIT");
  zput.free();
  const cput = db.prepare("INSERT OR REPLACE INTO constructions VALUES (?, ?, ?, ?, ?)");
  db.run("BEGIN");
  for (const c of written.constructions) cput.run([c.name, c.kind, JSON.stringify(c.layers), c.uWm2k, c.uSource]);
  db.run("COMMIT");
  cput.free();
  const schput = db.prepare("INSERT OR REPLACE INTO schedules VALUES (?,?,?,?,?,?,?,?,?,?,?)");
  db.run("BEGIN");
  for (const r of written.schedules) schput.run([r.role, r.name, r.file, r.cls, r.typeLimits, r.source, r.weekday ? JSON.stringify(r.weekday) : null, r.weekend ? JSON.stringify(r.weekend) : null, r.blocks, r.inUse ? 1 : 0, r.note]);
  db.run("COMMIT");
  schput.free();
  // THE ROOMS' GAINS (2026-09-13): one row per Space as written, each value with its source and the rule in words
  const rput = db.prepare("INSERT OR REPLACE INTO rooms VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  db.run("BEGIN");
  for (const r of written.rooms) rput.run([r.room, r.zone, r.epName, r.floorM2, r.conditioned ? 1 : 0, r.people.value, r.people.source, r.peopleNote, r.lightsW.value, r.lightsW.source, r.lightsNote, r.equipmentW.value, r.equipmentW.source, JSON.stringify(r.equipment), JSON.stringify(r.schedules)]);
  db.run("COMMIT");
  rput.free();
  const syput = db.prepare("INSERT OR REPLACE INTO systems VALUES (?,?,?,?,?,?,?,?,?,?,?)");
  db.run("BEGIN");
  for (const r of written.systems) syput.run([r.id, r.section, r.kind, r.label, r.source, JSON.stringify(r.zones), r.objects, JSON.stringify(r.objectNames), JSON.stringify(r.fields), JSON.stringify(r.refused), r.note]);
  db.run("COMMIT");
  syput.free();
  const fput = db.prepare("INSERT OR REPLACE INTO surfaces VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  db.run("BEGIN");
  for (const o of written.out) {
    const el = input.elements.get(o.elementId);
    fput.run([o.name, o.idfSurfaceId, o.elementId, el?.globalId ?? null, o.zone, o.zoneFacing, o.side, o.type, o.bc, o.bcSource,
      o.construction, o.constructionSource, o.grossAreaM2, o.codeConstruction]);
  }
  db.run("COMMIT");
  fput.free();
  const ssput = db.prepare("INSERT OR REPLACE INTO subsurfaces VALUES (?,?,?,?,?,?,?)");
  db.run("BEGIN");
  for (const s of written.subsurfaces) ssput.run([s.name, s.base, s.kind, s.holeIndex, s.construction, s.constructionSource, s.codeConstruction]);
  db.run("COMMIT");
  ssput.free();
  const nput = db.prepare("INSERT INTO not_emitted VALUES (?, ?)");
  db.run("BEGIN");
  for (const n of written.notEmitted) nput.run([n.idfSurfaceId, n.reason]);
  db.run("COMMIT");
  nput.free();
}

/** a run and what the engine's database said about it, in one long table */
export function writeRun(db: Database, run: BemRun, results: RunResults | null): void {
  db.run("DELETE FROM results WHERE stamp = ?", [run.stamp]);
  db.run("DELETE FROM engine_surfaces WHERE stamp = ?", [run.stamp]);
  db.run("DELETE FROM sizing WHERE stamp = ?", [run.stamp]);
  db.run("INSERT OR REPLACE INTO runs (stamp, dir, epw, exit_code, completed, fatal, severe, warning, seconds, energyplus_version, model_sha256, kind) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", [
    run.stamp, run.dir, run.epw, run.exitCode, run.completed ? 1 : 0, run.fatal, run.severe, run.warning, run.seconds, run.energyplusVersion,
    run.modelSha256 ?? (db.exec("SELECT value FROM meta WHERE key='model_sha256'")[0]?.values[0]?.[0] as string | undefined) ?? null,
    run.kind ?? "design",
  ]);
  putMeta(db, run.kind === "calibration" ? "last_calibration_stamp" : "last_run_stamp", run.stamp);
  if (!results) return;
  const put = db.prepare("INSERT INTO results VALUES (?,?,?,?,?,?,?,?)");
  const add = (scope: string, key: string, month: number, metric: string, value: number, units: string, origin: string): void => {
    put.run([run.stamp, scope, key, month, metric, value, units, origin]);
  };
  db.run("BEGIN");
  const F = results.facility, T = "tabular:AnnualBuildingUtilityPerformanceSummary";
  add("facility", "", 0, "heating", F.heatingKwh, "kWh", `${T}/End Uses`);
  add("facility", "", 0, "cooling", F.coolingKwh, "kWh", `${T}/End Uses`);
  add("facility", "", 0, "conditioned_area", F.conditionedAreaM2, "m2", `${T}/Building Area`);
  add("facility", "", 0, "total_area", F.totalAreaM2, "m2", `${T}/Building Area`);
  add("facility", "", 0, "unmet_heating", F.unmetHeatingH, "hr", `${T}/Comfort and Setpoint Not Met Summary`);
  add("facility", "", 0, "unmet_cooling", F.unmetCoolingH, "hr", `${T}/Comfort and Setpoint Not Met Summary`);
  for (const [zone, u] of results.zoneUnmet) {
    add("zone", zone, 0, "unmet_heating", u.heatingH, "hr", "tabular:SystemSummary/Time Setpoint Not Met");
    add("zone", zone, 0, "unmet_cooling", u.coolingH, "hr", "tabular:SystemSummary/Time Setpoint Not Met");
  }
  // THE LOADS (user, 2026-09-04): the engine's design loads per zone and per
  // space at their design days, each zone's peak rate over the weather year,
  // and the facility's coincident peak — W in the table, the units at the eye
  for (const s of results.sizing) {
    const T = `tabular:HVACSizingSummary/${s.scope === "zone" ? "Zone" : "Space"} Sensible ${s.kind === "heating" ? "Heating" : "Cooling"}`;
    add(s.scope, s.key, 0, `design_${s.kind}_w`, s.designLoadW, "W", `${T} · ${s.designDay}`);
    add(s.scope, s.key, 0, `design_${s.kind}_wm2`, s.perAreaWm2, "W/m2", T);
    add(s.scope, s.key, 0, `design_${s.kind}_flow_m3s`, s.airFlowM3s, "m3/s", T);
    add(s.scope, s.key, 0, `design_${s.kind}_time`, encodeTime(s.peakTime), "MMDDHHMM", `${T} · ${s.peakTime}`);
    add(s.scope, s.key, 0, `design_${s.kind}_outdoor_c`, s.outdoorC, "C", T);
  }
  for (const p of results.peaks) {
    add("zone", p.key, p.month, `peak_${p.kind}_w`, p.maxW, "W", "tabular:ZONE PEAK LOADS (Output:Table:Monthly, Maximum)");
    add("zone", p.key, p.month, `peak_${p.kind}_time`, encodeTime(p.time), "MMDDHHMM", `tabular:ZONE PEAK LOADS · ${p.time}`);
  }
  const FP = results.facilityPeak, DT = "tabular:DemandEndUseComponentsSummary/End Uses";
  add("facility", "", 0, "peak_heating_w", FP.heatingW, "W", DT);
  add("facility", "", 0, "peak_heating_time", encodeTime(FP.heatingTime), "MMDDHHMM", `${DT} · ${FP.heatingTime}`);
  add("facility", "", 0, "peak_cooling_w", FP.coolingW, "W", DT);
  add("facility", "", 0, "peak_cooling_time", encodeTime(FP.coolingTime), "MMDDHHMM", `${DT} · ${FP.coolingTime}`);
  // THE END USES BY FUEL (2026-09-15): every non-zero cell, the fuel its key, the row its metric; each fuel's own
  // coincident peak by row, and the fuel's time of peak once
  for (const c of results.endUses) add("enduse", c.fuel, 0, c.row, c.value, c.units, `${T}/End Uses`);
  for (const f of results.fuelPeaks) add("enduse_peak", f.fuel, 0, f.row, f.w, f.units, DT);
  for (const t of results.fuelPeakTimes) add("enduse_peak", t.fuel, 0, "time_of_peak", encodeTime(t.time), "MMDDHHMM", `${DT} · ${t.time}`);
  // every monthly / run-period variable the writer asked for, by scope
  const scopeOf = (name: string): string => (/^Surface /.test(name) ? "surface" : /^Zone /.test(name) ? "zone" : "facility");
  for (const s of results.series) {
    const scope = s.isMeter ? "facility" : scopeOf(s.name);
    const key = scope === "zone" ? zoneOfKey(s.key) : scope === "facility" ? "" : s.key;
    add(scope, key, s.month, s.name, s.value, s.units, `${s.isMeter ? "meter" : "variable"}:${s.name}`);
  }
  // the annual sums the paint reads, precomputed once
  for (const name of new Set(results.series.filter((s) => !s.isMeter && s.month > 0).map((s) => s.name))) {
    const scope = scopeOf(name);
    for (const [k, v] of annualByKey(results.series, name)) {
      add(scope, scope === "zone" ? zoneOfKey(k) : k, 0, name, v, results.series.find((s) => s.name === name)?.units ?? "", `variable:${name} (annual)`);
    }
  }
  for (const d of results.daily) add("facility", "", d.month * 100 + d.day, d.name, d.value, d.units, `meter:${d.name} (daily)`);
  // THE TARIFFS (2026-10-03): each tariff's monthly total (month 1–12) and its year (month 0), $ as the engine priced them
  for (const t of results.tariffs ?? []) {
    t.monthlyUsd.forEach((v, k) => add("tariff", t.name, k + 1, "cost", v, "$", "tabular:Tariff Report/Categories/Total"));
    add("tariff", t.name, 0, "cost", t.annualUsd, "$", "tabular:Economics Results Summary Report/Tariff Summary/Annual Cost");
  }
  // each zone's peak by load component (2026-10-02): metric "<heating|cooling>:<component>", the peak's time in the origin
  // the outside face temperatures on the design days (2026-10-08): scope "surface_dd", the month field the hour ending (1–24)
  for (const s of results.designSurfaceTemps ?? []) add("surface_dd", s.key, s.hour, `outside_temp_${s.day}_c`, s.c, "C", `variable:Surface Outside Face Temperature (${s.day} design day)`);
  // the coils' rates on the design days (2026-10-11): scope "coil_dd", the month field the minute the timestep ends
  for (const c of results.coilDesign ?? []) add("coil_dd", c.coil, c.minute, `${c.kind}_${c.day}_w`, c.w, "W", `variable:${c.kind === "heating" ? "Heating Coil Heating Rate" : "Cooling Coil Total Cooling Rate"} (${c.day} design day)`);
  for (const c of results.zoneBalance ?? []) add("zone_balance", c.zone, 0, `${c.kind}:${c.component}`, c.w, "W", `variable:Zone Air Heat Balance (design day timestep) · ${c.time}`);
  for (const c of results.componentLoads ?? []) add("zone_component", c.zone, 0, `${c.kind}:${c.component}`, c.w, "W", `tabular:Zone Component Load Summary/Estimated ${c.kind === "heating" ? "Heating" : "Cooling"} Peak Load Components · ${c.time}`);
  db.run("COMMIT");
  put.free();
  const eput = db.prepare("INSERT INTO engine_surfaces VALUES (?,?,?,?,?,?,?,?)");
  const zoneName = new Map(results.zones.map((z) => [z.index, z.name]));
  db.run("BEGIN");
  for (const s of results.surfaces) eput.run([run.stamp, s.name, s.cls, s.areaM2, s.grossAreaM2, s.azimuthDeg, s.tiltDeg, s.zoneIndex === null ? null : zoneName.get(s.zoneIndex) ?? null]);
  db.run("COMMIT");
  eput.free();
  // THE SIZING REPORTS (2026-09-15): ComponentSizingSummary and CoilSizingDetails as the engine wrote them
  const sput = db.prepare("INSERT INTO sizing VALUES (?,?,?,?,?,?,?,?)");
  db.run("BEGIN");
  for (const s of results.sizingDetails) sput.run([run.stamp, s.kind, s.cls, s.subject, s.field, s.value, s.text, s.units]);
  db.run("COMMIT");
  sput.free();
  // THE HOURS (2026-10-03): one row per series, its values as a JSON list — kept for the LATEST run only (8760 values a series; RUN's
  // day and week views read them), an earlier run's hours dropped when a new run is written
  // the coils' hourly rates over the weather year ride in the hourly table under "coil|<kind>|<COIL>" — kept out of the meters' reading
  writeHourly(db, run, [...(results.hourly ?? []), ...(results.coilYear ?? []).map((c) => ({ name: `${COIL_PREFIX}${c.kind}|${c.coil}`, units: "W", values: c.values }))]);
}

/** a run's hours — each KIND keeps its latest run's (2026-10-09): a calibration run never takes BEM's design run's away. The run's row
 *  must be written first (its kind is read from it) */
export function writeHourly(db: Database, run: BemRun, hourly: NonNullable<RunResults["hourly"]>): void {
  db.run("DELETE FROM hourly WHERE stamp <> ? AND (stamp NOT IN (SELECT stamp FROM runs) OR stamp IN (SELECT stamp FROM runs WHERE kind = ?))", [run.stamp, run.kind ?? "design"]);
  db.run("DELETE FROM hourly WHERE stamp = ?", [run.stamp]);
  const hput = db.prepare("INSERT INTO hourly (stamp, name, units, vals, start) VALUES (?,?,?,?,?)");
  db.run("BEGIN");
  for (const h of hourly) hput.run([run.stamp, h.name, h.units, JSON.stringify(h.values.map((v) => Number(v.toPrecision(6)))), h.start ? h.start.join("-") : null]);
  db.run("COMMIT");
  hput.free();
}

/** the run's tariffs: each one's year and months, $ */
export function queryTariffs(db: Database, stamp: string): Array<{ name: string; annualUsd: number; monthlyUsd: number[] }> {
  const by = new Map<string, { name: string; annualUsd: number; monthlyUsd: number[] }>();
  const st = db.prepare("SELECT key, month, value FROM results WHERE stamp=? AND scope='tariff' AND metric='cost' ORDER BY key, month");
  st.bind([stamp]);
  while (st.step()) {
    const r = st.get() as [string, number, number];
    const t = by.get(r[0]) ?? by.set(r[0], { name: r[0], annualUsd: 0, monthlyUsd: new Array(12).fill(0) }).get(r[0])!;
    if (r[1] === 0) t.annualUsd = r[2]; else t.monthlyUsd[r[1] - 1] = r[2];
  }
  st.free();
  return [...by.values()];
}
/** the hourly series of a run (only the latest run keeps its hours) */
export function queryHourly(db: Database, stamp: string): Array<{ name: string; units: string; values: number[]; start?: [number, number, number] }> {
  const out: Array<{ name: string; units: string; values: number[]; start?: [number, number, number] }> = [];
  const st = db.prepare("SELECT name, units, vals, start FROM hourly WHERE stamp=? AND name NOT LIKE 'coil|%' ORDER BY name");
  st.bind([stamp]);
  while (st.step()) {
    const r = st.get() as [string, string, string, string | null];
    const s = r[3] ? r[3].split("-").map(Number) : null;
    out.push({ name: r[0], units: r[1], values: JSON.parse(r[2]) as number[], ...(s && s.length === 3 ? { start: s as [number, number, number] } : {}) });
  }
  st.free();
  return out;
}

/** the End Uses cells of a run, by row and fuel */
export function queryEndUses(db: Database, stamp: string): EndUseCell[] {
  const out: EndUseCell[] = [];
  const st = db.prepare("SELECT key, metric, value, units FROM results WHERE stamp=? AND scope='enduse' ORDER BY metric, key");
  st.bind([stamp]);
  while (st.step()) { const r = st.get() as [string, string, number, string]; out.push({ fuel: r[0], row: r[1], value: r[2], units: r[3] }); }
  st.free();
  return out;
}

/** each fuel's coincident peak by row, and the fuel's time of peak (MMDDHHMM) */
export function queryFuelPeaks(db: Database, stamp: string): { peaks: FuelPeak[]; times: Map<string, number> } {
  const peaks: FuelPeak[] = [], times = new Map<string, number>();
  const st = db.prepare("SELECT key, metric, value, units FROM results WHERE stamp=? AND scope='enduse_peak' ORDER BY key, metric");
  st.bind([stamp]);
  while (st.step()) {
    const r = st.get() as [string, string, number, string];
    if (r[1] === "time_of_peak") times.set(r[0], r[2]); else peaks.push({ fuel: r[0], row: r[1], w: r[2], units: r[3] });
  }
  st.free();
  return { peaks, times };
}

/** the sizing reports of a run — the cells a unit is picked from */
export function querySizingDetails(db: Database, stamp: string): SizingDetail[] {
  const out: SizingDetail[] = [];
  const st = db.prepare("SELECT kind, cls, subject, field, value, text, units FROM sizing WHERE stamp=? ORDER BY kind, cls, subject, field");
  st.bind([stamp]);
  while (st.step()) { const r = st.get() as ["component" | "coil", string, string, string, number | null, string | null, string]; out.push({ kind: r[0], cls: r[1], subject: r[2], field: r[3], value: r[4], text: r[5], units: r[6] }); }
  st.free();
  return out;
}

/** the facility's monthly METERS of a run (months 1–12, in the engine's J), by meter name — the monthly chart's rows */
export function queryMonthlyMeters(db: Database, stamp: string): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const st = db.prepare("SELECT metric, month, value FROM results WHERE stamp=? AND scope='facility' AND origin LIKE 'meter:%' AND origin NOT LIKE '% (daily)' AND month BETWEEN 1 AND 12 ORDER BY metric, month");
  st.bind([stamp]);
  while (st.step()) {
    const r = st.get() as [string, number, number];
    const a = out.get(r[0]) ?? Array<number>(12).fill(0);
    a[r[1] - 1] = r[2];
    out.set(r[0], a);
  }
  st.free();
  return out;
}

/** one zone-scope variable's twelve months for every zone (the engine's J) */
export function queryMonthlyByZone(db: Database, stamp: string, metric: string): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const st = db.prepare("SELECT key, month, value FROM results WHERE stamp=? AND scope='zone' AND metric=? AND month BETWEEN 1 AND 12 ORDER BY key, month");
  st.bind([stamp, metric]);
  while (st.step()) {
    const r = st.get() as [string, number, number];
    const a = out.get(r[0]) ?? Array<number>(12).fill(0);
    a[r[1] - 1] = r[2];
    out.set(r[0], a);
  }
  st.free();
  return out;
}

/** the rows of one metric with their origin — where a design day's name travels */
export function queryResultRows(db: Database, stamp: string, scope: string, metric: string, month = 0): Array<{ key: string; value: number; units: string; origin: string }> {
  const out: Array<{ key: string; value: number; units: string; origin: string }> = [];
  const st = db.prepare("SELECT key, value, units, origin FROM results WHERE stamp=? AND scope=? AND metric=? AND month=?");
  st.bind([stamp, scope, metric, month]);
  while (st.step()) { const r = st.get() as [string, number, string, string]; out.push({ key: r[0], value: r[1], units: r[2], origin: r[3] }); }
  st.free();
  return out;
}

export function queryResults(db: Database, stamp: string, scope: string, metric: string, month = 0): Map<string, number> {
  const out = new Map<string, number>();
  const st = db.prepare("SELECT key, value FROM results WHERE stamp=? AND scope=? AND metric=? AND month=?");
  st.bind([stamp, scope, metric, month]);
  while (st.step()) { const r = st.get() as [string, number]; out.set(r[0], r[1]); }
  st.free();
  return out;
}

/** the exterior surfaces' outside face temperatures on the design days (2026-10-08): per day, each surface key → 24 hours (°C, the hour ending) */
export const COIL_PREFIX = "coil|";
/** the coils' rates of a run (2026-10-11): on the design days by minute, and the weather year by the hour */
export function queryCoilRates(db: Database, stamp: string): { design: Array<{ coil: string; kind: "heating" | "cooling"; day: "summer" | "winter"; minute: number; w: number }>; year: Array<{ coil: string; kind: "heating" | "cooling"; values: number[] }> } {
  const design: ReturnType<typeof queryCoilRates>["design"] = [], year: ReturnType<typeof queryCoilRates>["year"] = [];
  const a = db.prepare("SELECT key, month, metric, value FROM results WHERE stamp=? AND scope='coil_dd'");
  a.bind([stamp]);
  while (a.step()) {
    const r = a.get() as [string, number, string, number];
    const m = /^(heating|cooling)_(summer|winter)_w$/.exec(r[2]);
    if (m) design.push({ coil: r[0], kind: m[1] as "heating" | "cooling", day: m[2] as "summer" | "winter", minute: r[1], w: r[3] });
  }
  a.free();
  const b = db.prepare("SELECT name, vals FROM hourly WHERE stamp=? AND name LIKE 'coil|%'");
  b.bind([stamp]);
  while (b.step()) {
    const r = b.get() as [string, string];
    const [, kind, coil] = r[0].split("|");
    if ((kind === "heating" || kind === "cooling") && coil) year.push({ coil, kind, values: JSON.parse(r[1]) as number[] });
  }
  b.free();
  return { design, year };
}
export function queryDesignSurfaceTemps(db: Database, stamp: string): { summer: Map<string, number[]>; winter: Map<string, number[]> } {
  const out = { summer: new Map<string, number[]>(), winter: new Map<string, number[]>() };
  const st = db.prepare("SELECT key, month, metric, value FROM results WHERE stamp=? AND scope='surface_dd'");
  st.bind([stamp]);
  while (st.step()) {
    const r = st.get() as [string, number, string, number];
    const m = r[2] === "outside_temp_summer_c" ? out.summer : r[2] === "outside_temp_winter_c" ? out.winter : null;
    if (!m || r[1] < 1 || r[1] > 24) continue;
    const a = m.get(r[0]) ?? m.set(r[0], new Array<number>(24).fill(NaN)).get(r[0])!;
    a[r[1] - 1] = r[3];
  }
  st.free();
  return out;
}

/** the daily meters of a run, as the operations model sums them over bill periods */
/** each zone's peak by load component of a run (2026-10-02), as the engine signed it — the RUN tab's Peak graph */
/** each zone's design-day peak from its own air heat balance (2026-10-11) — the shape of the component loads */
export function queryZoneBalance(db: Database, stamp: string): ComponentLoad[] { return queryComponentLoads(db, stamp, "zone_balance"); }

export function queryComponentLoads(db: Database, stamp: string, scope: "zone_component" | "zone_balance" = "zone_component"): ComponentLoad[] {
  const out: ComponentLoad[] = [];
  const st = db.prepare(`SELECT key, metric, value, origin FROM results WHERE stamp=? AND scope='${scope}' ORDER BY key, metric`);
  st.bind([stamp]);
  while (st.step()) {
    const r = st.get() as [string, string, number, string];
    const i = r[1].indexOf(":");
    out.push({ zone: r[0], kind: r[1].slice(0, i) === "heating" ? "heating" : "cooling", component: r[1].slice(i + 1), w: r[2], time: r[3].split(" · ")[1] ?? "" });
  }
  st.free();
  return out;
}

export function queryDailyMeters(db: Database, stamp: string): Array<{ name: string; month: number; day: number; value: number }> {
  const out: Array<{ name: string; month: number; day: number; value: number }> = [];
  const st = db.prepare("SELECT metric, month, value FROM results WHERE stamp=? AND scope='facility' AND origin LIKE 'meter:% (daily)' ORDER BY metric, month");
  st.bind([stamp]);
  while (st.step()) {
    const r = st.get() as [string, number, number];
    out.push({ name: r[0], month: Math.floor(r[1] / 100), day: r[1] % 100, value: r[2] });
  }
  st.free();
  return out;
}

export interface BemSurfaceRow {
  epName: string; idfSurfaceId: number | null; elementId: number; globalId: string | null;
  zone: string; zoneFacing: string | null; side: number; type: string; bc: string; bcSource: string;
  construction: string; constructionSource: string; grossAreaM2: number;
  /** the code default's kind the surface would take, whatever governs (2026-09-16) */
  codeConstruction: string;
}
export function queryBemSurfaces(db: Database): BemSurfaceRow[] {
  const out: BemSurfaceRow[] = [];
  const st = db.prepare("SELECT ep_name, idf_surface_id, element_id, global_id, zone, zone_facing, side, type, bc, bc_source, construction, construction_source, gross_area_m2, code_construction FROM surfaces");
  while (st.step()) {
    const r = st.get() as [string, number | null, number, string | null, string, string | null, number, string, string, string, string, string, number, string];
    out.push({ epName: r[0], idfSurfaceId: r[1], elementId: r[2], globalId: r[3], zone: r[4], zoneFacing: r[5], side: r[6], type: r[7], bc: r[8], bcSource: r[9], construction: r[10], constructionSource: r[11], grossAreaM2: r[12], codeConstruction: r[13] ?? "" });
  }
  st.free();
  return out;
}
export function queryNotEmitted(db: Database): Map<number, string> {
  const out = new Map<number, string>();
  const st = db.prepare("SELECT idf_surface_id, reason FROM not_emitted");
  while (st.step()) { const r = st.get() as [number, string]; out.set(r[0], r[1]); }
  st.free();
  return out;
}
export function queryRuns(db: Database): BemRun[] {
  const out: BemRun[] = [];
  const st = db.prepare("SELECT stamp, dir, epw, exit_code, completed, fatal, severe, warning, seconds, energyplus_version, model_sha256, kind FROM runs ORDER BY stamp");
  while (st.step()) {
    const r = st.get() as [string, string, string | null, number | null, number, number, number, number, number, string, string | null, string | null];
    out.push({ stamp: r[0], dir: r[1], epw: r[2], exitCode: r[3], completed: r[4] === 1, fatal: r[5], severe: r[6], warning: r[7], seconds: r[8], energyplusVersion: r[9], modelSha256: r[10] ?? undefined, kind: r[11] === "calibration" ? "calibration" : "design" });
  }
  st.free();
  return out;
}
export function queryBemZones(db: Database): Array<{ name: string; epName: string; kind: string; volumeM3: number; conditioned: boolean; conditionedSource: string; heatingSetpointC: number | null; coolingSetpointC: number | null; setpointSource: string | null; infiltrationAch: number | null; infiltrationSource: string; infiltrationNote: string }> {
  const out: ReturnType<typeof queryBemZones> = [];
  const st = db.prepare("SELECT name, ep_name, kind, volume_m3, conditioned, conditioned_source, heating_setpoint_c, cooling_setpoint_c, setpoint_source, infiltration_ach, infiltration_source, infiltration_note FROM zones ORDER BY name");
  while (st.step()) {
    const r = st.get() as [string, string, string, number, number, string, number | null, number | null, string | null, number, string, string];
    out.push({ name: r[0], epName: r[1], kind: r[2], volumeM3: r[3], conditioned: r[4] === 1, conditionedSource: r[5], heatingSetpointC: r[6], coolingSetpointC: r[7], setpointSource: r[8], infiltrationAch: r[9], infiltrationSource: r[10], infiltrationNote: r[11] ?? "" });
  }
  st.free();
  return out;
}

/** the settings as stored — what the SITE tab and the RUN census read */
export function querySettings(db: Database): Array<{ key: string; value: string; source: Source }> {
  const out: Array<{ key: string; value: string; source: Source }> = [];
  const st = db.prepare("SELECT key, value, source FROM settings ORDER BY key");
  while (st.step()) { const r = st.get() as [string, string, Source]; out.push({ key: r[0], value: r[1], source: r[2] }); }
  st.free();
  return out;
}
export function queryConstructions(db: Database): Array<{ name: string; kind: string; layers: string[]; uWm2k: number | null; uSource: Source }> {
  const out: ReturnType<typeof queryConstructions> = [];
  const st = db.prepare("SELECT name, kind, layers, u_w_m2k, u_source FROM constructions ORDER BY name");
  while (st.step()) { const r = st.get() as [string, string, string, number | null, Source]; out.push({ name: r[0], kind: r[1], layers: JSON.parse(r[2]) as string[], uWm2k: r[3], uSource: r[4] }); }
  st.free();
  return out;
}

/** the provenance census: how many stored values came from where */
/** the schedules the model runs on, per role, as written (2026-09-09) — the 24-hour readings for the strips */
export interface BemScheduleRow { role: ScheduleRole; name: string; file: string; cls: string; typeLimits: string | null; source: Source; weekday: number[] | null; weekend: number[] | null; blocks: number; inUse: boolean; note: string }
export function querySchedules(db: Database): BemScheduleRow[] {
  const r = db.exec("SELECT role, name, file, cls, type_limits, source, weekday, weekend, blocks, in_use, note FROM schedules ORDER BY rowid");
  return (r[0]?.values ?? []).map((v) => ({ role: String(v[0]) as ScheduleRole, name: String(v[1]), file: String(v[2]), cls: String(v[3]), typeLimits: v[4] === null ? null : String(v[4]), source: String(v[5]) as Source,
    weekday: v[6] === null ? null : (JSON.parse(String(v[6])) as number[]), weekend: v[7] === null ? null : (JSON.parse(String(v[7])) as number[]), blocks: Number(v[8]), inUse: Number(v[9]) === 1, note: String(v[10]) }));
}
/** a room's gains as written (2026-09-13): what the ZONES frame reads back — never the in-memory report */
export interface BemRoomRow { room: string; zone: string; epName: string; floorM2: number; conditioned: boolean; people: number; peopleSource: Source; peopleNote: string; lightsW: number; lightsSource: Source; lightsNote: string; equipmentW: number; equipmentSource: Source;
  equipment: Array<{ id: string; name: string; group?: EquipmentGroup; wattsW: number; subcategory: string; latent: number; radiant: number; lost: number; schedule: string; source: Source; note: string }>; schedules: { occupancy: string | null; lighting: string | null; activity: string | null } }
export function queryRooms(db: Database): BemRoomRow[] {
  const r = db.exec("SELECT room, zone, ep_name, floor_m2, conditioned, people, people_source, people_note, lights_w, lights_source, lights_note, equipment_w, equipment_source, equipment, schedules FROM rooms ORDER BY room");
  return (r[0]?.values ?? []).map((v) => ({ room: String(v[0]), zone: String(v[1]), epName: String(v[2]), floorM2: Number(v[3]), conditioned: Number(v[4]) === 1, people: Number(v[5]), peopleSource: String(v[6]) as Source, peopleNote: String(v[7]),
    lightsW: Number(v[8]), lightsSource: String(v[9]) as Source, lightsNote: String(v[10]), equipmentW: Number(v[11]), equipmentSource: String(v[12]) as Source, equipment: JSON.parse(String(v[13])) as BemRoomRow["equipment"], schedules: JSON.parse(String(v[14])) as BemRoomRow["schedules"] }));
}
/** THE CHECKS read back (2026-10-06): a file written before the table existed reads as none */
export function queryChecks(db: Database): CheckRow[] {
  const has = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='checks'");
  if (!has.length || !has[0]!.values.length) return [];
  const hasData = (db.exec("PRAGMA table_info(checks)")[0]?.values ?? []).some((c) => String(c[1]) === "data");
  const r = db.exec(`SELECT rule, subject, verdict, text, fix, ${hasData ? "data" : "''"} FROM checks ORDER BY rowid`);
  return (r[0]?.values ?? []).map((v) => {
    const row: CheckRow = { rule: String(v[0]), subject: String(v[1]), verdict: String(v[2]) as CheckRow["verdict"], text: String(v[3]), fix: String(v[4]) };
    const data = String(v[5] ?? "");
    if (data) { const d = JSON.parse(data) as Pick<CheckRow, "sides">; if (d.sides) row.sides = d.sides; }
    else if (row.rule === "zone-sides" && row.verdict === "warn") {
      // a file written before 2026-11-03 holds the sides only in the words: read them so a side left off still stops the run
      const m = /^(heating|cooling)(?: and (heating|cooling))? switched off on its Zone card/.exec(row.text);
      if (m) row.sides = { off: [m[1], m[2]].filter(Boolean) as ZoneSide[], approved: [], rooms: [] };
    }
    return row;
  });
}
/** the systems the model runs on, per subsection, as written (2026-09-10) — the tab reads them back */
export interface BemSystemRow { id: string; section: SystemSection; kind: string; label: string; source: Source; zones: string[]; objects: number; objectNames: string[]; fields: Array<{ obj: string; key: string; label: string; value: string; source: Source; units: string | null }>; refused: string[]; note: string }
export function querySystems(db: Database): BemSystemRow[] {
  const has = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='systems'");
  if (!has.length || !has[0]!.values.length) return [];
  const r = db.exec("SELECT id, section, kind, label, source, zones, objects, object_names, fields, refused, note FROM systems ORDER BY rowid");
  return (r[0]?.values ?? []).map((v) => ({ id: String(v[0]), section: String(v[1]) as SystemSection, kind: String(v[2]), label: String(v[3]), source: String(v[4]) as Source, zones: JSON.parse(String(v[5])) as string[], objects: Number(v[6]),
    objectNames: JSON.parse(String(v[7])) as string[], fields: JSON.parse(String(v[8])) as BemSystemRow["fields"], refused: JSON.parse(String(v[9])) as string[], note: String(v[10]) }));
}
/** the system QA as written (2026-09-12) — the SYSTEMS column reads it back, one row per loop, air loop and zone */
export function querySystemQa(db: Database): SystemQaRow[] {
  const has = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='system_qa'");
  if (!has.length || !has[0]!.values.length) return [];
  const r = db.exec("SELECT subject, kind, cls, gaps, checks FROM system_qa ORDER BY rowid");
  return (r[0]?.values ?? []).map((v) => ({ subject: String(v[0]), kind: String(v[1]) as SystemQaRow["kind"], cls: String(v[2]), checks: JSON.parse(String(v[4])) as SystemQaRow["checks"], gaps: Number(v[3]) }));
}
export function provenanceCensus(db: Database): Record<Source, number> {
  const c: Record<Source, number> = { file: 0, dataset: 0, "code-default": 0, user: 0 };
  const bump = (s: string, n = 1): void => { if (s in c) c[s as Source] += n; };
  for (const [s, n] of db.exec("SELECT source, count(*) FROM settings GROUP BY source")[0]?.values ?? []) bump(String(s), Number(n));
  for (const col of ["conditioned_source", "setpoint_source", "infiltration_source"]) {
    for (const [s, n] of db.exec(`SELECT ${col}, count(*) FROM zones GROUP BY ${col}`)[0]?.values ?? []) bump(String(s), Number(n));
  }
  for (const col of ["bc_source", "construction_source"]) {
    for (const [s, n] of db.exec(`SELECT ${col}, count(*) FROM surfaces GROUP BY ${col}`)[0]?.values ?? []) bump(String(s), Number(n));
  }
  for (const [s, n] of db.exec("SELECT construction_source, count(*) FROM subsurfaces GROUP BY construction_source")[0]?.values ?? []) bump(String(s), Number(n));
  for (const [s, n] of db.exec("SELECT u_source, count(*) FROM constructions GROUP BY u_source")[0]?.values ?? []) bump(String(s), Number(n));
  for (const [s, n] of db.exec("SELECT source, count(*) FROM schedules GROUP BY source")[0]?.values ?? []) bump(String(s), Number(n));
  for (const [s, n] of db.exec("SELECT source, count(*) FROM systems GROUP BY source")[0]?.values ?? []) bump(String(s), Number(n));
  for (const col of ["people_source", "lights_source", "equipment_source"]) {
    for (const [s, n] of db.exec(`SELECT ${col}, count(*) FROM rooms GROUP BY ${col}`)[0]?.values ?? []) bump(String(s), Number(n));
  }
  return c;
}

/** bem.db's own content hash: the model and the results a downstream reads */
export function stampBemContentSha(db: Database): string {
  const lines: string[] = [];
  const dump = (sql: string): void => {
    const r = db.exec(sql);
    if (r.length) for (const row of r[0]!.values) lines.push(row.map((v) => (v === null ? "" : String(v))).join("|"));
  };
  dump("SELECT key, value, source FROM settings ORDER BY key");
  dump("SELECT name, ep_name, kind, volume_m3, conditioned, heating_setpoint_c, cooling_setpoint_c, infiltration_ach FROM zones ORDER BY name");
  dump("SELECT ep_name, idf_surface_id, zone, zone_facing, side, type, bc, construction, gross_area_m2, code_construction FROM surfaces ORDER BY ep_name");
  dump("SELECT stamp, fatal, severe, warning FROM runs ORDER BY stamp");
  dump("SELECT stamp, scope, key, month, metric, value FROM results ORDER BY stamp, scope, key, month, metric");
  dump("SELECT stamp, kind, cls, subject, field, value, text FROM sizing ORDER BY stamp, kind, cls, subject, field");
  const sha = sha256Hex(lines.join("\n"));
  putMeta(db, "content_sha256", sha);
  return sha;
}
