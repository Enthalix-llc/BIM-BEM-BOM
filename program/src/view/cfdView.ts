// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE AIRFLOW OVER THE MODEL (BOM › CFD, the user's ruling 2026-11-04): one arrow per bin of cfd.db's snapshot —
// LONG for fast air, SHORT for slow (length ∝ speed), THICK where much of the supply air passes, THIN where little
// does (cross-section ∝ cfm, so radius ∝ √cfm), coloured by the air's temperature. The openings are outlined boxes,
// the supplies in the arrows' warm or cool end, the outlets grey. Instanced: a shaft and a head per arrow, two draws.

import * as THREE from "three";
import type { Arrow } from "../modules/cfd/core/streamArrows.js";

export interface CfdViewIn {
  arrows: Arrow[];
  openings: Array<{ name: string; dir: "in" | "out"; lo: [number, number, number]; hi: [number, number, number] }>;
  /** the colour scale's ends, °C */
  tRange: [number, number];
  /** the speed drawn as the longest arrow, m/s, and that arrow's length, m */
  speedFull?: number; lengthFull?: number;
  /** the cfm drawn as the thickest arrow, and its radius, m */
  cfmFull?: number; radiusFull?: number;
}

/** blue → white → red over the range */
export function tempColour(t: number, [lo, hi]: [number, number], out = new THREE.Color()): THREE.Color {
  const f = hi > lo ? Math.min(1, Math.max(0, (t - lo) / (hi - lo))) : 0.5;
  const c0 = new THREE.Color(0x2c6fd6), c1 = new THREE.Color(0xf2f2f2), c2 = new THREE.Color(0xd8402a);
  return f < 0.5 ? out.copy(c0).lerp(c1, f * 2) : out.copy(c1).lerp(c2, (f - 0.5) * 2);
}

export function arrowScale(s: CfdViewIn): { speedFull: number; lengthFull: number; cfmFull: number; radiusFull: number } {
  return {
    speedFull: s.speedFull ?? 0.5, lengthFull: s.lengthFull ?? 0.45,
    cfmFull: s.cfmFull ?? Math.max(1, ...s.arrows.map((a) => a.cfm)), radiusFull: s.radiusFull ?? 0.03,
  };
}

export function buildCfdView(s: CfdViewIn): THREE.Group {
  const g = new THREE.Group();
  g.name = "cfd";
  const k = arrowScale(s);
  const n = s.arrows.length;
  // unit shaft along +Y from 0 to 1, unit head on top of it; each instance scaled (r, len, r)
  const shaft = new THREE.CylinderGeometry(1, 1, 1, 8, 1, false).translate(0, 0.5, 0);
  const head = new THREE.ConeGeometry(2.2, 1, 10, 1, false).translate(0, 0.5, 0);
  // drawn OVER the model: the arrows are inside a room whose walls would hide them (depth among themselves kept by
  // rendering after the model, testing nothing — thin arrows read fine in instance order)
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false, transparent: true, opacity: 0.95 });
  const shafts = new THREE.InstancedMesh(shaft, mat, n), heads = new THREE.InstancedMesh(head, mat, n);
  shafts.name = "cfd-shafts"; heads.name = "cfd-heads";
  shafts.renderOrder = 1000; heads.renderOrder = 1001;
  const up = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3(), q = new THREE.Quaternion(), m = new THREE.Matrix4(), col = new THREE.Color();
  const p = new THREE.Vector3(), sc = new THREE.Vector3();
  s.arrows.forEach((a, i) => {
    const len = Math.min(1.4 * k.lengthFull, Math.max(0.03, (a.speed / k.speedFull) * k.lengthFull));
    const r = Math.max(0.0025, Math.sqrt(Math.min(1, a.cfm / k.cfmFull)) * k.radiusFull);
    const hl = Math.min(len * 0.45, Math.max(r * 3, 0.02));
    d.set(a.dx, a.dy, a.dz).normalize();
    q.setFromUnitVectors(up, d);
    // the arrow centred on its bin's point
    p.set(a.x, a.y, a.z).addScaledVector(d, -len / 2);
    sc.set(r, len - hl, r);
    m.compose(p, q, sc); shafts.setMatrixAt(i, m);
    p.addScaledVector(d, len - hl);
    sc.set(r, hl, r);
    m.compose(p, q, sc); heads.setMatrixAt(i, m);
    tempColour(a.t, s.tRange, col);
    shafts.setColorAt(i, col); heads.setColorAt(i, col);
  });
  shafts.instanceMatrix.needsUpdate = true; heads.instanceMatrix.needsUpdate = true;
  g.add(shafts, heads);
  // MOVING (the user, 2026-11-10: "a real-time visualization with moving arrows … with moving and static switch"): each arrow
  // marches along its own direction AT THE AIR'S OWN SPEED, real time, through its 0.3 m bin and starts again — a phase per
  // arrow so the field does not pulse together. The static view is the same arrows held at their bin's point.
  const span = 0.3, base = s.arrows.map((a, i) => {
    const len = Math.min(1.4 * k.lengthFull, Math.max(0.03, (a.speed / k.speedFull) * k.lengthFull));
    const r = Math.max(0.0025, Math.sqrt(Math.min(1, a.cfm / k.cfmFull)) * k.radiusFull);
    return { a, len, r, hl: Math.min(len * 0.45, Math.max(r * 3, 0.02)), phase: ((i * 0.6180339887) % 1) * span };
  });
  g.userData.animate = (seconds: number | null): void => {
    base.forEach(({ a, len, r, hl, phase }, i) => {
      d.set(a.dx, a.dy, a.dz).normalize();
      q.setFromUnitVectors(up, d);
      const shift = seconds == null ? 0 : ((seconds * a.speed + phase) % span) - span / 2;
      p.set(a.x, a.y, a.z).addScaledVector(d, shift - len / 2);
      sc.set(r, len - hl, r); m.compose(p, q, sc); shafts.setMatrixAt(i, m);
      p.addScaledVector(d, len - hl);
      sc.set(r, hl, r); m.compose(p, q, sc); heads.setMatrixAt(i, m);
    });
    shafts.instanceMatrix.needsUpdate = true; heads.instanceMatrix.needsUpdate = true;
  };
  for (const o of s.openings) {
    const lo = new THREE.Vector3(...o.lo), hi = new THREE.Vector3(...o.hi);
    // a patch is flat: give its box 2 cm so the outline shows
    const size = hi.clone().sub(lo).max(new THREE.Vector3(0.02, 0.02, 0.02));
    const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z)),
      new THREE.LineBasicMaterial({ color: o.dir === "in" ? 0xffd166 : 0x9aa3b5, depthTest: false }));
    box.position.copy(lo.clone().add(hi).multiplyScalar(0.5));
    box.name = `cfd-opening:${o.name}`;
    g.add(box);
  }
  return g;
}
