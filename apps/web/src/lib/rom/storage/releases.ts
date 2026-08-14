import { resolveResource } from '@tauri-apps/api/path'
import { exists, readDir, readFile } from '@tauri-apps/plugin-fs'

import { basename, isDir, join } from './fs'
import { exporterSourceFolders, exportInstallFolder, getSettings } from './settings'
import {
  dazFlavorFromExeVersion,
  exporterDllFlavor,
  flavorFromPathHint,
  newestReleasePerFlavor,
} from '#/lib/daz-plugins.ts'

import type { DazFlavor, PluginRelease } from '#/lib/daz-plugins.ts'

// The generation split (`DazFlavor`, `dazFlavorFromExeVersion`) is pure and
// lives with the rest of the plugin-matching rules in `lib/daz-plugins.ts`;
// re-exported here because this module has always been where callers looked
// for it.
export type { DazFlavor, PluginRelease }
export { dazFlavorFromExeVersion }

// DTH release + Exporter Plugin scanning: what the Settings pickers list, which
// release/plugin is active, and the resolved install plans the Tools page runs.

/** Comparable version from a name: "Release 2.4.3" → [2,4,3] (last numeric run). */
function parseVersion(name: string): Array<number> {
  const runs = name.match(/\d+(?:\.\d+)*/g)
  if (!runs) return []
  return runs[runs.length - 1].split('.').map((n) => parseInt(n, 10))
}

function compareVersions(a: Array<number>, b: Array<number>): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** Dotted label for a parsed version: [2,4,3] → "2.4.3" ('' when none parsed). */
function versionLabel(version: Array<number>): string {
  return version.join('.')
}

/** A DTH release root is marked by a `copyright.txt` file at its top level. */
async function isReleaseFolder(folder: string): Promise<boolean> {
  return exists(join(folder, 'copyright.txt'))
}

/** Poses folder inside an extracted release root. */
function posesFolderOf(releaseRoot: string): string {
  return join(releaseRoot, 'Daz Studio Content', 'DazToHue', 'Poses')
}

export interface DthReleaseInfo {
  /** Dotted version label parsed from the name, e.g. "2.4.3". */
  version: string
  /** The folder or zip name on disk, e.g. "Release 2.4.3" or "Release 2.4.3.zip". */
  name: string
  kind: 'folder' | 'zip'
}

/**
 * Inspect a configured DTH folder. Two shapes are supported:
 *  - **single**: the folder itself is a release (has `copyright.txt`) — its
 *    version is parsed from the folder name;
 *  - **multi**: a folder of versioned releases, each a release folder (with
 *    `copyright.txt`) or a `.zip`. Returned newest-first and de-duplicated by
 *    version (an extracted folder wins over a same-version zip).
 */
export async function listDthReleases(folder: string): Promise<{
  mode: 'single' | 'multi' | 'none'
  version: string
  releases: Array<DthReleaseInfo>
  error: string | null
}> {
  if (!folder) return { mode: 'none', version: '', releases: [], error: null }
  if (!(await isDir(folder))) {
    return { mode: 'none', version: '', releases: [], error: `Folder not reachable: ${folder}` }
  }
  if (await isReleaseFolder(folder)) {
    return { mode: 'single', version: versionLabel(parseVersion(basename(folder))), releases: [], error: null }
  }
  const children = await readDir(folder)
  const found: Array<DthReleaseInfo & { v: Array<number> }> = []
  for (const child of children) {
    const v = parseVersion(child.name)
    if (v.length === 0) continue // releases are version-named
    if (child.isDirectory) {
      if (await isReleaseFolder(join(folder, child.name))) {
        found.push({ version: versionLabel(v), name: child.name, kind: 'folder', v })
      }
    } else if (/\.zip$/i.test(child.name)) {
      found.push({ version: versionLabel(v), name: child.name, kind: 'zip', v })
    }
  }
  if (found.length === 0) {
    return {
      mode: 'none',
      version: '',
      releases: [],
      error:
        'No DTH release here. Pick a release folder (containing copyright.txt) or a folder of versioned releases (folders or .zip).',
    }
  }
  // De-dupe by version, preferring an extracted folder over a same-version zip.
  const byVersion = new Map<string, DthReleaseInfo & { v: Array<number> }>()
  for (const r of found) {
    const existing = byVersion.get(r.version)
    if (!existing || (existing.kind === 'zip' && r.kind === 'folder')) byVersion.set(r.version, r)
  }
  const releases = [...byVersion.values()]
    .sort((a, b) => compareVersions(b.v, a.v))
    .map(({ v: _v, ...r }) => r)
  return { mode: 'multi', version: '', releases, error: null }
}

