import {
  exists,
  mkdir,
  readDir,
  readFile,
  readTextFile,
  remove,
  stat,
  writeFile,
} from '@tauri-apps/plugin-fs'
import { open as shellOpen } from '@tauri-apps/plugin-shell'
import { z } from 'zod'

import * as storage from '../storage'
import { notesPathFor } from '../library'
import { basename, charactersRoot, joinPath, locateCharacter, projectPath } from './core'
import { bytesToDataUrl, fileExt, IMAGE_EXT_MIME } from './data-url'

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

/** Absolute path of the notes file for a project or character. Resolves the
 *  character through the session location cache ({@link locateCharacter}) —
 *  a full library walk on every debounced autosave was pure waste. */
async function notesPath(projectId: string, characterId?: string): Promise<string> {
  if (!characterId) return joinPath(await projectPath(projectId), 'notes.md')
  const loc = await locateCharacter(await charactersRoot(projectId), characterId)
  if (!loc) throw new Error('Character not found.')
  return notesPathFor(loc.definitionAbs)
}

/** A file's mtime in epoch ms — null when it doesn't exist (or carries none). */
async function fileMtime(path: string): Promise<number | null> {
  try {
    const info = await stat(path)
    return info.mtime ? new Date(info.mtime).getTime() : null
  } catch {
    return null
  }
}

export interface NotesFile {
  text: string
  /** The notes file's mtime (ms) when it was read; null when no file exists.
   *  Hand it back to {@link saveNotes} as `expectedMtime` so a concurrent edit
   *  from another window is detected instead of silently overwritten. */
  mtime: number | null
}

export async function fetchNotes({ data }: { data: unknown }): Promise<NotesFile> {
  const { projectId, characterId } = notesScopeInput.parse(data)
  try {
    const path = await notesPath(projectId, characterId)
    // Stat before read: if the file changes in between, the stale mtime makes
    // the next save conflict (safe) rather than pass (clobbers the change).
    const mtime = await fileMtime(path)
    return { text: await readTextFile(path), mtime }
  } catch {
    return { text: '', mtime: null } // no notes yet
  }
}

const saveNotesInput = notesScopeInput.extend({
  text: z.string().max(2_000_000),
  /** The mtime returned by the load / previous save; null when there was no file. */
  expectedMtime: z.number().nullable(),
})

/** The notes file on disk is newer than what the caller loaded — the same
 *  project is probably open in a second window. Nothing was written; the
 *  caller must offer the disk version rather than retry blindly. */
export class NotesConflictError extends Error {
  constructor() {
    super('The notes changed on disk since they were loaded.')
    this.name = 'NotesConflictError'
  }
}

/**
 * Write the notes markdown; clearing the text removes the file again. Guarded
 * against concurrent windows: when the file's mtime no longer matches
 * `expectedMtime`, nothing is written and a {@link NotesConflictError} is
 * thrown. Returns the file's new mtime (null when the file was removed).
 */
export async function saveNotes({ data }: { data: unknown }): Promise<number | null> {
  const { projectId, characterId, text, expectedMtime } = saveNotesInput.parse(data)
  const path = await notesPath(projectId, characterId)
  const onDisk = await fileMtime(path)
  if (onDisk !== null && onDisk !== expectedMtime) throw new NotesConflictError()
  let mtime: number | null = null
  if (!text.trim()) {
    if (await exists(path)) await remove(path)
  } else {
    // Atomic like every other user-data write: notes are user prose — a crash
    // or dropped share mid-write must not leave a torn file where good notes stood.
    await storage.writeTextFileAtomic(path, text)
    mtime = await fileMtime(path)
  }
  // A successful save is the natural moment to drop media nothing references
  // anymore — but THROTTLED: the notes autosave fires on every ~800ms typing
  // pause, and the GC's reference collection walks the whole characters root,
  // for files that only become deletable after the one-hour grace anyway. At
  // most once per interval per project; the housekeeping sweep backstops
  // projects that stop saving. Best-effort: GC trouble must never fail the save.
  const projectDir = await projectPath(projectId)
  const lastGc = lastMediaGcAt.get(projectDir) ?? 0
  if (Date.now() - lastGc >= MEDIA_GC_MIN_INTERVAL_MS) {
    // Stamped up front so overlapping saves can't double-run the walk.
    lastMediaGcAt.set(projectDir, Date.now())
    try {
      await gcNoteMedia(projectDir, MEDIA_GC_GRACE_MS)
    } catch {
      // e.g. an unreadable folder mid-scan — a later save or the sweep gets it
    }
  }
  return mtime
}

// --- Media GC ----------------------------------------------------------------
// Dropped media is a project-level pool under `.dcsmeta/media`, referenced from
// ANY of the project's notes files (another character's notes may reference a
// file this one dropped). Deleting a reference — or a whole notes file — would
// otherwise strand the bytes forever, and app-generated data must never
// accumulate unbounded. Two layers share the same core: successful saves GC
// unreferenced files older than an hour (the grace protects cut/paste during
// an editing session; throttled per project — see saveNotes), and the
// housekeeping sweep backstops with a 7-day bound for projects that are never
// saved again.

/** Grace before the save-time GC may delete an unreferenced media file. */
export const MEDIA_GC_GRACE_MS = 60 * 60 * 1000

/** How often (at most) the save-time GC runs per project — see {@link saveNotes}. */
export const MEDIA_GC_MIN_INTERVAL_MS = 10 * 60 * 1000

/** When each project's save-time GC last ran (epoch ms), keyed by project dir. */
const lastMediaGcAt = new Map<string, number>()

