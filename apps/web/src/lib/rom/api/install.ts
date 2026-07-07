import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'

import * as storage from '../storage'
import { dataPath } from '../storage'

import type { StudioSettings } from '../storage'

// App-global settings (settings.json) + the Tools-page install features: the DTH
// release / Exporter plugin installs, the user's own Daz/Houdini content installs,
// asset dedup, Daz uninstall cleanup, and the DazToHue-Scripts runtime install.

// --- Settings + catalog ---------------------------------------------------

export async function fetchSettings(): Promise<StudioSettings> {
  return storage.getSettings()
}

/** The running app's version (e.g. "0.17.0"); '' on the web-only build. */
export async function fetchAppVersion(): Promise<string> {
  return storage.studioVersion()
}

/**
 * The app's internal per-user data folder — where settings.json, projects.json
 * and avatar images live. Surfaced in Settings so the user can find (and back
 * up) the app's state.
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

const settingsInput = z.object({
  dazLibraryFolder: z.string(),
  dthPosesFolder: z.string(),
  // Tolerate older payloads that predate the field (kept = '' = not chosen).
  currentDthVersion: z.string().default(''),
  dthExporterFolder: z.string().default(''),
  currentDthExporterVersion: z.string().default(''),
  dazInstallFolder: z.string().default(''),
  houdiniDocsFolder: z.string().default(''),
  dimManifestsFolder: z.string().default(''),
  dazAssetsFolders: z.array(z.string()).default([]),
  dazMorphsSource: z.string().default(''),
  dazMorphsDest: z.string().default(''),
  dazPresetsSource: z.string().default(''),
  dazPresetsDest: z.string().default(''),
  houdiniPresetsSource: z.string().default(''),
  acceptedConflicts: z.array(z.string()).default([]),
  dedupQuarantineFolder: z.string().default(''),
  dazUninstallFolders: z.array(z.string()).default([]),
})

export async function saveSettings({ data }: { data: unknown }): Promise<StudioSettings> {
  return storage.saveSettings(settingsInput.parse(data))
}

/** One copy step of the DTH install (mirrors the Rust `InstallStep`). */
export interface InstallStep {
  label: string
  files: number
  status: 'ok' | 'skipped' | 'error' | 'header'
  detail: string
  /** For asset steps: the (capped) list of files an install would copy. */
  filesList?: Array<string>
  /** Set when this asset writes the same library files as another in the report
   *  (e.g. a folder and its .zip) — a "same files as …" duplicate hint. */
  note?: string
}

/** Outcome of a DTH install run (mirrors the Rust `InstallReport`). */
export interface InstallReport {
  dryRun: boolean
  steps: Array<InstallStep>
  totalFiles: number
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
  const { dryRun, target } = z
    .object({ dryRun: z.boolean().optional(), target: z.enum(['daz', 'houdini']) })
    .parse(data ?? {})
  const plan = await storage.resolveReleaseInstall(target)
  if (plan.errors.length) throw new Error(plan.errors.join('\n'))
  return invoke<InstallReport>('install_dth_release', {
    request: {
      releaseRoot: plan.releaseRoot,
      dazLibFolder: plan.dazLibFolder,
      houdiniDocsFolder: plan.houdiniDocsFolder,
      dryRun: dryRun ?? false,
      target,
    },
  })
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
  return invoke<InstallReport>('install_dth_plugin', {
    request: {
      exporterFolder: plan.exporterFolder,
      dazInstallFolder: plan.dazInstallFolder,
      dryRun: dryRun ?? false,
    },
  })
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
  return invoke<InstallReport>('install_daz_assets', {
    request: {
      sources,
      dest: s.dazLibraryFolder.trim(),
      force: force ?? false,
      dryRun: dryRun ?? false,
      only: only ?? [],
      accepted: s.acceptedConflicts,
    },
  })
}

/** Read-only scan of the asset folders — what content each holds and whether it's
 *  already installed in the library. */
