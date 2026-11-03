// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE FILE'S OWN LAYERS (user, 2026-11-02: "a layer selection process for loaded ifc files"). An IFC file names its layers in
// IfcPresentationLayerAssignment, whose AssignedItems are shape representations, not elements. An element reaches its layer
// through its IfcProductDefinitionShape: the Body representation's layer when it has one, else the first representation that is
// on a layer. Measured on the three project files: every element with a shape gets a layer (the house's 108 IfcOpeningElements,
// which are never drawn, have none).

import * as WebIFC from "web-ifc";
import { IFCPRESENTATIONLAYERASSIGNMENT, IFCPRODUCT } from "web-ifc";

type Ref = { value: number } | null | undefined;
const list = (v: unknown): number[] => (Array.isArray(v) ? (v as Ref[]).map((r) => r?.value).filter((n): n is number => typeof n === "number") : []);

/** element express id → the name of its layer, for every element of the open model that is on one */
export function readLayers(api: WebIFC.IfcAPI, modelID: number): Map<number, string> {
  const repLayer = new Map<number, string>();
  const asg = api.GetLineIDsWithType(modelID, IFCPRESENTATIONLAYERASSIGNMENT);
  for (let i = 0; i < asg.size(); i++) {
    const line = api.GetLine(modelID, asg.get(i), false) as { Name?: { value?: string }; AssignedItems?: Ref[] };
    const name = line.Name?.value?.trim();
    if (!name) continue;
    for (const r of list(line.AssignedItems)) if (!repLayer.has(r)) repLayer.set(r, name);
  }
  const out = new Map<number, string>();
  if (!repLayer.size) return out;
  const prods = api.GetLineIDsWithType(modelID, IFCPRODUCT, true);
  for (let i = 0; i < prods.size(); i++) {
    const id = prods.get(i);
    const p = api.GetLine(modelID, id, false) as { Representation?: Ref };
    const pds = p.Representation?.value;
    if (!pds) continue;
    const reps = list((api.GetLine(modelID, pds, false) as { Representations?: Ref[] }).Representations);
    let layer: string | undefined;
    for (const r of reps) {
      const l = repLayer.get(r);
      if (!l) continue;
      const ident = (api.GetLine(modelID, r, false) as { RepresentationIdentifier?: { value?: string } }).RepresentationIdentifier?.value;
      if (ident === "Body") { layer = l; break; }
      layer ??= l;
    }
    if (layer) out.set(id, layer);
  }
  return out;
}

/** a layer's key in the view state: the file and the layer, as one string */
export const layerKey = (file: string, layer: string): string => `${file}|${layer}`;

/** the layers of one file with how many elements each holds, by name */
export function layerCounts(map: ReadonlyMap<number, string>): Array<{ name: string; count: number }> {
  const n = new Map<string, number>();
  for (const l of map.values()) n.set(l, (n.get(l) ?? 0) + 1);
  return [...n].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
}