/** Test seam: forget when each project's save-time GC last ran. */
export function resetMediaGcThrottle(): void {
  lastMediaGcAt.clear()
}

/** A `media://<file>` reference in markdown; group 1 is the bare filename. */
const MEDIA_REF_RE = /media:\/\/([^\s)"'<>]+)/g

/** Every media filename referenced by any of the project's notes files: the
 *  project `notes.md` + every character `<Name>.notes.md` under the characters
 *  root. STRICT throughout: a notes file that exists but can't be read — or an
 *  unreadable subtree of the characters root (listNotesFiles walks strictly) —
 *  aborts the collection (and with it the GC). Treating either as empty would
 *  make media that IS still referenced look orphaned and get deleted. */
async function referencedMedia(projectDir: string): Promise<Set<string>> {
  const notesFiles = [
    joinPath(projectDir, 'notes.md'),
    ...(await storage.listNotesFiles(await charactersRoot(projectDir))),
  ]
  const refs = new Set<string>()
  for (const file of notesFiles) {
    if (!(await exists(file))) continue
    const text = await readTextFile(file)
    for (const match of text.matchAll(MEDIA_REF_RE)) refs.add(match[1])
  }
  return refs
}

/** Epoch-ms age anchor of a media file: the filename's leading `Date.now()`
 *  prefix (`<millis>-<name>`, what {@link addNoteMedia} writes), falling back
 *  to the file's mtime. Null when neither parses — such a file is never GC'd. */
async function mediaBornAt(path: string, fileName: string): Promise<number | null> {
  const prefix = /^(\d{13})-/.exec(fileName)
  if (prefix) return Number(prefix[1])
  return fileMtime(path)
}

/**
 * Delete media files under `projectDir` that no notes file references anymore
 * and that are older than `maxAgeMs`. Returns what it freed. Callers treat
 * trouble as non-fatal; a single file that won't delete (e.g. open elsewhere)
 * is skipped — the next GC retries.
 */
export async function gcNoteMedia(
  projectDir: string,
  maxAgeMs: number,
): Promise<{ filesDeleted: number; bytesFreed: number }> {
  const result = { filesDeleted: 0, bytesFreed: 0 }
  const mediaDir = storage.metaMediaDir(projectDir)
  let entries: Awaited<ReturnType<typeof readDir>>
  try {
    entries = await readDir(mediaDir)
  } catch {
    return result // no media folder (or an unreachable project) — nothing to GC
  }
  // The reference set must be COMPLETE to delete safely. If it can't be built
  // in full (an unreadable notes file or subtree — flaky network share), skip
  // this project's GC entirely and delete NOTHING; the next save/sweep retries.
  let referenced: Set<string>
  try {
    referenced = await referencedMedia(projectDir)
  } catch (err) {
    console.warn(
      `Skipping note-media GC for ${projectDir} — the media reference set could not be built in full: ${String(err)}`,
    )
    return result
  }
  const now = Date.now()
  for (const entry of entries) {
    if (!entry.isFile || referenced.has(entry.name)) continue
    const path = joinPath(mediaDir, entry.name)
    const bornAt = await mediaBornAt(path, entry.name)
    if (bornAt === null || now - bornAt <= maxAgeMs) continue
    try {
      const size = (await stat(path)).size
      await remove(path)
      result.filesDeleted += 1
      result.bytesFreed += size
    } catch {
      // locked / already gone — the next save or sweep retries
    }
  }
  return result
}

/** Extensions the preview can inline as an <img> (everything else links) —
 *  exactly the formats the shared data-url module can name a MIME for. */
const NOTE_IMAGE_EXTS = new Set(Object.keys(IMAGE_EXT_MIME))

/**
 * Extensions `openNoteMedia` will hand to the OS default app. A strict ALLOWLIST
 * of passive media/document types — NOT the global `shell.open` regex, which (for
 * the legit "open the generated ROM script" flow) also allows `.dsa`, and a `.dsa`
 * opens IN Daz Studio, which EXECUTES it. A hostile shared project could carry a
 * `.dcsmeta/media/x.dsa` plus a notes link `[readme](media://x.dsa)`; clicking it
 * would run attacker DzScript. Anything not on this list is refused (the file
 * still lives on disk for the user to open deliberately from Explorer).
 */
const OPENABLE_MEDIA_EXTS = new Set([
  ...NOTE_IMAGE_EXTS,
  // video
  'mp4', 'webm', 'mov', 'avi', 'mkv',
  // audio
  'mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac',
  // documents / text
  'pdf', 'txt', 'md', 'csv', 'json',
])

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
  const ext = fileExt(safe)
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
  const mime = IMAGE_EXT_MIME[fileExt(fileName)]
  if (!mime) return '' // not an image — the preview links it instead
  const bytes = await readFile(await mediaPath(projectId, fileName))
  return bytesToDataUrl(bytes, mime)
}

/** Open a stored media file with its default app (non-image media links). */
export async function openNoteMedia({ data }: { data: unknown }): Promise<void> {
  const { projectId, fileName } = mediaRefInput.parse(data)
  // Refuse anything outside the passive-media allowlist — notably `.dsa`, which
  // the global shell scope permits but which EXECUTES in Daz Studio (a hostile
  // shared project's note attachment must not be one click from running).
  if (!OPENABLE_MEDIA_EXTS.has(fileExt(fileName))) {
    throw new Error(
      `Can't open “${fileName}” from the app for safety — reveal it in your file manager to open it yourself.`,
    )
  }
  const path = await mediaPath(projectId, fileName)
  if (!(await exists(path))) throw new Error('The media file is missing.')
  await shellOpen(path)
}
