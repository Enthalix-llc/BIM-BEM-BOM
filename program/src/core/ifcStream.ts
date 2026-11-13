// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// web-ifc → ElementInput stream, shared verbatim by the renderer and the
// node gate CLI so the gate measures EXACTLY the code the app runs.

import type * as WebIFC from "web-ifc";
import {
  IFCRELDEFINESBYPROPERTIES, IFCRELSPACEBOUNDARY, IFCGEOMETRICREPRESENTATIONCONTEXT,
  IFCSPACE, IFCRELCONTAINEDINSPATIALSTRUCTURE, IFCRELAGGREGATES, IFCUNITASSIGNMENT, IFCBUILDINGSTOREY, IFCSITE, IFCPOSTALADDRESS, IFCPROJECT,
  IFCRELDEFINESBYTYPE, IFCRELASSOCIATESMATERIAL, IFCMATERIALLAYERSETUSAGE, IFCMATERIALLAYERSET, IFCMATERIALCONSTITUENTSET } from "web-ifc";
import { extractElement, newStats, type ExtractStats, type FaceOut } from "./extract.js";

export interface ElementMeta {
  expressId: number;
  ifcClass: string;
  globalId: string | null;
  name: string | null;
  /** the element's PredefinedType, READ — an IfcCovering says CEILING,
   *  CLADDING, ROOFING…; null when the file leaves it unset */
  predefinedType: string | null;
  /** Pset_*Common.IsExternal — READ from the file, never derived. null = the
   *  file does not say. */
  isExternal: boolean | null;
  /** Pset_DoorCommon / Pset_WindowCommon.GlazingAreaFraction — the file's own
   *  word on whether a door or window is glazed, READ; null = not stated */
  glazingFraction: number | null;
  /** a Pset_DoorWindowGlazingType attached to the element — glazing stated
   *  by its presence, whatever its fields */
  glazingPset: boolean;
  /** IfcDoor / IfcWindow OverallWidth and OverallHeight — the file's stated
   *  size of the OPENING (38.5" × 81.25" for a 36" × 80" passage door), in
   *  metres by the file's own length unit; null where the file states none */
  overallWidthM: number | null;
  overallHeightM: number | null;
  /** the IfcSpace names this element bounds — "Yard", "ADU", "Great". READ
   *  from IfcRelSpaceBoundary. This is how the USER names a defect; without
   *  it the census can only say "el #25297" and a QC round is spent
   *  translating (2026-08-31). */
  spaces: string[];
  /** the IfcBuildingStorey that contains this element, READ from
   *  IfcRelContainedInSpatialStructure — "Basement", "Main", "Studio". The
   *  level is how a drawing set is organised, so the inspector speaks it. */
  storey: string | null;
  /** the storey's stated Elevation, converted to metres by the file's own
   *  linear unit (GetLinearScalingFactor), never assumed */
  storeyElevM: number | null;
  /** the element's TYPE (IfcRelDefinesByType), or the layer set an untyped
   *  element carries, as a row of ExtractRun.types; null = neither */
  typeId: number | null;
}

/** one layer of a type's IfcMaterialLayerSet (part null), or one part of a
 *  window's / door's IfcMaterialConstituentSet (part = "Glass", "Frame/Mullion";
 *  thickness null) — the material NAME and category the file states; this
 *  file states no thermal property on any material */
export interface TypeLayer { part: string | null; material: string; thicknessM: number | null; category: string | null }
/** what the file states per TYPE (2026-09-08): read from the IfcTypeObject's
 *  own HasPropertySets (Pset_WallCommon.ThermalTransmittance on 17 of 20 wall
 *  types here — never through IfcRelDefinesByProperties) and from
 *  IfcRelAssociatesMaterial on the type or on its elements */
export interface TypeMeta {
  expressId: number;
  ifcClass: string;
  globalId: string | null;
  name: string | null;
  /** ThermalTransmittance in W/m²K by the file's own derived unit; null = not stated */
  uWm2k: number | null;
  /** the pset that stated it */
  uPset: string | null;
  layers: TypeLayer[];
  /** the layers came from the type's own association, from an element's usage, or there are none */
  layersFrom: "type" | "element" | null;
  /** AN ELEMENT'S OWN MATERIALS (2026-11-13, the IFC import review): a row made for elements whose own set states other
   *  materials than their type's — the type's express id; absent on a type the file states */
  ownOf?: number;
}

/** what makes two material sets the same for the model: a layer set by its layers' materials and thicknesses in order
 *  (0.1 mm), a constituent set by its DISTINCT material names — a window's parts repeat under other labels ("Glass",
 *  "Glazing") in Revit's per-element copies with nothing changed (78 of the house's doors and windows) */
export function materialsKey(layers: TypeLayer[]): string {
  if (layers.length && layers.every((l) => l.part === null)) return layers.map((l) => `${l.material}@${l.thicknessM === null ? "-" : Math.round(l.thicknessM * 10000)}`).join("|");
  return [...new Set(layers.map((l) => l.material))].sort().join("|");
}

/** An IfcSpace as the file draws it. web-ifc leaves spaces OUT of
 *  StreamAllMeshes, so they are streamed by type. They are the rooms the user
 *  names things by ("Kitchen", "Living Room"), and for BEM they are the thermal zones, so they are worth
 *  carrying even though nothing derives from them yet. */
export interface SpaceOut {
  expressId: number;
  globalId: string | null;
  name: string | null;
  longName: string | null;
  /** stable index used to pick this space's colour in EVERY view */
  colorIndex: number;
  /** the IfcBuildingStorey this space belongs to — READ from IfcRelAggregates
   *  (a space is aggregated by its storey, not "contained" in it) — and that
   *  storey's stated Elevation in metres */
  storey: string | null;
  storeyElevM: number | null;
  faces: FaceOut[];
}

