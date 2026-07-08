import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'

import { dataPath, ensureAppDir } from './app-data'

// App-global settings (`settings.json` in app-data): machine/tool paths only —
// per-project behaviour lives in each project's .dcsp manifest (see projects.ts).

export interface StudioSettings {
  /**
   * "My DAZ 3D Library" — the user's Daz content library path. Asked on first
   * run; stored for a later feature (generating Daz scripts straight into it for
   * faster testing). Not yet otherwise wired.
   */
  dazLibraryFolder: string
  /**
   * A DTH release folder (contains `copyright.txt`), or a folder of versioned
   * releases (release folders and/or `.zip`s). Scanned for the pose catalog.
   */
  dthPosesFolder: string
  /**
   * Selected DTH release version (e.g. "2.4.3") when `dthPosesFolder` holds
   * several releases. Empty = not chosen yet. Persisting the pick stops a newly
   * dropped-in release from silently becoming the active one.
   */
  currentDthVersion: string
  /**
   * The DTH Exporter Plugin folder (contains `dth_exporter.dll`), or a folder of
   * versioned plugin folders. Stored for reference; the version is read from the
   * DLL rather than the folder name.
   */
  dthExporterFolder: string
  /**
   * Selected Exporter Plugin version (the DLL's FileVersion, e.g. "1.0.0.1"), or
   * a folder name fallback when a plugin folder carries no version resource.
   * Empty = not chosen / none detected.
   */
  currentDthExporterVersion: string
  /**
   * Where Daz Studio is installed (e.g. `C:/Program Files/DAZ 3D/DAZStudio4`).
   * Optional — the DTH install drops the exporter plugin DLLs into its `plugins`
   * subfolder.
   */
  dazInstallFolder: string
  /**
   * The Houdini documents folder (e.g. `D:/User Data/Documents/houdini20.5`).
   * Optional — the DTH install merges the release's Houdini assets
   * (otls/presets/toolbar) into it.
   */
  houdiniDocsFolder: string
  /**
   * ADDITIONAL Houdini documents folders (older/parallel Houdini versions) -
   * each is an alternative install target for a DTH release's Houdini assets,
   * so an old Houdini can keep an old DTH while the primary stays current.
   */
  extraHoudiniDocsFolders: Array<string>
  /**
   * The DAZ Install Manager `ManifestFiles` folder (a folder of `.dsx` XML), read
   * by the Daz Products scan to resolve scene assets to installed products
   * (name/SKU/artist/version). Machine-specific; empty = unset (the scan then runs
   * but reports every asset as unmatched).
   */
  dimManifestsFolder: string
  // Per-project behaviour defaults (dazSubdir / houdiniSubdir / createHoudiniSubdir)
  // now live in each project's .dcsp manifest (see DcspManifest), not in app-global
  // settings — they describe a project, not the machine.
  // --- "Optional" tab: install your own Daz/Houdini content (not DTH release) ---
  /**
   * Your Daz asset source folders. Each is scanned for content folders
   * (`data`/`People`/`Runtime`/`Documentation`, `.zip` assets extracted) and
   * installed into `dazLibraryFolder`. A flat list — generation is auto-detected.
   */
  dazAssetsFolders: Array<string>
  /** Custom morphs (Daz Transfer Shape Utility output): source folder + its
   *  destination (your personal "…/Studio/My Library/data/Daz 3D"). */
  dazMorphsSource: string
  dazMorphsDest: string
  /** Daz presets: source folder + destination ("…/Studio/My Library/Presets"). */
  dazPresetsSource: string
  dazPresetsDest: string
  /** Houdini `my_presets` source — copied into the Houdini docs folder and wired
   *  into its `houdini.env` (`SHARED_PRESETS` + `HOUDINI_PATH`). */
  houdiniPresetsSource: string
  /** Destination-relative file paths the user has "accepted" as legitimately
   *  shared between products (e.g. a vendor icon, cross-product textures). Both
   *  the asset scan/install and the dedup skip these, so they stop showing as
   *  "to copy" / as a conflict — the file stays whatever is installed. */
  acceptedConflicts: Array<string>
  /** Where the dedup moves redundant duplicate copies. Required to run Apply —
   *  nothing is quarantined until this is set. */
  dedupQuarantineFolder: string
  /** "Danger zone" — folders the Daz uninstall cleanup deletes (pre-filled from
   *  the dth-cli defaults, then user-editable). */
  dazUninstallFolders: Array<string>
}

