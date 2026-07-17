import {
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  rename,
  writeTextFile,
} from '@tauri-apps/plugin-fs'

import {
  CHARACTER_SCHEMA_VERSION,
  characterSchema,
  migrateCharacterData,
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
} from './fs'
import { studioVersion } from './app-data'
import { listRecents, readManifest } from './projects'
import type { Project } from './projects'

// The character library: scanning a project's folder for definitions and the
// CRUD around them (save/create/move/delete + the paths Generate writes into).

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

/**
 * Recursively scan the library for character definitions. A `.json` file is a
 * definition iff it parses as a character (generated `_FBMs.json` etc. fail the
 * schema and are skipped). De-duplicates by id (first match wins).
 */
async function scanLibrary(lib: string): Promise<Array<LibraryEntry>> {
  if (!lib || !(await isDir(lib))) return []
  const entries: Array<LibraryEntry> = []
  const seen = new Set<string>()
  for (const rel of await walkFiles(lib)) {
    if (!rel.toLowerCase().endsWith('.json')) continue
    const definitionAbs = join(lib, rel)
    let character: Character
    try {
      character = parseCharacter(JSON.parse(await readTextFile(definitionAbs)))
    } catch {
      continue // not a character definition
    }
    if (seen.has(character.id)) {
      console.warn(`Duplicate character id ${character.id} at ${definitionAbs} — ignoring.`)
      continue
    }
    seen.add(character.id)
    const relFolder = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
    entries.push({ folderAbs: join(lib, relFolder), definitionAbs, relFolder, character })
  }
  return entries
}

async function findEntry(lib: string, id: string): Promise<LibraryEntry | null> {
  return (await scanLibrary(lib)).find((entry) => entry.character.id === id) ?? null
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
  const entries = await scanLibrary(lib)
  return entries.map((entry) => entry.character).sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Every character notes file under the characters root (absolute paths).
 * Matched by the `.notes.md` suffix rather than via the definitions, so even a
 * notes file whose definition is temporarily unparseable still counts — the
 * media GC treats its `media://` references as live.
 */
export async function listNotesFiles(lib: string): Promise<Array<string>> {
  if (!lib || !(await isDir(lib))) return []
  const out: Array<string> = []
  for (const rel of await walkFiles(lib)) {
    if (rel.toLowerCase().endsWith('.notes.md')) out.push(join(lib, rel))
  }
  return out
}

export async function getCharacter(lib: string, id: string): Promise<Character | null> {
  return (await findEntry(lib, id))?.character ?? null
}

/**
 * Find a character by id across every project's library (ids are globally
 * unique). Used by ROM prefill, which can copy from a character in any project.
 */
export async function findCharacterAcrossProjects(id: string): Promise<Character | null> {
  for (const recent of await listRecents()) {
    const dir = dirname(recent.path)
    const manifest = await readManifest(dir)
    const root = manifest.charactersSubdir ? join(dir, manifest.charactersSubdir) : dir
    const found = await getCharacter(root, id)
    if (found) return found
  }
  return null
}

export async function saveCharacter(
  project: Project,
  character: Character,
  charactersRoot?: string,
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
  const existing = await findEntry(lib, character.id)

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
      const folderAbs = await uniqueFolder(dirname(existing.folderAbs), newName)
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
    const folderAbs = await uniqueFolder(lib, characterFolderName(character.name))
    await mkdir(folderAbs, { recursive: true })
    definitionAbs = join(folderAbs, definitionFileName(character.name))
  }

  // Repoint scenes / Houdini projects that lived inside the renamed folder to its
  // new location; a scene linked in place outside the folder is left untouched.
  if (folderMove) {
    const { from, to } = folderMove
    const repoint = (p: string): string => {
      const rel = relativeInside(from, p)
      return rel ? join(to, rel) : p
    }
    stamped.scenePath = repoint(stamped.scenePath)
    stamped.extraScenes = stamped.extraScenes.map(repoint)
    stamped.houdiniProjects = stamped.houdiniProjects.map(repoint)
    stamped.imageScene = repoint(stamped.imageScene)
  }

  await writeTextFile(definitionAbs, JSON.stringify(stamped, null, 2) + '\n')
  return stamped
}