// --- DTH Exporter Plugin --------------------------------------------------
// The Exporter Plugin ships as DLLs (not a content pack), so a "release" is a
// folder holding the exporter DLL (`dth_tools.dll` is an optional companion).
// Folder names carry no version, so the version is read from the DLL itself —
// and WHICH Studio generation a DLL is for is read from its name (the `dsp_`
// prefix DS6 requires), which is what lets one scan serve every install on the
// machine. The rules are pure, in `lib/daz-plugins.ts`.

/** Whether a filename is an exporter DLL of either generation. */
function isExporterDll(name: string): boolean {
  return exporterDllFlavor(name) !== null
}

/** Absolute path to the exporter DLL in `folder`, or null when there isn't one. */
async function findExporterDll(folder: string): Promise<string | null> {
  let entries: Awaited<ReturnType<typeof readDir>>
  try {
    entries = await readDir(folder)
  } catch {
    return null
  }
  const match = entries.find((entry) => entry.isFile && isExporterDll(entry.name))
  return match ? join(folder, match.name) : null
}

/**
 * A Windows DLL/EXE FileVersion from its `VS_FIXEDFILEINFO` resource, found by
 * scanning the bytes for the `0xFEEF04BD` signature (no full PE parse needed).
 * The two 32-bit words after the signature+struct-version encode the version as
 * major.minor.build.revision. Returns a dotted string, or '' when absent.
 */
export function fileVersionFromBytes(bytes: Uint8Array): string {
  for (let i = 0; i + 16 <= bytes.length; i++) {
    // 0xFEEF04BD, little-endian on disk → bytes BD 04 EF FE.
    if (bytes[i] === 0xbd && bytes[i + 1] === 0x04 && bytes[i + 2] === 0xef && bytes[i + 3] === 0xfe) {
      const view = new DataView(bytes.buffer, bytes.byteOffset + i + 8, 8)
      const ms = view.getUint32(0, true)
      const ls = view.getUint32(4, true)
      return [(ms >>> 16) & 0xffff, ms & 0xffff, (ls >>> 16) & 0xffff, ls & 0xffff].join('.')
    }
  }
  return ''
}

async function readDllFileVersion(path: string): Promise<string> {
  try {
    return fileVersionFromBytes(await readFile(path))
  } catch {
    return ''
  }
}

/** Shown when a release is only available as a zip — Daz can't load from one. */
export const ZIP_RELEASE_WARNING = 'Extract the release zip first and select folders only.'

/**
 * THE single release-selection cascade behind {@link resolveActiveRelease} and
 * {@link resolveActiveReleaseRoot} (they used to duplicate it): a single-release
 * folder resolves to itself; a multi-release folder resolves to the chosen
 * version, falling back to the newest extracted folder; a zip-only release
 * resolves to the extract-first warning (Daz can't load from an archive).
 */
/** What the release-selection cascade resolved to. */
export interface ActiveReleaseEntry {
  releaseRoot: string
  version: string
  name: string
  error: string | null
  /** Set when a PINNED version (`currentDthVersion`) no longer exists on disk
   *  and the newest available release was used instead — holds the missing
   *  version so Settings/generation can surface the silent swap ("pinned
   *  2.4.0 is gone; using 2.4.3") instead of quietly generating against a
   *  different release than the one the user chose. */
  pinnedMissing?: string
}

