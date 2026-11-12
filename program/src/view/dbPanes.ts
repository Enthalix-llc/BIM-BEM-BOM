// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// Panes 2 (IFC-DB) + 3 (IDF-DB, Phase-2 placeholder): ONE renderer, two
// scissored viewports, cameras mirroring the Fragments pane's camera each
// frame (wireframe-analysis.md § three concurrent views).

import * as THREE from "three";

export interface PickHit {
  /** 0 when the click landed on a ROOM face (see `space`) */
  elementId: number;
  /** index into the rows the pane was built from */
  rowIndex: number;
  /** a room face, when the spaces overlay is on and the click landed on one:
   *  index into the rows that pane's overlay was built from. With the rooms
   *  shown, a room under the cursor beats the wall behind it — the user is
   *  editing spaces and must not pick a wall by accident (2026-09-03). */
  space?: number;
  /** nothing under the cursor (reported for a right click only) */
  empty?: true;
  /** a SITE ELEMENT under the cursor — a tree, a tie, the dock — when the site is drawn (2026-09-05) */
  /** a projected file's element: `expressId` is the model's key (offset per file), `fileExpressId` the id in its own file */
  siteElement?: { expressId: number; name: string; ifcClass: string; file: string; fileExpressId: number };
  /** a SERVICES element under the cursor — a duct, a fixture, a panel — when the SYSTEMS view is drawn (2026-09-10) */
  mepElement?: { expressId: number; name: string; kind: string; ifcClass: string; discipline: string; room: string | null; file: string; fileExpressId: number };
  pane: 2 | 3;
  button: "left" | "right";
  /** viewport coordinates, for putting a menu where the cursor is */
  clientX: number;
  clientY: number;
}

export interface DbPanes {
  setDbGroup(group: THREE.Group | null): void;
  setIdfGroup(group: THREE.Group | null): void;
  /** the room overlay. Two scenes cannot share one Object3D, so each pane gets
   *  its own instance — the geometry behind them is shared. */
  setSpaceGroups(db: THREE.Group | null, idf: THREE.Group | null): void;
  /** the ground, the same mesh in both DB panes */
  setTerrainGroups(db: THREE.Group | null, idf: THREE.Group | null): void;
  /** THE SUN (2026-09-05): a shadow-casting light from this direction over the
   *  IDF-DB view, null for none; every mesh in the model, the terrain and the
   *  site casts and receives while it is on */
  setSun(dir: [number, number, number] | null): void;
  /** the sun-path overlay (sunView.ts) over the IDF-DB view */
  setSunGroup(group: THREE.Group | null): void;
  /** the airflow overlay (cfdView.ts, BOM › CFD) over the IDF-DB view — its own slot, so it never takes the sun's */
  setCfdGroup(group: THREE.Group | null): void;
  /** the CFD arrows move at the air's speed, or hold still */
  setCfdMoving(on: boolean): void;
  /** the hot outline that says WHICH wall a table row is talking about */
  setHighlights(db: THREE.Group | null, idf: THREE.Group | null): void;
  /** where to send drags and wheels: pane 1's camera element. One gesture in
   *  ANY pane then drives all three, because panes 2/3 mirror that camera. */
  setCameraDom(el: HTMLElement | null): void;
  /** click a surface in either DB pane. The callback gets the stored row the
   *  pixel belongs to, so the table can jump to it and a right-click can offer
   *  a correction on exactly the plane under the cursor. */
  onPick(cb: ((hit: PickHit) => void) | null): void;
  /** call every frame with the master (pane 1) camera */
  sync(master: THREE.PerspectiveCamera): void;
  /** one pane (the IDF-DB view across the whole canvas) or the two scissored panes */
  setLayout(single: boolean): void;
  dispose(): void;
  census(): { pane2Children: number; pane3Children: number; renderErrors: number; lastRenderError: string | null; badGeometry: string[] };
}

