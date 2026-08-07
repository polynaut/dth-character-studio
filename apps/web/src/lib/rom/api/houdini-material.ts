import { exists, mkdir, readDir, readTextFile, remove, stat } from '@tauri-apps/plugin-fs'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

import * as storage from '../storage'
import { houdiniVersionFromInstall, matchingHoudiniDocsFolder } from '#/lib/houdini-version.ts'
import { HOUDINI_SCRIPTS_FOLDER } from '../houdini-jobs'
import { normalizePath } from '#/lib/path.ts'
import { stripTrailingSeparators } from '#/lib/path-trim.ts'
import { hipRefPrefixFor } from '#/lib/scene-subfolder.ts'
import { buildHoudiniPrefill } from '../houdini-jobs'
import { characterScenesRoot } from './execute'
import { normalizeRelFolder } from '../library'
import {
  HOUDINI_SCAN_FILE,
  emptyScanStore,
  freshScan,
  houdiniScanStoreJson,
  parseScanStore,
  withScanResults,
} from '../houdini-project-cache.ts'
import type { HoudiniScanStore } from '../houdini-project-cache.ts'
import { validateHoudiniProject } from '../houdini-validate.ts'
import { charsRoot, locateCharacter, resolveProject } from './core'
import type { Character } from '@dth/rom'
import { materialUtilReportSchema } from './native-types.ts'
import type { MaterialScanProject, MaterialUtilReport } from './native-types.ts'
import { joinPath } from './core'
// The hython half, bundled as source and rewritten before every run (same
// self-repairing rule as 456.py: small, must track the app version, and needs
// no install ritual).
import materialUtilsScript from '../houdini-runtime/material_utils.py?raw'

// DazToHue material utilities — the studio half of the "Utils" panel.
//
// Reading what a DazToHueMaterial node holds requires `hou`, so the work runs
// under hython (`houdini-runtime/material_utils.py`); this module resolves the
// paths, writes the request, and parses the report — the usual split (resolve in
// TS, heavy work outside).
//
// Two measured facts the UI depends on, verified against DazToHue 2.5 rather
// than assumed (details in the Python's header):
//   * the node's multiparms are 0-BASED, and
//   * bakers reference their material and groups BY NAME, so a copy into a node
//     without those names imports cleanly and then bakes nothing.
// The second is why every transfer reports `missingMaterials` and why the dry
// run exists at all.

/**
 * The material-utility request/result files live beside `456.py` in app-data,
 * and every run gets its OWN pair.
 *
 * Fixed names looked tidier and were a race: two runs overlap easily (React
 * StrictMode double-fires the panel's scan effect in dev, and Rescan can be
 * clicked while a scan is in flight), and then the first run's cleanup deletes
 * the result the second run's hython had just written — which surfaces as the
 * baffling "hython wrote no result (exited with exit code: 0)", a process that
 * did everything right and left nothing behind.
 */
function runFiles(): { requestPath: string; resultPath: string; id: string } {
  const id = crypto.randomUUID()
  return {
    id,
    requestPath: `material-util-${id}-request.json`,
    resultPath: `material-util-${id}-report.json`,
  }
}

const nodeRef = z.object({
  hipPath: z.string().min(1),
  nodePath: z.string().min(1),
})

const scanInput = z.object({
  /** The `.hip`/`.hiplc` files to scan (deduped by the caller). */
  hipPaths: z.array(z.string().min(1)),
  /** Which store the results are persisted to. With BOTH set it is that
   *  character's own store (in its `.dcsmeta` folder); otherwise the shared
   *  source store in app-data — see `scanStorePath`. */
  projectId: z.string().default(''),
  characterId: z.string().default(''),
})

/**
 * Where a scan store lives.
 *
 * A character's own projects go with its other app data, so they travel with the
 * project folder and are pruned when a project is unlinked. Everything else —
 * the TEMPLATE projects setups get copied from, which usually sit outside any
 * character folder and get reused across characters — goes to one shared store
 * in app-data. Same file format (`houdini-project-cache.ts`), separate files, so
 * a character's cache never fills up with projects that aren't its own.
 */
async function scanStorePath(projectId: string, characterId: string): Promise<string> {
  if (projectId && characterId) {
    const project = await resolveProject(projectId)
    const location = await locateCharacter(charsRoot(project), characterId)
    if (location) {
      return joinPath(
        storage.characterMetaDir(project.path, location.relFolder, characterId),
        HOUDINI_SCAN_FILE,
      )
    }
  }
  return storage.dataPath(HOUDINI_SOURCE_SCAN_FILE)
}

/** The shared store for projects that belong to no character (Utils sources). */
const HOUDINI_SOURCE_SCAN_FILE = 'houdini-source-scans.json'

async function readScanStore(path: string): Promise<HoudiniScanStore> {
  try {
    if (await exists(path)) return parseScanStore(await readTextFile(path))
  } catch {
    // unreadable store — treat as empty; the scan below refills it
  }
  return emptyScanStore()
}