async function resolveActiveReleaseEntry(
  folder: string,
  currentVersion: string,
): Promise<ActiveReleaseEntry> {
  if (!folder) {
    return { releaseRoot: '', version: '', name: '', error: 'No DTH release folder configured' }
  }
  if (!(await isDir(folder))) {
    return { releaseRoot: '', version: '', name: '', error: `Folder not reachable: ${folder}` }
  }
  if (await isReleaseFolder(folder)) {
    return {
      releaseRoot: folder,
      version: versionLabel(parseVersion(basename(folder))),
      name: basename(folder),
      error: null,
    }
  }
  const list = await listDthReleases(folder)
  if (list.mode !== 'multi' || list.releases.length === 0) {
    return {
      releaseRoot: '',
      version: '',
      name: '',
      error: list.error ?? `No DTH release found in: ${folder}`,
    }
  }
  const pinned = currentVersion
    ? list.releases.find((r) => r.version === currentVersion)
    : undefined
  const chosen = pinned ?? list.releases.find((r) => r.kind === 'folder') ?? list.releases[0]
  // A configured version that no longer resolves is a broken pin, not a free
  // choice — fall back to the newest, but SAY so (see ActiveReleaseEntry).
  const pinnedMissing = currentVersion && !pinned ? { pinnedMissing: currentVersion } : {}
  if (chosen.kind === 'zip') {
    return {
      releaseRoot: '',
      version: chosen.version,
      name: chosen.name,
      error: ZIP_RELEASE_WARNING,
      ...pinnedMissing,
    }
  }
  return {
    releaseRoot: join(folder, chosen.name),
    version: chosen.version,
    name: chosen.name,
    error: null,
    ...pinnedMissing,
  }
}

/**
 * Resolve the release to scan from the configured folder + the selected
 * version — the {@link resolveActiveReleaseEntry} cascade, mapped to the Poses
 * subfolder the pose scan walks.
 */
export async function resolveActiveRelease(
  folder: string,
  currentVersion: string,
): Promise<{
  posesFolder: string
  version: string
  releaseName: string
  error: string | null
  /** The pinned version vanished from disk; the newest release was used instead
   *  (see {@link ActiveReleaseEntry.pinnedMissing}). */
  pinnedMissing?: string
}> {
  const entry = await resolveActiveReleaseEntry(folder, currentVersion)
  return {
    posesFolder: entry.releaseRoot ? posesFolderOf(entry.releaseRoot) : '',
    version: entry.version,
    releaseName: entry.name,
    error: entry.error,
    ...(entry.pinnedMissing !== undefined ? { pinnedMissing: entry.pinnedMissing } : {}),
  }
}

// --- DTH install plan -----------------------------------------------------
// The "Install" button copies a DTH release + the Exporter Plugin into the local
// Daz Studio + Houdini installs (a port of the dth-cli install commands). The
// heavy recursive copy runs in Rust (see apps/desktop); these helpers only
// resolve WHICH release/plugin and WHERE — fast, and reusing the pickers' logic.

/**
 * Resolve the active DTH release *root* (the folder holding `Daz Studio Content`
 * and `Houdini Assets`) from the configured folder + selected version — the
 * install counterpart to {@link resolveActiveRelease}; both are thin entry
 * points over the same {@link resolveActiveReleaseEntry} cascade.
 */
export async function resolveActiveReleaseRoot(
  folder: string,
  currentVersion: string,
): Promise<ActiveReleaseEntry> {
  return resolveActiveReleaseEntry(folder, currentVersion)
}

/** Resolved paths for the DTH *release* install (Daz content + Houdini assets). */
export interface ReleaseInstall {
  releaseRoot: string
  releaseName: string
  releaseVersion: string
  /** "My DAZ 3D Library" — required destination for the Daz content. */
  dazLibFolder: string
  /** Houdini documents folder — optional destination for the Houdini assets. */
  houdiniDocsFolder: string
  /** Blocking problems; non-empty means this install can't run yet. */
  errors: Array<string>
}