export async function listDazAssets(): Promise<InstallReport> {
  const s = await storage.getSettings()
  const sources = s.dazAssetsFolders.map((f) => f.trim()).filter(Boolean)
  if (!sources.length) throw new Error('Add at least one Daz assets folder')
  return invoke<InstallReport>('list_daz_assets', {
    request: { sources, dest: s.dazLibraryFolder.trim(), accepted: s.acceptedConflicts },
  })
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
  await storage.saveSettings({ ...s, acceptedConflicts })
  return acceptedConflicts
}

/** One copy of a conflicting shared file (mirrors Rust `ConflictCopy`). */
export interface ConflictCopy {
  label: string
  /** Source folder the copy lives in (e.g. "_genesis 9"). */
  source: string
  size: number
  inZip: boolean
}
/** A file shipped by 2+ different products at different sizes. Informational —
 *  resolved by Accept (never rewritten). */
export interface FileConflict {
  rel: string
  copies: Array<ConflictCopy>
}
/** One copy in a duplicate group. */
export interface DupMember {
  label: string
  /** Source folder the copy lives in (e.g. "_genesis 9"). */
  source: string
  fileCount: number
  isZip: boolean
  /** The copy kept (others are quarantined) — auto-picked, user-overridable. */
  isKeeper: boolean
}
/** A set of assets that are the same content — identical ('exact') or the same
 *  product at a different version ('version', e.g. a …UD vs …UPDATE). */
export interface AssetDup {
  members: Array<DupMember>
  kind: 'exact' | 'version'
  fixed: boolean
}
/** Result of the dedup scan/apply (mirrors Rust `DedupReport`). */
export interface DedupReport {
  dryRun: boolean
  conflicts: Array<FileConflict>
  duplicates: Array<AssetDup>
  assetsQuarantined: number
  backupDir: string
}

/** Find (dry run) or resolve duplicate assets + conflicting shared files. Apply
 *  rewrites every smaller copy — and the library copy — to the largest version,
 *  and quarantines redundant duplicate assets. Reversible (originals backed up). */
export async function dedupDazAssets({ data }: { data: unknown }): Promise<DedupReport> {
  const { dryRun, keepers } = z
    .object({ dryRun: z.boolean().optional(), keepers: z.array(z.string()).optional() })
    .parse(data ?? {})
  const s = await storage.getSettings()
  const sources = s.dazAssetsFolders.map((f) => f.trim()).filter(Boolean)
  if (!sources.length) throw new Error('Add at least one Daz assets folder')
  return invoke<DedupReport>('dedup_daz_assets', {
    request: {
      sources,
      dryRun: dryRun ?? false,
      accepted: s.acceptedConflicts,
      keepers: keepers ?? [],
      quarantine: s.dedupQuarantineFolder.trim(),
    },
  })
}

/** The default leftover-Daz-folder list (dth-cli `uninstall-daz` defaults: the
 *  library root, common Documents/Public spots, APPDATA DAZ 3D + Start Menu). */
export async function defaultDazUninstallFolders(): Promise<Array<string>> {
  const s = await storage.getSettings()
  return invoke<Array<string>>('default_daz_uninstall_folders', {
    request: { dazLibFolder: s.dazLibraryFolder.trim() },
  })
}

/** DANGER: recursively delete the configured leftover Daz folders (run after
 *  removing Daz Studio / DIM via Add or Remove Programs). `dryRun` only previews. */
export async function uninstallDaz({ data }: { data: unknown }): Promise<InstallReport> {
  const { dryRun } = z.object({ dryRun: z.boolean().optional() }).parse(data ?? {})
  const s = await storage.getSettings()
  const folders = s.dazUninstallFolders.map((f) => f.trim()).filter(Boolean)
  if (!folders.length) throw new Error('No folders to clean up')
  return invoke<InstallReport>('uninstall_daz', { request: { folders, dryRun: dryRun ?? false } })
}

