import {
  exists,
  mkdir,
  readDir,
  readFile,
  readTextFile,
  remove,
  rename,
  stat,
  writeFile,
  writeTextFile,
} from '@tauri-apps/plugin-fs'
import { appLocalDataDir } from '@tauri-apps/api/path'
import { getVersion } from '@tauri-apps/api/app'

import {
  CHARACTER_SCHEMA_VERSION,
  ROM_SECTIONS,
  characterSchema,
  defaultSections,
  newId,
  sectionsFromFlatFrames,
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
// source; a future runtime-version constant will flag when a studio update needs
// to refresh them.
import dthUtilsRuntime from './runtime/DthUtils.dsa?raw'
import dthOptionsRuntime from './runtime/DthOptions.dsa?raw'
import dthWorkflowRuntime from './runtime/DthWorkflow.dsa?raw'

import type { Character, DthPoseAsset, GenesisVersion, RomSection } from '@dth/rom'

/**
 * Storage, backed by the Tauri fs plugin, split across two roots:
 *
 *  - **App folder** = the per-user app-local data dir (e.g.
 *    %LOCALAPPDATA%/com.polynaut.dthcharacterstudio). Holds app-owned data:
 *    `settings.json`, `projects.json`, and `images/` (avatars). Created on first
 *    run.
 *  - **Project library** = each project's user-chosen folder (`Project.path`),
 *    kept OUTSIDE the app folder so the user can back it up. Each character is a
 *    folder named after it (`<library>/<Name>/`) holding the definition
 *    `<Name>.json` plus its generated artifacts. Discovery is a recursive scan —
 *    no registry — so a folder's location simply *is* the character's location.
 *    The character functions below all take the active project's `libraryPath`.
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
 * Migrates older data files to the sections model:
 *  v1: flat `entries`  v2: `groups` (with section field) + `options` flags.
 */
function parseCharacter(raw: unknown): Character {
  const data = raw as Record<string, any>
  if (data.sections) {
    // v3 stored a GEN presetVariant instead of selected preset asset files.
    const gen = data.sections.GEN
    if (gen?.presetVariant && !gen.presetAssets) {
      gen.presetAssets =
        gen.presetVariant === 'both'
          ? ['GP9 - Golden Palace.duf', 'DK9 - Dicktator.duf']
          : gen.presetVariant === 'dk'
            ? ['DK9 - Dicktator.duf']
            : ['GP9 - Golden Palace.duf']
    }
  }
  if (!data.sections) {
    const sections = Array.isArray(data.entries)
      ? sectionsFromFlatFrames(data.entries)
      : defaultSections()
    if (Array.isArray(data.groups)) {
      for (const group of data.groups) {
        const section: RomSection = (ROM_SECTIONS as ReadonlyArray<string>).includes(group.section)
          ? group.section
          : 'MISC'
        const { section: _ignored, ...rest } = group
        sections[section].enabled = true
        sections[section].mode = 'custom'
        sections[section].groups.push(rest)
      }
    }
    const options = data.options ?? {}
    if (options.includeJCM === false) {
      sections.RET.enabled = false
      if (sections.JCM.mode === 'preset') sections.JCM.enabled = false
    }
    if (options.includeFAC === false && sections.FAC.mode === 'preset') {
      sections.FAC.enabled = false
    }
    if ((options.includeGP || options.includeDK) && sections.GEN.mode === 'preset') {
      sections.GEN.enabled = true
      sections.GEN.presetAssets = [
        ...(options.includeGP ? ['GP9 - Golden Palace.duf'] : []),
        ...(options.includeDK ? ['DK9 - Dicktator.duf'] : []),
      ]
    }
    if (typeof options.resetGPBeforeApplying === 'boolean') {
      data.resetGenBeforeApplying = options.resetGPBeforeApplying
    }
    data.sections = sections
    delete data.entries
    delete data.groups
    delete data.options
  }
  // Field renamed resetGPBeforeApplying → resetGenBeforeApplying (now generic
  // over GP/DK); carry forward characters saved under the old name.
  if (data.resetGPBeforeApplying !== undefined && data.resetGenBeforeApplying === undefined) {
    data.resetGenBeforeApplying = data.resetGPBeforeApplying
  }
  delete data.resetGPBeforeApplying
  // The PoseAsset node knows no "none" suffix — older data migrates to centre.
  for (const config of Object.values(data.sections as Record<string, any>)) {
    for (const group of config?.groups ?? []) {
      if (group.suffix === 'none') group.suffix = 'centre'
    }
  }
  // Normalise avatar refs to the portable canonical form (filename or external
  // URL) — drops machine-specific asset/convertFileSrc URLs persisted earlier.
  data.image = canonicalImage(data.image)
  // Future migration framework: branch on `data.schemaVersion` (absent → 1) to
  // upgrade older shapes to CHARACTER_SCHEMA_VERSION before the parse below. The
  // shape fix-ups above are the implicit "pre-versioning → v1" migration.
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
  for (const project of await listProjects()) {
    const found = await getCharacter(project.path, id)
    if (found) return found
  }
  return null
}

export async function saveCharacter(project: Project, character: Character): Promise<Character> {
  const lib = project.path
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
): Promise<Character> {
  const lib = project.path
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
 * Duplicate a character within the same library: a fresh id + a unique name
 * a new folder, and a copy of the ROM definition under the given `name`. ALL
 * asset references (primary + extra Daz scenes, Houdini projects) are cleared
 * here — the caller decides which to bring across (copying local Daz scenes,
 * keeping linked ones). Returns the new character; the caller copies the avatar,
 * links/copies scenes, and regenerates files.
 */
export async function cloneCharacter(
  project: Project,
  id: string,
  name: string,
): Promise<Character> {
  const lib = project.path
  if (!lib) throw new Error('No project library configured.')
  const source = await getCharacter(lib, id)
  if (!source) throw new Error(`Character ${id} not found`)
  const cloneName = name.trim() || `${source.name} copy`
  const now = new Date().toISOString()
  const clone: Character = {
    ...source,
    id: newId(),
    name: cloneName,
    scenePath: '',
    extraScenes: [],
    houdiniProjects: [],
    createdAt: now,
    updatedAt: now,
  }
  return createCharacterAt(project, clone, cloneName)
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
}

/** `<My DAZ 3D Library>/Scripts/DTH-Character-Studio` — the shared install root,
 *  holding the DTH runtime files (installed once) at its top level. */
export function studioScriptsDir(dazLibraryFolder: string): string {
  return join(dazLibraryFolder, 'Scripts', 'DTH-Character-Studio')
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
  // Clean up earlier non-hidden copies (and the now-merged ScanKeyFrames.dsa)
  // the studio installed before runtime files were dot-prefixed.
  for (const legacy of [...Object.keys(RUNTIME_FILES), 'ScanKeyFrames.dsa']) {
    const old = join(destDir, legacy)
    if (await exists(old)) await remove(old)
  }
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
  /** Default subfolder a copied Daz scene lands in, under the character folder. */
  dazSubdir: string
  /** Name of the empty Houdini folder seeded into each new character (a nudge to
   *  create the character's Houdini project there). Gated by `createHoudiniSubdir`. */
  houdiniSubdir: string
  /** Whether to seed the empty Houdini folder when a character is created. */
  createHoudiniSubdir: boolean
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
    dazSubdir: 'daz3d',
    houdiniSubdir: 'houdini',
    createHoudiniSubdir: true,
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
// Each game project is { id, name, path }; the path is that project's character
// library. The list is app-folder metadata (projects.json). Deleting a project
// removes only its record — never the user's files on disk.

export interface Project {
  id: string
  name: string
  path: string
  /** ISO timestamp the project was added; absent for projects created before
   *  this was tracked (those sort oldest under "by date"). */
  createdAt?: string
}

async function readProjects(): Promise<Array<Project>> {
  try {
    const raw = JSON.parse(await readTextFile(await dataPath('projects.json')))
    if (!Array.isArray(raw)) return []
    return raw
      .filter(
        (p): p is Project =>
          p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.path === 'string',
      )
      .map((p) => ({ ...p, ...(typeof p.createdAt === 'string' ? { createdAt: p.createdAt } : {}) }))
  } catch {
    return []
  }
}

async function writeProjects(projects: Array<Project>): Promise<void> {
  await ensureAppDir()
  await writeTextFile(await dataPath('projects.json'), JSON.stringify(projects, null, 2) + '\n')
}

export async function listProjects(): Promise<Array<Project>> {
  return (await readProjects()).sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The folder's filesystem creation time as an ISO string — a fallback "created"
 * date for projects added before `createdAt` was tracked. Falls back to the
 * modified time, then `undefined` when the folder can't be stat'd.
 */
export async function folderCreatedAt(path: string): Promise<string | undefined> {
  if (!path) return undefined
  try {
    const info = await stat(path)
    const when = info.birthtime ?? info.mtime
    return when ? new Date(when).toISOString() : undefined
  } catch {
    return undefined
  }
}

export async function getProject(id: string): Promise<Project | null> {
  return (await readProjects()).find((p) => p.id === id) ?? null
}

export async function createProject(name: string, path: string): Promise<Project> {
  if (!name.trim()) throw new Error('Project name is required.')
  if (!path.trim()) throw new Error('Project folder is required.')
  const projects = await readProjects()
  const project: Project = {
    id: newId(),
    name: name.trim(),
    path: path.trim(),
    createdAt: new Date().toISOString(),
  }
  projects.push(project)
  await writeProjects(projects)
  await mkdir(project.path, { recursive: true })
  return project
}

export async function updateProject(
  id: string,
  patch: { name?: string; path?: string },
): Promise<Project> {
  const projects = await readProjects()
  const idx = projects.findIndex((p) => p.id === id)
  if (idx < 0) throw new Error(`Project ${id} not found`)
  projects[idx] = {
    ...projects[idx],
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.path !== undefined ? { path: patch.path.trim() } : {}),
  }
  await writeProjects(projects)
  return projects[idx]
}

/**
 * Remove a project. Its generated-scripts subfolder in the Daz library is ALWAYS
 * removed (a derived artifact that's orphaned once the project is gone). With
 * `deleteFiles`, the project's library folder (all character data) is deleted
 * too; otherwise only the list entry goes and the data stays on disk. The
 * library folder is removed before the record so a failure leaves the project
 * visible to retry.
 */
export async function deleteProject(
  id: string,
  opts: { deleteFiles?: boolean } = {},
): Promise<void> {
  const projects = await readProjects()
  const project = projects.find((p) => p.id === id)
  if (project) {
    if (opts.deleteFiles) {
      const folder = join(project.path)
      if (await exists(folder)) await remove(folder, { recursive: true })
    }
    // Always drop the generated-scripts subfolder (keyed by project name) — it's
    // derived data, so best-effort (never fail the delete on it).
    const { dazLibraryFolder } = await getSettings()
    if (dazLibraryFolder) {
      const scripts = join(studioScriptsDir(dazLibraryFolder), characterFolderName(project.name))
      try {
        if (await exists(scripts)) await remove(scripts, { recursive: true })
      } catch {
        // leave orphaned generated scripts rather than failing the delete
      }
    }
  }
  await writeProjects(projects.filter((p) => p.id !== id))
}

/**
 * Move a filesystem entry (file or directory) from `src` to `dst`: a fast rename
 * first, falling back to a recursive copy + delete when rename can't apply (e.g.
 * across drives).
 */
async function moveEntry(src: string, dst: string): Promise<void> {
  try {
    await rename(src, dst)
    return
  } catch {
    // cross-volume / un-renamable — copy then remove the source below.
  }
  if (await isDir(src)) {
    await mkdir(dst, { recursive: true })
    for (const rel of await walkFiles(src)) {
      const target = join(dst, rel)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, await readFile(join(src, rel)))
    }
  } else {
    await mkdir(dirname(dst), { recursive: true })
    await writeFile(dst, await readFile(src))
  }
  await remove(src, { recursive: true })
}

/**
 * Re-home a project to a different folder, keeping all of its characters' data
 * and references intact (the project's name is unchanged — that's `updateProject`).
 * Every top-level entry of the old library is moved into the new one, then each
 * character JSON has its in-folder asset paths (Daz scenes / Houdini projects
 * stored inside the character folder) repointed to the new location and its
 * `projectPath` provenance refreshed. Scenes linked in place outside the project
 * folder are left untouched.
 */
export async function moveProject(id: string, newPath: string): Promise<Project> {
  const projects = await readProjects()
  const idx = projects.findIndex((p) => p.id === id)
  if (idx < 0) throw new Error(`Project ${id} not found`)
  if (!newPath.trim()) throw new Error('Project folder is required.')
  const name = projects[idx].name

  const from = join(projects[idx].path) // normalise separators / trailing slash
  const to = join(newPath)
  if (from.toLowerCase() === to.toLowerCase()) return projects[idx] // same folder — no-op

  // Never move a folder into itself or its own subtree.
  const a = (from + '/').toLowerCase()
  const b = (to + '/').toLowerCase()
  if (b.startsWith(a) || a.startsWith(b)) {
    throw new Error('Choose a folder outside the current project folder.')
  }
  await mkdir(to, { recursive: true })
  if (await isDir(from)) {
    for (const entry of await readDir(from)) {
      const src = join(from, entry.name)
      const dst = join(to, entry.name)
      if (await exists(dst)) {
        throw new Error(`"${entry.name}" already exists in the target folder.`)
      }
      await moveEntry(src, dst)
    }
  }
  // Repoint each moved character's in-folder paths + provenance.
  for (const entry of await scanLibrary(to)) {
    const c = entry.character
    const repoint = (p: string): string => {
      const rel = relativeInside(from, p)
      return rel ? join(to, rel) : p
    }
    const updated: Character = {
      ...c,
      scenePath: repoint(c.scenePath),
      extraScenes: c.extraScenes.map(repoint),
      houdiniProjects: c.houdiniProjects.map(repoint),
      projectName: name,
      projectPath: to,
    }
    await writeTextFile(entry.definitionAbs, JSON.stringify(updated, null, 2) + '\n')
  }

  projects[idx] = { ...projects[idx], path: to }
  await writeProjects(projects)
  return projects[idx]
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

// --- Pose catalog (cached) ------------------------------------------------
// Walking a DTH release folder is slow — and with many releases it made opening
// a character take seconds. So scanning runs ONCE (explicitly, from Settings)
// and the classified presets are cached in pose-catalog.json. Opening or
// generating a character reads only that cache; it never walks the release.

interface PoseCatalog {
  /** The dthPosesFolder setting at scan time. */
  sourceFolder: string
  /** The release that was scanned (folder or zip name), e.g. "Release 2.4.3". */
  releaseName: string
  /** Dotted version of the scanned release, e.g. "2.4.3". */
  version: string
  /** The Poses folder (or the .zip path) that was scanned. */
  posesFolder: string
  scannedAt: string
  assets: Array<DthPoseAsset>
}

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

/** Walk + classify an extracted Poses folder into pose assets. */
async function scanPosesFolder(posesFolder: string): Promise<Array<DthPoseAsset>> {
  const entries = await walkFiles(posesFolder)
  const assets = entries
    .filter((entry) => entry.toLowerCase().endsWith('.duf'))
    .map((entry) => classifyPose(entry))
  assets.sort((a, b) => a.relPath.localeCompare(b.relPath))
  return assets
}

/**
 * Explicitly (re)build the cached pose catalog from the configured DTH release
 * folder: resolve the latest release, scan + classify its presets, and write
 * pose-catalog.json into the app folder. Slow, but only runs from Settings.
 */
export async function buildPoseCatalog(): Promise<{
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
  const assets = await scanPosesFolder(posesFolder)
  const catalog: PoseCatalog = {
    sourceFolder: dthPosesFolder,
    releaseName: resolved.releaseName,
    version: resolved.version,
    posesFolder,
    scannedAt: new Date().toISOString(),
    assets,
  }
  await ensureAppDir()
  await writeTextFile(await dataPath('pose-catalog.json'), JSON.stringify(catalog, null, 2) + '\n')
  return { folder: posesFolder, releaseName: resolved.releaseName, version: resolved.version, assets, error: null }
}

/**
 * The cached pose catalog used wherever a character is opened or generated.
 * Reads pose-catalog.json — it NEVER walks the release folder (that only happens
 * in buildPoseCatalog, from Settings). Returns an error directing the user to
 * Settings when the catalog hasn't been built yet.
 */
export async function listPoseAssets(): Promise<{
  folder: string
  assets: Array<DthPoseAsset>
  error: string | null
}> {
  try {
    const catalog = JSON.parse(await readTextFile(await dataPath('pose-catalog.json'))) as PoseCatalog
    if (!Array.isArray(catalog.assets)) throw new Error('bad catalog')
    return { folder: catalog.posesFolder, assets: catalog.assets, error: null }
  } catch {
    return { folder: '', assets: [], error: 'No pose catalog yet — scan a DTH release in Settings' }
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
 * + "My DAZ 3D Library" (required) + the Houdini documents folder (optional).
 */
export async function resolveReleaseInstall(): Promise<ReleaseInstall> {
  const s = await getSettings()
  const errors: Array<string> = []
  const release = await resolveActiveReleaseRoot(s.dthPosesFolder, s.currentDthVersion)
  if (release.error || !release.releaseRoot) {
    errors.push(release.error ?? 'No DTH release resolved — set the DTH release folder.')
  }
  if (!s.dazLibraryFolder) errors.push('Set “My DAZ 3D Library”.')
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
