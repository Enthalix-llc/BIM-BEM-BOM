// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE MODEL'S CHECKS (the user, 2026-10-06: "Why don't we save any check needed in the db so that these checks are straight
// forward?"). Each build asks the same questions of the model as written and keeps every answer — the ones that passed too — in
// bem.db's `checks` table, so a question about the model is one read, never a hunt across idf.db's sheet and bem.db's rows.
// The checks only READ what the build resolved; none changes the model.

import type { CompiledZone } from "./assembly.js";
import { THERMOSTAT_SIDE_FIELD } from "./assembly.js";
import type { ResolvedSystems } from "./bemSystems.js";
import type { ResolvedGains } from "./bemGains.js";
import type { PlumbCompiled } from "./plumbSheet.js";
import type { AsmNode } from "./assembly.js";

export type CheckVerdict = "ok" | "note" | "warn" | "fail";
export type ZoneSide = "heating" | "cooling";
/** one answer: the rule asked, what it was asked of, the verdict, in words, and where it is changed; a zone-sides row also
 *  names the sides switched off, those approved, and the zone's rooms (the run's QA reads them; bem.db keeps them in checks.data) */
export interface CheckRow { rule: string; subject: string; verdict: CheckVerdict; text: string; fix: string; sides?: { off: ZoneSide[]; approved: ZoneSide[]; rooms: string[] } }

export const CHECK_RULES: Record<string, string> = {
  "idf-db": "the model is written from idf.db alone — every ruling, library object and the weather held there as values (2026-10-07)",
  "zone-sides": "each zone a system serves is heated and cooled — a side switched off on its Zone card stops the run until it is switched on or approved (2026-11-03)",
  "zone-system": "each conditioned zone is served by a system on the sheet",
  "room-conditioning": "each room's default gains as written — a room the gains read as unoccupied (a garage) takes none, whatever conditions its zone",
  "room-zone": "each room with a floor is in a Zone drawn on the sheet",
  "not-honoured": "every ruling is written — none refused or left out",
  "plumbing": "the plumbing sheet's heaters and uses are written as drawn",
  "erv-flow": "each ERV's rated outdoor air meets the code's (ASHRAE 62.2) for the floor it serves — the ERV's flow is written either way; below the code is a warning (2026-10-07)",
};

export interface CheckInput {
  /** the zones drawn on the sheet, null when there is no sheet */
  drawn: { zones: CompiledZone[]; roomZone: Record<string, string> } | null;
  nodes: AsmNode[];
  sys: ResolvedSystems;
  gains: ResolvedGains;
  /** a zone's conditioning as the systems read it (the ZONES ledger, else by name) */
  conditioned: (zone: string) => boolean;
  plumbing: PlumbCompiled | null;
  /** the rulings not honoured, by where they are set */
  unresolved: Array<{ where: string; items: string[] }>;
  /** the sides the user approved left off, by Zone card name (BemLedger.sideApprovals) */
  approvals?: Record<string, { heating?: string; cooling?: string }>;
}