/** The companion DazToHue-Scripts repo (the runtime the studio co-owns). */
export const DAZTOHUE_SCRIPTS_REPO = 'https://github.com/soltude/DazToHue-Scripts'

/**
 * Download the soltude/DazToHue-Scripts repo as a zip and install it into
 * `<My DAZ 3D Library>/Scripts/DazToHue-Scripts`. The download + unpack run
 * natively in Rust (the webview can't fetch the archive — codeload's CORS only
 * allows render.githubusercontent.com); GitHub's top-level wrapper folder is
 * stripped so the repo files land directly in the folder. `dryRun` downloads +
 * counts only. Throws when "My DAZ 3D Library" isn't set.
 */
export async function installDazToHueScripts({ data }: { data: unknown }): Promise<InstallReport> {
  const { dryRun } = z.object({ dryRun: z.boolean().optional() }).parse(data ?? {})
  const s = await storage.getSettings()
  const lib = s.dazLibraryFolder.trim()
  if (!lib) throw new Error('Set “My DAZ 3D Library” first')
  return invoke<InstallReport>('install_daztohue_scripts', {
    request: { dest: storage.daztohueScriptsDir(lib), dryRun: dryRun ?? false },
  })
}

/** The latest available DazToHue-Scripts commit (HEAD of `main` on GitHub),
 *  fetched natively (the webview can't hit the GitHub API — CORS). Desktop-only;
 *  throws on web/offline/rate-limit, which {@link dazToHueScriptsStatus} treats as
 *  "couldn't check". */
export async function latestDazToHueCommit(): Promise<string> {
  return invoke<string>('latest_daztohue_commit')
}

export type DazToHueScriptsState =
  | 'uptodate'
  | 'outdated'
  /** Files present but no version marker — installed before we tracked commits. */
  | 'unversioned'
  | 'notinstalled'
  /** Installed (have a local commit) but the remote check couldn't run. */
  | 'unknown'

export interface DazToHueScriptsStatus {
  /** Commit recorded in the local install's marker (null → no marker). */
  installed: string | null
  /** Latest commit on GitHub (null → the remote check failed). */
  latest: string | null
  state: DazToHueScriptsState
}

/**
 * Whether the locally installed DazToHue-Scripts are up to date: compares the
 * commit the installer recorded against the current HEAD on GitHub. Never throws —
 * a failed remote check reports `unknown` (so the UI still shows what's installed),
 * and nothing installed reports `notinstalled`.
 */
export async function dazToHueScriptsStatus(): Promise<DazToHueScriptsStatus> {
  const s = await storage.getSettings()
  const lib = s.dazLibraryFolder.trim()
  const installed = await storage.readDazToHueScriptsCommit(lib)
  let latest: string | null = null
  try {
    latest = await latestDazToHueCommit()
  } catch {
    latest = null // offline / rate-limited / web build — surfaced as "unknown"
  }
  let state: DazToHueScriptsState
  if (installed) {
    state = !latest ? 'unknown' : installed === latest ? 'uptodate' : 'outdated'
  } else {
    // No marker: a pre-versioning install (files present) vs no install at all.
    state = (lib && (await storage.daztohueScriptsPresent(lib))) ? 'unversioned' : 'notinstalled'
  }
  return { installed, latest, state }
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
  return invoke<InstallReport>('install_daz_merge', {
    request: { label, source, dest, dryRun },
  })
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
  return invoke<InstallReport>('install_houdini_presets', {
    request: {
      source: s.houdiniPresetsSource.trim(),
      houdiniDocs: s.houdiniDocsFolder.trim(),
      dryRun: dryRun ?? false,
    },
  })
}

/** Version of the exporter DLL already installed in `<dazInstall>/plugins` (''=none). */
export async function installedExporterVersion(dazInstallFolder: string): Promise<string> {
  try {
    return await storage.installedExporterVersion(dazInstallFolder)
  } catch {
    return ''
  }
}
