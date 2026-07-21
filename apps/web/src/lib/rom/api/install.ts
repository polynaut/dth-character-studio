import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { z } from 'zod'

import { withBusyCursor } from '../../busy-cursor.ts'
import * as storage from '../storage'
import { dataPath } from '../storage'
import { dedupReportSchema, installReportSchema } from './native-types.ts'

import type { StudioSettings } from '../storage'
// The structured native-command RETURN types are inferred from the zod schemas
// in native-types.ts (parsed at each `invoke` boundary below, so a Rust
// serde-field rename throws where it happens instead of silently handing the UI
// `undefined`). Imported for this module's own annotations AND re-exported so the
// api.ts barrel + downstream (install-controls, tools) keep importing them here.
import type {
  AssetDup,
  ConflictCopy,
  DedupReport,
  DupMember,
  FileConflict,
  InstallReport,
  InstallStep,
} from './native-types.ts'
export type {
  AssetDup,
  ConflictCopy,
  DedupReport,
  DupMember,
  FileConflict,
  InstallReport,
  InstallStep,
}

/** Every native command in this module is a potentially long job (release/
 *  plugin/asset installs, library scans, dedup, uninstall) — run them all
 *  under the global working cursor. */
const invoke = <T,>(cmd: string, args?: Record<string, unknown>): Promise<T> =>
  withBusyCursor(tauriInvoke<T>(cmd, args))

// App-global settings (settings.json) + the Tools-page install features: the DTH
// release / Exporter plugin installs, the user's own Daz/Houdini content installs,
// asset dedup, and the Daz uninstall cleanup.

// --- Settings + catalog ---------------------------------------------------

export async function fetchSettings(): Promise<StudioSettings> {
  return storage.getSettings()
}

/** The running app's version (e.g. "0.17.0"); '' on the web-only build. */
export async function fetchAppVersion(): Promise<string> {
  return storage.studioVersion()
}

/**
 * The app's internal per-user data folder — where settings.json, recents.json and
 * network-drives.json live (projects.json + global avatars were migrated away to
 * the `.dcsp` model; avatars are now per-project under `.dcsmeta/images`).
 * Surfaced in Settings so the user can find (and back up) the app's machine state.
 */
export async function fetchAppDataFolder(): Promise<string> {
  return dataPath()
}

/** Inspect a DTH folder: a single release, or a list of versioned releases. */
export async function listDthReleases({
  data,
}: {
  data: unknown
}): Promise<ReturnType<typeof storage.listDthReleases>> {
  const { folder } = z.object({ folder: z.string() }).parse(data)
  return storage.listDthReleases(folder)
}

/** Inspect a DTH Exporter Plugin folder: a single plugin, or versioned folders. */
export async function listDthExporterReleases({
  data,
}: {
  data: unknown
}): Promise<ReturnType<typeof storage.listDthExporterReleases>> {
  const { folder } = z.object({ folder: z.string() }).parse(data)
  return storage.listDthExporterReleases(folder)
}

export async function saveSettings({ data }: { data: unknown }): Promise<StudioSettings> {
  // The same tolerant schema reads settings.json and validates the save input —
  // the field list + defaults live ONCE, in storage/settings.ts. The caller's
  // loader-seeded `baseline` rides along so only its actual edits win over what
  // other windows saved meanwhile (see storage.saveSettings).
  const { settings, baseline } = z
    .object({
      settings: storage.studioSettingsSchema,
      baseline: storage.studioSettingsSchema,
    })
    .parse(data)
  return storage.saveSettings(settings, baseline)
}

/** One-shot corrupt-settings flag for the startup toast (see storage/settings). */
export function consumeSettingsFileCorrupt(): boolean {
  return storage.consumeSettingsFileCorrupt()
}

/**
 * Install one half of the DTH *release* content — `target: 'daz'` copies the Daz
 * content into the local library, `'houdini'` merges the Houdini assets into the
 * Houdini documents folder — a port of the dth-cli `install-daz-dth` /
 * `install-houdini-dth` commands, individually runnable. Path resolution happens
 * here; the recursive copy runs in native Rust (`install_dth_release`). Throws
 * with a combined message when the half's prerequisites are missing. `dryRun`
 * previews without writing.
 */
