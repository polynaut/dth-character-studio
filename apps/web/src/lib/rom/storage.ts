import {
  exists,
  mkdir,
  readDir,
  readFile,
  readTextFile,
  remove,
  rename,
  stat,
  writeTextFile,
} from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import { appLocalDataDir } from '@tauri-apps/api/path'
import { getVersion } from '@tauri-apps/api/app'

import {
  CHARACTER_SCHEMA_VERSION,
  characterSchema,
  migrateCharacterData,
  newId,
} from '@dth/rom'

import { canonicalImage } from './image'
import {
  characterFolderName,
  definitionFileName,
  normalizeRelFolder,
  normalizeRelPath,
} from './library'
// The DTH runtime (DazToHue-Scripts) is bundled into the app so the studio is
// self-contained — no external checkout to configure. copyRuntimeFiles installs
// these (rewritten + dot-prefixed). Keep them in sync with the DazToHue-Scripts
// source; bump RUNTIME_VERSION (@dth/rom) when they change so Refresh assets flags
// characters whose generated scripts need regenerating.
import dthUtilsRuntime from './runtime/DthUtils.dsa?raw'
import dthOptionsRuntime from './runtime/DthOptions.dsa?raw'
import dthWorkflowRuntime from './runtime/DthWorkflow.dsa?raw'
import dthProductsRuntime from './runtime/DthProducts.dsa?raw'
import dthScanMorphsRuntime from './runtime/DthScanMorphs.dsa?raw'
import scanMorphsG9 from './runtime/Scan_Morphs_G9.dsa?raw'
import scanMorphsG81 from './runtime/Scan_Morphs_G8.1.dsa?raw'
import scanMorphsG8 from './runtime/Scan_Morphs_G8.dsa?raw'
import scanMorphsG3 from './runtime/Scan_Morphs_G3.dsa?raw'

import { characterScriptName } from '@dth/rom'
import type { Character, DthPoseAsset, GenesisVersion, RomSection } from '@dth/rom'

/**
 * Storage, backed by the Tauri fs plugin, split across two roots:
 *
 *  - **App folder** = the per-user app-local data dir (e.g.
 *    %LOCALAPPDATA%/com.polynaut.dthcharacterstudio). Holds only *volatile /
 *    machine-specific* data: `settings.json` (machine/tool paths), `recents.json`
 *    (the recently-opened-projects list) and `network-drives.json`. Created on
 *    first run.
 *  - **Project** = a user-chosen folder marked by a single `.dcsp` manifest file,
 *    scattered anywhere on disk and backed up by the user. Beside the manifest live
 *    the character folders (`<dir>/<Name>/` holding `<Name>.json` + generated
 *    artifacts) and a hidden `.dcsmeta/` of app-managed meta (avatars). Discovery
 *    is a recursive scan — no registry — so a folder's location simply *is* the
 *    project's location. The character functions below take the project's folder.
 */

/**
 * Join path segments with '/', normalising any '\' to '/'. A consistent
 * forward-slash path matters for the Tauri fs *scope* check: a not-yet-existing
 * path can't be canonicalised, so the raw string is matched against the `**`
 * scope — and a mixed-separator string (e.g. `X:\proj/New`) fails to match.
 */
function join(...parts: Array<string>): string {
  return parts
    .map((p) => p.replace(/\\/g, '/').replace(/\/+$/g, ''))
    .filter(Boolean)
    .join('/')
}

/**
 * If `child` lives inside `parent`, return its path relative to `parent`
 * ('/'-joined); otherwise null. Separator-agnostic and case-insensitive (matches
 * Windows semantics), so it works regardless of how either path was stored.
 */
function relativeInside(parent: string, child: string): string | null {
  const segs = (p: string) => p.replace(/\\/g, '/').split('/').filter(Boolean)
  const p = segs(parent)
  const c = segs(child)
  if (c.length <= p.length) return null
  for (let i = 0; i < p.length; i++) {
    if (c[i].toLowerCase() !== p[i].toLowerCase()) return null
  }
  return c.slice(p.length).join('/')
}

/** Last path segment (folder or file name). */
function basename(p: string): string {
  return p.replace(/[\\/]+$/g, '').split(/[\\/]/).pop() ?? p
}

/** Everything but the last path segment. */
function dirname(p: string): string {
  const norm = p.replace(/[\\/]+$/g, '')
  const idx = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'))
  return idx >= 0 ? norm.slice(0, idx) : norm
}

let dataDirPromise: Promise<string> | null = null
async function dataDir(): Promise<string> {
  if (!dataDirPromise) {
    dataDirPromise = appLocalDataDir().then((d) => d.replace(/[\\/]+$/g, ''))
  }
  return dataDirPromise
}

