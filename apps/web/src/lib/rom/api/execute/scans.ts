/**
 * The scan runs that ride the same Runner handoff: the whole-project scan, the
 * per-scene scan, and the ROM animations they produce.
 *
 * Top of `api/execute/` alongside `jobs.ts` — imports `primitives.ts` and
 * `run-state.ts`, and nothing imports this but the barrel. `jobs.ts` is its
 * PEER, not something it builds on: these scans ride the same handoff, but
 * they reach it through `run-state`, never through `jobs`.
 */
import { exists, mkdir, readTextFile, remove, stat } from '@tauri-apps/plugin-fs'
import { isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

import * as storage from '../../storage'
import {
  SCAN_CONFIG_FILE,
  jobFileJson,
  normalizeSceneKey,
  parseJobFileJson,
  romAnimationPath,
  scanConfigJson,
} from '../../execute-jobs'
import { BUILD_ROM_ANIMATION_SCRIPT } from '@dth/rom'

import type { GenesisVersion } from '@dth/rom'
import {
  SCAN_RUN_SCRIPT,
  parseScanResult,
  scanCsvPath,
  scanResultPath,
  scanRunScript,
} from '../../scan-run.ts'
import { charScopeInput, charsRoot, joinPath, projectIdInput, resolveProject } from '../core'
import type { ExporterJob, ScanProductsConfig, ScanSceneWork } from '../../execute-jobs'

import {
  OPEN_SCENE_PICKUP_TIMEOUT_MS,
  OPEN_SCENE_POLL_MS,
  assertHandoffOwned,
  dazStudioRunningNative,
  exporterJobFilePaths,
  launchDazSceneless,
  loadCharacter,
  mtimeOf,
} from './primitives.ts'
import { resetExportProgressLog, runOwner } from './run-state.ts'

export const PROJECT_SCAN_RUN = '#project-scan'

/** One character's scannable scenes, as the Tools panel lists them. */
export interface ProjectScanCharacter {
  id: string
  name: string
  /** Which Genesis generation, so the panel's scene tiles crop their previews
   *  where Daz actually put the face for it (see lib/tip-framing). */
  genesis: GenesisVersion
  /** Linked scenes whose `.duf` is readable — the ones that can get a row. */
  scenes: Array<string>
  /** Linked scenes whose `.duf` is missing — named in the panel, never enqueued. */
  missing: Array<string>
}

export interface ProjectScanPlan {
  characters: Array<ProjectScanCharacter>
  /** Total scannable scenes across the project (the row count for a scene pass). */
  totalScenes: number
  /** The product pass can run: a DIM `ManifestFiles` folder is configured. That
   *  folder IS the product database — without one a scan could only report every
   *  asset as unmatched, so it is the one thing the pass needs. (The per-project
   *  "Daz Products" toggle is NOT part of this: it only decides whether the
   *  character page shows the tab.) */
  productsEnabled: boolean
  /** Same condition, kept as its own field because the panel words the two
   *  differently — "unavailable" vs "set the folder in Settings". */
  dimConfigured: boolean
}

/**
 * What a bulk scan of this project WOULD cover: every character, its readable
 * linked scenes, and whether the product pass is available at all. Read-only
 * and tolerant — a character whose `.duf` files are missing still appears (with
 * them listed as missing) rather than failing the whole plan, so the panel can
 * show the user exactly what is about to run before they start it.
 */
export async function fetchProjectScanPlan({ data }: { data: unknown }): Promise<ProjectScanPlan> {
  const { projectId } = projectIdInput.parse(data)
  if (!isTauri()) {
    return { characters: [], totalScenes: 0, productsEnabled: false, dimConfigured: false }
  }
  const project = await resolveProject(projectId)
  const settings = await storage.getSettings()
  const characters = await storage.listCharacters(charsRoot(project))
  const out: Array<ProjectScanCharacter> = []
  let totalScenes = 0
  for (const character of characters) {
    const linked = [character.scenePath, ...character.extraScenes].filter(Boolean)
    const scenes: Array<string> = []
    const missing: Array<string> = []
    for (const scene of linked) {
      if (await exists(scene).catch(() => false)) scenes.push(scene)
      else missing.push(scene)
    }
    if (scenes.length === 0 && missing.length === 0) continue
    totalScenes += scenes.length
    out.push({
      id: character.id,
      name: character.name,
      genesis: character.genesis,
      scenes,
      missing,
    })
  }
  return {
    characters: out,
    totalScenes,
    productsEnabled: settings.dimManifestsFolder.trim() !== '',
    dimConfigured: settings.dimManifestsFolder.trim() !== '',
  }
}

export const projectScanInput = z.object({
  /** The project folder to scan. Empty is legal for a BASE-ONLY run: the stock
   *  figures belong to no project, so the Tools panel offers that pass from the
   *  Home window too (where no project is open). */
  projectId: z.string().default(''),
  /** Rebuild the BASE morph + bone index from the stock figures first — row one
   *  of the batch, and the only row a project-less run can produce. */
  base: z.boolean().default(false),
  /** Scan every linked scene for the morphs the base index doesn't carry. */
  morphs: z.boolean().default(false),
  /** Run the Daz Products scan for every linked scene. */
  products: z.boolean().default(false),
  /**
   * Restrict the scene passes to these scenes (absolute paths, matched by
   * {@link normalizeSceneKey}). Omitted = every linked scene of every
   * character — a project can hold dozens, and re-scanning all of them to
   * refresh one outfit is minutes of Daz time per scene.
   *
   * Only ever NARROWS: a path that isn't a linked scene of this project can't
   * add a row, so a stale selection (a scene unlinked between the panel's plan
   * probe and the click) silently drops out instead of enqueueing a row that
   * could only fail. All of them dropping out is caught below as "nothing to
   * run" rather than handed to Daz as an empty batch.
   */
  scenes: z.array(z.string()).optional(),
})

export interface ProjectScanSummary {
  /** Rows enqueued (the base row, if any, plus one per scene). */
  rows: number
  /** Scenes that got a row. */
  scenes: number
  /** Characters contributing at least one row. */
  characters: number
  /** Linked scenes skipped because their `.duf` is missing. */
  skipped: Array<string>
  dazWasRunning: boolean
}

/**
 * Hand a WHOLE-PROJECT scan to the Runner — Tools → **Scan project**, the
 * one-click "start it and wait" pass over everything a project can be scanned
 * for. One `bulk-export` batch:
 *
 *   row 0 (optional)  `.Build_Genesis_Index_Bulk.dsa` on an EMPTY scene — the
 *                     base morph + bone index. It runs FIRST on purpose: the
 *                     scene scans filter themselves against that index, so a
 *                     rebuild has to land before they read it, or the first
 *                     scan of a fresh install files the whole stock figure as
 *                     "what this scene adds".
 *   rows 1..n         `.Scan_Scene_Bulk.dsa`, one per linked scene, with the
 *                     sidecar ({@link SCAN_CONFIG_FILE}) saying whether that
 *                     scene is due for morphs, products, or both. One row per
 *                     SCENE rather than per scene-and-kind: opening a scene is
 *                     the slow part, so both scans share the one open.
 *
 * Same handoff mechanics as every other batch — one global job file, refuse
 * while another is live, clear a finished-but-unswept `running_`, self-heal the
 * runtime install, start Daz when it's closed, and the same ~10s claim-wait so
 * a batch is never handed to a shutting-down Daz.
 *
 * Throws with a user-facing message when the selection can produce no rows at
 * all — a batch of nothing would otherwise "succeed" without scanning anything.
 */
export async function startProjectScan({ data }: { data: unknown }): Promise<ProjectScanSummary> {
  const { projectId, base, morphs, products, scenes: chosenScenes } = projectScanInput.parse(data)
  if (!isTauri()) throw new Error('Scanning a project needs the desktop app (Daz Studio is launched natively).')
  if (!base && !morphs && !products) throw new Error('Pick at least one thing to scan.')
  // The scene passes are per project; the base pass is not. With no project
  // open (the Home window) only the base pass can run.
  if ((morphs || products) && !projectId) {
    throw new Error('Open a project to scan its characters — only the base index can be rebuilt from here.')
  }

  const settings = await storage.getSettings()
  if (!settings.dazLibraryFolder) {
    throw new Error('Set “My DAZ 3D Library” in Settings first — the job file and the scripts live there.')
  }
  const project = projectId ? await resolveProject(projectId) : null
  if (products && project?.dazProductsEnabled !== true) {
    throw new Error('Daz Products is switched off for this project — enable it in Settings → Project first.')
  }

  const scriptsRoot = storage.studioScriptsDir(settings.dazLibraryFolder)
  // Self-heal before checking: an app updated since the last save has the new
  // runtime bundled but not yet installed (the marker makes this a no-op when
  // the install is already current) — the same guard the index build uses, and
  // this batch needs a script that only exists from runtime v53 on.
  await storage.copyRuntimeFiles(scriptsRoot).catch(() => {})

  const jobs: Array<ExporterJob> = []
  if (base) {
    const indexScript = joinPath(scriptsRoot, storage.GENESIS_INDEX_BULK_SCRIPT)
    if (!(await exists(indexScript))) {
      throw new Error(
        `The index script is not installed:\n${indexScript}\nRun Tools → Refresh assets to install it, then try again.`,
      )
    }
    jobs.push({ scenePath: '', scriptPath: indexScript })
  }

  const sceneWork: Array<{ scenePath: string; work: ScanSceneWork }> = []
  const skipped: Array<string> = []
  let charactersWithRows = 0
  // The user's scene pick, as match keys (undefined = every linked scene).
  const chosen = chosenScenes ? new Set(chosenScenes.map(normalizeSceneKey)) : undefined
  // `project` is non-null here: the guard above refuses a scene pass without one.
  if ((morphs || products) && project) {
    const sceneScript = joinPath(scriptsRoot, storage.SCAN_SCENE_BULK_SCRIPT)
    if (!(await exists(sceneScript))) {
      throw new Error(
        `The scene-scan script is not installed:\n${sceneScript}\nRun Tools → Refresh assets to install it, then try again.`,
      )
    }
    const characters = await storage.listCharacters(charsRoot(project))
    for (const character of characters) {
      // Per character, because the product scan's config is per character (its
      // identity and its own output folder) — the morph scan is global.
      const productsConfig: ScanProductsConfig | undefined = products
        ? {
            characterId: character.id,
            characterName: character.name,
            genesis: character.genesis,
            dimManifestPath: settings.dimManifestsFolder.replace(/\\/g, '/'),
            outputDir: (await storage.productScanDir(project.id, character.id)).replace(/\\/g, '/'),
            dazLibraryFolder: settings.dazLibraryFolder.replace(/\\/g, '/'),
          }
        : undefined
      let any = false
      for (const scene of [character.scenePath, ...character.extraScenes].filter(Boolean)) {
        // Outside the user's pick — not skipped work, just not asked for, so it
        // stays out of the summary's `skipped` list too.
        if (chosen && !chosen.has(normalizeSceneKey(scene))) continue
        // A missing `.duf` can only produce a failed row — name it in the
        // summary instead of enqueueing work that cannot run.
        if (!(await exists(scene).catch(() => false))) {
          skipped.push(scene)
          continue
        }
        sceneWork.push({
          scenePath: scene,
          work: {
            morphs,
            // The owning character's generation — the morph scan's fallback
            // when the scene's figures carry no readable asset identity.
            genesis: character.genesis,
            ...(productsConfig ? { products: productsConfig } : {}),
          },
        })
        jobs.push({ scenePath: scene, scriptPath: sceneScript })
        any = true
      }
      if (any) charactersWithRows++
    }
  }

  if (jobs.length === 0) {
    throw new Error(
      skipped.length > 0
        ? 'Every selected Daz scene is missing on disk — nothing could be scanned.'
        : chosen
          ? 'None of the selected scenes are linked to this project anymore — reopen Tools and pick again.'
          : 'This project has no linked Daz scenes to scan yet.',
    )
  }

  const paths = await exporterJobFilePaths()
  if (!paths) throw new Error('Set “My DAZ 3D Library” in Settings first.')
  if (await exists(paths.pending)) {
    throw new Error('A batch is already waiting for Daz Studio — let it start (or abort it) first.')
  }
  if (await exists(paths.running)) {
    const finished = await readTextFile(paths.running)
      .then((text) => parseJobFileJson(text)?.progress === 100)
      // Unreadable or torn: assume a live batch — refusing is the safe guess.
      .catch(() => false)
    if (!finished) {
      throw new Error('Daz Studio is working through a batch — try again when it finishes.')
    }
    await remove(paths.running).catch(() => {})
  }

  // The sidecar goes down BEFORE the job file: the Runner can claim the batch
  // the moment the job file appears, and a row that beat its own config would
  // fail with "not in the scan config" for no reason.
  await storage.writeTextFileAtomic(joinPath(scriptsRoot, SCAN_CONFIG_FILE), scanConfigJson(sceneWork))
  // No progress log for a scan — but the last export's must not stand in for
  // one (see resetExportProgressLog). Best effort, as above.
  await resetExportProgressLog().catch(() => {})
  const jobJson = jobFileJson(jobs)
  await storage.writeTextFileAtomic(paths.pending, jobJson)
  // Both windows can pass the exists-checks above — the read-back decides who
  // actually holds the handoff, BEFORE this window arms its watch on it.
  await assertHandoffOwned(paths.pending, jobJson)
  runOwner.current = {
    characterId: PROJECT_SCAN_RUN,
    total: jobs.length,
    startedAtMs: Date.now(),
    houdiniProjects: [],
    houdiniMode: 'export-selected',
    scenes: sceneWork.map((s) => s.scenePath),
    unrealProjects: [],
    unrealSets: [],
    // A scan is not an export mode at all; the sentinel run has no character
    // editor to draw task cards for, so the field's value never reaches a UI.
    mode: 'rom-export',
    // Not interruptible by the export flag: a scan spans MANY characters (so
    // there is no one flag to write) and it has its own way out —
    // {@link abortProjectScanRun}. The scan scripts probe nothing.
    cancelPath: '',
  }

  const dazWasRunning = await dazStudioRunningNative(false, 'export')
  const summary: ProjectScanSummary = {
    rows: jobs.length,
    scenes: sceneWork.length,
    characters: charactersWithRows,
    skipped,
    dazWasRunning,
  }
  if (!dazWasRunning) {
    // A fresh launch claims the file on startup — no wait (Daz can take long to
    // come up; the panel's pending state covers it, with Abort as the out).
    await launchDazSceneless('minimized')
    return summary
  }
  // A "running" Daz may be SHUTTING DOWN (the process lingers, its Runner poller
  // is already gone) — or running without the Runner. Same claim-wait as every
  // other handoff: take the batch back rather than leave it pending forever.
  const deadline = Date.now() + OPEN_SCENE_PICKUP_TIMEOUT_MS
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, OPEN_SCENE_POLL_MS))
    if (!(await exists(paths.pending).catch(() => true))) return summary
  }
  if (runOwner.current?.characterId === PROJECT_SCAN_RUN) {
    runOwner.current = null
    await remove(paths.pending).catch(() => {})
  }
  throw new Error(
    'Daz Studio never picked the job up — it is most likely still shutting down (or the Runner plugin is not running). The handoff was taken back; wait for Daz Studio to close fully, then try again.',
  )
}