export interface ExtractRun {
  faces: FaceOut[];
  elements: ElementMeta[];
  stats: ExtractStats;
  /** overall bbox in metres — the units sanity check (house ≈ 20 m, not 65 ft) */
  bbox: { min: [number, number, number]; max: [number, number, number] };
  /** the rooms, with their own geometry — never folded into `faces`/`stats`,
   *  so the standing area identity cannot move because a space was added */
  spaces: SpaceOut[];
  /** plan direction of TRUE NORTH in web-ifc's frame, (x, z), unit — READ from
   *  IfcGeometricRepresentationContext.TrueNorth. null when the file is silent,
   *  and then nothing is labelled with a compass point rather than guessed. */
  trueNorth: [number, number] | null;
  /** IfcSite RefLatitude / RefLongitude (degrees) and RefElevation — READ.
   *  null when the file has no site or leaves them unset. */
  site: { latitude: number; longitude: number; elevationM: number } | null;
  /** the ADDRESS the file states (2026-09-07): IfcPostalAddress on the site or
   *  the building when one exists, else IfcProject.LongName — some authoring
   *  tools write the street address there. null when silent. */
  address: string | null;
  /** THE PROJECT the file belongs to (2026-09-30, the user's ruling): the IfcProject's GlobalId — the identity every
   *  version of this building's model carries (the house's is the same in all three versions on disk) — with its Name
   *  and LongName as stated. READ, never written; the project store keys the ledgers' versions to it. */
  project?: { globalId: string; name: string | null; longName: string | null } | null;
  /** every IfcBuildingStorey the file states, with its Elevation in metres (2026-09-07):
   *  the next stated level above a storey is read from this list */
  storeys: Array<{ name: string; elevM: number | null }>;
  /** the element types with the file's word on each (2026-09-08) */
  types: TypeMeta[];
  /** the file's THERMALTRANSMITTANCEUNIT as text ("kg·K⁻¹·s⁻³"), null when unstated */
  uUnit: string | null;
}

const packRgba = (c: { x: number; y: number; z: number; w: number }): number =>
  ((Math.round(c.x * 255) << 24) | (Math.round(c.y * 255) << 16) |
   (Math.round(c.z * 255) << 8) | Math.round(c.w * 255)) >>> 0;

export function runExtraction(
  api: WebIFC.IfcAPI,
  modelID: number,
  onProgress?: (elements: number) => void,
): ExtractRun {
  const faces: FaceOut[] = [];
  const elements: ElementMeta[] = [];
  const stats = newStats();
  const bbox = {
    min: [Infinity, Infinity, Infinity] as [number, number, number],
    max: [-Infinity, -Infinity, -Infinity] as [number, number, number],
  };

  api.StreamAllMeshes(modelID, (mesh) => {
    const parts: Array<{ rgba: number; positions: Float64Array; indices: Uint32Array }> = [];
    const geoms = mesh.geometries;
    for (let gi = 0; gi < geoms.size(); gi++) {
      const pg = geoms.get(gi);
      const g = api.GetGeometry(modelID, pg.geometryExpressID);
      const src = api.GetVertexArray(g.GetVertexData(), g.GetVertexDataSize()); // interleaved xyz+nrm
      const idx = api.GetIndexArray(g.GetIndexData(), g.GetIndexDataSize());
      const m = pg.flatTransformation; // column-major 4x4
      const nVerts = src.length / 6;
      const pos = new Float64Array(nVerts * 3);
      for (let i = 0; i < nVerts; i++) {
        const x = src[i * 6]!, y = src[i * 6 + 1]!, z = src[i * 6 + 2]!;
        const tx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
        const ty = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
        const tz = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
        pos[i * 3] = tx; pos[i * 3 + 1] = ty; pos[i * 3 + 2] = tz;
        if (tx < bbox.min[0]) bbox.min[0] = tx; if (tx > bbox.max[0]) bbox.max[0] = tx;
        if (ty < bbox.min[1]) bbox.min[1] = ty; if (ty > bbox.max[1]) bbox.max[1] = ty;
        if (tz < bbox.min[2]) bbox.min[2] = tz; if (tz > bbox.max[2]) bbox.max[2] = tz;
      }
      parts.push({
        rgba: packRgba(pg.color),
        positions: pos,
        indices: new Uint32Array(idx),
      });
      // web-ifc geometry handles are wasm-side objects — release them
      (g as unknown as { delete?: () => void }).delete?.();
    }

    const typeCode = api.GetLineType(modelID, mesh.expressID);
    let ifcClass = "UNKNOWN";
    try { ifcClass = api.GetNameFromTypeCode(typeCode) || "UNKNOWN"; } catch { /* keep UNKNOWN */ }
    let globalId: string | null = null;
    let name: string | null = null;
    let predefinedType: string | null = null;
    let overallWidth: number | null = null, overallHeight: number | null = null;   // file units; scaled below
    try {
      const line = api.GetLine(modelID, mesh.expressID) as {
        GlobalId?: { value?: string }; Name?: { value?: string }; PredefinedType?: { value?: string };
        OverallWidth?: { value?: unknown }; OverallHeight?: { value?: unknown };
      };
      globalId = line?.GlobalId?.value ?? null;
      name = line?.Name?.value ?? null;
      predefinedType = line?.PredefinedType?.value ?? null;
      const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
      overallWidth = num(line?.OverallWidth?.value);
      overallHeight = num(line?.OverallHeight?.value);
    } catch { /* geometry-only products may not read back */ }

    elements.push({ expressId: mesh.expressID, ifcClass, globalId, name, predefinedType, isExternal: null,
      glazingFraction: null, glazingPset: false, overallWidthM: overallWidth, overallHeightM: overallHeight, spaces: [], storey: null, storeyElevM: null, typeId: null });
    extractElement({ expressId: mesh.expressID, parts }, faces, stats);
    if (onProgress && stats.elements % 50 === 0) onProgress(stats.elements);
  });

  // the stated overall sizes are in the file's length unit (FOOT here) — web-ifc
  // converts geometry only, never attributes
  {
    const scale = readLengthScale(api, modelID);
    for (const e of elements) {
      if (e.overallWidthM !== null) e.overallWidthM *= scale;
      if (e.overallHeightM !== null) e.overallHeightM *= scale;
    }
  }
  // ── IsExternal and the glazing word, from the file's own property sets ──
  const ids = new Set(elements.map((e) => e.expressId));
  const psets = readCommonPsets(api, modelID, ids);
  for (const e of elements) {
    e.isExternal = psets.isExternal.get(e.expressId) ?? null;
    e.glazingFraction = psets.glazingFraction.get(e.expressId) ?? null;
    e.glazingPset = psets.glazingPset.has(e.expressId);
  }
  const spaces = readSpaces(api, modelID, ids);
  for (const e of elements) e.spaces = [...(spaces.get(e.expressId) ?? [])];
  const storeys = readStoreys(api, modelID, ids);
  for (const e of elements) {
    const st = storeys.get(e.expressId);
    if (st) { e.storey = st.name; e.storeyElevM = st.elevM; }
  }
  // ── the TYPES: the file's stated U and material layers, per type (2026-09-08)
  const typed = readTypes(api, modelID, elements);
  for (const e of elements) e.typeId = typed.typeOf.get(e.expressId) ?? null;

  return {
    faces, elements, stats, bbox,
    spaces: readSpaces3D(api, modelID),
    trueNorth: readTrueNorth(api, modelID),
    site: readSite(api, modelID),
    address: readAddress(api, modelID),
    project: readProject(api, modelID),
    storeys: readAllStoreys(api, modelID),
    types: typed.types,
    uUnit: typed.uUnit,
  };
}

