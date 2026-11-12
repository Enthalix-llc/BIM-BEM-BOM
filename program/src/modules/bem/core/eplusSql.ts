// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE RESULTS, READ FROM THE ENGINE'S OWN DATABASE. `Output:SQLite` makes
// EnergyPlus write eplusout.sql beside the run — thirty-odd tables holding
// every tabular report and every variable it was asked for — and this module
// opens it with sql.js exactly as it opens idf.db. No CSV parsing, no .eso
// walking: the engine's tables are the fact.
//
// Three things the file's shape demands, each paid for once by the
// predecessor: the design days are simulated too, so a time series is taken
// from the weather run period only (`EnvironmentType = 3`); `Time.Year` can
// be 0 for a typical year and is never filtered on; every key the engine
// writes is UPPERCASE, so joins go through `UPPER()`. For hourly series,
// later: `Hour` marks the END of the interval.

import type { Database } from "sql.js";

/** the coil rates a structure's peak is summed from (2026-10-11): the engine's own variable names */
export const COIL_RATE = { heating: "Heating Coil Heating Rate", cooling: "Cooling Coil Total Cooling Rate" } as const;
/** EACH ZONE'S AIR HEAT BALANCE (2026-10-11): the engine's terms of the zone air's balance, per zone, and every surface's convection to it */
export const ZB = "Zone Air Heat Balance ";
export const ZONE_BALANCE_VARIABLES = [
  "Surface Inside Face Convection Heat Gain Rate",
  `${ZB}Internal Convective Heat Gain Rate`, `${ZB}Interzone Air Transfer Rate`, `${ZB}Outdoor Air Transfer Rate`,
  `${ZB}System Air Transfer Rate`, `${ZB}System Convective Heat Gain Rate`, `${ZB}Air Energy Storage Rate`,
] as const;
export const ERV_RATE_VARIABLES = ["Zone Ventilator Sensible Heating Rate", "Zone Ventilator Sensible Cooling Rate"] as const;
/** the balance's own components, beside the surface groups (whose names are the engine's Component Load Summary rows) */
export const BALANCE = {
  internal: "Internal Gains (convective)", infiltration: "Infiltration", mixing: "Interzone Mixing", erv: "Ventilation (ERV)",
  storage: "Zone Air Storage", fenestration: "Fenestration", mass: "Internal Mass", residual: "Unattributed (sub-timestep averaging)",
} as const;
/** a zone whose unit supplies less than this at its peak has no peak of that kind (the Garage has no cooling) */
export const NO_PEAK_W = 10;
export interface CoilDesignRate { coil: string; kind: "heating" | "cooling"; day: "summer" | "winter"; /** the minute of the design day the interval ends */ minute: number; w: number }
export interface CoilYearRate { coil: string; kind: "heating" | "cooling"; /** W, hour i of the weather run */ values: number[] }
export interface FacilityResults {
  heatingKwh: number;
  coolingKwh: number;
  conditionedAreaM2: number;
  totalAreaM2: number;
  unmetHeatingH: number;
  unmetCoolingH: number;
}

export interface SeriesValue {
  /** the variable or meter name, as the engine writes it */
  name: string;
  /** the key (zone, surface, ideal-loads system…), UPPERCASE as the engine writes it */
  key: string;
  /** 1–12, or 0 for a run-period value */
  month: number;
  value: number;
  units: string;
  isMeter: boolean;
}

export interface DailyValue { name: string; key: string; month: number; day: number; value: number; units: string }
/** an hourly series over the weather run period (2026-10-03): the meters and the outdoor dry-bulb, value i the hour i after the run's
 *  first midnight. `start` = the run's first day as the engine dated it [year, month, day] — Jan 1 of the engine's nominal year for a
 *  typical year, the weather file's own first day for an actual one (2026-10-07: a run need not start on Jan 1) */
export interface HourlySeries { name: string; units: string; values: number[]; start?: [number, number, number] }
export interface TariffResult { name: string; annualUsd: number; monthlyUsd: number[]; selected: boolean }

export interface EngineSurface { name: string; cls: string; areaM2: number; grossAreaM2: number; azimuthDeg: number; tiltDeg: number; zoneIndex: number | null }
export interface EngineZone { index: number; name: string; volumeM3: number; floorAreaM2: number }

/** one row of the engine's HVAC Sizing Summary: the DESIGN load of a zone or
 *  a space at the design day that produced it — the zone's sensible load only,
 *  no ventilation or system effects (the report's own note) */
export interface SizingRow {
  scope: "zone" | "space";
  key: string;
  kind: "heating" | "cooling";
  designLoadW: number;
  userLoadW: number;
  perAreaWm2: number;
  airFlowM3s: number;
  designDay: string;
  /** the engine's own stamp, e.g. "1/21 24:00:00" */
  peakTime: string;
  outdoorC: number;
}

/** a zone's peak ideal-loads rate over the weather year — a month (1–12) or
 *  the maximum of months (0), from the writer's Output:Table:Monthly */
export interface PeakRow { key: string; kind: "heating" | "cooling"; month: number; maxW: number; time: string }

/** the facility's coincident peak under the weather year, from the Demand End Use Components Summary */
export interface FacilityPeak { heatingW: number; heatingTime: string; coolingW: number; coolingTime: string }

/** THE END USES BY FUEL (2026-09-15): one non-zero cell of the ABUPS End Uses table — a row (Heating, Cooling, Fans,
 *  Interior Lighting…) by a fuel column (Electricity, Propane, District Heating Water…); kWh, Water in m³. The day a
 *  real system is saved heating moves from the District column to Electricity or Propane, and the facility's heating
 *  is the row summed over every fuel — never one column read alone. */
export interface EndUseCell { row: string; fuel: string; value: number; units: string }
/** a fuel's coincident peak (the Demand End Use Components Summary): the rows' share at the fuel's own peak time */
export interface FuelPeak { fuel: string; row: string; w: number; units: string }
export interface FuelPeakTime { fuel: string; time: string }
/** THE SIZING REPORTS (user, 2026-09-15: "system peak loads for unit sizing"): a cell of ComponentSizingSummary —
 *  every autosized field of every object, the class as the table's name — or of CoilSizingDetails' Coils table, the
 *  fields a unit is picked from (capacity, air and water flow, the design day and hour, the entering and leaving
 *  conditions). A text cell (a type, a name, a design day) travels as `text`; the engine's -999 sentinel reads as none. */