async function writeScanStore(path: string, store: HoudiniScanStore): Promise<void> {
  try {
    await mkdir(path.replace(/[\\/][^\\/]*$/, ''), { recursive: true })
    await storage.writeTextFileAtomic(path, houdiniScanStoreJson(store))
  } catch {
    // A cache that cannot be written is a cache miss next time, nothing worse.
  }
}

/** Pending store writes, per file — see {@link queueScanStoreWrite}. */
const scanStoreWrites = new Map<string, Promise<void>>()

/**
 * Serialize writes to one store file, each folding into a FRESH read.
 *
 * A scan holds the store open across a whole hython run (tens of seconds), so
 * two projects scanned concurrently — the sweep runs two workers — would each
 * write a store based on what it read at the start, and the last writer would
 * drop the other's entry. Re-reading at write time, in a per-file queue, makes
 * concurrent results append instead of overwrite. (Two WINDOWS can still race
 * on the shared source store — the atomic write keeps that to a lost entry,
 * never a corrupt file, and a lost entry is just a rescan later.)
 */
function queueScanStoreWrite(
  path: string,
  mutate: (store: HoudiniScanStore) => HoudiniScanStore,
): Promise<void> {
  const next = (scanStoreWrites.get(path) ?? Promise.resolve()).then(async () => {
    try {
      await writeScanStore(path, mutate(await readScanStore(path)))
    } catch {
      // The cache may never fail a scan — and a rejection here would also
      // poison the queue for every later write on this path. A write that
      // cannot be prepared is dropped; its entry is a rescan later.
    }
  })
  scanStoreWrites.set(path, next)
  return next
}

/**
 * The three transferable parts of a material setup.
 *
 * They are one setup, not three independent ones: a baker names its material
 * (`MI_Skin`) and its layers name UV channels (`uv_original`, `uv_geoshell`) as
 * plain text, so bakers copied without the slots that define those names — and
 * the UV channels that create them — import cleanly and bake nothing.
 */
export const MATERIAL_SECTIONS = ['materials', 'uvChannels', 'bakers'] as const
export type MaterialSection = (typeof MATERIAL_SECTIONS)[number]

/**
 * The skeleton node's three top-level tabs, transferred as whole subtrees.
 *
 * Unlike a material section (one multiparm list), each of these mixes flat
 * settings with nested lists — bone renames, reparents, physics-bone offsets —
 * so they copy WHOLESALE: appending 22 bone renames onto 22 existing ones would
 * make 44 rules, not a merged setup. Daz bone names are fixed per generation,
 * which is what makes the block reusable across characters at all.
 */
export const SKELETON_SECTIONS = ['general', 'skeleton', 'skinWeights'] as const
export type SkeletonSection = (typeof SKELETON_SECTIONS)[number]

/** Which node kind a transfer targets — one panel tab each. */
export const NODE_KINDS = ['material', 'skeleton'] as const
export type NodeKind = (typeof NODE_KINDS)[number]

const transferInput = z.object({
  /** Which node kind this transfer is for — decides the valid `sections`. */
  nodeType: z.enum(NODE_KINDS).default('material'),
  source: nodeRef,
  /** One or more target nodes; several may live in the same project. */
  targets: z.array(nodeRef).min(1),
  /** Which parts of the setup to copy — at least one. Validated against the
   *  node kind below, so a skeleton section can never reach a material run. */
  sections: z.array(z.enum([...MATERIAL_SECTIONS, ...SKELETON_SECTIONS])).min(1),
  /** Restrict the material slots (and the bakers naming them) to these slot
   *  names. Empty = every material. This is the selection that matters in
   *  practice: a user reuses "the same skin" or "that one dress", not a whole
   *  node — and skin slots merge identically across a Daz generation, while
   *  clothing only matches when the same asset is worn. */
  materials: z.array(z.string()).default([]),
  /** Point Daz-library texture paths at `$DAZ3D_LIB` instead of copying them
   *  absolute. The variable is the one the studio upserts into every configured
   *  `houdini.env` (storage/houdini-env.ts), so a rewritten setup keeps working
   *  when the library moves — or on a machine whose library is on another
   *  drive. Off copies the paths exactly as the source stored them. */
  useLibVar: z.boolean().default(true),
  /** true = the selected sections are wiped at the target first; false =
   *  append (material slots merge by name rather than duplicating). */
  replace: z.boolean(),
  /** true = report what WOULD happen and write nothing. */
  dryRun: z.boolean(),
})

/**
 * Resolve hython + the version-matched Houdini prefs folder.
 *
 * A near-twin of the resolution in `api/houdini.ts` (Generate project / Export
 * too). Deliberately NOT shared with them here: those two sit on the shipped
 * generate and export paths, and this feature is not a reason to touch either.
 * Matching prefs are mandatory for the same measured reason — hython inherits
 * the studio's environment, and resolving another version's (or no) prefs means
 * the DazToHue otls never load, so every DazToHueMaterial node would come back
 * as an unknown type and a scan would report an empty project.
 */