/** Resolve a path inside the per-user data directory. */
export async function dataPath(...parts: Array<string>): Promise<string> {
  return join(await dataDir(), ...parts)
}

/**
 * The FOLDER a character's product-scan CSVs are written into and read back from,
 * under app-local-data: `product-scans/<projectId>/<characterId>/`. Keyed by the
 * stable `.dcsp` manifest id + character UUID (not names), so it survives renames
 * and folder moves. The generated `Scan_Products_<Name>.dsa` writes one CSV per
 * Daz scene into here (named after the open scene); the character page reads every
 * CSV and merges them. Both sides MUST resolve it through here so they agree.
 */
export async function productScanDir(
  projectId: string,
  characterId: string,
): Promise<string> {
  return dataPath('product-scans', projectId, characterId)
}

let versionPromise: Promise<string> | null = null
/** The DTH Character Studio app version, cached; '' when unavailable (e.g. the
 *  web-only build with no native layer). Stamped onto saved characters and the
 *  generated Daz scripts for traceability. */
export async function studioVersion(): Promise<string> {
  if (!versionPromise) versionPromise = getVersion().catch(() => '')
  return versionPromise
}

/** Ensure the app-data folder exists (it holds settings.json and images/). */
async function ensureAppDir(): Promise<void> {
  await mkdir(await dataDir(), { recursive: true })
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
 * Whether `path` already exists — or can't be confirmed absent. Tauri's `exists`
 * *throws* (rather than returning false) for a path it can't canonicalize for
 * the fs scope check, e.g. a locked / delete-pending folder on a network share.
 * Treat that as taken so callers skip the name instead of crashing.
 */
async function isTaken(path: string): Promise<boolean> {
  try {
    return await exists(path)
  } catch {
    return true
  }
}

/**
 * First folder name under `parent` that isn't taken (`Name`, `Name (2)`, …).
 * A pre-existing folder — including one that's locked / mid-delete and so can't
 * even be probed — just bumps the numeric suffix. Capped so a wholly
 * inaccessible parent fails loudly instead of spinning forever.
 */
async function uniqueFolder(parent: string, baseName: string): Promise<string> {
  for (let i = 1; i <= 9999; i++) {
    const candidate = i === 1 ? baseName : `${baseName} (${i})`
    const abs = join(parent, candidate)
    if (!(await isTaken(abs))) return abs
  }
  throw new Error(`Could not find a free folder name for "${baseName}" in ${parent}.`)
}

export async function listCharacters(lib: string): Promise<Array<Character>> {
  const entries = await scanLibrary(lib)
  return entries.map((entry) => entry.character).sort((a, b) => a.name.localeCompare(b.name))
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
      // Same folder — just renaming the definition file.
      if (await exists(newDefAbs)) throw new Error(`A file already exists at "${clean}".`)
      await rename(entry.definitionAbs, newDefAbs)
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
      if (newFileName !== oldDefName) await rename(join(newFolderAbs, oldDefName), newDefAbs)
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

/** Writes files into a folder, creating it if missing. */
export async function writeFilesToFolder(
  folder: string,
  files: Array<{ fileName: string; content: string }>,
): Promise<void> {
  await mkdir(folder, { recursive: true })
  await Promise.all(files.map((file) => writeTextFile(join(folder, file.fileName), file.content)))
}

/** Remove the named files from a folder if present (no error when missing). */
export async function removeFilesFromFolder(
  folder: string,
  fileNames: Array<string>,
): Promise<void> {
  for (const name of fileNames) {
    const path = join(folder, name)
    if (await exists(path)) await remove(path)
  }
}

/**
 * The DTH runtime files the generated character script `include()`s. Copied from
 * the DazToHue-Scripts checkout into the studio's shared scripts folder, where
 * they're dot-prefixed (hidden) so the user-facing character scripts stand out.
 * DthWorkflow.dsa pulls in the other two (ScanKeyFrames is now merged into it),
 * so all three must sit together.
 */
/** The bundled DTH runtime files (name → raw source), installed by copyRuntimeFiles. */
const RUNTIME_FILES: Record<string, string> = {
  'DthUtils.dsa': dthUtilsRuntime,
  'DthOptions.dsa': dthOptionsRuntime,
  'DthWorkflow.dsa': dthWorkflowRuntime,
  // Product-scan runtime — used only by the generated Scan_Products_<Name>.dsa
  // (the Daz Products feature), but installed for every project (harmless when off).
  'DthProducts.dsa': dthProductsRuntime,
  // Morph-scanner runtime — included by the VISIBLE Scan_Morphs_<Genesis>.dsa
  // wrappers below; feeds the Morph-name autocomplete's per-generation index.
  'DthScanMorphs.dsa': dthScanMorphsRuntime,
}

/**
 * The visible per-generation morph-scan scripts, installed AS-IS at the
 * DTH-Character-Studio root (they run there, so they include
 * `.DthScanMorphs.dsa` directly — no `../../` rewrite), with the studio's
 * app-data folder baked into their output path at install time.
 */
const SCAN_MORPH_SCRIPTS: Record<string, string> = {
  'Scan_Morphs_G9.dsa': scanMorphsG9,
  'Scan_Morphs_G8.1.dsa': scanMorphsG81,
  'Scan_Morphs_G8.dsa': scanMorphsG8,
  'Scan_Morphs_G3.dsa': scanMorphsG3,
}

/** `<My DAZ 3D Library>/Scripts/DTH-Character-Studio` — the shared install root,
 *  holding the DTH runtime files (installed once) at its top level. */
export function studioScriptsDir(dazLibraryFolder: string): string {
  return join(dazLibraryFolder, 'Scripts', 'DTH-Character-Studio')
}

/** `<My DAZ 3D Library>/Scripts/DazToHue-Scripts` — where the soltude/DazToHue-Scripts
 *  repo is downloaded + unpacked (Tools installer). Separate from the studio's own
 *  bundled DTH-Character-Studio runtime root above. */
export function daztohueScriptsDir(dazLibraryFolder: string): string {
  return join(dazLibraryFolder, 'Scripts', 'DazToHue-Scripts')
}

/** The commit SHA recorded in the installed DazToHue-Scripts version marker
 *  (`<daztohueScriptsDir>/.dth-version.json`, written by the Rust installer), or
 *  null when the scripts aren't installed / the marker is missing or unreadable.
 *  Living inside the install folder makes it the ground truth: delete the install
 *  and the marker goes with it, so we never claim something stale is installed. */
export async function readDazToHueScriptsCommit(dazLibraryFolder: string): Promise<string | null> {
  const lib = dazLibraryFolder.trim()
  if (!lib) return null
  try {
    const raw = await readTextFile(join(daztohueScriptsDir(lib), '.dth-version.json'))
    const parsed = JSON.parse(raw) as { commit?: unknown }
    return typeof parsed.commit === 'string' && parsed.commit ? parsed.commit : null
  } catch {
    return null // not installed, no marker, or unreadable — all "unknown locally"
  }
}

/** Whether a DazToHue-Scripts install exists on disk at all, regardless of whether
 *  it carries a version marker — lets the UI tell a pre-versioning install (files
 *  present, installed before we tracked commits) apart from no install at all. */
export async function daztohueScriptsPresent(dazLibraryFolder: string): Promise<boolean> {
  const lib = dazLibraryFolder.trim()
  if (!lib) return false
  try {
    return await exists(daztohueScriptsDir(lib))
  } catch {
    return false
  }
}

/**
 * Per-character script folder: `<root>/<project>/<character>/`. The generated
 * `<Name>_<Genesis>.dsa` lives here and imports the runtime from the root two
 * levels up. Both segments are filesystem-sanitised from the display names.
 */
export function studioCharScriptsDir(
  dazLibraryFolder: string,
  projectName: string,
  characterName: string,
): string {
  return join(
    studioScriptsDir(dazLibraryFolder),
    characterFolderName(projectName),
    characterFolderName(characterName),
  )
}

/**
 * Install the bundled DTH runtime files into `destDir` (the DTH-Character-Studio
 * root), creating it if missing. They're written dot-prefixed (`.DthWorkflow.dsa`
 * etc.) so they read as hidden, and the sibling `include()` references inside
 * them are rewritten so resolution still works from a character script two levels
 * deep — see the rewrite below. Overwrites so the runtime stays current with the
 * app version.
 */
export async function copyRuntimeFiles(destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true })
  for (const [name, raw] of Object.entries(RUNTIME_FILES)) {
    // The runtime files include each other via `dir_self.filePath("Dep.dsa")`,
    // where dir_self comes from getScriptFileName() — which, inside an include(),
    // is the TOP-LEVEL character script at <root>/<project>/<character>/, two
    // levels below this runtime root. So rewrite each sibling reference to the
    // dot-prefixed name AND climb `../../` back to the root where it lives
    // (mirrors the character script's own `../../.DthWorkflow.dsa` include).
    let content = raw
    for (const dep of Object.keys(RUNTIME_FILES)) {
      content = content.split(`"${dep}"`).join(`"../../.${dep}"`)
    }
    await writeTextFile(join(destDir, `.${name}`), content)
  }
  // The visible Scan_Morphs_<Genesis>.dsa scripts: installed as-is (they run at
  // this root — their include of `.DthScanMorphs.dsa` resolves right here), with
  // the studio's app-data folder baked into the JSON output path so the scan
  // lands where the Morph-name autocomplete reads it (DzFile wants '/').
  const appData = (await dataDir()).replace(/\\/g, '/')
  for (const [name, raw] of Object.entries(SCAN_MORPH_SCRIPTS)) {
    await writeTextFile(join(destDir, name), raw.split('__DTH_APPDATA_DIR__').join(appData))
  }
  // Clean up earlier non-hidden copies (and the now-merged ScanKeyFrames.dsa)
  // the studio installed before runtime files were dot-prefixed. Scan_Morphs
  // wrappers are exempt — they're MEANT to be visible.
  for (const legacy of [...Object.keys(RUNTIME_FILES), 'ScanKeyFrames.dsa']) {
    const old = join(destDir, legacy)
    if (await exists(old)) await remove(old)
  }
}

