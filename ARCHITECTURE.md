# How BIM-BEM-BOM is built

BIM-BEM-BOM is a desktop application made with Electron, React and TypeScript.
The interface is a web page (`program/src/`), and a small main process
(`program/electron/`) does what a page cannot do: read and write files, run
EnergyPlus, and download what the app needs.

## The three modules and their files

Each module reads the file the one before it wrote:

```
IFC file ──BIM──▶ ifc.db, idf.db ──BEM──▶ in.idf, bem.db ──BOM──▶ bom.db
                                                  └──CFD──▶ cfd.db
```

- **BIM** (`src/core/`, `src/modules/bim/`) reads the IFC file with
  [web-ifc](https://github.com/ThatOpen/engine_web-ifc). It stores every
  element's surfaces in `ifc.db`, collapses each assembly to the single plane
  EnergyPlus takes, carves it by room, and writes the result to `idf.db`.
- **BEM** (`src/modules/bem/`) builds the energy model from `idf.db` and your
  decisions: site and weather, constructions, schedules, zones and systems. It
  writes the EnergyPlus input file (`bemIdf.ts`), runs EnergyPlus as a separate
  program, and reads its SQL output into `bem.db`.
- **BOM** (`src/modules/bom/`) prices the run with your utility's tariff, takes
  your bills and PV production, and runs the calibration year against ASHRAE
  Guideline 14's statistics. Its results go to `bom.db`.
- **CFD** (`src/modules/cfd/`, the BOM › CFD tab) builds a room's closed
  enclosure from its own `idf.db` surfaces, holds each face at the inside
  surface temperature EnergyPlus reported for the design hour (`bem.db`), and
  places the room's air terminals from the MEP file or by hand. It writes an
  OpenFOAM case as text (`cfdCase.ts`), runs OpenFOAM as a separate program
  (`electron/cfdRun.cjs`) in `data/cfd/runs/`, and reads the finished case back
  into `cfd.db`: the room's comfort and air figures, slices and streamline arrows.

Every derived file records the hash of what it was built from, so a stale
result shows as stale. The databases are SQLite, used through
[sql.js](https://github.com/sql-js/sql.js) (WebAssembly), and live in `data/`.

## Your decisions

What you decide, such as a construction, a zone's thermostat or the energy code,
is a ruling. Rulings are saved as you work in `projects.sqlite`, in the
operating system's app-data folder. They are keyed by the IFC file's IfcProject
and version, so they follow the building across file versions
(`electron/projectStore.cjs`). When you click Apply, the applied rulings and the
library values they use are committed into `idf.db`, and the model is built
from `idf.db` alone.

## Rules the code keeps

- **It reads what the file states and derives nothing.** Where the file is
  silent, a stated default governs and is labelled as one.
- **No silent drops.** Geometry that can't be placed is reported, never repaired
  or dropped quietly.
- **No invented values.** A code value, a tariff rate or a coefficient that
  hasn't been entered stops the step that needs it, with a message saying what
  to enter.
- **One place per input.** Each input is typed on one screen and shown read-only
  everywhere else.
- **Units as you choose them.** Every number you type or read follows the
  imperial or metric choice.

## Where to start reading

| File | What it does |
| --- | --- |
| `src/App.tsx` | the window: the modules, their tabs and the state they share |
| `src/core/ifcStream.ts` | reads the IFC file |
| `src/core/db.ts` | the `ifc.db` and `idf.db` tables |
| `src/modules/bem/core/bemModel.ts` | the model from `idf.db` and the rulings |
| `src/modules/bem/core/bemIdf.ts` | writes the EnergyPlus input file |
| `src/modules/bem/pipeline.ts` | build, run and read back |
| `src/modules/bom/core/tariff.ts` | the tariff arithmetic |
| `src/modules/bom/core/calibration.ts` | Guideline 14's statistics |
| `electron/main.cjs` | the main process: files, EnergyPlus, downloads |

## Checking a change

`pnpm typecheck` checks the types, and `pnpm setup:check` checks the
installation. The end-to-end test suite runs on the developers' own building
and will be published once it runs on the public sample building.
