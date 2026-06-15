import { mkdir, readDir, readTextFile, remove, stat, writeFile } from '@tauri-apps/plugin-fs'
import { convertFileSrc } from '@tauri-apps/api/core'
import { z } from 'zod'

import { generateAll, resolveRomPaths } from '@dth/rom'
import * as storage from './storage'
import { dataPath } from './storage'
import { isExternalImage } from './image'
import {
  characterSchema,
  genderSchema,
  genesisVersionSchema,
  morphSchema,
  newId,
  sectionsFromFlatFrames,
} from '@dth/rom'

import type { Character } from '@dth/rom'
import type { StudioSettings } from './storage'

export type { CharacterLocation, Project } from './storage'

/**
 * Client data layer — the only bridge between the React UI and the filesystem.
 * Backed by the Tauri fs/dialog plugins (no Node/server). Functions keep the
 * `{ data }` call convention the route components use. Character operations are
 * scoped to a **project**: callers pass `projectId`, which resolves to that
 * project's library path (avatars stay global in the app folder).
 */

function joinPath(...parts: Array<string>): string {
  return parts
    .map((p) => p.replace(/[\\/]+$/g, ''))
    .filter(Boolean)
    .join('/')
}

function basename(p: string): string {
  return p.replace(/[\\/]+$/g, '').split(/[\\/]/).pop() ?? p
}

/** Resolve a project id to its library path (throws if the project is gone). */
async function projectPath(projectId: string): Promise<string> {
  const project = await storage.getProject(projectId)
  if (!project) throw new Error(`Project ${projectId} not found`)
  return project.path
}

// --- Projects -------------------------------------------------------------

const projectIdInput = z.object({ projectId: z.string().min(1) })

export async function fetchProjects(): Promise<Array<storage.Project>> {
  return storage.listProjects()
}

export async function fetchProject({ data }: { data: unknown }): Promise<storage.Project | null> {
  return storage.getProject(projectIdInput.parse(data).projectId)
}

const createProjectInput = z.object({ name: z.string().min(1), path: z.string().min(1) })

export async function createProject({ data }: { data: unknown }): Promise<storage.Project> {
  const { name, path } = createProjectInput.parse(data)
  return storage.createProject(name, path)
}

const updateProjectInput = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  path: z.string().optional(),
})

export async function updateProject({ data }: { data: unknown }): Promise<storage.Project> {
  const { id, name, path } = updateProjectInput.parse(data)
  return storage.updateProject(id, { name, path })
}

export async function deleteProject({ data }: { data: unknown }): Promise<void> {
  await storage.deleteProject(z.object({ id: z.string().min(1) }).parse(data).id)
}

// --- Characters (scoped to a project) -------------------------------------

const charScopeInput = z.object({ projectId: z.string().min(1), id: z.string().min(1) })

export async function fetchCharacters({ data }: { data: unknown }): Promise<Array<Character>> {
  return storage.listCharacters(await projectPath(projectIdInput.parse(data).projectId))
}

export async function fetchCharacter({ data }: { data: unknown }): Promise<Character | null> {
  const { projectId, id } = charScopeInput.parse(data)
  return storage.getCharacter(await projectPath(projectId), id)
}

const createInput = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  genesis: genesisVersionSchema,
  gender: genderSchema,
})

export async function createCharacter({ data }: { data: unknown }): Promise<Character> {
  const input = createInput.parse(data)
  const now = new Date().toISOString()
  const character: Character = characterSchema.parse({
    id: newId(),
    name: input.name,
    genesis: input.genesis,
    gender: input.gender,
    createdAt: now,
    updatedAt: now,
  })
  return storage.saveCharacter(await projectPath(input.projectId), character)
}

const saveInput = z.object({ projectId: z.string().min(1), character: z.unknown() })

export async function saveCharacter({ data }: { data: unknown }): Promise<Character> {
  const { projectId, character } = saveInput.parse(data)
  return storage.saveCharacter(await projectPath(projectId), characterSchema.parse(character))
}

