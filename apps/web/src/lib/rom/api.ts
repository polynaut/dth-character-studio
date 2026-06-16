import { exists, mkdir, readDir, readFile, readTextFile, remove, stat, writeFile } from '@tauri-apps/plugin-fs'
import { convertFileSrc } from '@tauri-apps/api/core'
import { z } from 'zod'

import { characterScriptName, generateAll, poseAssetFileName, resolveRomPaths } from '@dth/rom'
import * as storage from './storage'
import { dataPath } from './storage'
import { isExternalImage } from './image'
import { normalizeRelFolder } from './library'
import exampleCharacter from './example-character.json'
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
    .map((p) => p.replace(/\\/g, '/').replace(/\/+$/g, ''))
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
// Generate also accepts the character's previous name so a rename can clean up
// the old-named script left behind in the shared scripts folder.
const generateInput = charScopeInput.extend({ previousName: z.string().optional() })

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
  /** Absolute path to the picked Daz scene (.duf) — its `.tip.png` becomes the avatar. */
  scenePath: z.string().optional(),
  /** Subfolder relative to the project root; '' stores in the project root. */
  relFolder: z.string().optional(),
  /** 'example' seeds the ROM definitions from the bundled example. */
  prefill: z.enum(['empty', 'example']).optional(),
})

/** ROM-definition fields copied from the bundled example when prefill is 'example'. */
function examplePrefill(): Record<string, unknown> {
  const e = exampleCharacter as Record<string, unknown>
  return {
    sections: e.sections,
    targetSkeleton: e.targetSkeleton,
    facsDetailStrength: e.facsDetailStrength,
    flexionStrength: e.flexionStrength,
    resetGPBeforeApplying: e.resetGPBeforeApplying,
    preserveMorphs: e.preserveMorphs,
    preserveNodeTransforms: e.preserveNodeTransforms,
    jcmMorphMods: e.jcmMorphMods,
  }
}

/** Scene path with a trailing ".duf" stripped (case-insensitive). */
function sceneBase(scenePath: string): string {
  return scenePath.replace(/\.duf$/i, '')
}

/**
 * First existing Daz tip thumbnail next to a scene, trying both naming
 * conventions: `<scene>.tip.png` (e.g. Kira.duf.tip.png) and `<base>.tip.png`
 * (Kira.tip.png). Returns '' when neither exists.
 */
async function findTipImage(scenePath: string): Promise<string> {
  for (const p of [`${scenePath}.tip.png`, `${sceneBase(scenePath)}.tip.png`]) {
    if (await exists(p)) return p
  }
  return ''
}

/**
 * Copy a Daz scene's tip thumbnail into the app's images folder as the
 * character's avatar (`<id>.png`). Returns the canonical filename, or '' when
 * no tip image exists next to the scene.
 */
async function copyTipImage(characterId: string, scenePath: string): Promise<string> {
  const tipPath = await findTipImage(scenePath)
  if (!tipPath) return ''
  const bytes = await readFile(tipPath)
  const dir = await dataPath('images')
  await mkdir(dir, { recursive: true })
  const id = basename(characterId)
  for (const entry of await readDir(dir)) {
    if (entry.isFile && entry.name.startsWith(id) && !entry.name.endsWith('.png')) {
      await remove(joinPath(dir, entry.name))
    }
  }
  const fileName = `${id}.png`
  await writeFile(joinPath(dir, fileName), bytes)
  return fileName
}

export async function createCharacter({ data }: { data: unknown }): Promise<Character> {
  const input = createInput.parse(data)
  const now = new Date().toISOString()
  const id = newId()
  const base: Record<string, unknown> = {
    id,
    name: input.name,
    genesis: input.genesis,
    gender: input.gender,
    createdAt: now,
    updatedAt: now,
    ...(input.prefill === 'example' ? examplePrefill() : {}),
  }
  // The picked scene's tip thumbnail becomes the avatar, and we record the scene
  // path as read-only provenance shown in the editor.
  if (input.scenePath) {
    base.scenePath = input.scenePath
    const image = await copyTipImage(id, input.scenePath)
    if (image) base.image = image
  }
  const character: Character = characterSchema.parse(base)
  return storage.createCharacterAt(await projectPath(input.projectId), character, input.relFolder ?? '')
}

