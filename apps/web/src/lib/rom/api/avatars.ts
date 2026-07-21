import { invoke, isTauri } from '@tauri-apps/api/core'
import { exists, mkdir, readDir, readFile, remove, writeFile } from '@tauri-apps/plugin-fs'
import { z } from 'zod'

import * as storage from '../storage'
import {
  avatarFileName,
  avatarIdOf,
  avatarsToPrune,
  parseAvatarName,
  uploadsNewestFirst,
} from '../avatar-names'
import { isExternalImage } from '../image'
import { basename, getActiveProjectDir, joinPath } from './core'
import { bytesToDataUrl, fileExt, IMAGE_EXT_MIME } from './data-url'

import type { AvatarKind } from '../avatar-names'

// Avatar images + Daz scene thumbnails: storing avatar bytes in the active
// project's `.dcsmeta/images`, deriving avatars from a scene's `.tip.png`, and
// resolving stored image references / scene previews into loadable URLs.

/** Scene path with a trailing ".duf" stripped (case-insensitive). */
export function sceneBase(scenePath: string): string {
  return scenePath.replace(/\.duf$/i, '')
}

/**
 * First existing Daz tip thumbnail next to a scene, trying both naming
 * conventions: `<scene>.tip.png` (e.g. Kira.duf.tip.png) and `<base>.tip.png`
 * (Kira.tip.png). Returns '' when neither exists.
 */
export async function findTipImage(scenePath: string): Promise<string> {
  // Check both naming conventions in parallel, then return the first that exists
  // in preference order (`<scene>.tip.png` wins over `<base>.tip.png`).
  const candidates = [`${scenePath}.tip.png`, `${sceneBase(scenePath)}.tip.png`]
  const present = await Promise.all(candidates.map((p) => exists(p)))
  return candidates.find((_, i) => present[i]) ?? ''
}

/**
 * Write a character's avatar bytes under a content-versioned filename
 * (`<id>--<kind>-<ts>.<ext>`, see avatar-names), then PRUNE — keeping a rolling
 * history of the newest uploads and the newest scene snapshot rather than
 * wiping every other variant. The timestamp makes the stored reference change
 * whenever the image does, so every `<Avatar>` keyed on it re-resolves (a fixed
 * name would keep showing the cached old image). Returns the stored filename.
 */
export async function writeAvatarBytes(
  characterId: string,
  bytes: Uint8Array,
  ext: string,
  kind: AvatarKind,
): Promise<string> {
  const projectDir = await getActiveProjectDir()
  if (!projectDir) throw new Error('No project is open.')
  const dir = storage.metaImagesDir(projectDir)
  await mkdir(dir, { recursive: true })
  const id = basename(characterId)
  const fileName = avatarFileName(id, kind, Date.now(), ext)
  // Write the new avatar FIRST, then prune — the reverse order leaves a window
  // where a concurrent writer's just-written file (already referenced by a
  // save) gets deleted, breaking the stored reference.
  const filePath = joinPath(dir, fileName)
  await writeFile(filePath, bytes)
  // Upscale a small avatar — a 256px Daz scene `.tip.png` or a 256px cropped
  // upload — to 512² with xBRZ (in Rust, edge-directed), so the header portrait
  // isn't blowing up a tiny source. IN PLACE + idempotent: an image already ≥512²
  // is left untouched, so re-writes are safe. Best-effort — a failed upscale keeps
  // the just-written original rather than blocking the avatar set. Native-only,
  // like the fs writes above.
  if (isTauri()) {
    try {
      await invoke('upscale_avatar_file', { path: filePath })
    } catch (e) {
      console.warn('avatar upscale failed; keeping the original image', e)
    }
  }
  const entries = (await readDir(dir)).filter((e) => e.isFile).map((e) => e.name)
  await Promise.all(
    avatarsToPrune(entries, id, fileName).map((name) => remove(joinPath(dir, name))),
  )
  return fileName
}

/** Remove every avatar image stored for a character (current `--kind--` scheme,
 *  legacy `<id>-<ts>` / fixed `<id>.` names), used when the character is deleted.
 *  Best-effort per file; a missing images folder is a no-op. */
