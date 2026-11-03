// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// Pane 1: the IFC as ThatOpen renders it. The incantations (worker URL, wasm
// path, COORDINATE_TO_ORIGIN) are the ones the predecessor project settled.

import * as OBC from "@thatopen/components";
import { RenderedFaces } from "@thatopen/fragments";
import * as THREE from "three";
import CameraControls from "camera-controls";
import { WASM_DIR, wasmUrl } from "../core/wasmUrl.js";

export interface IfcPane {
  camera: THREE.PerspectiveCamera;
  loadIfc(bytes: Uint8Array, name: string): Promise<void>;
  fitTo(bboxMin: [number, number, number], bboxMax: [number, number, number]): void;
  census(): { models: number; sceneChildren: number; renderErrors: number; lastRenderError: string | null; lastRenderStack: string | null; meshes: { total: number; withArrays: number; empty: number; visible: number }; badGeometry: string[] };
  /** the room overlay, the same group builder panes 2 and 3 use */
  setSpaces(group: THREE.Group | null): void;
  /** the ground, the same mesh the DB panes draw */
  setTerrain(group: THREE.Group | null): void;
  /** fade the Fragments model so the rooms show through it. Fragments owns its
   *  materials, so this walks them; `null` restores what each one had. */
  setSurfaceOpacity(o: number | null): void;
  /** click an element in the Fragments view — same click threshold as the DB
   *  panes, so a rotate-drag never selects. A right-click reports itself so
   *  the app can offer Hide on exactly the element under the cursor. */
  onPick(cb: ((expressId: number, button: "left" | "right", clientX: number, clientY: number) => void) | null): void;
  /** click a ROOM face in the overlay — tested before the Fragments raycast,
   *  so while the rooms are shown a room beats the wall behind it. `row` is
   *  the index into the rows the overlay was built from. */
  onSpacePick(cb: ((row: number, button: "left" | "right", clientX: number, clientY: number) => void) | null): void;
  /** THE ALIGNMENT DIALOG's pick (2026-11-03): while set, a left click takes the nearest point under the cursor — on the house
   *  (Fragments) or on the overlay (the linked files) — and nothing else; `onFile` is true when it lies on the file being aligned
   *  (the overlay's "align-preview" group). null when the click hit nothing. */
  pickPoint(cb: ((hit: { point: [number, number, number]; onFile: boolean } | null) => void) | null): void;
  /** the hot outline of the selected room face; null clears it */
  setSpaceHighlight(group: THREE.Group | null): void;
  /** elements the user has hidden; Fragments' own visibility, never a re-derived mesh */
  setHidden(ids: ReadonlySet<number>): void;
  /** drop every loaded model, so a rewritten file can be loaded in its place */
  clear(): Promise<void>;
  /** paint one element — or every element of a room — in the selection colour; null restores */
  setHighlight(expressIds: number | number[] | null): void;
  /** what things are made of, for the eye: windows as glass, doors as wood, screens see-through —
   *  a persistent paint by element, kept under every selection */
  setClassPaint(paints: Array<{ ids: number[]; color: number; opacity: number }>): void;
  /** the element camera-controls listens on — the DB panes forward their
   *  drags and wheels here so one gesture drives all three views */
  controlsDom(): HTMLElement;
  /** THE STANDARD VIEWS (user, 2026-09-08: "scroll, rotate, typical view tools
   *  for plan views"): `plan` looks straight down; an elevation stands on the side
   *  it is named for — the PROJECT GRID's compass, −Z north as everywhere here —
   *  and looks at that face; `iso` the south-east corner from above; `fit` frames
   *  the box from where the camera stands. One camera serves every pane. */
  view(preset: ViewPreset, min: [number, number, number], max: [number, number, number]): void;
  /** zoom by a fraction of the distance to the target: +0.25 in, −0.25 out (the wheel does the same) */
  zoom(step: number): void;
  /** what a LEFT drag does — orbit, or pan (scroll the plan); a right drag always pans */
  setDrag(mode: DragMode): void;
  /** the camera's position and target, to come back to (user, 2026-10-02: a double right-click on a space name returns to the view before) */
  getView(): { position: [number, number, number]; target: [number, number, number] };
  setView(v: { position: [number, number, number]; target: [number, number, number] }): void;
  /** frame a box from where the camera stands — its direction kept, the box's sphere filling the view */
  frame(min: [number, number, number], max: [number, number, number]): void;
  /** the camera as it stands (end of any transition), for the census */
  cameraState(): { position: number[]; target: number[]; azimuthDeg: number; polarDeg: number; distance: number };
  /** Release the WebGL context. Without this a dev-session's HMR remounts
   *  each leak a renderer; past the browser's ~16-context cap the oldest are
   *  dropped and the OTHER panes go blank — which looks like a geometry bug
   *  and is not one (2026-08-31). */
  dispose(): void;
}

