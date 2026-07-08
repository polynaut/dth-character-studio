import { exists, readDir, readFile } from '@tauri-apps/plugin-fs'

import { basename, isDir, join } from './fs'
import { getSettings } from './settings'

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
// Folder names carry no version, so the version is read from the DLL itself.

export interface DthExporterReleaseInfo {
  /** The DLL's FileVersion (e.g. "1.0.0.1"), or the folder name when it has none. */
  version: string
  /** The folder name on disk holding the plugin. */
  name: string
}

/**
 * Whether a filename is the exporter DLL. Matched by pattern, not a fixed name:
 * the DLL has been renamed across releases (`dth_exporter.dll` →
 * `dsp_dth_exporter.dll`), so any `*dth_exporter*.dll` counts (which still
 * excludes the optional `dth_tools.dll` companion).
 */
function isExporterDll(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.endsWith('.dll') && lower.includes('dth_exporter')
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
 * Read a Windows DLL/EXE FileVersion from its `VS_FIXEDFILEINFO` resource by
 * scanning the bytes for the `0xFEEF04BD` signature (no full PE parse needed).
 * The two 32-bit words after the signature+struct-version encode the version as
 * major.minor.build.revision. Returns a dotted string, or '' when absent.
 */
async function readDllFileVersion(path: string): Promise<string> {
  let bytes: Uint8Array
  try {
    bytes = await readFile(path)
  } catch {
    return ''
  }
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

/**
 * Inspect a configured Exporter Plugin folder — mirrors `listDthReleases`:
 *  - **single**: the folder itself holds the exporter DLL; its version is read
 *    from the DLL;
 *  - **multi**: a folder of plugin folders (each with the exporter DLL), newest
 *    version first, de-duplicated by version.
 */
export async function listDthExporterReleases(folder: string): Promise<{
  mode: 'single' | 'multi' | 'none'
  version: string
  releases: Array<DthExporterReleaseInfo>
  error: string | null
}> {
  if (!folder) return { mode: 'none', version: '', releases: [], error: null }
  if (!(await isDir(folder))) {
    return { mode: 'none', version: '', releases: [], error: `Folder not reachable: ${folder}` }
  }
  const dll = await findExporterDll(folder)
  if (dll) {
    return { mode: 'single', version: await readDllFileVersion(dll), releases: [], error: null }
  }
  const children = await readDir(folder)
  const found: Array<DthExporterReleaseInfo & { v: Array<number> }> = []
  for (const child of children) {
    if (!child.isDirectory) continue
    const subDll = await findExporterDll(join(folder, child.name))
    if (!subDll) continue
    // Fall back to the folder name so a version-less DLL is still selectable.
    const version = (await readDllFileVersion(subDll)) || child.name
    found.push({ version, name: child.name, v: parseVersion(version) })
  }
  if (found.length === 0) {
    return {
      mode: 'none',
      version: '',
      releases: [],
      error:
        'No DTH Exporter Plugin here. Pick the plugin folder (containing the exporter DLL) or a folder of versioned plugin folders.',
    }
  }
  const byVersion = new Map<string, DthExporterReleaseInfo & { v: Array<number> }>()
  for (const r of found) if (!byVersion.has(r.version)) byVersion.set(r.version, r)
  const releases = [...byVersion.values()]
    .sort((a, b) => compareVersions(b.v, a.v))
    .map(({ v: _v, ...r }) => r)
  return { mode: 'multi', version: '', releases, error: null }
}

/** Shown when a release is only available as a zip — Daz can't load from one. */
export const ZIP_RELEASE_WARNING = 'Extract the release zip first and select folders only.'

/**
 * Resolve the release to scan from the configured folder + the selected version.
 * A single-release folder resolves to itself; a multi-release folder resolves to
 * the chosen version (falling back to the newest extracted folder). A zip
 * release can't be scanned — Daz can't load poses from inside an archive — so it
 * resolves to the extract-first warning.
 */
export async function resolveActiveRelease(
  folder: string,
  currentVersion: string,
): Promise<{
  posesFolder: string
  version: string
  releaseName: string
  error: string | null
}> {
  if (await isReleaseFolder(folder)) {
    return {
      posesFolder: posesFolderOf(folder),
      version: versionLabel(parseVersion(basename(folder))),
      releaseName: basename(folder),
      error: null,
    }
  }
  const list = await listDthReleases(folder)
  if (list.mode !== 'multi' || list.releases.length === 0) {
    return { posesFolder: '', version: '', releaseName: '', error: list.error ?? `No DTH release found in: ${folder}` }
  }
  const chosen =
    list.releases.find((r) => r.version === currentVersion) ??
    list.releases.find((r) => r.kind === 'folder') ??
    list.releases[0]
  if (chosen.kind === 'zip') {
    return { posesFolder: '', version: chosen.version, releaseName: chosen.name, error: ZIP_RELEASE_WARNING }
  }
  return {
    posesFolder: posesFolderOf(join(folder, chosen.name)),
    version: chosen.version,
    releaseName: chosen.name,
    error: null,
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
 * install counterpart to {@link resolveActiveRelease}, which returns the Poses
 * subfolder instead.
 */
async function resolveActiveReleaseRoot(
  folder: string,
  currentVersion: string,
): Promise<{ releaseRoot: string; version: string; name: string; error: string | null }> {
  if (!folder) return { releaseRoot: '', version: '', name: '', error: 'No DTH release folder configured' }
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
    return { releaseRoot: '', version: '', name: '', error: list.error ?? `No DTH release found in: ${folder}` }
  }
  const chosen =
    list.releases.find((r) => r.version === currentVersion) ??
    list.releases.find((r) => r.kind === 'folder') ??
    list.releases[0]
  if (chosen.kind === 'zip') {
    return { releaseRoot: '', version: chosen.version, name: chosen.name, error: ZIP_RELEASE_WARNING }
  }
  return { releaseRoot: join(folder, chosen.name), version: chosen.version, name: chosen.name, error: null }
}

/**
 * Resolve the active Exporter Plugin *folder* (the one holding the DLLs) from the
 * configured folder + selected version — single mode is the folder itself, multi
 * mode the chosen versioned subfolder.
 */
async function resolveExporterFolder(
  folder: string,
  currentVersion: string,
): Promise<{ exporterFolder: string; version: string; error: string | null }> {
  if (!folder) return { exporterFolder: '', version: '', error: 'No Exporter Plugin folder configured' }
  if (!(await isDir(folder))) {
    return { exporterFolder: '', version: '', error: `Folder not reachable: ${folder}` }
  }
  const dll = await findExporterDll(folder)
  if (dll) {
    return { exporterFolder: folder, version: await readDllFileVersion(dll), error: null }
  }
  const list = await listDthExporterReleases(folder)
  if (list.mode !== 'multi' || list.releases.length === 0) {
    return { exporterFolder: '', version: '', error: list.error ?? `No Exporter Plugin found in: ${folder}` }
  }
  const chosen = list.releases.find((r) => r.version === currentVersion) ?? list.releases[0]
  return { exporterFolder: join(folder, chosen.name), version: chosen.version, error: null }
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
 */
export async function resolvePluginInstall(): Promise<PluginInstall> {
  const s = await getSettings()
  const errors: Array<string> = []
  const exporter = await resolveExporterFolder(s.dthExporterFolder, s.currentDthExporterVersion)
  if (exporter.error || !exporter.exporterFolder) {
    errors.push(exporter.error ?? 'No DTH Exporter Plugin resolved — set the Exporter Plugin folder.')
  }
  if (!s.dazInstallFolder) errors.push('Set the Daz Studio install folder.')
  return {
    exporterFolder: exporter.exporterFolder,
    exporterVersion: exporter.version,
    dazInstallFolder: s.dazInstallFolder,
    errors,
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
