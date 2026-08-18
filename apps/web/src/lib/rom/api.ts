/**
 * Client data layer — the only bridge between the React UI and the filesystem.
 * Backed by the Tauri fs/dialog plugins (no Node/server). Functions keep the
 * `{ data }` call convention the route components use. Character operations are
 * scoped to a **project**: callers pass `projectId`, which resolves to that
 * project's library path (avatars stay global in the app folder).
 *
 * This file is a barrel: the implementation lives in the focused modules under
 * `./api/` (core, projects, characters, avatars, attachments, products,
 * generate, install, maintenance). Everything importable from here before the
 * split is still importable from here — import paths elsewhere never change.
 */

export type {
  CharacterLocation,
  CharacterScanProblem,
  DthReleaseInfo,
  KnownDrive,
  Project,
  RunnerGate,
  RunnerStatus,
} from './storage'
export { ProjectUnreachableError } from './storage'

// --- core: active-project state + the session pose-asset catalog -----------
export {
  fetchPoseAssets,
  getActiveProjectDir,
  rescanPoseAssets,
  setActiveProjectDir,
} from './api/core'
export type { ProjectInfo } from './api/core'

// --- projects: .dcsp lifecycle + per-project settings -----------------------
export {
  createProject,
  deleteProject,
  fetchActiveProject,
  fetchProject,
  fetchRecents,
  forgetRecent,
  isDirectory,
  openProject,
  rememberActiveProject,
  renameProject,
  saveProjectSettings,
  setUnrealProjects,
} from './api/projects'

// --- folder moves: the shared lock gate (Daz/Houdini file locks) -------------
export { LockedFilesError, assertMovable, probeLockedFiles } from './api/move'

// --- characters: CRUD, imports, run log, paths ------------------------------
export {
  characterKeepFolders,
  createCharacter,
  deleteCharacter,
  deleteCharacterFolder,
  dismissRomRunLog,
  fetchAllCharacters,
  fetchBoneIndex,
  fetchCharacter,
  fetchCharactersWithProblems,
  fetchMorphIndex,
  fetchRomRunLog,
  getCharacterPath,
  importPosesFromCsv,
  listScanFrameCsvs,
  moveCharacter,
  moveCharacterScenesFolder,
  syncAvatarWithScene,
  saveCharacter,
} from './api/characters'
export type {
  BoneIndexEntry,
  CharacterWithProject,
  MorphIndexEntry,
  RomRunFailedMorph,
  RomRunKeyProblem,
  RomRunLog,
  RomRunSceneRun,
  ScanFrameCsv,
} from './api/characters'

// --- character export/import zips (.dcsc.zip) --------------------------------
export {
  exportCharacterZip,
  importCharacterZip,
  readCharacterZipManifest,
  readCharacterZipSummary,
} from './api/character-zip'
export type {
  CharacterZipImportChoices,
  CharacterZipImportResult,
  CharacterZipManifest,
  CharacterZipSummary,
  ExportZipReport,
} from './api/character-zip'

// --- avatars: avatar images + scene thumbnails ------------------------------
export {
  deleteCharacterUpload,
  listCharacterUploads,
  readAvatarSourceFile,
  resolveImageSrc,
  resolveImageSrcAtSize,
  resolveScenePreview,
  setAvatarFromScene,
  uploadCroppedAvatar,
} from './api/avatars'

// --- attachments: scenes attached to characters + project assets ------------
export {
  copyDazScene,
  createAsset,
  dazStudioRunning,
  deleteAsset,
  deleteFiles,
  fileExists,
  listAssets,
  openScene,
  renameDazScene,
  revealPath,
  relinkScene,
} from './api/attachments'

// --- products: the Daz Products scan ----------------------------------------
export {
  addNoteMedia,
  fetchNotes,
  NotesConflictError,
  openNoteMedia,
  resolveNoteMedia,
  saveNotes,
} from './api/notes'
export {
  clearProductScan,
  detectDimManifestsFolder,
  fetchProductScan,
  ingestProjectProductScans,
} from './api/products'
// --- detected files: new scenes/.hips found in the character folder ---------
export {
  fetchDetectedFiles,
  fetchProjectDetectedFiles,
  ignoreDetectedFiles,
} from './api/detected-files'
export type { DetectedFilesResult, ProjectDetectedCharacter } from './api/detected-files'
// --- the Daz installation DIM already knows about ---------------------------
export { detectDazInstalls } from './api/daz-install'
// --- the Houdini versions SideFX registered ---------------------------------
export { detectHoudiniInstalls } from './api/houdini-install'
// --- Unreal Engine: detected engines, plugin sources, project install -------
export {
  detectUnrealEngines,
  installUnrealPlugin,
  scanUnrealPlugins,
  unrealProjectState,
} from './api/unreal'
export type { ProductScanResult } from './api/products'

// --- unreal import: hand a Houdini export to a watching editor (bridge plugin)
export {
  dismissUnrealImport,
  fetchUnrealSendPlan,
  fetchUnrealImportProgress,
  installUnrealBridge,
  openUnrealForPendingJob,
  startUnrealImport,
  unrealExportSets,
} from './api/unreal-import'
export type { UnrealExportSet, UnrealImportStarted, UnrealSendPlan } from './api/unreal-import'

