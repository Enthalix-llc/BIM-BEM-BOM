// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE AIR SOLVER ON MANY CORES (the user, 2026-11-04): the machine the app runs on is read (its cores, its performance and
// efficiency cores where the OS names them, its memory), and a plan is offered — ONE room split across processors (OpenFOAM's
// decomposePar + mpirun … -parallel + reconstructPar), or SEVERAL rooms run side by side, each on a share of the cores. The plan
// is a suggestion the dialog shows and the user may change; nothing here runs anything.
//
// Every constant is a MEASUREMENT, on the M5 Ultra (30 cores: 10 performance + 20 efficiency, 96 GB), Bed 1 heating
// (325,324 cells), 300 iterations each, 2026-11-04 — stated as such wherever it is shown:
//   one room:   s/iteration 1 → 0.380 · 2 → 0.200 · 4 → 0.112 · 8 → 0.068 · 10 → 0.056 · 12 → 0.052 · 16 → 0.048 · 20 → 0.044 ·
//               24 → 0.040 · 28 → 0.036 (10.6×); 10 processes against serial at 1,000 iterations: the occupied mean −0.005 K,
//               age −2 s, ACE +0.003 — the same answer
//   side by side: 2 × 14 → 0.064 s/it each · 3 × 8 → 0.091 · 4 × 7 → 0.115 · 3 × 10 (all 30 cores) → 0.108; room-iterations a
//               second 31.3 · 33.0 · 34.8 · 27.8 against 27.8 for one room on 28 — four rooms on 7 each did the most work, and
//               filling every core was no faster than leaving two to the app and the OS
//   memory:     0.73 GB peak for the serial solve (≈ 2.3 kB a cell)

export interface Machine {
  platform: string;
  /** physical cores (Open MPI places one process per core by default) */
  cores: number;
  /** the performance / efficiency split where the OS states it (macOS hw.perflevel0/1), else null */
  performance: number | null;
  efficiency: number | null;
  memGB: number;
}

/** s/iteration of Bed 1 by process count, one room alone (measured — see the header) */
export const BED1_SCALING: ReadonlyArray<readonly [number, number]> = [
  [1, 0.38], [2, 0.2], [4, 0.112], [8, 0.068], [10, 0.056], [12, 0.052], [16, 0.048], [20, 0.044], [24, 0.04], [28, 0.036],
];
export const BED1_CELLS = 325324;
/** the serial rate the estimate scales by cells */
export const SEC_PER_ITER_PER_CELL = 0.38 / BED1_CELLS;
/** each concurrent run slowed by this much against the same process count alone (measured: 2 × 14 · 3 × 8 · 4 × 7) */
const CONTENTION: Record<number, number> = { 1: 1, 2: 1.28, 3: 1.34, 4: 1.46 };
/** the processes a room was given in the best batch measured (4 × 7 on 28) */
export const BATCH_PROCS = 7;
/** below this many cells a process, a split stops paying (Bed 1 still gained at 11,600 a process on 28) */
export const MIN_CELLS_PER_PROC = 10000;
/** the serial solve's peak memory a cell (0.73 GB / 325,324) and an allowance a process for the parallel copies (an estimate) */
const GB_PER_CELL = 0.73 / BED1_CELLS, GB_PER_PROC = 0.15;
/** the share of memory a plan may take */
const MEM_SHARE = 0.6;

/** the cores left to the app and the OS — measured: all 30 busy was no faster than 28 */
export const reserved = (m: Machine): number => (m.cores >= 8 ? 2 : m.cores >= 3 ? 1 : 0);
export const usableCores = (m: Machine): number => Math.max(1, m.cores - reserved(m));

