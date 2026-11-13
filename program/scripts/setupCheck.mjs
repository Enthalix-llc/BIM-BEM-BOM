// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE SETUP CHECK: what BIM-BEM-BOM needs, what is on this computer, and where to get what is missing — each part from its own
// publisher, under its own terms. It INSTALLS NOTHING and changes nothing: it reads, and says. Run it from program/:
//
//   pnpm setup:check
//
// Exit code 0 when everything needed to run a model is in place, 1 otherwise.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const program = path.resolve(here, "..");
const repo = path.resolve(program, "..");
const TESTED_ENERGYPLUS = "26.1";

const rows = [];
let missing = 0;
const ok = (part, what) => rows.push(["ok", part, what]);
const need = (part, what, where) => { missing++; rows.push(["MISSING", part, `${what}\n      → ${where}`]); };
const note = (part, what, where) => rows.push(["note", part, where ? `${what}\n      → ${where}` : what]);
const csvRows = (f) => { try { return fs.readFileSync(f, "utf8").split(/\r?\n/).slice(1).filter((l) => l.trim()).length; } catch { return null; } };

// 1. Node.js and the program's packages
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor >= 22) ok("Node.js", `version ${process.versions.node}`);
else need("Node.js", `version ${process.versions.node} — 22 or newer is needed`, "https://nodejs.org/");
if (fs.existsSync(path.join(program, "node_modules", "web-ifc"))) ok("packages", "installed (program/node_modules)");
else need("packages", "not installed", "run `pnpm install` in program/ (pnpm: https://pnpm.io/installation)");
if (fs.existsSync(path.join(program, "node_modules", "electron", "dist"))) ok("Electron", "its binary is downloaded");
else note("Electron", "its binary is not downloaded yet — Electron fetches it the first time `pnpm dev` starts it");

// 2. EnergyPlus — installed separately, run as its own program
try {
  const { listEngines } = require(path.join(program, "electron", "engineLocate.cjs"));
  const engines = listEngines();
  const looked = { darwin: "/Applications, /usr/local/bin, /opt/homebrew/bin", win32: "C:\\EnergyPlusV* and Program Files", linux: "/usr/local/EnergyPlus-*, /opt/EnergyPlus-*, /usr/local/bin, /usr/bin" }[process.platform] ?? "the usual folders";
  if (!engines.length) need("EnergyPlus", `no installation found (looked in ${looked} and $ENERGYPLUS)`,
    `install EnergyPlus ${TESTED_ENERGYPLUS} from https://github.com/NatLabRockies/EnergyPlus/releases (or set ENERGYPLUS to its program)`);
  else {
    const e = engines[0];
    const v = `${e.v?.major ?? "?"}.${e.v?.minor ?? "?"}.${e.v?.patch ?? "?"}`;
    if (`${e.v?.major}.${e.v?.minor}` === TESTED_ENERGYPLUS) ok("EnergyPlus", `version ${v} at ${e.dir ?? e.exe}`);
    else note("EnergyPlus", `version ${v} at ${e.dir ?? e.exe} — this preview is tested with ${TESTED_ENERGYPLUS}`, "https://github.com/NatLabRockies/EnergyPlus/releases");
  }
} catch (err) { note("EnergyPlus", `could not be looked for: ${err instanceof Error ? err.message : String(err)}`); }

// 3. Projects (2026-11-12): a project is a folder holding its own weather, tables, library and IFCs — made from a template
const std = path.join(repo, "templates", "standard", "template.json");
if (fs.existsSync(std)) ok("template", "templates/standard — the template a new project is made from (New project… or Open IFC… on a file outside a project)");
else need("template", "templates/standard/template.json is missing — a new project cannot be made", "the repository's templates/ folder");

// 4. The energy code — the DOE/PNNL prototype values ship with the program (2026-10-15); a project's own tables, where present, come first
const shipped = csvRows(path.join(program, "src", "modules", "bem", "reference", "pnnl-values.csv"));
if (shipped) ok("energy code", `the DOE/PNNL prototype values for IECC 2006–2024 ship with the program (${shipped} values); a project's own code goes in its tables/energy-codes (BEM › SITE › energy code › Choose… › Edit values…)`);
else need("energy code", "no code values on record — the model is not written without them",
  "enter your code's values in BEM › SITE › energy code › Choose… › Edit values… (references/energy-codes/README.md)");

// 5. The weather and the tariff are the project's: its file picked on BEM › SITE (EnergyPlus's weather repository) lands in its weather/;
//    the Sample card prices the run until the project's own tariff (tables/tariffs/tariff.json) is applied
note("weather", "each project keeps its own weather/ — pick the site's file on the map in BEM › SITE (https://energyplus.net/weather)");

// 6. A building
if (fs.existsSync(path.join(repo, "examples", "Duplex", "Duplex_A_20110907.ifc"))) ok("building", "the example examples/Duplex — Open IFC… › New project from the example Duplex…, or any IFC of your own");
else note("building", "open any IFC from the app (Open IFC…) — it starts a new project", "a sample building: see SETUP.md");

// 7. Terms to know before paid work
note("terms", "the actual-year weather's sun and sky come from the Open-Meteo archive, whose free API is for NON-COMMERCIAL use only — for paid work use your own actual-year file (BOM › calibration)");

for (const [s, part, what] of rows) console.log(`${s.padEnd(8)} ${part.padEnd(12)} ${what}`);
console.log(missing ? `\n${missing} part${missing === 1 ? "" : "s"} missing — see above, and SETUP.md` : "\nEverything needed to run a model is in place.");
process.exit(missing ? 1 : 0);