export function modelChecks(c: CheckInput): CheckRow[] {
  const out: CheckRow[] = [];
  const put = (rule: string, subject: string, verdict: CheckVerdict, text: string, fix = ""): void => { out.push({ rule, subject, verdict, text, fix }); };
  const sysOf = (z: string): string | undefined => c.sys.zoneSystem.get(z);
  const condZone = (z: string): boolean => !!sysOf(z) || c.conditioned(z);
  const zoneNames = [...new Set(c.gains.rooms.map((r) => r.zone))].sort();

  // ERV FLOW AGAINST THE CODE (user, 2026-10-07): the ERV's rated flow runs; the code's flow is not used when the ERV meets it
  for (const e of c.sys.ervs ?? []) {
    const n = c.nodes.find((x) => x.id === e.coreId || (x.kind === "component" && `${x.cls}|${JSON.stringify(x.fields ?? {})}` === e.coreId)), name = n?.ident || n?.label || "the ERV";
    const short = e.ratedCfm + 1e-6 < e.codeCfm;
    put("erv-flow", name, short ? "warn" : "ok", `${e.ratedCfm.toFixed(0)} cfm outdoor and exhaust air (its rating)${e.units > 1 ? ` across the ${e.units} units it feeds` : ""} ${short ? "is BELOW" : "meets"} the code's ${e.codeCfm.toFixed(1)} cfm — ${e.codeWords}${short ? " — the ERV's flow is written; the house is under-ventilated by the code" : " — the ERV's flow is written, the code's is not used"}`,
      short ? "SYSTEMS › MECHANICAL — the ERV card's nominal supply air flow rate" : "");
  }

  // ZONE SIDES: the equipment's capability, then the Zone card's switches
  for (const z of zoneNames) {
    const s = sysOf(z);
    if (!s) continue;
    const cap = c.sys.zoneCapability.get(z) ?? { heat: true, cool: true, why: "" };
    const card = c.drawn?.zones.find((x) => x.name === z);
    const f = card ? c.nodes.find((n) => n.id === card.id)?.fields ?? {} : {};
    const hOff = f[THERMOSTAT_SIDE_FIELD.heating] === "off", cOff = f[THERMOSTAT_SIDE_FIELD.cooling] === "off";
    const heats = cap.heat && !hOff, cools = cap.cool && !cOff;
    const off = [hOff && cap.heat ? "heating" : "", cOff && cap.cool ? "cooling" : ""].filter(Boolean) as ZoneSide[];
    if (off.length) {
      // THE RUN'S QA (user, 2026-11-03): a side left off stops the run until it is switched on or the user approves it
      const ap = c.approvals?.[z] ?? {}, approved = off.filter((x) => ap[x]), open = off.filter((x) => !ap[x]);
      const rooms = c.gains.rooms.filter((r) => r.zone === z && r.floorM2 > 0).map((r) => r.room).sort();
      const what = `${off.join(" and ")} switched off on its Zone card — ${s} can ${off.map((x) => (x === "heating" ? "heat" : "cool")).join(" and ")}; the zone is ${heats ? "heated only" : cools ? "cooled only" : "neither heated nor cooled"}`;
      const said = approved.length ? ` — ${approved.join(" and ")} off approved by you ${ap[approved[0]!]!.slice(0, 10)}` : "";
      out.push({ rule: "zone-sides", subject: z, verdict: open.length ? "warn" : "note", text: what + said, fix: "SYSTEMS › MECHANICAL — the Zone card's thermostat, or approve it in the run's QA", sides: { off, approved, rooms } });
    } else if (!cap.heat || !cap.cool) put("zone-sides", z, "note", `${heats ? "heated only" : cools ? "cooled only" : "neither heated nor cooled"} — ${cap.why || s}`, "SYSTEMS › MECHANICAL — the equipment on the sheet");
    else put("zone-sides", z, "ok", `heated and cooled by ${s}`);
  }

  // ZONE SYSTEM: a conditioned zone no system serves
  const bare = zoneNames.filter((z) => c.conditioned(z) && !sysOf(z));
  if (!c.drawn) put("zone-system", "every zone", bare.length ? "note" : "ok", bare.length ? `no systems sheet — ${bare.length} conditioned zones run on ideal loads (the code default)` : "no conditioned zone");
  else for (const z of bare) put("zone-system", z, "warn", "conditioned, and no system on the sheet serves it", "SYSTEMS › MECHANICAL — draw it on the sheet, or ZONES — mark it unconditioned");
  if (c.drawn && !bare.length) put("zone-system", "every zone", "ok", `every conditioned zone is served — ${zoneNames.filter((z) => sysOf(z)).length} zones on a system`);

  // ROOM CONDITIONING: what the default gains do in each room, stated — never a warning (the user, 2026-10-07: "THE GARAGE IS
  // UNOCCUPIED!"). A garage's unit heater conditions its zone; the gains still read it as unoccupied, which is the ruling.
  const split = zoneNames.filter((z) => c.gains.rooms.some((r) => r.zone === z && r.floorM2 > 0 && r.conditioned !== condZone(z)));
  for (const z of split) {
    const rs = c.gains.rooms.filter((r) => r.zone === z && r.floorM2 > 0 && r.conditioned !== condZone(z)).map((r) => r.room);
    put("room-conditioning", z, "ok", condZone(z)
      ? `${rs.join(", ")}: unoccupied — no default people, lights or equipment; ${sysOf(z) ?? "its system"} conditions the zone`
      : `${rs.join(", ")}: the default gains of an occupied room, in a zone no system conditions`, "ZONES — the frame's gains");
  }
  if (!split.length) put("room-conditioning", "every room", "ok", "every room's gains read its zone's conditioning");

  // ROOM IN A ZONE: with a sheet, a room with a floor outside every drawn Zone runs as a zone of its own
  if (c.drawn) {
    const loose = c.gains.rooms.filter((r) => r.floorM2 > 0 && !c.drawn!.roomZone[r.room] && !/^(attic|interstitial)\b/i.test(r.room)).map((r) => r.room);
    for (const r of loose) put("room-zone", r, "warn", "in no Zone on the sheet — it runs as a zone of its own", "ZONES — put it in a Zone");
    if (!loose.length) put("room-zone", "every room", "ok", `every room with a floor is in one of the sheet's ${c.drawn.zones.length} Zones`);
  }

  // NOT HONOURED: what the build could not write, by where it is set
  let refused = 0;
  for (const u of c.unresolved) for (const t of u.items) { put("not-honoured", u.where, "fail", t, u.where); refused++; }
  if (!refused) put("not-honoured", "every ruling", "ok", "every ruling is written");

  // PLUMBING: the sheet's refusals and cautions as compiled
  if (c.plumbing) {
    for (const r of c.plumbing.refusals) put("plumbing", "the sheet", "fail", r.text, "SYSTEMS › PLUMBING");
    for (const r of c.plumbing.cautions) put("plumbing", "the sheet", "warn", r.text, "SYSTEMS › PLUMBING");
    if (!c.plumbing.refusals.length && !c.plumbing.cautions.length) put("plumbing", "the sheet", "ok", `${c.plumbing.heaters.length} heaters, ${c.plumbing.uses.length} uses, ${c.plumbing.wells.length} well pumps — written as drawn`);
  }
  return out;
}
