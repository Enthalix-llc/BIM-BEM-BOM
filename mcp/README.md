# bim-bem-bom-mcp

BIM-BEM-BOM's tools for an AI assistant, as an [MCP](https://modelcontextprotocol.io) server.

This package is separate from the app. The app ships no AI code, no LLM calls and no MCP server, and nothing here is
bundled into it or its installers. An assistant's client (Claude Desktop, Claude Code, OpenCode with a local model, or
any other MCP client) starts this package as a local process and talks to it over stdio. It opens no network port.

## What it does

The package **reads** your projects. It never writes them. Every number it returns comes from the program's own
core code, the same code the app runs, reading your project's own files (`project.sqlite` and `data/*.db`). Every reply
names the files it read, with each file's content sha and when it was written, so an old result cannot pass for a
current one.

| Tool | Returns |
|---|---|
| `list_projects` | the projects in the folder, their IFC files, which derived files the app has built |
| `project_summary(project)` | IFC versions and lineage, data sources, the freshness chain, the last run, and whether the model changed since |
| `census(project)` | IFC elements by class, rooms, zones, zone surfaces with net and gross area, what was not emitted to EnergyPlus and why |
| `wall_qa(project, filter?)` | one row per exposed exterior wall plane with its four boundary verdicts |
| `void_qa(project)` | each attic or floor cavity, what closes it, and your ruling on it |
| `model_checks(project)` | the model's checks with their fixes, and the system QA |
| `zones(project)` | each zone, its rooms, thermostat, infiltration and gains |
| `constructions(project)` | each construction written, its U and where it is used, and your rulings per IFC type |
| `run_results(project, run?)` | a run's results: end uses by fuel, peaks, unmet hours per zone, monthly meters, coil sizing |
| `bom_results(project)` | the bills against the run, and the Guideline 14 verdict with its caveats |
| `rulings(project, kind, key?)` | the rulings the app holds for the open IFC (`corrections`, `bem` or `bom`) |
| `explain(topic)` | the program's own help text on a field, check or method |
| `list_runs(project)` | every run of the project, in `bem.db` and in `record/` |
| `compare_runs(project, a, b)` | two runs side by side, with the differences |
| `preview_ruling(project, change)` | the model as it would be with one ruling changed: the IDF objects added, removed and changed, the settings changed, new checks, and rulings not honoured |

**Coming in later releases:** running a what-if year in EnergyPlus, and proposing a ruling. A proposal will wait in the
project's inbox until **you** stage and apply it in the app.

### Previewing a ruling

A **change** is one ruling, in the app's own words: a section of the energy-model rulings (`site`, `zones`,
`constructions`, `ground`, `schedules`, `holidays`, `gains` or `sideApprovals`), an optional key in it, and the value.
A value of `null` removes the key. Read the current value with `rulings` first. For example:

```json
{ "section": "constructions", "key": "Window-Casement-Single_Right:29\" x 48\"", "value": { "source": "u", "uWm2k": 1.4, "shgc": 0.25, "vt": 0.45 } }
```

The preview builds the model the way the app's **Apply** does: the same core code, the engine's datasets, your
materials, schedules and energy-code tables. It does this in memory, on a copy of `idf.db` that is never saved. It needs
EnergyPlus installed, because a ruling resolves against the engine's datasets.

Each preview carries:

- **the store proof** that the app's Apply runs (the model rebuilt from the committed rulings must equal the live
  build, byte for byte);
- a plain **"no effect"** when the change moves nothing (another ruling may govern it).

Not previewed in this release: the weather file, the SYSTEMS sheet, and the geometry corrections.

## The rules it keeps

- **A fixed set of tools.** No tool runs code, a shell command or SQL it is handed. Each takes named arguments,
  checked before it acts.
- **It never writes your project.** Every file is read into memory; nothing is opened for writing.
- **It stays in the projects folder.** A path outside it is refused.
- **It refuses newer files.** A file written by a newer schema than the package knows is refused, with the reason.

## Set up

You need Node 22 or later and [pnpm](https://pnpm.io). In this folder:

```
pnpm install
```

Then add the server to your MCP client, with your projects folder as its one argument. For Claude Code:

```
claude mcp add bim-bem-bom -- <this folder>/node_modules/.bin/tsx <this folder>/src/server.ts <your projects folder>
```

For a client configured by JSON (Claude Desktop and others):

```json
{
  "mcpServers": {
    "bim-bem-bom": {
      "command": "<this folder>/node_modules/.bin/tsx",
      "args": ["<this folder>/src/server.ts", "<your projects folder>"]
    }
  }
}
```

The package imports the program's core from `../program/src`, so keep it in this repository beside `program/`, at the
same version.

## Proving it

```
pnpm gate <a project folder>
```

The gate clones the project into a scratch folder and works only on the clone. It checks that:

- the package knows the schemas the program writes;
- every tool answers, each one checked against an independent read of the same file (direct SQL, and the run's own
  `eplustbl.csv`);
- a preview with no change reproduces the model as it stands, byte for byte, and a real change shows up with the store
  proof passing;
- every refusal holds;
- the server works over stdio;
- **every one of the project's files is byte-identical after all the calls.**

The original project is only read, to clone it.

## Licence

Apache-2.0, Copyright 2026 Enthalix LLC.