/** THE FILE'S WORD PER TYPE (2026-09-08). Three walks, nothing derived:
 *  IfcRelDefinesByType (element → type, the six envelope type classes kept);
 *  each type's own HasPropertySets for Pset_*Common.ThermalTransmittance,
 *  scaled by the file's THERMALTRANSMITTANCEUNIT (this file's derived unit is
 *  kg·K⁻¹·s⁻³ = W/m²K, scale 1 — read, not assumed); IfcRelAssociatesMaterial
 *  for the IfcMaterialLayerSet (directly, or through a usage) or the
 *  IfcMaterialConstituentSet of a window or door. A type with no set of its
 *  own takes the set its elements carry (Revit puts a roof's layers on the
 *  roof, not its type); an element with a set and no type is given a row
 *  keyed by the set itself. Thicknesses are in the file's length unit. */
export function readTypes(
  api: WebIFC.IfcAPI,
  modelID: number,
  elements: ElementMeta[],
): { types: TypeMeta[]; typeOf: Map<number, number>; uUnit: string | null; uScale: number } {
  const targets = new Set(elements.map((e) => e.expressId));
  const classOf = new Map(elements.map((e) => [e.expressId, e.ifcClass]));
  const typeOf = new Map<number, number>();
  const types = new Map<number, TypeMeta>();
  const unit = readUnitScale(api, modelID, "THERMALTRANSMITTANCEUNIT");
  const lengthScale = readLengthScale(api, modelID);
  const idOf = (v: unknown): number | null => (v && typeof v === "object" && typeof (v as { value?: unknown }).value === "number" ? (v as { value: number }).value : null);
  const ids = (v: unknown): number[] => (Array.isArray(v) ? v.map(idOf).filter((x): x is number => x !== null) : [idOf(v)].filter((x): x is number => x !== null));
  const str = (v: unknown): string | null => (v && typeof v === "object" && typeof (v as { value?: unknown }).value === "string" ? (v as { value: string }).value : null);
  const num = (v: unknown): number | null => (v && typeof v === "object" && typeof (v as { value?: unknown }).value === "number" ? (v as { value: number }).value : null);
  const className = (id: number): string => { try { return api.GetNameFromTypeCode(api.GetLineType(modelID, id)) || "UNKNOWN"; } catch { return "UNKNOWN"; } };
  // 1 · element → type, the type's identity and its own psets
  try {
    const rels = api.GetLineIDsWithType(modelID, IFCRELDEFINESBYTYPE);
    for (let i = 0; i < rels.size(); i++) {
      const rel = api.GetLine(modelID, rels.get(i)) as { RelatingType?: unknown; RelatedObjects?: unknown };
      const tId = idOf(rel.RelatingType);
      if (tId === null) continue;
      const cls = className(tId);
      if (!/^IFC(WALL|SLAB|ROOF|COVERING|WINDOW|DOOR)(TYPE|STYLE)$/i.test(cls)) continue;
      let t = types.get(tId);
      if (!t) {
        const line = api.GetLine(modelID, tId) as { GlobalId?: unknown; Name?: unknown; HasPropertySets?: unknown };
        t = { expressId: tId, ifcClass: cls, globalId: str(line.GlobalId), name: str(line.Name), uWm2k: null, uPset: null, layers: [], layersFrom: null };
        for (const pId of ids(line.HasPropertySets)) {
          try {
            const pset = api.GetLine(modelID, pId) as { Name?: unknown; HasProperties?: unknown };
            for (const hId of ids(pset.HasProperties)) {
              const prop = api.GetLine(modelID, hId) as { Name?: unknown; NominalValue?: unknown };
              if (str(prop.Name) !== "ThermalTransmittance") continue;
              const v = num(prop.NominalValue);
              if (v !== null) { t.uWm2k = v * unit.scale; t.uPset = str(pset.Name); }
            }
          } catch { /* a pset that does not read back */ }
        }
        types.set(tId, t);
      }
      for (const e of ids(rel.RelatedObjects)) if (targets.has(e)) typeOf.set(e, tId);
    }
  } catch { /* a file without types */ }
  // 2 · the material sets, by the object (type or element) they are associated with
  const setOf = new Map<number, { setId: number; name: string | null; layers: TypeLayer[] }>();
  const readSet = (mId: number): { setId: number; name: string | null; layers: TypeLayer[] } | null => {
    const kind = api.GetLineType(modelID, mId);
    let setId = mId;
    if (kind === IFCMATERIALLAYERSETUSAGE) {
      const u = api.GetLine(modelID, mId) as { ForLayerSet?: unknown };
      const ls = idOf(u.ForLayerSet);
      if (ls === null) return null;
      setId = ls;
    } else if (kind !== IFCMATERIALLAYERSET && kind !== IFCMATERIALCONSTITUENTSET) return null;
    const set = api.GetLine(modelID, setId) as { LayerSetName?: unknown; Name?: unknown; MaterialLayers?: unknown; MaterialConstituents?: unknown };
    const matName = (m: unknown): string => { const id = idOf(m); if (id === null) return ""; try { return str((api.GetLine(modelID, id) as { Name?: unknown }).Name) ?? ""; } catch { return ""; } };
    const layers: TypeLayer[] = [];
    for (const lId of ids(set.MaterialLayers)) {
      const l = api.GetLine(modelID, lId) as { Material?: unknown; LayerThickness?: unknown; Name?: unknown; Category?: unknown };
      const th = num(l.LayerThickness);
      layers.push({ part: null, material: matName(l.Material) || str(l.Name) || "?", thicknessM: th === null ? null : th * lengthScale, category: str(l.Category) });
    }
    for (const cId of ids(set.MaterialConstituents)) {
      const c = api.GetLine(modelID, cId) as { Name?: unknown; Material?: unknown; Category?: unknown };
      layers.push({ part: str(c.Name), material: matName(c.Material) || "?", thicknessM: null, category: str(c.Category) });
    }
    return { setId, name: str(set.LayerSetName) ?? str(set.Name), layers };
  };
  // AN ASSEMBLY'S SET REACHES ITS PARTS (2026-10-16): Revit writes a roof as an IfcRoof that carries the layer set and no geometry,
  // aggregating the IfcSlab (.ROOF.) that carries the geometry and no set — the part takes its whole's set when it has none of its own
  const aggParts = new Map<number, number[]>();   // the whole → its meshed parts
  try {
    const ag = api.GetLineIDsWithType(modelID, IFCRELAGGREGATES);
    for (let i = 0; i < ag.size(); i++) {
      try {
        const rel = api.GetLine(modelID, ag.get(i)) as { RelatingObject?: unknown; RelatedObjects?: unknown };
        const whole = idOf(rel.RelatingObject);
        const parts = ids(rel.RelatedObjects).filter((o) => targets.has(o));
        if (whole !== null && parts.length && !targets.has(whole)) aggParts.set(whole, parts);
      } catch { /* unreadable rel */ }
    }
  } catch { /* no aggregation */ }
  try {
    const rels = api.GetLineIDsWithType(modelID, IFCRELASSOCIATESMATERIAL);
    for (let i = 0; i < rels.size(); i++) {
      try {
        const rel = api.GetLine(modelID, rels.get(i)) as { RelatingMaterial?: unknown; RelatedObjects?: unknown };
        const mId = idOf(rel.RelatingMaterial);
        if (mId === null) continue;
        const objs = ids(rel.RelatedObjects).filter((o) => types.has(o) || targets.has(o) || aggParts.has(o));
        if (!objs.length) continue;
        const set = readSet(mId);
        if (!set) continue;
        for (const o of objs) setOf.set(o, set);
      } catch { /* unreadable rel */ }
    }
  } catch { /* no material associations */ }
  for (const [whole, parts] of aggParts) { const set = setOf.get(whole); if (set) for (const pt of parts) if (!setOf.has(pt)) setOf.set(pt, set); }
  // 3 · a type's layers: its own set, else the set its elements carry
  for (const t of types.values()) {
    const own = setOf.get(t.expressId);
    if (own) { t.layers = own.layers; t.layersFrom = "type"; }
  }
  for (const [e, tId] of typeOf) {
    const t = types.get(tId);
    const set = setOf.get(e);
    if (t && set && !t.layers.length) { t.layers = set.layers; t.layersFrom = "element"; }
  }
  // AN ELEMENT'S OWN MATERIALS (2026-11-13): a typed element whose own set states other materials than its type's
  // ("This element only" in BIMedit, a material painted on one wall in Revit) gets a row of its own — the set's express id,
  // shared by every element carrying that set — named for its type and its materials, so it can carry its own construction.
  // Read from the type before (it was hidden under the type's layers, the defect found 2026-11-06)
  for (const [e, tId] of typeOf) {
    const t = types.get(tId);
    const set = setOf.get(e);
    if (!t || !set || !t.layers.length || t.ownOf !== undefined) continue;
    if (materialsKey(set.layers) === materialsKey(t.layers)) continue;
    let own = types.get(set.setId);
    if (!own) {
      const mats = [...new Set(set.layers.map((l) => l.material))];
      own = { expressId: set.setId, ifcClass: t.ifcClass, globalId: null, name: `${t.name ?? `#${tId}`} · own materials: ${mats.slice(0, 3).join(" / ")}${mats.length > 3 ? ` +${mats.length - 3}` : ""}`,
        uWm2k: null, uPset: null, layers: set.layers, layersFrom: "element", ownOf: tId };
      types.set(set.setId, own);
    }
    typeOf.set(e, own.expressId);
  }
  // an element with a set and no type: the type row whose name is the set's, else a row keyed by the set
  const byName = new Map<string, number>();
  for (const t of types.values()) if (t.name) byName.set(t.name, t.expressId);
  for (const e of elements) {
    if (typeOf.has(e.expressId)) continue;
    const set = setOf.get(e.expressId);
    if (!set || !/^IFC(WALL|WALLSTANDARDCASE|SLAB|ROOF|COVERING|WINDOW|DOOR)$/i.test(e.ifcClass)) continue;
    let tId = set.name ? byName.get(set.name) : undefined;
    if (tId === undefined) {
      tId = set.setId;
      if (!types.has(tId)) types.set(tId, { expressId: tId, ifcClass: classOf.get(e.expressId) ?? "UNKNOWN", globalId: null, name: set.name, uWm2k: null, uPset: null, layers: set.layers, layersFrom: "element" });
      if (set.name) byName.set(set.name, tId);
    }
    typeOf.set(e.expressId, tId);
  }
  return { types: [...types.values()].sort((a, b) => a.expressId - b.expressId), typeOf, uUnit: unit.text, uScale: unit.scale };
}

