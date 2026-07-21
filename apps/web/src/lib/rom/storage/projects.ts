import { mkdir, readDir, readTextFile } from '@tauri-apps/plugin-fs'

import { newId } from '@dth/rom'

import { characterFolderName, normalizeRelFolder } from '../library'
import { basename, isDir, join, writeTextFileAtomic } from './fs'
import { dataPath, ensureAppDir } from './app-data'

// --- Projects -------------------------------------------------------------
// A project is a folder on disk marked by a single `.dcsp` manifest file. The
// folder's location simply *is* the project — there's no global registry. A
// `{ id, name, path }` is assembled on demand from the manifest (path = the
// folder). Per-project behaviour defaults + app-managed meta (avatars under
// `.dcsmeta/`) live beside the manifest. The app keeps only a volatile recents list.

export interface Project {
  id: string
  name: string
  path: string
  /** ISO timestamp the project was created (from the manifest). */
  createdAt?: string
}

// --- Project manifest (.dcsp) + per-project meta (.dcsmeta) ---------------

export const DCSP_EXT = 'dcsp'
export const DCSP_SCHEMA_VERSION = 2

export interface DcspManifest {
  schemaVersion: number
  id: string
  name: string
  createdAt: string
  /** Default subfolder a copied Daz scene lands in, under the character folder. */
  dazSubdir: string
  /** Empty Houdini folder seeded into each new character. Gated by createHoudiniSubdir. */
  houdiniSubdir: string
  /** Whether to seed the empty Houdini folder when a character is created. */
  createHoudiniSubdir: boolean
  /** Whether the project shows the reusable Daz-scene "assets" feature (off = characters only). */
  assetsEnabled: boolean
  /** Whether the project generates a per-character `Scan_Products_<Name>.dsa` that
   *  analyses the open Daz scene for used products (off by default). */
  dazProductsEnabled: boolean
  /** Relative folder the character folders live in, under the project root. '' = the
   *  project root itself (e.g. 'assets/characters' → <project>/assets/characters/<char>). */
  charactersSubdir: string
  /** Absolute paths of linked Unreal project files (.uproject) - shown on the
   *  project page like the character pages' Daz scenes / Houdini projects. */
  unrealProjects: Array<string>
}

/**
 * Per-project behaviour defaults — THE single copy: a fresh manifest
 * ({@link readManifest} filling gaps) and the api's project-settings save
 * input both take their defaults from here, so the two can't drift.
 */
export const PROJECT_BEHAVIOR_DEFAULTS = {
  dazSubdir: 'daz3d',
  houdiniSubdir: 'houdini',
  createHoudiniSubdir: true,
  assetsEnabled: false,
  dazProductsEnabled: false,
  charactersSubdir: '',
} as const

function manifestDefaults(dir: string): DcspManifest {
  return {
    schemaVersion: DCSP_SCHEMA_VERSION,
    id: '',
    name: basename(dir),
    createdAt: '',
    ...PROJECT_BEHAVIOR_DEFAULTS,
    unrealProjects: [],
  }
}

/** Filesystem-safe `.dcsp` file name from a project's display name. */
function dcspFileName(name: string): string {
  return `${characterFolderName(name.trim()) || 'project'}.${DCSP_EXT}`
}

/**
 * Sanitize a manifest's relative-subdir field (`charactersSubdir`, `dazSubdir`,
 * `houdiniSubdir`): each is later joined onto the project dir (or a character
 * folder), and projects are shared between users — a hostile manifest carrying
 * `"../../.."` or an absolute path must not traverse outside its scope. Anything
 * `normalizeRelFolder` rejects (absolute, drive letter, `..`, illegal chars)
 * falls back to `fallback` rather than propagating the error; so does an
 * empty/missing value. Nested relative paths (`scenes/daz`) pass through.
 */
function safeRelSubdir(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string' || !raw) return fallback
  try {
    return normalizeRelFolder(raw) || fallback
  } catch {
    return fallback
  }
}

