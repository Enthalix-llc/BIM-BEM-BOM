# bim-bem-bom-mcp

BIM-BEM-BOM's tools for an AI assistant, as an [MCP](https://modelcontextprotocol.io) server.

This package is separate from the app. The app ships no AI code, no LLM calls and no MCP server, and nothing here is
bundled into it or its installers. An assistant's client (Claude Desktop, Claude Code, OpenCode with a local model, or
any other MCP client) starts this package as a local process and talks to it over stdio. It opens no network port.

## What it does

The package **reads** your projects. It never changes them. It writes two things inside a project, both its own: a
what-if run's folder, `cache/mcp/runs/`, and a proposal's file in `inbox/` (see below). Every number it returns comes from the program's own
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
| `run_scenario(project, change?)` | a year in EnergyPlus on that model (or on the model as it stands), beside the project's last run, with the differences |
| `propose_ruling(project, change, reason, scenario?)` | the change left as a proposal in the project's `inbox/` for you to stage or reject in the app |
| `proposals(project)` | the proposals in the inbox: waiting, staged by you, rejected by you |


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

### Running a scenario

`run_scenario` takes the same change as `preview_ruling`, or none. It runs the model for a year in EnergyPlus the way the
app's **RUN** does: the same IDF, the same weather, the same report units, the results read the same way. It returns them
beside the project's last run: end uses by fuel, peaks, unmet hours per zone, and the differences. It also says whether
the last run was on the same model and the same weather, so a difference is read for what it is.

**A run waits on what only you can clear.** `run_scenario` refuses while the model has a check the app's Run stops on (a
zone's heating or cooling switched off and not approved, a PV array that cannot be written, incomplete energy-code values),
or a question you have not answered on RUN (a zone no system serves: conditioned by the default district heat/cool, or
unconditioned with its loads passing to the adjoining spaces). The refusal names each one and where you clear it.
`model_checks` lists them as `clearBeforeRun` (from `bem.db`, as the app last built it), and `preview_ruling` lists them for the
model after the change. The assistant cannot clear them.

A run takes about as long as one in the app (a minute and a half on a large house). The server sends progress as the
engine works; if your client stops waiting sooner, raise its tool timeout (in Claude Code, `MCP_TOOL_TIMEOUT`).

The run's files go in `cache/mcp/runs/<stamp>/` inside the project, and only there: the IDF, the weather, the
engine's output and `change.json` naming the change. The newest 5 are kept; the package removes older ones of its own
and nothing else. The model, the rulings, `bem.db` and the app's runs are never touched, so a scenario is not in the
app's RUN list.

### Proposing a ruling

`propose_ruling` takes the same change as `preview_ruling`, for a section a tab stages in the app: `site`,
`constructions`, `ground`, `schedules`, `holidays` or `gains`. It needs a reason, in words. It previews the change
and writes one JSON file in the project's `inbox/` holding:

- the change and the reason;
- what it was measured against: the open IFC's sha and `idf.db`'s content sha;
- the preview;
- a scenario's year beside the last run, when `scenario` names a `run_scenario` stamp made with the same change on the
  same model.

**Nothing is applied.** The app shows the waiting proposals in a line at the head of the editing column. Each reads
its reason, the change, and whether it was measured on the model as it stands. After any Apply it reads "out of date".
**Stage** puts it in its tab's stage as if you had made the change, and opens that tab; you may edit it, then
**Apply** there, or revert. **Reject** moves the file to `inbox/rejected/`. A staged proposal's file moves to
`inbox/staged/`. Nothing is deleted, so `proposals` can tell the assistant what became of each one. The inbox holds
at most 50 waiting proposals.

## The rules it keeps

- **A fixed set of tools.** No tool runs code, a shell command or SQL it is handed. Each takes named arguments,
  checked before it acts.
- **It never changes your project.** Every file is read into memory; nothing the app reads is opened for writing. A
  scenario writes only its own folder, `cache/mcp/runs/`, and a proposal only its own file in `inbox/`.
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
- a scenario with no change reproduces the project's last run (when that run was on the same model and weather), and a
  real change runs clean and moves the year (`GATE_NO_RUN=1` skips the two years);
- a proposal is written in the program's own format and read back by the app's own reader, the stage the app would
  make from it holds the ruling proposed, and a scenario named with it is carried;
- every refusal holds;
- the server works over stdio;
- **every one of the project's files is byte-identical after all the calls**, with new files only in
  `cache/mcp/runs/` and `inbox/`.

The original project is only read, to clone it.

## Licence

Apache-2.0, Copyright 2026 Enthalix LLC.