export type ViewPreset = "plan" | "S" | "N" | "E" | "W" | "iso" | "fit";
export type DragMode = "orbit" | "pan";

export async function createIfcPane(container: HTMLElement): Promise<IfcPane> {
  const components = new OBC.Components();
  const worlds = components.get(OBC.Worlds);
  const world = worlds.create<OBC.SimpleScene, OBC.SimpleCamera, OBC.SimpleRenderer>();
  world.scene = new OBC.SimpleScene(components);
  world.renderer = new OBC.SimpleRenderer(components, container);
  world.camera = new OBC.SimpleCamera(components);
  // the pane is one third of a working surface, not a demo scene
  world.renderer.showLogo = false;

  const fragments = components.get(OBC.FragmentsManager);
  fragments.init(wasmUrl("fragments-worker.mjs"));

  components.init();
  world.scene.setup();
  world.scene.three.background = new THREE.Color(0x0f1117);
  world.scene.three.add(new THREE.GridHelper(40, 40, 0x2a2f3a, 0x1a1e27));

  // ── picking: Fragments raycasts in its worker, off the stored model ──────
  let pickCb: ((expressId: number, button: "left" | "right", clientX: number, clientY: number) => void) | null = null;
  let classPaint: Array<{ ids: number[]; color: number; opacity: number }> = [];
  let lastHighlight: number | number[] | null = null;
  let spacePickCb: ((row: number, button: "left" | "right", clientX: number, clientY: number) => void) | null = null;
  let pointCb: ((hit: { point: [number, number, number]; onFile: boolean } | null) => void) | null = null;
  const spaceRay = new THREE.Raycaster();
  let down: { x: number; y: number; button: number } | null = null;
  const dom = (): HTMLElement => world.renderer!.three.domElement;
  dom().addEventListener("pointerdown", (ev) => {
    if (ev.isTrusted && (ev.button === 0 || ev.button === 2)) down = { x: ev.clientX, y: ev.clientY, button: ev.button };
  });
  dom().addEventListener("contextmenu", (ev) => ev.preventDefault());
  dom().addEventListener("pointerup", (ev) => {
    // a synthetic event is a forwarded camera gesture from another pane, not
    // a click in this one
    if (!ev.isTrusted || !down || (!pickCb && !pointCb)) { down = null; return; }
    const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
    const button = down.button === 2 ? "right" : "left";
    down = null;
    if (moved > 4) return;
    if (pointCb) {
      if (button !== "left") return;
      const cb = pointCb;
      void (async () => {
        const rect = dom().getBoundingClientRect();
        const cam = world.camera.three as THREE.PerspectiveCamera;
        spaceRay.setFromCamera(new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1), cam);
        let best: { point: THREE.Vector3; distance: number; onFile: boolean } | null = null;
        const over = world.scene.three.getObjectByName("terrain");
        if (over) {
          over.updateMatrixWorld(true);
          const meshes: THREE.Mesh[] = [];
          over.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.visible) meshes.push(o as THREE.Mesh); });
          const h = spaceRay.intersectObjects(meshes, false)[0];
          if (h) {
            let onFile = false;
            for (let o: THREE.Object3D | null = h.object; o; o = o.parent) if (o.name === "align-preview") { onFile = true; break; }
            best = { point: h.point, distance: h.distance, onFile };
          }
        }
        for (const [, model] of fragments.list) {
          const hit = await model.raycast({ camera: cam, mouse: new THREE.Vector2(ev.clientX, ev.clientY), dom: world.renderer!.three.domElement });
          if (hit && (!best || hit.distance < best.distance)) best = { point: hit.point, distance: hit.distance, onFile: false };
        }
        cb(best ? { point: [best.point.x, best.point.y, best.point.z], onFile: best.onFile } : null);
      })();
      return;
    }
    if (!pickCb) return;
    // the rooms first, when they are shown: an ordinary three.js raycast on
    // the overlay mesh, off its stored-row map
    const spaces = world.scene.three.getObjectByName("spaces");
    if (spaces && spacePickCb) {
      const rect = dom().getBoundingClientRect();
      spaceRay.setFromCamera(
        new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1),
        world.camera.three as THREE.PerspectiveCamera,
      );
      const meshes: THREE.Mesh[] = [];
      spaces.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
      for (const hit of spaceRay.intersectObjects(meshes, false)) {
        const rows = hit.object.userData.rowOfTri as Int32Array | undefined;
        if (!rows || hit.faceIndex == null) continue;
        spacePickCb(rows[hit.faceIndex]!, button, ev.clientX, ev.clientY);
        return;
      }
    }
    void (async () => {
      let best: { id: number; distance: number } | null = null;
      for (const [, model] of fragments.list) {
        const hit = await model.raycast({
          camera: world.camera.three as THREE.PerspectiveCamera,
          mouse: new THREE.Vector2(ev.clientX, ev.clientY),
          dom: world.renderer!.three.domElement,
        });
        if (hit && (!best || hit.distance < best.distance)) {
          best = { id: hit.localId, distance: hit.distance };
        }
      }
      if (best && pickCb) pickCb(best.id, button, ev.clientX, ev.clientY);
      else if (pickCb && button === "right") pickCb(0, button, ev.clientX, ev.clientY);   // a right click on nothing: 0
    })();
  });

  fragments.list.onItemSet.add(({ value: model }) => {
    model.useCamera(world.camera.three as THREE.PerspectiveCamera);
    world.scene.three.add(model.object);
    fragments.core.update(true);
  });
  world.camera.controls.addEventListener("rest", () => fragments.core.update(true));
  world.camera.controls.addEventListener("update", () => fragments.core.update(true));

  // THE LOOP MUST NOT DIE (2026-09-08, "orbit and pan are both not working"): ThatOpen's Components.update
  // calls every component's update and only THEN schedules the next frame, so one exception thrown by
  // three.js while rendering this scene (a geometry whose attribute array is undefined) ended the loop —
  // and camera-controls updates in that loop, so every pane's camera froze: no orbit, no pan, no preset.
  // The renderer's update is wrapped: a bad frame is counted and named, the loop goes on, and the
  // census lists any geometry that cannot be drawn.
  let renderErrors = 0, lastRenderError: string | null = null, lastRenderStack: string | null = null;
  {
    const r = world.renderer!;
    const orig = r.update.bind(r);
    // the STACK is kept too (2026-09-19): "a geometry whose attribute array is undefined" says what, never WHERE —
    // and when the model stops drawing entirely, where is the whole question. The first few frames are enough.
    // A VIEW THAT KEEPS FAILING IS A LEAK (measured 2026-10-09; three.js 0.185.1 WebGLRenderer.render): render() pushes a render state and a
    // render list onto two internal stacks before it draws and pops them only at the end, so a frame that throws mid-draw leaves both
    // pushed — and the next frame makes a new pair one level deeper. After the GPU process died the view threw on every frame (~7,200 a
    // minute) and the heap grew ~22 MB a minute with it, to the out-of-memory crash in hours. The throw is three.js reading an attribute
    // array Fragments freed after upload, gone from the GPU with the context: no frame of that view can draw again. So ten frames failing
    // in a row HALT the view (nothing more is pushed) and the app is told once — it reloads the page and reopens the house (App.tsx).
    // A HIDDEN VIEW DRAWS NOTHING (measured 2026-10-09). Off the BIM screens the pane is ghosted (visibility: hidden, full size — the
    // camera element keeps its rectangle) and the loop went on drawing every frame into a canvas never put on screen. Chromium never
    // presents such a canvas, and ANGLE's Metal backend kept every frame's draw data (ContextMtl::handleDirtyDefaultAttribs,
    // ProgramExecutableMtl::commitUniforms in the crash dumps) until the GPU process ran out of memory (partition_alloc OnNoMemory,
    // exit 5) every one to two minutes — Chromium then switches WebGL off for the app. Reproduced on Electron 44.1.0 alone: a three.js
    // scene drawn into a visibility:hidden canvas grew the GPU process 137 → 1,137 MB in a minute; drawn visible it held 723 MB, and
    // hidden with the draw skipped 86 MB. The camera updates in its own step (world.update: camera, then renderer), so a drag forwarded
    // from another pane still moves it.
    const shown = (): boolean => container.clientWidth > 0 && container.clientHeight > 0 && (container.checkVisibility?.({ visibilityProperty: true }) ?? true);
    let inRow = 0, halted = false;
    r.update = (): void => {
      if (halted || !shown()) return;
      try { orig(); inRow = 0; } catch (e) {
        if (++inRow >= 10) { halted = true; window.dispatchEvent(new CustomEvent("bim-render-broken", { detail: `the IFC view: ${e instanceof Error ? e.message : String(e)}` })); }
        renderErrors++;
        lastRenderError = e instanceof Error ? e.message : String(e);
        lastRenderStack = e instanceof Error && e.stack ? e.stack.split("\n").slice(0, 8).join(" | ") : null;
        if (renderErrors === 1) console.warn("[ifc-pane] a frame threw; the loop goes on:", lastRenderError, lastRenderStack);
      }
    };
  }
  /** how much of the scene can actually be drawn — an empty mesh is one the renderer will throw on */
  const meshCensus = (): { total: number; withArrays: number; empty: number; visible: number } => {
    let total = 0, withArrays = 0, empty = 0, visible = 0;
    world.scene.three.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      total++;
      if (m.visible) visible++;
      const a = (m.geometry as THREE.BufferGeometry | undefined)?.attributes?.position as THREE.BufferAttribute | undefined;
      if (a && a.array && a.array.length) withArrays++; else empty++;
    });
    return { total, withArrays, empty, visible };
  };
  const badGeometry = (): string[] => {
    const out: string[] = [];
    world.scene.three.traverse((o) => {
      const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
      if (!g || !g.attributes) return;
      const bad = Object.entries(g.attributes).filter(([, a]) => !(a as THREE.BufferAttribute).array).map(([k]) => k);
      if (g.index && !g.index.array) bad.push("index");
      if (bad.length) out.push(`${o.type} "${o.name || "(unnamed)"}" under "${o.parent?.name || "(root)"}": ${bad.join(", ")}`);
    });
    return out;
  };

  /** the class paint first, the selection over it — one path for both */
  const applyHighlight = (expressIds: number | number[] | null): void => {
    const list = expressIds === null ? [] : Array.isArray(expressIds) ? expressIds : [expressIds];
    lastHighlight = expressIds;
    void (async () => {
      for (const [, model] of fragments.list) {
        await model.resetHighlight();
        // the class paint first, the selection over it
        for (const p of classPaint) {
          if (!p.ids.length) continue;
          await model.highlight(p.ids, { color: new THREE.Color(p.color), renderedFaces: RenderedFaces.TWO, opacity: p.opacity, transparent: p.opacity < 1 });
        }
        if (list.length) {
          await model.highlight(list, {
            color: new THREE.Color(0xffd166),
            renderedFaces: RenderedFaces.TWO,
            opacity: 1,
            transparent: false,
          });
        }
      }
      fragments.core.update(true);
    })();
  };

  // under a hot reload the pane outlives its world: `world.scene` and `fragments.core` THROW ("No scene initialized!",
  // "FragmentsManager not initialized") from the mount effects that draw the terrain and re-apply hiding, and the App
  // unmounted (2026-09-10). A dead pane answers nothing and throws nothing; the next page load makes a live one.
  const live = (): boolean => { try { return !!world.scene.three && !!fragments.core; } catch { return false; } };
  const pane: IfcPane = {
    camera: world.camera.three as THREE.PerspectiveCamera,
    async loadIfc(bytes: Uint8Array, name: string) {
      const loader = components.get(OBC.IfcLoader);
      await loader.setup({
        autoSetWasm: false,
        wasm: { path: WASM_DIR, absolute: true },
        webIfc: { COORDINATE_TO_ORIGIN: false },
      });
      await loader.load(bytes, true, name, {
        processData: {
          progressCallback: (p: number) =>
            console.log(`[ifc-pane] convert ${(p * 100).toFixed(0)}%`),
        },
      });
    },
    fitTo(min, max) {
      const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2, cz = (min[2] + max[2]) / 2;
      const r = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
      void world.camera.controls.setLookAt(cx + r, cy + r * 0.7, cz + r, cx, cy, cz, false);
    },
    view(preset, min, max) {
      const c = world.camera.controls;
      const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2, cz = (min[2] + max[2]) / 2;
      const sx = max[0] - min[0], sy = max[1] - min[1], sz = max[2] - min[2];
      if (preset === "fit") {
        // the box's sphere, not the box: fitToBox snaps the camera to the nearest face of the
        // box (measured: iso 45°/64° → the east elevation); fitToSphere keeps the direction
        void c.fitToSphere(new THREE.Sphere(new THREE.Vector3(cx, cy, cz), Math.hypot(sx, sy, sz) / 2), true);
        return;
      }
      if (preset === "iso") { const r = Math.max(sx, sy, sz); void c.setLookAt(cx + r, cy + r * 0.7, cz + r, cx, cy, cz, true); return; }
      // the plan: a hair off the vertical, so camera-controls keeps an up vector
      if (preset === "plan") { const r = Math.max(sx, sz); void c.setLookAt(cx, cy + r * 1.6, cz + 0.001, cx, cy, cz, true); return; }
      // an elevation: the camera stands on the named side, far enough for that face to fit
      const d = 1.6 * Math.max(sy, preset === "S" || preset === "N" ? sx : sz);
      const [px, pz] = preset === "S" ? [cx, cz + d] : preset === "N" ? [cx, cz - d] : preset === "E" ? [cx + d, cz] : [cx - d, cz];
      void c.setLookAt(px, cy, pz, cx, cy, cz, true);
    },
    getView() {
      const c = world.camera.controls;
      const p = c.getPosition(new THREE.Vector3()), t = c.getTarget(new THREE.Vector3());
      return { position: [p.x, p.y, p.z], target: [t.x, t.y, t.z] };
    },
    setView(v) { void world.camera.controls.setLookAt(...v.position, ...v.target, true); },
    frame(min, max) {
      const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2, cz = (min[2] + max[2]) / 2;
      // a floor of 1 m on the radius: a thin cavity's sphere would put the camera inside the wall beside it
      const r = Math.max(1, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2);
      void world.camera.controls.fitToSphere(new THREE.Sphere(new THREE.Vector3(cx, cy, cz), r), true);
    },
    zoom(step) { const c = world.camera.controls; void c.dolly(c.distance * step, true); },
    // a mount effect calls this; under a hot reload the pane outlives its world and `world.camera` throws — that must not end the app (2026-09-08)
    setDrag(mode) { try { world.camera.controls.mouseButtons.left = mode === "pan" ? CameraControls.ACTION.TRUCK : CameraControls.ACTION.ROTATE; } catch { /* no camera yet */ } },
    cameraState() {
      const c = world.camera.controls;
      const r3 = (v: THREE.Vector3): number[] => [v.x, v.y, v.z].map((x) => Math.round(x * 1000) / 1000);
      const deg = (a: number): number => Math.round((a * 180) / Math.PI * 10) / 10;
      return { position: r3(c.getPosition(new THREE.Vector3())), target: r3(c.getTarget(new THREE.Vector3())), azimuthDeg: deg(c.azimuthAngle), polarDeg: deg(c.polarAngle), distance: Math.round(c.distance * 1000) / 1000 };
    },
    census: () => (!live() ? { models: 0, sceneChildren: 0, renderErrors, lastRenderError: "the pane's world is disposed (a hot reload) — reload the page", lastRenderStack: null, meshes: { total: 0, withArrays: 0, empty: 0, visible: 0 }, badGeometry: [] as ReturnType<typeof badGeometry> } : {
      models: fragments.list.size,
      sceneChildren: world.scene.three.children.length,
      renderErrors, lastRenderError, lastRenderStack, meshes: meshCensus(), badGeometry: badGeometry(),
    }),
    setSpaces(group) {
      if (!live()) return;
      const old = world.scene.three.getObjectByName("spaces");
      if (old) world.scene.three.remove(old);
      if (group) world.scene.three.add(group);
    },
    setTerrain(group) {
      if (!live()) return;
      const old = world.scene.three.getObjectByName("terrain");
      if (old) world.scene.three.remove(old);
      if (group) world.scene.three.add(group);
    },
    setSurfaceOpacity(o) {
      for (const [, model] of fragments.list) {
        model.object.traverse((obj) => {
          const mats = (obj as THREE.Mesh).material;
          if (!mats) return;
          for (const m of Array.isArray(mats) ? mats : [mats]) {
            const mat = m as THREE.Material & { opacity: number; transparent: boolean };
            // Save the WHOLE original state, not just opacity. Restoring
            // opacity while leaving depthWrite off leaves the model z-broken
            // and still see-through — unticking looked like it did nothing
            // (2026-09-01).
            let base = mat.userData.baseState as
              { opacity: number; transparent: boolean; depthWrite: boolean } | undefined;
            if (!base) {
              base = { opacity: mat.opacity, transparent: mat.transparent, depthWrite: mat.depthWrite };
              mat.userData.baseState = base;
            }
            if (o === null) {
              mat.opacity = base.opacity;
              mat.transparent = base.transparent;
              mat.depthWrite = base.depthWrite;
            } else {
              mat.opacity = o;
              mat.transparent = true;
              mat.depthWrite = false;
            }
            mat.needsUpdate = true;
          }
        });
      }
    },
    onPick(cb) { pickCb = cb; },
    pickPoint(cb) { pointCb = cb; dom().style.cursor = cb ? "crosshair" : ""; },
    onSpacePick(cb) { spacePickCb = cb; },
    setSpaceHighlight(group) {
      const old = world.scene.three.getObjectByName("space-highlight");
      if (old) world.scene.three.remove(old);
      if (group) { group.name = "space-highlight"; world.scene.three.add(group); }
    },
    async clear() {
      for (const [id, model] of [...fragments.list]) {
        world.scene.three.remove(model.object);
        await fragments.core.disposeModel(id);
      }
      fragments.core.update(true);
    },
    setHidden(ids) {
      if (!live()) return;
      void (async () => {
        for (const [, model] of fragments.list) {
          await model.resetVisible();
          if (ids.size) await model.setVisible([...ids], false);
        }
        fragments.core.update(true);
      })();
    },
    setClassPaint(paints) {
      classPaint = paints;
      applyHighlight(lastHighlight);
    },
    setHighlight(expressIds) { applyHighlight(expressIds); },
    controlsDom: dom,
    dispose() { components.dispose(); },
  };
  // EVERY method guarded once (2026-09-10): the first guard covered four methods and the hot reload found two more
  // (`setSpaceHighlight`, `cameraState`) — a dead pane answers a harmless value and never throws into a mount effect
  const dead: Partial<Record<keyof IfcPane, () => unknown>> = {
    cameraState: () => ({ position: [0, 0, 0], target: [0, 0, 0], azimuthDeg: 0, polarDeg: 0, distance: 0 }),
    census: () => ({ models: 0, sceneChildren: 0, renderErrors, lastRenderError: "the pane's world is disposed (a hot reload) — reload the page", lastRenderStack: null, meshes: { total: 0, withArrays: 0, empty: 0, visible: 0 }, badGeometry: [] }),
    loadIfc: () => Promise.resolve(),
    onPick: () => () => undefined, onSpacePick: () => () => undefined, pickPoint: () => undefined,
  };
  for (const k of Object.keys(pane) as Array<keyof IfcPane>) {
    const v = pane[k];
    if (typeof v !== "function") continue;
    const fn = v as (...a: unknown[]) => unknown;
    (pane as unknown as Record<string, unknown>)[k] = (...a: unknown[]): unknown => {
      if (!live()) return dead[k]?.();
      try { return fn(...a); } catch (e) { if (!live()) return dead[k]?.(); throw e; }
    };
  }
  return pane;
}