/** the speed-up at n processes, from Bed 1's curve (linear between the measured points; flat past the last) */
export function speedup(n: number): number {
  const t = BED1_SCALING;
  if (n <= 1) return 1;
  for (let i = 1; i < t.length; i++) {
    const [n1, s1] = t[i]!, [n0, s0] = t[i - 1]!;
    if (n <= n1) return t[0]![1] / (s0 + ((s1 - s0) * (n - n0)) / (n1 - n0));
  }
  return t[0]![1] / t[t.length - 1]![1];
}
export const contention = (slots: number): number => CONTENTION[slots] ?? CONTENTION[4]! + 0.12 * (slots - 4);
export const memoryGB = (cells: number, procs: number): number => cells * GB_PER_CELL + (procs > 1 ? procs * GB_PER_PROC : 0);

export interface Job { key: string; cells: number; iterations: number }
export interface Placed { key: string; procs: number; slot: number; seconds: number }
export interface Plan {
  slots: number;
  procs: number;
  jobs: Placed[];
  /** the batch's wall time, the jobs list-scheduled over the slots in order */
  seconds: number;
  memGB: number;
  notes: string[];
}

/** a job's time at n processes with `slots` runs going at once: the solve scaled from Bed 1, plus the mesh (16.6 s at Bed 1's
 *  size) and the split and rejoin (≈ 6 s) */
export function jobSeconds(j: Job, procs: number, slots: number, factor = 1): number {
  const solve = (j.iterations * j.cells * SEC_PER_ITER_PER_CELL) / speedup(procs) * (slots > 1 ? contention(slots) : 1);
  return factor * (solve + 16.6 * (j.cells / BED1_CELLS) + (procs > 1 ? 6 : 0));
}

/** THIS MACHINE'S OWN TIMES (2026-11-10): every run the app finishes is a measurement — its wall time against the Bed 1
 *  estimate for the same cells, processes and runs side by side. The median of the latest ratios corrects every estimate after,
 *  so the times offered come true on whatever machine runs the app; until a run has finished they are Bed 1's on the M5 Ultra. */
export interface Timing { at: string; ratio: number; procs: number; cells: number }
export function machineFactor(ts: readonly Timing[]): { factor: number; runs: number } {
  const r = ts.slice(-7).map((t) => t.ratio).filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!r.length) return { factor: 1, runs: 0 };
  const mid = r.length >> 1;
  return { factor: r.length % 2 ? r[mid]! : (r[mid - 1]! + r[mid]!) / 2, runs: r.length };
}

/** THE CHOICES, side by side (the user, 2026-11-10): each a share of processes per run, with what it means for these jobs —
 *  how many at a time and about how long; the suggestion marked. Shares: every usable core, half, the measured best batch share
 *  (7), 4, 2, and one (serial). */
export interface PlanOption { procs: number; plan: Plan; suggested: boolean; words: string }
export function planOptions(m: Machine, jobs: Job[], factor = 1): PlanOption[] {
  if (!jobs.length) return [];
  const usable = usableCores(m), suggested = planRuns(m, jobs, undefined, factor);
  const shares = [...new Set([usable, Math.ceil(usable / 2), BATCH_PROCS, 4, 2, 1, suggested.procs].filter((n) => n >= 1 && n <= usable))].sort((a, b) => b - a);
  const out = shares.map((n) => {
    const plan = n === suggested.procs ? suggested : planRuns(m, jobs, n, factor);
    const what = jobs.length === 1 ? (n === 1 ? "serial — one process" : `the room split ${n} ways`) : plan.slots > 1 ? `${plan.slots} at a time × ${n} process${n === 1 ? "" : "es"}` : `one at a time × ${n} process${n === 1 ? "" : "es"}`;
    return { procs: n, plan, suggested: n === suggested.procs, words: what };
  });
  return out;
}

/** the processes worth giving one room alone: every usable core, unless the room is too small to split that far */
export const soloProcs = (m: Machine, cells: number): number => Math.max(1, Math.min(usableCores(m), Math.floor(cells / MIN_CELLS_PER_PROC)));

/** the suggestion: one job → split across the usable cores; several → as many side by side as BATCH_PROCS-sized shares fit,
 *  each on an equal share; `procs` given (the user's own) overrides the share */
