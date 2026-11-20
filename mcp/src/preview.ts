// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// PREVIEW A RULING (release 2): the model as it would be if one BEM ruling were applied — built the way the app's Apply builds it,
// in memory, and compared with the model as it stands. The app's Apply COMMITS the rulings it holds (with the library objects the
// build reads and the weather) into idf.db and builds the model from idf.db alone (modules/bem/core/modelStore.ts); here the same
// commitModel and buildFromStore run on a copy of idf.db's bytes that is never saved. Nothing is written: not idf.db, not the
// ledger, not bem.db. A change is a ruling in the ledger's own words — a section of the BEM rulings, a key in it, a value.
import fs from "node:fs";
import path from "node:path";
import { commitModel, buildFromStore, readModelInputs, type ModelWeather } from "../../program/src/modules/bem/core/modelStore.js";
import { writeIdf } from "../../program/src/modules/bem/core/bemIdf.js";
import { parseIdfObjects } from "../../program/src/modules/bem/core/idfLib.js";
import { DEFAULT_EPW, type WeatherRead } from "../../program/src/modules/bem/core/weather.js";
import type { BemLedger } from "../../program/src/modules/bem/core/bemDb.js";
import type { BuiltModel } from "../../program/src/modules/bem/core/bemModel.js";
import { Refusal, sql, projectDb, needDb, openIfcSha, rows, type ReadFrom } from "./project.js";
import { buildEnv, engines } from "./environment.js";

/** the BEM ruling sections a preview may change; the weather (a file), the SYSTEMS sheet (a drawing) and the geometry corrections
 *  (they re-derive idf.db) are not previewed in this release */
export const PREVIEW_SECTIONS = ["site", "zones", "constructions", "ground", "schedules", "holidays", "gains", "sideApprovals"] as const;
export type PreviewSection = (typeof PREVIEW_SECTIONS)[number];
export interface Change { section: PreviewSection; key?: string; value: unknown }

const CAP = 40;
const idfOf = (b: BuiltModel, weather: WeatherRead | null): string => {
  const i = b.input;
  return writeIdf(i.faces, i.elements, i.zoneVolumesM3, i.site, i.trueNorth, i.sourceIfcName, weather, b.model).idf;
};

/** the applied rulings with the change made; refused, by name, when the change is not a ruling the ledger defines */
export function applyChange(ledger: BemLedger, c: Change, known: { zones: Set<string>; types: Set<string> }): BemLedger {
  if (!c || typeof c !== "object") throw new Refusal("a change is { section, key?, value }");
  if (!PREVIEW_SECTIONS.includes(c.section)) throw new Refusal(`"${String(c.section)}" is not a BEM ruling a preview may change — one of ${PREVIEW_SECTIONS.join(", ")} (the weather, the SYSTEMS sheet and the geometry corrections are not previewed in this release)`);
  if (c.value === undefined) throw new Refusal("a change needs a value (null removes the key)");
  if (JSON.stringify(c.value ?? null).length > 200_000) throw new Refusal("a change's value is over 200 kB — refused");
  if (c.section === "zones" && c.key !== undefined && !known.zones.has(c.key)) throw new Refusal(`no zone "${c.key}" in this model — the zones tool lists them`);
  if (c.section === "constructions" && c.key !== undefined && !known.types.has(c.key)) throw new Refusal(`no IFC type "${c.key}" in this file — a construction ruling is keyed by the type's name as the file states it`);
  const next = JSON.parse(JSON.stringify(ledger)) as Record<string, unknown>;
  delete next.staged;
  if (c.key === undefined) {
    if (c.value === null) { if (c.section === "zones" || c.section === "constructions") next[c.section] = {}; else delete next[c.section]; }
    else next[c.section] = c.value;
  } else {
    const sec = { ...((next[c.section] as Record<string, unknown> | undefined) ?? {}) };
    if (c.value === null) delete sec[c.key]; else sec[c.key] = c.value;
    next[c.section] = sec;
  }
  return next as unknown as BemLedger;
}