async function resolveHython(): Promise<{ hythonPath: string; houdiniPrefDir: string }> {
  const settings = await storage.getSettings()
  const installDir = settings.houdiniInstallFolder.trim()
  if (!installDir) {
    throw new Error(
      'Set the Houdini installation folder in Settings first — the material utilities run hython.',
    )
  }
  const hythonPath = joinPath(installDir.replace(/\\/g, '/'), 'bin/hython.exe')
  if (!(await exists(hythonPath))) {
    throw new Error(
      `hython was not found:\n${hythonPath}\nCheck the Houdini installation folder in Settings.`,
    )
  }
  const houdiniPrefDir = matchingHoudiniDocsFolder(installDir, [
    settings.houdiniDocsFolder,
    ...settings.extraHoudiniDocsFolders,
  ])
  if (!houdiniPrefDir) {
    const version = houdiniVersionFromInstall(installDir)
    throw new Error(
      version
        ? `The Houdini installation (${version}) has no matching documents folder — add "…\\Documents\\houdini${version}" as a Houdini documents folder in Settings.`
        : `Could not read a Houdini version from the installation folder:\n${installDir}\nPoint it at a versioned install (e.g. "…\\Houdini 22.0.368").`,
    )
  }
  return { hythonPath, houdiniPrefDir }
}

/** Write the script + request into app-data and run one operation. */
async function runMaterialUtil(request: unknown): Promise<MaterialUtilReport> {
  const { hythonPath, houdiniPrefDir } = await resolveHython()
  const dir = await storage.dataPath(HOUDINI_SCRIPTS_FOLDER)
  await mkdir(dir, { recursive: true })
  const scriptPath = joinPath(dir, 'material_utils.py')
  const files = runFiles()
  const requestPath = joinPath(dir, files.requestPath)
  const resultPath = joinPath(dir, files.resultPath)
  await storage.writeTextFileAtomic(scriptPath, materialUtilsScript)
  await storage.writeTextFileAtomic(requestPath, JSON.stringify(request, null, 2))

  await sweepStaleRunFiles(dir)

  try {
    // Never a bare invoke<T>() cast — the report crosses Python → serde → here,
    // and the shared fixture (contracts/material-util-report.json) pins all three.
    const report = materialUtilReportSchema.parse(
      await invoke('run_houdini_material_util', {
        request: { hythonPath, scriptPath, requestPath, resultPath, houdiniPrefDir },
      }),
    )
    if (!report.ok) throw new Error(report.error || 'The material utility failed.')
    return report
  } finally {
    // In a `finally`, not on the success path: a failed run's files are exactly
    // the ones nobody will ever look at again, and per-run names mean a leak
    // here accumulates instead of being overwritten.
    await Promise.all(
      [requestPath, resultPath].map(async (path) => {
        try {
          if (await exists(path)) await remove(path)
        } catch {
          // locked — the age sweep above collects it on a later run
        }
      }),
    )
  }
}

/**
 * Drop material-utility run files left behind by a crash.
 *
 * ONLY files older than {@link STALE_RUN_MS}: a run still in flight owns files
 * that are seconds old, and deleting those would recreate the very race the
 * per-run names removed. An app-generated file that nothing collects is how a
 * disk fills, so this is the bound.
 */
const STALE_RUN_MS = 60 * 60 * 1000

async function sweepStaleRunFiles(dir: string): Promise<void> {
  try {
    const entries = await readDir(dir)
    const cutoff = Date.now() - STALE_RUN_MS
    await Promise.all(
      entries
        .filter((entry) => entry.isFile && /^material-util-.*\.json$/.test(entry.name))
        .map(async (entry) => {
          const path = joinPath(dir, entry.name)
          try {
            const info = await stat(path)
            const changed = info.mtime?.getTime() ?? info.birthtime?.getTime() ?? 0
            if (changed && changed < cutoff) await remove(path)
          } catch {
            // vanished or locked — nothing to do
          }
        }),
    )
  } catch {
    // the folder may not exist yet on a first run
  }
}

/**
 * Every DazToHueMaterial node in the given projects.
 *
 * One hython process opens the files in turn — starting it costs far more than
 * a single extra `.hip`, so the panel scans in batches rather than per project.
 * An unreadable project comes back as `ok: false` with its reason instead of
 * failing the whole scan.
 */