/**
 * Abort a project-scan handoff still WAITING for Daz Studio (the un-renamed job
 * file): delete it and drop the watch — the Tools panel's way out of the pending
 * state. The sidecar is left in place: it is inert without a batch pointing at
 * it, and the next scan overwrites it. A file the Runner already claimed is left
 * alone; the watch still ends ({@link dismissExportRun}'s promise).
 */
export async function abortProjectScanRun(): Promise<void> {
  if (runOwner.current?.characterId !== PROJECT_SCAN_RUN) return
  const paths = await exporterJobFilePaths()
  if (paths) await remove(paths.pending).catch(() => {})
  runOwner.current = null
}

/** A file's mtime in ms, or 0 when it doesn't exist / can't be stat'ed. */
export interface RomAnimationStatus {
  scenePath: string
  /** Where the saved ROM animation lives (whether or not it exists). */
  romPath: string
  /** A `rom-animations/<stem>_ROM.duf` exists for this scene. */
  exists: boolean
  /**
   * …and was built from the CURRENT inputs: its mtime is at/after both the
   * source `.duf` and the character's generated ROM script (rewritten on every
   * save, so it dates the definition the ROM would be built from now).
   *
   * That makes it a MUCH stricter test than it reads: since every character
   * save rewrites the script, one edit of anything stales every saved animation
   * of that character. So `current` gates whether a REBUILD is worth offering —
   * never whether the file may be opened. Stale ⇒ the card marks the open entry
   * and adds "Open and Generate" under it; {@link exists} alone decides that the
   * entry is there at all.
   */
  current: boolean
}