/** A project folder that doesn't exist or can't be reached (offline share,
 *  unplugged drive). Distinct from "exists but has no `.dcsp`" — THAT is a
 *  legit defaults case; this must surface instead of yielding a phantom
 *  default project. */
export class ProjectUnreachableError extends Error {
  constructor(dir: string) {
    super(`Project folder is unreachable or does not exist:\n${dir}`)
    this.name = 'ProjectUnreachableError'
  }
}

/** Absolute path to the single `.dcsp` file in a project folder, or null. */
export async function findManifestPath(dir: string): Promise<string | null> {
  if (!dir) return null
  try {
    for (const entry of await readDir(dir)) {
      if (entry.isFile && entry.name.toLowerCase().endsWith(`.${DCSP_EXT}`)) {
        return join(dir, entry.name)
      }
    }
  } catch {
    // unreadable folder — treat as no manifest
  }
  return null
}

/** Read a project's `.dcsp` manifest (filling defaults for missing/old fields).
 *  Throws {@link ProjectUnreachableError} when the folder itself is missing or
 *  unreachable — only an EXISTING folder without a `.dcsp` reads as defaults
 *  (otherwise a stale recents path renders a phantom empty project, and cross-
 *  project sweeps count an offline project as "0 characters" instead of
 *  surfacing it). */
export async function readManifest(dir: string): Promise<DcspManifest> {
  if (!dir || !(await isDir(dir))) throw new ProjectUnreachableError(dir)
  const defaults = manifestDefaults(dir)
  const path = await findManifestPath(dir)
  if (!path) return defaults
  try {
    const raw = JSON.parse(await readTextFile(path))
    const hadId = typeof raw.id === 'string' && raw.id
    const manifest: DcspManifest = {
      schemaVersion:
        typeof raw.schemaVersion === 'number' ? raw.schemaVersion : DCSP_SCHEMA_VERSION,
      id: hadId ? raw.id : newId(),
      name: typeof raw.name === 'string' && raw.name ? raw.name : defaults.name,
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
      // The subdir fields are joined onto folders later — sanitize them all
      // through the same normalizeRelFolder gate (nested `scenes/daz` is fine;
      // absolute / `..` / illegal falls back to the default).
      dazSubdir: safeRelSubdir(raw.dazSubdir, defaults.dazSubdir),
      houdiniSubdir: safeRelSubdir(raw.houdiniSubdir, defaults.houdiniSubdir),
      createHoudiniSubdir:
        typeof raw.createHoudiniSubdir === 'boolean'
          ? raw.createHoudiniSubdir
          : defaults.createHoudiniSubdir,
      assetsEnabled:
        typeof raw.assetsEnabled === 'boolean' ? raw.assetsEnabled : defaults.assetsEnabled,
      dazProductsEnabled:
        typeof raw.dazProductsEnabled === 'boolean'
          ? raw.dazProductsEnabled
          : defaults.dazProductsEnabled,
      charactersSubdir: safeRelSubdir(raw.charactersSubdir, ''),
      unrealProjects: Array.isArray(raw.unrealProjects)
        ? raw.unrealProjects.filter((p: unknown): p is string => typeof p === 'string' && p !== '')
        : [],
    }
    // A manifest without an id used to mint a fresh one on EVERY read — a
    // non-deterministic project id (its product-scan output dir + recents key
    // change between reads). Persist the minted id once so it's stable. Best-effort.
    if (!hadId) {
      try {
        await writeManifest(dir, manifest)
      } catch {
        // read-only manifest — falls back to the old per-read behaviour, no worse
      }
    }
    return manifest
  } catch (e) {
    // A `.dcsp` file EXISTS here but couldn't be read/parsed — it is CORRUPT, not
    // a fresh project. Returning defaults would (a) make fetchProject render a fake
    // empty project for a stale/typoed path instead of 404-ing, and (b) let the
    // next save write those defaults OVER the real charactersSubdir/flags. Surface
    // it instead; cross-project sweeps already skip a project whose manifest throws.
    throw new Error(
      `The project file at "${path}" is unreadable or corrupt — ${e instanceof Error ? e.message : String(e)}`,
      { cause: e },
    )
  }
}

