# Projects and templates

**A project is a folder.** It holds everything the project uses, so a copy of the folder is complete:

| In the folder | What it is |
| --- | --- |
| `project.sqlite` | the project: its versions and their lineage, every ruling with its history, and its data-sources record |
| `ifc/` | the IFC files, copied in when the project was made (the originals stay where they were) |
| `weather/` | its weather files |
| `tables/` | the tables and lists its data sources name (energy-code values, tariff cards, reference lists …) |
| `library/` | your own materials, windows, schedules, holiday lists and seasons |
| `cache/` | what it read from the web (station listings, catalogues) |
| `imports/` | the bills it imported |
| `data/` | the derived databases and the runs, rebuilt from the rest when missing |

**The projects folder** (chosen in the New project dialog, remembered in the settings) holds one folder per project,
named for the building's IFC file unless you type another name, and an `Example/` folder with the example IFC files:

```
Projects/                    e.g. ~/Documents/BIM-BEM-BOM Projects
├── Example/                 the example IFC files (New project from the example … copies them here first)
└── Duplex_A_20110907/       a project, named for its IFC file
    ├── project.sqlite       versions and lineage, every ruling with its history, the data-sources record
    ├── ifc/                 its IFC files (building, site, services), copied in
    ├── weather/  tables/  library/  cache/  imports/
    └── data/                ifc.db · idf.db · bem.db · bom.db · cfd.db and the runs — derived, rebuilt if missing
```

**A template is a folder of the same shape**, without IFCs, rulings or results: `template.json` (a name and the
data-sources record), `tables/`, `library/`, `cache/`. **New project…** copies a template into a new folder, then
copies in the IFC files you pick. `standard/` here is the template the program ships with. It is clean, and holds
nothing of any project. **Save as template…** (in the Open menu) writes one of your own from the open project, such as
one carrying your licensed tables or your own materials. You can make it the default for new projects.

## The data-sources record

Every project keeps a record of where its data comes from. It is shown, and can be changed, on
**BEM › SITE › data sources**. Paths in it are relative to the project's folder. A source that is a **table** is a
file **you** supply. BIM-BEM-BOM ships none of them: such tables belong to their publishers, and the right to use
them is yours to obtain.

| Field | Meaning | Values |
| --- | --- | --- |
| `template` | the template the record started from | a name |
| `weatherListing` | the station map's listing | `energyplus` (energyplus.net/weather) · `onebuilding-tmyx-usa` (climate.onebuilding.org's USA TMYx files) |
| `amyStation` | the NOAA GHCNh station an actual-year weather file is made from | `{ "mode": "nearest" }` · `{ "mode": "pinned", "id": "<GHCNh id>", "name"?: "…", "fileStem"?: "…" }` |
| `energyCodes` | the energy code's tables | `{ "shipped": true \| false, "tables"?: "<folder>" }`. The folder holds `editions.csv`, `values.csv`, `state-adoptions.csv`, `state-overrides.csv` (default `tables/energy-codes`). `shipped` adds the DOE/PNNL prototype values. |
| `climateZone` | the climate zone | `{ "mode": "typed" }` (entered with the energy code) · `{ "mode": "county-table", "file" \| "url": "…" }` |
| `infiltration` | the stack and wind coefficients (Cs, Cw) | `{ "mode": "typed" }` · `{ "mode": "table", "file": "<json>" }` |
| `groundFactors` | the F and C factors of the F/C ground method | `{ "mode": "typed" }` · `{ "mode": "table", "file": "<json>" }` |
| `referenceLists` | material and window reference lists (CSV) | a list of paths |
| `referenceManifest` | the datasets those lists fill | a JSON path (below) |
| `tariffs` | the tariff cards | `{ "sample": true \| false, "files": ["<json>", …] }` |

## Table layouts

- **County table** (CSV): the DOE Building America layout. Its columns are `State`,
  `State FIPS`, `County FIPS`, `IECC Climate Zone`, `IECC Moisture Regime`,
  `BA Climate Zone` and `County Name`.
- **Infiltration table** (JSON):
  - `cite`;
  - `stack`, which maps storeys to Cs: `{ "1": Cs, "2": Cs, "3": Cs }`;
  - `wind`, which maps each shelter class to Cw by storeys: `{ "<shelter>": { "<storeys>": Cw } }`;
  - optionally `shelterWords`: `{ "<shelter>": "…" }`.

  On a Zone card, the storeys and shelter pick a row, and that row fills Cs and Cw.
- **F/C table** (JSON):
  - `fCite` and `fUninsulated`;
  - `f`, a list of `{ "placement": "horizontal" | "vertical" | "full", "inches", "rIp", "f" }`;
  - `cCite`;
  - `c`, a list of `{ "rIp", "c" }`.

  On CONSTRUCTIONS › Floors, **from the table** fills F and C from the row at or under
  the slab's R and distance and the walls' R. Values are never interpolated.
- **Reference manifest** (JSON): `{ "sources": [ …rows like materialsDb.ts SOURCES ], "datasets": [ { "key", "sourceId", "kind", "set", "provider"? } ] }`.
- **Tariff card files**: the layout of `references/tariffs/tariff.template.json`.