/**
 * Every linked scene's saved-ROM-animation state, derived from the FILES alone
 * — no stamps, so it re-reads correctly on every window focus.
 *
 * This deliberately does NOT use the export-handoff stamps
 * ({@link fetchExecuteScenes}'s `affected`): those record the last EXPORT, an
 * unrelated event. A ROM-animation build writes no stamp, so a freshly built
 * animation still read "affected" (stale) forever — and a character that never
 * exported had every scene stale from the start.
 */
export async function fetchRomAnimations({
  data,
}: {
  data: unknown
}): Promise<Array<RomAnimationStatus>> {
  const { projectId, id } = charScopeInput.parse(data)
  if (!isTauri()) return []
  const { project, character } = await loadCharacter(projectId, id)
  const settings = await storage.getSettings()
  // The generated ROM-only script IS the compiled ROM inputs — its mtime dates
  // the definition. Missing library/script (never generated) ⇒ 0, i.e. only the
  // scene file gates freshness.
  const scriptMtime = settings.dazLibraryFolder
    ? await mtimeOf(
        joinPath(
          storage.studioCharScriptsDir(settings.dazLibraryFolder, project.name, character.name),
          BUILD_ROM_ANIMATION_SCRIPT,
        ),
      )
    : 0
  const linked = [character.scenePath, ...character.extraScenes].filter(Boolean)
  return Promise.all(
    linked.map(async (scenePath) => {
      const romPath = romAnimationPath(scenePath)
      const romMtime = await mtimeOf(romPath)
      if (romMtime === 0) return { scenePath, romPath, exists: false, current: false }
      const sceneMtime = await mtimeOf(scenePath)
      return {
        scenePath,
        romPath,
        exists: true,
        current: romMtime >= sceneMtime && romMtime >= scriptMtime,
      }
    }),
  )
}