/**
 * Create a new character at a chosen folder relative to the project root. An
 * empty `relFolder` stores the definition directly in the project root; a
 * non-empty one creates `<lib>/<relFolder>/` (auto-suffixed if it exists) to
 * hold the definition + all generated files. The definition is named after the
 * character (`<Name>.json`).
 */
export async function createCharacterAt(
  project: Project,
  character: Character,
  relFolder: string,
  charactersRoot?: string,
): Promise<Character> {
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
  if (clean) {
    const slash = clean.lastIndexOf('/')
    const parent = slash >= 0 ? join(lib, clean.slice(0, slash)) : lib
    const leaf = slash >= 0 ? clean.slice(slash + 1) : clean
    await mkdir(parent, { recursive: true })
    const folderAbs = await uniqueFolder(parent, leaf)
    await mkdir(folderAbs, { recursive: true })
    definitionAbs = join(folderAbs, fileName)
  } else {
    // Store directly in the project root.
    definitionAbs = join(lib, fileName)
    if (await isTaken(definitionAbs)) {
      throw new Error(`A character file "${fileName}" already exists in the project root.`)
    }
  }

  await writeTextFile(definitionAbs, JSON.stringify(stamped, null, 2) + '\n')
  return stamped
}

/**
 * Delete a character. By default removes its whole folder. `keepFolders` (top-
 * level subfolder names, e.g. the configured Daz / Houdini subdirs) are
 * preserved: every other top-level entry in the folder is removed, but those
 * subfolders are left on disk. When everything was kept (nothing else to remove)
 * the empty character folder itself stays. A definition dropped loosely at the
 * library root only ever has its own file removed (never the library).
 */
export async function deleteCharacter(
  lib: string,
  id: string,
  opts: { keepFolders?: Array<string> } = {},
): Promise<void> {
  const entry = await findEntry(lib, id)
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

  const keep = new Set((opts.keepFolders ?? []).map((f) => basename(f).toLowerCase()).filter(Boolean))
  if (keep.size === 0) {
    await remove(entry.folderAbs, { recursive: true })
    return
  }
  // Selective delete: drop every top-level entry except the kept subfolders.
  for (const child of await readDir(entry.folderAbs)) {
    if (child.isDirectory && keep.has(child.name.toLowerCase())) continue
    const abs = join(entry.folderAbs, child.name)
    if (await exists(abs)) await remove(abs, { recursive: true })
  }
}

/**
 * Relocate every character from `oldRoot` to `newRoot`, keeping each character's
 * folder name (and any sub-nesting) and repointing the scene / Houdini paths that
 * lived inside a moved folder so links don't break (mirrors a rename). Used when a
 * project's `charactersSubdir` changes — the character folders must follow it.
 * Only character folders / loose definitions move; other project files (the
 * `.dcsp`, `.dcsmeta`, `.assets`) are untouched. Returns how many moved.
 */