/** Write a project's manifest, reusing the existing `.dcsp` file name if present. */
export async function writeManifest(dir: string, manifest: DcspManifest): Promise<DcspManifest> {
  await mkdir(dir, { recursive: true })
  const existing = await findManifestPath(dir)
  const path = existing ?? join(dir, dcspFileName(manifest.name))
  await writeTextFileAtomic(path, JSON.stringify(manifest, null, 2) + '\n')
  return manifest
}

/**
 * Create a brand-new project: ensure `dir` exists, write a fresh `.dcsp` manifest
 * (named after the project) plus the `.dcsmeta/images` folder. Returns the absolute
 * path of the created `.dcsp` file (what gets opened / remembered).
 */
export async function createProjectManifest(dir: string, name: string): Promise<string> {
  if (!name.trim()) throw new Error('Project name is required.')
  if (!dir.trim()) throw new Error('Project folder is required.')
  await mkdir(dir, { recursive: true })
  const manifest: DcspManifest = {
    ...manifestDefaults(dir),
    id: newId(),
    name: name.trim(),
    createdAt: new Date().toISOString(),
  }
  const path = join(dir, dcspFileName(name))
  await writeTextFileAtomic(path, JSON.stringify(manifest, null, 2) + '\n')
  await mkdir(metaImagesDir(dir), { recursive: true })
  return path
}

/** Hidden per-project meta folder (avatars + app-managed data), beside the .dcsp. */
export function dcsmetaDir(projectDir: string): string {
  return join(projectDir, '.dcsmeta')
}

/** Where a project's character avatar images live (under `.dcsmeta`). */
export function metaImagesDir(projectDir: string): string {
  return join(dcsmetaDir(projectDir), 'images')
}

/** Where a project's notes media (dropped images/files) lives (under `.dcsmeta`). */
export function metaMediaDir(projectDir: string): string {
  return join(dcsmetaDir(projectDir), 'media')
}

// --- Recent projects (volatile app-data) ---------------------------------
// The only project state the app keeps: a capped, newest-first list of recently
// opened `.dcsp` files, for the Home screen. Non-important — losing it just empties
// the list; the projects themselves are the `.dcsp` files scattered on disk.

export interface RecentProject {
  /** Absolute path to the project's `.dcsp` file. */
  path: string
  name: string
  lastOpenedAt: string
}

const RECENTS_CAP = 12

async function readRecents(): Promise<Array<RecentProject>> {
  try {
    const raw = JSON.parse(await readTextFile(await dataPath('recents.json')))
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (r): r is RecentProject => r && typeof r.path === 'string' && typeof r.name === 'string',
    )
  } catch {
    return []
  }
}

async function writeRecents(recents: Array<RecentProject>): Promise<void> {
  await ensureAppDir()
  await writeTextFileAtomic(await dataPath('recents.json'), JSON.stringify(recents, null, 2) + '\n')
}

/** Recently opened projects, newest-first. */
export async function listRecents(): Promise<Array<RecentProject>> {
  return readRecents()
}

/** Record (or bump to the top) a project in the recents list. */
export async function rememberRecent(path: string, name: string): Promise<void> {
  const key = path.toLowerCase()
  const rest = (await readRecents()).filter((r) => r.path.toLowerCase() !== key)
  rest.unshift({ path, name, lastOpenedAt: new Date().toISOString() })
  await writeRecents(rest.slice(0, RECENTS_CAP))
}

/** Drop a project from the recents list (never touches files on disk). */
export async function forgetRecent(path: string): Promise<void> {
  const key = path.toLowerCase()
  await writeRecents((await readRecents()).filter((r) => r.path.toLowerCase() !== key))
}