/** ONE ZONE'S PEAK BY LOAD COMPONENT (2026-10-02): the engine's Zone Component Load Summary — the Total column of its estimated
 *  heating and cooling peak tables, W, signed as the engine signs them (a heating loss negative), and the time of that peak */
export interface ComponentLoad { zone: string; kind: "heating" | "cooling"; component: string; w: number; time: string }
export interface SizingDetail { kind: "component" | "coil"; cls: string; subject: string; field: string; value: number | null; text: string | null; units: string }

/** the CoilSizingDetails fields kept — the rest of its ~100 columns are the engine's intermediate psychrometrics */
export const COIL_FIELDS = new Set([
  "Coil Type", "Coil Location", "HVAC Type", "HVAC Name", "Zone Name(s)", "Autosized Coil Capacity?", "Autosized Coil Airflow?", "Autosized Coil Water Flow?",
  "Coil Final Gross Total Capacity", "Coil Final Gross Sensible Capacity", "Coil Final Reference Air Volume Flow Rate", "Coil Final Reference Plant Fluid Volume Flow Rate",
  "Supply Fan Name for Coil", "Supply Fan Maximum Air Volume Flow Rate", "Plant Name for Coil", "Plant Design Fluid Supply Temperature", "Plant Design Fluid Return Temperature",
  "Design Day Name at Sensible Ideal Loads Peak", "Date/Time at Sensible Ideal Loads Peak", "Design Day Name at Total Ideal Loads Peak", "Date/Time at Total Ideal Loads Peak", "Peak Load Type to Size On",
  "Coil Total Capacity at Ideal Loads Peak", "Coil Sensible Capacity at Ideal Loads Peak", "Coil Air Volume Flow Rate at Ideal Loads Peak",
  "Coil Entering Air Drybulb at Ideal Loads Peak", "Coil Entering Air Wetbulb at Ideal Loads Peak", "Coil Leaving Air Drybulb at Ideal Loads Peak", "Coil Leaving Air Wetbulb at Ideal Loads Peak",
  "Coil Entering Plant Fluid Temperature at Ideal Loads Peak", "Coil Leaving Plant Fluid Temperature at Ideal Loads Peak", "Coil Plant Fluid Mass Flow Rate at Ideal Loads Peak",
  "Outdoor Air Drybulb at Ideal Loads Peak", "Outdoor Air Wetbulb at Ideal Loads Peak", "Zone Air Drybulb at Ideal Loads Peak", "Zone Sensible Heat Gain at Ideal Loads Peak", "Zone Latent Heat Gain at Ideal Loads Peak",
  "Coil Total Capacity at Rating Conditions", "Coil Sensible Capacity at Rating Conditions", "Coil Air Mass Flow Rate at Rating Conditions",
]);

export interface DesignSurfaceTemp { key: string; day: "summer" | "winter"; hour: number; c: number; face?: "outside" | "inside" }
export interface RunResults {
  facility: FacilityResults;
  facilityPeak: FacilityPeak;
  sizing: SizingRow[];
  peaks: PeakRow[];
  /** per zone (UPPERCASE), hours the setpoint was not met, from SystemSummary */
  zoneUnmet: Map<string, { heatingH: number; coolingH: number }>;
  /** every Monthly / RunPeriod variable and meter over the weather run period */
  series: SeriesValue[];
  /** every Daily meter over the weather run period */
  daily: DailyValue[];
  /** every Hourly meter, and the outdoor dry-bulb, over the weather run period */
  hourly: HourlySeries[];
  /** THE TARIFFS (2026-10-03): each UtilityCost:Tariff's monthly total and its year, from the engine's Tariff Report and Economics summary */
  tariffs: TariffResult[];
  surfaces: EngineSurface[];
  zones: EngineZone[];
  /** the tabular reports available, for the census */
  reportNames: string[];
  /** every non-zero End Uses cell by row and fuel (2026-09-15) */
  endUses: EndUseCell[];
  /** each fuel's coincident peak by row, and its time */
  fuelPeaks: FuelPeak[];
  fuelPeakTimes: FuelPeakTime[];
  /** the two sizing reports the run writes and a unit is picked from */
  sizingDetails: SizingDetail[];
  /** each zone's design-day peak by load component, Grand Total included (2026-10-02) */
  componentLoads: ComponentLoad[];
  /** THE OUTSIDE FACE TEMPERATURES ON THE DESIGN DAYS (2026-10-08): each surface, each hour (1–24, the hour ending), °C */
  designSurfaceTemps?: DesignSurfaceTemp[];
  /** every coil's rate on the design days (each zone timestep) and over the weather year (hourly), W (2026-10-11) */
  coilDesign?: CoilDesignRate[]; coilYear?: CoilYearRate[];
  /** each zone's design-day peak from its own air heat balance, in ComponentLoad's terms (2026-10-11) */
  zoneBalance?: ComponentLoad[];
}

type Row = Array<string | number | Uint8Array | null>;
function rows(db: Database, sql: string, params: Array<string | number> = []): Row[] {
  const r = db.exec(sql, params);
  return r.length ? (r[0]!.values as Row[]) : [];
}
const num = (v: string | number | Uint8Array | null): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: string | number | Uint8Array | null): string => (v === null ? "" : String(v));
const at = (r: Row, i: number): string | number | Uint8Array | null => r[i] ?? null;