const copySceneInput = z.object({
  projectId: z.string().min(1),
  characterId: z.string().min(1),
  /** Absolute path to the picked Daz scene (.duf). */
  scenePath: z.string().min(1),
  /** Subfolder inside the character's folder; '' copies into the folder itself. */
  subfolder: z.string().optional(),
})

/**
 * Copy a Daz scene into the character's folder (used when the picked scene lives
 * outside the project). Copies the `.duf` plus its two sibling thumbnails
 * (`<scene>.png` and `<scene>.tip.png`) into `<characterFolder>/<subfolder>/`.
 */
export async function copyDazScene({ data }: { data: unknown }): Promise<void> {
  const input = copySceneInput.parse(data)
  const lib = await projectPath(input.projectId)
  const folder = await storage.getCharacterFolder(lib, input.characterId)
  const sub = normalizeRelFolder(input.subfolder ?? '')
  const destDir = sub ? joinPath(folder, sub) : folder
  await mkdir(destDir, { recursive: true })
  const sources = [
    input.scenePath,
    `${input.scenePath}.png`,
    `${input.scenePath}.tip.png`,
    `${sceneBase(input.scenePath)}.tip.png`,
  ]
  for (const src of sources) {
    if (await exists(src)) {
      await writeFile(joinPath(destDir, basename(src)), await readFile(src))
    }
  }
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

/**
 * Preview a picked Daz scene's tip thumbnail (`<scene>.tip.png`) as a data URL.
 * The asset protocol is scoped to the app folder, so an arbitrary scene path
 * can't be served via convertFileSrc — we read the bytes and inline them.
 * Returns '' when there's no tip image.
 */
export async function resolveScenePreview(scenePath: string): Promise<string> {
  if (!scenePath) return ''
  try {
    const tipPath = await findTipImage(scenePath)
    if (!tipPath) return ''
    const bytes = await readFile(tipPath)
    let binary = ''
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
    }
    return `data:image/png;base64,${btoa(binary)}`
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
  const { projectId, id, previousName } = generateInput.parse(data)
  const lib = await projectPath(projectId)
  const character = await storage.getCharacter(lib, id)
  if (!character) throw new Error(`Character ${id} not found`)
  // Exact ROM paths from the installed preset catalog; {} when the folder is
  // unavailable — the script then falls back to DthOptions resolution.
  const catalog = await storage.listPoseAssets()
  const romPaths = catalog.error ? {} : resolveRomPaths(character, catalog)
  const files = generateAll(character, romPaths)

  // Houdini deliverable(s) — <Name>_PoseAsset.csv — live in the character's own folder.
  const outDir = await storage.getCharacterFolder(lib, id)
  await storage.writeFilesToFolder(
    outDir,
    files.filter((file) => file.target === 'houdini'),
  )
  // After a rename the PoseAsset filename changes too — drop the old-named one
  // that traveled with the folder.
  if (previousName) {
    const oldPose = poseAssetFileName({ ...character, name: previousName })
    if (oldPose !== poseAssetFileName(character)) {
      await storage.removeFilesFromFolder(outDir, [oldPose])
    }
  }

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
      // After a rename the script's filename (<Name>_<Genesis>.dsa) changes —
      // remove the stale previous-named one left in the shared folder.
      if (previousName) {
        const oldBase = characterScriptName({ ...character, name: previousName })
        if (oldBase !== characterScriptName(character)) {
          await storage.removeFilesFromFolder(dir, [`${oldBase}.dsa`])
        }
      }
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
