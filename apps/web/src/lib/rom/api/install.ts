// Sequential `await` in a loop is this module's normal shape, not an oversight:
// it is ORDERED filesystem work — a step reads, moves or overwrites what the
// step before it wrote, and the rule's advice (`Promise.all`) would race those
// against each other. Scoped off for the file rather than repeated at each
// loop; a loop here that genuinely CAN run in parallel should use `Promise.all`
// on its own merits.
/* oxlint-disable no-await-in-loop */
import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { z } from 'zod'

import { withBusyCursor } from '../../busy-cursor.ts'
import * as storage from '../storage'
import { dataPath } from '../storage'
import { dedupReportSchema, installReportSchema } from './native-types.ts'
import { detectDazInstalls } from './daz-install'
import { dazFlavorFromMajor, newestReleasePerFlavor } from '#/lib/daz-plugins.ts'
import { normalizePathLower } from '#/lib/path.ts'

import type { DazFlavor, PluginRelease } from '#/lib/daz-plugins.ts'
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
  const saved = await storage.saveSettings(settings, baseline)
  // Keep DAZ3D_LIB in the configured houdini.env(s) pointing at the saved Daz
  // library folder — best effort (Refresh assets re-ensures and reports); the
  // MERGED result is what's on disk, so wire from that, not the input.
  try {
    await storage.ensureHoudiniEnvDazLib(saved)
  } catch {
    // never fail a settings save over the env wiring
  }
  return saved
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

// --- Daz plugins: every release, into every installation ---------------------
// Both Daz plugins the studio installs — the DTH Exporter (mrpdean's, from the
// user's release folders) and the bundled Runner — ship ONE BINARY PER STUDIO
// GENERATION, and a machine can have several generations installed at once. So
// the install is a MATCH, not a pair of paths: every release, into every
// installation of the generation it was built for. The matching rules are pure
// (`lib/daz-plugins.ts`); this is the I/O around them.

/** One Daz installation as an install TARGET, with both plugins' state in it. */
export interface DazPluginTarget {
  /** DIM's key, or '' for the manually configured install folder. */
  key: string
  /** "DAZ Studio 6", or "Daz Studio install folder" for the manual one. */
  name: string
  path: string
  /** Read from the install's own DAZStudio exe; DIM's major version is the
   *  fallback when the exe can't be read. null = neither could answer, and the
   *  panel says so rather than guessing a binary into it. */
  flavor: DazFlavor | null
  /** The exporter DLL version currently in its `plugins` folder ('' = none). */
  exporterInstalled: string
  /** The release that WOULD be installed here (null = none for this
   *  generation among the configured folders). */
  exporterSource: PluginRelease | null
  /** The bundled Runner's state against this install. */
  runner: storage.RunnerStatus
}

/** What Settings → Daz Studio plugins shows: what we have, where it goes. */
export interface DazPluginState {
  /** Every exporter build found under the configured folders. */
  sources: Array<PluginRelease>
  /** Configured folders holding no exporter DLL at all — a typo or a moved
   *  release, named instead of silently ignored. */
  emptyFolders: Array<string>
  /** The bundled Runner release tag ('' in a dev checkout with no staged DLLs). */
  runnerBundledVersion: string
  targets: Array<DazPluginTarget>
  /** No Daz installation could be resolved at all — DIM lists none and no
   *  install folder is configured. */
  noTargets: boolean
}

/** Whether this target's exporter is already the build we would install. An
 *  unknown version on either side is never "current": it cannot be compared, so
 *  installing (a copy) is the honest answer. */
function exporterIsCurrent(target: DazPluginTarget): boolean {
  const source = target.exporterSource
  if (!source || !source.version || !target.exporterInstalled) return false
  return source.version === target.exporterInstalled
}

/** Whether the bundled Runner still has to be written into this target. */
function runnerIsPending(status: storage.RunnerStatus): boolean {
  if (status.error !== null) return false
  if (status.installed === 'none') return true
  // 'differs' with the INSTALLED one newer is a runner ahead of this app —
  // installing would downgrade it (the same call `runnerGate` makes).
  return status.installed === 'differs' && !storage.runnerInstalledNewer(status)
}

/** How many plugin copies "Install / update all" would actually make. */
export function pendingPluginInstalls(state: DazPluginState): number {
  let pending = 0
  for (const target of state.targets) {
    if (target.exporterSource && !exporterIsCurrent(target)) pending++
    if (runnerIsPending(target.runner)) pending++
  }
  return pending
}

/**
 * Every Daz installation the studio may install plugins into.
 *
 * DIM's list is the source (64-bit and actually on disk — a 32-bit entry takes
 * none of these 64-bit DLLs, and an install DIM still lists after removal has no
 * `plugins` folder to write to). The configured install folder joins it when DIM
 * doesn't already cover it, which is what keeps a DIM-less machine — a portable
 * install, a hand-set path — working exactly as before.
 */
