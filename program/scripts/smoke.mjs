// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE SMOKE RUN (2026-10-20, macOS, Windows and Linux): the built app, started in an empty folder of its own, opens the bundled
// Duplex sample, builds the model and runs EnergyPlus — the path a new user takes. It drives the app's own window over the DevTools
// protocol (as scripts/cdp.mjs does), writes smoke-result.json and exits 1 on anything short of a completed run with Fatal 0, Severe 0.
//
//   node scripts/smoke.mjs                      the app electron-builder left in ../release (pnpm dist, or electron-builder --dir)
//   node scripts/smoke.mjs --app <executable>   another build
//   node scripts/smoke.mjs --out <file>         where the result goes (default: ./smoke-result.json)
//
// EnergyPlus must be installed, or named by ENERGYPLUS. The run takes the engine's own default weather file.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const PORT = 9229;
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };

/** the built app's executable and its resources folder, for this system */
function findApp() {
  const rel = path.join(REPO, "release");
  const given = arg("--app");
  const pick = (exe, resources) => (fs.existsSync(exe) ? { exe, resources } : null);
  if (given) {
    const exe = path.resolve(given);
    const resources = process.platform === "darwin" ? path.resolve(exe, "..", "..", "Resources") : path.join(path.dirname(exe), "resources");
    return pick(exe, resources);
  }
  let dirs = [];
  try { dirs = fs.readdirSync(rel); } catch { return null; }
  for (const d of dirs) {
    const base = path.join(rel, d);
    if (process.platform === "darwin" && d.startsWith("mac")) {
      const app = path.join(base, "BIM-BEM-BOM.app");
      const found = pick(path.join(app, "Contents", "MacOS", "BIM-BEM-BOM"), path.join(app, "Contents", "Resources"));
      if (found) return found;
    }
    if (process.platform === "win32" && d.startsWith("win") && d.endsWith("unpacked")) {
      const found = pick(path.join(base, "BIM-BEM-BOM.exe"), path.join(base, "resources"));
      if (found) return found;
    }
    if (process.platform === "linux" && d.startsWith("linux") && d.endsWith("unpacked")) {
      const found = pick(path.join(base, "bim-bem-bom"), path.join(base, "resources"));
      if (found) return found;
    }
  }
  return null;
}

const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const publishedSha = () => /SHA-256:\*\*\s*`([0-9a-f]{64})`/.exec(fs.readFileSync(path.join(REPO, "examples", "Duplex", "README.md"), "utf8"))?.[1] ?? null;

/** the page's DevTools socket, once the window has loaded */
async function pageSocket(deadline) {
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === "page" && t.url.startsWith("file:"));
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("the app's window never opened");
}

async function evaluate(wsUrl, expression) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  const reply = await new Promise((res) => {
    ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id === 1) res(d); });
    ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  ws.close();
  // a protocol error is said, never read as an empty verdict (2026-10-23: the window navigated under the first evaluation on a macOS
  // runner — "Execution context was destroyed" — and the result read "no verdict")
  if (reply.error) throw new Error(`DevTools: ${reply.error.message ?? JSON.stringify(reply.error)}`);
  if (reply.result?.exceptionDetails) throw new Error(reply.result.exceptionDetails.exception?.description ?? "the page threw");
  return reply.result?.result?.value;
}

// what the page does: open the sample, wait for the model, Run EnergyPlus, wait for the engine's verdict
const PAGE_SCRIPT = (ifc) => `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const status = () => document.querySelector(".status")?.textContent ?? "";
  for (let i = 0; i < 120 && !window.__BIM__?.open; i++) await wait(500);
  await window.__BIM__.open(${JSON.stringify(ifc)});
  // the energy model is built when BEM is opened, as a user would: BEM, then its RUN tab
  [...document.querySelectorAll(".rail .railItem")].find((e) => e.textContent.trim() === "BEM").click(); await wait(800);
  [...document.querySelectorAll(".editTabs button")].find((x) => /^RUN/.test(x.textContent.trim())).click(); await wait(800);
  for (let i = 0; i < 480 && !window.__BIM__.census().bemModel; i++) await wait(500);
  if (!window.__BIM__.census().bemModel) return { error: "the model was never built", status: status() };
  const b = [...document.querySelectorAll("button")].find((x) => /Run EnergyPlus/.test(x.textContent));
  if (!b) return { error: "no Run EnergyPlus button", status: status() };
  b.click(); await wait(800);
  const blocked = document.querySelector(".dialog.runBlocked")?.innerText;
  if (blocked) return { error: "the run was refused", blocked };
  for (let i = 0; i < 1800 && !/EnergyPlus (completed|did not complete)|BEM run failed/.test(status()); i++) await wait(500);
  return { status: status(), model: window.__BIM__.census().bemModel?.modelSha ?? null, runLine: document.querySelector(".runLine")?.textContent ?? null, engine: [...document.querySelectorAll(".kv, .idfInfo")].map((e) => e.textContent).filter((t) => /^engine|NOT FOUND|cannot run/.test(t)).slice(0, 3) };
})()`;

