import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { generateAll, resolveRomPaths } from './generate'
import {
  characterSchema,
  characterSlug,
  genderSchema,
  genesisVersionSchema,
  morphSchema,
  newId,
  sectionsFromFlatFrames,
} from './types'

import type { Character } from './types'

/**
 * Server functions — the only bridge between the React UI and the
 * filesystem. Storage is imported dynamically inside handlers so no
 * node:fs code ever reaches the client bundle.
 */

const idInput = z.object({ id: z.string() })

export const fetchCharacters = createServerFn({ method: 'GET' }).handler(async () => {
  const storage = await import('./storage')
  return storage.listCharacters()
})

export const fetchCharacter = createServerFn({ method: 'GET' })
  .validator((input: unknown) => idInput.parse(input))
  .handler(async ({ data }) => {
    const storage = await import('./storage')
    return storage.getCharacter(data.id)
  })

const createInput = z.object({
  name: z.string().min(1),
  genesis: genesisVersionSchema,
  gender: genderSchema,
})

export const createCharacter = createServerFn({ method: 'POST' })
  .validator((input: unknown) => createInput.parse(input))
  .handler(async ({ data }) => {
    const storage = await import('./storage')
    const now = new Date().toISOString()
    const character: Character = characterSchema.parse({
      id: newId(),
      name: data.name,
      genesis: data.genesis,
      gender: data.gender,
      createdAt: now,
      updatedAt: now,
    })
    return storage.saveCharacter(character)
  })

export const saveCharacter = createServerFn({ method: 'POST' })
  .validator((input: unknown) => characterSchema.parse(input))
  .handler(async ({ data }) => {
    const storage = await import('./storage')
    return storage.saveCharacter(data)
  })

export const deleteCharacter = createServerFn({ method: 'POST' })
  .validator((input: unknown) => idInput.parse(input))
  .handler(async ({ data }) => {
    const storage = await import('./storage')
    await storage.deleteCharacter(data.id)
  })

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
export const importCharacterFromJson = createServerFn({ method: 'POST' })
  .validator((input: unknown) => importInput.parse(input))
  .handler(async ({ data }) => {
    const { readFile } = await import('node:fs/promises')
    const storage = await import('./storage')
    const raw = fbmJsonSchema.parse(JSON.parse(await readFile(data.filePath, 'utf8')))
    const now = new Date().toISOString()
    const character: Character = characterSchema.parse({
      id: newId(),
      name: data.name,
      genesis: data.genesis,
      gender: data.gender,
      createdAt: now,
      updatedAt: now,
      sections: sectionsFromFlatFrames([...raw.frames].sort((a, b) => a.frame - b.frame)),
    })
    if (raw.meta?.resetGPBeforeApplying !== undefined) {
      character.resetGPBeforeApplying = raw.meta.resetGPBeforeApplying
    }
    return storage.saveCharacter(character)
  })

/**
 * Opens a native file dialog ON THE MACHINE RUNNING THE STUDIO (which is the
 * user's machine for this local tool) and returns the picked path, or ''.
 */
export const pickFbxFile = createServerFn({ method: 'POST' }).handler(async () => {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const script =
    "Add-Type -AssemblyName System.Windows.Forms; " +
    '$d = New-Object System.Windows.Forms.OpenFileDialog; ' +
    "$d.Filter = 'FBX files (*.fbx)|*.fbx|All files (*.*)|*.*'; " +
    "$d.Title = 'Select reference skeleton FBX'; " +
    "if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.FileName }"
  try {
    const { stdout } = await promisify(execFile)(
      'powershell.exe',
      ['-NoProfile', '-STA', '-Command', script],
      { timeout: 300000 },
    )
    return stdout.trim()
  } catch {
    return ''
  }
})

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
 * Stores a dropped avatar image under data/images/ and returns the URL it
 * is served from (with a cache-busting version).
 */
export const uploadCharacterImage = createServerFn({ method: 'POST' })
  .validator((input: unknown) => uploadImageInput.parse(input))
  .handler(async ({ data }) => {
    const extension = IMAGE_EXTENSIONS[data.mimeType]
    if (!extension) throw new Error(`Unsupported image type: ${data.mimeType}`)
    const { mkdir, writeFile, readdir, rm } = await import('node:fs/promises')
    const { join, basename } = await import('node:path')
    const dir = join(process.cwd(), 'data', 'images')
    await mkdir(dir, { recursive: true })
    const id = basename(data.characterId)
    // One avatar per character — drop stale variants with other extensions.
    for (const file of await readdir(dir)) {
      if (file.startsWith(id) && !file.endsWith(extension)) {
        await rm(join(dir, file), { force: true })
      }
    }
    const fileName = `${id}${extension}`
    await writeFile(join(dir, fileName), Buffer.from(data.dataBase64, 'base64'))
    return `/api/character-images/${fileName}?v=${Date.now()}`
  })

export const fetchSettings = createServerFn({ method: 'GET' }).handler(async () => {
  const storage = await import('./storage')
  return storage.getSettings()
})

/** The pre-defined DTH pose preset catalog, scanned from the Poses folder. */
export const fetchPoseAssets = createServerFn({ method: 'GET' }).handler(async () => {
  const storage = await import('./storage')
  return storage.listPoseAssets()
})

const settingsInput = z.object({ dazScriptsFolder: z.string(), dthPosesFolder: z.string() })

export const saveSettings = createServerFn({ method: 'POST' })
  .validator((input: unknown) => settingsInput.parse(input))
  .handler(async ({ data }) => {
    const storage = await import('./storage')
    return storage.saveSettings(data)
  })

/**
 * Compiles the character into all DTH artifacts, writes them to
 * data/out/<slug>/ and — when a DazToHue-Scripts folder is configured —
 * writes the Daz-side files there too, runnable next to DthWorkflow.dsa.
 * Returns the files so the UI can offer downloads as well.
 */
export const generateCharacterFiles = createServerFn({ method: 'POST' })
  .validator((input: unknown) => idInput.parse(input))
  .handler(async ({ data }) => {
    const storage = await import('./storage')
    const character = await storage.getCharacter(data.id)
    if (!character) throw new Error(`Character ${data.id} not found`)
    // Exact ROM paths from the installed preset catalog; {} when the folder
    // is unavailable — the wrapper then falls back to DthOptions resolution.
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
  })