export async function installDthRelease({ data }: { data: unknown }): Promise<InstallReport> {
  const { dryRun, target, houdiniDocsFolder } = z
    .object({
      dryRun: z.boolean().optional(),
      target: z.enum(['daz', 'houdini']),
      /** Install the Houdini half into THIS folder instead of the primary one
       *  (an extra Houdini version from Settings). */
      houdiniDocsFolder: z.string().optional(),
    })
    .parse(data ?? {})
  const plan = await storage.resolveReleaseInstall(target, houdiniDocsFolder)
  if (plan.errors.length) throw new Error(plan.errors.join('\n'))
  return installReportSchema.parse(await invoke('install_dth_release', {
    request: {
      releaseRoot: plan.releaseRoot,
      dazLibFolder: plan.dazLibFolder,
      houdiniDocsFolder: plan.houdiniDocsFolder,
      dryRun: dryRun ?? false,
      target,
    },
  }))
}

/**
 * Install the Exporter *plugin* DLLs into `<Daz install>/plugins` (the
 * admin-sensitive half) — native `install_dth_plugin`. Throws when prerequisites
 * are missing; `dryRun` previews without writing.
 */
export async function installDthPlugin({ data }: { data: unknown }): Promise<InstallReport> {
  const { dryRun } = z.object({ dryRun: z.boolean().optional() }).parse(data ?? {})
  const plan = await storage.resolvePluginInstall()
  if (plan.errors.length) throw new Error(plan.errors.join('\n'))
  return installReportSchema.parse(await invoke('install_dth_plugin', {
    request: {
      exporterFolder: plan.exporterFolder,
      dazInstallFolder: plan.dazInstallFolder,
      dryRun: dryRun ?? false,
    },
  }))
}

// --- "Optional" tab: install your own Daz/Houdini content -----------------
// Ports of the dth-cli install-daz-assets / -morphs / -presets / -houdini-presets
// (and list-daz-assets) commands. Paths come from settings; the copy + scan run
// in native Rust. `dryRun` previews; assets/list also report what's already there.

const installOptions = z.object({
  dryRun: z.boolean().optional(),
  force: z.boolean().optional(),
  // The changed-asset names from a prior dry-run/scan — install only those,
  // skipping a re-walk of every already-installed asset. Empty installs all.
  only: z.array(z.string()).optional(),
})

/** Install your own Daz assets (G3/G8/G9, .zip extracted) from the configured
 *  asset folders into "My DAZ 3D Library" — content-folder-aware, overwriting per
 *  asset, skipping ones already installed unless `force`. */
export async function installDazAssets({ data }: { data: unknown }): Promise<InstallReport> {
  const { dryRun, force, only } = installOptions.parse(data ?? {})
  const s = await storage.getSettings()
  const sources = s.dazAssetsFolders.map((f) => f.trim()).filter(Boolean)
  const errors: Array<string> = []
  if (!sources.length) errors.push('Add at least one Daz assets folder')
  if (!s.dazLibraryFolder.trim()) errors.push('Set “My DAZ 3D Library”')
  if (errors.length) throw new Error(errors.join('\n'))
  return installReportSchema.parse(await invoke('install_daz_assets', {
    request: {
      sources,
      dest: s.dazLibraryFolder.trim(),
      force: force ?? false,
      dryRun: dryRun ?? false,
      only: only ?? [],
      accepted: s.acceptedConflicts,
    },
  }))
}

/** Read-only scan of the asset folders — what content each holds and whether it's
 *  already installed in the library. */
export async function listDazAssets(): Promise<InstallReport> {
  const s = await storage.getSettings()
  const sources = s.dazAssetsFolders.map((f) => f.trim()).filter(Boolean)
  if (!sources.length) throw new Error('Add at least one Daz assets folder')
  return installReportSchema.parse(await invoke('list_daz_assets', {
    request: { sources, dest: s.dazLibraryFolder.trim(), accepted: s.acceptedConflicts },
  }))
}