// --- execute: DTH Exporter job-file handoff + Daz launch ---------------------
export {
  PROJECT_SCAN_RUN,
  abortExporterJobs,
  awaitBatchPickup,
  abortProjectScanRun,
  clearExporterJobFiles,
  dismissExportRun,
  interruptExportRun,
  executeCharacterJobs,
  ExporterJobFilesChangedError,
  exporterJobFilesSignature,
  exportDazStudioRunning,
  exporterJobsPending,
  fetchExecuteScenes,
  fetchExporterJobFiles,
  fetchExportRunProgress,
  fetchProjectScanPlan,
  fetchRomAnimations,
  generateRomAnimation,
  launchDazForPendingJobs,
  openSceneInRunningDaz,
  pendingExportHandoffState,
  romAnimationFresh,
  startProjectScan,
  startSceneScan,
  fetchSceneScanProgress,
  abortSceneScan,
  watchExportRunFiles,
} from './api/execute'
export type {
  ExecuteJobsSummary,
  ExecuteSceneStatus,
  ExporterJobFileState,
  ExportRunProgress,
  StopWatching,
  ProjectScanCharacter,
  ProjectScanPlan,
  ProjectScanSummary,
  RomAnimationStatus,
  SceneScanStarted,
  SceneScanProgress,
} from './api/execute'

// --- houdini: Generate project (hython, DazToHue network from the HDA), and
// --- "Export too" (job file → Houdini GUI → polled result) ------------------
export {
  adoptHoudiniRun,
  dismissHoudiniRun,
  fetchHoudiniRunProgress,
  fetchSceneDthPaths,
  copyHoudiniProject,
  generatedHoudiniScenePath,
  generateHoudiniProject,
  removeGeneratedHoudiniProject,
  renameHoudiniProject,
  startHoudiniExport,
} from './api/houdini'
export type { GeneratedHoudiniProject, HoudiniExportStarted, HoudiniRunPlan } from './api/houdini'

// --- houdini material utilities: scan DazToHueMaterial nodes, transfer a
// --- node's texture-baker setup onto others, repair per-project $JOB (hython)
export {
  GROOM_OCCLUSION_SECTIONS,
  MATERIAL_SECTIONS,
  NODE_KINDS,
  OCCLUSION_SECTIONS,
  SECTIONS_BY_KIND,
  SKELETON_SECTIONS,
  discardHoudiniBackups,
  prefillHoudiniNetwork,
  refreshHoudiniAssets,
  repairHoudiniDefaults,
  repathHoudiniReferences,
  restoreHoudiniBackup,
  fetchCachedHoudiniScans,
  fetchHoudiniProjectStatus,
  fetchHoudiniSourceRecents,
  forgetHoudiniSource,
  rememberHoudiniSource,
  scanCharacterHoudiniProjects,
  scanHoudiniMaterials,
  transferHoudiniMaterials,
} from './api/houdini-material'
export type {
  GroomOcclusionSection,
  HoudiniProjectStatus,
  MaterialSection,
  NodeKind,
  OcclusionSection,
  SkeletonSection,
} from './api/houdini-material'
export type {
  HoudiniDefaultsResult,
  HoudiniRefreshResult,
  MaterialNodeInfo,
  MaterialSectionResult,
  MaterialSlotInfo,
  MaterialScanProject,
  MaterialTransferTarget,
  MaterialUtilReport,
  PrefillResult,
  ProjectPrefillInfo,
  ProjectRefInfo,
  RepathResult,
} from './api/native-types.ts'

// --- generate: artifact generation + refresh sweep + version detection ------
export {
  characterStaleTargets,
  detectAssetVersions,
  generateCharacterFiles,
  isCharacterStale,
  isRefreshNeeded,
  refreshAllAssets,
  resolvePresetFrames,
  sceneWearables,
} from './api/generate'
export type {
  AssetVersionReport,
  CharacterAssetStatus,
  RefreshResult,
  RefreshSummary,
  StaleTargets,
  TooNewDefinition,
} from './api/generate'
export type { SceneWearables } from './api/native-types'

// --- install: app settings + the Tools-page install features ----------------
export {
  dedupDazAssets,
  defaultDazUninstallFolders,
  consumeSettingsFileCorrupt,
  fetchAppDataFolder,
  fetchAppVersion,
  fetchDazPluginState,
  fetchExportRunnerGate,
  fetchSettings,
  fetchRunnerStatus,
  INSTALL_PHRASES,
  installDazAssets,
  installDazPlugins,
  installDazMorphs,
  installDazPresets,
  installDthPlugin,
  installDthRelease,
  installDthRunner,
  installUnrealDthContent,
  unrealDthContentPresent,
  installHoudiniPresets,
  installedExporterVersion,
  listDazAssets,
  listDthReleases,
  pendingPluginInstalls,
  saveSettings,
  setAcceptedConflicts,
  uninstallDaz,
} from './api/install'
export type {
  AssetDup,
  ConflictCopy,
  DazPluginState,
  DazPluginTarget,
  DedupReport,
  DupMember,
  FileConflict,
  InstallReport,
  InstallStep,
} from './api/install'

// --- maintenance: housekeeping + network drives ------------------------------
export {
  ensureNetworkDrives,
  fetchKnownDrives,
  forgetNetworkDrive,
  housekeepingSweep,
  isElevatedSession,
  relaunchDeelevated,
  NOTE_MEDIA_RETENTION_DAYS,
  PRODUCT_SCAN_RETENTION_DAYS,
  SCAN_FRAMES_RETENTION_DAYS,
  rememberNetworkPath,
  uncForPath,
} from './api/maintenance'
export type { HousekeepingResult, RemapResult } from './api/maintenance'
