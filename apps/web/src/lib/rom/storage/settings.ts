import { readTextFile } from '@tauri-apps/plugin-fs'
import { z } from 'zod'

import { writeTextFileAtomic } from './fs'
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
   * Where the DTH Exporter Plugin releases are, as a LIST — a folder holding the
   * exporter DLL, or one holding a folder per Studio generation
   * (`ExporterPlugin/Daz Studio 4` + `…/Daz Studio 6`, which is how mrpdean
   * publishes it). Each folder is scanned itself and one level down.
   *
   * A list because the plugin ships one binary per Studio generation and a
   * machine can run several side by side: the studio installs the DS4 build into
   * every Daz Studio 4 it finds and the DS6 build into every Daz Studio 6, so
   * "the exporter folder" was never one folder — it was one per Studio, and a
   * single field could only ever describe half a machine.
   */
  dthExporterFolders: stringArray,
  /**
   * LEGACY single Exporter Plugin folder — read once and merged into
   * {@link exporterSourceFolders} so an existing settings.json keeps working,
   * never written again. (Same treatment as `houdiniPathStyle`.)
   */
  dthExporterFolder: str,
  /**
   * LEGACY selected Exporter Plugin version. The plugin is now resolved per
   * Studio generation and the NEWEST build of each is installed, so there is no
   * single version to pin; kept only so old files still parse.
   */
  currentDthExporterVersion: str,
  /**
   * Where Daz Studio is installed (e.g. `C:/Program Files/DAZ 3D/DAZStudio4`).
   * Optional — the DTH install drops the exporter plugin DLLs into its `plugins`
   * subfolder.
   *
   * DERIVED while `dazInstallKey` is set (see there); the user's own to edit
   * otherwise. Everything downstream reads this field either way, so activating
   * an installation changes where the value comes from, never what reads it.
   */
  dazInstallFolder: str,
  /**
   * Which detected Daz installation the three Daz paths were derived from —
   * DIM's own key for it (`dzStudio6InstallDir-64`), which survives the folder
   * moving. Empty = none activated, and `dazLibraryFolder` / `dazInstallFolder`
   * / `dimManifestsFolder` are plain editable fields as they always were.
   *
   * The KEY is stored rather than a snapshot of the paths so a re-detect can
   * tell "the same installation, moved" from "a different installation", and so
   * a machine that no longer has it can say so instead of silently activating
   * something else (`deriveDazPaths`, `lib/daz-install.ts`).
   */
  dazInstallKey: str,
  /**
   * An OLDER Daz installation that runs the export batches — DIM's key for it,
   * the same identity `dazInstallKey` stores. Empty (the default) = exports run
   * in the activated installation like everything else.
   *
   * **Why one installation can be the odd one out.** Everything the studio does
   * in Daz goes through the activated install — except the batch handoff, which
   * only works if the DTH **Runner plugin** loaded, and a plugin binary is built
   * against ONE Studio major version (see `.ai/gotchas.md`, "Export only" may
   * never point at Daz Studio 4 — which also records the one install this must
   * never name). So a user who has moved to the newest Studio for authoring can still
   * be waiting on an exporter/runner build for it, and their exports have to
   * keep running in the older one. This field is that arrangement, made
   * explicit and visible, instead of forcing the whole app back a version.
   *
   * At most ONE installation carries it: the flag is a single stored key, so
   * turning it on for one card is what turns it off everywhere else — there is
   * no state in which two installs both claim the exports.
   */
  dazExportInstallKey: str,
  /**
   * Where that export installation lives — the folder the launcher needs, kept
   * beside the key for the same reason `dazInstallFolder` is: the key is the
   * identity, the folder is what a process can actually be started from, and
   * resolving one from the other at launch time would mean a registry scan on
   * the path where Daz is already starting.
   */
  dazExportInstallFolder: str,
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
   * The Houdini INSTALLATION folder (e.g.
   * `C:/Program Files/Side Effects Software/Houdini 22.0.368`). Optional — its
   * `bin/hython.exe` powers the character page's "Generate project" (creating
   * a ready-made DazToHue Houdini project; the network is instantiated from
   * the INSTALLED DazToHue HDA — no template scene to rot across versions).
   *
   * DERIVED while `houdiniInstallKey` is set, together with
   * `houdiniDocsFolder`; the user's own to edit otherwise.
   */
  houdiniInstallFolder: str,
  /**
   * Which detected Houdini the two Houdini paths were derived from — SideFX's
   * four-part version (`22.0.0.368`), which is the registry's own key for it.
   * Empty = none activated, and both fields are plain editable ones.
   *
   * `extraHoudiniDocsFolders` is deliberately NOT part of this: it exists so an
   * older Houdini can keep an older DTH release, which is a decision about the
   * OTHER versions and stays the user's.
   */
  houdiniInstallKey: str,
  /**
   * Folders holding Unreal Engine plugins, as a LIST. Two shapes are accepted
   * per folder: a plugin folder itself (its `.uplugin` at top level, or one
   * level down — a folder of plugins), where the UE version it was built for is
   * read from the `.uplugin`'s `EngineVersion` or a version-looking path
   * segment; or a MULTI-BUILD root (e.g. `…/DazToUnrealBridge`) whose
   * subfolders name the engine version (`UE_5.7`, `5.6`, …), each holding that
   * build's `Plugins`. The install dialog on a project's Unreal card matches
   * these against the `.uproject`'s engine version at install time — nothing is
   * resolved when the folder is added, so a new build dropped into a
   * multi-build root is picked up on the next install.
   */
  unrealPluginFolders: stringArray,
  /**
   * LEGACY (pre-v0.61): how the bone-scale **reference-skeleton FBX** paths in
   * the PoseAsset CSV were anchored, back when this was one app-global knob.
   * The decision is PER PROJECT now — `houdiniPathStyle` in the `.dcsp`
   * manifest (`DcspManifest`, storage/projects.ts) is what generation reads,
   * decided in the first Generate-project dialog and edited in Settings →
   * Project.
   *
   * Kept tolerated so old settings.json files still parse, and read in exactly
   * ONE place: the first-Generate-project intro seeds its `$HIP` default from
   * it, so a user who had deliberately switched to `absolute` (the escape
   * hatch when `$HIP` expansion misbehaves in Houdini) isn't silently flipped
   * back to `$HIP` by the fresh per-project default.
   */
  houdiniPathStyle: z.enum(['hip', 'absolute']).catch('hip').default('hip'),
  /**
   * The DAZ Install Manager `ManifestFiles` folder (a folder of `.dsx` XML), read
   * by the Daz Products scan to resolve scene assets to installed products
   * (name/SKU/artist/version). Machine-specific; empty = unset (the scan then runs
   * but reports every asset as unmatched).
   */
  dimManifestsFolder: str,
  /**
   * ADDITIONAL DIM `ManifestFiles` folders — users organize their installs
   * across several DIM libraries (each with its own manifests folder), and the
   * product scan reads them ALL: {@link dimManifestsPathSpec} joins these with
   * the primary into the one `dimManifestPath` the generated scan scripts
   * bake (runtime v104 splits it again). User-owned even while an activated
   * Daz installation DERIVES the primary — the derivation knows only its own
   * install's folder, and which other libraries exist stays the user's.
   */
  extraDimManifestsFolders: stringArray,
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