/**
 * Read the `// DTH-Runtime: vN` marker from a character's generated Daz script to
 * learn which runtime produced the scripts on disk: the integer `N`; `0` when a
 * script exists but predates the marker (an older runtime); `null` when no script
 * exists yet. The DTH release is no longer stamped here — the scripts are
 * release-independent (tied to RUNTIME_VERSION only); the release the PoseAsset
 * CSV was generated for lives in the character JSON's `generatedDthVersion`.
 */
export async function readScriptRuntimeVersion(
  dazLibraryFolder: string,
  projectName: string,
  character: Character,
): Promise<number | null> {
  const dir = studioCharScriptsDir(dazLibraryFolder, projectName, character.name)
  const base = characterScriptName(character)
  // The main ROM script is either combined (`<base>.dsa`) or, when the export is
  // split out, `ROM_<base>.dsa`. Either carries the runtime marker in its header.
  for (const name of [`${base}.dsa`, `ROM_${base}.dsa`]) {
    const path = join(dir, name)
    if (await exists(path)) {
      const runtime = /DTH-Runtime:\s*v(\d+)/.exec(await readTextFile(path))
      return runtime ? Number(runtime[1]) : 0
    }
  }
  return null
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

export interface StudioSettings {
  /**
   * "My DAZ 3D Library" — the user's Daz content library path. Asked on first
   * run; stored for a later feature (generating Daz scripts straight into it for
   * faster testing). Not yet otherwise wired.
   */
  dazLibraryFolder: string
  /**
   * A DTH release folder (contains `copyright.txt`), or a folder of versioned
   * releases (release folders and/or `.zip`s). Scanned for the pose catalog.
   */
  dthPosesFolder: string
  /**
   * Selected DTH release version (e.g. "2.4.3") when `dthPosesFolder` holds
   * several releases. Empty = not chosen yet. Persisting the pick stops a newly
   * dropped-in release from silently becoming the active one.
   */
  currentDthVersion: string
  /**
   * The DTH Exporter Plugin folder (contains `dth_exporter.dll`), or a folder of
   * versioned plugin folders. Stored for reference; the version is read from the
   * DLL rather than the folder name.
   */
  dthExporterFolder: string
  /**
   * Selected Exporter Plugin version (the DLL's FileVersion, e.g. "1.0.0.1"), or
   * a folder name fallback when a plugin folder carries no version resource.
   * Empty = not chosen / none detected.
   */
  currentDthExporterVersion: string
  /**
   * Where Daz Studio is installed (e.g. `C:/Program Files/DAZ 3D/DAZStudio4`).
   * Optional — the DTH install drops the exporter plugin DLLs into its `plugins`
   * subfolder.
   */
  dazInstallFolder: string
  /**
   * The Houdini documents folder (e.g. `D:/User Data/Documents/houdini20.5`).
   * Optional — the DTH install merges the release's Houdini assets
   * (otls/presets/toolbar) into it.
   */
  houdiniDocsFolder: string
  /**
   * The DAZ Install Manager `ManifestFiles` folder (a folder of `.dsx` XML), read
   * by the Daz Products scan to resolve scene assets to installed products
   * (name/SKU/artist/version). Machine-specific; empty = unset (the scan then runs
   * but reports every asset as unmatched).
   */
  dimManifestsFolder: string
  // Per-project behaviour defaults (dazSubdir / houdiniSubdir / createHoudiniSubdir)
  // now live in each project's .dcsp manifest (see DcspManifest), not in app-global
  // settings — they describe a project, not the machine.
  // --- "Optional" tab: install your own Daz/Houdini content (not DTH release) ---
  /**
   * Your Daz asset source folders. Each is scanned for content folders
   * (`data`/`People`/`Runtime`/`Documentation`, `.zip` assets extracted) and
   * installed into `dazLibraryFolder`. A flat list — generation is auto-detected.
   */
  dazAssetsFolders: Array<string>
  /** Custom morphs (Daz Transfer Shape Utility output): source folder + its
   *  destination (your personal "…/Studio/My Library/data/Daz 3D"). */
  dazMorphsSource: string
  dazMorphsDest: string
  /** Daz presets: source folder + destination ("…/Studio/My Library/Presets"). */
  dazPresetsSource: string
  dazPresetsDest: string
  /** Houdini `my_presets` source — copied into the Houdini docs folder and wired
   *  into its `houdini.env` (`SHARED_PRESETS` + `HOUDINI_PATH`). */
  houdiniPresetsSource: string
  /** Destination-relative file paths the user has "accepted" as legitimately
   *  shared between products (e.g. a vendor icon, cross-product textures). Both
   *  the asset scan/install and the dedup skip these, so they stop showing as
   *  "to copy" / as a conflict — the file stays whatever is installed. */
  acceptedConflicts: Array<string>
  /** Where the dedup moves redundant duplicate copies. Required to run Apply —
   *  nothing is quarantined until this is set. */
  dedupQuarantineFolder: string
  /** "Danger zone" — folders the Daz uninstall cleanup deletes (pre-filled from
   *  the dth-cli defaults, then user-editable). */
  dazUninstallFolders: Array<string>
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory
  } catch {
    return false
  }
}