/** Defaults for a fresh install: all folders empty, no release version chosen. */
function defaultSettings(): StudioSettings {
  return {
    dazLibraryFolder: '',
    dthPosesFolder: '',
    currentDthVersion: '',
    dthExporterFolder: '',
    currentDthExporterVersion: '',
    dazInstallFolder: '',
    houdiniDocsFolder: '',
    extraHoudiniDocsFolders: [],
    dimManifestsFolder: '',
    dazAssetsFolders: [],
    dazMorphsSource: '',
    dazMorphsDest: '',
    dazPresetsSource: '',
    dazPresetsDest: '',
    houdiniPresetsSource: '',
    acceptedConflicts: [],
    dedupQuarantineFolder: '',
    dazUninstallFolders: [],
  }
}

export async function getSettings(): Promise<StudioSettings> {
  const defaults = defaultSettings()
  try {
    const raw = JSON.parse(await readTextFile(await dataPath('settings.json')))
    return {
      dazLibraryFolder:
        typeof raw.dazLibraryFolder === 'string' ? raw.dazLibraryFolder : defaults.dazLibraryFolder,
      dthPosesFolder:
        typeof raw.dthPosesFolder === 'string' && raw.dthPosesFolder
          ? raw.dthPosesFolder
          : defaults.dthPosesFolder,
      currentDthVersion:
        typeof raw.currentDthVersion === 'string'
          ? raw.currentDthVersion
          : defaults.currentDthVersion,
      dthExporterFolder:
        typeof raw.dthExporterFolder === 'string'
          ? raw.dthExporterFolder
          : defaults.dthExporterFolder,
      currentDthExporterVersion:
        typeof raw.currentDthExporterVersion === 'string'
          ? raw.currentDthExporterVersion
          : defaults.currentDthExporterVersion,
      dazInstallFolder:
        typeof raw.dazInstallFolder === 'string'
          ? raw.dazInstallFolder
          : defaults.dazInstallFolder,
      houdiniDocsFolder:
        typeof raw.houdiniDocsFolder === 'string'
          ? raw.houdiniDocsFolder
          : defaults.houdiniDocsFolder,
      extraHoudiniDocsFolders: Array.isArray(raw.extraHoudiniDocsFolders)
        ? raw.extraHoudiniDocsFolders.filter((p: unknown): p is string => typeof p === 'string')
        : [],
      dimManifestsFolder:
        typeof raw.dimManifestsFolder === 'string'
          ? raw.dimManifestsFolder
          : defaults.dimManifestsFolder,
      dazAssetsFolders: Array.isArray(raw.dazAssetsFolders)
        ? raw.dazAssetsFolders.filter((f: unknown): f is string => typeof f === 'string')
        : defaults.dazAssetsFolders,
      dazMorphsSource:
        typeof raw.dazMorphsSource === 'string' ? raw.dazMorphsSource : defaults.dazMorphsSource,
      dazMorphsDest:
        typeof raw.dazMorphsDest === 'string' ? raw.dazMorphsDest : defaults.dazMorphsDest,
      dazPresetsSource:
        typeof raw.dazPresetsSource === 'string' ? raw.dazPresetsSource : defaults.dazPresetsSource,
      dazPresetsDest:
        typeof raw.dazPresetsDest === 'string' ? raw.dazPresetsDest : defaults.dazPresetsDest,
      houdiniPresetsSource:
        typeof raw.houdiniPresetsSource === 'string'
          ? raw.houdiniPresetsSource
          : defaults.houdiniPresetsSource,
      acceptedConflicts: Array.isArray(raw.acceptedConflicts)
        ? raw.acceptedConflicts.filter((f: unknown): f is string => typeof f === 'string')
        : defaults.acceptedConflicts,
      dedupQuarantineFolder:
        typeof raw.dedupQuarantineFolder === 'string'
          ? raw.dedupQuarantineFolder
          : defaults.dedupQuarantineFolder,
      dazUninstallFolders: Array.isArray(raw.dazUninstallFolders)
        ? raw.dazUninstallFolders.filter((f: unknown): f is string => typeof f === 'string')
        : defaults.dazUninstallFolders,
    }
  } catch {
    return defaults
  }
}

export async function saveSettings(settings: StudioSettings): Promise<StudioSettings> {
  await ensureAppDir()
  await writeTextFile(await dataPath('settings.json'), JSON.stringify(settings, null, 2) + '\n')
  return settings
}