/** the scale of a non-length unit the file assigns, to SI: an IfcDerivedUnit's
 *  elements (prefix factor ^ exponent, kg·K⁻¹·s⁻³ → 1) or a conversion-based
 *  unit's factor; 1 with the unit named when it is plainly SI, and null text
 *  when the file states no such unit */
export function readUnitScale(api: WebIFC.IfcAPI, modelID: number, unitType: string): { scale: number; text: string | null } {
  const pf: Record<string, number> = { EXA: 1e18, PETA: 1e15, TERA: 1e12, GIGA: 1e9, MEGA: 1e6, KILO: 1e3, HECTO: 1e2, DECA: 1e1, DECI: 1e-1, CENTI: 1e-2, MILLI: 1e-3, MICRO: 1e-6, NANO: 1e-9, PICO: 1e-12 };
  const sym: Record<string, string> = { GRAM: "g", KELVIN: "K", SECOND: "s", METRE: "m", WATT: "W", JOULE: "J" };
  const sup = (n: number): string => String(n).replace(/-/g, "⁻").replace(/\d/g, (d) => "⁰¹²³⁴⁵⁶⁷⁸⁹"[Number(d)]!);
  try {
    const asg = api.GetLineIDsWithType(modelID, IFCUNITASSIGNMENT);
    for (let i = 0; i < asg.size(); i++) {
      const ua = api.GetLine(modelID, asg.get(i)) as { Units?: Array<{ value?: number }> };
      for (const uref of ua.Units ?? []) {
        if (!uref?.value) continue;
        const u = api.GetLine(modelID, uref.value) as { UnitType?: { value?: string }; Elements?: Array<{ value?: number }>; ConversionFactor?: { value?: number }; Name?: { value?: string } };
        if (u?.UnitType?.value !== unitType) continue;
        if (Array.isArray(u.Elements)) {
          let scale = 1;
          const parts: string[] = [];
          for (const eref of u.Elements) {
            if (!eref?.value) continue;
            const el = api.GetLine(modelID, eref.value) as { Unit?: { value?: number }; Exponent?: { value?: number } };
            const exp = el.Exponent?.value ?? 1;
            const base = el.Unit?.value ? (api.GetLine(modelID, el.Unit.value) as { Prefix?: { value?: string } | null; Name?: { value?: string } }) : null;
            const prefix = base?.Prefix?.value ?? "";
            // the SI base of mass is the KILOgram: a kilo prefix on gram is scale 1
            const f = base?.Name?.value === "GRAM" ? (pf[prefix] ?? 1) / 1e3 : (pf[prefix] ?? 1);
            scale *= f ** exp;
            parts.push(`${prefix === "KILO" && base?.Name?.value === "GRAM" ? "k" : ""}${sym[base?.Name?.value ?? ""] ?? (base?.Name?.value ?? "?").toLowerCase()}${exp === 1 ? "" : sup(exp)}`);
          }
          return { scale, text: parts.join("·") };
        }
        if (typeof u.ConversionFactor?.value === "number") {
          const mwu = api.GetLine(modelID, u.ConversionFactor.value) as { ValueComponent?: { value?: number } };
          const v = mwu?.ValueComponent?.value;
          if (typeof v === "number" && v > 0) return { scale: v, text: u.Name?.value ?? "conversion" };
        }
        return { scale: 1, text: u.Name?.value ?? "SI" };
      }
    }
  } catch { /* fall through */ }
  return { scale: 1, text: null };
}