/** Accept files as legitimately shared between products — they stop showing as
 *  "to copy" / as a conflict (left as whatever is installed). Returns the updated
 *  accepted list. Pass `clear: true` with the same paths to un-accept them. */
export async function setAcceptedConflicts(
  rels: Array<string>,
  clear = false,
): Promise<Array<string>> {
  const s = await storage.getSettings()
  const set = new Set(s.acceptedConflicts)
  for (const r of rels) {
    if (clear) set.delete(r)
    else set.add(r)
  }
  const acceptedConflicts = [...set].sort()
  // Pass `s` as the baseline so this writes ONLY `acceptedConflicts` (field-level
  // merge, re-reading every other field from disk) — a plain full-object write
  // would clobber a Settings save made in another window between the read above
  // and here.
  await storage.saveSettings({ ...s, acceptedConflicts }, s)
  return acceptedConflicts
}

/** Find (dry run) or resolve duplicate assets + conflicting shared files. Apply
 *  quarantines the redundant duplicate copies (a reversible move — downloaded
 *  files are never edited); shared-file conflicts are informational, resolved by
 *  Accept. `keepers` carries the full asset PATHS the user chose to keep (paths,
 *  not labels — an exact-dup group's members share a label by construction).
 *  Quarantine failures and stale keeper choices come back in `report.errors` /
 *  per-member `error`. */
export async function dedupDazAssets({ data }: { data: unknown }): Promise<DedupReport> {
  const { dryRun, keepers } = z
    .object({ dryRun: z.boolean().optional(), keepers: z.array(z.string()).optional() })
    .parse(data ?? {})
  const s = await storage.getSettings()
  const sources = s.dazAssetsFolders.map((f) => f.trim()).filter(Boolean)
  if (!sources.length) throw new Error('Add at least one Daz assets folder')
  return dedupReportSchema.parse(await invoke('dedup_daz_assets', {
    request: {
      sources,
      dryRun: dryRun ?? false,
      accepted: s.acceptedConflicts,
      keepers: keepers ?? [],
      quarantine: s.dedupQuarantineFolder.trim(),
    },
  }))
}

/** The default leftover-Daz-folder list (dth-cli `uninstall-daz` defaults: the
 *  library root, common Documents/Public spots, APPDATA DAZ 3D + Start Menu). */
export async function defaultDazUninstallFolders(): Promise<Array<string>> {
  const s = await storage.getSettings()
  // Parse the native return through zod rather than a bare `invoke<T>()` cast:
  // this list pre-fills the danger-zone RECURSIVE-DELETE targets, so a wrong shape
  // must fail loud here, not feed junk into a delete.
  const raw = await invoke('default_daz_uninstall_folders', {
    request: { dazLibFolder: s.dazLibraryFolder.trim() },
  })
  return z.array(z.string()).parse(raw)
}

/** DANGER: recursively delete the configured leftover Daz folders (run after
 *  removing Daz Studio / DIM via Add or Remove Programs). `dryRun` only previews. */
export async function uninstallDaz({ data }: { data: unknown }): Promise<InstallReport> {
  const { dryRun } = z.object({ dryRun: z.boolean().optional() }).parse(data ?? {})
  const s = await storage.getSettings()
  const folders = s.dazUninstallFolders.map((f) => f.trim()).filter(Boolean)
  if (!folders.length) throw new Error('No folders to clean up')
  return installReportSchema.parse(await invoke('uninstall_daz', { request: { folders, dryRun: dryRun ?? false } }))
}

/** Merge-only install (adds new files, never overwrites) used for custom morphs
 *  and presets — `which` picks the source/dest pair from settings. */