export async function scanHoudiniMaterials({
  data,
}: {
  data: unknown
}): Promise<Array<MaterialScanProject>> {
  const { hipPaths, projectId, characterId } = scanInput.parse(data)
  if (hipPaths.length === 0) return []
  if (!isTauri()) {
    throw new Error('Scanning Houdini projects needs the desktop app (it runs hython).')
  }
  // Serve unchanged files from cache and only send the rest to hython. When
  // everything is cached this returns without starting a process at all —
  // reopening the drawer on projects nobody touched is then instant.
  //
  // TWO layers, same mtime key: the in-memory Map answers within a session, the
  // on-disk store survives a restart and is shared between windows. The disk
  // read costs one small JSON; the miss it saves costs a whole hython start.
  // The persistent layer must never be able to FAIL a scan: it is an
  // optimisation, and a broken cache degrading to "no cache" is correct where
  // degrading to "no scan" is not. (Learned the hard way — an unguarded store
  // path resolution took the Utils drawer's whole project list down with it.)
  let storePath = ''
  let stored = emptyScanStore()
  try {
    storePath = await scanStorePath(projectId, characterId)
    stored = await readScanStore(storePath)
  } catch {
    storePath = ''
  }
  const keys = await Promise.all(hipPaths.map(scanKey))
  const cached = new Map<string, MaterialScanProject>()
  const stale: Array<string> = []
  hipPaths.forEach((hipPath, i) => {
    const key = keys[i]
    const hit = (key ? scanCache.get(key) : undefined) ?? freshScan(stored, hipPath, key)
    if (hit) cached.set(hipPath, hit)
    else stale.push(hipPath)
  })
  if (stale.length === 0) {
    return hipPaths.map((p) => cached.get(p)).filter((p): p is MaterialScanProject => Boolean(p))
  }

  // Identical scans already in flight are SHARED rather than started again: a
  // scan costs a whole hython start plus seconds per `.hip`, and the panel can
  // easily ask twice (React StrictMode double-fires its effect in dev, and
  // Rescan is clickable while one is running). Deliberately scans only —
  // a transfer is not idempotent and must never be coalesced.
  const key = JSON.stringify(stale)
  const running = inFlightScans.get(key)
  const pending =
    running ??
    runMaterialUtil({ op: 'scan', hipPaths: stale })
      .then((report) => report.projects)
      .finally(() => {
        inFlightScans.delete(key)
      })
  if (!running) inFlightScans.set(key, pending)
  const fresh = await pending

  // Re-key AFTER the scan: hython read the file at that moment, so the mtime
  // taken before it is the one this result describes. Only ok results are
  // cached — a failure is a reason to look again, not a fact to remember.
  const persist: Array<{ hipPath: string; key: string; project: MaterialScanProject }> = []
  fresh.forEach((project) => {
    const i = hipPaths.findIndex((p) => normalizePath(p) === normalizePath(project.hipPath))
    const cacheAt = i >= 0 ? keys[i] : ''
    if (cacheAt && project.ok) {
      cacheScan(cacheAt, project)
      persist.push({ hipPath: hipPaths[i], key: cacheAt, project })
    }
  })
  if (persist.length > 0 && storePath) {
    await queueScanStoreWrite(storePath, (store) =>
      withScanResults(store, persist, new Date().toISOString()),
    )
  }

  const byPath = new Map(fresh.map((p) => [normalizePath(p.hipPath).toLowerCase(), p]))
  return hipPaths
    .map((p) => cached.get(p) ?? byPath.get(normalizePath(p).toLowerCase()))
    .filter((p): p is MaterialScanProject => Boolean(p))
}

/** Scans in flight, keyed by their file list — see {@link scanHoudiniMaterials}. */
const inFlightScans = new Map<string, Promise<Array<MaterialScanProject>>>()

/**
 * How many hython processes a background sweep may run at once.
 *
 * Not unbounded, even though the projects are independent: each one is a whole
 * Houdini interpreter loading the DazToHue otls, so a character with five
 * projects would spike five of them the first time its page is opened. Two keeps
 * the machine usable while the user carries on working — which is the entire
 * point of scanning in the background rather than on demand.
 */
const BACKGROUND_SCAN_CONCURRENCY = 2

/** Characters whose background sweep is already running — a second trigger (the
 *  route's focus refetch, a fast re-navigation) joins it instead of starting
 *  another set of hython processes. */
const sweeps = new Map<string, Promise<void>>()

const characterScopeInput = z.object({
  projectId: z.string().min(1),
  id: z.string().min(1),
})

/**
 * Scan this character's own Houdini projects in the background, filling the
 * store the cards and the Utils drawer read.
 *
 * Fire-and-forget: it resolves when the sweep is done, but every caller is
 * expected to ignore that — the results land in the store, and the UI reads the
 * store. Anything that goes wrong (no Houdini configured, an unreadable `.hip`)
 * stays silent here; a background job must never toast at somebody who didn't
 * ask for it. The Utils drawer is where problems are reported and repaired.
 *
 * **Only projects INSIDE the character folder.** A `.hip` the user linked from
 * their own tree is theirs: the studio has no `$JOB` expectation for it, cannot
 * repair it, and scanning it would cost a hython start to produce a verdict
 * nobody can act on.
 *
 * Already-fresh projects cost nothing — `scanHoudiniMaterials` short-circuits on
 * the mtime key before starting a process — so calling this on every character
 * page load is cheap once the cache is warm.
 */