async function main() {
  const out = path.resolve(arg("--out") ?? "smoke-result.json");
  const result = { platform: `${process.platform}-${process.arch}`, ok: false };
  const app = findApp();
  if (!app) { result.error = "no built app found — run pnpm dist (or electron-builder --dir) first, or pass --app"; return finish(out, result); }
  const ifc = path.join(app.resources, "examples", "Duplex", "Duplex_A_20110907.ifc");
  result.app = app.exe;
  // the repository's sample and the bundled one must both be the published file, byte for byte (line endings included)
  result.sample = { published: publishedSha(), repo: sha256(path.join(REPO, "examples", "Duplex", "Duplex_A_20110907.ifc")), bundled: fs.existsSync(ifc) ? sha256(ifc) : null };
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "enthalix-smoke-"));
  // Linux in CI has no display or GPU: Chromium's own software GL (SwiftShader) draws the 3D view there, where WebGL2 is otherwise blocked
  const args = [`--remote-debugging-port=${PORT}`, ...(process.platform === "linux" ? ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] : [])];
  const env = { ...process.env, ENTHALIX_HOME: home };
  delete env.ELECTRON_RUN_AS_NODE;
  const t0 = Date.now();
  const child = spawn(app.exe, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  try {
    // THE PAGE MAY STILL BE LOADING when its socket first answers: an evaluation the page's own navigation cuts off is tried once more,
    // on the page as it then stands, after a pause; any other failure stands
    let r;
    for (let attempt = 1; ; attempt++) {
      const ws = await pageSocket(Date.now() + 120000);
      try { r = await evaluate(ws, PAGE_SCRIPT(ifc)); break; }
      catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (attempt >= 2 || !/context was destroyed|navigated|Target closed|Cannot find context/i.test(msg)) throw e;
        result.retried = msg;
        await new Promise((res) => setTimeout(res, 3000));
      }
    }
    Object.assign(result, r);
    const m = /EnergyPlus completed · Fatal (\d+) · Severe (\d+) · Warning (\d+) · heating (\d+) · cooling (\d+) kWh/.exec(r?.status ?? "");
    if (m) Object.assign(result, { fatal: +m[1], severe: +m[2], warning: +m[3], heatingKwh: +m[4], coolingKwh: +m[5] });
    // the engine's own report, kept beside the result: its Severe lines, and whether its shadows fell back from the graphics card
    const runs = path.join(home, "data", "bem", "runs");
    let errText = "";
    try { const last = fs.readdirSync(runs).sort().pop(); errText = fs.readFileSync(path.join(runs, last, "eplusout.err"), "utf8"); } catch { /* no run folder */ }
    if (errText) {
      fs.writeFileSync(path.join(path.dirname(out), "smoke-eplusout.err"), errText);
      result.severeLines = errText.split(/\r?\n/).filter((l) => /\*\* Severe/.test(l)).map((l) => l.trim());
      result.shadingNotes = errText.split(/\r?\n/).filter((l) => /PixelCounting|OpenGL|graphics/i.test(l)).map((l) => l.trim()).slice(0, 6);
    }
    const s = result.sample;
    // A MACHINE WITHOUT A GRAPHICS CARD (the CI runners): EnergyPlus says "No GPU found (required for PixelCounting)" and casts the
    // shadows by polygon clipping, which refuses a non-convex casting surface as Severe. That case, and only that one, passes — recorded
    const noGpu = (result.shadingNotes ?? []).some((l) => /No GPU found/i.test(l));
    const onlyNonConvex = (result.severeLines ?? []).length === result.severe && (result.severeLines ?? []).every((l) => /is a casting surface and is non-convex/.test(l));
    result.shadingFallback = noGpu;
    const severeOk = result.severe === 0 || (noGpu && onlyNonConvex);
    result.ok = !!m && result.fatal === 0 && severeOk && s.published === s.repo && s.repo === s.bundled;
    if (m && !result.ok && s.published !== s.repo) result.error = "the sample's SHA-256 differs from examples/Duplex/README.md (line endings rewritten?)";
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
  } finally {
    result.seconds = Math.round((Date.now() - t0) / 1000);
    child.kill();
    result.log = log.split(/\r?\n/).filter(Boolean).slice(-20);
    // a failed run keeps its folder (the engine's eplusout.err is in data/bem/runs/<stamp>/); a passed one is removed
    if (result.ok) { try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* a Windows file still held: left in the temp folder */ } }
    else result.home = home;
  }
  return finish(out, result);
}

function finish(out, result) {
  fs.writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
  const line = result.ok
    ? `smoke OK on ${result.platform}: Fatal 0 · Severe ${result.severe}${result.severe ? " (no GPU: polygon-clipped shadows, non-convex casting surfaces)" : ""} · heating ${result.heatingKwh} · cooling ${result.coolingKwh} kWh · ${result.seconds} s`
    : `smoke FAILED on ${result.platform}: ${result.error ?? result.status ?? "no verdict"}`;
  console.log(line);
  process.exit(result.ok ? 0 : 1);
}

await main();