export async function deleteCharacter({ data }: { data: unknown }): Promise<void> {
  const { projectId, id } = charScopeInput.parse(data)
  await storage.deleteCharacter(await projectPath(projectId), id)
}

/** Shape of an existing DazToHue-Scripts FBM file (e.g. ElectraG9_FBMs.json). */
const fbmJsonSchema = z.object({
  meta: z.object({ resetGPBeforeApplying: z.boolean().optional() }).optional(),
  frames: z.array(
    z.object({
      frame: z.number(),
      section: z.string(),
      name: z.string(),
      morphs: z.array(morphSchema),
    }),
  ),
})

const importInput = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  genesis: genesisVersionSchema,
  gender: genderSchema,
  /** Absolute path to an existing *_FBMs.json on this machine. */
  filePath: z.string().min(1),
})

/** Seeds a new character from an existing DazToHue-Scripts FBM JSON file. */
export async function importCharacterFromJson({ data }: { data: unknown }): Promise<Character> {
  const input = importInput.parse(data)
  const raw = fbmJsonSchema.parse(JSON.parse(await readTextFile(input.filePath)))
  const now = new Date().toISOString()
  const character: Character = characterSchema.parse({
    id: newId(),
    name: input.name,
    genesis: input.genesis,
    gender: input.gender,
    createdAt: now,
    updatedAt: now,
    sections: sectionsFromFlatFrames([...raw.frames].sort((a, b) => a.frame - b.frame)),
  })
  if (raw.meta?.resetGPBeforeApplying !== undefined) {
    character.resetGPBeforeApplying = raw.meta.resetGPBeforeApplying
  }
  return storage.saveCharacter(await projectPath(input.projectId), character)
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
}

const uploadImageInput = z.object({
  characterId: z.string().min(1),
  mimeType: z.string(),
  /** Raw image data, base64 (no data-URL prefix). Capped at ~10 MB. */
  dataBase64: z.string().max(14_000_000),
})

/**
 * Stores a dropped avatar image under <data>/images/ and returns its bare
 * filename — the portable canonical reference saved on the character (see
 * ./image). Avatars are global (keyed by character id), not per-project.
 */
export async function uploadCharacterImage({ data }: { data: unknown }): Promise<string> {
  const input = uploadImageInput.parse(data)
  const extension = IMAGE_EXTENSIONS[input.mimeType]
  if (!extension) throw new Error(`Unsupported image type: ${input.mimeType}`)
  const dir = await dataPath('images')
  await mkdir(dir, { recursive: true })
  const id = basename(input.characterId)
  // One avatar per character — drop stale variants with other extensions.
  for (const entry of await readDir(dir)) {
    if (entry.isFile && entry.name.startsWith(id) && !entry.name.endsWith(extension)) {
      await remove(joinPath(dir, entry.name))
    }
  }
  const fileName = `${id}${extension}`
  const bytes = Uint8Array.from(atob(input.dataBase64), (c) => c.charCodeAt(0))
  await writeFile(joinPath(dir, fileName), bytes)
  return fileName
}

/**
 * Turns a stored `image` reference (see ./image) into a URL the webview can
 * load. External URLs pass through unchanged; a local filename resolves to its
 * asset URL under <data>/images/ with an mtime cache-buster. Returns '' when the
 * local file is missing so the UI falls back to the initial-letter placeholder.
 */
export async function resolveImageSrc(image: string): Promise<string> {
  if (!image) return ''
  if (isExternalImage(image)) return image
  const filePath = await dataPath('images', image)
  try {
    const info = await stat(filePath)
    const version = info.mtime ? `?v=${info.mtime.getTime()}` : ''
    return `${convertFileSrc(filePath)}${version}`
  } catch {
    return ''
  }
}

// --- Settings + catalog ---------------------------------------------------

export async function fetchSettings(): Promise<StudioSettings> {
  return storage.getSettings()
}

