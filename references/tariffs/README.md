# Tariffs

BIM-BEM-BOM prices the simulated year, and your utility bills, with your utility's
own rate schedule. Every utility publishes its own, and you transcribe yours once.

Until you apply a card of your own, a **Sample** card prices the run. It ships
with the program in `program/src/modules/bom/reference/sample-tariff.json` and
holds example values of a residential cooperative rate with net metering. They
are not any utility's rates. To find your own utility and its schedule, use
**Search…** in BOM › 2 · tariff & PV. It opens the U.S. Utility Rate Database
(OpenEI) for the site's ZIP code, and a web search for the county's utility.

1. Copy `tariff.template.json` to `tables/tariffs/tariff.json` in your project's
   folder (create the folder).
2. Open your utility's published residential rate schedule and its net metering
   schedule, usually PDFs on the utility's website.
3. Fill in every `value`, with the schedule's section in `cite` and the
   document's address in `url`. A number without its citation is refused.
4. Set `summerMonths` and the `demandWindow` hours as the schedule states them.
5. Change `status` to `"in force"`.

The app reads the file when it starts. BOM › UTILITY lists the card, or says
which values it refused. Apply your card, and it replaces the Sample.

## What the arithmetic covers

- A monthly customer (access) charge.
- Delivery and supply charges per kWh, with summer and other-month supply rates.
- A demand charge per kW of billing demand, measured in the schedule's hours.
- A power cost adjustment per kWh, typed from your bills because it changes monthly.
- Net metering with monthly netting: surplus kWh are banked as credits and
  applied to later months. At the end of each 12-month net metering period,
  only credits up to that period's billed consumption carry forward.

Schedules with tiered energy blocks, time-of-use periods or other net metering
rules aren't covered yet.