// Set when settings.json EXISTED but couldn't be parsed — the UI surfaces it
// once (see __root.tsx), so a reset-to-defaults never masquerades as a fresh
// install while a later save silently overwrites the broken file.
let settingsFileCorrupt = false

/** One-shot: whether the last settings read found an existing-but-unparseable
 *  file. Reading the flag clears it (a single startup toast, not a nag). */
export function consumeSettingsFileCorrupt(): boolean {
  const was = settingsFileCorrupt
  settingsFileCorrupt = false
  return was
}

export async function getSettings(): Promise<StudioSettings> {
  let raw: string
  try {
    raw = await readTextFile(await dataPath('settings.json'))
  } catch {
    // Missing/unreadable file — a fresh install: every field at its default.
    return studioSettingsSchema.parse({})
  }
  try {
    // Every field is individually tolerant (see the schema), so a partial or
    // hand-damaged settings.json keeps its good fields instead of resetting.
    return studioSettingsSchema.parse(JSON.parse(raw))
  } catch {
    // The file exists but isn't JSON — same defaults, but flagged for the UI.
    settingsFileCorrupt = true
    return studioSettingsSchema.parse({})
  }
}

/**
 * Persist the app-global settings. With a `baseline` (the caller's loader-seeded
 * snapshot), only the fields the caller actually CHANGED versus that baseline are
 * taken from `next`; every other field is re-read fresh from disk. One project per
 * WINDOW means several windows share this file — a whole-object write from window
 * A silently reverted anything window B changed since A's loader ran (e.g. Tools
 * saving `dazMorphsSource` in a project window, wiped by a later Settings save in
 * the Home window). Same-field concurrent edits stay last-writer-wins. Without a
 * baseline (one-shot internal writers that just re-read) it's a plain write.
 */
