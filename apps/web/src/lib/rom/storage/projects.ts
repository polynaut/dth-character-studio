// Sequential `await` in a loop is this module's normal shape, not an oversight:
// it is ORDERED filesystem work — a step reads, moves or overwrites what the
// step before it wrote, and the rule's advice (`Promise.all`) would race those
// against each other. Scoped off for the file rather than repeated at each
// loop; a loop here that genuinely CAN run in parallel should use `Promise.all`
// on its own merits.
/* oxlint-disable no-await-in-loop */
import { exists, mkdir, readDir, readTextFile, remove, rename } from '@tauri-apps/plugin-fs'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

import { newId } from '@dth/rom'

import { characterFolderName, normalizeRelFolder } from '../library'
import { basename, dirname, isDir, join, writeTextFileAtomic } from './fs'
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
  /** The character's Houdini folder — its `.hiplc` projects AND the fixed
   *  `daz-export` root the studio writes into. `createHoudiniSubdir`
   *  only governs seeding it EMPTY into a new character; the export root brings
   *  it into being either way. */
  houdiniSubdir: string
  /** Whether to seed the empty Houdini folder when a character is created. */
  createHoudiniSubdir: boolean
  /**
   * The character's FINAL export folder, seeded empty into each new character
   * beside the Daz and Houdini ones — where the files Houdini generates for
   * Unreal land. The END of the pipeline, and not to be confused with
   * `daz-export`, which is the Daz→Houdini intermediate INSIDE the Houdini folder.
   */
  exportSubdir: string
  /** Whether the project shows the reusable Daz-scene "assets" feature (off = characters only). */
  assetsEnabled: boolean
  /** Whether the project generates a per-character `Scan_Products_<Name>.dsa` that
   *  analyses the open Daz scene for used products (off by default). */
  dazProductsEnabled: boolean
  /**
   * How the generated PoseAsset CSV writes reference-skeleton paths: `'hip'` =
   * relative to the scene file (`$HIP/../…`, portable across moves/machines),
   * `'absolute'` = the real path baked in. Editable in Settings → Project.
   */
  houdiniPathStyle: 'hip' | 'absolute'
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
  exportSubdir: 'export',
  assetsEnabled: false,
  dazProductsEnabled: false,
  charactersSubdir: '',
  houdiniPathStyle: 'hip' as 'hip' | 'absolute',
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
      exportSubdir: safeRelSubdir(raw.exportSubdir, defaults.exportSubdir),
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
      houdiniPathStyle: raw.houdiniPathStyle === 'absolute' ? 'absolute' : 'hip',
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
 * Rename the project's `.dcsp` file to match `name`, so the filename (and the
 * window title derived from it) track the project name. Returns the resulting
 * `.dcsp` path — unchanged when there's no manifest, or when the filename would
 * only differ by case (a case-only rename is a no-op / can fail on
 * case-insensitive filesystems).
 */
export async function renameManifestFile(dir: string, name: string): Promise<string | null> {
  const existing = await findManifestPath(dir)
  if (!existing) return null
  const target = join(dir, dcspFileName(name))
  if (basename(existing).toLowerCase() === basename(target).toLowerCase()) return existing
  await rename(existing, target)
  return target
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

/** Root of the per-character app-internal folders (under `.dcsmeta`). Its own
 *  level, not `.dcsmeta/<name>` directly, so a character called "images" or
 *  "media" can't collide with the two folders that were there first. */
export function metaCharactersDir(projectDir: string): string {
  return join(dcsmetaDir(projectDir), 'characters')
}

/**
 * Where ONE character's app-internal files live: `.dcsmeta/characters/<its
 * folder>` — the run log, the Execute stamps, the export-folder record and the
 * PoseAsset CSV(s). None of them is user content; keeping them out of the
 * character folder leaves that folder holding only what the user put there plus
 * the definition.
 *
 * Keyed on the character's LIBRARY-RELATIVE folder (`Ita`, or `Group A/Ita` for
 * a nested one), so the folder is readable when someone goes looking — and
 * unique by construction, since two characters can't own the same folder. It is
 * relative to the characters ROOT, not the project, so changing the project's
 * `charactersSubdir` (which moves every character folder) leaves these put.
 *
 * A rename or move of the character folder has to move this folder with it —
 * `saveCharacter` / `moveCharacter` / `deleteCharacter` in ./characters do,
 * which is why they take the project dir.
 *
 * A loose definition dropped at the library root owns no folder (`relFolder`
 * ''); it falls back to its id, the only thing that tells it from its siblings
 * there. Those used to share ONE set of these files in the library root.
 */
export function characterMetaDir(
  projectDir: string,
  relFolder: string,
  characterId: string,
): string {
  return join(metaCharactersDir(projectDir), relFolder.trim() || characterId)
}

/**
 * Follow a character folder's rename/move with its meta folder, so the studio's
 * own files stay attached to the character they describe.
 *
 * Best-effort by design, and safe to call for a no-op move: nothing to do when
 * the key is unchanged or the source was never created (a character that has
 * never generated has no meta folder). A destination that already exists is
 * necessarily ORPHANED state — no live character can hold that folder key (the
 * character-folder rename itself would have collided first; loose root-level
 * definitions key by id, so they can't collide at all) — so it is removed and
 * the move proceeds. Leaving it would both strand the source forever AND hand
 * the renamed character a dead character's run log and export-folder record.
 */
export async function moveCharacterMetaDir(
  projectDir: string,
  fromRelFolder: string,
  toRelFolder: string,
  characterId: string,
): Promise<void> {
  const from = characterMetaDir(projectDir, fromRelFolder, characterId)
  const to = characterMetaDir(projectDir, toRelFolder, characterId)
  // Case-only renames (kira → Kira) DO have to run: the folder should carry the
  // character's casing, and `rename` re-cases in place on Windows.
  if (from === to) return
  try {
    if (!(await isDir(from))) return
    if (from.toLowerCase() !== to.toLowerCase() && (await exists(to))) {
      await remove(to, { recursive: true })
    }
    await mkdir(dirname(to), { recursive: true })
    await rename(from, to)
  } catch {
    // A locked meta folder must never fail the rename/move that triggered it.
  }
}

// --- Recent projects (volatile app-data) ---------------------------------
// The only project state the app keeps: a newest-first list of recently opened
// `.dcsp` files, for the Home screen. Losing it just empties the list; the
// projects themselves are the `.dcsp` files scattered on disk.
//
// Deliberately UNCAPPED: recents doubles as the app's only project REGISTRY —
// every cross-project sweep (Refresh assets, note-media GC, fetchAllCharacters)
// reads it as "the projects the app knows about". A cap would silently evict
// the oldest entry on the next open, dropping that project out of Home AND out
// of every sweep with no signal to the user. Entries are one path+name each, so
// the list stays tiny; the explicit "Remove from recents" is the only removal.

export interface RecentProject {
  /** Absolute path to the project's `.dcsp` file. */
  path: string
  name: string
  lastOpenedAt: string
}

/** Parse the recents file's text — tolerant, like every registry read. */
function parseRecentsText(raw: string): Array<RecentProject> {
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (r): r is RecentProject => r && typeof r.path === 'string' && typeof r.name === 'string',
    )
  } catch {
    return []
  }
}