export async function scanCharacterHoudiniProjects({ data }: { data: unknown }): Promise<void> {
  const { projectId, id } = characterScopeInput.parse(data)
  if (!isTauri()) return
  const running = sweeps.get(`${projectId}|${id}`)
  if (running) return running
  const sweep = (async () => {
    try {
      const { character, charFolder } = await prefillContext({ projectId, id })
      const inside = character.houdiniProjects.filter((hip) => insideFolder(hip, charFolder))
      // Prune first, so unlinking a project drops its entry even when nothing
      // needs re-scanning. The keep-list is everything still LINKED, not just
      // what the sweep scans: the drawer stores its own scans of outside-folder
      // links here too, and pruning those would throw away an earned scan of a
      // project the character still uses.
      const storePath = await scanStorePath(projectId, id)
      await queueScanStoreWrite(storePath, (store) =>
        withScanResults(store, [], new Date().toISOString(), character.houdiniProjects),
      )
      // A worker pool at the concurrency cap — as one project finishes the next
      // starts, rather than waiting for a whole batch. Each trip goes through
      // `scanHoudiniMaterials`, so the mtime short-circuit, the in-flight
      // coalescing and the store write all still apply.
      let next = 0
      const worker = async (): Promise<void> => {
        const i = next++
        if (i >= inside.length) return
        await scanHoudiniMaterials({
          data: { hipPaths: [inside[i]], projectId, characterId: id },
        }).catch(() => [])
        return worker()
      }
      await Promise.all(
        Array.from({ length: Math.min(BACKGROUND_SCAN_CONCURRENCY, inside.length) }, worker),
      )
    } catch {
      // Silent by design — see the doc comment.
    } finally {
      sweeps.delete(`${projectId}|${id}`)
    }
  })()
  sweeps.set(`${projectId}|${id}`, sweep)
  return sweep
}

/** Whether `hip` lives inside `folder` (separator- and case-insensitive). */
function insideFolder(hip: string, folder: string): boolean {
  // path-trim, not /\/+$/ — that regex shape is the polynomial-ReDoS CodeQL
  // alert this repo has reintroduced twice already (.ai/gotchas.md).
  const norm = (p: string) => stripTrailingSeparators(p.trim().replace(/\\/g, '/').toLowerCase())
  const root = norm(folder)
  return root !== '' && norm(hip).startsWith(`${root}/`)
}

/**
 * The character's projects as the store has them — no hython, no waiting.
 *
 * This is what the Utils drawer opens on: it reads what the background sweep
 * and the drawer's own previous scans left, and scans only what the store
 * doesn't cover — it never WAITS on the sweep, because a sweep is not
 * guaranteed to deliver (no Houdini configured, a project outside the
 * character folder — the sweep skips those by design, see
 * {@link scanCharacterHoudiniProjects}, but the drawer's scan of one lands
 * here too, so the next open is served from the store).
 *
 * Stale entries are skipped rather than served: a `.hip` saved in Houdini since
 * the last sweep has a new mtime, so it simply isn't in the answer, and the
 * caller sees it as "not scanned yet" while the sweep catches up.
 */
export async function fetchCachedHoudiniScans({
  data,
}: {
  data: unknown
}): Promise<Array<MaterialScanProject>> {
  const { projectId, id } = characterScopeInput.parse(data)
  if (!isTauri()) return []
  try {
    const { character } = await prefillContext({ projectId, id })
    const stored = await readScanStore(await scanStorePath(projectId, id))
    const hits = await Promise.all(
      character.houdiniProjects.map(async (hipPath) =>
        freshScan(stored, hipPath, await scanKey(hipPath)),
      ),
    )
    return hits.filter((p): p is MaterialScanProject => p !== null)
  } catch {
    return []
  }
}

/** One project's stored verdict, for the character page's cards. */
export interface HoudiniProjectStatus {
  hipPath: string
  /** false only when a scan EXISTS and found something wrong — an unscanned
   *  project is never reported as unhealthy (see `validateHoudiniProject`). */
  ok: boolean
  /** Tooltip text; '' when healthy or not scanned yet. */
  summary: string
  /** Whether a scan has been stored for this project at all. */
  scanned: boolean
}

/**
 * The stored verdict for each of a character's Houdini projects — read only, no
 * hython. Projects outside the character folder are reported as unscanned:
 * nothing scans them, so nothing can judge them.
 */
export async function fetchHoudiniProjectStatus({
  data,
}: {
  data: unknown
}): Promise<Array<HoudiniProjectStatus>> {
  const { projectId, id } = characterScopeInput.parse(data)
  if (!isTauri()) return []
  try {
    const { character, charFolder } = await prefillContext({ projectId, id })
    const stored = await readScanStore(await scanStorePath(projectId, id))
    return Promise.all(
      character.houdiniProjects.map(async (hipPath) => {
        const scan = insideFolder(hipPath, charFolder)
          ? freshScan(stored, hipPath, await scanKey(hipPath))
          : null
        const health = validateHoudiniProject(scan, charFolder)
        return { hipPath, ok: health.ok, summary: health.summary, scanned: scan !== null }
      }),
    )
  } catch {
    return []
  }
}

/**
 * Scanned projects, keyed by path + mtime.
 *
 * Opening a `.hip` costs tens of seconds, and the drawer is built for REPEATED
 * use — pick a template, transfer, come back. Re-reading a file that hasn't
 * changed since the last look is the single most wasteful thing this feature
 * did. The mtime IS the invalidation: a transfer rewrites the target, so its
 * next scan misses and re-reads exactly the file that changed while its
 * neighbours stay cached.
 */
const scanCache = new Map<string, MaterialScanProject>()

/** Bounded so a long session can't grow it without limit (app-generated state
 *  needs a ceiling). Oldest-inserted goes first — Map preserves insertion order. */
const SCAN_CACHE_MAX = 64