export async function saveSettings(
  next: StudioSettings,
  baseline?: StudioSettings,
): Promise<StudioSettings> {
  await ensureAppDir()
  let merged = next
  if (baseline) {
    const disk = await getSettings()
    merged = { ...disk }
    for (const key of Object.keys(studioSettingsSchema.shape) as Array<keyof StudioSettings>) {
      if (JSON.stringify(next[key]) !== JSON.stringify(baseline[key])) {
        ;(merged as Record<string, unknown>)[key] = next[key]
      }
    }
  }
  await writeTextFileAtomic(await dataPath('settings.json'), JSON.stringify(merged, null, 2) + '\n')
  return merged
}

/**
 * Every folder to look for DTH Exporter Plugin releases in: the configured list,
 * plus the legacy single field when it names something the list doesn't already
 * cover. Trimmed, de-duplicated case-insensitively, order preserved (the user's
 * order decides ties between two copies of the same version).
 *
 * The legacy merge is a fallback for a settings.json that has never been through
 * the Settings page — which MIGRATES the value into the list and clears it, so
 * that a folder removed from the list is really gone rather than being merged
 * back in here forever.
 *
 * Pure, and the single statement of "where do the exporter builds come from" —
 * the scan, the install and the Settings readout all ask it.
 */
export function exporterSourceFolders(settings: StudioSettings): Array<string> {
  const out: Array<string> = []
  const seen = new Set<string>()
  for (const raw of [...settings.dthExporterFolders, settings.dthExporterFolder]) {
    const folder = raw.trim()
    if (!folder || seen.has(folder.toLowerCase())) continue
    seen.add(folder.toLowerCase())
    out.push(folder)
  }
  return out
}

/**
 * Every DIM manifests folder the product scan should read — the primary
 * (possibly derived from the activated Daz installation) plus the user's
 * {@link extraDimManifestsFolders} — deduped, trimmed, order kept.
 *
 * Pure, and the single statement of "what is the product database": the scan
 * arming checks (non-empty spec = the scan can name products), the generated
 * scripts' baked `dimManifestPath` and the Refresh-assets staleness compare
 * all read the SAME list, so adding or removing a folder re-flags every
 * character's scripts exactly like moving the single folder always has.
 */
export function dimManifestsFolderList(
  settings: Pick<StudioSettings, 'dimManifestsFolder' | 'extraDimManifestsFolders'>,
): Array<string> {
  const out: Array<string> = []
  const seen = new Set<string>()
  for (const raw of [settings.dimManifestsFolder, ...settings.extraDimManifestsFolders]) {
    const folder = raw.trim()
    // The dedupe key normalizes like `samePath` (the staleness compare): the
    // derived primary arrives with backslashes while a typed extra may not, and
    // the same folder surviving twice would be baked twice — the runtime then
    // scans it twice and every product it names shows up doubled.
    const key = folder.toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '')
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(folder)
  }
  return out
}

/**
 * {@link dimManifestsFolderList} as the ONE wire string the generated scan
 * scripts bake (`dimManifestPath`): '|'-joined, because '|' is illegal in
 * Windows paths (collision-free) AND needs no JSON escaping — the baked
 * config and `readScriptRuntimeInfo`'s regex read-back both survive it, which
 * a newline join would not (it reads back as a literal `\n` escape and the
 * staleness compare then never matches). '' = no folder configured. Runtime
 * v104's `getInstalledProducts` splits it again.
 */
export function dimManifestsPathSpec(
  settings: Pick<StudioSettings, 'dimManifestsFolder' | 'extraDimManifestsFolders'>,
): string {
  return dimManifestsFolderList(settings).join('|')
}

/**
 * The Daz installation that runs EXPORT BATCHES: the one flagged **Export only**
 * when a card carries that flag, else the activated one.
 *
 * Pure, and the single statement of the rule — three layers need the same
 * answer and must never disagree about it: the launcher that starts the batch
 * (`api/core.exportDazInstallFolder`), the Runner gate that says the batch can
 * start, and the Runner install that puts the plugin where the batch will look
 * for it. A gate reading one install while the launcher starts another is a
 * "ready" over an export that opens Daz and waits forever.
 *
 * The KEY is what arms it. A folder left behind by a switch turned off, or by an
 * install that has since been activated in its own right, must not keep quietly
 * taking the exports.
 */
export function exportInstallFolder(settings: StudioSettings): string {
  const key = settings.dazExportInstallKey.trim()
  const folder = settings.dazExportInstallFolder.trim()
  return key && folder ? folder : settings.dazInstallFolder.trim()
}