/** Defaults for a fresh install: all folders empty, no release version chosen. */
function defaultSettings(): StudioSettings {
  return {
    dazLibraryFolder: '',
    dthPosesFolder: '',
    currentDthVersion: '',
    dthExporterFolder: '',
    currentDthExporterVersion: '',
    dazInstallFolder: '',
    houdiniDocsFolder: '',
    dimManifestsFolder: '',
    dazAssetsFolders: [],
    dazMorphsSource: '',
    dazMorphsDest: '',
    dazPresetsSource: '',
    dazPresetsDest: '',
    houdiniPresetsSource: '',
    acceptedConflicts: [],
    dedupQuarantineFolder: '',
    dazUninstallFolders: [],
  }
}

export async function getSettings(): Promise<StudioSettings> {
  const defaults = defaultSettings()
  try {
    const raw = JSON.parse(await readTextFile(await dataPath('settings.json')))
    return {
      dazLibraryFolder:
        typeof raw.dazLibraryFolder === 'string' ? raw.dazLibraryFolder : defaults.dazLibraryFolder,
      dthPosesFolder:
        typeof raw.dthPosesFolder === 'string' && raw.dthPosesFolder
          ? raw.dthPosesFolder
          : defaults.dthPosesFolder,
      currentDthVersion:
        typeof raw.currentDthVersion === 'string'
          ? raw.currentDthVersion
          : defaults.currentDthVersion,
      dthExporterFolder:
        typeof raw.dthExporterFolder === 'string'
          ? raw.dthExporterFolder
          : defaults.dthExporterFolder,
      currentDthExporterVersion:
        typeof raw.currentDthExporterVersion === 'string'
          ? raw.currentDthExporterVersion
          : defaults.currentDthExporterVersion,
      dazInstallFolder:
        typeof raw.dazInstallFolder === 'string'
          ? raw.dazInstallFolder
          : defaults.dazInstallFolder,
      houdiniDocsFolder:
        typeof raw.houdiniDocsFolder === 'string'
          ? raw.houdiniDocsFolder
          : defaults.houdiniDocsFolder,
      dimManifestsFolder:
        typeof raw.dimManifestsFolder === 'string'
          ? raw.dimManifestsFolder
          : defaults.dimManifestsFolder,
      dazAssetsFolders: Array.isArray(raw.dazAssetsFolders)
        ? raw.dazAssetsFolders.filter((f: unknown): f is string => typeof f === 'string')
        : defaults.dazAssetsFolders,
      dazMorphsSource:
        typeof raw.dazMorphsSource === 'string' ? raw.dazMorphsSource : defaults.dazMorphsSource,
      dazMorphsDest:
        typeof raw.dazMorphsDest === 'string' ? raw.dazMorphsDest : defaults.dazMorphsDest,
      dazPresetsSource:
        typeof raw.dazPresetsSource === 'string' ? raw.dazPresetsSource : defaults.dazPresetsSource,
      dazPresetsDest:
        typeof raw.dazPresetsDest === 'string' ? raw.dazPresetsDest : defaults.dazPresetsDest,
      houdiniPresetsSource:
        typeof raw.houdiniPresetsSource === 'string'
          ? raw.houdiniPresetsSource
          : defaults.houdiniPresetsSource,
      acceptedConflicts: Array.isArray(raw.acceptedConflicts)
        ? raw.acceptedConflicts.filter((f: unknown): f is string => typeof f === 'string')
        : defaults.acceptedConflicts,
      dedupQuarantineFolder:
        typeof raw.dedupQuarantineFolder === 'string'
          ? raw.dedupQuarantineFolder
          : defaults.dedupQuarantineFolder,
      dazUninstallFolders: Array.isArray(raw.dazUninstallFolders)
        ? raw.dazUninstallFolders.filter((f: unknown): f is string => typeof f === 'string')
        : defaults.dazUninstallFolders,
    }
  } catch {
    return defaults
  }
}