async function pluginTargets(): Promise<Array<{ key: string; name: string; path: string; major: number }>> {
  const settings = await storage.getSettings()
  const scan = await detectDazInstalls()
  const targets = scan.apps
    .filter((app) => app.exists && app.bits === 64)
    .map((app) => ({ key: app.key, name: app.name, path: app.path, major: app.version }))
  const configured = settings.dazInstallFolder.trim()
  if (configured && !targets.some((t) => normalizePathLower(t.path) === normalizePathLower(configured))) {
    targets.push({ key: '', name: 'Daz Studio install folder', path: configured, major: 0 })
  }
  return targets
}

/**
 * The whole panel's state in one read: which exporter builds the configured
 * folders hold, and what each detected Daz installation currently has.
 *
 * `folders` are the ones to scan — the Settings panel passes what is IN ITS
 * FIELDS, which is not the same thing as what is on disk: a folder just added
 * is unsaved, and a readout built from settings.json would show the user a scan
 * of the list they had a minute ago (measured: two fields on screen, one of
 * them scanned, the other reported as "no build for this generation"). Omit
 * them and the saved list is used, which is what the install itself wants —
 * it runs after the save.
 */
export async function fetchDazPluginState({ data }: { data?: unknown } = {}): Promise<DazPluginState> {
  const { folders } = z
    .object({ folders: z.array(z.string()).optional() })
    .parse(data ?? {})
  const settings = await storage.getSettings()
  const scan = await storage.scanExporterSources(
    folders ?? storage.exporterSourceFolders(settings),
  )
  const newest = newestReleasePerFlavor(scan.found)
  const found = await pluginTargets()
  const targets = await Promise.all(
    found.map(async (target) => {
      const flavor = (await storage.detectDazFlavor(target.path)) ?? dazFlavorFromMajor(target.major)
      return {
        key: target.key,
        name: target.name,
        path: target.path,
        flavor,
        exporterInstalled: await storage.installedExporterVersion(target.path),
        exporterSource: flavor ? newest[flavor] : null,
        // The SAME generation the exporter was matched on, DIM fallback and all
        // — otherwise one install can take an Exporter build while reporting the
        // Runner as undetectable.
        runner: await storage.runnerStatus(target.path, flavor),
      }
    }),
  )
  return {
    sources: scan.found,
    emptyFolders: scan.emptyFolders,
    runnerBundledVersion: targets[0]?.runner.bundledVersion ?? (await storage.bundledRunnerTag()),
    targets,
    noTargets: targets.length === 0,
  }
}

/**
 * Phrases pinned on the Rust side (`report.rs` hint constants, `elevate.rs`
 * ELEVATION_CANCELLED) that this layer reads a failure by.
 *
 * A failed copy's own detail line is what tells the panel WHICH remedy to offer,
 * and the two it can hit are not interchangeable: administrator rights fix a
 * permission refusal and do nothing at all for a DLL Daz Studio has loaded. An
 * elevation button offered for a locked DLL would prompt, fail identically, and
 * teach the user the button is a lie — so it is offered only for the failure it
 * actually fixes. Rust tests pin each phrase; reword both sides together.
 */
export const INSTALL_PHRASES = {
  needsAdmin: 'needs administrator rights',
  dazLocked: 'close every Daz Studio window',
  elevationCancelled: 'Cancelled at the Windows permission prompt',
} as const

/**
 * Install BOTH plugins into every detected Daz installation — the panel's one
 * button.
 *
 * Only what is actually pending is copied (an up-to-date plugin is left alone,
 * and a Runner NEWER than the bundled one is never downgraded), unless `force`
 * repairs everything. Every copy is its own step in the merged report, labelled
 * with the installation it went into, so a machine where one Daz needs
 * elevation and another doesn't reads as exactly that — one failed step beside
 * three good ones — instead of one opaque failure.
 *
 * Per-target failures do NOT abort the rest: the report carries them. It throws
 * only when there is nothing to do at all, which is a setup problem the user has
 * to fix before any of this means anything.
 */
