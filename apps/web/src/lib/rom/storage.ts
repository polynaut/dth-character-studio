import {
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  rename,
  stat,
  writeTextFile,
} from '@tauri-apps/plugin-fs'
import { appLocalDataDir } from '@tauri-apps/api/path'

import {
  ROM_SECTIONS,
  characterSchema,
  defaultSections,
  newId,
  sectionsFromFlatFrames,
} from '@dth/rom'

import { canonicalImage } from './image'
import { characterFolderName, definitionFileName, normalizeRelPath } from './library'

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

/** Join path segments with '/'. Tauri's fs normalizes separators on Windows. */
function join(...parts: Array<string>): string {
  return parts
    .map((p) => p.replace(/[\\/]+$/g, ''))
    .filter(Boolean)
    .join('/')
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
      data.resetGPBeforeApplying = options.resetGPBeforeApplying
    }
    data.sections = sections
    delete data.entries
    delete data.groups
    delete data.options
  }
  // The PoseAsset node knows no "none" suffix — older data migrates to centre.
  for (const config of Object.values(data.sections as Record<string, any>)) {
    for (const group of config?.groups ?? []) {
      if (group.suffix === 'none') group.suffix = 'centre'
    }
  }
  // Normalise avatar refs to the portable canonical form (filename or external
  // URL) — drops machine-specific asset/convertFileSrc URLs persisted earlier.
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

/** First folder name under `parent` that doesn't already exist (`Name`, `Name (2)`, …). */
async function uniqueFolder(parent: string, baseName: string): Promise<string> {
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? baseName : `${baseName} (${i})`
    const abs = join(parent, candidate)
    if (!(await exists(abs))) return abs
  }
}

export async function listCharacters(lib: string): Promise<Array<Character>> {
  const entries = await scanLibrary(lib)
  return entries.map((entry) => entry.character).sort((a, b) => a.name.localeCompare(b.name))
}

export async function getCharacter(lib: string, id: string): Promise<Character | null> {
  return (await findEntry(lib, id))?.character ?? null
}

export async function saveCharacter(lib: string, character: Character): Promise<Character> {
  if (!lib) throw new Error('No project library configured.')
  await mkdir(lib, { recursive: true })
  const stamped = { ...character, updatedAt: new Date().toISOString() }
  const existing = await findEntry(lib, character.id)

  let definitionAbs: string
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
    } else {
      definitionAbs = existing.definitionAbs
    }
  } else {
    const folderAbs = await uniqueFolder(lib, characterFolderName(character.name))
    await mkdir(folderAbs, { recursive: true })
    definitionAbs = join(folderAbs, definitionFileName(character.name))
  }

  await writeTextFile(definitionAbs, JSON.stringify(stamped, null, 2) + '\n')
  return stamped
}