/**
 * Resolve the DTH *release* install from saved settings: the active release root
 * plus the destination the chosen `target` half needs — "My DAZ 3D Library" for
 * the Daz content, the Houdini documents folder for the Houdini assets ('all'
 * requires the library and treats Houdini as optional, as before).
 */
export async function resolveReleaseInstall(
  target: 'daz' | 'houdini' | 'all' = 'all',
  /** Install the Houdini half into THIS docs folder instead of the primary one
   *  (an "additional Houdini folder" from Settings - older/parallel versions). */
  houdiniDocsOverride?: string,
): Promise<ReleaseInstall> {
  const s = await getSettings()
  const errors: Array<string> = []
  const release = await resolveActiveReleaseRoot(s.dthPosesFolder, s.currentDthVersion)
  if (release.error || !release.releaseRoot) {
    errors.push(release.error ?? 'No DTH release resolved — set the DTH release folder.')
  }
  const houdiniDocs = houdiniDocsOverride?.trim() || s.houdiniDocsFolder
  if (target !== 'houdini' && !s.dazLibraryFolder) errors.push('Set “My DAZ 3D Library”.')
  if (target === 'houdini' && !houdiniDocs) errors.push('Set the Houdini documents folder.')
  return {
    releaseRoot: release.releaseRoot,
    releaseName: release.name,
    releaseVersion: release.version,
    dazLibFolder: s.dazLibraryFolder,
    houdiniDocsFolder: houdiniDocs,
    errors,
  }
}

/** Resolved paths for the Exporter *plugin* install (DLLs → Daz install). */
export interface PluginInstall {
  exporterFolder: string
  exporterVersion: string
  /** Daz Studio install root — required; DLLs go to its `plugins` subfolder. */
  dazInstallFolder: string
  errors: Array<string>
}

/**
 * Resolve the Exporter *plugin* install from saved settings: the active exporter
 * folder + the Daz Studio install folder (required).
 *
 * The SINGLE-target resolver, kept for the manual setup — a machine DIM does not
 * describe, where the studio knows exactly one Daz install folder and nothing to
 * enumerate. The normal path is {@link planPluginInstalls}, which pairs every
 * release with every detected installation.
 */
export async function resolvePluginInstall(): Promise<PluginInstall> {
  const s = await getSettings()
  const errors: Array<string> = []
  const flavor = s.dazInstallFolder ? await detectDazFlavor(s.dazInstallFolder) : null
  const releases = await scanExporterSources(exporterSourceFolders(s))
  const release = flavor ? newestReleasePerFlavor(releases.found)[flavor] : null
  if (!release) {
    errors.push(
      releases.found.length === 0
        ? 'No DTH Exporter Plugin resolved — add an Exporter Plugin release folder.'
        : `No DTH Exporter Plugin build for this Daz Studio (${flavor ?? 'unknown generation'}) among the release folders.`,
    )
  }
  if (!s.dazInstallFolder) errors.push('Set the Daz Studio install folder.')
  return {
    exporterFolder: release?.folder ?? '',
    exporterVersion: release?.version ?? '',
    dazInstallFolder: s.dazInstallFolder,
    errors,
  }
}

/** What a scan of the configured Exporter release folders found. */
export interface ExporterSourceScan {
  /** Every exporter DLL found, in the order the folders were configured. */
  found: Array<PluginRelease>
  /** Configured folders that hold no exporter DLL at all (named so a typo or a
   *  moved release is visible instead of silently reducing the plan). */
  emptyFolders: Array<string>
}

/**
 * Every DTH Exporter build under the configured release folders.
 *
 * Each folder is read as itself AND one level down, because that is how the
 * plugin is actually published: `ExporterPlugin/Daz Studio 4/dth_exporter.dll`
 * beside `ExporterPlugin/Daz Studio 6/dsp_dth_exporter.dll`. So pointing the
 * studio at ONE folder can yield a build for every Studio on the machine — and
 * pointing it at several (a release per Studio, kept apart) works the same way.
 *
 * One level, not a recursive walk: a release tree is shallow by construction,
 * and a deep scan over a network share is a cost the user never asked for.
 */
