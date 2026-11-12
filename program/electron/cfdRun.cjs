// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE AIR SOLVER, RUN (BOM › CFD, 2026-11-04): OpenFOAM is a separate program the app calls, as it calls EnergyPlus —
// found on this machine, never bundled (GPL). A run is a folder under data/cfd/runs/<stamp>/ holding the case the
// renderer wrote (cfd/core/cfdCase.ts); the steps run one after another through OpenFOAM's own launcher
// (`openfoam -c "<command>"`, the native macOS app's or a Linux install's), each step's output streamed to the window
// and kept in log.<n>.<step>. A run states how many processes it takes (1 = serial; more = the mesh split and the solver under
// MPI — the renderer writes those steps, cfd/core/cfdParallel.ts); runs go side by side while their processes fit in the cores
// this machine leaves to CFD, and wait otherwise (2026-11-04, measured: one room on 28 is 10.6× serial, four rooms on 7 each
// do the most work).

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn, spawnSync } = require("node:child_process");

/** the machine: physical cores (Open MPI places a process per core), the performance / efficiency split where macOS states it,
 *  the memory */
function readMachine() {
  const num = (name) => { const r = spawnSync("sysctl", ["-n", name], { encoding: "utf8" }); const v = parseInt((r.stdout || "").trim(), 10); return Number.isFinite(v) ? v : null; };
  let cores = null, performance = null, efficiency = null;
  if (process.platform === "darwin") {
    cores = num("hw.physicalcpu");
    const levels = num("hw.nperflevels");
    if (levels && levels >= 2) { performance = num("hw.perflevel0.physicalcpu"); efficiency = num("hw.perflevel1.physicalcpu"); }
  } else if (process.platform === "linux") {
    const r = spawnSync("lscpu", ["-p=core,socket"], { encoding: "utf8" });
    const set = new Set((r.stdout || "").split("\n").filter((l) => l && !l.startsWith("#")));
    if (set.size) cores = set.size;
  }
  if (!cores) cores = os.availableParallelism ? os.availableParallelism() : os.cpus().length;
  return { platform: process.platform, cores, performance, efficiency, memGB: Math.round(os.totalmem() / 2 ** 30) };
}

/** every launcher this machine has, asked for its version; the first that answers is used ($OPENFOAM pins one) */
function findOpenFoam() {
  if (process.platform === "win32") return { exe: null, version: null, why: "OpenFOAM has no native Windows build this app can call — run the case under WSL, or on macOS / Linux" };
  const c = [];
  if (process.env.OPENFOAM) c.push(process.env.OPENFOAM);
  c.push("/opt/homebrew/bin/openfoam", "/usr/local/bin/openfoam");
  try { for (const a of fs.readdirSync("/Applications")) if (/^OpenFOAM-v?\d+\.app$/.test(a)) c.push(path.join("/Applications", a, "Contents/Resources/etc/openfoam")); } catch { /* not macOS */ }
  for (const dir of ["/usr/bin", "/usr/local/bin"]) { try { for (const a of fs.readdirSync(dir)) if (/^openfoam\d+$/.test(a)) c.push(path.join(dir, a)); } catch { /* none */ } }
  const tried = [];
  for (const exe of c) {
    if (!fs.existsSync(exe)) continue;
    // its version, and whether it has the solver the cases are written for (buoyantSimpleFoam, openfoam.com's releases): an install
    // without it is named, never run into a failure at the solve (no filename wildcard here — the macOS app's shell crashes on one)
    const r = spawnSync(exe, ["-c", "echo $WM_PROJECT_VERSION; command -v buoyantSimpleFoam > /dev/null && echo has-solver"], { encoding: "utf8", timeout: 60000 });
    const out = (r.stdout || "").trim().split("\n").map((l) => l.trim()).filter(Boolean);
    const v = out[0], solver = out.includes("has-solver");
    if (r.status === 0 && v && solver) return { exe, version: v, why: null, tried };
    tried.push(v ? `${exe}: OpenFOAM ${v} has no buoyantSimpleFoam, the solver the cases use (openfoam.com's releases have it)` : `${exe}: ${(r.stderr || r.error || "no answer").toString().trim().slice(0, 120)}`);
  }
  return { exe: null, version: null, why: tried.length ? `no OpenFOAM install this app can use: ${tried.join(" · ")}` : "OpenFOAM is not installed — it is a separate program you install: macOS, the OpenFOAM app (github.com/gerlero/openfoam-app); Linux, openfoam.com's packages (the openfoamNNNN launcher)", tried };
}