/** every IfcBuildingStorey, name and stated Elevation (scaled by the file's length unit) */
export function readAllStoreys(api: WebIFC.IfcAPI, modelID: number): Array<{ name: string; elevM: number | null }> {
  const out: Array<{ name: string; elevM: number | null }> = [];
  try {
    const scale = readLengthScale(api, modelID);
    const ids = api.GetLineIDsWithType(modelID, IFCBUILDINGSTOREY);
    for (let i = 0; i < ids.size(); i++) {
      const st = api.GetLine(modelID, ids.get(i)) as { Name?: { value?: string }; LongName?: { value?: string }; Elevation?: { value?: number } };
      const name = st?.Name?.value ?? st?.LongName?.value;
      if (!name) continue;
      out.push({ name, elevM: typeof st?.Elevation?.value === "number" ? st.Elevation.value * scale : null });
    }
  } catch { /* a silent file: an empty list */ }
  return out.sort((a, b) => (a.elevM ?? -1e9) - (b.elevM ?? -1e9));
}

/** the IfcProject: its GlobalId, Name and LongName as stated; null when the file has none (then no project is assumed) */
export function readProject(api: WebIFC.IfcAPI, modelID: number): { globalId: string; name: string | null; longName: string | null } | null {
  const str = (v: unknown): string | null => { const t = typeof v === "string" ? v : (v && typeof v === "object" && typeof (v as { value?: unknown }).value === "string") ? String((v as { value: string }).value) : ""; return t.trim() ? t : null; };
  try {
    const ids = api.GetLineIDsWithType(modelID, IFCPROJECT);
    if (!ids.size()) return null;
    const p = api.GetLine(modelID, ids.get(0)) as { GlobalId?: unknown; Name?: unknown; LongName?: unknown };
    const gid = str(p.GlobalId);
    return gid ? { globalId: gid, name: str(p.Name), longName: str(p.LongName) } : null;
  } catch { return null; }
}

/** the address as the file states it: an IfcPostalAddress (AddressLines, Town,
 *  Region, PostalCode, Country) on the IfcSite or the IfcBuilding, else the
 *  IfcProject's LongName when it is not empty — read, never geocoded */
