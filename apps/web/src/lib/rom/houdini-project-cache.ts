import { z } from 'zod'

import { materialScanProjectSchema } from './api/native-types.ts'

import type { MaterialScanProject } from './api/native-types.ts'

/**
 * The on-disk store for Houdini project scans.
 *
 * Scanning a `.hip` means starting hython and opening the scene — tens of
 * seconds, and a whole process. The result is worth keeping, and keeping it
 * across restarts: the Utils drawer used to re-earn it on every open, from an
 * in-memory Map that died with the window.
 *
 * **Keyed on the file's modification time — and on the export root plus the
 * installed DazToHue libraries it was judged against**, so the store answers "is
 * this still true?" without opening anything: a `.hip` the user saved in Houdini
 * gets a new mtime, its entry stops matching, and the background scan picks it up
 * again. A path that cannot be stat'd yields no key at all and is always treated
 * as stale — never as a hit. See {@link scanCacheKey} for why the mtime alone is
 * not enough, twice over.
 *
 * Two stores, deliberately separate (see `characterScanStorePath` /
 * `sourceScanStorePath` in api/houdini-material.ts): a character's own projects
 * live with its other app data, while the TEMPLATE projects people copy setups
 * from are usually outside any character folder and get reused across
 * characters. Sharing one file would make a character's cache grow with
 * projects that have nothing to do with it.
 *
 * This module is pure — shape, staleness and merging — so the rules are
 * testable without a filesystem or a Houdini.
 */

/** File name of a scan store, inside whichever folder owns it. */
export const HOUDINI_SCAN_FILE = 'houdini-scan.json'

const entrySchema = z.object({
  /** `<normalized path>|<mtime ms>|<normalized export root>|<HDA fingerprint>` —
   *  see {@link scanCacheKey}. Opaque: compared by equality, never parsed. */
  key: z.string().default(''),
  /** ISO timestamp of the scan that produced this entry (diagnostics only). */
  scannedAt: z.string().default(''),
  project: materialScanProjectSchema,
})

export type HoudiniScanEntry = z.infer<typeof entrySchema>

export const houdiniScanStoreSchema = z.object({
  version: z.number().default(1),
  /** Keyed by the project's normalized lower-cased path. */
  projects: z.record(z.string(), entrySchema).default({}),
})

export type HoudiniScanStore = z.infer<typeof houdiniScanStoreSchema>

export function emptyScanStore(): HoudiniScanStore {
  return { version: 1, projects: {} }
}

/**
 * Parse a store. Anything unreadable becomes an EMPTY store rather than an
 * exception: every entry is re-derivable by scanning again, so failing loud here
 * would break the page that shows the results to save nothing.
 */
export function parseScanStore(text: string): HoudiniScanStore {
  try {
    return houdiniScanStoreSchema.parse(JSON.parse(text))
  } catch {
    return emptyScanStore()
  }
}

/** The path a store files a project under — separators and case normalized,
 *  matching how every other scene/project lookup in the app compares paths. */
export function scanStoreKey(hipPath: string): string {
  return hipPath.trim().replace(/\\/g, '/').toLowerCase()
}

/**
 * The freshness key for one project: its path, the file's mtime, the export root
 * the scan judged it against, and the DazToHue libraries it was judged WITH. An
 * unreadable mtime yields '' — which never matches a stored key, so a file the
 * studio cannot stat is rescanned rather than served from a guess.
 *
 * **The export root is part of the key because part of the ANSWER is about files
 * that are not the `.hip`.** `refs.broken` says whether the files an import path
 * names exist, and the export-root move relocated every one of them
 * without touching a single `.hip` — so on path+mtime alone the store kept
 * serving "everything resolves" for exactly the projects that move broke, until
 * the user happened to re-save one in Houdini. Anything else a verdict depends
 * on and that can change behind the file's back belongs here too.
 *
 * **The installed HDAs are the second such thing, measured 2026-08-10.** A scan
 * answers in the vocabulary of the DazToHue version hython loaded — `prefill`
 * reports a parm as *missing from your DazToHue version*, and the node/section
 * counts come from the same templates. Installing a newer HDA changes every one
 * of those answers without touching a `.hip`, so on path+mtime+root alone the
 * store kept insisting the PoseAsset CSV path did not exist for a user whose
 * freshly-installed `DazToHuePoseAsset.hda` 2.5.1 had it — with no way out from
 * the UI, because the drawer's Rescan reads through this same cache.
 * `tooling` is {@link hdaLibraryKey} over the otls hython will load.
 *
 * Both trailing parts default to '': an unscoped scan (the shared source store —
 * the template projects people copy setups from) belongs to no character and has
 * no export root, and a fingerprint the studio cannot read is '' rather than a
 * guess. '' is a value like any other here — it stops matching the moment the
 * studio CAN read one, which is the invalidation that matters.
 */