export async function removeCharacterAvatars(
  projectDir: string,
  characterId: string,
): Promise<void> {
  const dir = storage.metaImagesDir(projectDir)
  const id = basename(characterId)
  if (!(await exists(dir))) return
  const entries = await readDir(dir)
  // Remove the matching avatar files in parallel (independent files, best-effort).
  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isFile &&
          (entry.name.startsWith(`${id}.`) || entry.name.startsWith(`${id}-`)),
      )
      .map((entry) => remove(joinPath(dir, entry.name))),
  )
}

/**
 * The character's past UPLOADS (newest first, capped at the retained history) —
 * the dialog's "recent images" gallery, so a user can switch back to an earlier
 * upload after trying a scene avatar. Bare filenames (the portable references);
 * '' entries are impossible. Empty when there's no active project or no uploads.
 */
export async function listCharacterUploads({ data }: { data: unknown }): Promise<Array<string>> {
  const { characterId } = z.object({ characterId: z.string().min(1) }).parse(data)
  const projectDir = await getActiveProjectDir()
  if (!projectDir) return []
  const dir = storage.metaImagesDir(projectDir)
  if (!(await exists(dir))) return []
  const entries = (await readDir(dir)).filter((e) => e.isFile).map((e) => e.name)
  return uploadsNewestFirst(entries, basename(characterId))
}

/**
 * Delete one stored UPLOAD (the gallery's per-image ✕). Refuses anything that
 * isn't an `up` avatar for this character — never a scene snapshot (those
 * re-derive from the scene) or another character's file. The caller must not
 * offer it for the currently-active avatar (deleting the referenced file would
 * break the stored reference).
 */
export async function deleteCharacterUpload({ data }: { data: unknown }): Promise<void> {
  const { characterId, fileName } = z
    .object({ characterId: z.string().min(1), fileName: z.string().min(1) })
    .parse(data)
  const parsed = parseAvatarName(fileName)
  if (!parsed || parsed.kind !== 'up' || parsed.id !== basename(characterId)) {
    throw new Error('Only uploaded images can be deleted.')
  }
  const projectDir = await getActiveProjectDir()
  if (!projectDir) return
  await remove(joinPath(storage.metaImagesDir(projectDir), fileName))
}

/**
 * Copy a Daz scene's tip thumbnail into the app's images folder as the
 * character's avatar. Returns the stored filename, or '' when no tip image exists
 * next to the scene.
 */
export async function copyTipImage(characterId: string, scenePath: string): Promise<string> {
  const tipPath = await findTipImage(scenePath)
  if (!tipPath) return ''
  return writeAvatarBytes(characterId, await readFile(tipPath), 'png', 'sc')
}

const sceneAvatarInput = z.object({
  characterId: z.string().min(1),
  scenePath: z.string().min(1),
})

/**
 * Set a character's avatar to a Daz scene's tip thumbnail — copies the scene's
 * `.tip.png` into the app images folder as `<id>.png` and returns the stored
 * filename (the portable reference saved on the character). Throws when the scene
 * has no thumbnail. Powers the avatar dialog's scene-thumbnail picker, so the user
 * can switch the avatar to any linked scene's image.
 */
export async function setAvatarFromScene({ data }: { data: unknown }): Promise<string> {
  const { characterId, scenePath } = sceneAvatarInput.parse(data)
  const fileName = await copyTipImage(characterId, scenePath)
  if (!fileName) throw new Error('That scene has no thumbnail (.tip.png) to use.')
  return fileName
}

/** Extension → MIME for avatar images dropped as a file path (native drag-drop).
 *  An UPLOAD allowlist — deliberately narrower than the shared display table in
 *  data-url.ts (no svg/bmp/avif): only formats the crop pipeline can decode. */
const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

/**
 * Read an image file (native OS drag-drop hands the webview a PATH, not bytes)
 * so the avatar dialog can decode, validate and crop it — the ONLY native
 * access the crop flow needs, kept in the lib layer per the boundary rule.
 * Enforces the same extension allowlist and byte cap as the old direct upload.
 */
