// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE CFD CHECK — BOM › CFD's instrument, with no OpenFOAM and no building of anyone's: every part below gives the numbers the
// physics or the arithmetic gives by hand.
//
// 1 · A BOX WITH A KNOWN ANSWER, written here as an OpenFOAM ASCII case (4 × 3 × 3 m, 10 cm cells): plug flow at 0.1 m/s from an
//     inlet on one end to an outlet on the other, the temperature 20 °C + 1 K per metre of height, the age of air x / 0.1 s. The
//     reader, the assessment, the streamlines and cfd.db must give occupied mean 20.95 °C, speed 0.1 m/s, air-change
//     effectiveness 2.000, every streamline reaching the outlet, the seeds carrying the supply's cfm, mass balanced.
// 2 · THE PROCESSORS: the plan offered on a 30-core machine and on a 4-core one, from the measured scaling (cfdParallel.ts).
// 3 · TERMINALS PLACED BY HAND (for a model with no MEP file): an added terminal makes the same box as a file's terminal at the
//     same point and size; a grille on a slope keeps its size on the face.
//
//   pnpm cfd:check

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { getSql } from "../src/core/db.js";
import { loadCase, CFM_PER_M3S, type CaseFiles } from "../src/modules/cfd/core/caseLoad.js";
import { buildGrid } from "../src/modules/cfd/core/voxelGrid.js";
import { assess } from "../src/modules/cfd/core/cfdMetrics.js";
import { traceArrows } from "../src/modules/cfd/core/streamArrows.js";
import { importCase } from "../src/modules/cfd/pipeline.js";
import { openCfdDb, queryRuns, queryMetrics, queryArrows, querySlices, queryOpenings } from "../src/modules/cfd/core/cfdDb.js";

let failed = false;
const ok = (c: boolean, msg: string): void => { console.log(`  ${c ? "✓" : "✗"} ${msg}`); if (!c) failed = true; };
const nodeFiles = (dir: string): CaseFiles => ({
  read: async (rel) => readFileSync(path.join(dir, rel), "utf8"),
  list: async (rel) => readdirSync(path.join(dir, rel)),
  exists: async (rel) => existsSync(path.join(dir, rel)),
});
const SQL = await getSql((f) => path.join(path.dirname(createRequire(import.meta.url).resolve("sql.js")), f));

