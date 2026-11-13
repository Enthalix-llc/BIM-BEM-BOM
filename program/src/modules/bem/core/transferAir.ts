// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// TRANSFER AIR THROUGH A VOID (2026-11-11, the user: "Can we add zone mixing for the space to attic to space air transfer? …
// indicate spaces that feed unconditioned unoccupied space and spaces that receive transfer air from the unconditioned unoccupied
// space … the air supplied should match actual flow, which at this point is an expected air balance").
//
// A PATH is one room's air through a void into another room: from → via → to, at the flow the user types (the expected air
// balance — what the room's supply leaves by the grille). In the house every transfer grille path is OPEN through an attic (the
// user, 2026-11-11), so the air takes the void's temperature on its way.
//
// Written as the engine's own one-way exchange, `ZoneMixing` — two per path, at the same flow: the void receives the first room's
// air, the second room receives the void's. ZoneMixing "only affects the energy balance of the receiving zone" (the IDD) — the
// source loses no heat by it, which is right: its air leaves at its own temperature. Delta Temperature 0: the engine's full
// mixing every hour (ZoneEquipmentManager.cc: "If TD equals zero (default) set coefficients for full mixing"). The void's air in
// equals its air out by construction, whatever the paths.
//
// The engine mixes ZONES in a run (the space heat balance is on for sizing only), so the void must be a zone of its own: an attic
// left on a room's Zone card is the room's air, and a path through it is refused with the reason — never written as if it worked.

/** one path, by the rooms' own names (the IfcSpace names the tree shows) */
export interface TransferPath { from: string; via: string; to: string; cfm: number }

export interface TransferRoom { room: string; zone: string; conditioned: boolean; people: number }
export interface ZoneMixingOut { name: string; zone: string; source: string; m3s: number; paths: string[] }
export interface ResolvedTransfers { mixing: ZoneMixingOut[]; written: TransferPath[]; unresolved: string[] }

const CFM = 0.000471947443;
const pathWords = (p: TransferPath): string => `${p.from} → ${p.via} → ${p.to}`;

/** the paths checked against the model's rooms; each one written becomes two exchanges, summed per (receiving, source) zone pair */
export function resolveTransfers(paths: TransferPath[] | undefined, rooms: TransferRoom[]): ResolvedTransfers {
  const out: ResolvedTransfers = { mixing: [], written: [], unresolved: [] };
  if (!paths?.length) return out;
  const by = new Map(rooms.map((r) => [r.room, r]));
  const pairs = new Map<string, ZoneMixingOut>();
  const add = (zone: string, source: string, m3s: number, path: string): void => {
    const k = `${zone}\u0000${source}`;
    const m = pairs.get(k) ?? pairs.set(k, { name: `${source} to ${zone} transfer air`, zone, source, m3s: 0, paths: [] }).get(k)!;
    m.m3s += m3s; m.paths.push(path);
  };
  for (const p of paths) {
    const w = pathWords(p);
    if (!p.from || !p.via || !p.to) { out.unresolved.push(`transfer air ${w}: pick the room it leaves, the void it crosses and the room it enters — not written`); continue; }
    const f = by.get(p.from), v = by.get(p.via), t = by.get(p.to);
    const missing = [[p.from, f], [p.via, v], [p.to, t]].filter(([, r]) => !r).map(([n]) => `"${n as string}"`);
    if (missing.length) { out.unresolved.push(`transfer air ${w}: ${missing.join(", ")} is not a room of the model — not written`); continue; }
    if (!(p.cfm > 0)) { out.unresolved.push(`transfer air ${w}: no flow — type the expected air balance (the air the room's supply sends this way)`); continue; }
    if (v!.zone === f!.zone || v!.zone === t!.zone) {
      const room = v!.zone === f!.zone ? p.from : p.to;
      out.unresolved.push(`transfer air ${w}: ${p.via} is in the zone ${v!.zone} with ${room} — the run mixes zones, so it has no temperature of its own there; take ${p.via} off the ${v!.zone} Zone card (SYSTEMS) for the path to be written`);
      continue;
    }
    if (v!.conditioned) { out.unresolved.push(`transfer air ${w}: ${p.via} is conditioned (zone ${v!.zone}) — the path is through an unconditioned, unoccupied space; not written`); continue; }
    if (v!.people > 0) { out.unresolved.push(`transfer air ${w}: ${p.via} has people in it (${v!.people.toFixed(2)}) — the path is through an unoccupied space; not written`); continue; }
    if (f!.zone === t!.zone) { out.unresolved.push(`transfer air ${w}: ${p.from} and ${p.to} are one zone (${f!.zone}) — air back into its own zone moves no heat in the run; not written`); continue; }
    const m3s = p.cfm * CFM;
    add(v!.zone, f!.zone, m3s, w);
    add(t!.zone, v!.zone, m3s, w);
    out.written.push(p);
  }
  out.mixing = [...pairs.values()];
  return out;
}

/** the paths in words, for the setting and the RUN census */
export const transfersInWords = (r: ResolvedTransfers): string =>
  r.written.length ? r.written.map((p) => `${pathWords(p)} ${p.cfm.toFixed(0)} cfm`).join(" · ") : "none";