/**
 * Whether the saved ROM animation at `romPath` is FRESH — written at/after
 * `sinceMs`. The generate flow polls this instead of bare existence, because a
 * regenerate OVERWRITES an existing file: only a new mtime means the Daz run
 * saved. Best-effort false (missing file, unreadable stat).
 */
export async function romAnimationFresh({ data }: { data: unknown }): Promise<boolean> {
  const { romPath, sinceMs } = z
    .object({ romPath: z.string().min(1), sinceMs: z.number() })
    .parse(data)
  if (!isTauri()) return false
  try {
    const info = await stat(romPath)
    return (info.mtime?.getTime() ?? 0) >= sinceMs
  } catch {
    return false
  }
}

// --- Import from Daz scene: a headless Scan_Frames run ----------------------

/** Tolerance on "this file was written by THIS run": FAT/exFAT stamp mtimes to
 *  2-second granularity, so a file written right after the clock reading can
 *  land just before it. A scan takes many seconds, so nothing real is missed. */
export const MTIME_SLACK_MS = 2000

export const scanSceneInput = z.object({
  /** The `.duf` to open and scan — already validated by `sceneScanRows`. */
  scenePath: z.string().min(1),
  /** The character's generation, e.g. "G9". The silent run selects the figure
   *  by ASSET identity from it (`dthFindGenerationFigure`). */
  genesis: z.string().min(1),
})

