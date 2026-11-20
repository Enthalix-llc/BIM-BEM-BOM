// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE RUN RECORD (the user's plan, 2026-11-17, built 2026-11-20): idf.db holds only the model in force and bem.db keeps a run's
// results only beside the model of the moment, while data/ is derived and left out of every backup. So each run leaves a small
// record in the project folder that survives all of that — <project>/record/<stamp>/: the IDF the engine ran (in.idf), its tables
// (eplustbl.csv), its messages (eplusout.err) and this summary, about 2 MB of text a run. A past model and its results can then be
// reviewed, compared and backed up long after the derived files have moved on. Pure: the main process copies the three files and
// writes the JSON this returns.

import type { BemRun } from "./bemDb.js";
import type { RunResults } from "./eplusSql.js";

/** the run folder's files a record keeps, beside summary.json */
export const RECORD_FILES = ["in.idf", "eplustbl.csv", "eplusout.err"] as const;

export interface RunRecordContext {
  /** idf.db's content sha — the model definition the run was built from */
  idfContentSha256?: string | null;
  /** the IFC's sha the model was built from */
  ifcSha256?: string | null;
  /** when the BEM rulings in force were last saved */
  ledgerSavedAt?: string | null;
  /** the project's name */
  project?: string | null;
}

const kwh = (v: number): number => Math.round(v * 10) / 10;

/** what summary.json holds: the run, what it was built from, and its results in the engine's own words (kWh, W, hours) */
export function runSummary(run: BemRun, results: RunResults | null, ctx: RunRecordContext = {}): Record<string, unknown> {
  const fuels: Record<string, Record<string, number>> = {};
  const units: Record<string, string> = {};
  for (const c of results?.endUses ?? []) {
    (fuels[c.fuel] ??= {})[c.row] = kwh(c.value);
    units[c.fuel] = c.units;
  }
  const f = results?.facility, p = results?.facilityPeak;
  return {
    format: "BIM-BEM-BOM run record 1",
    project: ctx.project ?? null,
    stamp: run.stamp,
    kind: run.kind ?? "design",
    engine: run.energyplusVersion,
    weather: run.epw ? run.epw.split(/[\\/]/).pop() : null,
    verdict: { exitCode: run.exitCode, completed: run.completed, fatal: run.fatal, severe: run.severe, warning: run.warning, seconds: run.seconds },
    builtFrom: { modelSha256: run.modelSha256 ?? null, idfContentSha256: ctx.idfContentSha256 ?? null, ifcSha256: ctx.ifcSha256 ?? null, ledgerSavedAt: ctx.ledgerSavedAt ?? null },
    facility: f ? { heatingKwh: kwh(f.heatingKwh), coolingKwh: kwh(f.coolingKwh), conditionedAreaM2: f.conditionedAreaM2, totalAreaM2: f.totalAreaM2,
      unmetHeatingH: f.unmetHeatingH, unmetCoolingH: f.unmetCoolingH } : null,
    peak: p ? { heatingW: p.heatingW, heatingTime: p.heatingTime, coolingW: p.coolingW, coolingTime: p.coolingTime } : null,
    endUsesByFuel: fuels,
    endUseUnits: units,
  };
}
