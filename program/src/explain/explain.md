<!--
THE EXPLAIN TEXTS — first pass, 2026-10-15, for review and editing.

How this file is read (src/explain/explainText.ts):
- "# Region" starts a region: Top bar, Rail, Levels and spaces, View, Frame, Right column.
- "## match" starts an entry. The entry is shown when the hovered header's text STARTS WITH `match` (case is ignored).
  "TAB › match" limits an entry to one tab: BIM, SITE, CONSTRUCTIONS, SCHEDULES, ZONES, SYSTEMS, RUN, BOM.
  The longest match wins. "## *" is the region's general text, shown when nothing else matches.
- Under an entry: paragraphs, "- " lists, **bold** and `code`. Blank lines separate paragraphs.
Save the file and the dialog's text updates; the model is not reloaded.
-->

# Top bar

## *
The bar across the top of the window: what the whole program works on, whatever module is open.

- **Open IFC… ▾** opens the building's IFC file (every module reads from it), or **Edit Alignment…** to move and turn a file beside the house (see Alignment).
- **fill** sets how opaque the model's surfaces are drawn.
- **surface tables** shows or hides the frame of tables under the view.
- **spaces** draws the rooms (IfcSpace volumes) in the view.
- **terrain** (or **shading** on SITE's solar view) draws the files beside the building: the site's terrain and shading elements.
- The grey text is the program's **status**: what it is doing, or did last.
- **hidden · show all** appears when you have hidden elements, levels or spaces, and shows every one of them again. The layers' eyes in FILES · LAYERS stay as you set them.
- **Show Metric / Show Imperial** switches every number you read or type between feet and metres.
- **Explain** turns this help on: hover over a section's header to read about it here. Click it again to turn the help off.
- The **gate** mark (✓ or ✗) reports the last check of idf.db against the file.

# Rail

## *
The module rail: the three modules, in the order the work flows.

- **BIM** — the building information model. Reads the IFC and writes `ifc.db` and `idf.db`: each assembly collapsed to the single plane EnergyPlus takes, carved by room.
- **BEM** — the building energy model. Builds the EnergyPlus model from `idf.db` and your rulings, runs it, and reads the results into `bem.db`.
- **BOM** — the building operations model. Prices the run with the tariff and compares it with the bills and the PV production, in `bom.db`.

The dot beside each module says whether its file is **ok** (built from the current file before it), **stale** (the file before it has changed since) or **absent** (not built yet). Click a module to open its first tab.

# Levels and spaces

## *
LEVELS · SPACES lists the building as the IFC file organises it: each level (IfcBuildingStorey) with its elevation, and under it the spaces (IfcSpace) it holds.

- Click a level or a space to select it; the view lights it, and the frame below the view shows its details.
- The **eye** shows or hides a level or a space in the view.
- The **swatch** is the colour the space is drawn in, the same in every view.
- Attic voids under the roof are listed as their own rows. Every roof is insulated, so every void under one is inside the envelope.
- On SYSTEMS and ZONES, dragging a room onto the sheet takes it **out of the Zone it was in**: a room belongs to one zone.


## FILES · LAYERS
FILES · LAYERS lists every IFC file loaded: the house, then the files beside it in its folder that are projected into it (the site, the MEP). Under each file are its own layers, as the file names them (IfcPresentationLayerAssignment, for example `A-WALL`, `M-HVAC-DUCT`, `C-TOPO`), with how many elements each holds.

- Click a bar (LEVELS · SPACES or FILES · LAYERS) to drop its list down or roll it up.
- Click a file's name to show or roll up its layers.
- The **eye** on a file shows or hides the whole file; the eye on a layer shows or hides the elements on that layer. The site, and the MEP file's exterior equipment (the PV panels), are drawn when the terrain is shown.
- An MEP layer whose elements are not drawn yet (ducts, pipes, fixtures inside the rooms) shows a grey eye. Turn it on to draw them, with or without the terrain.
- The eyes change the view only. The energy model keeps every element; to leave a file out of the model, use **Close IFC… ▾**.

# Alignment

## *
The alignment dialog places a file beside the house (the site, the MEP) against the house. Each file is first turned by its own TrueNorth against the house's; the dialog moves and turns it from there. It opens by itself the first time a file beside the house is in the model without a placement you accepted, and from **Open IFC… ▾ › Edit Alignment…** at any time.

- The dialog floats over the views: orbit, pan and zoom as usual, and drag it by its title to move it out of the way.
- **MOVE** nudges the file east, north or up by the step chosen (or type how far, and press Enter). North is the project grid's north.
- **Lock**, beside each move, holds that direction: lit, its − / + and typed value are off, and **Match a point** leaves it where it is (lock **Up** to match a point in plan alone). Click it again to unlock. The locks start unlit each time the dialog opens. A turn still turns the file about the pivot.
- **TURN** turns the file clockwise or counter-clockwise, seen from above, about the **pivot**.
- **Pick pivot…**: click a point in the IFC view. The file turns about the vertical line through it (drawn in yellow), so a point the file and the house share stays together while you turn.
- **Match a point…**: click a point on the file, then the house point it belongs on. The file moves there, and that point becomes the pivot. Then turn to bring the rest in line.
- The file moves in the views as you work; nothing is kept until **Accept**. Accept stores the placement with your corrections and in ifc.db (`site_files`: the move, the pivot and the turn), projects the files again and rebuilds idf.db. **Cancel** puts the file back. **Reset** returns it to its TrueNorth turn alone.

# View

## *
The view: the drawing in the centre of the window. The tabs above it pick what it draws; the frame under it holds the facts and tables for what you select.

Views are drawings only — tables and settings stay in the frame and the right column.

## IFC — FRAGMENTS
The IFC file drawn as the authoring tool exported it: every wall, slab, roof, window and door with its true thickness.

On BIM this is the left half of a split view, beside IDF-DB. Click the tab to collapse or show this half; the other half then takes the width.

- Click a surface, a room or a level to select it; the frame under the view names it.
- Drag to orbit; the tools at the right end of the tab row turn the view to a side or zoom it.

## IDF-DB — SINGLE PLANE
`idf.db` drawn: each assembly collapsed to the single plane EnergyPlus takes, carved by room. This is the geometry the energy model is built from.

On BIM this is the right half of a split view, beside the IFC. Click the tab to collapse or show this half.

- Selecting a surface in either half selects it in both, so you can check the plane against the file's element.

## ENERGY & COST
BOM's view: the run's months against the bills, priced by the tariff applied in UTILITY (the frame below).

## SITE · location
The site on the map, at the position the IfcSite states or the one you located. Confirm the position here; the frame says which is in force.

## SITE · weather stations
Every weather station near the site with a typical-year weather file, for picking the one the run uses. Click a station to download its files into `Weather/`; the frame below lists what is installed and which file is in force.

## IDF-DB — SITE · solar
The model with the site around it: the terrain, the shading elements and the sun's position for the day and hour set in the right column's solar studies.

## IDF-DB — SITE
The model with the files beside the building (the site and shading IFCs) as the energy model sees them. The frame below lists the files; a checkbox shows or hides one.

## PLAN
CONSTRUCTIONS' plan: the model from above, each cell painted by the file's type, or by what governs it (the code, the library or the file's own value). Click a cell to select its type.

## DETAIL
The selected construction type's assembly, drawn to scale from the file's own layers, with the U-factor the governing construction gives it. The frame below is its materials table.

## CALENDAR
The run's year as a calendar, painted by the schedule of the card selected in the right column — which days of the year, and which hours of each day, the schedule applies to. Click a month, a week or a day to go in; double-click to go back out.

The frame under it holds that schedule's **daily** values for the part picked (All Days, Weekdays, Weekends, Holiday, a season, or a design day).

## IDF-DB — ZONES
The model alone, without the site, each room painted by the Zone it belongs to on the SYSTEMS sheet. Rooms in no zone are grey.

## ASSEMBLY
The systems sheet, where a system is **assembled**: drag components from the bench under the view onto the sheet — MECHANICAL heat pumps, fans, coils, pumps and loops; ELECTRICAL PV arrays, inverters and load centers; PLUMBING water heaters and hot-water uses — and link them together: drag from one connector to another, or right-click a connector and choose **Connect to …**. The connectors are typed (water, air, location), so only compatible ones join.

Select a component to edit its EnergyPlus inputs in the right column. A red mark on a card names what is missing; hover over it. **Save** in the right column writes the sheet into the model.

## GRAPHS · ANNUAL
The run's year graphed: outside temperature, heating and cooling, ventilation, occupant loads, PV, bought and sold. The **checkboxes** pick which lines are drawn; the slider and scroll bar set the window of time (a day, a week, a month, the year).

To sum over a range: **left-click** the graph to set the first point and **right-click** to set the second. The frame below the graph sums each line drawn over that range — or at the single point, with one click. Clicking the same point again clears it.

## GRAPHS · PEAK
Peak conditioning on the design days, per structure and per zone. The frame below picks the parts.

## REPORT · ENGINE
EnergyPlus's own tabular report (`eplustbl.htm`) for the run, as the engine wrote it: end uses, component loads, sizing, envelope. A run that ended Fatal shows its error file instead.

## SURFACE TEMPERATURES
The model painted by each exposed surface's **external** (outside face) temperature — EnergyPlus's Surface Outside Face Temperature — on the winter or summer design day. It shows where the envelope runs cold or hot: areas of concern, and the effect of shading, both from the landscape (trees) and from installed systems (PV panels over the roof).

# Frame

## *
The frame: the panel under the view, holding the facts and tables for what the view shows and what you selected. Drag the line between the view and the frame to give either more height.

## IFC ·
The selected IFC element: its id, and the cell of it you clicked. Select a surface, a room or a level in the view to see it here.

## IDF-DB ·
The selected room in `idf.db`: its surfaces with their net areas (openings taken out), in the units you chose.

## LOCATION ·
The project site: the position the IfcSite states, and whether a position you located on the map is the ruling in force.

## WEATHER FILES ·
The weather file in force, the project's climate zone (from the county the site falls in) and the stations installed in the engine's WeatherData.

## SITE ·
The site files beside the building: which are projected into the model, and the trees' shade for the month shown. A checkbox shows or hides a file or a kind; right-click a file or an item to project it, hide it, delete it from the model, or turn the file.

## CONSTRUCTIONS ·
The construction types: what governs each one (the code, the library or the file's value), and on DETAIL the materials table of the selected type.

## SCHEDULES ·
The **daily schedule** of the card selected in the right column: its 24 hourly values, as applied for the part picked over the bars — **All Days**, **Weekdays**, **Weekends**, **Holiday**, **Seasonal** (a summer or winter season you set), **Summer DD** or **Winter DD** (the design days used to size the equipment).

The calendar above shows where in the year each part applies: click a month, a week or a day to go in, double-click to go back out.

**Editing:** click an hour's bar and type its value; **Enter**/**Tab** to the next hour; right-drag from a bar to copy its value across. Then type a **Name** and **Save as yours** — the copy goes to your library and is staged for the role (**Apply** in the column). Blank hours are counted, with a button to set them to 0.

**Holidays:** pick **Holiday**, and choose the project's list under the graph — none, the US federal holidays, a list of yours, or **Custom…** (give it an ID and click days in the calendar). **keep in your library** saves a custom list (`data/calendars-user.json`). One list serves every schedule in the project; Apply in the column.

**Seasons:** pick **Seasonal**, and choose the schedule's season — Summer (Jun 1 – Sep 30), Winter (Dec 1 – Mar 31) or a custom one. On the season's days it replaces Weekdays, Weekends and Holiday.

## ZONES ·
The selected zone's settings — occupancy, envelope, lighting, loads. Every room in the zone takes them; a room's own ruling overrides its zone's. Pick a zone in the right column, or a room in the view.

## OCCUPANCY
The zone's people: how many, their activity, and the schedule they follow.

## ENVELOPE
The zone's envelope: infiltration and the surfaces that bound it.

## LIGHTING
The zone's lighting power and its schedule.

## LOADS
The zone's plug and process loads, and any overrides of the defaults.

## SYSTEMS ·
The systems sheet's components: how many are on the sheet and whether any were refused by the writer. Below it, the bench: the components you drag onto the sheet, by shelf.

## ZONE EQUIPMENT
Bench shelf: equipment that serves a zone directly — a heat pump unit, an ERV, a baseboard.

## AIR LOOP
Bench shelf: the parts of a ducted air system — fans, mixers, the loop's controls.

## COILS
Bench shelf: heating and cooling coils, placed in a unit or a loop.

## PLANT LOOP
Bench shelf: the water side — pumps, ground heat exchangers, pipes.

## RESOURCE
Bench shelf: supporting objects — schedules, curves, the ground.

## GENERATION
Bench shelf: PV arrays and other generators.

## INVERTERS
Bench shelf: the inverters between the PV and the building's power.

## DISTRIBUTION
Bench shelf: load centers (drag a space from LEVELS · SPACES onto one to put its zone on it; right-click a zone on the card to unassign it), meters (a load center's Grid wired to a meter puts its zones on that meter) and the utility connection.

## WATER HEATERS
Bench shelf: tanks and heat-pump water heaters.

## HOT-WATER USE
Bench shelf: the uses the water heaters supply — sinks, showers, appliances.

## DOMESTIC WATER
Bench shelf: the cold-water supply and its mains temperature.

## RUN ·
The graph's settings and sums: for ANNUAL, each line drawn summed over the window in view and over the range or point picked on the graph; for PEAK, the parts and loads drawn. The run named is the one shown.

## BOM ·
BOM's frame, by its rail: UTILITY (the tariff cards), WEATHER (the weather the run used, and an actual year) or BILLS (the bills imported).

## UTILITY
The tariff cards: select one for its charges, its power cost adjustment and Apply, in the right column. The **Sample** card prices the run until you apply a card of your own. It holds example values of a residential rate with net metering, not any utility's.

## WEATHER
The weather the run used, and the **calibration-year** (actual-year) weather file, made here for the bills' period:

- **Measured hours** — temperature, dew point, pressure and wind — from NOAA's hourly station archive (GHCNh) for the nearest reporting station to the site (one with an ICAO or WMO id, within 150 km).
- **Sun, sky and rain** at the site from the Open-Meteo historical archive. **Open-Meteo's free API is for non-commercial use only**: for paid work, use an actual-year weather file you have the right to use, with **Run on my own weather file…** on the calibration card.
- **Gaps** in the station's record: short ones are filled from the neighbouring hours; gaps longer than 6 hours are filled from the archive's own values, and every fill is counted in the file's comments.
- The **header** — location, design conditions, ground temperatures — and the design days come from the typical-year file; every hour is in local standard time.

The file is saved in `Weather/` and used for the calibration run. The archive trails today by about six days, so the period must end before then.

## BILLS
The utility bills you entered or imported, month by month.

# Right column

## *
The right column: the selected module's tabs and the inputs and rulings for that tab. Each input is typed in one place only, and shown read-only everywhere else.

Sections fold: click a header to open or close it; the program remembers which are open. Drag the column's left edge to make it wider.

## IDF-DB EDITING
BIM's one tab: how the IFC's elements become `idf.db`'s planes, and the corrections you rule on.

## SITE
BEM's first tab: the building type, the location, the weather file, the design days, the run period, the ground and the simulation settings.

Changes on this tab are **staged** first: they show in amber, are kept on disk as you work, and change nothing in the model. Clicking **Apply** commits them to `idf.db` — the record the EnergyPlus input file is written from — and the model is rebuilt from it. **revert** drops what is staged.

## CONSTRUCTIONS
A construction for each kind of surface: the file's own U-values, the library's constructions, or the code's defaults.

**Roofs.** A roof the file does not define is a standard flat roof: built-up asphalt roofing outside, insulation to the code's U, gypsum inside. A **green roof** — a roof type whose outermost layer the file names as planting or soil (grass, sedum, soil…) — is written as EnergyPlus's vegetated roof (*Material:RoofVegetation*): the plants and soil of the engine's own example green roof, the soil as thick as the file states, an EPDM membrane, then insulation to the code's U. A model with a green roof runs at 12 timesteps an hour, as the engine asks.

Changes on this tab are **staged** first: they show in amber, are kept on disk as you work, and change nothing in the model. Clicking **Apply** commits them to `idf.db` — the record the EnergyPlus input file is written from — and the model is rebuilt from it. **revert** drops what is staged.

## SCHEDULES
The schedules each role runs on (occupancy, lighting, equipment, thermostat…): the engine's own **reference** schedules, or **custom** schedules of your own — an edited copy saved to your library. Which days of the year a schedule applies to is shown in the calendar view and the frame under it.

Changes on this tab are **staged** first: they show in amber, are kept on disk as you work, and change nothing in the model. Clicking **Apply** commits them to `idf.db` — the record the EnergyPlus input file is written from — and the model is rebuilt from it. **revert** drops what is staged.

**To change the schedule a role runs on:** open the dropdown on the role's card and pick one — the code default, one of the engine's schedules (grouped by file), or one of yours (under *your schedules*). The card turns amber; **Apply**.

**To edit a schedule, or make a new one:**
1. Click the role's card. The calendar paints its schedule, and the frame under the view shows its hours.
2. In the frame, pick the part to edit — **All Days**, or **Weekdays**, **Weekends**, **Holiday**, **Seasonal**, **Summer DD**, **Winter DD**. On an All Days schedule, picking another part splits it into parts.
3. Click an hour's bar and type its value (a fraction 0–1, or a temperature). **Enter** or **Tab** moves to the next hour, **Shift** back, **Esc** closes. Right-drag from a bar copies its value across the bars you pass. **×** puts an hour back.
4. Type a **Name** and click **Save as yours**. The edited copy is saved to your library (`data/schedules-user.idf`), appears under *your schedules* in every card's dropdown, and is staged for the role — **Apply** to use it. A role on the code default offers **start a new schedule…**, a blank profile to type in. **discard edits** drops the edits.

To change a schedule of yours, edit it and save it again under its own name.

## ZONES
What each zone runs on — conditioning, thermostat, infiltration, people and loads — and which rooms each zone holds.

A **zone** is one or more rooms that EnergyPlus treats as one air volume, on one thermostat. Every room in no zone is its own zone.

**To combine rooms into zones:**
- **Zones by level** makes one zone per level, named for it, holding that level's rooms that are in no zone yet (the attics stay their own zones). This is the quickest start — for the sample file, one zone for Level 1 and one for Level 2. Then adjust by hand.
- **By hand:** right-click a room that is in no zone (in LEVELS · SPACES, on any tab) and pick the zone it joins. Or, on **SYSTEMS › ASSEMBLY · MECHANICAL**, drag a room from LEVELS · SPACES onto a zone's card — or onto an empty part of the sheet, which makes a new zone holding it.
- **To take a room out:** click **×** beside it on the zone's card, or right-click it and choose **Un-assign … from …**.
- **To make, rename or delete a zone:** on SYSTEMS › ASSEMBLY · MECHANICAL, drag the **Zone** tile from the bench's ZONE EQUIPMENT shelf onto the sheet; select a card to rename it (its name and **ID** in the column); select a card and press **Delete** to delete it — its rooms return to no zone.

Zone changes are staged until **Save · n changes** (here or on SYSTEMS), which writes the zones and the systems sheet into `idf.db`, the record the EnergyPlus input file is written from; **revert** drops them. The room gains (people, lights, equipment, the **Bed** ticks) are staged in the frame below the view and applied with **Apply · n gain rulings**.

**What serves a zone:** the **system** column of the zones table picks it for a zone that is a single room; a zone drawn on the sheet is served by what its card is joined to on SYSTEMS (see SYSTEMS). A conditioned zone served by nothing runs on ideal loads.

## SYSTEMS
The mechanical, electrical and plumbing systems. Each is **assembled in the view**: drag components from the bench under the view onto the sheet, and link their connectors — drag from one connector to another, or right-click a connector and choose **Connect to …** — to define the system. Select a component on the sheet: its EnergyPlus inputs are shown in this column for editing.

The sheet is saved with **Save · n changes**, which writes it — and the system it compiles to — into `idf.db`, the record the EnergyPlus input file is written from; **revert** puts the drawing back to the saved one.

**To assign zones to a card — for example Ideal loads:**
1. Open **ASSEMBLY · MECHANICAL** (the view tab). The zones are cards on the sheet (see ZONES for making them).
2. Drag **Ideal loads** from the bench's ZONE EQUIPMENT shelf onto the sheet.
3. Join its **Loc** connector to a zone card's **Loc**: drag from one to the other, or right-click the connector, choose **Connect to …**, and click the zone's Loc. Repeat for each zone it serves — one card can serve many zones; a zone takes one.
4. The card shows **serves …**, and so does the column when it is selected. **Save · n changes**.

A card that serves no zone is refused, and the refusal says so ("… serves no zone — join its Loc to a Zone's"). Equipment with air connections (an air terminal, a unit) joins the zone's **Air in**, and an exhaust fan its **Air out**.

## RUN
Build the model, check it, run EnergyPlus, and read the results.

The model the run uses is the one applied on the other tabs. **Run EnergyPlus** turns red when the results are out of date: no run yet, the last run failed, the model changed since, or something is staged and not applied.

On a computer without a graphics card (a virtual machine, a remote desktop, a build server), EnergyPlus cannot cast shadows by PixelCounting and uses polygon clipping instead. The RUN column then says so: non-convex surfaces cast no shadow and are reported as Severe errors, and the year's results differ slightly from a run on a computer with a graphics card.

When something stands in the way of the run (a change staged and not applied, the energy code's values incomplete, no envelope, no EnergyPlus), clicking **Run EnergyPlus** opens a box that names each reason, with a button to the tab where it is resolved. The box stays open while you work and closes by itself once nothing is left in the way.

## OPERATIONS
BOM's one tab: the tariff, the bills and the PV, and the calibration year.

## MECHANICAL
SYSTEMS' mechanical sheet: heating, cooling and ventilation, assembled from the bench.

## ELECTRICAL
SYSTEMS' electrical sheet: power, lighting and generation (PV).

## PLUMBING
SYSTEMS' plumbing sheet: domestic hot water and domestic water.

## BIM › project
The project this IFC belongs to (its IfcProject) and its versions. Your rulings follow the project from one version of the file to the next.

## BIM › file changed
The IFC changed since your rulings were made: the changes found, and the rulings that need you to decide whether they still apply.

## BIM › single surface placement
In the IFC, each wall, roof, floor and window is a layered assembly with a thickness. The energy model needs it as **one plane**. For each category, choose where that plane lies:

- **I** — the inside face (the room side)
- **M** — the middle of the assembly
- **E** — the exterior face

The choice moves every plane of that category, and the rooms' areas and volumes follow it. Hover on the header for the choices in force.

**match vertices** moves each boundary corner onto the line where its plane meets the adjoining wall, roof or floor. Each plane keeps its direction, and the planes close against each other without gaps.

## BIM › storey alignment QA
The storey alignment QA lists every place where a wall stands over a wall on the storey below, **parallel but offset** — a foundation wall under a framed wall, for example. Two parallel planes have no line of intersection, so the program cannot join them by itself and invents nothing: each pair is your ruling. Click a row to light the walls in the views.

- **Keep (strip between)** — both walls stay where the file put them. A horizontal strip, whose four corners are the two walls' own vertices, closes the offset and meets both walls exactly. The envelope gains that small ledge as a surface; no wall moves and no room changes size.
- **Align to upper** — the LOWER wall's whole plane slides onto the upper wall's. The wall below leaves the coordinates the file authored; the rooms behind it gain or lose floor area and volume (the offset × the wall's length), and the floor edges and partitions that meet it follow it, since the program solves them after the ruling. No strip is needed.
- **Align to lower** — the UPPER wall's plane slides onto the lower one's, with the same effects on the rooms above.

Choose **Keep** when the offset is real (a thicker wall below, a real ledge); choose an **Align** when the offset is a drafting difference that should not be in the energy model. Rulings are staged; **Apply** applies them, before any other correction (an alignment moves a whole plane). **set all** rules every row at once. Each ruling is kept with the file and listed under **corrections**, where it can be restored.

## BIM › wall QA
The wall QA checks every exposed exterior wall plane on its four boundaries — the top, the bottom and the two ends — and says whether each is sealed against what it should meet. The header counts the walls with a **gap**.

The table, one row per wall: **dir** the way it faces (on the project grid) · **above** and **below** its area above and below grade (against fill named) · **lost** authored length the wall lost from its exterior face · **gap** its widest open boundary · **open boundary → meets** which boundaries are open and what each should meet. A bottom open at ground level, meeting nothing, is not a defect.

To correct a gap:
- Click the row: the wall lights in the views.
- In the IDF-DB view, right-click the wall and choose **Select Extend to Surface**, then click the surface it should reach (a roof, a slab, the wall at the corner). The wall's facing edge moves onto the line where the two planes meet; the wall stays in its own plane. The target must actually cover that place, or the move is refused and said.
- **Undo Last**, at the foot of the same menu, takes back the last extension. Every extension is kept with the file and listed under **corrections**, where it can be restored.
- A gap between stacked walls is ruled in the **storey alignment QA** instead.

## BIM › spaces
The spaces QA lists every zone the model will have: each room (IfcSpace) the file names, and each attic or floor void the program builds over a room with a roof or floor above it. It checks whether each zone is **enclosed** — EnergyPlus's own test: every edge of every surface shared by exactly two of the zone's surfaces. The header counts the zones that are closed.

The table: **assign to** · **zone** (✓ when closed) · **surfaces** the number that bound it · **closed %** the share of its boundary that is shared · **gap** (in your units) open length with a parallel edge of the same zone close by — the two sides of one gap, usually a wall or floor thickness · **missing** (in your units) open length with no counterpart — a surface the zone does not have, such as a missing ceiling. Click a row to light the zone's surfaces.

EnergyPlus runs a zone that is not enclosed, with a warning; the QA shows where the boundary is open. To correct:
- **assign to** merges a zone into another — a stair or a corridor into the room it opens to, a void into its room; the surfaces between them become that zone's internal partitions. Staged in amber; **Apply** applies.
- **Extend Space to Space**: with **spaces** on in the top bar, right-click a room's face in a view and choose **Select Extend Space to Space**, then click the face of the room it should meet. The room's face moves to the other's; the room stays a closed solid.
- Gaps that come from walls are corrected in the **wall QA** (Extend to Surface).
- A **?** beside a space's name in LEVELS · SPACES asks where an attic's insulation is; right-click it to answer.

A space the file draws **on the roof** (a roof area modelled as a space) is not a room: the roof under it is the building's top. LEVELS · SPACES lists it as *on the roof, not a room*.

The **Attic** zones: over each room whose ceiling has a roof or floor above it, the program builds the column from the top of the ceiling to that plane, carved like a room. A cathedral ceiling that lies under its roof takes the roof as its ceiling, and gets no attic.

## BIM › corrections
The corrections ledger: every ruling and hand edit made on this file, in order — storey alignment rulings, wall and space extensions, glazing and void rulings. They are kept with the file in the project store, keyed to the IFC's content, and applied again every time it is opened, so a wall extended by hand stays extended. A ⚠ marks a correction that failed.

**Restore** puts one correction back to the file as authored; the geometry rebuilds from that point.

## SITE › location
The site's latitude, longitude and elevation from the IfcSite, or the position you located on the map.

## SITE › building type
The kind of building being modelled. It decides the inputs that follow: **Residential**, for example, marks bedrooms (the **Bed** checkboxes on ZONES), which set the whole-house ventilation rate, the occupants and the hot-water use.

Only **Residential** is active now. Commercial, Industrial, Healthcare, Laboratory and Other are listed greyed until their inputs are built.

## SITE › weather file
The typical-year weather file the run uses (`.epw`), from EnergyPlus's weather repository on the station map, or a file you picked. **Find…** opens the station map; **Browse…** picks a file.

## SITE › design days
The design days the `.ddy` beside the weather file states, and the ones picked for sizing the equipment.

## SITE › run period
The days of the year the run covers.

## SITE › ground temperature
The ground temperatures under the building's floors and walls, by month, and where they come from.

## SITE › solar studies
Turns on the site view with the terrain, the shading elements and the sun, for a month, day and hour you set.

## SITE › simulation
The engine's settings: timesteps per hour, the shadow calculation, the terrain and the solar distribution. The code defaults govern until you rule otherwise.

## SITE › energy code
The energy code your project is under: its edition and the climate zone your county's row in the code states, which you enter. Until you choose one, the project reads the **DOE/PNNL prototype values** that ship with BIM-BEM-BOM, for the 2021 IECC; **Choose…** offers every edition from 2006 to 2024. They are public domain, and hovering on the code's name shows the notice acknowledging DOE and PNNL. They are the prototypes' values, not a state's code. **Choose…** also has **Find…**, which opens the code adopted by your state and county in your browser, and **Edit values…**, which opens a table where you enter your own code's values, with the table or section of the code each is from: each U-factor, the SHGC, slab insulation, air leakage and the reference thermostat. You can also copy a prototype edition and change what differs. Your values are kept in `data/energy-codes/`. The code's values govern every input you have not ruled. If a code of your own is missing a value, the model is still built, so ZONES, SCHEDULES and SYSTEMS can be set up, but it cannot run, and RUN names the missing values.

## CONSTRUCTIONS › Roof
The roof's construction types (skylights included), with the area of each and what governs its U-factor.

## CONSTRUCTIONS › Ceiling
Ceilings between a space and an attic void above it.

## CONSTRUCTIONS › Wall
The wall construction types.

## CONSTRUCTIONS › Window
The window types: U-factor, SHGC and VT, from the file, the library or the code.

## CONSTRUCTIONS › Door
The door types, and the share of glass in each.

## CONSTRUCTIONS › Floors
The floor types, those on the ground included.

## SCHEDULES › assignment
The schedule each role runs on: the code default until you pick one of the engine's own schedules.

## SCHEDULES › library
Every schedule you can pick: the engine's own, read from its files (its DataSets and its single-family example), and yours. Filter by role (**fits …**) or by name. Clicking a row shows the schedule as the engine reads it; the pick itself is made in the dropdown on the role's card above.

## ZONES › ZONES ON THE SYSTEMS SHEET
The zones drawn on the SYSTEMS sheet, one card each, with the rooms it holds. Click a card for its settings in the frame below the view.

- **Creating a zone**: on SYSTEMS › MECHANICAL, drag a **Zone** card from the bench's ZONE EQUIPMENT shelf onto the sheet, or drag a room from LEVELS · SPACES onto an empty part of the sheet (that makes a zone holding it).
- **Deleting a zone**: select its card on the sheet and press **Delete** (or Backspace); its rooms return to no zone.
- **Renaming a zone**: select its card; its name and **ID** are in the column.
- **Zones by level**: one zone per level, holding the level's rooms in no zone, each joined to the sheet's **Ideal loads** card when it has one — staged until Save.
- **Assigning rooms**: right-click a room that is in no zone (in LEVELS · SPACES, on any tab) and pick the zone; or drag the room onto the zone's card on the sheet. Right-click a room in a zone to **Un-assign** it.
- **Bed** (residential): tick each room that is a bedroom. The bedrooms set the whole-house ventilation rate (ASHRAE 62.2: bedrooms + 1), count in the occupants (Building America, 2014) and in the hot-water use of the dwelling (30 + 10 × bedrooms gal/day). Rooms named "Bed n" start ticked. Ticks are applied with **Apply · n gain rulings**.

## SYSTEMS › system QA
**QA** — quality assurance: the eight checks every saved model's systems are put through, read from the EnergyPlus input as written. Each card on the sheet shows ✓ when it passes, or ✗ and the number of gaps; hover for the checks.

1. a fluid loop has a pump on its supply side
2. every node named is named twice — nothing dangles
3. both sides of a loop are populated
4. producers on the supply side, consumers on the demand side; every water side on a loop
5. an air loop has its supply path, its return path and a terminal per zone
6. a zone with equipment has one equipment list and its connections; every conditioned zone has something serving it
7. every control has its setpoint
8. sizing once for every zone, air loop and plant loop

The header counts the rows checked and the gaps.
## SYSTEMS › MECHANICAL
The selected component's settings. The code default governs each subsection until it is ruled; the engine's fields are read-only until then.

## SYSTEMS › ELECTRICAL
The electrical sheet: power, lighting and generation.

## SYSTEMS › PLUMBING
The plumbing sheet: domestic hot water and domestic water.

## RUN › the model, as written
The EnergyPlus input file as written from `idf.db` and your rulings: its zones, surfaces and lines.

## RUN › checks
Checks of the model as built: rules that pass, items to look at, and notes.

## RUN › run
Runs EnergyPlus on the model with the weather file in force. The last run's result is shown as Fatal / Severe / Warning counts.

## RUN › results
The annual energy by fuel and end use, from the last run.

## RUN › peak demand
The peak demand for each fuel and when it happened, and the design loads.

## RUN › unit sizing
The engine's own sizing of each unit and coil.

## RUN › runs
Every run on record, by date.

## BOM › BOM · OPERATIONS
BOM's column, step by step. **Print / Save PDF…** prints the tariff, the bills against the model and the months' cost.

## BOM › 1 · schedules
The operating schedules. For now the run uses the code's thermostat all year.

## BOM › 2 · tariff
The tariff and the PV. Select a tariff card in UTILITY (frame below) for its charges. Until you apply one, the Sample card prices the run. **Search…** finds the utility that serves the site, in your browser: the U.S. Utility Rate Database (OpenEI) for the ZIP code, and a web search for the county's utility. Enter its schedule as a card of your own (`data/tariffs/tariff.json`). The PV is on BEM › SYSTEMS › ELECTRICAL.

## BOM › 3 · bills
The bills: typed from the statement or imported as CSV, the weather they are compared under, and **Compare with the run**.

## BOM › 4 · calibration
The calibration year: the model run on that year's **actual weather** (a calibration-year file made from the station's measured hours and the archive's sun and sky — see WEATHER in the frame below) and compared with the bills by ASHRAE Guideline 14's statistics (CVRMSE and NMBE).

## BOM › against BEM's run
The typical-year run compared with the bills. This is a comparison, not a calibration: a typical year's weather is not the bills' weather.

## BOM › power cost adjustment
The power cost adjustment, typed from a bill: it changes month to month, so the tariff takes it from the bill.

## BOM › net metering
How the PV's exported energy is credited under the tariff's net-metering schedule.