export function readAddress(api: WebIFC.IfcAPI, modelID: number): string | null {
  const str = (v: unknown): string => (typeof v === "string" ? v : (v && typeof v === "object" && typeof (v as { value?: unknown }).value === "string") ? String((v as { value: string }).value) : "");
  try {
    const addrs = api.GetLineIDsWithType(modelID, IFCPOSTALADDRESS);
    for (let i = 0; i < addrs.size(); i++) {
      const a = api.GetLine(modelID, addrs.get(i)) as { AddressLines?: unknown[]; Town?: unknown; Region?: unknown; PostalCode?: unknown; Country?: unknown };
      const parts = [...(Array.isArray(a.AddressLines) ? a.AddressLines.map(str) : []), str(a.Town), str(a.Region), str(a.PostalCode), str(a.Country)].filter((x) => x.trim());
      if (parts.length) return parts.join(", ");
    }
    const projects = api.GetLineIDsWithType(modelID, IFCPROJECT);
    if (projects.size()) {
      const p = api.GetLine(modelID, projects.get(0)) as { LongName?: unknown };
      const ln = str(p.LongName).trim();
      if (ln) return ln;
    }
  } catch { /* silent file: null */ }
  return null;
}

/** IfcSite: latitude and longitude come as (degrees, minutes, seconds,
 *  millionths of a second), signed on every component; elevation in the
 *  file's length unit — but web-ifc leaves attributes unconverted, so the
 *  caller's length scale applies. Left in the file's unit here; the gate
 *  reads a metres-or-feet flag elsewhere and this house states 0. */
export function readSite(api: WebIFC.IfcAPI, modelID: number): { latitude: number; longitude: number; elevationM: number } | null {
  try {
    const sites = api.GetLineIDsWithType(modelID, IFCSITE);
    if (sites.size() === 0) return null;
    // web-ifc hands a compound measure as { value: [deg, min, sec, µsec] }
    // and a length as { _representationValue } — unwrap both, assume neither
    const site = api.GetLine(modelID, sites.get(0)) as {
      RefLatitude?: { value?: unknown } | unknown[] | null;
      RefLongitude?: { value?: unknown } | unknown[] | null;
      RefElevation?: { value?: unknown; _representationValue?: unknown } | number | null;
    };
    const num = (v: unknown): number => {
      if (typeof v === "number") return v;
      if (v && typeof v === "object") {
        const o = v as { value?: unknown; _representationValue?: unknown };
        if (typeof o.value === "number") return o.value;
        if (typeof o._representationValue === "number") return o._representationValue;
      }
      return 0;
    };
    const deg = (a: unknown): number | null => {
      const arr = Array.isArray(a) ? a : (a && typeof a === "object" && Array.isArray((a as { value?: unknown }).value))
        ? (a as { value: unknown[] }).value : null;
      if (!arr || arr.length < 2) return null;
      const d = num(arr[0]), mi = num(arr[1]), s = num(arr[2]), us = num(arr[3]);
      const sign = d < 0 || mi < 0 || s < 0 || us < 0 ? -1 : 1;
      return sign * (Math.abs(d) + Math.abs(mi) / 60 + Math.abs(s) / 3600 + Math.abs(us) / 3.6e9);
    };
    const lat = deg(site.RefLatitude), lon = deg(site.RefLongitude);
    if (lat === null || lon === null) return null;
    return { latitude: lat, longitude: lon, elevationM: num(site.RefElevation) };
  } catch { return null; }
}

/** Stream the IfcSpace volumes. Their triangles run through the SAME merge as
 *  everything else (extract.ts), but into a private stats object: a space is
 *  not part of the surface census and must not move the area identity. */
function readSpaces3D(api: WebIFC.IfcAPI, modelID: number): SpaceOut[] {
  const out: SpaceOut[] = [];
  try {
    api.StreamAllMeshesWithTypes(modelID, [IFCSPACE], (mesh) => {
      const parts: Array<{ rgba: number; positions: Float64Array; indices: Uint32Array }> = [];
      const geoms = mesh.geometries;
      for (let gi = 0; gi < geoms.size(); gi++) {
        const pg = geoms.get(gi);
        const g = api.GetGeometry(modelID, pg.geometryExpressID);
        const src = api.GetVertexArray(g.GetVertexData(), g.GetVertexDataSize());
        const idx = api.GetIndexArray(g.GetIndexData(), g.GetIndexDataSize());
        const m = pg.flatTransformation;
        const nVerts = src.length / 6;
        const pos = new Float64Array(nVerts * 3);
        for (let i = 0; i < nVerts; i++) {
          const x = src[i * 6]!, y = src[i * 6 + 1]!, z = src[i * 6 + 2]!;
          pos[i * 3] = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
          pos[i * 3 + 1] = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
          pos[i * 3 + 2] = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
        }
        parts.push({ rgba: 0, positions: pos, indices: new Uint32Array(idx) });
        (g as unknown as { delete?: () => void }).delete?.();
      }
      let globalId: string | null = null, name: string | null = null, longName: string | null = null;
      try {
        const line = api.GetLine(modelID, mesh.expressID) as {
          GlobalId?: { value?: string }; Name?: { value?: string }; LongName?: { value?: string };
        };
        globalId = line?.GlobalId?.value ?? null;
        name = line?.Name?.value ?? null;
        longName = line?.LongName?.value ?? null;
      } catch { /* geometry-only space */ }
      const faces: FaceOut[] = [];
      extractElement({ expressId: mesh.expressID, parts }, faces, newStats());
      out.push({ expressId: mesh.expressID, globalId, name, longName, colorIndex: 0, storey: null, storeyElevM: null, faces });
    });
  } catch { /* the file has no space geometry — the view simply has none */ }
  // a stable order gives a stable colour in every view, every run
  out.sort((a, b) => a.expressId - b.expressId);
  out.forEach((sp, i) => { sp.colorIndex = i; });
  // TWO ROOMS, ONE NAME (a two-unit building: each unit's "Living Room"): the room's name is its key in every table and ruling, so
  // a LongName the file gives to more than one space carries the space's own Name beside it ("Living Room A101"), or its id when
  // the Names repeat too — the file's words, both of them, nothing invented
  {
    const label = (sp: { longName: string | null; name: string | null; expressId: number }): string => sp.longName ?? sp.name ?? `#${sp.expressId}`;
    const count = new Map<string, number>();
    for (const sp of out) count.set(label(sp), (count.get(label(sp)) ?? 0) + 1);
    const seen = new Set<string>();
    for (const sp of out) {
      const l = label(sp);
      if ((count.get(l) ?? 0) < 2 || sp.longName === null) continue;
      let u = sp.name && sp.name !== sp.longName ? `${sp.longName} ${sp.name}` : `${sp.longName} #${sp.expressId}`;
      if (seen.has(u)) u = `${sp.longName} #${sp.expressId}`;
      seen.add(u);
      sp.longName = u;
    }
  }
  // which storey aggregates each space, and at what elevation
  {
    const byId = new Map(out.map((sp) => [sp.expressId, sp]));
    for (const [id, st] of readSpaceStoreys(api, modelID, new Set(byId.keys()))) {
      const sp = byId.get(id);
      if (sp) { sp.storey = st.name; sp.storeyElevM = st.elevM; }
    }
  }
  return out;
}

