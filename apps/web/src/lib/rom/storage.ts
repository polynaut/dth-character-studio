/**
 * Storage, backed by the Tauri fs plugin, split across two roots:
 *
 *  - **App folder** = the per-user app-local data dir (e.g.
 *    %LOCALAPPDATA%/com.polynaut.dthcharacterstudio). Holds only *volatile /
 *    machine-specific* data: `settings.json` (machine/tool paths), `recents.json`
 *    (the recently-opened-projects list) and `network-drives.json`. Created on
 *    first run.
 *  - **Project** = a user-chosen folder marked by a single `.dcsp` manifest file,
 *    scattered anywhere on disk and backed up by the user. Beside the manifest live
 *    the character folders (`<dir>/<Name>/` holding `<Name>.json` + generated
 *    artifacts) and a hidden `.dcsmeta/` of app-managed meta (avatars). Discovery
 *    is a recursive scan — no registry — so a folder's location simply *is* the
 *    project's location. The character functions below take the project's folder.
 *
 * This file is a barrel: the implementation lives in the focused modules under
 * `./storage/` (fs, app-data, settings, characters, projects, assets, releases,
 * pose-assets, runtime-install, network-drives). Everything importable from here
 * before the split is still importable from here — import paths elsewhere never
 * change.
 */

// --- App-data paths + studio version ---------------------------------------
export { dataPath, productScanDir, scanFramesDir, studioVersion } from './storage/app-data'

// --- Generic folder file ops (Generate writes through these) ----------------
export { removeFilesFromFolder, writeFilesToFolder, writeTextFileAtomic } from './storage/fs'

// --- App-global settings (settings.json) ------------------------------------
export {
  consumeSettingsFileCorrupt,
  getSettings,
  saveSettings,
  studioSettingsSchema,
} from './storage/settings'
export type { StudioSettings } from './storage/settings'

// --- Character library (scan + CRUD) -----------------------------------------
export {
  createCharacterAt,
  deleteCharacter,
  existingCharacterSubfolders,
  findCharacterAcrossProjects,
  getCharacter,
  getCharacterFolder,
  getCharacterPath,
  listCharacters,
  listNotesFiles,
  moveCharacter,
  moveCharactersRoot,
  moveFolder,
  readCharacterAt,
  repointCharacterPaths,
  saveCharacter,
  scanCharacterLibrary,
  setGeneratedDthVersion,
} from './storage/characters'
export type {
  CharacterLocation,
  CharacterScanProblem,
  MoveCharactersRootResult,
} from './storage/characters'

// --- Project manifest (.dcsp) + meta dirs + recents --------------------------
export {
  DCSP_EXT,
  DCSP_SCHEMA_VERSION,
  createProjectManifest,
  dcsmetaDir,
  findManifestPath,
  forgetRecent,
  listRecents,
  metaImagesDir,
  metaMediaDir,
  PROJECT_BEHAVIOR_DEFAULTS,
  ProjectUnreachableError,
  readManifest,
  rememberRecent,
  renameManifestFile,
  writeManifest,
} from './storage/projects'
export type { DcspManifest, Project, RecentProject } from './storage/projects'

// --- Daz-scene assets (.assets registry) --------------------------------------
export { addAsset, assetsDir, listAssets, removeAsset, updateAsset } from './storage/assets'
export type { DazAsset } from './storage/assets'

// --- DTH release / Exporter Plugin scanning + install plans -------------------
export {
  ZIP_RELEASE_WARNING,
  installedExporterVersion,
  listDthExporterReleases,
  listDthReleases,
  resolveActiveReleaseRoot,
  resolvePluginInstall,
  resolveReleaseInstall,
} from './storage/releases'
export type {
  ActiveReleaseEntry,
  DthExporterReleaseInfo,
  DthReleaseInfo,
  PluginInstall,
  ReleaseInstall,
} from './storage/releases'

// --- Pose-asset catalog (live scan of the active release) ---------------------
export { scanPoseAssets } from './storage/pose-assets'

// --- DTH runtime install (bundled .dsa → the Daz library Scripts root) --------
export {
  copyRuntimeFiles,
  readScriptRuntimeVersion,
  studioCharScriptsDir,
  studioScriptsDir,
} from './storage/runtime-install'

// --- Known network drives (drive → UNC metadata) ------------------------------
export { forgetDrive, listKnownDrives, rememberDrive } from './storage/network-drives'
export type { KnownDrive } from './storage/network-drives'
