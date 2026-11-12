// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// A FINISHED CASE → ONE RUN IN cfd.db: load the case's own files, put it on the grid, assess the room, trace the
// supply air, and write the snapshot. The same function serves the app (files over IPC) and the gate (node fs).

import type { Database } from "sql.js";
import { loadCase, CFM_PER_M3S, type CaseFiles } from "./core/caseLoad.js";
import { buildGrid } from "./core/voxelGrid.js";
import { assess } from "./core/cfdMetrics.js";
import { traceArrows } from "./core/streamArrows.js";
import { writeArrows, writeMetrics, writeOpenings, writeRunRow, writeSlices, writeWalls } from "./core/cfdDb.js";

export interface ImportMeta {
  space: string; peak: "heating" | "cooling"; stamp: string; caseDir: string;
  seconds?: number | null; solver?: string | null; sourceIfcSha256?: string | null; sourceIdfSha256?: string | null; bemRun?: string | null;
}

export async function importCase(db: Database, files: CaseFiles, meta: ImportMeta, progress?: (s: string) => void) {
  const c = await loadCase(files, progress);
  progress?.("putting the cells on a 5 cm grid");
  const g = buildGrid(c);
  progress?.("assessing the occupied zone");
  const setpoint = typeof c.info.setpoint_c === "number" ? c.info.setpoint_c : undefined;
  const a = assess(c, g, { setpointC: setpoint });
  progress?.("tracing the supply air");
  const s = traceArrows(c, g);
  const id = writeRunRow(db, {
    stamp: meta.stamp, space: meta.space, peak: meta.peak, designHour: typeof c.info.time === "string" ? c.info.time : null, status: "done",
    iteration: c.time, averaged: c.averaged, cells: c.cells, seconds: meta.seconds ?? null, solver: meta.solver ?? null, caseDir: meta.caseDir,
    settings: c.info, sourceIfcSha256: meta.sourceIfcSha256, sourceIdfSha256: meta.sourceIdfSha256, bemRun: meta.bemRun,
    lines: s.lines, ends: s.ends, arrowParams: s.params, speedHist: a.speedHist,
  });
  writeMetrics(db, id, [
    ...a.metrics,
    { key: "lines", group: "flows", label: "streamlines traced from the supply", value: s.lines, unit: "", verdict: null, limit: null },
    { key: "lines_out_pct", group: "flows", label: "of them reaching an outlet within 40 m", value: (100 * s.ends.out) / s.lines, unit: "%", verdict: null, limit: null },
  ]);
  writeOpenings(db, id, c.openings.map((o) => {
    const lo: [number, number, number] = [Infinity, Infinity, Infinity], hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    let cx = 0, cy = 0, cz = 0, A = 0;
    for (let j = 0; j < o.areas.length; j++) {
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, o.centres[3 * j + k]!); hi[k] = Math.max(hi[k]!, o.centres[3 * j + k]!); }
      cx += o.centres[3 * j]! * o.areas[j]!; cy += o.centres[3 * j + 1]! * o.areas[j]!; cz += o.centres[3 * j + 2]! * o.areas[j]!; A += o.areas[j]!;
    }
    return { name: o.name, dir: o.dir, cfm: o.m3s * CFM_PER_M3S, tC: o.tC, c: [cx / A, cy / A, cz / A], area: A, lo, hi, reachedCfm: o.dir === "out" ? s.reached[o.name] ?? 0 : null };
  }));
  writeWalls(db, id, c.walls);
  writeArrows(db, id, s.arrows);
  writeSlices(db, id, a.slices);
  return { runId: id, cells: c.cells, arrows: s.arrows.length, lines: s.lines, ends: s.ends, supplyCfm: s.supplyCfm, seededCfm: s.seededCfm, metrics: a.metrics };
}