export async function scanExporterSources(
  folders: ReadonlyArray<string>,
): Promise<ExporterSourceScan> {
  const unique: Array<string> = []
  const seen = new Set<string>()
  for (const raw of folders) {
    const folder = raw.trim()
    if (!folder || seen.has(folder.toLowerCase())) continue
    seen.add(folder.toLowerCase())
    unique.push(folder)
  }
  // Per folder concurrently, but flattened in the CONFIGURED order: that order
  // is what decides ties between two copies of the same version.
  const perFolder = await Promise.all(
    unique.map(async (folder) => {
      const own = await releasesInFolder(folder)
      const nested = await Promise.all((await subFolders(folder)).map(releasesInFolder))
      return { folder, releases: [...own, ...nested.flat()] }
    }),
  )
  return {
    found: perFolder.flatMap((entry) => entry.releases),
    emptyFolders: perFolder.filter((entry) => entry.releases.length === 0).map((e) => e.folder),
  }
}

/** The exporter DLLs directly inside one folder, typed by generation. */
async function releasesInFolder(folder: string): Promise<Array<PluginRelease>> {
  let entries: Awaited<ReturnType<typeof readDir>>
  try {
    entries = await readDir(folder)
  } catch {
    return []
  }
  // The DLL name is the contract (DS6 loads `dsp_*` only), so it decides which
  // generation a build is for; the folder's own claim rides along as a
  // cross-check the panel can flag.
  const pathHint = flavorFromPathHint(folder)
  return Promise.all(
    entries
      .filter((entry) => entry.isFile && exporterDllFlavor(entry.name) !== null)
      .map(async (entry) => ({
        folder,
        fileName: entry.name,
        flavor: exporterDllFlavor(entry.name)!,
        version: await readDllFileVersion(join(folder, entry.name)),
        pathHint,
      })),
  )
}

/** Immediate subfolder paths, or none when the folder can't be read. */
async function subFolders(folder: string): Promise<Array<string>> {
  try {
    return (await readDir(folder))
      .filter((entry) => entry.isDirectory)
      .map((entry) => join(folder, entry.name))
  } catch {
    return []
  }
}

/**
 * Version of the exporter DLL already installed in `<dazInstallFolder>/plugins`,
 * or '' when none is there / the folder isn't set. Lets the UI tell whether the
 * plugin is missing, out of date, or already current before installing.
 */
export async function installedExporterVersion(dazInstallFolder: string): Promise<string> {
  if (!dazInstallFolder) return ''
  const dll = await findExporterDll(join(dazInstallFolder, 'plugins'))
  return dll ? readDllFileVersion(dll) : ''
}

// --- The bundled DTH Character Studio Runner plugin --------------------------
// The studio's OWN Daz plugin (polynaut/dth-character-studio-runner): it polls
// for the DTH Export job file and runs the batches unattended. Its DLLs ship
// INSIDE the app as Tauri resources, staged at build time by
// scripts/fetch-runner.mjs under resources/dth-runner/{version.txt,ds4/,ds6/}.
// "Installed"/"up to date" comes from BYTE-comparing the installed DLL against
// the bundled one (exact, and works for every runner version); the INSTALLED
// display version is read from the DLL's VERSIONINFO resource (the runner
// carries one since v1.0.3 — '' for older DLLs), the bundled one is the staged
// release tag (version.txt).

/** The per-generation DLL names — fixed by the runner's install contract
 *  (DS6 only loads plugins named `dsp_*.dll`; DS4 uses the plain name — the
 *  same rule that identifies an EXPORTER release, see `lib/daz-plugins.ts`). */
export const RUNNER_DLL: Record<DazFlavor, string> = {
  ds4: 'dthcharacterstudiorunner.dll',
  ds6: 'dsp_dthcharacterstudiorunner.dll',
}

/** Detect the install folder's Daz generation by reading the version resource
 *  of its `DAZStudio*.exe` (the exe, unlike the runner DLL, carries one). */
