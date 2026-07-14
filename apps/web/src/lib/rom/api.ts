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
  DthExporterReleaseInfo,
  DthReleaseInfo,
  KnownDrive,
  Project,
} from './storage'

// --- core: active-project state + the session pose-asset catalog -----------
export { fetchPoseAssets, rescanPoseAssets, setActiveProjectDir } from './api/core'
export type { ProjectInfo } from './api/core'

// --- projects: .dcsp lifecycle + per-project settings -----------------------
export {
  createProject,
  fetchActiveProject,
  fetchProject,
  fetchRecents,
  forgetRecent,
  isDirectory,
  openProject,
  renameProject,
  saveProjectSettings,
  setUnrealProjects,
} from './api/projects'

// --- characters: CRUD, imports, run log, paths ------------------------------
export {
  characterKeepFolders,
  createCharacter,
  deleteCharacter,
  dismissRomRunLog,
  fetchAllCharacters,
  fetchCharacter,
  fetchMorphIndex,
  fetchCharacters,
  fetchRomRunLog,
  getCharacterPath,
  importCharacterFromJson,
  importPosesFromCsv,
  moveCharacter,
  moveCharacterScenesFolder,
  saveCharacter,
} from './api/characters'
export type { CharacterWithProject, MorphIndexEntry, RomRunFailedMorph, RomRunLog } from './api/characters'

// --- avatars: avatar images + scene thumbnails ------------------------------
export {
  resolveImageSrc,
  resolveScenePreview,
  setAvatarFromScene,
  uploadCharacterImage,
  uploadCharacterImageFromPath,
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
export { clearProductScan, detectDimManifestsFolder, fetchProductScan } from './api/products'
export type { ProductScanFile } from './api/products'

// --- generate: artifact generation + refresh sweep + version detection ------
export {
  characterStaleTargets,
  detectAssetVersions,
  generateCharacterFiles,
  isCharacterStale,
  isRefreshNeeded,
  refreshAllAssets,
  resolvePresetFrames,
} from './api/generate'
export type {
  AssetVersionReport,
  CharacterAssetStatus,
  RefreshResult,
  RefreshSummary,
  StaleTargets,
} from './api/generate'

// --- install: app settings + the Tools-page install features ----------------
export {
  DAZTOHUE_SCRIPTS_REPO,
  dazToHueScriptsStatus,
  dedupDazAssets,
  defaultDazUninstallFolders,
  fetchAppDataFolder,
  fetchAppVersion,
  fetchSettings,
  installDazAssets,
  installDazMorphs,
  installDazPresets,
  installDazToHueScripts,
  installDthPlugin,
  installDthRelease,
  installUnrealDthContent,
  unrealDthContentPresent,
  installHoudiniPresets,
  installedExporterVersion,
  latestDazToHueCommit,
  listDazAssets,
  listDthExporterReleases,
  listDthReleases,
  saveSettings,
  setAcceptedConflicts,
  uninstallDaz,
} from './api/install'
export type {
  AssetDup,
  ConflictCopy,
  DazToHueScriptsState,
  DazToHueScriptsStatus,
  DedupReport,
  DupMember,
  FileConflict,
  InstallReport,
  InstallStep,
} from './api/install'

// --- maintenance: housekeeping + network drives ------------------------------
export {
  emptyQuarantine,
  ensureNetworkDrives,
  fetchKnownDrives,
  forgetNetworkDrive,
  housekeepingSweep,
  NOTE_MEDIA_RETENTION_DAYS,
  PRODUCT_SCAN_RETENTION_DAYS,
  quarantineStats,
  rememberNetworkPath,
  uncForPath,
} from './api/maintenance'
export type { HousekeepingResult, RemapResult } from './api/maintenance'
