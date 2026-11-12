// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
interface CorrectionsLedger {
  sourceName: string;
  sourceSha256: string;
  savedAt: string;
  /** storey-step rulings by step key; absent = keep */
  steps: Record<string, string>;
  /** hand extensions, in the order they were made */
  extends: Array<{ from: string; to: string }>;
  /** space extensions — a room's face taken to another room's face — in order */
  spaceExtends?: Array<{ from: string; to: string }>;
  /** elements the user deleted FROM THE FILE, in order — the file itself was
   *  rewritten; this records what happened and lets the ledger follow the
   *  file's new hash */
  deletes?: Array<{ expressId: number; globalId: string | null; ifcClass: string; name: string | null; at: string; backup: string }>;
  /** zone rulings: a space merged into another, a void assigned to a zone */
  zones?: { spaces: Record<string, string>; voids: Record<string, string> };
  /** glazing rulings by the window's or door's GlobalId: true = glass, false =
   *  opaque — the checkbox in the space table, for what the file leaves unsaid */
  glazing?: Record<string, boolean>;
  /** SHADING rulings (2026-09-05): site elements the user deleted from the
   *  model — vetoed from idf.db's site_elements and the view, the site file
   *  itself untouched; keyed to the site file's hash */
  shading?: { siteSha256: string; deleted: Array<{ expressId: number; name: string; file?: string }> };
  /** THE FILES BESIDE THE HOUSE (2026-09-07): the user's word per IFC file in
   *  the folder — true = projected into the model (its terrain, its shading
   *  elements), false = left out; absent = the default (`_Site.ifc` projected,
   *  every other file not) */
  siteFiles?: Record<string, boolean>;
  /** A PER-FILE TURN (user, 2026-09-15, C1: "rotate a very small angle (0.65 deg CW) — a per file rotation tool"): degrees
   *  clockwise seen from above, added to the file's own TrueNorth turn into the house frame; keyed by file name */
  siteFileTurn?: Record<string, number>;
  /** THE PLACEMENT of each linked file (2026-11-03, the alignment dialog): a move and a turn about a locked pivot on top of its
   *  TrueNorth turn, in the house frame (siteAlign.ts) — replaces siteFileTurn for that file once accepted */
  siteFileAlign?: Record<string, { dx: number; dy: number; dz: number; deg: number; px: number; pz: number; at?: string }>;
  /** THE VOID RULINGS (user, 2026-09-18: "When spaces are created, flag the
   *  suspected spaces of concern and provide a dialogue box that asks where the
   *  insulation resides (at roof or at ceiling level)"): per space the void QA
   *  flagged, the user's answer — the file does not say which plane carries the
   *  insulation, and only they know. `answer` is `VoidAnswer` in core/voidQa.ts
   *  (roof · ceiling · not-a-space · make-a-void · shade); `grille` is their
   *  word that the space opens into conditioned space. */
  voids?: Record<string, { answer: string; grille?: boolean; at: string }>;
  /** STAGED, NOT YET APPLIED (2026-09-09): the zone rulings waiting on the
   *  Apply button — written as they are staged so a restart keeps them */
  staged?: { at: string; zones: Record<string, string> };
  /** THE FILE CHANGED (2026-09-09): this ledger was carried from an earlier
   *  version of the file — what came over unchanged, what the user kept over
   *  the file's change, what the file's word overwrote, what was dropped */
  carried?: { fromSha: string; fromName: string; at: string; carried: number; kept: string[]; overwritten: string[]; dropped: string[] };
}