export async function detectDazFlavor(dazInstallFolder: string): Promise<DazFlavor | null> {
  let entries: Awaited<ReturnType<typeof readDir>>
  try {
    entries = await readDir(dazInstallFolder)
  } catch {
    return null
  }
  for (const entry of entries) {
    if (!entry.isFile || !/^dazstudio.*\.exe$/i.test(entry.name)) continue
    const flavor = dazFlavorFromExeVersion(
      await readDllFileVersion(join(dazInstallFolder, entry.name)),
    )
    if (flavor) return flavor
  }
  return null
}

/** Absolute path of the bundled runner resources for a flavor (the folder
 *  holding that generation's one DLL). */
async function bundledRunnerDir(flavor: DazFlavor): Promise<string> {
  return resolveResource(`resources/dth-runner/${flavor}`)
}

/** The bundled runner folder for a flavor, but only when its DLL is really
 *  there — '' otherwise, so a caller installing into several Daz installs skips
 *  a generation this build carries no binary for instead of failing all of them
 *  (a dev checkout before `pnpm fetch:runner`). */
export async function bundledRunnerFolder(flavor: DazFlavor): Promise<string> {
  const dir = await bundledRunnerDir(flavor)
  return (await exists(join(dir, RUNNER_DLL[flavor]))) ? dir : ''
}

/** The staged runner release tag, for a panel with no install to read it off. */
export async function bundledRunnerTag(): Promise<string> {
  return bundledRunnerVersion()
}

/** The staged runner release tag ('' when this build has none — a dev checkout
 *  before `pnpm fetch:runner`). */
async function bundledRunnerVersion(): Promise<string> {
  try {
    const bytes = await readFile(await resolveResource('resources/dth-runner/version.txt'))
    return new TextDecoder().decode(bytes).trim()
  } catch {
    return ''
  }
}

/** The runner DLL's 4-part FileVersion trimmed to the release-tag format —
 *  "1.0.3.4" → "1.0.3" (the 4th component is an internal build counter). */
function runnerDisplayVersion(fileVersion: string): string {
  return fileVersion.split('.').slice(0, 3).join('.')
}

export interface RunnerStatus {
  /** The runner release shipped inside this build ('' when absent). */
  bundledVersion: string
  /** The configured install's Daz generation (null = not detectable / unset). */
  flavor: DazFlavor | null
  /** none = no runner DLL in the plugins folder; current = byte-identical to
   *  the bundled DLL; differs = present but different bytes (older or newer). */
  installed: 'none' | 'current' | 'differs'
  /** The installed DLL's version, read from its VERSIONINFO resource and
   *  trimmed to the tag format ('' when none is installed or the DLL predates
   *  the version resource, i.e. runner < 1.0.3). */
  installedVersion: string
  error: string | null
}

/**
 * The bundled-vs-installed runner state driving the Settings panel.
 *
 * `knownFlavor` is the caller's already-resolved generation, and it exists so the
 * two plugins never disagree about one installation: the plugin panel falls back
 * to DIM's major version when an install's `DAZStudio*.exe` can't be read, and
 * without passing that down the Exporter would be matched into an install while
 * the Runner reported "could not detect the Daz Studio version" for the very
 * same folder. Omitted, this detects the generation itself, exactly as before.
 */