export function createDbPanes(canvas: HTMLCanvasElement): DbPanes {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setScissorTest(true);

  const mkScene = (): THREE.Scene => {
    const s = new THREE.Scene();
    s.background = new THREE.Color(0x0f1117);
    s.add(new THREE.AmbientLight(0xffffff, 0.75));
    const d = new THREE.DirectionalLight(0xffffff, 1.4);
    d.position.set(30, 60, 20);
    s.add(d);
    s.add(new THREE.GridHelper(40, 40, 0x2a2f3a, 0x1a1e27));
    return s;
  };
  const scene2 = mkScene();
  const scene3 = mkScene();

  const cam2 = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
  const cam3 = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);

  let dbGroup: THREE.Group | null = null;
  let idfGroup: THREE.Group | null = null;
  let space2: THREE.Group | null = null;
  let terrain2: THREE.Group | null = null, terrain3: THREE.Group | null = null;
  let space3: THREE.Group | null = null;
  let hi2: THREE.Group | null = null;
  let hi3: THREE.Group | null = null;
  let sunGroup: THREE.Group | null = null;
  let cfdGroup: THREE.Group | null = null;
  let cfdMoving = false;
  // the sun: one light, made when first asked for; shadow flags re-applied to
  // every mesh whenever a group changes while the sun is on (the predecessor's
  // lesson: a one-shot traversal misses meshes that arrive later)
  let sunLight: THREE.DirectionalLight | null = null;
  let sunOn = false;
  const shadowFlags = (): void => {
    for (const grp of [idfGroup, terrain3, sunGroup]) {
      if (!grp) continue;
      grp.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && grp !== sunGroup) { m.castShadow = sunOn; m.receiveShadow = sunOn; } });
    }
  };
  const applySun = (dir: [number, number, number] | null): void => {
    if (!dir) {
      sunOn = false;
      if (sunLight) { scene3.remove(sunLight); scene3.remove(sunLight.target); }
      shadowFlags();
      return;
    }
    if (!sunLight) {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;   // PCFSoft is deprecated in r185 (the renderer said so)
      sunLight = new THREE.DirectionalLight(0xfff1cc, 2.2);
      sunLight.castShadow = true;
      sunLight.shadow.mapSize.set(2048, 2048);
      sunLight.shadow.bias = -0.0005;
    }
    const box = new THREE.Box3();
    for (const grp of [idfGroup, terrain3]) if (grp) box.expandByObject(grp);
    const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    const radius = box.isEmpty() ? 40 : Math.max(20, box.getSize(new THREE.Vector3()).length() / 2);
    const cam = sunLight.shadow.camera;
    cam.left = -radius; cam.right = radius; cam.top = radius; cam.bottom = -radius; cam.near = 0.5; cam.far = radius * 4;
    cam.updateProjectionMatrix();
    sunLight.position.set(center.x + dir[0] * radius * 2, center.y + dir[1] * radius * 2, center.z + dir[2] * radius * 2);
    sunLight.target.position.copy(center);
    sunLight.target.updateMatrixWorld();
    if (!sunLight.parent) { scene3.add(sunLight); scene3.add(sunLight.target); }
    sunOn = true;
    shadowFlags();
  };
  let pickCb: ((hit: PickHit) => void) | null = null;
  // the IFC-DB view was retired from the BIM screen (user, 2026-09-04): the
  // canvas is then the IDF-DB pane alone, full width
  let single = false;

  // Picking reads the per-triangle element map buildDbView leaves on the fill
  // mesh, so a click resolves to a DB row and never to a re-derived guess.
  // Only meshes are tested: raycasting 150,050 line segments is not free.
  //
  // A CLICK IS NOT A DRAG. Press-and-move past 4 px becomes a camera gesture,
  // forwarded to pane 1's camera element as a synthetic pointerdown at the
  // press point — camera-controls anchors there and rides the real window
  // moves, so rotate/pan/zoom work from any pane. Release within 4 px is the
  // pick. Synthetic events are ignored by every pick handler (isTrusted).
  const ray = new THREE.Raycaster();
  let cameraDom: HTMLElement | null = null;
  let press: { x: number; y: number; button: number; forwarded: boolean } | null = null;
  const doPick = (x0: number, y0: number, button: number): void => {
    if (!pickCb) return;
    const r = canvas.getBoundingClientRect();
    const pw = single ? r.width : r.width / 2;
    const x = x0 - r.left, y = y0 - r.top;
    const right = single ? true : x >= pw;
    const group = right ? idfGroup : dbGroup;
    if (!group) return;
    const meshes = group.children.filter((o): o is THREE.Mesh => (o as THREE.Mesh).isMesh);
    ray.setFromCamera(
      new THREE.Vector2(((x - (right && !single ? pw : 0)) / pw) * 2 - 1, -(y / r.height) * 2 + 1),
      right ? cam3 : cam2,
    );
    const spaceGroup = right ? space3 : space2;
    if (spaceGroup) {
      const sm = spaceGroup.children.filter((o): o is THREE.Mesh => (o as THREE.Mesh).isMesh);
      for (const hit of ray.intersectObjects(sm, false)) {
        const rows = hit.object.userData.rowOfTri as Int32Array | undefined;
        if (!rows || hit.faceIndex == null) continue;
        pickCb({
          elementId: 0, rowIndex: -1, space: rows[hit.faceIndex]!, pane: right ? 3 : 2,
          button: button === 2 ? "right" : "left",
          clientX: x0, clientY: y0,
        });
        return;
      }
    }
    // the model's nearest cell, and the site's nearest element: whichever is closer
    let model: { dist: number; id: number; row: number } | null = null;
    for (const hit of ray.intersectObjects(meshes, false)) {
      const map = hit.object.userData.elementOfTri as Int32Array | undefined;
      const rows = hit.object.userData.rowOfTri as Int32Array | undefined;
      if (!map || !rows || hit.faceIndex == null) continue;
      const id = map[hit.faceIndex];
      if (id === undefined || id <= 0) continue;
      model = { dist: hit.distance, id, row: rows[hit.faceIndex] ?? -1 };
      break;
    }
    const terrainGroup = right ? terrain3 : terrain2;
    let site: { dist: number; el: { expressId: number; name: string; ifcClass: string; file: string; fileExpressId: number } } | null = null;
    let mep: { dist: number; el: NonNullable<PickHit["mepElement"]> } | null = null;
    if (terrainGroup) {
      const sm: THREE.Mesh[] = [];
      terrainGroup.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && (m.userData.siteElement || m.userData.mepElement)) sm.push(m); });
      const h = ray.intersectObjects(sm, false)[0];
      if (h && h.object.userData.mepElement) mep = { dist: h.distance, el: h.object.userData.mepElement as NonNullable<PickHit["mepElement"]> };
      else if (h) site = { dist: h.distance, el: h.object.userData.siteElement as { expressId: number; name: string; ifcClass: string; file: string; fileExpressId: number } };
    }
    if (mep && (!model || mep.dist < model.dist)) {
      pickCb({ elementId: 0, rowIndex: -1, mepElement: mep.el, pane: right ? 3 : 2, button: button === 2 ? "right" : "left", clientX: x0, clientY: y0 });
      return;
    }
    if (site && (!model || site.dist < model.dist)) {
      pickCb({ elementId: 0, rowIndex: -1, siteElement: site.el, pane: right ? 3 : 2, button: button === 2 ? "right" : "left", clientX: x0, clientY: y0 });
      return;
    }
    if (model) {
      pickCb({ elementId: model.id, rowIndex: model.row, pane: right ? 3 : 2, button: button === 2 ? "right" : "left", clientX: x0, clientY: y0 });
      return;
    }
    // nothing under the cursor: a right click is reported as an empty hit (it clears the selection)
    if (button === 2) pickCb({ elementId: 0, rowIndex: -1, empty: true, pane: right ? 3 : 2, button: "right", clientX: x0, clientY: y0 });
  };
  const onDown = (ev: PointerEvent): void => {
    if (!ev.isTrusted || (ev.button !== 0 && ev.button !== 2)) return;
    press = { x: ev.clientX, y: ev.clientY, button: ev.button, forwarded: false };
  };
  const onMove = (ev: PointerEvent): void => {
    if (!press || press.forwarded || !cameraDom) return;
    if (Math.hypot(ev.clientX - press.x, ev.clientY - press.y) <= 4) return;
    press.forwarded = true;
    cameraDom.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true, cancelable: true,
      pointerId: ev.pointerId, pointerType: ev.pointerType,
      button: press.button, buttons: ev.buttons,
      clientX: press.x, clientY: press.y,
    }));
  };
  const onUp = (ev: PointerEvent): void => {
    const p = press;
    press = null;
    if (!p || p.forwarded) return;
    if (Math.hypot(ev.clientX - p.x, ev.clientY - p.y) > 4) return;
    doPick(ev.clientX, ev.clientY, p.button);
  };
  const onWheel = (ev: WheelEvent): void => {
    cameraDom?.dispatchEvent(new WheelEvent("wheel", ev));
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("wheel", onWheel, { passive: true });
  // the corrective menu is ours, not the browser's
  const noMenu = (ev: Event): void => ev.preventDefault();
  canvas.addEventListener("contextmenu", noMenu);

  const render = (master?: THREE.PerspectiveCamera): void => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    // a canvas not on screen draws nothing — a hidden WebGL canvas fills the GPU process until it dies (view/ifcPane.ts says how it was measured)
    if (w === 0 || h === 0 || !(canvas.checkVisibility?.({ visibilityProperty: true }) ?? true)) return;
    const pw = single ? w : Math.floor(w / 2);
    // both sides checked (2026-10-27): a height-only change (the frame below or the status line moving) left the drawing at its old
    // height, stretched into the new box, so the IDF view no longer matched the IFC view beside it until a width change reset it
    const pr = renderer.getPixelRatio();
    if (canvas.width !== Math.floor(w * pr) || canvas.height !== Math.floor(h * pr)) renderer.setSize(w, h, false);
    const draw: ReadonlyArray<readonly [THREE.PerspectiveCamera, THREE.Scene, number]> =
      single ? [[cam3, scene3, 0]] : [[cam2, scene2, 0], [cam3, scene3, pw]];
    for (const [cam, scene, x] of draw) {
      if (master) {
        cam.position.copy(master.position);
        cam.quaternion.copy(master.quaternion);
        cam.fov = master.fov;
      }
      cam.aspect = pw / h;
      cam.updateProjectionMatrix();
      renderer.setViewport(x, 0, pw, h);
      renderer.setScissor(x, 0, pw, h);
      renderer.render(scene, cam);
    }
  };

  let raf = 0;
  let masterRef: THREE.PerspectiveCamera | null = null;
  // a frame that throws is counted and named, never the end of the loop (2026-09-08)
  let renderErrors = 0, lastRenderError: string | null = null;
  // ten frames failing in a row halt the loop and tell the app (2026-10-09): three.js leaves its render stacks pushed on every frame that
  // throws mid-draw, so a view that fails frame after frame leaks without end (view/ifcPane.ts says how it was measured)
  let inRow = 0;
  const loop = (): void => {
    // the CFD arrows move while the switch says so (2026-11-10) — the group carries its own step
    if (cfdGroup && cfdMoving && typeof cfdGroup.userData.animate === "function") { try { (cfdGroup.userData.animate as (s: number) => void)(performance.now() / 1000); } catch { /* a view, never the loop */ } }
    try { render(masterRef ?? undefined); inRow = 0; } catch (e) {
      renderErrors++; lastRenderError = e instanceof Error ? e.message : String(e);
      if (renderErrors === 1) console.warn("[db-panes] a frame threw; the loop goes on:", lastRenderError);
      if (++inRow >= 10) { window.dispatchEvent(new CustomEvent("bim-render-broken", { detail: `the IDF-DB view: ${lastRenderError}` })); return; }
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  return {
    setDbGroup(group) {
      if (dbGroup) scene2.remove(dbGroup);
      dbGroup = group;
      if (group) scene2.add(group);
    },
    setIdfGroup(group) {
      if (idfGroup) scene3.remove(idfGroup);
      idfGroup = group;
      if (group) scene3.add(group);
      if (sunOn) shadowFlags();
    },
    setSpaceGroups(db, idf) {
      if (space2) scene2.remove(space2);
      if (space3) scene3.remove(space3);
      space2 = db; space3 = idf;
      if (db) scene2.add(db);
      if (idf) scene3.add(idf);
    },
    setTerrainGroups(db, idf) {
      if (terrain2) scene2.remove(terrain2);
      if (terrain3) scene3.remove(terrain3);
      terrain2 = db; terrain3 = idf;
      if (db) scene2.add(db);
      if (idf) scene3.add(idf);
      if (sunOn) shadowFlags();
    },
    setSun(dir) { applySun(dir); },
    setSunGroup(group) {
      if (sunGroup) scene3.remove(sunGroup);
      sunGroup = group;
      if (group) scene3.add(group);
    },
    setCfdGroup(group) {
      if (cfdGroup) scene3.remove(cfdGroup);
      cfdGroup = group;
      if (group) scene3.add(group);
    },
    setCfdMoving(on) {
      cfdMoving = on;
      // held still at the bins' own points when switched off
      if (!on && cfdGroup && typeof cfdGroup.userData.animate === "function") (cfdGroup.userData.animate as (s: null) => void)(null);
    },
    setHighlights(db, idf) {
      if (hi2) scene2.remove(hi2);
      if (hi3) scene3.remove(hi3);
      hi2 = db; hi3 = idf;
      if (db) scene2.add(db);
      if (idf) scene3.add(idf);
    },
    onPick(cb) { pickCb = cb; },
    setCameraDom(el) { cameraDom = el; },
    sync(master) { masterRef = master; },
    setLayout(s) { single = s; },
    dispose() {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", noMenu);
      renderer.dispose();
    },
    census: () => {
      // the instrument for the site overlay (2026-09-05): what pane 3's terrain group holds
      let meshes = 0, glow = 0, siteEls = 0;
      let mepEls = 0;
      terrain3?.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh) return; meshes++; if (m.userData.siteElement) siteEls++; if (m.userData.mepElement) mepEls++; const mat = m.material as THREE.MeshBasicMaterial; if (mat?.color?.getHex?.() === 0xffd166 && mat.depthTest === false) glow++; });
      const badGeometry: string[] = [];
      for (const [nm, sc] of [["pane2", scene2], ["pane3", scene3]] as const) sc.traverse((o) => {
        const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
        if (!g || !g.attributes) return;
        const bad = Object.entries(g.attributes).filter(([, a]) => !(a as THREE.BufferAttribute).array).map(([k]) => k);
        if (g.index && !g.index.array) bad.push("index");
        if (bad.length) badGeometry.push(`${nm}: ${o.type} "${o.name || "(unnamed)"}" under "${o.parent?.name || "(root)"}": ${bad.join(", ")}`);
      });
      return { pane2Children: scene2.children.length, pane3Children: scene3.children.length, terrain3: terrain3 ? { meshes, siteElements: siteEls, mepElements: mepEls, glow } : null, sun: sunOn, renderErrors, lastRenderError, badGeometry };
    },
  };
}
