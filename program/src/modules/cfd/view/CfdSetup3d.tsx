// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE ROOM IN 3-D, FOR PLACING ITS TERMINALS (the user, 2026-11-10: "Can we use a 3d model for locating the terminals?"). The room's
// own solid — the faces the case is written from — drawn as a doll's house: each face's INSIDE shown and its outside nearly clear,
// so the room is seen into from any side; the terminals as boxes at their size, coloured by role, red when they touch no face.
// A click on any face — floor, wall, sloped ceiling — adds a terminal there (the tool "+ on a face"); a terminal is dragged along
// its own face; a right-click removes an added one or switches one of the file's off; the selection is the TERMINALS table's.
// A click picks the first face whose INSIDE faces the eye, so a near wall seen from outside never takes the click.

import { useEffect, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { triangles, type RoomFace } from "../core/cfdCase.js";
import { faceLabel, touchesRoom } from "../core/cfdPrep.js";
import type { CfdSetupState, SetupTerminal } from "./CfdSetup.js";
import { addTerminal, editTerminal, hostOf, ROLE_COLOUR, ROLE_WORD, roleWords } from "./cfdSetupShared.js";

type V3 = [number, number, number];
const HOST_COLOUR = { floor: 0xb59a73, ceiling: 0x8ea2c0, wall: 0x9aa0aa } as const;

const cssVar = (name: string, fallback: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

export function CfdSetup3d({ s, imperial, tool }: { s: CfdSetupState; imperial: boolean; tool: "select" | "add" | "path" }): ReactNode {
  const host = useRef<HTMLDivElement>(null);
  const world = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; room: THREE.Group; terms: THREE.Group; render: () => void } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const frame = useRef<{ c: THREE.Vector3; r: number } | null>(null);
  // FROM ABOVE OR FROM BELOW: a face is clicked from its inside, so a ceiling is reached looking up from under the room
  const look = (below: boolean): void => {
    const w = world.current, f = frame.current; if (!w || !f) return;
    w.controls.target.copy(f.c);
    w.camera.position.copy(f.c).add(new THREE.Vector3(1, below ? -0.9 : 0.9, 1).normalize().multiplyScalar(f.r * 2.4));
    w.controls.update(); w.render();
  };
  const faces = s.inp?.faces ?? null;
  const live = useRef({ s, tool, faces });
  live.current = { s, tool, faces };

  // the renderer, the camera and the orbit — once
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(cssVar("--bg", "#0f1117"));
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const sun = new THREE.DirectionalLight(0xffffff, 0.7); sun.position.set(3, 8, 5); scene.add(sun);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 500);
    const controls = new OrbitControls(camera, renderer.domElement);
    const room = new THREE.Group(), terms = new THREE.Group();
    scene.add(room, terms);
    const render = (): void => renderer.render(scene, camera);
    controls.addEventListener("change", render);
    const fit = (): void => { const w = el.clientWidth, h = el.clientHeight; if (!w || !h) return; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); render(); };
    const ro = new ResizeObserver(fit); ro.observe(el);
    world.current = { renderer, scene, camera, controls, room, terms, render };
    // THE INSTRUMENT (as the census is): where a terminal or a face's inside lies on the screen, so a drag can be driven and measured
    const toScreen = (p: THREE.Vector3): [number, number] => { const r = renderer.domElement.getBoundingClientRect(), q = p.clone().project(camera); return [Math.round(r.left + ((q.x + 1) / 2) * r.width), Math.round(r.top + ((1 - q.y) / 2) * r.height)]; };
    (window as unknown as { __BIM_CFD3D__?: unknown }).__BIM_CFD3D__ = {
      terminal: (key: string) => { const m = terms.children.find((c) => c.userData.key === key) as THREE.Mesh | undefined; if (!m) return null; m.geometry.computeBoundingBox(); return toScreen(m.geometry.boundingBox!.getCenter(new THREE.Vector3())); },
      face: (i: number) => { const ms = room.children.filter((c) => c.userData.face === i) as THREE.Mesh[]; if (!ms[0]) return null; ms[0].geometry.computeBoundingBox(); return toScreen(ms[0].geometry.boundingBox!.getCenter(new THREE.Vector3())); },
    };
    fit();
    return () => { ro.disconnect(); controls.dispose(); renderer.dispose(); renderer.domElement.remove(); world.current = null; };
  }, []);

  // the room: its faces' insides, their outsides nearly clear, their edges — and the camera framed on it from the south-east, above
  useEffect(() => {
    const w = world.current;
    if (!w || !faces) return;
    for (const c of [...w.room.children]) { w.room.remove(c); (c as THREE.Mesh).geometry?.dispose(); }
    const box = new THREE.Box3();
    faces.forEach((f, i) => {
      const tri = triangles(f), pos = new Float32Array(tri.length * 9);
      tri.forEach((t, k) => t.forEach((p, j) => pos.set(p, k * 9 + j * 3)));
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.computeVertexNormals();
      const col = HOST_COLOUR[hostOf(f)];
      // the triangles are wound to the face's OUTWARD normal: the back side is the room's inside
      const inside = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: col, side: THREE.BackSide, transparent: true, opacity: 0.55, depthWrite: false }));
      const outside = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: col, side: THREE.FrontSide, transparent: true, opacity: 0.06, depthWrite: false }));
      inside.userData.face = i; outside.userData.face = i;
      const ring = [...f.outer, f.outer[0]!].flatMap((p) => p);
      const edge = new THREE.Line(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array(ring), 3)), new THREE.LineBasicMaterial({ color: 0x5a6070 }));
      w.room.add(inside, outside, edge);
      for (const p of f.outer) box.expandByPoint(new THREE.Vector3(...p));
    });
    const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2;
    w.controls.target.copy(c);
    frame.current = { c, r };
    w.camera.position.copy(c).add(new THREE.Vector3(1, 0.9, 1).normalize().multiplyScalar(r * 2.4));
    w.camera.near = r / 100; w.camera.far = r * 50; w.camera.updateProjectionMatrix();
    w.controls.update(); w.render();
  }, [faces]);

  // the terminals and the face under the pointer
  useEffect(() => {
    const w = world.current;
    if (!w || !faces) return;
    for (const c of [...w.terms.children]) { w.terms.remove(c); (c as THREE.Mesh).geometry?.dispose(); }
    const sel = new THREE.Color(cssVar("--sel", "#ffd166")), bad = new THREE.Color(cssVar("--warn", "#f87171"));
    for (const t of s.terminals) {
      // drawn ON its face (2026-11-10): the box's footprint with each corner on the face's plane — a grille on a slope lies on the slope
      const f = faces[t.face], c = [0, 1, 2].map((a) => (t.box.lo[a]! + t.box.hi[a]!) / 2) as V3;
      const ax = f ? ([0, 1, 2] as const).reduce((m, i) => (Math.abs(f.n[i]) > Math.abs(f.n[m]) ? i : m), 0 as 0 | 1 | 2) : 1;
      const [u, v] = [0, 1, 2].filter((i) => i !== ax) as [number, number];
      const corner = (su: number, sv: number): THREE.Vector3 => {
        const p: V3 = [0, 0, 0]; p[u] = su < 0 ? t.box.lo[u]! : t.box.hi[u]!; p[v] = sv < 0 ? t.box.lo[v]! : t.box.hi[v]!;
        p[ax] = f ? f.outer[0]![ax]! - (f.n[u]! * (p[u]! - f.outer[0]![u]!) + f.n[v]! * (p[v]! - f.outer[0]![v]!)) / f.n[ax]! : c[ax]!;
        // a hair inside the room, so the panel shows over its face
        return new THREE.Vector3(p[0] - (f?.n[0] ?? 0) * 0.01, p[1] - (f?.n[1] ?? 0) * 0.01, p[2] - (f?.n[2] ?? 0) * 0.01);
      };
      const q = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
      const g = new THREE.BufferGeometry().setFromPoints([q[0]!, q[1]!, q[2]!, q[0]!, q[2]!, q[3]!]); g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: ROLE_COLOUR[t.role] ?? "#666c78", side: THREE.DoubleSide, transparent: !t.use, opacity: t.use ? 1 : 0.3 }));
      m.userData.key = t.key;
      w.terms.add(m);
      const off = (t.use && !touchesRoom(faces, t.box)) || s.issues.has(t.key);
      if (off || s.sel === t.key || hover === t.key) {
        const e = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(q), new THREE.LineBasicMaterial({ color: off ? bad : sel, depthTest: false }));
        w.terms.add(e);
      }
    }
    // the face the pointer is over, while adding: lit
    w.room.children.forEach((c) => { const mm = (c as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined; if (mm && "side" in mm && mm.side === THREE.BackSide) mm.emissive?.setHex(hover === `face:${c.userData.face}` ? 0x444422 : 0x000000); });
    w.render();
  }, [s.terminals, s.sel, s.issues, hover, faces]);

  // picking: a terminal first (through the walls — a terminal is what is grabbed), else the first face whose inside faces the eye
  const ray = new THREE.Raycaster();
  const cast = (e: { clientX: number; clientY: number }): THREE.Raycaster | null => {
    const w = world.current; if (!w) return null;
    const r = w.renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), w.camera);
    return ray;
  };
  const termAt = (e: { clientX: number; clientY: number }): SetupTerminal | null => {
    const w = world.current, rc = cast(e); if (!w || !rc) return null;
    const hit = rc.intersectObjects(w.terms.children.filter((c) => c.userData.key), false)[0];
    return hit ? live.current.s.terminals.find((t) => t.key === hit.object.userData.key) ?? null : null;
  };
  const faceAt = (e: { clientX: number; clientY: number }): { face: number; p: V3 } | null => {
    const w = world.current, rc = cast(e), fs = live.current.faces; if (!w || !rc || !fs) return null;
    for (const h of rc.intersectObjects(w.room.children.filter((c) => c.userData.face != null && (c as THREE.Mesh).material && ((c as THREE.Mesh).material as THREE.Material).side === THREE.BackSide), false)) {
      const f = fs[h.object.userData.face as number]!;
      if (rc.ray.direction.x * f.n[0] + rc.ray.direction.y * f.n[1] + rc.ray.direction.z * f.n[2] > 0) return { face: h.object.userData.face as number, p: [h.point.x, h.point.y, h.point.z] };
    }
    return null;
  };

  const drag = useRef<{ key: string } | null>(null);
  const press = useRef<{ x: number; y: number } | null>(null);
  const down = (e: React.PointerEvent): void => {
    if (e.button !== 0) return;
    press.current = { x: e.clientX, y: e.clientY };
    const w = world.current; if (!w) return;
    const t = termAt(e);
    if (!t) return;
    live.current.s.setSel(t.key);
    if (live.current.tool !== "select") return;
    drag.current = { key: t.key };
    w.controls.enabled = false; // read by the orbit's own pointerdown, which fires after this capture handler
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const move = (e: React.PointerEvent): void => {
    const d = drag.current, fs = live.current.faces;
    if (d && fs) {
      // ATTACHED TO THE FACE UNDER THE POINTER (2026-11-10, the user: "the ceiling return needs to be attached to the ceiling
      // matching its slope … correcting terminals does not clear error on run"): a drag carries the terminal from face to face, its
      // centre where the pointer meets the room's inside — never left off a face
      const hit = faceAt(e);
      if (!hit) return;
      const t = live.current.s.terminals.find((q) => q.key === d.key);
      if (!t) return;
      const host = hostOf(fs[hit.face]);
      editTerminal(live.current.s, d.key, {
        file: (c) => { const o = t.offer, b: V3 = [0, 1, 2].map((a) => (o.bbLo[a]! + o.bbHi[a]!) / 2) as V3; return { ...c, face: hit.face, nudge: [hit.p[0] - b[0], hit.p[1] - b[1], hit.p[2] - b[2]] }; },
        added: (a) => ({ ...a, face: hit.face, host, c: hit.p }),
      });
      return;
    }
    if (e.buttons) return;
    const t = termAt(e);
    if (t) { setHover(t.key); return; }
    const f = live.current.tool !== "select" ? faceAt(e) : null;
    setHover(f ? `face:${f.face}` : null);
  };
  const up = (e: React.PointerEvent): void => {
    const w = world.current, p = press.current, fs = live.current.faces;
    press.current = null;
    if (drag.current) { drag.current = null; if (w) w.controls.enabled = true; return; }
    // a click, not an orbit: adds on the face under it
    if (!p || !fs || Math.hypot(e.clientX - p.x, e.clientY - p.y) > 4) return;
    if (live.current.tool !== "select") { const f = faceAt(e); if (f) addTerminal(live.current.s, fs, hostOf(fs[f.face]), f.face, f.p, live.current.tool === "path"); return; }
    if (!termAt(e)) live.current.s.setSel(null);
  };
  const ctx = (e: React.MouseEvent): void => {
    e.preventDefault();
    const t = termAt(e); if (!t) return;
    if (t.source === "added") { if (window.confirm(`Remove "${t.label}"?`)) live.current.s.update((c) => ({ ...c, added: (c.added ?? []).filter((a) => a.id !== t.key) })); }
    else editTerminal(live.current.s, t.key, { file: (c) => ({ ...c, use: !c.use }) });
  };

  const flow = (c: number | null): string => (c == null ? "free" : imperial ? `${c.toFixed(0)} cfm` : `${(c * 0.471947).toFixed(0)} L/s`);
  const shown = s.terminals.find((t) => t.key === (hover && !hover.startsWith("face:") ? hover : s.sel));
  const hf = hover?.startsWith("face:") && faces ? faces[+hover.slice(5)] : null;
  return (
    <div className="cfd3d" ref={host} onPointerDownCapture={down} onPointerMove={move} onPointerUp={up} onContextMenu={ctx}>
      <div className="cfd3dViews" onPointerDown={(e) => e.stopPropagation()}>
        <button onClick={() => look(false)} title="look down into the room — the floor and the walls' insides">from above</button>
        <button onClick={() => look(true)} title="look up into the room from under it — the ceilings' and roofs' insides, to place or drag a ceiling terminal">from below</button>
      </div>
      <div className="cfd3dNote">
        {shown ? <><b>{shown.label}</b> · {roleWords(shown.role, shown.from.from)} · {flow(shown.cfm == null ? null : shown.role === "return" || shown.role === "exhaust" ? -Math.abs(shown.cfm) : shown.cfm)}{faces && shown.use && !touchesRoom(faces, shown.box) ? <span className="bad"> · OFF ITS FACE — drag it onto a face</span> : null}{s.issues.get(shown.key)?.filter((x) => !x.includes("does not touch")).map((x, i) => <span key={i} className="bad"> · ✗ {x}</span>)}</>
          : hf ? <>add on: {faceLabel(hf)}</>
          : <span className="muted">{tool === "add" ? "click a face — floor, wall or ceiling — to add a terminal there" : tool === "path" ? "click the face the open path is in — the floor over a stair well, the wall at the stair's top" : "drag to orbit · right-drag to pan · wheel to zoom · drag a terminal onto any face — it attaches there (a ceiling: from below) · right-click it to remove or switch off"}</span>}
      </div>
    </div>
  );
}