export async function saveSettings(settings: StudioSettings): Promise<StudioSettings> {
  await ensureAppDir()
  await writeTextFile(await dataPath('settings.json'), JSON.stringify(settings, null, 2) + '\n')
  return settings
}

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
}

function manifestDefaults(dir: string): DcspManifest {
  return {
    schemaVersion: DCSP_SCHEMA_VERSION,
    id: '',
    name: basename(dir),
    createdAt: '',
    dazSubdir: 'daz3d',
    houdiniSubdir: 'houdini',
    createHoudiniSubdir: true,
    assetsEnabled: false,
    dazProductsEnabled: false,
    charactersSubdir: '',
  }
}

/** Filesystem-safe `.dcsp` file name from a project's display name. */
function dcspFileName(name: string): string {
  return `${characterFolderName(name.trim()) || 'project'}.${DCSP_EXT}`
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

/** Read a project's `.dcsp` manifest (filling defaults for missing/old fields). */
export async function readManifest(dir: string): Promise<DcspManifest> {
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
      dazSubdir:
        typeof raw.dazSubdir === 'string' && raw.dazSubdir ? raw.dazSubdir : defaults.dazSubdir,
      houdiniSubdir:
        typeof raw.houdiniSubdir === 'string' && raw.houdiniSubdir
          ? raw.houdiniSubdir
          : defaults.houdiniSubdir,
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
      charactersSubdir:
        typeof raw.charactersSubdir === 'string'
          ? raw.charactersSubdir
          : defaults.charactersSubdir,
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
  } catch {
    return defaults
  }
}