export async function installDazPlugins({ data }: { data: unknown }): Promise<InstallReport> {
  const { dryRun, force, folders, elevated } = z
    .object({
      dryRun: z.boolean().optional(),
      force: z.boolean().optional(),
      /** The release folders to install FROM. The panel passes what is in its
       *  fields, the same list it scanned to draw the table — otherwise a DRY
       *  RUN (which deliberately saves nothing) would plan from settings.json
       *  and report a different set of copies than the table above it shows. */
      folders: z.array(z.string()).optional(),
      /** Do the copies in a one-shot ELEVATED helper process (one UAC prompt for
       *  the whole batch) instead of in this one — see `elevate.rs`. The plan is
       *  computed identically either way, so a retry after a permission failure
       *  picks up exactly the copies that are still pending. */
      elevated: z.boolean().optional(),
    })
    .parse(data ?? {})
  const state = await fetchDazPluginState({ data: folders ? { folders } : {} })
  if (state.noTargets) {
    throw new Error(
      'No Daz Studio installation to install into — activate one above, or set the Daz Studio install folder.',
    )
  }
  // Both bundled Runner folders once, not once per target: they are the same
  // two paths for every installation on the machine.
  const runnerFolders: Record<DazFlavor, string> = {
    ds4: await storage.bundledRunnerFolder('ds4'),
    ds6: await storage.bundledRunnerFolder('ds6'),
  }
  const jobs: Array<{ label: string; folder: string; target: string }> = []
  for (const target of state.targets) {
    if (target.exporterSource && (force || !exporterIsCurrent(target))) {
      jobs.push({
        label: `Exporter plugin → ${target.name}`,
        folder: target.exporterSource.folder,
        target: target.path,
      })
    }
    // A generation this build carries no Runner for is skipped, not failed —
    // the other installs still get theirs (dev checkout without `fetch:runner`).
    if (target.flavor && runnerFolders[target.flavor] && (force || runnerIsPending(target.runner))) {
      jobs.push({
        label: `Runner plugin → ${target.name}`,
        folder: runnerFolders[target.flavor],
        target: target.path,
      })
    }
  }
  if (jobs.length === 0) {
    throw new Error(
      state.sources.length === 0
        ? 'No DTH Exporter Plugin release found — add the folder holding its DLLs above.'
        : 'Everything is already up to date in every detected Daz Studio.',
    )
  }
  // With administrator rights: ONE call carrying every job, because one UAC
  // prompt per DLL would be intolerable. A dry run never comes here — it writes
  // nothing, so it can never lack the rights to, and prompting to preview would
  // be absurd.
  if (elevated && !dryRun) {
    return installReportSchema.parse(
      await invoke('install_dth_plugins_elevated', {
        request: {
          jobs: jobs.map((job) => ({
            label: job.label,
            exporterFolder: job.folder,
            dazInstallFolder: job.target,
          })),
        },
      }),
    )
  }
  const steps: InstallReport['steps'] = []
  let totalFiles = 0
  for (const job of jobs) {
    const report = installReportSchema.parse(
      await invoke('install_dth_plugin', {
        request: {
          exporterFolder: job.folder,
          dazInstallFolder: job.target,
          dryRun: dryRun ?? false,
          label: job.label,
        },
      }),
    )
    steps.push(...report.steps)
    totalFiles += report.totalFiles
  }
  return { dryRun: dryRun ?? false, steps, totalFiles }
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

/** The bundled DTH Character Studio Runner plugin's state vs the configured Daz
 *  install — drives the Settings panel (see `storage.runnerStatus`: "up to
 *  date" is a byte-compare with the bundled DLL, the installed version is read
 *  from the DLL's VERSIONINFO resource). */
export function fetchRunnerStatus(dazInstallFolder: string): Promise<storage.RunnerStatus> {
  return storage.runnerStatus(dazInstallFolder)
}

/** The Runner gate for the DTH Export panel, resolved from the saved settings:
 *  exports run through the Runner plugin in Daz Studio, so a missing or
 *  outdated install blocks the handoff — the panel routes the user to Settings
 *  instead of writing a job file the runner would mishandle (or never pick up). */
export async function fetchExportRunnerGate(): Promise<storage.RunnerGate> {
  // The install the batch will actually START, which is the "Export only" one
  // when a card carries that flag. Checking the ACTIVE install instead would
  // report "ready" off a Runner sitting in a Studio the export never opens —
  // the export would then launch the other one, find no Runner to claim the job
  // file, and wait for a batch that never begins.
  const folder = storage.exportInstallFolder(await storage.getSettings())
  if (!folder)
    return { blocked: true, reason: 'no-install-folder', bundledVersion: '', installedVersion: '' }
  return storage.runnerGate(await storage.runnerStatus(folder))
}

/**
 * Install the bundled **DTH Character Studio Runner** plugin DLL into
 * `<Daz install>/plugins` — the same admin-sensitive copy as the Exporter
 * plugin (native `install_dth_plugin`), except the source ships INSIDE the app
 * (a Tauri resource staged at build time by scripts/fetch-runner.mjs) and the
 * right DLL (DS4 vs DS6) is picked by reading the install folder's
 * DAZStudio exe version — no folder to select.
 */
export async function installDthRunner({ data }: { data: unknown }): Promise<InstallReport> {
  const { dryRun } = z.object({ dryRun: z.boolean().optional() }).parse(data ?? {})
  const plan = await storage.resolveRunnerInstall()
  if (plan.errors.length) throw new Error(plan.errors.join('\n'))
  return installReportSchema.parse(await invoke('install_dth_plugin', {
    request: {
      exporterFolder: plan.runnerFolder,
      dazInstallFolder: plan.dazInstallFolder,
      dryRun: dryRun ?? false,
      label: 'Runner plugin',
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
export async function setAcceptedConflicts({ data }: { data: unknown }): Promise<Array<string>> {
  const { rels, clear } = z
    .object({ rels: z.array(z.string()), clear: z.boolean().optional() })
    .parse(data)
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
