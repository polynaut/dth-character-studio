// Sequential `await` in a loop is this module's normal shape, not an oversight:
// it is ORDERED filesystem work — a step reads, moves or overwrites what the
// step before it wrote, and the rule's advice (`Promise.all`) would race those
// against each other. Scoped off for the file rather than repeated at each
// loop; a loop here that genuinely CAN run in parallel should use `Promise.all`
// on its own merits.
/* oxlint-disable no-await-in-loop */
import { exists, mkdir, readDir, readTextFile, remove, stat } from '@tauri-apps/plugin-fs'
import { isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

import {
  parseProductScanCsv,
  productRecordSchema,
  scansFromMerged,
  unmatchedAssetSchema,
} from '@dth/rom'
import * as storage from '../storage'
import {
  characterProductsJson,
  emptyCharacterProducts,
  mergedProducts,
  parseCharacterProductsText,
  PRODUCTS_FILE,
  withScans,
  withoutUnlinkedScenes,
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

/** Every element of an unknown value that parses, the rest dropped. For reading
 *  arrays out of raw JSON where one bad row must not cost the good ones. */
function parseEach<T>(value: unknown, schema: z.ZodType<T>): Array<T> {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const parsed = schema.safeParse(item)
    return parsed.success ? [parsed.data] : []
  })
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
  // Carry BEFORE ingest: a pre-v30 definition's stored products must reach the
  // store before a leftover drop-folder CSV creates it — the carry bails once the
  // store exists, and ingest-first would make that partial store permanent.
  if (ingest) {
    await carryStoredProductsToMeta(project, location.relFolder, id, location.definitionAbs)
    await ingestProductScans(project, location.relFolder, id)
  }
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

/** One pickup at a time per character: route load and window focus both trigger
 *  ingestion, and two interleaved read-modify-write passes over the same store —
 *  each ending in a delete — could lose a scene (A's write clobbered by B's,
 *  A's CSV already gone). Concurrent callers share the running pass; a CSV
 *  landing mid-pass waits for the next one. In-process only — a second window on
 *  the same project could still race, but windows are one-per-project. */
const inflightIngests = new Map<string, Promise<number>>()

/** How long a terminator-less CSV must sit unmodified before the pickup trusts
 *  it as finished: pre-v61 scripts wrote no `end` row, so age is the only signal
 *  separating their finished CSVs from a write still in flight. */
const LEGACY_CSV_SETTLE_MS = 10_000

/**
 * Pick up whatever the Daz script has written for one character: parse every CSV
 * in its drop folder, fold each scanned scene into the store, and delete the CSVs
 * that made it in.
 *
 * Ordering is the whole safety story — the store is written FIRST and only the
 * CSVs whose contents reached it are deleted. A failed write leaves every CSV on
 * disk for the next pickup. The parser is TOTAL (truncated text parses to a
 * partial scan, it never throws), so "won't parse" cannot gate consumption;
 * what does: a v61+ CSV is consumed only with its closing `end` row present, and
 * an older, terminator-less CSV only when it names its scene and has sat
 * unmodified past the settle window. Anything else is left for the next pickup.
 *
 * Returns how many scenes were taken in. Best-effort throughout: this runs on a
 * route load, and an unreadable drop folder must never break opening a character.
 */
export function ingestProductScans(
  project: ProjectInfo,
  relFolder: string,
  characterId: string,
): Promise<number> {
  const key = `${project.id}|${characterId}`
  const running = inflightIngests.get(key)
  if (running) return running
  const pass = runIngestPass(project, relFolder, characterId).finally(() => {
    inflightIngests.delete(key)
  })
  inflightIngests.set(key, pass)
  return pass
}

async function runIngestPass(
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
          const path = joinPath(dir, name)
          try {
            const { complete, ...scan } = parseProductScanCsv(await readTextFile(path))
            if (!complete) {
              // Truncated before its scene row: never consumable — an empty scan
              // stored under the '' key would replace a real unsaved-scene entry.
              if (!scan.sceneName && !scan.scenePath) return null
              const { mtime } = await stat(path)
              if (!mtime || Date.now() - mtime.getTime() < LEGACY_CSV_SETTLE_MS) return null
            }
            return { name, scan }
          } catch {
            return null // unreadable (or unstatable) — left on disk for the next pickup
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
      scan.entries.map(async (entry) => {
        // Same carry-before-ingest order as fetchProductScan, for the same
        // reason: ingest creating the store first would strand a pre-v30
        // definition's products behind the carry's exists-bail.
        await carryStoredProductsToMeta(
          project,
          entry.location.relFolder,
          entry.character.id,
          entry.location.definitionAbs,
        )
        return ingestProductScans(project, entry.location.relFolder, entry.character.id)
      }),
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
    // v30 stripped the product fields from the definition — a definition at (or
    // past) it can have nothing to carry, so skip the field parsing it would pay
    // on every save/pickup of a never-scanned character.
    if (typeof record.schemaVersion === 'number' && record.schemaVersion >= 30) return false
    // PARSED, not cast. This is raw definition JSON of unknown age, and the first
    // cut of this function crashed on exactly that — a record written before
    // per-scene attribution existed carries no `scenes` array. A row that fails
    // is dropped rather than failing the whole carry: a partial carry beats none.
    const products = parseEach(record.products, productRecordSchema)
    const unmatched = parseEach(record.productsUnmatched, unmatchedAssetSchema)
    if (products.length === 0 && unmatched.length === 0) return false
    const merged: MergedProductScan = {
      scenes: [...new Set(products.flatMap((p) => p.scenes))],
      products,
      unmatched,
    }
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
 * Drop stored scenes the character no longer links (see
 * {@link withoutUnlinkedScenes}). Runs on save — the only moment a character's
 * scene list changes — with the freshly saved scene list. Best-effort: a failed
 * prune costs nothing but a stale row until the next save.
 */
export async function pruneProductScans(
  project: ProjectInfo,
  relFolder: string,
  characterId: string,
  linkedScenePaths: ReadonlyArray<string>,
): Promise<void> {
  try {
    const path = productsPath(project, relFolder, characterId)
    if (!(await exists(path))) return
    const store = await readProducts(path)
    const pruned = withoutUnlinkedScenes(store, linkedScenePaths)
    if (pruned === store) return
    await storage.writeTextFileAtomic(path, characterProductsJson(pruned))
  } catch {
    // best-effort — a stale entry survives until the next save
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
