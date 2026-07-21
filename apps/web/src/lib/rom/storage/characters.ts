import { exists, mkdir, readDir, readTextFile, remove, rename } from '@tauri-apps/plugin-fs'

import {
  CHARACTER_SCHEMA_VERSION,
  characterSchema,
  CharacterSchemaTooNewError,
  migrateCharacterData,
  ROM_RUN_LOG_FILE,
} from '@dth/rom'
import type { Character } from '@dth/rom'

import { canonicalImage } from '../image'
import {
  characterFolderName,
  definitionFileName,
  normalizeRelFolder,
  normalizeRelPath,
  notesPathFor,
} from '../library'
import {
  basename,
  dirname,
  isDir,
  isTaken,
  join,
  relativeInside,
  uniqueFolder,
  walkFiles,
  walkFilesStrict,
  writeTextFileAtomic,
} from './fs'
import { studioVersion } from './app-data'
import { listRecents, readManifest } from './projects'
import type { Project } from './projects'

// The character library: scanning a project's folder for definitions and the
// CRUD around them (save/create/move/delete + the paths Generate writes into).

/**
 * THE single repoint site: rewrite every in-folder path field of a character
 * from `fromFolder` to `toFolder`. A folder move/rename carries the character's
 * files with it, so any stored path that lived INSIDE the folder must follow; a
 * path linked in place outside it is left untouched. A new character field that
 * stores an inside-the-folder path MUST be added here (and to the prefill list) —
 * see `.ai/conventions.md` §schema-ritual item 5. Used by `saveCharacter`'s
 * rename, `moveCharacter`, and `moveCharactersRoot` so they can't drift apart
 * (they used to: `moveCharacter` repointed only `scenePath`, orphaning extra
 * scenes / grooms / overrides / the avatar-source scene on a folder move).
 */
export function repointCharacterPaths(
  character: Character,
  fromFolder: string,
  toFolder: string,
): Character {
  const repoint = (p: string): string => {
    const rel = relativeInside(fromFolder, p)
    return rel ? join(toFolder, rel) : p
  }
  return {
    ...character,
    scenePath: repoint(character.scenePath),
    extraScenes: character.extraScenes.map(repoint),
    houdiniProjects: character.houdiniProjects.map(repoint),
    imageScene: repoint(character.imageScene),
    groomScenes: character.groomScenes.map((g) => ({ ...g, scenePath: repoint(g.scenePath) })),
    sceneOverrides: character.sceneOverrides.map((o) => ({ ...o, scenePath: repoint(o.scenePath) })),
  }
}

/**
 * Read a stored definition into a current-shape Character: run the core migration
 * framework ({@link migrateCharacterData}) on the raw JSON to bring any older
 * shape forward, normalise the avatar ref, then validate against the schema. The
 * stored `schemaVersion` is preserved (so a migrated-on-read definition still
 * reads as below current) — it's bumped only when the character is written back.
 */
function parseCharacter(raw: unknown): Character {
  const data = migrateCharacterData(raw)
  // Avatar canonicalization stays here — it's web/storage-specific (it drops
  // machine-specific asset/convertFileSrc URLs the pure core knows nothing about).
  data.image = canonicalImage(data.image)
  return characterSchema.parse(data)
}

interface LibraryEntry {
  /** Absolute path to the character's folder. */
  folderAbs: string
  /** Absolute path to the definition JSON inside the folder. */
  definitionAbs: string
  /** Folder path relative to the library root ('/'-separated; '' at the root). */
  relFolder: string
  character: Character
}

/** Where a character's files live — surfaced in the editor + used by Generate. */
export interface CharacterLocation {
  definitionAbs: string
  folderAbs: string
  relFolder: string
  libraryFolder: string
}

/** A `.json` file in the library that looks like a character definition but
 *  could not be read/parsed — surfaced by the scan instead of silently skipped
 *  (a silently skipped torn definition made the character VANISH from the
 *  library, and the next save then forked a "Name (2)" duplicate beside it). */
export interface CharacterScanProblem {
  /** Absolute path of the offending file. */
  path: string
  /** Human-readable reason: unreadable file / invalid JSON / failed schema. */
  reason: string
}

