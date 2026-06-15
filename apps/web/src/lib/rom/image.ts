/**
 * Avatar image references are stored in a *portable* canonical form, so a shared
 * character JSON carries no machine-specific paths:
 *
 *   - `''`                     → no avatar
 *   - `"<file>.png"`           → a local avatar at `<data>/images/<file>`
 *   - `"https://…"` / `"data:…"` → a genuine external image, kept verbatim
 *
 * The render layer turns a local filename into a loadable asset URL on demand
 * (see `resolveImageSrc` in `./api`), so the persisted value never embeds an
 * absolute path or a `convertFileSrc`/asset-protocol URL. These helpers are pure
 * (no Tauri imports) so they can be unit-tested and reused on both sides.
 */

/** True for a reference the webview can load directly, with no local-file lookup. */
export function isExternalImage(image: string): boolean {
  // Genuine remote images and inline data URLs — but NOT the asset protocol,
  // which is just a (machine-specific) wrapper around a local file.
  return /^data:/i.test(image) || /^https?:\/\/(?!asset\.localhost\/)/i.test(image)
}

/**
 * Reduce any historical `image` value to the canonical form. Genuine remote
 * (`http(s)://…`, not the asset protocol) and `data:` URLs are kept as-is;
 * everything else — asset-protocol URLs from earlier builds, the old Electron
 * `/api/character-images/<file>` and `/images/<file>` routes, absolute paths —
 * collapses to the file's basename (a local avatar under `<data>/images/`).
 */
export function canonicalImage(image: unknown): string {
  if (typeof image !== 'string' || !image) return ''
  if (isExternalImage(image)) return image
  const path = image.split(/[?#]/)[0] // drop ?v=… cache-busters / fragments
  let decoded = path
  try {
    decoded = decodeURIComponent(path)
  } catch {
    // malformed percent-escapes — fall back to the raw string
  }
  return decoded.replace(/[\\/]+$/g, '').split(/[\\/]/).pop() ?? ''
}
