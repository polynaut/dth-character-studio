import { exists, mkdir, readDir, readFile, remove, writeFile } from '@tauri-apps/plugin-fs'
import { z } from 'zod'

import * as storage from '../storage'
import { isExternalImage } from '../image'
import { basename, getActiveProjectDir, joinPath } from './core'

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
 * (`<id>-<ts>.<ext>`), removing any previous avatar for that id first. The version
 * in the name makes the stored reference change whenever the image does, so every
 * `<Avatar>` keyed on it re-resolves — a fixed `<id>.png` would look unchanged and
 * keep showing the cached old image (e.g. switching the avatar between two scenes).
 * Returns the stored filename.
 */
export async function writeAvatarBytes(
  characterId: string,
  bytes: Uint8Array,
  ext: string,
): Promise<string> {
  const projectDir = await getActiveProjectDir()
  if (!projectDir) throw new Error('No project is open.')
  const dir = storage.metaImagesDir(projectDir)
  await mkdir(dir, { recursive: true })
  const id = basename(characterId)
  const fileName = `${id}-${Date.now()}.${ext}`
  // Write the new avatar FIRST, then drop the previous variants — the reverse
  // order leaves a window where a concurrent writer's just-written file (already
  // referenced by a save) gets deleted, breaking the stored reference.
  await writeFile(joinPath(dir, fileName), bytes)
  await removeCharacterAvatars(projectDir, id, fileName)
  return fileName
}

/** Remove every avatar image stored for a character (old fixed name + versioned
 *  `<id>-<ts>.<ext>`), used both when replacing an avatar and when the character
 *  is deleted. `keep` spares one filename (the replacement just written).
 *  Best-effort per file; a missing images folder is a no-op. */
export async function removeCharacterAvatars(
  projectDir: string,
  characterId: string,
  keep = '',
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
          entry.name !== keep &&
          (entry.name.startsWith(`${id}.`) || entry.name.startsWith(`${id}-`)),
      )
      .map((entry) => remove(joinPath(dir, entry.name))),
  )
}

/**
 * Copy a Daz scene's tip thumbnail into the app's images folder as the
 * character's avatar. Returns the stored filename, or '' when no tip image exists
 * next to the scene.
 */
export async function copyTipImage(characterId: string, scenePath: string): Promise<string> {
  const tipPath = await findTipImage(scenePath)
  if (!tipPath) return ''
  return writeAvatarBytes(characterId, await readFile(tipPath), 'png')
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
 * Stores a dropped avatar image under the active project's `.dcsmeta/images/`
 * (via {@link writeAvatarBytes}) and returns its bare filename — the portable
 * canonical reference saved on the character (see ./image). Avatars are
 * PER-PROJECT (they live in the project's hidden `.dcsmeta`), keyed by character id.
 */
export async function uploadCharacterImage({ data }: { data: unknown }): Promise<string> {
  const input = uploadImageInput.parse(data)
  const extension = IMAGE_EXTENSIONS[input.mimeType]
  if (!extension) throw new Error(`Unsupported image type: ${input.mimeType}`)
  const bytes = Uint8Array.from(atob(input.dataBase64), (c) => c.charCodeAt(0))
  // extension is like ".png"; writeAvatarBytes wants the bare "png".
  return writeAvatarBytes(input.characterId, bytes, extension.slice(1))
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
 * writes the bytes DIRECTLY via {@link writeAvatarBytes} — the old route
 * detoured through base64 (readFile → chunked btoa → atob → bytes), tripling
 * the memory of a multi-MB image for nothing.
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
  // Same canonical extension the base64 upload derives (jpeg → jpg).
  return writeAvatarBytes(characterId, bytes, IMAGE_EXTENSIONS[mimeType].slice(1))
}

/** Inline raw image bytes as a `data:` URL, MIME inferred from the file name. */
function bytesToDataUrl(bytes: Uint8Array, fileName: string): string {
  const ext = (fileName.split('.').pop() ?? '').toLowerCase()
  const mime = IMAGE_MIME[ext] ?? 'image/png'
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return `data:${mime};base64,${btoa(binary)}`
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
const imageSrcCache = new Map<string, string>()

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
    const url = bytesToDataUrl(bytes, image)
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
    return bytesToDataUrl(await readFile(tipPath), tipPath)
  } catch {
    return ''
  }
}
