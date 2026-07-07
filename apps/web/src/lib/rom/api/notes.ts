import { exists, mkdir, readFile, readTextFile, remove, writeFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { open as shellOpen } from '@tauri-apps/plugin-shell'
import { z } from 'zod'

import * as storage from '../storage'
import { notesPathFor } from '../library'
import { basename, charactersRoot, joinPath, projectPath } from './core'

// Project / character notes: freeform markdown the user writes about a project
// or a character (background, art direction, todos …). Stored as PLAIN `.md`
// files next to what they describe — readable and backupable outside the app:
//   project   → <project>/notes.md
//   character → <definition folder>/<Name>.notes.md  (next to the .json, so
//               loose root-level definitions can't collide on one notes.md)
// Dropped media lands in <project>/.dcsmeta/media/ (like avatars live under
// .dcsmeta/images) and is referenced from the markdown as `media://<file>` —
// the preview resolves those to data URLs; other editors just see the tag.

const notesScopeInput = z.object({
  projectId: z.string().min(1),
  /** Present → the character's notes; absent → the project's. */
  characterId: z.string().optional(),
})

/** Absolute path of the notes file for a project or character. */
async function notesPath(projectId: string, characterId?: string): Promise<string> {
  if (!characterId) return joinPath(await projectPath(projectId), 'notes.md')
  const loc = await storage.getCharacterPath(await charactersRoot(projectId), characterId)
  if (!loc) throw new Error('Character not found.')
  return notesPathFor(loc.definitionAbs)
}

export async function fetchNotes({ data }: { data: unknown }): Promise<string> {
  const { projectId, characterId } = notesScopeInput.parse(data)
  try {
    return await readTextFile(await notesPath(projectId, characterId))
  } catch {
    return '' // no notes yet
  }
}

const saveNotesInput = notesScopeInput.extend({ text: z.string().max(2_000_000) })

/** Write the notes markdown; clearing the text removes the file again. */
export async function saveNotes({ data }: { data: unknown }): Promise<void> {
  const { projectId, characterId, text } = saveNotesInput.parse(data)
  const path = await notesPath(projectId, characterId)
  if (!text.trim()) {
    if (await exists(path)) await remove(path)
    return
  }
  await writeTextFile(path, text)
}

/** Extensions the preview can inline as an <img> (everything else links). */
const NOTE_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'avif'])
const NOTE_IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
}

const addMediaInput = z.object({
  projectId: z.string().min(1),
  /** Absolute path of the dropped/picked file (native drag-drop hands us paths). */
  sourcePath: z.string().min(1),
})

/**
 * Copy a dropped file into the project's `.dcsmeta/media/` (timestamped so two
 * drops of "ref.png" can't collide) and return the markdown snippet to insert:
 * an image tag for image formats, a plain link for any other media.
 */
export async function addNoteMedia({
  data,
}: {
  data: unknown
}): Promise<{ fileName: string; markdown: string }> {
  const { projectId, sourcePath } = addMediaInput.parse(data)
  const bytes = await readFile(sourcePath)
  if (bytes.length > 100 * 1024 * 1024) throw new Error('File is larger than 100 MB.')
  const source = basename(sourcePath)
  const safe = source.replace(/[^A-Za-z0-9._-]+/g, '_')
  const fileName = `${Date.now()}-${safe}`
  const dir = storage.metaMediaDir(await projectPath(projectId))
  await mkdir(dir, { recursive: true })
  await writeFile(joinPath(dir, fileName), bytes)
  const ext = (safe.split('.').pop() ?? '').toLowerCase()
  const label = source.replace(/\.[^.]+$/, '')
  const markdown = NOTE_IMAGE_EXTS.has(ext)
    ? `![${label}](media://${fileName})`
    : `[${label}](media://${fileName})`
  return { fileName, markdown }
}

const mediaRefInput = z.object({
  projectId: z.string().min(1),
  /** Bare stored filename from a `media://` reference — never a path. */
  fileName: z.string().min(1),
})

/** The validated absolute path of a stored media file (refuses path escapes). */
async function mediaPath(projectId: string, fileName: string): Promise<string> {
  if (fileName !== basename(fileName) || fileName.includes('..')) {
    throw new Error('Invalid media reference.')
  }
  return joinPath(storage.metaMediaDir(await projectPath(projectId)), fileName)
}

/** Resolve a `media://` image reference to a data URL for the notes preview. */
export async function resolveNoteMedia({ data }: { data: unknown }): Promise<string> {
  const { projectId, fileName } = mediaRefInput.parse(data)
  const ext = (fileName.split('.').pop() ?? '').toLowerCase()
  const mime = NOTE_IMAGE_MIME[ext]
  if (!mime) return '' // not an image — the preview links it instead
  const bytes = await readFile(await mediaPath(projectId, fileName))
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return `data:${mime};base64,${btoa(binary)}`
}

/** Open a stored media file with its default app (non-image media links). */
export async function openNoteMedia({ data }: { data: unknown }): Promise<void> {
  const { projectId, fileName } = mediaRefInput.parse(data)
  const path = await mediaPath(projectId, fileName)
  if (!(await exists(path))) throw new Error('The media file is missing.')
  await shellOpen(path)
}