export function planRuns(m: Machine, jobs: Job[], procs?: number, factor = 1): Plan {
  const usable = usableCores(m), notes: string[] = [];
  if (!jobs.length) return { slots: 0, procs: 0, jobs: [], seconds: 0, memGB: 0, notes };
  let slots = jobs.length === 1 ? 1 : Math.max(1, Math.min(jobs.length, Math.floor(usable / BATCH_PROCS)));
  let share = procs != null ? Math.max(1, Math.min(usable, Math.round(procs))) : Math.max(1, Math.floor(usable / slots));
  if (procs != null && jobs.length > 1) slots = Math.max(1, Math.min(jobs.length, Math.floor(usable / share)));
  // memory: the runs going at once must fit in MEM_SHARE of the machine; fewer side by side when they do not
  const biggest = Math.max(...jobs.map((j) => j.cells));
  while (slots > 1 && slots * memoryGB(biggest, share) > MEM_SHARE * m.memGB) { slots--; notes.push(`fewer rooms at once: ${slots + 1} would need ${(Math.ceil((slots + 1) * memoryGB(biggest, share) * 10) / 10)} GB of ${m.memGB} GB`); }
  if (memoryGB(biggest, share) > MEM_SHARE * m.memGB) notes.push(`the largest room needs about ${memoryGB(biggest, share).toFixed(1)} GB — more than ${Math.round(MEM_SHARE * 100)} % of this machine's ${m.memGB} GB`);
  const end = new Array<number>(slots).fill(0);
  const placed: Placed[] = jobs.map((j) => {
    const p = Math.max(1, Math.min(share, Math.floor(j.cells / MIN_CELLS_PER_PROC) || 1));
    const s = end.indexOf(Math.min(...end));
    const sec = jobSeconds(j, p, Math.min(slots, jobs.length), factor);
    end[s] = end[s]! + sec;
    return { key: j.key, procs: p, slot: s, seconds: sec };
  });
  if (jobs.length > 1 && slots === 1) notes.push(procs != null ? `one at a time: ${share} processes each leave no room for a second run in ${usable} usable cores` : `one at a time: ${usable} usable cores give no room a share of ${BATCH_PROCS}`);
  return { slots, procs: share, jobs: placed, seconds: Math.max(...end), memGB: Math.round(slots * memoryGB(biggest, share) * 10) / 10, notes };
}

/** OpenFOAM's split of the mesh: scotch needs no geometry from us */
export const decomposeParDict = (n: number): string =>
  `FoamFile { version 2.0; format ascii; class dictionary; object decomposeParDict; }\nnumberOfSubdomains ${n};\nmethod scotch;\n`;

/** the case's steps at n processes: the solve split, run under MPI, joined back, the processor folders removed — the rest as
 *  the serial steps (the reader reads the joined time folder) */
export function stepsFor<S extends { label: string; cmd: string }>(steps: readonly S[], n: number): Array<{ label: string; cmd: string }> {
  if (n <= 1) return steps.map((s) => ({ label: s.label, cmd: s.cmd }));
  return steps.flatMap((s) => s.cmd === "buoyantSimpleFoam"
    ? [
      { label: "the mesh split", cmd: "decomposePar -force" },
      { label: "the solve", cmd: `mpirun -np ${n} buoyantSimpleFoam -parallel` },
      // the processor folders by NAME: OpenFOAM.app's shell (bash 5.2.37, LANG C.UTF-8) dies of a segmentation fault on any
      // filename wildcard — `echo p*` alone kills it (measured 2026-11-04) — so no step may carry a glob
      { label: "the result joined", cmd: `reconstructPar -latestTime && rm -rf ${Array.from({ length: n }, (_, i) => `processor${i}`).join(" ")}` },
    ]
    : [{ label: s.label, cmd: s.cmd }]);
}

/** the machine in words, for the dialog */
export function machineLine(m: Machine): string {
  const split = m.performance != null && m.efficiency != null ? ` (${m.performance} performance + ${m.efficiency} efficiency)` : "";
  return `${m.cores} cores${split} · ${m.memGB} GB · ${usableCores(m)} used for CFD, ${reserved(m)} left to the app`;
}
