import { exists, mkdir, readDir, readTextFile, remove } from '@tauri-apps/plugin-fs'
import { isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

import { parseProductScanCsv, scansFromMerged } from '@dth/rom'
import * as storage from '../storage'
import {
  characterProductsJson,
  emptyCharacterProducts,
  mergedProducts,
  parseCharacterProductsText,
  PRODUCTS_FILE,
  withScans,
} from '../character-products.ts'
import { charScopeInput, charsRoot, joinPath, locateCharacter, resolveProject } from './core'

import type { MergedProductScan, ProductScan } from '@dth/rom'
import type { CharacterProductsFile } from '../character-products.ts'
import type { ProjectInfo } from './core'

// The Daz Products scan: picking up the per-scene CSVs the generated
// `Scan_Products_<Name>.dsa` writes from Daz into the studio's own store, plus
// DIM-folder auto-detection.
//
// The pickup is unattended. Daz writes a CSV per scanned scene into the drop
// folder; the studio parses them, folds each scene into
// `.dcsmeta/characters/<folder>/products.json`, and DELETES the CSV it consumed.
// There is no review step and no "store on character" button any more — the scan
// either produced results or it didn't.

/**
 * Best-effort auto-detect of the DAZ Install Manager `ManifestFiles` folder (the
 * Daz Products scan's product database). DIM's location is user-configured and
 * isn't reliably derivable, so we probe the standard layout across drive letters
 * plus the Public Documents fallback and return the first that exists, or '' when
 * none match (the user then sets it by hand). ~30 cheap `exists()` probes.
 */
export async function detectDimManifestsFolder(): Promise<string> {
  if (!isTauri()) return ''
  const candidates: Array<string> = []
  for (let c = 'C'.charCodeAt(0); c <= 'Z'.charCodeAt(0); c++) {
    candidates.push(`${String.fromCharCode(c)}:/DAZ 3D/Install Manager/ManifestFiles`)
  }
  candidates.push('C:/Users/Public/Documents/DAZ 3D/InstallManager/ManifestFiles')
  for (const path of candidates) {
    try {
      if (await exists(path)) return path
    } catch {
      // unprobeable drive — skip
    }
  }
  return ''
}

/** Absolute path of a character's stored product results. */
function productsPath(project: ProjectInfo, relFolder: string, characterId: string): string {
  return joinPath(storage.characterMetaDir(project.path, relFolder, characterId), PRODUCTS_FILE)
}

/** Read the store (missing / unreadable = empty — see `parseCharacterProductsText`). */
async function readProducts(path: string): Promise<CharacterProductsFile> {
  try {
    if (await exists(path)) return parseCharacterProductsText(await readTextFile(path))
  } catch {
    // unreadable store — treat as empty; the next scan rewrites it
  }
  return emptyCharacterProducts()
}

export interface ProductScanResult {
  /** Whether anything has been scanned for this character. */
  exists: boolean
  /** Every stored scene merged, for display. */
  scan: MergedProductScan | null
  /** Where the results are stored (shown on the tab). */
  path: string
  /** ISO timestamp of the most recent pickup; '' when never scanned. */
  scannedAt: string
  /** Per stored scene: its name, path and counts — what backs the merged view. */
  scenes: Array<{ scene: string; scenePath: string; products: number; unmatched: number; scannedAt: string }>
}

/**
 * A character's product results, ingesting anything Daz has left in the drop
 * folder first.
 *
 * `ingest: false` is the hover-PRELOAD path: picking up DELETES the CSVs, and
 * merely hovering a character card must never race the Daz script mid-write — a
 * half-written CSV would parse into a truncated scene and the real one would be
 * gone. The same rule the ROM run log follows.
 */
export async function fetchProductScan({ data }: { data: unknown }): Promise<ProductScanResult> {
  const { projectId, id, ingest } = charScopeInput
    .extend({ ingest: z.boolean().default(true) })
    .parse(data)
  const project = await resolveProject(projectId)
  const location = await locateCharacter(charsRoot(project), id)
  const empty: ProductScanResult = {
    exists: false,
    scan: null,
    path: '',
    scannedAt: '',
    scenes: [],
  }
  if (!location) return empty
  const path = productsPath(project, location.relFolder, id)
  if (ingest) await ingestProductScans(project, location.relFolder, id)
  const store = await readProducts(path)
  if (store.scans.length === 0) return { ...empty, path }
  return {
    exists: true,
    scan: mergedProducts(store),
    path,
    scannedAt: store.scannedAt,
    scenes: store.scans.map((s) => ({
      scene: s.sceneName,
      scenePath: s.scenePath,
      products: s.products.length,
      unmatched: s.unmatched.length,
      scannedAt: s.scannedAt,
    })),
  }
}

/**
 * Pick up whatever the Daz script has written for one character: parse every CSV
 * in its drop folder, fold each scanned scene into the store, and delete the CSVs
 * that made it in.
 *
 * Ordering is the whole safety story — the store is written FIRST and only the
 * CSVs whose contents reached it are deleted. A failed write leaves every CSV on
 * disk for the next pickup; a CSV that won't parse is left alone too (it may be a
 * partial write Daz is still finishing, and a later pickup gets the whole file).
 *
 * Returns how many scenes were taken in. Best-effort throughout: this runs on a
 * route load, and an unreadable drop folder must never break opening a character.
 */
export async function ingestProductScans(
  project: ProjectInfo,
  relFolder: string,
  characterId: string,
): Promise<number> {
  const dir = await storage.productScanDir(project.id, characterId)
  try {
    if (!(await exists(dir))) return 0
    const names = (await readDir(dir))
      .filter((e) => e.isFile && e.name.toLowerCase().endsWith('.csv'))
      .map((e) => e.name)
    if (names.length === 0) return 0
    // Parse first, so a single bad file can't cost the good ones their pickup.
    // Independent reads, so concurrent; `map` keeps the drop folder's order.
    const parsed = (
      await Promise.all(
        names.map(async (name) => {
          try {
            return { name, scan: parseProductScanCsv(await readTextFile(joinPath(dir, name))) }
          } catch {
            return null // unreadable or mid-write — left on disk for the next pickup
          }
        }),
      )
    ).filter((p): p is { name: string; scan: ProductScan } => p !== null)
    if (parsed.length === 0) return 0
    const path = productsPath(project, relFolder, characterId)
    const store = withScans(
      await readProducts(path),
      parsed.map((p) => p.scan),
      new Date().toISOString(),
    )
    await mkdir(storage.characterMetaDir(project.path, relFolder, characterId), { recursive: true })
    await storage.writeTextFileAtomic(path, characterProductsJson(store))
    // Only now — the results are safely stored, so the transport can go.
    await Promise.all(
      parsed.map(async (p) => {
        try {
          await remove(joinPath(dir, p.name))
        } catch {
          // locked CSV: it is re-ingested next time and simply replaces its own
          // scene again, so a failed delete costs nothing but a retry
        }
      }),
    )
    return parsed.length
  } catch {
    return 0
  }
}

/**
 * The same pickup across every character of a project — for the moments a batch
 * finishes and the user isn't sitting on any one character's page (Tools → Scan
 * project, Refresh assets). Without it, a ten-character batch would leave its
 * CSVs waiting until each character page was visited.
 */
export async function ingestProjectProductScans({ data }: { data: unknown }): Promise<number> {
  const { projectId } = z.object({ projectId: z.string().min(1) }).parse(data)
  if (!isTauri()) return 0
  try {
    const project = await resolveProject(projectId)
    const scan = await storage.scanCharacterLibrary(charsRoot(project))
    const counts = await Promise.all(
      scan.entries.map((entry) =>
        ingestProductScans(project, entry.location.relFolder, entry.character.id),
      ),
    )
    return counts.reduce((a, b) => a + b, 0)
  } catch {
    return 0
  }
}

/**
 * Carry a pre-v30 character's stored products into the new store — the one-time
 * move off the definition JSON.
 *
 * Reads the RAW definition, because this has to run BEFORE the save that strips
 * those fields (zod drops them the moment the character is parsed at the current
 * schema). Never overwrites an existing store: a character that has already
 * scanned under the new model has better data than the definition's snapshot.
 *
 * The definition kept the MERGED view, so it is split back per scene
 * ({@link scansFromMerged}) — exact for everything the merge preserved. Returns
 * true when a store was written. Best-effort: losing this costs one re-scan.
 */
export async function carryStoredProductsToMeta(
  project: ProjectInfo,
  relFolder: string,
  characterId: string,
  definitionAbs: string,
): Promise<boolean> {
  try {
    const path = productsPath(project, relFolder, characterId)
    if (await exists(path)) return false
    const raw: unknown = JSON.parse(await readTextFile(definitionAbs))
    if (!raw || typeof raw !== 'object') return false
    const record = raw as Record<string, unknown>
    const products = Array.isArray(record.products) ? record.products : []
    const unmatched = Array.isArray(record.productsUnmatched) ? record.productsUnmatched : []
    if (products.length === 0 && unmatched.length === 0) return false
    const merged = {
      scenes: [...new Set(products.flatMap((p: { scenes?: Array<string> }) => p.scenes ?? []))],
      products,
      unmatched,
    } as MergedProductScan
    const scannedAt =
      typeof record.productsScannedAt === 'string' && record.productsScannedAt
        ? record.productsScannedAt
        : new Date().toISOString()
    const store = withScans(emptyCharacterProducts(), scansFromMerged(merged), scannedAt)
    await mkdir(storage.characterMetaDir(project.path, relFolder, characterId), { recursive: true })
    await storage.writeTextFileAtomic(path, characterProductsJson(store))
    return true
  } catch {
    return false
  }
}

/**
 * Discard a character's stored product results. They are fully re-derivable —
 * open the scenes in Daz and export/scan again — so this is a plain delete of the
 * store, not a two-stage thing. Best-effort.
 */
export async function clearProductScan({ data }: { data: unknown }): Promise<void> {
  const { projectId, id } = charScopeInput.parse(data)
  const project = await resolveProject(projectId)
  const location = await locateCharacter(charsRoot(project), id)
  if (!location) return
  const path = productsPath(project, location.relFolder, id)
  if (await exists(path)) await remove(path)
}