/** Where a started scan will land, so the caller can poll for it. */
export interface SceneScanStarted {
  /** The CSV this run is predicted to write ({@link scanCsvPath}) — the studio's
   *  half of the naming contract with the `.dsa`, stated where it can be
   *  asserted. NOT the path to import: the poll reports the one the result file
   *  names, which is authoritative even if this guess were wrong. */
  csvPath: string
  resultPath: string
  /** When the handoff went down. The poll requires the CSV to be newer than
   *  this, which is what keeps a previous scan's file from being imported as
   *  this run's (see {@link fetchSceneScanProgress}). */
  startedAtMs: number
  /** False ⇒ the studio started Daz itself, and the wait covers a cold launch.
   *  True ⇒ a live Runner claimed the batch before this returned. */
  dazWasRunning: boolean
}

/**
 * Hand a headless frame scan of `scenePath` to the job runner.
 *
 * The same handoff every batch uses — one global job file, refuse while another
 * is live, read back what we wrote — because a scan is a batch like any other
 * from the Runner's point of view: it opens the scene and runs the script.
 *
 * **The stale-result delete is not tidying.** The poll's whole termination
 * condition is "the result file for this scene appeared". A previous scan of
 * the same scene left one, so without removing it first the dialog would read
 * the OLD verdict — instantly — and call the new scan finished before Daz had
 * opened anything. The previous CSV is deliberately NOT deleted: a scan that
 * then fails would have destroyed a working import for nothing, and `startedAtMs`
 * already stops the old file being read as this run's.
 *
 * Like every other handoff writer, a Daz that is ALREADY running gets the
 * claim-wait: the Runner renames the file within a poll interval, and when the
 * rename never comes the handoff is taken back rather than left pending
 * forever — a stranded job file blocks every later batch with "an export batch
 * is waiting", and this dialog would spin on a scan nobody is running.
 */
