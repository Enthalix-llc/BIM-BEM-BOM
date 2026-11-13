// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE ENGINE, FOUND ONE WAY (2026-09-23). The project moved to a machine with EnergyPlus 26.1 and no 25.2, and the user's
// ruling is that the program follows whichever version is INSTALLED — later or earlier than the one it was developed on.
// Before this the app took the first working candidate (alphabetically the OLDEST install under /Applications) while the
// gate took $ENERGYPLUS or `which energyplus` and never looked in /Applications — two engines possible, against principle
// #1. Now both call this module (main.cjs requires it, the gates through createRequire, as ledgerStore.cjs):
//   · every install is listed — $ENERGYPLUS, /Applications/EnergyPlus-*, the usual bin links — each asked `--version`,
//     links deduplicated by their real path;
//   · the NEWEST is in force, unless $ENERGYPLUS pins one (the remote shim of LOCAL MODE is a pin too); the others are named;
//   · the install folder (Energy+.idd, DataSets, ExampleFiles, WeatherData) is the one beside the binary, or — for a pin
//     that is a shim with no install beside it — the newest local install's, said so.
// And the weather files by NAME: a path that no longer exists (a ledger written on the old machine names
// /Applications/EnergyPlus-25-2-0/WeatherData/…) is looked for by its file name in the project's Weather/ folder (the
// user's ruling, 2026-09-22), then the engine's WeatherData, then every other install's, then data/weather/*.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

/** "EnergyPlus, Version 26.1.0-6f2e40d102" → { major: 26, minor: 1, patch: 0, build: "6f2e40d102" }; null when unreadable */
function parseVersion(text) {
  const m = /Version\s+(\d+)\.(\d+)\.(\d+)(?:-(\w+))?/.exec(String(text ?? ""));
  return m ? { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), build: m[4] ?? "" } : null;
}
const cmp = (a, b) => (a.major - b.major) || (a.minor - b.minor) || (a.patch - b.patch);
const realOf = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
const hasInstall = (dir) => fs.existsSync(path.join(dir, "Energy+.idd"));

/** the installs' usual homes on each system (2026-10-20, Windows and Linux): EnergyPlus's own installers put
 *  macOS in /Applications/EnergyPlus-<v>, Windows in C:\EnergyPlusV<v>, Linux in /usr/local/EnergyPlus-<v> with a link in /usr/local/bin */
