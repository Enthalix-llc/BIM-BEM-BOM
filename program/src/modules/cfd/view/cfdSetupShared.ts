// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// WHAT THE SETUP'S PLAN AND ITS 3-D VIEW SHARE (2026-11-10): the role colours and words, which kind of face a face is, a wall
// grille's size in the box rule's order, one change to a terminal of either kind, and one terminal added on a face.

import type { RoomFace } from "../core/cfdCase.js";
import type { AddedTerminal, CfdChoices, TermChoice } from "../core/cfdChoices.js";

type V3 = [number, number, number];
export type Host = "floor" | "ceiling" | "wall";
/** the state's two calls the helpers need (CfdSetup's useCfdSetup) */
interface SetupLike { update: (f: (c: CfdChoices) => CfdChoices) => void; setSel: (k: string | null) => void }

export const ROLE_COLOUR: Record<string, string> = { supply: "#e0a63a", return: "#7aa7e0", transfer: "#9aa3b5", "transfer-in": "#7cc4a0", exhaust: "#c06bd6", "": "#666c78" };
/** a terminal's role in words with the other room of a transfer grille: "transfer out to Bed 1 Bath" · "transfer in from Great" */
export const roleWords = (role: string, other: string | null | undefined): string =>
  (ROLE_WORD[role] ?? role) + (other && (role === "transfer" || role === "transfer-in") ? ` ${role === "transfer" ? "to" : "from"} ${other}` : "");
export const ROLE_WORD: Record<string, string> = { supply: "supply", return: "return", transfer: "transfer out", "transfer-in": "transfer in", exhaust: "exhaust", "": "no role" };
export const hostOf = (f: RoomFace | undefined): Host => (!f ? "floor" : f.n[1] < -0.9 ? "floor" : f.n[1] > 0.2 ? "ceiling" : "wall");
export const axisOf = (f: RoomFace): 0 | 1 | 2 => ([0, 1, 2] as const).reduce((m, i) => (Math.abs(f.n[i]) > Math.abs(f.n[m]) ? i : m), 0 as 0 | 1 | 2);
/** a wall terminal's size in the box rule's order: the face's two other axes ascending — an x-facing wall's are (y, z) */
export const wallSize = (f: RoomFace, w: number, h: number): [number, number] => (axisOf(f) === 0 ? [h, w] : [w, h]);
export const wallWH = (f: RoomFace, size: [number, number]): [number, number] => (axisOf(f) === 0 ? [size[1], size[0]] : [size[0], size[1]]);

/** a change to one terminal, whichever kind it is */
export function editTerminal(s: SetupLike, key: string, f: { file?: (c: TermChoice) => TermChoice; added?: (a: AddedTerminal) => AddedTerminal }): void {
  s.update((c) => key.startsWith("f")
    ? (f.file ? { ...c, terms: { ...c.terms, [key.slice(1)]: f.file(c.terms[key.slice(1)]!) } } : c)
    : (f.added ? { ...c, added: (c.added ?? []).map((a) => (a.id === key ? f.added!(a) : a)) } : c));
}

let addSeq = 0;
const newId = (c: CfdChoices): string => { let k = (c.added?.length ?? 0) + 1 + addSeq++; while (c.added?.some((a) => a.id === `a${k}`)) k++; return `a${k}`; };

/** a terminal added on a face of the room at the point c (on its plane): a default size for the host, a supply with no flow yet */
export function addTerminal(s: SetupLike, faces: RoomFace[], host: Host, face: number, c: V3, path = false): void {
  s.update((cc) => {
    const id = newId(cc), f = faces[face]!, n = (cc.added?.length ?? 0) + 1;
    // AN OPEN PATH (2026-11-10, the user: "Can we assign air transfer path as in down a stair?"): an opening of its own size, free —
    // the stair well, an archway: air leaves or enters by it as the pressure finds
    const size: [number, number] = path ? (host === "wall" ? wallSize(f, 0.9, 2.0) : [1.0, 2.5]) : host === "wall" ? wallSize(f, 0.36, 0.2) : host === "ceiling" ? [0.3, 0.3] : [0.25, 0.1];
    const label = path ? `open path ${n}` : `${host === "wall" ? "wall grille" : host === "ceiling" ? "ceiling diffuser" : "floor register"} ${n}`;
    const a: AddedTerminal = { id, label, host, face, c, size, role: path ? "transfer" : "supply", cfm: null, use: true };
    s.setSel(id);
    return { ...cc, added: [...(cc.added ?? []), a] };
  });
}