export async function startSceneScan({ data }: { data: unknown }): Promise<SceneScanStarted> {
  const { scenePath, genesis } = scanSceneInput.parse(data)
  if (!isTauri()) throw new Error('Scanning a Daz scene needs the desktop app.')
  const settings = await storage.getSettings()
  if (!settings.dazLibraryFolder) {
    throw new Error(
      'Set “My DAZ 3D Library” in Settings first — the job file and the scan script live there.',
    )
  }
  const outDir = await storage.scanFramesDir()
  const csvPath = scanCsvPath(outDir, scenePath)
  const resultPath = scanResultPath(outDir, scenePath)

  // The per-run script goes in the scripts ROOT, beside the runtime it includes
  // (it resolves `.DthUtils.dsa` / `.DthScanFrames.dsa` from its own folder).
  const scriptPath = joinPath(storage.studioScriptsDir(settings.dazLibraryFolder), SCAN_RUN_SCRIPT)
  const runtimeProbe = joinPath(storage.studioScriptsDir(settings.dazLibraryFolder), '.DthUtils.dsa')
  if (!(await exists(runtimeProbe))) {
    throw new Error(
      'The DTH runtime is not installed in your Daz library yet — save a character (or run Tools → Refresh assets) once, then try again.',
    )
  }

  const paths = await exporterJobFilePaths()
  if (!paths) throw new Error('Set “My DAZ 3D Library” in Settings first.')
  if (await exists(paths.pending)) {
    throw new Error('An export batch is waiting for Daz Studio — let it start (or abort it) first.')
  }
  if (await exists(paths.running)) {
    const finished = await readTextFile(paths.running)
      .then((text) => parseJobFileJson(text)?.progress === 100)
      .catch(() => false)
    if (!finished) {
      throw new Error('Daz Studio is working through an export batch — try again when it finishes.')
    }
    await remove(paths.running).catch(() => {})
  }

  await mkdir(outDir, { recursive: true }).catch(() => {})
  await remove(resultPath).catch(() => {})
  await storage.writeTextFileAtomic(scriptPath, scanRunScript({ outDir, resultPath, genesis }))

  // Stamped BEFORE the handoff, so every file this run writes is newer than it.
  const startedAtMs = Date.now()
  // No progress log for a morph scan either — and no inherited one (see
  // resetExportProgressLog). Best effort, as above.
  await resetExportProgressLog().catch(() => {})
  const jobJson = jobFileJson([{ scenePath, scriptPath }])
  await storage.writeTextFileAtomic(paths.pending, jobJson)
  await assertHandoffOwned(paths.pending, jobJson)
  const dazWasRunning = await dazStudioRunningNative(false, 'export')
  if (!dazWasRunning) {
    // A fresh launch claims the file on startup — no wait (Daz can take long to
    // come up; the dialog's waiting state covers it, with Cancel as the out).
    await launchDazSceneless('minimized')
    return { csvPath, resultPath, startedAtMs, dazWasRunning }
  }
  // A "running" Daz may be SHUTTING DOWN (the process lingers, its Runner poller
  // is already gone) — or running without the Runner plugin at all, which is the
  // one requirement of this feature nothing else can check. Same claim-wait as
  // every other handoff: take the batch back rather than leave it pending
  // forever, blocking every export and scan that comes after it.
  const deadline = Date.now() + OPEN_SCENE_PICKUP_TIMEOUT_MS
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, OPEN_SCENE_POLL_MS))
    // The rename IS the claim (contract v2 lifecycle, shared by every type).
    if (!(await exists(paths.pending).catch(() => true))) {
      return { csvPath, resultPath, startedAtMs, dazWasRunning }
    }
  }
  await remove(paths.pending).catch(() => {})
  throw new Error(
    'Daz Studio never picked the scan up — it is most likely still shutting down, or running without the Runner plugin (the same one DTH Export needs). The handoff was taken back; check the Runner in Settings, then try again.',
  )
}

