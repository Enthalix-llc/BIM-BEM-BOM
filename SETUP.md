# Setting up BIM-BEM-BOM

BIM-BEM-BOM is a public preview. It runs on macOS, Windows and Linux, with
EnergyPlus 26.1. It is developed on macOS (Apple silicon); every change is
built and run on all three systems automatically (`.github/workflows/ci.yml`).

You install each part yourself, from its own publisher and under its own terms.
To see what is installed and what is missing, run this in `program/`:

```bash
pnpm setup:check
```

The check only reads; it installs nothing.

## 1. The software

| Part | Where to get it | Notes |
| --- | --- | --- |
| Node.js 22 or newer | [nodejs.org](https://nodejs.org/) | |
| pnpm | [pnpm.io](https://pnpm.io/installation) | or `npm install -g pnpm` |
| git | [git-scm.com](https://git-scm.com/) | to copy the repository |
| EnergyPlus 26.1 | [EnergyPlus releases](https://github.com/NatLabRockies/EnergyPlus/releases) | Install it with its own installer, in its usual folder (below). To use another installation, set `ENERGYPLUS` to its `energyplus` program. |

Where BIM-BEM-BOM looks for EnergyPlus:

| System | EnergyPlus's download | Where BIM-BEM-BOM looks |
| --- | --- | --- |
| macOS | `…-Darwin-macOS13-arm64.dmg` (Apple silicon) or `…-x86_64.dmg` (Intel) | `/Applications/EnergyPlus-*`, `/usr/local/bin`, `/opt/homebrew/bin` |
| Windows | `…-Windows-x86_64.exe`, or `…-Windows-arm64.exe` on an ARM computer | `C:\EnergyPlusV*` and `Program Files` |
| Linux | `…-Linux-Ubuntu24.04-x86_64.sh` (or `.tar.gz`) | `/usr/local/EnergyPlus-*`, `/opt/EnergyPlus-*`, `/usr/local/bin`, `/usr/bin` |

Then, in a copy of this repository:

```bash
cd program
pnpm install
pnpm dev
```

The first `pnpm dev` downloads Electron's binary.

**On Windows**, building from source also needs the Microsoft Visual C++
runtime ([download](https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist));
without it `pnpm dev` and `pnpm build` stop with "The specified module could
not be found". Run the commands in PowerShell or the Command Prompt.

**On Linux**, if Electron will not start because of its sandbox (Ubuntu 23.10 and
later restrict unprivileged user namespaces), start it with
`pnpm exec electron . --no-sandbox` while `pnpm exec vite` runs, or allow the
namespaces as your distribution documents.

### An installer instead

`pnpm dist` builds an installer for the system you run it on, in `release/`: a
`.dmg` on macOS, a setup `.exe` on Windows, an `.AppImage` and a `.deb` on Linux.
They are not code-signed yet: macOS asks you to open the app with right-click ›
Open the first time, and Windows SmartScreen asks you to choose "Run anyway". An
AppImage needs `libfuse2` on recent Ubuntu.

**On Windows on ARM**, use the x64 installer built by the project's checks
(Windows runs it on ARM). An ARM64 installer made with `pnpm dist` on an ARM
computer currently installs without `BIM-BEM-BOM.exe` and its DLLs; the cause is
not yet known.

An installed BIM-BEM-BOM keeps your files in its app-data folder (see "Where your
files are"). It still needs EnergyPlus installed separately.

### Known issue: Windows in Parallels on a Mac

In a Windows virtual machine under Parallels Desktop on Apple silicon, the
EnergyPlus run can stop the whole virtual machine. It happens when EnergyPlus
calculates shadows on the graphics card (SITE › shadows: PixelCounting, the
default), through Parallels' 3D acceleration. Run BIM-BEM-BOM on macOS itself on
such a Mac, or choose PolygonClipping under SITE › shadows (some buildings then
report non-convex surfaces as Severe errors).

## 2. A building

Use BIM › Open IFC… to open an IFC file. To try the program, open the sample
building `examples/Duplex/Duplex_A_20110907.ifc` (see `examples/Duplex/README.md` for its source
and licence).

BIM-BEM-BOM reads the rooms (IfcSpace), the walls, slabs, roofs, windows and doors,
and the site's position (IfcSite). A room-based model from an architect's
authoring tool works best.

## 3. Weather

In BEM › SITE, under "weather file", click "Find…". The map shows every location in
EnergyPlus's own weather repository
([energyplus.net/weather](https://energyplus.net/weather)). Click the station
nearest the site, and the app downloads its files into `Weather/`. Some data
sets in that repository have their own licence; the
[sources page](https://energyplus.net/weather/sources) says which.

You can also use "Browse…" to pick any `.epw` file, or put one with its `.ddy`
beside it in `Weather/`.

## 4. The energy code

BIM-BEM-BOM ships the DOE/PNNL residential prototype values for each IECC
edition (2006 to 2024), so a model runs from the start; a project reads the
2021 edition until you choose another. They are the prototypes' values, not a
state's code (see `references/energy-codes/README.md`). To use the code your
project is under as the code states it, enter its values:

1. Read the code; the IECC is free to read at
   [codes.iccsafe.org](https://codes.iccsafe.org/).
2. In BEM › SITE › energy code, click **Choose…**, then **Edit values…**. Give the code an id
   and a name, pick your climate zone's row, and enter each value with the
   table or section it is from. Save writes the project's `tables/energy-codes/`; the CSV
   format is in `references/energy-codes/README.md`, if you prefer to edit
   the files directly.
3. Click **Choose…**, choose the edition, enter the climate zone that your
   county's row in the code's table (IECC Table R301.1) states, and click Use.

If a code of your own is missing a value, the model is still built, so you can
set up zones, schedules and systems, but it cannot run, and the app names the
values that are missing.

## 5. Costs and calibration (optional)

- **Tariff:** copy `references/tariffs/tariff.template.json` to the project's
  `tables/tariffs/tariff.json` and fill it in from your utility's published rate
  schedule (`references/tariffs/README.md`).
- **Bills and PV:** type your bills in BOM, or import them as CSV, and import
  your PV system's daily production as CSV.
- **Actual-year weather:** for the calibration year, BIM-BEM-BOM builds a weather
  file from the hourly readings of the NOAA station nearest the site, plus the
  sun and sky from the Open-Meteo archive. **Open-Meteo's free API is for
  non-commercial use only.** For paid work, use an actual-year weather file you
  have the right to use, with "Run on my own weather file…" on the calibration
  card.

## 6. Room airflow (optional)

BOM › CFD runs OpenFOAM, a separate program you install. BIM-BEM-BOM writes
each room's case and runs OpenFOAM's own commands on it; it does not include
OpenFOAM.

- **macOS (Apple silicon):** the OpenFOAM app,
  `brew install gerlero/openfoam/openfoam`, or download it from
  [github.com/gerlero/openfoam-app](https://github.com/gerlero/openfoam-app).
- **Linux:** openfoam.com's packages
  ([openfoam.com/download](https://www.openfoam.com/download/openfoam-installation-on-linux)).
  BIM-BEM-BOM looks for their `openfoamNNNN` launcher in `/usr/bin` or
  `/usr/local/bin`.
- **Windows:** not available yet.

BIM-BEM-BOM uses the first OpenFOAM install it finds that has the
`buoyantSimpleFoam` solver; set `OPENFOAM` to a launcher's path to choose one.
The CFD tab says which install it found, or why none could be used.

A room needs its EnergyPlus run first (BEM › RUN), for its design peaks and
surface temperatures. Then click the room in LEVELS · SPACES on the CFD tab, place
its supply, return and transfer grilles (from the MEP file, or by hand with
**+ floor**, **+ ceiling** or **+ wall**), and give each supply its flow.

OPENFOAM® is a registered trade mark of OpenCFD Limited, producer and
distributor of the OpenFOAM software. This offering is not approved or endorsed
by OpenCFD Limited, producer and distributor of the OpenFOAM software and owner
of the OPENFOAM® and OpenCFD® trade marks.

## Where your files are

**A project is a folder** you choose (by default `Documents/BIM-BEM-BOM Projects/<name>`). It holds everything the
project uses: `project.sqlite` (its rulings and history), `ifc/` (the IFC files, copied in), `weather/`, `tables/`,
`library/`, `cache/`, `imports/` and `data/` (the derived databases and runs). Copy the folder and the project is
complete. **Open IFC…** on a file outside a project starts a new one. **New project…** makes one from a template, and
**Save as template…** makes a template of your own from a project. The shipped template is in `templates/standard/`
and the sample in `examples/Duplex/` (see `templates/README.md`).

| What | Where |
| --- | --- |
| Settings and the window's own storage | the app-data folder: `~/Library/Application Support/Enthalix/` on macOS, `%APPDATA%\Enthalix\` on Windows, `~/.config/Enthalix/` on Linux — `settings.json` names the default template, the projects folder and recent projects; `{ "geocoderUrl": "https://…/search" }` there uses another Nominatim-compatible geocoder |
| Your templates | `templates/` in the app-data folder |
| All of these, elsewhere | set `ENTHALIX_HOME` to a folder |