// ── 1 · the box ──────────────────────────────────────────────────────────────────────────────────────────────────
const box = path.join(os.tmpdir(), `bim-bem-bom-cfd-check-${process.pid}`);
rmSync(box, { recursive: true, force: true });
for (const d of ["constant/polyMesh", "100"]) mkdirSync(path.join(box, d), { recursive: true });
const H = 0.1, NX = 40, NY = 30, NZ = 30, U0 = 0.1, RHO0 = 1.2;
const hdr = (cls: string, obj: string): string => `FoamFile\n{\n    version     2.0;\n    format      ascii;\n    class       ${cls};\n    object      ${obj};\n}\n`;
const pid = (i: number, j: number, k: number): number => (i * (NY + 1) + j) * (NZ + 1) + k;
const pts: string[] = [];
for (let i = 0; i <= NX; i++) for (let j = 0; j <= NY; j++) for (let k = 0; k <= NZ; k++) pts.push(`(${(i * H).toFixed(4)} ${(j * H).toFixed(4)} ${(k * H).toFixed(4)})`);
writeFileSync(path.join(box, "constant/polyMesh/points"), `${hdr("vectorField", "points")}\n${pts.length}\n(\n${pts.join("\n")}\n)\n`);
// the boundary faces only, each in right-hand order about its OUTWARD normal: inlet x = 0 (−x), outlet x = 4 (+x), floor y = 0 (−y)
const faces: string[] = [];
for (let j = 0; j < NY; j++) for (let k = 0; k < NZ; k++) faces.push(`4(${pid(0, j, k)} ${pid(0, j, k + 1)} ${pid(0, j + 1, k + 1)} ${pid(0, j + 1, k)})`);
for (let j = 0; j < NY; j++) for (let k = 0; k < NZ; k++) faces.push(`4(${pid(NX, j, k)} ${pid(NX, j + 1, k)} ${pid(NX, j + 1, k + 1)} ${pid(NX, j, k + 1)})`);
for (let i = 0; i < NX; i++) for (let k = 0; k < NZ; k++) faces.push(`4(${pid(i, 0, k)} ${pid(i + 1, 0, k)} ${pid(i + 1, 0, k + 1)} ${pid(i, 0, k + 1)})`);
writeFileSync(path.join(box, "constant/polyMesh/faces"), `${hdr("faceList", "faces")}\n${faces.length}\n(\n${faces.join("\n")}\n)\n`);
const nIn = NY * NZ, nFloor = NX * NZ;
writeFileSync(path.join(box, "constant/polyMesh/boundary"), `${hdr("polyBoundaryMesh", "boundary")}\n3\n(\n    inlet\n    {\n        type            patch;\n        nFaces          ${nIn};\n        startFace       0;\n    }\n    outlet\n    {\n        type            patch;\n        nFaces          ${nIn};\n        startFace       ${nIn};\n    }\n    floor\n    {\n        type            wall;\n        nFaces          ${nFloor};\n        startFace       ${2 * nIn};\n    }\n)\n`);
writeFileSync(path.join(box, "constant/thermophysicalProperties"), `${hdr("dictionary", "thermophysicalProperties")}\nmixture { equationOfState { rho0 ${RHO0}; T0 293.15; beta 3.4e-03; } }\n`);
const cells = NX * NY * NZ;
const C: string[] = [], T: string[] = [], Uv: string[] = [], age: string[] = [], V: string[] = [];
for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) for (let k = 0; k < NZ; k++) {
  const x = (i + 0.5) * H, y = (j + 0.5) * H, z = (k + 0.5) * H;
  C.push(`(${x} ${y} ${z})`); T.push(`${293.15 + y}`); Uv.push(`(${U0} 0 0)`); age.push(`${x / U0}`); V.push(`${H ** 3}`);
}
const field = (cls: string, obj: string, kind: string, vals: string[], bf: string): string => `${hdr(cls, obj)}\ninternalField   nonuniform List<${kind}> \n${vals.length}\n(\n${vals.join("\n")}\n)\n;\nboundaryField\n{\n${bf}\n}\n`;
const none = "    inlet { type calculated; }\n    outlet { type calculated; }\n    floor { type calculated; }";
writeFileSync(path.join(box, "100/C"), field("volVectorField", "C", "vector", C, none));
writeFileSync(path.join(box, "100/V"), field("volScalarField::Internal", "V", "scalar", V, ""));
writeFileSync(path.join(box, "100/T"), field("volScalarField", "T", "scalar", T, "    inlet { type fixedValue; value uniform 293.15; }\n    outlet { type zeroGradient; value uniform 293.15; }\n    floor { type fixedValue; value uniform 293.15; }"));
writeFileSync(path.join(box, "100/U"), field("volVectorField", "U", "vector", Uv, none));
writeFileSync(path.join(box, "100/age"), field("volScalarField", "age", "scalar", age, none));
writeFileSync(path.join(box, "100/k"), field("volScalarField", "k", "scalar", Array(cells).fill("0"), none));
const A = H * H, phiIn = Array(nIn).fill(`${-RHO0 * U0 * A}`), phiOut = Array(nIn).fill(`${RHO0 * U0 * A}`);
writeFileSync(path.join(box, "100/phi"), `${hdr("surfaceScalarField", "phi")}\ninternalField nonuniform List<scalar> 0();\nboundaryField\n{\n    inlet\n    {\n        type calculated;\n        value nonuniform List<scalar> ${nIn}\n(\n${phiIn.join("\n")}\n)\n;\n    }\n    outlet\n    {\n        type calculated;\n        value nonuniform List<scalar> ${nIn}\n(\n${phiOut.join("\n")}\n)\n;\n    }\n    floor\n    {\n        type calculated;\n        value uniform 0;\n    }\n}\n`);
writeFileSync(path.join(box, "case.json"), JSON.stringify({ peak: "heating", time: "gate", setpoint_c: 21 }));