function cacheScan(key: string, project: MaterialScanProject): void {
  scanCache.set(key, project)
  while (scanCache.size > SCAN_CACHE_MAX) {
    const oldest = scanCache.keys().next().value
    if (oldest === undefined) break
    scanCache.delete(oldest)
  }
}

/** `<path>|<mtime>` — '' when the file can't be stat'd, which means "don't
 *  cache": an unreadable path must be re-attempted, not remembered as broken. */
async function scanKey(hipPath: string): Promise<string> {
  try {
    const info = await stat(hipPath)
    const mtime = info.mtime?.getTime()
    return mtime ? `${normalizePath(hipPath).toLowerCase()}|${mtime}` : ''
  } catch {
    return ''
  }
}

const defaultsInput = z.object({
  targets: z
    .array(
      z.object({
        hipPath: z.string().min(1),
        /** The folder `$JOB` should carry — the CHARACTER folder, the same
         *  value `create_houdini_project` bakes into a new project. */
        jobDir: z.string().min(1),
      }),
    )
    .min(1),
  /** true = report what WOULD change and write nothing. */
  dryRun: z.boolean(),
})

/**
 * Repoint each project's `$JOB` at the folder the studio expects.
 *
 * `$JOB` is scene state saved with the `.hip`, so an EXISTING project keeps
 * whatever it was created with — v0.64 fixed only newly generated ones. This is
 * that migration: without it, a hand-picked export path in an old project keeps
 * coming back absolute, because Houdini collapses a path above `$HIP` to a
 * variable only when it sits under `$JOB` (and the old value sat BELOW the
 * exports).
 *
 * Writes a `.hip`, so it carries the transfer's guarantees: a dry run that
 * changes nothing, and one rolling backup beside Houdini's own before any save.
 * A project already on the right folder is reported and left untouched.
 */
export async function repairHoudiniDefaults({
  data,
}: {
  data: unknown
}): Promise<MaterialUtilReport> {
  const input = defaultsInput.parse(data)
  if (!isTauri()) {
    throw new Error('Repairing Houdini project settings needs the desktop app (it runs hython).')
  }
  return runMaterialUtil({ op: 'defaults', ...input })
}

const repathInput = z.object({
  targets: z
    .array(
      z.object({
        hipPath: z.string().min(1),
        /** The `$JOB` the project must ALREADY carry. The Python refuses a
         *  mismatch rather than repathing against a stale root — see below. */
        jobDir: z.string().min(1),
      }),
    )
    .min(1),
  dryRun: z.boolean(),
})

/**
 * Make a project's stored references portable, and rebuild broken ones.
 *
 * The other half of the `$JOB` story: {@link repairHoudiniDefaults} fixes what
 * the user picks AFTERWARDS, this fixes what is already stored. Every absolute
 * reference under `$HIP` / `$JOB` / `$DAZ3D_LIB` is rewritten relative to it,
 * and any DazToHue import path whose file is missing is rebuilt from a sibling
 * that still resolves (only when the derived file actually exists).
 *
 * **`$JOB` must already be correct.** `jobDir` is the value the caller expects,
 * and the Python REFUSES a project whose `$JOB` differs — collapsing against a
 * stale root would bake the old project folder into every path it touched. The
 * panel gates the action on the same condition, so the refusal is a backstop
 * rather than the normal way to find out.
 *
 * Writes a `.hip`, so it carries the same guarantees as the transfer: a dry run
 * that changes nothing and reports exactly what a real run would do, and one
 * rolling backup beside Houdini's own before any save.
 */
export async function repathHoudiniReferences({
  data,
}: {
  data: unknown
}): Promise<MaterialUtilReport> {
  const input = repathInput.parse(data)
  if (!isTauri()) {
    throw new Error('Repathing Houdini references needs the desktop app (it runs hython).')
  }
  return runMaterialUtil({ op: 'repath', ...input })
}

const refreshInput = z.object({
  hipPaths: z.array(z.string().min(1)).min(1),
  /** true = load each project and run the tool, but never save. */
  dryRun: z.boolean(),
})

/**
 * Run the DazToHue shelf's own "Refresh Assets" tool against each project.
 *
 * A `.hip` stores the DazToHue asset definitions it was built with, so
 * switching the installed DazToHue release leaves every existing project on the
 * old ones. "Refresh Assets" is the vendor's answer to that, and until now the
 * only way to reach it was to open each project in Houdini by hand.
 *
 * The studio does not reimplement what the tool does — it EXECUTES the shelf
 * tool's own script, the same strategy `create_houdini_project` uses to build a
 * network, and for the same reason: the script is the ground truth of what the
 * installed release means by a refresh, so this tracks every release without a
 * code change here.
 *
 * Two honest limits, both surfaced in the drawer rather than buried:
 *
 * - **No detection.** Nothing in a scanned project says whether it needs this,
 *   and nothing afterwards says whether it helped — so this is never a check
 *   with a verdict, only an action the user chooses.
 * - **A weaker dry run.** It still loads each project and runs the tool; it
 *   simply never saves. Third-party code is being executed, so "the project
 *   file was not saved" is the guarantee — not "nothing was written".
 */