function register(ipcMain, { dataDir }) {
  const runs = path.join(dataDir, "cfd", "runs");
  const runDir = (stamp) => {
    if (!/^[0-9A-Za-z_-]+$/.test(String(stamp))) throw new Error("bad stamp");
    return path.join(runs, String(stamp));
  };
  const inRun = (stamp, rel) => {
    const d = runDir(stamp), p = path.resolve(d, String(rel || "."));
    if (p !== d && !p.startsWith(d + path.sep)) throw new Error("outside the run folder");
    return p;
  };
  let found = null;
  ipcMain.handle("cfd:engine", async (_ev, again) => { if (!found || again) found = findOpenFoam(); return found; });

  const machine = readMachine();
  ipcMain.handle("cfd:machine", async () => machine);

  // the process budget: a run starts when its processes fit beside those running (one always may, whatever it asks)
  const budget = Math.max(1, machine.cores - (machine.cores >= 8 ? 2 : machine.cores >= 3 ? 1 : 0));
  let inUse = 0;
  const waiting = [];   // { need, start }
  const pump = () => {
    for (let i = 0; i < waiting.length; i++) {
      const w = waiting[i];
      if (inUse === 0 || inUse + w.need <= budget) { waiting.splice(i, 1); i--; inUse += w.need; w.start(); }
    }
  };
  const live = new Map();   // stamp → { child, cancelled }
  ipcMain.handle("cfd:run", (ev, opts) => new Promise((resolve) => {
    const need = Math.max(1, Math.min(budget, Math.round(opts.np || 1)));
    const state = { child: null, cancelled: false };
    live.set(opts.stamp, state);
    waiting.push({ stamp: opts.stamp, need, drop: () => { live.delete(opts.stamp); resolve({ ok: false, error: "cancelled", failedStep: "waiting for cores", seconds: 0 }); }, start: () => {
      runOne(ev, opts, state, need).then(resolve, (e) => resolve({ ok: false, error: String(e), seconds: 0 }))
        .finally(() => { inUse -= need; live.delete(opts.stamp); pump(); });
    } });
    if (inUse > 0 && !(inUse + need <= budget)) { try { ev.sender.send("cfd:progress", { stamp: opts.stamp, step: 0, label: "waiting", text: `waiting for ${need} of ${budget} cores — ${inUse} in use` }); } catch { /* gone */ } }
    pump();
  }));
  ipcMain.handle("cfd:cancel", async (_ev, stamp) => {
    const r = live.get(stamp);
    if (!r) return false;
    r.cancelled = true;
    const w = waiting.findIndex((x) => x.stamp === stamp);
    if (w >= 0) { waiting.splice(w, 1)[0].drop(); return true; }
    // the step's whole process group: the launcher's shell, mpirun and every rank
    try { if (r.child?.pid) process.kill(-r.child.pid, "SIGTERM"); } catch { try { r.child?.kill("SIGTERM"); } catch { /* gone */ } }
    return true;
  });
  async function runOne(ev, opts, state, np) {
    if (!found) found = findOpenFoam();
    const send = (msg) => { try { ev.sender.send("cfd:progress", { stamp: opts.stamp, ...msg }); } catch { /* window gone */ } };
    if (!found.exe) return { ok: false, error: found.why, seconds: 0 };
    const dir = runDir(opts.stamp);
    fs.mkdirSync(dir, { recursive: true });
    for (const [rel, text] of Object.entries(opts.files || {})) {
      const p = inRun(opts.stamp, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, String(text));
    }
    const t0 = Date.now();
    {
      for (let i = 0; i < opts.steps.length; i++) {
        const st = opts.steps[i];
        if (state.cancelled) return { ok: false, error: "cancelled", failedStep: st.label, seconds: (Date.now() - t0) / 1000 };
        send({ step: i, steps: opts.steps.length, label: st.label, text: `▶ ${st.label}: ${st.cmd}` });
        const log = fs.createWriteStream(path.join(dir, `log.${String(i).padStart(2, "0")}.${st.cmd.split(/\s/)[0]}`));
        const code = await new Promise((resolve) => {
          const child = spawn(found.exe, ["-c", `cd '${dir.replace(/'/g, "'\\''")}' && ${st.cmd}`], { cwd: dir, detached: true });
          state.child = child;
          let buf = "";
          const onData = (d) => {
            log.write(d);
            buf += d.toString();
            const lines = buf.split(/\r?\n/); buf = lines.pop() ?? "";
            for (const l of lines) if (l.trim()) send({ step: i, label: st.label, text: l });
          };
          child.stdout.on("data", onData);
          child.stderr.on("data", onData);
          child.on("close", (c) => { log.end(); resolve(c); });
          child.on("error", (err) => { log.end(); send({ step: i, label: st.label, text: String(err) }); resolve(-1); });
        });
        state.child = null;
        if (state.cancelled) return { ok: false, error: "cancelled", failedStep: st.label, seconds: (Date.now() - t0) / 1000 };
        if (code !== 0) return { ok: false, error: `${st.label} (${st.cmd.split(/\s/)[0]}) ended with code ${code} — its log is log.${String(i).padStart(2, "0")}.* in ${dir}`, failedStep: st.label, seconds: (Date.now() - t0) / 1000 };
      }
      return { ok: true, error: null, dir, seconds: (Date.now() - t0) / 1000, version: found.version, np };
    }
  }
  // the finished case read back by the renderer's loader (cfd/core/caseLoad.ts), inside its run folder only
  ipcMain.handle("cfd:read", async (_ev, stamp, rel) => { try { return fs.readFileSync(inRun(stamp, rel), "utf8"); } catch { return null; } });
  ipcMain.handle("cfd:list", async (_ev, stamp, rel) => { try { return fs.readdirSync(inRun(stamp, rel)); } catch { return []; } });
  ipcMain.handle("cfd:exists", async (_ev, stamp, rel) => { try { return fs.existsSync(inRun(stamp, rel)); } catch { return false; } });
  // THE ROOM HAS SETTLED at iteration n (2026-11-10): the average moved to start at n + 1 and the run to end at n + 3,000 (never past
  // its cap) — OpenFOAM re-reads its controlDict as it runs (runTimeModifiable), the master process for a split run too
  ipcMain.handle("cfd:settle", async (_ev, stamp, n) => {
    try {
      const f = inRun(stamp, "system/controlDict"), t = fs.readFileSync(f, "utf8");
      const end = +(/endTime\s+(\d+)\s*;/.exec(t) || [])[1], it = Math.round(+n);
      if (!Number.isFinite(end) || !Number.isFinite(it)) return null;
      // the end on a WRITE: the solver writes every writeInterval only, so an end between writes leaves the average unwritten
      // (measured 2026-11-10: ended at 703, written every 500 — only 500 on disk)
      const every = Math.max(1, +(/writeInterval\s+(\d+)\s*;/.exec(t) || [])[1] || 1);
      const newEnd = Math.min(end, Math.ceil((it + 3000) / every) * every);
      const out = t.replace(/(avg\s*\{[^}]*?timeStart\s+)\d+/, `$1${it + 1}`).replace(/endTime\s+\d+\s*;/, `endTime ${newEnd};`);
      fs.writeFileSync(f, out);
      return { averageFrom: it + 1, end: newEnd };
    } catch { return null; }
  });
  ipcMain.handle("cfd:settle-note", async (_ev, stamp, json) => {
    try { fs.writeFileSync(inRun(stamp, "settled.json"), String(json)); return true; } catch { return false; }
  });
}

module.exports = { register, findOpenFoam, readMachine };