interface Obj { cls: string; name: string; fields: string[] }
function objects(idf: string): Map<string, Obj> {
  const out = new Map<string, Obj>();
  for (const o of parseIdfObjects(idf, "preview")) {
    let k = `${o.cls}|${o.name}`, n = 2;
    while (out.has(k)) k = `${o.cls}|${o.name}#${n++}`;
    out.set(k, { cls: o.cls, name: o.name, fields: o.fields });
  }
  return out;
}

export async function preview(dir: string, change: Change | null): Promise<{ result: Record<string, unknown>; read: ReadFrom[]; idfNow: string; idfAfter: string }> {
  const idfFile = path.join(dir, "data", "idf.db");
  const idfHeld = await needDb(dir, "idf");   // the schema check, and what the reply says it read
  const bytes = new Uint8Array(fs.readFileSync(idfFile));
  const SQL = await sql();
  const env = await buildEnv(dir);
  const p = await projectDb(dir);
  const sha = await openIfcSha(dir);
  const ledRow = sha ? rows(p.db, "SELECT json FROM ledgers WHERE sha=? AND kind='bem'", [sha])[0] : undefined;
  const now = new SQL.Database(bytes);
  const stored = readModelInputs(now);
  if (!stored) { now.close(); throw new Refusal("idf.db holds no model yet — open the project's BEM tabs in the app once"); }
  const ledger = ledRow ? (JSON.parse(String(ledRow.json)) as BemLedger) : stored.ledger;
  const known = {
    zones: new Set(rows(now, "SELECT name FROM zones").map((r) => String(r.name))),
    types: new Set(rows(now, "SELECT name FROM element_types WHERE name IS NOT NULL").map((r) => String(r.name))),
  };
  const next = change ? applyChange(ledger, change, known) : (({ staged: _s, ...rest }) => rest as BemLedger)(ledger);

  // THE MODEL AS IT STANDS: built from idf.db alone, as the app builds it between Applies
  const a = buildFromStore(now, env.model, env.schema)!;
  now.close();
  const idfNow = idfOf(a.built, a.weather);

  // THE MODEL AFTER THE APPLY: the commit the app makes (its weather: the one the rulings name, else the one idf.db holds), on a copy
  const named = next.weather?.epw ?? null;
  let weatherT: ModelWeather | null = stored.weather, weatherFrom = "the weather idf.db holds";
  if (named) {
    const eng = engines.findEngine();
    const f = engines.resolveEpw(named, engines.weatherDirs(dir, eng));
    if (!f) throw new Refusal(`the rulings name the weather file ${named}, found in none of the project's weather folders`);
    const ddy = f.replace(/\.epw$/i, ".ddy");
    weatherT = { path: f, epw: fs.readFileSync(f, "utf8"), ddy: fs.existsSync(ddy) ? fs.readFileSync(ddy, "utf8") : null };
    weatherFrom = `the file the rulings name, ${path.basename(f)}`;
  } else if (!weatherT) weatherFrom = `none held — the program's default ${DEFAULT_EPW} would stand in`;
  const work = new SQL.Database(bytes);
  const liveIdf = commitModel(work, { ledger: next, library: env.library, weather: weatherT, zone: stored.zone, model: env.model, schema: env.schema, tariff: stored.tariff });
  const b = buildFromStore(work, env.model, env.schema)!;
  work.close();
  const idfAfter = idfOf(b.built, b.weather);

  // THE DIFFERENCE
  const A = objects(idfNow), B = objects(idfAfter);
  const added = [...B].filter(([k]) => !A.has(k)).map(([, o]) => ({ cls: o.cls, name: o.name }));
  const removed = [...A].filter(([k]) => !B.has(k)).map(([, o]) => ({ cls: o.cls, name: o.name }));
  const changed = [...B].filter(([k, o]) => A.has(k) && A.get(k)!.fields.join("\u0000") !== o.fields.join("\u0000")).map(([k, o]) => {
    const was = A.get(k)!.fields;
    const fields = o.fields.map((v, i) => ({ field: i, was: was[i] ?? null, now: v })).filter((f) => f.was !== f.now);
    for (let i = o.fields.length; i < was.length; i++) fields.push({ field: i, was: was[i]!, now: null as unknown as string });
    return { cls: o.cls, name: o.name, fields: fields.slice(0, 8), fieldsChanged: fields.length };
  });
  const byClass = (xs: Array<{ cls: string }>): Record<string, number> => xs.reduce<Record<string, number>>((m, x) => { m[x.cls] = (m[x.cls] ?? 0) + 1; return m; }, {});
  const sa = new Map(a.built.settings.map((s) => [s.key, s])), sb = new Map(b.built.settings.map((s) => [s.key, s]));
  const settings = [...new Set([...sa.keys(), ...sb.keys()])].filter((k) => sa.get(k)?.value !== sb.get(k)?.value || sa.get(k)?.source !== sb.get(k)?.source)
    .map((k) => ({ key: k, was: sa.get(k) ? `${sa.get(k)!.value} (${sa.get(k)!.source})` : null, now: sb.get(k) ? `${sb.get(k)!.value} (${sb.get(k)!.source})` : null }));
  const ck = (c: { rule: string; subject: string; verdict: string; text: string }): string => `${c.verdict} · ${c.rule} · ${c.subject} · ${c.text}`;
  const ca = new Set(a.built.checks.filter((c) => c.verdict !== "ok").map(ck)), cb = new Set(b.built.checks.filter((c) => c.verdict !== "ok").map(ck));
  const refusedAfter = [...b.built.unresolvedConstructions, ...b.built.unresolvedSchedules, ...b.built.unresolvedSystems, ...b.built.unresolvedGains, ...b.built.unresolvedZones];
  const refusedNow = new Set([...a.built.unresolvedConstructions, ...a.built.unresolvedSchedules, ...a.built.unresolvedSystems, ...a.built.unresolvedGains, ...a.built.unresolvedZones]);
  // what already differs between the rulings the app holds and those idf.db holds — changes an Apply would carry besides this one
  const heldDiffers = Object.keys({ ...stored.ledger, ...ledger }).filter((k) => !["staged", "savedAt", "sourceIfcSha256"].includes(k)
    && JSON.stringify((stored.ledger as unknown as Record<string, unknown>)[k] ?? null) !== JSON.stringify((ledger as unknown as Record<string, unknown>)[k] ?? null));
  return {
    idfNow, idfAfter,
    result: {
      change, identical: idfNow === idfAfter,
      ...(change && idfNow === idfAfter ? { noEffect: "the IDF is the same with this change — the ruling has no effect on this model (another ruling may govern it: a zone's thermostat, for one, is set on its Zone card in the SYSTEMS sheet)" } : {}),
      storeProof: liveIdf === idfAfter ? "the model built from the committed idf.db equals the live libraries' to the byte — the app's own idf-db check" : "✗ the committed idf.db does not reproduce the live build — the app's idf-db check would fail",
      idfLines: { now: idfNow.split("\n").length, after: idfAfter.split("\n").length },
      objects: {
        added: added.length, removed: removed.length, changed: changed.length,
        addedByClass: byClass(added), removedByClass: byClass(removed), changedByClass: byClass(changed),
        addedList: added.slice(0, CAP), removedList: removed.slice(0, CAP), changedList: changed.slice(0, CAP),
      },
      settingsChanged: settings,
      checksNew: [...cb].filter((x) => !ca.has(x)), checksGone: [...ca].filter((x) => !cb.has(x)),
      notHonoured: refusedAfter.filter((x) => !refusedNow.has(x)),
      builtOn: { weather: weatherFrom, climateZone: stored.zone ? `${stored.zone.zone} (${stored.zone.county} County, ${stored.zone.state})` : "none held", tariff: stored.tariff ? "the tariff idf.db holds" : "none", environment: env.notes },
      ...(heldDiffers.length ? { alsoCarried: `the rulings the app holds already differ from the model in: ${heldDiffers.join(", ")} — an Apply would carry these too, and they are in this difference` } : {}),
      note: "built in memory as the app's Apply builds it; nothing written. Apply it in the app to make it the model.",
    },
    read: [p.from, idfHeld.from, ...env.read],
  };
}
