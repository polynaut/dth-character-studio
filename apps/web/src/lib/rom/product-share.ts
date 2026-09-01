import type { MergedProductScan, ProductRecord, UnmatchedAsset } from '@dth/rom'

// The community product-DB submission, phase 1: PURE payload building. What a
// submission contains — and just as deliberately, what it strips — is decided
// here, testably, before any I/O (api/product-share.ts does the sending).
//
// Framing: this is a crowdsourced PRODUCT CATALOG, not user telemetry. A
// payload carries product facts the scan derived (names, SKUs, artists,
// versions, content-relative provenance) and NOTHING about the sender — no
// scene names, no absolute paths, no machine or user identity. The server
// dedupes whole submissions by content hash and aggregates by product, so no
// per-user record can exist even by accident. Everything here is versioned
// (`v`) so a richer v2 payload can coexist with stored v1 blobs.

/** Bump when the payload SHAPE changes — the server stores this beside every
 *  raw submission so later aggregation passes know what they are reading. */
export const PRODUCT_SHARE_PAYLOAD_VERSION = 1

/**
 * The ingest endpoint (`POST <endpoint>`) — '' until the Worker
 * (services/products-ingest) is deployed, which keeps the whole feature
 * visibly dormant: the Settings toggle renders disabled with a note, and the
 * submitter no-ops. Flipping this on is a one-line change + release.
 */
export const PRODUCT_SHARE_ENDPOINT = ''

/** Shared app token the Worker checks (`x-dth-token`). Keeps drive-by junk out
 *  of the ingest table; NOT a security boundary — it ships inside a public
 *  app, and the server treats every submission as untrusted regardless. */
export const PRODUCT_SHARE_TOKEN = 'dth-community-v1'

/** One matched product, as the scan recorded it. Scene attribution and the
 *  usage/usedBy columns stay out — they describe the USER's scene. */
export interface SharedProduct {
  name: string
  sku: string
  artist: string
  version: string
  productType: string
  /** How the scan matched it ("SKU Match", "Third-Party Match", …) — the
   *  aggregator's official-vs-unofficial signal. */
  matchMethod: string
}

/** One asset no manifest could claim — the unofficial-product raw material. */
export interface SharedUnmatched {
  name: string
  technicalName: string
  assetType: string
  /** Content-relative source ("data/…" / "runtime/…"), lowercased; '' when the
   *  scan had none or the path would not reduce to the content tree — an
   *  absolute path must never leave the machine. */
  sourceFile: string
  artist: string
  version: string
}

export interface ProductSharePayload {
  v: number
  /** The generating app version — scan-logic changes shift what fields mean. */
  app: string
  products: Array<SharedProduct>
  unmatched: Array<SharedUnmatched>
}

/**
 * Reduce a scanned source path to its content-relative tail, the same anchor
 * the Daz-side scan normalizes on (`normalizeContentPath` in DthProducts.dsa):
 * lowercased, forward slashes, cut at `data/` or `runtime/`. Anything that
 * doesn't reduce becomes '' — a path outside the content tree is an absolute
 * user path, and stripping it is the privacy contract, not an optimization.
 */
export function contentRelativePath(path: string): string {
  const s = path.trim().replace(/\\/g, '/').toLowerCase()
  for (const root of ['data/', 'runtime/']) {
    if (s.startsWith(root)) return s
    const at = s.indexOf(`/${root}`)
    if (at !== -1) return s.slice(at + 1)
  }
  return ''
}

function sharedProduct(p: ProductRecord): SharedProduct {
  return {
    name: p.name.trim(),
    sku: p.sku.trim(),
    artist: p.artist.trim(),
    version: p.version.trim(),
    productType: p.productType.trim(),
    matchMethod: p.matchMethod.trim(),
  }
}

function sharedUnmatched(a: UnmatchedAsset): SharedUnmatched {
  return {
    name: a.name.trim(),
    technicalName: a.technicalName.trim(),
    assetType: a.assetType.trim(),
    sourceFile: contentRelativePath(a.sourceFile),
    artist: a.artist.trim(),
    version: a.version.trim(),
  }
}

/**
 * Build a submission from a character's merged product scans, or null when
 * there is nothing worth sending (an empty scan must not become an empty row
 * server-side). Deduped and SORTED: two libraries holding the same products
 * must produce byte-identical payloads whatever order their scenes were
 * scanned in, because the content hash is the dedupe key on both ends.
 */
export function buildProductSharePayload(
  appVersion: string,
  scan: MergedProductScan,
): ProductSharePayload | null {
  const products = new Map<string, SharedProduct>()
  for (const p of scan.products) {
    const shared = sharedProduct(p)
    if (!shared.name) continue
    products.set(`${shared.name.toLowerCase()}|${shared.sku.toLowerCase()}`, shared)
  }
  const unmatched = new Map<string, SharedUnmatched>()
  for (const a of scan.unmatched) {
    const shared = sharedUnmatched(a)
    if (!shared.name && !shared.technicalName) continue
    unmatched.set(
      `${shared.technicalName.toLowerCase()}|${shared.name.toLowerCase()}|${shared.sourceFile}`,
      shared,
    )
  }
  if (products.size === 0 && unmatched.size === 0) return null
  const byKey = <T,>(entries: Map<string, T>): Array<T> =>
    [...entries.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, v]) => v)
  return {
    v: PRODUCT_SHARE_PAYLOAD_VERSION,
    app: appVersion,
    products: byKey(products),
    unmatched: byKey(unmatched),
  }
}

/** Stable content hash of a payload (FNV-1a over the canonical JSON, hex).
 *  Client-side dedupe only — "have I already sent exactly this?" — so a fast
 *  non-cryptographic hash is the right tool; the server keys on its own
 *  SHA-256 of the body it received. */
export function payloadHash(payload: ProductSharePayload): string {
  const text = JSON.stringify(payload)
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