export async function moveCharactersRoot(oldRoot: string, newRoot: string): Promise<number> {
  const norm = (s: string) => s.replace(/\\/g, '/').replace(/\/+$/g, '')
  const from = norm(oldRoot)
  const to = norm(newRoot)
  if (!from || !to || from === to || !(await isDir(from))) return 0
  // When the new root nests inside the old one, leave characters already under it
  // alone (moving them by their old-relative path would double-nest them).
  const newInsideOld = (to + '/').startsWith(from + '/')
  await mkdir(to, { recursive: true })

  // Plan every move up front and check ALL destinations for collisions BEFORE
  // moving anything — so a collision on the third character can't leave the first
  // two stranded at the new root while the manifest still points at the old one.
  const plan: Array<{ src: string; dest: string; relFolder: string; defAbs: string }> = []
  for (const entry of await scanLibrary(from)) {
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

  let moved = 0
  for (const { src, dest, relFolder, defAbs: oldDefAbs } of plan) {
    await mkdir(dirname(dest), { recursive: true })
    await rename(src, dest)
    moved += 1
    // A folder-backed character carries its notes inside the folder; a loose
    // definition's `<Name>.notes.md` sits beside it and must move separately.
    if (!relFolder) {
      const srcNotes = notesPathFor(src)
      if (await exists(srcNotes)) await rename(srcNotes, notesPathFor(dest))
    }
    const entry = { relFolder, folderAbs: src, definitionAbs: oldDefAbs }
    // Repoint scenes / Houdini projects that travelled inside the moved folder.
    if (entry.relFolder) {
      try {
        const defAbs = join(dest, basename(entry.definitionAbs))
        const c = parseCharacter(JSON.parse(await readTextFile(defAbs)))
        const repoint = (p: string): string => {
          const rel = relativeInside(entry.folderAbs, p)
          return rel ? join(dest, rel) : p
        }
        const updated: Character = {
          ...c,
          scenePath: repoint(c.scenePath),
          extraScenes: c.extraScenes.map(repoint),
          houdiniProjects: c.houdiniProjects.map(repoint),
          imageScene: repoint(c.imageScene),
        }
        await writeTextFile(defAbs, JSON.stringify(updated, null, 2) + '\n')
      } catch {
        // best-effort — a parse/write hiccup leaves the moved paths as-is
      }
    }
  }
  return moved
}

/** Absolute path to a character's folder (created if missing) — Generate's target. */
export async function getCharacterFolder(lib: string, id: string): Promise<string> {
  const entry = await findEntry(lib, id)
  if (!entry) throw new Error(`Character ${id} not found`)
  await mkdir(entry.folderAbs, { recursive: true })
  return entry.folderAbs
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
 */
export async function existingCharacterSubfolders(
  lib: string,
  id: string,
  names: Array<string>,
): Promise<Array<string>> {
  const entry = await findEntry(lib, id)
  if (!entry) return []
  const found: Array<string> = []
  for (const name of names) {
    if (name && (await isDir(join(entry.folderAbs, name)))) found.push(name)
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
    if (newFolderAbs === entry.folderAbs) {
      // Same folder — just renaming the definition file (+ its notes, which are
      // named after it).
      if (await exists(newDefAbs)) throw new Error(`A file already exists at "${clean}".`)
      await rename(entry.definitionAbs, newDefAbs)
      const oldNotes = notesPathFor(entry.definitionAbs)
      if (await exists(oldNotes)) await rename(oldNotes, notesPathFor(newDefAbs))
    } else {
      // Moving the whole folder to a new location.
      if (await exists(newFolderAbs)) throw new Error(`A folder already exists at "${newFolderRel}".`)
      await mkdir(dirname(newFolderAbs), { recursive: true })
      if ((newFolderAbs + '/').startsWith(entry.folderAbs + '/')) {
        // Destination is inside the source — a dir can't be renamed into its own
        // descendant, so relocate via a temporary slot in the library root.
        const tmp = join(lib, '.dth-moving')
        if (await exists(tmp)) await remove(tmp, { recursive: true })
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

  // If the linked Daz scene lived inside the (now moved) character folder, it
  // travelled with it — repoint the stored scenePath at the new location. A
  // scene linked in place outside the character folder didn't move, so it's left
  // untouched.
  let character = entry.character
  if (newFolderAbs !== entry.folderAbs && character.scenePath) {
    const rel = relativeInside(entry.folderAbs, character.scenePath)
    if (rel) {
      character = { ...character, scenePath: join(newFolderAbs, rel) }
      await writeTextFile(newDefAbs, JSON.stringify(character, null, 2) + '\n')
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
): Promise<void> {
  const entry = await findEntry(lib, id)
  if (!entry) return
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(await readTextFile(entry.definitionAbs))
  } catch {
    return
  }
  if (raw.generatedDthVersion === version) return
  raw.generatedDthVersion = version
  await writeTextFile(entry.definitionAbs, JSON.stringify(raw, null, 2) + '\n')
}