export async function refreshHoudiniAssets({
  data,
}: {
  data: unknown
}): Promise<MaterialUtilReport> {
  const input = refreshInput.parse(data)
  if (!isTauri()) {
    throw new Error('Refreshing DazToHue assets needs the desktop app (it runs hython).')
  }
  return runMaterialUtil({
    op: 'refresh',
    targets: input.hipPaths.map((hipPath) => ({ hipPath })),
    dryRun: input.dryRun,
  })
}

const prefillInput = z.object({
  projectId: z.string().min(1),
  /** The character whose values are filled in — its export layout is the
   *  source of every path. */
  id: z.string().min(1),
  /** The linked `.hip` files to fill. */
  hipPaths: z.array(z.string().min(1)).min(1),
  dryRun: z.boolean(),
})

/**
 * Fill the blank DazToHue parms of projects that ALREADY exist.
 *
 * Generate project wires a fresh network end-to-end; a project made before that
 * — or before the DazToHue release that adds a parm — can never be regenerated,
 * so the same values are offered as an action here.
 *
 * Two properties worth keeping:
 *
 *  - **Feature-detected per parm.** A parm the installed HDA doesn't have is
 *    reported as missing, never an error, so this ships today and starts
 *    filling the PoseAsset CSV path by itself the day that release lands.
 *  - **Only BLANK parms are written**, so it can never overwrite a value the
 *    user set by hand — the same posture 456.py takes with a blank export
 *    directory.
 *
 * The `$HIP`-relative prefix is computed **per target**, not once: how many
 * `..` hops reach the export root depends on how deep that particular `.hip`
 * sits, and a hand-linked project is routinely a level deeper than a generated
 * one.
 */
export async function prefillHoudiniNetwork({
  data,
}: {
  data: unknown
}): Promise<MaterialUtilReport> {
  const input = prefillInput.parse(data)
  if (!isTauri()) {
    throw new Error('Prefilling a DazToHue network needs the desktop app (it runs hython).')
  }
  const { character, charFolder, scenesRootAbs, relative, finalExportAbs } =
    await prefillContext(input)
  const targets = input.hipPaths.map((hipPath) => ({
    hipPath,
    values: buildHoudiniPrefill(character, {
      hipRefPrefix: relative
        ? hipRefPrefixFor([hipPath], charFolder, character.exportPath)
        : '',
      scenesRootAbs,
      // The character's `export/` folder, per target for the same reason the
      // import prefix is: how many `..` hops reach it depends on this `.hip`.
      finalExportDir:
        (relative ? hipRefPrefixFor([hipPath], charFolder, finalExportAbs) : '') || finalExportAbs,
      // No scene picker here: this fills an EXISTING network, and which scene it
      // imports is the network's own business. The primary is the only defensible
      // default — and only BLANK parms are written, so a project already wired to
      // another scene keeps every path it has.
    }),
  }))
  return runMaterialUtil({ op: 'prefill', targets, dryRun: input.dryRun })
}

/** The character + layout a prefill needs, resolved the same way generation
 *  resolves it (`api/houdini.ts`) so both fill identical values. */
async function prefillContext(input: { projectId: string; id: string }): Promise<{
  character: Character
  charFolder: string
  /** undefined for a sceneless character — `buildHoudiniPrefill` takes that and
   *  returns empty paths, which the Python then leaves alone. */
  scenesRootAbs: string | undefined
  relative: boolean
  /** The character's FINAL export folder (`<char>/<exportSubdir>`), absolute. */
  finalExportAbs: string
}> {
  const project = await resolveProject(input.projectId)
  const lib = charsRoot(project)
  const location = await locateCharacter(lib, input.id)
  if (!location) throw new Error(`Character ${input.id} not found`)
  const character = await storage.getCharacter(lib, input.id, location.definitionAbs)
  if (!character) throw new Error(`Character ${input.id} not found`)
  return {
    character,
    charFolder: location.folderAbs,
    scenesRootAbs: characterScenesRoot(character, location, project.dazSubdir ?? 'daz3d'),
    relative: project.houdiniPathStyle !== 'absolute',
    finalExportAbs: joinPath(location.folderAbs, normalizeRelFolder(project.exportSubdir)),
  }
}

const restoreInput = z.object({
  /** The project to put back — the file the failed run was saving. */
  hipPath: z.string().min(1),
  /** The `…_dthbak` file from that same run's report. The Rust side refuses
   *  anything else, so a stale report can never aim this at another scene. */
  backupPath: z.string().min(1),
})

/**
 * Revert a project to the state it was in before a run that failed.
 *
 * Every real run takes one rolling backup before it saves, and none of that is
 * shown while things work — a "backup written" line on every success is noise
 * that teaches the eye to skip the one line that matters. The backup surfaces
 * exactly once: as this offer, beside the entry that failed.
 *
 * A plain file copy in Rust rather than a Houdini round trip — hython would
 * spend tens of seconds re-saving a scene that is already correct on disk, and
 * that save is one more chance to damage what is being rescued. Restoring does
 * NOT consume the backup: it is rolling, and the next failure needs it too.
 */
