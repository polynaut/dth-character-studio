import { exists, readDir, readTextFile, remove, stat } from '@tauri-apps/plugin-fs'
import { isTauri } from '@tauri-apps/api/core'

import { mergeProductScans, parseProductScanCsv } from '@dth/rom'
import * as storage from '../storage'
import { charScopeInput, joinPath, productScanCache, resolveProject } from './core'

import type { MergedProductScan, ProductScan } from '@dth/rom'

// The Daz Products scan: reading back the per-scene CSVs the generated
// `Scan_Products_<Name>.dsa` writes from Daz, plus DIM-folder auto-detection.

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

/**
 * Read back a character's product scans (written from Daz by the generated
 * `Scan_Products_<Name>.dsa`). The script writes one CSV per Daz scene into the
 * character's scan folder; this reads every CSV and merges them so each product /
 * unmatched asset is attributed to the scene(s) it was found in. Best-effort —
 * returns `{ exists: false }` when no scan has been run or the folder is unreadable.
 */
/** One per-scene CSV on disk in a character's scan folder — surfaced so the UI can
 *  show exactly which files back the merged results and when each was last written. */
export interface ProductScanFile {
  /** The CSV file name on disk (e.g. `KiraSummertide_G9_GP.csv`). */
  name: string
  /** The Daz scene the CSV was written for ('' for an unsaved scene). */
  scene: string
  scenePath: string
  products: number
  unmatched: number
  /** ISO mtime of the file, or '' when it couldn't be stat'd. */
  modifiedAt: string
}

export interface ProductScanResult {
  exists: boolean
  scan: MergedProductScan | null
  dir: string
  files: Array<ProductScanFile>
}

export async function fetchProductScan({ data }: { data: unknown }): Promise<ProductScanResult> {
  const { projectId, id } = charScopeInput.parse(data)
  const project = await resolveProject(projectId)
  const dir = await storage.productScanDir(project.id, id)
  try {
    if (!(await exists(dir))) {
      productScanCache.delete(dir)
      return { exists: false, scan: null, dir, files: [] }
    }
    // List + stat the CSVs first (cheap): when the listing matches the cached
    // signature (names + mtimes + sizes), serve the cached merge instead of
    // re-reading and re-parsing every file on each navigation to the character.
    const listing: Array<{ name: string; modifiedAt: string; size: number }> = []
    let anyUnstattable = false
    for (const entry of await readDir(dir)) {
      if (!entry.isFile || !entry.name.toLowerCase().endsWith('.csv')) continue
      let modifiedAt = ''
      let size = -1
      try {
        const info = await stat(joinPath(dir, entry.name))
        modifiedAt = info.mtime ? info.mtime.toISOString() : ''
        size = info.size
      } catch {
        // stat failed — the entry can't be revalidated, so this run neither
        // trusts the cache (its `|-1` stamp won't match a healthy signature)
        // nor stores its result (see below)
        anyUnstattable = true
      }
      listing.push({ name: entry.name, modifiedAt, size })
    }
    listing.sort((a, b) => a.name.localeCompare(b.name))
    const signature = listing.map((f) => `${f.name}|${f.modifiedAt}|${f.size}`).join('\n')
    const cached = productScanCache.get(dir)
    if (cached && cached.signature === signature) return cached.result

    const scans: Array<ProductScan> = []
    const files: Array<ProductScanFile> = []
    for (const f of listing) {
      try {
        const parsed = parseProductScanCsv(await readTextFile(joinPath(dir, f.name)))
        scans.push(parsed)
        files.push({
          name: f.name,
          scene: parsed.sceneName,
          scenePath: parsed.scenePath,
          products: parsed.products.length,
          unmatched: parsed.unmatched.length,
          modifiedAt: f.modifiedAt,
        })
      } catch {
        // skip an individual unreadable CSV
      }
    }
    let result: ProductScanResult
    if (scans.length === 0) {
      result = { exists: false, scan: null, dir, files: [] }
    } else {
      files.sort((a, b) =>
        (a.scene || a.name).localeCompare(b.scene || b.name, undefined, { sensitivity: 'base' }),
      )
      result = { exists: true, scan: mergeProductScans(scans), dir, files }
    }
    // An unstattable entry can't prove itself unchanged later — storing this
    // run would only park a result under a signature no future run can match
    // (permanently unservable). Skip the store; the next run re-reads.
    if (!anyUnstattable) productScanCache.set(dir, { signature, result })
    return result
  } catch {
    return { exists: false, scan: null, dir, files: [] }
  }
}

/**
 * Discard a character's unstored product-scan results — the per-scene CSVs the Daz
 * script wrote into the scan folder. This clears the review panel; it does NOT
 * touch the products already stored on the character (those live in its JSON).
 * The whole folder is removed — the next scan recreates it. Best-effort.
 */
export async function clearProductScan({ data }: { data: unknown }): Promise<void> {
  const { projectId, id } = charScopeInput.parse(data)
  const project = await resolveProject(projectId)
  const dir = await storage.productScanDir(project.id, id)
  productScanCache.delete(dir)
  if (await exists(dir)) await remove(dir, { recursive: true })
}