/** The cached DTH pose preset catalog (read from appdata; never walks the release). */
export async function fetchPoseAssets(): Promise<ReturnType<typeof storage.listPoseAssets>> {
  return storage.listPoseAssets()
}

/**
 * Rebuild the cached pose catalog: resolve the latest DTH release in the
 * configured folder, scan + classify its presets, and persist them. Slow —
 * invoked explicitly from Settings, not on every character open.
 */
export async function buildPoseCatalog(): Promise<ReturnType<typeof storage.buildPoseCatalog>> {
  return storage.buildPoseCatalog()
}

const settingsInput = z.object({
  dazLibraryFolder: z.string(),
  dazScriptsFolder: z.string(),
  dthPosesFolder: z.string(),
})

export async function saveSettings({ data }: { data: unknown }): Promise<StudioSettings> {
  return storage.saveSettings(settingsInput.parse(data))
}

/**
 * Compiles the character into its DTH artifacts and writes them to two places:
 *  - the Houdini PoseAsset CSV → the character's own folder (next to its
 *    definition JSON), and
 *  - the self-contained Daz script (<Name>_<Genesis>.dsa) → the shared
 *    `<My DAZ 3D Library>/Scripts/DTH-Character-Studio` folder, into which the
 *    DTH runtime files it imports are also installed (copied from the
 *    DazToHue-Scripts checkout). Returns the files so the UI can offer downloads.
 */
export async function generateCharacterFiles({ data }: { data: unknown }): Promise<{
  outDir: string
  files: ReturnType<typeof generateAll>
  scriptsDir: string | null
  scriptsError: string | null
}> {
  const { projectId, id } = charScopeInput.parse(data)
  const lib = await projectPath(projectId)
  const character = await storage.getCharacter(lib, id)
  if (!character) throw new Error(`Character ${id} not found`)
  // Exact ROM paths from the installed preset catalog; {} when the folder is
  // unavailable — the script then falls back to DthOptions resolution.
  const catalog = await storage.listPoseAssets()
  const romPaths = catalog.error ? {} : resolveRomPaths(character, catalog)
  const files = generateAll(character, romPaths)

  // Houdini deliverable(s) — PoseAsset.csv — live in the character's own folder.
  const outDir = await storage.getCharacterFolder(lib, id)
  await storage.writeFilesToFolder(
    outDir,
    files.filter((file) => file.target === 'houdini'),
  )

  // The character script + the runtime it imports go in the shared scripts folder.
  const settings = await storage.getSettings()
  const dazFiles = files.filter((file) => file.target === 'daz')
  let scriptsDir: string | null = null
  let scriptsError: string | null = null
  if (settings.dazLibraryFolder) {
    const dir = storage.studioScriptsDir(settings.dazLibraryFolder)
    try {
      await storage.copyRuntimeFiles(settings.dazScriptsFolder, dir)
      await storage.writeFilesToFolder(dir, dazFiles)
      scriptsDir = dir
    } catch (error) {
      scriptsError = error instanceof Error ? error.message : String(error)
    }
  } else {
    scriptsError = 'Set “My DAZ 3D Library” to install the character script'
  }
  return { outDir, files, scriptsDir, scriptsError }
}

/** Where a character's files live (absolute + library-relative), for the editor. */
export async function getCharacterPath({
  data,
}: {
  data: unknown
}): Promise<storage.CharacterLocation | null> {
  const { projectId, id } = charScopeInput.parse(data)
  return storage.getCharacterPath(await projectPath(projectId), id)
}

const moveInput = z.object({
  projectId: z.string().min(1),
  id: z.string().min(1),
  relPath: z.string().min(1),
})

/** Move/rename a character by its definition path relative to the project library. */
export async function moveCharacter({
  data,
}: {
  data: unknown
}): Promise<storage.CharacterLocation> {
  const { projectId, id, relPath } = moveInput.parse(data)
  return storage.moveCharacter(await projectPath(projectId), id, relPath)
}
