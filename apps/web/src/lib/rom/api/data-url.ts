// Shared, pure image-inlining helpers for the api modules. THE single copy of
// the chunked bytes→base64 data-URL encoder and the extension→MIME table for
// displayable images (avatars.ts and notes.ts used to carry drifting duplicates
// of both). No I/O — callers read the bytes themselves.

/** Extension → MIME for every image format the app inlines as a data URL
 *  (avatar resolution + the notes preview). Upload allowlists are narrower on
 *  purpose — see avatars.ts. */
export const IMAGE_EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
}

/** Lower-cased extension of a file name/path, without the dot ('' when none). */
export function fileExt(name: string): string {
  return (name.split('.').pop() ?? '').toLowerCase()
}

/** Inline raw bytes as a `data:<mime>;base64,…` URL. Chunked so a multi-MB
 *  image can't blow the argument limit of `String.fromCharCode(...bytes)`. */
export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return `data:${mime};base64,${btoa(binary)}`
}