export async function runnerStatus(
  dazInstallFolder: string,
  knownFlavor?: DazFlavor | null,
): Promise<RunnerStatus> {
  const bundledVersion = await bundledRunnerVersion()
  if (!dazInstallFolder)
    return { bundledVersion, flavor: null, installed: 'none', installedVersion: '', error: null }
  const flavor = (await detectDazFlavor(dazInstallFolder)) ?? knownFlavor ?? null
  if (!flavor) {
    return {
      bundledVersion,
      flavor: null,
      installed: 'none',
      installedVersion: '',
      error:
        'Could not detect the Daz Studio version — the install folder has no readable DAZStudio*.exe.',
    }
  }
  let bundled: Uint8Array
  try {
    bundled = await readFile(join(await bundledRunnerDir(flavor), RUNNER_DLL[flavor]))
  } catch {
    return {
      bundledVersion,
      flavor,
      installed: 'none',
      installedVersion: '',
      error:
        'This build carries no bundled Runner plugin — reinstall the app (dev checkout: run `pnpm fetch:runner`).',
    }
  }
  let installedBytes: Uint8Array | null = null
  try {
    installedBytes = await readFile(join(dazInstallFolder, 'plugins', RUNNER_DLL[flavor]))
  } catch {
    installedBytes = null
  }
  const installed =
    installedBytes === null ? 'none' : bytesEqual(installedBytes, bundled) ? 'current' : 'differs'
  const installedVersion = installedBytes
    ? runnerDisplayVersion(fileVersionFromBytes(installedBytes))
    : ''
  return { bundledVersion, flavor, installed, installedVersion, error: null }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** True when the installed DLL identifies as NEWER than the bundled release —
 *  a runner build ahead of this app; updating would downgrade it, and exporting
 *  through it is fine (the job-file contract is kept backward-compatible). */
export function runnerInstalledNewer(status: RunnerStatus): boolean {
  if (status.installed !== 'differs' || !status.installedVersion || !status.bundledVersion)
    return false
  return compareVersions(parseVersion(status.installedVersion), parseVersion(status.bundledVersion)) > 0
}

/** Whether (and why) a DTH Export handoff is blocked on the Runner plugin's
 *  state — the export panel's gate. A missing runner would take the job file
 *  nowhere; an outdated one would run it with stale behaviour.
 *  `no-install-folder` is produced by the api layer (which resolves settings),
 *  never by {@link runnerGate} itself. */
export type RunnerGate =
  | { blocked: false }
  | {
      blocked: true
      reason: 'no-install-folder' | 'not-installed' | 'update-pending'
      bundledVersion: string
      installedVersion: string
    }

export function runnerGate(status: RunnerStatus): RunnerGate {
  // An unreadable state (undetectable flavor, no bundled DLL, …) must not brick
  // exporting — the Settings panel surfaces the error; the gate only acts on
  // definite verdicts.
  if (status.error !== null) return { blocked: false }
  const versions = {
    bundledVersion: status.bundledVersion,
    installedVersion: status.installedVersion,
  }
  if (status.installed === 'none') return { blocked: true, reason: 'not-installed', ...versions }
  if (status.installed === 'differs' && !runnerInstalledNewer(status))
    return { blocked: true, reason: 'update-pending', ...versions }
  return { blocked: false }
}

/** Resolved paths for the bundled Runner plugin install (DLL → Daz install). */
export interface RunnerInstall {
  /** The bundled resource folder holding the ONE DLL for the detected flavor. */
  runnerFolder: string
  dazInstallFolder: string
  errors: Array<string>
}

/**
 * Resolve the Runner plugin install from saved settings: no source folder to
 * pick — the DLLs ship with the app — only the Daz install folder (and its
 * detected DS4/DS6 generation) matters.
 */
export async function resolveRunnerInstall(): Promise<RunnerInstall> {
  const s = await getSettings()
  const errors: Array<string> = []
  let runnerFolder = ''
  // The install the EXPORT runs in, which is the only place a Runner is any use
  // — and the flavor probe below then picks the DS4/DS6 DLL to match it, so an
  // "Export only" DS4 beside an active DS6 gets the DS4 binary without anything
  // here having to know that happened.
  const dazInstallFolder = exportInstallFolder(s)
  if (!dazInstallFolder) {
    errors.push('Set the Daz Studio install folder.')
  } else {
    const flavor = await detectDazFlavor(dazInstallFolder)
    if (!flavor) {
      errors.push(
        'Could not detect the Daz Studio version — the install folder has no readable DAZStudio*.exe.',
      )
    } else {
      runnerFolder = await bundledRunnerDir(flavor)
      if (!(await exists(join(runnerFolder, RUNNER_DLL[flavor])))) {
        errors.push(
          'This build carries no bundled Runner plugin — reinstall the app (dev checkout: run `pnpm fetch:runner`).',
        )
      }
    }
  }
  return { runnerFolder, dazInstallFolder, errors }
}
