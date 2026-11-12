// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// A ROOM'S CFD SETUP, LOADED AND SAVED (2026-11-10): the choices made for a room in BOM › CFD · SETUP (CfdSetup.tsx) — its
// terminals, names, flows, sizes and places, the terminals added, its doors, setpoints, supply air, mesh and iterations — kept in
// the project's BOM ledger, which the app hands in (setChoicesStore). Before then they were kept in the window's storage; a room
// set up that way is carried into the ledger the first time it is read.

import type { CfdChoices } from "../core/cfdChoices.js";

const store = (space: string): string => `bim-cfd-choices:${space}`;
/** WHERE A ROOM'S SETUP IS KEPT (2026-11-10): the project's BOM ledger, which the app hands in here; the window's storage is read
 *  only to carry a room set up before then into the ledger, once */
export interface ChoicesStore { get: (space: string) => Partial<CfdChoices> | null; set: (space: string, ch: Partial<CfdChoices>) => void }
let ledgerStore: ChoicesStore | null = null;
export function setChoicesStore(s: ChoicesStore | null): void { ledgerStore = s; }
const fromWindow = (space: string): Partial<CfdChoices> | null => { try { const t = window.localStorage.getItem(store(space)); return t ? JSON.parse(t) as Partial<CfdChoices> : null; } catch { return null; } };
export function loadChoices(space: string): Partial<CfdChoices> | null {
  const v = ledgerStore?.get(space) ?? null;
  if (v || !ledgerStore) return v ?? fromWindow(space);
  const old = fromWindow(space);
  if (old) ledgerStore.set(space, old); // carried into the ledger once
  return old;
}
export function saveChoices(space: string, ch: Partial<CfdChoices>): void {
  if (ledgerStore) { ledgerStore.set(space, ch); return; }
  try { window.localStorage.setItem(store(space), JSON.stringify(ch)); } catch { /* no ledger and no storage: nothing kept */ }
}