async function readRecents(): Promise<Array<RecentProject>> {
  try {
    return parseRecentsText(await readTextFile(await dataPath('recents.json')))
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

// Recents mutations are a read-modify-write on a file shared across windows —
// and recents IS the app's only project registry, so a dropped entry is a
// "lost" project on the Home screen. Two layers of serialization:
//  - the per-window queue below orders THIS window's mutations (and re-reads
//    fresh inside each step);
//  - ACROSS windows, the write goes through the native compare-and-swap
//    command (one process-wide lock — every window shares the one Tauri
//    process), so an interleaved write from another window turns into a
//    'conflict' + retry here instead of silently clobbering that window's
//    entry. A mutation is re-applied on retry, never dropped.
let recentsMutationQueue: Promise<void> = Promise.resolve()

/** How many straight CAS conflicts before falling back to a plain write. Two
 *  windows retrying against each other resolve in one or two rounds; hitting
 *  this many means something rewrites the file in a tight loop — the fallback
 *  keeps THIS mutation from being dropped (pre-CAS behavior, no worse). */
const RECENTS_CAS_ATTEMPTS = 8

function mutateRecents(
  mutate: (recents: Array<RecentProject>) => Array<RecentProject>,
): Promise<void> {
  const run = recentsMutationQueue.then(async () => {
    if (isTauri()) {
      const path = await dataPath('recents.json')
      for (let attempt = 0; attempt < RECENTS_CAS_ATTEMPTS; attempt++) {
        const current = await readTextFile(path).catch(() => '')
        const next = JSON.stringify(mutate(parseRecentsText(current)), null, 2) + '\n'
        let verdict: 'written' | 'conflict'
        try {
          // A primitive return through the FFI ritual — z.enum, no fixture
          // (the remove_dir_if_empty pattern).
          verdict = z.enum(['written', 'conflict']).parse(
            await invoke('write_text_file_if_unchanged', {
              request: { path, expected: current, next },
            }),
          )
        } catch {
          // The command is missing or answered garbage — a WEBVIEW newer than
          // its shell (mid-update) is the real case. Fall back to the plain
          // write: pre-CAS behavior, strictly no worse.
          break
        }
        if (verdict === 'written') return
      }
    }
    // Browser build (single window), CAS unavailable, or the attempts ran dry.
    await writeRecents(mutate(await readRecents()))
  })
  // The queue survives a failed write — the next mutation still runs.
  recentsMutationQueue = run.catch(() => {})
  return run
}

/** Record (or bump to the top) a project in the recents list. */
export async function rememberRecent(path: string, name: string): Promise<void> {
  const key = path.toLowerCase()
  return mutateRecents((recents) => [
    { path, name, lastOpenedAt: new Date().toISOString() },
    ...recents.filter((r) => r.path.toLowerCase() !== key),
  ])
}

/** Drop a project from the recents list (never touches files on disk). */
export async function forgetRecent(path: string): Promise<void> {
  const key = path.toLowerCase()
  return mutateRecents((recents) => recents.filter((r) => r.path.toLowerCase() !== key))
}