/** a save or a backup, as the main process reports it (2026-09-23): a failure is shown on every tab until dismissed */
interface SaveStatus { kind: "save" | "backup"; ok: boolean; what?: string; error?: string; committed?: boolean; pushed?: boolean; at: string }
interface Window {
  /** the Explain help in a window of its own (2026-10-15); absent → the dialog inside the page */
  explainWin?: { show(title: string, html: string): Promise<{ ok: boolean }>; hide(): Promise<{ ok: boolean }> };
  appStatus: { onSaveStatus(cb: (s: SaveStatus) => void): () => void };
  bim: {
    openIfc(): Promise<{ name: string; path: string; bytes: Uint8Array } | null>;
    saveDb(name: string, bytes: Uint8Array): Promise<string>;
    /** a file beside the opened one (`_Site.ifc`), or null when there is none */
    readSibling(path: string, name: string): Promise<{ name: string; path: string; bytes: Uint8Array } | null>;
    /** why the main process last reloaded the page after a crash (2026-10-09), read once */
    lastRecovery(): Promise<{ at: string; why: string } | null>;
    /** every other IFC in the opened file's folder, with its size */
    listSiblings(path: string): Promise<Array<{ name: string; path: string; bytes: number }>>;
    /** the user's corrections for ONE source file, keyed by its sha256 */
    loadCorrections(sha: string): Promise<CorrectionsLedger | null>;
    saveCorrections(sha: string, json: CorrectionsLedger): Promise<string>;
    /** overwrite the source IFC with a lossless rewrite; the previous bytes are backed up beside it */
    writeIfc(path: string, bytes: Uint8Array): Promise<{ path: string; backup: string }>;
  };
  /** the BEM module's bridge: the contract file, the weather, its ledger, the engine */
  bem: {
    readDataFile(rel: string): Promise<Uint8Array | null>;
    /** data/energy-codes/<name>.csv written (the previous kept as .bak); the paths written */
    saveEnergyCodes(files: Partial<Record<"editions.csv" | "values.csv" | "state-adoptions.csv" | "state-overrides.csv", string>>): Promise<string[]>;
    readText(path: string): Promise<string | null>;
    /** a text file under references/ — the user's reference lists (references/materials/*.csv, 2026-09-16); null outside it or absent */
    readReference(rel: string): Promise<string | null>;
    exists(path: string): Promise<boolean>;
    pickEpw(): Promise<string | null>;
    loadDecisions(sha: string): Promise<unknown | null>;
    saveDecisions(sha: string, json: unknown): Promise<string>;
    /** the same write, synchronous — the last word on pagehide (2026-09-10) */
    saveDecisionsSync(sha: string, json: unknown): string | null;
    /** the previous versions of this file's ledger, newest first (the store keeps the last 30) */
    listDecisionsHistory(sha: string): Promise<Array<{ stamp: string; at: string; path: string; bytes: number }>>;
    readDecisionsHistory(sha: string, path: string): Promise<unknown | null>;
    /** the engine in force (2026-09-23, engineLocate.cjs): the $ENERGYPLUS pin, else the newest install; the others named; where weather is looked for */
    engine(): Promise<{ exe: string; dir: string; version: string; majorMinor: string | null; pinned: boolean; dirNote: string | null; others: Array<{ exe: string; dir: string; version: string }>; weatherDirs: string[] } | null>;
    /** a weather file's path as it stands, else the first weather folder holding its NAME; null when none does */
    resolveEpw(p: string): Promise<string | null>;
    /** the files of one extension in a directory, full paths, sorted */
    listDir(dir: string, ext: string): Promise<string[]>;
    /** a web text read once into data/cache/<cacheName>; read from the cache while younger than maxAgeDays (omit = forever) */
    fetchCached(url: string, cacheName: string, maxAgeDays?: number | null): Promise<{ text: string; cached: boolean; savedAt: string; path: string } | { error: string }>;
    /** an address → candidate positions (OpenStreetMap Nominatim; the user picks one) */
    geocode(query: string): Promise<{ results: Array<{ name: string; latitude: number; longitude: number; kind: string }> } | { error: string }>;
    /** the user's browser on an http(s) URL — General search, "open in browser" (2026-09-08) */
    openExternal(url: string): Promise<{ ok: true } | { error: string }>;
    /** the in-app browser window on an http(s) page (2026-09-16): one window, reused */
    openBrowser(url: string): Promise<{ ok: true } | { error: string }>;
    /** a weather zip from the web, unpacked under data/weather/<stem>/; the epw's path */
    downloadWeather(url: string): Promise<{ epw: string; dir: string; cached: boolean } | { error: string }>;
    saveWeather(stem: string, epwText: string, ddyFrom: string | null): Promise<{ epw: string; ddy: boolean } | { error: string }>;
    run(opts: { stamp: string; idf: string; epw: string | null; expand: boolean; exe?: string }): Promise<{ exitCode: number | null; seconds: number; dir: string | null; error: string | null }>;
    readRunFile(stamp: string, name: string): Promise<Uint8Array | null>;
    /** the run's eplustbl.htm printed through the system dialog, or saved as a PDF where the user picks (2026-10-08) */
    reportOut(stamp: string, mode: "print" | "pdf", title?: string): Promise<{ saved?: string; printed?: boolean; canceled?: boolean; error?: string; why?: string }>;
    validate(idf: string): Promise<{ ok: boolean; err: string }>;
    onProgress(cb: (msg: { stamp: string; text: string }) => void): () => void;
  };
  /** BOM › CFD (2026-11-04): OpenFOAM found and run; a run's folder read back */
  cfd: {
    engine(again?: boolean): Promise<{ exe: string | null; version: string | null; why: string | null }>;
    /** the machine's cores (performance / efficiency where the OS states them) and memory */
    machine(): Promise<import("./modules/cfd/core/cfdParallel").Machine>;
    /** np: the processes the run takes (1 = serial); runs go side by side while their processes fit */
    run(opts: { stamp: string; files: Record<string, string>; steps: Array<{ label: string; cmd: string }>; np?: number }): Promise<{ ok: boolean; error: string | null; failedStep?: string; dir?: string; seconds: number; version?: string; np?: number }>;
    cancel(stamp: string): Promise<boolean>;
    read(stamp: string, rel: string): Promise<string | null>;
    list(stamp: string, rel: string): Promise<string[]>;
    exists(stamp: string, rel: string): Promise<boolean>;
    /** the room has settled at iteration n: the average starts at n + 1 and the run ends at n + 3,000 (2026-11-10) */
    settle(stamp: string, n: number): Promise<{ averageFrom: number; end: number } | null>;
    /** the settling verdict, kept beside the case as settled.json */
    settleNote(stamp: string, json: string): Promise<boolean>;
    onProgress(cb: (msg: { stamp: string; step?: number; steps?: number; label?: string; text: string }) => void): () => void;
  };
  /** the BOM module's bridge: the bills, the raw imports, its ledger */
  bom: {
    pickCsv(): Promise<{ name: string; path: string; text: string } | null>;
    saveImport(sha12: string, ext: string, text: string): Promise<string>;
    readImport(sha12: string, ext: string): Promise<string | null>;
    loadLedger(sha: string): Promise<unknown | null>;
    saveLedger(sha: string, json: unknown): Promise<string>;
  };
  /** the project store (2026-09-30): projects.sqlite in the OS app-data folder — projects by the IfcProject GlobalId,
   *  versions by the file's sha256 with the version each came from, the ledgers keyed as before */
  projects: {
    info(): Promise<{ file: string; projects: StoredProject[]; unassigned: StoredVersion[] }>;
    version(sha: string): Promise<StoredVersion | null>;
    versions(projectId: string): Promise<StoredVersion[]>;
    versionIndex(sha: string): Promise<unknown | null>;
    unassigned(): Promise<StoredVersion[]>;
    registerVersion(v: VersionRecord): Promise<StoredVersion>;
    exportProject(projectId: string, suggested?: string): Promise<{ file: string; project: string; versions: number } | null>;
    importProject(): Promise<{ file: string; projects: number; versions: number; ledgers: number; kept: number; history: number } | null>;
  };
  __BIM__?: { census(): unknown; open?(p: string): Promise<void> };
}
interface StoredProject { id: string; name: string | null; longName: string | null; createdAt: string }
interface StoredVersion {
  sha: string; projectId: string | null; parentSha: string | null;
  /** how it was made: opened · carried · inferred · bimedit · delete-from-ifc · migrated */
  madeBy: string; note: string | null; fileName: string | null; filePath: string | null; createdAt: string;
  hasIndex: boolean; ledgers: string[];
}
interface VersionRecord {
  sha: string; projectId?: string; projectName?: string | null; projectLongName?: string | null;
  parentSha?: string | null; madeBy?: string; note?: string | null; fileName?: string; filePath?: string;
  /** the version's FileIndex (core/ifcChanges.ts) — stored once so any two versions can be compared later */
  index?: unknown; reparent?: boolean;
}