/** one cell of a tabular report, by report / table / row / column */
/** a tabular cell as text — the engine's timestamps and design-day names */
export function tabularText(db: Database, report: string, table: string, row: string, column: RegExp): string {
  for (const r of rows(db,
    "SELECT ColumnName, Value FROM TabularDataWithStrings WHERE ReportName=? AND TableName=? AND RowName=?", [report, table, row])) {
    if (column.test(str(at(r, 0)))) return str(at(r, 1)).trim();
  }
  return "";
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const MONTH_ROWS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** the engine's two timestamp forms — "1/21 24:00:00" (a design day) and
 *  "14-FEB-07:30" (the weather year) — as one number MMDDHHMM, so the long
 *  results table can hold a time; 0 when there is none */
export function encodeTime(t: string): number {
  let m = /^\s*(\d+)\/(\d+)\s+(\d+):(\d+)/.exec(t);
  if (m) return +m[1]! * 1e6 + +m[2]! * 1e4 + +m[3]! * 100 + +m[4]!;
  m = /^\s*(\d+)-([A-Za-z]{3})-(\d+):(\d+)/.exec(t);
  if (m) return (MONTHS.indexOf(m[2]!.toUpperCase()) + 1) * 1e6 + +m[1]! * 1e4 + +m[3]! * 100 + +m[4]!;
  return 0;
}

/** MMDDHHMM back to words: "14 Feb 07:30" */
export function decodeTime(n: number): string {
  if (!n) return "";
  const mo = Math.floor(n / 1e6), d = Math.floor((n % 1e6) / 1e4), h = Math.floor((n % 1e4) / 100), mi = n % 100;
  const name = MONTHS[mo - 1] ?? "";
  return `${d} ${name.charAt(0)}${name.slice(1).toLowerCase()} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}

export function tabular(db: Database, report: string, table: string, row: string, column: RegExp): number {
  for (const r of rows(db,
    "SELECT ColumnName, Value FROM TabularDataWithStrings WHERE ReportName=? AND TableName=? AND RowName=?",
    [report, table, row])) {
    if (column.test(str(at(r, 0)))) return num(at(r, 1));
  }
  return 0;
}

/** a component the engine's table cannot hold: a heat pump water heater's pull on its room (2026-10-07) */
export const HPWH_COMPONENT = "Heat Pump Water Heater";

export function readRunSql(db: Database, opts: { hpwhZones?: ReadonlyMap<string, string>; unitHeaters?: ReadonlyMap<string, string>; ervZones?: ReadonlyMap<string, string> } = {}): RunResults {
  const A = "AnnualBuildingUtilityPerformanceSummary";
  // THE END USES BY FUEL (2026-09-15): the whole table, every non-zero cell; heating and cooling are the ROW over every
  // fuel, so a heat pump's electricity counts as heating the day one is saved (the District columns alone read 0 then)
  const endUses: EndUseCell[] = [];
  for (const r of rows(db, "SELECT RowName, ColumnName, Value, Units FROM TabularDataWithStrings WHERE ReportName=? AND TableName='End Uses'", [A])) {
    const row = str(at(r, 0)).trim(), fuel = str(at(r, 1)).trim(), v = num(at(r, 2));
    if (!row || !fuel || v === 0) continue;
    endUses.push({ row, fuel, value: v, units: str(at(r, 3)).trim() });
  }
  const rowSum = (row: string): number => endUses.filter((c) => c.row === row && c.units === "kWh").reduce((t, c) => t + c.value, 0);
  const facility: FacilityResults = {
    heatingKwh: rowSum("Heating"),
    coolingKwh: rowSum("Cooling"),
    conditionedAreaM2: tabular(db, A, "Building Area", "Net Conditioned Building Area", /Area/),
    totalAreaM2: tabular(db, A, "Building Area", "Total Building Area", /Area/),
    unmetHeatingH: tabular(db, A, "Comfort and Setpoint Not Met Summary", "Time Setpoint Not Met During Occupied Heating", /Facility/),
    unmetCoolingH: tabular(db, A, "Comfort and Setpoint Not Met Summary", "Time Setpoint Not Met During Occupied Cooling", /Facility/),
  };

  // the coincident facility peak under the weather year, with its time
  const D = "DemandEndUseComponentsSummary";
  const facilityPeak: FacilityPeak = {
    heatingW: tabular(db, D, "End Uses", "Heating", /District Heating Water/),
    heatingTime: tabularText(db, D, "End Uses", "Time of Peak", /District Heating Water/),
    coolingW: tabular(db, D, "End Uses", "Cooling", /District Cooling/),
    coolingTime: tabularText(db, D, "End Uses", "Time of Peak", /District Cooling/),
  };
  // each fuel's own coincident peak — what a meter sees — with the rows' share at that moment and its time
  const fuelPeaks: FuelPeak[] = [], fuelPeakTimes: FuelPeakTime[] = [];
  for (const r of rows(db, "SELECT RowName, ColumnName, Value, Units FROM TabularDataWithStrings WHERE ReportName=? AND TableName='End Uses'", [D])) {
    const row = str(at(r, 0)).trim(), fuel = str(at(r, 1)).trim(), txt = str(at(r, 2)).trim();
    if (row === "Time of Peak") { if (txt && txt !== "-") fuelPeakTimes.push({ fuel, time: txt }); continue; }
    const v = num(at(r, 2));
    if (!row || !fuel || v === 0) continue;
    fuelPeaks.push({ fuel, row, w: v, units: str(at(r, 3)).trim() });
  }

  // THE SIZING REPORTS (2026-09-15): every ComponentSizingSummary cell (the class is the table's name), and the kept
  // CoilSizingDetails fields per coil; a text cell travels as text, the engine's -999 "not applicable" as none
  const sizingDetails: SizingDetail[] = [];
  const cellOf = (v: string): { value: number | null; text: string | null } => {
    const n = Number(v);
    if (v === "") return { value: null, text: null };
    if (Number.isFinite(n)) return { value: n <= -998 ? null : n, text: null };
    return { value: null, text: v };
  };
  const isNone = (s: string): boolean => s === "" || s.toUpperCase() === "NONE";   // the engine's placeholder row when nothing exists to size
  for (const r of rows(db, "SELECT TableName, RowName, ColumnName, Value, Units FROM TabularDataWithStrings WHERE ReportName='ComponentSizingSummary'")) {
    if (isNone(str(at(r, 1)).trim())) continue;
    sizingDetails.push({ kind: "component", cls: str(at(r, 0)).trim(), subject: str(at(r, 1)).trim(), field: str(at(r, 2)).trim(), ...cellOf(str(at(r, 3)).trim()), units: str(at(r, 4)).trim() });
  }
  const coilType = new Map<string, string>();
  for (const r of rows(db, "SELECT RowName, ColumnName, Value FROM TabularDataWithStrings WHERE ReportName='CoilSizingDetails' AND TableName='Coils' AND ColumnName='Coil Type'")) coilType.set(str(at(r, 0)).trim(), str(at(r, 2)).trim());
  for (const r of rows(db, "SELECT RowName, ColumnName, Value, Units FROM TabularDataWithStrings WHERE ReportName='CoilSizingDetails' AND TableName='Coils'")) {
    const subject = str(at(r, 0)).trim(), field = str(at(r, 1)).trim();
    if (isNone(subject) || !COIL_FIELDS.has(field)) continue;
    sizingDetails.push({ kind: "coil", cls: coilType.get(subject) ?? "", subject, field, ...cellOf(str(at(r, 2)).trim()), units: str(at(r, 3)).trim() });
  }

  // the design loads: the HVAC Sizing Summary, zone and space tables alike
  const sizing: SizingRow[] = [];
  const SIZING_TABLES = [
    ["zone", "heating", "Zone Sensible Heating"], ["zone", "cooling", "Zone Sensible Cooling"],
    ["space", "heating", "Space Sensible Heating"], ["space", "cooling", "Space Sensible Cooling"],
  ] as const;
  for (const [scope, kind, table] of SIZING_TABLES) {
    const byRow = new Map<string, Map<string, string>>();
    for (const r of rows(db, "SELECT RowName, ColumnName, Value FROM TabularDataWithStrings WHERE ReportName='HVACSizingSummary' AND TableName=?", [table])) {
      const key = str(at(r, 0)).trim().toUpperCase();
      if (!key || key === "NONE") continue;
      const e = byRow.get(key) ?? new Map<string, string>();
      e.set(str(at(r, 1)).trim(), str(at(r, 2)).trim());
      byRow.set(key, e);
    }
    const col = (c: Map<string, string>, label: string): string => { for (const [k, v] of c) if (k.startsWith(label)) return v; return ""; };
    for (const [key, c] of byRow) {
      sizing.push({
        scope, key, kind,
        designLoadW: +col(c, "Calculated Design Load") || 0, userLoadW: +col(c, "User Design Load") || 0,
        perAreaWm2: +col(c, "User Design Load per Area") || 0, airFlowM3s: +col(c, "Calculated Design Air Flow") || 0,
        designDay: col(c, "Design Day Name"), peakTime: col(c, "Date/Time Of Peak"), outdoorC: +col(c, "Outdoor Temperature at Peak Load") || 0,
      });
    }
  }

  // the weather-year peaks per zone: the writer's monthly table of maxima
  const pk = new Map<string, PeakRow>();
  for (const r of rows(db, "SELECT ReportForString, RowName, ColumnName, Value FROM TabularDataWithStrings WHERE ReportName='ZONE PEAK LOADS'")) {
    const zone = zoneOfKey(str(at(r, 0)).toUpperCase()), row = str(at(r, 1)).trim(), col = str(at(r, 2)), val = str(at(r, 3)).trim();
    const month = row === "Maximum of Months" ? 0 : MONTH_ROWS.indexOf(row) + 1;
    if (row !== "Maximum of Months" && month === 0) continue;
    const kind: PeakRow["kind"] | null = /HEATING RATE/i.test(col) ? "heating" : /COOLING RATE/i.test(col) ? "cooling" : null;
    if (!kind) continue;
    const id = `${zone}|${kind}|${month}`;
    const e = pk.get(id) ?? { key: zone, kind, month, maxW: 0, time: "" };
    if (/\{TIMESTAMP\}/.test(col)) e.time = val; else e.maxW = +val || 0;
    pk.set(id, e);
  }
  // the annual maximum carries no stamp of its own: it is the stamp of the month that holds it
  for (const e of pk.values()) {
    if (e.month !== 0 || e.time) continue;
    const m = [...pk.values()].filter((x) => x.key === e.key && x.kind === e.kind && x.month > 0 && Math.abs(x.maxW - e.maxW) < 1e-6)[0];
    if (m) e.time = m.time;
  }
  const peaks = [...pk.values()];

  const zoneUnmet = new Map<string, { heatingH: number; coolingH: number }>();
  for (const r of rows(db,
    "SELECT RowName, ColumnName, Value FROM TabularDataWithStrings WHERE ReportName='SystemSummary' AND TableName='Time Setpoint Not Met'")) {
    const zone = str(at(r, 0)).toUpperCase(), col = str(at(r, 1));
    const e = zoneUnmet.get(zone) ?? { heatingH: 0, coolingH: 0 };
    if (/^During Heating$/i.test(col)) e.heatingH = num(at(r, 2));
    else if (/^During Cooling$/i.test(col)) e.coolingH = num(at(r, 2));
    else continue;
    zoneUnmet.set(zone, e);
  }

  // the weather run period only: design days are simulated too
  const series: SeriesValue[] = [];
  for (const r of rows(db, `
    SELECT d.Name, d.KeyValue, d.ReportingFrequency, d.IsMeter, d.Units, t.Month, SUM(r.Value)
      FROM ReportData r
      JOIN ReportDataDictionary d ON d.ReportDataDictionaryIndex = r.ReportDataDictionaryIndex
      JOIN Time t ON t.TimeIndex = r.TimeIndex
      JOIN EnvironmentPeriods e ON e.EnvironmentPeriodIndex = t.EnvironmentPeriodIndex
     WHERE e.EnvironmentType = 3 AND d.ReportingFrequency IN ('Monthly', 'Run Period')
     GROUP BY d.Name, d.KeyValue, d.ReportingFrequency, d.IsMeter, d.Units, t.Month`)) {
    const freq = str(at(r, 2));
    series.push({
      name: str(at(r, 0)), key: str(at(r, 1)).toUpperCase(), month: freq === "Run Period" ? 0 : num(at(r, 5)),
      value: num(at(r, 6)), units: str(at(r, 4)), isMeter: num(at(r, 3)) === 1,
    });
  }

  const daily: DailyValue[] = [];
  for (const r of rows(db, `
    SELECT d.Name, d.KeyValue, d.Units, t.Month, t.Day, r.Value
      FROM ReportData r
      JOIN ReportDataDictionary d ON d.ReportDataDictionaryIndex = r.ReportDataDictionaryIndex
      JOIN Time t ON t.TimeIndex = r.TimeIndex
      JOIN EnvironmentPeriods e ON e.EnvironmentPeriodIndex = t.EnvironmentPeriodIndex
     WHERE e.EnvironmentType = 3 AND d.ReportingFrequency = 'Daily'
     ORDER BY d.Name, t.Month, t.Day`)) {
    daily.push({ name: str(at(r, 0)), key: str(at(r, 1)).toUpperCase(), units: str(at(r, 2)), month: num(at(r, 3)), day: num(at(r, 4)), value: num(at(r, 5)) });
  }

  // THE HOURS (user, 2026-10-03: RUN's day and week views): the hourly meters and the site's dry-bulb — the run's EMS hourly
  // variables are left out. A series' hours in the time table's order; the weather period is one year (8760, or 8784 in a leap year)
  const hourly: HourlySeries[] = [];
  {
    const by = new Map<string, HourlySeries>();
    for (const r of rows(db, `
      SELECT d.Name, d.Units, r.Value
        FROM ReportData r
        JOIN ReportDataDictionary d ON d.ReportDataDictionaryIndex = r.ReportDataDictionaryIndex
        JOIN Time t ON t.TimeIndex = r.TimeIndex
        JOIN EnvironmentPeriods e ON e.EnvironmentPeriodIndex = t.EnvironmentPeriodIndex
       WHERE e.EnvironmentType = 3 AND d.ReportingFrequency = 'Hourly' AND (d.IsMeter = 1 OR d.Name = 'Site Outdoor Air Drybulb Temperature')
       ORDER BY d.ReportDataDictionaryIndex, t.TimeIndex`)) {
      const name = str(at(r, 0));
      const h = by.get(name) ?? by.set(name, { name, units: str(at(r, 1)), values: [] }).get(name)!;
      h.values.push(num(at(r, 2)));
    }
    // the run's first hour, as the engine dated it
    const t0 = rows(db, `SELECT t.Year, t.Month, t.Day FROM Time t JOIN EnvironmentPeriods e ON e.EnvironmentPeriodIndex = t.EnvironmentPeriodIndex
       WHERE e.EnvironmentType = 3 AND t.IntervalType = 1 ORDER BY t.TimeIndex LIMIT 1`)[0];
    const start: [number, number, number] | undefined = t0 ? [num(at(t0, 0)), num(at(t0, 1)), num(at(t0, 2))] : undefined;
    hourly.push(...[...by.values()].map((h) => (start ? { ...h, start } : h)));
  }

  // THE TARIFF REPORT (2026-10-03): per tariff (ReportForString), the Categories table's Total row, January to December; the year from
  // the Economics Results Summary's Tariff Summary
  const tariffs: TariffResult[] = [];
  {
    const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const by = new Map<string, TariffResult>();
    for (const r of rows(db, "SELECT ReportForString, ColumnName, Value FROM TabularDataWithStrings WHERE ReportName='Tariff Report' AND TableName='Categories' AND RowName LIKE 'Total%'")) {
      const n = str(at(r, 0)), col = str(at(r, 1)), k = MON.findIndex((m) => col.startsWith(m));
      if (k < 0) continue;
      const t = by.get(n) ?? by.set(n, { name: n, annualUsd: 0, monthlyUsd: new Array(12).fill(0), selected: false }).get(n)!;
      t.monthlyUsd[k] = num(at(r, 2));
    }
    for (const r of rows(db, "SELECT RowName, ColumnName, Value FROM TabularDataWithStrings WHERE ReportName='Economics Results Summary Report' AND TableName='Tariff Summary'")) {
      const t = by.get(str(at(r, 0)));
      if (!t) continue;
      if (/^Annual Cost/i.test(str(at(r, 1)))) t.annualUsd = num(at(r, 2));
      if (/^Selected/i.test(str(at(r, 1)))) t.selected = /yes/i.test(String(at(r, 2)));
    }
    tariffs.push(...by.values());
  }

  const surfaces: EngineSurface[] = rows(db,
    "SELECT SurfaceName, ClassName, Area, GrossArea, Azimuth, Tilt, ZoneIndex FROM Surfaces").map((r) => ({
    name: str(at(r, 0)), cls: str(at(r, 1)), areaM2: num(at(r, 2)), grossAreaM2: num(at(r, 3)), azimuthDeg: num(at(r, 4)), tiltDeg: num(at(r, 5)),
    zoneIndex: at(r, 6) === null ? null : num(at(r, 6)),
  }));
  const zones: EngineZone[] = rows(db, "SELECT ZoneIndex, ZoneName, Volume, FloorArea FROM Zones").map((r) => ({
    index: num(at(r, 0)), name: str(at(r, 1)), volumeM3: num(at(r, 2)), floorAreaM2: num(at(r, 3)),
  }));
  const reportNames = rows(db, "SELECT DISTINCT ReportName FROM TabularDataWithStrings ORDER BY ReportName").map((r) => str(at(r, 0)));

  // each zone's peak by load component — the report's name carries spaces in the sql ("Zone Component Load Summary")
  const componentLoads: ComponentLoad[] = [];
  const peakAt = new Map<string, string>();
  for (const r of rows(db, "SELECT ReportForString, TableName, Value FROM TabularDataWithStrings WHERE ReportName='Zone Component Load Summary' AND RowName='Time of Peak Load'"))
    peakAt.set(`${str(at(r, 0)).trim().toUpperCase()}|${str(at(r, 1)).startsWith("Heating") ? "heating" : "cooling"}`, str(at(r, 2)).trim());
  for (const r of rows(db, "SELECT ReportForString, TableName, RowName, Value FROM TabularDataWithStrings WHERE ReportName='Zone Component Load Summary' AND ColumnName='Total' AND TableName IN ('Estimated Heating Peak Load Components', 'Estimated Cooling Peak Load Components')")) {
    const zone = str(at(r, 0)).trim().toUpperCase(), kind = str(at(r, 1)).startsWith("Estimated Heating") ? "heating" as const : "cooling" as const;
    const v = Number(str(at(r, 3)).trim());
    if (!zone || !Number.isFinite(v)) continue;
    componentLoads.push({ zone, kind, component: str(at(r, 2)).trim(), w: v, time: peakAt.get(`${zone}|${kind}`) ?? "" });
  }
  // A HEAT PUMP WATER HEATER'S PULL ON ITS ROOM (user, 2026-10-07: "the heat pump water heater does not appear to extract heat from the
  // garage"). The engine's table counts zone equipment as no load component; the evaporator's sensible cooling of the zone air is read
  // here, over the DESIGN DAY of the zone's peak (the run simulates the sizing periods) — the day's mean, the heater running on the
  // draws and not on the peak — and set beside the table's components in its sign: heat taken from the room is a loss (negative), an
  // added heating load, a cooling load relieved. The engine's Grand Total is left as it is.
  if (opts.hpwhZones?.size) {
    const dd = new Map<string, number>();   // "month/day" → the design day's environment
    for (const r of rows(db, "SELECT DISTINCT t.EnvironmentPeriodIndex, t.Month, t.Day FROM Time t JOIN EnvironmentPeriods e ON e.EnvironmentPeriodIndex=t.EnvironmentPeriodIndex WHERE e.EnvironmentType=1 AND t.Month IS NOT NULL"))
      dd.set(`${num(at(r, 1))}/${num(at(r, 2))}`, num(at(r, 0)));
    for (const [coil, zone] of opts.hpwhZones) {
      for (const kind of ["heating", "cooling"] as const) {
        const time = peakAt.get(`${zone}|${kind}`) ?? "";
        const m = /^(\d+)\/(\d+)/.exec(time), env = m ? dd.get(`${Number(m[1])}/${Number(m[2])}`) : undefined;
        if (env === undefined) continue;
        const r = rows(db, "SELECT avg(r.Value) FROM ReportData r JOIN ReportDataDictionary d ON d.ReportDataDictionaryIndex=r.ReportDataDictionaryIndex JOIN Time t ON t.TimeIndex=r.TimeIndex WHERE upper(d.KeyValue)=? AND d.Name='Cooling Coil Sensible Cooling Rate' AND t.EnvironmentPeriodIndex=? AND (t.WarmupFlag IS NULL OR t.WarmupFlag=0)", [coil, env])[0];
        const w = r ? num(at(r, 0)) : 0;
        if (w > 0) componentLoads.push({ zone, kind, component: HPWH_COMPONENT, w: -w, time });
      }
    }
  }
  // A UNIT HEATER'S PEAK OVER THE RUN (user, 2026-10-08: "Show garage heater at 3.8kW and report peak"): its coil's heating rate, the
  // largest timestep of the weather run (EnvironmentType 3) and when — a sizing row on the unit, beside the capacity it was given
  for (const [coil, unit] of opts.unitHeaters ?? []) {
    const r = rows(db, "SELECT r.Value, t.Month, t.Day, t.Hour, t.Minute FROM ReportData r JOIN ReportDataDictionary d ON d.ReportDataDictionaryIndex=r.ReportDataDictionaryIndex JOIN Time t ON t.TimeIndex=r.TimeIndex JOIN EnvironmentPeriods e ON e.EnvironmentPeriodIndex=t.EnvironmentPeriodIndex WHERE upper(d.KeyValue)=? AND d.Name=? AND e.EnvironmentType=3 ORDER BY r.Value DESC LIMIT 1", [coil, UH_PEAK_VARIABLE])[0];
    if (!r) continue;
    const pad = (n: number): string => String(n).padStart(2, "0");
    sizingDetails.push({ kind: "component", cls: "ZoneHVAC:UnitHeater", subject: unit, field: UH_PEAK_FIELD, value: num(at(r, 0)), text: null, units: "W" });
    sizingDetails.push({ kind: "component", cls: "ZoneHVAC:UnitHeater", subject: unit, field: UH_PEAK_TIME_FIELD, value: null, text: `${pad(num(at(r, 1)))}/${pad(num(at(r, 2)))} ${pad(num(at(r, 3)) - 1)}:${pad(num(at(r, 4)))}`, units: "" });
  }
  // THE OUTSIDE FACE TEMPERATURES ON THE DESIGN DAYS (user, 2026-10-08): the writer asks for them on the design days only; the day's own
  // type says which (a SummerDesignDay is the cooling peaks' day, a WinterDesignDay the heating peaks')
  const designSurfaceTemps: DesignSurfaceTemp[] = [];
  for (const r of rows(db, "SELECT d.KeyValue, t.DayType, t.Hour, r.Value, d.Name FROM ReportData r JOIN ReportDataDictionary d ON d.ReportDataDictionaryIndex=r.ReportDataDictionaryIndex JOIN Time t ON t.TimeIndex=r.TimeIndex JOIN EnvironmentPeriods e ON e.EnvironmentPeriodIndex=t.EnvironmentPeriodIndex WHERE e.EnvironmentType=1 AND d.Name IN ('Surface Outside Face Temperature', 'Surface Inside Face Temperature')")) {
    const dt = str(at(r, 1));
    const day = /Summer/i.test(dt) ? "summer" : /Winter/i.test(dt) ? "winter" : null;
    if (day) designSurfaceTemps.push({ key: str(at(r, 0)).toUpperCase(), day, hour: num(at(r, 2)), c: num(at(r, 3)), face: /Inside/.test(str(at(r, 4))) ? "inside" : "outside" });
  }
  // THE COILS' RATES (2026-10-11): on the design days at each zone timestep (the minute the interval ends), and by the hour over the weather
  // year — read so the units of one structure can be summed at the instant they peak together
  const coilDesign: CoilDesignRate[] = [], coilYear: CoilYearRate[] = [];
  const kindOf = (n: string): "heating" | "cooling" | null => (n === COIL_RATE.heating ? "heating" : n === COIL_RATE.cooling ? "cooling" : null);
  for (const r of rows(db, `SELECT d.KeyValue, d.Name, t.DayType, t.Hour, t.Minute, r.Value FROM ReportData r JOIN ReportDataDictionary d ON d.ReportDataDictionaryIndex=r.ReportDataDictionaryIndex
      JOIN Time t ON t.TimeIndex=r.TimeIndex JOIN EnvironmentPeriods e ON e.EnvironmentPeriodIndex=t.EnvironmentPeriodIndex
      WHERE e.EnvironmentType=1 AND d.ReportingFrequency <> 'Hourly' AND d.Name IN (?, ?) ORDER BY t.TimeIndex`, [COIL_RATE.heating, COIL_RATE.cooling])) {
    const dt = str(at(r, 2)), day = /Summer/i.test(dt) ? "summer" : /Winter/i.test(dt) ? "winter" : null, kind = kindOf(str(at(r, 1)));
    if (day && kind) coilDesign.push({ coil: str(at(r, 0)).toUpperCase(), kind, day, minute: (num(at(r, 3)) - 1) * 60 + num(at(r, 4)), w: num(at(r, 5)) });
  }
  {
    const by = new Map<string, CoilYearRate>();
    for (const r of rows(db, `SELECT d.KeyValue, d.Name, r.Value FROM ReportData r JOIN ReportDataDictionary d ON d.ReportDataDictionaryIndex=r.ReportDataDictionaryIndex
        JOIN Time t ON t.TimeIndex=r.TimeIndex JOIN EnvironmentPeriods e ON e.EnvironmentPeriodIndex=t.EnvironmentPeriodIndex
        WHERE e.EnvironmentType=3 AND d.ReportingFrequency='Hourly' AND d.Name IN (?, ?) ORDER BY d.ReportDataDictionaryIndex, t.TimeIndex`, [COIL_RATE.heating, COIL_RATE.cooling])) {
      const kind = kindOf(str(at(r, 1)));
      if (!kind) continue;
      const k = `${kind}|${str(at(r, 0)).toUpperCase()}`;
      const s0 = by.get(k) ?? by.set(k, { coil: str(at(r, 0)).toUpperCase(), kind, values: [] }).get(k)!;
      s0.values.push(num(at(r, 2)));
    }
    coilYear.push(...by.values());
  }
  const zoneBalance = readZoneBalance(db, opts);
  return { facility, facilityPeak, sizing, peaks, zoneUnmet, series, daily, hourly, tariffs, surfaces, zones, reportNames, endUses, fuelPeaks, fuelPeakTimes, sizingDetails, componentLoads, designSurfaceTemps, coilDesign, coilYear, zoneBalance };
}

/** a surface's group in the balance — the engine's Component Load Summary row names, so the colours carry over. The boundary is the sql's
 *  ExtBoundCond: 0 outdoors, > 0 another surface (interzone), −1 the ground, −4 an F/C-factor ground, −6 a Kiva foundation */
export function balanceGroup(cls: string, bound: number): string {
  const c = cls.toLowerCase(), ground = bound === -1 || bound === -4 || bound === -6, iz = bound > 0;
  if (c === "window" || c === "glassdoor" || c.startsWith("tdd")) return BALANCE.fenestration;
  if (c === "internalmass") return BALANCE.mass;
  if (c === "door") return iz ? "Interzone Wall" : "Opaque Door";
  if (c === "wall") return iz ? "Interzone Wall" : ground ? "Ground Contact Wall" : bound === 0 ? "Exterior Wall" : "Other Wall";
  if (c === "roof" || c === "ceiling") return iz ? "Interzone Ceiling" : bound === 0 ? "Roof" : "Other Roof";
  if (c === "floor") return iz ? "Interzone Floor" : ground ? "Ground Contact Floor" : bound === 0 ? "Exterior Floor" : "Other Floor";
  return `Other ${cls}`;
}

/** EACH ZONE'S PEAK FROM ITS OWN AIR HEAT BALANCE (2026-10-11). On each design day of its kind (a WinterDesignDay for heating, a
 *  SummerDesignDay for cooling) the zone timestep its conditioning unit supplies the most — the zone equipment's supply (the engine's
 *  System Air Transfer + System Convective) less what the zone's ERV and heat pump water heater did to the air — and at that instant
 *  every term of the balance as a GAIN to the zone air (W, + warms it): each surface group's convection, the convective internal gains,
 *  the outdoor air (infiltration), interzone mixing, the ERV, the water heater's evaporator, and the air's own storage taken as − its rate.
 *  The Grand Total is − the unit's supply (the engine's sign: a heating load negative); what the terms leave over is shown, not spread:
 *  the surfaces' outputs are zone-timestep values and the air's balance is averaged over the HVAC sub-steps, so where a unit cycles the
 *  two part (the Garage's heater, 2026-10-11: the faces 199 W, the zone's own surface convection 312 W, the zone's balance closing to 12 W).
 *  Radiant gains (the sun, lights) reach the air through the surfaces that absorb them, so they are in those surfaces' convection.
 *  A zone whose unit supplies under NO_PEAK_W writes only its Grand Total — no peak of that kind. */
export function readZoneBalance(db: Database, opts: { ervZones?: ReadonlyMap<string, string>; hpwhZones?: ReadonlyMap<string, string> } = {}): ComponentLoad[] {
  const zoneName = new Map(rows(db, "SELECT ZoneIndex, ZoneName FROM Zones").map((r) => [num(at(r, 0)), str(at(r, 1)).toUpperCase()] as const));
  const surf = new Map<string, { zone: string; group: string }>();
  for (const r of rows(db, "SELECT SurfaceName, ClassName, ExtBoundCond, ZoneIndex FROM Surfaces WHERE HeatTransferSurf=1"))
    surf.set(str(at(r, 0)).toUpperCase(), { zone: zoneName.get(num(at(r, 3))) ?? "", group: balanceGroup(str(at(r, 1)), num(at(r, 2))) });
  // zone → time index → term → W
  const by = new Map<string, Map<number, Map<string, number>>>();
  const put = (zone: string, ti: number, term: string, w: number): void => {
    if (!zone) return;
    const z = by.get(zone) ?? by.set(zone, new Map()).get(zone)!;
    const m = z.get(ti) ?? z.set(ti, new Map()).get(ti)!;
    m.set(term, (m.get(term) ?? 0) + w);
  };
  const when = new Map<number, { day: "winter" | "summer"; text: string }>();
  const pad = (n: number): string => String(n).padStart(2, "0");
  const names = [...ZONE_BALANCE_VARIABLES, ...ERV_RATE_VARIABLES, "Cooling Coil Sensible Cooling Rate"];
  for (const r of rows(db, `SELECT upper(d.KeyValue), d.Name, t.TimeIndex, t.DayType, t.Month, t.Day, t.Hour, t.Minute, r.Value FROM ReportData r
      JOIN ReportDataDictionary d ON d.ReportDataDictionaryIndex=r.ReportDataDictionaryIndex JOIN Time t ON t.TimeIndex=r.TimeIndex
      JOIN EnvironmentPeriods e ON e.EnvironmentPeriodIndex=t.EnvironmentPeriodIndex
      WHERE e.EnvironmentType=1 AND d.ReportingFrequency <> 'Hourly' AND (t.WarmupFlag IS NULL OR t.WarmupFlag=0)
        AND d.Name IN (${names.map(() => "?").join(",")})`, names)) {
    const dt = str(at(r, 3)), day = /Summer/i.test(dt) ? "summer" as const : /Winter/i.test(dt) ? "winter" as const : null;
    if (!day) continue;
    const key = str(at(r, 0)), name = str(at(r, 1)), ti = num(at(r, 2)), w = num(at(r, 8));
    if (!when.has(ti)) { const h = num(at(r, 6)) - 1, mi = num(at(r, 7)); when.set(ti, { day, text: `${num(at(r, 4))}/${num(at(r, 5))} ${pad(mi === 60 ? h + 1 : h)}:${pad(mi % 60)}` }); }
    // the surface's OWN gain from the air (+ the air heats the face): the zone air's gain is its negative — the faces summed equal the
    // engine's Zone Air Heat Balance Surface Convection Rate (measured on this house, 2026-10-11)
    if (name === "Surface Inside Face Convection Heat Gain Rate") { const s = surf.get(key); if (s) put(s.zone, ti, s.group, -w); }
    else if (name.startsWith(ZB)) put(key, ti, name, w);
    else if (name === ERV_RATE_VARIABLES[0]) put(opts.ervZones?.get(key) ?? "", ti, BALANCE.erv, w);
    else if (name === ERV_RATE_VARIABLES[1]) put(opts.ervZones?.get(key) ?? "", ti, BALANCE.erv, -w);
    else if (opts.hpwhZones?.has(key)) put(opts.hpwhZones.get(key)!, ti, HPWH_COMPONENT, -w);
  }
  const out: ComponentLoad[] = [];
  for (const [zone, times] of [...by].sort((a, b) => a[0].localeCompare(b[0]))) {
    for (const kind of ["heating", "cooling"] as const) {
      const day = kind === "heating" ? "winter" : "summer";
      // the unit's supply: the zone equipment's, less the ERV's and the water heater's own effect on the air
      const unit = (m: Map<string, number>): number => (m.get(`${ZB}System Air Transfer Rate`) ?? 0) + (m.get(`${ZB}System Convective Heat Gain Rate`) ?? 0) - (m.get(BALANCE.erv) ?? 0) - (m.get(HPWH_COMPONENT) ?? 0);
      let best: [number, Map<string, number>] | null = null;
      for (const [ti, m] of times) {
        if (when.get(ti)?.day !== day || !m.has(`${ZB}System Air Transfer Rate`)) continue;
        if (!best || (kind === "heating" ? unit(m) > unit(best[1]) : unit(m) < unit(best[1]))) best = [ti, m];
      }
      if (!best) continue;
      const [ti, m] = best, supply = unit(m), time = when.get(ti)!.text;
      const sup = kind === "heating" ? supply : -supply;
      if (sup < NO_PEAK_W) { out.push({ zone, kind, component: "Grand Total", w: 0, time: "" }); continue; }
      const parts = new Map<string, number>();
      for (const [term, w] of m) {
        if (term === `${ZB}System Air Transfer Rate` || term === `${ZB}System Convective Heat Gain Rate`) continue;
        const name = term === `${ZB}Internal Convective Heat Gain Rate` ? BALANCE.internal : term === `${ZB}Outdoor Air Transfer Rate` ? BALANCE.infiltration
          : term === `${ZB}Interzone Air Transfer Rate` ? BALANCE.mixing : term === `${ZB}Air Energy Storage Rate` ? BALANCE.storage : term;
        parts.set(name, (parts.get(name) ?? 0) + (term === `${ZB}Air Energy Storage Rate` ? -w : w));
      }
      const total = -supply, residual = total - [...parts.values()].reduce((a, b) => a + b, 0);
      if (Math.abs(residual) >= 1) parts.set(BALANCE.residual, residual);
      for (const [component, w] of parts) if (Math.abs(w) >= 0.5) out.push({ zone, kind, component, w, time });
      out.push({ zone, kind, component: "Grand Total", w: total, time });
    }
  }
  return out;
}
/** the unit heater's run peak (2026-10-08): the variable the writer asks for, and the rows it is read into */
export const UH_PEAK_VARIABLE = "Heating Coil Heating Rate";
export const UH_PEAK_FIELD = "Peak Heating Rate in the Run", UH_PEAK_TIME_FIELD = "Time of the Peak in the Run";

/** the annual (Σ months) value of one variable per key — the paint's input */
export function annualByKey(series: SeriesValue[], name: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of series) {
    if (s.name !== name || s.month === 0) continue;
    out.set(s.key, (out.get(s.key) ?? 0) + s.value);
  }
  return out;
}

/** the zone a key names: an ideal-loads system is "<ZONE> IDEAL LOADS AIR SYSTEM" */
export function zoneOfKey(key: string): string {
  return key.replace(/ IDEAL LOADS AIR SYSTEM$/i, "");
}

export const J_PER_KWH = 3.6e6;