interface LibraryScan {
  entries: Array<LibraryEntry>
  problems: Array<CharacterScanProblem>
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Whether a parsed JSON value is SHAPED like a character definition — so its
 *  schema failure is a problem to surface, not just a foreign JSON to skip
 *  (generated `_FBMs.json` sidecars legitimately fail the schema). */
function looksLikeCharacter(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false
  const r = raw as Record<string, unknown>
  return typeof r.id === 'string' && typeof r.name === 'string' && ('genesis' in r || 'sections' in r)
}

/**
 * Recursively scan the library for character definitions. A `.json` file is a
 * definition iff it parses as a character (generated `_FBMs.json` etc. fail the
 * schema and are skipped). De-duplicates by id (first match wins). Files that
 * FAIL to read/parse are collected into `problems` rather than silently
 * dropped — except app-internal/transport JSONs (dot-files, the Daz-written run
 * log), which may legitimately be mid-write.
 */
async function scanLibrary(lib: string): Promise<LibraryScan> {
  const problems: Array<CharacterScanProblem> = []
  if (!lib || !(await isDir(lib))) return { entries: [], problems }
  const entries: Array<LibraryEntry> = []
  const seen = new Set<string>()
  // Prune dot-folders: a character definition never lives in one, but `.dcsmeta`
  // (avatars + up-to-100MB note media), `.assets`, and `.dth-moving` would
  // otherwise be walked in full on every scan. Character/Daz/Houdini subfolders
  // still descend (a moved character can nest arbitrarily).
  for (const rel of await walkFiles(lib, '', (name) => name.startsWith('.'))) {
    if (!rel.toLowerCase().endsWith('.json')) continue
    const definitionAbs = join(lib, rel)
    const fileName = basename(definitionAbs)
    // Dot-files (`.last_rom_run.json`) and the Daz-side run-log transport are
    // app-internal and may be mid-write — never report them as problems.
    const internal =
      fileName.startsWith('.') || fileName.toLowerCase() === ROM_RUN_LOG_FILE.toLowerCase()
    let raw: unknown
    try {
      raw = JSON.parse(await readTextFile(definitionAbs))
    } catch (e) {
      if (!internal) {
        problems.push({
          path: definitionAbs,
          reason: `unreadable or invalid JSON (possibly a torn write): ${errorMessage(e)}`,
        })
      }
      continue
    }
    let character: Character
    try {
      character = parseCharacter(raw)
    } catch (e) {
      // A file saved by a NEWER app build must never be silently downgraded
      // (parse throws before any normalization) — surface "update the app",
      // not "corrupt". The definition is left untouched on disk.
      if (e instanceof CharacterSchemaTooNewError) {
        problems.push({ path: definitionAbs, reason: e.message })
        continue
      }
      // Foreign JSON (a generated sidecar) is simply not a character; a
      // definition-shaped object failing the schema is a real problem.
      if (!internal && looksLikeCharacter(raw)) {
        problems.push({
          path: definitionAbs,
          reason: `failed the character schema: ${errorMessage(e)}`,
        })
      }
      continue
    }
    if (seen.has(character.id)) {
      console.warn(`Duplicate character id ${character.id} at ${definitionAbs} — ignoring.`)
      continue
    }
    seen.add(character.id)
    const relFolder = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
    entries.push({ folderAbs: join(lib, relFolder), definitionAbs, relFolder, character })
  }
  return { entries, problems }
}

async function findEntry(lib: string, id: string): Promise<LibraryEntry | null> {
  return (await scanLibrary(lib)).entries.find((entry) => entry.character.id === id) ?? null
}

/**
 * Scan a project's character library, returning both the readable characters
 * (with their resolved locations, so callers can skip re-scans) and the
 * PROBLEMS: definition-shaped `.json` files that could not be read or parsed.
 * `listCharacters` keeps its plain shape for the routes; this is the surfaced
 * channel for the problems (and the location-threading seam for sweeps).
 */
export async function scanCharacterLibrary(lib: string): Promise<{
  entries: Array<{ character: Character; location: CharacterLocation }>
  problems: Array<CharacterScanProblem>
}> {
  const scan = await scanLibrary(lib)
  return {
    entries: scan.entries.map((entry) => ({
      character: entry.character,
      location: {
        definitionAbs: entry.definitionAbs,
        folderAbs: entry.folderAbs,
        relFolder: entry.relFolder,
        libraryFolder: lib,
      },
    })),
    problems: scan.problems,
  }
}

/**
 * Read + parse ONE definition file at a known path — the fast path for the api
 * layer's character-location cache, which skips the full library scan when it
 * already knows where a definition lives. Null when the file is missing or no
 * longer parses as a character (callers then fall back to the full scan).
 */
export async function readCharacterAt(definitionAbs: string): Promise<Character | null> {
  try {
    return parseCharacter(JSON.parse(await readTextFile(definitionAbs)))
  } catch {
    return null
  }
}

export async function listCharacters(lib: string): Promise<Array<Character>> {
  const { entries } = await scanLibrary(lib)
  return entries.map((entry) => entry.character).sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Every character notes file under the characters root (absolute paths).
 * Matched by the `.notes.md` suffix rather than via the definitions, so even a
 * notes file whose definition is temporarily unparseable still counts — the
 * media GC treats its `media://` references as live.
 *
 * STRICT on purpose: its only consumer is the media GC's reference collection,
 * where a silently skipped unreadable subtree (one flaky folder on a network
 * share) would make still-referenced media look orphaned and get DELETED. Any
 * unreadable directory therefore throws — the GC then skips that project. A
 * cleanly ABSENT root (no characters folder yet) is still just "no notes".
 */
export async function listNotesFiles(lib: string): Promise<Array<string>> {
  if (!lib || !(await exists(lib))) return []
  const out: Array<string> = []
  for (const rel of await walkFilesStrict(lib)) {
    if (rel.toLowerCase().endsWith('.notes.md')) out.push(join(lib, rel))
  }
  return out
}

export async function getCharacter(
  lib: string,
  id: string,
  // When the definition path is already known (a caller that resolved the
  // location once), read it directly — skips a full library scan.
  definitionAbs?: string,
): Promise<Character | null> {
  if (definitionAbs) {
    const character = await readCharacterAt(definitionAbs)
    return character && character.id === id ? character : null
  }
  return (await findEntry(lib, id))?.character ?? null
}

/**
 * Find a character by id across every project's library (ids are globally
 * unique). Used by ROM prefill, which can copy from a character in any project.
 */
export async function findCharacterAcrossProjects(id: string): Promise<Character | null> {
  for (const recent of await listRecents()) {
    try {
      const dir = dirname(recent.path)
      const manifest = await readManifest(dir)
      const root = manifest.charactersSubdir ? join(dir, manifest.charactersSubdir) : dir
      const found = await getCharacter(root, id)
      if (found) return found
    } catch {
      // A recent project with a corrupt/unreachable manifest must not abort the
      // cross-project search — skip it and keep scanning the others.
    }
  }
  return null
}

export async function saveCharacter(
  project: Project,
  character: Character,
  charactersRoot?: string,
  /** The character's already-resolved entry (skips the full library scan) —
   *  the caller must have just re-read `character` from this location, so the
   *  entry is known to be this character's. Used by the Refresh sweep. */
  preResolved?: { location: CharacterLocation; character: Character },
): Promise<Character> {
  // `charactersRoot` is where character folders live (the project's charactersSubdir
  // applied); falls back to the project root. Provenance stamps still use project.path.
  const lib = charactersRoot || project.path
  if (!lib) throw new Error('No project library configured.')
  await mkdir(lib, { recursive: true })
  const stamped = {
    ...character,
    updatedAt: new Date().toISOString(),
    studioVersion: await studioVersion(),
    schemaVersion: CHARACTER_SCHEMA_VERSION,
    projectName: project.name,
    projectPath: project.path,
  }
  let existing: { folderAbs: string; definitionAbs: string; character: Character } | null
  let problems: Array<CharacterScanProblem> = []
  if (preResolved) {
    existing = {
      folderAbs: preResolved.location.folderAbs,
      definitionAbs: preResolved.location.definitionAbs,
      character: preResolved.character,
    }
  } else {
    const scan = await scanLibrary(lib)
    problems = scan.problems
    existing = scan.entries.find((entry) => entry.character.id === character.id) ?? null
  }

  let definitionAbs: string
  // A name change renames the character's folder; asset paths that lived inside
  // it travel with it, so they must be repointed (or they'd break — the classic
  // "scenes unlinked after rename"). Captured here, applied below.
  let folderMove: { from: string; to: string } | null = null
  if (existing) {
    const oldFolderName = basename(existing.folderAbs)
    const newName = characterFolderName(character.name)
    // Rename the folder + definition to match a new name only when the folder
    // was still tracking the name (never clobber a manually moved/renamed one).
    const tracksName = oldFolderName === characterFolderName(existing.character.name)
    if (tracksName && oldFolderName !== newName) {
      // A case-only rename (kira → Kira) targets the SAME physical folder on
      // Windows, so `uniqueFolder` would see it as taken and fork to "Kira (2)".
      // Rename in place to the new casing instead of probing for a free name.
      const caseOnlyRename = oldFolderName.toLowerCase() === newName.toLowerCase()
      const folderAbs = caseOnlyRename
        ? join(dirname(existing.folderAbs), newName)
        : await uniqueFolder(dirname(existing.folderAbs), newName)
      await rename(existing.folderAbs, folderAbs)
      const movedDefinition = join(folderAbs, basename(existing.definitionAbs))
      definitionAbs = join(folderAbs, definitionFileName(character.name))
      if (movedDefinition !== definitionAbs && (await exists(movedDefinition))) {
        await rename(movedDefinition, definitionAbs)
      }
      // The notes file travelled with the folder still named after the OLD
      // definition — rename it too, or the editor resolves <NewName>.notes.md
      // and shows an empty page while the notes sit orphaned on disk.
      const movedNotes = notesPathFor(movedDefinition)
      const newNotes = notesPathFor(definitionAbs)
      if (movedNotes !== newNotes && (await exists(movedNotes))) {
        await rename(movedNotes, newNotes)
      }
      folderMove = { from: existing.folderAbs, to: folderAbs }
    } else {
      definitionAbs = existing.definitionAbs
    }
  } else {
    // The scan didn't find this character. NEVER treat a folder whose
    // definition failed to parse as free: if the corrupt file sits exactly
    // where this character's folder would go, it almost certainly IS this
    // character (a torn write) — `uniqueFolder` would silently fork a
    // "Name (2)" duplicate beside it. Surface the corruption instead.
    const folderName = characterFolderName(character.name)
    const lower = (p: string) => p.replace(/\\/g, '/').toLowerCase()
    const prospectiveFolder = lower(join(lib, folderName))
    const looseDefinition = lower(join(lib, definitionFileName(character.name)))
    const corrupt = problems.find((p) => {
      const path = lower(p.path)
      return path === looseDefinition || path.startsWith(`${prospectiveFolder}/`)
    })
    if (corrupt) {
      throw new Error(
        `Can't save "${character.name}": the existing definition at "${corrupt.path}" is unreadable ` +
          `(${corrupt.reason}). Repair or remove that file first — saving now would create a duplicate ` +
          `"${folderName} (2)" character beside it.`,
      )
    }
    const folderAbs = await uniqueFolder(lib, folderName)
    await mkdir(folderAbs, { recursive: true })
    definitionAbs = join(folderAbs, definitionFileName(character.name))
  }

  // Repoint scenes / Houdini projects that lived inside the renamed folder to its
  // new location; a scene linked in place outside the folder is left untouched.
  const finalStamped = folderMove
    ? repointCharacterPaths(stamped, folderMove.from, folderMove.to)
    : stamped

  await writeTextFileAtomic(definitionAbs, JSON.stringify(finalStamped, null, 2) + '\n')
  return finalStamped
}

/**
 * Create a new character at a chosen folder relative to the project root. An
 * empty `relFolder` stores the definition directly in the project root; a
 * non-empty one creates `<lib>/<relFolder>/` (auto-suffixed if it exists) to
 * hold the definition + all generated files. The definition is named after the
 * character (`<Name>.json`). Returns the stamped character AND where it landed
 * (the caller shouldn't have to re-scan the library to find the folder it
 * just created).
 */
export async function createCharacterAt(
  project: Project,
  character: Character,
  relFolder: string,
  charactersRoot?: string,
): Promise<{ character: Character; location: CharacterLocation }> {
  const lib = charactersRoot || project.path
  if (!lib) throw new Error('No project library configured.')
  await mkdir(lib, { recursive: true })
  const stamped = {
    ...character,
    updatedAt: new Date().toISOString(),
    studioVersion: await studioVersion(),
    schemaVersion: CHARACTER_SCHEMA_VERSION,
    projectName: project.name,
    projectPath: project.path,
  }
  const fileName = definitionFileName(character.name)
  const clean = normalizeRelFolder(relFolder)

  let definitionAbs: string
  let folderAbs: string
  let charRelFolder: string
  if (clean) {
    const slash = clean.lastIndexOf('/')
    const parent = slash >= 0 ? join(lib, clean.slice(0, slash)) : lib
    const leaf = slash >= 0 ? clean.slice(slash + 1) : clean
    await mkdir(parent, { recursive: true })
    folderAbs = await uniqueFolder(parent, leaf) // may differ from `clean` (auto-suffix)
    await mkdir(folderAbs, { recursive: true })
    definitionAbs = join(folderAbs, fileName)
    charRelFolder = relativeInside(lib, folderAbs) ?? ''
  } else {
    // Store directly in the project root.
    folderAbs = join(lib)
    charRelFolder = ''
    definitionAbs = join(lib, fileName)
    if (await isTaken(definitionAbs)) {
      throw new Error(`A character file "${fileName}" already exists in the project root.`)
    }
  }

  await writeTextFileAtomic(definitionAbs, JSON.stringify(stamped, null, 2) + '\n')
  return {
    character: stamped,
    location: { definitionAbs, folderAbs, relFolder: charRelFolder, libraryFolder: lib },
  }
}

/**
 * Delete a character. By default removes its whole folder. `keepFolders`
 * (subfolder paths relative to the character folder, e.g. the configured Daz /
 * Houdini subdirs — possibly NESTED like `scenes/daz`) are preserved: every
 * other entry is removed, but the kept subtrees are left on disk. When
 * everything was kept (nothing else to remove) the empty character folder
 * itself stays. A definition dropped loosely at the library root only ever has
 * its own file removed (never the library). `location`, when the caller already
 * resolved it, skips the full library scan.
 */
export async function deleteCharacter(
  lib: string,
  id: string,
  opts: { keepFolders?: Array<string>; location?: CharacterLocation } = {},
): Promise<void> {
  const entry = opts.location ?? (await findEntry(lib, id))
  if (!entry) return
  // Guard: a definition manually dropped at the library root has folderAbs ===
  // the library itself — only remove its file, never recursively wipe the library.
  if (entry.relFolder === '') {
    if (await exists(entry.definitionAbs)) await remove(entry.definitionAbs)
    // A loose definition's notes sit beside it — they belong to the character.
    const looseNotes = notesPathFor(entry.definitionAbs)
    if (await exists(looseNotes)) await remove(looseNotes)
    return
  }
  if (!(await exists(entry.folderAbs))) return

  // Kept subdirs as full '/'-relative paths (lowercased): a nested keep like
  // `scenes/daz` must preserve exactly that subtree — the old basename-only
  // matching kept a top-level `daz` (which didn't exist) and deleted all of
  // `scenes`, taking the supposedly-kept Daz files with it.
  const keep = (opts.keepFolders ?? [])
    .map((f) => f.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase())
    .filter(Boolean)
  if (keep.length === 0) {
    await remove(entry.folderAbs, { recursive: true })
    return
  }
  await deleteExceptKept(entry.folderAbs, keep)
}

/**
 * Remove everything under `dir` except the kept rel paths ('/'-separated,
 * lowercased). A directory that IS a kept path survives untouched; an ANCESTOR
 * of a kept path is descended into (so `scenes/daz` keeps that subtree while
 * the rest of `scenes` is removed); everything else goes.
 */
async function deleteExceptKept(dir: string, keptRel: Array<string>): Promise<void> {
  for (const child of await readDir(dir)) {
    const name = child.name.toLowerCase()
    const abs = join(dir, child.name)
    if (child.isDirectory && keptRel.includes(name)) continue
    const nested = keptRel.filter((k) => k.startsWith(`${name}/`)).map((k) => k.slice(name.length + 1))
    if (child.isDirectory && nested.length > 0) {
      await deleteExceptKept(abs, nested)
      continue
    }
    if (await exists(abs)) await remove(abs, { recursive: true })
  }
}

/** One planned character move in {@link moveCharactersRoot}. */
interface RootMoveItem {
  src: string
  dest: string
  relFolder: string
  defAbs: string
}

export interface MoveCharactersRootResult {
  /** Characters now living at the NEW root when the dust settled. */
  moved: number
  /** Moved characters whose in-file scene/Houdini paths failed to repoint. */
  repointFailures: Array<{ dest: string; error: string }>
  /** Characters whose folder could NOT be moved (locked, unreadable …). */
  moveFailures: Array<{ src: string; error: string }>
  /** True when a partial failure was fully rolled back — every character is
   *  back at the OLD root and the manifest needs no change. */
  rolledBack: boolean
  /** How many characters ended up at the new root (= `moved`). */
  atNewRoot: number
  /** How many remained at (or were returned to) the old root. */
  atOldRoot: number
}

/**
 * Relocate every character from `oldRoot` to `newRoot`, keeping each character's
 * folder name (and any sub-nesting) and repointing the scene / Houdini paths that
 * lived inside a moved folder so links don't break (mirrors a rename). Used when a
 * project's `charactersSubdir` changes — the character folders must follow it.
 * Only character folders / loose definitions move; other project files (the
 * `.dcsp`, `.dcsmeta`, `.assets`) are untouched.
 *
 * Failure semantics: every move is attempted (a locked folder no longer aborts
 * the loop mid-way, stranding the earlier characters across two roots). On a
 * PARTIAL failure the already-moved characters are moved BACK (rollback), so
 * the library is whole at the old root and the caller's manifest needs no
 * change; if some rollback itself fails, those characters stay at the new root
 * and the result's counts say exactly where everything lives so the caller can
 * write the manifest that matches reality.
 */
export async function moveCharactersRoot(
  oldRoot: string,
  newRoot: string,
): Promise<MoveCharactersRootResult> {
  const norm = (s: string) => s.replace(/\\/g, '/').replace(/\/+$/g, '')
  const from = norm(oldRoot)
  const to = norm(newRoot)
  const empty: MoveCharactersRootResult = {
    moved: 0,
    repointFailures: [],
    moveFailures: [],
    rolledBack: false,
    atNewRoot: 0,
    atOldRoot: 0,
  }
  if (!from || !to || from === to || !(await isDir(from))) return empty
  // When the new root nests inside the old one, leave characters already under it
  // alone (moving them by their old-relative path would double-nest them).
  const newInsideOld = (to + '/').startsWith(from + '/')
  await mkdir(to, { recursive: true })

  // Plan every move up front and check ALL destinations for collisions BEFORE
  // moving anything — a collision throws here, while nothing has moved yet.
  const plan: Array<RootMoveItem> = []
  for (const entry of (await scanLibrary(from)).entries) {
    // A folder-backed character moves its folder; a loose root-level definition
    // moves just its `.json` (its "folder" IS the root — never move that).
    const src = norm(entry.relFolder ? entry.folderAbs : entry.definitionAbs)
    if (newInsideOld && (src + '/').startsWith(to + '/')) continue
    const dest = entry.relFolder
      ? join(to, entry.relFolder)
      : join(to, basename(entry.definitionAbs))
    if (norm(dest) === src) continue
    if (await isTaken(dest)) {
      throw new Error(`Can't move character to "${dest}" — something already exists there.`)
    }
    plan.push({ src, dest, relFolder: entry.relFolder, defAbs: entry.definitionAbs })
  }

  // Phase 1 — attempt EVERY move, collecting failures instead of aborting on
  // the first (which stranded the already-moved characters at a root the
  // manifest didn't point at).
  const movedItems: Array<RootMoveItem> = []
  const moveFailures: Array<{ src: string; error: string }> = []
  for (const item of plan) {
    try {
      await mkdir(dirname(item.dest), { recursive: true })
      await rename(item.src, item.dest)
      // A folder-backed character carries its notes inside the folder; a loose
      // definition's `<Name>.notes.md` sits beside it and must move separately.
      if (!item.relFolder) {
        const srcNotes = notesPathFor(item.src)
        if (await exists(srcNotes)) await rename(srcNotes, notesPathFor(item.dest))
      }
      movedItems.push(item)
    } catch (e) {
      moveFailures.push({ src: item.src, error: errorMessage(e) })
    }
  }

  // Phase 2 — partial failure: roll the moved characters BACK so the library is
  // whole at the old root again (safest recovery — the manifest stays valid
  // untouched). A character whose rollback also fails stays at the new root.
  if (moveFailures.length > 0 && movedItems.length > 0) {
    const stranded: Array<RootMoveItem> = []
    for (const item of [...movedItems].reverse()) {
      try {
        await rename(item.dest, item.src)
        if (!item.relFolder) {
          const destNotes = notesPathFor(item.dest)
          if (await exists(destNotes)) await rename(destNotes, notesPathFor(item.src))
        }
      } catch {
        stranded.push(item)
      }
    }
    // Whatever is stuck at the new root lives there now — its in-file paths
    // must still be repointed, whatever the manifest ends up saying.
    const repointFailures = await repointMovedCharacters(stranded)
    return {
      moved: stranded.length,
      repointFailures,
      moveFailures,
      rolledBack: stranded.length === 0,
      atNewRoot: stranded.length,
      atOldRoot: plan.length - stranded.length,
    }
  }

  // Phase 3 — clean run (everything moved, or nothing could move at all):
  // repoint the moved characters' in-file paths.
  const repointFailures = await repointMovedCharacters(movedItems)
  return {
    moved: movedItems.length,
    repointFailures,
    moveFailures,
    rolledBack: false,
    atNewRoot: movedItems.length,
    atOldRoot: plan.length - movedItems.length,
  }
}

/** Repoint the in-file scene/Houdini paths of folder-backed characters that
 *  now live at `dest` (moved from `src`). Failures are collected, not thrown —
 *  the folder IS at the new place; only the definition's links need a re-save. */
async function repointMovedCharacters(
  items: Array<RootMoveItem>,
): Promise<Array<{ dest: string; error: string }>> {
  const failures: Array<{ dest: string; error: string }> = []
  for (const { src, dest, relFolder, defAbs } of items) {
    if (!relFolder) continue // a loose definition carries no in-folder paths
    try {
      const newDefAbs = join(dest, basename(defAbs))
      const c = parseCharacter(JSON.parse(await readTextFile(newDefAbs)))
      const updated = repointCharacterPaths(c, src, dest)
      await writeTextFileAtomic(newDefAbs, JSON.stringify(updated, null, 2) + '\n')
    } catch (e) {
      failures.push({ dest, error: errorMessage(e) })
    }
  }
  return failures
}

/** Absolute path to a character's folder (created if missing) — Generate's target.
 *  Pass `folderAbs` (a caller that already resolved the location) to skip the scan. */
export async function getCharacterFolder(
  lib: string,
  id: string,
  folderAbs?: string,
): Promise<string> {
  const dir = folderAbs ?? (await findEntry(lib, id))?.folderAbs
  if (!dir) throw new Error(`Character ${id} not found`)
  await mkdir(dir, { recursive: true })
  return dir
}

export async function getCharacterPath(lib: string, id: string): Promise<CharacterLocation | null> {
  const entry = await findEntry(lib, id)
  if (!entry) return null
  return {
    definitionAbs: entry.definitionAbs,
    folderAbs: entry.folderAbs,
    relFolder: entry.relFolder,
    libraryFolder: lib,
  }
}

/**
 * Which of the given subfolder names exist (as directories) inside a character's
 * folder — e.g. the configured Daz / Houdini subdirs, so the delete dialog only
 * offers to keep folders that are actually there. Returns the subset that exist.
 * Pass `folderAbs` (a caller that already resolved the location) to skip the scan.
 */
export async function existingCharacterSubfolders(
  lib: string,
  id: string,
  names: Array<string>,
  folderAbs?: string,
): Promise<Array<string>> {
  const dir = folderAbs ?? (await findEntry(lib, id))?.folderAbs
  if (!dir) return []
  const found: Array<string> = []
  for (const name of names) {
    if (name && (await isDir(join(dir, name)))) found.push(name)
  }
  return found
}

/**
 * Move/rename a folder on disk, creating the destination's parent first.
 * Collisions throw (the destination is user-chosen — never silently merged).
 */
export async function moveFolder(oldAbs: string, newAbs: string): Promise<void> {
  if (await isTaken(newAbs)) {
    throw new Error(`Something already exists at "${newAbs}".`)
  }
  const parent = newAbs.replace(/[\\/][^\\/]*$/, '')
  if (parent) await mkdir(parent, { recursive: true })
  await rename(oldAbs, newAbs)
}

/**
 * Move/rename a character by its definition path relative to the project library
 * (e.g. `Electra/Electra.json` → `Electra/OutfitDefault/Electra.json`). Moves the
 * whole folder to the new location and renames the definition to the new
 * filename. Collisions throw (the path is user-chosen — we don't silently rename
 * it, unlike create/title-rename which auto-suffix with ` (2)`).
 */
export async function moveCharacter(
  lib: string,
  id: string,
  relPath: string,
): Promise<{ location: CharacterLocation; character: Character }> {
  if (!lib) throw new Error('No project library configured.')
  const entry = await findEntry(lib, id)
  if (!entry) throw new Error(`Character ${id} not found`)

  const clean = normalizeRelPath(relPath) // separators, no '..' / absolute / illegal chars
  if (!/\.json$/i.test(clean)) throw new Error('The path must end in ".json".')
  const slash = clean.lastIndexOf('/')
  if (slash <= 0) throw new Error('Keep the character in a folder, e.g. "Electra/Electra.json".')
  const newFolderRel = clean.slice(0, slash)
  const newFileName = clean.slice(slash + 1)
  const newFolderAbs = join(lib, newFolderRel)
  const newDefAbs = join(newFolderAbs, newFileName)
  const oldDefName = basename(entry.definitionAbs)

  if (newDefAbs !== entry.definitionAbs) {
    // A case-only folder rename (kira → Kira) targets the SAME physical folder
    // on Windows, so the case-insensitive `exists` probes below would see the
    // destination as taken and refuse a rename that is perfectly fine. Mirror
    // saveCharacter's caseOnlyRename: rename in place, skip the probe. (Both
    // paths come '/'-joined out of `join`, so a plain lower-case compare is
    // exact.)
    const caseOnlyFolder =
      newFolderAbs !== entry.folderAbs &&
      newFolderAbs.toLowerCase() === entry.folderAbs.toLowerCase()
    if (newFolderAbs === entry.folderAbs || caseOnlyFolder) {
      // Same folder (possibly re-cased) — re-case it first when needed, then
      // rename the definition file (+ its notes, which are named after it).
      if (caseOnlyFolder) await rename(entry.folderAbs, newFolderAbs)
      const movedDef = join(newFolderAbs, oldDefName)
      if (newDefAbs !== movedDef) {
        // A case-only FILE rename also targets itself — probe only for a
        // genuinely different name.
        const caseOnlyFile = newDefAbs.toLowerCase() === movedDef.toLowerCase()
        if (!caseOnlyFile && (await exists(newDefAbs))) {
          throw new Error(`A file already exists at "${clean}".`)
        }
        await rename(movedDef, newDefAbs)
        const oldNotes = notesPathFor(movedDef)
        const newNotes = notesPathFor(newDefAbs)
        if (oldNotes !== newNotes && (await exists(oldNotes))) await rename(oldNotes, newNotes)
      }
    } else {
      // Moving the whole folder to a new location.
      if (await exists(newFolderAbs)) throw new Error(`A folder already exists at "${newFolderRel}".`)
      await mkdir(dirname(newFolderAbs), { recursive: true })
      if ((newFolderAbs + '/').startsWith(entry.folderAbs + '/')) {
        // Destination is inside the source — a dir can't be renamed into its own
        // descendant, so relocate via a temporary slot in the library root. Use a
        // UNIQUE slot (never blindly `remove()` an existing `.dth-moving`): a crash
        // between the two renames strands the WHOLE character there, and the old
        // unconditional delete would then destroy that stranded character on the
        // next descendant-move. A unique name leaves it recoverable instead.
        const tmp = await uniqueFolder(lib, '.dth-moving')
        await rename(entry.folderAbs, tmp)
        await mkdir(dirname(newFolderAbs), { recursive: true })
        await rename(tmp, newFolderAbs)
      } else {
        await rename(entry.folderAbs, newFolderAbs)
      }
      if (newFileName !== oldDefName) {
        await rename(join(newFolderAbs, oldDefName), newDefAbs)
        // The notes moved with the folder but still carry the old name.
        const movedNotes = notesPathFor(join(newFolderAbs, oldDefName))
        if (await exists(movedNotes)) await rename(movedNotes, notesPathFor(newDefAbs))
      }
    }
  }

  // Repoint EVERY in-folder path that travelled with the moved folder — scenes,
  // Houdini projects, the avatar-source scene, grooms, and scene overrides — not
  // just the primary scenePath (that omission orphaned outfit scenes/overrides on
  // a folder move, and the next save wrote the dead paths permanently). Paths
  // linked in place outside the folder are left untouched by the helper.
  let character = entry.character
  if (newFolderAbs !== entry.folderAbs) {
    const repointed = repointCharacterPaths(character, entry.folderAbs, newFolderAbs)
    if (JSON.stringify(repointed) !== JSON.stringify(character)) {
      character = repointed
      await writeTextFileAtomic(newDefAbs, JSON.stringify(character, null, 2) + '\n')
    }
  }

  return {
    location: {
      definitionAbs: newDefAbs,
      folderAbs: newFolderAbs,
      relFolder: newFolderRel,
      libraryFolder: lib,
    },
    character,
  }
}

/**
 * Stamp the DTH release a character's PoseAsset CSV was just generated for into
 * its definition JSON (the `generatedDthVersion` provenance). Writes the RAW
 * stored JSON back with only that one field updated — it never migrates / re-stamps
 * the rest — so generating the CSV records its era without disturbing anything
 * else. No-op when the character can't be found or the value is unchanged.
 */
export async function setGeneratedDthVersion(
  lib: string,
  id: string,
  version: string,
  // Known definition path (a caller that already resolved the location) — skips a scan.
  definitionAbs?: string,
): Promise<void> {
  const defAbs = definitionAbs ?? (await findEntry(lib, id))?.definitionAbs
  if (!defAbs) return
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(await readTextFile(defAbs))
  } catch {
    return
  }
  if (raw.generatedDthVersion === version) return
  raw.generatedDthVersion = version
  await writeTextFileAtomic(defAbs, JSON.stringify(raw, null, 2) + '\n')
}