/** Write a project's manifest, reusing the existing `.dcsp` file name if present. */
export async function writeManifest(dir: string, manifest: DcspManifest): Promise<DcspManifest> {
  await mkdir(dir, { recursive: true })
  const existing = await findManifestPath(dir)
  const path = existing ?? join(dir, dcspFileName(manifest.name))
  await writeTextFile(path, JSON.stringify(manifest, null, 2) + '\n')
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
  await writeTextFile(path, JSON.stringify(manifest, null, 2) + '\n')
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
  await writeTextFile(await dataPath('recents.json'), JSON.stringify(recents, null, 2) + '\n')
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

// --- Assets ---------------------------------------------------------------
// A library of reusable Daz scenes ("assets") — starting points to build
// characters on. They live per level: globally in the app-data folder, or inside
// a project's folder, both under a hidden `.assets/` directory holding a small
// `assets.json` registry plus, for copied assets, the scene files themselves. A
// linked asset keeps its scene where it is and just records the path.

export interface DazAsset {
  id: string
  /** Display name (defaults to the scene's file name; user-editable). */
  name: string
  /** Absolute path to the asset's Daz scene (.duf) — inside `.assets` when copied,
   *  wherever the user picked it when linked. */
  scenePath: string
  description: string
  /** Subfolder under `.assets` the scene was copied into ('' = directly in
   *  `.assets`; unused for a linked asset). */
  subfolder: string
  /** true = scene lives outside `.assets` (linked in place); false = copied in. */
  linked: boolean
  createdAt: string
  updatedAt: string
}

/** The hidden `.assets` folder under a level root (the app-data dir, or a project). */
export function assetsDir(base: string): string {
  return join(base, '.assets')
}

async function readAssetRegistry(base: string): Promise<Array<DazAsset>> {
  try {
    const raw = JSON.parse(await readTextFile(join(assetsDir(base), 'assets.json')))
    if (!Array.isArray(raw)) return []
    return raw
      .filter(
        (a): a is Partial<DazAsset> & Pick<DazAsset, 'id' | 'scenePath'> =>
          a && typeof a.id === 'string' && typeof a.scenePath === 'string',
      )
      .map((a) => ({
        id: a.id,
        name: a.name ?? '',
        scenePath: a.scenePath,
        description: a.description ?? '',
        subfolder: a.subfolder ?? '',
        linked: a.linked ?? true,
        createdAt: a.createdAt ?? '',
        updatedAt: a.updatedAt ?? '',
      }))
  } catch {
    return []
  }
}

async function writeAssetRegistry(base: string, assets: Array<DazAsset>): Promise<void> {
  await mkdir(assetsDir(base), { recursive: true })
  await writeTextFile(join(assetsDir(base), 'assets.json'), JSON.stringify(assets, null, 2) + '\n')
}

export async function listAssets(base: string): Promise<Array<DazAsset>> {
  return (await readAssetRegistry(base)).sort((a, b) => a.name.localeCompare(b.name))
}

export async function addAsset(base: string, asset: DazAsset): Promise<DazAsset> {
  const assets = await readAssetRegistry(base)
  assets.push(asset)
  await writeAssetRegistry(base, assets)
  return asset
}

export async function updateAsset(base: string, asset: DazAsset): Promise<DazAsset> {
  const assets = await readAssetRegistry(base)
  const idx = assets.findIndex((a) => a.id === asset.id)
  if (idx < 0) throw new Error(`Asset ${asset.id} not found`)
  const updated = { ...asset, updatedAt: new Date().toISOString() }
  assets[idx] = updated
  await writeAssetRegistry(base, assets)
  return updated
}

export async function removeAsset(
  base: string,
  id: string,
  opts: { keepFiles?: boolean } = {},
): Promise<void> {
  const assets = await readAssetRegistry(base)
  const asset = assets.find((a) => a.id === id)
  if (!asset) return
  // A copied asset owns its scene files under `.assets` — remove them unless the
  // caller opts to keep them. A linked asset points outside `.assets`, so its
  // source is never touched.
  if (!asset.linked && !opts.keepFiles) {
    const dir = asset.subfolder ? join(assetsDir(base), asset.subfolder) : assetsDir(base)
    const duf = basename(asset.scenePath)
    const stem = duf.replace(/\.duf$/i, '')
    for (const sidecar of [duf, `${duf}.png`, `${duf}.tip.png`, `${stem}.tip.png`, `${stem}.png`]) {
      const p = join(dir, sidecar)
      try {
        if (await exists(p)) await remove(p)
      } catch {
        // leave a stray file rather than failing the delete
      }
    }
  }
  await writeAssetRegistry(
    base,
    assets.filter((a) => a.id !== id),
  )
}

/** Recursively collect file paths (relative to `root`, '/'-separated). */
async function walkFiles(root: string, rel = ''): Promise<Array<string>> {
  const here = rel ? join(root, rel) : root
  let listing: Awaited<ReturnType<typeof readDir>>
  try {
    listing = await readDir(here)
  } catch (err) {
    // A locked, permission-restricted, or delete-pending folder (common on
    // network shares — e.g. a directory whose delete is still pending because a
    // handle stays open) makes readDir throw. Tauri even reports it as a
    // "forbidden path" because it can't canonicalize the path for its scope
    // check. Skip the subtree so one unreadable folder can't blank the whole
    // library overview.
    console.warn(`Skipping unreadable folder ${here}: ${err}`)
    return []
  }
  const out: Array<string> = []
  for (const entry of listing) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory) out.push(...(await walkFiles(root, childRel)))
    else out.push(childRel)
  }
  return out
}

