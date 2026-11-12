// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE MODULE RAIL's registry: three modules, one window. Each module owns a
// `.sqlite` file in data/ and reads the one before it — the contract — and
// the rail shows whether that read is still fresh (core/stale.ts). The
// accent is the only colour a module is allowed to bring: it appears on its
// rail item, its arm bars and its apply button, nowhere else.
//
// A module's PAGES are its tabs (user, 2026-09-04): one strip at the top of
// the editing column, one tab active at a time, the rail jumping to a
// module's first tab and lighting the module a tab belongs to. BEM's tabs
// follow what four interfaces agree on (references/bem-screen-organisation.md):
// site · constructions · schedules · zones · systems · run (the user put SYSTEMS after
// CONSTRUCTIONS on 2026-09-10 and restored this order on 2026-09-14: the schedules and
// the zones are what a system is assigned to, so they come first).

export type AppModule = "bim" | "bem" | "bom";

export type TabId = "bim-edit" | "bem-site" | "bem-constructions" | "bem-schedules" | "bem-zones" | "bem-systems" | "bem-run" | "bom-ops" | "bom-cfd";

export interface TabDef { id: TabId; label: string; title: string }

export interface ModuleDef {
  id: AppModule;
  label: string;
  /** what the module is, for the rail's tooltip */
  title: string;
  /** the CSS token carrying its accent */
  accentVar: string;
  /** the file it writes */
  file: string;
  /** its pages, in workflow order */
  tabs: TabDef[];
}

export const MODULES: ModuleDef[] = [
  { id: "bim", label: "BIM", title: "the envelope — ifc.db and idf.db from the IFC", accentVar: "--accent-bim", file: "idf.db", tabs: [
    { id: "bim-edit", label: "IDF-DB EDITING", title: "the single-plane placements, the storey steps, the wall QA, the spaces, the corrections" },
  ] },
  { id: "bem", label: "BEM", title: "the energy model — bem.db and the EnergyPlus run from idf.db", accentVar: "--accent-bem", file: "bem.db", tabs: [
    { id: "bem-site", label: "SITE", title: "location, weather file, design days, run period, ground, simulation settings" },
    { id: "bem-constructions", label: "CONSTRUCTIONS", title: "a construction per surface kind — the file's U-values, the library, the code defaults" },
    { id: "bem-schedules", label: "SCHEDULES", title: "a schedule per role — the library's profiles" },
    { id: "bem-zones", label: "ZONES", title: "what each zone runs on — conditioning, thermostat, infiltration, people, the system serving it, its load overrides" },
    { id: "bem-systems", label: "SYSTEMS", title: "the mechanical, electrical and plumbing systems the file names — heating, cooling, ventilation · power, lighting, generation · hot water, water — and the loads they carry" },
    { id: "bem-run", label: "RUN", title: "validate, run, the log, the results and the lens" },
  ] },
  { id: "bom", label: "BOM", title: "the operations model — bom.db: schedules, tariff, bills, calibration", accentVar: "--accent-bom", file: "bom.db", tabs: [
    { id: "bom-ops", label: "OPERATIONS", title: "bills, tariff and PV, calibration" },
    { id: "bom-cfd", label: "CFD", title: "the air in a room at its heating and cooling design peaks — OpenFOAM runs kept in cfd.db, drawn as arrows, slices and the room's assessment" },
  ] },
];

export const TABS: Array<TabDef & { module: AppModule }> = MODULES.flatMap((m) => m.tabs.map((t) => ({ ...t, module: m.id })));

export function moduleOf(tab: TabId): AppModule {
  return TABS.find((t) => t.id === tab)?.module ?? "bim";
}

/** a module's own pages — the strip shows these alone (user, 2026-09-04: a BEM tab must not show BIM's or BOM's) */
export function tabsOf(m: AppModule): TabDef[] {
  return MODULES.find((x) => x.id === m)?.tabs ?? [];
}

export function firstTab(m: AppModule): TabId {
  return MODULES.find((x) => x.id === m)?.tabs[0]?.id ?? "bim-edit";
}

export function isTab(v: unknown): v is TabId {
  return typeof v === "string" && TABS.some((t) => t.id === v);
}