export function scanCacheKey(
  hipPath: string,
  mtimeMs: number | undefined,
  exportRoot = '',
  tooling = '',
): string {
  if (mtimeMs === undefined || !Number.isFinite(mtimeMs)) return ''
  return `${scanStoreKey(hipPath)}|${mtimeMs}|${scanStoreKey(exportRoot)}|${tooling}`
}

/**
 * Fold the installed operator libraries into one comparable string — name, mtime
 * and size per file, sorted so directory order never matters.
 *
 * Deliberately NOT the DazToHue release version from Settings: that records which
 * release the studio INSTALLED, and the case this exists for is a library that
 * arrives beside it (a standalone `DazToHuePoseAsset.hda` dropped into `otls/`,
 * which is exactly how 2.5.1 shipped the CSV path). The files hython will load
 * are the only honest answer to "which DazToHue is this scan speaking".
 *
 * Size joins mtime because a restore-in-place can reinstate an older library
 * with a NEW mtime; together they catch the swap either way round.
 */
export function hdaLibraryKey(
  files: ReadonlyArray<{ name: string; mtimeMs?: number | undefined; size?: number | undefined }>,
): string {
  return [...files]
    .map((f) => `${f.name.trim().toLowerCase()}:${f.mtimeMs ?? ''}:${f.size ?? ''}`)
    .sort()
    .join(';')
}

/** The stored scan for `hipPath` IF it still describes the file on disk. */
export function freshScan(
  store: HoudiniScanStore,
  hipPath: string,
  key: string,
): MaterialScanProject | null {
  if (!key) return null
  const entry = store.projects[scanStoreKey(hipPath)]
  return entry && entry.key === key ? entry.project : null
}

/**
 * Fold fresh scans into the store, replacing each project's entry and leaving
 * the others alone.
 *
 * `prune` drops entries for projects no longer in scope — a character that
 * unlinked a project shouldn't carry its scan forever. It is opt-in because the
 * SOURCE store is deliberately cumulative: the whole point of caching a template
 * project is that it stays cached across the characters it is copied into.
 */
export function withScanResults(
  store: HoudiniScanStore,
  results: ReadonlyArray<{ hipPath: string; key: string; project: MaterialScanProject }>,
  scannedAt: string,
  prune?: ReadonlyArray<string>,
): HoudiniScanStore {
  const projects: Record<string, HoudiniScanEntry> = { ...store.projects }
  if (prune) {
    const keep = new Set(prune.map(scanStoreKey))
    for (const key of Object.keys(projects)) {
      if (!keep.has(key)) delete projects[key]
    }
  }
  for (const result of results) {
    // A result whose file could not be stat'd has no key, so storing it would
    // park an entry no future run can match — and one that can never be
    // invalidated either. Skip it; the next pass rescans.
    if (!result.key) continue
    projects[scanStoreKey(result.hipPath)] = {
      key: result.key,
      scannedAt,
      project: result.project,
    }
  }
  return { version: 1, projects }
}

/** Pretty JSON + trailing newline — the shape every other studio-written JSON has. */
export function houdiniScanStoreJson(store: HoudiniScanStore): string {
  return `${JSON.stringify(store, null, 2)}\n`
}
