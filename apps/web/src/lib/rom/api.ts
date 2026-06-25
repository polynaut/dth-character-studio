import { exists, mkdir, readDir, readFile, readTextFile, remove, stat, writeFile } from '@tauri-apps/plugin-fs'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { open as shellOpen } from '@tauri-apps/plugin-shell'
import { z } from 'zod'

import {
  characterScriptName,
  generateAll,
  genRomIncludes,
  jcmIsBaseRom,
  poseAssetFileName,
  resolveRomPaths,
} from '@dth/rom'
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
  posesFromDazCsv,
  sectionsFromFlatFrames,
} from '@dth/rom'

import type { Character, ImportedPose, PresetFrames } from '@dth/rom'
import type { StudioSettings } from './storage'

export type {
  CharacterLocation,
  DthExporterReleaseInfo,
  DthReleaseInfo,
  KnownDrive,
  Project,
} from './storage'

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

/** Resolve a project id to its record (throws if the project is gone). */
async function resolveProject(projectId: string): Promise<storage.Project> {
  const project = await storage.getProject(projectId)
  if (!project) throw new Error(`Project ${projectId} not found`)
  return project
}

/** Resolve a project id to its library path (throws if the project is gone). */
async function projectPath(projectId: string): Promise<string> {
  return (await resolveProject(projectId)).path
}

// --- Projects -------------------------------------------------------------

const projectIdInput = z.object({ projectId: z.string().min(1) })

/** A project plus its character count, for the projects overview. */
export interface ProjectOverview extends storage.Project {
  characterCount: number
}

export async function fetchProjects(): Promise<Array<ProjectOverview>> {
  const projects = await storage.listProjects()
  return Promise.all(
    projects.map(async (project) => {
      // Count is a library scan; the date fallback is a single stat. Both run
      // per project — fine for a handful, scanned in parallel across projects.
      const [characters, fallbackCreatedAt] = await Promise.all([
        project.path ? storage.listCharacters(project.path) : Promise.resolve([]),
        project.createdAt ? Promise.resolve(undefined) : storage.folderCreatedAt(project.path),
      ])
      const createdAt = project.createdAt ?? fallbackCreatedAt
      return {
        ...project,
        characterCount: characters.length,
        ...(createdAt ? { createdAt } : {}),
      }
    }),
  )
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

const moveProjectInput = z.object({ id: z.string().min(1), path: z.string().min(1) })

/**
 * Re-home a project to a different folder (the "Move" action). Moves all
 * character data to the new location and repoints every character's in-folder
 * references + provenance (see storage.moveProject). The name is unchanged —
 * renaming is the lighter `updateProject`.
 */
export async function moveProject({ data }: { data: unknown }): Promise<storage.Project> {
  const { id, path } = moveProjectInput.parse(data)
  return storage.moveProject(id, path)
}

export async function deleteProject({ data }: { data: unknown }): Promise<void> {
  const { id, deleteFiles } = z
    .object({ id: z.string().min(1), deleteFiles: z.boolean().optional() })
    .parse(data)
  await storage.deleteProject(id, { deleteFiles })
}

// --- Characters (scoped to a project) -------------------------------------

const charScopeInput = z.object({ projectId: z.string().min(1), id: z.string().min(1) })
// Generate also accepts the character's previous name so a rename can clean up
// the old-named script left behind in the shared scripts folder.
const generateInput = charScopeInput.extend({ previousName: z.string().optional() })

export async function fetchCharacters({ data }: { data: unknown }): Promise<Array<Character>> {
  return storage.listCharacters(await projectPath(projectIdInput.parse(data).projectId))
}

/** A character tagged with the project it belongs to — for cross-project pickers
 *  like ROM prefill, which can copy from any project's character. */
export type CharacterWithProject = Character & { projectId: string; projectName: string }

export async function fetchAllCharacters(): Promise<Array<CharacterWithProject>> {
  const projects = await storage.listProjects()
  const lists = await Promise.all(
    projects.map(async (project) =>
      (await storage.listCharacters(project.path)).map((c) => ({
        ...c,
        projectId: project.id,
        projectName: project.name,
      })),
    ),
  )
  return lists.flat()
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
  /** Copy the ROM definitions from this existing character (in the same project). */
  prefillFromId: z.string().optional(),
})

/** ROM-definition fields copied when prefilling from the example or another
 *  character — everything that shapes the ROM, minus identity / provenance. */