/** IfcGeometricRepresentationContext.TrueNorth is an IfcDirection in the IFC
 *  XY plane. web-ifc streams Y-up, mapping IFC (x, y, z) → (x, z, −y), so the
 *  plan north vector is (tn.x, −tn.y). */
export function readTrueNorth(api: WebIFC.IfcAPI, modelID: number): [number, number] | null {
  try {
    const ctxs = api.GetLineIDsWithType(modelID, IFCGEOMETRICREPRESENTATIONCONTEXT);
    for (let i = 0; i < ctxs.size(); i++) {
      const ctx = api.GetLine(modelID, ctxs.get(i)) as { TrueNorth?: { value?: number } };
      if (!ctx?.TrueNorth?.value) continue;
      const dir = api.GetLine(modelID, ctx.TrueNorth.value) as {
        DirectionRatios?: Array<number | { value?: number }>;
      };
      const r = dir?.DirectionRatios;
      if (!Array.isArray(r) || r.length < 2) continue;
      const num = (v: number | { value?: number } | undefined): number =>
        typeof v === "number" ? v : (v?.value ?? 0);
      const x = num(r[0]), z = -num(r[1]);
      const l = Math.hypot(x, z);
      if (l < 1e-9) continue;
      return [x / l, z / l];
    }
  } catch { /* the file is silent — say so with null, never guess */ }
  return null;
}

const asBool = (v: unknown): boolean | null => {
  if (typeof v === "boolean") return v;
  if (v === "T" || v === ".T." || v === "TRUE") return true;
  if (v === "F" || v === ".F." || v === "FALSE") return false;
  return null;
};

/** IfcRelSpaceBoundary: which named spaces does this element bound? Some
 *  boundaries are virtual (no RelatedBuildingElement) — skipped, not an error. */
function readSpaces(
  api: WebIFC.IfcAPI,
  modelID: number,
  targets: Set<number>,
): Map<number, Set<string>> {
  const out = new Map<number, Set<string>>();
  const rels = api.GetLineIDsWithType(modelID, IFCRELSPACEBOUNDARY);
  for (let i = 0; i < rels.size(); i++) {
    try {
      const rel = api.GetLine(modelID, rels.get(i)) as {
        RelatingSpace?: { value?: number };
        RelatedBuildingElement?: { value?: number };
      };
      const el = rel.RelatedBuildingElement?.value;
      if (!el || !targets.has(el) || !rel.RelatingSpace?.value) continue;
      const sp = api.GetLine(modelID, rel.RelatingSpace.value) as {
        Name?: { value?: string }; LongName?: { value?: string };
      };
      const nm = sp?.LongName?.value ?? sp?.Name?.value;
      if (!nm) continue;
      const set = out.get(el) ?? new Set<string>();
      set.add(nm);
      out.set(el, set);
    } catch { /* unreadable rel — skip */ }
  }
  return out;
}

/** The FILE's length unit, as metres — from IfcUnitAssignment. An imperial
 *  export states FOOT via IfcConversionBasedUnit(#10) → IfcMeasureWithUnit 0.3048;
 *  a metric export states METRE (with an optional MILLI prefix). Attribute
 *  values like a storey's Elevation are in THIS unit — web-ifc converts only
 *  geometry, never attributes. */
function readLengthScale(api: WebIFC.IfcAPI, modelID: number): number {
  try {
    const asg = api.GetLineIDsWithType(modelID, IFCUNITASSIGNMENT);
    for (let i = 0; i < asg.size(); i++) {
      const ua = api.GetLine(modelID, asg.get(i)) as { Units?: Array<{ value?: number }> };
      for (const uref of ua.Units ?? []) {
        if (!uref?.value) continue;
        const u = api.GetLine(modelID, uref.value) as {
          UnitType?: { value?: string };
          Prefix?: { value?: string } | null;
          Name?: { value?: string };
          ConversionFactor?: { value?: number };
        };
        if (u?.UnitType?.value !== "LENGTHUNIT") continue;
        if (typeof u.ConversionFactor?.value === "number") {
          const mwu = api.GetLine(modelID, u.ConversionFactor.value) as {
            ValueComponent?: { value?: number };
          };
          const v = mwu?.ValueComponent?.value;
          if (typeof v === "number" && v > 0) return v;
        }
        const pf: Record<string, number> = { MILLI: 1e-3, CENTI: 1e-2, DECI: 1e-1, KILO: 1e3 };
        return u.Prefix?.value ? pf[u.Prefix.value] ?? 1 : 1;
      }
    }
  } catch { /* fall through */ }
  return 1;
}

/** Which IfcBuildingStorey contains each element, via
 *  IfcRelContainedInSpatialStructure. The storey's Elevation attribute is in
 *  the FILE's length unit, not web-ifc's metres frame, so it is scaled by the
 *  factor the file itself states. */