export async function restoreHoudiniBackup({ data }: { data: unknown }): Promise<void> {
  const input = restoreInput.parse(data)
  if (!isTauri()) {
    throw new Error('Restoring a Houdini project backup needs the desktop app.')
  }
  await invoke('restore_houdini_backup', { request: input })
}

/**
 * Whether a path is one of the studio's own Houdini backups.
 *
 * The gate on every delete below. `_backup` (material_utils.py) writes exactly
 * `<dir>/backup/<name>_dthbak<ext>`, so anything else reaching the discard —
 * from a stale report, a hand-edited value, a future change to the Python —
 * is refused rather than deleted. Houdini's OWN backups live in the same
 * folder and are named `<name>_bak1.hip`; they must never be touched.
 */
export function isStudioBackup(path: string): boolean {
  return /_dthbak\.[^./\\]+$/i.test(path.trim())
}

const discardInput = z.object({
  /** The `…_dthbak` files to delete — anything else is skipped, not deleted. */
  paths: z.array(z.string().min(1)),
})

/**
 * Delete the backups one drawer session left behind.
 *
 * A backup is an UNDO BUFFER for this sitting, not an archive. Each one is a
 * full copy of the project (~8 MB for a real `.hiplc`), one lands beside every
 * project a run touches, and nothing else in the app would ever collect them —
 * exactly the shape of app-generated data that quietly fills a disk. So the
 * drawer offers to clear them on the way out, and this performs it.
 *
 * Never silent and never unasked: the panel puts this behind a confirm, because
 * the one case where a backup still matters is a failed run the user has not
 * undone yet.
 *
 * A file that cannot be removed (Houdini holding it open) is counted as kept
 * rather than raising — the caller reports how many of how many went, and the
 * next session offers the rest again.
 */
export async function discardHoudiniBackups({ data }: { data: unknown }): Promise<number> {
  const { paths } = discardInput.parse(data)
  if (!isTauri()) {
    throw new Error('Removing Houdini project backups needs the desktop app.')
  }
  const removed = await Promise.all(
    paths.filter(isStudioBackup).map(async (path) => {
      try {
        if (!(await exists(path))) return false
        await remove(path)
        return true
      } catch {
        // locked, or gone between the two calls — offered again next time
        return false
      }
    }),
  )
  return removed.filter(Boolean).length
}

/**
 * Whether two node references point at the SAME material node.
 *
 * Path comparison is case- and separator-insensitive (Windows): the target list
 * comes from a scan (whatever spelling Houdini reported) while the source may
 * have come from a file picker, so `D:\p\x.hiplc` and `d:/p/x.hiplc` are one
 * file. The node path itself is Houdini's own and compared exactly.
 */
export function isSameNode(
  a: { hipPath: string; nodePath: string },
  b: { hipPath: string; nodePath: string },
): boolean {
  const norm = (p: string) => p.trim().replace(/\\/g, '/').toLowerCase()
  return norm(a.hipPath) === norm(b.hipPath) && a.nodePath === b.nodePath
}

/**
 * Copy the source node's texture bakers onto the target nodes.
 *
 * `dryRun` changes nothing on disk and reports exactly what a real run would do
 * — including which materials each target is missing, which is the difference
 * between a copy that bakes and one that only looks copied.
 *
 * A real run saves each touched project ONCE, after taking a single rolling
 * backup into Houdini's own `backup/` folder (`<name>_dthbak.hiplc`).
 */
export async function transferHoudiniMaterials({
  data,
}: {
  data: unknown
}): Promise<MaterialUtilReport> {
  const input = transferInput.parse(data)
  // Checked BEFORE the host check so the refusal is testable (and so a browser
  // build reports the real mistake rather than "needs the desktop app").
  // A target that IS the source would be opened and saved by the same run —
  // append would double the node's own bakers, replace would be a no-op that
  // still rewrites the file.
  if (input.targets.some((t) => isSameNode(t, input.source))) {
    throw new Error('The source node is also a target — deselect it and run again.')
  }
  // A section belonging to the other node kind would be silently dropped by the
  // Python (it filters to the ones it knows), so a run could report success
  // having copied nothing. Refuse at the boundary instead.
  const valid: ReadonlyArray<string> =
    input.nodeType === 'skeleton' ? SKELETON_SECTIONS : MATERIAL_SECTIONS
  const stray = input.sections.filter((s) => !valid.includes(s))
  if (stray.length > 0) {
    throw new Error(`Not a ${input.nodeType} section: ${stray.join(', ')}`)
  }
  if (!isTauri()) {
    throw new Error('Transferring material setups needs the desktop app (it runs hython).')
  }
  // The library root is Settings' Daz library — the SAME value the studio
  // upserts as DAZ3D_LIB, so a rewritten path resolves to what Houdini has.
  // Reading it here (not in the Python) keeps settings access on this side.
  const dazLibRoot = input.useLibVar ? (await storage.getSettings()).dazLibraryFolder.trim() : ''
  if (input.useLibVar && !dazLibRoot) {
    throw new Error(
      'No Daz library folder is set in Settings, so texture paths cannot be pointed at $DAZ3D_LIB — set it, or turn the option off to copy the paths as they are.',
    )
  }
  return runMaterialUtil({ op: 'transfer', ...input, dazLibRoot })
}