const HOMES = {
  darwin: { roots: ["/Applications"], pattern: /^EnergyPlus/i, exe: "energyplus", links: ["/usr/local/bin/energyplus", "/opt/homebrew/bin/energyplus"] },
  win32: { roots: ["C:\\", process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(Boolean), pattern: /^EnergyPlusV/i, exe: "energyplus.exe", links: [] },
  linux: { roots: ["/usr/local", "/opt"], pattern: /^EnergyPlus-/i, exe: "energyplus", links: ["/usr/local/bin/energyplus", "/usr/bin/energyplus"] },
};

/** the candidates, in the order they are asked: the pin, the installs in the system's usual homes, the bin links */
function candidates(env = process.env, platform = process.platform) {
  const c = [];
  if (env.ENERGYPLUS) c.push({ exe: env.ENERGYPLUS, from: "$ENERGYPLUS" });
  const home = HOMES[platform] ?? HOMES.linux;
  for (const root of home.roots) {
    try {
      for (const d of fs.readdirSync(root)) if (home.pattern.test(d)) c.push({ exe: path.join(root, d, home.exe), from: root });
    } catch { /* no such folder */ }
  }
  for (const p of home.links) c.push({ exe: p, from: path.dirname(p) });
  return c;
}

/** a pinned .bat or .cmd (a shim) runs through the shell on Windows: Node refuses to spawn one directly; its path is quoted for the shell */
const viaShell = (exe) => process.platform === "win32" && /\.(bat|cmd)$/i.test(exe);
const spawnArgs = (exe, args) => (viaShell(exe) ? { exe: `"${exe}"`, args: args.map((a) => `"${a}"`), shell: true } : { exe, args, shell: false });

/** every engine that answers `--version`, newest first; the pin (if any) flagged */
function listEngines(env = process.env) {
  const seen = new Map();
  for (const cand of candidates(env)) {
    if (!fs.existsSync(cand.exe)) continue;
    const real = realOf(cand.exe);
    if (seen.has(real)) { if (cand.from === "$ENERGYPLUS") seen.get(real).pinned = true; continue; }
    let out = "";
    try { const sa = spawnArgs(cand.exe, ["--version"]); const r = spawnSync(sa.exe, sa.args, { encoding: "utf8", timeout: 30000, shell: sa.shell }); if (r.status !== 0) continue; out = (r.stdout || "").trim().split(/\r?\n/)[0]; } catch { continue; }
    const v = parseVersion(out);
    seen.set(real, { exe: cand.exe, real, dir: path.dirname(real), version: out, v, from: cand.from, pinned: cand.from === "$ENERGYPLUS" });
  }
  return [...seen.values()].sort((a, b) => (a.v && b.v ? cmp(b.v, a.v) : a.v ? -1 : b.v ? 1 : 0));
}

/** THE ENGINE IN FORCE: the pin, else the newest; its install folder; the others named. null when none answers */
function findEngine(env = process.env) {
  const all = listEngines(env);
  if (!all.length) return null;
  const inForce = all.find((e) => e.pinned) ?? all[0];
  const local = all.find((e) => hasInstall(e.dir));
  // a pin with no install beside it (the LOCAL MODE shim) reads the datasets of the newest local install
  const dir = hasInstall(inForce.dir) ? inForce.dir : local ? local.dir : inForce.dir;
  const vv = inForce.v;
  return {
    exe: inForce.exe, dir, version: inForce.version,
    /** "26.1" — the IDF's Version and the docs' numbering come from this */
    majorMinor: vv ? `${vv.major}.${vv.minor}` : null,
    pinned: inForce.pinned,
    dirNote: dir === inForce.dir ? null : `the pinned engine has no install beside it; the datasets are read from ${dir}`,
    others: all.filter((e) => e !== inForce).map((e) => ({ exe: e.exe, dir: e.dir, version: e.version })),
  };
}

/** where a weather file is looked for, in order: the project's Weather/, the engine's WeatherData, every other install's, data/weather/<stem>/ */
function weatherDirs(repoRoot, engine) {
  // a project folder keeps its files in weather/ (2026-11-12); an older home in Weather/ — the same folder on a case-insensitive disk
  const dirs = [path.join(repoRoot, "weather"), path.join(repoRoot, "Weather")];
  if (engine) {
    dirs.push(path.join(engine.dir, "WeatherData"));
    for (const o of engine.others ?? []) dirs.push(path.join(o.dir, "WeatherData"));
  }
  const dl = path.join(repoRoot, "data", "weather");
  try { for (const d of fs.readdirSync(dl).sort()) dirs.push(path.join(dl, d)); } catch { /* none downloaded */ }
  const real = (d) => { try { return fs.realpathSync(d); } catch { return d; } };
  const seen = new Set();
  return dirs.filter((d) => fs.existsSync(d)).filter((d) => { const r = real(d).toLowerCase(); if (seen.has(r)) return false; seen.add(r); return true; });
}

/** a weather file's path as it stands, else the first folder holding a file of its NAME; null when none does */
function resolveEpw(p, dirs) {
  if (!p) return null;
  if (fs.existsSync(p)) return p;
  const name = String(p).split(/[\\/]/).pop();   // a path written on another system keeps its own separator
  for (const d of dirs) { const q = path.join(d, name); if (fs.existsSync(q)) return q; }
  return null;
}

module.exports = { parseVersion, listEngines, findEngine, weatherDirs, resolveEpw, spawnArgs };