// --- Pose asset scan ------------------------------------------------------
// The active release's Poses folder is walked natively (Rust scan_duf_files) and
// classified here on demand — there is no on-disk catalog to build or go stale.
// The scan is tiny and fast (a handful of .duf files), so the frontend keeps the
// result in memory for the session and re-scans when the release selection
// changes (see api.fetchPoseAssets / rescanPoseAssets).

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
async function resolveActiveRelease(
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

/**
 * Classify one pose preset by its path relative to the Poses root
 * (`<Genesis X>/<DQS|Linear>/...`): genesis generation, skinning variant and ROM
 * section.
 */
function classifyPose(relPath: string): DthPoseAsset {
  const parts = relPath.split('/')
  const name = parts[parts.length - 1].replace(/\.duf$/i, '')
  const genesis: GenesisVersion | null =
    parts[0] === 'Genesis 3'
      ? 'G3'
      : parts[0] === 'Genesis 8'
        ? 'G8'
        : parts[0] === 'Genesis 8.1'
          ? 'G8.1'
          : parts[0] === 'Genesis 9'
            ? 'G9'
            : null
  const skinning = parts[1] === 'DQS' ? 'dqs' : parts[1] === 'Linear' ? 'linear' : null
  let section: RomSection | null = null
  if (/retargett?ing poses/i.test(name)) section = 'RET'
  else if (/JCM( FAC)? - Base/i.test(name)) section = 'JCM'
  else if (/FAC - Mouth/i.test(name)) section = 'FAC'
  else if (parts.some((p) => /golden ?palace|dicktator/i.test(p))) section = 'GEN'
  else if (parts.some((p) => /physics/i.test(p))) section = 'PHY'
  return {
    name,
    relPath,
    genesis,
    skinning,
    section,
    includesFac: section === 'JCM' && /FAC/i.test(name),
  }
}

/** Recursively list `.duf` paths under a Poses folder via the native walk (one
 *  IPC call; rel paths are '/'-separated, relative to `posesFolder`). */
async function scanDufPaths(posesFolder: string): Promise<Array<string>> {
  return invoke<Array<string>>('scan_duf_files', { folder: posesFolder })
}

/**
 * Scan + classify the active DTH release's pose presets, live. Resolves the
 * selected release under the configured folder, walks its Poses folder natively,
 * and classifies each `.duf`. Nothing is persisted — callers keep the result in
 * memory for the session (see api.fetchPoseAssets / rescanPoseAssets). Returns a
 * setup error (which ConfigError turns into a "change in Settings" link) when no
 * release is configured or it's unreachable.
 */
export async function scanPoseAssets(): Promise<{
  folder: string
  releaseName: string
  version: string
  assets: Array<DthPoseAsset>
  error: string | null
}> {
  const empty = { folder: '', releaseName: '', version: '', assets: [] as Array<DthPoseAsset> }
  const { dthPosesFolder, currentDthVersion } = await getSettings()
  if (!dthPosesFolder) {
    return { ...empty, error: 'No DTH release folder configured' }
  }
  if (!(await isDir(dthPosesFolder))) {
    return { ...empty, folder: dthPosesFolder, error: `Folder not reachable: ${dthPosesFolder}` }
  }
  const resolved = await resolveActiveRelease(dthPosesFolder, currentDthVersion)
  if (resolved.error) {
    return {
      ...empty,
      folder: dthPosesFolder,
      releaseName: resolved.releaseName,
      version: resolved.version,
      error: resolved.error,
    }
  }
  const posesFolder = resolved.posesFolder
  if (!(await isDir(posesFolder))) {
    return {
      ...empty,
      folder: dthPosesFolder,
      releaseName: resolved.releaseName,
      version: resolved.version,
      error: `Release "${resolved.releaseName}" has no Poses folder (expected at ${posesFolder})`,
    }
  }
  const assets = (await scanDufPaths(posesFolder))
    .map((relPath) => classifyPose(relPath))
    .sort((a, b) => a.relPath.localeCompare(b.relPath))
  return { folder: posesFolder, releaseName: resolved.releaseName, version: resolved.version, assets, error: null }
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
): Promise<ReleaseInstall> {
  const s = await getSettings()
  const errors: Array<string> = []
  const release = await resolveActiveReleaseRoot(s.dthPosesFolder, s.currentDthVersion)
  if (release.error || !release.releaseRoot) {
    errors.push(release.error ?? 'No DTH release resolved — set the DTH release folder.')
  }
  if (target !== 'houdini' && !s.dazLibraryFolder) errors.push('Set “My DAZ 3D Library”.')
  if (target === 'houdini' && !s.houdiniDocsFolder) errors.push('Set the Houdini documents folder.')
  return {
    releaseRoot: release.releaseRoot,
    releaseName: release.name,
    releaseVersion: release.version,
    dazLibFolder: s.dazLibraryFolder,
    houdiniDocsFolder: s.houdiniDocsFolder,
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

// --- Known network drives (metadata) --------------------------------------
// Mapped network drives (X: → \\host\share) live in the user's logon session,
// so an elevated relaunch loses them. We remember each one's UNC as paths are
// picked (network-drives.json) and re-map the missing ones on startup — see the
// WNet commands in apps/desktop.

export interface KnownDrive {
  /** Drive specifier, upper-cased, e.g. "X:". */
  drive: string
  /** UNC target, e.g. "\\jebpot\devs". */
  unc: string
}

async function readKnownDrives(): Promise<Array<KnownDrive>> {
  try {
    const raw = JSON.parse(await readTextFile(await dataPath('network-drives.json')))
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (d): d is KnownDrive => d && typeof d.drive === 'string' && typeof d.unc === 'string',
    )
  } catch {
    return []
  }
}

async function writeKnownDrives(drives: Array<KnownDrive>): Promise<void> {
  await ensureAppDir()
  await writeTextFile(await dataPath('network-drives.json'), JSON.stringify(drives, null, 2) + '\n')
}

export async function listKnownDrives(): Promise<Array<KnownDrive>> {
  return (await readKnownDrives()).sort((a, b) => a.drive.localeCompare(b.drive))
}

/** Upsert a drive→UNC mapping, keyed by drive letter (case-insensitive). */
export async function rememberDrive(drive: string, unc: string): Promise<void> {
  const key = drive.trim().toUpperCase()
  const target = unc.trim()
  if (!key || !target) return
  const drives = await readKnownDrives()
  const idx = drives.findIndex((d) => d.drive.toUpperCase() === key)
  if (idx >= 0) {
    if (drives[idx].unc === target) return // unchanged — skip the write
    drives[idx] = { drive: key, unc: target }
  } else {
    drives.push({ drive: key, unc: target })
  }
  await writeKnownDrives(drives)
}

export async function forgetDrive(drive: string): Promise<void> {
  const key = drive.trim().toUpperCase()
  await writeKnownDrives((await readKnownDrives()).filter((d) => d.drive.toUpperCase() !== key))
}