console.log("CFD · THE BOX (4 × 3 × 3 m, 10 cm cells, plug flow 0.1 m/s, T = 20 °C + 1 K/m, age = x / 0.1 s):");
const c = await loadCase(nodeFiles(box));
ok(c.cells === cells && c.time === "100", `the reader: ${c.cells} cells at time ${c.time}, ${c.openings.length} openings (${c.openings.map((o) => `${o.name} ${o.dir} ${(o.m3s * CFM_PER_M3S).toFixed(1)} cfm`).join(", ")}), ${c.walls.length} wall patch`);
const Q = U0 * NY * NZ * H * H;
ok(Math.abs(c.openings.find((o) => o.name === "inlet")!.m3s - Q) < 1e-9 && c.openings.find((o) => o.name === "inlet")!.dir === "in", `the inlet's flow ${Q.toFixed(3)} m³/s = U × A, read from phi ÷ ρ`);
const g = buildGrid(c);
const a = assess(c, g, { setpointC: 21 });
const m = (k: string): number => a.metrics.find((x) => x.key === k)!.value;
// by hand: the occupied cells have centres 0.15 … 1.75 m up → mean height 0.95 m → 20.95 °C; plug flow → mean age over a
// zone symmetric about the room's middle = 2.0 m / 0.1 m/s = 20 s; V/Q = 36 / 0.9 = 40 s → ACE 2
ok(Math.abs(m("occupied_mean_c") - 20.95) < 1e-6, `occupied mean ${m("occupied_mean_c").toFixed(4)} °C = 20.95 by hand`);
ok(Math.abs(m("speed_mean_ms") - U0) < 1e-9 && Math.abs(m("speed_p95_ms") - U0) < 1e-9, `occupied speed mean ${m("speed_mean_ms")} · p95 ${m("speed_p95_ms")} m/s = the plug flow's`);
ok(Math.abs(m("tau_nominal_s") - 40) < 1e-6 && Math.abs(m("ace_occupied") - 2) < 1e-6, `nominal time constant ${m("tau_nominal_s").toFixed(3)} s · air-change effectiveness ${m("ace_occupied").toFixed(4)} = 2 by hand`);
ok(Math.abs(m("mass_balance_pct")) < 1e-9, `mass out − in ${m("mass_balance_pct").toExponential(1)} %`);
ok(Math.abs(m("head_1_1_c") - 21.05) < 1e-6, `head band (1.05–1.15 m): ${m("head_1_1_c").toFixed(4)} °C = the cells at 1.05 m, by hand`);
const s = traceArrows(c, g);
const maxBin = Math.max(...s.arrows.map((x) => x.cfm));
ok(s.ends.out === s.lines && Math.abs(s.seededCfm - s.supplyCfm) < 1e-6, `${s.lines} streamlines, ${s.ends.out} reach the outlet (${JSON.stringify(s.ends)}) · seeds ${s.seededCfm.toFixed(2)} cfm = supply ${s.supplyCfm.toFixed(2)} cfm`);
ok(Math.abs((s.reached.outlet ?? 0) - s.supplyCfm) < 1e-6, `the outlet reached by ${(s.reached.outlet ?? 0).toFixed(2)} cfm = all the supply`);
const offAxis = s.arrows.filter((x) => !(Math.abs(x.speed - U0) < 1e-6 && x.dx > 0.999));
if (offAxis.length) console.log(`    off the plug flow: ${offAxis.slice(0, 3).map((x) => JSON.stringify(x)).join(" · ")}`);
ok(maxBin <= s.supplyCfm + 1e-6 && !offAxis.length, `${s.arrows.length} arrows · the thickest ${maxBin.toFixed(1)} cfm ≤ the supply · every arrow 0.1 m/s along +x`);
// cfd.db: write, export, reopen, read back
const db = openCfdDb(SQL, null);
const r = await importCase(db, nodeFiles(box), { space: "Gate box", peak: "heating", stamp: "2026-11-04T00:00:00Z", caseDir: box });
const back = openCfdDb(SQL, db.export());
const runs = queryRuns(back);
ok(runs.length === 1 && runs[0]!.space === "Gate box" && queryArrows(back, r.runId).length === r.arrows && queryMetrics(back, r.runId).length === r.metrics.length + 2
  && querySlices(back, r.runId).length === 3 && queryOpenings(back, r.runId).length === 2,
  `cfd.db round trip: 1 run, ${r.arrows} arrows, ${r.metrics.length + 2} metrics, 3 slices, 2 openings read back`);