async function installMerge(
  which: 'morphs' | 'presets',
  dryRun: boolean,
): Promise<InstallReport> {
  const s = await storage.getSettings()
  const label = which === 'morphs' ? 'Custom morphs' : 'Daz presets'
  const source = which === 'morphs' ? s.dazMorphsSource.trim() : s.dazPresetsSource.trim()
  const dest = which === 'morphs' ? s.dazMorphsDest.trim() : s.dazPresetsDest.trim()
  const errors: Array<string> = []
  if (!source) errors.push(`Set the ${label.toLowerCase()} source folder`)
  if (!dest) errors.push(`Set the ${label.toLowerCase()} destination folder`)
  if (errors.length) throw new Error(errors.join('\n'))
  return installReportSchema.parse(await invoke('install_daz_merge', {
    request: { label, source, dest, dryRun },
  }))
}

export async function installDazMorphs({ data }: { data: unknown }): Promise<InstallReport> {
  return installMerge('morphs', installOptions.parse(data ?? {}).dryRun ?? false)
}

export async function installDazPresets({ data }: { data: unknown }): Promise<InstallReport> {
  return installMerge('presets', installOptions.parse(data ?? {}).dryRun ?? false)
}

/** Install your Houdini `my_presets` into the Houdini docs folder (overwriting)
 *  and wire it into that version's `houdini.env`. */
export async function installHoudiniPresets({ data }: { data: unknown }): Promise<InstallReport> {
  const { dryRun } = installOptions.parse(data ?? {})
  const s = await storage.getSettings()
  const errors: Array<string> = []
  if (!s.houdiniPresetsSource.trim()) errors.push('Set the Houdini presets source folder')
  if (!s.houdiniDocsFolder.trim()) errors.push('Set the Houdini documents folder')
  if (errors.length) throw new Error(errors.join('\n'))
  return installReportSchema.parse(await invoke('install_houdini_presets', {
    request: {
      source: s.houdiniPresetsSource.trim(),
      houdiniDocs: s.houdiniDocsFolder.trim(),
      dryRun: dryRun ?? false,
    },
  }))
}

/** Version of the exporter DLL already installed in `<dazInstall>/plugins` (''=none). */
export async function installedExporterVersion(dazInstallFolder: string): Promise<string> {
  try {
    return await storage.installedExporterVersion(dazInstallFolder)
  } catch {
    return ''
  }
}

const unrealContentInput = z.object({
  /** The linked `.uproject` file (absolute). */
  uprojectPath: z.string().min(1),
})

/**
 * Whether the linked Unreal project already carries `Content/DazToHue`.
 * Rust-side (`unreal_dth_present`) on purpose: the old JS probe's separator
 * regex had lost its backslash, so backslash paths never stripped to the
 * parent folder and every project read as "missing" — and Rust keeps the
 * check symmetric with `install_unreal_dth`'s own path derivation.
 */
export async function unrealDthContentPresent({ data }: { data: unknown }): Promise<boolean> {
  const { uprojectPath } = unrealContentInput.parse(data)
  // zod-parsed, not a bare invoke<T>() cast (primitive shape — no fixture needed).
  return z.boolean().parse(await invoke('unreal_dth_present', { uprojectPath }))
}

/**
 * Install the ACTIVE DTH release's Unreal Engine content into the linked
 * project's `Content/DazToHue` (native copy, `install_unreal_dth`) — the
 * instant bootstrap for a fresh Unreal project. `overwrite` copies over an
 * existing folder (the UI's Ctrl+click); never deletes first. Returns the
 * number of files copied.
 */
export async function installUnrealDthContent({ data }: { data: unknown }): Promise<number> {
  const { uprojectPath, overwrite } = unrealContentInput
    .extend({ overwrite: z.boolean().optional() })
    .parse(data)
  const s = await storage.getSettings()
  const release = await storage.resolveActiveReleaseRoot(s.dthPosesFolder, s.currentDthVersion)
  if (release.error || !release.releaseRoot) {
    throw new Error(release.error ?? 'No DTH release resolved — set the DTH release folder in Settings.')
  }
  // zod-parsed, not a bare invoke<T>() cast (primitive shape — no fixture needed).
  return z.number().parse(
    await invoke('install_unreal_dth', {
      request: { releaseRoot: release.releaseRoot, uprojectPath, overwrite: overwrite ?? false },
    }),
  )
}