export async function deleteCharacter(lib: string, id: string): Promise<void> {
  const entry = await findEntry(lib, id)
  if (!entry) return
  // Guard: a definition manually dropped at the library root has folderAbs ===
  // the library itself — only remove its file, never recursively wipe the library.
  if (entry.relFolder === '') {
    if (await exists(entry.definitionAbs)) await remove(entry.definitionAbs)
  } else if (await exists(entry.folderAbs)) {
    await remove(entry.folderAbs, { recursive: true })
  }
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
): Promise<CharacterLocation> {
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

  return {
    definitionAbs: newDefAbs,
    folderAbs: newFolderAbs,
    relFolder: newFolderRel,
    libraryFolder: lib,
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

/**
 * The DTH runtime files the generated character script `include()`s. Copied from
 * the DazToHue-Scripts checkout into the studio's shared scripts folder.
 * DthWorkflow.dsa pulls in the other three, so all four must sit together.
 */
const RUNTIME_FILES = ['DthUtils.dsa', 'DthOptions.dsa', 'ScanKeyFrames.dsa', 'DthWorkflow.dsa']

/** `<My DAZ 3D Library>/Scripts/DTH-Character-Studio` — the shared install folder. */
export function studioScriptsDir(dazLibraryFolder: string): string {
  return join(dazLibraryFolder, 'Scripts', 'DTH-Character-Studio')
}

/**
 * Install the DTH runtime files (from the DazToHue-Scripts checkout) into
 * `destDir`, creating it if missing. Overwrites so the runtime stays in sync as
 * the scripts evolve — they live once in the shared folder, not per character.
 */
export async function copyRuntimeFiles(srcDir: string, destDir: string): Promise<void> {
  if (!srcDir) {
    throw new Error('Set the DazToHue-Scripts folder in Settings to install the runtime.')
  }
  if (!(await isDir(srcDir))) throw new Error(`DazToHue-Scripts folder not reachable: ${srcDir}`)
  await mkdir(destDir, { recursive: true })
  for (const name of RUNTIME_FILES) {
    const src = join(srcDir, name)
    if (!(await exists(src))) throw new Error(`Missing runtime file in DazToHue-Scripts: ${name}`)
    await writeTextFile(join(destDir, name), await readTextFile(src))
  }
}

export interface StudioSettings {
  /**
   * "My DAZ 3D Library" — the user's Daz content library path. Asked on first
   * run; stored for a later feature (generating Daz scripts straight into it for
   * faster testing). Not yet otherwise wired.
   */
  dazLibraryFolder: string
  /** DazToHue-Scripts checkout — generated Daz files are written here, next to DthWorkflow.dsa. */
  dazScriptsFolder: string
  /** DazToHue Poses folder — scanned for the pre-defined pose preset catalog. */
  dthPosesFolder: string
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory
  } catch {
    return false
  }
}

/** Defaults for a fresh install: all folders empty. */
function defaultSettings(): StudioSettings {
  return { dazLibraryFolder: '', dazScriptsFolder: '', dthPosesFolder: '' }
}

export async function getSettings(): Promise<StudioSettings> {
  const defaults = defaultSettings()
  try {
    const raw = JSON.parse(await readTextFile(await dataPath('settings.json')))
    return {
      dazLibraryFolder:
        typeof raw.dazLibraryFolder === 'string' ? raw.dazLibraryFolder : defaults.dazLibraryFolder,
      dazScriptsFolder:
        typeof raw.dazScriptsFolder === 'string' ? raw.dazScriptsFolder : defaults.dazScriptsFolder,
      dthPosesFolder:
        typeof raw.dthPosesFolder === 'string' && raw.dthPosesFolder
          ? raw.dthPosesFolder
          : defaults.dthPosesFolder,
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
}

async function readProjects(): Promise<Array<Project>> {
  try {
    const raw = JSON.parse(await readTextFile(await dataPath('projects.json')))
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (p): p is Project =>
        p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.path === 'string',
    )
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

export async function getProject(id: string): Promise<Project | null> {
  return (await readProjects()).find((p) => p.id === id) ?? null
}

export async function createProject(name: string, path: string): Promise<Project> {
  if (!name.trim()) throw new Error('Project name is required.')
  if (!path.trim()) throw new Error('Project folder is required.')
  const projects = await readProjects()
  const project: Project = { id: newId(), name: name.trim(), path: path.trim() }
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

export async function deleteProject(id: string): Promise<void> {
  await writeProjects((await readProjects()).filter((p) => p.id !== id))
}

/** Recursively collect file paths (relative to `root`, '/'-separated). */
async function walkFiles(root: string, rel = ''): Promise<Array<string>> {
  const here = rel ? join(root, rel) : root
  const out: Array<string> = []
  for (const entry of await readDir(here)) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory) out.push(...(await walkFiles(root, childRel)))
    else out.push(childRel)
  }
  return out
}

/**
 * Scans the DazToHue Poses folder and classifies every .duf preset by genesis
 * generation, skinning variant and pose asset category. The folder layout is
 * `<Genesis X>/<Common|DQS|Linear>/...`.
 */
export async function listPoseAssets(): Promise<{
  folder: string
  assets: Array<DthPoseAsset>
  error: string | null
}> {
  const { dthPosesFolder } = await getSettings()
  if (!dthPosesFolder) {
    return { folder: '', assets: [], error: 'No DTH release / Poses folder configured.' }
  }
  if (!(await isDir(dthPosesFolder))) {
    return { folder: dthPosesFolder, assets: [], error: `Folder not reachable: ${dthPosesFolder}` }
  }
  // Accept either the Poses folder itself or a DTH release root
  // (e.g. ".../Release 2.4.3", which contains Daz Studio Content/DazToHue/Poses).
  let posesFolder = dthPosesFolder
  const looksLikePoses = (
    await Promise.all(
      ['Genesis 3', 'Genesis 8', 'Genesis 8.1', 'Genesis 9'].map((g) =>
        isDir(join(posesFolder, g)),
      ),
    )
  ).some(Boolean)
  if (!looksLikePoses) {
    const releaseContent = join(posesFolder, 'Daz Studio Content', 'DazToHue', 'Poses')
    if (await isDir(releaseContent)) posesFolder = releaseContent
  }
  const entries = await walkFiles(posesFolder)
  const assets: Array<DthPoseAsset> = []
  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith('.duf')) continue
    const relPath = entry
    const parts = relPath.split('/')
    const fileName = parts[parts.length - 1]
    const name = fileName.replace(/\.duf$/i, '')

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

    assets.push({
      name,
      relPath,
      genesis,
      skinning,
      section,
      includesFac: section === 'JCM' && /FAC/i.test(name),
    })
  }
  assets.sort((a, b) => a.relPath.localeCompare(b.relPath))
  return { folder: posesFolder, assets, error: null }
}
