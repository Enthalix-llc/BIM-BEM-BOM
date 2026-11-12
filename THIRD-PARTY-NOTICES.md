# Third-party notices

Enthalix uses the open-source software, data and web services below. Each
remains under its own licence or terms. Enthalix does not modify any of them.

This file summarises them. A packaged release of Enthalix also includes the
full licence text of everything it bundles.

## Software included in the application

The application bundles these npm packages and the packages they need. The
versions are those in `pnpm-lock.yaml`.

| Component | Version | Licence | How Enthalix uses it |
| --- | --- | --- | --- |
| [web-ifc](https://github.com/ThatOpen/engine_web-ifc) | 0.0.77 | MPL-2.0 | Reads IFC files. Its WebAssembly files are copied unmodified from the npm package at build time. Any change to web-ifc's own files must be published under MPL-2.0. Its source code is at the link. |
| [@thatopen/components](https://github.com/ThatOpen/engine_components) | 3.4.8 | MIT | The 3D model viewer. |
| [@thatopen/fragments](https://github.com/ThatOpen/engine_fragment) | 3.4.7 | MIT | The viewer's model format. Its worker script is copied unmodified at build time. |
| [three.js](https://github.com/mrdoob/three.js) | 0.185.1 | MIT | 3D rendering of the model, the energy model's surfaces and the site. |
| [camera-controls](https://github.com/yomotsu/camera-controls) | 3.1.2 | MIT | The viewer's camera. |
| [sql.js](https://github.com/sql-js/sql.js) | 1.14.2 | MIT. It includes SQLite, which is in the public domain. | Reads and writes the project databases. |
| [React](https://github.com/react/react) | 19.2.8 | MIT | The user interface. |
| [React DOM](https://github.com/react/react) | 19.2.8 | MIT | The user interface. |
| [React Flow (@xyflow/react)](https://github.com/xyflow/xyflow) | 12.11.6 | MIT | The systems diagram. |
| [earcut](https://github.com/mapbox/earcut) | 3.2.3 | ISC | Triangulates surfaces for display. |
| [polygon-clipping](https://github.com/mfogel/polygon-clipping) | 0.15.7 | MIT | Intersects and joins polygons when rooms and surfaces are matched. |

### Packages included with them

| Component | Version | Licence | Included with |
| --- | --- | --- | --- |
| @nodable/entities | 2.2.0 | MIT | fast-xml-parser |
| @xyflow/system | 0.0.82 | MIT | React Flow |
| anynum | 1.0.1 | MIT | strnum |
| classcat | 5.0.5 | MIT | React Flow |
| core-util-is | 1.0.3 | MIT | readable-stream |
| d3-color | 3.1.0 | ISC | React Flow |
| d3-dispatch | 3.0.1 | ISC | React Flow |
| d3-drag | 3.0.0 | ISC | React Flow |
| d3-ease | 3.0.1 | BSD-3-Clause | React Flow |
| d3-interpolate | 3.0.1 | ISC | React Flow |
| d3-selection | 3.0.0 | ISC | React Flow |
| d3-timer | 3.0.1 | ISC | React Flow |
| d3-transition | 3.0.1 | ISC | React Flow |
| d3-zoom | 3.0.0 | ISC | React Flow |
| fast-xml-builder | 1.3.1 | MIT | fast-xml-parser |
| fast-xml-parser | 5.7.2 | MIT | @thatopen/components |
| flatbuffers | 25.2.10 | Apache-2.0 | @thatopen/fragments |
| immediate | 3.0.6 | MIT | lie |
| inherits | 2.0.4 | ISC | readable-stream |
| isarray | 1.0.0 | MIT | readable-stream |
| jszip | 3.10.1 | MIT or GPL-3.0-or-later. Enthalix uses it under MIT. | @thatopen/components |
| lie | 3.3.0 | MIT | jszip |
| lru-cache | 11.1.0 | ISC | @thatopen/fragments |
| pako | 1.0.11 and 2.1.0 | MIT and Zlib | jszip, @thatopen/fragments |
| path-expression-matcher | 1.6.2 | MIT | fast-xml-parser |
| process-nextick-args | 2.0.1 | MIT | readable-stream |
| readable-stream | 2.3.8 | MIT | jszip |
| robust-predicates | 3.0.3 | Unlicense | polygon-clipping |
| safe-buffer | 5.1.2 | MIT | readable-stream |
| scheduler | 0.27.0 | MIT | React DOM |
| setimmediate | 1.0.5 | MIT | jszip |
| splaytree | 3.2.3 | MIT | polygon-clipping |
| string_decoder | 1.1.1 | MIT | readable-stream |
| strnum | 2.4.2 | MIT | fast-xml-parser |
| three-mesh-bvh | 0.9.9 | MIT | @thatopen/components |
| use-sync-external-store | 1.7.0 | MIT | zustand |
| util-deprecate | 1.0.2 | MIT | readable-stream |
| xml-naming | 0.3.0 | MIT | fast-xml-builder |
| zustand | 4.5.7 | MIT | React Flow |
| @types/d3-color, @types/d3-drag, @types/d3-interpolate, @types/d3-selection, @types/d3-transition, @types/d3-zoom, @types/react, @types/react-dom, csstype | various | MIT | React Flow. These are type definitions only, with no run-time code. |

### Compiled into web-ifc's WebAssembly

web-ifc's build (release 0.77) compiles these libraries into its WebAssembly
files.

| Component | Licence |
| --- | --- |
| [fast_float](https://github.com/fastfloat/fast_float) | Apache-2.0, MIT or BSL-1.0 |
| [tinynurbs](https://github.com/QuimMoya/tinynurbs) (a fork) | BSD-3-Clause |
| [GLM](https://github.com/g-truc/glm) | MIT, or the Happy Bunny Licence |
| [earcut.hpp](https://github.com/mapbox/earcut.hpp) | ISC |
| [CDT](https://github.com/artem-ogre/CDT) | MPL-2.0 |
| [spdlog](https://github.com/gabime/spdlog), with [{fmt}](https://github.com/fmtlib/fmt) | MIT |
| [stduuid](https://github.com/mariusbancila/stduuid) | MIT |

## Data included in the application

| Data | Source | Terms | How Enthalix uses it |
| --- | --- | --- | --- |
| Residential energy-code values by IECC edition (2006–2024) and climate zone: `program/src/modules/bem/reference/pnnl-*.csv` | The Residential Prototype Building Models developed by Pacific Northwest National Laboratory (PNNL) for the U.S. Department of Energy (DOE), [energycodes.gov](https://www.energycodes.gov/prototype-building-models) | DOE publishes the information on its websites as public domain and asks that DOE be acknowledged in any later use ([energy.gov/web-policies](https://www.energy.gov/web-policies)). Enthalix acknowledges DOE and PNNL here and in the app, under BEM › SITE › energy code. DOE and PNNL do not endorse Enthalix. | The default values when no energy-code table of the user's own is on record. The window, skylight, slab, air-leakage and thermostat values are those the prototypes state. The wall, ceiling, floor and basement-wall U-factors are those EnergyPlus computed for the prototypes' assemblies. Each value cites the prototype file it was read from. `program/scripts/pnnl-codes/` re-reads them from the published files. |

The prototypes model codes as published. They are not a state's adopted code.

## The application runtime

| Component | Version | Licence | How Enthalix uses it |
| --- | --- | --- | --- |
| [Electron](https://github.com/electron/electron) | 44.1.0 | MIT | The desktop application. Electron includes Chromium, V8, Node.js, FFmpeg and other components. Their licences are listed in `LICENSES.chromium.html`, which comes with every Electron build. FFmpeg is LGPL-2.1-or-later and is included as a separate, replaceable library (`libffmpeg`). |

## Programs Enthalix runs but does not include

| Component | Licence | How Enthalix uses it |
| --- | --- | --- |
| [EnergyPlus](https://github.com/NatLabRockies/EnergyPlus) | EnergyPlus licence (BSD-3-Clause-style, with a clause on the use of the EnergyPlus name) | The simulation engine. The user installs it, and Enthalix runs it as its own program. Enthalix reads the schema (`Energy+.idd` and `Energy+.schema.epJSON`), the `DataSets`, an example file and the `WeatherData` folder from that installation. "EnergyPlus" is a trademark of the US Department of Energy. Enthalix is not affiliated with or endorsed by the Department of Energy. |
| [OpenFOAM](https://www.openfoam.com) (openfoam.com's releases; on macOS the [OpenFOAM app](https://github.com/gerlero/openfoam-app)) | GNU General Public License v3.0 | The airflow solver for BOM › CFD. The user installs it, and Enthalix runs it as its own program: BIM-BEM-BOM writes each case as plain text files in a run folder, runs OpenFOAM's own commands on it through OpenFOAM's launcher, and reads the results back from that folder. Nothing of OpenFOAM is included in, linked into or distributed with BIM-BEM-BOM. OPENFOAM® is a registered trade mark of OpenCFD Limited, producer and distributor of the OpenFOAM software. This offering is not approved or endorsed by OpenCFD Limited, producer and distributor of the OpenFOAM software and owner of the OPENFOAM® and OpenCFD® trade marks. |
| unzip ([Info-ZIP](https://infozip.sourceforge.net/)) | Info-ZIP licence | The operating system's own `unzip` unpacks downloaded weather archives. |

## Data and web services used at run time

Nothing from these sources is shipped with Enthalix. The application contacts
them while it runs.

| Source | Licence or terms | How Enthalix uses it |
| --- | --- | --- |
| [EnergyPlus weather repository](https://energyplus.net/weather) (`weather/master.geojson` in the EnergyPlus repository, pinned commit `87ed919`) | The listing: the EnergyPlus licence. Each weather data set keeps its own terms, stated on the [sources page](https://energyplus.net/weather/sources). | The station map lists every location; the file the user picks is downloaded into the user's `Weather/` folder. |
| [NOAA Global Historical Climatology Network hourly (GHCNh)](https://www.ncei.noaa.gov/products/global-historical-climatology-network-hourly) | CC0-1.0 (NOAA) | Downloads NOAA's station list and the hourly observations of the reporting station nearest the site, and keeps them, to build an actual-year weather file. Citation: Menne, M. J., et al. (2023). *Global Historical Climatology Network-Hourly (GHCNh)*. NOAA National Centers for Environmental Information. https://doi.org/10.25921/jp3d-3v19 |
| [Open-Meteo](https://open-meteo.com/) historical weather API | Data under [CC BY 4.0](https://open-meteo.com/en/licence): "Weather data by Open-Meteo.com". The free API may be used **for non-commercial purposes only** ([terms](https://open-meteo.com/en/terms)). | Downloads the sun, sky and rain of an actual year at the site, for calibration against utility bills. For paid work, use a source whose terms allow it, or your own actual-year weather file. |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) map tiles (tile.openstreetmap.org) | Map data © OpenStreetMap contributors, under the [ODbL](https://opendatacommons.org/licenses/odbl/). Use follows the [OSMF Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/). | Draws the site map. The map shows the attribution. |
| [Nominatim](https://nominatim.org/) (nominatim.openstreetmap.org) | OpenStreetMap data under the ODbL. Use follows the [OSMF Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/). | Finds the coordinates of an address the user types. |
| [openstudio-standards](https://github.com/NatLabRockies/openstudio-standards) materials catalogue (`ashrae_90_1.materials.json`, commit `c8479fa`) | OpenStudio licence (BSD-3-Clause-style, with a clause on the use of the OpenStudio name). © 2008-2023 Alliance for Sustainable Energy, LLC. | Downloaded once, and kept, to seed the materials library. |
| US county boundaries ([plotly/datasets](https://github.com/plotly/datasets), `geojson-counties-fips.json`) | MIT | Downloaded once, and kept, to find the project's county. |
| [EnergyPlus Input Output Reference](https://bigladdersoftware.com/epx/docs/), the HTML edition by Big Ladder Software | © Big Ladder Software LLC, all rights reserved | Its index page is downloaded so that each EnergyPlus object can link to its page in the reference. Enthalix links to the pages and does not copy their content. |
| [Google Maps](https://www.google.com/maps) | Google's terms, between Google and the user | Links only: a button opens Google Maps at the site in the user's own browser through Google's documented Maps URLs. Nothing of Google's is shown in the app. |

## Data owned by others in the materials library

Enthalix ships no material, standard or product data belonging to others. The
materials library (`data/materials.db`) is built on the user's computer:

- **ASHRAE Handbook of Fundamentals (2005) materials**, 270 rows, read from
  `DataSets/ASHRAE_2005_HOF_Materials.idf` in the user's own EnergyPlus
  installation. The file states that it contains content from the Handbook and
  carries no permission statement. The numbers are ASHRAE's.
- **openstudio-standards materials catalogue**, downloaded once (see the table
  above). Most of its rows cite the California Energy Commission's Title
  24-2013.

The right to use these numbers in your work, and any standard, code or product
value you type in yourself, is yours to obtain from the publisher. Enthalix
grants no right to them. The app says this on the start-up page and on each
affected row's tooltip.

## Sample data

| File | Source | Licence |
| --- | --- | --- |
| `samples/Duplex_A_20110907.ifc` | The "Duplex Apartment" model, from the [buildingSMART community sample files](https://github.com/buildingsmart-community/Community-Sample-Test-Files), commit `7ddf57a`. Included unmodified. | © the original authors, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