function romFields(src: Record<string, unknown>): Record<string, unknown> {
  return {
    sections: src.sections,
    facsDetailStrength: src.facsDetailStrength,
    flexionStrength: src.flexionStrength,
    resetGenBeforeApplying: src.resetGenBeforeApplying,
    preserveMorphs: src.preserveMorphs,
    preserveNodeTransforms: src.preserveNodeTransforms,
    jcmMorphMods: src.jcmMorphMods,
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
  const project = await resolveProject(input.projectId)
  const lib = project.path
  const now = new Date().toISOString()
  const id = newId()
  // ROM prefill: from the bundled example, or copied from an existing character.
  let prefill: Record<string, unknown> = {}
  if (input.prefill === 'example') {
    prefill = romFields(exampleCharacter as Record<string, unknown>)
  } else if (input.prefillFromId) {
    // The source may live in any project (prefill lists characters globally).
    const source = await storage.findCharacterAcrossProjects(input.prefillFromId)
    if (source) prefill = romFields(source as unknown as Record<string, unknown>)
  }
  const base: Record<string, unknown> = {
    id,
    name: input.name,
    genesis: input.genesis,
    gender: input.gender,
    createdAt: now,
    updatedAt: now,
    ...prefill,
  }
  // The picked scene's tip thumbnail becomes the avatar, and we record the scene
  // path as read-only provenance shown in the editor.
  if (input.scenePath) {
    base.scenePath = input.scenePath
    const image = await copyTipImage(id, input.scenePath)
    if (image) base.image = image
  }
  const character: Character = characterSchema.parse(base)
  const created = await storage.createCharacterAt(project, character, input.relFolder ?? '')
  // Seed an empty Houdini folder (named from settings) so the user is nudged to
  // create the character's Houdini project there. Best-effort and only for
  // characters that own a folder — never scatter it into the project root.
  const settings = await storage.getSettings()
  const houSub = normalizeRelFolder(settings.houdiniSubdir)
  if (settings.createHoudiniSubdir && houSub) {
    try {
      const loc = await storage.getCharacterPath(lib, created.id)
      if (loc?.relFolder) await mkdir(joinPath(loc.folderAbs, houSub), { recursive: true })
    } catch {
      // a missing seed folder shouldn't fail character creation
    }
  }
  return created
}

const copySceneInput = z.object({
  projectId: z.string().min(1),
  characterId: z.string().min(1),
  /** Absolute path to the picked Daz scene (.duf). */
  scenePath: z.string().min(1),
  /** Subfolder inside the character's folder; '' copies into the folder itself. */
  subfolder: z.string().optional(),
  /** When true, delete the source `.duf` + thumbnails after copying (a move). */
  deleteOriginal: z.boolean().optional(),
})

/**
 * Copy a Daz scene into the character's folder (used when the picked scene lives
 * outside the project). Copies the `.duf` plus its two sibling thumbnails
 * (`<scene>.png` and `<scene>.tip.png`) into `<characterFolder>/<subfolder>/`.
 * With `deleteOriginal`, the sources are removed afterwards (effectively a move).
 * Returns the absolute path of the copied `.duf`.
 */
export async function copyDazScene({ data }: { data: unknown }): Promise<string> {
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
  const copied: Array<string> = []
  for (const src of sources) {
    if (await exists(src)) {
      await writeFile(joinPath(destDir, basename(src)), await readFile(src))
      copied.push(src)
    }
  }
  // Delete the originals only after every copy succeeded (so a failed copy never
  // loses the source). Each removal is best-effort — a locked source shouldn't
  // undo the add now that the in-project copy exists.
  if (input.deleteOriginal) {
    for (const src of copied) {
      try {
        await remove(src)
      } catch {
        // leave a stray original rather than failing the whole operation
      }
    }
  }
  return joinPath(destDir, basename(input.scenePath))
}

const relinkInput = z.object({
  projectId: z.string().min(1),
  /** The current (possibly draft) character — saved with the new scene path. */
  character: z.unknown(),
  /** Absolute path to the newly-linked Daz scene (.duf). */
  scenePath: z.string().min(1),
})

/**
 * Point a character at a (new) Daz scene: persist the path and refresh the
 * avatar from that scene's `.tip.png`. Operates on the passed-in character so
 * any unsaved editor edits are preserved (mirrors the inline rename).
 */
export async function relinkScene({ data }: { data: unknown }): Promise<Character> {
  const { projectId, character, scenePath } = relinkInput.parse(data)
  const parsed = characterSchema.parse(character)
  const next: Character = { ...parsed, scenePath, updatedAt: new Date().toISOString() }
  const image = await copyTipImage(parsed.id, scenePath)
  if (image) next.image = image
  return storage.saveCharacter(await resolveProject(projectId), next)
}

/** Open a file with its OS-default application (a `.duf` opens in Daz Studio). */
export async function openScene({ data }: { data: unknown }): Promise<void> {
  const { scenePath } = z.object({ scenePath: z.string().min(1) }).parse(data)
  await shellOpen(scenePath)
}

/**
 * Delete files from disk (best-effort, each independently) — used when unlinking
 * a Daz scene / Houdini project with "Delete file on disk" on. The caller passes
 * the asset plus any siblings (e.g. a scene's `.png` / `.tip.png` thumbnails).
 */
export async function deleteFiles({ data }: { data: unknown }): Promise<void> {
  const { paths } = z.object({ paths: z.array(z.string()) }).parse(data)
  for (const p of paths) {
    if (!p) continue
    try {
      if (await exists(p)) await remove(p)
    } catch {
      // best-effort — a locked/absent file shouldn't fail the whole unlink
    }
  }
}

/** Whether a path exists on disk; false (never throws) when it can't be probed. */
export async function fileExists({ data }: { data: unknown }): Promise<boolean> {
  const { path } = z.object({ path: z.string() }).parse(data)
  if (!path) return false
  try {
    return await exists(path)
  } catch {
    return false
  }
}

/** Whether `path` is a directory (false, never throws, when it can't be probed).
 *  Used to resolve a dropped folder vs file in the create-project drop zone. */
export async function isDirectory(path: string): Promise<boolean> {
  if (!path) return false
  try {
    return (await stat(path)).isDirectory
  } catch {
    return false
  }
}

const saveInput = z.object({ projectId: z.string().min(1), character: z.unknown() })

export async function saveCharacter({ data }: { data: unknown }): Promise<Character> {
  const { projectId, character } = saveInput.parse(data)
  return storage.saveCharacter(await resolveProject(projectId), characterSchema.parse(character))
}

const deleteCharacterInput = charScopeInput.extend({
  /** Preserve the character's Daz-scenes subfolder (settings.dazSubdir). */
  keepDaz: z.boolean().optional(),
})

export async function deleteCharacter({ data }: { data: unknown }): Promise<void> {
  const { projectId, id, keepDaz } = deleteCharacterInput.parse(data)
  const project = await resolveProject(projectId)
  const lib = project.path
  // Capture the name before deleting — it keys the generated script subfolder.
  const character = await storage.getCharacter(lib, id)
  const settings = await storage.getSettings()
  // Resolve the keep flag to the configured Daz subfolder name so the recursive
  // delete can spare it. (Houdini projects are only ever linked in place, never
  // copied into the character folder, so there's nothing Houdini-side to keep.)
  const keepFolders: Array<string> = []
  if (keepDaz && settings.dazSubdir) keepFolders.push(settings.dazSubdir)
  await storage.deleteCharacter(lib, id, { keepFolders })
  // Remove the character's generated Daz script subfolder (derived artifact,
  // orphaned once the character is gone). Best-effort.
  if (character && settings.dazLibraryFolder) {
    try {
      const dir = storage.studioCharScriptsDir(settings.dazLibraryFolder, project.name, character.name)
      if (await exists(dir)) await remove(dir, { recursive: true })
    } catch {
      // leave an orphaned script folder rather than failing the delete
    }
  }
}

const cloneInput = charScopeInput.extend({
  /** Name for the copy (the dialog pre-fills "<name> copy"). */
  name: z.string().min(1),
  /** Bring the character's Daz scenes across: local ones (inside the source
   *  folder) are copied into the copy's folder; linked ones are kept as links. */
  copyScenes: z.boolean().optional(),
})

/** Is `p` located inside `folderAbs` (separator/case-insensitive)? */
function pathInside(folderAbs: string, p: string): boolean {
  const norm = (s: string) => s.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return norm(p).startsWith(norm(folderAbs) + '/')
}

/** Subfolder of `p`'s parent relative to `folderAbs` ('' = directly in it). */
function relSubfolder(folderAbs: string, p: string): string {
  const norm = (s: string) => s.replace(/\\/g, '/').replace(/\/+$/, '')
  const rel = norm(p).slice(norm(folderAbs).length + 1) // "<sub>/Name.duf"
  const slash = rel.lastIndexOf('/')
  return slash >= 0 ? rel.slice(0, slash) : ''
}

/**
 * Duplicate a character within its project: copies the ROM definition under the
 * given name, clones the avatar, optionally brings its Daz scenes across (local
 * scenes copied into the copy's folder, linked scenes kept as references), and
 * generates the copy's initial artifacts. Returns the new character.
 */
export async function cloneCharacter({ data }: { data: unknown }): Promise<Character> {
  const { projectId, id, name, copyScenes } = cloneInput.parse(data)
  const project = await resolveProject(projectId)
  const lib = project.path
  const source = await storage.getCharacter(lib, id)
  if (!source) throw new Error(`Character ${id} not found`)
  const sourceLoc = await storage.getCharacterPath(lib, id)
  let clone = await storage.cloneCharacter(project, id, name)

  // Bring the Daz scenes across when asked: a scene inside the source folder is
  // a local copy → copy its files into the clone's folder at the same relative
  // subpath; a scene linked in place → keep the link (never touch the file).
  if (copyScenes && sourceLoc) {
    const sourceScenes = [source.scenePath, ...source.extraScenes].filter(Boolean)
    const resolved: Array<string> = []
    for (const scene of sourceScenes) {
      if (pathInside(sourceLoc.folderAbs, scene)) {
        resolved.push(
          await copyDazScene({
            data: {
              projectId,
              characterId: clone.id,
              scenePath: scene,
              subfolder: relSubfolder(sourceLoc.folderAbs, scene),
              deleteOriginal: false,
            },
          }),
        )
      } else {
        resolved.push(scene)
      }
    }
    clone = await storage.saveCharacter(project, {
      ...clone,
      scenePath: resolved[0] ?? '',
      extraScenes: resolved.slice(1),
    })
  }

  // Duplicate the avatar so the copy is visually identifiable right away (only
  // for locally-stored images; external URLs already carry through unchanged).
  if (source.image && !isExternalImage(source.image)) {
    try {
      const srcFile = await dataPath('images', source.image)
      if (await exists(srcFile)) {
        const ext = source.image.includes('.') ? `.${source.image.split('.').pop()}` : '.png'
        const dir = await dataPath('images')
        await mkdir(dir, { recursive: true })
        const fileName = `${basename(clone.id)}${ext}`
        await writeFile(joinPath(dir, fileName), await readFile(srcFile))
        clone = await storage.saveCharacter(project, { ...clone, image: fileName })
      }
    } catch {
      // a missing/locked avatar shouldn't fail the clone — it just has no image
    }
  }
  // Best-effort initial generation (mirrors createCharacter) so the copy's files exist.
  try {
    await generateCharacterFiles({ data: { projectId, id: clone.id } })
  } catch {
    // non-fatal — the editor's Save can regenerate
  }
  return clone
}

/** Shape of an existing DazToHue-Scripts FBM file (e.g. ElectraG9_FBMs.json). */
const fbmJsonSchema = z.object({
  meta: z
    .object({
      resetGPBeforeApplying: z.boolean().optional(),
      resetDKBeforeApplying: z.boolean().optional(),
    })
    .optional(),
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
  // Map either per-block reset flag from the imported FBM JSON onto the generic field.
  const importedReset = raw.meta?.resetGPBeforeApplying ?? raw.meta?.resetDKBeforeApplying
  if (importedReset !== undefined) {
    character.resetGenBeforeApplying = importedReset
  }
  return storage.saveCharacter(await resolveProject(input.projectId), character)
}

const csvImportInput = z.object({ filePath: z.string().min(1) })

/**
 * Read a DAZ-exported morph CSV and parse it into poses (a cleaned name + the
 * `(node, prop, value)` morphs of each frame). Used by the per-section "Import
 * from CSV" action so users don't hand-enter long custom-morph lists.
 */
export async function importPosesFromCsv({ data }: { data: unknown }): Promise<Array<ImportedPose>> {
  const { filePath } = csvImportInput.parse(data)
  return posesFromDazCsv(await readTextFile(filePath))
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

/** Extension → MIME for avatar images dropped as a file path (native drag-drop). */
const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

/**
 * Store an avatar image from an absolute file path — native OS drag-drop hands us
 * a path, not file bytes. Reads it, infers the MIME from the extension, and
 * delegates to {@link uploadCharacterImage}.
 */
export async function uploadCharacterImageFromPath({ data }: { data: unknown }): Promise<string> {
  const { characterId, path } = z
    .object({ characterId: z.string().min(1), path: z.string().min(1) })
    .parse(data)
  const ext = (path.split('.').pop() ?? '').toLowerCase()
  const mimeType = IMAGE_MIME[ext]
  if (!mimeType) throw new Error(`Unsupported image type${ext ? `: .${ext}` : ''}`)
  const bytes = await readFile(path)
  if (bytes.length > 10 * 1024 * 1024) throw new Error('Image is larger than 10 MB.')
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return uploadCharacterImage({ data: { characterId, mimeType, dataBase64: btoa(binary) } })
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

/** The running app's version (e.g. "0.17.0"); '' on the web-only build. */
export async function fetchAppVersion(): Promise<string> {
  return storage.studioVersion()
}

/**
 * The app's internal per-user data folder — where settings.json, projects.json
 * and avatar images live. Surfaced in Settings so the user can find (and back
 * up) the app's state.
 */
export async function fetchAppDataFolder(): Promise<string> {
  return dataPath()
}

// In-memory pose catalog for the app session. The active DTH release's Poses
// folder is scanned (natively, in Rust) on first use and re-scanned when the
// release selection changes — there's no on-disk cache to build, miss, or go
// stale. The scan is small and fast, so one session-lived value is plenty.
// Failed scans (no release / unreachable) are NOT memoized, so fixing Settings
// recovers on the next read without an explicit rescan.
type PoseAssets = Awaited<ReturnType<typeof storage.scanPoseAssets>>
let poseAssets: PoseAssets | null = null

/** The DTH pose presets for the active release — scanned once, then kept in
 *  memory for the session. */
export async function fetchPoseAssets(): Promise<PoseAssets> {
  if (poseAssets) return poseAssets
  const result = await storage.scanPoseAssets()
  if (!result.error) poseAssets = result
  return result
}

/** Re-scan the active release now and refresh the in-memory catalog — call after
 *  the release selection changes or its content is installed/updated. */
export async function rescanPoseAssets(): Promise<PoseAssets> {
  const result = await storage.scanPoseAssets()
  poseAssets = result.error ? null : result
  return result
}

/** Inspect a DTH folder: a single release, or a list of versioned releases. */
export async function listDthReleases({
  data,
}: {
  data: unknown
}): Promise<ReturnType<typeof storage.listDthReleases>> {
  const { folder } = z.object({ folder: z.string() }).parse(data)
  return storage.listDthReleases(folder)
}

/** Inspect a DTH Exporter Plugin folder: a single plugin, or versioned folders. */
export async function listDthExporterReleases({
  data,
}: {
  data: unknown
}): Promise<ReturnType<typeof storage.listDthExporterReleases>> {
  const { folder } = z.object({ folder: z.string() }).parse(data)
  return storage.listDthExporterReleases(folder)
}

const settingsInput = z.object({
  dazLibraryFolder: z.string(),
  dthPosesFolder: z.string(),
  // Tolerate older payloads that predate the field (kept = '' = not chosen).
  currentDthVersion: z.string().default(''),
  dthExporterFolder: z.string().default(''),
  currentDthExporterVersion: z.string().default(''),
  dazInstallFolder: z.string().default(''),
  houdiniDocsFolder: z.string().default(''),
  dazSubdir: z.string().default('daz3d'),
  houdiniSubdir: z.string().default('houdini'),
  createHoudiniSubdir: z.boolean().default(true),
  dazAssetsFolders: z.array(z.string()).default([]),
  dazMorphsSource: z.string().default(''),
  dazMorphsDest: z.string().default(''),
  dazPresetsSource: z.string().default(''),
  dazPresetsDest: z.string().default(''),
  houdiniPresetsSource: z.string().default(''),
  acceptedConflicts: z.array(z.string()).default([]),
  dedupQuarantineFolder: z.string().default(''),
  dazUninstallFolders: z.array(z.string()).default([]),
})

export async function saveSettings({ data }: { data: unknown }): Promise<StudioSettings> {
  return storage.saveSettings(settingsInput.parse(data))
}

/** One copy step of the DTH install (mirrors the Rust `InstallStep`). */
export interface InstallStep {
  label: string
  files: number
  status: 'ok' | 'skipped' | 'error' | 'header'
  detail: string
  /** For asset steps: the (capped) list of files an install would copy. */
  filesList?: Array<string>
  /** Set when this asset writes the same library files as another in the report
   *  (e.g. a folder and its .zip) — a "same files as …" duplicate hint. */
  note?: string
}

/** Outcome of a DTH install run (mirrors the Rust `InstallReport`). */
export interface InstallReport {
  dryRun: boolean
  steps: Array<InstallStep>
  totalFiles: number
}

/**
 * Install the DTH *release* content into the local Daz library + (optionally) the
 * Houdini documents folder — a port of the dth-cli `install-daz-dth` /
 * `install-houdini-dth` commands. Path resolution happens here; the recursive
 * copy runs in native Rust (`install_dth_release`). Throws with a combined
 * message when prerequisites are missing. `dryRun` previews without writing.
 */
export async function installDthRelease({ data }: { data: unknown }): Promise<InstallReport> {
  const { dryRun } = z.object({ dryRun: z.boolean().optional() }).parse(data ?? {})
  const plan = await storage.resolveReleaseInstall()
  if (plan.errors.length) throw new Error(plan.errors.join('\n'))
  return invoke<InstallReport>('install_dth_release', {
    request: {
      releaseRoot: plan.releaseRoot,
      dazLibFolder: plan.dazLibFolder,
      houdiniDocsFolder: plan.houdiniDocsFolder,
      dryRun: dryRun ?? false,
    },
  })
}

/**
 * Install the Exporter *plugin* DLLs into `<Daz install>/plugins` (the
 * admin-sensitive half) — native `install_dth_plugin`. Throws when prerequisites
 * are missing; `dryRun` previews without writing.
 */
export async function installDthPlugin({ data }: { data: unknown }): Promise<InstallReport> {
  const { dryRun } = z.object({ dryRun: z.boolean().optional() }).parse(data ?? {})
  const plan = await storage.resolvePluginInstall()
  if (plan.errors.length) throw new Error(plan.errors.join('\n'))
  return invoke<InstallReport>('install_dth_plugin', {
    request: {
      exporterFolder: plan.exporterFolder,
      dazInstallFolder: plan.dazInstallFolder,
      dryRun: dryRun ?? false,
    },
  })
}

// --- "Optional" tab: install your own Daz/Houdini content -----------------
// Ports of the dth-cli install-daz-assets / -morphs / -presets / -houdini-presets
// (and list-daz-assets) commands. Paths come from settings; the copy + scan run
// in native Rust. `dryRun` previews; assets/list also report what's already there.

const installOptions = z.object({
  dryRun: z.boolean().optional(),
  force: z.boolean().optional(),
  // The changed-asset names from a prior dry-run/scan — install only those,
  // skipping a re-walk of every already-installed asset. Empty installs all.
  only: z.array(z.string()).optional(),
})

/** Install your own Daz assets (G3/G8/G9, .zip extracted) from the configured
 *  asset folders into "My DAZ 3D Library" — content-folder-aware, overwriting per
 *  asset, skipping ones already installed unless `force`. */
export async function installDazAssets({ data }: { data: unknown }): Promise<InstallReport> {
  const { dryRun, force, only } = installOptions.parse(data ?? {})
  const s = await storage.getSettings()
  const sources = s.dazAssetsFolders.map((f) => f.trim()).filter(Boolean)
  const errors: Array<string> = []
  if (!sources.length) errors.push('Add at least one Daz assets folder')
  if (!s.dazLibraryFolder.trim()) errors.push('Set “My DAZ 3D Library”')
  if (errors.length) throw new Error(errors.join('\n'))
  return invoke<InstallReport>('install_daz_assets', {
    request: {
      sources,
      dest: s.dazLibraryFolder.trim(),
      force: force ?? false,
      dryRun: dryRun ?? false,
      only: only ?? [],
      accepted: s.acceptedConflicts,
    },
  })
}

/** Read-only scan of the asset folders — what content each holds and whether it's
 *  already installed in the library. */
export async function listDazAssets(): Promise<InstallReport> {
  const s = await storage.getSettings()
  const sources = s.dazAssetsFolders.map((f) => f.trim()).filter(Boolean)
  if (!sources.length) throw new Error('Add at least one Daz assets folder')
  return invoke<InstallReport>('list_daz_assets', {
    request: { sources, dest: s.dazLibraryFolder.trim(), accepted: s.acceptedConflicts },
  })
}

/** Accept files as legitimately shared between products — they stop showing as
 *  "to copy" / as a conflict (left as whatever is installed). Returns the updated
 *  accepted list. Pass `clear: true` with the same paths to un-accept them. */
export async function setAcceptedConflicts(
  rels: Array<string>,
  clear = false,
): Promise<Array<string>> {
  const s = await storage.getSettings()
  const set = new Set(s.acceptedConflicts)
  for (const r of rels) {
    if (clear) set.delete(r)
    else set.add(r)
  }
  const acceptedConflicts = [...set].sort()
  await storage.saveSettings({ ...s, acceptedConflicts })
  return acceptedConflicts
}

/** One copy of a conflicting shared file (mirrors Rust `ConflictCopy`). */
export interface ConflictCopy {
  label: string
  /** Source folder the copy lives in (e.g. "_genesis 9"). */
  source: string
  size: number
  inZip: boolean
}
/** A file shipped by 2+ different products at different sizes. Informational —
 *  resolved by Accept (never rewritten). */
export interface FileConflict {
  rel: string
  copies: Array<ConflictCopy>
}
/** One copy in a duplicate group. */
export interface DupMember {
  label: string
  /** Source folder the copy lives in (e.g. "_genesis 9"). */
  source: string
  fileCount: number
  isZip: boolean
  /** The copy kept (others are quarantined) — auto-picked, user-overridable. */
  isKeeper: boolean
}
/** A set of assets that are the same content — identical ('exact') or the same
 *  product at a different version ('version', e.g. a …UD vs …UPDATE). */
export interface AssetDup {
  members: Array<DupMember>
  kind: 'exact' | 'version'
  fixed: boolean
}
/** Result of the dedup scan/apply (mirrors Rust `DedupReport`). */
export interface DedupReport {
  dryRun: boolean
  conflicts: Array<FileConflict>
  duplicates: Array<AssetDup>
  assetsQuarantined: number
  backupDir: string
}

/** Find (dry run) or resolve duplicate assets + conflicting shared files. Apply
 *  rewrites every smaller copy — and the library copy — to the largest version,
 *  and quarantines redundant duplicate assets. Reversible (originals backed up). */
export async function dedupDazAssets({ data }: { data: unknown }): Promise<DedupReport> {
  const { dryRun, keepers } = z
    .object({ dryRun: z.boolean().optional(), keepers: z.array(z.string()).optional() })
    .parse(data ?? {})
  const s = await storage.getSettings()
  const sources = s.dazAssetsFolders.map((f) => f.trim()).filter(Boolean)
  if (!sources.length) throw new Error('Add at least one Daz assets folder')
  return invoke<DedupReport>('dedup_daz_assets', {
    request: {
      sources,
      dryRun: dryRun ?? false,
      accepted: s.acceptedConflicts,
      keepers: keepers ?? [],
      quarantine: s.dedupQuarantineFolder.trim(),
    },
  })
}

/** The default leftover-Daz-folder list (dth-cli `uninstall-daz` defaults: the
 *  library root, common Documents/Public spots, APPDATA DAZ 3D + Start Menu). */
export async function defaultDazUninstallFolders(): Promise<Array<string>> {
  const s = await storage.getSettings()
  return invoke<Array<string>>('default_daz_uninstall_folders', {
    request: { dazLibFolder: s.dazLibraryFolder.trim() },
  })
}

/** DANGER: recursively delete the configured leftover Daz folders (run after
 *  removing Daz Studio / DIM via Add or Remove Programs). `dryRun` only previews. */
export async function uninstallDaz({ data }: { data: unknown }): Promise<InstallReport> {
  const { dryRun } = z.object({ dryRun: z.boolean().optional() }).parse(data ?? {})
  const s = await storage.getSettings()
  const folders = s.dazUninstallFolders.map((f) => f.trim()).filter(Boolean)
  if (!folders.length) throw new Error('No folders to clean up')
  return invoke<InstallReport>('uninstall_daz', { request: { folders, dryRun: dryRun ?? false } })
}

/** Merge-only install (adds new files, never overwrites) used for custom morphs
 *  and presets — `which` picks the source/dest pair from settings. */
async function installMerge(
  which: 'morphs' | 'presets',
  dryRun: boolean,
): Promise<InstallReport> {
  const s = await storage.getSettings()
  const label = which === 'morphs' ? 'Custom morphs' : 'Daz presets'
  const source = which === 'morphs' ? s.dazMorphsSource.trim() : s.dazPresetsSource.trim()
  const dest = which === 'morphs' ? s.dazMorphsDest.trim() : s.dazPresetsDest.trim()
  const errors: Array<string> = []
  if (!source) errors.push(`Set the ${label.toLowerCase()} source folder`)
  if (!dest) errors.push(`Set the ${label.toLowerCase()} destination folder`)
  if (errors.length) throw new Error(errors.join('\n'))
  return invoke<InstallReport>('install_daz_merge', {
    request: { label, source, dest, dryRun },
  })
}

export async function installDazMorphs({ data }: { data: unknown }): Promise<InstallReport> {
  return installMerge('morphs', installOptions.parse(data ?? {}).dryRun ?? false)
}

export async function installDazPresets({ data }: { data: unknown }): Promise<InstallReport> {
  return installMerge('presets', installOptions.parse(data ?? {}).dryRun ?? false)
}

/** Install your Houdini `my_presets` into the Houdini docs folder (overwriting)
 *  and wire it into that version's `houdini.env`. */
export async function installHoudiniPresets({ data }: { data: unknown }): Promise<InstallReport> {
  const { dryRun } = installOptions.parse(data ?? {})
  const s = await storage.getSettings()
  const errors: Array<string> = []
  if (!s.houdiniPresetsSource.trim()) errors.push('Set the Houdini presets source folder')
  if (!s.houdiniDocsFolder.trim()) errors.push('Set the Houdini documents folder')
  if (errors.length) throw new Error(errors.join('\n'))
  return invoke<InstallReport>('install_houdini_presets', {
    request: {
      source: s.houdiniPresetsSource.trim(),
      houdiniDocs: s.houdiniDocsFolder.trim(),
      dryRun: dryRun ?? false,
    },
  })
}

// --- Network drives -------------------------------------------------------

/** Outcome of trying to ensure one known network drive is mapped (mirrors Rust). */
export interface RemapResult {
  drive: string
  unc: string
  status: 'already' | 'remapped' | 'conflict' | 'failed' | 'unsupported'
  detail: string
}

/** UNC a mapped network drive points to ("X:\…" → "\\host\share"), or '' when
 *  the path isn't on a (mapped) network drive / the native command is absent. */
export async function uncForPath(path: string): Promise<string> {
  try {
    return (await invoke<string | null>('unc_for_path', { path })) ?? ''
  } catch {
    return ''
  }
}

/**
 * If `path` lives on a mapped network drive, remember that drive→UNC mapping so
 * it can be re-mapped later (e.g. after relaunching elevated). Fire-and-forget,
 * called as folders/files are picked; a no-op off Windows / in web-only mode.
 */
export async function rememberNetworkPath(path: string): Promise<void> {
  if (!path || path[1] !== ':') return
  const unc = await uncForPath(path)
  if (unc) await storage.rememberDrive(path.slice(0, 2), unc)
}

/** Re-map any known network drives that aren't currently available. Runs on
 *  startup; returns a per-drive report. No-op (empty) off Windows / web-only. */
export async function ensureNetworkDrives(): Promise<Array<RemapResult>> {
  try {
    const mappings = await storage.listKnownDrives()
    if (mappings.length === 0) return []
    return await invoke<Array<RemapResult>>('ensure_network_drives', { mappings })
  } catch {
    return []
  }
}

export async function fetchKnownDrives(): Promise<Array<storage.KnownDrive>> {
  return storage.listKnownDrives()
}

/** Version of the exporter DLL already installed in `<dazInstall>/plugins` (''=none). */
export async function installedExporterVersion(dazInstallFolder: string): Promise<string> {
  try {
    return await storage.installedExporterVersion(dazInstallFolder)
  } catch {
    return ''
  }
}

export async function forgetNetworkDrive({ data }: { data: unknown }): Promise<void> {
  await storage.forgetDrive(z.object({ drive: z.string().min(1) }).parse(data).drive)
}

// --- Pose-asset frame measurement -----------------------------------------

interface MeasuredFrames {
  frames: number
  error: string
}

/** Measure the frame length of each `.duf` via the native command. */
async function measureFrames(paths: Array<string>): Promise<Map<string, MeasuredFrames>> {
  const unique = [...new Set(paths.filter(Boolean))]
  if (unique.length === 0) return new Map()
  const results = await invoke<Array<{ path: string; frames: number; error: string }>>(
    'pose_asset_frames',
    { paths: unique },
  )
  return new Map(results.map((r) => [r.path, { frames: r.frames, error: r.error }]))
}

/**
 * Measure the preset ROM block lengths (base JCM/RET/FAC, GP, DK, Physics) for a
 * character from the actual `.duf` assets — read on the fly, nothing hard-coded,
 * custom assets measured the same way as DTH ones. **Throws** when an included
 * block's asset can't be found or read, so a missing/bad `.duf` can never
 * silently produce a wrong-length ROM. `gp`/`dk`/`phys` are 0 when not included.
 */
export async function resolvePresetFrames(
  character: Character,
  catalog?: PoseAssets,
): Promise<PresetFrames> {
  const cat = catalog ?? (await fetchPoseAssets())
  const romPaths = cat.error ? {} : resolveRomPaths(character, cat)
  const { sections, gender } = character
  const genPreset = sections.GEN.enabled && sections.GEN.mode === 'preset'
  const roms = genRomIncludes(gender, sections.GEN.presetAssets)

  const basePath =
    sections.JCM.mode === 'custom' ? sections.JCM.customAssetPath.trim() : (romPaths.jcm ?? '')
  const blocks: Array<{
    key: keyof PresetFrames
    label: string
    need: boolean
    path: string
  }> = [
    { key: 'base', label: 'base ROM (JCM / RET / FAC)', need: jcmIsBaseRom(sections), path: basePath },
    { key: 'gp', label: 'Golden Palace', need: genPreset && roms.gp, path: romPaths.gp ?? '' },
    { key: 'dk', label: 'Dicktator', need: genPreset && roms.dk, path: romPaths.dk ?? '' },
    {
      key: 'phys',
      label: 'Physics',
      need: sections.PHY.enabled && sections.PHY.mode === 'preset',
      path: romPaths.phys ?? '',
    },
  ]

  const measured = await measureFrames(blocks.filter((b) => b.need).map((b) => b.path))
  const frames: PresetFrames = { base: 0, gp: 0, dk: 0, phys: 0 }
  for (const block of blocks) {
    if (!block.need) continue
    if (!block.path) {
      throw new Error(
        `Couldn't locate the ${block.label} pose asset — rescan the poses in Settings.`,
      )
    }
    const hit = measured.get(block.path)
    if (!hit || hit.error) {
      throw new Error(`Couldn't read frames from the ${block.label} asset:\n${hit?.error ?? block.path}`)
    }
    frames[block.key] = hit.frames
  }
  return frames
}

/**
 * Compiles the character into its DTH artifacts and writes them to two places:
 *  - the Houdini PoseAsset CSV → the character's own folder (next to its
 *    definition JSON), and
 *  - the self-contained Daz script (<Name>_<Genesis>.dsa) → a per-character
 *    subfolder `<My DAZ 3D Library>/Scripts/DTH-Character-Studio/<project>/<character>/`.
 *    The DTH runtime files it imports are installed ONCE in that root (copied
 *    from the DazToHue-Scripts checkout); the script imports them two levels up.
 *    Returns the files so the UI can offer downloads.
 */
export async function generateCharacterFiles({ data }: { data: unknown }): Promise<{
  outDir: string
  files: ReturnType<typeof generateAll>
  scriptsDir: string | null
  scriptsError: string | null
}> {
  const { projectId, id, previousName } = generateInput.parse(data)
  const project = await storage.getProject(projectId)
  if (!project) throw new Error(`Project ${projectId} not found`)
  const lib = project.path
  const character = await storage.getCharacter(lib, id)
  if (!character) throw new Error(`Character ${id} not found`)
  // Exact ROM paths from the active release's pose scan; {} when the folder is
  // unavailable — the script then falls back to DthOptions resolution.
  const catalog = await fetchPoseAssets()
  const romPaths = catalog.error ? {} : resolveRomPaths(character, catalog)
  // Frame lengths measured live from the actual .duf assets (hard-errors if an
  // included block can't be read — never a wrong-length ROM).
  const frames = await resolvePresetFrames(character, catalog)
  // The character's own folder holds the canonical PoseAsset CSV. Its absolute
  // path is baked into the generated script so the script can move the CSV into
  // the resolved export dir (scene subfolder included) when it runs in Daz.
  const outDir = await storage.getCharacterFolder(lib, id)
  // Stamp the generating studio version into the script header for traceability.
  const versioned = { ...character, studioVersion: await storage.studioVersion() }
  const files = generateAll(versioned, romPaths, frames, outDir)

  // Houdini deliverable(s) — <Name>_pose_asset.csv — live in the character's own folder.
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
  // Drop the legacy-cased CSV (<name>_PoseAsset.csv) left by older versions —
  // the file is now <name>_pose_asset.csv.
  const legacyPose = poseAssetFileName(character).replace(/_pose_asset\.csv$/, '_PoseAsset.csv')
  await storage.removeFilesFromFolder(outDir, [legacyPose])

  // The PoseAsset CSV is delivered to the export dir by the generated Daz script
  // when it runs — it copies the CSV from the character folder into the resolved
  // export dir (scene subfolder included), next to the exporter's .abc/.dth. So
  // the studio no longer copies it to the export root here (the scene subfolder
  // isn't known until run time anyway).

  // The character script goes in its own <project>/<character>/ subfolder of the
  // shared scripts folder; the runtime it imports is installed once in the root.
  const settings = await storage.getSettings()
  const dazFiles = files.filter((file) => file.target === 'daz')
  let scriptsDir: string | null = null
  let scriptsError: string | null = null
  if (!settings.dazLibraryFolder) {
    scriptsError = 'Set “My DAZ 3D Library” to install the character script'
  } else {
    const root = storage.studioScriptsDir(settings.dazLibraryFolder)
    const charDir = storage.studioCharScriptsDir(settings.dazLibraryFolder, project.name, character.name)
    try {
      await storage.copyRuntimeFiles(root)
      await storage.writeFilesToFolder(charDir, dazFiles)
      // Drop the other script variant when the combined/split choice changed:
      // keep only the .dsa names just written (<base>, ROM_<base>, Export_<base>).
      const dazBase = characterScriptName(character)
      const writtenDaz = dazFiles.map((file) => file.fileName)
      await storage.removeFilesFromFolder(
        charDir,
        [`${dazBase}.dsa`, `ROM_${dazBase}.dsa`, `Export_${dazBase}.dsa`].filter(
          (name) => !writtenDaz.includes(name),
        ),
      )
      // Migration: older versions wrote the script flat in the root — drop this
      // character's flat-layout script (current + previous name) if it lingers.
      await storage.removeFilesFromFolder(root, [
        `${characterScriptName(character)}.dsa`,
        ...(previousName ? [`${characterScriptName({ ...character, name: previousName })}.dsa`] : []),
      ])
      // After a rename the character subfolder name changes — remove the stale one.
      if (previousName) {
        const oldCharDir = storage.studioCharScriptsDir(
          settings.dazLibraryFolder,
          project.name,
          previousName,
        )
        if (oldCharDir !== charDir && (await exists(oldCharDir))) {
          await remove(oldCharDir, { recursive: true })
        }
      }
      scriptsDir = charDir
    } catch (error) {
      scriptsError = error instanceof Error ? error.message : String(error)
    }
  }
  return { outDir, files, scriptsDir, scriptsError }
}

/** One character's outcome in a {@link refreshAllAssets} run. */
export interface RefreshResult {
  project: string
  character: string
  /** false = generation threw (e.g. an asset couldn't be measured). */
  ok: boolean
  /** Generation error (when !ok) or a soft warning (e.g. scripts skipped). */
  detail?: string
}

export interface RefreshSummary {
  total: number
  regenerated: number
  failed: number
  results: Array<RefreshResult>
  /** Outcome of refreshing the bundled DTH runtime files (null = no DAZ library
   *  set, so nothing to install into). */
  runtime: { ok: boolean; detail?: string } | null
}

/**
 * Re-generate the derived artifacts for every character in every project — run
 * after a studio update or a DTH-release switch so all generated files match the
 * current version. Also re-installs the bundled DTH runtime files once (so an app
 * update pushes the new runtime even with zero characters). Character definition
 * JSONs are NOT touched (they self-migrate on open/save). Per-character failures
 * are collected, not thrown, so one bad character can't abort the whole sweep.
 */
export async function refreshAllAssets(): Promise<RefreshSummary> {
  const settings = await storage.getSettings()
  // Refresh the bundled runtime once, up front — independent of any characters.
  let runtime: RefreshSummary['runtime'] = null
  if (settings.dazLibraryFolder) {
    try {
      await storage.copyRuntimeFiles(storage.studioScriptsDir(settings.dazLibraryFolder))
      runtime = { ok: true }
    } catch (e) {
      runtime = { ok: false, detail: e instanceof Error ? e.message : String(e) }
    }
  }
  const projects = await storage.listProjects()
  const results: Array<RefreshResult> = []
  for (const project of projects) {
    let characters: Array<Character>
    try {
      characters = await storage.listCharacters(project.path)
    } catch (e) {
      results.push({
        project: project.name,
        character: '(project unreachable)',
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      })
      continue
    }
    for (const character of characters) {
      try {
        const res = await generateCharacterFiles({ data: { projectId: project.id, id: character.id } })
        results.push({
          project: project.name,
          character: character.name,
          ok: true,
          detail: res.scriptsError ?? undefined,
        })
      } catch (e) {
        results.push({
          project: project.name,
          character: character.name,
          ok: false,
          detail: e instanceof Error ? e.message : String(e),
        })
      }
    }
  }
  const failed = results.filter((r) => !r.ok).length
  return { total: results.length, regenerated: results.length - failed, failed, results, runtime }
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
}): Promise<{ location: storage.CharacterLocation; character: Character }> {
  const { projectId, id, relPath } = moveInput.parse(data)
  return storage.moveCharacter(await projectPath(projectId), id, relPath)
}
