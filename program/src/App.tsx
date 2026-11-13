// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// Phase 1: open an IFC → pane 1 (Fragments) + pane 2 (IFC-DB shaded
// wireframe, drawn FROM the sql.js rows) + the area-identity gate badge.
// Pane 3 is the Phase-2 placeholder (single-plane IDF-DB).

import { NewProjectDialog } from "./view/NewProjectDialog.js";
import { LensPicker } from "./modules/bem/view/bemUi.js";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as WebIFC from "web-ifc";
import { WASM_DIR, wasmUrl } from "./core/wasmUrl.js";
import { readLayers, layerKey, layerCounts } from "./core/ifcLayers.js";
import { runExtraction, type ExtractRun } from "./core/ifcStream.js";
import type { Database } from "sql.js";
import * as THREE from "three";
import {
  getSql, buildIfcDb, buildIdfDb, queryFaces, queryIdfFaces, writeWallQA, queryWallQA, writeVoidQA, queryVoidQA, writeVoidRulings,
  querySpaces, writeStepDecisions, writeEdits, queryElement, queryElementIndex, writeZoneSolids, writeIdfElements, writeZones, queryZones, writeOpenings, queryOpenings, writeElementTypes, queryElementTypes, type SpaceFaceRow, type ZoneRowIn, type ElementIndexRow, type IdfElementIn, type ElementTypeRow,
  type WallQaRowOut, type DbFaceRow, writeTerrain, queryTerrain, writeWallGrade, queryWallGrade, type WallGradeOut, writeFills, queryFills, writeSiteElements, querySiteElements, querySiteFiles, writeSiteFiles, writeMepElements, queryMepElements, writeMepSystems, queryMepSystems, writeSystemsDiagram, type SiteFileRow, type SiteElementRow, type MepElementRow, type MepSystemRow } from "./core/db.js";
import { buildTerrain, flattenTris, heightAt, type Terrain } from "./core/terrain.js";
import { gradeSplit, fillCandidates } from "./core/gradeSplit.js";
import { buildTerrainView, buildFillView, buildSiteElementsView, buildMepView } from "./view/terrainView.js";
import { collapse, DEFAULT_CHOICES, CATEGORY_LABEL, type Category, type Choices, type Mode } from "./core/collapse.js";
import { atticSolids, applyZoneRulings, zoneResolver, type AtticReport, type ZoneRulings } from "./core/zones.js";
import { assessZones, zoneRows as zoneRowsFor, type ZoneReport } from "./core/zoneCheck.js";
import { deleteFromStep, formatDelete } from "./core/ifcStepDelete.js";
import { openEdges } from "./core/openEdges.js";
import { matchVertices, type StepChoice, type StepMismatch } from "./core/matchVertices.js";
import { wallQA } from "./core/wallQA.js";
import { assessVoids, answersFor, voidWord, VOID_ANSWERS, type VoidQaRow, type VoidRuling, type VoidAnswer } from "./core/voidQa.js";
import { buildDbView, buildRowHighlight, buildLoopHighlight, buildQuadHighlight, combineHighlights, type DbViewStyle } from "./view/dbView.js";
import { spaceSurfaces, spaceSummary } from "./modules/bim/spaceTable.js";
import { SpaceTableView } from "./view/SpaceTableView.js";
import { ZoneFrame, FRAME_TABS, type FrameTab } from "./modules/bem/view/ZoneFrame.js";
import { gainRulingCount, isBedroom, bedroomByName, bedroomMarksOf } from "./modules/bem/core/bemGains.js";
import { buildOpeningIndex, matchOpening, isScreenWall, glazingOf, type OpeningRef } from "./modules/bim/openings.js";
import { placeOpenings, type PlacedOpening } from "./core/placeOpenings.js";
import { Eye } from "./shell/Eye.js";
import { applyExtensions, surfaceKey, type ExtendOp } from "./core/extend.js";
import { applySpaceExtensions, faceKeyOf, findSpaceFace, faceWord, parseSpaceFaceKey, solidVolume, firstFaceReached, parseSurfaceTargetKey, type SpaceExtendOp } from "./core/spaceExtend.js";
import { splitBySpace } from "./core/spaceSplit.js";
import { buildSpaceView, spaceColor } from "./view/spaceView.js";
import { createDbPanes, type DbPanes, type PickHit } from "./view/dbPanes.js";
import { createIfcPane, type DragMode, type IfcPane, type ViewPreset } from "./view/ifcPane.js";
import { ViewTools } from "./view/ViewTools.js";
import { Rail, type DotState } from "./shell/Rail.js";
import { tabsOf, moduleOf, firstTab, isTab, TABS, type AppModule, type TabId } from "./shell/registry.js";
import { RunBlockedDialog, type RunBlock } from "./modules/bem/view/RunBlockedDialog.js";
import { checkChain, readMeta, moduleState, stampIdfContentSha, stampIfcContentSha, formatChain, type ChainLink } from "./core/stale.js";
import { indexIfcDb, diffIndex, carryRulings, type FileIndex, type FileDiff, type RulingCase, type Ledgers, type Carry, type CarryRecord } from "./core/ifcChanges.js";
import { rankParents, versionLabel, readLineageSidecar, type VersionCandidate, type RankedParent } from "./core/projectLookup.js";
import { ProjectPanel, type ProjectView } from "./view/ProjectPanel.js";
import { FileChanges } from "./view/FileChanges.js";
import { runBemPipeline, buildBemModel, readLatestRun, runCalibration, readLatestCalibration, type BemOutcome, type BemModelOutcome } from "./modules/bem/pipeline.js";
import { BomCalibration, type CalibrationRunView } from "./modules/bom/view/BomCalibration.js";
import { pvOffBefore, billedWithoutPv, producesElectricity, type HourSeries } from "./modules/bom/core/calibration.js";
import { sha256Hex } from "./core/sha256.js";
import { parsePvCsv, type PvRead } from "./modules/bom/core/pvRead.js";
import { makeActualWeather, latestEnd } from "./modules/bom/weatherMake.js";
import { carryModelInputs } from "./modules/bem/core/modelStore.js";
import { slabPlan, groundMethodOf } from "./modules/bem/core/groundCoupling.js";
import { DEFAULT_EPW, humidityMeasured } from "./modules/bem/core/weather.js";
import { BemSite, type SunClock, type SunCycle } from "./modules/bem/view/BemSite.js";
import { BemConstructions } from "./modules/bem/view/BemConstructions.js";
import { BemSchedules } from "./modules/bem/view/BemSchedules.js";
import { appliedHolidays, specialDayDate } from "./modules/bem/core/scheduleDays.js";
import { type DaySetDef, type UserCalendars, USER_CALENDAR_FILE, readUserCalendars, keepInCalendars, calendarsText } from "./modules/bem/core/scheduleParts.js";
import { BemZones } from "./modules/bem/view/BemZones.js";
import { BemSystems, DisciplineColumn, type SheetItem } from "./modules/bem/view/BemSystems.js";
import { BemRun } from "./modules/bem/view/BemRun.js";
import { SystemOptions } from "./modules/bem/view/SystemOptions.js";
import { zoneColor, SystemsAssembly } from "./modules/bem/view/SystemsAssembly.js";
import { qaRowsByNode } from "./modules/bem/view/SystemQaPanel.js";
import { AssemblyBench } from "./modules/bem/view/AssemblyBench.js";
import { ElectricalColumn } from "./modules/bem/view/ElectricalSheet.js";
import { readElecCatalogue, compileElectrical, sheetFromFile, ELEC_SHELVES, ELEC_CLASS, zonesOn, withZones, zoneOnto, withTodaysLabels } from "./modules/bem/core/elecSheet.js";
import { PlumbingColumn, type PlumbRoom } from "./modules/bem/view/PlumbingSheet.js";
import { readPlumbCatalogue, compilePlumbing, sheetFromFile as plumbFromFile, isFileWaterHeater, PLUMB_SHELVES, PLUMB_CLASS } from "./modules/bem/core/plumbSheet.js";
import { readPanels, isPvPanel } from "./modules/bem/core/pvArrays.js";
import { startPaletteDrag } from "./modules/bem/view/assemblyDrag.js";
import { compileAssembly, stageAssembly, sanitizeStage, diagramRows, diagramDiff, removeRoom, addRoom, addNode, addEdge, type Assembly, type ZoneAssign, refusedByNode } from "./modules/bem/core/assembly.js";
import { readJournal, writeJournal, newestStaged, stagedEmpty, stagedContent, type Staged } from "./modules/bem/core/stageJournal.js";
import { parseEpSchema, SCHEMA_FILE, IDD_FILE, type EpSchema } from "./modules/bem/core/epSchema.js";
import { parseIoReferenceIndex, ioRefVersionOf, ioRefIndexUrl, ioRefCacheName, type IoReference } from "./modules/bem/core/ioReference.js";
import { readCatalogue, type Catalogue } from "./modules/bem/core/epCatalogue.js";
import { FOCUS, SECTION_LABELS, MAIN_OF, type SystemSection } from "./modules/bem/core/mepFocus.js";
import { BemResultsPanel, BemRunPanel } from "./modules/bem/view/BemPanels.js";
import { paintRows, LENSES, categorical, type Lens, type Legend } from "./modules/bem/core/bemPaint.js";
import { sunPosition, sunDirection, northDirection, northAxisFromTrueNorth, fmtHour, dayOfYear, monthDayOf, type SunPosition } from "./core/sun.js";
import { treeTransmittance } from "./core/shadingSchedule.js";
import { parseEpwRadiation, irradiance, intensityColor, type EpwRadiation, type HourRad } from "./core/solar.js";
import { repaintFill } from "./view/dbView.js";
import { baseName, fmtTemp } from "./modules/bem/view/bemUi.js";
import { siteTypes } from "./modules/bem/view/SiteTable.js";
import { LocationFrame, LocationLocator, WeatherStationsMap, StationList, SiteFilesFrame, TurnMenu, stationsInView, zoneCode, type SiteFocus, type Located } from "./modules/bem/view/SiteViews.js";
import type { MapBounds } from "./view/TileMap.js";
import { parseStationListing, parseStationKml, USA_TMYX_KML, TMYX_CACHE, groupStations, nearestStations, wmoOfEpw, stationId, newestFile, WEATHER_LISTING_URL, STATIONS_CACHE, type Station, type NearStation, type StationFile } from "./core/weatherStations.js";
import { projectSiteFile, roomSolids, isProjected } from "./core/siteProject.js";
import { isShaft, projectElevation, spacesOnRoof } from "./core/levels.js";
import { parseCounties, climateZoneAt, climateZoneFromTable, parseCountyZones, COUNTIES_URL, COUNTIES_CACHE, type CountyFeature, type CountyZone, type CountyZoneRead } from "./core/climateZone.js";
import { STANDARD_SOURCES, DEFAULT_CODE_TABLES, readSources, type ProjectSources } from "./core/projectSources.js";
import { readInfilTable, type InfilTable } from "./modules/bem/core/infiltration.js";
import { readGroundTable, type GroundTable } from "./modules/bem/core/groundCoupling.js";
import { parseEnergyCodes, mergeEnergyCodes, setEnergyCodeData, ENERGY_CODE_FILES } from "./modules/bem/core/energyCodes.js";
import PNNL_EDITIONS_CSV from "./modules/bem/reference/pnnl-editions.csv?raw";
import PNNL_VALUES_CSV from "./modules/bem/reference/pnnl-values.csv?raw";
import { buildSunView } from "./view/sunView.js";
import { constructionTypes, typeKey, type TypeRow } from "./modules/bem/constructionTypes.js";
import { ConstructionOptions, type MaterialsApi } from "./modules/bem/view/ConstructionOptions.js";
import { ConstructionDetail, describeStage } from "./modules/bem/view/constructionDetail.js";
import { ConstructionReading } from "./modules/bem/view/ConstructionReading.js";
import { ieccFor, codeCatalogue, catalogueKindOf, type IdfModel } from "./modules/bem/core/bemIdf.js";
import { parseTariffs, withSample, cardInForce } from "./modules/bom/core/tariff.js";
import SAMPLE_TARIFF_JSON from "./modules/bom/reference/sample-tariff.json?raw";
import { BomCostView, BomCostTables, BomFrame, TariffDetails, WeatherMaker, priceBoth, type BomRail, type BomCardSel } from "./modules/bom/view/BomCost.js";
import type { ZoneSide } from "./modules/bem/core/modelChecks.js";
import { withLayers, nextAddedSeq, climateZoneOf, type BemLedger, type SiteRuling, type ConstructionRuling, type GroundRuling, type LayerPick, type LayerCustom, type SystemsRuling, type GenerationRuling, type GainRulings } from "./modules/bem/core/bemDb.js";
import { SCHEDULE_FILES, parseScheduleObjects, profileFor, readProfiles, fitsRole, scheduleFileName, ROLE_KIND, ROLE_LABELS, CODE_DEFAULT_SCHEDULE, DEFAULT_PROFILE_REF, type ScheduleRole, type ScheduleRef } from "./modules/bem/core/schedules.js";
import { ScheduleCalendar, type CalAt } from "./modules/bem/view/ScheduleCalendar.js";
import { ScheduleEditor, type EditorSave, type CalMode } from "./modules/bem/view/ScheduleEditor.js";
import { USER_SCHEDULE_FILE, readUserFile, writeUserFile, withUserSchedules, withProjectCopies, copyTextOf } from "./modules/bem/core/scheduleEdit.js";
import type { ScheduleProfile } from "./modules/bem/core/schedules.js";
import type { IdfObject } from "./modules/bem/core/idfLib.js";
import { RunGraphs, RunGraphFrame, RUN_GRAPH_DEFAULT, type RunGraphState } from "./modules/bem/view/RunGraphs.js";
import { RunEngineReport } from "./modules/bem/view/RunEngineReport.js";
import { RunReport } from "./modules/bem/view/RunReport.js";
import { BomReport } from "./modules/bom/view/BomReport.js";
import { runCalendar, dayLabel } from "./modules/bem/core/scheduleCalendar.js";
import { ruledStack } from "./modules/bem/core/bemModel.js";
import { LIB_FILES, CURVE_FILES, parseLibrary, parseCurveFile, formatLibraryCensus, parseIdfObjects, type Library } from "./modules/bem/core/idfLib.js";
import { type ReferenceManifest, buildMaterialsDb, openMaterialsDb, readMaterialsMeta, queryMaterials, queryFenestration, querySources, withMaterials, seedSha, formatMaterialsCensus, mergeUserRows, readSidecar, writeSidecar, handFenestration, candidateRows, layerPickFor, MATERIALS_DB, MATERIALS_SIDECAR, OSSTD_URL, OSSTD_CACHE, REFERENCE_FILES, type MaterialRow, type GlazingProduct, type MaterialSource } from "./modules/bem/core/materialsDb.js";
import { searchUrl, handMaterial, formFromRow, searchQueryFor, customLayerMaterial, BROWSE_URLS, type HandInput } from "./modules/bem/core/materialSearch.js";
import { MaterialDialog, newDialog, type DialogState } from "./modules/bem/view/MaterialDialog.js";
import { FenestrationDialog, newFenDialog, editFenDialog, type FenDialogState } from "./modules/bem/view/FenestrationDialog.js";
import { importBills, runBomPipeline, type BomImport, type BomOutcome } from "./modules/bom/pipeline.js";
import { BomColumn } from "./modules/bom/view/BomColumn.js";
import { DEFAULT_BILL_FORMAT, upgradeStatements, fillRates, newestStatements, statementsFromHandCsv, withFormat, pcaFromStatements, type BillFormat, type StatementsLedger } from "./modules/bom/core/statement.js";
import { statementBills } from "./modules/bom/pipeline.js";
import { BillFormatDialog } from "./modules/bom/view/BillFormatDialog.js";
import { BomBillsPanel, BomCalibrationPanel } from "./modules/bom/view/BomPanels.js";
import { describeEpw, readEpw } from "./modules/bem/core/epwRead.js";
import type { BillColumnMap } from "./modules/bom/core/csvRead.js";
import type { BomLedger } from "./modules/bom/core/bomDb.js";
import { ExplainLayer } from "./explain/ExplainLayer";
import { AlignDialog, type AlignPick } from "./view/AlignDialog";
import { openCfdDb, queryRuns as queryCfdRuns, queryMetrics as queryCfdMetrics, queryOpenings as queryCfdOpenings, querySlices as queryCfdSlices, queryWalls as queryCfdWalls, queryArrows as queryCfdArrows, type RunRow as CfdRunRow } from "./modules/cfd/core/cfdDb";
import { CfdFrame, CfdColumn, type CfdFrameTab, type CfdShown, type SliceField } from "./modules/cfd/view/CfdViews";
import { buildCfdView, arrowScale } from "./view/cfdView";
import { loadChoices as loadCfdChoices, saveChoices as saveCfdChoices, setChoicesStore } from "./modules/cfd/view/cfdChoicesStore";
import { CfdBatchDialog } from "./modules/cfd/view/CfdBatchDialog";
import { SupplyAirPanel } from "./modules/cfd/view/CfdSupply";
import { CfdSetupFrame, CfdSetupPlan, useCfdSetup, type CfdSetupIn, type SetupTab } from "./modules/cfd/view/CfdSetup";
import { cfdOffer, type CfdOffer as CfdOfferT } from "./modules/cfd/core/cfdPrep";
import { MESH_STEPS as CFD_MESH_STEPS, stepsOnMesh, type RoomFace as CfdRoomFace } from "./modules/cfd/core/cfdCase";
import type { CfdCase } from "./modules/cfd/core/cfdChoices";
import { decomposeParDict, jobSeconds, machineLine, stepsFor, usableCores, type Machine as CfdMachine } from "./modules/cfd/core/cfdParallel";
import { addTiming } from "./modules/cfd/view/CfdProcessors";
import { diagnose, fileNamed, type Diagnosis as CfdDiagnosis } from "./modules/cfd/core/cfdDiagnose";
import { MONITORS, readDat, settledYet, settleWords, STOP_DEFAULT, type MonitorKey, type Settle } from "./modules/cfd/core/cfdConverge";
import { importCase as importCfdCase } from "./modules/cfd/pipeline";
import type { Arrow as CfdArrow } from "./modules/cfd/core/streamArrows";
import { alignOf, alignMatrix, matchPoint, setPivot, isIdentity, NO_LOCKS, alignPoint, unalignPoint, roofGap, type AxisLocks, type FileAlign } from "./core/siteAlign";

// pane-2 default: the envelope + structure classes plane assignment will care
// about. A VIEW filter only — the DB stores every streamed element
// (capture everything, prune later).
const SHELL_CLASSES = new Set([
  "IFCWALL", "IFCWALLSTANDARDCASE", "IFCSLAB", "IFCROOF", "IFCCOVERING",
  "IFCWINDOW", "IFCDOOR", "IFCPLATE", "IFCCURTAINWALL", "IFCCOLUMN",
  "IFCBEAM", "IFCMEMBER", "IFCSTAIR", "IFCSTAIRFLIGHT", "IFCRAILING",
]);

interface GateState {
  ok: boolean;
  text: string;
}

const EMPTY_SITE: SiteRuling = {};

/** THE FILE CHANGED (2026-09-09): the previous file's index and ledgers, the
 *  diff, every ruling's case, the user's choices and what was applied */
interface CarryState { prev: { index: FileIndex; ledgers: Ledgers }; next: FileIndex; diff: FileDiff; cases: RulingCase[]; carry: Carry; take: Set<string>; applied: Set<string>; record: CarryRecord; prevAt: string }

/** the file this window has open, kept in sessionStorage so a reload reopens it (2026-10-09) */
const OPEN_FILE_KEY = "bim-open-file";

export function App(): React.ReactElement {
  const pane1Ref = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ifcPaneRef = useRef<IfcPane | null>(null);
  const dbPanesRef = useRef<DbPanes | null>(null);
  const runRef = useRef<ExtractRun | null>(null);
  /** what a left drag does — orbit or pan (user, 2026-09-08); view state, remembered */
  const [drag, setDrag] = useState<DragMode>(() => (window.localStorage.getItem("bim-drag") === "pan" ? "pan" : "orbit"));
  const dragRef = useRef(drag); dragRef.current = drag;
  useEffect(() => { window.localStorage.setItem("bim-drag", drag); ifcPaneRef.current?.setDrag(drag); }, [drag]);
  /** the standard views drive the one camera; the model's box is the file's */
  const viewTo = useCallback((v: ViewPreset) => { const run = runRef.current; if (run) ifcPaneRef.current?.view(v, run.bbox.min, run.bbox.max); }, []);
  const dbRef = useRef<import("sql.js").Database | null>(null);

  const [status, setStatus] = useState("open an IFC to begin");
  const [busy, setBusy] = useState(false);
  const [gate, setGate] = useState<GateState | null>(null);
  // THE MODULE RAIL: which module owns the editing column and the lens; the
  // views stay mounted across modules. The chain is the freshness check read
  // from the files' own metas (core/stale.ts) — a dot per module.
  // THE PAGE TABS (user, 2026-09-04): one strip over the editing column, one
  // tab active; the module is derived from the tab, the rail jumps to a
  // module's first tab and lights the module the active tab belongs to.
  const [tab, setTab] = useState<TabId>(() => { const v = window.localStorage.getItem("bim-tab"); return isTab(v) ? v : "bim-edit"; });
  useEffect(() => { window.localStorage.setItem("bim-tab", tab); }, [tab]);
  // A FAILED SAVE OR BACKUP IS SHOWN ON EVERY TAB (2026-09-23): the main process reports each; the banner stays until dismissed
  // or until the same kind succeeds again (a later backup that commits and pushes clears a backup failure)
  const [saveAlarm, setSaveAlarm] = useState<SaveStatus | null>(null);
  /** CRASH RECOVERY (2026-10-09): why the page was reloaded, and the heap when it nears the renderer's limit */
  const [recovered, setRecovered] = useState<{ at: string; why: string; reopened: string | null } | null>(null);
  const [memHigh, setMemHigh] = useState<{ used: number; limit: number } | null>(null);
  useEffect(() => window.appStatus?.onSaveStatus((s) => setSaveAlarm((cur) => (!s.ok ? s : cur && cur.kind === s.kind ? null : cur))), []);
  const module: AppModule = moduleOf(tab);
  const moduleRef = useRef<AppModule>("bim");
  moduleRef.current = module;
  const tabRef = useRef<TabId>("bim-edit");
  tabRef.current = tab;
  const [chain, setChain] = useState<ChainLink[]>([]);
  const chainRef = useRef<ChainLink[]>([]);
  // THE BEM MODULE's state: the last run as read back from bem.db, the lens
  // on pane 3, its ledger, the engine's progress. The pipeline it runs is the
  // gate's (modules/bem/pipeline.ts).
  const [bem, setBem] = useState<BemOutcome | null>(null);
  const bemRef = useRef<BemOutcome | null>(null);
  const [bemRunning, setBemRunning] = useState(false);
  const [bemLog, setBemLog] = useState<string[]>([]);
  const [bemEpw, setBemEpw] = useState<string | null>(null);
  const [runBlocked, setRunBlocked] = useState(false);
  const [bemEngine, setBemEngine] = useState<{ exe: string; version: string; others: Array<{ version: string }> } | null | undefined>(undefined);
  const bemLedgerRef = useRef<BemLedger | null>(null);
  /** the systems diagram as idf.db holds it after the last rebuild or Save (2026-09-10) */
  const savedDiagramRef = useRef<{ components: number; connectors: number; zones: number; at: string | null } | null>(null);
  const [bemLedger, setBemLedger] = useState<BemLedger | null>(null);
  // THE PROJECT'S DATA SOURCES (2026-11-12, core/projectSources.ts): the open project's own record (its project.sqlite), read once at the
  // page's start — opening another project, or saving its sources, reloads the page; with no project open, the standard template's
  const templateSources = useMemo(() => {
    const raw = window.projectNow?.sources;
    if (!raw) return STANDARD_SOURCES;
    const r = readSources(raw);
    if (r.problems.length) console.warn(`[sources] the project's record: ${r.problems.join("; ")}`);
    return r.sources;
  }, []);
  const sourcesNow = (): ProjectSources => templateSources;
  const sources = templateSources;
  const sourcesKey = JSON.stringify(sources);
  /** the staged record as last CONFIRMED on disk for this file (undefined = not known yet), the sha the stages in memory
   *  belong to, the load generation (bumped when a load ends, so an edit made during it is written), the journal's last
   *  content, and the draft's word for the column (2026-09-10: the sheet is never lost) */
  const savedStagedRef = useRef<Staged | null | undefined>(undefined);
  const stageShaRef = useRef<string>("");
  const [loadGen, setLoadGen] = useState(0);
  const lastJournalRef = useRef<string>("");
  const [draftNote, setDraftNote] = useState<{ at: string; error?: string } | null>(null);
  // THE MODEL WITHOUT A RUN: bem.db written from the ledger and idf.db's bytes,
  // read back — what every BEM tab draws; refreshed when a BEM tab is shown
  // and the idf.db content it was built from has moved
  const [bemModel, setBemModel] = useState<BemModelOutcome | null>(null);
  const bemModelRef = useRef<BemModelOutcome | null>(null);
  const [bemBusy, setBemBusy] = useState(false);
  /** the engine's datasets, read once when the engine is found (2026-09-08): what a library ruling resolves against */
  const libRef = useRef<Library | null>(null);
  /** materials.db as loaded or rebuilt (2026-09-08): its rows, its content sha (what bem.db records), its meta, and a version the screen re-reads on */
  const materialsRef = useRef<{ rows: MaterialRow[]; products: GlazingProduct[]; sources: MaterialSource[]; sha: string; meta: Map<string, string>; version: number; census: string } | null>(null);
  const [materialsCensus, setMaterialsCensus] = useState("");
  const [libCensus, setLibCensus] = useState("");
  const [epwList, setEpwList] = useState<string[]>([]);
  const [validation, setValidation] = useState<string | null>(null);
  const [lens, setLens] = useState<Lens>("none");
  const lensChoiceRef = useRef<Lens>("none");
  lensChoiceRef.current = lens;
  const lensRef = useRef<((row: DbFaceRow) => number | null) | null>(null);
  const [legend, setLegend] = useState<Legend | null>(null);
  const idfMetaRef = useRef<Map<string, string> | null>(null);
  const [selZone, setSelZone] = useState<string | null>(null);
  const selZoneRef = useRef(selZone); selZoneRef.current = selZone;
  // THE SUN in the SITE view (user, 2026-09-05): a wall-clock; view state, never a ruling
  const [sun, setSun] = useState<SunClock>({ month: 6, day: 21, hour: 12 });
  const sunRef = useRef<SunClock>({ month: 6, day: 21, hour: 12 });
  sunRef.current = sun;
  const [cycle, setCycle] = useState<SunCycle>({ run: false, day: true, year: false, speed: 1 });
  // deciduous tree modelling: on, a tree's opacity cycles with the month; off, every tree gives FULL SHADE (user, 2026-09-05)
  const [deciduous, setDeciduous] = useState(true);
  const deciduousRef = useRef(true);
  deciduousRef.current = deciduous;
  const transmittanceOf = (month: number, name: string): number => (deciduousRef.current ? treeTransmittance(month, name) : 0);
  // SOLAR INTENSITY (user, 2026-09-05): the exterior surfaces painted by the
  // irradiance on them at the clock's hour, from the weather file's own row
  const [intensity, setIntensity] = useState(false);
  const intensityRef = useRef(false);
  intensityRef.current = intensity;
  const epwRadRef = useRef<{ path: string; rad: EpwRadiation } | null>(null);
  const idfViewGroupRef = useRef<ReturnType<typeof buildDbView>["group"] | null>(null);
  const intensityRepaintRef = useRef<(() => void) | null>(null);
  const [intensityLegend, setIntensityLegend] = useState<{ maxWm2: number; rad: HourRad; hour: number; painted: number; epw: string } | null>(null);
  // the units at the eye (user, 2026-09-05): W/ft² under Show Imperial, W/m² under Show Metric
  const fmtIrr = (wm2: number): string => (imperial ? (wm2 * 0.09290304).toFixed(1) : wm2.toFixed(0));
  const [sunInfo, setSunInfo] = useState<SunPosition | null>(null);
  const [siteWord, setSiteWord] = useState("");
  // THE SITE TAB's VIEW (user, 2026-09-07): the model by default with the files beside the
  // house listed under it; Google Maps while locating; the stations while choosing a weather
  // file; the solar study — terrain, shading elements, the sun — behind its own checkbox
  const [siteFocus, setSiteFocus] = useState<SiteFocus>("model");
  const [solar, setSolar] = useState<boolean>(() => window.localStorage.getItem("bim-solar") === "1");
  useEffect(() => { window.localStorage.setItem("bim-solar", solar ? "1" : "0"); }, [solar]);
  const [satellite, setSatellite] = useState(true);
  const [siteFiles, setSiteFiles] = useState<SiteFileRow[]>([]);
  const siteFilesRulingRef = useRef<Record<string, boolean>>({});
  /** THE PER-FILE TURN (user, 2026-09-15, C1): degrees clockwise per projected file, a ruling in the corrections ledger */
  const siteFileTurnRef = useRef<Record<string, number>>({});
  /** THE PLACEMENT of each linked file (user, 2026-11-03): the alignment dialog's accepted move and turn about a pivot — siteAlign.ts */
  const siteFileAlignRef = useRef<Record<string, FileAlign>>({});
  type AlignEdit = { file: string; draft: FileAlign; pick: AlignPick; from: [number, number, number] | null; note: string | null; locks: AxisLocks };
  const [alignEdit, setAlignEditState] = useState<AlignEdit | null>(null);
  const alignEditRef = useRef<AlignEdit | null>(null);
  const setAlignEdit = (e: AlignEdit | null): void => { alignEditRef.current = e; setAlignEditState(e); };
  /** the overlay roots the preview lives in (one per pane), so a nudge moves the drawn file without rebuilding it */
  const alignPreviewRef = useRef<THREE.Object3D[]>([]);
  /** files the dialog has asked about in this window (a Close without Accept is not asked again until the house is reopened) */
  const alignAskedRef = useRef<Set<string>>(new Set());
  const appliedAlign = (file: string): FileAlign => alignOf(file, siteFileAlignRef.current, siteFileTurnRef.current);
  const placePreview = (): void => {
    const ed = alignEditRef.current;
    if (!ed) return;
    const m = new THREE.Matrix4().fromArray(alignMatrix(ed.draft)).multiply(new THREE.Matrix4().fromArray(alignMatrix(appliedAlign(ed.file))).invert());
    for (const r of alignPreviewRef.current) {
      const g = r.getObjectByName("align-preview");
      if (g) m.decompose(g.position, g.quaternion, g.scale);
      r.getObjectByName("align-pivot")?.position.set(ed.draft.px, 0, ed.draft.pz);
    }
  };
  const [siteAddress, setSiteAddress] = useState<string | null>(null);
  const [locPick, setLocPick] = useState<{ loc: Located | null; seq: number } | null>(null);
  const [stations, setStations] = useState<Station[] | null>(null);
  const [stationsWord, setStationsWord] = useState("the listing has not been read");
  const [stationsBusy, setStationsBusy] = useState(false);
  const [mapBounds, setMapBounds] = useState<MapBounds | null>(null);
  const [onlySameZone, setOnlySameZone] = useState(false);
  // HUMIDITY MEASURED per installed station (the legend, 2026-09-07): read from each installed file's own .ddy
  const [humidityByWmo, setHumidityByWmo] = useState<Map<string, boolean>>(new Map());
  const [countyZone, setCountyZone] = useState<CountyZoneRead | null>(null);
  const [focusStation, setFocusStation] = useState<NearStation | null>(null);
  const siteViewRef = useRef<string | null>(null);
  const siteFilesRef = useRef<Array<{ name: string; kind: string; projected: boolean; elements: number }>>([]);
  // THE CONSTRUCTIONS TABLE's selection — a unique type's key — and the colour each type paints
  const [typeSel, setTypeSel] = useState<string | null>(null);
  const typeSelRef = useRef(typeSel); typeSelRef.current = typeSel;
  /** the selected LAYER of the selected type (its seq) — a band in the DETAIL view or a row under it (2026-09-08) */
  const [layerSel, setLayerSel] = useState<number | null>(null);
  /** the right-click menu on a DETAIL band or row (2026-09-09): delete · add a layer · add a sub-item · restore */
  /** CLOSE IFC… (user, 2026-10-23): the drop-down under the button — All, the house, each file beside it */
  const [closeMenu, setCloseMenu] = useState<{ right: number; top: number } | null>(null);
  const [openMenu, setOpenMenu] = useState<{ left: number; top: number } | null>(null);
  const [layerMenu, setLayerMenu] = useState<{ x: number; y: number; seq: number; label: string; deleted: boolean; added: boolean; custom: boolean; parts: boolean } | null>(null);
  const layerSelRef = useRef(layerSel); layerSelRef.current = layerSel;
  const [materialsVersion, setMaterialsVersion] = useState(0);
  /** the Internet search for a layer's material (2026-09-08): under the view while open; a save writes the sidecar, a pick stages */
  /** THE MATERIAL DIALOG (2026-09-16): a new row for a layer typed in a modal; the palette leads its list with a placeholder meanwhile */
  const [dialog, setDialog] = useState<DialogState | null>(null);
  /** THE FENESTRATION DIALOG (2026-09-17): New on a window, a glazed door or a skylight — a whole-product assembly of yours */
  const [fenDialog, setFenDialog] = useState<FenDialogState | null>(null);
  const dialogRef = useRef(dialog); dialogRef.current = dialog;
  const datasetTextsRef = useRef<Array<{ file: string; text: string }>>([]);
  /** the CONSTRUCTIONS rulings as staged — shared by the column and the options table under the view (2026-09-08) */
  const [consStage, setConsStage] = useState<Record<string, ConstructionRuling>>({});
  // a code-default ruling that carries only a NAME is kept (user, 2026-09-08: "rename the component so the DETAIL header reads
  // correctly") — the name is the type's label on the screen and the Construction's name once the type is ruled; a bare code
  // default is no ruling and leaves the stage
  // A DOOR'S GLASS SHARE (2026-10-07) rides with its type whatever the Reference: a new Reference keeps it; only a ruling that
  // names `glassShare` (the share's own input) sets or clears it
  const stageCons = (key: string, r: ConstructionRuling | undefined): void => setConsStage((s) => {
    const n = { ...s };
    const share = r && Object.prototype.hasOwnProperty.call(r, "glassShare") ? r.glassShare : s[key]?.glassShare;
    const next: ConstructionRuling | undefined = r ? { ...r } : share !== undefined ? { source: "code" } : undefined;
    if (next) { if (share !== undefined) next.glassShare = share; else delete next.glassShare; }
    if (!next || (next.source === "code" && !next.name?.trim() && next.glassShare === undefined)) delete n[key]; else n[key] = next;
    return n;
  });
  const consStageRef = useRef(consStage); consStageRef.current = consStage;
  /** the SITE tab's stage, mirrored here so it is written with the ledger (2026-09-09) */
  const [siteStage, setSiteStage] = useState<SiteRuling | null>(null);
  /** the SCHEDULES tab's rulings as staged (2026-09-09): per role, one of the engine's own schedules */
  const [schedStage, setSchedStage] = useState<Partial<Record<ScheduleRole, ScheduleRef>>>({});
  const schedStageRef = useRef(schedStage); schedStageRef.current = schedStage;
  // THE PROJECT'S HOLIDAY LIST (2026-10-05): set in the editor's Holiday button, staged with the schedules, one Apply
  const [holStage, setHolStage] = useState<DaySetDef | null>(null);
  // your schedules re-saved this session under a name the project runs on: the copy the ledger takes on Apply, by name
  const [copyStage, setCopyStage] = useState<Record<string, string>>({});
  /** the SYSTEMS tab's rulings as staged (2026-09-10): per subsection, the engine's own objects the model runs on */
  const [sysStage, setSysStage] = useState<SystemsRuling>({});
  const sysStageRef = useRef(sysStage); sysStageRef.current = sysStage;
  const [carry, setCarry] = useState<CarryState | null>(null);
  const carryRef = useRef<CarryState | null>(null);
  /** the carry record the corrections ledger keeps, re-saved with every write */
  const carriedRef = useRef<CorrectionsLedger["carried"] | null>(null);
  /** a load in progress: the stage-persisting effects hold off until the refs are seeded */
  const loadingRef = useRef(false);
  /** what paints the CONSTRUCTIONS view: one colour per type, or the source that governs each type */
  const [consPaint, setConsPaint] = useState<"type" | "source">("type");
  const [consGround, setConsGround] = useState<GroundRuling | undefined>(undefined);
  const consPaintRef = useRef(consPaint); consPaintRef.current = consPaint;
  const typeRowsRef = useRef<TypeRow[]>([]);
  const typeColorRef = useRef<Map<number, number>>(new Map());
  // THE BOM MODULE's state: the bills the user imported (raw files under
  // data/bom/imports/, the column maps in its ledger), what they are compared
  // to, and the outcome read back from bom.db
  const [bomImports, setBomImports] = useState<BomImport[]>([]);
  const bomImportsRef = useRef<BomImport[]>([]);
  const [bomPending, setBomPending] = useState<BomImport | null>(null);
  const [bomExcluded, setBomExcluded] = useState<Set<string>>(new Set());
  const bomExcludedRef = useRef<Set<string>>(new Set());
  const [bomMeters, setBomMeters] = useState<string[]>([]);
  const [bom, setBom] = useState<BomOutcome | null>(null);
  const bomRef = useRef<BomOutcome | null>(null);
  const [bomBusy, setBomBusy] = useState(false);
  /** THE BILLS AS PRINTED (2026-10-09): the statements typed by hand and their format, kept in the BOM ledger and mirrored at once into
   *  browser storage (a reload never loses a half-typed bill); the format's dialog */
  const emptyStatements = (): StatementsLedger => ({ formats: [structuredClone(DEFAULT_BILL_FORMAT)], bills: [], at: "" });
  const [bomStatements, setBomStatements] = useState<StatementsLedger>(emptyStatements);
  const bomStatementsRef = useRef<StatementsLedger>(bomStatements);
  // THE CALIBRATION RUN (2026-10-09): BOM's run on the actual year, the panels' measured PV, the PV connection date
  const [calRun, setCalRun] = useState<CalibrationRunView | null>(null);
  const [calPv, setCalPv] = useState<{ name: string; read: PvRead } | null>(null);
  const [calPvOn, setCalPvOn] = useState<string>("");
  const [calBusy, setCalBusy] = useState("");
  const [billFormatOpen, setBillFormatOpen] = useState(false);
  const statementsTimer = useRef<number | null>(null);
  const [epwLine, setEpwLine] = useState("no weather file read");
  const bomLedgerRef = useRef<BomLedger | null>(null);
  // BOM › UTILITY (2026-10-03): the tariff cards the user made from their utility's published schedule (the project's tables/tariffs/tariff.json, from the
  // template references/tariffs/tariff.template.json), and the one the BOM ledger applied — written into every BEM build as the engine's
  // UtilityCost objects. No card ships with the program.
  const [tariffRead, setTariffRead] = useState<ReturnType<typeof parseTariffs> | null>(null);
  const tariffReadRef = useRef<ReturnType<typeof parseTariffs> | null>(null);
  // the SAMPLE card ships with the program (2026-10-16): offered beside the user's, and the one a run is priced by when none is applied
  // the cards are read from the files the project's data sources name (2026-11-12: tables/tariffs/tariff.json by the standard template)
  useEffect(() => {
    let gone = false;
    void (async () => {
      const src = sourcesNow().tariffs;
      const reads = (await Promise.all(src.files.map(async (f) => { const t = await window.bem.readHomeFile(f); return t ? parseTariffs(t) : null; }))).filter((x): x is ReturnType<typeof parseTariffs> => !!x);
      const user = reads.length ? reads.reduce((a, b) => ({ file: a.file || b.file ? { readAt: a.file?.readAt ?? b.file?.readAt ?? "", utility: a.file?.utility || b.file?.utility || "", cards: [...(a.file?.cards ?? []), ...(b.file?.cards ?? [])] } : null, usable: [...a.usable, ...b.usable], refused: [...a.refused, ...b.refused] })) : null;
      const r = src.sample ? withSample(user, parseTariffs(SAMPLE_TARIFF_JSON)) : (user ?? parseTariffs("{}"));
      if (gone) return;
      tariffReadRef.current = r; setTariffRead(r);
    })();
    return () => { gone = true; };
  }, [sourcesKey]);   // eslint-disable-line react-hooks/exhaustive-deps
  // THE ENERGY CODE'S VALUES, THE USER'S OWN (the project's tables/energy-codes/*.csv; the empty templates and how to fill them: references/energy-codes/):
  // read once at start, and awaited before any model is built — no code table ships with the program. A file absent reads empty
  const energyCodesReadRef = useRef<Promise<void> | null>(null);
  const energyCodesRead = (): Promise<void> => {
    if (!energyCodesReadRef.current) energyCodesReadRef.current = (async () => {
      // the folder the project's data sources name (2026-11-12; tables/energy-codes by the standard template), read from the project's folder
      const src = sourcesNow().energyCodes, dir = src.tables ?? DEFAULT_CODE_TABLES;
      const text = async (rel: string): Promise<string> => (await window.bem.readHomeFile(`${dir}/${rel.split("/").pop()}`)) ?? "";
      const [editions, values, adoptions, overrides] = await Promise.all([text(ENERGY_CODE_FILES.editions), text(ENERGY_CODE_FILES.values), text(ENERGY_CODE_FILES.adoptions), text(ENERGY_CODE_FILES.overrides)]);
      // the DOE/PNNL prototype values ship with the program (2026-10-15) and are read when the sources say so; the user's own tables
      // are read first and win
      const own = parseEnergyCodes({ editions, values, adoptions, overrides });
      const data = src.shipped ? mergeEnergyCodes(own, parseEnergyCodes({ editions: PNNL_EDITIONS_CSV, values: PNNL_VALUES_CSV, adoptions: "", overrides: "" })) : own;
      setEnergyCodeData(data);
      if (data.problems.length) console.warn(`[energy codes] ${data.problems.length} row(s) refused:\n${data.problems.join("\n")}`);
    })();
    return energyCodesReadRef.current;
  };
  // THE TABLES A PROJECT'S DATA SOURCES NAME (2026-11-12): a Cs/Cw table and an F/C table — read from the home folder, they FILL what the
  // user would type (the Zone card's Cs and Cw, the Floors' F and C); none ships with the program
  const [infilTable, setInfilTable] = useState<InfilTable | null>(null);
  const [groundTable, setGroundTable] = useState<GroundTable | null>(null);
  useEffect(() => {
    let gone = false;
    const i = sources.infiltration, g = sources.groundFactors;
    void (async () => {
      const it = i.mode === "table" ? readInfilTable(await window.bem.readHomeFile(i.file)) : null;
      const gt = g.mode === "table" ? readGroundTable(await window.bem.readHomeFile(g.file)) : null;
      if (gone) return;
      setInfilTable(it); setGroundTable(gt);
      if (i.mode === "table" && !it) setStatus(`data sources: the infiltration table ${i.file} could not be read`);
      if (g.mode === "table" && !gt) setStatus(`data sources: the F/C table ${g.file} could not be read`);
    })();
    return () => { gone = true; };
  }, [JSON.stringify(sources.infiltration), JSON.stringify(sources.groundFactors)]);   // eslint-disable-line react-hooks/exhaustive-deps
  // read at start, and again when the project's data sources change — the model rebuilt on the new tables
  const codesKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const k = JSON.stringify(sources.energyCodes);
    if (codesKeyRef.current === k) return;
    const first = codesKeyRef.current === null;
    codesKeyRef.current = k; energyCodesReadRef.current = null;
    void energyCodesRead().then(() => { if (!first && bemModelRef.current) void refreshBemModel(); });
  }, [sourcesKey]);   // eslint-disable-line react-hooks/exhaustive-deps
  const appliedTariff = (): IdfModel["tariff"] => {
    const t = bomLedgerRef.current?.tariff, card = cardInForce(tariffReadRef.current, t?.card);
    return card ? { card, ...(t?.pca ? { pca: t.pca } : {}) } : null;
  };
  /** the lens applies to pane 3 only outside BIM mode; in BEM the ZONES view
   *  paints every cell by the zone behind it (idf.db's own colour index) until a result lens is chosen */
  const zoneRowLens = (row: DbFaceRow): number | null => {
    const i = row.spaceColorIndex;
    if (i === null || i === undefined) return (((70 & 255) << 24) | ((74 & 255) << 16) | ((84 & 255) << 8) | 255) >>> 0;
    const c = spaceColor(i);
    return (((Math.round(c.r * 255) & 255) << 24) | ((Math.round(c.g * 255) & 255) << 16) | ((Math.round(c.b * 255) & 255) << 8) | 255) >>> 0;
  };
  const GREY_ROW = (((70 & 255) << 24) | ((74 & 255) << 16) | ((84 & 255) << 8) | 255) >>> 0;
  const AMBER_ROW = (((224 & 255) << 24) | ((168 & 255) << 16) | ((58 & 255) << 8) | 255) >>> 0;
  const rgbaOf = (hex: string): number => { const n = parseInt(hex.slice(1), 16); return ((((n >> 16) & 255) << 24) | (((n >> 8) & 255) << 16) | ((n & 255) << 8) | 255) >>> 0; };
  const lensFor = (): ((row: DbFaceRow) => number | null) | undefined => {
    if (moduleRef.current === "bim") return undefined;
    // (2026-09-10) SYSTEMS paints the zones a staged hvac ruling takes in the user's amber; the rest by zone
    if (tabRef.current === "bem-systems") {
      const taken = new Set((sysStageRef.current.hvac ?? []).flatMap((h) => h.zones));
      if (!taken.size) return zoneRowLens;
      return (row) => { const z = row.space ?? row.spaceFacing; return z && taken.has(z) ? AMBER_ROW : zoneRowLens(row); };
    }
    // (2026-09-05) SITE shows the stored colours under the sun; CONSTRUCTIONS paints by the file's type
    if (tabRef.current === "bem-site") return undefined;
    if (tabRef.current === "bem-constructions") return (row) => (row.id !== undefined ? typeColorRef.current.get(row.id) ?? GREY_ROW : GREY_ROW);
    // (2026-09-13) ZONES paints each room in its drawn Zone's colour — the sheet's and the tree's — rooms in no Zone grey, until a run lens
    if (tabRef.current === "bem-zones" && !lensRef.current) return (row) => { const r = row.space ?? row.spaceFacing; const h = r ? roomHeldRef.current.get(r) : undefined; return h ? rgbaOf(zoneColor(h.id)) : GREY_ROW; };
    return lensRef.current ?? (moduleRef.current === "bem" ? zoneRowLens : undefined);
  };
  const [showAll, setShowAll] = useState(false);
  const [fillOpacity, setFillOpacity] = useState(1);
  const [choices, setChoices] = useState<Choices>(DEFAULT_CHOICES);
  /** the last rebuild's census — numbers, formatted at render in the user's units */
  interface RebuildCensus {
    surfacesIn: number; surfacesOut: number; interZone: number; unassignedAreaM2: number; areaDeltaM2: number;
    byCategory: Array<[string, number]>; droppedEdgeAreaM2: number;
    match: { wall: number; roof: number; floor: number; inserted: number; maxMoveM: number; steps: number } | null;
    leakBeforeM: number; leakAfterM: number;
  }
  const [idfInfo, setIdfInfo] = useState<RebuildCensus | null>(null);
  // ARMED BY DEFAULT. It was off, with a label that no longer described it,
  // so pane 3 kept showing the raw collapse and the storey-step panel never
  // appeared — the user reasonably asked why nothing had changed (2026-09-01).
  // principles.md #11: a tool with no armed action must say so, loudly.
  const [shellOn, setShellOn] = useState(true);
  const [qaRows, setQaRows] = useState<WallQaRowOut[]>([]);
  // THE VOID QA (user, 2026-09-18): the spaces this app BUILT over a room's ceiling carry a question the
  // file does not answer — which plane holds the insulation. The rows are read back from idf.db (the wall
  // QA's rule), the `?` on a space name in LEVELS · SPACES reads them, and the ruling is the user's.
  const [voidRows, setVoidRows] = useState<VoidQaRow[]>([]);
  const voidRowsRef = useRef<VoidQaRow[]>([]);
  const voidRulingsRef = useRef<Record<string, VoidRuling>>({});
  const [voidRulings, setVoidRulings] = useState<Record<string, VoidRuling>>({});
  /** the `?` right-click: the correction dialog for one space */
  const [voidDialog, setVoidDialog] = useState<{ row: VoidQaRow; answer: VoidAnswer; grille: boolean } | null>(null);
  // THE DIAGNOSTICS DOCK. One panel at a time, docked BESIDE the views instead
  // of over them: a ruling whose effect you cannot see while you make it is not
  // a ruling, and the steps panel was covering the very pane it changes (user,
  // 2026-09-01). The panes just shrink — pane 1's renderer watches its
  // container and panes 2/3 re-read the canvas every frame, so no renderer
  // needs telling. The one idea worth taking from the predecessor's UI was the
  // resizable docked sidebar; none of its 49 panel components came with it.
  // THE EDITING COLUMN'S SECTIONS (user, 2026-09-04): every panel is a
  // collapsible dropdown in the one column, never a second sidebar; several
  // may be open at once, and which are is remembered.
  type SectionId = "project" | "changed" | "placement" | "steps" | "qa" | "edits" | "spaces" | "bem-results" | "bem-run" | "bom-bills" | "bom-calibration";
  const [open, setOpen] = useState<Set<string>>(() => {
    try { const v = JSON.parse(window.localStorage.getItem("bim-sections") ?? "") as unknown; return new Set(Array.isArray(v) ? (v as string[]) : ["placement"]); } catch { return new Set(["placement"]); }
  });
  useEffect(() => { window.localStorage.setItem("bim-sections", JSON.stringify([...open])); }, [open]);
  const toggleSection = (id: SectionId): void => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const openSection = (id: SectionId): void => setOpen((o) => (o.has(id) ? o : new Set([...o, id])));
  // ZONES BEYOND THE ROOMS. Attics are built over each room's ceiling and
  // carved like rooms; the user's rulings merge zones. Rulings live in the
  // ledger with the steps and extensions.
  const zonesRef = useRef<ZoneRulings>({ spaces: {}, voids: {} });
  const [zoneStage, setZoneStage] = useState<Record<string, string>>({});
  const zoneStageRef = useRef(zoneStage); zoneStageRef.current = zoneStage;
  const [zoneRows, setZoneRows] = useState<ZoneReport[]>([]);
  const [attics, setAttics] = useState<AtticReport | null>(null);
  // DELETIONS FROM THE FILE ITSELF: recorded so the ledger can follow the
  // file's new hash, and so the user can see what was removed and when
  const deletesRef = useRef<NonNullable<CorrectionsLedger["deletes"]>>([]);
  const pathRef = useRef<string>("");
  const bytesRef = useRef<Uint8Array | null>(null);
  const nameRef = useRef<string>("");
  const [ledgerNote, setLedgerNote] = useState("");
  /** what the project store decided on open (2026-09-30): the version, where its rulings came from — or that none were found */
  const [projectNote, setProjectNote] = useState<{ tone: "info" | "warn"; text: string } | null>(null);
  /** the open file's project and every version the store holds for it (the BIM column's "project" section) */
  const [projectView, setProjectView] = useState<ProjectView | null>(null);
  const [projectOpNote, setProjectOpNote] = useState("");
  const refreshProject = useCallback(async (proj: { globalId: string; name: string | null; longName: string | null } | null | undefined): Promise<void> => {
    if (!proj) { setProjectView(null); return; }
    const [info, versions] = await Promise.all([window.projects.info(), window.projects.versions(proj.globalId)]);
    setProjectView({ id: proj.globalId, name: proj.name, longName: proj.longName, file: info.file, versions });
  }, []);
  // the wall under discussion. A table row points at it in the views, and a
  // click in a view points back at the row — both through the ELEMENT id the
  // stored rows carry, so neither side re-derives anything.
  // A selection is a SURFACE: an element plus the plane normal of the face
  // that was clicked. Identified that way it survives a rebuild, and it is the
  // same identity the extend tool and the inspector both need.
  const [sel, setSel] = useState<{ elementId: number; n: [number, number, number] } | null>(null);
  const selEl = sel?.elementId ?? null;
  // THE SELECTION, three ways in (user, 2026-09-04): an element (pane 1 or a
  // table row — every cell it became), one CELL (pane 3 — that cell and its
  // element, never the element's other cells), or a room / level named in the
  // tree (every cell that bounds it). The IDF-DB reading is then BY ROOM.
  const [selRow, setSelRow] = useState<number | null>(null);
  const [selSpaceName, setSelSpaceName] = useState<string | null>(null);
  const [selLevel, setSelLevel] = useState<string | null>(null);
  /** a drawn Zone picked in ZONES (2026-09-13): every room it holds lights in the model and the tree */
  const [selRooms, setSelRooms] = useState<string[] | null>(null);
  const selRoomsRef = useRef(selRooms); selRoomsRef.current = selRooms;
  const selSpaceNameRef = useRef(selSpaceName); selSpaceNameRef.current = selSpaceName;
  /** a row of the space table narrows the outline to its cells and lights the
   *  element(s) they came from in the IFC view; an opening row outlines its
   *  hole and lights the window or door itself (user, 2026-09-04) */
  const [hi, setHi] = useState<{ rows: Set<number>; elements: Set<number>; loop: Array<[number, number, number]> | null; quads?: Array<Array<[number, number, number]>> } | null>(null);
  /** which related room the table shows when there are several */
  const [tableSpace, setTableSpace] = useState<string | null>(null);
  const zoneRowsRef = useRef<ZoneRowIn[]>([]);
  // WHAT THINGS ARE MADE OF, for the eye and the table (user, 2026-09-04):
  // the file's windows and doors with their extents, so a hole is matched to
  // the element that fills it; the porch screens the file names "Screen Wall"
  const elementIndexRef = useRef<Map<number, ElementIndexRow>>(new Map());
  /** the file's word per TYPE (2026-09-08): stated U and layers, read from ifc.db's element_types */
  const typesRef = useRef<Map<number, ElementTypeRow>>(new Map());
  const openingIndexRef = useRef<OpeningRef[]>([]);
  const screenIdsRef = useRef<Set<number>>(new Set());
  /** the user's glazing rulings by GlobalId — the checkbox in the space table,
   *  for what the file leaves unsaid; the ledger keeps them */
  const glazingRef = useRef<Map<string, boolean>>(new Map());
  const [glazing, setGlazing] = useState<Map<string, boolean>>(new Map());
  const glazingRuling = (globalId: string | null): boolean | undefined => (globalId ? glazingRef.current.get(globalId) : undefined);
  /** the verdict idf.db's elements carry: the file's word, the type name's default, or the ruling */
  const glazingResolver = (e: IdfElementIn): { glazed: boolean; source: string } | null => glazingOf(e.ifcClass, e.name, e, glazingRuling(e.globalId));
  const rebuildOpeningIndex = (): void => { openingIndexRef.current = buildOpeningIndex(dbRowsRef.current, elementIndexRef.current, glazingRuling); };
  // WHERE EACH WINDOW AND DOOR STANDS — placed on the cell it cuts by its own
  // geometry (idf.db.openings, read back), hole or notch alike; the panes pane 3
  // draws, the picks it answers, the outline a selection gets, the table's items
  const placedRef = useRef<PlacedOpening[]>([]);
  const panesByRowRef = useRef<Map<number, PlacedOpening[]>>(new Map());
  const placedByElRef = useRef<Map<number, PlacedOpening>>(new Map());
  const setPlaced = (list: PlacedOpening[]): void => {
    placedRef.current = list;
    const byRow = new Map<number, PlacedOpening[]>(), byEl = new Map<number, PlacedOpening>();
    for (const o of list) { byRow.set(o.surfaceId, [...(byRow.get(o.surfaceId) ?? []), o]); byEl.set(o.elementId, o); }
    panesByRowRef.current = byRow; placedByElRef.current = byEl;
  };
  /** the placed openings with the glazing verdicts the index holds now */
  const reglazePlaced = (): void => {
    const g = new Map(openingIndexRef.current.map((o) => [o.elementId, o]));
    setPlaced(placedRef.current.map((o) => { const x = g.get(o.elementId); return x ? { ...o, glazed: x.glazed, glazedSource: x.glazedSource } : o; }));
  };
  /** glass and wood in the IFC view through Fragments' own paint — the same
   *  verdicts the table's checkboxes show, so the eye and the row agree */
  const paintClasses = (): void => {
    const glass: number[] = [], extDoor: number[] = [], intDoor: number[] = [];
    for (const o of openingIndexRef.current) {
      if (o.glazed) glass.push(o.elementId);
      else (o.isExternal ? extDoor : intDoor).push(o.elementId);
    }
    ifcPaneRef.current?.setClassPaint([
      { ids: glass, color: 0x9fd3ff, opacity: 0.3 },
      { ids: extDoor, color: 0x4a2e1a, opacity: 1 },
      { ids: intDoor, color: 0xa8794f, opacity: 1 },
      { ids: [...screenIdsRef.current], color: 0xcfd8dc, opacity: 0.2 },
    ]);
  };
  const RGBA = (r: number, g: number, b: number): number => (((r & 255) << 24) | ((g & 255) << 16) | ((b & 255) << 8) | 255) >>> 0;
  const GLASS = RGBA(159, 211, 255), DOOR_EXT = RGBA(74, 46, 26), DOOR_INT = RGBA(168, 121, 79);
  /** glass and wood in the IDF-DB view: a screen wall is glass; a hole is
   *  glass or wood (dark outside, light inside) by the opening's glazing
   *  verdict — the file's word, the type name's default, or the user's checkbox */
  const styleFor = (): DbViewStyle => ({
    rowGlass: (row) => screenIdsRef.current.has(row.elementId),
    panes: (row) => (row.id === undefined ? [] : (panesByRowRef.current.get(row.id) ?? []).map((o) => ({
      quad: o.quad, glass: o.glazed, elementId: o.elementId,
      rgba: o.glazed ? GLASS : (o.isExternal ?? row.ifcClass === "exteriorWall") ? DOOR_EXT : DOOR_INT,
    }))),
  });
  // The drawings this file came from are in FEET (the file states FOOT as its
  // length unit); the module stores metres. Display is the user's choice.
  const [imperial, setImperial] = useState(() => window.localStorage.getItem("bim-units") === "ft");
  const imperialRef = useRef(imperial); imperialRef.current = imperial;
  useEffect(() => { window.localStorage.setItem("bim-units", imperial ? "ft" : "m"); }, [imperial]);
  // EXPLAIN (user, 2026-10-15): hover help on every section's header while on — the button beside the units toggle
  const [explain, setExplain] = useState(() => window.localStorage.getItem("bim-explain") === "1");
  useEffect(() => { window.localStorage.setItem("bim-explain", explain ? "1" : "0"); }, [explain]);
  const FT = 1 / 0.3048;
  const lu = imperial ? "ft" : "m";
  const fmtL = (m: number): string => (imperial ? (m * FT).toFixed(3) : m.toFixed(3));
  const fmtL2 = (m: number): string => (imperial ? (m * FT).toFixed(2) : m.toFixed(2));
  const fmtA = (m2: number): string =>
    imperial ? `${(m2 * FT * FT).toFixed(2)} ft²` : `${m2.toFixed(3)} m²`;

  const INSP_DEFAULT = 170;
  const [inspH, setInspH] = useState(() => {
    const n = Number(window.localStorage.getItem("bim-insp-h2"));
    return Number.isFinite(n) && n > 0 ? Math.min(window.innerHeight - 140, Math.max(60, n)) : INSP_DEFAULT;   // the divider moves up to a strip of panes (user, 2026-09-16: it was locked at 520)
  });
  const dbRowsRef = useRef<DbFaceRow[]>([]);
  const idfRowsRef = useRef<DbFaceRow[]>([]);
  // THE USER'S OWN CORRECTIONS. Right-click a surface in pane 3, choose
  // "Extend to Surface", click the surface it should reach. Kept as an ordered
  // list of operations and replayed after every rebuild, so a step ruling or a
  // dropdown does not throw away work done by hand.
  const editsRef = useRef<ExtendOp[]>([]);
  const [edits, setEdits] = useState<ExtendOp[]>([]);
  const [editLog, setEditLog] = useState<string[]>([]);
  // the right-click menu: on any pane it offers Hide for the element under the
  // cursor; on pane 3 it also offers the corrections (key = the idf surface)
  const [menu, setMenu] = useState<{ x: number; y: number; elementId: number; key: string | null; spaceKey?: string | null; label: string; siteIds?: number[]; /** the linked file an item belongs to (2026-09-16): project / leave out / turn */ siteFile?: string; siteFileProjected?: boolean } | null>(null);
  // HIDDEN ELEMENTS — a roof in the way of a wall corner. The set lives here;
  // panes 2/3 are rebuilt from the same stored rows with those rows skipped,
  // pane 1 uses Fragments' own visibility. Double right-click anywhere restores.
  const hiddenRef = useRef<Set<number>>(new Set());
  // THE SITE'S SHADING ELEMENTS (user, 2026-09-05): hidden ones are view state;
  // deleted ones are a RULING in the ledger — vetoed from idf.db's site_elements
  // and the view, the site file itself untouched, restorable from the SITE table
  const hiddenSiteRef = useRef<Set<number>>(new Set());
  /** THE FILES HIDDEN in the view (user, 2026-09-16): the display checkbox per linked file — view state, written nowhere */
  const hiddenFilesRef = useRef<Set<string>>(new Set());
  const [hiddenFiles, setHiddenFiles] = useState<Set<string>>(new Set());
  /** FILES · LAYERS (user, 2026-11-02): each loaded file's own IFC presentation layers — the house's element → layer, and each
   *  projected file's by the file's own express id — with an eye per file and per layer; view state, kept in local storage */
  const houseLayersRef = useRef<Map<number, string>>(new Map());
  const fileLayersRef = useRef<Map<string, Map<number, string>>>(new Map());
  /** the ground's triangles by the terrain element they came from, in the stored order — so a hidden layer drops its own */
  const terrainRangesRef = useRef<Array<{ key: string | null; start: number; n: number }>>([]);
  const [layerList, setLayerList] = useState<Array<{ file: string; house: boolean; layers: Array<{ name: string; count: number }> }>>([]);
  const hiddenLayersRef = useRef<Set<string>>((() => {
    try { const v = JSON.parse(window.localStorage.getItem("bim-hidden-layers") ?? "[]") as unknown; return new Set(Array.isArray(v) ? (v as string[]) : []); } catch { return new Set<string>(); }
  })());
  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(hiddenLayersRef.current);
  /** the layers the user turned ON (user, 2026-11-02): a services file's layer draws nothing by default — only its exterior
   *  shades (the PV panels) are drawn, as before — so its eye reads off until turned on, and then its elements are drawn */
  const shownLayersRef = useRef<Set<string>>((() => {
    try { const v = JSON.parse(window.localStorage.getItem("bim-shown-layers") ?? "[]") as unknown; return new Set(Array.isArray(v) ? (v as string[]) : []); } catch { return new Set<string>(); }
  })());
  const [shownLayers, setShownLayers] = useState<Set<string>>(shownLayersRef.current);
  /** a layer drawn by default: any layer of the house or the site, and a services layer holding an exterior shade */
  const layerDefaultOn = (file: string, layer: string): boolean => {
    if (!mepElementsRef.current.some((e) => e.file === file)) return true;
    const m = fileLayersRef.current.get(file);
    return siteElementsRef.current.some((e) => (e.file || "") === file && m?.get(e.fileExpressId ?? e.expressId) === layer);
  };
  const layerOn = (file: string, layer: string): boolean => {
    const k = layerKey(file, layer);
    return !hiddenLayersRef.current.has(k) && (shownLayersRef.current.has(k) || layerDefaultOn(file, layer));
  };
  /** the column's two bars, each rolled down or up (user, 2026-11-02); view state */
  const [treeBars, setTreeBars] = useState<{ levels: boolean; files: boolean }>(() => {
    try { return { levels: true, files: false, ...(JSON.parse(window.localStorage.getItem("bim-tree-bars") ?? "{}") as object) }; } catch { return { levels: true, files: false }; }
  });
  useEffect(() => { try { window.localStorage.setItem("bim-tree-bars", JSON.stringify(treeBars)); } catch { /* view state only */ } }, [treeBars]);
  const [openFiles, setOpenFiles] = useState<Set<string>>(new Set());
  const publishLayers = (): void => {
    const rows = [{ file: nameRef.current || "the house", house: true, layers: layerCounts(houseLayersRef.current) }];
    for (const [file, m] of fileLayersRef.current) rows.push({ file, house: false, layers: layerCounts(m) });
    setLayerList(rows);
  };
  const siteFileRowsRef = useRef<Array<{ name: string; kind: string }>>([]);
  const shadingRef = useRef<{ siteSha256: string; deleted: Array<{ expressId: number; name: string; file?: string }> }>({ siteSha256: "", deleted: [] });
  const [shadingDeleted, setShadingDeleted] = useState<Array<{ expressId: number; name: string; file?: string }>>([]);
  const siteElementsRef = useRef<SiteElementRow[]>([]);
  /** THE SERVICES INVENTORY as idf.db holds it (2026-09-10): the projected shade files' elements, interior included, for the SYSTEMS view and column */
  const mepElementsRef = useRef<MepElementRow[]>([]);
  /** THE ROOF GAP in the alignment dialog (user, 2026-11-03): the file's PV panels, stored under the accepted placement, taken back
   *  and placed by the draft, measured against the house's roofs in idf.db — live as the file is nudged or turned */
  const alignRoofGap = useMemo(() => {
    if (!alignEdit) return null;
    const applied = appliedAlign(alignEdit.file), draft = alignEdit.draft;
    const panels = mepElementsRef.current.filter((e) => e.file === alignEdit.file && isPvPanel(e.name)).map((e) => {
      const pts: Array<[number, number, number]> = [];
      for (let i = 0; i + 2 < e.xyz.length; i += 3) pts.push(alignPoint(unalignPoint([e.xyz[i]!, e.xyz[i + 1]!, e.xyz[i + 2]!], applied), draft));
      return pts;
    });
    return roofGap(panels, idfRowsRef.current.filter((r) => r.ifcClass === "roof").map((r) => ({ n: r.n, outer: r.outer })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alignEdit?.file, alignEdit?.draft]);
  const mepSystemsRef = useRef<MepSystemRow[]>([]);
  const [mepInfo, setMepInfo] = useState(0);
  /** THE SYSTEMS FOCUS (user, 2026-09-10): the subsection whose elements the view lights and whose options sit under the view; view state */
  const [sysFocus, setSysFocus] = useState<SystemSection>(() => { const v = window.localStorage.getItem("bim-sys-focus"); return v && v in SECTION_LABELS ? (v as SystemSection) : "heating"; });
  const sysFocusRef = useRef(sysFocus); sysFocusRef.current = sysFocus;
  useEffect(() => { window.localStorage.setItem("bim-sys-focus", sysFocus); }, [sysFocus]);
  /** the MECHANICAL focus shows the ASSEMBLY sheet or the model, one at a time (user, 2026-09-10) */
  const [sysView, setSysView] = useState<"assembly" | "model">(() => (window.localStorage.getItem("bim-sys-view") === "model" ? "model" : "assembly"));
  useEffect(() => { window.localStorage.setItem("bim-sys-view", sysView); requestAnimationFrame(() => window.dispatchEvent(new Event("resize"))); }, [sysView]);
  /** THE SCHEDULES CALENDAR (user, 2026-09-13): the tab's view is the run's calendar, zoomed by clicks; a card in the column paints it */
  const [schedView, setSchedView] = useState<"calendar" | "model">(() => (window.localStorage.getItem("bim-sched-view") === "model" ? "model" : "calendar"));
  // RUN: the graphs or the model (user, 2026-10-02: "the view should show graphed model results"), one at a time; the frame below picks the graph
  const [bomView, setBomView] = useState<"cost" | "model">(() => { try { return window.localStorage.getItem("bim-bom-view") === "model" ? "model" : "cost"; } catch { return "cost"; } });
  useEffect(() => { try { window.localStorage.setItem("bim-bom-view", bomView); } catch { /* view state only */ } requestAnimationFrame(() => window.dispatchEvent(new Event("resize"))); }, [bomView]);
  const [bomRail, setBomRail] = useState<BomRail>("UTILITY");
  // BOM › CFD (user, 2026-11-04): cfd.db's runs, the space and peak shown, the run picked among a space's runs, the frame's tab
  const [cfdRuns, setCfdRuns] = useState<CfdRunRow[]>([]);
  const [cfdSpace, setCfdSpace] = useState<string | null>(null);
  const [cfdPeak, setCfdPeak] = useState<"heating" | "cooling">("heating");
  /** the arrows MOVE at the air's own speed, or hold still (2026-11-10) — a view preference, remembered per window */
  const [cfdMachine, setCfdMachine] = useState<CfdMachine | null>(null);
  const [cfdMoving, setCfdMoving] = useState<boolean>(() => { try { return window.localStorage.getItem("bim-cfd-moving") === "1"; } catch { return false; } });
  const [cfdPick, setCfdPick] = useState<number | null>(null);
  const [cfdShown, setCfdShown] = useState<(CfdShown & { arrows: CfdArrow[] }) | null>(null);
  const [cfdFrameTab, setCfdFrameTab] = useState<CfdFrameTab>("SECTION");
  const [cfdField, setCfdField] = useState<SliceField>("T");
  // SPACE OR SPACES (2026-11-11, the user): the PROCESSORS frame's two exclusive buttons, then Select — pick a space (or several)
  // in the left column and press Select again; the processors are then reviewed in the frame below the view. View state.
  const [cfdPickMode, setCfdPickMode] = useState<"space" | "spaces" | null>(null);
  const [cfdSelecting, setCfdSelecting] = useState(false);
  const [cfdPicks, setCfdPicks] = useState<string[]>([]);
  /** the space last clicked: a setup still being read for another space when it arrives steps aside */
  const cfdWantRef = useRef<string | null>(null);
  const cfdDbRef = useRef<Database | null>(null);
  // the Run CFD… dialog: what it reads (the room's solid, the run's IDF, idf.db and bem.db) opened when it opens
  type CfdInputs = { idf: string; idfDb: Database; bemDb: Database; stamp: string; engine: { exe: string | null; version: string | null; why: string | null }; machine: CfdMachine | null };
  /** A ROOM SET UP FOR CFD (2026-11-10): its plan in the view, its settings in the frame — in place of the Run CFD… dialog */
  const [cfdSetupIn, setCfdSetupIn] = useState<(CfdSetupIn & { stamp: string }) | null>(null);
  const [cfdView, setCfdView] = useState<"results" | "setup">("results");
  const [cfdSetupTab, setCfdSetupTab] = useState<SetupTab>("TERMINALS");
  const cfdSet = useCfdSetup(cfdSetupIn);
  // Run CFD · several rooms: the same inputs, every room of the model
  const [cfdBatch, setCfdBatch] = useState<(CfdInputs & { rooms: Array<{ space: string; faces: CfdRoomFace[] }> }) | null>(null);
  // the runs going (several at once, 2026-11-04): each its own progress; a failed one stays until dismissed
  const [cfdJobs, setCfdJobs] = useState<Array<{ stamp: string; space: string; peak: string; np: number; step: number; steps: number; label: string; iteration: number; iterations: number; last: string; error?: string; diag?: CfdDiagnosis | null }>>([]);
  // the results go into cfd.db one at a time — two runs finishing together must not both read, add and save it
  const cfdSaveChain = useRef<Promise<void>>(Promise.resolve());
  const [bomSel, setBomSel] = useState<BomCardSel | null>(null);
  const [bomTariff, setBomTariff] = useState<BomLedger["tariff"] | undefined>(undefined);
  const [runView, setRunView] = useState<"graphs" | "model" | "report">(() => { try { const v = window.localStorage.getItem("bim-run-view"); return v === "model" || v === "report" ? v : "graphs"; } catch { return "graphs"; } });
  useEffect(() => { try { window.localStorage.setItem("bim-run-view", runView); } catch { /* view state only */ } requestAnimationFrame(() => window.dispatchEvent(new Event("resize"))); }, [runView]);
  // "-2" (2026-10-02): the Annual series grew by total use and the utility lines, so an earlier pick does not hide them
  // RUN opens on GRAPHS · ANNUAL (user, 2026-10-12: "Place Graphs - Annual as first offering in Run View") — the lines, scale and parts as left
  const [runGraph, setRunGraph] = useState<RunGraphState>(() => { try { return { ...RUN_GRAPH_DEFAULT, ...(JSON.parse(window.localStorage.getItem("bim-run-graph-2") ?? "{}") as Partial<RunGraphState>), section: "annual" }; } catch { return RUN_GRAPH_DEFAULT; } });
  useEffect(() => { try { window.localStorage.setItem("bim-run-graph-2", JSON.stringify(runGraph)); } catch { /* view state only */ } }, [runGraph]);
  useEffect(() => { window.localStorage.setItem("bim-sched-view", schedView); requestAnimationFrame(() => window.dispatchEvent(new Event("resize"))); }, [schedView]);
  const schedViewRef = useRef(schedView); schedViewRef.current = schedView;
  const [calAt, setCalAt] = useState<CalAt>({ level: "year", n: 1 });
  const calAtRef = useRef(calAt); calAtRef.current = calAt;
  const [schedCard, setSchedCard] = useState<ScheduleRole | null>(null);
  // THE DAY PROFILE EDITOR (2026-10-05): the draft the calendar paints while hours are edited, and YOUR schedules — the
  // user's own library file (data/schedules-user.idf, every project), read with the engine's files and written on a save
  const [schedDraft, setSchedDraft] = useState<ScheduleProfile | null>(null);
  const userSchedRef = useRef<{ objects: IdfObject[]; notes: Map<string, string> }>({ objects: [], notes: new Map() });
  const [userSchedV, setUserSchedV] = useState(0);
  // YOUR holiday lists and seasons (data/calendars-user.json, every project), and what the calendar shows while the
  // editor's Holiday or Seasonal button is picked
  const [userCal, setUserCal] = useState<UserCalendars>({ holidays: [], seasons: [] });
  const [calMode, setCalMode] = useState<CalMode | null>(null);
  const schedCardRef = useRef(schedCard); schedCardRef.current = schedCard;
  /** the selected node or connector on the assembly sheet — view state */
  const [asmSel, setAsmSel] = useState<string | null>(null);
  const [elecSel, setElecSel] = useState<string | null>(null);
  const [plumbSel, setPlumbSel] = useState<string | null>(null);
  /** what the load moved or dropped on the sheet (2026-09-13: a line on a connector this build no longer draws), shown once on the sheet */
  const [asmMigration, setAsmMigration] = useState<string[]>([]);
  const asmSelRef = useRef(asmSel); asmSelRef.current = asmSel;
  const [selMep, setSelMep] = useState<Set<number>>(new Set());
  const selMepRef = useRef(selMep); selMepRef.current = selMep;
  /** the engine's schema, read once beside the binary (2026-09-10): what the SYSTEMS options render their fields from */
  const schemaRef = useRef<EpSchema | null>(null);
  const [schemaCensus, setSchemaCensus] = useState<string | null>(null);
  // THE COMPONENT CATALOGUE (2026-09-11): built once the schema is read — the bench's cards and their connectors come from it
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  /** THE INPUT OUTPUT REFERENCE's index (2026-09-13 night): fetched once for the engine's own docs version, read into a map for the Reference button on every component */
  const [ioRef, setIoRef] = useState<IoReference | null>(null);
  const ioRefRef = useRef<IoReference | null>(null);
  useEffect(() => {
    if (!schemaCensus) return;
    const v = ioRefVersionOf(schemaRef.current?.engineVersion);
    void window.bem.fetchCached(ioRefIndexUrl(v), ioRefCacheName(v), 30).then((r) => { if ("text" in r) { const ref = parseIoReferenceIndex(r.text, v); ioRefRef.current = ref; setIoRef(ref); } }, () => undefined);
  }, [schemaCensus]);
  const [siteElsInfo, setSiteElsInfo] = useState(0);
  const [selSite, setSelSite] = useState<Set<number>>(new Set());
  const selSiteRef = useRef<Set<number>>(new Set());
  const siteShaRef = useRef("");
  const [hiddenCount, setHiddenCount] = useState(0);
  /** the instrument's way in (2026-09-05): load a file by path through the same routine the Open button uses */
  const loadPickedRef = useRef<((p: { name: string; path: string; bytes: Uint8Array }) => Promise<void>) | null>(null);
  const viewOpacityRef = useRef(1);
  // THE LEVEL TREE. Storeys by elevation, their spaces and attics beneath;
  // an eye on each. A hidden level hides its elements, its spaces and their
  // attics in all three views — how a level is isolated to find its gaps.
  const hiddenLevelsRef = useRef<Set<string>>(new Set());
  const hiddenSpacesRef = useRef<Set<string>>(new Set());
  const [hiddenLevels, setHiddenLevels] = useState<Set<string>>(new Set());
  const [hiddenSpaces, setHiddenSpaces] = useState<Set<string>>(new Set());
  const atticsRef = useRef<AtticReport | null>(null);
  const spaceName = (sp: { longName: string | null; name: string | null; expressId: number }): string =>
    sp.longName ?? sp.name ?? `#${sp.expressId}`;
  /** hidden spaces, with every space and attic on a hidden level */
  const effHiddenSpaces = (): Set<string> => {
    const out = new Set(hiddenSpacesRef.current);
    const run = runRef.current;
    if (!run) return out;
    const storeyOf = new Map(run.spaces.map((sp) => [spaceName(sp), sp.storey]));
    for (const sp of run.spaces) if (sp.storey && hiddenLevelsRef.current.has(sp.storey)) out.add(spaceName(sp));
    for (const a of atticsRef.current?.attics ?? []) {
      const st = storeyOf.get(a.room);
      if (st && hiddenLevelsRef.current.has(st)) out.add(a.name);
    }
    return out;
  };
  /** the spaces and attics a level aggregates, by the file's storey */
  const spacesOfLevel = (level: string): string[] => {
    const run = runRef.current;
    if (!run) return [];
    const storeyOf = new Map(run.spaces.map((sp) => [spaceName(sp), sp.storey]));
    const out = run.spaces.filter((sp) => sp.storey === level).map(spaceName);
    for (const a of atticsRef.current?.attics ?? []) if (storeyOf.get(a.room) === level) out.push(a.name);
    return out;
  };
  const levelOfSpace = (name: string): string | null => {
    const run = runRef.current;
    if (!run) return null;
    const storeyOf = new Map(run.spaces.map((sp) => [spaceName(sp), sp.storey]));
    const direct = storeyOf.get(name);
    if (direct) return direct;
    const a = (atticsRef.current?.attics ?? []).find((x) => x.name === name);
    return a ? storeyOf.get(a.room) ?? null : null;
  };
  /** hidden elements, with every element on a hidden level */
  const effHiddenElements = (): Set<number> => {
    const out = new Set(hiddenRef.current);
    const run = runRef.current;
    if (run && hiddenLevelsRef.current.size) for (const e of run.elements) if (e.storey && hiddenLevelsRef.current.has(e.storey)) out.add(e.expressId);
    // FILES · LAYERS: the house's eye off hides every element; a layer's eye off hides the elements the file puts on it
    const house = nameRef.current, hl = hiddenLayersRef.current;
    if (hiddenFilesRef.current.has(house)) {
      for (const id of houseLayersRef.current.keys()) out.add(id);
      for (const e of run?.elements ?? []) out.add(e.expressId);
    } else if (hl.size) for (const [id, l] of houseLayersRef.current) if (hl.has(layerKey(house, l))) out.add(id);
    return out;
  };
  /** an idf row whose zones are all hidden leaves pane 3 */
  const idfRowHider = (hs: Set<string>) => (row: DbFaceRow): boolean => {
    const zones = [row.space, row.spaceFacing].filter((z): z is string => !!z);
    return zones.length > 0 && zones.every((z) => hs.has(z));
  };
  const [armed, setArmed] = useState<{ key: string; label: string } | null>(null);
  const armedRef = useRef<{ key: string; label: string } | null>(null);
  // THE USER'S SPACE EXTENSIONS. With the rooms shown, right-click a room's
  // face, "Select Extend Space to Space", click the face of the room it must
  // meet. Replayed BEFORE the carve on every rebuild: the rooms as ruled are
  // what every surface is carved by, what settles a wall's side, what the
  // attics stand on. Same ledger contract as the surface tool.
  const spaceEditsRef = useRef<SpaceExtendOp[]>([]);
  const [spaceEdits, setSpaceEdits] = useState<SpaceExtendOp[]>([]);
  const [spaceEditLog, setSpaceEditLog] = useState<string[]>([]);
  /** the rooms after the ledger's space ops — the ones the last rebuild used */
  const ruledSpacesRef = useRef<ExtractRun["spaces"]>([]);
  /** idf.db's copy of the rooms as ruled, read back after the rebuild */
  const zoneSpaceRowsRef = useRef<SpaceFaceRow[]>([]);
  /** the rows each overlay was built from: panes 1/2 the file's rooms, pane 3 the ruled */
  const spaceRowsRef = useRef<{ file: SpaceFaceRow[]; zone: SpaceFaceRow[] }>({ file: [], zone: [] });
  const [selSpace, setSelSpace] = useState<{ key: string; label: string } | null>(null);
  const [armedSpace, setArmedSpace] = useState<{ key: string; label: string } | null>(null);
  const armedSpaceRef = useRef<{ key: string; label: string } | null>(null);
  /** which kind of hand edit was made last, so Undo Last undoes THAT one */
  const undoHistoryRef = useRef<Array<"surface" | "space">>([]);
  const spaceLabelOfRef = useRef<(key: string) => string>((k) => k);
  spaceLabelOfRef.current = (key: string): string => {
    // an ELEMENT's face as a target (2026-09-19): named by the element, as every other element is
    const sk = parseSurfaceTargetKey(key);
    if (sk) {
      const el = runRef.current?.elements.find((e) => e.expressId === sk.elementId);
      return `#${sk.elementId}${el ? ` ${el.ifcClass}` : ""}${el?.spaces.length ? ` [${el.spaces.join(" + ")}]` : ""} · ${faceWord(sk.n)} face`;
    }
    const k = parseSpaceFaceKey(key);
    if (!k) return key;
    const sp = runRef.current?.spaces.find((s) => s.expressId === k.spaceId);
    return `${sp ? spaceName(sp) : `#${k.spaceId}`} · ${faceWord(k.n)} face`;
  };
  /** the stored row a space-face key names among the given overlay rows:
   *  same room, same normal, the plane nearest the key's offset */
  const spaceFaceRow = (rows: SpaceFaceRow[], key: string): SpaceFaceRow | null => {
    const k = parseSpaceFaceKey(key);
    if (!k) return null;
    const nk = (n: [number, number, number]): string => n.map((v) => Math.round(v / 1e-3)).join(",");
    let best: SpaceFaceRow | null = null, bestD = Infinity;
    for (const r of rows) {
      if (r.spaceId !== k.spaceId || nk(r.n) !== nk(k.n) || r.outer.length === 0) continue;
      const d = Math.abs(r.n[0] * r.outer[0]![0] + r.n[1] * r.outer[0]![1] + r.n[2] * r.outer[0]![2] - k.d);
      if (d < bestD) { bestD = d; best = r; }
    }
    return bestD <= 1 ? best : null;
  };
  const [showSpaces, setShowSpaces] = useState(false);
  const [showTerrain, setShowTerrain] = useState(false);
  const showTerrainRef = useRef(false);
  const [terrainInfo, setTerrainInfo] = useState<{ tris: number; rotationDeg: number } | { split: number; belowM2: number; fillM2: number; fills: number } | null>(null);   // the terrain read, then the grade cut's census — formatted at the eye
  const [wallGrade, setWallGrade] = useState<Map<number, WallGradeOut>>(new Map());
  /** ifc.db gained rows after it was saved (the grade census): save it again with the next idf.db */
  const ifcDirtyRef = useRef(false);
  /** the site model's ground in the house frame; null when no `_Site.ifc` sits beside the file */
  const terrainRef = useRef<Terrain | null>(null);
  // A step listed as "#11681 under #1764804" is unfindable; the same step read
  // as "Basement… under Bed 1" is the one the user came looking for. The names
  // are the file's own (IfcRelSpaceBoundary), like every other census here.
  // A table row names an element, not a plane. Point at its biggest idf
  // surface — the one the eye lands on — so the inspector has something to show.
  const selectElement = useCallback((elementId: number) => {
    setSelSpace(null); setSelRow(null); setSelSpaceName(null); setSelLevel(null); setHi(null); setTableSpace(null); setSelRooms(null);
    let best: DbFaceRow | null = null;
    for (const r of idfRowsRef.current) {
      if (r.elementId !== elementId) continue;
      if (!best || r.areaM2 > best.areaM2) best = r;
    }
    setSel({ elementId, n: best?.n ?? [0, 1, 0] });
  }, []);
  // a room or a level named in the tree: every cell that bounds it lights up,
  // in both views, and the table reads that room
  const selectSpaceName = useCallback((name: string) => {
    setSelSpace(null); setSel(null); setSelRow(null); setSelLevel(null); setHi(null); setTableSpace(name); setSelSpaceName(name); setSelRooms(null);
  }, []);
  const selectLevel = useCallback((name: string) => {
    setSelSpace(null); setSel(null); setSelRow(null); setSelSpaceName(null); setHi(null); setTableSpace(null); setSelLevel(name); setSelRooms(null);
  }, []);

  useEffect(() => { window.localStorage.setItem("bim-insp-h2", String(inspH)); }, [inspH]);
  // the ZONES frame's four rails want the height (2026-09-13): a nudge once, view state
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === "bem-zones" && inspH > 0 && inspH < 300) setInspH(300); }, [tab]);
  /** LEVELS · SPACES is as wide as the user drags it (user, 2026-10-23: "adjustable width so names can be exposed"); view state */
  const TREE_DEFAULT = 220;
  const [treeW, setTreeW] = useState(() => {
    const n = Number(window.localStorage.getItem("bim-tree-w"));
    return Number.isFinite(n) && n > 0 ? Math.min(600, Math.max(140, n)) : TREE_DEFAULT;
  });
  useEffect(() => { window.localStorage.setItem("bim-tree-w", String(treeW)); }, [treeW]);
  const dragTree = useCallback((ev: React.PointerEvent) => {
    ev.preventDefault();
    const x0 = ev.clientX, w0 = treeW;
    const move = (e: PointerEvent): void => setTreeW(Math.min(600, Math.max(140, w0 + (e.clientX - x0))));
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    document.body.style.cursor = "col-resize";
  }, [treeW]);
  const dragInsp = useCallback((ev: React.PointerEvent) => {
    ev.preventDefault();
    const y0 = ev.clientY, h0 = inspH;
    const move = (e: PointerEvent): void =>
      setInspH(Math.min(window.innerHeight - 140, Math.max(0, h0 + (y0 - e.clientY))));
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    document.body.style.cursor = "row-resize";
  }, [inspH]);

  // a surface key -> the words on screen. Held in a ref because the rebuild
  // closure has no deps and must not go stale.
  const labelOfRef = useRef<(key: string) => string>((k) => k);
  labelOfRef.current = (key: string): string => {
    const id = Number(key.split("|")[0]);
    const el = runRef.current?.elements.find((e) => e.expressId === id);
    const dir = key.split("|").slice(1).join(",");
    return `#${id}${el?.spaces.length ? ` ${el.spaces.join(" + ")}` : ""} (${dir})`;
  };

  const spaceOf = (id: number): string =>
    runRef.current?.elements.find((e) => e.expressId === id)?.spaces.join(" + ") ?? "";
  const [spaceInfo, setSpaceInfo] = useState("");
  const [steps, setSteps] = useState<StepMismatch[]>([]);
  const [stepChoices, setStepChoices] = useState<Map<string, StepChoice>>(new Map());
  const choicesRef = useRef<Map<string, StepChoice>>(new Map());
  const shaRef = useRef<string>("");

  useEffect(() => {
    let disposed = false;
    let panes: DbPanes | null = null;
    let pane1: IfcPane | null = null;
    void (async () => {
      const ifcPane = await createIfcPane(pane1Ref.current!);
      if (disposed) { ifcPane.dispose(); return; }
      pane1 = ifcPane;
      ifcPaneRef.current = ifcPane;
      ifcPane.setDrag(dragRef.current);
      panes = createDbPanes(canvasRef.current!);
      dbPanesRef.current = panes;
      panes.sync(ifcPane.camera);
      panes.setLayout(true);          // the IDF-DB view alone beside the IFC
      // click a surface in pane 2 or 3 → select that element, and if a storey
      // step involves it, open the steps table on that row
      panes.onPick((hit: PickHit) => onPickRef.current(hit));
      // one gesture drives all three views; a click in the IFC view selects
      panes.setCameraDom(ifcPane.controlsDom());
      ifcPane.onPick((expressId, button, x, y) => pane1PickRef.current(expressId, button, x, y));
      ifcPane.onSpacePick((row, button, x, y) => onSpacePickRef.current(row, 1, button, x, y));
      void window.bem.engine().then((e) => {
        setBemEngine(e);
        // every weather folder, Weather/ first (2026-09-23); a file of one name listed once, from the first folder holding it
        if (e) void Promise.all(e.weatherDirs.map((d) => window.bem.listDir(d, ".epw"))).then((lists) => {
          const seen = new Set<string>();
          setEpwList(lists.flat().filter((p) => { const n = baseName(p); if (seen.has(n)) return false; seen.add(n); return true; }));
        }, () => setEpwList([]));
        // the datasets beside the engine, read as they are — never stored, only what is picked from them
        // — and the schedule files (2026-09-09): the DataSets' profiles and the single-family example's, their schedule objects only
        if (e) void Promise.all([...LIB_FILES.map((f) => window.bem.readText(`${e.dir}/DataSets/${f}`)), ...SCHEDULE_FILES.map((f) => window.bem.readText(`${e.dir}/${f.path}`)), ...CURVE_FILES.map((f) => window.bem.readText(`${e.dir}/${f.path}`))]).then(async (texts) => {
          const files = texts.slice(0, LIB_FILES.length).map((t, i) => ({ file: LIB_FILES[i]!, text: t ?? "" })).filter((f) => f.text);
          const sched = SCHEDULE_FILES.flatMap((f, i) => { const t = texts[LIB_FILES.length + i]; return t ? parseScheduleObjects(t, f.path) : []; });
          // the equipment datasets (2026-09-12): the water-to-air coils' curves, as extra objects — the materials seed reads `files` alone
          const curves = CURVE_FILES.flatMap((f, i) => { const t = texts[LIB_FILES.length + SCHEDULE_FILES.length + i]; return t ? parseCurveFile(t, f) : []; });
          // YOUR schedules (2026-10-05) join the library before anything reads it, so a ruling naming one resolves on load
          const mine = readUserFile(await window.bem.readDataFile(USER_SCHEDULE_FILE).then((b) => (b ? new TextDecoder().decode(b) : null), () => null));
          userSchedRef.current = mine;
          setUserCal(readUserCalendars(await window.bem.readDataFile(USER_CALENDAR_FILE).then((b) => (b ? new TextDecoder().decode(b) : null), () => null)));
          libRef.current = files.length ? withUserSchedules(parseLibrary(files, [...sched, ...curves]), mine.objects) : null;
          setUserSchedV((v) => v + 1);
          setLibCensus(libRef.current ? formatLibraryCensus(libRef.current) : "");
          if (libRef.current) await loadMaterialsRef.current(files);
        }, () => { libRef.current = null; });
        // the schema (10 MB), on its own promise so the datasets never wait for it; the ~30 classes SYSTEMS offers are kept
        // the IDD's header rides with the schema: the IP conversions every field input converts through (2026-09-13 night)
        if (e) void Promise.all([window.bem.readText(`${e.dir}/${SCHEMA_FILE}`), window.bem.readText(`${e.dir}/${IDD_FILE}`).catch(() => null)]).then(([t, idd]) => { schemaRef.current = t ? parseEpSchema(t, undefined, idd) : null; setSchemaCensus(schemaRef.current?.census ?? null); setCatalogue(schemaRef.current ? readCatalogue(schemaRef.current) : null); }, () => { schemaRef.current = null; });
      }, () => setBemEngine(null));
      window.__BIM__ = {
        census: () => ({
          onRoof: [...onRoofRef.current],
          ifc: ifcPane.census(),
          camera: ifcPane.cameraState(),
          db: panes?.census(),
          gate,
          module: moduleRef.current,
          tab: tabRef.current,
          siteView: siteViewRef.current,
          siteFiles: siteFilesRef.current,
          bemModel: bemModelRef.current ? { modelSha: bemModelRef.current.modelSha, sourceIdfSha: bemModelRef.current.sourceIdfSha, census: bemModelRef.current.census } : null,
          chain: formatChain(chainRef.current),
          carry: carryRef.current ? { prevSha: carryRef.current.diff.prevSha.slice(0, 12), overlap: carryRef.current.diff.overlap, changes: carryRef.current.diff.changes.map((c) => `${c.kind} ${c.what} ${c.label}${c.diffs.length ? ` — ${c.diffs.join("; ")}` : ""}`), cases: carryRef.current.cases.map((c) => `${c.verdict} ${c.ledger}/${c.kind}: ${c.label}`), take: [...carryRef.current.take], record: carryRef.current.record } : null,
          staged: { constructions: Object.keys(bemLedgerRef.current?.staged?.constructions ?? {}).length, ground: !!bemLedgerRef.current?.staged?.ground, site: !!bemLedgerRef.current?.staged?.site, schedules: Object.keys(bemLedgerRef.current?.staged?.schedules ?? {}).length, systems: !!bemLedgerRef.current?.staged?.systems, gains: gainRulingCount(bemLedgerRef.current?.staged?.gains), zones: Object.keys(zoneStageRef.current).length, at: bemLedgerRef.current?.staged?.at ?? null, journal: (() => { const j = shaRef.current ? readJournal(window.localStorage, shaRef.current) : null; return j ? { at: j.at, sheet: (j.systems?.assembly?.nodes ?? []).map((n) => n.id) } : null; })(), disk: savedStagedRef.current ? { at: savedStagedRef.current.at, sheet: (savedStagedRef.current.systems?.assembly?.nodes ?? []).map((n) => n.id) } : savedStagedRef.current, draft: draftNote },
          zonesTab: { selZone: selZoneRef.current, selRooms: selRoomsRef.current, selSpace: selSpaceNameRef.current, frame: zoneFrameTabRef.current, staged: gainRulingCount(gainStageRef.current), rooms: bemModelRef.current?.rooms.length ?? 0 },
          schedules: { calendar: { view: schedViewRef.current, level: calAtRef.current.level, n: calAtRef.current.n, card: schedCardRef.current, cells: document.querySelectorAll(".calCell").length }, staged: schedStageRef.current, applied: bemLedgerRef.current?.schedules ?? {}, rows: bemModelRef.current?.schedules.map((r) => ({ role: r.role, name: r.name, source: r.source, inUse: r.inUse })) ?? null },
          systems: { focus: sysFocusRef.current, selected: [...selMepRef.current], stage: sysStageRef.current, applied: bemLedgerRef.current?.systems ?? null, assembly: { nodes: (sysStageRef.current.assembly?.nodes ?? []).map((n) => ({ id: n.id, kind: n.kind, x: n.x, y: n.y, attached: n.attached, label: n.label, ident: n.ident, rooms: n.rooms })), zones: (() => { const c = compileAssembly(sysStageRef.current.assembly ?? { nodes: [], edges: [] }, bemModelRef.current?.input.zones.map((z) => z.name) ?? [], sysStageRef.current.assign ?? {}); return c.zones; })(), saved: savedDiagramRef.current, edges: sysStageRef.current.assembly?.edges ?? [], assign: sysStageRef.current.assign ?? {}, sel: asmSelRef.current, view: sysView, compiled: (() => { const c = compileAssembly(sysStageRef.current.assembly ?? { nodes: [], edges: [] }, bemModelRef.current?.input.zones.map((z) => z.name) ?? [], sysStageRef.current.assign ?? {}); return { hvac: c.hvac.map((h) => ({ id: h.id, kind: h.kind, zones: h.zones, fields: h.fields, doas: h.doas?.id, hotWater: h.plant?.hotWater?.id, controlZone: h.wired?.controlZone, loop: h.wired?.loop })), refusals: c.refusals, cautions: c.cautions, splitIds: c.splitIds, loops: c.loops.map((l) => ({ id: l.id, consumers: l.consumers })) }; })() }, rows: bemModelRef.current?.systems.map((r) => ({ id: r.id, section: r.section, kind: r.kind, source: r.source, zones: r.zones.length, objects: r.objects, refused: r.refused.length })) ?? null, unresolved: bemModelRef.current?.built.unresolvedSystems ?? null, mep: { elements: mepElementsRef.current.length, interior: mepElementsRef.current.filter((e) => e.interior).length, inFocus: mepElementsRef.current.filter(FOCUS[sysFocusRef.current]).length, byDiscipline: Object.fromEntries(["mechanical", "electrical", "plumbing", "other"].map((d) => [d, mepElementsRef.current.filter((e) => e.discipline === d).length])), systems: mepSystemsRef.current.length }, schema: schemaRef.current?.census ?? null, ioReference: ioRefRef.current ? { version: ioRefRef.current.version, links: ioRefRef.current.entries.length, classLinks: ioRefRef.current.classLinks } : null },
          materials: materialsRef.current ? { rows: materialsRef.current.rows.length, sha: materialsRef.current.sha.slice(0, 12), version: materialsRef.current.version, census: materialsRef.current.census } : null,
          cons: { view: consViewRef.current, typeSel: typeSelRef.current, layerSel: layerSelRef.current, staged: Object.keys(consStageRef.current).length, dialog: dialogRef.current ? { seq: dialogRef.current.seq, editFrom: dialogRef.current.editFrom, name: dialogRef.current.form.name ?? "" } : null, openSections: [...document.querySelectorAll(".qaBtn.sec.on")].map((b) => (b.textContent ?? "").replace(/^[▾▸]\s*/, "").split("·")[0]!.trim()) },
        }),
        open: async (p: string) => {
          const sib = await window.bim.readSibling(p, p.split(/[\\/]/).pop() ?? p);
          if (!sib) throw new Error(`cannot read ${p}`);
          await loadPickedRef.current?.({ name: sib.name, path: sib.path, bytes: new Uint8Array(sib.bytes) });
        },
      };
      // AFTER A RELOAD (a crash the main process recovered from, a merge, a hot reload): the house this window had open is opened again
      let reopen: string | null = null;
      try { reopen = window.sessionStorage.getItem(OPEN_FILE_KEY); } catch { reopen = null; }
      // a project opened (or a new window on one) opens the IFC it last had open (2026-11-12)
      if (!reopen && window.projectNow?.openIfc) reopen = window.projectNow.openIfc;
      const rec = await window.bim.lastRecovery().catch(() => null);
      if (disposed) return;
      if (rec) setRecovered({ ...rec, reopened: reopen });
      if (reopen) {
        setStatus(`reopening ${reopen.split(/[\\/]/).pop()} …`);
        void window.__BIM__!.open!(reopen).catch((e: unknown) => setStatus(`could not reopen ${reopen}: ${e instanceof Error ? e.message : String(e)} — Open IFC… to load it`));
      }
    })();
    return () => { disposed = true; panes?.dispose(); pane1?.dispose(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Engaging the rooms does two things at once, in all three panes: draw the
  // volumes, and fade the surfaces so the volumes are visible through them.
  const SPACE_OPACITY = 0.2;    // the rooms themselves — 80% translucent
  const FADED_SURFACE = 0.3;    // walls/roofs/floors while the rooms are shown

  const applySpaces = useCallback((on: boolean) => {
    const db = dbRef.current;
    const panes = dbPanesRef.current;
    if (!db || !panes) return;
    if (!on) {
      panes.setSpaceGroups(null, null);
      ifcPaneRef.current?.setSpaces(null);
      ifcPaneRef.current?.setSurfaceOpacity(null);
      setSpaceInfo("");
      return;
    }
    const hs = effHiddenSpaces();
    // panes 1 and 2 draw the rooms the FILE states (ifc.db); pane 3 draws the
    // rooms as the user RULED them (idf.db's copy, the space extensions
    // applied) — one builder, one palette, two sets of stored rows
    const fileRows = querySpaces(db).filter((r) => !hs.has(r.label));
    const zoneAll = zoneSpaceRowsRef.current;
    const zoneRows = (zoneAll.length ? zoneAll : querySpaces(db)).filter((r) => !hs.has(r.label));
    spaceRowsRef.current = { file: fileRows, zone: zoneRows };
    // one Object3D cannot sit in three scenes, and each mesh carries its own
    // pick map, so each pane gets its own build (358 faces — cheap)
    const v1 = buildSpaceView(fileRows, SPACE_OPACITY);
    const v3 = buildSpaceView(zoneRows, SPACE_OPACITY);
    panes.setSpaceGroups(null, v3.group);
    ifcPaneRef.current?.setSpaces(v1.group);
    ifcPaneRef.current?.setSurfaceOpacity(FADED_SURFACE);
    setSpaceInfo(`${v1.spaces} spaces · ${v1.triangles.toLocaleString()} tris`);
  }, []);

  const TERRAIN_OPACITY = 0.35;
  const applyTerrain = useCallback((on: boolean) => {
    const db = dbRef.current;
    const panes = dbPanesRef.current;
    if (!db || !panes) return;
    // THE SYSTEMS VIEW (2026-09-10): the services inventory drawn in the model, the focused subsection lit — read from the
    // LIVE refs (the loader trap); a panel in both tables is drawn once, as its services row, while the systems are shown.
    // On the BIM tabs too (user, 2026-11-02: the ducts behind Bed 1's hidden wall): the whole inventory, ducts and pipes
    // inside the rooms, drawn whether or not the terrain is — its file's eye and its layers' eyes say what shows
    const bimTab = tabRef.current.startsWith("bim");
    const systemsOn = (tabRef.current === "bem-systems" || bimTab) && mepElementsRef.current.length > 0;
    // THE FILE BEING PLACED (the alignment dialog, 2026-11-03): drawn whole — whatever the checkbox, its eye or its layers'
    // default — in a group of its own that the dialog's nudges move without rebuilding anything
    const edFile = bimTab ? alignEditRef.current?.file ?? null : null;
    if ((!on && !edFile && !(bimTab && systemsOn && shownLayersRef.current.size)) || tabRef.current === "bem-zones") {   // ZONES shows the model alone (user, 2026-09-13): no site, no shading — the checkbox untouched
      panes.setTerrainGroups(null, null);
      ifcPaneRef.current?.setTerrain(null);
      alignPreviewRef.current = [];
      return;
    }
    const siteFileName = siteFileRowsRef.current.find((f) => f.kind === "site")?.name ?? "_Site.ifc";
    const stored = on || edFile === siteFileName ? queryTerrain(db) : null;            // the ground comes from ifc.db
    const mepKeys = systemsOn && !bimTab ? new Set(mepElementsRef.current.map((e) => `${e.file}|${e.fileExpressId}`)) : null;
    const els0 = mepKeys ? siteElementsRef.current.filter((e) => !mepKeys.has(`${e.file}|${e.fileExpressId}`)) : siteElementsRef.current;
    // THE DISPLAY CHECKBOX per linked file (user, 2026-09-16): a hidden file's elements and terrain leave the view — view state
    const hf = hiddenFilesRef.current;
    // FILES · LAYERS: an element on a hidden layer leaves the view; the ground goes when every layer it was read from is hidden
    const hl = hiddenLayersRef.current;
    const layerOff = (file: string, id: number): boolean => {
      if (!hl.size) return false;
      const l = fileLayersRef.current.get(file)?.get(id);
      return !!l && hl.has(layerKey(file, l));
    };
    // the ground drawn: every terrain element whose layer is shown (the ranges index the stored triangles; one that does not
    // match the stored count — an ifc.db written by another read — draws whole rather than guess)
    let groundTris = stored?.tris ?? null;
    const rs = terrainRangesRef.current;
    if (groundTris && hl.size && rs.some((r) => r.key && hl.has(r.key)) && rs.reduce((a, r) => a + r.n, 0) * 9 === groundTris.length) {
      const keep = rs.filter((r) => !(r.key && hl.has(r.key)));
      const out = new Float32Array(keep.reduce((a, r) => a + r.n, 0) * 9);
      let o = 0;
      for (const r of keep) { out.set(groundTris.subarray(r.start * 9, (r.start + r.n) * 9), o); o += r.n * 9; }
      groundTris = out;
    }
    const terrainHidden = (hf.has(siteFileName) && edFile !== siteFileName) || !groundTris?.length;
    const els = els0.filter((e) => {
      const f = e.file || siteFileName;
      return (on || f === edFile) && (f === edFile || !hf.has(f)) && !layerOff(f, e.fileExpressId ?? e.expressId);
    });
    // (2026-09-07) a shade file projected without a site file still draws: the overlay is
    // whatever the projected files hold — the terrain, the shading elements, the fill
    if (!stored && !els.length && !systemsOn) { panes.setTerrainGroups(null, null); ifcPaneRef.current?.setTerrain(null); alignPreviewRef.current = []; return; }
    // ONE overlay, always named "terrain" (each pane drops the old one by that name — an unnamed group would stay behind)
    const root = new THREE.Group();
    root.name = "terrain";
    const moving = new THREE.Group();
    moving.name = "align-preview";
    if (groundTris && !terrainHidden) {
      const g = buildTerrainView(groundTris, TERRAIN_OPACITY).group;
      g.name = "ground";
      (edFile === siteFileName ? moving : root).add(g);
    }
    // the site's shading elements — trees, ties, the dock, the PV panels — beside the ground (2026-09-05)
    const shadeView = (list: typeof els): THREE.Group => buildSiteElementsView(list, 0.9, hiddenSiteRef.current, selSiteRef.current, (name) => transmittanceOf(sunRef.current.month, name)).group;
    const elsStill = els.filter((e) => (e.file || siteFileName) !== edFile), elsMoving = els.filter((e) => (e.file || siteFileName) === edFile);
    if (elsStill.length) root.add(shadeView(elsStill));
    if (elsMoving.length) moving.add(shadeView(elsMoving));
    if (systemsOn) {
      // on the BIM tabs the shades are drawn above, with the site; a services element is drawn when its layer is turned on —
      // and every one of the file being placed, but for a layer the user has switched off
      const shadeKeys = bimTab ? new Set(siteElementsRef.current.map((e) => `${e.file || siteFileName}|${e.fileExpressId ?? e.expressId}`)) : null;
      const shownOn = (e: { file: string; fileExpressId: number }): boolean => {
        const l = fileLayersRef.current.get(e.file)?.get(e.fileExpressId);
        return !!l && shownLayersRef.current.has(layerKey(e.file, l)) && !hl.has(layerKey(e.file, l));
      };
      const inv = mepElementsRef.current.filter((e) => (e.file === edFile || !hf.has(e.file))
        && (bimTab ? !shadeKeys!.has(`${e.file}|${e.fileExpressId}`) && (e.file === edFile ? !layerOff(e.file, e.fileExpressId) : shownOn(e)) : !layerOff(e.file, e.fileExpressId)));
      const invStill = inv.filter((e) => e.file !== edFile), invMoving = inv.filter((e) => e.file === edFile);
      if (invStill.length) root.add(buildMepView(invStill, { focus: bimTab ? null : FOCUS[sysFocusRef.current], selected: selMepRef.current }).group);
      if (invMoving.length) moving.add(buildMepView(invMoving, { focus: null, selected: selMepRef.current }).group);
    }
    // the fill: the stored fill list, its faces from ifc.db, drawn as earth
    const fillIds = new Set(queryFills(db).map((f) => f.elementId));
    if (on && fillIds.size && terrainRef.current) {
      const terrain = terrainRef.current;
      const faces = queryFaces(db, null).filter((r) => fillIds.has(r.elementId));
      const fill = buildFillView(faces, (x, z) => heightAt(terrain, x, z), TERRAIN_OPACITY);
      root.add(fill.group);
    }
    if (edFile) {
      root.add(moving);
      // the pivot: a vertical line through it, the height of the house and some
      const pivot = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -10, 0), new THREE.Vector3(0, 40, 0)]),
        new THREE.LineBasicMaterial({ color: 0xf0c060, depthTest: false, transparent: true }));
      pivot.name = "align-pivot";
      pivot.renderOrder = 10;
      root.add(pivot);
    }
    const c2 = root.clone(), c3 = root.clone();
    panes.setTerrainGroups(c2, c3);
    ifcPaneRef.current?.setTerrain(root);
    alignPreviewRef.current = edFile ? [root, c2, c3] : [];
    if (edFile) placePreview();
  }, []);

  // the editing column is dragged wider for the BEM tables (user, 2026-09-04)
  const [editW, setEditW] = useState(() => {
    const n = Number(window.localStorage.getItem("bim-edit-w"));
    return Number.isFinite(n) && n > 0 ? Math.min(760, Math.max(200, n)) : 236;
  });
  useEffect(() => { window.localStorage.setItem("bim-edit-w", String(editW)); }, [editW]);
  const dragEdit = useCallback((ev: React.PointerEvent) => {
    ev.preventDefault();
    const x0 = ev.clientX, w0 = editW;
    const move = (e: PointerEvent): void => setEditW(Math.min(760, Math.max(200, w0 + (x0 - e.clientX))));
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    document.body.style.cursor = "col-resize";
  }, [editW]);
  // THE VIEW TABS: each view collapses behind its title; the last one shown stays
  // (user, 2026-09-04): in BEM the main view is the IDF-DB zone model, painted
  // by the lens; the systems schematic joins it on the SYSTEMS tab only; the
  // zone grid and the schedule strips live in the column, never in the view
  /** the CONSTRUCTIONS page's centre view ALTERNATES (user, 2026-09-08): PLAN — the model from above — or DETAIL, one at a time */
  const [consView, setConsView] = useState<"plan" | "detail">(() => (window.localStorage.getItem("bim-cons-view") === "detail" ? "detail" : "plan"));
  useEffect(() => { window.localStorage.setItem("bim-cons-view", consView); requestAnimationFrame(() => window.dispatchEvent(new Event("resize"))); }, [consView]);
  const consViewRef = useRef(consView); consViewRef.current = consView;
  type ViewKey = "ifc" | "idf" | "detail" | "assembly" | "calendar" | "graphs" | "report" | "cost";
  const [views, setViews] = useState<Record<ViewKey, boolean>>(() => {
    const all: Record<ViewKey, boolean> = { ifc: true, idf: true, detail: true, assembly: true, calendar: true, graphs: true, report: true, cost: true };
    try { const v = JSON.parse(window.localStorage.getItem("bim-views") ?? "") as Partial<Record<ViewKey, boolean>>; for (const k of Object.keys(all) as ViewKey[]) if (v[k] === false) all[k] = false; } catch { /* defaults */ }
    return all;
  });
  /** the views a page shows: BIM and BOM the two, BEM the zone model (SYSTEMS: the model with the services drawn in it — no schematic, 2026-09-10) */
  const viewSetFor = (m: AppModule, t: TabId): ViewKey[] => (m === "bem" ? (t === "bem-constructions" ? ["idf", "detail"] : t === "bem-schedules" ? ["calendar", "idf"] : t === "bem-run" ? ["graphs", "report", "idf"] : ["idf"]) : ["ifc", "idf"]);
  /** what is on screen: the shown members of the page's set — all of them when none is (a view collapsed on another page) */
  // BOM · ENERGY & COST (2026-10-03): the card selected in UTILITY, else the one applied, else the first in force — both sides priced by it
  const bomPricing = useMemo(() => {
    const usable = tariffRead?.usable ?? [];
    const pick = bomSel?.rail === "UTILITY" ? bomSel.id : bomTariff?.card;
    const card = usable.find((c) => c.id === pick) ?? cardInForce(tariffRead, bomTariff?.card) ?? usable[0];
    if (!card) return null;
    // the PCA billed prices the model's month too (2026-10-09) — a bill's month over a value typed on the card
    const t = bomTariff?.card === card.id ? bomTariff : undefined, billed = pcaFromStatements(bomStatements.bills);
    const tt = t && Object.keys(billed).length ? { ...t, pca: { ...t.pca, byMonth: { ...t.pca?.byMonth, ...billed } } } : t;
    return { card, tt, bills: [...bomImports.flatMap((i) => i.bills), ...statementBills(bomStatements)] };
  }, [tariffRead, bomSel, bomTariff, bomImports, bomStatements]);
  const pricedBom = useMemo(() => (bomPricing && bem ? priceBoth(bomPricing.card, bomPricing.tt, bem.hourly ?? [], bomPricing.bills, bem.tariffs ?? []) : null), [bomPricing, bem]);
  // THE CALIBRATED SIDE (user, 2026-10-10: "graph the BEM Standard, Calibrated … and Bill (total) costs"): BOM's calibration run priced by
  // the same card over each bill's own dates; before the PV's connection its hours are the house without PV, as the bills were billed
  const pricedCal = useMemo(() => {
    if (!bomPricing || !calRun) return null;
    const firstGen = bomPricing.bills.filter((b) => (b.receivedKwh ?? 0) > 0).map((b) => b.periodStart).sort()[0] ?? null;
    return priceBoth(bomPricing.card, bomPricing.tt, pvOffBefore(calRun.hourly, calPvOn || firstGen), bomPricing.bills, []);
  }, [bomPricing, calRun, calPvOn]);
  // EACH SIDE WITHOUT THE PV (user, 2026-10-10: "Standard w/o and w/ PV, Calibrated w/o and w/ PV, and Billed w/o and w/ PV"): the runs'
  // hours as the house without panels (its use bought, nothing sold) — the run itself untouched; the bills moved by the card's price of
  // the panels' measured production bought instead
  const NEVER = "9999-12-31";
  // EACH METER ITS OWN ACCOUNT (user, 2026-10-23: "The BOM should offer utility cost per meter"): the ELECTRICAL sheet's meters, each
  // one's hourly series from the run (its Meter:Custom, by the name written) priced on the same card as a service of its own
  const pricedMeters = useMemo(() => {
    if (!bomPricing || !bem) return [];
    return (bemModel?.report.meters ?? []).flatMap((m) => {
      const s = m.emitted ? (bem.hourly ?? []).find((h) => h.name.toUpperCase() === m.emitted.toUpperCase()) : undefined;
      return s ? [{ name: m.name, zones: m.zones, priced: priceBoth(bomPricing.card, bomPricing.tt, [{ ...s, name: "Electricity:Facility" }], [], []) }] : [];
    });
  }, [bomPricing, bem, bemModel]);
  const pricedStdNo = useMemo(() => (bomPricing && bem ? priceBoth(bomPricing.card, bomPricing.tt, pvOffBefore((bem.hourly ?? []) as HourSeries[], NEVER), bomPricing.bills, []) : null), [bomPricing, bem]);
  const pricedCalNo = useMemo(() => (bomPricing && calRun ? priceBoth(bomPricing.card, bomPricing.tt, pvOffBefore(calRun.hourly, NEVER), bomPricing.bills, []) : null), [bomPricing, calRun]);
  const billNoPv = useMemo(() => {
    if (!bomPricing) return null;
    const firstGen = bomPricing.bills.filter((b) => (b.receivedKwh ?? 0) > 0).map((b) => b.periodStart).sort()[0] ?? null;
    return billedWithoutPv(bomPricing.card, bomPricing.tt, bomPricing.bills, calPv ? new Map(calPv.read.days.map((d) => [d.date, d.kwh] as const)) : null, calPvOn || firstGen);
  }, [bomPricing, calPv, calPvOn]);
  /** A PV OR OTHER RENEWABLE SYSTEM (user, 2026-10-23: "When there isn't a PV or renewable energy system (not including heat reclaim),
   *  then the BOM should not show PV (or other renewable) values"): a run made electricity, a bill sent energy to the grid, or the
   *  panels' production is imported */
  const hasPv = useMemo(() => producesElectricity((bem?.hourly ?? []) as HourSeries[]) || producesElectricity(calRun?.hourly ?? [])
    || (bomPricing?.bills ?? []).some((b) => (b.receivedKwh ?? 0) > 0) || !!calPv, [bem, calRun, bomPricing, calPv]);
  // THE PRINTED REPORT'S NAME (user, 2026-10-07: "which should be labeled BOM, not BIM for pdf print"): the print dialog names the PDF
  // after the window's title — the report's own while it prints, the app's back after
  const projectName = (pathRef.current.split(/[\\/]/).pop() ?? "").replace(/\.ifc$/i, "") || "the project";
  const printAs = (title: string): void => {
    const was = document.title;
    const back = (): void => { document.title = was; window.removeEventListener("afterprint", back); };
    window.addEventListener("afterprint", back);
    document.title = title;
    window.print();
  };
  const vset = viewSetFor(module, tab);
  const shownViews = vset.filter((k) => views[k]);
  const eff = new Set<ViewKey>(shownViews.length ? shownViews : vset);
  if (module === "bem" && tab === "bem-constructions") { eff.clear(); eff.add(consView === "plan" ? "idf" : "detail"); }
  // SYSTEMS: the assembly sheet alone — the model with the services drawn in it showed nothing of use (user, 2026-10-15)
  if (module === "bem" && tab === "bem-systems") { eff.clear(); eff.add("assembly"); }
  // SCHEDULES: the calendar alone — the zone model has no bearing on a schedule (user, 2026-10-15)
  if (module === "bem" && tab === "bem-schedules") { eff.clear(); eff.add("calendar"); }
  if (module === "bem" && tab === "bem-run") { eff.clear(); eff.add(runView === "graphs" ? "graphs" : runView === "report" ? "report" : "idf"); }
  // BOM: the main view is ENERGY & COST alone — the model's two views served no purpose there (user, 2026-10-15)
  // BOM › CFD: the model, the supply air drawn in it as arrows (user, 2026-11-04)
  const cfdTab = module === "bom" && tab === "bom-cfd";
  const bomOps = module === "bom" && !cfdTab;
  if (module === "bom") { eff.clear(); eff.add(cfdTab ? "idf" : "cost"); }
  const costView = eff.has("cost");
  // cfd.db read on entering the tab (and after a run) — the screen draws the snapshot it holds, never the solver's files
  const loadCfd = useCallback(async (): Promise<void> => {
    const bytes = await window.bem.readDataFile("cfd.db").catch(() => null);
    const SQL = await getSql(wasmUrl);
    cfdDbRef.current?.close();
    cfdDbRef.current = bytes ? openCfdDb(SQL, bytes) : null;
    const runs = cfdDbRef.current ? queryCfdRuns(cfdDbRef.current) : [];
    setCfdRuns(runs);
    setCfdSpace((sp) => (sp && runs.some((r) => r.space === sp) ? sp : runs[runs.length - 1]?.space ?? sp));
  }, []);
  useEffect(() => { if (cfdTab) void loadCfd(); }, [cfdTab, loadCfd]);
  /** Run CFD… on a space: the dialog opens on the files it reads — the room solid (idf.db, as loaded), the latest run's own IDF
   *  and bem.db (its peaks and inside temperatures), idf.db's terminals and doors */
  const cfdFacesOf = useCallback((space: string): CfdRoomFace[] => {
    const sp = runRef.current?.spaces.find((x) => spaceName(x) === space);
    return (sp?.faces ?? []).map((f) => ({ n: f.n as [number, number, number], outer: f.outer as Array<[number, number, number]>, areaM2: f.areaM2, holes: ((f as { holes?: unknown }).holes ?? []) as Array<Array<[number, number, number]>> }));
  }, []);
  const cfdInputs = useCallback(async (): Promise<CfdInputs | null> => {
    const stamp = bemRef.current?.stamp;
    if (!stamp) { setStatus(`CFD: no EnergyPlus run yet — run the model on BEM › RUN first`); return null; }
    const [idfB, bemB, idfTextB, engine, machine] = await Promise.all([window.bem.readDataFile("idf.db"), window.bem.readDataFile("bem.db"), window.bem.readRunFile(stamp, "in.idf"), window.cfd.engine(), window.cfd.machine().catch(() => null)]);
    if (!idfB || !bemB || !idfTextB) { setStatus(`CFD: ${!idfB ? "idf.db" : !bemB ? "bem.db" : `the run ${stamp}'s in.idf`} could not be read`); return null; }
    const SQL = await getSql(wasmUrl);
    return { idf: new TextDecoder().decode(idfTextB), idfDb: new SQL.Database(idfB), bemDb: new SQL.Database(bemB), stamp, engine, machine };
  }, []);
  const openCfdDialog = useCallback(async (space: string): Promise<void> => {
    // the setup opens on the plan (2026-11-10): the room's offer read once, the databases closed after
    const inp = await cfdInputs();
    if (!inp) return;
    if (cfdWantRef.current && cfdWantRef.current !== space) { inp.idfDb.close(); inp.bemDb.close(); return; }
    try {
      const faces = cfdFacesOf(space);
      const offer = cfdOffer({ space, faces, idf: inp.idf, idfDb: inp.idfDb, bemDb: inp.bemDb, stamp: inp.stamp });
      setCfdSetupIn({ space, faces: offer.faces, idf: inp.idf, offer, engine: inp.engine, machine: inp.machine, stamp: inp.stamp });
      setCfdView("setup"); setCfdSpace(space);
    } catch (e) { setStatus(`CFD: could not set up ${space}: ${e instanceof Error ? e.message : String(e)}`); }
    finally { inp.idfDb.close(); inp.bemDb.close(); }
  }, [cfdInputs, cfdFacesOf]);
  const openCfdBatch = useCallback(async (only?: string[]): Promise<void> => {
    const inp = await cfdInputs();
    if (!inp) return;
    const rooms = (runRef.current?.spaces ?? []).map((x) => spaceName(x)).filter((n, i, a) => n && a.indexOf(n) === i && (!only || only.includes(n))).map((space) => ({ space, faces: cfdFacesOf(space) })).filter((r) => r.faces.length);
    setCfdBatch((d) => { d?.idfDb.close(); d?.bemDb.close(); return null; });
    setCfdBatch({ ...inp, rooms });
  }, [cfdInputs, cfdFacesOf]);
  // SUPPLY AIR (2026-11-10): the room's offer read when that tab is up — the system's supply per peak, the loads, the setpoints
  const [cfdSupplyOffer, setCfdSupplyOffer] = useState<{ space: string; stamp: string; offer: CfdOfferT | null; why: string | null } | null>(null);
  const [cfdSupplyRev, setCfdSupplyRev] = useState(0);
  useEffect(() => {
    if (!cfdTab || cfdFrameTab !== "SUPPLY AIR" || !cfdSpace) return;
    const stamp = bemRef.current?.stamp ?? "";
    if (cfdSupplyOffer && cfdSupplyOffer.space === cfdSpace && cfdSupplyOffer.stamp === stamp) return;
    let live = true;
    setCfdSupplyOffer({ space: cfdSpace, stamp, offer: null, why: null });
    void (async () => {
      const inp = await cfdInputs();
      if (!inp) { if (live) setCfdSupplyOffer({ space: cfdSpace, stamp, offer: null, why: "no EnergyPlus run yet — run the model on BEM › RUN" }); return; }
      try {
        const offer = cfdOffer({ space: cfdSpace, faces: cfdFacesOf(cfdSpace), idf: inp.idf, idfDb: inp.idfDb, bemDb: inp.bemDb, stamp: inp.stamp });
        if (live) setCfdSupplyOffer({ space: cfdSpace, stamp, offer, why: null });
      } catch (e) { if (live) setCfdSupplyOffer({ space: cfdSpace, stamp, offer: null, why: `could not read ${cfdSpace}'s system: ${e instanceof Error ? e.message : String(e)}` }); }
      finally { inp.idfDb.close(); inp.bemDb.close(); }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfdTab, cfdFrameTab, cfdSpace, bem?.stamp]);
  const closeCfdBatch = useCallback((): void => { setCfdBatch((d) => { d?.idfDb.close(); d?.bemDb.close(); return null; }); }, []);
  /** the runs, all handed to the runner at once (it holds each until its processes fit): OpenFOAM in data/cfd/runs/<stamp>/, each
   *  run's progress in the column, each result into cfd.db as it finishes — one save at a time */
  const runCfdJobs = useCallback(async (bemStamp: string, jobs: Array<{ space: string; case: CfdCase; np: number }>): Promise<void> => {
    const base = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15);
    // THE MESH ONCE PER ROOM, THE PEAKS ON IT (2026-11-10): a mesh run folder per room, each peak's run copying it in
    const tag = (sp: string): string => sp.replace(/[^A-Za-z0-9]+/g, "_");
    const meshes = [...new Map(jobs.map((j) => [j.space, j])).values()].map((j) => ({ space: j.space, stamp: `${base}-${tag(j.space)}-mesh`, files: j.case.out.files, steps: CFD_MESH_STEPS }));
    const items = jobs.map((j) => ({ ...j, stamp: `${base}-${tag(j.space)}-${j.case.peak}`, steps: stepsFor(stepsOnMesh(`${base}-${tag(j.space)}-mesh`), j.np) }));
    setCfdJobs((x) => [...x,
      ...meshes.map((mj) => ({ stamp: mj.stamp, space: mj.space, peak: "mesh", np: 1, step: 0, steps: mj.steps.length, label: "waiting", iteration: 0, iterations: 0, last: "" })),
      ...items.map((j) => ({ stamp: j.stamp, space: j.space, peak: j.case.peak, np: j.np, step: 0, steps: j.steps.length, label: "waiting for the mesh", iteration: 0, iterations: (j.case.out.info.iterations as number) ?? 0, last: "" }))]);
    const mark = (stamp: string, f: (r: (typeof cfdJobs)[number]) => (typeof cfdJobs)[number]): void => setCfdJobs((x) => x.map((r) => (r.stamp === stamp ? f(r) : r)));
    // STOP WHEN SETTLED (2026-11-10): every 250 iterations the room's three averages are read and judged (cfdConverge.ts); settled,
    // the solver is asked to write and end. The last verdict per run is kept for its settled.json.
    const settle = new Map<string, { checked: number; stopped: boolean; last: Settle | null; busy: boolean; end?: number }>();
    const readSeries = async (stamp: string): Promise<Partial<Record<MonitorKey, Array<[number, number]>>>> => {
      const out: Partial<Record<MonitorKey, Array<[number, number]>>> = {};
      for (const mo of MONITORS) {
        const starts = await window.cfd.list(stamp, `postProcessing/${mo.key}`);
        const st = starts.sort((a, b) => +a - +b)[0];
        const txt = st ? await window.cfd.read(stamp, `postProcessing/${mo.key}/${st}/${mo.file}`) : null;
        if (txt) out[mo.key] = readDat(txt);
      }
      return out;
    };
    const ruleOf = (j: (typeof items)[number]) => (j.case.input.stop ? { ...STOP_DEFAULT, tolK: j.case.input.stop.tolK, minIterations: j.case.input.stop.minIterations } : null);
    const off = window.cfd.onProgress((m) => {
      if (!items.some((j) => j.stamp === m.stamp) && !meshes.some((mj) => mj.stamp === m.stamp)) return;
      const it = /^Time = (\d+)/.exec(m.text);
      const job = items.find((j) => j.stamp === m.stamp), rule = job ? ruleOf(job) : null;
      if (it && rule) {
        const st = settle.get(m.stamp) ?? { checked: 0, stopped: false, last: null, busy: false };
        settle.set(m.stamp, st);
        if (!st.stopped && !st.busy && +it[1]! >= st.checked + 250 && +it[1]! >= rule.minIterations) {
          st.busy = true; st.checked = +it[1]!;
          void readSeries(m.stamp).then((series) => {
            const v = settledYet(series, rule); st.last = v;
            if (v.settled && !st.stopped) {
              st.stopped = true;
              void window.cfd.settle(m.stamp, v.iteration).then((r) => { if (r) st.end = r.end; if (r) mark(m.stamp, (x) => ({ ...x, iterations: r.end, last: `settled at iteration ${v.iteration.toLocaleString()} — averaging the next ${(r.end - r.averageFrom + 1).toLocaleString()}` })); });
            }
          }).finally(() => { st.busy = false; });
        }
      }
      mark(m.stamp, (r) => ({ ...r, step: m.step ?? r.step, label: m.label ?? r.label, iteration: it ? +it[1]! : r.iteration, last: m.text.slice(0, 160) }));
    });
    // WHY, AND WHAT TO DO (2026-11-10): the failed step's own log read and explained
    const explain = async (stamp: string, res: { error: string | null; failedStep?: string }): Promise<void> => {
      mark(stamp, (r) => ({ ...r, error: res.error ?? "the run failed" }));
      if (res.error === "cancelled") return;
      try {
        const k = /log\.(\d\d)\./.exec(res.error ?? "")?.[1];
        const names = await window.cfd.list(stamp, ".");
        const log = names.find((n) => (k ? n.startsWith(`log.${k}.`) : n.startsWith("log."))) ?? [...names].filter((n) => n.startsWith("log.")).sort().pop();
        const text = log ? (await window.cfd.read(stamp, log)) ?? "" : "";
        const named = fileNamed(text), files: Record<string, string> = {};
        if (named) files[named.file] = (await window.cfd.read(stamp, named.file)) ?? "";
        mark(stamp, (r) => ({ ...r, diag: diagnose(text, res.failedStep ?? null, files) }));
      } catch { /* the raw error stays */ }
    };
    const runPeak = async (j: (typeof items)[number]): Promise<void> => {
      const files = j.np > 1 ? { ...j.case.out.files, "system/decomposeParDict": decomposeParDict(j.np) } : j.case.out.files;
      const res = await window.cfd.run({ stamp: j.stamp, files, steps: j.steps, np: j.np });
      if (!res.ok) {
        await explain(j.stamp, res);
        return;
      }
      // the verdict beside the case, read back with it (caseLoad's settle)
      const rule = ruleOf(j);
      if (rule) {
        try {
          const v = settledYet(await readSeries(j.stamp), rule), done = settle.get(j.stamp);
          const settled = !!done?.stopped || v.settled;
          const cap = Number(j.case.out.info.iterations ?? 0) || 0;
          await window.cfd.settleNote(j.stamp, JSON.stringify({ settled, iteration: done?.stopped && done.last ? done.last.iteration : v.iteration, cap, words: settleWords(done?.stopped && done.last ? done.last : v, imperialRef.current) }));
        } catch { /* the run stands; its verdict is read as not kept */ }
      }
      mark(j.stamp, (r) => ({ ...r, label: "reading the result into cfd.db", last: "" }));
      let meshCells = 0;
      const save = cfdSaveChain.current.then(async () => {
        const SQL = await getSql(wasmUrl);
        const bytes = await window.bem.readDataFile("cfd.db").catch(() => null);
        const db = openCfdDb(SQL, bytes);
        const imp = await importCfdCase(db, { read: async (rel) => (await window.cfd.read(j.stamp, rel)) ?? "", list: (rel) => window.cfd.list(j.stamp, rel), exists: (rel) => window.cfd.exists(j.stamp, rel) },
          { space: j.space, peak: j.case.peak, stamp: new Date().toISOString(), caseDir: res.dir ?? j.stamp, seconds: res.seconds, solver: `OpenFOAM ${res.version ?? ""}${j.np > 1 ? ` · ${j.np} processes` : ""}`.trim(), bemRun: bemStamp });
        meshCells = imp.cells;
        await window.bim.saveDb("cfd.db", db.export());
        db.close();
      });
      cfdSaveChain.current = save.catch(() => undefined);
      try { await save; } catch (e) { mark(j.stamp, (r) => ({ ...r, error: `the run finished but could not be read: ${e instanceof Error ? e.message : String(e)}` })); return; }
      // this machine's own time against the Bed 1 estimate for the same run (2026-11-10): the next estimates are corrected by it
      if (typeof res.seconds === "number" && res.seconds > 0) {
        // the iterations RUN — a run that settled early ended at its settling point + 3,000, not the cap
        const cells = meshCells, iters = settle.get(j.stamp)?.end ?? (Number(j.case.out.info.iterations ?? 0) || 0);
        const machine = await window.cfd.machine().catch(() => null);
        const side = machine ? Math.max(1, Math.min(items.length, Math.floor(usableCores(machine) / Math.max(1, j.np)))) : 1;
        const est = cells && iters ? jobSeconds({ key: j.stamp, cells, iterations: iters }, j.np, side) : 0;
        if (est > 0) addTiming({ at: new Date().toISOString(), ratio: res.seconds / est, procs: j.np, cells });
      }
      setCfdJobs((x) => x.filter((r) => r.stamp !== j.stamp));
      await loadCfd();
      setCfdSpace(j.space); setCfdPeak(j.case.peak); setCfdPick(null); setCfdView("results");
    };
    await Promise.all(meshes.map(async (mj) => {
      const peaks = items.filter((j) => j.space === mj.space);
      const mres = await window.cfd.run({ stamp: mj.stamp, files: mj.files, steps: mj.steps, np: 1 });
      if (!mres.ok) {
        await explain(mj.stamp, mres);
        for (const j of peaks) mark(j.stamp, (r) => ({ ...r, error: mres.error === "cancelled" ? "cancelled with its mesh" : `not run: ${mj.space}'s mesh failed — see the mesh above` }));
        return;
      }
      setCfdJobs((x) => x.filter((r) => r.stamp !== mj.stamp));
      for (const j of peaks) mark(j.stamp, (r) => ({ ...r, label: "waiting" }));
      await Promise.all(peaks.map(runPeak));
    }));
    off();
  }, [loadCfd]);
  // a space picked in LEVELS · SPACES on this tab is the one shown
  // (2026-11-10, the user: "switching spaces in left column did not refocus to that space in the 3d view" — it moved only for a
  //  space with a run; now any space picked is the one the tab is about, and the view goes to it)
  useEffect(() => { if (cfdTab && selSpaceName) { setCfdSpace(selSpaceName); setCfdPick(null); } }, [cfdTab, selSpaceName]);
  // the view goes to the room shown, once per room (a right-click zooms already; this is the tab's first look) — zoomToSpace is
  // declared further down, read here only when the effect runs, after the render that declared it
  const cfdZoomed = useRef<string | null>(null);
  useEffect(() => { if (!cfdTab) { cfdZoomed.current = null; return; } if (cfdSpace && cfdZoomed.current !== cfdSpace) { cfdZoomed.current = cfdSpace; const sp = cfdSpace; window.setTimeout(() => zoomToSpace(sp), 400); } }, [cfdTab, cfdSpace, cfdShown]);
  useEffect(() => {
    const db = cfdDbRef.current;
    const mine = cfdRuns.filter((r) => r.space === cfdSpace && r.peak === cfdPeak);
    const run = mine.find((r) => r.id === cfdPick) ?? mine[mine.length - 1];
    if (!db || !run) { setCfdShown(null); return; }
    setCfdShown({ run, metrics: queryCfdMetrics(db, run.id), openings: queryCfdOpenings(db, run.id), slices: queryCfdSlices(db, run.id), walls: queryCfdWalls(db, run.id), arrows: queryCfdArrows(db, run.id) });
  }, [cfdRuns, cfdSpace, cfdPeak, cfdPick]);
  // the arrows over the IDF-DB view while the tab is up; gone on every other tab
  useEffect(() => {
    const panes = dbPanesRef.current;
    if (!panes) return;
    if (!cfdTab || !cfdShown) { panes.setCfdGroup(null); return; }
    panes.setCfdGroup(buildCfdView({ arrows: cfdShown.arrows, openings: cfdShown.openings, tRange: cfdTRange(cfdShown.arrows) }));
    return () => panes.setCfdGroup(null);
  }, [cfdTab, cfdShown]);
  useEffect(() => { if (cfdTab && !cfdMachine) void window.cfd.machine().then(setCfdMachine).catch(() => undefined); }, [cfdTab, cfdMachine]);
  useEffect(() => {
    dbPanesRef.current?.setCfdMoving(cfdTab && cfdMoving);
    try { window.localStorage.setItem("bim-cfd-moving", cfdMoving ? "1" : "0"); } catch { /* a convenience */ }
  }, [cfdTab, cfdMoving, cfdShown]);
  /** the arrows' colour scale: their 5th to 95th percentile temperature, so the room's own range spreads over the scale and the
   *  supply jets saturate at the end */
  const cfdTRange = (as: CfdArrow[]): [number, number] => {
    const t = as.map((a) => a.t).filter(Number.isFinite).sort((a, b) => a - b);
    if (!t.length) return [20, 22];
    const q = (p: number): number => t[Math.min(t.length - 1, Math.floor(p * (t.length - 1)))]!;
    return q(0.05) === q(0.95) ? [q(0) - 0.5, q(1) + 0.5] : [q(0.05), q(0.95)];
  };
  const cfdMark = (space: string): React.ReactNode => {
    if (!cfdTab) return null;
    const h = cfdRuns.some((r) => r.space === space && r.peak === "heating"), c = cfdRuns.some((r) => r.space === space && r.peak === "cooling");
    if (!h && !c) return null;
    return <sup className="cfdMark" title={`cfd.db holds ${[h && "a heating", c && "a cooling"].filter(Boolean).join(" and ")} run of ${space} — click the name to show it`}>{h ? "\u2191H" : ""}{c ? "\u2193C" : ""}</sup>;
  };
  const asmView = eff.has("assembly");
  // the ELECTRICAL sheet (2026-10-02) is the same canvas, bench and column over its own cards
  const elecSheet = asmView && MAIN_OF[sysFocus] === "electrical";
  // and the PLUMBING sheet (2026-10-02): the water heaters and the hot-water uses
  const plumbSheet = asmView && MAIN_OF[sysFocus] === "plumbing";
  // ELECTRICAL takes a space too (2026-10-23): dropped on a Load center, the space's ZONE goes on it
  const roomDrag = asmView && !plumbSheet;
  const calView = eff.has("calendar");
  const graphView = eff.has("graphs");
  const reportView = eff.has("report");
  useEffect(() => {
    window.localStorage.setItem("bim-views", JSON.stringify(views));
    // the renderers size themselves to their containers; nudge them after a collapse
    requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  }, [views]);
  const toggleView = (k: ViewKey): void => setViews((v) => (v[k] && viewSetFor(moduleRef.current, tabRef.current).filter((x) => x !== k).every((x) => !v[x]) ? v : { ...v, [k]: !v[k] }));


  const rebuildDbView = useCallback((all: boolean, opacity: number) => {
    const db = dbRef.current;
    const panes = dbPanesRef.current;
    if (!db || !panes) return;
    const rows = queryFaces(db, all ? null : SHELL_CLASSES);
    dbRowsRef.current = rows;
    viewOpacityRef.current = opacity;
    // the windows, doors and screens the file names — read once per file
    elementIndexRef.current = queryElementIndex(db);
    typesRef.current = queryElementTypes(db);
    screenIdsRef.current = new Set([...elementIndexRef.current].filter(([, e]) => isScreenWall(e.ifcClass, e.name)).map(([id]) => id));
    rebuildOpeningIndex();
    paintClasses();
    // the IFC-DB view was retired from the screen (user, 2026-09-04): its
    // stored rows still feed the IFC inspector; nothing is drawn from them
    setStatus(`ifc.db: ${rows.length.toLocaleString()} stored faces` + (all ? " (all classes)" : " (shell classes)"));
  }, []);

  /** the corrections ledger as ONE object, so every save carries every ruling */
  const ledgerJson = (sha: string): CorrectionsLedger => ({
    sourceName: nameRef.current, sourceSha256: sha, savedAt: new Date().toISOString(),
    steps: Object.fromEntries(choicesRef.current), extends: editsRef.current, spaceExtends: spaceEditsRef.current,
    zones: zonesRef.current, deletes: deletesRef.current, glazing: Object.fromEntries(glazingRef.current),
    ...(Object.keys(voidRulingsRef.current).length ? { voids: voidRulingsRef.current } : {}),
    shading: { siteSha256: shadingRef.current.siteSha256 || siteShaRef.current, deleted: shadingRef.current.deleted },
    siteFiles: siteFilesRulingRef.current,
    siteFileTurn: siteFileTurnRef.current,
    ...(Object.keys(siteFileAlignRef.current).length ? { siteFileAlign: siteFileAlignRef.current } : {}),
    ...(Object.keys(zoneStageRef.current).length ? { staged: { at: new Date().toISOString(), zones: zoneStageRef.current } } : {}),
    ...(carriedRef.current ? { carried: carriedRef.current } : {}),
  });
  // Phase 2 — collapse to single planes per the four dropdowns, write idf.db,
  // render pane 3 FROM the idf.db rows (the view proves the DB).
  /** the spaces standing on a roof — outside the envelope, no room (spacesOnRoof) */
  const onRoofRef = useRef<Set<string>>(new Set());
  const rebuildIdf = useCallback(async (ch: Choices, opacity: number, useShell: boolean) => {
    const run = runRef.current;
    const panes = dbPanesRef.current;
    if (!run || !panes) return;
    // THE ROOMS AS RULED come first: the user's space extensions are applied
    // to the file's IfcSpace solids, and everything downstream — the side
    // read, the fill list, the carve, the attics, the zone census — sees the
    // rooms as ruled, never a mix
    const spaced = applySpaceExtensions(run.spaces, spaceEditsRef.current, spaceLabelOfRef.current, run.faces.map((f) => ({ elementId: f.expressId, n: f.n, outer: f.outer })));
    setSpaceEditLog(spaced.report.lines);
    // a space standing on a roof is no room: the roof under it is the building's top (2026-10-16)
    const roofIds = new Set(run.elements.filter((e) => /^IFCROOF$/i.test(e.ifcClass) || (/^IFCSLAB$/i.test(e.ifcClass) && (e.predefinedType ?? "").toUpperCase() === "ROOF")).map((e) => e.expressId));
    const onRoof = spacesOnRoof(spaced.out, [...roofIds].map((id) => ({ expressId: id, faces: run.faces.filter((f) => f.expressId === id) })));
    onRoofRef.current = new Set(spaced.out.filter((sp) => onRoof.has(sp.expressId)).map((sp) => sp.longName ?? sp.name ?? `#${sp.expressId}`));
    ruledSpacesRef.current = spaced.out.filter((sp) => !onRoof.has(sp.expressId));
    const spaces = ruledSpacesRef.current;
    const col = collapse(
      run.faces.map((f) => ({
        elementId: f.expressId, n: f.n, areaM2: f.areaM2, rgba: f.rgba,
        outer: f.outer, holes: f.holes,
      })),
      run.elements.map((e) => ({ expressId: e.expressId, ifcClass: e.ifcClass, isExternal: e.isExternal, predefinedType: e.predefinedType, name: e.name })),
      ch,
      // the rooms settle which side of a wall is the interior — a read, not a guess
      spaces.flatMap((sp) => sp.faces.map((f) => ({ n: f.n, outer: f.outer, areaM2: f.areaM2 }))),
    );
    // the open-edge instrument runs on BOTH sides, always — the badge tells
    // the truth whether or not the user armed the solver (principles.md #11)
    const edgeIn = (fs: typeof col.out): Parameters<typeof openEdges>[0] =>
      fs.map((f) => ({ elementId: f.elementId, category: f.category, n: f.n, outer: f.outer, holes: f.holes }));
    const leakBefore = openEdges(edgeIn(col.out)).leakLenM;
    const shell = useShell ? matchVertices(col.out, choicesRef.current) : null;
    // the user's hand corrections go LAST: they are the final word, and they
    // are replayed from the operation list so they survive every rebuild
    const hand0 = applyExtensions(shell ? shell.out : col.out, editsRef.current, labelOfRef.current);
    setEditLog(hand0.report.lines);
    // THE GROUND LINE: exterior walls cut into above- and below-grade parts by
    // the site terrain, slabs given their depth — before the carve, so every
    // room's cell inherits which side of the ground it is on
    const fills = terrainRef.current
      ? fillCandidates(run.elements, run.faces, spaces.map((sp) => ({ faces: sp.faces })), terrainRef.current) : [];
    const graded = terrainRef.current ? gradeSplit(hand0.out, terrainRef.current, fills) : null;
    const hand = graded ? { out: graded.out, report: hand0.report } : hand0;
    if (graded) setTerrainInfo({ split: graded.report.split, belowM2: graded.report.belowAreaM2, fillM2: graded.report.fillAreaM2, fills: fills.length });
    // ONE SURFACE, ONE ZONE. EnergyPlus has no surface belonging to two rooms;
    // 129 of the 204 collapsed surfaces here touch more than one, so idf.db is
    // not a zone model until they are carved by the room solids the file draws.
    const rooms = spaces.map((sp) => ({
      name: sp.longName ?? sp.name ?? `#${sp.expressId}`,
      colorIndex: sp.colorIndex,
      faces: sp.faces.map((f) => ({ n: f.n, outer: f.outer })),
    }));
    const split1 = splitBySpace(hand.out, rooms);
    // ATTICS: the column over each room's carved ceiling up to the roof or
    // floor above — built from that first carve, then everything is carved
    // again by rooms and attics together, so each surface is partitioned once
    const atticRep = atticSolids(split1.out.map((f) => ({
      elementId: f.elementId, category: f.category, n: f.n, outer: f.outer, areaM2: f.areaM2,
      space: f.space ?? null, spaceFacing: f.spaceFacing ?? null,
    })), rooms.map((r) => r.name));
    setAttics(atticRep);
    atticsRef.current = atticRep;
    const split2 = splitBySpace(hand.out, [...rooms, ...atticRep.attics.map((a) => ({ name: a.name, colorIndex: a.colorIndex, faces: a.faces, built: true }))]);
    // the user's zone rulings: merges, relabeled after the carve
    const ruled = applyZoneRulings(split2.out, zonesRef.current);
    const split = { out: ruled.out, report: split2.report };
    const surfaces = split.out;
    const leakAfter = shell ? openEdges(edgeIn(shell.out)).leakLenM : leakBefore;

    const SQL = await getSql(wasmUrl);
    const idfDb = buildIdfDb(SQL, surfaces, ch, {
      sourceName: "ifc.db", sourceSha256: shaRef.current,
      shellApplied: useShell, leakBeforeM: leakBefore, leakAfterM: leakAfter,
      // THE PROJECT ELEVATION (user, 2026-09-07): the lowest occupied level, not the IfcSite's stated 0
      site: run.site ? { ...run.site, elevationM: projectElevation(run).elevM } : null, trueNorth: run.trueNorth, sourceIfcName: nameRef.current, address: run.address,
      siteElevationFrom: projectElevation(run).from, siteRefElevationM: projectElevation(run).siteRefM,
    });
    // WALL QA — measured from the STORED rows of both databases, then written
    // back into idf.db so the panel below reads the DB, not this closure
    const idfStored = queryIdfFaces(idfDb);
    // the rooms as ruled travel with the zone model; pane 3's overlay is
    // drawn from THESE rows once they are read back
    writeZoneSolids(idfDb, spaces);
    zoneSpaceRowsRef.current = querySpaces(idfDb);
    // schema 3: the elements and the zones — a downstream writer reads the FILE alone
    writeIdfElements(idfDb, run.elements, glazingResolver);
    writeElementTypes(idfDb, run.types);   // schema 8: the file's word per type
    // every window and door on the cell it cuts, by its own geometry — then read back
    writeOpenings(idfDb, placeOpenings(openingIndexRef.current, idfStored).placed);
    setPlaced(queryOpenings(idfDb));
    // the zone list folded through the user's own merges, so a merged zone's volume is the air it holds (2026-09-19)
    writeZones(idfDb, zoneRowsFor(spaces, atticRep.attics, zoneResolver(zonesRef.current)));
    zoneRowsRef.current = queryZones(idfDb);
    // THE VOID QA travels with the geometry and is READ BACK, as the wall QA is: the `?` in the tree
    // and its dialog are a reading of the DB, never of this closure (user, 2026-09-18)
    writeVoidQA(idfDb, assessVoids(idfStored, zoneRowsRef.current.map((z) => ({ name: z.name, kind: z.kind }))));
    voidRowsRef.current = queryVoidQA(idfDb);
    setVoidRows(voidRowsRef.current);
    // the user's answers ride in the CONTRACT beside the QA — the IDF writer reads them, so they are in
    // idf.db's canonical text and ruling a space makes the BEM model read stale (2026-09-18)
    writeVoidRulings(idfDb, voidRulingRows());
    // THE AIRTIGHT ASSESSMENT, per zone, from the stored rows — the spaces
    // panel reads this, never the closure above
    setZoneRows(assessZones(
      idfStored.map((f) => ({
        elementId: f.elementId, category: f.ifcClass, n: f.n, outer: f.outer, holes: f.holes,
        areaM2: f.areaM2, grossAreaM2: f.grossAreaM2, thicknessM: f.thicknessM, space: f.space ?? null, spaceFacing: f.spaceFacing ?? null,
      })),
      rooms.map((r) => ({ name: r.name, faces: r.faces })),
    ).zones);
    const ifcDb = dbRef.current;
    if (ifcDb) {
      const qa = wallQA(
        queryFaces(ifcDb, null),
        idfStored,
        openEdges(idfStored.map((f) => ({
          elementId: f.elementId, category: f.ifcClass, n: f.n, outer: f.outer, holes: f.holes,
        }))),
        run.trueNorth,
      );
      writeWallQA(idfDb, qa.rows);
      setQaRows(queryWallQA(idfDb));
    }
    // ABOVE / BELOW GRADE per wall, in BOTH databases (the user's ask)
    if (graded) {
      writeWallGrade(idfDb, graded.report.walls);
      writeFills(idfDb, graded.report.fills);
      if (dbRef.current) { writeWallGrade(dbRef.current, graded.report.walls); writeFills(dbRef.current, graded.report.fills); ifcDirtyRef.current = true; }
      setWallGrade(queryWallGrade(idfDb));
    }
    // THE SITE'S SHADING ELEMENTS as ruled — idf.db's site_elements is what the
    // IDF will carry as shading (the user's deletions vetoed), then READ BACK
    if (dbRef.current) {
      const vetoed = new Set(shadingRef.current.deleted.map((d) => d.expressId));
      writeSiteElements(idfDb, querySiteElements(dbRef.current).filter((e) => !vetoed.has(e.expressId)));
      siteElementsRef.current = querySiteElements(idfDb);
      // the services inventory rides along untouched: a deleted shade is still a piece of equipment
      writeMepElements(idfDb, queryMepElements(dbRef.current));
      writeMepSystems(idfDb, queryMepSystems(dbRef.current));
      mepElementsRef.current = queryMepElements(idfDb);
      mepSystemsRef.current = queryMepSystems(idfDb);
      setMepInfo((n) => n + 1);
      writeSiteFiles(idfDb, querySiteFiles(dbRef.current));
      siteFileRowsRef.current = querySiteFiles(idfDb); setSiteFiles(siteFileRowsRef.current as typeof siteFiles);
      setSiteElsInfo((n) => n + 1);
    }
    applyTerrain(showTerrainRef.current);
    // THE SYSTEMS DIAGRAM as saved (2026-09-10): the BEM ledger's sheet, copied into idf.db's system_* tables on every rebuild
    { const s = bemLedgerRef.current?.systems; const rows = diagramRows(s?.assembly ?? { nodes: [], edges: [] }, s?.assign ?? {}); writeSystemsDiagram(idfDb, rows); savedDiagramRef.current = { components: rows.components.length, connectors: rows.connectors.length, zones: rows.zones.length, at: bemLedgerRef.current?.savedAt ?? null }; }
    writeEdits(idfDb, [
      ...editsRef.current.map((o) => ({ op: "extend" as const, from: o.from, to: o.to, fromLabel: labelOfRef.current(o.from), toLabel: labelOfRef.current(o.to) })),
      ...spaceEditsRef.current.map((o) => ({ op: "extendSpace" as const, from: o.from, to: o.to, fromLabel: spaceLabelOfRef.current(o.from), toLabel: spaceLabelOfRef.current(o.to) })),
    ]);
    // every rebuild writes the ledger: the corrections are the user's, and
    // they belong to this file, not to this session
    void window.bim.saveCorrections(shaRef.current, ledgerJson(shaRef.current));
    if (shell) {
      writeStepDecisions(idfDb, shell.report.steps, choicesRef.current);
      setSteps(shell.report.steps);
      if (shell.report.steps.length > 0 && choicesRef.current.size === 0) openSection("steps");
    } else setSteps([]);
    // THE MODEL IS idf.db's (2026-10-07): a rebuild re-derives the geometry from the file, and the model committed to the
    // idf.db before it — the user's rulings, the library objects as values, the weather — rides across, for the SAME file only
    {
      const prev = await window.bem.readDataFile("idf.db");
      if (prev) {
        const old = new SQL.Database(prev);
        if (readMeta(old).get("source_ifc_sha256") === shaRef.current) carryModelInputs(old, idfDb);
        old.close();
      }
    }
    // THE FRESHNESS STAMP: idf.db's content hash after its last write, then
    // the chain check on both files' metas — the rail shows the verdict
    stampIdfContentSha(idfDb);
    {
      idfMetaRef.current = readMeta(idfDb);
      const links = checkChain({ ifc: dbRef.current ? readMeta(dbRef.current) : null, idf: idfMetaRef.current, bem: bemRef.current?.bemMeta ?? null, materials: materialsRef.current?.meta ?? null });
      chainRef.current = links; setChain(links);
    }
    await window.bim.saveDb("idf.db", idfDb.export());
    if (ifcDirtyRef.current && dbRef.current) { ifcDirtyRef.current = false; await window.bim.saveDb("ifc.db", dbRef.current.export()); }
    const rows = idfStored;
    idfRowsRef.current = rows;
    idfDb.close();
    viewOpacityRef.current = opacity;
    const view = buildDbView(rows, opacity, effHiddenElements(), idfRowHider(effHiddenSpaces()), lensFor(), styleFor());
    panes.setIdfGroup(view.group);
    // the rooms overlay follows every rebuild: pane 3 draws the rooms AS RULED
    if (showSpacesRef.current) applySpaces(true);
    const c = col.census;
    const r = shell?.report;
    setIdfInfo({
      surfacesIn: split.report.surfacesIn, surfacesOut: split.report.surfacesOut, interZone: split.report.interZone,
      unassignedAreaM2: split.report.unassignedAreaM2, areaDeltaM2: split.report.areaDeltaM2,
      byCategory: (Object.keys(c.byCategory) as Category[]).map((k) => [CATEGORY_LABEL[k], c.byCategory[k].elements]),
      droppedEdgeAreaM2: c.droppedEdgeAreaM2,
      match: r ? { wall: r.movedToWall, roof: r.movedToRoof, floor: r.movedToFloor, inserted: r.verticesInserted, maxMoveM: r.maxMoveM, steps: r.steps.length } : null,
      leakBeforeM: leakBefore, leakAfterM: leakAfter,
    });
  }, []);

  // ── the corrective tool ──────────────────────────────────────────────────
  // Two clicks and no guessing: right-click names the surface to move,
  // left-click names the surface it must reach. The geometry is the same one
  // model matchVertices uses; what the solver gets from a stated dimension,
  // this gets from a person who can see the gap.
  const surfaceAt = useCallback((hit: PickHit): { key: string; label: string } | null => {
    const rows = hit.pane === 3 ? idfRowsRef.current : dbRowsRef.current;
    const row = rows[hit.rowIndex];
    if (!row) return null;
    const key = surfaceKey(row.elementId, row.n);
    return { key, label: labelOfRef.current(key) };
  }, []);

  const runExtend = useCallback((op: ExtendOp) => {
    editsRef.current = [...editsRef.current, op];
    setEdits(editsRef.current);
    undoHistoryRef.current.push("surface");
    void rebuildIdf(choices, showSpaces ? FADED_SURFACE : fillOpacity, shellOn);
  }, [choices, showSpaces, fillOpacity, shellOn, rebuildIdf]);
  // the same two clicks on the ROOMS: a room's face taken to another room's
  // face, with the rooms overlay on so neither click can land on a wall
  const runSpaceExtend = useCallback((op: SpaceExtendOp) => {
    spaceEditsRef.current = [...spaceEditsRef.current, op];
    setSpaceEdits(spaceEditsRef.current);
    undoHistoryRef.current.push("space");
    void rebuildIdf(choices, showSpaces ? FADED_SURFACE : fillOpacity, shellOn);
  }, [choices, showSpaces, fillOpacity, shellOn, rebuildIdf]);
  const restoreSpaceExtend = useCallback((index: number) => {
    spaceEditsRef.current = spaceEditsRef.current.filter((_, i) => i !== index);
    setSpaceEdits(spaceEditsRef.current);
    void rebuildIdf(choices, showSpaces ? FADED_SURFACE : fillOpacity, shellOn);
  }, [choices, showSpaces, fillOpacity, shellOn, rebuildIdf]);

  // per-item restore: one ruling back to keep, one extension removed, or all
  const restoreStep = useCallback((key: string) => {
    const m = new Map(choicesRef.current); m.delete(key);
    choicesRef.current = m; setStepChoices(new Map(m));
    void rebuildIdf(choices, showSpaces ? FADED_SURFACE : fillOpacity, shellOn);
  }, [choices, showSpaces, fillOpacity, shellOn, rebuildIdf]);
  const restoreExtend = useCallback((index: number) => {
    editsRef.current = editsRef.current.filter((_, i) => i !== index);
    setEdits(editsRef.current);
    void rebuildIdf(choices, showSpaces ? FADED_SURFACE : fillOpacity, shellOn);
  }, [choices, showSpaces, fillOpacity, shellOn, rebuildIdf]);
  const restoreAll = useCallback(() => {
    choicesRef.current = new Map(); setStepChoices(new Map());
    editsRef.current = []; setEdits([]);
    spaceEditsRef.current = []; setSpaceEdits([]);
    glazingRef.current = new Map(); setGlazing(new Map());
    rebuildOpeningIndex(); paintClasses();
    undoHistoryRef.current = [];
    void rebuildIdf(choices, showSpaces ? FADED_SURFACE : fillOpacity, shellOn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choices, showSpaces, fillOpacity, shellOn, rebuildIdf]);

  // Undo Last undoes the last hand edit MADE, of either kind; after a reload
  // the order is unknown and the space edits go first
  const undoLast = useCallback(() => {
    let kind = undoHistoryRef.current.pop();
    if (kind === "space" && spaceEditsRef.current.length === 0) kind = "surface";
    if (kind === "surface" && editsRef.current.length === 0) kind = "space";
    if (!kind) kind = spaceEditsRef.current.length ? "space" : "surface";
    if (kind === "space") {
      if (spaceEditsRef.current.length === 0) return;
      spaceEditsRef.current = spaceEditsRef.current.slice(0, -1);
      setSpaceEdits(spaceEditsRef.current);
    } else {
      if (editsRef.current.length === 0) return;
      editsRef.current = editsRef.current.slice(0, -1);
      setEdits(editsRef.current);
    }
    setMenu(null);
    void rebuildIdf(choices, showSpaces ? FADED_SURFACE : fillOpacity, shellOn);
  }, [choices, showSpaces, fillOpacity, shellOn, rebuildIdf]);

  // re-draw panes 2/3 from the rows they already hold, and pane 1 through
  // Fragments — no solve, no DB write; hiding is a view state
  const applyHidden = useCallback(() => {
    const panes = dbPanesRef.current;
    const he = effHiddenElements(), hs = effHiddenSpaces();
    if (panes) {
      const g = buildDbView(idfRowsRef.current, viewOpacityRef.current, he, idfRowHider(hs), lensFor(), styleFor()).group;
      idfViewGroupRef.current = g;
      panes.setIdfGroup(g);
      if (intensityRef.current) intensityRepaintRef.current?.();
    }
    ifcPaneRef.current?.setHidden(he);
    setHiddenCount(hiddenRef.current.size + hiddenSiteRef.current.size);
    if (showSpacesRef.current) applySpaces(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applySpaces]);
  const showSpacesRef = useRef(false);
  showSpacesRef.current = showSpaces;
  // THE GLAZING RULING. The file is silent on every door here (no
  // GlazingAreaFraction, no glazing pset), so the checkbox is the user's word:
  // the ledger keeps it, both views redraw from it at once, and idf.db's
  // elements are rewritten from the file's bytes and restamped — a downstream
  // that reads what fills a hole sees the chain go stale (user, 2026-09-04).
  const applyGlazing = useCallback(async () => {
    setGlazing(new Map(glazingRef.current));
    rebuildOpeningIndex();
    reglazePlaced();
    paintClasses();
    applyHidden();
    void window.bim.saveCorrections(shaRef.current, ledgerJson(shaRef.current));
    const run = runRef.current;
    const bytes = await window.bem.readDataFile("idf.db");
    if (!run || !bytes) return;
    const SQL = await getSql(wasmUrl);
    const idfDb = new SQL.Database(bytes);
    writeIdfElements(idfDb, run.elements, glazingResolver);
    writeElementTypes(idfDb, run.types);
    writeOpenings(idfDb, placedRef.current);
    setPlaced(queryOpenings(idfDb));
    stampIdfContentSha(idfDb);
    idfMetaRef.current = readMeta(idfDb);
    const links = checkChain({ ifc: dbRef.current ? readMeta(dbRef.current) : null, idf: idfMetaRef.current, bem: bemRef.current?.bemMeta ?? null, materials: materialsRef.current?.meta ?? null });
    chainRef.current = links; setChain(links);
    await window.bim.saveDb("idf.db", idfDb.export());
    idfDb.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyHidden]);
  const ruleGlazing = useCallback((globalId: string, on: boolean) => { glazingRef.current.set(globalId, on); void applyGlazing(); }, [applyGlazing]);
  const restoreGlazing = useCallback((globalId: string) => { glazingRef.current.delete(globalId); void applyGlazing(); }, [applyGlazing]);
  /** the void rulings as idf.db's `void_rulings` takes them — ONE mapping, used by the rebuild and by a ruling made after it */
  const voidRulingRows = (): Array<{ space: string; answer: string; grille: boolean }> =>
    Object.entries(voidRulingsRef.current).map(([space, r]) => ({ space, answer: r.answer, grille: !!r.grille }));
  // THE VOID RULING (user, 2026-09-18). It goes to the corrections ledger keyed to the file, like every other
  // ruling here, AND into idf.db's `void_rulings`, which is in the contract's canonical text — so the content
  // sha moves, the chain reads stale and the BEM model rebuilt next writes the envelope the user ruled. The
  // glazing ruling's own path (2026-09-04), which does the same for what fills a hole.
  const applyVoids = useCallback(async () => {
    setVoidRulings({ ...voidRulingsRef.current });
    void window.bim.saveCorrections(shaRef.current, ledgerJson(shaRef.current));
    const bytes = await window.bem.readDataFile("idf.db");
    if (!bytes) return;
    const SQL = await getSql(wasmUrl);
    const idfDb = new SQL.Database(bytes);
    writeVoidRulings(idfDb, voidRulingRows());
    stampIdfContentSha(idfDb);
    idfMetaRef.current = readMeta(idfDb);
    const links = checkChain({ ifc: dbRef.current ? readMeta(dbRef.current) : null, idf: idfMetaRef.current, bem: bemRef.current?.bemMeta ?? null, materials: materialsRef.current?.meta ?? null });
    chainRef.current = links; setChain(links);
    await window.bim.saveDb("idf.db", idfDb.export());
    idfDb.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const ruleVoid = useCallback((name: string, r: VoidRuling) => {
    voidRulingsRef.current = { ...voidRulingsRef.current, [name]: r };
    void applyVoids();
  }, [applyVoids]);
  const restoreVoid = useCallback((name: string) => {
    const next = { ...voidRulingsRef.current }; delete next[name];
    voidRulingsRef.current = next;
    void applyVoids();
  }, [applyVoids]);
  // the lens follows the module: on in BEM / BOM, off in BIM
  useEffect(() => { applyHidden(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [module, tab]);
  // THE DESIGN DAY'S HOUR (2026-10-08): a surface-temperature lens shows one hour; untouched, the zones' median design peak hour that day
  const [lensHour, setLensHour] = useState<{ summer: number | null; winter: number | null }>({ summer: null, winter: null });
  const lensHourRef = useRef(lensHour); lensHourRef.current = lensHour;
  /** the hour ending (1–24) of the zones' median design peak on the day — the peak times are MMDDHHMM */
  const peakHourOf = (outcome: BemOutcome | null, day: "summer" | "winter"): number => {
    const hs = [...(outcome?.loads.zones.values() ?? [])].map((z) => (day === "summer" ? z.coolingDayTime : z.heatingDayTime)).filter((t) => t > 0)
      .map((t) => { const hh = Math.floor(t / 100) % 100, mm = t % 100; return Math.min(24, hh + (mm > 0 ? 1 : 0)) || 24; }).sort((a, b) => a - b);
    return hs.length ? hs[Math.floor((hs.length - 1) / 2)]! : day === "summer" ? 15 : 7;
  };
  const applyLens = useCallback((l: Lens, outcome: BemOutcome | null = bemRef.current) => {
    setLens(l);
    if (!outcome || l === "none") { lensRef.current = null; setLegend(null); applyHidden(); return; }
    const values = {
      zone: l === "zone-heating" ? outcome.zoneHeating : l === "zone-cooling" ? outcome.zoneCooling : outcome.zoneUnmet,
      surface: l === "surface-temp-summer" || l === "surface-temp-winter"
        ? (() => {
          const day = l === "surface-temp-summer" ? "summer" : "winter", h = lensHourRef.current[day] ?? peakHourOf(outcome, day);
          return new Map([...(outcome.designSurfaceTemps?.[day] ?? new Map<string, number[]>())].map(([k, a]) => [k, a[h - 1] ?? NaN] as const));
        })()
        : l === "window-net" ? outcome.windowNet : outcome.surfaceConduction,
      // the zones' design-day peaks (the engine's zone sizing), for the peak lenses and every legend (2026-10-08)
      peaks: new Map([...outcome.loads.zones].map(([k, z]) => [k.toUpperCase(), { heatW: z.designHeatingW, coolW: z.designCoolingW }] as const)),
    };
    const { colorOf, legend: lg } = paintRows(idfRowsRef.current, outcome.surfaces, values, l, outcome.report?.northAxisDeg ?? 0);
    lensRef.current = colorOf; setLegend(lg); applyHidden();
  }, [applyHidden]);
  // RUN's model shows the surface temperatures (2026-10-12): whenever it is the view, a lens of another kind becomes the winter design day's
  useEffect(() => {
    if (module === "bem" && tab === "bem-run" && runView === "model" && bem?.designSurfaceTemps && lens !== "surface-temp-winter" && lens !== "surface-temp-summer") applyLens("surface-temp-winter");
  }, [module, tab, runView, bem, lens, applyLens]);
  // THE APP'S RUN IS THE GATE'S RUN: the same core, from data/idf.db's bytes
  const runBem = useCallback(async () => {
    if (bemRunning) return;
    setBemRunning(true); setBemLog([]); setStatus("simulation running (EnergyPlus)…");
    const off = window.bem.onProgress((m) => setBemLog((l) => [...l.slice(-199), m.text]));
    try {
      const SQL = await getSql(wasmUrl);
      const out = await runBemPipeline(SQL, {
        ledger: bemLedgerRef.current, epw: null, zone: countyZoneRef.current, library: libRef.current, materialsSha256: materialsRef.current?.sha, schema: schemaRef.current, tariff: appliedTariff(),
        onProgress: (t) => setBemLog((l) => [...l.slice(-199), t]), readMeta, reportUnits: imperial ? "ip" : "si",
      });
      bemRef.current = out; setBem(out);
      bemModelRef.current = out; setBemModel(out);
      const links = checkChain({ ifc: dbRef.current ? readMeta(dbRef.current) : null, idf: idfMetaRef.current, bem: out.bemMeta, materials: materialsRef.current?.meta ?? null });
      chainRef.current = links; setChain(links);
      setStatus(`EnergyPlus ${out.run.completed ? "completed" : "did not complete"} · Fatal ${out.run.fatal} · Severe ${out.run.severe} · Warning ${out.run.warning} · heating ${out.facility.heatingKwh.toFixed(0)} · cooling ${out.facility.coolingKwh.toFixed(0)} kWh · run ${out.stamp}`);
      applyLens(lens === "none" ? "zone-heating" : lens, out);
      openSection("bem-results");
      const runMeters = [...new Set(out.daily.map((d) => d.name))];
      if (bomMeters.length === 0) setBomMeters(runMeters);
    } catch (e) {
      setStatus(`BEM run failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally { off(); setBemRunning(false); }
  }, [bemRunning, lens, applyLens, bomMeters, imperial]);
  // THE MODEL STORE and THE LEDGER'S ONE WRITER (2026-09-04): every BEM tab's
  // Apply goes through applyBemLedger, which saves data/bem/decisions/<sha>.json
  // and rebuilds bem.db from idf.db's bytes without a run
  // THE CLIMATE ZONE BY COUNTY (user, 2026-09-07): the two public tables, read once from
  // data/cache (fetched the first time), place the position in force in its county and
  // read the county's zone; the settings carry it as a dataset value beside the .ddy's word
  const countyRef = useRef<{ counties: CountyFeature[]; tableKey?: string; zones?: Map<string, CountyZone> } | null>(null);
  const countyZoneRef = useRef<CountyZoneRead | null>(null);
  const countyZoneFor = async (site: { latitude: number; longitude: number } | null): Promise<CountyZoneRead | null> => {
    if (!site) return null;
    if (!countyRef.current) {
      const c = await window.bem.fetchCached(COUNTIES_URL, COUNTIES_CACHE, null);
      if ("error" in c) return null;
      countyRef.current = { counties: parseCounties(c.text) };
    }
    // the zone is the user's reading of the county's row in the code's table, entered with the energy code (BEM › SITE) — or, when the
    // project's data sources name a county table (2026-11-12), the county's row of that table; a zone typed with the code still wins
    const typed = climateZoneOf(bemLedgerRef.current?.site?.energyCode);
    const cz = sourcesNow().climateZone;
    if (cz.mode === "county-table") {
      const key = cz.file ?? cz.url ?? "";
      if (countyRef.current.tableKey !== key) {
        const t = cz.file ? await window.bem.readHomeFile(cz.file) : await window.bem.fetchCached(cz.url!, `county-climate-zones-${sha256Hex(cz.url!).slice(0, 12)}.csv`, null).then((r) => ("text" in r ? r.text : null));
        countyRef.current = { ...countyRef.current, tableKey: key, zones: t ? parseCountyZones(t) : new Map() };
      }
      const read = climateZoneFromTable(site.latitude, site.longitude, countyRef.current.counties, countyRef.current.zones ?? new Map());
      return read && typed ? { ...read, zone: typed.trim().toUpperCase() } : read;
    }
    return climateZoneAt(site.latitude, site.longitude, countyRef.current.counties, typed);
  };
  /** MATERIALS.DB (2026-09-08): read from data/, rebuilt from its seeds when absent or when a seed moved — the DataSets' text, the catalogue
   *  fetched once at its pinned commit, the user's sidecar — saved, then READ BACK; the library carries its rows for every pick */
  const loadMaterials = async (datasets: Array<{ file: string; text: string }>): Promise<void> => {
    datasetTextsRef.current = datasets;
    try {
      const SQL = await getSql(wasmUrl);
      const cat = await window.bem.fetchCached(OSSTD_URL, OSSTD_CACHE, null);
      const osstdJson = "text" in cat ? cat.text : null;
      const side = await window.bem.readDataFile(MATERIALS_SIDECAR);
      const sidecar = readSidecar(side ? new TextDecoder().decode(side) : null);
      // THE USER'S REFERENCE LISTS (2026-09-16): the CSVs under references/materials, seeds like the DataSets; one absent is named, not fatal
      const reference: Array<{ file: string; text: string }> = [];
      const refMissing: string[] = [];
      for (const f of REFERENCE_FILES) { const t = await window.bem.readReference(`materials/${f}`); if (t) reference.push({ file: f, text: t }); else refMissing.push(f); }
      // and the lists the project's data sources name (2026-11-12), from the home folder, with the datasets they fill
      const src = sourcesNow();
      for (const f of src.referenceLists) { const t = await window.bem.readHomeFile(f); if (t) reference.push({ file: f.split("/").pop() ?? f, text: t }); else refMissing.push(f); }
      let manifest: ReferenceManifest | undefined;
      if (src.referenceManifest) { const t = await window.bem.readHomeFile(src.referenceManifest); try { manifest = t ? JSON.parse(t) as ReferenceManifest : undefined; } catch { refMissing.push(`${src.referenceManifest} (not JSON)`); } if (!t) refMissing.push(src.referenceManifest); }
      let user: MaterialRow[] = sidecar.rows;
      const bytes = await window.bem.readDataFile(MATERIALS_DB);
      let db = bytes ? openMaterialsDb(SQL, bytes) : null;
      // THE USER'S ROWS SURVIVE A LOST SIDECAR (2026-09-08): the previous materials.db carries every saved row; any the
      // sidecar lacks — and the user did not remove — are carried forward and written back to it before the seeds are hashed
      if (db) {
        const merged = mergeUserRows(user, queryMaterials(db), sidecar.removed);
        if (merged.recovered.length) {
          user = merged.rows;
          await window.bim.saveDb(MATERIALS_SIDECAR, new TextEncoder().encode(writeSidecar({ rows: user, removed: sidecar.removed, fenestration: sidecar.fenestration ?? [] })));
          setStatus(`materials: ${merged.recovered.length} saved row${merged.recovered.length > 1 ? "s" : ""} carried forward from materials.db into ${MATERIALS_SIDECAR} — ${merged.recovered.map((r) => r.name).join(", ")}`);
        }
      }
      const seeds = { datasets: datasets.filter((d) => /^ASHRAE_2005_HOF|^Composite|^WindowConstructs/.test(d.file)), osstdJson, user, reference, userFen: sidecar.fenestration ?? [], ...(manifest ? { manifest } : {}) };
      const want = seedSha(seeds);
      let census = db ? "read from data/materials.db" : "";
      if (!db || readMaterialsMeta(db).get("seed_sha256") !== want) {
        db?.close();
        const built = buildMaterialsDb(SQL, seeds);
        census = formatMaterialsCensus(built.census);
        const out = built.db.export();
        built.db.close();
        await window.bim.saveDb(MATERIALS_DB, out);
        db = openMaterialsDb(SQL, out);
        if (!db) throw new Error("materials.db did not read back");
      }
      const meta = readMaterialsMeta(db);
      const rows = queryMaterials(db);
      const products = queryFenestration(db);
      const sources = querySources(db);   // the palette's Source and dataset filters read the db's own classes (2026-09-17)
      db.close();
      materialsRef.current = { rows, products, sources, sha: meta.get("content_sha256") ?? "", meta, version: (materialsRef.current?.version ?? 0) + 1, census: `${rows.length} materials · ${products.length} fenestration rows · ${census}${"error" in cat ? ` · catalogue: ${cat.error}` : ""}${refMissing.length ? ` · reference lists missing: ${refMissing.join(", ")}` : ""}` };
      if (libRef.current) libRef.current = withMaterials(libRef.current, rows);
      setMaterialsCensus(materialsRef.current.census);
      setMaterialsVersion(materialsRef.current.version);
    } catch (e) { setMaterialsCensus(`materials.db: ${e instanceof Error ? e.message : String(e)}`); }
  };
  const loadMaterialsRef = useRef(loadMaterials); loadMaterialsRef.current = loadMaterials;
  /** A SAVE: the row goes into the sidecar (replayable, diffable), materials.db is rebuilt from its seeds + the sidecar and read back */
  const saveMaterial = (row: MaterialRow): Promise<void> => saveMaterials([row]);
  /** several rows in ONE save and one rebuild (the custom edits of an Apply, 2026-09-29) */
  const saveMaterials = async (rows: MaterialRow[]): Promise<void> => {
    const side = await window.bem.readDataFile(MATERIALS_SIDECAR);
    const sc = readSidecar(side ? new TextDecoder().decode(side) : null);
    const keys = new Set(rows.map((r) => r.key)), at = new Date().toISOString();
    const next = [...sc.rows.filter((r) => !keys.has(r.key)), ...rows.map((r) => ({ ...r, addedAt: r.addedAt || at }))];
    await window.bim.saveDb(MATERIALS_SIDECAR, new TextEncoder().encode(writeSidecar({ rows: next, removed: sc.removed.filter((k) => !keys.has(k)), fenestration: sc.fenestration ?? [] })));
    await loadMaterialsRef.current(datasetTextsRef.current);
  };
  /** THE IN-APP BROWSER (user, 2026-09-16): a window beside the app on BCL's site search for the layer's material — the numbers come back through the dialog */
  const openBrowser = async (q: string, where: "bcl" | "general" = "bcl"): Promise<void> => {
    const r = await window.bem.openBrowser(where === "general" ? searchUrl(BROWSE_URLS.general, q) : searchUrl(BROWSE_URLS.bcl, searchQueryFor(q)));
    setStatus("error" in r ? `browser: ${r.error}` : where === "general" ? `browser: a web search for "${q}" — the numbers come back through New, with the page as the source` : `browser: BCL's site on "${searchQueryFor(q)}" — the numbers come back through New, with the page as the source`);
  };
  /** A FENESTRATION ROW OF YOURS (2026-09-17): typed in the dialog → the sidecar → materials.db's fenestration table,
   *  and the type TAKES it at once as a U ruling carrying the row (the same shape a Marvin rating's pick writes) */
  const saveFenestration = async (st: FenDialogState, uWm2k: number | null): Promise<string | null> => {
    const { row, why } = handFenestration({ name: st.name, section: st.section, group: st.group || null, uWm2k, shgc: st.shgc, vt: st.vt, sourceName: st.sourceName, sourceUrl: st.sourceUrl });
    if (!row) return why;
    const side = await window.bem.readDataFile(MATERIALS_SIDECAR);
    const sc = readSidecar(side ? new TextDecoder().decode(side) : null);
    const gone = st.editFrom && st.editFrom !== row.key ? st.editFrom : null;   // an edit REPLACES the row it came from
    const next = [...(sc.fenestration ?? []).filter((g) => g.key !== row.key && g.key !== gone), row];
    await window.bim.saveDb(MATERIALS_SIDECAR, new TextEncoder().encode(writeSidecar({ ...sc, fenestration: next, removed: gone ? [...sc.removed.filter((k) => k !== gone), gone] : sc.removed })));
    await loadMaterialsRef.current(datasetTextsRef.current);
    stageCons(st.key, { source: "u", uWm2k: row.uWm2k, shgc: row.shgc, vt: row.vt ?? undefined, product: { key: row.key, name: row.name, source: "hand" } });
    setStatus(`fenestration: saved "${row.name}" as ${row.key}${st.editFrom && st.editFrom !== row.key ? ` (edited from ${st.editFrom}, which is gone)` : ""} · ${st.label} takes it — ${st.custom ? "staged: Apply in the column" : "Apply assembly in DETAIL"}`);
    setFenDialog(null);
    return null;
  };
  /** DELETE a fenestration row of yours, from the dialog's own button (2026-09-17): the sidecar's `removed` list
   *  remembers the key, so a rebuild never brings it back; a type that took it keeps the numbers as typed values */
  const deleteFenestration = async (key: string): Promise<void> => {
    const row = materialsRef.current?.products.find((g) => g.key === key);
    if (!row || row.sourceId !== "hand") return;
    if (!window.confirm(`Delete "${row.name}" (${key}) from the fenestration table?\n\nThe key is remembered in ${MATERIALS_SIDECAR}, so it is never carried back. A type that took it keeps its U, SHGC and VT as values of yours.`)) return;
    const side = await window.bem.readDataFile(MATERIALS_SIDECAR);
    const sc = readSidecar(side ? new TextDecoder().decode(side) : null);
    await window.bim.saveDb(MATERIALS_SIDECAR, new TextEncoder().encode(writeSidecar({ ...sc, fenestration: (sc.fenestration ?? []).filter((g) => g.key !== key), removed: [...sc.removed.filter((k) => k !== key), key] })));
    await loadMaterialsRef.current(datasetTextsRef.current);
    setStatus(`fenestration: deleted "${row.name}" (${key}) — remembered in the sidecar, never carried back`);
    setFenDialog(null);
  };
  const saveHand = async (h: HandInput): Promise<string | null> => {
    const { row, why } = handMaterial(h);
    if (!row) return why;
    await saveMaterial(row);
    const d = dialogRef.current, dr = detailRowRef.current;
    // A HAND SAVE PICKS (2026-09-16): the layer takes the new row at once — an edit did, a fresh row waited on a click — and the dialog closes
    if (d) pickForLayer(d.seq, row.key);
    setStatus(`materials: saved "${row.name}" as ${row.key}${d?.editFrom ? ` (edited from ${d.editFrom})` : ""}${d ? ` · picked for layer ${layerPos(d.seq)}${dr ? ` of ${dr.label}` : ""} — Apply assembly in DETAIL` : ""}`);
    setDialog(null);
    return null;
  };
  /** REMOVE a saved row by its key (2026-09-08): the sidecar's `removed` list remembers it, so the carry-forward never brings
   *  it back; a seed row (the datasets, the catalogue) cannot be removed. A layer that carried it reads "no material" */
  const removeMaterial = async (key: string): Promise<void> => {
    // a row of yours — a material, or (2026-09-17) a fenestration assembly you typed
    const row = materialsRef.current?.rows.find((r) => r.key === key) ?? materialsRef.current?.products.find((g) => g.key === key);
    if (!row || (row.sourceId !== "hand" && row.sourceId !== "bcl")) return;
    if (!window.confirm(`Remove "${row.name}" (${key}) from materials.db?\n\nThe key is remembered in ${MATERIALS_SIDECAR}, so it is never carried back; a layer that carries it reads "no material" until another is picked.`)) return;
    const side = await window.bem.readDataFile(MATERIALS_SIDECAR);
    const sc = readSidecar(side ? new TextDecoder().decode(side) : null);
    await window.bim.saveDb(MATERIALS_SIDECAR, new TextEncoder().encode(writeSidecar({ rows: sc.rows.filter((r) => r.key !== key), removed: [...sc.removed.filter((k) => k !== key), key], fenestration: (sc.fenestration ?? []).filter((g) => g.key !== key) })));
    await loadMaterialsRef.current(datasetTextsRef.current);
    setStatus(`materials: deleted "${row.name}" (${key}) — remembered in ${MATERIALS_SIDECAR}, never carried back`);
    setDialog(null);   // Delete lives in the edit dialog now (2026-09-17)
  };
  /** EDIT a saved material (user, 2026-09-08): the form prefilled with the row in the user's units; the save is a new row the layer takes */
  const editMaterial = (seq: number, row: MaterialRow): void => {
    setDialog({ seq, form: formFromRow(row, imperial ? "IP" : "SI"), editFrom: row.key, role: null, note: `editing "${row.name}" — ${row.sourceRef.slice(0, 80)}` });
  };
  /** a saved row onto a layer: the layer takes the row (staged; Apply assembly in DETAIL writes it) */
  const pickForLayer = (seq: number, key: string): void => {
    const row = detailRowRef.current;
    if (!row) return;
    const st = { seq };
    const cur = consStageRef.current[row.key];
    const stack = ruledStack(row.layers.filter((l) => !l.part), cur?.source === "layers" ? cur.layers : undefined);
    stageCons(row.key, withLayers(cur, stack.map((rl) => { const l = rl.pick; if (rl.seq !== st.seq) return l; const m = materialsRef.current?.rows.find((r) => r.key === key); const pk = m ? layerPickFor(m, rl.file?.thicknessM ?? null) : null; const { ref: _r, parts: _p, rSi: _s, thicknessM: _t, ...rest } = l; return { ...rest, ref: { key }, ...(pk?.thicknessM !== undefined ? { thicknessM: pk.thicknessM } : {}) }; })));
  };
  /** the layer's number from the outside as ruled — what every message names it by (2026-09-09) */
  const layerPos = (seq: number): string => { const row = detailRowRef.current; if (!row) return "?"; const cur = consStageRef.current[row.key]; return String(ruledStack(row.layers.filter((l) => !l.part), cur?.source === "layers" ? cur.layers : undefined).find((q) => q.seq === seq)?.position ?? "?"); };
  /** the thickness typed in the DETAIL list (2026-09-09): the layer's `thicknessM`, promoted to a layers ruling like a pick */
  const setLayerThickness = (seq: number, m: number | undefined): void => {
    const row = detailRowRef.current;
    if (!row) return;
    const st = consStageRef.current[row.key];
    const stack = ruledStack(row.layers.filter((l) => !l.part), st?.source === "layers" ? st.layers : undefined);
    stageCons(row.key, withLayers(st, stack.map((rl) => { if (rl.seq !== seq) return rl.pick; const { thicknessM: _t, ...rest } = rl.pick; return m === undefined ? rest : { ...rest, thicknessM: m }; })));
  };
  /** A CUSTOM EDIT (user, 2026-09-29: "Create a custom edit, which when selected allows field values to be edited in MVT"): a patch
   *  on the layer's draft — its name, R, reflectance — staged like any pick (promoted to a layers ruling); null drops the draft */
  const setLayerCustom = (seq: number, patch: LayerCustom | null): void => {
    const row = detailRowRef.current;
    if (!row) return;
    const st = consStageRef.current[row.key];
    const stack = ruledStack(row.layers.filter((l) => !l.part), st?.source === "layers" ? st.layers : undefined);
    stageCons(row.key, withLayers(st, stack.map((rl) => {
      if (rl.seq !== seq) return rl.pick;
      const { custom: c0, ...rest } = rl.pick;
      if (patch === null) return rest;
      return { ...rest, custom: Object.fromEntries(Object.entries({ ...(c0 ?? {}), ...patch }).filter(([, v]) => v !== undefined)) as LayerCustom };
    })));
  };
  /** THE LAYER OPERATIONS from the right-click menu (user, 2026-09-09: "right click on image or row in view should offer
   *  delete layer or add layer behind or add subitem"): every one a patch on the stack as ruled, staged like any pick */
  const layerOp = (op: "delete" | "restore" | "addInside" | "addOutside", seq: number): void => {
    const row = detailRowRef.current;
    if (!row) return;
    const st = consStageRef.current[row.key];
    const stack = ruledStack(row.layers.filter((l) => !l.part), st?.source === "layers" ? st.layers : undefined);
    const rl = stack.find((x) => x.seq === seq);
    if (!rl) return;
    let layers: LayerPick[] = stack.map((x) => x.pick);
    if (op === "delete") {
      if (rl.added) { const prev = rl.pick.after ?? null; layers = layers.filter((l) => l.seq !== seq).map((l) => (l.added && l.after === seq ? { ...l, after: prev } : l)); }
      else layers = layers.map((l) => (l.seq === seq ? { ...l, deleted: true as const } : l));
      if (layerSelRef.current === seq) setLayerSel(null);
    } else if (op === "restore") layers = layers.map((l) => { if (l.seq !== seq) return l; const { deleted: _d, ...rest } = l; return rest; });
    else {
      const nseq = nextAddedSeq(layers);
      const i = stack.findIndex((x) => x.seq === seq);
      const after = op === "addInside" ? seq : i > 0 ? stack[i - 1]!.seq : null;
      layers = [...layers, { seq: nseq, material: "new layer", added: true, after }];
      setLayerSel(nseq);
    }
    stageCons(row.key, withLayers(st, layers));
    setLayerMenu(null);
  };
  /** `commit` (an Apply): the applied rulings, the library objects they read and the weather go INTO idf.db, and the model is
   *  built from idf.db alone (2026-10-07); without it the model is built from what idf.db already holds */
  // BOM's Search… names the site's county (2026-10-16): read it when BOM is opened before any BEM build has
  useEffect(() => {
    if (module !== "bom" || countyZone) return;
    const loc = bemLedgerRef.current?.site?.location ?? runRef.current?.site ?? null;
    if (loc) void countyZoneFor(loc).then((z) => { if (z && !countyZoneRef.current) { countyZoneRef.current = z; setCountyZone(z); } });
  }, [module, countyZone, siteAddress]);   // eslint-disable-line react-hooks/exhaustive-deps
  const refreshBemModel = useCallback(async (commit = false) => {
    if (idfRowsRef.current.length === 0) return;
    setBemBusy(true);
    try {
      await energyCodesRead();
      const SQL = await getSql(wasmUrl);
      countyZoneRef.current = await countyZoneFor(bemLedgerRef.current?.site?.location ?? runRef.current?.site ?? null);
      setCountyZone(countyZoneRef.current);
      const out = await buildBemModel(SQL, { ledger: bemLedgerRef.current, commit, epw: null, readMeta, engineVersion: bemEngine?.version, zone: countyZoneRef.current, library: libRef.current, materialsSha256: materialsRef.current?.sha, schema: schemaRef.current, tariff: appliedTariff() });
      if (out.idfMeta) idfMetaRef.current = out.idfMeta;   // a commit restamped idf.db: the chain and the staleness test read the new sha
      bemModelRef.current = out; setBemModel(out);
      // built, but the code's values are incomplete: the tabs work, the run refuses — said where the user looks first
      if (out.report.codeGap) setStatus(`BEM model built — it cannot run yet: ${out.report.codeGap}`);
      else setStatus((s) => (s.startsWith("BEM model") ? "" : s));   // a gap said before, now filled
      const links = checkChain({ ifc: dbRef.current ? readMeta(dbRef.current) : null, idf: idfMetaRef.current, bem: out.bemMeta, materials: materialsRef.current?.meta ?? null });
      chainRef.current = links; setChain(links);
      // the last stored run, read back, so the loads paint the zone model on load
      if (!bemRef.current) { const last = await readLatestRun(SQL, out); if (last) { bemRef.current = last; setBem(last); } }
      if (bemRef.current) applyLens(lensChoiceRef.current === "none" ? "zone-heating" : lensChoiceRef.current, bemRef.current);
      else applyHidden();
    } catch (e) { setStatus(`BEM model: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBemBusy(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bemEngine, applyLens]);
  /** a Door type ruled glass or opaque from CONSTRUCTIONS (2026-10-01): the per-door ruling on every door of the type, once,
   *  then the model rebuilt so the row, the GlassDoor/Door kind and the Reference follow */
  const ruleDoorGlazing = useCallback(async (elementIds: number[], glazed: boolean | null) => {
    let n = 0;
    for (const id of elementIds) {
      const gid = elementIndexRef.current.get(id)?.globalId;
      if (!gid) continue;
      if (glazed === null) glazingRef.current.delete(gid); else glazingRef.current.set(gid, glazed);
      n++;
    }
    await applyGlazing();
    await refreshBemModel();
    setStatus(`${n} door${n === 1 ? "" : "s"} ${glazed === null ? "back to the file's word" : glazed ? "ruled glass" : "ruled opaque"}`);
  }, [applyGlazing, refreshBemModel]);
  const doorGlazingRuled = (elementIds: number[]): number => elementIds.filter((id) => { const g = elementIndexRef.current.get(id)?.globalId; return !!g && glazing.has(g); }).length;

  useEffect(() => {
    // BOM reads the model too (2026-10-23: opened straight from BIM, BOM showed "no run yet" and no meters — the model, its meters
    // and the last run were read only when BEM was opened)
    if (module !== "bem" && module !== "bom") return;
    const sha = idfMetaRef.current?.get("content_sha256") ?? "";
    const msha = materialsRef.current?.sha ?? "";
    if (!bemModelRef.current || bemModelRef.current.sourceIdfSha !== sha || (bemModelRef.current.bemMeta.get("source_materials_sha256") ?? "") !== msha) void refreshBemModel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [module, tab, idfInfo]);
  /** a pending stage write (the 400 ms debounce below), cancelled by an Apply: measured 2026-09-09, a write that fired
   *  after an Apply put the ledger it had captured BEFORE the click back on disk, the applied rulings gone with it */
  const stageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** THE GAINS STAGE (2026-09-13): the ZONES frame's rulings by zone and by room, retained like every other tab's */
  const [gainStage, setGainStage] = useState<GainRulings>({});
  const gainStageRef = useRef(gainStage); gainStageRef.current = gainStage;
  const [zoneFrameTab, setZoneFrameTab] = useState<FrameTab>(() => { const v = window.localStorage.getItem("bim-zone-frame"); return (FRAME_TABS as string[]).includes(v ?? "") ? (v as FrameTab) : "OCCUPANCY"; });
  const zoneFrameTabRef = useRef(zoneFrameTab); zoneFrameTabRef.current = zoneFrameTab;
  useEffect(() => { window.localStorage.setItem("bim-zone-frame", zoneFrameTab); }, [zoneFrameTab]);
  const applyBemLedger = useCallback(async (next: BemLedger, applied: Array<"constructions" | "ground" | "site" | "schedules" | "holidays" | "systems" | "gains"> = []) => {
    if (stageTimerRef.current) { clearTimeout(stageTimerRef.current); stageTimerRef.current = null; }
    // ONLY the applied tab's stage is done with (2026-09-10: an Apply on any tab had deleted every tab's draft); the other
    // tabs' drafts stay staged — taken from the journal, the newest copy of every tab
    const sha = shaRef.current;
    const j = readJournal(window.localStorage, sha);
    const staged: Staged = { ...(j ?? next.staged ?? {}), at: new Date().toISOString() };
    for (const k of applied) delete staged[k];
    const led: BemLedger = { ...next, sourceIfcSha256: sha, savedAt: new Date().toISOString() };
    if (!stagedEmpty(staged)) led.staged = staged; else delete led.staged;
    writeJournal(window.localStorage, sha, led.staged ?? null); lastJournalRef.current = stagedContent(led.staged);
    bemLedgerRef.current = led; setBemLedger(led);
    savedStagedRef.current = led.staged ?? null;
    setBemEpw(led.weather?.epw ?? null);
    await window.bem.saveDecisions(sha, led);
    setDraftNote(led.staged ? { at: led.staged.at } : null);
    await refreshBemModel(true);
  }, [refreshBemModel]);
  // THE PROJECT'S DATA SOURCES SAVED (2026-11-12): into the project's project.sqlite; the page reloads, so every loader reads the new
  // record (the drafts on the tabs are kept: the stage is on disk and in the journal)
  const saveSources = async (next: ProjectSources | null): Promise<void> => {
    if (!window.projectNow) { setStatus("open a project first — its data sources are kept with it"); return; }
    await window.projectFolder.setSources(next ?? STANDARD_SOURCES);
    window.location.reload();
  };
  // THE STAGE IS RETAINED (2026-09-09). What waits on an Apply button — the
  // CONSTRUCTIONS rulings, the ground method, the SITE settings — lived only in
  // the process, and a restart lost the user's evening ("the idf db changes
  // were not retained"). It is now written to the ledger as `staged`, as it is
  // staged, and comes back on the next load; the ref alone is updated (the
  // state would re-seed the stage from itself). The zone stage goes the same
  // way through the corrections ledger.
  // THE SHEET IS NEVER LOST (2026-09-10). The stages belong to the file they were seeded from (stageShaRef); every change
  // goes to the JOURNAL first — browser storage, synchronous, keyed by the sha — then, 400 ms later, to the ledger file, the
  // stage being the newest word on `staged` and the current ref the word on what is applied. A load moving the file under
  // the timer only defers the disk write: the load's end (loadGen) re-runs this effect, and the load's own seed takes the
  // journal when it is newer than the disk. The ref moves only when the write is CONFIRMED; a rejected write is named in
  // the SYSTEMS column and retried on the next change.
  useEffect(() => {
    if (!shaRef.current || !runRef.current || stageShaRef.current !== shaRef.current) return;
    const sha = shaRef.current;
    const led = bemLedgerRef.current ?? { sourceIfcSha256: sha, savedAt: "", zones: {}, constructions: {} };
    const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    const want: Staged = { at: new Date().toISOString() };
    if (!same(consStage, led.constructions ?? {})) want.constructions = consStage;
    if (!same(consGround, led.ground)) want.ground = consGround;
    if (siteStage && !same(siteStage, led.site ?? EMPTY_SITE)) want.site = siteStage;
    if (!same(schedStage, led.schedules ?? {})) want.schedules = schedStage;
    if (!same(holStage, appliedHolidays(led))) want.holidays = holStage;
    if (!same(sysStage, led.systems ?? {})) want.systems = sysStage;
    if (!same(gainStage, led.gains ?? {})) want.gains = gainStage;
    const content = stagedContent(want);
    if (content !== lastJournalRef.current) { writeJournal(window.localStorage, sha, stagedEmpty(want) ? null : want); lastJournalRef.current = content; }
    if (savedStagedRef.current !== undefined && stagedContent(savedStagedRef.current) === content) return;   // on disk already, confirmed
    const t = setTimeout(() => {
      stageTimerRef.current = null;
      if (shaRef.current !== sha || loadingRef.current) return;   // the file moved, or a load is on: its end re-runs this effect
      const next: BemLedger = { ...(bemLedgerRef.current ?? led) };
      if (stagedEmpty(want)) delete next.staged; else next.staged = want;
      window.bem.saveDecisions(sha, next).then(() => {
        if (shaRef.current !== sha) return;
        bemLedgerRef.current = next; savedStagedRef.current = next.staged ?? null;
        setDraftNote(next.staged ? { at: want.at } : null);
      }, (e: unknown) => setDraftNote({ at: want.at, error: e instanceof Error ? e.message : String(e) }));
    }, 400);
    stageTimerRef.current = t;
    return () => { clearTimeout(t); if (stageTimerRef.current === t) stageTimerRef.current = null; };
  }, [consStage, consGround, siteStage, schedStage, holStage, sysStage, gainStage, loadGen]);
  // the last word on a reload or a quit: a pending write goes to disk synchronously from the journal
  useEffect(() => {
    const flush = (): void => {
      const sha = shaRef.current;
      if (!sha || !stageTimerRef.current) return;
      clearTimeout(stageTimerRef.current); stageTimerRef.current = null;
      const j = readJournal(window.localStorage, sha);
      const next: BemLedger = { ...(bemLedgerRef.current ?? { sourceIfcSha256: sha, savedAt: "", zones: {}, constructions: {} }) };
      if (j && !stagedEmpty(j)) next.staged = j; else delete next.staged;
      window.bem.saveDecisionsSync(sha, next);
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);
  useEffect(() => {
    if (loadingRef.current || !shaRef.current || !runRef.current) return;
    const t = setTimeout(() => { void window.bim.saveCorrections(shaRef.current, ledgerJson(shaRef.current)); }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneStage]);
  const ledgerOf = (): BemLedger => bemLedgerRef.current ?? { sourceIfcSha256: shaRef.current, savedAt: "", zones: {}, constructions: {} };
  /** the MECHANICAL assembly as staged, what it compiles to, and the zones it can name (2026-09-10) */
  const asm: Assembly = sysStage.assembly ?? { nodes: [], edges: [] };
  const asmZoneNames = useMemo(() => bemModel?.input.zones.map((z) => z.name) ?? [], [bemModel]);
  const asmConditioned = useMemo(() => bemModel?.report.model.conditionedZones ?? [], [bemModel]);

  // once the model exists the sheet is compiled against its zones — a seed never does that (2026-09-10)
  useEffect(() => { if (!bemModel) return; const zn = bemModel.input.zones.map((z) => z.name); setSysStage((st) => (st.assembly ? stageAssembly(st, st.assembly, zn, st.assign) : st)); }, [bemModel]);
  const asmAssign: ZoneAssign = sysStage.assign ?? {};
  const asmCompiled = useMemo(() => compileAssembly(asm, asmZoneNames, asmAssign), [asm, asmZoneNames, asmAssign]);
  /** THE STRUCTURES (2026-10-11): each card on the sheet that is written as one or more units — the house's heat pump split into a unit per
   *  thermostat zone, the ADU's own — by the name the card carries; RUN sums each one's units at the instant they peak together */
  const runStructures = useMemo(() => asm.nodes.flatMap((n) => {
    const units = (asmCompiled.splitIds[n.id] ?? (asmCompiled.rulingIds[n.id] ? [asmCompiled.rulingIds[n.id]!] : [])).filter((u) => asmCompiled.hvac.some((h) => h.id === u));
    // the card's OWN units only (2026-10-12): a card wired into a unit (an ERV core on the heat pump) is mapped to that unit's first id — it is
    // not a structure, and had been counted as one (ERV-H repeating HP-HOUSE Basement's coils, ERV-A HP-ADU's). A unit is the card's own when
    // it is named for it — the card's name, or the card's name and a zone
    const own = (n.ident || n.label || n.id).trim();
    if (!units.some((u) => u === own || u.startsWith(`${own} `))) return [];
    // the zones each unit serves: a template's coils are named by the engine for the zone, and found by it (2026-10-23)
    return units.length ? [{ name: own, units, unitZones: Object.fromEntries(units.map((u) => [u, asmCompiled.hvac.find((h) => h.id === u)?.zones ?? []])) }] : [];
  }), [asm, asmCompiled]);
  const asmQa = useMemo(() => qaRowsByNode(asmCompiled, bemModel), [asmCompiled, bemModel]);
  // ── SYSTEMS › ELECTRICAL, THE SHEET (user, 2026-10-02: "assembled like the mechanical systems"): staged as systems.generation.assembly
  const elecCatalogue = useMemo(() => readElecCatalogue(catalogue ? schemaRef.current : null), [catalogue]);
  // a saved sheet's old card words read as today's (2026-10-23: "Load centre", "Utility — net metering"), on both sides of the diff
  const elecAsm: Assembly = useMemo(() => withTodaysLabels(sysStage.generation?.assembly ?? { nodes: [], edges: [] }), [sysStage.generation?.assembly]);
  const pvPanels = useMemo(() => readPanels(bemModel?.input.siteElements ?? []).panels, [bemModel]);
  // a panel the projection left inside a room is named so on its card (2026-11-03), as the model build names it
  const pvInRoom = useMemo(() => new Map((bemModel?.input.mep?.elements ?? []).filter((e) => e.interior && isPvPanel(e.name)).map((e) => [e.expressId, e.room ?? "a room"] as const)), [bemModel]);
  const elecCompiled = useMemo(() => compileElectrical(elecAsm, new Set(pvPanels.map((q) => q.expressId)), pvInRoom), [elecAsm, pvPanels, pvInRoom]);
  const elecPending = diagramDiff({ assembly: elecAsm }, { assembly: withTodaysLabels(bemLedger?.systems?.generation?.assembly) }).pending;
  // ── SYSTEMS › PLUMBING, THE SHEET (user, 2026-10-02): staged as systems.dhw.assembly, the rooms the model's own (a room → its zone)
  const plumbCatalogue = useMemo(() => readPlumbCatalogue(catalogue ? schemaRef.current : null), [catalogue]);
  const plumbAsm: Assembly = sysStage.dhw?.assembly ?? { nodes: [], edges: [] };
  // THE ROOMS THE PLUMBING NAMES (2026-10-06, the user: "the listing of zones is wrong to list attics and interstitial spaces, and is
  // missing the Bed1 and Hall baths"): the model's own rooms as written — each in YOUR zone (ZONES), conditioned as the zone is — and
  // never a void (an attic or a floor cavity: no floor of its own). It read the geometry's spaces before, which knew no zones of yours
  const plumbRooms = useMemo((): PlumbRoom[] => (bemModel?.rooms ?? [])
    .filter((r) => r.floorM2 > 0 && !/^(attic|interstitial)\b/i.test(r.room))
    .map((r) => ({ room: r.room, zone: r.zone, conditioned: r.conditioned }))
    .sort((a, b) => a.zone.localeCompare(b.zone) || a.room.localeCompare(b.room)), [bemModel]);
  // the code edition the use is counted under: the model's own code and zone, as the writer reads them
  const plumbEdition = useMemo(() => { const m = bemModel?.built.model; if (!m) return undefined; const e = ieccFor(m.climateZone, m.energyCode).edition; return e.base || e.id; }, [bemModel]);
  const plumbOccupants = bemModel?.built.model.gains?.nocc ?? null;
  // the bedrooms as APPLIED on ZONES (2026-10-07) — what the model counts
  const appliedBedroomMarks = useMemo(() => bedroomMarksOf(bemLedger?.gains), [bemLedger]);
  const plumbCompiled = useMemo(() => compilePlumbing(plumbAsm, plumbRooms.map((r) => r.room), plumbEdition, plumbOccupants ?? undefined, appliedBedroomMarks), [plumbAsm, plumbRooms, plumbEdition, plumbOccupants, appliedBedroomMarks]);
  // the sheet's water heaters, listed under Domestic Hot Water in the column: saved when the saved sheet holds the same component
  const plumbItems = useMemo((): SheetItem[] => {
    const savedNodes = bemLedger?.systems?.dhw?.assembly?.nodes ?? [];
    const heaterCls = new Set<string>([PLUMB_CLASS.hpwh, PLUMB_CLASS.electric, PLUMB_CLASS.gas]);
    // the heaters under Domestic Hot Water, the well pumps under Domestic Water (the user, 2026-10-05)
    return plumbAsm.nodes.filter((n) => n.kind === "component" && (heaterCls.has(n.cls ?? "") || n.cls === PLUMB_CLASS.well)).map((n) => {
      const was = savedNodes.find((x) => x.id === n.id);
      const { x: _x, y: _y, ...a } = n, b = was ? (({ x: _a, y: _b, ...r }) => r)(was) : null;
      return { section: n.cls === PLUMB_CLASS.well ? "water" as const : "dhw" as const, node: n.id, name: n.ident?.trim() || n.label || plumbCatalogue.of(n.cls ?? "")?.label || n.id, kind: n.cls ?? "", room: n.rooms?.[0] ?? null,
        saved: !!b && JSON.stringify(a) === JSON.stringify(b), refused: plumbCompiled.refusals.filter((r) => r.node === n.id).map((r) => r.text).join("; ") || null };
    });
  }, [plumbAsm, bemLedger, plumbCompiled, plumbCatalogue]);
  const plumbPending = diagramDiff({ assembly: plumbAsm }, { assembly: bemLedger?.systems?.dhw?.assembly }).pending;
  const fileHeaters = useMemo(() => (bemModel?.input.mep?.elements ?? []).filter((e) => isFileWaterHeater(e.name)).map((e) => ({ name: e.name, room: e.room ?? null })), [bemModel]);
  const asmNotWritten = useMemo(() => refusedByNode(asmCompiled, bemModel?.systems ?? []), [asmCompiled, bemModel]);   // the "not written" mark (2026-09-15): the SAVED model's refusals per card
  /** the room → the Zone holding it on the sheet (user, 2026-09-10): the tree reads a held room in its zone's colour; a right-click un-assigns it */
  const roomHeld = useMemo(() => { const m = new Map<string, { id: string; name: string }>(); for (const z of asmCompiled.zones) for (const r of z.rooms) m.set(r, { id: z.id, name: z.name }); return m; }, [asmCompiled]);
  const roomHeldRef = useRef(roomHeld); roomHeldRef.current = roomHeld;
  // the ZONES paint follows the sheet (2026-09-13)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === "bem-zones") applyHidden(); }, [roomHeld]);
  const [roomMenu, setRoomMenu] = useState<{ x: number; y: number; room: string; zoneId: string; zoneName: string } | null>(null);
  useEffect(() => {
    if (!roomMenu) return;
    const down = (e: PointerEvent): void => { if (!(e.target instanceof Element && e.target.closest(".roomMenu"))) setRoomMenu(null); };
    const key = (e: KeyboardEvent): void => { if (e.key === "Escape") setRoomMenu(null); };
    document.addEventListener("pointerdown", down, true); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down, true); document.removeEventListener("keydown", key); };
  }, [roomMenu]);
  useEffect(() => {
    if (!voidDialog) return;
    const key = (e: KeyboardEvent): void => { if (e.key === "Escape") setVoidDialog(null); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [voidDialog]);
  /** RIGHT-CLICK A SPACE NAME TO ZOOM TO IT, a DOUBLE right-click to go back to the view before (user, 2026-10-02). The box is every
   *  cell that bounds the space, by its zone name or its own (a merged void), else the room's or the void's own solid */
  const viewStackRef = useRef<Array<ReturnType<IfcPane["getView"]>>>([]);
  const lastRightRef = useRef<{ name: string; t: number } | null>(null);
  const zoomToSpace = (name: string): void => {
    const pane = ifcPaneRef.current;
    if (!pane) return;
    const now = performance.now(), last = lastRightRef.current;
    if (last && last.name === name && now - last.t < 450) {
      // the second click of a double: drop the view the first click saved, and go back to the one before it
      lastRightRef.current = null;
      const first = viewStackRef.current.pop();
      const back = viewStackRef.current.pop() ?? first;
      if (back) pane.setView(back);
      setRoomMenu(null);
      return;
    }
    lastRightRef.current = { name, t: now };
    const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    const add = (v: ArrayLike<number>): void => { for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i]!, v[i]!); max[i] = Math.max(max[i]!, v[i]!); } };
    for (const r of idfRowsRef.current) if (r.space === name || r.spaceFacing === name || r.spaceIfc === name || r.spaceFacingIfc === name) for (const v of r.outer) add(v);
    if (min[0] === Infinity) {
      const sp = runRef.current?.spaces.find((x) => spaceName(x) === name);
      const at = (atticsRef.current?.attics ?? []).find((x) => x.name === name);
      for (const f of sp?.faces ?? at?.faces ?? []) for (const v of f.outer) add(v);
    }
    if (min[0] === Infinity) { setStatus(`${name}: no cells and no solid to zoom to`); return; }
    viewStackRef.current.push(pane.getView());
    if (viewStackRef.current.length > 20) viewStackRef.current.shift();
    pane.frame(min, max);
    selectSpaceName(name);
  };
  const roomNameProps = (room: string): { className: string; style?: React.CSSProperties; onContextMenu?: (e: React.MouseEvent) => void; held: { id: string; name: string } | null; via: string | null } => {
    // a void or room MERGED into another on ZONES takes the colour of the Zone that one is in (user, 2026-10-02: "Interstitial floor –
    // Great shows as greyed … should show its assigned zone color"); the un-assign menu stays with the room the sheet holds
    const direct = roomHeld.get(room) ?? null;
    const into = direct ? room : zoneResolver(zonesRef.current)(room);
    const via = into !== room ? into : null;
    const held = direct ?? (via ? roomHeld.get(via) ?? null : null);
    // a space MERGED into another (BIM › spaces "assign to") is struck through (user, 2026-11-11: "use strikethrough on space name
    // for spaces that are merged") — it is that space's air now, not a space of its own
    const style: React.CSSProperties | undefined = held || via ? { ...(held ? { color: zoneColor(held.id) } : {}), ...(via ? { textDecoration: "line-through" } : {}) } : undefined;
    return { held, via, className: (held ? " held" : "") + (cfdTab && cfdPicks.includes(room) ? " cfdPicked" : ""), style, onContextMenu: (e) => { e.preventDefault(); e.stopPropagation(); zoomToSpace(room); if (cfdTab) return; if (!held && !via && asmCompiled.zones.length && lastRightRef.current) setRoomMenu({ x: Math.min(e.clientX, window.innerWidth - 280), y: Math.min(e.clientY, window.innerHeight - 40 - 24 * asmCompiled.zones.length), room, zoneId: "", zoneName: "" }); else if (direct && held && lastRightRef.current) setRoomMenu({ x: Math.min(e.clientX, window.innerWidth - 280), y: Math.min(e.clientY, window.innerHeight - 120), room, zoneId: held.id, zoneName: held.name }); } };
  };
  /** A SPACE CLICKED IN THE LEFT COLUMN (2026-11-11, the user: "on the cfd tab, switching space selection to another space … needs
   *  to switch focus. If a cfd model doesn't exist for the selected space, then offer up a cfd setup"): on the CFD tab the room
   *  becomes the one shown — its results when cfd.db holds a run of it, else its setup. While Spaces are being picked, a click
   *  adds the space and a second click takes it out. */
  const clickSpaceName = (name: string): void => {
    if (!cfdTab) { selectSpaceName(name); return; }
    if (cfdSelecting && cfdPickMode === "spaces") { setCfdPicks((p) => (p.includes(name) ? p.filter((x) => x !== name) : [...p, name])); return; }
    selectSpaceName(name);
    if (cfdSelecting && cfdPickMode === "space") setCfdPicks([name]);
    cfdWantRef.current = name;
    closeCfdBatch();
    setCfdSpace(name); setCfdPick(null);
    const has = (["heating", "cooling"] as const).filter((pk) => cfdRuns.some((r) => r.space === name && r.peak === pk));
    if (has.length) { setCfdPeak(has.includes(cfdPeak) ? cfdPeak : has[0]!); setCfdView("results"); }
    else void openCfdDialog(name);
  };
  /** SELECT, PRESSED AGAIN: the space set up on its PROCESSORS subtab, or the spaces' run reviewed in the frame below the view */
  const pressCfdSelect = (): void => {
    if (!cfdSelecting) { setCfdSelecting(true); setCfdPicks([]); return; }
    setCfdSelecting(false);
    if (cfdPickMode === "space") {
      const sp = cfdPicks[0] ?? cfdSpace;
      if (!sp) return;
      cfdWantRef.current = sp; closeCfdBatch(); setCfdSetupTab("PROCESSORS");
      if (cfdSetupIn?.space === sp) setCfdView("setup"); else void openCfdDialog(sp);
    } else if (cfdPicks.length) void openCfdBatch(cfdPicks);
  };
  /** THE `?` ON A SPACE NAME (user, 2026-09-18: "I would place a '?' superscript flag on space names in the
   *  left space column, with tool tips explaining that the user should right click the ? to see a correction
   *  dialogue box"). The rows are idf.db's own void_qa; a space the user has ruled reads its answer instead. */
  const voidMark = (space: string): React.ReactNode => {
    const row = voidRows.find((r) => r.name === space);
    if (!row) return null;
    const ruled = voidRulings[row.name];
    const open = (e: React.MouseEvent): void => {
      e.preventDefault(); e.stopPropagation();
      setVoidDialog({ row, answer: (ruled?.answer as VoidAnswer | undefined) ?? answersFor(row)[0]!, grille: ruled?.grille ?? false });
    };
    return (
      <sup className={`qFlag${ruled ? " ruled" : ""}`} onContextMenu={open} onClick={open}
        title={`${ruled ? `ruled: ${voidWord(row, ruled)}` : `this space needs a ruling — ${row.note}`}\n\nright-click the ${ruled ? "✓" : "?"} for the correction dialog`}>
        {ruled ? "\u2713" : "?"}
      </sup>
    );
  };
  const setAssembly = useCallback((a: Assembly, assign?: ZoneAssign): void => { const zn = bemModelRef.current?.input.zones.map((z) => z.name) ?? []; setSysStage((st) => stageAssembly(st, a, zn, assign)); }, []);
  /** the ZONES tab's word (user, 2026-09-10): a zone's system (one at most) and its exhaust fans, by the assembly's node ids */
  const setZoneAssign = useCallback((zone: string, ids: string[]): void => { const zn = bemModelRef.current?.input.zones.map((z) => z.name) ?? []; setSysStage((st) => { const a = { ...(st.assign ?? {}) }; if (ids.length) a[zone] = ids; else delete a[zone]; return stageAssembly(st, st.assembly ?? { nodes: [], edges: [] }, zn, a); }); }, []);

  const applySite = (site: SiteRuling): void => { void applyBemLedger({ ...ledgerOf(), site }, ["site"]); };
  /** the SCHEDULES tab's rulings (2026-09-09): per role, the engine's own schedule the model runs on */
  const applySchedules = (schedules: Partial<Record<ScheduleRole, ScheduleRef>>): void => {
    const prev = ledgerOf();
    const led = { ...prev, schedules } as BemLedger;
    // the project's holiday list; the retired day parts end here (their picks were named while they stood)
    led.holidays = holStage; delete led.scheduleDays;
    // THE PROJECT'S COPIES (the user, 2026-10-05: "the project database must save the schedules for the project"): every
    // ruling naming one of your schedules keeps its text — the copy already kept, unless re-saved this session
    const copies: Record<string, string> = {};
    for (const ref of Object.values(schedules)) {
      if (!ref || ref.file !== USER_SCHEDULE_FILE) continue;
      const lc = ref.name.toLowerCase();
      const t = copyStage[lc] ?? prev.scheduleCopies?.[lc] ?? (libRef.current ? copyTextOf(libRef.current, ref.name) : null);
      if (t) copies[lc] = t;
    }
    if (Object.keys(copies).length) led.scheduleCopies = copies; else delete led.scheduleCopies;
    setCopyStage({});
    void applyBemLedger(led, ["schedules", "holidays"]);
  };
  /** the SYSTEMS tab's rulings (2026-09-10): per subsection, the engine's own objects the model runs on; an empty ruling leaves the key out */
  /** SAVE (user, 2026-09-10): the sheet — its components, connectors and the zones assigned in ZONES — into idf.db's system_*
   *  tables (stamped and written, so the model rebuilt next reads it) and into the BEM ledger keyed to the file */
  const saveSystemsDiagram = async (s: SystemsRuling): Promise<void> => {
    const bytes = await window.bem.readDataFile("idf.db");
    if (!bytes) return;
    const SQL = await getSql(wasmUrl);
    const idfDb = new SQL.Database(bytes);
    const rows = diagramRows(s.assembly ?? { nodes: [], edges: [] }, s.assign ?? {});
    writeSystemsDiagram(idfDb, rows);
    stampIdfContentSha(idfDb);
    idfMetaRef.current = readMeta(idfDb);
    const links = checkChain({ ifc: dbRef.current ? readMeta(dbRef.current) : null, idf: idfMetaRef.current, bem: bemRef.current?.bemMeta ?? null, materials: materialsRef.current?.meta ?? null });
    chainRef.current = links; setChain(links);
    await window.bim.saveDb("idf.db", idfDb.export());
    idfDb.close();
    savedDiagramRef.current = { components: rows.components.length, connectors: rows.connectors.length, zones: rows.zones.length, at: new Date().toISOString() };
  };
  const applySystems = async (systems: SystemsRuling): Promise<void> => {
    const next: BemLedger = { ...ledgerOf() };
    // the sheet's Save never overwrites ELECTRICAL › Generation (2026-10-02): that ruling is applied on its own, so the applied one stands
    const gen = next.systems?.generation, dhwApplied = next.systems?.dhw;
    systems = { ...systems }; if (gen) systems.generation = gen; else delete systems.generation;
    // nor PLUMBING's (2026-10-02): its sheet is saved on its own
    if (dhwApplied) systems.dhw = dhwApplied; else delete systems.dhw;
    if (Object.keys(systems).length) next.systems = systems; else delete next.systems;
    await saveSystemsDiagram(systems);
    await applyBemLedger(next, ["systems"]);
  };
  /** ELECTRICAL › GENERATION (2026-10-02): applied on its own; the sheet's draft takes it too, so the sheet reads no change for it */
  const applyGeneration = async (g: GenerationRuling): Promise<void> => {
    const next: BemLedger = { ...ledgerOf() };
    const sys: SystemsRuling = { ...(next.systems ?? {}) };
    if (g.assembly || g.pv || g.storage || g.generator) sys.generation = g; else delete sys.generation;
    if (Object.keys(sys).length) next.systems = sys; else delete next.systems;
    setSysStage((st) => { const n = { ...st }; if (sys.generation) n.generation = sys.generation; else delete n.generation; return n; });
    await applyBemLedger(next, []);
  };
  /** A SIDE LEFT OFF, APPROVED (user, 2026-11-03): saved at once with the project (no Apply), the model rebuilt so its checks read it */
  const approveSide = async (zone: string, side: ZoneSide, on: boolean): Promise<void> => {
    const next: BemLedger = { ...ledgerOf() };
    const all = { ...(next.sideApprovals ?? {}) }, z = { ...(all[zone] ?? {}) };
    if (on) z[side] = new Date().toISOString(); else delete z[side];
    if (Object.keys(z).length) all[zone] = z; else delete all[zone];
    if (Object.keys(all).length) next.sideApprovals = all; else delete next.sideApprovals;
    setStatus(on ? `${zone} approved to run without ${side} — rebuilding the model` : `${zone}: the approval to run without ${side} taken back`);
    await applyBemLedger(next, []);
  };
  const setPlumbAssembly = useCallback((a: Assembly): void => { setSysStage((st) => ({ ...st, dhw: { ...(st.dhw ?? {}), assembly: a } })); }, []);
  /** the PLUMBING sheet's Save (2026-10-02): applied on its own, as the ELECTRICAL sheet's is — the sheet governs the water heaters */
  const savePlumbing = async (): Promise<void> => {
    const next: BemLedger = { ...ledgerOf() };
    const sys: SystemsRuling = { ...(next.systems ?? {}) };
    const d = { ...(sys.dhw ?? {}) }; if (plumbAsm.nodes.length) d.assembly = plumbAsm; else delete d.assembly;
    if (Object.keys(d).length) sys.dhw = d; else delete sys.dhw;
    if (Object.keys(sys).length) next.systems = sys; else delete next.systems;
    setSysStage((st) => { const n = { ...st }; if (sys.dhw) n.dhw = sys.dhw; else delete n.dhw; return n; });
    await applyBemLedger(next, []);
  };
  const setElecAssembly = useCallback((a: Assembly): void => { setSysStage((st) => ({ ...st, generation: { ...(st.generation ?? {}), assembly: a } })); }, []);
  /** the ELECTRICAL sheet's Save: the sheet governs the PV (the form it replaced is dropped); an empty sheet writes no PV */
  const saveElectrical = (): void => { const g: GenerationRuling = { ...(bemLedger?.systems?.generation ?? {}) }; delete g.pv; if (elecAsm.nodes.length) g.assembly = elecAsm; else delete g.assembly; void applyGeneration(g); };
  /** a previous version of the sheet, from the ledger's history, STAGED (Save then writes it) */
  const restoreSystems = (s: SystemsRuling): void => { setSysStage(sanitizeStage(s)); };
  /** the ZONES frame's gain rulings (2026-09-13), by zone and by room — applied like every other tab's, the stage stripped */
  const applyGains = async (g: GainRulings): Promise<void> => { const next: BemLedger = { ...ledgerOf() }; if (gainRulingCount(g)) next.gains = g; else delete next.gains; await applyBemLedger(next, ["gains"]); };
  /** A BEDROOM TICKED ON ZONES (2026-10-07), staged with the gains: a tick that agrees with the room's name is no ruling */
  const tickBedroom = (room: string, on: boolean): void => setGainStage((g) => {
    const rooms = { ...(g.rooms ?? {}) };
    const { bedroom: _b, ...rest } = rooms[room] ?? {};
    const next = on === bedroomByName(room) ? rest : { ...rest, bedroom: on };
    if (Object.keys(next).length) rooms[room] = next; else delete rooms[room];
    const out = { ...g }; if (Object.keys(rooms).length) out.rooms = rooms; else delete out.rooms;
    return out;
  });
  const gainPending = (() => { const a = bemLedger?.gains ?? {}; const n = (k: "rooms" | "zones"): number => Object.keys({ ...(gainStage[k] ?? {}), ...(a[k] ?? {}) }).filter((x) => JSON.stringify(gainStage[k]?.[x] ?? null) !== JSON.stringify(a[k]?.[x] ?? null)).length; return n("rooms") + n("zones") + (JSON.stringify(gainStage.transfers ?? []) !== JSON.stringify(a.transfers ?? []) ? 1 : 0); })();
  // RUN'S HONESTY (2026-09-15, the tab review): the model RUN describes is rebuilt from the APPLIED ledger, so what the
  // tabs hold STAGED is not in it — counted here in words for the RUN column, never left silent
  const runStaged = ((): Array<{ what: string; tab: TabId }> => {
    const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    const led = bemLedger;
    const parts: Array<{ what: string; tab: TabId }> = [];
    const nCons = [...new Set([...Object.keys(consStage), ...Object.keys(led?.constructions ?? {})])].filter((k) => !same(consStage[k], led?.constructions?.[k])).length;
    if (nCons) parts.push({ what: `${nCons} construction ruling${nCons > 1 ? "s" : ""}`, tab: "bem-constructions" });
    if (!same(consGround, led?.ground)) parts.push({ what: "the ground method", tab: "bem-constructions" });
    const siteKeys = ["designDays", "runPeriod", "groundTemp", "northAxisDeg", "timestep", "shadowCalculation", "terrain", "solarDistribution", "location"] as const;
    if (siteStage && siteKeys.some((k) => !same(siteStage[k], led?.site?.[k]))) parts.push({ what: "site settings", tab: "bem-site" });
    const nSched = [...new Set([...Object.keys(schedStage), ...Object.keys(led?.schedules ?? {})])].filter((r) => !same(schedStage[r as ScheduleRole], led?.schedules?.[r as ScheduleRole])).length;
    if (nSched) parts.push({ what: `${nSched} schedule${nSched > 1 ? "s" : ""}`, tab: "bem-schedules" });
    if (!same(holStage, appliedHolidays(led))) parts.push({ what: "the project's holidays", tab: "bem-schedules" });
    const sys = diagramDiff(sysStage, led?.systems).pending;
    if (sys) parts.push({ what: `the systems sheet (${sys} change${sys > 1 ? "s" : ""})`, tab: "bem-systems" });
    if (gainPending) parts.push({ what: `${gainPending} gain ruling${gainPending > 1 ? "s" : ""}`, tab: "bem-zones" });
    const nZ = Object.keys(zoneStage).length;
    if (nZ) parts.push({ what: `${nZ} zone ruling${nZ > 1 ? "s" : ""}`, tab: "bem-zones" });
    return parts;
  })();
  const runStagedNote = runStaged.length ? `staged on the tabs and NOT in this model: ${runStaged.map((x) => x.what).join(", ")} — Apply or Save there, then run` : null;
  // WHY THE RUN CANNOT GO (user, 2026-10-16: "pop up a dialog box stating that the run can't occur because …, which clears when the
  // issues are resolved"): each reason with the tab where it is resolved; a change staged and not applied is one — the run would not hold it
  const runBlocks: RunBlock[] = [
    ...(bemEngine === null ? [{ what: "EnergyPlus is not installed", how: "install it (see SETUP.md), then restart the program" }] : []),
    ...(idfRowsRef.current.length === 0 ? [{ what: "no envelope is built", how: "open an IFC file in BIM", tab: "bim-edit" as TabId }] : []),
    ...(bemModel?.report.codeGap ? [{ what: `the energy code's values are incomplete — ${bemModel.report.codeGap}`, how: "enter them in SITE › energy code › Choose… › Edit values…", tab: "bem-site" as TabId }] : []),
    ...runStaged.map((x) => ({ what: `${x.what} staged and not applied`, how: `Apply or Save it on ${TABS.find((t) => t.id === x.tab)?.label ?? x.tab}`, tab: x.tab })),
    // A SIDE LEFT OFF (user, 2026-11-03): each zone whose heating or cooling is switched off on its Zone card, naming its rooms,
    // until the side is switched on or approved here
    ...(bemModel?.checks ?? []).flatMap((c) => (c.rule === "zone-sides" && c.sides ? c.sides.off.filter((s) => !c.sides!.approved.includes(s)).map((side) => ({
      what: `${c.subject}: ${side} is switched off${c.sides!.rooms.length ? ` — ${c.sides!.rooms.join(", ")}` : ""}`,
      how: `switch it on in the Zone card's thermostat (SYSTEMS › MECHANICAL), or approve running ${c.subject} without ${side}`, tab: "bem-systems" as TabId,
      approve: { label: `approve: ${c.subject} runs without ${side}`, onApprove: () => void approveSide(c.subject, side, true) },
    })) : [])),
    // THE PV AS DRAWN (user, 2026-11-03): an array the ELECTRICAL sheet holds and the build cannot write — never a silent loss of the PV
    // (a card refused only because the card feeding it is — "(see the arrays)" — is in RUN › checks, not repeated here)
    ...(bemModel?.checks ?? []).filter((c) => c.rule === "pv-sheet" && c.verdict === "fail" && !/is refused \(see the /.test(c.text)).map((c) => ({
      what: `the PV is not written: ${c.text}`, how: "fix the array on SYSTEMS › ELECTRICAL (untick the panels), or the file's placement in BIM › Open IFC › Edit Alignment", tab: "bem-systems" as TabId })),
  ];
  // the box clears itself once nothing stands in the way
  useEffect(() => { if (runBlocked && runBlocks.length === 0) { setRunBlocked(false); setStatus("nothing stands in the way of the run — Run EnergyPlus when ready"); } }, [runBlocked, runBlocks.length]);
  /** the CONSTRUCTIONS tab's rulings (2026-09-08): what governs each type, keyed by the type's name */
  /** CUSTOM EDITS ARE SAVED ON APPLY (user, 2026-09-29: "When main view (MV) button is applied, any custom layer edits are saved"):
   *  every layer drafted in the DETAIL list becomes a material of yours — its pick the base, the typed name, R and reflectance over
   *  it (customLayerMaterial) — written to the sidecar in ONE save, and the layer takes the new row. A draft that cannot make a row
   *  stops the Apply and says which layer and why; the stage is updated to the saved picks so nothing reads as still staged */
  const materializeCustoms = async (cons: Record<string, ConstructionRuling>): Promise<Record<string, ConstructionRuling> | null> => {
    const rows: MaterialRow[] = [], why: string[] = [], out = { ...cons }, changed: string[] = [];
    const all = materialsRef.current?.rows ?? [];
    for (const [key, ru] of Object.entries(cons)) {
      if (ru.source !== "layers" || !ru.layers?.some((l) => l.custom)) continue;
      const tr = typeRowsRef.current.find((t) => t.key === key);
      const stack = ruledStack(tr ? tr.layers.filter((l) => !l.part) : [], ru.layers);
      const layers = stack.map((rl): LayerPick => {
        const l = rl.pick;
        if (!l.custom) return l;
        const { custom, ...rest } = l;
        if (rl.deleted) return rest;
        const ref = l.ref;
        const base = !ref ? null : "key" in ref ? all.find((m) => m.key === ref.key) ?? null : all.find((m) => m.name === ref.name) ?? null;
        const { row, why: w } = customLayerMaterial(base, l.thicknessM ?? rl.file?.thicknessM ?? null, custom, rl.file?.material ?? l.material);
        if (!row) { why.push(`layer ${rl.position ?? "?"} of ${ru.name ?? tr?.label ?? key}: ${w}`); return l; }
        rows.push(row);
        const { parts: _p, rSi: _s, library: _lb, ref: _r, ...keep } = rest;
        return { ...keep, ref: { key: row.key } };
      });
      out[key] = { ...ru, layers };
      changed.push(key);
    }
    if (why.length) { setStatus(`custom edit not saved — ${why.join(" · ")}`); return null; }
    if (rows.length) {
      await saveMaterials(rows);
      setConsStage((s) => { const n = { ...s }; for (const k of changed) if (n[k]) n[k] = out[k]!; return n; });
      setStatus(`saved ${rows.length} custom edit${rows.length > 1 ? "s" : ""} as your material${rows.length > 1 ? "s" : ""}: ${rows.map((r) => `"${r.name}" (${r.key})`).join(", ")}`);
    }
    return out;
  };
  const applyConstructions = (constructions: Record<string, ConstructionRuling>, ground?: GroundRuling): void => {
    void (async () => { const c = await materializeCustoms(constructions); if (c) void applyBemLedger({ ...ledgerOf(), constructions: c, ground }, ["constructions", "ground"]); })();
  };
  /** THE VIEW'S APPLY (user, 2026-09-16: "the Apply button in the View should apply the name change, layer add/delete, and push to the
   *  Constructions list in the right column"): this ONE type's staged ruling goes to the ledger — with its alias target when that is
   *  staged too, since an alias to an unruled target is refused — and the other types stay staged; the column's Apply still takes them all */
  const applyConstructionType = (key: string): void => { void applyConstructionTypeAsync(key); };
  const applyConstructionTypeAsync = async (key: string): Promise<void> => {
    const pending = consStageRef.current;
    const mine: Record<string, ConstructionRuling> = {};
    if (pending[key]) mine[key] = pending[key]!;
    if (pending[key]?.sameAs && pending[pending[key]!.sameAs!]) mine[pending[key]!.sameAs!] = pending[pending[key]!.sameAs!]!;
    const done = await materializeCustoms(mine);
    if (!done) return;
    const led = ledgerOf();
    const st = { ...consStageRef.current, ...done };
    const constructions = { ...(led.constructions ?? {}) };
    const cur = st[key];
    if (cur) constructions[key] = cur; else delete constructions[key];
    if (cur?.sameAs && st[cur.sameAs]) constructions[cur.sameAs] = st[cur.sameAs]!;
    void applyBemLedger({ ...led, constructions }, []);
  };
  const revertConstructionType = (key: string): void => stageCons(key, bemLedgerRef.current?.constructions?.[key]);
  const chooseEpw = (p: string | null): void => { const next: BemLedger = { ...ledgerOf() }; if (p) next.weather = { epw: p }; else delete next.weather; void applyBemLedger(next); };
  const pickEpw = useCallback(async () => {
    const p = await window.bem.pickEpw();
    if (p) chooseEpw(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const validateModel = async (): Promise<void> => {
    const m = bemModelRef.current;
    if (!m) return;
    if (m.report.codeGap) { setValidation(`not validated: ${m.report.codeGap}`); return; }
    setValidation("validating…");
    try {
      const r = await window.bem.validate(m.idf);
      const lines = r.err.split("\n");
      const severe = lines.filter((l) => /\*\* (Severe|Fatal)/.test(l)).length, warn = lines.filter((l) => /\*\* Warning/.test(l)).length;
      setValidation(r.ok ? `--convert-only: ok · ${severe} severe · ${warn} warnings` : `--convert-only FAILED: ${lines.filter((l) => /Severe|Fatal/.test(l)).slice(0, 3).join(" | ") || r.err.slice(-300)}`);
    } catch (e) { setValidation(`validate failed: ${e instanceof Error ? e.message : String(e)}`); }
  };
  /** a zone picked in the ZONES grid or the SYSTEMS canvas: the room named, its cells lit, the table read */
  const pickZone = (z: string | null): void => {
    setSelZone(z);
    // a drawn Zone with rooms (2026-09-13): every room lit in the model and the tree, the frame reading the zone; else the room named
    const drawn = z ? asmCompiled.zones.find((x) => x.name === z) : null;
    if (drawn && drawn.rooms.length) { setSelSpace(null); setSel(null); setSelRow(null); setSelSpaceName(null); setSelLevel(null); setHi(null); setTableSpace(drawn.rooms[0] ?? null); setSelRooms(drawn.rooms); }
    else if (z) selectSpaceName(z);
    else { setSelSpaceName(null); setSelRooms(null); }
  };
  // ── THE OPERATIONS MODEL: a bill is a file; the comparison is the gate's
  const epwPathFor = (): string | null => bemEpw ?? bemRef.current?.weather?.epw ?? null;
  const readEpwLine = useCallback(async () => {
    const p = await window.bem.resolveEpw(epwPathFor() ?? DEFAULT_EPW);
    const text = p ? await window.bem.readText(p) : null;
    setEpwLine(describeEpw(text ? readEpw(text) : null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bemEpw, bem]);
  useEffect(() => { if (module === "bom") void readEpwLine(); }, [module, readEpwLine]);
  /** BOM › UTILITY's Apply (2026-10-03): the card, its PCA and the period's month into the BOM ledger, then the BEM model rebuilt with
   *  the engine's UtilityCost objects — RUN says the model moved; a run prices the year */
  const applyTariff = (card: string, t: { pca?: { all?: number; byMonth?: Record<string, number> }; nemStartMonth: number } | null): void => {
    const base: BomLedger = bomLedgerRef.current ?? { sourceIfcSha256: shaRef.current, savedAt: "", imports: [], excluded: [], meterMap: {} };
    const next: BomLedger = { ...base, savedAt: new Date().toISOString() };
    if (t) next.tariff = { card, ...t, appliedAt: new Date().toISOString() }; else delete next.tariff;
    bomLedgerRef.current = next; setBomTariff(next.tariff);
    void window.bom.saveLedger(shaRef.current, next);
    setStatus(t ? `tariff ${card} applied — the model is rebuilt with it; Run on BEM › RUN to price the year` : "tariff removed — the run reports energy only");
    void refreshBemModel(true);   // the tariff is an IDF input: committed into idf.db with the rest of the model (2026-10-07)
  };
  const saveBomLedger = useCallback(() => {
    const ledger: BomLedger = {
      sourceIfcSha256: shaRef.current, savedAt: new Date().toISOString(),
      imports: bomImportsRef.current.map((i) => ({ sha256: i.sha256, name: i.name, kind: "bills" as const, columnMap: { ...i.columnMap } as unknown as Record<string, string | undefined>, rows: i.csv.rows.length })),
      excluded: [...bomExcludedRef.current], meterMap: {},
      ...(bomLedgerRef.current?.tariff ? { tariff: bomLedgerRef.current.tariff } : {}),
      ...(bomStatementsRef.current.bills.length || bomStatementsRef.current.at ? { statements: bomStatementsRef.current } : {}),
      ...(bomLedgerRef.current?.calibration ? { calibration: bomLedgerRef.current.calibration } : {}),
      ...(bomLedgerRef.current?.cfd ? { cfd: bomLedgerRef.current.cfd } : {}),
    };
    bomLedgerRef.current = ledger;
    void window.bom.saveLedger(shaRef.current, ledger);
  }, []);
  const recomputeBom = useCallback(async (imports: BomImport[] = bomImportsRef.current, meters: string[] = bomMeters) => {
    const b = bemRef.current;
    if (!b) { setStatus("run the BEM first — the bills are compared to its daily meters"); return; }
    setBomBusy(true);
    try {
      const SQL = await getSql(wasmUrl);
      const out = await runBomPipeline(SQL, {
        imports, statements: bomStatementsRef.current, excluded: bomExcludedRef.current, meters, daily: b.daily, runStamp: b.stamp,
        epwPath: epwPathFor(), bemMeta: b.bemMeta, readMeta,
      });
      bomRef.current = out; setBom(out); setEpwLine(out.epwLine);
      const links = checkChain({ ifc: dbRef.current ? readMeta(dbRef.current) : null, idf: idfMetaRef.current, bem: b.bemMeta, bom: out.bomMeta });
      chainRef.current = links; setChain(links);
      saveBomLedger();
      if (out.calibration) setStatus(`bills vs the run: CVRMSE ${out.calibration.cvrmsePct?.toFixed(2)} % · NMBE ${out.calibration.nmbePct?.toFixed(2)} % · ${out.calibration.verdict}`);
    } catch (e) { setStatus(`BOM failed: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBomBusy(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bomMeters, saveBomLedger]);
  // A ROOM'S CFD SETUP, kept in the BOM ledger (2026-11-10): written as it is typed, the save gathered over 800 ms so a typed
  // name is one ledger version, not one per key
  const cfdSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** the file whose BOM ledger is LOADED (2026-11-10): until it is, a CFD setup is held here and never saved — saving before the load
   *  built a fresh ledger and wrote it over the project's (measured in the test window: the tariff, the statements and the
   *  calibration gone, the CFD setup alone left) */
  const bomLedgerLoadedFor = useRef<string | null>(null);
  const cfdPending = useRef<Record<string, unknown>>({});
  useEffect(() => {
    setChoicesStore({
      get: (sp) => ((bomLedgerLoadedFor.current === shaRef.current ? bomLedgerRef.current?.cfd?.rooms?.[sp] : cfdPending.current[sp]) as never) ?? null,
      set: (sp, ch) => {
        if (!shaRef.current) return;
        if (bomLedgerLoadedFor.current !== shaRef.current) { cfdPending.current[sp] = ch; return; }
        const base: BomLedger = bomLedgerRef.current ?? { sourceIfcSha256: shaRef.current, savedAt: "", imports: [], excluded: [], meterMap: {} };
        bomLedgerRef.current = { ...base, cfd: { rooms: { ...(base.cfd?.rooms ?? {}), [sp]: ch } } };
        if (cfdSaveTimer.current) clearTimeout(cfdSaveTimer.current);
        cfdSaveTimer.current = setTimeout(() => { cfdSaveTimer.current = null; saveBomLedger(); }, 800);
      },
    });
    // a setup edit still waiting on the 800 ms gather is written when the window goes
    const flush = (): void => { if (cfdSaveTimer.current) { clearTimeout(cfdSaveTimer.current); cfdSaveTimer.current = null; saveBomLedger(); } };
    window.addEventListener("pagehide", flush);
    return () => { window.removeEventListener("pagehide", flush); flush(); setChoicesStore(null); };
  }, [saveBomLedger]);
  // THE CALIBRATION RUN'S INPUTS, kept in the BOM ledger: the PV connection date typed, the panels' export (its raw file under imports/)
  const setCalibration = useCallback((patch: NonNullable<BomLedger["calibration"]>) => {
    const base: BomLedger = bomLedgerRef.current ?? { sourceIfcSha256: shaRef.current, savedAt: "", imports: [], excluded: [], meterMap: {} };
    bomLedgerRef.current = { ...base, calibration: { ...base.calibration, ...patch } };
    saveBomLedger();
  }, [saveBomLedger]);
  const importPv = useCallback(async () => {
    const f = await window.bom.pickCsv();
    if (!f) return;
    const read = parsePvCsv(f.text);
    if ("error" in read) { setStatus(`PV production not read: ${read.error}`); return; }
    const sha = sha256Hex(f.text);
    await window.bom.saveImport(sha.slice(0, 12), "csv", f.text);
    setCalPv({ name: f.name, read });
    setCalibration({ pv: { sha256: sha, name: f.name } });
    setStatus(`PV production: ${read.days.length} days read from ${f.name} (${read.energyColumn})${read.problems.length ? ` · ${read.problems.length} rows not read` : ""}`);
  }, [setCalibration]);
  const calibrationView = async (r: { run: { stamp: string; epw: string | null; fatal: number; severe: number; warning: number; seconds: number; completed: boolean }; hourly: CalibrationRunView["hourly"] }): Promise<CalibrationRunView> => {
    const text = r.run.epw ? await window.bem.readText(r.run.epw) : null;
    const epw = text ? readEpw(text) : null;
    return { ...r.run, hourly: r.hourly, epwKind: epw?.kind ?? "unknown", epwComment: epw?.comment ?? "" };
  };
  // ownEpw: the user's own actual-year file (picked on the card) — for paid work, where Open-Meteo's free archive may not be used
  const runCalibrationYear = useCallback(async (span: { a: string; b: string }, ownEpw?: string) => {
    const site = bemLedgerRef.current?.site?.location ?? runRef.current?.site ?? null;
    if (!site) { setStatus("the file states no position — locate the site on BEM › SITE first"); return; }
    const end = span.b > latestEnd() ? latestEnd() : span.b;
    try {
      setCalBusy("the actual-year weather …");
      const w = ownEpw ? { epw: ownEpw } : await makeActualWeather({ start: span.a, end, lat: Number(site.latitude.toFixed(4)), lon: Number(site.longitude.toFixed(4)), template: bemLedgerRef.current?.weather?.epw, station: sourcesNow().amyStation, onProgress: setCalBusy });
      if ("error" in w) { setStatus(`calibration weather: ${w.error}`); return; }
      setCalBusy("simulating the actual year …");
      const SQL = await getSql(wasmUrl);
      const r = await runCalibration(SQL, { epwPath: w.epw, schema: schemaRef.current, onProgress: setCalBusy });
      setCalRun(await calibrationView(r));
      setStatus(`calibration run ${r.run.completed ? "completed" : "did not complete"} · ${span.a} – ${end} · Fatal ${r.run.fatal} · Severe ${r.run.severe} — BEM's design run untouched`);
    } catch (e) { setStatus(`calibration run failed: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setCalBusy(""); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const importCsv = useCallback(async () => {
    const f = await window.bom.pickCsv();
    if (!f) return;
    setBomPending(importBills(f.name, f.text));
  }, []);
  const confirmImport = useCallback(async () => {
    const p = bomPending;
    if (!p) return;
    await window.bom.saveImport(p.sha256.slice(0, 12), "csv", p.text);
    const next = [...bomImportsRef.current.filter((i) => i.sha256 !== p.sha256), p];
    bomImportsRef.current = next; setBomImports(next); setBomPending(null);
    saveBomLedger();
    if (bemRef.current) await recomputeBom(next);
  }, [bomPending, saveBomLedger, recomputeBom]);
  // THE BILLS AS PRINTED (2026-10-09): a change mirrored at once into browser storage under the file's sha, written to the ledger after
  // a pause in the typing, then compared with the run like any bill
  const statementsKey = (): string => `bim-bom-statements:${shaRef.current}`;
  const changeStatements = useCallback((next: StatementsLedger) => {
    bomStatementsRef.current = next; setBomStatements(next);
    try { window.localStorage.setItem(statementsKey(), JSON.stringify(next)); } catch { /* the ledger copy stands */ }
    if (statementsTimer.current !== null) window.clearTimeout(statementsTimer.current);
    statementsTimer.current = window.setTimeout(() => {
      statementsTimer.current = null;
      saveBomLedger();
      if (bemRef.current) void recomputeBom();
    }, 700);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveBomLedger, recomputeBom]);
  const saveBillFormat = (f: BillFormat): void => {
    const led = bomStatementsRef.current;
    changeStatements({ formats: [f, ...led.formats.filter((x) => x.id !== f.id)], bills: led.bills.map((b) => (b.format === f.id ? withFormat(b, f) : b)), at: new Date().toISOString() });
    setBillFormatOpen(false);
  };
  const toggleBill = useCallback((key: string) => {
    const s = new Set(bomExcludedRef.current);
    if (s.has(key)) s.delete(key); else s.add(key);
    bomExcludedRef.current = s; setBomExcluded(s);
    void recomputeBom();
  }, [recomputeBom]);
  // THE TREE'S EYES (user, 2026-09-04): a level's eye ON shows the level and
  // every space on it; OFF hides them all, each space's own flag set, so one
  // space can be brought back alone — its eye, clicked under a hidden level,
  // shows that space and the level's elements while the other spaces stay
  // hidden as the level left them.
  const setTreeHidden = (lv: Set<string>, sp: Set<string>): void => {
    hiddenLevelsRef.current = lv; setHiddenLevels(lv);
    hiddenSpacesRef.current = sp; setHiddenSpaces(sp);
    applyHidden();
  };
  const toggleLevel = useCallback((name: string) => {
    const lv = new Set(hiddenLevelsRef.current), sp = new Set(hiddenSpacesRef.current);
    if (lv.has(name)) { lv.delete(name); for (const x of spacesOfLevel(name)) sp.delete(x); }
    else { lv.add(name); for (const x of spacesOfLevel(name)) sp.add(x); }
    setTreeHidden(lv, sp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyHidden]);
  const toggleSpace = useCallback((name: string) => {
    const lv = new Set(hiddenLevelsRef.current), sp = new Set(hiddenSpacesRef.current);
    const level = levelOfSpace(name);
    const levelOff = level !== null && lv.has(level);
    if (sp.has(name) || levelOff) { sp.delete(name); if (levelOff) lv.delete(level); }
    else sp.add(name);
    setTreeHidden(lv, sp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyHidden]);
  const showAllLevels = useCallback(() => {
    hiddenLevelsRef.current = new Set(); setHiddenLevels(new Set());
    hiddenSpacesRef.current = new Set(); setHiddenSpaces(new Set());
    applyHidden();
  }, [applyHidden]);
  // the tree's rows: storeys by elevation (highest first, as a section is
  // read), each with its spaces and the attics over them
  interface LevelRow { name: string; elevM: number | null; spaces: Array<{ name: string; colorIndex: number }>; attics: string[]; heightM: number | null; heightRooms: number; heightOthers: Array<{ name: string; heightM: number }>; shafts: Array<{ name: string; bottomM: number; topM: number }>; floorsOk: boolean; nextM: number | null; nextName: string | null }
  // NOT OCCUPIED SPACE: `isShaft` in core/levels.ts (the user's rule, 2026-09-07)
  const levels = useMemo(() => {
    const run = runRef.current;
    if (!run) return [] as LevelRow[];
    const map = new Map<string, LevelRow>();
    const at = (st: string, elev: number | null): LevelRow => { let l = map.get(st); if (!l) { l = { name: st, elevM: elev, spaces: [], attics: [], heightM: null, heightRooms: 0, heightOthers: [], shafts: [], floorsOk: true, nextM: null, nextName: null }; map.set(st, l); } return l; };
    for (const e of run.elements) if (e.storey) at(e.storey, e.storeyElevM);
    for (const sp of run.spaces) at(sp.storey ?? "(no storey)", sp.storeyElevM).spaces.push({ name: spaceName(sp), colorIndex: sp.colorIndex });
    const storeyOf = new Map(run.spaces.map((sp) => [spaceName(sp), sp.storey ?? "(no storey)"]));
    for (const a of attics?.attics ?? []) at(storeyOf.get(a.room) ?? "(no storey)", null).attics.push(a.name);
    // A LEVEL'S HEIGHT (user, 2026-09-07): the file states no storey height, so two reads
    // stand in — the ceiling the storey's OCCUPIED rooms share (each IfcSpace solid's top,
    // binned at 1 cm; the Elevator shaft the Basement aggregates rises to 53.44 ft and is a
    // named exception — "the 23.44 ft is not true", the user), and the first stated level at
    // or above that ceiling (the floor above: Main over the Basement, not the split-level
    // Garage that is merely next in the list). The rooms' floors are checked against the
    // stated elevation, since the user's rule is that the lowest occupied space sets it.
    const stated = (run.storeys ?? []).filter((x) => x.elevM !== null).map((x) => ({ name: x.name, elevM: x.elevM as number })).sort((a, b) => a.elevM - b.elevM);
    for (const l of map.values()) {
      if (l.elevM === null) continue;
      const tops: Array<{ name: string; top: number }> = [];
      for (const sp of run.spaces) {
        if ((sp.storey ?? "(no storey)") !== l.name) continue;
        let top = -Infinity, bottom = Infinity;
        for (const f of sp.faces) for (const q of f.outer) { if (q[1] > top) top = q[1]; if (q[1] < bottom) bottom = q[1]; }
        if (!Number.isFinite(top)) continue;
        const nm = spaceName(sp);
        if (isShaft(nm)) { l.shafts.push({ name: nm, bottomM: bottom, topM: top }); continue; }
        tops.push({ name: nm, top });
        if (Math.abs(bottom - l.elevM) > 0.02) l.floorsOk = false;
      }
      if (tops.length) {
        const bins = new Map<number, number>();
        for (const t of tops) { const k = Math.round(t.top * 100); bins.set(k, (bins.get(k) ?? 0) + 1); }
        const [modeK, modeN] = [...bins].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]!;
        l.heightM = modeK / 100 - l.elevM; l.heightRooms = modeN;
        l.heightOthers = tops.filter((t) => Math.abs(t.top - modeK / 100) > 0.1).map((t) => ({ name: t.name, heightM: t.top - l.elevM! }));
        const ceiling = modeK / 100;
        const above = stated.find((x) => x.elevM >= ceiling - 0.02 && x.elevM > l.elevM! + 1e-6);
        l.nextM = above ? above.elevM - l.elevM : null;
        l.nextName = above ? stated.filter((x) => Math.abs(x.elevM - above.elevM) < 1e-6).map((x) => x.name).join(", ") : null;
      } else {
        const next = stated.find((x) => x.elevM > l.elevM! + 1e-6);
        l.nextM = next ? next.elevM - l.elevM : null;
        l.nextName = next ? stated.filter((x) => Math.abs(x.elevM - next.elevM) < 1e-6).map((x) => x.name).join(", ") : null;
      }
    }
    return [...map.values()].sort((a, b) => (b.elevM ?? -1e9) - (a.elevM ?? -1e9));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attics, gate]);
  /** ZONES BY LEVEL (user, 2026-10-16: "can we assign spaces to zones by level"): one Zone card per level, named for it, holding the level's
   *  rooms that are in no zone yet — the attics stay their own zones; staged like any sheet change, kept by Save */
  const zonesByLevel = (): number => {
    const inModel = new Set(bemModelRef.current?.input.zones.map((z) => z.name) ?? []);
    const held = new Set(asm.nodes.flatMap((n) => (n.kind === "zone" ? n.rooms ?? [] : [])));
    let a = asm, made = 0;
    const y0 = Math.max(40, ...asm.nodes.map((n) => n.y + 200));
    for (const l of [...levels].reverse()) {
      const rooms = l.spaces.map((x) => x.name).filter((r) => inModel.has(r) && !held.has(r));
      if (!rooms.length) continue;
      const r = addNode(a, { node: "zone", label: l.name }, 40 + made * 280, y0);
      a = r.asm;
      for (const room of rooms) a = addRoom(a, r.id, room);
      made++;
    }
    // THE IDEAL LOADS CARD SERVES THEM (user, 2026-10-16: "Ideal Loads was loaded expecting to have zones assigned to it"): every zone
    // card that holds rooms and is fed by nothing is joined to the sheet's Ideal loads card, Loc to Loc
    const ideal = a.nodes.find((n) => n.kind === "ideal");
    let joined = 0;
    if (ideal) for (const z of a.nodes.filter((n) => n.kind === "zone" && (n.rooms?.length ?? 0) > 0)) {
      if (a.edges.some((e) => e.to === z.id && (e.toPort ?? "loc-in") === "loc-in")) continue;
      a = addEdge(a, ideal.id, z.id, "loc-out", "loc-in"); joined++;
    }
    if (made || joined) setAssembly(a);
    return made;
  };
  const hideElement = useCallback((elementId: number) => {
    hiddenRef.current.add(elementId);
    setSel((s) => (s?.elementId === elementId ? null : s));
    setMenu(null);
    applyHidden();
  }, [applyHidden]);
  // SHOW ALL (user, 2026-11-03: "show all did not work"): every element hidden, every linked file's eye, AND the levels and spaces
  // hidden from LEVELS · SPACES — their elements are hidden in the views as surely as a right-click's, and show all left them
  // hidden. The layers' eyes are the FILES · LAYERS settings and stay as set.
  const unhideAll = useCallback(() => {
    if (hiddenRef.current.size === 0 && hiddenSiteRef.current.size === 0 && hiddenFilesRef.current.size === 0 && hiddenLevelsRef.current.size === 0 && hiddenSpacesRef.current.size === 0) return;
    hiddenRef.current = new Set(); hiddenSiteRef.current = new Set(); hiddenFilesRef.current = new Set(); setHiddenFiles(new Set());
    hiddenLevelsRef.current = new Set(); setHiddenLevels(new Set());
    hiddenSpacesRef.current = new Set(); setHiddenSpaces(new Set());
    setMenu(null);
    applyHidden();
    applyTerrain(showTerrainRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyHidden]);
  const hideSiteElements = useCallback((ids: number[]) => {
    for (const id of ids) hiddenSiteRef.current.add(id);
    setMenu(null);
    setHiddenCount(hiddenRef.current.size + hiddenSiteRef.current.size);
    applyTerrain(showTerrainRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** the display checkbox per linked file and per kind (user, 2026-09-16): view state — the model keeps the file */
  const showSiteFile = useCallback((name: string, on: boolean) => {
    const n = new Set(hiddenFilesRef.current); if (on) n.delete(name); else n.add(name);
    hiddenFilesRef.current = n; setHiddenFiles(n);
    applyTerrain(showTerrainRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** FILES · LAYERS (user, 2026-11-02): a layer's eye, and a file's — the house's through the hidden elements, a projected file's
   *  through the overlay (the same display flag as its SITE checkbox); view state, the model keeps every element */
  const toggleLayer = (file: string, layer: string, house: boolean): void => {
    const n = new Set(hiddenLayersRef.current), sh = new Set(shownLayersRef.current), k = layerKey(file, layer);
    if (layerOn(file, layer)) { n.add(k); sh.delete(k); } else { n.delete(k); sh.add(k); }
    hiddenLayersRef.current = n; setHiddenLayers(n);
    shownLayersRef.current = sh; setShownLayers(sh);
    try { window.localStorage.setItem("bim-hidden-layers", JSON.stringify([...n])); window.localStorage.setItem("bim-shown-layers", JSON.stringify([...sh])); } catch { /* view state only */ }
    if (house) applyHidden(); else applyTerrain(showTerrainRef.current);
  };
  const toggleFileEye = (file: string, house: boolean): void => {
    if (!house) { showSiteFile(file, hiddenFilesRef.current.has(file)); return; }
    const n = new Set(hiddenFilesRef.current); if (n.has(file)) n.delete(file); else n.add(file);
    hiddenFilesRef.current = n; setHiddenFiles(n);
    applyHidden();
  };
  const showSiteElements = useCallback((ids: number[], on: boolean) => {
    for (const id of ids) { if (on) hiddenSiteRef.current.delete(id); else hiddenSiteRef.current.add(id); }
    setHiddenCount(hiddenRef.current.size + hiddenSiteRef.current.size);
    applyTerrain(showTerrainRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** delete from the MODEL: a ledger ruling, idf.db's site_elements rebuilt without them; the dialog names the count */
  const deleteSiteElements = useCallback((ids: number[], label: string) => {
    const els = siteElementsRef.current.filter((e) => ids.includes(e.expressId));
    if (els.length === 0) return;
    setMenu(null);
    if (!window.confirm(`Delete ${els.length === 1 ? "this element" : `these ${els.length} elements`} from the model?\n\n${label}\n\nThey leave idf.db's shading elements and the view; the site file is not rewritten; each is restorable from the SITE table.`)) return;
    shadingRef.current = { siteSha256: siteShaRef.current, deleted: [...shadingRef.current.deleted, ...els.map((e) => ({ expressId: e.expressId, name: e.name, file: e.file }))] };
    setShadingDeleted(shadingRef.current.deleted);
    setSelSite(new Set()); selSiteRef.current = new Set();
    void rebuildIdf(choices, showSpaces ? FADED_SURFACE : fillOpacity, shellOn);
  }, [choices, showSpaces, fillOpacity, shellOn, rebuildIdf]);
  const restoreSiteElements = useCallback((ids: number[]) => {
    const gone = new Set(ids);
    shadingRef.current = { ...shadingRef.current, deleted: shadingRef.current.deleted.filter((d) => !gone.has(d.expressId)) };
    setShadingDeleted(shadingRef.current.deleted);
    void rebuildIdf(choices, showSpaces ? FADED_SURFACE : fillOpacity, shellOn);
  }, [choices, showSpaces, fillOpacity, shellOn, rebuildIdf]);
  const restoreSiteElement = useCallback((id: number) => restoreSiteElements([id]), [restoreSiteElements]);
  // DOUBLE RIGHT-CLICK, anywhere, brings every hidden element back. Detected
  // on the window so it works over the menu's scrim and over empty space —
  // where a hidden element used to be, there is nothing to hit.
  useEffect(() => {
    let last = { t: 0, x: 0, y: 0 };
    const onUp = (ev: PointerEvent): void => {
      if (!ev.isTrusted || ev.button !== 2) return;
      const now = performance.now();
      if (now - last.t < 500 && Math.hypot(ev.clientX - last.x, ev.clientY - last.y) < 6) {
        last = { t: 0, x: 0, y: 0 };
        unhideAll();
        return;
      }
      last = { t: now, x: ev.clientX, y: ev.clientY };
    };
    window.addEventListener("pointerup", onUp, true);
    return () => window.removeEventListener("pointerup", onUp, true);
  }, [unhideAll]);
  const elementLabel = (id: number): string => {
    const el = runRef.current?.elements.find((e) => e.expressId === id);
    return `#${id}${el?.spaces.length ? ` ${el.spaces.join(" + ")}` : ""}${el ? ` · ${el.ifcClass}` : ""}`;
  };

  // A RIGHT CLICK ON NOTHING CLEARS THE SELECTION (user, 2026-10-26: "In views, a right click should unselect any surface or
  // space or zone selection"): surfaces, rooms, levels, zones, types, site and services elements, an armed extension, the menu.
  // A right click ON something still opens its menu — the corrections live there.
  const clearSelection = (): void => {
    setMenu(null);
    armedRef.current = null; setArmed(null); armedSpaceRef.current = null; setArmedSpace(null);
    setSel(null); setSelRow(null); setSelSpace(null); setSelSpaceName(null); setSelLevel(null); setHi(null); setTableSpace(null);
    setSelZone(null); setSelRooms(null); selectType(null);
    const hadSite = selSiteRef.current.size > 0;
    selSiteRef.current = new Set(); setSelSite(new Set()); selMepRef.current = new Set(); setSelMep(new Set());
    if (hadSite && showTerrainRef.current) applyTerrain(true);
  };
  const pane1PickRef = useRef<(expressId: number, button: "left" | "right", x: number, y: number) => void>(() => undefined);
  pane1PickRef.current = (expressId, button, x, y) => {
    if (expressId === 0) { if (button === "right") clearSelection(); return; }
    if (button === "right" && moduleRef.current === "bem" && tabRef.current === "bem-zones" && (selZoneRef.current || selRoomsRef.current || selSpaceNameRef.current)) { clearSelection(); return; }
    if (armedSpaceRef.current) return;      // a wall is not a room: ignored while arming
    if (button === "right") { setMenu({ x, y, elementId: expressId, key: null, label: elementLabel(expressId) }); return; }
    selectElement(expressId);
  };
  // A CLICK ON A ROOM FACE, from any pane. The key is taken against the rooms
  // AS RULED — a face already moved by an earlier op is named by where it is
  // now — so panes 1/2 (the file's rooms) and pane 3 (the ruled) agree.
  const onSpacePickRef = useRef<(row: number, pane: 1 | 2 | 3, button: "left" | "right", x: number, y: number) => void>(() => undefined);
  onSpacePickRef.current = (row, pane, button, x, y) => {
    const rows = pane === 3 ? spaceRowsRef.current.zone : spaceRowsRef.current.file;
    const r = rows[row];
    if (!r) return;
    const k0 = faceKeyOf(r.spaceId, r);
    const ruled = findSpaceFace(ruledSpacesRef.current, k0);
    const key = ruled ? faceKeyOf(ruled.space.expressId, ruled.face) : k0;
    const label = spaceLabelOfRef.current(key);
    if (button === "right") { setMenu({ x, y, elementId: 0, key: null, spaceKey: key, label }); return; }
    setMenu(null);
    const from = armedSpaceRef.current;
    if (from) {
      if (from.key !== key) {
        armedSpaceRef.current = null; setArmedSpace(null);
        runSpaceExtend({ from: from.key, to: key });
      }
      return;
    }
    setSel(null);
    setSelSpace({ key, label });
  };

  /** the target key for "extend this room face to THIS element": among the element's own faces as the
   *  FILE draws them, the one the moving face reaches first going along its own normal. A room meets a
   *  roof's soffit, a wall's near side — never the far face, which is inside the solid. */
  const surfaceTargetFor = (elementId: number, fromKey: string): string | null => {
    const run = runRef.current;
    const P = findSpaceFace(ruledSpacesRef.current, fromKey);
    if (!run || !P) return null;
    return firstFaceReached(run.faces.map((f) => ({ elementId: f.expressId, n: f.n, outer: f.outer })), elementId, P.face);
  };

  const onPickRef = useRef<(hit: PickHit) => void>(() => undefined);
  onPickRef.current = (hit: PickHit): void => {
    if (hit.empty) { if (hit.button === "right") clearSelection(); return; }
    // ZONES (user, 2026-10-26: "deselect zones if already highlighted with right click in view"): a right click on the
    // model while a zone or room is lit clears it — the surface menu only when nothing is lit
    if (moduleRef.current === "bem" && tabRef.current === "bem-zones" && hit.button === "right" && (selZoneRef.current || selRoomsRef.current || selSpaceNameRef.current)) { clearSelection(); return; }
    // a SERVICES element (2026-09-10): selected in the view and the tables, never deleted — equipment is not shading
    if (hit.mepElement) {
      const me = hit.mepElement;
      setMenu(null);
      if (hit.button === "right") return;
      const next = new Set(selMepRef.current.has(me.expressId) && selMepRef.current.size === 1 ? [] : [me.expressId]);
      selMepRef.current = next; setSelMep(next);
      return;
    }
    if (hit.siteElement) {
      const se = hit.siteElement;
      if (hit.button === "right") { setMenu({ x: hit.clientX, y: hit.clientY, elementId: 0, key: null, label: `${se.name} · ${se.file.replace(/\.ifc$/i, "") || "site"} #${se.fileExpressId}`, siteIds: [se.expressId] }); return; }
      setMenu(null);
      const next = new Set(selSiteRef.current.has(se.expressId) && selSiteRef.current.size === 1 ? [] : [se.expressId]);
      selSiteRef.current = next; setSelSite(next);
      applyTerrain(showTerrainRef.current);
      return;
    }
    if (hit.space !== undefined) { onSpacePickRef.current(hit.space, hit.pane, hit.button, hit.clientX, hit.clientY); return; }
    // CONSTRUCTIONS (2026-09-08): a left click on a cell selects its TYPE — the column row lights and its section
    // opens, the DETAIL tab and the options read it; before the generic block, which would clear the type
    if (moduleRef.current === "bem" && tabRef.current === "bem-constructions" && hit.button === "left") {
      setMenu(null);
      // a cell of a type COMBINED into another selects the row it folded into (2026-09-09)
      const own = typeRowsRef.current.find((x) => x.elements.includes(hit.elementId));
      const foldTarget = (x: typeof own, depth = 0): typeof own => { const st = x ? consStageRef.current[x.key] : undefined; const tgt = st?.combined && st.sameAs ? typeRowsRef.current.find((y) => y.key === st.sameAs && y.section === x!.section) : undefined; return tgt && depth < 8 ? foldTarget(tgt, depth + 1) : x; };
      const t = foldTarget(own);
      selectType(t ? typeKey(t) : null);
      return;
    }
    // ZONES (2026-09-13): a left click on a cell selects its ROOM — the cells light, the tree's row, the frame reads it
    if (moduleRef.current === "bem" && tabRef.current === "bem-zones" && hit.button === "left") {
      const rows = hit.pane === 3 ? idfRowsRef.current : dbRowsRef.current;
      const row = rows[hit.rowIndex];
      const r = row?.space ?? row?.spaceFacing ?? null;
      setMenu(null);
      if (r) { selectSpaceName(r); setSelZone(roomHeldRef.current.get(r)?.name ?? r); }
      return;
    }
    // EXTEND A ROOM TO AN ELEMENT'S FACE (user, 2026-09-19: a room whose ceiling was deleted has no
    // other ROOM above it to reach — the plane it belongs on is the roof's own soffit). While a space
    // extension is armed, a left click on a surface takes the element's face the room REACHES FIRST
    // along its own normal — a room meets a roof's underside, not its top.
    if (armedSpaceRef.current) {
      const from = armedSpaceRef.current;
      if (hit.button === "right") return;
      const t = surfaceTargetFor(hit.elementId, from.key);
      armedSpaceRef.current = null; setArmedSpace(null);
      setMenu(null);
      if (!t) { setSpaceEditLog((l) => [...l, `✗ ${from.label} → #${hit.elementId}: no face of that element lies ahead of this room face`]); return; }
      runSpaceExtend({ from: from.key, to: t });
      return;
    }
    {
      const rows = hit.pane === 3 ? idfRowsRef.current : dbRowsRef.current;
      const row = rows[hit.rowIndex];
      setSelSpace(null); setSelSpaceName(null); setSelLevel(null); setHi(null);
      setSel({ elementId: hit.elementId, n: row?.n ?? [0, 1, 0] });
      // a CELL clicked in the IDF-DB view selects that cell and its element only;
      // a window's or door's pane selects the opening itself, its cell only read for the room
      const isOpening = placedByElRef.current.has(hit.elementId);
      setSelRow(hit.pane === 3 && !isOpening ? row?.id ?? null : null);
      setTableSpace(hit.pane === 3 ? row?.space ?? row?.spaceFacing ?? null : null);
    }
    const surf = surfaceAt(hit);
    if (hit.button === "right") {
      // corrections belong to idf (pane 3); Hide is offered on any pane
      const key = hit.pane === 3 && surf ? surf.key : null;
      setMenu({ x: hit.clientX, y: hit.clientY, elementId: hit.elementId, key, label: key && surf ? surf.label : elementLabel(hit.elementId) });
      return;
    }
    setMenu(null);
    const from = armedRef.current;
    if (from && surf && surf.key !== from.key) {
      armedRef.current = null; setArmed(null);
      runExtend({ from: from.key, to: surf.key });
      return;
    }
    if (steps.some((st) => st.lowerId === hit.elementId || st.upperId === hit.elementId)) {
      openSection("steps");
    }
  };

  // ── THE INSPECTOR — what the three views each know about one surface ─────
  // Every field is read back from a stored row, never from the pipeline: the
  // GlobalId and class from ifc.db.elements, the vertices from the faces table
  // of whichever database that pane draws.
  const nKey = (n: [number, number, number]): string =>
    n.map((v) => Math.round(v / 1e-3)).join(",");
  const facesOf = (rows: DbFaceRow[], n: [number, number, number]): DbFaceRow[] =>
    sel ? rows.filter((r) => r.elementId === sel.elementId && nKey(r.n) === nKey(n)) : [];
  const ifcFaces = sel ? facesOf(dbRowsRef.current, sel.n) : [];

  // 8-point compass on the project grid, plus degrees clockwise from the
  // file's TRUE north — the drawing's word and the surveyor's number
  const orient = (n: [number, number, number]): string => {
    const hl = Math.hypot(n[0], n[2]);
    if (hl < 0.05) return n[1] > 0 ? "up" : "down";
    const nh: [number, number] = [n[0] / hl, n[2] / hl];
    const pt = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    const deg = (Math.atan2(nh[0], -nh[1]) * 180) / Math.PI;   // vs project north (0,-1), same convention wallQA validated on the Laundry east wall
    const label = pt[((Math.round(deg / 45) % 8) + 8) % 8]!;
    const tn = runRef.current?.trueNorth;
    if (!tn) return label;
    const dT = (Math.atan2(tn[0] * nh[1] - tn[1] * nh[0], tn[0] * nh[0] + tn[1] * nh[1]) * 180) / Math.PI;
    return `${label} · ${Math.round(((dT % 360) + 360) % 360)}° true`;
  };
  const kindOf = (c: string): string => {
    const u = c.toUpperCase();
    if (u.startsWith("IFCWALL")) return "Wall";
    if (u === "IFCWINDOW") return "Window";
    if (u.startsWith("IFCDOOR")) return "Door";
    if (u === "IFCROOF") return "Roof";
    if (u === "IFCSLAB") return "Floor";
    return c.replace(/^Ifc/i, "");
  };
  const elRow = sel && dbRef.current ? queryElement(dbRef.current, sel.elementId) : null;
  const area = (fs: DbFaceRow[]): number => fs.reduce((t, f) => t + f.areaM2, 0);
  // WHAT THE SELECTION RELATES TO: the rooms it names, the cells to outline in
  // the IDF-DB view, the elements to light in the IFC view. An element lights
  // every cell it became; a cell lights itself and its element only; a room
  // or a level lights every cell that bounds it (the user's rule, 2026-09-04).
  const related = useMemo(() => {
    const rows = idfRowsRef.current;
    const spaces = new Set<string>(); let elementIds = new Set<number>(); let rowIds = new Set<number>();
    const lv = selLevel ? levels.find((l) => l.name === selLevel) : null;
    if (lv) { for (const sp of lv.spaces) spaces.add(sp.name); for (const a of lv.attics) spaces.add(a); }
    else if (selSpaceName) spaces.add(selSpaceName);
    else if (selRooms) for (const r of selRooms) spaces.add(r);   // a drawn Zone (2026-09-13): every room it holds, the level's own path
    else if (sel) {
      elementIds.add(sel.elementId);
      if (selRow !== null) {
        const r = rows.find((x) => x.id === selRow);
        if (r) { rowIds.add(selRow); if (r.space) spaces.add(r.space); if (r.spaceFacing) spaces.add(r.spaceFacing); }
      } else {
        for (const r of rows) if (r.elementId === sel.elementId) { if (r.id !== undefined) rowIds.add(r.id); if (r.space) spaces.add(r.space); if (r.spaceFacing) spaces.add(r.spaceFacing); }
        for (const x of (elRow?.spaces ?? "").split(" + ").map((t) => t.trim()).filter(Boolean)) spaces.add(x);
        // a window or door is not a surface: it names the ROOMS of the cell it stands in
        const po = placedByElRef.current.get(sel.elementId);
        if (po) { const r = rows.find((x) => x.id === po.surfaceId); if (r) { if (r.space) spaces.add(r.space); if (r.spaceFacing) spaces.add(r.spaceFacing); } }
      }
    }
    if (lv || selSpaceName || selRooms) {
      // a void or room merged into another zone (the ZONES ruling) keeps its own name only as the side's IfcSpace — light it by that too
      // (user, 2026-10-02: "Interstitial floor – Great … did not highlight")
      for (const r of rows) if ((r.space && spaces.has(r.space)) || (r.spaceFacing && spaces.has(r.spaceFacing)) || (r.spaceIfc && spaces.has(r.spaceIfc)) || (r.spaceFacingIfc && spaces.has(r.spaceFacingIfc))) { if (r.id !== undefined) rowIds.add(r.id); elementIds.add(r.elementId); }
    }
    if (hi) { rowIds = hi.rows; elementIds = new Set(hi.elements); }
    const tableSpaces = [...spaces].filter((x) => rows.some((r) => r.space === x || r.spaceFacing === x));
    return { spaces, elementIds, rowIds, tableSpaces };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, selRow, selSpaceName, selLevel, selRooms, hi, levels, elRow?.spaces, idfInfo]);
  const shownSpace = tableSpace && related.tableSpaces.includes(tableSpace) ? tableSpace : related.tableSpaces[0] ?? null;
  // THE UNIQUE TYPES the constructions table lists (2026-09-05), and the colour each paints in the view
  const typeRows = useMemo(() => {
    const rows = constructionTypes(idfRowsRef.current, elementIndexRef.current, placedRef.current, bemModel, typesRef.current);
    const colors = new Map<number, number>();
    const rgba = (r: number, g: number, b: number): number => (((r & 255) << 24) | ((g & 255) << 16) | ((b & 255) << 8) | 255) >>> 0;
    const bySource: Record<string, number> = { "code-default": rgba(74, 123, 208), file: rgba(216, 221, 230), dataset: rgba(63, 182, 168), user: rgba(255, 209, 102) };
    let i = 0;
    const ofType = new Map<string, number>();
    for (const t of rows) {
      if (t.section === "Window" || t.section === "Door") continue;
      const src = bemModel?.settings.find((s) => s.key === `construction:${t.key}`)?.source ?? "code-default";
      ofType.set(t.key, consPaint === "source" ? bySource[src] ?? bySource["code-default"]! : categorical(i++));
    }
    // a type CONVERTED to another — combined into it, or aliased through "select other…" — paints in its target's colour
    // (user, 2026-09-09: "other elements converted to a selected type must match the color of the selected type")
    const targetOf = (key: string, depth = 0): string => { const st = consStage[key]; return st?.sameAs && st.sameAs !== key && ofType.has(st.sameAs) && depth < 8 ? targetOf(st.sameAs, depth + 1) : key; };
    for (const t of rows) {
      if (t.section === "Window" || t.section === "Door") continue;
      const c = ofType.get(targetOf(t.key)) ?? ofType.get(t.key)!;
      for (const id of t.rowIds) colors.set(id, c);
    }
    typeRowsRef.current = rows; typeColorRef.current = colors;
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idfInfo, bemModel, consPaint, consStage]);
  // THE SEED (2026-09-10): the stages come from the NEWEST of the ledger's staged record and the journal's — a journal
  // newer than the disk is a draft the disk never got (an edit during a load, a reload inside the debounce), written now
  useEffect(() => {
    const sha = shaRef.current;
    const journal = sha ? readJournal(window.localStorage, sha) : null;
    const disk = bemLedger?.staged ?? null;
    const staged = newestStaged(disk, journal);
    if (sha && staged && staged !== disk && !stagedEmpty(staged)) {
      const next: BemLedger = { ...(bemLedger ?? { sourceIfcSha256: sha, savedAt: "", zones: {}, constructions: {} }), staged };
      bemLedgerRef.current = next;
      void window.bem.saveDecisions(sha, next).then(() => { if (shaRef.current === sha) { savedStagedRef.current = staged; setDraftNote({ at: staged.at }); } }, (e: unknown) => setDraftNote({ at: staged.at, error: e instanceof Error ? e.message : String(e) }));
    } else { savedStagedRef.current = disk; setDraftNote(disk ? { at: disk.at } : null); }
    lastJournalRef.current = stagedContent(staged);
    setConsStage(staged?.constructions ?? bemLedger?.constructions ?? {});
    setConsGround(staged?.ground ?? bemLedger?.ground);
    setSchedStage(staged?.schedules ?? bemLedger?.schedules ?? {});
    setHolStage(staged && staged.holidays !== undefined ? staged.holidays : appliedHolidays(bemLedger)); setCopyStage({});
    const migration: string[] = [];
    setSysStage(sanitizeStage(staged?.systems ?? bemLedger?.systems ?? {}, migration));
    setGainStage(staged?.gains ?? bemLedger?.gains ?? {});
    if (migration.length) setAsmMigration(migration);
    stageShaRef.current = sha;
  }, [bemLedger]);
  // the SYSTEMS lens follows the stage: the zones a staged ruling takes light as the ruling is made
  useEffect(() => { if (tab === "bem-systems") applyHidden(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sysStage]);
  /** the type the DETAIL pane and the options table read: the selected row */
  const detailRow = typeSel ? typeRows.find((r) => typeKey(r) === typeSel) ?? null : null;
  /** THE CODE DEFAULT for the selected type (2026-09-16): the code kind its cells WOULD take (the writer's own rule, recorded per
   *  surface in bem.db whatever governs — the column had read the RULED construction once one was applied), its name, layers and U
   *  from the construction as written when the model wrote it, else from the code catalogue (the table's nominal U, the layers in
   *  words); the other kinds on some cells named beside it */
  const detailCode = detailRow && bemModel ? (() => {
    const kinds = detailRow.codeConstructions;
    const top = kinds[0];
    if (!top) return null;
    const cat = codeCatalogue(bemModel.built.model.climateZone, bemModel.built.model.energyCode);
    const base = catalogueKindOf(top.kind);
    const emitted = bemModel.constructions.find((x) => x.kind === top.kind && !/ reversed$/.test(x.name)) ?? bemModel.constructions.find((x) => x.kind === base && !/ reversed$/.test(x.name));
    const entry = cat.find((e) => e.kind === base);
    const others = kinds.slice(1).map((o) => `${o.kind} (${o.cells} cell${o.cells === 1 ? "" : "s"})`);
    // the glazed kinds carry the code's SHGC and the writer's stated VT too (2026-09-18): the DETAIL frame states them once
    return { name: top.kind, layers: emitted?.layers ?? [entry?.layers ?? "—"], uWm2k: emitted?.uWm2k ?? entry?.uWm2k ?? null, shgc: entry?.shgc ?? null, vt: entry?.vt ?? null, others };
  })() : null;
  const detailResolved = detailRow && detailRow.typeId !== null ? bemModel?.built.model.constructions?.get(detailRow.typeId) ?? null : null;
  const detailOverall = detailRow && (detailRow.kind === "window" || detailRow.kind === "door") ? (() => { const e = elementIndexRef.current.get(detailRow.elements[0] ?? -1); return e && e.overallWidthM !== null && e.overallHeightM !== null ? { w: e.overallWidthM, h: e.overallHeightM } : null; })() : null;
  /** a floor type on the ground: the depth its cells sit at, the deepest wall part beside them — for the foundation drawing */
  // each Material's thickness in the model as written (2026-10-12: the slab's edge draws its wall's own layers to scale)
  const materialThick = useMemo(() => {
    const m = new Map<string, number>();
    if (bemModel?.idf) for (const o of parseIdfObjects(bemModel.idf, "in.idf")) if (o.cls === "Material" && o.fields[0]) m.set(o.fields[0].toUpperCase(), Number(o.fields[2]));
    return m;
  }, [bemModel]);
  const detailGround = detailRow && detailRow.kind === "floor" ? (() => {
    const cells = idfRowsRef.current.filter((r) => r.id !== undefined && detailRow.rowIds.includes(r.id));
    const on = cells.filter((r) => r.gradeDepthM !== null && r.gradeDepthM !== undefined && r.gradeDepthM >= -0.1);
    if (!on.length) return undefined;
    const zones = new Set(on.flatMap((r) => [r.space, r.spaceFacing]).filter((z): z is string => !!z));
    let wallDepthM = 0;
    for (const r of idfRowsRef.current) if (r.ifcClass === "exteriorWall" && r.grade === "below" && r.space && zones.has(r.space)) { const ys = r.outer.map((p) => p[1]); wallDepthM = Math.max(wallDepthM, Math.max(...ys) - Math.min(...ys)); }
    const mo = bemModelRef.current, bm = mo?.built.model, codeT = ieccFor(bm?.climateZone, bm?.energyCode);
    // what EnergyPlus is given (2026-10-10): the slab cells' constructions and the below-grade walls in the same zones, read back from bem.db
    const els = new Set(cells.map((r) => r.elementId));
    // on the ground: a constant ground temperature's "Ground", or Kiva's "Foundation" (2026-10-12: the Kiva slabs and walls had been left out)
    const grounded = (bc: string): boolean => bc === "Ground" || bc === "Foundation";
    const slabSurf = (mo?.surfaces ?? []).filter((x) => els.has(x.elementId) && grounded(x.bc) && x.type === "Floor");
    const consOf = (n: string) => mo?.constructions.find((c) => c.name === n);
    const slabConstructions = [...new Set(slabSurf.map((x) => x.construction))].map((n) => ({ name: n, layers: consOf(n)?.layers ?? [] }));
    const wallBy = new Map<string, number>();
    for (const x of mo?.surfaces ?? []) if (grounded(x.bc) && x.type === "Wall" && zones.has(x.zone)) wallBy.set(x.construction, (wallBy.get(x.construction) ?? 0) + x.grossAreaM2);
    const walls = [...wallBy].sort((a, b) => b[1] - a[1]).map(([n, a]) => ({ name: n, uWm2k: consOf(n)?.uWm2k ?? null, areaM2: a, layers: consOf(n)?.layers ?? [], thickM: (consOf(n)?.layers ?? []).map((l) => materialThick.get(l.toUpperCase()) ?? null) }));
    // the last run's heat flow through these slab cells: the engine's annual inside-face conduction, as the surface-conduction lens reads it
    const b = bem, sc = slabSurf.map((x) => b?.surfaceConduction.get(x.epName.toUpperCase())).filter((v): v is number => v !== undefined);
    const runSha = b?.run.modelSha256;
    const run = b && sc.length ? { stamp: b.stamp, kwh: sc.reduce((t, v) => t + v, 0), cells: sc.length, current: !!runSha && runSha === mo?.modelSha } : null;
    return { method: groundMethodOf(consGround), depthM: on.reduce((t, r) => t + (r.gradeDepthM ?? 0), 0) / on.length, wallDepthM, slabThickM: detailRow.layers.reduce((t, l) => t + (l.thicknessM ?? 0), 0), cells: on.length, of: cells.length,
      plan: slabPlan(consGround, codeT), code: `${codeT.edition.label.replace(/ \(.*\)$/, "")}, zone ${codeT.zone}, Table R402.1.2`, wallR: consGround?.wallR ?? 10, slabConstructions, walls, run };
  })() : undefined;
  /** a file just loaded: the plan preset applies then too, when the CONSTRUCTIONS plan view was the one remembered */
  const [loadedAt, setLoadedAt] = useState(0);
  useEffect(() => {
    if (tab === "bem-constructions" && consView === "plan") viewTo("plan");
  }, [tab, consView, viewTo, loadedAt]);
  /** what the screen asks of materials.db: the rows read back, by key, name-matched, or searched */
  const materialsApi = useMemo((): MaterialsApi | null => {
    const m = materialsRef.current;
    if (!m) return null;
    const byKey = new Map(m.rows.map((r) => [r.key, r]));
    return {
      version: m.version,
      byKey: (k) => byKey.get(k) ?? null,
      candidates: (layer, kind) => candidateRows(m.rows, libRef.current, layer, kind),   // the user's own rows first, the reference list's keyword matches, then the name-matched seeds
      fenestration: (section) => m.products.filter((g) => g.section === section || g.section === "any"),   // the fenestration datasets a track offers: the engine's constructions, the generic sets, the manufacturers' ratings (2026-09-17)
      all: () => m.rows,   // the palette culls by role over every row (2026-09-16)
      sources: () => m.sources,   // the db's own source classes: Open · Manufacturers · Yours, and each dataset's short label (2026-09-17)
      search: (text, opts) => { const t = text.trim().toLowerCase(); return m.rows.filter((r) => (!opts?.kind || r.kind === opts.kind) && (!opts?.zero || r.cls !== "Material") && (!t || `${r.name} ${r.kind} ${r.sourceRef} ${r.sourceId}`.toLowerCase().includes(t))).slice(0, 200); },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialsVersion, libCensus]);
  // the Window schedule's Reference reads the fenestration datasets' window rows (2026-10-01)
  const windowProducts = useMemo(() => materialsApi?.fenestration("window") ?? null, [materialsApi]);
  // and a glazed Door row's, the door rows (user, 2026-10-01: "Same approach is needed for glass doors")
  const doorProducts = useMemo(() => materialsApi?.fenestration("door") ?? null, [materialsApi]);
  // the library's on/off and fraction schedules, for the component inputs' schedule dropdowns (2026-09-14) — read once per library
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sysSchedules = useMemo(() => (libRef.current ? readProfiles(libRef.current).filter((s) => !s.problem && fitsRole(s, "hvac-availability")) : []), [libCensus]);
  const detailRowRef = useRef<TypeRow | null>(null); detailRowRef.current = detailRow;
  const detailStage = detailRow ? consStage[detailRow.key] : undefined;
  const detailAlias = detailStage?.source === "sameAs" && detailStage.sameAs ? { key: detailStage.sameAs, row: typeRows.find((r) => r.key === detailStage.sameAs) ?? null, stage: consStage[detailStage.sameAs] } : null;
  /** the name typed in the DETAIL head (an alias reads its target's) — the DETAIL tab, the head and the options read it (user, 2026-09-08) */
  const detailName = (detailStage?.source === "sameAs" ? detailAlias?.stage?.name : detailStage?.name)?.trim() || null;
  const detailStaged = detailRow ? JSON.stringify(consStage[detailRow.key] ?? null) !== JSON.stringify(bemLedger?.constructions?.[detailRow.key] ?? null) : false;
  /** the staged changes in words (2026-09-16), for the DETAIL head and the PLAN reading; the energy code and zone the CODE column names */
  const detailSummary = detailRow ? describeStage(consStage[detailRow.key], bemLedger?.constructions?.[detailRow.key]) : null;
  const energyCodeLabel = bemModel?.settings.find((s) => s.key === "energy_code")?.value ?? "2018 IECC (IRC ch. 11) · climate zone by county";
  const nameType = (name: string | undefined): void => { if (!detailRow) return; const cur = consStage[detailRow.key]; stageCons(detailRow.key, cur ? { ...cur, name } : { source: "code", name }); };
  useEffect(() => { if (tab === "bem-constructions") applyHidden(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeRows]);
  useEffect(() => { if (hi === null) { setTypeSel(null); setLayerSel(null); } }, [hi]);
  const selectType = (key: string | null): void => {
    setTypeSel(key); setLayerSel(null); setDialog(null);
    const t = key ? typeRowsRef.current.find((r) => typeKey(r) === key) : undefined;
    if (!t) { setHi(null); return; }
    setSel(null); setSelRow(null); setSelSpaceName(null); setSelLevel(null); setSelSpace(null);
    // a combined row lights every type folded into it (2026-09-09)
    const ms = typeRowsRef.current.filter((o) => { const s = consStageRef.current[o.key]; return !!s?.combined && s.sameAs === t.key && o.section === t.section; });
    const els = [...t.elements, ...ms.flatMap((o) => o.elements)];
    // A WINDOW OR DOOR TYPE LIGHTS ITS OWN PANES (user, 2026-10-01: "Window segment highlights walls rather than windows"):
    // its rowIds are the wall cells its openings cut — the accounting keeps them — so the view lights each opening's
    // placed rectangle instead, the way a single window picked in a view is lit
    if (t.section === "Window" || t.section === "Door") {
      const quads = els.map((e) => placedByElRef.current.get(e)?.quad).filter((q): q is Array<[number, number, number]> => !!q);
      setHi({ rows: new Set(), elements: new Set(els), loop: null, quads });
      return;
    }
    setHi({ rows: new Set([...t.rowIds, ...ms.flatMap((o) => o.rowIds)]), elements: new Set(els), loop: null });
  };
  // DETAIL IS WHERE THE ASSEMBLY IS EDITED, so opening a type there lands on its OUTERMOST layer, with the
  // material palette under the view — never on the type's options table (the user, 2026-09-17, arriving from
  // PLAN's "edit in DETAIL": "the frame below view is the old UI"). A type the file gives no layers — a window,
  // a glazed door — keeps that table: the General and Marvin tracks live in it. Clicking the selected layer
  // again still deselects, which is how an opaque type's own options (the datasets, a typed U) are reached.
  useEffect(() => {
    if (tab !== "bem-constructions" || consView !== "detail") return;
    const row = detailRowRef.current;
    if (!row || layerSelRef.current !== null) return;
    const st = consStageRef.current[row.key];
    const first = ruledStack(row.layers.filter((l) => !l.part), st?.source === "layers" ? st.layers : undefined).find((q) => q.position === 1);
    if (first) setLayerSel(first.seq);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, consView, typeSel]);
  /** which SITE view is on screen: the model, the map, the stations, or the solar study */
  const siteView: "model" | "location" | "weather" | "solar" | null = tab === "bem-site" ? (solar ? "solar" : siteFocus) : null;
  // THE WEATHER STATIONS FROM THE WEB (user, 2026-09-07): the listing is read once into
  // data/cache and parsed here; a file is used by downloading its zip once
  // the listing the project's data sources name (2026-11-12): EnergyPlus's repository by the standard template, or climate.onebuilding.org's
  // USA TMYx files
  const loadStations = useCallback(async (refresh = false) => {
    const tmyx = sourcesNow().weatherListing === "onebuilding-tmyx-usa";
    setStationsBusy(true);
    setStationsWord(refresh ? (tmyx ? "fetching the listing from climate.onebuilding.org…" : "fetching EnergyPlus's weather listing…") : "reading the listing…");
    try {
      const r = await window.bem.fetchCached(tmyx ? USA_TMYX_KML : WEATHER_LISTING_URL, tmyx ? TMYX_CACHE : STATIONS_CACHE, refresh ? 0 : null);
      if ("error" in r) { setStationsWord(`listing unavailable: ${r.error}`); return; }
      const rows = tmyx ? parseStationKml(r.text) : parseStationListing(r.text), groups = groupStations(rows);
      setStations(groups);
      setStationsWord(`${tmyx ? "climate.onebuilding.org · USA TMYx" : "EnergyPlus weather repository"}: ${rows.length.toLocaleString()} files · ${groups.length.toLocaleString()} stations · listing ${r.cached ? "cached" : "fetched"} ${r.savedAt.slice(0, 10)}`);
    } finally { setStationsBusy(false); }
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  // a change of listing reads the map again
  useEffect(() => { setStations(null); }, [sources.weatherListing]);
  useEffect(() => { if (siteView === "weather" && stations === null && !stationsBusy) void loadStations(); }, [siteView, stations]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (siteView !== "weather" || humidityByWmo.size || !epwList.length) return;
    void (async () => {
      const m = new Map<string, boolean>();
      for (const epw of epwList) {
        const wmo = wmoOfEpw(epw);
        if (!wmo) continue;
        const ddy = await window.bem.readText(epw.replace(/\.epw$/i, ".ddy"));
        if (ddy !== null) m.set(wmo, humidityMeasured(ddy));
      }
      setHumidityByWmo(m);
    })();
  }, [siteView, epwList]); // eslint-disable-line react-hooks/exhaustive-deps
  const useStation = useCallback(async (file: StationFile) => {
    const have = epwList.find((p) => baseName(p).replace(/\.epw$/i, "") === file.stem);
    if (have) { chooseEpw(have); setStationsWord(`${file.stem}: already in a weather folder (${baseName(have.replace(/\/[^/]+$/, ""))}) — in force`); return; }
    setStationsBusy(true); setStationsWord(`downloading ${file.stem}…`);
    try {
      const r = await window.bem.downloadWeather(file.url);
      if ("error" in r) { setStationsWord(`download failed: ${r.error}`); return; }
      setStationsWord(`${file.stem} ${r.cached ? "already in" : "unpacked into"} Weather/ — in force`);
      chooseEpw(r.epw);
    } finally { setStationsBusy(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epwList]);
  // THE SITE VIEW (user, 2026-09-05): the model under its terrain and the site's
  // shading elements, the sun where the clock puts it, its shadows cast in the view
  useEffect(() => {
    const panes = dbPanesRef.current;
    if (!panes) return;
    if (siteView !== "solar") { panes.setSun(null); panes.setSunGroup(null); setSunInfo(null); return; }
    const run = runRef.current;
    const site = bemLedgerRef.current?.site?.location ?? run?.site ?? null;
    if (!site) { setSunInfo(null); panes.setSun(null); panes.setSunGroup(null); return; }
    const tz = bemModelRef.current?.weather?.header?.timeZone ?? Math.round(site.longitude / 15);
    const northAxis = northAxisFromTrueNorth(run?.trueNorth ?? null);
    const pos = sunPosition(site.latitude, site.longitude, tz, sun.month, sun.day, sun.hour);
    setSunInfo(pos);
    const dir = sunDirection(pos, northAxis);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const r of idfRowsRef.current) for (const q of r.outer) for (let k = 0; k < 3; k++) { if (q[k]! < min[k]!) min[k] = q[k]!; if (q[k]! > max[k]!) max[k] = q[k]!; }
    if (!Number.isFinite(min[0]!)) { panes.setSun(dir); panes.setSunGroup(null); return; }
    const center: [number, number, number] = [(min[0]! + max[0]!) / 2, min[1]!, (min[2]! + max[2]!) / 2];
    const radius = Math.max(15, Math.hypot(max[0]! - min[0]!, max[2]! - min[2]!) * 0.75);
    const path: Array<{ hour: number; dir: [number, number, number] | null }> = [];
    for (let h = 0; h <= 24; h += 0.25) path.push({ hour: h, dir: sunDirection(sunPosition(site.latitude, site.longitude, tz, sun.month, sun.day, h), northAxis) });
    panes.setSunGroup(buildSunView({ center, radius, path, sun: dir, north: northDirection(northAxis) }));
    panes.setSun(dir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteView, sun, idfInfo, terrainInfo, bemModel]);
  // the solar intensity lens: the weather file's radiation for the clock's hour on every exterior surface
  useEffect(() => {
    const panes = dbPanesRef.current;
    if (!panes) return;
    if (siteView !== "solar" || !intensity) { intensityRepaintRef.current = null; setIntensityLegend(null); if (idfViewGroupRef.current && intensityRef.current === false) applyHidden(); return; }
    let cancelled = false;
    const paint = (): void => {
      const rad = epwRadRef.current?.rad;
      const group = idfViewGroupRef.current;
      const run = runRef.current;
      const site = bemLedgerRef.current?.site?.location ?? run?.site ?? null;
      if (!rad || !group || !site) return;
      const r = rad.at(sunRef.current.month, sunRef.current.day, sunRef.current.hour);
      if (!r) { setIntensityLegend(null); return; }
      const tz = bemModelRef.current?.weather?.header?.timeZone ?? Math.round(site.longitude / 15);
      const northAxis = northAxisFromTrueNorth(run?.trueNorth ?? null);
      const sunDir = sunDirection(sunPosition(site.latitude, site.longitude, tz, sunRef.current.month, sunRef.current.day, sunRef.current.hour), northAxis);
      // which rows face outdoors: the writer's word (bc Outdoors) where it emitted the row; a roof
      // or exterior wall no zone claimed — the envelope the model lacks — is exterior by its category
      const outdoors = new Set<number>(), emitted = new Set<number>();
      const m = bemModelRef.current;
      if (m) { for (const sf of m.surfaces) if (sf.idfSurfaceId !== null) { emitted.add(sf.idfSurfaceId); if (sf.bc === "Outdoors") outdoors.add(sf.idfSurfaceId); } }
      const rows = idfRowsRef.current;
      let cx = 0, cy = 0, cz = 0, n = 0;
      for (const row of rows) for (const q of row.outer) { cx += q[0]; cy += q[1]; cz += q[2]; n++; }
      cx /= n || 1; cy /= n || 1; cz /= n || 1;
      const value = new Map<number, number>();
      let max = 0;
      for (const row of rows) {
        if (row.id === undefined) continue;
        const byCategory = (row.ifcClass === "exteriorWall" || row.ifcClass === "roof") && !(row.space && row.spaceFacing);
        const ext = outdoors.has(row.id) || (!emitted.has(row.id) && byCategory);
        if (!ext) continue;
        // the outward normal: away from the room behind, toward the room faced, else away from the
        // model's centre in all three axes — a roof's normal is nearly vertical, so plan alone cannot tell
        let sgn = row.space ? 1 : row.spaceFacing ? -1 : 0;
        if (sgn === 0) {
          let px = 0, py = 0, pz = 0;
          for (const q of row.outer) { px += q[0]; py += q[1]; pz += q[2]; }
          px /= row.outer.length; py /= row.outer.length; pz /= row.outer.length;
          sgn = (row.n[0] * (px - cx) + row.n[1] * (py - cy) + row.n[2] * (pz - cz)) >= 0 ? 1 : -1;
        }
        const v = irradiance([row.n[0] * sgn, row.n[1] * sgn, row.n[2] * sgn], sunDir, r).total;
        value.set(row.id, v); if (v > max) max = v;
      }
      const painted = repaintFill(group, rows, (row) => (row.id !== undefined && value.has(row.id) ? intensityColor(max > 0 ? value.get(row.id)! / max : 0) : null));
      setIntensityLegend({ maxWm2: max, rad: r, hour: Math.max(1, Math.min(24, Math.ceil(sunRef.current.hour - 1e-9))), painted: value.size, epw: epwRadRef.current?.path ?? "" });
      void painted;
    };
    intensityRepaintRef.current = paint;
    const epw = bemModelRef.current?.weather?.epw ?? DEFAULT_EPW;
    if (epwRadRef.current?.path === epw) paint();
    else void window.bem.resolveEpw(epw).then((p) => (p ? window.bem.readText(p) : null)).then((text) => { if (cancelled || !text) return; epwRadRef.current = { path: epw, rad: parseEpwRadiation(text) }; paint(); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteView, intensity, sun, idfInfo, bemModel]);
  // THE SITE TAB DRAWS THE PROJECTED FILES (user, 2026-09-07: "both site and mep ifc files are
  // not loading in the basic Site tab view" — a first cut switched the overlay off with Solar
  // Studies, and the projected files vanished from the very view that lists them). The model
  // view and the solar view both switch the overlay on when a projected file holds anything;
  // the top-bar checkbox is the user's after that
  useEffect(() => {
    if (!(tab === "bem-site" || tab === "bem-systems") || siteView === "location" || siteView === "weather") return;
    if ((terrainInfo || siteElementsRef.current.length > 0 || mepElementsRef.current.length > 0) && !showTerrainRef.current) { setShowTerrain(true); showTerrainRef.current = true; applyTerrain(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, siteView, terrainInfo, siteElsInfo, mepInfo]);
  // the SYSTEMS view follows its focus and its selection, and drops the services on leaving the tab (2026-09-10)
  useEffect(() => { applyTerrain(showTerrainRef.current); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, sysFocus, selMep, mepInfo]);
  // the trees follow the month's transmittance while deciduous modelling is on
  const lastMonthRef = useRef(sun.month);
  useEffect(() => {
    if (lastMonthRef.current === sun.month) return;
    lastMonthRef.current = sun.month;
    if (showTerrainRef.current && deciduousRef.current) applyTerrain(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sun.month]);
  useEffect(() => { if (showTerrainRef.current) applyTerrain(true); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deciduous]);
  // THE SOLAR STUDY's cycle: the hour through the day, the day through the year
  useEffect(() => {
    if (siteView !== "solar" || !cycle.run || (!cycle.day && !cycle.year)) return;
    const id = window.setInterval(() => {
      setSun((c) => {
        let { month, day, hour } = c;
        if (cycle.day) { hour += 0.25 * cycle.speed; if (hour >= 24) hour -= 24; }
        if (cycle.year) { let n = dayOfYear(month, day) + cycle.speed; if (n > 365) n -= 365; ({ month, day } = monthDayOf(n)); }
        return { month, day, hour };
      });
    }, 120);
    return () => window.clearInterval(id);
  }, [siteView, cycle]);
  // a deletion recorded before files were named (2026-09-07) belongs to the terrain file it was keyed to
  const siteFileName = siteFiles.find((f) => f.kind === "site")?.name ?? "_Site.ifc";
  const siteRows = useMemo(() => {
    const siteName = siteFileName;
    return siteTypes(siteElementsRef.current, hiddenSiteRef.current, shadingDeleted.map((d) => (d.file ? d : { ...d, file: siteName })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteElsInfo, hiddenCount, shadingDeleted, siteFiles]);
  /** the position in force: located on the map by the user, else the IfcSite's */
  const siteInForce = bemLedger?.site?.location ?? runRef.current?.site ?? null;
  const inForcePath = bemLedger?.weather?.epw ?? DEFAULT_EPW;
  const inForceWmo = wmoOfEpw(inForcePath);
  const installedWmos = useMemo(() => new Set(epwList.map(wmoOfEpw).filter((x): x is string => !!x)), [epwList]);
  // every station with its distance from the site, once; the map's view (and the zone switch) is the filter
  const allStations = useMemo(() => (stations && siteInForce ? nearestStations(stations, siteInForce, 1e9, 1e9) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stations, siteInForce?.latitude, siteInForce?.longitude]);
  const projectZone = countyZone?.zone || null;
  const nearStations = useMemo(() => stationsInView(onlySameZone && projectZone && allStations.some((x) => x.climateZone) ? allStations.filter((x) => zoneCode(x.climateZone) === projectZone) : allStations, mapBounds),
    [allStations, mapBounds, onlySameZone, projectZone]);
  const mapView = siteView === "location" || siteView === "weather";
  siteViewRef.current = siteView;
  siteFilesRef.current = siteFiles.map((f) => ({ name: f.name, kind: f.kind, projected: f.projected, elements: f.elements }));
  const spaceCtx = {
    isExternalOf: (id: number) => elementIndexRef.current.get(id)?.isExternal ?? null,
    matchHole: (ring: Array<[number, number, number]>, t: number) => matchOpening(openingIndexRef.current, ring, t / 2 + 0.15),
    isCrawl: (n: string) => /crawl/i.test(n),
    openingsOn: (rowId: number) => panesByRowRef.current.get(rowId) ?? [],
    nameOf: (id: number) => elementIndexRef.current.get(id)?.name ?? null,
  };
  const surfacesOfRoom = (room: string) => spaceSurfaces(idfRowsRef.current, room, runRef.current?.trueNorth ?? null, spaceCtx);
  const spaceRows = shownSpace ? surfacesOfRoom(shownSpace) : [];
  const summary = spaceSummary(spaceRows);
  // the calendar's subject (2026-09-13): the staged pick, else the applied row's schedule, else nothing painted (the code default's words)
  const runCal = useMemo(() => {
    const c = runCalendar(bemModel?.weather?.header ?? null, bemLedger?.site?.runPeriod ?? null);
    // the project's holidays (staged) join the weather file's: the engine reads both
    const mine = (holStage?.days ?? []).filter((n) => !c.holidays.some((h) => h.n === n)).map((n) => ({ name: holStage!.id || "holiday", date: specialDayDate(n), n }));
    return mine.length ? { ...c, holidays: [...c.holidays, ...mine] } : c;
  }, [bemModel, bemLedger, holStage]);
  const calProfile = useMemo(() => {
    if (!schedCard || !libRef.current) return null;
    const lib = libRef.current;
    // a schedule of yours the project already runs on reads the PROJECT's copy (2026-10-05), unless re-saved this session
    const P = withProjectCopies(lib, bemLedger?.scheduleCopies);
    const st = schedStage[schedCard];
    const row = bemModel?.schedules.find((r) => r.role === schedCard);
    const d = DEFAULT_PROFILE_REF[schedCard];   // a gain role's default is one of the library's own: painted as the default
    const kept = (r: ScheduleRef): boolean => r.file === USER_SCHEDULE_FILE && !copyStage[r.name.toLowerCase()] && !!bemLedger?.scheduleCopies?.[r.name.toLowerCase()];
    return st ? profileFor(kept(st) ? P : lib, st) : row && row.file ? profileFor(P, { file: row.file, name: row.name }) : d ? profileFor(lib, d) : null;
  }, [schedCard, schedStage, bemModel, bemLedger, userSchedV, copyStage]);
  /** A SAVE FROM THE EDITOR: the copy into your schedules file (its earlier one of that name replaced), the library re-read
   *  with it, and the copy staged for the role — Apply in the column puts it in the model */
  const saveUserSchedule = async (s: EditorSave): Promise<string | null> => {
    const w = writeUserFile(userSchedRef.current, s);
    try { await window.bim.saveDb(USER_SCHEDULE_FILE, new TextEncoder().encode(w.text)); }
    catch (e) { return `not saved: ${e instanceof Error ? e.message : String(e)}`; }
    userSchedRef.current = { objects: w.objects, notes: w.notes };
    if (libRef.current) libRef.current = withUserSchedules(libRef.current, w.objects);
    setUserSchedV((v) => v + 1);
    setSchedDraft(null);
    setSchedStage((st) => ({ ...st, [s.role]: { file: USER_SCHEDULE_FILE, name: s.object.name } }));
    const t = libRef.current ? copyTextOf(libRef.current, s.object.name) : null;
    if (t) setCopyStage((c) => ({ ...c, [s.object.name.toLowerCase()]: t }));
    // the schedule's own season is kept in your library too, by its ID
    const kept = s.season ? await keepCalendar("seasons", s.season) : null;
    setStatus(`saved "${s.object.name}" into ${USER_SCHEDULE_FILE} and staged it for ${ROLE_LABELS[s.role]} — Apply in the column${s.season ? (kept ? ` · its season NOT kept: ${kept}` : ` · its season "${s.season.id}" kept in ${USER_CALENDAR_FILE}`) : ""}`);
    return null;
  };
  /** KEEP A HOLIDAY LIST OR A SEASON in your library (data/calendars-user.json, every project): the earlier one of its ID replaced */
  const keepCalendar = async (kind: "holidays" | "seasons", d: DaySetDef): Promise<string | null> => {
    const next = keepInCalendars(userCal, kind, d);
    try { await window.bim.saveDb(USER_CALENDAR_FILE, new TextEncoder().encode(calendarsText(next))); }
    catch (e) { return `not saved: ${e instanceof Error ? e.message : String(e)}`; }
    setUserCal(next);
    return null;
  };
  const calShown = schedDraft ?? calProfile;
  const calSourceWord = schedCard ? (schedStage[schedCard] ? "staged — Apply in the column" : bemModel?.schedules.find((r) => r.role === schedCard)?.file ? "applied" : calProfile ? `the default — ${CODE_DEFAULT_SCHEDULE[schedCard]}` : CODE_DEFAULT_SCHEDULE[schedCard]) : "no card selected — the day types and the run period";
  // the ZONES frame's subject (2026-09-13): the drawn Zone picked, else the room's own zone
  const frameZone = ((): { name: string; rooms: string[] } | null => {
    // a room selected reads under ITS zone (a tree click leaves selZone as it was — measured 2026-09-13: Studio read under Office/Bed2)
    if (selSpaceName) { const h = roomHeld.get(selSpaceName); return h ? { name: h.name, rooms: asmCompiled.zones.find((x) => x.id === h.id)?.rooms ?? [selSpaceName] } : { name: selSpaceName, rooms: [selSpaceName] }; }
    const z = selZone ? asmCompiled.zones.find((x) => x.name === selZone) : null;
    return z && z.rooms.length ? { name: z.name, rooms: z.rooms } : null;
  })();
  const zoneOf = (name: string | null): ZoneRowIn | null => (name ? zoneRowsRef.current.find((z) => z.name === name) ?? null : null);
  // The outline is rebuilt from the STORED rows the pane is drawn from, so it
  // cannot drift from what is on screen.
  useEffect(() => {
    const panes = dbPanesRef.current;
    if (!panes) return;
    if (selEl === null && selSpace) {
      // the selected ROOM FACE (the space tool): its loop in each view's own rows
      ifcPaneRef.current?.setHighlight(null);
      const loops = (rows: SpaceFaceRow[]): Array<Array<[number, number, number]>> => {
        const f = spaceFaceRow(rows, selSpace.key);
        return f ? [f.outer, ...f.holes] : [];
      };
      ifcPaneRef.current?.setSpaceHighlight(buildLoopHighlight(loops(spaceRowsRef.current.file)));
      panes.setHighlights(null, buildLoopHighlight(loops(spaceRowsRef.current.zone)));
      return;
    }
    ifcPaneRef.current?.setSpaceHighlight(null);
    ifcPaneRef.current?.setHighlight(related.elementIds.size ? [...related.elementIds] : null);
    const groups: Array<ReturnType<typeof buildRowHighlight>> = [];
    if (related.rowIds.size) groups.push(buildRowHighlight(idfRowsRef.current, related.rowIds));
    // an opening row's pane, or the selected window's or door's own: FILLED, since
    // its outline coincides with the wall's notch on three sides
    if (hi?.quads?.length) groups.push(buildQuadHighlight(hi.quads));
    if (hi?.loop) groups.push(buildQuadHighlight([hi.loop]));
    else if (sel && placedByElRef.current.has(sel.elementId)) groups.push(buildQuadHighlight([placedByElRef.current.get(sel.elementId)!.quad]));
    if (groups.length === 0) { panes.setHighlights(null, null); return; }
    // the room's own volume too, when the rooms are shown
    if (showSpaces && (selSpaceName || selLevel || selRooms)) {
      const loops = spaceRowsRef.current.zone.filter((r) => related.spaces.has(r.label)).flatMap((r) => [r.outer, ...r.holes]);
      groups.push(buildLoopHighlight(loops));
    }
    panes.setHighlights(null, combineHighlights(groups));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [related, hi, selSpace, steps, qaRows, spaceInfo, showSpaces]);
  // THE ROOM READING: the selected room face in the file (ifc.db's rooms) and
  // as ruled (idf.db's copy) — one face, three cells, every number from a
  // stored row or the ruled solid the last rebuild used
  const roomSel = (() => {
    if (!selSpace || sel) return null;
    const k = parseSpaceFaceKey(selSpace.key);
    const run = runRef.current;
    if (!k || !run) return null;
    const sp = run.spaces.find((s) => s.expressId === k.spaceId);
    if (!sp) return null;
    const fileRow = spaceFaceRow(dbRef.current ? querySpaces(dbRef.current) : [], selSpace.key);
    const zoneRow = spaceFaceRow(zoneSpaceRowsRef.current, selSpace.key);
    const ruled = ruledSpacesRef.current.find((s) => s.expressId === k.spaceId) ?? null;
    return { sp, k, fileRow, zoneRow, fileVolume: solidVolume(sp.faces), ruledVolume: ruled ? solidVolume(ruled.faces) : null };
  })();
  const rowArea = (r: SpaceFaceRow | null): number => {
    if (!r) return 0;
    const { u, v } = ((n: [number, number, number]) => {
      const a: [number, number, number] = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      const ux = a[1] * n[2] - a[2] * n[1], uy = a[2] * n[0] - a[0] * n[2], uz = a[0] * n[1] - a[1] * n[0];
      const l = Math.hypot(ux, uy, uz) || 1;
      const uu: [number, number, number] = [ux / l, uy / l, uz / l];
      const vv: [number, number, number] = [n[1] * uu[2] - n[2] * uu[1], n[2] * uu[0] - n[0] * uu[2], n[0] * uu[1] - n[1] * uu[0]];
      return { u: uu, v: vv };
    })(r.n);
    const ring = (rr: Array<[number, number, number]>): number => {
      let a = 0;
      for (let i = 0; i < rr.length; i++) {
        const p = rr[i]!, q = rr[(i + 1) % rr.length]!;
        const pu = p[0] * u[0] + p[1] * u[1] + p[2] * u[2], pv = p[0] * v[0] + p[1] * v[1] + p[2] * v[2];
        const qu = q[0] * u[0] + q[1] * u[1] + q[2] * u[2], qv = q[0] * v[0] + q[1] * v[1] + q[2] * v[2];
        a += pu * qv - qu * pv;
      }
      return Math.abs(a / 2);
    };
    return ring(r.outer) - r.holes.reduce((t, h) => t + ring(h), 0);
  };
  const fmtV = (m3: number): string => (imperial ? `${(m3 * FT * FT * FT).toFixed(0)} ft³` : `${m3.toFixed(2)} m³`);

  // Rulings are STAGED, then applied in one go. Before, each dropdown fired its
  // own rebuild and the only feedback was the geometry itself — which, while
  // "align" was mirroring walls across the house, looked like nothing happening
  // at all (user, 2026-09-01). The count says what is waiting.
  const pending = steps.filter(
    (st) => (stepChoices.get(st.key) ?? "keep") !== (choicesRef.current.get(st.key) ?? "keep"),
  ).length;
  const applyRulings = useCallback(() => {
    choicesRef.current = new Map(stepChoices);
    void rebuildIdf(choices, showSpaces ? FADED_SURFACE : fillOpacity, shellOn);
  }, [stepChoices, choices, showSpaces, fillOpacity, shellOn, rebuildIdf]);

  /** THE FILES BESIDE THE HOUSE, projected (user, 2026-09-07): every IFC in the folder is
   *  listed; the ruled ones (`_Site.ifc` by default) are read — terrain, shading elements —
   *  turned into the house frame by their own TrueNorth, keyed per file, and written into
   *  ifc.db; the SITE table reads the rows back. A shade file's interior equipment is left out. */
  const projectFiles = async (housePath: string, run: ExtractRun, db: Database): Promise<void> => {
    const sibs = await window.bim.listSiblings(housePath);
    const order = [...sibs].sort((a, b) => (a.name.toLowerCase() === "_site.ifc" ? -1 : b.name.toLowerCase() === "_site.ifc" ? 1 : a.name.localeCompare(b.name)));
    const rows: SiteFileRow[] = [];
    const all: Array<{ expressId: number; file: string; fileExpressId: number; name: string; ifcClass: string; xyz: Float32Array }> = [];
    const mepAll: Array<Omit<MepElementRow, "tris">> = [];
    const mepSystems: import("./core/db.js").MepSystemRow[] = [];
    const rooms = roomSolids(run.spaces.map((sp) => ({ faces: sp.faces, name: sp.longName ?? sp.name ?? `#${sp.expressId}` })));
    const words: string[] = [];
    let terrainDone = false, index = 0;
    fileLayersRef.current = new Map(); terrainRangesRef.current = [];
    for (const f of order) {
      if (!isProjected(f.name, siteFilesRulingRef.current)) { rows.push({ name: f.name, sha256: "", bytes: f.bytes, kind: "unread", projected: false, terrainTris: 0, elements: 0, word: "", turnDeg: 0 }); continue; }
      setStatus(`${f.name}: reading…`);
      await new Promise((r) => setTimeout(r, 30));
      const file = await window.bim.readSibling(housePath, f.name);
      if (!file) { rows.push({ name: f.name, sha256: "", bytes: f.bytes, kind: "unread", projected: false, terrainTris: 0, elements: 0, word: "could not be read", turnDeg: 0 }); continue; }
      const fb = new Uint8Array(file.bytes);
      const sha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", fb.slice().buffer)), (b) => b.toString(16).padStart(2, "0")).join("");
      const sapi = new WebIFC.IfcAPI();
      sapi.SetWasmPath(WASM_DIR, true);
      await sapi.Init();
      const sid = sapi.OpenModel(fb, { COORDINATE_TO_ORIGIN: false });
      const pr = projectSiteFile(sapi, sid, { name: f.name, index, houseTrueNorth: run.trueNorth, rooms, align: alignOf(f.name, siteFileAlignRef.current, siteFileTurnRef.current) });
      const lm = readLayers(sapi, sid);
      fileLayersRef.current.set(f.name, lm);
      let at = 0;
      const ranges = pr.terrainElements.map((t) => { const l = lm.get(t.expressId), r = { key: l ? layerKey(f.name, l) : null, start: at, n: t.tris }; at += t.tris; return r; });
      sapi.CloseModel(sid);
      index++;
      if (pr.terrain && !terrainDone) {
        siteShaRef.current = sha;
        // a ruling names the site file it was made on; another site file starts clean
        if (shadingRef.current.siteSha256 && shadingRef.current.siteSha256 !== sha) { shadingRef.current = { siteSha256: sha, deleted: [] }; setShadingDeleted([]); }
        const terrain = buildTerrain(pr.terrain, 0);     // already turned into the house frame
        terrain.rotationDeg = pr.rotationDeg;
        terrainRef.current = terrain;
        terrainRangesRef.current = ranges;
        writeTerrain(db, flattenTris(pr.terrain), { siteName: f.name, siteSha256: sha, rotationDeg: pr.rotationDeg });
        setTerrainInfo({ tris: pr.terrain.length, rotationDeg: pr.rotationDeg });
        terrainDone = true;
      }
      for (const e of pr.elements) all.push({ expressId: e.expressId, file: e.file, fileExpressId: e.fileExpressId, name: e.name, ifcClass: e.ifcClass, xyz: flattenTris(e.tris) });
      // the services inventory of a shade file, interior included — the SYSTEMS tab reads it (2026-09-10)
      if (pr.mep) {
        for (const e of pr.mep.elements) mepAll.push({ expressId: e.expressId, file: e.file, fileExpressId: e.fileExpressId, globalId: e.meta.globalId, name: e.name, kind: e.kind, ifcClass: e.ifcClass, predefinedType: e.meta.predefinedType, typeName: e.meta.typeName,
          discipline: e.discipline, interior: e.interior, room: e.room, storey: e.meta.storey, systems: e.meta.systems, uniformat: e.meta.uniformat, manufacturer: e.meta.manufacturer, model: e.meta.model, wattageW: e.meta.wattageW, powerW: e.meta.powerW, props: e.meta.props,
          cx: e.centroid[0], cy: e.centroid[1], cz: e.centroid[2], lod: e.lod, fileTris: e.fileTris, xyz: flattenTris(e.tris) });
        for (const sy of pr.mep.systems) mepSystems.push({ ...sy, file: f.name });
      }
      rows.push({ name: f.name, sha256: sha, bytes: f.bytes, kind: pr.kind, projected: true, terrainTris: pr.terrain?.length ?? 0, elements: pr.elements.length, word: pr.word, turnDeg: pr.turnDeg,
        dx: pr.align.dx, dy: pr.align.dy, dz: pr.align.dz, pivotX: pr.align.px, pivotZ: pr.align.pz });
      words.push(`${f.name}: ${pr.word}`);
    }
    if (!terrainDone) db.run("DROP TABLE IF EXISTS terrain");
    writeSiteElements(db, all);
    writeMepElements(db, mepAll);
    writeMepSystems(db, mepSystems);
    writeSiteFiles(db, rows);
    siteFileRowsRef.current = rows; setSiteFiles(siteFileRowsRef.current as typeof siteFiles);
    setSiteWord(words.join(" · "));
    publishLayers();
  };
  /** THE PER-FILE TURN typed in the SITE table (user, 2026-09-15, C1): a ruling in the ledger, the files projected again, idf.db rebuilt — the same path as the checkbox */
  const onTurnFile = useCallback(async (name: string, deg: number) => {
    const run = runRef.current, db = dbRef.current;
    if (!run || !db || !pathRef.current) return;
    // a file with an accepted placement turns that placement, about its own pivot (2026-11-03); else the older turn about the origin
    const placed = siteFileAlignRef.current[name];
    if (placed) siteFileAlignRef.current = { ...siteFileAlignRef.current, [name]: { ...placed, deg, at: new Date().toISOString() } };
    else { const next = { ...siteFileTurnRef.current }; if (deg) next[name] = deg; else delete next[name]; siteFileTurnRef.current = next; }
    setBusy(true);
    try {
      terrainRef.current = null; setTerrainInfo(null);
      await projectFiles(pathRef.current, run, db);
      stampIfcContentSha(db);
      await window.bim.saveDb("ifc.db", db.export());
      await rebuildIdf(choices, showSpaces ? FADED_SURFACE : fillOpacity, shellOn);
      setShowTerrain(true); showTerrainRef.current = true;
      applyTerrain(true);
      setStatus(`${name}: turned ${deg > 0 ? "+" : ""}${deg.toFixed(2)}° clockwise on top of its TrueNorth turn`);
    } catch (err) { setStatus(`failed: ${err instanceof Error ? err.message : String(err)}`); }
    finally { setBusy(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choices, showSpaces, fillOpacity, shellOn, rebuildIdf, applyTerrain]);
  /** the checkbox in the SITE table: a ruling in the ledger, the files projected again, idf.db rebuilt */
  const onProjectFile = useCallback(async (name: string, on: boolean) => {
    const run = runRef.current, db = dbRef.current;
    if (!run || !db || !pathRef.current) return;
    siteFilesRulingRef.current = { ...siteFilesRulingRef.current, [name]: on };
    setBusy(true);
    try {
      terrainRef.current = null; setTerrainInfo(null);
      await projectFiles(pathRef.current, run, db);
      stampIfcContentSha(db);
      await window.bim.saveDb("ifc.db", db.export());
      await rebuildIdf(choices, showSpaces ? FADED_SURFACE : fillOpacity, shellOn);
      setShowTerrain(true); showTerrainRef.current = true;
      applyTerrain(true);
      setStatus(`${name}: ${on ? "projected into" : "left out of"} the model`);
      if (on && !siteFileAlignRef.current[name]) { alignAskedRef.current.delete(name); askAlignRef.current(); }
    } catch (err) { setStatus(`failed: ${err instanceof Error ? err.message : String(err)}`); }
    finally { setBusy(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choices, showSpaces, fillOpacity, shellOn, rebuildIdf, applyTerrain]);
  // ── THE ALIGNMENT DIALOG (user, 2026-11-03) ────────────────────────────────────────────────────────────────────────────────
  const projectedFiles = (): string[] => (siteFileRowsRef.current as SiteFileRow[]).filter((f) => f.projected).map((f) => f.name);
  const redrawSoon = (): void => { requestAnimationFrame(() => applyTerrain(showTerrainRef.current)); };
  /** open the dialog on a file (the first projected one when none is named); the BIM views are where it is seen */
  const openAlign = (file?: string, note?: string): void => {
    const files = projectedFiles();
    const f = file && files.includes(file) ? file : files[0];
    if (!f) { setStatus("Edit Alignment: no file beside the house is in the model — project one from BEM › SITE first"); return; }
    alignAskedRef.current.add(f);
    setAlignEdit({ file: f, draft: appliedAlign(f), pick: null, from: null, note: note ?? null, locks: NO_LOCKS });
    if (!tabRef.current.startsWith("bim")) setTab("bim-edit");
    redrawSoon();
  };
  /** after a load or a projection: a projected file with no accepted placement is shown in the dialog, once per window */
  const askAlign = (): void => {
    if (alignEditRef.current) return;
    const f = projectedFiles().find((n) => !siteFileAlignRef.current[n] && !alignAskedRef.current.has(n));
    if (f) openAlign(f, `${f} is placed by its TrueNorth turn alone — check where it sits against the house, then Accept (or move it first)`);
  };
  const askAlignRef = useRef(askAlign); askAlignRef.current = askAlign;
  const stopPick = (): void => { ifcPaneRef.current?.pickPoint(null); };
  const onAlignDraft = (a: FileAlign): void => {
    const ed = alignEditRef.current;
    if (!ed) return;
    setAlignEdit({ ...ed, draft: a, note: null });
    placePreview();
  };
  const onAlignFile = (name: string): void => {
    stopPick();
    setAlignEdit({ file: name, draft: appliedAlign(name), pick: null, from: null, note: null, locks: NO_LOCKS });
    alignAskedRef.current.add(name);
    redrawSoon();
  };
  const onAlignPick = (mode: AlignPick): void => {
    const ed = alignEditRef.current;
    if (!ed) return;
    setAlignEdit({ ...ed, pick: mode, from: null, note: null });
    if (!mode) { stopPick(); return; }
    ifcPaneRef.current?.pickPoint((hit) => {
      const cur = alignEditRef.current;
      if (!cur || !cur.pick) return;
      if (!hit) { setAlignEdit({ ...cur, note: "nothing under the cursor there — click on the house or the file" }); return; }
      const [x, , z] = hit.point;
      if (cur.pick === "pivot") { stopPick(); setAlignEdit({ ...cur, pick: null, draft: setPivot(cur.draft, x, z), note: null }); placePreview(); return; }
      if (cur.pick === "from") {
        if (!hit.onFile) { setAlignEdit({ ...cur, note: `that point is not on ${cur.file} — click the file itself` }); return; }
        setAlignEdit({ ...cur, pick: "to", from: hit.point, note: null });
        return;
      }
      if (cur.pick === "to" && cur.from) {
        if (hit.onFile) { setAlignEdit({ ...cur, note: "that point is on the file — click the HOUSE point it belongs on" }); return; }
        stopPick();
        setAlignEdit({ ...cur, pick: null, from: null, draft: matchPoint(cur.draft, cur.from, hit.point, cur.locks), note: lockedWord(cur.locks) ? `matched but for the locked ${lockedWord(cur.locks)} — where the point landed is now the pivot` : "matched — that point is now the pivot; turn to bring the rest in line" });
        placePreview();
      }
    });
  };
  const lockedWord = (l: AxisLocks): string => [l.east ? "east" : "", l.north ? "north" : "", l.up ? "up" : ""].filter(Boolean).join(" and ");
  const onAlignLocks = (l: AxisLocks): void => { const ed = alignEditRef.current; if (ed) setAlignEdit({ ...ed, locks: l }); };
  const closeAlign = (): void => {
    stopPick();
    setAlignEdit(null);
    redrawSoon();
  };
  /** Accept: the placement into the ledger, the files projected again (ifc.db's site_files keeps the move, the pivot and the turn), idf.db rebuilt */
  const acceptAlign = async (): Promise<void> => {
    const ed = alignEditRef.current, run = runRef.current, db = dbRef.current;
    if (!ed || !run || !db || !pathRef.current) return;
    stopPick();
    siteFileAlignRef.current = { ...siteFileAlignRef.current, [ed.file]: { ...ed.draft, at: new Date().toISOString() } };
    const turns = { ...siteFileTurnRef.current }; delete turns[ed.file]; siteFileTurnRef.current = turns;
    setAlignEdit(null);
    setBusy(true);
    try {
      terrainRef.current = null; setTerrainInfo(null);
      await projectFiles(pathRef.current, run, db);
      stampIfcContentSha(db);
      await window.bim.saveDb("ifc.db", db.export());
      await rebuildIdf(choices, showSpaces ? FADED_SURFACE : fillOpacity, shellOn);
      applyTerrain(showTerrainRef.current);
      const a = ed.draft;
      setStatus(`${ed.file}: placed — ${isIdentity(a) ? "its TrueNorth turn alone" : `moved (${a.dx.toFixed(3)}, ${a.dy.toFixed(3)}, ${a.dz.toFixed(3)}) m, turned ${a.deg.toFixed(3)}° clockwise about (${a.px.toFixed(3)}, ${a.pz.toFixed(3)})`}; ifc.db and idf.db rebuilt`);
    } catch (err) { setStatus(`failed: ${err instanceof Error ? err.message : String(err)}`); }
    finally { setBusy(false); }
    askAlign();
  };
  /** the corrections ledger into the refs and the state that every rebuild reads — on load, and again when the file's changes are ruled on */
  const seedCorrections = useCallback((ledger: CorrectionsLedger | null) => {
    choicesRef.current = new Map(Object.entries(ledger?.steps ?? {}) as Array<[string, StepChoice]>);
    setStepChoices(new Map(choicesRef.current));
    editsRef.current = ledger?.extends ?? [];
    setEdits(editsRef.current);
    spaceEditsRef.current = ledger?.spaceExtends ?? [];
    setSpaceEdits(spaceEditsRef.current);
    glazingRef.current = new Map(Object.entries(ledger?.glazing ?? {}));
    setGlazing(new Map(glazingRef.current));
    voidRulingsRef.current = (ledger?.voids ?? {}) as Record<string, VoidRuling>;
    setVoidRulings({ ...voidRulingsRef.current });
    undoHistoryRef.current = [];
    zonesRef.current = ledger?.zones ?? { spaces: {}, voids: {} };
    deletesRef.current = ledger?.deletes ?? [];
    shadingRef.current = ledger?.shading ?? { siteSha256: "", deleted: [] };
    setShadingDeleted(shadingRef.current.deleted);
    siteFilesRulingRef.current = ledger?.siteFiles ?? {};
    siteFileTurnRef.current = ledger?.siteFileTurn ?? {};
    siteFileAlignRef.current = (ledger?.siteFileAlign ?? {}) as Record<string, FileAlign>;
    alignAskedRef.current = new Set();
    carriedRef.current = ledger?.carried ?? null;
  }, []);
  const loadPicked = useCallback(async (picked: { name: string; path: string; bytes: Uint8Array }) => {
    if (loadingRef.current) { setStatus("a file is still loading — wait for it"); return; }   // one load at a time (2026-09-10)
    setBusy(true);
    loadingRef.current = true;
    try {
      const bytes = new Uint8Array(picked.bytes);
      pathRef.current = picked.path;
      bytesRef.current = bytes;
      setStatus(`${picked.name}: converting for the IFC view…`);
      await ifcPaneRef.current!.loadIfc(bytes, picked.name);

      setStatus(`${picked.name}: extracting surfaces…`);
      await new Promise((r) => setTimeout(r, 30)); // let the status paint
      const api = new WebIFC.IfcAPI();
      api.SetWasmPath(WASM_DIR, true);
      await api.Init();
      const modelID = api.OpenModel(bytes);
      const run = runExtraction(api, modelID);
      houseLayersRef.current = readLayers(api, modelID);
      api.CloseModel(modelID);
      runRef.current = run;

      const s = run.stats;
      const identity = s.triAreaM2 > 0 ? Math.abs(s.faceAreaM2 - s.triAreaM2) / s.triAreaM2 : 0;
      const fallbackPct = (100 * s.fallbackAreaM2) / Math.max(1e-9, s.triAreaM2);
      const ok = identity <= 0.001 && s.worstElementDelta <= 0.001;
      setGate({
        ok,
        text:
          `${s.elements} els · ${s.faces.toLocaleString()} faces · ` +
          `Δarea ${(identity * 100).toFixed(3)}% · fallback ${fallbackPct.toFixed(2)}%`,
      });

      setStatus(`${picked.name}: writing ifc.db…`);
      const sha = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice().buffer)),
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
      shaRef.current = sha;
      nameRef.current = picked.name;
      // THE LEDGERS: this file's rulings, made in an earlier session, come back
      // before the first build so nothing has to be redone by hand (the
      // Great-room wall was being re-extended every load). All three are keyed
      // to the file's sha256.
      let ledger = await window.bim.loadCorrections(sha);
      let bemLed = (await window.bem.loadDecisions(sha)) as BemLedger | null;
      let bomLed = (await window.bom.loadLedger(sha)) as BomLedger | null;
      const SQL = await getSql(wasmUrl);
      // WHICH VERSION IS THIS (2026-09-30, the user's rulings): the project is the IfcProject GlobalId the file states, a
      // version its sha. A file with ledgers of its own is that version. One without is compared against every version of
      // its project that HAS ledgers (their FileIndex is in the store) — and, as before 2026-09-30, against the previous
      // ifc.db when its sha has ledgers — and the closest is its parent: the rulings are carried across the diff and the
      // user rules on each one the file changed under. What was decided is said on screen, never only in the console.
      const proj = run.project ?? null;
      const cands: VersionCandidate[] = [];
      const addCand = async (v: StoredVersion, index: FileIndex | null): Promise<void> => {
        if (v.sha === sha || cands.some((c) => c.sha === v.sha) || !v.ledgers.length) return;
        const idx = index ?? (await window.projects.versionIndex(v.sha)) as FileIndex | null;
        if (idx) cands.push({ sha: v.sha, fileName: v.fileName, madeBy: v.madeBy, createdAt: v.createdAt, index: idx, ledgers: v.ledgers });
      };
      const ownLedgers = !!(ledger || bemLed || bomLed);
      if (!ownLedgers) {
        if (proj) for (const v of await window.projects.versions(proj.globalId)) await addCand(v, null);
        // the previous ifc.db, before it is overwritten: its sha, if it has ledgers, is a candidate (a version migrated
        // from data/ gets its index here the first time)
        const prevBytes = await window.bem.readDataFile("ifc.db");
        if (prevBytes) {
          const pdb = new SQL.Database(prevBytes);
          try {
            const prevSha = readMeta(pdb).get("source_sha256") ?? "";
            const pv = prevSha && prevSha !== sha ? await window.projects.version(prevSha) : null;
            if (pv && pv.ledgers.length && !cands.some((c) => c.sha === prevSha)) {
              setStatus(`${picked.name}: the file changed — reading the previous ifc.db…`);
              await new Promise((r) => setTimeout(r, 30));
              const idx = indexIfcDb(pdb);
              await addCand(pv, idx);
              if (!pv.hasIndex) await window.projects.registerVersion({ sha: prevSha, index: idx });
            }
          } finally { pdb.close(); }
        }
      }
      const db = buildIfcDb(SQL, run, { sourceName: picked.name, sourceSha256: sha });
      carryRef.current = null; setCarry(null);
      const next = indexIfcDb(db);
      const here = await window.projects.version(sha);
      const record: VersionRecord = { sha, projectId: proj?.globalId, projectName: proj?.name, projectLongName: proj?.longName, fileName: picked.name, filePath: picked.path, index: here?.hasIndex ? undefined : next };
      const pct = (x: number): string => `${(100 * x).toFixed(1)} %`;
      // the sidecar a writer of versions (BIMedit) leaves beside the file names its parent EXACTLY
      const sideBytes = await window.bim.readSibling(picked.path, `${picked.name}.lineage.json`);
      const side = readLineageSidecar(sideBytes ? new TextDecoder().decode(sideBytes.bytes) : null, sha);
      if (side.problem) console.warn(`[bim] ${picked.name}.lineage.json: ${side.problem}`);
      const sideNote = side.sidecar ? ` Made by ${side.sidecar.madeBy}${side.sidecar.edits?.length ? ` (${side.sidecar.edits.length} edit${side.sidecar.edits.length === 1 ? "" : "s"}: ${side.sidecar.edits.slice(0, 3).join("; ")}${side.sidecar.edits.length > 3 ? " …" : ""})` : ""}, as its lineage file states.` : "";
      const projWord = proj ? `project ${proj.longName ?? proj.name ?? proj.globalId}` : "a file that states no IfcProject";
      if (!ownLedgers) {
        const { ranked, eligible } = rankParents(next, cands);
        // the parent the sidecar names wins when the store holds it with ledgers; else the ranking decides
        const named = side.sidecar ? ranked.find((r) => r.sha === side.sidecar!.parentSha256 && r.ledgers.length) ?? null : null;
        const best = named ?? eligible[0] ?? null;
        if (best) {
          const [pc, pb, pbom] = await Promise.all([window.bim.loadCorrections(best.sha), window.bem.loadDecisions(best.sha) as Promise<BemLedger | null>, window.bom.loadLedger(best.sha)]);
          const prevLedgers: Ledgers = { corrections: pc, bem: pb, bom: pbom };
          const diff = diffIndex(best.index, next);
          const c = carryRulings(best.index, next, diff, prevLedgers);
          const built = c.build(() => true);   // the default keeps every ruling the file changed under; the panel offers the file's word per row
          ledger = built.corrections; bemLed = built.bem; bomLed = built.bom as BomLedger | null;
          if (ledger) await window.bim.saveCorrections(sha, ledger);
          if (bemLed) await window.bem.saveDecisions(sha, bemLed);
          if (bomLed) await window.bom.saveLedger(sha, bomLed);
          const st: CarryState = { prev: { index: best.index, ledgers: prevLedgers }, next, diff, cases: c.cases, carry: c, take: new Set(), applied: new Set(), record: built.record, prevAt: pc?.savedAt ?? pb?.savedAt ?? "" };
          carryRef.current = st; setCarry(st);
          setOpen((o) => new Set([...o, "changed"]));
          await window.projects.registerVersion({ ...record, parentSha: best.sha, madeBy: named ? side.sidecar!.madeBy : "carried", note: named ? `named by ${picked.name}.lineage.json${side.sidecar!.edits?.length ? `: ${side.sidecar!.edits.join("; ")}` : ""}` : `${pct(best.overlap)} of GlobalIds in common with ${best.sha.slice(0, 12)}` });
          setProjectNote({ tone: "info", text: `${picked.name} is a NEW version of ${projWord}. Its rulings were carried from ${versionLabel(best)}${named ? " — the parent its lineage file names" : ""} — ${pct(best.overlap)} of GlobalIds in common, ${best.changed} elements changed, ${best.added} added, ${best.removed} removed; rule on each change under "file changed".${sideNote}${!named && eligible.length > 1 ? ` Other versions it could have come from: ${eligible.slice(1, 4).map((r) => `${r.sha.slice(0, 12)} (${pct(r.overlap)})`).join(", ")}.` : ""}${side.sidecar && !named ? ` Its lineage file names ${side.sidecar.parentSha256.slice(0, 12)}, which the store does not hold with rulings — the closest version was used instead.` : ""}` });
        } else {
          await window.projects.registerVersion({ ...record, madeBy: "opened" });
          setProjectNote({ tone: "warn", text: `${picked.name}: no rulings were found for this file${proj ? ` or ${projWord}` : ""}${ranked[0] ? ` — the closest stored version, ${ranked[0].sha.slice(0, 12)}, has only ${pct(ranked[0].overlap)} of its GlobalIds in common` : ""}. It starts with none; what you rule on is kept for it from here.` });
        }
      } else {
        // this exact version: the store learns its project and index; a version with no parent yet (one migrated from
        // data/, or first opened before the store) is given the closest of its project's other versions — the lineage only,
        // nothing carried, since it has rulings of its own
        let parent: RankedParent | null = null;
        // A VERSION MADE FROM THIS ONE IS NEVER ITS PARENT (user, 2026-10-23): reopening the current file after an older one
        // had offered the older one — recorded as made FROM this file — as its parent, the store refused the cycle and the
        // refusal read as "NOT SAVED". The descendants are read from the store's own parent links
        const all = proj ? await window.projects.versions(proj.globalId) : [];
        const parentOf = new Map(all.map((x) => [x.sha, x.parentSha ?? null] as const));
        const descends = (s: string): boolean => { for (let a = parentOf.get(s) ?? null, n = 0; a && n < 10000; n++) { if (a === sha) return true; a = parentOf.get(a) ?? null; } return false; };
        if (side.sidecar && !here?.parentSha) {
          try { const v0 = await window.projects.registerVersion({ ...record, parentSha: side.sidecar.parentSha256, madeBy: side.sidecar.madeBy, note: `named by ${picked.name}.lineage.json` }); if (v0.parentSha) { setProjectNote({ tone: "info", text: `${picked.name}: ${projWord} · this version ${sha.slice(0, 12)}, made by ${v0.madeBy} from ${v0.parentSha.slice(0, 12)}.${sideNote} Its own rulings are loaded.` }); } }
          catch (e) { console.warn(`[bim] the lineage file's parent was not recorded: ${e instanceof Error ? e.message : String(e)}`); }
        } else if (proj && !here?.parentSha) {
          const others: VersionCandidate[] = [];
          for (const v of all) {
            if (v.sha === sha || !v.hasIndex || descends(v.sha)) continue;
            const idx = (await window.projects.versionIndex(v.sha)) as FileIndex | null;
            if (idx) others.push({ sha: v.sha, fileName: v.fileName, madeBy: v.madeBy, createdAt: v.createdAt, index: idx, ledgers: v.ledgers });
          }
          parent = rankParents(next, others, { ledgers: false }).eligible[0] ?? null;
        }
        let v: StoredVersion = here as StoredVersion;
        try { v = await window.projects.registerVersion(parent ? { ...record, parentSha: parent.sha, madeBy: "inferred", note: `the closest version by GlobalIds: ${pct(parent.overlap)} in common` } : record); }
        catch (e) { v = await window.projects.registerVersion(record); console.warn(`[bim] the lineage was not recorded: ${e instanceof Error ? e.message : String(e)}`); }
        setProjectNote(v.parentSha ? { tone: "info", text: `${picked.name}: ${projWord} · this version ${sha.slice(0, 12)}, made ${v.madeBy === "inferred" ? "(by the closest match)" : v.madeBy} from ${v.parentSha.slice(0, 12)}. Its own rulings are loaded.` } : null);
      }
      await refreshProject(proj);
      setProjectOpNote("");
      seedCorrections(ledger);
      // the BEM ledger, keyed to the same IFC sha; the last run belongs to the last file
      bemLedgerRef.current = bemLed;
      setBemLedger(bemLedgerRef.current);
      setBemEpw(bemLedgerRef.current?.weather?.epw ?? null);
      setSiteStage(null);
      bemModelRef.current = null; setBemModel(null); setValidation(null);
      bemRef.current = null; setBem(null); lensRef.current = null; setLens("none"); setLegend(null); setSelZone(null);
      // the BOM ledger: the imports come back from their raw files with the user's column maps
      bomLedgerRef.current = bomLed;
      bomLedgerLoadedFor.current = sha;
      // a room's setup carried from the window's storage while the ledger was loading joins it now — a room the ledger holds wins
      {
        const pend = Object.entries(cfdPending.current).filter(([sp]) => !bomLed?.cfd?.rooms?.[sp]);
        cfdPending.current = {};
        if (pend.length) {
          const base: BomLedger = bomLed ?? { sourceIfcSha256: sha, savedAt: "", imports: [], excluded: [], meterMap: {} };
          bomLedgerRef.current = { ...base, cfd: { rooms: { ...(base.cfd?.rooms ?? {}), ...Object.fromEntries(pend) } } };
          void window.bom.saveLedger(sha, bomLedgerRef.current);
        }
      }
      setBomTariff(bomLed?.tariff);
      bomRef.current = null; setBom(null); setBomPending(null);
      {
        const imps: BomImport[] = [];
        for (const i of bomLedgerRef.current?.imports ?? []) {
          const text = await window.bom.readImport(i.sha256.slice(0, 12), "csv");
          if (text !== null) imps.push(importBills(i.name, text, i.columnMap as Partial<BillColumnMap>));
        }
        // the statements: the newer of the ledger's and the browser's copy; yesterday's sheet ("bills entered by hand.csv") converted
        // once into statements and left out of the imports — its file stays under data/bom/imports/
        let journal: StatementsLedger | null = null;
        try { const j = window.localStorage.getItem(`bim-bom-statements:${sha}`); journal = j ? JSON.parse(j) as StatementsLedger : null; } catch { journal = null; }
        const found = newestStatements(bomLed?.statements, journal) ?? emptyStatements();
        let led = upgradeStatements(found);
        { const filled = fillRates(led.bills); if (JSON.stringify(filled) !== JSON.stringify(led.bills)) led = { ...led, bills: filled, at: new Date().toISOString() }; }
        const hand = imps.find((i) => i.name === "bills entered by hand.csv");
        if (hand) {
          if (!led.bills.length) led = { ...led, bills: statementsFromHandCsv(hand.text, led.formats[0] ?? DEFAULT_BILL_FORMAT), at: new Date().toISOString() };
          imps.splice(imps.indexOf(hand), 1);
        }
        bomStatementsRef.current = led; setBomStatements(led);
        bomImportsRef.current = imps; setBomImports(imps);
        // the calibration run's inputs and its last run (2026-10-09)
        setCalPvOn(bomLed?.calibration?.pvOn ?? "");
        {
          const pv = bomLed?.calibration?.pv;
          const text = pv ? await window.bom.readImport(pv.sha256.slice(0, 12), "csv") : null;
          const read = text ? parsePvCsv(text) : null;
          setCalPv(pv && read && !("error" in read) ? { name: pv.name, read } : null);
          const SQL = await getSql(wasmUrl);
          const last = await readLatestCalibration(SQL).catch(() => null);
          setCalRun(last ? await calibrationView(last) : null);
        }
        if (hand || (journal && journal === found) || led !== found) saveBomLedger();
        const ex = new Set(bomLedgerRef.current?.excluded ?? []);
        bomExcludedRef.current = ex; setBomExcluded(ex);
      }
      zoneSpaceRowsRef.current = [];
      ruledSpacesRef.current = [];
      setSelSpace(null);
      setZoneStage(ledger?.staged?.zones ?? {});
      hiddenSiteRef.current = new Set(); selSiteRef.current = new Set(); setSelSite(new Set());
      {
        const staged = bemLed?.staged; const nCons = Object.keys(staged?.constructions ?? {}).length; const nZones = Object.keys(ledger?.staged?.zones ?? {}).length; const nSched = Object.keys(staged?.schedules ?? {}).length;
        const stagedNote = nCons + nZones + nSched || staged?.site || staged?.ground ? ` · staged, not yet applied: ${[nCons ? `${nCons} constructions` : "", staged?.ground ? "the ground method" : "", staged?.site ? "site settings" : "", nSched ? `${nSched} schedules` : "", nZones ? `${nZones} zone rulings` : ""].filter(Boolean).join(", ")} (${(staged?.at ?? ledger?.staged?.at ?? "").slice(0, 16).replace("T", " ")})` : "";
        setLedgerNote(ledger
          ? `${Object.keys(ledger.steps).length} rulings + ${ledger.extends.length} extensions${(ledger.spaceExtends ?? []).length ? ` + ${(ledger.spaceExtends ?? []).length} space extensions` : ""}${Object.keys(ledger.glazing ?? {}).length ? ` + ${Object.keys(ledger.glazing ?? {}).length} glazing rulings` : ""} restored from ${ledger.savedAt.slice(0, 10)}${ledger.carried ? ` · carried from ${ledger.carried.fromSha.slice(0, 12)} on ${ledger.carried.at.slice(0, 10)}: ${ledger.carried.carried} unchanged, ${ledger.carried.kept.length} kept over the file's change, ${ledger.carried.overwritten.length} overwritten, ${ledger.carried.dropped.length} dropped` : ""}${stagedNote}`
          : stagedNote.replace(/^ · /, ""));
      }
      // THE SITE beside the house: its terrain, turned into the house frame by
      // the house's own TrueNorth (the site is true-north-up; the user's rule),
      // stored in ifc.db so the views draw what the grade cut used
      terrainRef.current = null;
      setTerrainInfo(null);
      setSiteAddress(run.address);
      setSiteFocus("model"); setFocusStation(null); setLocPick(null);
      await projectFiles(picked.path, run, db);
      dbRef.current = db;
      stampIfcContentSha(db);                 // the source file + the site beside it
      const savedTo = await window.bim.saveDb("ifc.db", db.export());
      console.log(`[bim] ifc.db saved → ${savedTo}`);

      ifcPaneRef.current!.fitTo(run.bbox.min, run.bbox.max);
      setLoadedAt(Date.now());
      rebuildDbView(showAll, showSpaces ? FADED_SURFACE : fillOpacity);
      await rebuildIdf(choices, showSpaces ? FADED_SURFACE : fillOpacity, shellOn);
      applySpaces(showSpaces);
      // the LIVE checkbox, not the state this async load captured when it began:
      // opening the SITE page switches the shading on while the load is still
      // running, and the captured `false` erased it (measured over CDP, 2026-09-05)
      applyTerrain(showTerrainRef.current);
      // the file this window has open — a reload (a crash recovered, a merge) reopens it; a new window starts empty
      try { window.sessionStorage.setItem(OPEN_FILE_KEY, picked.path); } catch { /* the reopen is a convenience */ }
      if (window.projectNow) void window.projectFolder.setOpenIfc(picked.path);
      askAlignRef.current();   // a file beside the house with no accepted placement is shown in the alignment dialog
    } catch (err) {
      console.error(err);
      setStatus(`failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      loadingRef.current = false;
      setBusy(false);
      setLoadGen((g) => g + 1);   // an edit made during the load is written now
    }
  }, [rebuildDbView, rebuildIdf, applySpaces, applyTerrain, choices, showAll, fillOpacity, shellOn, showSpaces, showTerrain, seedCorrections]);
  loadPickedRef.current = loadPicked;
  /** THE FILE CHANGED — the user's choices applied: the ledgers rebuilt from the previous file's with the file's word taken where ruled so, saved under this hash, the model rebuilt */
  const applyCarry = useCallback(async () => {
    const st = carryRef.current;
    if (!st) return;
    setBusy(true);
    try {
      const built = st.carry.build((c) => !st.take.has(c.id));
      seedCorrections(built.corrections);
      bemLedgerRef.current = built.bem; setBemLedger(built.bem); setBemEpw(built.bem?.weather?.epw ?? null);
      await window.bim.saveCorrections(shaRef.current, built.corrections ?? ledgerJson(shaRef.current));
      if (built.bem) await window.bem.saveDecisions(shaRef.current, built.bem);
      const next: CarryState = { ...st, record: built.record, applied: new Set(st.take) };
      carryRef.current = next; setCarry(next);
      setStatus(`the file's changes ruled on: ${built.record.carried} carried · ${built.record.kept.length} kept · ${built.record.overwritten.length} overwritten by the file · ${built.record.dropped.length} dropped`);
      await rebuildIdf(choices, showSpaces ? FADED_SURFACE : fillOpacity, shellOn);
    } finally { setBusy(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedCorrections, rebuildIdf, choices, showSpaces, fillOpacity, shellOn]);
  // OPEN IFC… (2026-11-12, a project is a folder): a file in the open project's ifc/ opens; a file in another project's opens that project;
  // any other file starts a NEW PROJECT — copied into the project's folder, the original left where it is
  const openIfc = useCallback(async () => {
    const picked = await window.bim.openIfc();
    if (!picked) return;
    const owner = await window.projectFolder.ofIfc(picked.path);
    if (owner && owner === window.projectNow?.dir) { await loadPicked(picked); return; }
    if (owner) { await switchProject(owner, picked.path); return; }
    const sibs = await window.bim.listSiblings(picked.path);
    setNewProject({ ifc: picked.path, siblings: sibs.map((x) => x.path) });
  }, [loadPicked]);   // eslint-disable-line react-hooks/exhaustive-deps
  /** another project in force: main opens its folder, the page reloads on it, opening `ifc` (else the IFC it last had open) */
  const switchProject = async (dir: string | null, ifc?: string): Promise<void> => {
    if (shaRef.current && runRef.current) await window.bim.saveCorrections(shaRef.current, ledgerJson(shaRef.current));
    const info = await window.projectFolder.open(dir);
    try {
      const next = ifc ?? info?.openIfc ?? null;
      if (next) window.sessionStorage.setItem(OPEN_FILE_KEY, next); else window.sessionStorage.removeItem(OPEN_FILE_KEY);
    } catch { /* the reopen is a convenience */ }
    window.location.reload();
  };
  const [newProject, setNewProject] = useState<{ ifc: string | null; siblings: string[] } | null>(null);
  const [recentProjects, setRecentProjects] = useState<Array<{ dir: string; name: string }>>([]);
  const [examples, setExamples] = useState<Array<{ name: string; ifcs: string[] }>>([]);
  useEffect(() => { if (openMenu) { void window.projectFolder.recent().then(setRecentProjects); void window.projectFolder.examples().then(setExamples); } }, [openMenu]);
  /** CLOSE IFC… · ALL (user, 2026-10-23, asked first): the house and the files beside it leave the window, which starts empty — the
   *  corrections ledger written now, the BEM drafts by the pagehide flush; the reopen key forgotten so the reload opens nothing */
  const closeAll = useCallback(async () => {
    setCloseMenu(null);
    const name = nameRef.current || "the house";
    if (!window.confirm(`Close ${name} and the files beside it?\n\nYour rulings are on disk; Open IFC… brings the house back.`)) return;
    if (shaRef.current && runRef.current) await window.bim.saveCorrections(shaRef.current, ledgerJson(shaRef.current));
    try { window.sessionStorage.removeItem(OPEN_FILE_KEY); } catch { /* the reopen is a convenience */ }
    window.location.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // DELETE FROM THE IFC. The user rules that an element is not there; the
  // source file is rewritten losslessly (the previous bytes backed up beside
  // it), the ledger follows the file's new hash with the deletion recorded,
  // and the file is loaded again so all three views show what remains.
  const deleteElement = useCallback(async (elementId: number) => {
    setMenu(null);
    const bytes = bytesRef.current;
    const el = runRef.current?.elements.find((e) => e.expressId === elementId);
    if (!bytes || !pathRef.current || !el) return;
    const label = `#${elementId} ${el.ifcClass}${el.name ? ` "${el.name}"` : ""}`;
    if (!window.confirm(`Delete ${label} from the IFC file?\n\n${pathRef.current}\n\nThe file is rewritten in place (every other byte kept) and the previous bytes are saved beside it.`)) return;
    setBusy(true);
    setStatus(`deleting ${label} from the IFC…`);
    try {
      const text = new TextDecoder("latin1").decode(bytes);
      const { text: next, report } = deleteFromStep(text, [elementId]);
      if (!report.ok) { setStatus(`delete refused: ${formatDelete(report).join(" ")}`); return; }
      const out = new Uint8Array(next.length);
      for (let i = 0; i < next.length; i++) out[i] = next.charCodeAt(i) & 0xff;
      const { backup } = await window.bim.writeIfc(pathRef.current, out);
      const sha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", out.slice().buffer)), (b) => b.toString(16).padStart(2, "0")).join("");
      deletesRef.current = [...deletesRef.current, { expressId: elementId, globalId: el.globalId, ifcClass: el.ifcClass, name: el.name, at: new Date().toISOString(), backup }];
      // the ledgers follow the file: same rulings, new hash, the deletion on record
      await window.bim.saveCorrections(sha, ledgerJson(sha));
      if (bemLedgerRef.current) await window.bem.saveDecisions(sha, { ...bemLedgerRef.current, sourceIfcSha256: sha });
      if (bomLedgerRef.current) await window.bom.saveLedger(sha, { ...bomLedgerRef.current, sourceIfcSha256: sha });
      // the lineage, exactly (2026-09-30): the new version was made from the one open, by this deletion
      const proj = runRef.current?.project ?? null;
      await window.projects.registerVersion({ sha, projectId: proj?.globalId, projectName: proj?.name, projectLongName: proj?.longName, parentSha: shaRef.current || null, madeBy: "delete-from-ifc", note: `${label} deleted`, fileName: nameRef.current, filePath: pathRef.current });
      setStatus(`${label} deleted · ${formatDelete(report)[0]!.trim()} · backup ${backup.split(/[\\/]/).pop()}`);
      await ifcPaneRef.current?.clear();
      await loadPicked({ name: nameRef.current, path: pathRef.current, bytes: out });
    } catch (err) {
      setStatus(`delete failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [loadPicked]);

  // ZONE RULINGS: every room and attic can be assigned to another zone
  const allZoneNames = useMemo(() => {
    const rooms = runRef.current?.spaces.map((sp) => sp.longName ?? sp.name ?? `#${sp.expressId}`) ?? [];
    const at = attics?.attics.map((a) => a.name) ?? [];
    return [...rooms, ...at];
  }, [attics]);
  const currentZoneTarget = useCallback((name: string): string =>
    zonesRef.current.spaces[name] ?? zonesRef.current.voids[name] ?? name, []);
  const zonePending = allZoneNames.filter((n) => (zoneStage[n] ?? currentZoneTarget(n)) !== currentZoneTarget(n)).length;
  const applyZones = useCallback(() => {
    const roomNames = new Set(runRef.current?.spaces.map((sp) => sp.longName ?? sp.name ?? `#${sp.expressId}`) ?? []);
    const next: ZoneRulings = { spaces: {}, voids: {} };
    for (const n of allZoneNames) {
      const t = zoneStage[n] ?? currentZoneTarget(n);
      if (t === n) continue;
      (roomNames.has(n) ? next.spaces : next.voids)[n] = t;
    }
    zonesRef.current = next;
    setZoneStage({});
    void rebuildIdf(choices, showSpaces ? FADED_SURFACE : fillOpacity, shellOn);
  }, [allZoneNames, zoneStage, currentZoneTarget, choices, showSpaces, fillOpacity, shellOn, rebuildIdf]);

  // A LOST 3-D VIEW (2026-10-09): Chromium reports a WebGL context lost when its GPU process dies. The IFC view's geometry is freed
  // after upload, so a restored context cannot draw it again — the page is reloaded (the house reopens) unless the context comes back by
  // itself within four seconds. The main process reloads too on the GPU process's exit; one reload is enough.
  useEffect(() => {
    let timer: number | null = null;
    const lost = (e: Event): void => {
      if (!(e.target instanceof HTMLCanvasElement) || timer !== null) return;
      setStatus("a 3-D view lost its graphics context — reloading in 4 s unless it comes back (the house reopens; your work is on disk)");
      timer = window.setTimeout(() => window.location.reload(), 4000);
    };
    const back = (e: Event): void => { if (e.target instanceof HTMLCanvasElement && timer !== null) { window.clearTimeout(timer); timer = null; } };
    // the IFC view failing frame after frame (view/ifcPane.ts) — the same reload
    const broken = (e: Event): void => {
      if (timer !== null) return;
      setStatus(`a 3-D view stopped drawing (${String((e as CustomEvent).detail ?? "")}) — reloading in 4 s (the house reopens; your work is on disk)`);
      timer = window.setTimeout(() => window.location.reload(), 4000);
    };
    window.addEventListener("bim-render-broken", broken);
    document.addEventListener("webglcontextlost", lost, true);
    document.addEventListener("webglcontextrestored", back, true);
    return () => { window.removeEventListener("bim-render-broken", broken); document.removeEventListener("webglcontextlost", lost, true); document.removeEventListener("webglcontextrestored", back, true); if (timer !== null) window.clearTimeout(timer); };
  }, []);
  // THE HEAP WATCH (2026-10-09): the renderer dies at its heap limit (V8 OOM after ~16 h, three times); past 85 % of it the app says so
  // and offers the reload that frees it, before the crash does it without asking
  useEffect(() => {
    const m = (): void => {
      const pm = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
      if (!pm) return;
      setMemHigh(pm.usedJSHeapSize > 0.85 * pm.jsHeapSizeLimit ? { used: pm.usedJSHeapSize, limit: pm.jsHeapSizeLimit } : null);
    };
    m();
    const id = window.setInterval(m, 30_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="app">
      <ExplainLayer on={explain} scope={tab === "bim-edit" ? "BIM" : tab === "bom-ops" || tab === "bom-cfd" ? "BOM" : tab.replace(/^bem-/, "").toUpperCase()} />
      {recovered && (
        <div className="projectNote warn" role="status">
          <span>The app recovered at {new Date(recovered.at).toLocaleTimeString()}: {recovered.why}. The page was reloaded{recovered.reopened ? ` and ${recovered.reopened.split(/[\\/]/).pop()} reopened` : ""}; your rulings and drafts were on disk.</span>
          <button onClick={() => setRecovered(null)}>dismiss</button>
        </div>
      )}
      {memHigh && (
        <div className="saveAlarm" role="alert">
          <b>Memory is high</b> — {(memHigh.used / 1e9).toFixed(2)} of {(memHigh.limit / 1e9).toFixed(2)} GB; the page will crash at the limit. Your work is on disk:
          <button onClick={() => window.location.reload()} title="reload the page now — the house reopens">reload now</button>
        </div>
      )}
      {saveAlarm && (
        <div className="saveAlarm" role="alert">
          <b>{saveAlarm.kind === "backup" ? "The backup of your files failed" : `NOT SAVED: ${saveAlarm.what ?? "a file"}`}</b>
          {" "}— {saveAlarm.error} · {new Date(saveAlarm.at).toLocaleTimeString()}
          {saveAlarm.kind === "save" ? " · your last change is not on disk; do not close the app" : " · your files are saved in data/, not yet in the backup"}
          <button onClick={() => setSaveAlarm(null)} title="hide this message (the next failure shows it again)">dismiss</button>
        </div>
      )}
      {projectNote && (
        <div className={`projectNote ${projectNote.tone}`} role="status">
          <span>{projectNote.text}</span>
          <button onClick={() => setProjectNote(null)} title="hide this message">dismiss</button>
        </div>
      )}
      <div className="topbar">
        <button disabled={busy}
          onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setOpenMenu({ left: r.left, top: r.bottom + 4 }); }}
          title="open a house file, or edit where the files beside it sit">
          {busy ? "working…" : "Open IFC… ▾"}
        </button>
        <label>
          fill
          <input
            type="range" min={0} max={1} step={0.05} value={fillOpacity}
            onChange={(e) => {
              const v = Number(e.target.value);
              setFillOpacity(v);
              rebuildDbView(showAll, v);
              void rebuildIdf(choices, v, shellOn);
            }}
          />
        </label>
        <label title="a window under each view showing what that view knows about the selected surface">
          <input
            type="checkbox"
            checked={inspH > 0}
            onChange={(e) => setInspH(e.target.checked ? INSP_DEFAULT : 0)}
          />
          surface tables
        </label>
        <label title="draw the IfcSpace volumes in all three views and fade the surfaces so they show through">
          <input
            type="checkbox"
            checked={showSpaces}
            onChange={(e) => {
              const on = e.target.checked;
              setShowSpaces(on);
              const o = on ? FADED_SURFACE : fillOpacity;
              rebuildDbView(showAll, o);
              void rebuildIdf(choices, o, shellOn);
              applySpaces(on);
            }}
          />
          spaces
        </label>
        {spaceInfo && <span className="spaceInfo">{spaceInfo}</span>}
        <label title={siteView === "solar" ? "draw the site's terrain and its shading elements — trees, ties, the dock — and let them cast the sun's shadows" : "draw the projected files' terrain and shading elements in every view"}>
          <input
            type="checkbox"
            checked={showTerrain}
            disabled={!terrainInfo && siteElsInfo === 0}
            onChange={(e) => { setShowTerrain(e.target.checked); showTerrainRef.current = e.target.checked; applyTerrain(e.target.checked); }}
          />
          {siteView === "solar" ? "shading" : "terrain"}
        </label>
        {terrainInfo && <span className="spaceInfo">{"tris" in terrainInfo ? `${terrainInfo.tris.toLocaleString()} terrain tris · rotated ${terrainInfo.rotationDeg.toFixed(2)}°` : `${terrainInfo.split} walls cut at grade · below ${fmtA(terrainInfo.belowM2)} (fill ${fmtA(terrainInfo.fillM2)}) · fill elements ${terrainInfo.fills}`}</span>}
        <span className="status">{status}</span>
        {(() => {
          // a space under a hidden level is hidden with it — counted once, as the level
          const spacesOwn = [...hiddenSpaces].filter((x) => { const l = levelOfSpace(x); return l === null || !hiddenLevels.has(l); }).length;
          const n = hiddenCount + hiddenLevels.size + spacesOwn;
          if (n === 0) return null;
          const parts = [hiddenCount ? `${hiddenCount} element${hiddenCount === 1 ? "" : "s"}` : "", hiddenLevels.size ? `${hiddenLevels.size} level${hiddenLevels.size === 1 ? "" : "s"}` : "", spacesOwn ? `${spacesOwn} space${spacesOwn === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
          return (
            <button className="unitsBtn" onClick={unhideAll} title={`${parts} hidden — show all brings every one back (the layers' eyes stay as set); double right-click anywhere does the same`}>
              {n} hidden · show all
            </button>
          );
        })()}
        <button className="unitsBtn" onClick={() => setImperial((v) => !v)}>
          {imperial ? "Show Metric" : "Show Imperial"}
        </button>
        <button className={`unitsBtn explainBtn${explain ? " on" : ""}`} onClick={() => setExplain((v) => !v)}
          title={explain ? "Explain is on: rest the mouse on a section's header to read what it is — click to turn it off" : "Explain: rest the mouse on a section's header to read what it is"}>
          Explain
        </button>
        <button className="closeIfc" disabled={busy || !loadedAt}
          onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setCloseMenu({ right: window.innerWidth - r.right, top: r.bottom + 4 }); }}
          title="close the house file and the files beside it, or one file beside it">
          Close IFC… ▾
        </button>
        {gate && <span className={`gate ${gate.ok ? "ok" : "bad"}`}>{gate.ok ? "✓" : "✗"} {gate.text}</span>}
      </div>
      {armed && (
        <div className="armBar">
          <b>Select Extend to Surface</b> — click the surface that
          <i> {armed.label}</i> should reach
          <button onClick={() => { armedRef.current = null; setArmed(null); }}>cancel</button>
        </div>
      )}
      {armedSpace && (
        <div className="armBar">
          <b>Extend this room face</b> — click the face of the room it should meet, or a SURFACE
          (a roof, a wall) whose own face it should land on, for
          <i> {armedSpace.label}</i>
          <button onClick={() => { armedSpaceRef.current = null; setArmedSpace(null); }}>cancel</button>
        </div>
      )}
      {newProject && <NewProjectDialog ifc={newProject.ifc} siblings={newProject.siblings} onCancel={() => setNewProject(null)}
        onCreated={(info) => { setNewProject(null); try { if (info.openIfc) window.sessionStorage.setItem(OPEN_FILE_KEY, info.openIfc); else window.sessionStorage.removeItem(OPEN_FILE_KEY); } catch { /* a convenience */ } window.location.reload(); }} />}
      {openMenu && (
        <>
          <div className="menuScrim" onPointerDown={() => setOpenMenu(null)} />
          <div className="ctxMenu" style={{ left: openMenu.left, top: openMenu.top }}>
            <div className="ctxHead">project{window.projectNow ? ` · ${window.projectNow.name}` : " · none open"}</div>
            <button onClick={() => { setOpenMenu(null); void openIfc(); }} title="an IFC in the open project opens; any other starts a new project — the file copied into the project's folder, the original left where it is">Open IFC…</button>
            <button onClick={() => { setOpenMenu(null); void window.projectFolder.pickFolder("Open a project folder").then((d) => { if (d) void switchProject(d).catch((e: unknown) => setStatus(e instanceof Error ? e.message : String(e))); }); }} title="a project folder (it holds project.sqlite): its rulings, data sources and files">Open project…</button>
            <button onClick={() => { setOpenMenu(null); setNewProject({ ifc: null, siblings: [] }); }} title="a new project folder from a template — pick the IFC files to copy into it">New project…</button>
            {examples.map((x) => <button key={x.name} onClick={() => { setOpenMenu(null); void window.projectFolder.example(x.name).then((r) => setNewProject({ ifc: r.ifcs[0] ?? null, siblings: r.ifcs.slice(1) })).catch((e: unknown) => alert(e instanceof Error ? e.message : String(e))); }} title="the example's IFC files are put in your projects folder's Example/ folder, then a new project of your own is made from them — copied in, the example left as it is">New project from the example {x.name}…</button>)}
            {recentProjects.filter((r) => r.dir !== window.projectNow?.dir).length > 0 && <div className="ctxHead">recent projects</div>}
            {recentProjects.filter((r) => r.dir !== window.projectNow?.dir).slice(0, 8).map((r) => <button key={r.dir} title={r.dir} onClick={() => { setOpenMenu(null); void switchProject(r.dir); }}>{r.name}</button>)}
            {window.projectNow && <>
              <div className="ctxHead">this project</div>
              <button onClick={() => { setOpenMenu(null); void window.projectFolder.reveal(); }} title={window.projectNow.dir}>Show the project folder</button>
              <button onClick={() => { setOpenMenu(null); const n = window.prompt("Name the template — its data sources, tables, library and cache (never the IFCs, rulings or results):", `${window.projectNow?.name ?? "my"} template`); if (n) void window.projectFolder.saveTemplate(n, window.confirm("Make it the default for new projects?")).then((t) => setStatus(`template saved: ${t}`), (e: unknown) => setStatus(e instanceof Error ? e.message : String(e))); }} title="a template of your own from this project, for new projects">Save as template…</button>
              <button onClick={() => { setOpenMenu(null); if (window.confirm(`Close the project ${window.projectNow?.name}? Its rulings are on disk.`)) void switchProject(null); }}>Close project</button>
            </>}
            <div className="ctxHead">files beside the building</div>
            <button disabled={!loadedAt || !siteFiles.some((f) => f.projected)} onClick={() => { setOpenMenu(null); openAlign(); }}
              title={siteFiles.some((f) => f.projected) ? "move and turn a file beside the house — see it in place before you Accept; ifc.db keeps the placement" : "no file beside the house is in the model"}>
              Edit Alignment…
            </button>
          </div>
        </>
      )}
      {alignEdit && tab.startsWith("bim") && (
        <AlignDialog files={siteFiles.filter((f) => f.projected).map((f) => f.name)} file={alignEdit.file} onFile={onAlignFile}
          draft={alignEdit.draft} applied={appliedAlign(alignEdit.file)} onDraft={onAlignDraft}
          pick={alignEdit.pick} onPick={onAlignPick} locks={alignEdit.locks} onLocks={onAlignLocks} imperial={imperial} busy={busy} note={alignEdit.note}
          fileWord={siteFiles.find((f) => f.name === alignEdit.file)?.word ?? null}
          roofGap={alignRoofGap} onAccept={() => void acceptAlign()} onCancel={closeAlign} />
      )}
      {closeMenu && (
        <>
          <div className="menuScrim" onPointerDown={() => setCloseMenu(null)} />
          <div className="ctxMenu" style={{ right: closeMenu.right, top: closeMenu.top }}>
            <div className="ctxHead">close IFC</div>
            <button onClick={() => void closeAll()} title="the house and every file beside it — the window starts empty (asks first)">All</button>
            <button onClick={() => void closeAll()} title="the house file — the files beside it close with it (asks first)">{nameRef.current} <span className="ctxDim">· the house, closes all</span></button>
            {siteFiles.filter((f) => f.projected).map((f) => (
              <button key={f.name} onClick={() => { setCloseMenu(null); void onProjectFile(f.name, false); }}
                title="leave this file out of the model: its terrain and shading elements leave idf.db and the view (the ledger's siteFiles) — project it again from its right-click menu on SITE">
                {f.name} <span className="ctxDim">· leave out of the model</span>
              </button>
            ))}
          </div>
        </>
      )}
      {layerMenu && (
        <>
          <div className="menuScrim" onPointerDown={() => setLayerMenu(null)} />
          <div className="ctxMenu" style={{ left: layerMenu.x, top: layerMenu.y }}>
            <div className="ctxHead">layer {layerMenu.label}</div>
            {layerMenu.deleted ? <button onClick={() => layerOp("restore", layerMenu.seq)} title="the file's layer back in the stack">Restore layer</button> : (
              <>
                <button onClick={() => layerOp("delete", layerMenu.seq)} title={layerMenu.added ? "remove the layer you added" : "strike the file's layer: not drawn, not emitted; named in the setting; restorable"}>Delete layer</button>
                <button onClick={() => layerOp("addOutside", layerMenu.seq)} title="a new layer before this one (toward the outside) — pick its category and material in the table">Add a layer outside of it</button>
                <button onClick={() => layerOp("addInside", layerMenu.seq)} title="a new layer behind this one (toward the room) — pick its category and material in the table">Add a layer behind it</button>
                {layerMenu.custom
                  ? <button onClick={() => { setLayerCustom(layerMenu.seq, null); setLayerMenu(null); }} title="drop the custom edit — the layer goes back to its pick">Drop the custom edit</button>
                  : <button disabled={layerMenu.parts} onClick={() => { setLayerCustom(layerMenu.seq, {}); setLayerSel(layerMenu.seq); setLayerMenu(null); }} title={layerMenu.parts ? "a layer with sub-items (framing + batt) is not edited this way" : "edit this layer's name, R and reflectance in the list above; Apply assembly saves them as a material of yours and the layer takes it"}>Create a custom edit</button>}
              </>
            )}
          </div>
        </>
      )}
      {runBlocked && runBlocks.length > 0 && <RunBlockedDialog blocks={runBlocks} tabLabel={(t) => TABS.find((x) => x.id === t)?.label ?? t} onGo={(t) => setTab(t)} onClose={() => setRunBlocked(false)} busy={bemBusy} />}
      {fenDialog && <FenestrationDialog state={fenDialog} onState={setFenDialog} imperial={imperial} onSave={saveFenestration} onDelete={(k) => void deleteFenestration(k)} onCancel={() => setFenDialog(null)} />}
      {dialog && <MaterialDialog state={dialog} onState={setDialog} imperial={imperial} layerLabel={`layer ${layerPos(dialog.seq)}${detailRow ? ` of ${detailName ?? detailRow.label}` : ""}`} onSave={saveHand} onDelete={(k) => void removeMaterial(k)} canDelete={!!dialog.editFrom && (materialsRef.current?.rows.find((r) => r.key === dialog.editFrom)?.sourceId === "hand" || materialsRef.current?.rows.find((r) => r.key === dialog.editFrom)?.sourceId === "bcl")} onCancel={() => setDialog(null)} />}
      {menu && (
        <>
          <div className="menuScrim" onPointerDown={() => setMenu(null)} />
          <div className="ctxMenu" style={{ left: menu.x, top: menu.y }}>
            <div className="ctxHead">{menu.label}</div>
            {menu.key && <button onClick={() => {
              const from = { key: menu.key!, label: menu.label };
              armedRef.current = from; setArmed(from); setMenu(null);
            }}>Select Extend to Surface</button>}
            {menu.spaceKey && <button onClick={() => {
              const from = { key: menu.spaceKey!, label: menu.label };
              armedSpaceRef.current = from; setArmedSpace(from); setMenu(null);
              setSel(null); setSelSpace(from);
            }} title="take this room's face to the face of another ROOM, or to an ELEMENT's own face — a roof soffit, a wall's near side (2026-09-19). Click that face next; the element's face the room reaches first is the one taken.">Select Extend Space to…</button>}
            {menu.elementId > 0 && <button onClick={() => hideElement(menu.elementId)} title="hide this element in all three views; double right-click anywhere to show everything again">
              Hide
            </button>}
            {menu.elementId > 0 && <button onClick={() => void deleteElement(menu.elementId)} title="remove this element from the IFC file itself — a lossless rewrite, the previous bytes backed up beside it">
              Delete from IFC…
            </button>}
            {menu.siteIds && <button onClick={() => hideSiteElements(menu.siteIds!)} title="hide in every view; double right-click anywhere to show everything again">Hide{menu.siteIds.length > 1 ? ` all ${menu.siteIds.length}` : ""}</button>}
            {menu.siteIds && <button onClick={() => deleteSiteElements(menu.siteIds!, menu.label)} title="delete from the MODEL: vetoed from idf.db's shading elements and the view, recorded in the ledger, restorable from the SITE table — the site file itself is not rewritten">Delete{menu.siteIds.length > 1 ? ` all ${menu.siteIds.length}` : ""} from the model…</button>}
            {menu.siteFile && (menu.siteFileProjected
              ? <button onClick={() => { setMenu(null); void onProjectFile(menu.siteFile!, false); }} title="leave this file out of the model: its terrain and shading elements leave idf.db and the view (the ledger's siteFiles)">Leave {menu.siteFile} out of the model</button>
              : <button onClick={() => { setMenu(null); void onProjectFile(menu.siteFile!, true); }} title="read this file's terrain and shading elements into ifc.db and idf.db">Project {menu.siteFile} into the model</button>)}
            {menu.siteFile && menu.siteFileProjected && <TurnMenu file={menu.siteFile} turnDeg={siteFiles.find((f) => f.name === menu.siteFile)?.turnDeg ?? 0} disabled={busy} onTurn={(d) => { setMenu(null); void onTurnFile(menu.siteFile!, d); }} />}
            {hiddenCount > 0 && <button onClick={unhideAll}>Show hidden ({hiddenCount})</button>}
            <div className="ctxFoot">
              <button onClick={() => { setMenu(null); openSection("edits"); }}>
                Show corrections ({edits.length + spaceEdits.length + [...choicesRef.current.values()].filter((c) => c !== "keep").length})
              </button>
              <button disabled={edits.length + spaceEdits.length === 0} onClick={undoLast}>
                Undo Last{edits.length + spaceEdits.length ? ` (${edits.length + spaceEdits.length})` : ""}
              </button>
            </div>
          </div>
        </>
      )}
      <div className="body">
      <Rail
        active={module}
        dots={{ bim: moduleState(chain, "idf"), bem: moduleState(chain, "bem"), bom: moduleState(chain, "bom") } as Record<AppModule, DotState>}
        onSelect={(m) => setTab(firstTab(m))}
      />
      <aside className="tree" style={{ flexBasis: treeW }}>
        <button className="treeHead treeBar" onClick={() => setTreeBars((b) => ({ ...b, levels: !b.levels }))}
          title={treeBars.levels ? "roll up the levels and spaces" : "drop down the levels and spaces"}>
          LEVELS · SPACES <span className="treeCaret">{treeBars.levels ? "▾" : "▸"}</span>
        </button>
        {treeBars.levels && (<>
        {(hiddenLevels.size > 0 || hiddenSpaces.size > 0) && (
          <div className="allRow"><button onClick={showAllLevels}>show all</button></div>
        )}
        {levels.map((lv) => {
          const off = hiddenLevels.has(lv.name);
          return (
            <Fragment key={lv.name}>
              <div className={`row level${off ? " off" : ""}${selLevel === lv.name ? " sel" : ""}`} title={off ? "show this level and every space on it" : "hide this level and its spaces"}>
                <button className={`eye${off ? " off" : ""}`} onClick={() => toggleLevel(lv.name)} aria-label={off ? "show level" : "hide level"}><Eye on={!off} /></button>
                <span className="name" onClick={() => selectLevel(lv.name)} title="select this level: its rooms' cells light up and the table reads them">{lv.name}</span>
                {lv.elevM !== null && <span className="elev" title={`elevation the file states${lv.heightM !== null ? ` · h: ${fmtL2(lv.heightM)} ${lu} to the ceiling ${lv.heightRooms} of ${lv.spaces.length - lv.shafts.length} occupied rooms share${lv.heightOthers.length ? ` (${lv.heightOthers.map((o) => `${o.name} ${fmtL2(o.heightM)}`).join(", ")})` : ""}` : ""}${lv.shafts.length ? ` · not occupied: ${lv.shafts.map((x) => `${x.name} ${fmtL2(x.bottomM)}–${fmtL2(x.topM)} ${lu}`).join(", ")}` : ""}${lv.nextM !== null ? ` · the floor above: ${lv.nextName} ${fmtL2(lv.nextM)} ${lu} up` : ""}`}>{fmtL2(lv.elevM)} {lu}{lv.heightM !== null ? <i> · h {fmtL2(lv.heightM)}</i> : null}</span>}
              </div>
              {lv.spaces.map((sp) => {
                // a space standing on a roof is no room (spacesOnRoof): listed as the file names it, said so, never a zone
                if (onRoofRef.current.has(sp.name)) return (
                  <div key={sp.name} className="row space off" title="this space stands on the roof — outside the envelope: the roof under it is the building's top, and the space is not a room in the energy model">
                    <span className="swatch" style={{ background: "transparent" }} /><span className="name muted"><i>{sp.name}</i> · on the roof, not a room</span>
                  </div>
                );
                const soff = off || hiddenSpaces.has(sp.name);
                return (
                  <div key={sp.name} className={`row space${soff ? " off" : ""}${related.spaces.has(sp.name) ? " sel" : ""}`}>
                    <button className={`eye${soff ? " off" : ""}`} onClick={() => toggleSpace(sp.name)} title={soff ? (off ? "show this space alone: its level comes back with the other spaces still hidden" : "show this space") : "hide this space"} aria-label={soff ? "show space" : "hide space"}><Eye on={!soff} /></button>
                    <span className="swatch" style={{ background: spaceColor(sp.colorIndex).getStyle() }} />
                    {(() => { const h = roomNameProps(sp.name); return <span className={`name${roomDrag ? " draggable" : ""}${h.className}`} style={h.style} onContextMenu={h.onContextMenu} onClick={() => clickSpaceName(sp.name)} onPointerDown={roomDrag ? (e) => { e.preventDefault(); startPaletteDrag({ room: sp.name }, sp.name, e); } : undefined} title={`${h.held ? (h.via ? `merged into ${h.via} on ZONES, which is in zone ${h.held.name} on the SYSTEMS sheet` : `in zone ${h.held.name} on the SYSTEMS sheet · right-click to un-assign it`) : asmView ? (elecSheet ? "drag this space onto a Load center on the sheet: its zone goes on that load center; click to select it" : "drag this room onto a Zone on the sheet (or onto the sheet for a new Zone); click to select it") : "select this room: every cell that bounds it lights up and the table reads it"}\nright-click: zoom to it${h.held || h.via ? "" : " and assign it to a Zone"} · double right-click: back to the view before`}>{sp.name}</span>; })()}
                    {voidMark(sp.name)}{cfdMark(sp.name)}
                  </div>
                );
              })}
              {lv.attics.map((an) => {
                const aoff = off || hiddenSpaces.has(an);
                return (
                  <div key={an} className={`row attic${aoff ? " off" : ""}${related.spaces.has(an) ? " sel" : ""}`}>
                    <button className={`eye${aoff ? " off" : ""}`} onClick={() => toggleSpace(an)} title={aoff ? (off ? "show this attic alone: its level comes back with the other spaces still hidden" : "show this attic") : "hide this attic"} aria-label={aoff ? "show attic" : "hide attic"}><Eye on={!aoff} /></button>
                    {(() => { const h = roomNameProps(an); return <span className={`name${roomDrag ? " draggable" : ""}${h.className}`} style={h.style} onContextMenu={h.onContextMenu} onClick={() => clickSpaceName(an)} onPointerDown={roomDrag ? (e) => { e.preventDefault(); startPaletteDrag({ room: an }, an, e); } : undefined} title={`${h.held ? (h.via ? `merged into ${h.via} on ZONES, which is in zone ${h.held.name} on the SYSTEMS sheet` : `in zone ${h.held.name} on the SYSTEMS sheet · right-click to un-assign it`) : asmView ? (elecSheet ? "drag this space onto a Load center on the sheet: its zone goes on that load center" : "drag this attic onto a Zone on the sheet") : "select this void: every cell that bounds it lights up"}\nright-click: zoom to it${h.held || h.via ? "" : " and assign it to a Zone"} · double right-click: back to the view before`}>{an}</span>; })()}
                    {voidMark(an)}{cfdMark(an)}
                  </div>
                );
              })}
            </Fragment>
          );
        })}
        </>)}
        <button className="treeHead treeBar" onClick={() => setTreeBars((b) => ({ ...b, files: !b.files }))}
          title={treeBars.files ? "roll up the files and their layers" : "drop down the files loaded and their layers"}>
          FILES · LAYERS <span className="treeCaret">{treeBars.files ? "▾" : "▸"}</span>
        </button>
        {treeBars.files && layerList.map((f) => {
          const foff = hiddenFiles.has(f.file);
          const open = openFiles.has(f.file);
          return (
            <Fragment key={f.file}>
              <div className={`row level${foff ? " off" : ""}`}>
                <button className={`eye${foff ? " off" : ""}`} onClick={() => toggleFileEye(f.file, f.house)}
                  title={f.house ? (foff ? "show the house" : "hide the house") : (foff ? "show this file" : "hide this file — it is drawn when the terrain is shown")}
                  aria-label={foff ? "show file" : "hide file"}><Eye on={!foff} /></button>
                <span className="name" onClick={() => setOpenFiles((s) => { const n = new Set(s); if (n.has(f.file)) n.delete(f.file); else n.add(f.file); return n; })}
                  title={open ? "roll up its layers" : "drop down its layers"}>{open ? "▾" : "▸"} {f.file}</span>
                <span className="elev" title={f.house ? "the house file" : "a file beside the house, projected into it"}>{`${f.layers.length} layers`}</span>
              </div>
              {open && !f.layers.length && <div className="row space off"><span className="name muted">the file names no layers</span></div>}
              {open && f.layers.map((l) => {
                void hiddenLayers; void shownLayers; void mepInfo; void siteElsInfo;   // the eye re-reads when these move
                const loff = foff || !layerOn(f.file, l.name);
                return (
                  <div key={l.name} className={`row space${loff ? " off" : ""}`}>
                    <button className={`eye${loff ? " off" : ""}`} onClick={() => toggleLayer(f.file, l.name, f.house)} disabled={foff}
                      title={foff ? "the file is hidden — show it first" : loff ? "show this layer" : "hide this layer"} aria-label={loff ? "show layer" : "hide layer"}><Eye on={!loff} /></button>
                    <span className="name" title={`IFC presentation layer ${l.name} · ${l.count} element${l.count === 1 ? "" : "s"}`}>{l.name}</span>
                    <span className="elev">{l.count}</span>
                  </div>
                );
              })}
            </Fragment>
          );
        })}
        {roomMenu && (
          <div className="ctxMenu roomMenu" style={{ left: roomMenu.x, top: roomMenu.y }} onContextMenu={(e) => e.preventDefault()}>
            {/* ASSIGN, AS UN-ASSIGN IS (the user, 2026-10-07: "Correct assignment approach"): a room in no zone, right-clicked on any
                tab, joins a Zone card here — the same staged change a drag onto the card on SYSTEMS › MECHANICAL makes; Save keeps it */}
            {!roomMenu.zoneId && <>
              <div className="ctxHead">{roomMenu.room} · in no zone — assign it to</div>
              {asmCompiled.zones.map((z) => <button key={z.id} onClick={() => { setAssembly(addRoom(asm, z.id, roomMenu.room)); setRoomMenu(null); }} title={`put ${roomMenu.room} in ${z.name} (${z.rooms.join(", ")}) — staged: Save on ZONES or SYSTEMS keeps it`}><span style={{ color: zoneColor(z.id) }}>{z.name}</span></button>)}
            </>}
            {roomMenu.zoneId && <>
            <div className="ctxHead">{roomMenu.room} · in zone <span style={{ color: zoneColor(roomMenu.zoneId) }}>{roomMenu.zoneName}</span></div>
            <button onClick={() => { setAssembly(removeRoom(asm, roomMenu.zoneId, roomMenu.room)); setRoomMenu(null); }} title="take this room out of the zone: it is its own zone again, on ideal loads unless the ZONES tab assigns it">Un-assign {roomMenu.room} from {roomMenu.zoneName}</button>
            <button onClick={() => { setSysView("assembly"); setAsmSel(roomMenu.zoneId); setRoomMenu(null); }} title="select the zone on the SYSTEMS sheet">Show {roomMenu.zoneName} on the sheet</button>
            </>}
          </div>
        )}
        {voidDialog && (() => {
          // THE CORRECTION DIALOG (user, 2026-09-18). It states what the QA READ — what closes the space
          // above and below, the gap, the areas — and asks the one question the file does not answer.
          const { row } = voidDialog;
          const ft2 = (m2: number): string => `${Math.round(m2 * 10.7639).toLocaleString()} ft²`;
          const len = (m: number): string => `${fmtL2(m)} ${lu}`;
          const ruled = voidRulings[row.name];
          return (
            <div className="menuScrim dialogScrim" onPointerDown={() => setVoidDialog(null)}>
              <div className="dialog voidDialog" role="dialog" aria-label={`where the insulation sits in ${row.name}`} onPointerDown={(e) => e.stopPropagation()}>
                <div className="dialogHead">{row.name} — where does the insulation sit?</div>
                <div className="muted">
                  {row.kind === "void"
                    ? <>the app BUILT this space over a room&rsquo;s ceiling; the file does not say which of its two planes carries the insulation, and the answer decides the whole envelope here</>
                    : <>a roof of this room has another roof over it and no space between — as the model stands, the lower roof tells the engine it faces the sky</>}
                </div>
                <table className="voidFacts"><tbody>
                  {row.top && <tr><td>above</td><td><b>{row.top}</b> · {ft2(row.topM2)}{row.over.length ? <> · beyond it: {row.over.join(", ")}</> : null}</td></tr>}
                  {row.bottom && <tr><td>below</td><td><b>{row.bottom}</b> · {ft2(row.bottomM2)}{row.under.length ? <> · beyond it: {row.under.join(", ")}</> : null}</td></tr>}
                  {row.gapMaxM > 0 && <tr><td>the gap</td><td>{len(row.gapMinM)} – {len(row.gapMaxM)}</td></tr>}
                  {row.extWallM2 > 0 && <tr><td>its sides</td><td>{ft2(row.extWallM2)} of exterior wall</td></tr>}
                  {row.coveredM2 > 0 && <tr><td>covered</td><td>{ft2(row.coveredM2)} under {row.coveredBy.join(", ")}</td></tr>}
                  <tr><td>the QA reads</td><td>{row.note}</td></tr>
                </tbody></table>
                <div className="voidAnswers">
                  {answersFor(row).map((a, i) => (
                    <label key={a} className={voidDialog.answer === a ? "sel" : ""} title={VOID_ANSWERS[a].why}>
                      <input type="radio" name="voidAnswer" checked={voidDialog.answer === a} onChange={() => setVoidDialog({ ...voidDialog, answer: a })} />
                      <span><b>{VOID_ANSWERS[a].label}</b>{i === 0 && !ruled ? <i> — what the QA reads</i> : null}<br /><i>{VOID_ANSWERS[a].why}</i></span>
                    </label>
                  ))}
                </div>
                <label className="voidGrille" title="the user's word on every void in this project (2026-09-18): the vents are interior, so the space is not outdoor air">
                  <input type="checkbox" checked={voidDialog.grille} onChange={(e) => setVoidDialog({ ...voidDialog, grille: e.target.checked })} />
                  it opens into conditioned space (a transfer grille)
                </label>
                <div className="muted">the ruling is written to <code>data/corrections/&lt;sha256&gt;.json</code>, replayed on every load, and carried into <code>idf.db</code> — the IDF writer reads it, so the BEM model reads stale until it is rebuilt{voidDialog.answer === "make-a-void" || voidDialog.answer === "shade" ? ". This answer is about GEOMETRY — a space the carve never built — so nothing is written for it in the IDF; it is recorded and named." : "."}</div>
                <div className="allRow">
                  <button className="apply" onClick={() => { ruleVoid(row.name, { answer: voidDialog.answer, ...(voidDialog.grille ? { grille: true } : {}), at: new Date().toISOString() }); setVoidDialog(null); }}>Rule {row.name}</button>
                  {ruled && <button onClick={() => { restoreVoid(row.name); setVoidDialog(null); }} title="leave this space unruled: the `?` comes back and nothing is recorded">clear the ruling</button>}
                  <button onClick={() => setVoidDialog(null)}>cancel</button>
                </div>
              </div>
            </div>
          );
        })()}
      </aside>
      <div className="treeGrip" onPointerDown={dragTree} onDoubleClick={() => setTreeW(TREE_DEFAULT)} title="drag to widen LEVELS · SPACES · double-click for the default width" />
      <div className="viewsCol">
      <div className="viewTabs">
        {module !== "bem" ? (
          <>
            {cfdTab && (cfdSetupIn || cfdSpace) && (() => {
              // THE SETUP STAYS REACHABLE (2026-11-11, the user: "the CFD setup should not disappear after running the CFD model so
              // assignments can be reviewed"): the tab is the room on screen's — its saved setup read again when it is not the one open
              const sp = cfdView === "setup" && cfdSetupIn ? cfdSetupIn.space : cfdSpace ?? cfdSetupIn!.space;
              return <button className={cfdView === "setup" ? "on" : ""} onClick={() => { if (cfdSetupIn?.space === sp) setCfdView("setup"); else { cfdWantRef.current = sp; void openCfdDialog(sp); } }} title="the room's setup — its terminals, their roles and flows, where the transfer air goes and comes from, as saved; add one on the floor, a wall or the ceiling">CFD · SETUP · {sp}</button>;
            })()}
            {cfdTab && (["heating", "cooling"] as const).map((pk) => {
              const has = cfdRuns.some((r) => r.space === cfdSpace && r.peak === pk);
              return <button key={pk} className={cfdView === "results" && cfdPeak === pk && has ? "on" : ""} disabled={!has} onClick={() => { setCfdPeak(pk); setCfdPick(null); setCfdView("results"); }}
                title={has ? `the supply air at the ${pk} design peak: arrow length = air speed, thickness = the share of the supply air passing, colour = air temperature` : `cfd.db holds no ${pk} run of ${cfdSpace ?? "this space"}`}>CFD · {pk.toUpperCase()}{cfdSpace ? ` · ${cfdSpace}` : ""}</button>;
            })}
            {cfdTab && cfdShown && cfdView === "results" && <span className="cfdMotion" title="moving: each arrow travels along its own direction at the air's speed there, in real time · static: the arrows held at their points">
              <button className={!cfdMoving ? "on" : ""} onClick={() => setCfdMoving(false)}>static</button><button className={cfdMoving ? "on" : ""} onClick={() => setCfdMoving(true)}>moving</button>
            </span>}
            {bomOps && <button className={costView ? "on" : ""} onClick={() => setBomView("cost")} title="the run's months and the bills, priced by the tariff applied in UTILITY below">ENERGY &amp; COST{pricedBom ? ` · ${pricedBom.card.name}` : ""}</button>}
            {module !== "bom" && <button className={eff.has("ifc") ? "on" : ""} onClick={() => toggleView("ifc")} title={eff.has("ifc") ? "collapse the IFC view" : "show the IFC view"}>IFC — FRAGMENTS</button>}
          </>
        ) : (
          <>
            {tab === "bem-constructions" && <button className={eff.has("idf") ? "on" : ""} onClick={() => setConsView("plan")} title={`the model from above, every cell painted ${consPaint === "source" ? "by what governs each type" : "by the file's type"} — click a cell to select its type`}>PLAN</button>}
            {tab === "bem-constructions" && <button className={eff.has("detail") ? "on" : ""} onClick={() => setConsView("detail")} title="the selected type's assembly, drawn to scale from the file's own layers, with the U the governing construction gives it">DETAIL · {detailRow ? detailName ?? detailRow.label : "select a type"}</button>}
            {tab === "bem-systems" && <button className={asmView ? "on" : ""} onClick={() => setSysView("assembly")} title={MAIN_OF[sysFocus] === "plumbing" ? "the plumbing assembly: water heaters and the hot-water uses they supply, from the bench, connected; each heater in its room; the selected card's settings in the column" : MAIN_OF[sysFocus] === "electrical" ? "the electrical assembly: PV arrays, inverters, load centers and the utility from the bench, connected; the selected card's settings in the column" : "the mechanical assembly: components from the bench, connected into systems, the zones assigned in ZONES; the selected component's settings in the column"}>ASSEMBLY · {MAIN_OF[sysFocus].toUpperCase()}</button>}
            {tab === "bem-schedules" && <button className={calView ? "on" : ""} onClick={() => setSchedView("calendar")} title="the run's calendar — a card in the column paints it with that schedule's values; click a month, a week, a day; double-click backs up">CALENDAR · {schedCard ? `${ROLE_LABELS[schedCard]} · ${calProfile?.name ?? "the code default"} · ` : ""}{calAt.level}</button>}
            {/* ANNUAL and PEAK, each its own tab (user, 2026-10-12: "What happened to the Annual plots?" — one tab named for the section
                shown hid the other behind the frame's title) */}
            {tab === "bem-run" && <button className={graphView && runGraph.section === "annual" ? "on" : ""} onClick={() => { setRunView("graphs"); setRunGraph({ ...runGraph, section: "annual" }); }} title="the run's year graphed by the hour: outside temperature, heating and cooling, ventilation, occupant loads, PV, bought and sold — the frame below picks the lines and the window">GRAPHS · ANNUAL</button>}
            {tab === "bem-run" && <button className={graphView && runGraph.section === "peak" ? "on" : ""} onClick={() => { setRunView("graphs"); setRunGraph({ ...runGraph, section: "peak" }); }} title="peak conditioning per structure and per zone on the design days — the frame below picks the parts">GRAPHS · PEAK</button>}
            {tab === "bem-run" && <button className={reportView ? "on" : ""} onClick={() => setRunView("report")} title="EnergyPlus's own tabular report (eplustbl.htm) for the run, as the engine wrote it — the end uses, the zone and space component loads, sizing, envelope; a run that ended Fatal shows its error file">REPORT · ENGINE</button>}
            {tab !== "bem-constructions" && tab !== "bem-schedules" && tab !== "bem-systems" && <button className={eff.has("idf") ? "on" : ""} onClick={() => (tab === "bem-run" ? (setRunView("model"), lens !== "surface-temp-winter" && lens !== "surface-temp-summer" && applyLens("surface-temp-winter")) : toggleView("idf"))} title={tab === "bem-site" ? (siteView === "location" ? "the project location — OpenStreetMap" : siteView === "weather" ? "the weather stations — EnergyPlus's weather repository" : siteView === "solar" ? "the model under its terrain, with the site's shading elements and the sun" : "the model; the files beside the house are listed below")
                : tab === "bem-zones" ? `the model alone, no site — painted ${lens === "none" ? "by the sheet's Zones; rooms in none are grey" : `by ${LENSES.find((l) => l.id === lens)?.label ?? lens}`}`
                : tab === "bem-run" ? `the exterior surface temperatures, the ${lens === "surface-temp-summer" ? "summer" : "winter"} design day`
                : `the zone model: every cell painted by ${lens === "none" ? "the zone behind it" : LENSES.find((l) => l.id === lens)?.label ?? lens}`}>
              {/* the tab names its view; what the view shows is the tab's tooltip (user, 2026-10-16) */}
              {tab === "bem-site" ? (siteView === "location" ? "SITE · LOCATION" : siteView === "weather" ? "SITE · WEATHER STATIONS" : siteView === "solar" ? "IDF-DB — SITE · SOLAR" : "IDF-DB — SITE")
                : tab === "bem-zones" ? "IDF-DB — ZONES" : tab === "bem-run" ? "SURFACE TEMPERATURES" : "IDF-DB — ZONE MODEL"}
            </button>}
          </>
        )}
        {/* RUN's model takes the mouse alone — left-drag orbits, right-drag pans (user, 2026-10-12: "without all the view orientation") */}
        {(eff.has("idf") || eff.has("ifc")) && !mapView && !asmView && !calView && !(module === "bem" && tab === "bem-run") && <ViewTools drag={drag} onDrag={setDrag} onView={viewTo} onZoom={(step) => ifcPaneRef.current?.zoom(step)} />}
        {/* BIM's IDF-DB tab at the far right, after the view tools (user, 2026-10-16): it names the RIGHT pane of the split, so it sits over it */}
        {module === "bim" && <button className={`farRight${eff.has("idf") ? " on" : ""}`} onClick={() => toggleView("idf")} title={eff.has("idf") ? "collapse the IDF-DB view" : "show the IDF-DB view"}>IDF-DB — SINGLE PLANE</button>}
      </div>
      <div className="panes" style={{ gridTemplateColumns: `repeat(${eff.size || 1}, 1fr)` }}>
        {/* a collapsed IFC pane is GHOSTED, never display:none: every drag in any pane is
            forwarded to its camera element, and camera-controls divides the drag by that
            element's height — a zero rectangle made a NaN camera and the view vanished
            (user, 2026-09-05: "I tried to rotate the model and the image disappears") */}
        <div className={`pane1${eff.has("ifc") ? "" : " ghost"}`} ref={pane1Ref} />
        {module === "bem" && tab === "bem-constructions" && <div className="paneHtml" hidden={!eff.has("detail")}><ConstructionDetail row={detailRow} resolved={detailResolved} code={detailCode} onApply={() => { if (detailRow) applyConstructionType(detailRow.key); }} onRevert={() => { if (detailRow) revertConstructionType(detailRow.key); }} stagedSummary={detailSummary} overall={detailOverall} imperial={imperial} ground={detailGround} stage={detailStage} library={libRef.current} alias={detailAlias} layerSel={layerSel} onLayer={setLayerSel} onName={nameType} staged={detailStaged} onThickness={setLayerThickness} onLayerMenu={(seq, x, y) => { if (!detailRow) return; const st = consStage[detailRow.key]; const rl = ruledStack(detailRow.layers.filter((l) => !l.part), st?.source === "layers" ? st.layers : undefined).find((q) => q.seq === seq); if (rl) setLayerMenu({ x, y, seq, label: `${rl.position ?? "—"} · ${rl.file?.material ?? rl.pick.material}${rl.added ? " (added)" : ""}`, deleted: rl.deleted, added: rl.added, custom: !!rl.pick.custom, parts: !!rl.pick.parts?.length }); }} onCustom={setLayerCustom} rowOf={(k) => materialsApi?.byKey(k) ?? null} /></div>}
        {asmView && (
          <div className="paneHtml paneMapSlot asmSlot">
            {plumbSheet
              ? <SystemsAssembly key="plumb" asm={plumbAsm} assign={{}} onChange={(a) => setPlumbAssembly(a)} sel={plumbSel} onSel={setPlumbSel} compiled={plumbCompiled} catalogue={plumbCatalogue} rooms={false} paletteKinds={false}
                  emptyText={<><div><b>PLUMBING — the assembly</b></div><div>drag a water heater (heat pump, electric or gas) and a hot-water use from the bench below and connect HW out → HW in; pick the heater's room in the column — or <b>make the sheet from the file</b> in the column: the file's heaters in their rooms</div></>} />
              : elecSheet
              ? <SystemsAssembly key="elec" asm={elecAsm} assign={{}} onChange={(a) => setElecAssembly(a)} sel={elecSel} onSel={setElecSel} compiled={elecCompiled} catalogue={elecCatalogue} rooms={false} paletteKinds={false}
                  heldOf={(n) => (n.cls === ELEC_CLASS.centre ? zonesOn(n) : null)}
                  onZoneOut={(id, z) => { const n = elecAsm.nodes.find((x) => x.id === id); if (n) setElecAssembly(withZones(elecAsm, id, zonesOn(n).filter((x) => x !== z))); }}
                  onRoomDrop={(n, room) => {
                    // the space's zone in the model (spacesByZone, the writer's own), then onto the Load center under the pointer
                    const zone = Object.entries(bemModel?.report.model.spacesByZone ?? {}).find(([, rs]) => rs.includes(room))?.[0];
                    if (!zone) return `${room} is in no zone of the model yet — open BEM so the model is built, then drag it again`;
                    if (!n || n.cls !== ELEC_CLASS.centre) return `${room} is in ${zone}: drop it ONTO a Load center to put ${zone} on it`;
                    const r = zoneOnto(elecAsm, n.id, zone);
                    setElecAssembly(r.asm);
                    return `${room} → ${r.note}`;
                  }}
                  emptyText={<><div><b>ELECTRICAL — the assembly</b></div><div>drag a PV array, an inverter, a load center, a meter and the utility from the bench below, and connect DC out → DC in, AC out → AC in, Grid → Grid; drag a space from LEVELS · SPACES onto a load center to put its zone on it — or <b>make the sheet from the file</b> in the column: an array per roof face, wired. Select an array to tick its panels in the column.</div><div className="muted">nothing drawn here changes the model until Save.</div></>} />
              : <SystemsAssembly key="mech" asm={asm} assign={asmAssign} onChange={setAssembly} sel={asmSel} onSel={setAsmSel} compiled={asmCompiled} catalogue={catalogue} qa={asmQa} notWritten={asmNotWritten} migration={asmMigration} onMigrationSeen={() => setAsmMigration([])} />}
          </div>
        )}
        {costView && (
          <div className="paneHtml paneMapSlot runPane">
            <BomCostView meters={pricedMeters} statements={bomStatements.bills} priced={pricedBom} calibrated={pricedCal} withoutPv={{ standard: pricedStdNo, calibrated: pricedCalNo, bills: billNoPv }} pv={hasPv} applied={(!!bomTariff && pricedBom?.card.id === bomTariff.card) || (!bomTariff && !!pricedBom?.card.sample)} why={!bem ? "no run yet — run the model on BEM › RUN; its months are priced here" : !tariffRead?.usable.length ? "no tariff card is readable (references/tariffs/)" : null} />
          </div>
        )}
        {reportView && (
          <div className="paneHtml paneMapSlot runPane">
            <RunEngineReport stamp={bem?.stamp ?? null} fatal={!!bem && bem.run.fatal > 0} project={projectName} imperial={imperial} />
          </div>
        )}
        {graphView && (
          <div className="paneHtml paneMapSlot runPane">
            <RunGraphs bem={bem} state={runGraph} imperial={imperial} modelSha={bemModel?.modelSha ?? null} onState={setRunGraph} structures={runStructures} spacesByZone={bemModel?.report.model.spacesByZone} />
          </div>
        )}
        {calView && (
          <div className="paneHtml paneMapSlot calPane">
            <ScheduleCalendar profile={calShown} kind={schedCard ? ROLE_KIND[schedCard] : "fraction"} cal={runCal} at={calAt} onAt={setCalAt} imperial={imperial}
              label={schedCard ? `${ROLE_LABELS[schedCard]}${schedDraft ? ` · ${schedDraft.name} · your edit, not saved` : calProfile ? ` · ${calProfile.name}${calProfile.file ? ` · ${scheduleFileName(calProfile.file)}` : " · composed by day part"}` : ""}` : "the run calendar"}
              source={calMode ? calMode.word : calSourceWord}
              active={calMode ? (n) => calMode.days.includes(n) : null}
              onPaint={calMode?.paint ?? null} />
          </div>
        )}
        {siteView === "location" && (
          <div className="paneHtml paneMapSlot">
            <LocationFrame latitude={siteInForce?.latitude ?? 0} longitude={siteInForce?.longitude ?? 0} satellite={satellite}
              label={siteInForce ? `${bemLedger?.site?.location ? "located" : "the IfcSite"} · lat ${siteInForce.latitude.toFixed(5)} · lon ${siteInForce.longitude.toFixed(5)}${siteAddress ? ` · ${siteAddress}` : ""}` : "the file states no position"} />
          </div>
        )}
        {siteView === "weather" && (
          <div className="paneHtml paneMapSlot">
            <WeatherStationsMap site={siteInForce} stations={nearStations} inForceWmo={inForceWmo} installed={installedWmos} humidity={humidityByWmo} projectZone={projectZone} focus={focusStation} imperial={imperial}
              onMarker={(id) => {
                // a click on a station IS the selection (user, 2026-09-07): its newest file is used, downloaded once if it is not installed
                const st = nearStations.find((x) => stationId(x) === id) ?? null;
                setFocusStation(st);
                const f = st ? newestFile(st) : null;
                if (f) void useStation(f);
              }} onView={setMapBounds} />
          </div>
        )}
        {cfdTab && cfdView === "setup" && cfdSetupIn && <div className="paneHtml paneMapSlot"><CfdSetupPlan s={cfdSet} imperial={imperial} /></div>}
        <div className="paneDb" hidden={!eff.has("idf") || mapView || asmView || calView || (cfdTab && cfdView === "setup" && !!cfdSetupIn)}>
          <canvas ref={canvasRef} />
          {cfdTab && cfdShown && (() => {
            const tr = cfdTRange(cfdShown.arrows), k = arrowScale({ arrows: cfdShown.arrows, openings: [], tRange: tr });
            const spd = (v: number): string => (imperial ? `${(v * 196.85).toFixed(0)} fpm` : `${v.toFixed(2)} m/s`);
            const len = (m: number): string => (imperial ? `${(m / 0.3048).toFixed(1)} ft` : `${m.toFixed(2)} m`);
            const flow = (c: number): string => (imperial ? `${c.toFixed(0)} cfm` : `${(c * 0.471947).toFixed(0)} L/s`);
            return (
              <div className="viewLegend">
                <b>{cfdShown.run.space} · {cfdShown.run.peak} peak{cfdShown.run.designHour ? ` · ${cfdShown.run.designHour}` : ""} · {cfdShown.arrows.length.toLocaleString()} arrows</b>
                <span>length = air speed: {spd(k.speedFull)} draws {len(k.lengthFull)}</span>
                <span>thickness = the supply air passing: the thickest {flow(k.cfmFull)} of {flow(cfdShown.openings.filter((o) => o.dir === "in").reduce((t, o) => t + o.cfm, 0))} supplied</span>
                {/* the scale is the arrows' 5th–95th percentile so the room's own spread shows; the ends are therefore "at or
                    below / above" — never a minimum the arrows do not have (the user, 2026-11-10: the cooling legend read 72.7 °F
                    with the supply at 61 °F). The label ABOVE the bar, the temperatures BELOW it, the room's final average marked
                    at its place on the scale (the user, 2026-11-10) */}
                <div className="cfdScaleHead">colour = air temperature</div>
                {(() => {
                  const mean = cfdShown.metrics.find((m) => m.key === "room_mean_c")?.value;
                  const f = mean != null && Number.isFinite(mean) && tr[1] > tr[0] ? Math.min(1, Math.max(0, (mean - tr[0]) / (tr[1] - tr[0]))) : null;
                  return <>
                    <div className="cfdScale"><div className="legendBar cfdT" />{f != null && <span className="cfdScaleTick" style={{ left: `${100 * f}%` }} />}</div>
                    <div className="cfdScaleEnds">
                      <span>≤ {fmtTemp(tr[0], imperial)}</span>
                      {f != null && <span className="cfdScaleMean" style={{ left: `${100 * f}%` }} title="the room air's mean over the run's averaging window (THE ROOM in the column)">room average {fmtTemp(mean!, imperial)}</span>}
                      <span>≥ {fmtTemp(tr[1], imperial)}</span>
                    </div>
                  </>;
                })()}
                {(() => {
                  const ts = cfdShown.arrows.map((a) => a.t).filter(Number.isFinite);
                  const sup = cfdShown.openings.filter((o) => o.dir === "in" && o.tC != null).map((o) => o.tC as number);
                  if (!ts.length) return null;
                  const lo = Math.min(...ts), hi = Math.max(...ts);
                  const below = ts.filter((t) => t <= tr[0]).length, above = ts.filter((t) => t >= tr[1]).length;
                  return <span>arrows {fmtTemp(lo, imperial)} – {fmtTemp(hi, imperial)}{sup.length ? ` · supply ${fmtTemp(sup[0]!, imperial)}` : ""} · {below} at the cold end, {above} at the warm end (the jet mixes into the room within about a foot of the register)</span>;
                })()}
                <span className="muted">boxes: supplies yellow, outlets grey · drawn over the model</span>
              </div>
            );
          })()}
          {intensityLegend && tab === "bem-site" && (
            <div className="viewLegend">
              <b>solar intensity · {imperial ? "W/ft²" : "W/m²"} on {intensityLegend.painted} exterior surfaces</b>
              <span>{["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][sun.month - 1]} {sun.day} · {fmtHour(sun.hour)} · the weather file's hour {intensityLegend.hour}</span>
              <span className="muted">direct normal {fmtIrr(intensityLegend.rad.dni)} · diffuse {fmtIrr(intensityLegend.rad.dhi)} · global horizontal {fmtIrr(intensityLegend.rad.ghi)} {imperial ? "W/ft²" : "W/m²"}</span>
              <div className="legendBar sun" />
              <div className="legendEnds"><span>0</span><span>{fmtIrr(intensityLegend.maxWm2)} {imperial ? "W/ft²" : "W/m²"}</span></div>
              <span className="muted">isotropic sky, albedo 0.2, unshaded · {intensityLegend.epw.split(/[\\/]/).pop()?.replace(/\.epw$/i, "")}</span>
            </div>
          )}
        </div>
      </div>
      <div className="inspGrip" onPointerDown={dragInsp} title="drag to resize the inspectors" />
      {inspH > 0 && (
        <div className="inspector" style={{ height: inspH, gridTemplateColumns: eff.has("ifc") && eff.has("idf") ? "1fr 1fr" : "1fr" }}>
          <section hidden={!eff.has("ifc")}>
            <h4>IFC · {sel ? `#${sel.elementId}${selRow !== null ? ` · cell ${selRow}` : ""}` : roomSel ? `space #${roomSel.sp.expressId}` : selSpaceName ? `space · ${selSpaceName}` : selLevel ? `level · ${selLevel}` : "click a surface, a room or a level"}</h4>
            {roomSel && (
              <>
                <div><b>GlobalId</b> {roomSel.sp.globalId ?? "—"}</div>
                <div><b>type</b> Space · {spaceName(roomSel.sp)}</div>
                <div><b>face</b> {faceWord(roomSel.k.n)} · {orient(roomSel.k.n)}</div>
                <div><b>area</b> {fmtA(rowArea(roomSel.fileRow))} as the file draws it{roomSel.zoneRow && Math.abs(rowArea(roomSel.zoneRow) - rowArea(roomSel.fileRow)) > 1e-4 ? ` · ${fmtA(rowArea(roomSel.zoneRow))} as ruled` : ""}</div>
                <div><b>level</b> {roomSel.sp.storey ?? "—"}
                  {roomSel.sp.storeyElevM !== null ? ` · elev ${fmtL(roomSel.sp.storeyElevM)} ${lu}` : ""}</div>
                <div><b>volume</b> {fmtV(roomSel.fileVolume)} as the file draws it
                  {roomSel.ruledVolume !== null && Math.abs(roomSel.ruledVolume - roomSel.fileVolume) > 1e-6 ? ` · ${fmtV(roomSel.ruledVolume)} as ruled` : ""}</div>
              </>
            )}
            {elRow && sel && (
              <>
                <div><b>GlobalId</b> {elRow.globalId ?? "—"}</div>
                <div><b>type</b> {kindOf(elRow.ifcClass)}{elRow.name ? ` · ${elRow.name}` : ""}</div>
                <div><b>facing</b> {orient(sel.n)}</div>
                <div><b>area</b> {fmtA(area(ifcFaces))} on this plane</div>
                <div><b>level</b> {elRow.storey ?? "—"}
                  {elRow.storeyElevM !== null ? ` · elev ${fmtL(elRow.storeyElevM)} ${lu}` : ""}</div>
                <div><b>bounds</b> {elRow.spaces || "—"} <span className="dim">(the file)</span></div>
                <div><b>rooms</b> {[...related.spaces].join(", ") || "none claimed"} <span className="dim">(the cells)</span></div>
                <div><b>IsExternal</b> {elRow.isExternal === null ? "unstated" : String(elRow.isExternal)}</div>
                {(() => {
                  const g = glazingOf(elRow.ifcClass, elRow.name, elRow, glazingRuling(elRow.globalId));
                  if (!g) return null;
                  const why = g.source === "user" ? "your ruling"
                    : g.source === "file" ? (elRow.glazingFraction !== null ? `the file: GlazingAreaFraction ${elRow.glazingFraction}` : elRow.glazingPset ? "the file: a glazing pset" : "the file: an IfcWindow")
                    : "the file does not say · default from the type name";
                  return <div><b>glazing</b> <span className={g.source === "user" ? "src-user" : g.source === "default" ? "src-code" : "src-file"}>{g.glazed ? "glass" : "opaque"}</span> <span className="dim">({why})</span></div>;
                })()}
                {wallGrade.get(sel.elementId) && (
                  <div><b>grade</b> above {fmtA(wallGrade.get(sel.elementId)!.aboveM2)} · below {fmtA(wallGrade.get(sel.elementId)!.belowM2)}
                    {wallGrade.get(sel.elementId)!.fillM2 > 1e-3 ? ` (fill ${fmtA(wallGrade.get(sel.elementId)!.fillM2)})` : ""}
                    {" · ground "}{fmtL(wallGrade.get(sel.elementId)!.gradeMinM)}…{fmtL(wallGrade.get(sel.elementId)!.gradeMaxM)} {lu}</div>
                )}
                {selRow !== null && (() => {
                  const r = idfRowsRef.current.find((x) => x.id === selRow);
                  return r ? <div><b>cell</b> {r.ifcClass} · {fmtA(r.areaM2)} · {r.space ?? "—"}{r.spaceFacing ? ` ⟷ ${r.spaceFacing}` : ""}{r.grade ? ` · ${r.grade} grade` : ""}</div> : null;
                })()}
              </>
            )}
            {!sel && !roomSel && (selSpaceName || selLevel) && (() => {
              const sp = selSpaceName ? runRef.current?.spaces.find((x) => spaceName(x) === selSpaceName) ?? null : null;
              const z = zoneOf(selSpaceName);
              const lv = selLevel ? levels.find((l) => l.name === selLevel) ?? null : null;
              return (
                <>
                  {sp && <div><b>GlobalId</b> {sp.globalId ?? "—"}</div>}
                  {sp && <div><b>level</b> {sp.storey ?? "—"}{sp.storeyElevM !== null ? ` · elev ${fmtL(sp.storeyElevM)} ${lu}` : ""}</div>}
                  {selSpaceName && !sp && <div><b>type</b> attic (built over a ceiling)</div>}
                  {z && <div><b>volume</b> {fmtV(z.volumeM3)} <span className="dim">({z.volumeSource})</span></div>}
                  {lv && <div><b>elevation</b> {lv.elevM !== null ? `${fmtL(lv.elevM)} ${lu}` : "—"}</div>}
                  {lv && lv.elevM !== null && <div><b>height</b> {lv.heightM !== null ? `${fmtL(lv.heightM)} ${lu} to the ceiling ${lv.heightRooms} of ${lv.spaces.length - lv.shafts.length} occupied rooms share (the IfcSpace solids)${lv.heightOthers.length ? ` · others: ${lv.heightOthers.map((o) => `${o.name} ${fmtL(o.heightM)}`).join(", ")}` : ""}` : "no occupied rooms on it"}{lv.nextM !== null ? ` · the floor above: ${lv.nextName}, ${fmtL(lv.nextM)} ${lu} up` : " · no stated level above its ceiling"}{lv.floorsOk ? " · its occupied rooms' floors sit at the stated elevation" : " · some occupied room's floor is off the stated elevation"}</div>}
                  {lv && lv.shafts.length > 0 && <div><b>not occupied</b> {lv.shafts.map((x) => `${x.name} ${fmtL(x.bottomM)} → ${fmtL(x.topM)} ${lu} (a shaft: excluded from the height — the user's rule; the file states no occupancy)`).join(" · ")}</div>}
                  {lv && <div><b>rooms</b> {lv.spaces.map((x) => x.name).join(", ") || "—"}{lv.attics.length ? ` · ${lv.attics.length} attics` : ""}</div>}
                  <div><b>cells</b> {related.rowIds.size} on {related.elementIds.size} elements</div>
                </>
              );
            })()}
          </section>
          {module === "bem" && tab === "bem-constructions" && (
            <section>
              {(() => {
                const fenFrame = !!detailRow && consView === "detail" && (detailRow.kind === "window" || (detailRow.kind === "door" && detailRow.glazed === true));
                const head = consView === "plan" && detailRow ? `${detailName ?? detailRow.label} (${detailRow.section}) — CODE · IFC · IDF, the lit column governs; the assembly is edited in DETAIL`
                  : fenFrame ? `${detailName ?? detailRow!.label} (${detailRow!.section}) — the fenestration datasets; Apply at the right`
                  : detailRow && layerSel !== null ? `layer ${layerPos(layerSel)} of ${detailName ?? detailRow.label} — the category and its materials; a click replaces the layer`
                  : detailRow ? `options for ${detailName ?? detailRow.label} (${detailRow.section})`
                  : `${typeRows.filter((r) => r.section !== "Window" && r.section !== "Door").length} surface types · ${typeRows.filter((r) => r.section === "Window").length} window · ${typeRows.filter((r) => r.section === "Door").length} door`;
                return <h4 title={(consView === "plan" && detailRow) || fenFrame || layerSel !== null ? undefined : "the unique types the file names — a row click stages the ruling; Apply is in the column"}>CONSTRUCTIONS · {head}</h4>;
              })()}
              {consView === "plan" && detailRow ? (
                <ConstructionReading row={detailRow} imperial={imperial} codeLabel={energyCodeLabel} code={detailCode} codeShgc={detailRow.kind === "window" || detailRow.kind === "door" ? ieccFor(bemModel?.built.model.climateZone, bemModel?.built.model.energyCode).fenestrationSHGC ?? 0.40 : null} applied={bemLedger?.constructions?.[detailRow.key]} stage={detailStage} resolved={detailResolved} stagedSummary={detailSummary} onStage={stageCons} onDetail={() => setConsView("detail")} />
              ) : (
                <ConstructionOptions row={detailRow} library={libRef.current} stage={detailStage} onStage={stageCons} imperial={imperial} code={detailCode ? { name: detailCode.name, uWm2k: detailCode.uWm2k } : null} layerSel={layerSel} onLayer={setLayerSel} materials={materialsApi} onBrowse={(seq, q) => void openBrowser(q, seq < 0 ? "general" : "bcl")} onHand={(seq, role) => setDialog(newDialog(seq, role, imperial ? "IP" : "SI"))} dialog={dialog ? { seq: dialog.seq, editFrom: dialog.editFrom, name: dialog.form.name ?? "" } : null} onEdit={editMaterial} onRemove={(k) => void removeMaterial(k)} onFenHand={(key, label, section) => setFenDialog(newFenDialog(key, label, section))} onFenEdit={(key, label, g) => setFenDialog(editFenDialog(key, label, g, imperial))} />
              )}
            </section>
          )}
          {module === "bem" && tab === "bem-systems" && (
            <section className="asmSection">
              <h4>SYSTEMS · {MAIN_OF[sysFocus].toUpperCase()}{MAIN_OF[sysFocus] === "plumbing" ? ` · ${plumbAsm.nodes.length} component${plumbAsm.nodes.length === 1 ? "" : "s"} on the sheet${plumbCompiled.refusals.length ? ` · ${plumbCompiled.refusals.length} refused` : ""}` : MAIN_OF[sysFocus] === "electrical" ? ` · ${elecAsm.nodes.length} component${elecAsm.nodes.length === 1 ? "" : "s"} on the sheet${elecCompiled.refusals.length ? ` · ${elecCompiled.refusals.length} refused` : ""}` : ` › ${SECTION_LABELS[sysFocus]}`}{MAIN_OF[sysFocus] === "mechanical" ? ` · ${asm.nodes.length} component${asm.nodes.length === 1 ? "" : "s"} on the sheet${asmCompiled.refusals.length ? ` · ${asmCompiled.refusals.length} refused` : ""}` : ""}</h4>
              {MAIN_OF[sysFocus] === "plumbing"
                ? <AssemblyBench key="plumb" catalogue={plumbCatalogue} shelves={PLUMB_SHELVES} title="SYSTEMS · PLUMBING" />
                : MAIN_OF[sysFocus] === "electrical"
                ? <AssemblyBench key="elec" catalogue={elecCatalogue} shelves={ELEC_SHELVES} title="SYSTEMS · ELECTRICAL" />
                : MAIN_OF[sysFocus] === "mechanical"
                ? <AssemblyBench key="mech" catalogue={catalogue} />
                : <SystemOptions section={sysFocus} schema={schemaRef.current} imperial={imperial} ioRef={ioRef} stage={sysStage} applied={bemLedger?.systems} model={bemModel} />}
            </section>
          )}
          {module === "bem" && tab === "bem-site" && siteView === "model" && (
            <section>
              <h4 title="a checkbox shows or hides a file or a kind in the view · right-click a file or an item: project it, hide, delete from the model, or turn the file by degrees">SITE · the files beside {nameRef.current || "the house"} · {siteFiles.filter((f) => f.projected).length} of {siteFiles.length} projected</h4>
              <SiteFilesFrame files={siteFiles} siteName={siteFileName} rows={siteRows} hiddenFiles={hiddenFiles} selected={selSite} busy={busy} onShowFile={showSiteFile} onShowKind={showSiteElements}
                onSelect={(ids) => { const n = new Set(ids ?? []); selSiteRef.current = n; setSelSite(n); if (showTerrainRef.current) applyTerrain(true); }} onRestore={restoreSiteElement} onRestoreAll={restoreSiteElements}
                onMenu={(m) => setMenu({ x: m.x, y: m.y, elementId: 0, key: null, label: m.kind ? `${m.kind.ids.length} × ${m.kind.name} · ${m.file}` : m.file, siteIds: m.kind?.ids, siteFile: m.file, siteFileProjected: m.projected })} />
            </section>
          )}
          {module === "bem" && tab === "bem-site" && siteView === "location" && (
            <section>
              <h4>LOCATION · confirm the project site · {bemLedger?.site?.location ? "a located position is the ruling" : "the IfcSite's position is in force"}</h4>
              <LocationLocator fileAddress={siteAddress} fileSite={runRef.current?.site ?? null} located={locPick?.loc ?? bemLedger?.site?.location} imperial={imperial}
                satellite={satellite} onSatellite={setSatellite}
                onLocate={(loc) => setLocPick((q) => ({ loc, seq: (q?.seq ?? 0) + 1 }))} onClear={() => setLocPick((q) => ({ loc: null, seq: (q?.seq ?? 0) + 1 }))} />
            </section>
          )}
          {module === "bem" && tab === "bem-site" && siteView === "weather" && (
            <section>
              <h4>WEATHER FILES · in force: {baseName(inForcePath).replace(/\.epw$/i, "")}{bemLedger?.weather?.epw ? "" : " (the default)"} · project zone by county {countyZone ? `${countyZone.zone} (${countyZone.county} County, ${countyZone.state})` : "not identified"} · {installedWmos.size} stations installed in the engine's WeatherData</h4>
              <StationList stations={nearStations} projectZone={projectZone} onlySameZone={onlySameZone} onOnlySameZone={setOnlySameZone} zoom={mapBounds?.zoom ?? null} listingWord={stationsWord} onRefresh={() => void loadStations(true)}
                inForcePath={inForcePath} installedPaths={epwList} focus={focusStation} onFocus={setFocusStation} onUse={(f) => void useStation(f)} busy={stationsBusy || bemBusy} imperial={imperial} humidity={humidityByWmo} />
            </section>
          )}
          {module === "bem" && tab === "bem-site" && siteView === "solar" && (
            <section>
              <h4>SITE · {siteWord || "no site file beside the IFC"} · {deciduous ? `deciduous trees at ${(100 * (1 - treeTransmittance(sun.month, "Deciduous"))).toFixed(0)}% opacity in ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][sun.month - 1]}` : "trees at full shade (deciduous modelling off)"}</h4>
              <SiteFilesFrame files={siteFiles} siteName={siteFileName} rows={siteRows} hiddenFiles={hiddenFiles} selected={selSite} busy={busy} onShowFile={showSiteFile} onShowKind={showSiteElements}
                onSelect={(ids) => { const n = new Set(ids ?? []); selSiteRef.current = n; setSelSite(n); if (showTerrainRef.current) applyTerrain(true); }} onRestore={restoreSiteElement} onRestoreAll={restoreSiteElements}
                onMenu={(m) => setMenu({ x: m.x, y: m.y, elementId: 0, key: null, label: m.kind ? `${m.kind.ids.length} × ${m.kind.name} · ${m.file}` : m.file, siteIds: m.kind?.ids, siteFile: m.file, siteFileProjected: m.projected })} />
              <div className="idfInfo">
                {sunInfo
                  ? `sun ${sunInfo.altitudeDeg > 0 ? `${sunInfo.altitudeDeg.toFixed(1)}° above the horizon, ${sunInfo.azimuthDeg.toFixed(0)}° from true north` : "below the horizon"} · sunrise ${fmtHour(sunInfo.sunriseH)} · solar noon ${fmtHour(sunInfo.solarNoonH)} · sunset ${fmtHour(sunInfo.sunsetH)}`
                  : "the IfcSite states no position"}
                {" "}· the red tick is true north · the shadows are cast from the sun's direction in the view; EnergyPlus casts its own from the same equations
              </div>
            </section>
          )}
          {cfdTab && cfdBatch && (
            <section className="asmSection">
              <h4 title="the spaces selected, each with the setup made for it, the peaks and the processors">CFD · SPACES · PROCESSORS</h4>
              <CfdBatchDialog inline rooms={cfdBatch.rooms} idf={cfdBatch.idf} engine={cfdBatch.engine} machine={cfdBatch.machine}
                offerOf={(space, faces) => cfdOffer({ space, faces, idf: cfdBatch.idf, idfDb: cfdBatch.idfDb, bemDb: cfdBatch.bemDb, stamp: cfdBatch.stamp })}
                onCancel={closeCfdBatch}
                onSetUp={(space) => { cfdWantRef.current = space; closeCfdBatch(); void openCfdDialog(space); }}
                onRun={(jobs, plan) => { const d = cfdBatch; closeCfdBatch(); void runCfdJobs(d.stamp, jobs.map((j, i) => ({ space: j.space, case: j.case, np: plan.jobs[i]?.procs ?? 1 }))); }} />
            </section>
          )}
          {cfdTab && !cfdBatch && cfdView === "setup" && cfdSetupIn && (
            <section className="asmSection">
              <h4 title="the room's setup, tab by tab — saved as it is set, in the project's BOM ledger">CFD · SETUP · {cfdSetupIn.space} · {cfdSetupTab}</h4>
              <CfdSetupFrame s={cfdSet} tab={cfdSetupTab} onTab={setCfdSetupTab} imperial={imperial}
                supply={<SupplyAirPanel space={cfdSetupIn.space} peak={cfdPeak} offer={cfdSetupIn.offer} why={null} saved={cfdSet.choices} imperial={imperial}
                  lastRunC={(([...cfdRuns].reverse().find((r) => r.space === cfdSetupIn.space && r.peak === cfdPeak)?.settings) as { supply_c?: number } | undefined)?.supply_c ?? null}
                  onChange={(pk, sc) => cfdSet.update((c) => ({ ...c, supply: { ...(c.supply ?? {}), [pk]: sc } }))}
                  onSetpoint={(pk, v) => cfdSet.update((c) => ({ ...c, setpoints: { ...c.setpoints, [pk]: v ?? cfdSetupIn.offer.peaks.find((p) => p.peak === pk)?.setpointC ?? null } }))} />}
                onRun={(cases, np) => void runCfdJobs(cfdSetupIn.stamp, cases.map((c) => ({ space: cfdSetupIn.space, case: c, np })))} />
            </section>
          )}
          {cfdTab && !cfdBatch && cfdView === "results" && (
            <section className="asmSection">
              <h4 title="the run's air drawn as slices, its speeds and the flow through each opening — each its own tab">CFD · {cfdFrameTab}{cfdShown ? ` · ${cfdShown.run.space} · ${cfdShown.run.peak}` : ""}</h4>
              <CfdFrame shown={cfdShown} tab={cfdFrameTab} onTab={setCfdFrameTab} field={cfdField} onField={setCfdField} imperial={imperial}
                supply={(() => {
                  const sp = cfdSpace, saved = sp ? loadCfdChoices(sp) : null;
                  void cfdSupplyRev; // re-read the saved choices after an edit
                  const last = [...cfdRuns].reverse().find((r) => r.space === sp && r.peak === cfdPeak);
                  const lastC = last && cfdShown?.run.id === last.id ? cfdShown.openings.find((o) => o.dir === "in")?.tC ?? null : (last?.settings as { supply_c?: number } | undefined)?.supply_c ?? null;
                  return <SupplyAirPanel space={sp} peak={cfdPeak} offer={cfdSupplyOffer?.space === sp ? cfdSupplyOffer.offer : null} why={cfdSupplyOffer?.space === sp ? cfdSupplyOffer.why : null}
                    saved={saved} lastRunC={lastC} imperial={imperial}
                    onChange={(pk, sc) => { if (!sp) return; if (cfdSetupIn?.space === sp) { cfdSet.update((c) => ({ ...c, supply: { ...(c.supply ?? {}), [pk]: sc } })); setCfdSupplyRev((n) => n + 1); return; } const cur = loadCfdChoices(sp) ?? {}; saveCfdChoices(sp, { ...cur, supply: { ...(cur.supply ?? {}), [pk]: sc } } as never); setCfdSupplyRev((n) => n + 1); }}
                    onSetpoint={(pk, c) => { if (!sp) return; if (cfdSetupIn?.space === sp) { const th = cfdSupplyOffer?.offer?.peaks.find((p) => p.peak === pk)?.setpointC ?? null; cfdSet.update((x) => ({ ...x, setpoints: { ...x.setpoints, [pk]: c ?? th } })); setCfdSupplyRev((n) => n + 1); return; } const cur = loadCfdChoices(sp) ?? {}; const th = cfdSupplyOffer?.offer?.peaks.find((p) => p.peak === pk)?.setpointC ?? null; saveCfdChoices(sp, { ...cur, setpoints: { ...(cur.setpoints ?? {}), [pk]: c ?? th } } as never); setCfdSupplyRev((n) => n + 1); }} />;
                })()} />
            </section>
          )}
          {module === "bom" && costView && (
            <section className="asmSection">
              <h4 title={bomRail === "UTILITY" ? "the tariff cards — select one for its details in the column" : bomRail === "WEATHER" ? "the weather the run used, and an actual year" : "the bills imported"}>BOM · {bomRail}</h4>
              <BomFrame rail={bomRail} onRail={setBomRail} sel={bomSel} onSel={setBomSel}
                cards={(tariffRead?.file?.cards ?? []).map((card) => ({ card, applied: bomTariff?.card === card.id || (!bomTariff && !!card.sample) }))}
                weather={epwLine ? { name: (bem?.run.epw ?? bemEpw ?? "").split(/[\\/]/).pop() || "the weather file", line: epwLine } : null}
                imports={bomImports.map((i) => ({ sha256: i.sha256, name: i.name, rows: i.csv.rows.length }))} />
            </section>
          )}
          {module === "bem" && tab === "bem-run" && graphView && (
            <section>
              <h4 title={runGraph.section === "annual" ? "the lines the graph draws, summed over the window in view and at the points clicked" : "the parts and loads the view draws"}>RUN · {runGraph.section === "annual" ? "ANNUAL — the lines summed" : "PEAK"}{bem ? ` · run ${bem.stamp}` : " · no run yet"}</h4>
              <RunGraphFrame state={runGraph} onState={setRunGraph} bem={bem} imperial={imperial} spacesByZone={bemModel?.report.model.spacesByZone} />
            </section>
          )}
          {module === "bem" && tab === "bem-schedules" && (
            <section>
              <h4 title="the values the view shows">SCHEDULES · {schedCard ? `${ROLE_LABELS[schedCard]}${calProfile ? ` · ${calProfile.name}` : " · the code default"}` : "the run calendar"} · {calAt.level}{calAt.level !== "year" ? ` · ${dayLabel(runCal, calAt.n)}` : ""}</h4>
              {schedCard && <ScheduleEditor profile={calProfile} role={schedCard} cal={runCal} at={calAt} imperial={imperial} library={libRef.current} onDraft={setSchedDraft} onSave={saveUserSchedule}
                holidays={holStage} onHolidays={setHolStage} calendars={userCal} onKeep={keepCalendar} onCalMode={setCalMode} />}
              {!schedCard && <div className="muted" title="pick a card in the column to edit its day profiles">no schedule selected</div>}
            </section>
          )}
          {module === "bem" && tab === "bem-zones" && (
            <section className="asmSection">
              <h4 title={frameZone ? "the zone's settings — every room takes them" : "pick a zone in the column, or a room — in the tree, under a zone's card, or in the model"}>ZONES · {frameZone ? frameZone.name : "—"}{selSpaceName ? ` › ${selSpaceName}` : frameZone ? ` · ${frameZone.rooms.length} room${frameZone.rooms.length === 1 ? "" : "s"}` : " · no zone selected"}{gainPending ? ` · ${gainPending} staged` : ""}</h4>
              <ZoneFrame zone={frameZone} space={selSpaceName} rooms={bemModel?.rooms ?? []} stage={gainStage} onStage={setGainStage}
                surfacesOf={surfacesOfRoom} fixturesOf={(r) => mepElementsRef.current.filter((e) => FOCUS.lighting(e) && e.room === r)}
                table={{ hi, onHi: setHi, selRow, selElementId: sel?.elementId ?? null, bem, onRuleGlazing: ruleGlazing }}
                schedules={bemModel?.schedules ?? []} fmtA={fmtA} imperial={imperial} tab={zoneFrameTab} onTab={setZoneFrameTab} />
            </section>
          )}
          {/* THE LENS UNDER THE VIEW (user, 2026-10-08: "Those values are seen in the view, so it needs to be under the view"): on RUN, the
              picker and its legend — each zone in its colour with its heating and cooling peaks — in the frame under the zone model it paints */}
          {module === "bem" && tab === "bem-run" && eff.has("idf") && !graphView && !reportView && (
            <section className="lensFrame">
              {/* SURFACE TEMPERATURES (user, 2026-10-12: "The IDF-DB Zone model wasn't requested, as it is redundant, although I did ask for
                  surface temperatures to be shown"): RUN's model is painted by the design-day surface temperatures alone */}
              <h4>SURFACE TEMPERATURES · {LENSES.find((l) => l.id === lens)?.label ?? lens}</h4>
              <LensPicker only={["surface-temp-winter", "surface-temp-summer"]} lens={lens} legend={legend} hasRun={!!bem} onLens={(l) => applyLens(l)} imperial={imperial}
                hour={lens === "surface-temp-summer" ? lensHour.summer ?? peakHourOf(bem, "summer") : lens === "surface-temp-winter" ? lensHour.winter ?? peakHourOf(bem, "winter") : undefined}
                onHour={(h) => { const day = lens === "surface-temp-summer" ? "summer" : "winter"; const next = { ...lensHourRef.current, [day]: h }; lensHourRef.current = next; setLensHour(next); applyLens(lens); }}
                hourWords={lens === "surface-temp-summer" || lens === "surface-temp-winter"
                  ? (!bem?.designSurfaceTemps?.[lens === "surface-temp-summer" ? "summer" : "winter"].size ? "— this run has no design-day surface temperatures (runs before 2026-10-08); run again"
                    : (lens === "surface-temp-summer" ? lensHour.summer : lensHour.winter) === null ? `— the zones' median ${lens === "surface-temp-summer" ? "cooling" : "heating"} peak hour on the design day` : "")
                  : undefined} />
            </section>
          )}
          <section hidden={!views.idf || (module === "bom" && costView) || cfdTab || (module === "bem" && (tab === "bem-constructions" || tab === "bem-site" || tab === "bem-systems" || tab === "bem-zones" || tab === "bem-schedules" || (tab === "bem-run" && (graphView || reportView))))}>
            <h4>IDF-DB · {shownSpace ?? (sel ? "no room claims this element" : "—")} · net areas in {imperial ? "ft²" : "m²"}</h4>
            {related.tableSpaces.length > 1 && (
              <div className="spaceTabs">
                {related.tableSpaces.map((x) => <button key={x} className={x === shownSpace ? "on" : ""} onClick={() => setTableSpace(x)}>{x}</button>)}
              </div>
            )}
            {shownSpace && <SpaceTableView rows={spaceRows} summary={summary} hi={hi} onHi={setHi} selRow={selRow} selElementId={sel?.elementId ?? null} bem={bem} fmtA={fmtA} onRuleGlazing={ruleGlazing} />}
            {!shownSpace && sel && <div className="vhead">{idfRowsRef.current.filter((r) => r.elementId === sel.elementId).length} cells on this element, none claimed by a room</div>}
          </section>
        </div>
      )}
      </div>
      <div className="editGrip" onPointerDown={dragEdit} title="drag to resize the editing column" />
      <aside className="editCol" style={{ width: editW }}>
          <div className="viewTabs editTabs">
            {tabsOf(module).map((t) => (
              <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)} title={t.title}>{t.label}</button>
            ))}
          </div>
          {tab === "bem-systems" && (
            // the disciplines as sub-tabs of SYSTEMS (user, 2026-09-10): MECHANICAL is the assembly sheet; the others come with their slices
            <div className="subTabs">
              {([["mechanical", "MECHANICAL", "heating"], ["electrical", "ELECTRICAL", "power"], ["plumbing", "PLUMBING", "dhw"]] as const).map(([m, label, first]) => (
                <button key={m} className={MAIN_OF[sysFocus] === m ? "on" : ""} onClick={() => setSysFocus(first)}>{label}</button>
              ))}
            </div>
          )}
          {/* the tabs above stay put; only what is under them scrolls (user, 2026-10-02) */}
          <div className="editScroll">
          {tab === "bem-site" && (
            <BemSite model={bemModel} codeTables={sources.energyCodes.tables ?? DEFAULT_CODE_TABLES} sources={{ own: window.projectNow ? templateSources : null, template: STANDARD_SOURCES, onSave: (next) => void saveSources(next) }} onCodesSaved={() => { energyCodesReadRef.current = null; void energyCodesRead().then(() => refreshBemModel()); }} county={countyZone} site={runRef.current?.site ?? null} elevation={runRef.current ? projectElevation(runRef.current) : null} trueNorth={runRef.current?.trueNorth ?? null}
              epw={bemLedger?.weather?.epw ?? null} epwList={epwList} ruling={bemLedger?.site ?? EMPTY_SITE} busy={bemBusy || bemRunning} imperial={imperial}
              onEpw={chooseEpw} onPickEpw={() => void pickEpw()} onApply={applySite} staged={siteStage ?? bemLedger?.staged?.site} onStage={setSiteStage}
              sun={sun} onSun={setSun} cycle={cycle} onCycle={setCycle} deciduous={deciduous} onDeciduous={setDeciduous} intensity={intensity} onIntensity={setIntensity}
              sunInfo={sunInfo} timeZone={bemModel?.weather?.header?.timeZone ?? null} siteWord={siteWord}
              focus={siteFocus} solar={solar}
              // the view is the last one asked for (user, 2026-10-26: the map did not show with Solar Studies on): the map or the
              // stations turn the solar study off, and the solar study brings the model back
              onFocus={(f) => { setSiteFocus(f); if (f !== "model") setSolar(false); }}
              onSolar={(on) => { setSolar(on); if (on) setSiteFocus("model"); }} address={siteAddress} locPick={locPick} />
          )}
          {tab === "bem-constructions" && <BemConstructions groundTable={groundTable} groundFacts={detailGround && detailRow ? { g: detailGround, label: detailRow.label } : undefined} model={bemModel} imperial={imperial} rows={typeRows} ledger={bemLedger} library={libRef.current} libCensus={`${libCensus}${materialsCensus ? ` · materials.db: ${materialsCensus}` : ""}`} stage={consStage} onStage={stageCons} onRevert={() => { setConsStage(bemLedger?.constructions ?? {}); setConsGround(bemLedger?.ground); }} ground={consGround} onGround={setConsGround} onApply={applyConstructions} busy={bemBusy} selected={typeSel} onSelect={selectType} paint={consPaint} onPaint={setConsPaint} windowProducts={windowProducts} doorProducts={doorProducts} onFenNew={(key, label, unitAreaM2, count, section) => setFenDialog({ ...newFenDialog(key, label, section), unitAreaM2, unitCount: count, custom: true })}  onDoorGlazing={(ids, g) => void ruleDoorGlazing(ids, g)} doorGlazingRuled={doorGlazingRuled} />}
          {tab === "bem-schedules" && <BemSchedules model={bemModel} library={libRef.current} stage={schedStage} onStage={(role, ref) => setSchedStage((st) => { const n = { ...st }; if (ref) n[role] = ref; else delete n[role]; return n; })} onRevert={() => { setSchedStage(bemLedger?.schedules ?? {}); setHolStage(appliedHolidays(bemLedger)); setCopyStage({}); }} onApply={applySchedules} busy={bemBusy} ledger={bemLedger} imperial={imperial} card={schedCard} onCard={setSchedCard}
            holidays={holStage} holidaysApplied={appliedHolidays(bemLedger)} seasons={userCal.seasons} copiesPending={Object.keys(copyStage).filter((k) => Object.values(schedStage).some((r) => r?.file === USER_SCHEDULE_FILE && r.name.toLowerCase() === k))} />}
          {tab === "bem-zones" && <BemZones model={bemModel} selectedZone={selZone} onZone={pickZone} imperial={imperial} lens={lens} legend={legend} hasRun={bem !== null} onLens={(l) => applyLens(l)}
            assembly={asm} assign={asmAssign} onAssign={setZoneAssign} onByLevel={() => { const n = zonesByLevel(); setStatus(n ? `${n} zone${n === 1 ? "" : "s"} made, one per level — staged: Save on ZONES keeps them` : "every room is already in a zone"); }} pending={diagramDiff(sysStage, bemLedger?.systems).pending} onApply={() => { void applySystems(sysStage); }} onRevert={() => setSysStage(bemLedger?.systems ?? {})} busy={bemBusy} compiled={asmCompiled} onAssembly={setAssembly}
            selectedSpace={selSpaceName} onSpace={(room, zone) => { selectSpaceName(room); setSelZone(zone); }} gainPending={gainPending} isBedroom={(room) => isBedroom(room, bedroomMarksOf(gainStage))} onBedroom={tickBedroom} onApplyGains={() => { void applyGains(gainStage); }} onRevertGains={() => setGainStage(bemLedger?.gains ?? {})} infilTable={infilTable}
            transfers={gainStage.transfers ?? []} onTransfers={(t) => setGainStage((g) => { const n = { ...g }; if (t.length) n.transfers = t; else delete n.transfers; return n; })}
            designFlow={(room) => { const l = bem?.loads?.spaces.get(room.toUpperCase()); return l ? { heating: l.designHeatingFlowM3s, cooling: l.designCoolingFlowM3s } : null; }} />}
          {tab === "bem-systems" && MAIN_OF[sysFocus] === "electrical" && (
            <ElectricalColumn imperial={imperial} asm={elecAsm} onChange={setElecAssembly} sel={elecSel} onSel={setElecSel} compiled={elecCompiled} panels={pvPanels} catalogueLabel={(c) => elecCatalogue.of(c)?.label ?? c}
              written={bemModel?.built.model.pv} writtenNote={bemModel?.settings.find((x) => x.key === "generation")?.value ?? null}
              pending={elecPending} onSave={saveElectrical} onRevert={() => setSysStage((st) => { const n = { ...st }; const g = bemLedger?.systems?.generation; if (g) n.generation = g; else delete n.generation; return n; })} busy={bemBusy || bemRunning}
              onFromFile={() => setElecAssembly(sheetFromFile(pvPanels, bemLedger?.systems?.generation?.pv?.fields))}
              onShow={(ids) => { const s2 = new Set(ids); selMepRef.current = s2; setSelMep(s2); setSysView("model"); }} ioRef={ioRef} />
          )}
          {tab === "bem-systems" && MAIN_OF[sysFocus] === "plumbing" && (
            <PlumbingColumn bedroomMarks={appliedBedroomMarks} asm={plumbAsm} onChange={setPlumbAssembly} sel={plumbSel} onSel={setPlumbSel} compiled={plumbCompiled} rooms={plumbRooms} catalogueLabel={(c) => plumbCatalogue.of(c)?.label ?? c}
              writtenNote={bemModel?.built.model.systems?.list.filter((s) => s.id === "DHW" || s.id === "DW").map((s) => s.note).join(" · ") || null}
              pending={plumbPending} onSave={() => { void savePlumbing(); }} onRevert={() => setSysStage((st) => { const n = { ...st }; const d = bemLedger?.systems?.dhw; if (d) n.dhw = d; else delete n.dhw; return n; })} busy={bemBusy || bemRunning}
              fileHeaters={fileHeaters} onFromFile={() => setPlumbAssembly(plumbFromFile(fileHeaters, new Map(plumbRooms.map((r) => [r.room, r.zone])), plumbRooms.filter((r) => r.conditioned).map((r) => r.room)))}
              ioRef={ioRef} imperial={imperial} occupants={plumbOccupants} />
          )}
          {tab === "bem-systems" && MAIN_OF[sysFocus] !== "mechanical" && <DisciplineColumn main={MAIN_OF[sysFocus]} model={bemModel} mep={mepElementsRef.current} focus={sysFocus} onFocus={setSysFocus}
            sheet={MAIN_OF[sysFocus] === "plumbing" ? plumbItems : undefined} onPick={(n) => setPlumbSel(n)} />}
          {tab === "bem-systems" && MAIN_OF[sysFocus] === "mechanical" && <BemSystems draft={draftNote} sha={shaRef.current} onRestore={restoreSystems} model={bemModel}
            stage={sysStage} applied={bemLedger?.systems} onApply={applySystems} onRevert={() => setSysStage(bemLedger?.systems ?? {})} busy={bemBusy}
            settings={{ runSizing: bem?.sizingDetails ?? null, asm, assign: asmAssign, onChange: setAssembly, sel: asmSel, onSel: setAsmSel, compiled: asmCompiled, schema: schemaRef.current, catalogue, model: bemModel, input: bemModel?.input ?? null, conditioned: asmConditioned, imperial, ioRef, ventilationScheduled: !!(schedStage.ventilation ?? bemLedger?.schedules?.ventilation), schedules: sysSchedules, availabilityRole: schedStage["hvac-availability"] ?? bemLedger?.schedules?.["hvac-availability"] ?? null }} />}
          {tab === "bem-run" && (
            <BemRun structures={runStructures} onCosts={() => setTab("bom-ops")} model={bemModel} bem={bem} engine={bemEngine} idfReady={idfRowsRef.current.length > 0} running={bemRunning}
              lastLine={bemLog[bemLog.length - 1] ?? ""} validation={validation} lens={lens} legend={legend} imperial={imperial} stagedNote={runStagedNote}
              onValidate={() => void validateModel()} onRun={() => (runBlocks.length ? setRunBlocked(true) : void runBem())} onLens={(l) => applyLens(l)}
              onDock={(d) => toggleSection(d)} isOpen={(d) => open.has(d)} onPrint={() => printAs(`BEM · Run report — ${projectName}`)} onApproveSide={(z, side, on) => void approveSide(z, side, on)} busy={bemBusy} />
          )}
          {module === "bem" && tab === "bem-run" && bem && (
            <RunReport bem={bem} model={bemModel} imperial={imperial} project={(pathRef.current.split(/[\\/]/).pop() ?? "").replace(/\.ifc$/i, "")} />
          )}
          {module === "bom" && bomSel?.rail === "UTILITY" && (() => {
            const card = tariffRead?.file?.cards.find((c) => c.id === bomSel.id);
            return card ? <TariffDetails key={card.id} card={card} ledger={bomTariff} billedPca={pcaFromStatements(bomStatements.bills)} busy={bemBusy} onApply={(t) => applyTariff(card.id, t)} onRemove={() => applyTariff(card.id, null)} /> : null;
          })()}
          {module === "bom" && bomSel?.rail === "WEATHER" && (
            <div className="sysSettings bomDetails">
              <div className="barHead">{bomSel.id === "amy" ? "the actual weather — NOAA + Open-Meteo" : "the weather the run used"}</div>
              {bomSel.id === "amy"
                ? <WeatherMaker bills={[...bomImports.flatMap((i) => i.bills), ...statementBills(bomStatements)]} site={siteInForce ? { latitude: siteInForce.latitude, longitude: siteInForce.longitude } : null} template={bemLedger?.weather?.epw} station={sources.amyStation} />
                : <><div className="idfInfo">{epwLine}</div><div className="idfInfo">a typical year cannot calibrate against bills metered in a real one — an actual year can</div></>}
            </div>
          )}
          {cfdTab && (
            <div className="cfdProcFrame">
              <div className="barHead">PROCESSORS</div>
              <div className="idfInfo">{cfdMachine ? machineLine(cfdMachine) : "reading this machine…"}</div>
              {/* SPACE OR SPACES, THEN SELECT (2026-11-11, the user) — one excludes the other */}
              <div className="cfdPickBar">
                {(["space", "spaces"] as const).map((m) => (
                  <button key={m} className={`qaBtn${cfdPickMode === m ? " on" : ""}`} onClick={() => { setCfdPickMode((x) => (x === m ? null : m)); setCfdSelecting(false); setCfdPicks([]); }}
                    title={m === "space" ? "run one space, split across the processors" : "run several spaces side by side, each on a share of the processors"}>{m === "space" ? "Space" : "Spaces"}</button>
                ))}
                {cfdPickMode && <button className={`qaBtn cfdGo${cfdSelecting ? " on" : ""}`} onClick={pressCfdSelect} title="Select space in left column and press this Select button again when ready to run">Select</button>}
              </div>
              {cfdPickMode && cfdSelecting && <div className="idfInfo">{cfdPickMode === "space" ? (cfdPicks[0] ?? cfdSpace ?? "no space yet") : cfdPicks.length ? `${cfdPicks.length} selected: ${cfdPicks.join(" · ")}` : "none selected"}</div>}
              {!cfdSelecting && (cfdBatch || (cfdPickMode === "space" && cfdView === "setup")) && <div className="idfInfo muted">review the PROCESSORS tab in the frame below the view, then run</div>}
              {cfdJobs.length > 0 && <div className="idfInfo">{cfdJobs.length} run{cfdJobs.length === 1 ? "" : "s"} · {cfdJobs.filter((r) => r.label !== "waiting" && !r.error).reduce((t, r) => t + r.np, 0)} processes busy</div>}
            </div>
          )}
          {cfdTab && cfdJobs.length > 1 && <div className="cfdRunHead"><b>CFD · {cfdJobs.length} runs</b> <button className="qaBtn" onClick={() => { for (const r of cfdJobs) if (!r.error) void window.cfd.cancel(r.stamp); }} title="stop every run; their folders stay in data/cfd/runs/">Cancel all</button></div>}
          {cfdTab && cfdJobs.map((r) => (
            <div key={r.stamp} className="cfdRunBox">
              <b>CFD · {r.space} · {r.peak} · {r.np > 1 ? `${r.np} processes` : "serial"}</b>
              {r.diag && <div className="cfdDiag">
                <div><b>Why:</b> {r.diag.cause}</div>
                <div><b>What to do</b> <span className="muted">({r.diag.by === "you" ? "your choices in Run CFD…" : r.diag.by})</span><b>:</b> {r.diag.remedy}</div>
                <details><summary className="muted">OpenFOAM's words</summary><pre>{r.diag.excerpt.join("\n")}</pre></details>
              </div>}
              <span>{r.error ? <span className={r.diag ? "muted" : "bad"}>✗ {r.error}</span> : r.label === "waiting" ? "waiting for processors" : `step ${r.step + 1} of ${r.steps} · ${r.label}${r.label === "the solve" ? ` · iteration ${r.iteration.toLocaleString()} of ${r.iterations.toLocaleString()}` : ""}`}</span>
              {r.label === "the solve" && !r.error && <div className="bar"><span style={{ width: `${(100 * r.iteration) / Math.max(1, r.iterations)}%` }} /></div>}
              <span className="muted">{r.last}</span>
              {r.error ? <button className="qaBtn" onClick={() => setCfdJobs((x) => x.filter((y) => y.stamp !== r.stamp))}>Dismiss</button> : <button className="qaBtn" onClick={() => void window.cfd.cancel(r.stamp)} title="stop OpenFOAM; the run's folder stays in data/cfd/runs/">Cancel the run</button>}
            </div>
          ))}
          {cfdTab && <CfdColumn shown={cfdShown} runs={cfdRuns} imperial={imperial} onPick={setCfdPick} />}
          {bomOps && (
            <BomColumn place={{ address: siteAddress ?? null, county: countyZone?.county || null, state: countyZone?.state || null }}
              imports={bomImports} pending={bomPending} outcome={bom} bemStamp={bem?.stamp ?? null}
              metersAvailable={[...new Set((bem?.daily ?? []).map((d) => d.name))]} meters={bomMeters} epwLine={epwLine} busy={bomBusy}
              onImport={() => void importCsv()}
              onMap={(map) => setBomPending((p) => (p ? importBills(p.name, p.text, map) : p))}
              onConfirm={() => void confirmImport()} onCancelPending={() => setBomPending(null)}
              onMeters={(m) => { setBomMeters(m); void recomputeBom(undefined, m); }}
              onRecompute={() => void recomputeBom()}
              statements={bomStatements} format={bomStatements.formats[0] ?? DEFAULT_BILL_FORMAT}
              onStatements={changeStatements} onFormat={() => setBillFormatOpen(true)}
              onDock={(d) => toggleSection(d)} isOpen={(d) => open.has(d)} onPrint={() => printAs(`BOM · Energy & Cost — ${projectName}`)}
              costTables={<BomCostTables meters={pricedMeters} statements={bomStatements.bills} priced={pricedBom} calibrated={pricedCal} withoutPv={{ standard: pricedStdNo, calibrated: pricedCalNo, bills: billNoPv }} pv={hasPv} applied={(!!bomTariff && pricedBom?.card.id === bomTariff.card) || (!bomTariff && !!pricedBom?.card.sample)} why={!bem ? "no run yet — run the model on BEM › RUN; its months are priced here" : !tariffRead?.usable.length ? "no tariff card is readable (references/tariffs/)" : null} />}
              calibrationRun={(() => {
                const bills = [...bomImports.flatMap((i) => i.bills), ...statementBills(bomStatements)].filter((b) => !bomExcluded.has(`${b.account}|${b.periodStart}`));
                const span = bills.length ? { a: bills.reduce((m, b) => (b.periodStart < m ? b.periodStart : m), bills[0]!.periodStart), b: bills.reduce((m, b) => (b.periodEnd > m ? b.periodEnd : m), bills[0]!.periodEnd) } : null;
                // the PV's first day, until typed: the first bill that sent energy to the grid — the bills' own word
                const firstGen = bills.filter((b) => (b.receivedKwh ?? 0) > 0).map((b) => b.periodStart).sort()[0] ?? "";
                return <BomCalibration bills={bills} span={span} archiveEnd={latestEnd()} pvOn={calPvOn || firstGen} onPvOn={(v) => { setCalPvOn(v); setCalibration({ pvOn: v }); }}
                  pv={calPv} hasPv={hasPv} onImportPv={() => void importPv()} run={calRun} busy={calBusy} onRun={() => span && void runCalibrationYear(span)}
                  onRunOwn={() => { if (span) void window.bem.pickEpw().then((f) => { if (f) void runCalibrationYear(span, f); }); }} />;
              })()}
            />
          )}
          {module === "bom" && billFormatOpen && <BillFormatDialog format={bomStatements.formats[0] ?? DEFAULT_BILL_FORMAT} onSave={saveBillFormat} onCancel={() => setBillFormatOpen(false)} />}
          {module === "bom" && (
            <BomReport pv={hasPv} meters={pricedMeters} priced={pricedBom} tariff={bomTariff} project={(pathRef.current.split(/[\\/]/).pop() ?? "").replace(/\.ifc$/i, "")} runStamp={bem?.stamp ?? null}
              weather={`${(bem?.run.epw ?? bemEpw ?? "").split(/[\\/]/).pop() || "the weather file"} · ${epwLine}`} />
          )}
            {tab === "bem-run" && open.has("bem-results") && bem && <BemResultsPanel bem={bem} selectedZone={selZone} onZone={setSelZone} imperial={imperial} />}
            {tab === "bem-run" && open.has("bem-run") && <BemRunPanel bem={bem} log={bemLog} />}
            {module === "bom" && open.has("bom-bills") && bom && <BomBillsPanel outcome={bom} excluded={bomExcluded} onToggle={toggleBill} />}
            {module === "bom" && open.has("bom-calibration") && bom && <BomCalibrationPanel outcome={bom} />}
          {module === "bim" && (
          <div className="idfBar">
            {projectView && (
              <>
                <button className={`qaBtn sec${open.has("project") ? " on" : ""}`} onClick={() => toggleSection("project")} title="the project this file belongs to (its IfcProject GlobalId) and every version the store holds for it, each under the one it was made from">
                  {open.has("project") ? "▾" : "▸"} project ({projectView.versions.length} version{projectView.versions.length === 1 ? "" : "s"})
                </button>
                {open.has("project") && (
                  <ProjectPanel project={projectView} currentSha={shaRef.current} busy={busy} note={projectOpNote}
                    onExport={() => void (async () => { const r = await window.projects.exportProject(projectView.id, `${(projectView.longName ?? projectView.name ?? projectView.id).replace(/[^\w .,-]+/g, "_")}.bimproject`); setProjectOpNote(r ? `exported ${r.versions} versions → ${r.file}` : "export cancelled"); })()}
                    onImport={() => void (async () => { const r = await window.projects.importProject(); setProjectOpNote(r ? `imported from ${r.file.split(/[\\/]/).pop()}: ${r.versions} versions, ${r.ledgers} rulings added or newer, ${r.kept} kept, ${r.history} history entries${r.ledgers ? " — reopen the file to load them" : ""}` : "import cancelled"); await refreshProject(runRef.current?.project); })()} />
                )}
              </>
            )}
            {carry && (
              <>
                <button className={`qaBtn sec${open.has("changed") ? " on" : ""}`} onClick={() => toggleSection("changed")} title="the file's hash had no ledger; the previous ifc.db's rulings were carried across the diff">
                  {open.has("changed") ? "▾" : "▸"} file changed ({carry.diff.changes.length} changes · {carry.cases.filter((c) => c.verdict !== "carried").length} rulings to rule on)
                </button>
                {open.has("changed") && (
                  <FileChanges prevName={carry.prev.index.name} prevSha={carry.diff.prevSha} nextSha={carry.diff.nextSha} prevAt={carry.prevAt} diff={carry.diff} cases={carry.cases} record={carry.record}
                    take={carry.take} pending={[...carry.take].some((id) => !carry.applied.has(id)) || [...carry.applied].some((id) => !carry.take.has(id))} busy={busy}
                    onTake={(id, take) => setCarry((s) => { if (!s) return s; const t = new Set(s.take); if (take) t.add(id); else t.delete(id); const n = { ...s, take: t }; carryRef.current = n; return n; })}
                    onApply={() => void applyCarry()} onDismiss={() => { carryRef.current = null; setCarry(null); }} onSelect={(id) => { if (id !== null) selectElement(id); }} />
                )}
              </>
            )}
            <button className={`qaBtn sec${open.has("placement") ? " on" : ""}`} onClick={() => toggleSection("placement")}
              title={`Each wall, roof, floor and window is a layered assembly in the IFC; the energy model needs it as ONE plane. For each category, choose where that plane lies:\nI — the inside face\nM — the middle of the assembly\nE — the exterior face\nNow: ${(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => `${CATEGORY_LABEL[c]} ${choices[c]}`).join(" · ")}.\nmatch vertices${shellOn ? " (on)" : " (off)"} moves each boundary corner onto the line where its plane meets the adjoining wall, roof or floor, so the planes close without gaps.`}>
              {open.has("placement") ? "▾" : "▸"} single surface placement
            </button>
            {open.has("placement") && (
              <div className="secBody">
            {(Object.keys(CATEGORY_LABEL) as Category[]).map((cat) => (
              <label key={cat}>
                {CATEGORY_LABEL[cat]}
                <select
                  value={choices[cat]}
                  onChange={(e) => {
                    const next = { ...choices, [cat]: e.target.value as Mode };
                    setChoices(next);
                    void rebuildIdf(next, fillOpacity, shellOn);
                  }}
                >
                  <option value="I">I</option>
                  <option value="M">M</option>
                  <option value="E">E</option>
                </select>
              </label>
            ))}
            <label title="move each boundary vertex onto the line where its plane meets the adjoining wall, roof or floor — the plane's direction is preserved by construction">
              <input
                type="checkbox"
                checked={shellOn}
                onChange={(e) => { setShellOn(e.target.checked); void rebuildIdf(choices, fillOpacity, e.target.checked); }}
              />
              match vertices
            </label>
              </div>
            )}
            <button className={`qaBtn sec${open.has("steps") ? " on" : ""}`} onClick={() => toggleSection("steps")} disabled={steps.length === 0}>
              {open.has("steps") ? "▾" : "▸"} {steps.length ? `storey alignment QA (${steps.length})` : "storey alignment QA"}
            </button>
            {open.has("steps") && steps.length > 0 && (
              <div className="qaPanel steps">
                <div className="allRow">
                  <button className="apply" disabled={pending === 0} onClick={applyRulings}>
                    {pending === 0 ? "✓ applied" : `Apply ${pending} ruling${pending > 1 ? "s" : ""}`}
                  </button>
                  {pending > 0 && (
                    <button onClick={() => setStepChoices(new Map(choicesRef.current))}>revert</button>
                  )}
                  <span className="sep">set all:</span>
                  {(["keep", "alignUpper", "alignLower"] as StepChoice[]).map((c) => (
                    <button key={c} onClick={() =>
                      setStepChoices(new Map(steps.map((st) => [st.key, c])))
                    }>{c}</button>
                  ))}
                </div>
                <table>
                  <thead><tr><th>ruling</th><th className="wrap">step</th><th>offset</th></tr></thead>
                  <tbody>
                    {steps.map((st) => (
                      <tr
                        key={st.key}
                        className={selEl !== null && (st.lowerId === selEl || st.upperId === selEl) ? "sel" : ""}
                        onClick={() => selectElement(st.upperId)}
                      >
                        {/* the control comes FIRST: the space names run as long
                            as the file makes them, and behind them the ruling
                            column ran clean off the panel (2026-09-01) */}
                        <td>
                          <select
                            value={stepChoices.get(st.key) ?? "keep"}
                            onChange={(e) => {
                              const m = new Map(stepChoices);
                              m.set(st.key, e.target.value as StepChoice);
                              setStepChoices(m);
                              selectElement(st.upperId);
                            }}
                          >
                            <option value="keep">Keep (strip between)</option>
                            <option value="alignUpper">Align to upper</option>
                            <option value="alignLower">Align to lower</option>
                          </select>
                        </td>
                        <td className="wrap">
                          #{st.lowerId} <i>{spaceOf(st.lowerId)}</i>
                          <br />under #{st.upperId} <i>{spaceOf(st.upperId)}</i>
                        </td>
                        <td>{fmtL(st.offsetM)} {lu}<br />y {fmtL2(st.atHeightM)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <button className={`qaBtn sec${open.has("qa") ? " on" : ""}`} onClick={() => toggleSection("qa")} disabled={qaRows.length === 0}>
              {open.has("qa") ? "▾" : "▸"} {qaRows.length === 0 ? "wall QA" : ((n) => `wall QA (${n} gap${n === 1 ? "" : "s"})`)(qaRows.filter((r) => r.worstGapM > 1e-3).length)}
            </button>
            {open.has("qa") && qaRows.length > 0 && (
              <div className="qaPanel">
                <table>
                  <thead>
                    <tr><th>el #</th><th>space</th><th title="the way the wall faces, on the project grid">dir</th><th title="the wall's area above grade">above</th><th title="the wall's area below grade (and against fill)">below</th><th title="authored length lost from the wall's exterior face">lost</th><th title="the widest open boundary between this wall's plane and what it should meet">gap</th><th>open boundary → meets</th></tr>
                  </thead>
                  <tbody>
                    {qaRows.slice(0, 40).map((r, i) => (
                      <tr
                        key={`${r.elementId}-${i}`}
                        className={`${r.lostLengthM > 1e-3 ? "bad" : ""}${r.elementId === selEl ? " sel" : ""}`}
                        onClick={() => selectElement(r.elementId)}
                      >
                        <td>#{r.elementId}</td>
                        <td>{r.spaces}</td>
                        <td>{r.facing}</td>
                        <td>{wallGrade.get(r.elementId) ? fmtA(wallGrade.get(r.elementId)!.aboveM2) : ""}</td>
                        <td>{wallGrade.get(r.elementId) && wallGrade.get(r.elementId)!.belowM2 > 1e-3
                          ? `${fmtA(wallGrade.get(r.elementId)!.belowM2)}${wallGrade.get(r.elementId)!.fillM2 > 1e-3 ? ` (fill ${fmtA(wallGrade.get(r.elementId)!.fillM2)})` : ""}` : ""}</td>
                        <td>{r.lostLengthM > 1e-3 ? `${fmtL2(r.lostLengthM)} ${lu}` : ""}</td>
                        <td>{r.worstGapM > 1e-3 ? `${fmtL2(r.worstGapM)} ${lu}` : ""}</td>
                        <td>{r.boundaries.filter((b) => b.state === "open")
                          .map((b) => `${b.name} → ${b.meets || "nothing"}`).join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <button className={`qaBtn sec${open.has("spaces") ? " on" : ""}`} onClick={() => toggleSection("spaces")} disabled={zoneRows.length === 0}>
              {open.has("spaces") ? "▾" : "▸"} {zoneRows.length === 0 ? "spaces" : `spaces (${zoneRows.filter((z) => z.closed).length}/${zoneRows.length} closed)`}
            </button>
          {open.has("spaces") && (
            <div className="qaPanel steps corr">
              <div className="allRow">
                <button className="apply" disabled={zonePending === 0} onClick={applyZones}>
                  {zonePending === 0 ? "✓ applied" : `Apply ${zonePending} assignment${zonePending > 1 ? "s" : ""}`}
                </button>
                {zonePending > 0 && <button onClick={() => setZoneStage({})}>revert</button>}
              </div>
              <table>
                <thead><tr><th>assign to</th><th className="wrap">zone</th><th title="the number of surfaces that bound the zone">surfaces</th><th title="the share of the zone's boundary edges shared by exactly two of its own surfaces — EnergyPlus's enclosure test">closed %</th><th title="open boundary length with a parallel edge of the same zone close by — the two sides of one gap">gap {lu}</th><th title="open boundary length with no counterpart edge — a surface the zone does not have">missing {lu}</th></tr></thead>
                <tbody>
                  {allZoneNames.map((name) => {
                    const applied = currentZoneTarget(name);
                    const target = zoneStage[name] ?? applied;
                    const z = zoneRows.find((r) => r.name === name);
                    const merged = target !== name;
                    // APPLIED vs STAGED (user, 2026-09-19: "why doesn't Attic spaces assigned together show as
                    // merged?"). An applied merge is gone from the built model, so the row has no zone to count
                    // and reads "merged"; a STAGED one is still its own zone until Apply rebuilds, so it kept
                    // showing its own surface count with nothing to say why — and `tr.merged` had no style at
                    // all. Staged reads in the user's amber and says what Apply will do.
                    const stagedMerge = target !== applied;
                    // SELECTING A ROW LIGHTS THE SPACE (user, 2026-09-19: "when space is selected in Spaces in
                    // right column the spaces should highlight in the idf model"). The same selection the
                    // tree's name makes — every cell that bounds it, and the table below reads it. A zone
                    // merged into another no longer owns any cell, so the row lights the zone it is part of.
                    const lights = merged ? target : name;
                    return (
                      <tr key={name} className={`${merged ? "merged" : ""}${stagedMerge ? " stagedMerge" : ""}${related.spaces.has(lights) ? " sel" : ""}`.trim() || undefined}
                        onClick={() => selectSpaceName(lights)}
                        title={merged
                          ? `part of ${target} — selecting this lights that zone's cells in the IDF-DB view`
                          : "select this space: every cell that bounds it lights up in the IDF-DB view and the table below reads it"}>
                        <td onClick={(e) => e.stopPropagation()}>
                          <select value={target} onChange={(e) => setZoneStage({ ...zoneStage, [name]: e.target.value })}>
                            <option value={name}>— itself —</option>
                            {allZoneNames.filter((o) => o !== name).map((o) => <option key={o} value={o}>{o}</option>)}
                          </select>
                        </td>
                        <td className="wrap">{name}{z?.closed ? " ✓" : ""}{merged ? <i> → {target}</i> : ""}</td>
                        <td title={!z && merged ? "applied: this zone is folded into its target and is no longer written"
                          : stagedMerge ? "staged: it is still its own zone until Apply rebuilds the model"
                          : undefined}>{z ? (stagedMerge ? `${z.surfaces} →` : z.surfaces) : merged ? "merged" : "—"}</td>
                        <td>{z && z.edgeLenM > 0 ? `${((100 * z.closedLenM) / z.edgeLenM).toFixed(0)}%` : ""}</td>
                        <td>{z ? (z.openByKind.gap * (imperial ? FT : 1)).toFixed(1) : ""}</td>
                        <td>{z ? (z.openByKind.missing * (imperial ? FT : 1)).toFixed(1) : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
            <button className={`qaBtn sec${open.has("edits") ? " on" : ""}`} onClick={() => toggleSection("edits")} title={[...editLog, ...spaceEditLog].join("\n")}>
              {open.has("edits") ? "▾" : "▸"} corrections ({[...choicesRef.current.values()].filter((c) => c !== "keep").length + edits.length + spaceEdits.length + glazing.size + Object.keys(voidRulings).length}){[...editLog, ...spaceEditLog].some((l) => l.startsWith("✗")) ? " ⚠" : ""}
            </button>
          {open.has("edits") && (
            <div className="qaPanel steps corr">
              {ledgerNote && <div className="idfInfo">{ledgerNote}</div>}
              <div className="allRow">
                <button
                  className="apply"
                  disabled={edits.length === 0 && spaceEdits.length === 0 && glazing.size === 0 && [...choicesRef.current.values()].every((c) => c === "keep")}
                  onClick={restoreAll}
                >Restore all to the file as authored</button>
              </div>
              <table>
                <thead><tr><th>#</th><th className="wrap">correction</th><th>status</th><th></th></tr></thead>
                <tbody>
                  {[...choicesRef.current].filter(([, c]) => c !== "keep").map(([key, c]) => {
                    const st = steps.find((x) => x.key === key);
                    return (
                      <tr key={`s-${key}`} onClick={() => st && selectElement(st.upperId)}>
                        <td>step</td>
                        <td className="wrap">
                          {st
                            ? <>#{st.lowerId} <i>{spaceOf(st.lowerId)}</i> under #{st.upperId} <i>{spaceOf(st.upperId)}</i></>
                            : <>step {key} <i>(not in this build)</i></>}
                          {" → "}<b>{c === "alignUpper" ? "Align to upper" : "Align to lower"}</b>
                        </td>
                        <td>{st ? "applied" : "no such step now"}</td>
                        <td><button onClick={(e) => { e.stopPropagation(); restoreStep(key); }}>restore</button></td>
                      </tr>
                    );
                  })}
                  {edits.map((op, i) => (
                    <tr key={`e-${i}`} onClick={() => selectElement(Number(op.from.split("|")[0]))}>
                      <td>{i + 1}</td>
                      <td className="wrap">extend <i>{labelOfRef.current(op.from)}</i> → <i>{labelOfRef.current(op.to)}</i></td>
                      <td>{editLog[i] ?? ""}</td>
                      <td><button onClick={(e) => { e.stopPropagation(); restoreExtend(i); }}>restore</button></td>
                    </tr>
                  ))}
                  {spaceEdits.map((op, i) => (
                    <tr key={`sp-${i}`} onClick={() => { setSel(null); setSelSpace({ key: op.from, label: spaceLabelOfRef.current(op.from) }); }}>
                      <td>space</td>
                      <td className="wrap">extend <i>{spaceLabelOfRef.current(op.from)}</i> → <i>{spaceLabelOfRef.current(op.to)}</i></td>
                      <td>{spaceEditLog[i] ?? ""}</td>
                      <td><button onClick={(e) => { e.stopPropagation(); restoreSpaceExtend(i); }}>restore</button></td>
                    </tr>
                  ))}
                  {[...glazing].map(([gid, on]) => {
                    const o = openingIndexRef.current.find((x) => x.globalId === gid);
                    return (
                      <tr key={`g-${gid}`} onClick={() => o && selectElement(o.elementId)}>
                        <td>glazing</td>
                        <td className="wrap">{o ? <>{o.kind} <i>{o.label}</i> #{o.elementId}</> : gid} → <b>{on ? "glass" : "opaque"}</b></td>
                        <td>{o ? "applied" : "no such element now"}</td>
                        <td><button onClick={(e) => { e.stopPropagation(); restoreGlazing(gid); }}>restore</button></td>
                      </tr>
                    );
                  })}
                  {Object.entries(voidRulings).map(([name, r]) => {
                    const row = voidRows.find((x) => x.name === name);
                    return (
                      <tr key={`v-${name}`} onClick={() => selectSpaceName(name)}>
                        <td>void</td>
                        <td className="wrap"><i>{name}</i> → <b>{VOID_ANSWERS[r.answer as VoidAnswer]?.label ?? r.answer}</b>{r.grille ? " · a transfer grille" : ""}</td>
                        <td>{row ? "applied" : "no such space now"}</td>
                        <td><button onClick={(e) => { e.stopPropagation(); restoreVoid(name); }}>restore</button></td>
                      </tr>
                    );
                  })}
                  {edits.length === 0 && spaceEdits.length === 0 && glazing.size === 0 && Object.keys(voidRulings).length === 0 && [...choicesRef.current.values()].every((c) => c === "keep") && (
                    <tr><td colSpan={4}><i>no corrections on this file</i></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
            {open.has("edits") && idfInfo && (() => {
              // THE REBUILD CENSUS, pinned under the corrections and read in the
              // user's units (user, 2026-09-04): what the collapse, the carve and
              // the vertex match did on the last rebuild, and what still waits
              const i = idfInfo, m = i.match;
              const L0 = (v: number): string => `${(imperial ? v * FT : v).toFixed(0)} ${lu}`;
              return (
                <div className="idfInfo census" title="the last rebuild's census: the collapse, the carve, the vertex match, and what still waits">
                  {i.surfacesIn} surfaces → {i.surfacesOut} zone surfaces ({i.interZone} inter-zone · {fmtA(i.unassignedAreaM2)} no room · Δarea {fmtA(i.areaDeltaM2)})
                  {" · "}{i.byCategory.map(([k, n]) => `${k} ${n}`).join(" · ")} · edge dropped {fmtA(i.droppedEdgeAreaM2)}
                  {m
                    ? <> · matched to neighbours: {m.wall} wall + {m.roof} roof + {m.floor} floor vertices, {m.inserted} inserted (max {fmtL2(m.maxMoveM)} {lu}){m.steps ? ` · ${m.steps} storey steps need a ruling` : ""} · leak {L0(i.leakBeforeM)} → {L0(i.leakAfterM)}</>
                    : <> · ⚠ VERTEX MATCHING OFF — raw collapse · leak {L0(i.leakBeforeM)}</>}
                </div>
              );
            })()}
          </div>
          )}
          </div>
      </aside>
      </div>
    </div>
  );
}
