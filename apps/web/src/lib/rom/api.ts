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
  DthExporterReleaseInfo,
  DthReleaseInfo,
  KnownDrive,
  Project,
} from './storage'
export { ProjectUnreachableError } from './storage'

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
  dismissRomRunLog,
  fetchAllCharacters,
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
export type { CharacterWithProject, MorphIndexEntry, RomRunFailedMorph, RomRunLog, ScanFrameCsv } from './api/characters'

// --- avatars: avatar images + scene thumbnails ------------------------------
export {
  deleteCharacterUpload,
  listCharacterUploads,
  readAvatarSourceFile,
  resolveImageSrc,
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

// --- install: app settings + the Tools-page install features ----------------
export {
  dedupDazAssets,
  defaultDazUninstallFolders,
  consumeSettingsFileCorrupt,
  fetchAppDataFolder,
  fetchAppVersion,
  fetchSettings,
  installDazAssets,
  installDazMorphs,
  installDazPresets,
  installDthPlugin,
  installDthRelease,
  installUnrealDthContent,
  unrealDthContentPresent,
  installHoudiniPresets,
  installedExporterVersion,
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
  NOTE_MEDIA_RETENTION_DAYS,
  PRODUCT_SCAN_RETENTION_DAYS,
  SCAN_FRAMES_RETENTION_DAYS,
  rememberNetworkPath,
  uncForPath,
} from './api/maintenance'
export type { HousekeepingResult, RemapResult } from './api/maintenance'