/**
 * Abort a scan handoff still WAITING for Daz Studio — the dialog's way out of
 * the spinner, and the reason closing it can't strand the global job file.
 *
 * Deletes the pending file only when it is still OUR scan (its one row points at
 * {@link SCAN_RUN_SCRIPT}): an export batch queued meanwhile belongs to someone
 * else, and taking it away would strand that run instead. A batch the Runner has
 * already CLAIMED is left alone — the rename means Daz is running it, and the
 * result file it writes is simply nobody's business by then.
 */
export async function abortSceneScan(): Promise<void> {
  if (!isTauri()) return
  try {
    const paths = await exporterJobFilePaths()
    if (!paths) return
    const parsed = parseJobFileJson(await readTextFile(paths.pending).catch(() => ''))
    const jobs = parsed?.jobs ?? []
    // `every` on an empty list is vacuously true — an unrecognisable batch is
    // somebody's, not ours.
    const ours = jobs.length > 0 && jobs.every((job) => job.scriptPath.endsWith(SCAN_RUN_SCRIPT))
    if (ours) await remove(paths.pending).catch(() => {})
  } catch {
    // Nothing to take back, or unreadable — either way there is no scan of ours
    // left pending to abort.
  }
}

/**
 * Remove the Runner's claimed job file once it reports the batch finished.
 *
 * The export flow's progress watch owns this for its own batches; a scan has no
 * watch, so this is where it happens. Only a FINISHED file (`progress: 100`) is
 * removed — a live batch's file is somebody else's, and deleting it would strand
 * the run that owns it.
 */