export async function readAvatarSourceFile({
  data,
}: {
  data: unknown
}): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const { path } = z.object({ path: z.string().min(1) }).parse(data)
  const ext = fileExt(path)
  const mimeType = IMAGE_MIME[ext]
  if (!mimeType) throw new Error(`Unsupported image type${ext ? `: .${ext}` : ''}`)
  const bytes = await readFile(path)
  if (bytes.length > 10 * 1024 * 1024) throw new Error('Image is larger than 10 MB.')
  return { bytes, mimeType }
}

/**
 * Store a CROPPED avatar produced by the 1:1 crop editor — always PNG, always
 * one of the two square output sizes (the editor guarantees both; this is the
 * only write path for user-uploaded avatars, so everything stored is square).
 * Takes raw bytes DIRECTLY — no base64 round-trip through the webview.
 */
export async function uploadCroppedAvatar({ data }: { data: unknown }): Promise<string> {
  const { characterId, bytes } = z
    .object({
      characterId: z.string().min(1),
      bytes: z.instanceof(Uint8Array).refine((b) => b.length <= 4 * 1024 * 1024, {
        message: 'Cropped avatar is unexpectedly large.',
      }),
    })
    .parse(data)
  return writeAvatarBytes(characterId, bytes, 'png', 'up')
}

/** Inline raw image bytes as a `data:` URL, MIME inferred from the file name
 *  (via the shared data-url helpers; png when the extension is unknown). */
function imageDataUrl(bytes: Uint8Array, fileName: string): string {
  return bytesToDataUrl(bytes, IMAGE_EXT_MIME[fileExt(fileName)] ?? 'image/png')
}

/**
 * Turns a stored `image` reference (see ./image) into a URL the webview can load.
 * External URLs pass through unchanged; a local filename resolves to the avatar in
 * the active project's `.dcsmeta/images`, read as an inline data URL (the asset
 * protocol isn't scoped to arbitrary project folders). Returns '' when there's no
 * active project or the file is missing, so the UI falls back to the placeholder.
 */
// Resolved avatar data URLs, keyed by `<projectDir>|<image>`. The stored avatar
// filename is content-versioned (`<id>-<ts>.<ext>`), so a changed avatar gets a
// NEW key — the cache is self-invalidating and spares a file read + base64 encode
// on every remount of a character grid (dozens of cards, re-run on each nav back).
// Caching a character's fresh avatar EVICTS its superseded entries (below):
// each holds a full multi-hundred-KB data URL, and without eviction every
// avatar replacement accreted another one for the whole session.
const imageSrcCache = new Map<string, string>()

/** Drop the cached data URLs of a character's SUPERSEDED avatars: every entry
 *  under `projectDir` whose stored filename shares the id of `image`
 *  (`<id>-<ts>.<ext>`, or the legacy fixed `<id>.<ext>`), except `keepKey`. */
function evictStaleAvatarUrls(projectDir: string, image: string, keepKey: string): void {
  const id = avatarIdOf(image)
  if (id === image) return // not a versioned avatar name — nothing to relate
  const prefixes = [`${projectDir}|${id}-`, `${projectDir}|${id}.`]
  for (const key of [...imageSrcCache.keys()]) {
    if (key !== keepKey && prefixes.some((p) => key.startsWith(p))) {
      imageSrcCache.delete(key)
    }
  }
}

export async function resolveImageSrc(image: string): Promise<string> {
  if (!image) return ''
  if (isExternalImage(image)) return image
  const projectDir = await getActiveProjectDir()
  if (!projectDir) return ''
  const key = `${projectDir}|${image}`
  const cached = imageSrcCache.get(key)
  if (cached) return cached
  try {
    const bytes = await readFile(joinPath(storage.metaImagesDir(projectDir), image))
    const url = imageDataUrl(bytes, image)
    evictStaleAvatarUrls(projectDir, image, key)
    imageSrcCache.set(key, url)
    return url
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
    return imageDataUrl(await readFile(tipPath), tipPath)
  } catch {
    return ''
  }
}
