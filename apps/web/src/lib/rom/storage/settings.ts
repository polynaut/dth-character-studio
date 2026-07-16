import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { z } from 'zod'

import { dataPath, ensureAppDir } from './app-data'

// App-global settings (`settings.json` in app-data): machine/tool paths only —
// per-project behaviour lives in each project's .dcsp manifest (see projects.ts).

/** Tolerant string: a missing or wrong-typed field becomes ''. */
const str = z.string().catch('')

/** Tolerant string array: non-string ELEMENTS are dropped (a hand-edited
 *  settings.json with one bad entry keeps the rest); any non-array becomes []. */
const stringArray = z.preprocess(
  (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []),
  z.array(z.string()),
)

/**
 * THE single definition of the app-global settings: the field list, the
 * defaults (every field's `catch` value — `parse({})` IS a fresh install) and
 * the tolerant read used on both the settings.json parse and the save input,
 * with `StudioSettings` inferred from it. One place to add a field — plus its
 * UI in the Settings route (remember the `dirty` gate there, or the value
 * never reaches disk).
 */
export const studioSettingsSchema = z.object({
  /**
   * "My DAZ 3D Library" — the user's Daz content library path. Asked on first
   * run; the generated character scripts install into its
   * `Scripts/DTH-Character-Studio/` root.
   */
  dazLibraryFolder: str,
  /**
   * A DTH release folder (contains `copyright.txt`), or a folder of versioned
   * releases (release folders and/or `.zip`s). Scanned for the pose catalog.
   */
  dthPosesFolder: str,
  /**
   * Selected DTH release version (e.g. "2.4.3") when `dthPosesFolder` holds
   * several releases. Empty = not chosen yet. Persisting the pick stops a newly
   * dropped-in release from silently becoming the active one.
   */
  currentDthVersion: str,
  /**
   * The DTH Exporter Plugin folder (contains `dth_exporter.dll`), or a folder of
   * versioned plugin folders. Stored for reference; the version is read from the
   * DLL rather than the folder name.
   */
  dthExporterFolder: str,
  /**
   * Selected Exporter Plugin version (the DLL's FileVersion, e.g. "1.0.0.1"), or
   * a folder name fallback when a plugin folder carries no version resource.
   * Empty = not chosen / none detected.
   */
  currentDthExporterVersion: str,
  /**
   * Where Daz Studio is installed (e.g. `C:/Program Files/DAZ 3D/DAZStudio4`).
   * Optional — the DTH install drops the exporter plugin DLLs into its `plugins`
   * subfolder.
   */
  dazInstallFolder: str,
  /**
   * The Houdini documents folder (e.g. `D:/User Data/Documents/houdini20.5`).
   * Optional — the DTH install merges the release's Houdini assets
   * (otls/presets/toolbar) into it.
   */
  houdiniDocsFolder: str,
  /**
   * ADDITIONAL Houdini documents folders (older/parallel Houdini versions) -
   * each is an alternative install target for a DTH release's Houdini assets,
   * so an old Houdini can keep an old DTH while the primary stays current.
   */
  extraHoudiniDocsFolders: stringArray,
  /**
   * The DAZ Install Manager `ManifestFiles` folder (a folder of `.dsx` XML), read
   * by the Daz Products scan to resolve scene assets to installed products
   * (name/SKU/artist/version). Machine-specific; empty = unset (the scan then runs
   * but reports every asset as unmatched).
   */
  dimManifestsFolder: str,
  // Per-project behaviour defaults (dazSubdir / houdiniSubdir / createHoudiniSubdir)
  // live in each project's .dcsp manifest (see DcspManifest), not in app-global
  // settings — they describe a project, not the machine.
  // --- "Optional" tab: install your own Daz/Houdini content (not DTH release) ---
  /**
   * Your Daz asset source folders. Each is scanned for content folders
   * (`data`/`People`/`Runtime`/`Documentation`, `.zip` assets extracted) and
   * installed into `dazLibraryFolder`. A flat list — generation is auto-detected.
   */
  dazAssetsFolders: stringArray,
  /** Custom morphs (Daz Transfer Shape Utility output): source folder + its
   *  destination (your personal "…/Studio/My Library/data/Daz 3D"). */
  dazMorphsSource: str,
  dazMorphsDest: str,
  /** Daz presets: source folder + destination ("…/Studio/My Library/Presets"). */
  dazPresetsSource: str,
  dazPresetsDest: str,
  /** Houdini `my_presets` source — copied into the Houdini docs folder and wired
   *  into its `houdini.env` (`SHARED_PRESETS` + `HOUDINI_PATH`). */
  houdiniPresetsSource: str,
  /** Destination-relative file paths the user has "accepted" as legitimately
   *  shared between products (e.g. a vendor icon, cross-product textures). Both
   *  the asset scan/install and the dedup skip these, so they stop showing as
   *  "to copy" / as a conflict — the file stays whatever is installed. */
  acceptedConflicts: stringArray,
  /** Where the dedup moves redundant duplicate copies. Required to run Apply —
   *  nothing is quarantined until this is set. */
  dedupQuarantineFolder: str,
  /** "Danger zone" — folders the Daz uninstall cleanup deletes (pre-filled from
   *  the dth-cli defaults, then user-editable). */
  dazUninstallFolders: stringArray,
})

export type StudioSettings = z.infer<typeof studioSettingsSchema>

export async function getSettings(): Promise<StudioSettings> {
  try {
    // Every field is individually tolerant (see the schema), so a partial or
    // hand-damaged settings.json keeps its good fields instead of resetting.
    return studioSettingsSchema.parse(
      JSON.parse(await readTextFile(await dataPath('settings.json'))),
    )
  } catch {
    // Missing/unreadable file — a fresh install: every field at its default.
    return studioSettingsSchema.parse({})
  }
}

export async function saveSettings(settings: StudioSettings): Promise<StudioSettings> {
  await ensureAppDir()
  await writeTextFile(await dataPath('settings.json'), JSON.stringify(settings, null, 2) + '\n')
  return settings
}
