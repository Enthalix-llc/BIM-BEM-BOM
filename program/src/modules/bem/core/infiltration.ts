// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// A ZONE'S INFILTRATION FROM ITS BLOWER-DOOR NUMBER (user, 2026-10-08: "build it into Zones" — the house must test under
// 5 ACH50, "expected infiltration is almost nothing … the garage will see higher than the house"). Two rulings a Zone card
// can carry on ZONES, the one place they are typed:
//   · ACH50 → EnergyPlus's ZoneInfiltration:EffectiveLeakageArea (the Sherman-Grimsrud model): the leakage at 50 Pa turned
//     into the effective leakage area at 4 Pa, the flow then driven hour by hour by the indoor-outdoor ΔT (stack) and the
//     wind — low on a mild calm day, higher on a cold windy one;
//   · a constant ACH → ZoneInfiltration:DesignFlowRate as the code default is written (the garage's door openings).
// Measured 2026-10-08 (EnergyPlus 26.1, the user's model): an EffectiveLeakageArea named for a ZONE is shared among the
// zone's spaces — 100 cm² on the zone gave the same flow as 100 cm² on one of its spaces (0.01009 m³/s both) — so one
// object per zone carries the zone's whole leakage area.

/** the flow exponent and discharge coefficient of the conversion — ASHRAE Handbook—Fundamentals, ch. 16 (Ventilation and
 *  Infiltration), "effective leakage area" at a 4 Pa reference, C_D = 1, n = 0.65 the typical house's exponent; air 1.2 kg/m³ */
export const ELA = { n: 0.65, cd: 1, refPa: 4, testPa: 50, rho: 1.2 } as const;

/** the effective leakage area (cm²) at 4 Pa of a zone of `volumeM3` leaking `ach50` air changes an hour at 50 Pa:
 *  Q4 = Q50 · (4/50)^n, A = Q4 · √(ρ / 2ΔP) / C_D — 0.354 cm² per cfm50 (the familiar 0.055 in² per cfm50) */
export function elaCm2(ach50: number, volumeM3: number): number {
  const q50 = (ach50 * volumeM3) / 3600;                                  // m³/s
  const q4 = q50 * Math.pow(ELA.refPa / ELA.testPa, ELA.n);
  return (q4 * Math.sqrt(ELA.rho / (2 * ELA.refPa)) / ELA.cd) * 1e4;      // m² → cm²
}

/** THE STACK AND WIND COEFFICIENTS (Cs, Cw) the object requires — no default in EnergyPlus. Their values are tabled by the house's
 *  storeys and its shelter class in ASHRAE Handbook—Fundamentals, ch. 16 (and repeated in the EnergyPlus Input Output Reference under
 *  ZoneInfiltration:EffectiveLeakageArea); that table does not ship with the program: the user types the two numbers for their house on
 *  the Zone card. Units: Cs (L/s)²/(cm⁴·K), Cw (L/s)²/(cm⁴·(m/s)²) */
export const COEFF_SOURCE = "ASHRAE Handbook—Fundamentals ch. 16, the basic model's table by storeys and shelter class; repeated in the EnergyPlus Input Output Reference under ZoneInfiltration:EffectiveLeakageArea";

/** the Zone card's fields (the node's `fields`, saved with the SYSTEMS sheet) */
export const INFIL_FIELD = { method: "infiltration_method", ach: "infiltration_ach", ach50: "infiltration_ach50", cs: "infiltration_cs", cw: "infiltration_cw" } as const;
export type InfilMethod = "code" | "ach" | "ach50";

/** a zone's infiltration ruling as the writer takes it */
/** cs / cw: as typed; absent = not entered (the writer refuses the zone's blower-door ruling until both are) */
export type InfilRuling = { method: "ach"; ach: number } | { method: "ach50"; ach50: number; cs?: number; cw?: number };

/** the ruling a Zone card's fields carry; null = the code default (ACH50 of the code table ÷ 20) */
export function infilRulingOf(fields: Record<string, unknown> | undefined): InfilRuling | null {
  const f = fields ?? {};
  const m = f[INFIL_FIELD.method];
  if (m === "ach" && typeof f[INFIL_FIELD.ach] === "number" && (f[INFIL_FIELD.ach] as number) >= 0) return { method: "ach", ach: f[INFIL_FIELD.ach] as number };
  if (m === "ach50" && typeof f[INFIL_FIELD.ach50] === "number" && (f[INFIL_FIELD.ach50] as number) > 0)
  {
    const pos = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);
    return { method: "ach50", ach50: f[INFIL_FIELD.ach50] as number, cs: pos(f[INFIL_FIELD.cs]), cw: pos(f[INFIL_FIELD.cw]) };
  }
  return null;
}

/** A COEFFICIENT TABLE THE USER SUPPLIES (2026-11-12, named by a project's data sources): the table of ASHRAE Handbook—Fundamentals
 *  ch. 16 by the house's storeys and its shelter class, as JSON — { cite, stack: { "1": Cs, "2": Cs, "3": Cs }, wind: { "<shelter 1–5>":
 *  { "<storeys>": Cw } }, shelterWords?: { "<shelter>": "words" } }. None ships with the program; it only FILLS the Zone card's Cs and Cw,
 *  which stay what the writer reads */
export interface InfilTable { cite: string; stack: Record<string, number>; wind: Record<string, Record<string, number>>; shelterWords?: Record<string, string> }
export function readInfilTable(text: string | null): InfilTable | null {
  try {
    const t = text ? JSON.parse(text) as InfilTable : null;
    return t && typeof t.cite === "string" && t.stack && t.wind ? t : null;
  } catch { return null; }
}
/** the Zone card's own record of the row it filled from (display only; the writer reads Cs and Cw) */
export const INFIL_ROW_FIELD = { stories: "infiltration_stories", shelter: "infiltration_shelter" } as const;
