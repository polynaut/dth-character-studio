import { mkdir, readDir, readTextFile, remove, writeFile } from '@tauri-apps/plugin-fs'
import { convertFileSrc } from '@tauri-apps/api/core'
import { z } from 'zod'

import { generateAll, resolveRomPaths } from '@dth/rom'
import * as storage from './storage'
import { dataPath } from './storage'
import {
  characterSchema,
  characterSlug,
  genderSchema,
  genesisVersionSchema,
  morphSchema,
  newId,
  sectionsFromFlatFrames,
} from '@dth/rom'

import type { Character } from '@dth/rom'
import type { StudioSettings } from './storage'

/**
 * Client data layer — the only bridge between the React UI and the filesystem.
 * Backed by the Tauri fs/dialog plugins (no Node/server). Functions keep the
 * `{ data }` call convention the route components already use, so the UI is
 * unchanged.
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

const idInput = z.object({ id: z.string() })

export async function fetchCharacters(): Promise<Array<Character>> {
  return storage.listCharacters()
}

export async function fetchCharacter({ data }: { data: unknown }): Promise<Character | null> {
  return storage.getCharacter(idInput.parse(data).id)
}

const createInput = z.object({
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
  return storage.saveCharacter(character)
}

export async function saveCharacter({ data }: { data: unknown }): Promise<Character> {
  return storage.saveCharacter(characterSchema.parse(data))
}

export async function deleteCharacter({ data }: { data: unknown }): Promise<void> {
  await storage.deleteCharacter(idInput.parse(data).id)
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
  return storage.saveCharacter(character)
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
 * Stores a dropped avatar image under <data>/images/ and returns the asset URL
 * the webview loads it from (with a cache-busting version).
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
  const filePath = joinPath(dir, `${id}${extension}`)
  const bytes = Uint8Array.from(atob(input.dataBase64), (c) => c.charCodeAt(0))
  await writeFile(filePath, bytes)
  return `${convertFileSrc(filePath)}?v=${Date.now()}`
}

export async function fetchSettings(): Promise<StudioSettings> {
  return storage.getSettings()
}

/** The pre-defined DTH pose preset catalog, scanned from the Poses folder. */
export async function fetchPoseAssets(): Promise<ReturnType<typeof storage.listPoseAssets>> {
  return storage.listPoseAssets()
}

const settingsInput = z.object({ dazScriptsFolder: z.string(), dthPosesFolder: z.string() })

export async function saveSettings({ data }: { data: unknown }): Promise<StudioSettings> {
  return storage.saveSettings(settingsInput.parse(data))
}

/**
 * Compiles the character into all DTH artifacts, writes them to
 * <data>/out/<slug>/ and — when a DazToHue-Scripts folder is configured —
 * writes the Daz-side files there too, runnable next to DthWorkflow.dsa.
 * Returns the files so the UI can offer downloads as well.
 */
export async function generateCharacterFiles({ data }: { data: unknown }): Promise<{
  outDir: string
  files: ReturnType<typeof generateAll>
  dazScriptsFolder: string | null
  dazScriptsError: string | null
}> {
  const { id } = idInput.parse(data)
  const character = await storage.getCharacter(id)
  if (!character) throw new Error(`Character ${id} not found`)
  // Exact ROM paths from the installed preset catalog; {} when the folder is
  // unavailable — the wrapper then falls back to DthOptions resolution.
  const catalog = await storage.listPoseAssets()
  const romPaths = catalog.error ? {} : resolveRomPaths(character, catalog)
  const files = generateAll(character, romPaths)
  const outDir = await storage.writeGeneratedFiles(characterSlug(character), files)

  const settings = await storage.getSettings()
  let dazScriptsFolder: string | null = null
  let dazScriptsError: string | null = null
  if (settings.dazScriptsFolder) {
    try {
      await storage.writeFilesToFolder(
        settings.dazScriptsFolder,
        files.filter((file) => file.target === 'daz'),
      )
      dazScriptsFolder = settings.dazScriptsFolder
    } catch (error) {
      dazScriptsError = error instanceof Error ? error.message : String(error)
    }
  }
  return { outDir, files, dazScriptsFolder, dazScriptsError }
}