export async function clearFinishedJobFile(): Promise<void> {
  try {
    const paths = await exporterJobFilePaths()
    if (!paths) return
    if (!(await exists(paths.running))) return
    const finished = await readTextFile(paths.running)
      .then((text) => parseJobFileJson(text)?.progress === 100)
      .catch(() => false)
    if (finished) await remove(paths.running).catch(() => {})
  } catch {
    // A leftover blocks nothing — the next start sweeps a finished one.
  }
}

/** A started scan, as the dialog polls it. */
export interface SceneScanProgress {
  state: 'running' | 'done' | 'failed'
  csvPath: string
  frames: number
  error: string
}

/**
 * Poll one started scan.
 *
 * Reads the RESULT file, never "did a CSV appear": the result is what
 * distinguishes "still running" from "ran and found nothing", and a CSV alone
 * cannot say which. A torn read is `running` — the file is written while Daz
 * has it open, and treating a half-written one as failed would abort a scan
 * about to succeed.
 *
 * `done` still insists the CSV is on disk AND newer than the run that claims it
 * ({@link SceneScanStarted.startedAtMs}). The result says the script believed it
 * wrote one — but a `printCSV` that fails silently (locked file, full disk)
 * leaves the PREVIOUS scan's CSV sitting at exactly that path, and importing
 * that would be the worst outcome available: stale frames, reported as success.
 * The mtime is the same freshness test {@link romAnimationFresh} uses for a
 * regenerated file, and it costs no user data — unlike deleting the old CSV up
 * front, which throws away a working import whenever the new scan fails.
 */
export async function fetchSceneScanProgress({
  data,
}: {
  data: unknown
}): Promise<SceneScanProgress> {
  const { resultPath, startedAtMs } = z
    .object({ resultPath: z.string().min(1), startedAtMs: z.number().default(0) })
    .parse(data)
  if (!isTauri()) return { state: 'running', csvPath: '', frames: 0, error: '' }
  const text = await readTextFile(resultPath).catch(() => '')
  if (!text) return { state: 'running', csvPath: '', frames: 0, error: '' }
  const result = parseScanResult(text)
  if (!result) return { state: 'running', csvPath: '', frames: 0, error: '' }
  // The scan is over either way — clear the claimed job file the Runner left
  // behind. The EXPORT flow's watch does this for its own batches; a scan has
  // no watch, so without it a finished `running_…json` sits in the user's
  // scripts folder until the next scan happens to sweep it (measured on the
  // first live run). Best-effort: a leftover blocks nothing (the next start
  // removes a finished one), so failing here must not fail the scan.
  await clearFinishedJobFile()
  if (!result.ok) {
    return { state: 'failed', csvPath: '', frames: 0, error: result.error || 'The scan failed.' }
  }
  if (!(await exists(result.csvPath))) {
    return {
      state: 'failed',
      csvPath: '',
      frames: 0,
      error: `The scan reported success but wrote no CSV:\n${result.csvPath}`,
    }
  }
  // A filesystem with coarse timestamps can stamp a file a beat before the
  // clock reading that started the run; the slack keeps that from reading as
  // "stale", and is far shorter than any scan takes.
  if (startedAtMs > 0 && (await mtimeOf(result.csvPath)) < startedAtMs - MTIME_SLACK_MS) {
    return {
      state: 'failed',
      csvPath: '',
      frames: 0,
      error: `The scan reported success but left the previous CSV in place — nothing was written this run:\n${result.csvPath}`,
    }
  }
  return { state: 'done', csvPath: result.csvPath, frames: result.frames, error: '' }
}

