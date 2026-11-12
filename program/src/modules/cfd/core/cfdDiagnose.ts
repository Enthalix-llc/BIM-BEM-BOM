// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// WHY A CFD RUN FAILED, AND WHAT TO DO (the user, 2026-11-10: "Can we provide the user assistance with identifying the error
// cause and how to remedy?"): the failed step's own OpenFOAM log is read and matched against the failures known — each a cause
// in words, whose it is to fix (the user's choices in Run CFD…, the room in BIM, this machine, or the program), and the remedy.
// A failure no rule knows is still shown: OpenFOAM's own FATAL ERROR lines, never a guess.

export type FixBy = "you" | "the room" | "this machine" | "the program";
export interface Diagnosis { cause: string; remedy: string; by: FixBy; excerpt: string[] }

interface Rule { test: RegExp; diag: (m: RegExpMatchArray, log: string, files: Record<string, string>) => Omit<Diagnosis, "excerpt"> }

/** the case file and line an OpenFOAM IO error names */
export function fileNamed(log: string): { file: string; line: number } | null {
  const m = /file: (\S+) at line (\d+)/.exec(log);
  return m ? { file: m[1]!, line: +m[2]! } : null;
}

const RULES: Rule[] = [
  {
    // the openings check (cfdCase RUN_STEPS) — or, before it existed, the solver's crash on an inlet with no area
    test: /OPENING WITH NO FACES: (\S+)|flowRateInletVelocityFvPatch/,
    diag: (m, log) => {
      const names = [...log.matchAll(/OPENING WITH NO FACES: (\S+)/g)].map((x) => x[1]!);
      return {
        by: "you",
        cause: `${names.length ? names.join(", ") : "a supply terminal"} came out with no faces in the mesh — the terminal's box does not touch the room's surface, so its opening has no area${names.length ? "" : " and the solver divided by zero"}`,
        remedy: "in CFD · SETUP: move it onto its face (TERMINALS › on, or drag it on the plan), check it is not past a wall (red on the plan), or switch it off; then run again",
      };
    },
  },
  {
    // a dictionary the program wrote that OpenFOAM cannot parse (the Great room, 2026-11-10: a name starting with a digit)
    test: /FOAM FATAL IO ERROR[\s\S]*?\n(.*while reading.*|.*found on line \d+.*)[\s\S]*?file: (\S+)/,
    diag: (m, log, files) => {
      // OpenFOAM reads a leading digit as a number and quotes the rest, so the name is checked on the line itself
      const at = fileNamed(log), line = at ? files[at.file]?.split(/\r?\n/)[at.line - 1] ?? "" : "";
      const digit = /(^|[\s(])[0-9][A-Za-z_]\w*/.exec(line);
      return {
      by: "the program",
      cause: `OpenFOAM could not read the case file ${m[2]} the program wrote: ${m[1]!.trim()}${digit ? ` — the name "${digit[0].trim()}" there starts with a digit` : ""}`,
      remedy: digit
        ? "a name in the case started with a digit, which OpenFOAM cannot read — fixed in this version (such names now start with a letter): Run CFD… again"
        : "nothing in the room or your choices causes this — run it again with the newest version; if it repeats, keep the run folder and report it",
      };
    },
  },
  {
    test: /(Cannot find point|keepPoint|locationInMesh|insidePoint)[^\n]*(not|outside|cannot)[^\n]*/i,
    diag: () => ({
      by: "the room",
      cause: "the mesher could not find the room's inside — the point it starts from is outside the room's solid, or the solid is not closed",
      remedy: "check the room in BIM › LEVELS · SPACES with spaces shown: a face missing or a gap in the room's solid opens it; close it with Extend Space to Space, then Run CFD… again",
    }),
  },
  {
    test: /(exceeds|more than) (the )?max(Global|Local)Cells|maxGlobalCells/i,
    diag: () => ({
      by: "you",
      cause: "the mesh grew past the cell limit — the room is large for the mesh size chosen",
      remedy: "in Run CFD… › THE SOLVE give the mesh a larger size (4 in → 5 or 6 in); the refinement at the terminals stays",
    }),
  },
  {
    test: /(std::bad_alloc|Cannot allocate memory|out of memory)/i,
    diag: () => ({
      by: "this machine",
      cause: "the machine ran out of memory",
      remedy: "run fewer rooms side by side (THE PROCESSORS: one at a time), or a larger mesh size in THE SOLVE",
    }),
  },
  {
    test: /(not enough slots|There are not enough slots available)/i,
    diag: () => ({
      by: "this machine",
      cause: "more processes were asked for than the machine offers",
      remedy: "in THE PROCESSORS pick a plan with fewer processes per run",
    }),
  },
  {
    test: /(Floating point exception|sigFpe|\bnan\b|Maximum number of iterations exceeded)/i,
    diag: () => ({
      by: "you",
      cause: "the solver diverged — the air speeds or temperatures ran away before the flow settled",
      remedy: "check the terminals in Run CFD…: a supply flow typed far too high, a terminal placed past a wall (a red clearance), or no way out for the air; then try a coarser mesh",
    }),
  },
  {
    test: /Cannot find patchField entry for (\S+)/,
    diag: (m) => ({
      by: "the program",
      cause: `the boundary conditions name no patch ${m[1]} the mesh made — the mesh and the conditions disagree`,
      remedy: "a terminal or door may be outside the room's solid, so the mesher dropped its patch: check the clearances in Run CFD… (a red box), then run again; if it repeats, report it",
    }),
  },
];

/** the lines worth showing: OpenFOAM's FATAL ERROR block, else the log's last lines */
function excerptOf(log: string): string[] {
  const lines = log.split(/\r?\n/);
  const i = lines.findIndex((l) => /FOAM FATAL/.test(l));
  const pick = i >= 0 ? lines.slice(i, i + 8) : lines.slice(-8);
  return pick.map((l) => l.trimEnd()).filter((l) => l.trim() !== "");
}

/** a failed step's log → why and what to do */
export function diagnose(log: string, step: string | null, files: Record<string, string> = {}): Diagnosis {
  for (const r of RULES) {
    const m = log.match(r.test);
    if (m) return { ...r.diag(m, log, files), excerpt: excerptOf(log) };
  }
  return {
    by: "the program",
    cause: `${step ?? "a step"} stopped with an error this program does not recognise yet`,
    remedy: "OpenFOAM's own words are below; the run folder holds the whole case and its logs",
    excerpt: excerptOf(log),
  };
}
