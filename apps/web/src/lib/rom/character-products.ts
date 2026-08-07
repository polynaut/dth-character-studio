import { z } from 'zod'

import { mergeProductScans, productRecordSchema, unmatchedAssetSchema } from '@dth/rom'

import type { MergedProductScan, ProductScan } from '@dth/rom'

/**
 * A character's Daz-product scan results, as stored by the studio.
 *
 * They live in `.dcsmeta/characters/<folder>/products.json` — app data, not part
 * of the definition. Before v0.68 the merged list was written onto the character
 * JSON by a "review, then store" dialog; the scan is now picked up, written and
 * the source CSVs deleted, all without asking, so there is no found-vs-stored
 * split left to review and no reason to bloat a shareable definition with a few
 * hundred machine-derived rows.
 *
 * **Stored PER SCENE, merged on read.** A scan run covers whichever scenes were
 * opened — often just one — so a pickup must replace that scene's contribution
 * and leave every other scene's alone. Keeping the per-scene scans (rather than
 * the merged view the UI renders) makes that exact, and `mergeProductScans` is
 * still the one merge rule for display.
 *
 * This module is pure: the file's shape, its tolerant parse, and the
 * replace-by-scene rule. The pickup I/O lives in `api/products.ts`.
 */

/** File name inside the character's meta folder. */
export const PRODUCTS_FILE = 'products.json'

/** One scanned scene, plus when the studio picked it up. */
const storedScanSchema = z.object({
  sceneName: z.string().default(''),
  scenePath: z.string().default(''),
  /** ISO timestamp of the pickup that produced this entry. */
  scannedAt: z.string().default(''),
  products: z.array(productRecordSchema).default([]),
  unmatched: z.array(unmatchedAssetSchema).default([]),
})

export type StoredProductScan = z.infer<typeof storedScanSchema>

/** The whole file. Tolerant on read: an unknown future version still parses as
 *  far as it matches, since losing a scan to a strict gate is worse than
 *  rendering a partial one (the next Daz run rewrites it anyway). */
export const characterProductsSchema = z.object({
  version: z.number().default(1),
  /** ISO timestamp of the most recent pickup into this file. */
  scannedAt: z.string().default(''),
  scans: z.array(storedScanSchema).default([]),
})

export type CharacterProductsFile = z.infer<typeof characterProductsSchema>

export function emptyCharacterProducts(): CharacterProductsFile {
  return { version: 1, scannedAt: '', scans: [] }
}

/**
 * Parse the stored file. Anything unreadable — torn write, hand-edited, a shape
 * from the future — becomes an EMPTY store rather than an exception: the results
 * are fully re-derivable by running the scan again, so failing loud here would
 * only break the page that shows them.
 */
export function parseCharacterProductsText(text: string): CharacterProductsFile {
  try {
    return characterProductsSchema.parse(JSON.parse(text))
  } catch {
    return emptyCharacterProducts()
  }
}

/** The key a scan is filed under: its scene path when it has one (exact, and
 *  survives two scenes sharing a basename), else its scene name. Normalised the
 *  way every other scene lookup in the app is. */
function scanKey(scan: { sceneName: string; scenePath: string }): string {
  const path = scan.scenePath.trim().replace(/\\/g, '/').toLowerCase()
  return path || scan.sceneName.trim().toLowerCase()
}

/**
 * Fold freshly picked-up scans into the store: each incoming scene REPLACES its
 * own entry and leaves the others untouched — the same per-scene rule the ROM
 * run log follows, and the reason a one-scene re-scan can't wipe the products of
 * the five scenes you scanned last week.
 *
 * Matching is by key, with one fallback: when either side has no scene path but
 * the scene NAMES agree, they are the same scene. The carry-over rebuilds scans
 * with '' paths (pre-v30 definitions kept no scene paths), while a fresh Daz
 * scan always carries the full `.duf` path — without the fallback a carried
 * entry could never be replaced and would shadow its scene forever.
 *
 * Incoming order wins for the entries it carries; the rest keep their place, so
 * the file doesn't reshuffle on every pickup. `scannedAt` stamps both the
 * replaced entries and the file.
 */
export function withScans(
  store: CharacterProductsFile,
  incoming: ReadonlyArray<ProductScan>,
  scannedAt: string,
): CharacterProductsFile {
  if (incoming.length === 0) return store
  // Dedupe incoming by key first (later wins), like repeated pickups would.
  const byKey = new Map(
    incoming.map((scan) => [scanKey(scan), { ...scan, scannedAt } satisfies StoredProductScan]),
  )
  const fresh = [...byKey.values()]
  const consumed = new Set<StoredProductScan>()
  const matchFor = (existing: StoredProductScan): StoredProductScan | undefined => {
    const key = scanKey(existing)
    const name = existing.sceneName.trim().toLowerCase()
    let byName: StoredProductScan | undefined
    for (const scan of fresh) {
      if (consumed.has(scan)) continue
      if (scanKey(scan) === key) return scan
      if (
        !byName &&
        name &&
        name === scan.sceneName.trim().toLowerCase() &&
        (existing.scenePath === '' || scan.scenePath === '')
      ) {
        byName = scan
      }
    }
    return byName
  }
  const scans: Array<StoredProductScan> = []
  for (const existing of store.scans) {
    const match = matchFor(existing)
    if (match) {
      scans.push(match)
      consumed.add(match)
    } else {
      scans.push(existing)
    }
  }
  // Scenes scanned for the first time append in the order they came in.
  for (const scan of fresh) {
    if (!consumed.has(scan)) scans.push(scan)
  }
  return { version: 1, scannedAt, scans }
}

/**
 * Drop stored scenes the character no longer links — a path-keyed entry whose
 * scene was deleted, unlinked or relinked elsewhere. Without this, an entry
 * outlives its scene forever and keeps its products in the merged view.
 * Results are re-derivable (re-scan), so pruning beats hoarding.
 *
 * ONLY path-keyed entries are judged: a path-less entry is either the ''
 * unsaved-scene bucket or a carried pre-v30 scan whose path was unrecoverable —
 * neither can be verified against the scene list, and guessing by name could
 * discard the very data the carry preserved. A carried entry becomes path-keyed
 * (and thus prunable) the first time its scene is scanned again.
 *
 * Returns the SAME object when nothing changed, so callers can skip the write.
 */
export function withoutUnlinkedScenes(
  store: CharacterProductsFile,
  linkedScenePaths: ReadonlyArray<string>,
): CharacterProductsFile {
  const paths = new Set(
    linkedScenePaths.map((p) => p.trim().replace(/\\/g, '/').toLowerCase()).filter(Boolean),
  )
  const scans = store.scans.filter((s) => {
    const path = s.scenePath.trim().replace(/\\/g, '/').toLowerCase()
    return !path || paths.has(path)
  })
  return scans.length === store.scans.length ? store : { ...store, scans }
}

/** The display view: every stored scene merged, exactly like the loose per-scene
 *  CSVs used to be merged when the page read them straight off disk. */
export function mergedProducts(store: CharacterProductsFile): MergedProductScan {
  return mergeProductScans(store.scans.map((s) => ({ ...s })))
}

/** Pretty JSON + trailing newline — the shape every other studio-written JSON has. */
export function characterProductsJson(store: CharacterProductsFile): string {
  return `${JSON.stringify(store, null, 2)}\n`
}