const sl = querySlices(back, r.runId).find((x) => x.plane === "plan 1.1 m")!;
// the grid holds each CELL's value (a voxel is the mean of the cells covering it): the plan at 1.125 m reads the cell 1.1–1.2 m
const cellY = (Math.floor(sl.at / H) + 0.5) * H;
ok(Math.abs(sl.T[Math.floor(sl.nv / 2) * sl.nu + Math.floor(sl.nu / 2)]! - (20 + cellY)) < 1e-4, `the 1.1 m plan (voxel row at ${sl.at.toFixed(3)} m) reads the cell centred ${cellY.toFixed(2)} m: ${(20 + cellY).toFixed(2)} °C, stored as float32`);
db.close(); back.close();

// ── 2 · the processors ───────────────────────────────────────────────────────────────────────────────────────────
{
  const { planRuns, stepsFor, decomposeParDict, speedup, usableCores, BED1_CELLS } = await import("../src/modules/cfd/core/cfdParallel.js");
  const { RUN_STEPS } = await import("../src/modules/cfd/core/cfdCase.js");
  console.log("CFD · THE PROCESSORS (the plan from the measured scaling of a 110 m³ bedroom on a 30-core Mac):");
  const mac30 = { platform: "darwin", cores: 30, performance: 10, efficiency: 20, memGB: 96 };
  const job = (k: string, cells = BED1_CELLS) => ({ key: k, cells, iterations: 11000 });
  const one = planRuns(mac30, [job("a")]), two = planRuns(mac30, [job("h"), job("c")]), six = planRuns(mac30, ["1", "2", "3", "4", "5", "6"].map((k) => job(k)));
  ok(usableCores(mac30) === 28 && one.procs === 28 && one.slots === 1, `one room: ${one.procs} processes of ${mac30.cores} cores (2 left to the app) — about ${(one.seconds / 60).toFixed(1)} min at 11,000 iterations, ${speedup(28).toFixed(1)}× serial`);
  ok(two.slots === 2 && two.procs === 14, `two peaks: ${two.slots} side by side × ${two.procs} processes (measured 2 × 14 = 31.3 room-iterations a second against 27.8 one after the other)`);
  ok(six.slots === 4 && six.procs === 7 && six.jobs.filter((j) => j.slot === 0).length === 2, `six rooms: ${six.slots} at a time × ${six.procs} processes (the measured best, 4 × 7), list-scheduled — about ${(six.seconds / 60).toFixed(0)} min`);
  const small = planRuns(mac30, [job("tiny", 30000)]);
  ok(small.jobs[0]!.procs === 3, `a 30,000-cell room splits only ${small.jobs[0]!.procs} ways (10,000 cells a process at the least)`);
  const laptop = { platform: "linux", cores: 4, performance: null, efficiency: null, memGB: 16 };
  const lap = planRuns(laptop, [job("h"), job("c")]);
  ok(usableCores(laptop) === 3 && lap.slots === 1 && lap.procs === 3 && lap.notes.some((n) => /one at a time/.test(n)), `a 4-core machine: ${lap.slots} at a time × ${lap.procs} processes — ${lap.notes.join("; ")}`);
  const st = stepsFor(RUN_STEPS, 8), serial = stepsFor(RUN_STEPS, 1);
  ok(serial.map((x) => x.cmd).join("|") === RUN_STEPS.map((x) => x.cmd).join("|") && !st.some((x) => x.cmd === "buoyantSimpleFoam") && st.some((x) => x.cmd === "mpirun -np 8 buoyantSimpleFoam -parallel") && st.some((x) => /^reconstructPar -latestTime/.test(x.cmd)) && st.length === RUN_STEPS.length + 2,
    `the steps at 8: ${st.map((x) => x.cmd.split(" ")[0]).join(" → ")} · serial unchanged`);
  ok([...st, ...serial].every((x) => !/[*?[]/.test(x.cmd)), `no step carries a filename wildcard (OpenFOAM.app's shell dies of one: \`echo p*\` alone, 2026-11-04)`);
  ok(/numberOfSubdomains 8;/.test(decomposeParDict(8)) && /method scotch;/.test(decomposeParDict(8)), `decomposeParDict: scotch, 8 subdomains`);
}

// ── 3 · terminals placed by hand ─────────────────────────────────────────────────────────────────────────────────
{
  const { terminalBox } = await import("../src/modules/cfd/core/cfdPrep.js");
  const { addedAsOffer } = await import("../src/modules/cfd/core/cfdChoices.js");
  console.log("CFD · TERMINALS PLACED BY HAND:");
  const IN = 0.0254;
  // a 4 × 3 × 3 m room's floor (outward normal down) and a wall (x = 0, normal −x)
  const room = [
    { n: [0, -1, 0] as [number, number, number], outer: [[0, 0, 0], [0, 0, 3], [4, 0, 3], [4, 0, 0]] as Array<[number, number, number]>, areaM2: 12 },
    { n: [-1, 0, 0] as [number, number, number], outer: [[0, 0, 0], [0, 3, 0], [0, 3, 3], [0, 0, 3]] as Array<[number, number, number]>, areaM2: 9 },
  ];
  const size: [number, number] = [12 * IN, 6 * IN];
  for (const [face, host, c] of [[0, "floor", [1.2, 0, 2.5]], [1, "wall", [0, 0.3, 1.5]]] as Array<[number, "floor" | "wall", [number, number, number]]>) {
    const file = terminalBox({ id: 1, name: "f", globalId: null, system: null, guess: null, bbLo: c, bbHi: c, face, axis: face === 0 ? 1 : 0, plane: room[face]!.outer[0]![face === 0 ? 1 : 0], size, offFace: 0, candidates: [] }, size, [0, 0, 0], room, face);
    const hand = terminalBox(addedAsOffer({ id: "a1", label: "by hand", host, face, c, size, role: "supply", cfm: 150, use: true }, room), size, [0, 0, 0], room, face);
    const same = [0, 1, 2].every((i) => Math.abs(file.lo[i]! - hand.lo[i]!) < 1e-12 && Math.abs(file.hi[i]! - hand.hi[i]!) < 1e-12);
    ok(same, `a ${host} terminal added by hand at (${c.join(", ")}) makes the same box as the MEP file's at that point and size`);
  }
  // A GRILLE ON A SLOPE: its size is on the face; its plan footprint is projected — an 18 in grille on a 3-in-4 slope
  const slope = [{ n: [0, 0.8, 0.6] as [number, number, number], outer: [[0, 3, 0], [4, 3, 0], [4, 0, 4], [0, 0, 4]] as Array<[number, number, number]>, areaM2: 20 }];
  const g = 18 * IN, sb = terminalBox({ id: 1, name: "r", globalId: null, system: null, guess: null, bbLo: [2, 1.5, 2], bbHi: [2, 1.5, 2], face: 0, axis: 1, plane: 1.5, size: [g, g], offFace: 0, candidates: [] }, [g, g], [0, 0, 0], slope, 0);
  const fx = sb.hi[0] - sb.lo[0], fz = sb.hi[2] - sb.lo[2];
  ok(Math.abs(fx - g) < 1e-9 && Math.abs(fz - g * 0.8) < 1e-9, `a grille on a slope: 18 in on the face → plan ${(fx / IN).toFixed(2)} in across, ${(fz / IN).toFixed(2)} in along the slope (18 × cos 36.9° = 14.40)`);
}

rmSync(box, { recursive: true, force: true });
console.log(failed ? "cfd:check ✗ FAILED" : "cfd:check ✓ ok");
process.exit(failed ? 1 : 0);
