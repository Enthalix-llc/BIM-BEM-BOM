# BIM-BEM-BOM

**Where the model meets the meter.** Website: <https://enthalix.com>

BIM-BEM-BOM is open-source building energy modelling software offered by
**Enthalix LLC**. The program is BIM-BEM-BOM; Enthalix is the company. Its
name is its three parts: the building information model (IFC) in, the building
energy model (EnergyPlus) out, and the building operations model, the
building's measured operation compared back against the model.

> **Status: public preview.** Runs on macOS, Windows and Linux, from the
> installers on the [Releases](https://github.com/Enthalix-llc/BIM-BEM-BOM/releases)
> page or from source, with EnergyPlus 26.1. Developed on macOS; every change is
> built and run on all three systems automatically. Results are simulation
> estimates, not code-compliance documentation.
>
> **Room airflow (CFD) needs OpenFOAM, installed separately.** BIM-BEM-BOM does
> not include OpenFOAM: it writes each room's case and runs the OpenFOAM you
> install, on macOS (the OpenFOAM app) or Linux (openfoam.com's packages); CFD is
> not available on Windows yet. Everything else runs without it. See
> [SETUP.md § 6](SETUP.md#6-room-airflow-optional).

## See it in action

A narrated video walkthrough: the Duplex sample through BIM, every BEM tab and
the BOM, then an actual house. <https://youtu.be/MwWHeHbkUAE> (10/30/26)

## What it does

- **BIM** reads a building's IFC model: its rooms, walls, slabs, roofs, windows
  and doors. It reduces each assembly to the single surface EnergyPlus needs,
  and reports anything it can't place.
- **BEM** builds the energy model: site and weather, constructions, schedules,
  zones and systems. It then runs EnergyPlus, which you install separately.
- **BOM** prices the simulated year with your utility's tariff, takes your bills
  and PV production, and calibrates the model against ASHRAE Guideline 14.
- **CFD** (on the BOM tab) shows how air moves through a room at its heating and
  cooling design peaks: the room is the energy model's own enclosure, its walls
  held at EnergyPlus's surface temperatures, and its supply, return and transfer
  grilles placed from the MEP file or by hand. It runs OpenFOAM, which you
  install separately.

## Getting started

See [SETUP.md](SETUP.md). In short: install Node.js, pnpm and EnergyPlus 26.1,
then run `pnpm install` and `pnpm dev` in `program/`, and open the sample
building in [`samples/`](samples/). To see what is installed and what is
missing, run `pnpm setup:check`. For room airflow (CFD), also install OpenFOAM
separately; it is optional, and SETUP.md § 6 says how.

BIM-BEM-BOM ships no copyrighted standards tables, weather files or manufacturer
data. You get each from its publisher, under its own terms; SETUP.md says where.
For the energy code it ships public-domain reference values: those of the
DOE/PNNL residential prototype models, for each IECC edition from 2006 to 2024.
With them, a model runs before you enter your own code.

For how the program is built, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Who it's for

Researchers, engineers, architects and anyone else interested in practical,
honest building energy modelling. Early users are invited to try the preview,
report what works and what doesn't, and help shape where it goes next.

## Get involved

- **Feedback and bugs:** open an [issue](https://github.com/Enthalix-llc/BIM-BEM-BOM/issues).
- **Contributing code:** see [CONTRIBUTING.md](CONTRIBUTING.md). Commits are
  signed off under the Developer Certificate of Origin.

## Licence

BIM-BEM-BOM is licensed under the [Apache License 2.0](LICENSE). See
[NOTICE](NOTICE) and [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

"Enthalix" and the Enthalix logo are trademarks of Enthalix LLC; see
[TRADEMARKS.md](TRADEMARKS.md). BIM-BEM-BOM uses EnergyPlus but is not affiliated
with or endorsed by the US Department of Energy.

OPENFOAM® is a registered trade mark of OpenCFD Limited, producer and
distributor of the OpenFOAM software. This offering is not approved or endorsed
by OpenCFD Limited, producer and distributor of the OpenFOAM software and owner
of the OPENFOAM® and OpenCFD® trade marks.

---

BIM-BEM-BOM is offered and maintained by Enthalix LLC. The Enthalix name was first recorded here on 23 September 2026.