function readStoreys(
  api: WebIFC.IfcAPI,
  modelID: number,
  targets: Set<number>,
): Map<number, { name: string; elevM: number | null }> {
  const out = new Map<number, { name: string; elevM: number | null }>();
  const scale = readLengthScale(api, modelID);
  const rels = api.GetLineIDsWithType(modelID, IFCRELCONTAINEDINSPATIALSTRUCTURE);
  for (let i = 0; i < rels.size(); i++) {
    try {
      const rel = api.GetLine(modelID, rels.get(i)) as {
        RelatingStructure?: { value?: number };
        RelatedElements?: Array<{ value?: number }>;
      };
      const stId = rel.RelatingStructure?.value;
      if (!stId) continue;
      // only a real storey — elements are also "contained" in zones and
      // groups whose names are meaningless as levels
      if (api.GetLineType(modelID, stId) !== IFCBUILDINGSTOREY) continue;
      const st = api.GetLine(modelID, stId) as {
        Name?: { value?: string }; LongName?: { value?: string };
        Elevation?: { value?: number };
      };
      const name = st?.Name?.value ?? st?.LongName?.value;
      if (!name) continue;
      const elevM = typeof st?.Elevation?.value === "number" ? st.Elevation.value * scale : null;
      for (const r of rel.RelatedElements ?? []) {
        const id = r?.value;
        if (id && targets.has(id)) out.set(id, { name, elevM });
      }
    } catch { /* unreadable rel — skip */ }
  }
  return out;
}

/** Which IfcBuildingStorey AGGREGATES each space (IfcRelAggregates —
 *  spaces hang under storeys by aggregation, not containment). */
function readSpaceStoreys(
  api: WebIFC.IfcAPI,
  modelID: number,
  targets: Set<number>,
): Map<number, { name: string; elevM: number | null }> {
  const out = new Map<number, { name: string; elevM: number | null }>();
  const scale = readLengthScale(api, modelID);
  const rels = api.GetLineIDsWithType(modelID, IFCRELAGGREGATES);
  for (let i = 0; i < rels.size(); i++) {
    try {
      const rel = api.GetLine(modelID, rels.get(i)) as {
        RelatingObject?: { value?: number };
        RelatedObjects?: Array<{ value?: number }>;
      };
      const stId = rel.RelatingObject?.value;
      if (!stId || api.GetLineType(modelID, stId) !== IFCBUILDINGSTOREY) continue;
      const st = api.GetLine(modelID, stId) as {
        Name?: { value?: string }; LongName?: { value?: string }; Elevation?: { value?: number };
      };
      const name = st?.Name?.value ?? st?.LongName?.value;
      if (!name) continue;
      const elevM = typeof st?.Elevation?.value === "number" ? st.Elevation.value * scale : null;
      for (const r of rel.RelatedObjects ?? []) {
        const id = r?.value;
        if (id && targets.has(id)) out.set(id, { name, elevM });
      }
    } catch { /* unreadable rel — skip */ }
  }
  return out;
}

/** Pset_WallCommon / Pset_SlabCommon / Pset_RoofCommon carry IsExternal;
 *  Pset_DoorCommon / Pset_WindowCommon carry GlazingAreaFraction, and a
 *  Pset_DoorWindowGlazingType states glazing by being there at all. One walk
 *  of IfcRelDefinesByProperties without flattening (deref by id). */
function readCommonPsets(
  api: WebIFC.IfcAPI,
  modelID: number,
  targets: Set<number>,
): { isExternal: Map<number, boolean>; glazingFraction: Map<number, number>; glazingPset: Set<number> } {
  const isExternal = new Map<number, boolean>();
  const glazingFraction = new Map<number, number>();
  const glazingPset = new Set<number>();
  const opaque = new Set<number>();
  const relIds = api.GetLineIDsWithType(modelID, IFCRELDEFINESBYPROPERTIES);
  for (let i = 0; i < relIds.size(); i++) {
    try {
      const rel = api.GetLine(modelID, relIds.get(i)) as {
        RelatedObjects?: Array<{ value?: number }> | { value?: number };
        RelatingPropertyDefinition?: { value?: number };
      };
      const objs = Array.isArray(rel.RelatedObjects) ? rel.RelatedObjects : [rel.RelatedObjects];
      const hits = objs.filter((o) => o?.value !== undefined && targets.has(o.value)).map((o) => o!.value!);
      if (hits.length === 0) continue;
      const psetId = rel.RelatingPropertyDefinition?.value;
      if (!psetId) continue;
      const pset = api.GetLine(modelID, psetId) as {
        Name?: { value?: string };
        HasProperties?: Array<{ value?: number }>;
      };
      if (pset.Name?.value === "Pset_DoorWindowGlazingType") for (const id of hits) glazingPset.add(id);
      if (!Array.isArray(pset.HasProperties)) continue;
      for (const ph of pset.HasProperties) {
        if (ph?.value === undefined) continue;
        const prop = api.GetLine(modelID, ph.value) as {
          Name?: { value?: string };
          NominalValue?: { value?: unknown };
        };
        const pn = prop.Name?.value;
        if (pn === "IsExternal") {
          const b = asBool(prop.NominalValue?.value);
          if (b !== null) for (const id of hits) isExternal.set(id, b);
        } else if (pn === "GlazingAreaFraction") {
          const v = prop.NominalValue?.value;
          const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
          if (Number.isFinite(n)) for (const id of hits) if (!opaque.has(id)) glazingFraction.set(id, n);
        } else if (pn === "Opaque" && pset.Name?.value === "BIMedit_Glazing" && asBool(prop.NominalValue?.value) === true) {
          // A SOLID DOOR (the user's ruling, 2026-09-25): GlazingAreaFraction must be > 0 (IfcPositiveRatioMeasure WR1), so a
          // door ruled solid carries no fraction and BIMedit's project pset Opaque = true — read as a stated fraction of 0
          for (const id of hits) { opaque.add(id); glazingFraction.set(id, 0); }
        }
      }
    } catch { /* unreadable rel — skip */ }
  }
  return { isExternal, glazingFraction, glazingPset };
}
