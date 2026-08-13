import {
  BUILD_ROM_ANIMATION_SCRIPT,
  BULK_EXPORT_ONLY_SCRIPT,
  BULK_ROM_EXPORT_SCRIPT,
  romAnimationPath,
  sceneExportSubfolders,
} from '@dth/rom'

import type { Character } from '@dth/rom'

/**
 * The DTH Exporter job file — the handoff between the studio's DTH Export
 * button and the DTH Character Studio Runner plugin (contract v2). The studio
 * writes a JSON job file ({@link ExporterJobFile}: type, whole-batch progress,
 * the job rows) into the shared `Scripts/DTH-Character-Studio/` root of the
 * Daz library, starting Daz Studio (scene-less) when it isn't running. The
 * plugin POLLS for it — on startup and regularly while Daz runs, so a running
 * instance accepts new batches — and on pickup RENAMES it (`running_` prefix,
 * the "started" signal; only an un-renamed file can still be aborted by
 * deletion). From then on the plugin OWNS the file: it updates `progress` and
 * the per-job statuses as it works (open scene → run script → discard →
 * next). The studio just polls the renamed file for progress, deletes it once
 * `progress` reaches 100, and toasts the outcome. Contract spec:
 * docs/exporter-plugin-job-file.md.
 *
 * This module is the pure part (names, JSON text, change signatures) so it
 * stays unit-testable; the I/O lives in api/execute.ts.
 */

/** Job-file name inside `Scripts/DTH-Character-Studio/` (the studio scripts root). */
export const EXPORTER_JOB_FILE = 'dth_exporter_jobs.json'

/** The prefix the Runner RENAMES the job file to when it starts working on it
 *  — the rename IS the "started" signal (an un-renamed file can still be
 *  aborted by deletion; a renamed one is in progress and carries the
 *  plugin-owned `progress`). */
export const RUNNING_JOB_PREFIX = 'running_'

/** The renamed (in-progress) job file the studio polls for progress. */
export const RUNNING_JOB_FILE = `${RUNNING_JOB_PREFIX}${EXPORTER_JOB_FILE}`

/** Per-character stamp file (in the character's `.dcsmeta` folder, alongside the
 *  run log): what Execute last handed off per scene, so Execute all can skip
 *  unchanged scenes. Machine-friendly bookkeeping, not user content. */
export const EXECUTE_STAMPS_FILE = '.dth_execute_stamps.json'

/**
 * The bulk scan's sidecar config, written into the studio scripts root beside
 * the job file (Tools → **Scan project**).
 *
 * The job-file contract has no room for per-row parameters — a row is
 * `{ scenePath, scriptPath }` and nothing else — but a scene row needs to know
 * WHICH scans it is due for and, for products, that character's DIM folder and
 * output dir. So the studio writes this alongside the batch and the per-scene
 * worker (`.Scan_Scene_Bulk.dsa`) looks the scene it was just handed up in it.
 * The name is duplicated inside that `.dsa` (`DTH_SCAN_CONFIG_FILE`) — change
 * both together.
 */
export const SCAN_CONFIG_FILE = 'dth_scan_config.json'

/** The `DthScanProducts()` config for one character — the SAME shape the
 *  generated `Scan_Products_<Name>.dsa` bakes in (`ScanProductsOptions` +
 *  identity), passed through verbatim so the bulk and per-character paths
 *  cannot drift. */
export interface ScanProductsConfig {
  characterId: string
  characterName: string
  genesis: string
  dimManifestPath: string
  outputDir: string
  dazLibraryFolder: string
}

/** What ONE scene of a bulk scan is due for. At least one of the two is set —
 *  a scene due for nothing never gets a row in the first place. */
export interface ScanSceneWork {
  /** Scan this scene for morphs the base index doesn't carry. */
  morphs: boolean
  /** The generation to file this scene's morphs under when its figures carry
   *  no readable source asset — the owning character's own. Detection is the
   *  first answer; this is the one that cannot fail (Daz Studio 4 could read
   *  no figure identity at all, and every scene's scan was skipped). */
  genesis?: string
  /** Run the Daz Products scan for this scene, with this config. */
  products?: ScanProductsConfig
}

/** The sidecar config file's shape: scene key → that scene's work. */
export interface ScanConfigFile {
  version: 1
  scenes: Record<string, ScanSceneWork>
}

/**
 * The sidecar's full text (pretty JSON + trailing newline). Scenes are keyed by
 * {@link normalizeSceneKey} — the worker normalizes `Scene.getFilename()` the
 * same way (`dthScanSceneKey`), which is what lets a scene the Runner opened
 * find its own row regardless of separator or case.
 */
export function scanConfigJson(
  scenes: ReadonlyArray<{ scenePath: string; work: ScanSceneWork }>,
): string {
  const file: ScanConfigFile = { version: 1, scenes: {} }
  for (const { scenePath, work } of scenes) {
    file.scenes[normalizeSceneKey(scenePath)] = work
  }
  return `${JSON.stringify(file, null, 2)}\n`
}

/**
 * What a batch does. The `type` field IS the capability handshake: a Runner
 * that predates a type rejects the whole file as foreign (logs, leaves it, never
 * renames), so the studio can write a newer type and detect non-pickup instead
 * of negotiating versions. See docs/exporter-plugin-job-file.md.
 */
export type ExporterJobType =
  /** Per-scene ROM build + full export via the hidden `.Bulk_ROM_Export.dsa`. */
  | 'bulk-export'
  /** Contract v3: open ONE scene in the running Daz and raise its window. No
   *  script runs, and the Runner must NOT reset to an empty scene afterwards —
   *  the scene staying loaded is the entire point. */
  | 'open-scene'

export interface ExporterJob {
  /** Absolute path of the Daz scene (`.duf`) to open. */
  scenePath: string
  /** Absolute path of the `.dsa` script to run in that scene. Empty only on an
   *  `open-scene` row, where nothing is executed. */
  scriptPath: string
  /** How many equal steps this row's export comprises — the per-scene percent
   *  scale of the verbose progress log (Runner v1.2.0; see
   *  {@link jobStepsForMode}). Absent = the Runner writes 0/100 boundary
   *  lines only. */
  steps?: number
}

/** One job row in the JSON job file — the Runner updates `status`/`error` as
 *  it works (the studio writes every row as `pending`). */
export interface ExporterJobEntry extends ExporterJob {
  status: 'pending' | 'running' | 'done' | 'failed'
  /** Set by the Runner on a failed row (missing scene/script, script error). */
  error?: string
}

/** The JSON job file (contract v2 — docs/exporter-plugin-job-file.md): the
 *  studio writes it with `progress: 0`; the Runner renames it
 *  (`running_` prefix) on pickup and OWNS `progress` + the per-job statuses
 *  from then on; the studio deletes the renamed file once progress hits 100. */
export interface ExporterJobFile {
  version: 1
  /** What this batch does — see {@link ExporterJobType}. */
  type: ExporterJobType
  /** Whole-batch progress 0–100, Runner-owned after the rename. Kept as the
   *  finish signal (the studio deletes at 100); the UI shows {@link jobsDone}. */
  progress: number
  /** Rows already processed (done + failed) — Runner-written (v1.1.1+) on
   *  every rewrite; absent on the studio-written pending file and on older
   *  Runners (the reader then derives it from the row statuses). */
  jobsDone?: number
  /** The verbose per-scene progress log (Runner v1.2.0): when present the
   *  Runner truncates this file at batch start and appends
   *  `[<percent>] <message>` lines; the generated export script appends the
   *  interior steps to the same file. Older Runners ignore the field. */
  progressLogPath?: string
  jobs: Array<ExporterJobEntry>
}

/** What a scene looked like when its jobs were last written: the `.duf` stamp
 *  plus the definition signature ({@link executeSceneSignature}). */
export interface ExecuteStamp {
  mtimeMs: number
  size: number
  signature: string
}

export interface ExecuteStamps {
  version: 1
  /** Keyed by {@link normalizeSceneKey} of the scene path. */
  scenes: Record<string, ExecuteStamp>
}

/** The one scene-path normalization (trim, '/'-separators, lowercase) — the same
 *  convention generation and the runtime scene lookup key scenes by. */
export function normalizeSceneKey(scenePath: string): string {
  return scenePath.trim().replace(/\\/g, '/').toLowerCase()
}

/**
 * The job file's full text (pretty JSON + trailing newline): every row starts
 * `pending`, whole-batch `progress` starts 0 — the Runner owns both once it
 * renames the file. Paths are written as-is (absolute, Windows separators
 * allowed; JSON escaping handles everything).
 */
export function jobFileJson(
  jobs: Array<ExporterJob>,
  type: ExporterJobType = 'bulk-export',
  /** Arms the Runner's verbose progress log (v1.2.0) — see {@link ExporterJobFile}. */
  progressLogPath?: string,
): string {
  const file: ExporterJobFile = {
    version: 1,
    type,
    progress: 0,
    ...(progressLogPath ? { progressLogPath } : {}),
    jobs: jobs.map((job) => ({ ...job, status: 'pending' as const })),
  }
  return `${JSON.stringify(file, null, 2)}\n`
}

// --- The verbose progress log (Runner v1.2.0) --------------------------------

/** The progress log's app-data file name — ONE file, truncated by the Runner at
 *  every batch start (and by the studio at every handoff), so it can never
 *  accrete: the housekeeping bound is the file itself. */
export const EXPORT_PROGRESS_FILE = 'export-progress.log'

/**
 * How many equal steps a mode's job row comprises — the per-scene percent
 * scale both writers share: the Runner reports the scene OPEN (step 1) and the
 * terminal done/failed, the generated script the interior steps.
 *
 *  - rom+export (5): open / generate ROM / export character / export hair /
 *    deliver the PoseAsset CSV
 *  - export-only (4): the same minus the ROM build
 *  - rom-only (2): open / generate + save the ROM
 */
export function jobStepsForMode(mode: ExportMode): number {
  if (mode === 'rom-only') return 2
  if (mode === 'export-only') return 4
  return 5
}

export interface ExportProgressLine {
  /** 0–100, per scene (each `[0] <scene>: opening scene` starts a new scene). */
  percent: number
  message: string
}

/** Parse the progress log's text — `[<percent>] <message>` per line, anything
 *  else ignored (tolerant: the file is read while it is being appended to). */
export function parseExportProgressLog(text: string): Array<ExportProgressLine> {
  const lines: Array<ExportProgressLine> = []
  for (const raw of text.split(/\r?\n/)) {
    const match = /^\[(\d{1,3})\]\s+(.*\S)\s*$/.exec(raw)
    if (!match) continue
    lines.push({ percent: Math.min(100, Number(match[1])), message: match[2] })
  }
  return lines
}

/** The live view the UI shows of a progress log: the newest line's percent +
 *  message, WHICH scene it belongs to (the `<stem>: ` message prefix; '' for
 *  batch-level lines), and the capped message tail for the log window.
 *  `message` and `lines` are display-clean: no percent bracket, no scene
 *  prefix — the scene shows on the active task card and the percent on the
 *  meter, so repeating them per line was pure noise. */
export interface ExportProgressState {
  percent: number
  message: string
  scene: string
  lines: Array<string>
}

/** `<stem>: message` → `message` (the display carries the scene elsewhere). */
function stripSceneMessagePrefix(message: string): string {
  return /^.+?:\s+(.*)$/.exec(message)?.[1] ?? message
}

/** The two SCENE-OPEN steps name the file they opened — the only lines where
 *  the scene is the news (the rest all happen to the scene the card already
 *  shows, and a per-scene run works several of them in a row). */
const SCENE_OPEN_MESSAGES: ReadonlySet<string> = new Set(['opening scene', 'scene opened'])

export function exportProgressStateFrom(
  parsed: Array<ExportProgressLine>,
  keep = 40,
  /** Scene paths of the batch's job rows — the scene-open lines are rendered
   *  with the real FILE NAME resolved from these (the log itself carries only
   *  the stem, and guessing an extension would be a lie). A stem with no row
   *  falls back to the stem. */
  scenePaths: ReadonlyArray<string> = [],
): ExportProgressState | null {
  if (parsed.length === 0) return null
  const fileNameByStem = new Map<string, string>()
  for (const path of scenePaths) {
    const fileName = path.split(/[\\/]/).pop() ?? ''
    if (fileName) fileNameByStem.set(fileName.replace(/\.[^./\\]+$/, ''), fileName)
  }
  const display = (message: string): string => {
    const stem = /^(.+?):\s/.exec(message)?.[1] ?? ''
    const text = stripSceneMessagePrefix(message)
    if (!stem || !SCENE_OPEN_MESSAGES.has(text)) return text
    return `${text} ${fileNameByStem.get(stem) ?? stem}`
  }
  const last = parsed[parsed.length - 1]
  const scene = /^(.+?):\s/.exec(last.message)?.[1] ?? ''
  return {
    percent: last.percent,
    message: display(last.message),
    scene,
    lines: parsed.slice(-keep).map((line) => display(line.message)),
  }
}

/**
 * The one-row `open-scene` job file: hand `scenePath` to a Daz that is already
 * running (which ignores a forwarded command-line open once a scene is loaded)
 * and let the Runner raise the window. `scriptPath` is deliberately empty —
 * nothing is executed, and for THIS type the Runner also skips its usual
 * end-of-batch reset to an empty scene. A Runner that predates the type leaves
 * the file untouched, which is exactly the signal the caller falls back on.
 */
export function openSceneJobFileJson(scenePath: string): string {
  return jobFileJson([{ scenePath, scriptPath: '' }], 'open-scene')
}

/**
 * Where a scene's saved ROM animation lives:
 * `<scene dir>/rom-animations/<stem>_ROM.duf`. Re-exported from @dth/rom,
 * which owns the rule — generation embeds the same paths so an export-only run
 * can map an open ROM animation back to its source scene.
 */
export { romAnimationPath }

/**
 * What a DTH Export run does, chosen in the dialog's first step:
 *
 * - `rom-export` — build a fresh ROM, save the ROM animation, export
 *   everything (skeletal mesh + hair). The default, and the only mode that
 *   stamps the scenes as exported (see {@link ExecuteStamp}).
 * - `rom-only` — build the ROM and save the `rom-animations` scene, skip the
 *   export. Needs no export directory.
 * - `export-only` — export the SAVED ROM animation as it stands (hair
 *   included), rebuilding nothing: the mode for a ROM that was hand-edited in
 *   Daz. Its job rows open the ROM animation, not the source scene.
 */
export const EXPORT_MODES = ['rom-export', 'rom-only', 'export-only'] as const
export type ExportMode = (typeof EXPORT_MODES)[number]

/**
 * What each Daz mode is CALLED, in the user's words — one spelling for the
 * dialog's Mode dropdown and for the run's Daz task cards, which say what the
 * run is about to do to each scene. Two spellings of "ROM + Export" would be
 * two things to keep in step, and the card is read while the dropdown that
 * chose it is long closed.
 */
export const EXPORT_MODE_LABELS: Record<ExportMode, string> = {
  'rom-export': 'ROM + Export',
  'rom-only': 'ROM only',
  'export-only': 'Export only',
}

/**
 * Everything the dialog's Daz **Mode** dropdown can pick: the three Daz-side
 * {@link ExportMode}s plus `houdini-only` ("Skip Daz — use last exports"),
 * which never reaches `executeCharacterJobs` at all — no Daz run, no Runner.
 * It takes each selected scene's LAST-DELIVERED Daz export (the `.dth` at
 * `sceneDthPath`) as it stands and hands the scenes straight to
 * `startHoudiniExport` (api/houdini.ts) — the same Houdini leg every other
 * mode continues into after its Daz batch. Kept out of {@link EXPORT_MODES}
 * on purpose: that enum is the Daz job-file wire contract, and `houdini-only`
 * writes no Daz job.
 */
export type RunChoice = ExportMode | 'houdini-only'

/**
 * The Houdini list's **Mode** dropdown — what the Houdini leg does:
 *
 * - `export-selected` — run the checked projects' DazToHue exports for the
 *   CHECKED Daz scenes. The default, and for a long time the only thing this
 *   dropdown really offered.
 * - `skip` — run no Houdini at all; the run's Unreal leg hands over the LAST
 *   exports as they stand on disk. Offered only when the studio project has a
 *   linked `.uproject`, because without one "skip Houdini" means "do nothing".
 *
 * Two modes that used to sit here are gone (v0.77):
 * - `open` — opened one project and ran nothing. The Houdini project cards open
 *   a project on their own, so this was a second way to do the same thing
 *   inside a dialog whose job is running a pipeline.
 * - `export-all` — exported every LINKED scene instead of the checked ones. The
 *   scene list is right above it: "export all" is what checking every scene
 *   means, and two ways to say one thing invite picking the wrong one.
 */
export const HOUDINI_RUN_MODES = ['export-selected', 'skip'] as const
export type HoudiniRunMode = (typeof HOUDINI_RUN_MODES)[number]

/** What one linked Houdini project imports, as the scan recorded it. */
export interface HoudiniProjectImports {
  hipPath: string
  /** The export-set names this project WRITES (each export node's
   *  `character_name`). Empty = not known, never "writes none" — see the scan
   *  schema's own note. */
  exportSets?: Array<string>
  /** Every `.dth` its networks import (normalized lowercase) — EMPTY means
   *  "never scanned / not known", never "imports nothing": the scan only
   *  reaches projects inside the character folder, and a `.hip` saved since
   *  the last sweep reads as unscanned until it catches up. */
  imports: ReadonlyArray<string>
}

/** One spelling for comparing `.dth` paths across the TS/scan boundary. */
function dthKey(path: string): string {
  return path.trim().replace(/\\/g, '/').toLowerCase()
}

/**
 * THE "which projects does this scene selection involve" rule.
 *
 * A project JOINS the run when at least one of its networks imports the `.dth`
 * of a SELECTED scene, and LEAVES it when its imports demonstrably name only
 * DESELECTED ones. Names are deliberately not consulted: users rename networks
 * and copy projects between characters.
 *
 * Three fallbacks, all erring toward keeping a project rather than silently
 * dropping it — a wrongly-kept project no-ops in Houdini (456.py exports only
 * the networks matching the job), a wrongly-dropped one silently skips the
 * Houdini half of a run the user asked for:
 *
 * - a project with NO recorded imports (never scanned, or scanned before that
 *   field existed) keeps whatever the user currently has;
 * - a project whose imports match NEITHER the selected nor the deselected
 *   scenes keeps it too. That is not "imports nothing of this character" — it
 *   is the studio and the project failing to speak the same path. 456.py
 *   compares through `os.path.realpath` (folding mapped drives to UNC and the
 *   retired junction spellings old `.hip`s still store); the scan's
 *   `_scene_dth_imports` normalizes with `os.path.normpath` and `sceneDthPath`
 *   resolves nothing at all, so two spellings 456.py would happily fold
 *   together compare unequal HERE. Dropping on that is ignorance wearing
 *   knowledge's clothes — the one guess this rule exists to refuse;
 * - with nothing selected there is nothing to join, so nothing is implied.
 *
 * Paths come in any spelling — compared normalized ({@link dthKey}).
 */
export function hipsForSelectedScenes(
  hips: ReadonlyArray<HoudiniProjectImports>,
  /** The selected scenes' `.dth` paths (see `sceneDthPath`). */
  scenesDth: ReadonlyArray<string>,
  /** What is ticked right now — the answer whenever the studio cannot tell. */
  current: ReadonlySet<string>,
  /** The character's OTHER linked scenes' `.dth` paths — the ones NOT selected.
   *  Only an import naming one of these earns a drop; see the doc above. */
  deselectedDth: ReadonlyArray<string> = [],
): Set<string> {
  const wanted = new Set(scenesDth.map(dthKey).filter(Boolean))
  const dropped = new Set(deselectedDth.map(dthKey).filter(Boolean))
  const next = new Set<string>()
  for (const hip of hips) {
    const keep = (): void => {
      if (current.has(hip.hipPath)) next.add(hip.hipPath)
    }
    if (hip.imports.length === 0) {
      keep()
      continue
    }
    const keys = hip.imports.map(dthKey)
    if (keys.some((dth) => wanted.has(dth))) {
      next.add(hip.hipPath)
      continue
    }
    // Its imports name a scene the user unticked → a real "this project is
    // about that scene, which is out". Anything else is not knowledge.
    if (!keys.some((dth) => dropped.has(dth))) keep()
  }
  return next
}

/**
 * The hidden generated script a mode's job rows run — each selects the open
 * scene's overrides itself, so one script serves every scene:
 * {@link BULK_ROM_EXPORT_SCRIPT} (ROM + full export),
 * {@link BUILD_ROM_ANIMATION_SCRIPT} (ROM + save, no export) or
 * {@link BULK_EXPORT_ONLY_SCRIPT} (full export, no ROM build).
 */
export function jobScriptForMode(mode: ExportMode): string {
  if (mode === 'rom-only') return BUILD_ROM_ANIMATION_SCRIPT
  if (mode === 'export-only') return BULK_EXPORT_ONLY_SCRIPT
  return BULK_ROM_EXPORT_SCRIPT
}

/**
 * THE "Export only" rule: the SELECTED scenes that have no saved ROM animation,
 * and therefore nothing for an export-only run to export.
 *
 * Pure so it is testable without a browser, and shared by BOTH places the
 * dialog applies it: the Start gate (non-empty ⇒ Start is disabled and the
 * scenes are named) and the pre-handoff re-check in `onExport`, which re-probes
 * the scenes at the decision point — the dialog's status is a snapshot from
 * when it opened, and a ROM animation deleted since then would otherwise ride
 * the stale go-ahead into Daz.
 *
 * Empty for every other mode, and empty while `scenes` is null — nothing is
 * known before the probe lands, and "unknown" must not read as "missing" (the
 * dialog's Start separately waits out that window as "Checking scenes…").
 */
export function scenesMissingRomAnimation<T extends { scenePath: string; romExists: boolean }>(
  mode: RunChoice,
  scenes: ReadonlyArray<T> | null,
  checked: ReadonlySet<string>,
): Array<T> {
  if (mode !== 'export-only' || !scenes) return []
  return scenes.filter((scene) => checked.has(scene.scenePath) && !scene.romExists)
}

/**
 * THE "Houdini only" gate, {@link scenesMissingRomAnimation}'s sibling: the
 * SELECTED scenes whose last Daz export is not on disk (`exportExists` — the
 * `.dth` the Houdini network imports), so there is nothing to rely on. Same two
 * call sites and the same null-tolerance: the Start gate, and the pre-handoff
 * re-probe that catches an export deleted while the dialog sat open.
 */
export function scenesMissingExport<T extends { scenePath: string; exportExists: boolean }>(
  mode: RunChoice,
  scenes: ReadonlyArray<T> | null,
  checked: ReadonlySet<string>,
): Array<T> {
  if (mode !== 'houdini-only' || !scenes) return []
  return scenes.filter((scene) => checked.has(scene.scenePath) && !scene.exportExists)
}

/**
 * Which scenes a mode PRE-CHECKS in the DTH Export dialog: the ones whose work
 * is outstanding for THAT run — changed inputs for the ROM-building modes, an
 * unexported saved ROM animation for the export-only pass. A scene whose
 * `.duf` is missing is never pre-checked by a Daz mode: its row cannot run
 * (the dialog disables it), and a saved ROM animation can well survive a
 * deleted scene — pre-checking it would arm a selection whose handoff can only
 * fail.
 *
 * `houdini-only` has no staleness signal (nothing tracks what Houdini last
 * consumed), so it pre-checks every scene whose export is on disk — including
 * one whose `.duf` is missing: Houdini reads the delivered export, not the
 * scene, so a deleted `.duf` takes nothing away from this run.
 */
export function preCheckedScenes(
  mode: RunChoice,
  scenes: ReadonlyArray<{
    scenePath: string
    affected: boolean
    missing: boolean
    romExists: boolean
    romUnexported: boolean
    exportExists: boolean
  }>,
): Set<string> {
  if (mode === 'houdini-only') {
    return new Set(scenes.filter((s) => s.exportExists).map((s) => s.scenePath))
  }
  return new Set(
    scenes
      .filter(
        (s) => !s.missing && (mode === 'export-only' ? s.romExists && s.romUnexported : s.affected),
      )
      .map((s) => s.scenePath),
  )
}

/** Digital-clock elapsed time for the live buttons and the meter's per-step
 *  tick — all four digits always rendered ("00:01", "12:34"), so the label
 *  never resizes; an hour-plus run grows to "1:02:03". */
export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  const minutes = String(Math.floor(totalSeconds / 60) % 60).padStart(2, '0')
  const hours = Math.floor(totalSeconds / 3600)
  return hours > 0 ? `${hours}:${minutes}:${seconds}` : `${minutes}:${seconds}`
}

/**
 * A run duration for humans — the finish toast's total: `"37s"`, `"4m 12s"`,
 * `"1h 03m"`. Sub-second runs still read `"0s"` rather than vanishing. Pure so
 * the three widths are pinned by tests.
 */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  if (totalMinutes === 0) return `${seconds}s`
  const minutes = totalMinutes % 60
  const hours = Math.floor(totalMinutes / 60)
  if (hours === 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`
  return `${hours}h ${String(minutes).padStart(2, '0')}m`
}

/**
 * Whether a `running_` batch can be handed back to a fresh Daz — i.e. it was
 * CLAIMED but never worked.
 *
 * A closing Daz can rename the job file (the rename IS the claim) on a final
 * poll tick and then exit before running a row. The Runner only ever polls for
 * the PENDING name, so a file left that way is orphaned forever unless the
 * studio renames it back.
 *
 * Deliberately narrow, which is the whole point of the helper: reclaiming a
 * PARTIALLY worked batch would re-run scenes that already finished — minutes of
 * ROM build and a re-export each. So the batch must be an untouched
 * `bulk-export`: that type, progress 0 AND every row still `pending`. Anything
 * else belongs to the export watch's "dead run" report, not here — including an
 * orphaned `open-scene` handoff, which is not an export to requeue (renamed
 * back to pending it would yank a scene open out of nowhere on the next Daz
 * start). A torn or foreign read (null) is never reclaimable.
 */
export function isReclaimableBatch(parsed: ExporterJobFile | null): boolean {
  if (!parsed || parsed.type !== 'bulk-export' || parsed.progress !== 0) return false
  return parsed.jobs.every((job) => job.status === 'pending')
}

/** Which of the two job-file names is on disk: the one the studio writes, or
 *  the `running_` one the Runner renamed it to (the rename IS the claim). */
export type JobFileKind = 'pending' | 'running'

/**
 * Whether deleting this job file could strand a run that is happening RIGHT NOW
 * — the judgement Settings → App Data needs before offering to clear a job file
 * by hand.
 *
 * A stranded file blocks every later export and scan ("a batch is waiting for
 * Daz Studio"), so clearing one has to be possible; a file a Runner is working
 * through is the opposite case, where deleting it takes the batch away from the
 * Daz that owns it and no toast will ever explain why the run stopped. The two
 * are told apart exactly the way the reclaim path already tells them apart —
 * this restates no rule of its own:
 *
 * - **pending** — never claimed. Deleting it IS what Abort does. Not live.
 * - **`running_` at 100** — finished; the studio just never swept it. Not live.
 * - **`running_`, untouched** ({@link isReclaimableBatch}) — a closing Daz
 *   claimed it and died before running a row. That is the stranded case itself.
 * - **`running_`, part-worked** — a Runner is (or was) working it. LIVE.
 * - **`running_`, unreadable** — the same guess every other reader here makes
 *   about a torn or foreign file: assume a live batch.
 */
export function jobFileMayBeLive(kind: JobFileKind, parsed: ExporterJobFile | null): boolean {
  if (kind === 'pending') return false
  if (!parsed) return true
  if (parsed.progress >= 100) return false
  return !isReclaimableBatch(parsed)
}

/**
 * How long ago something happened, for a human deciding whether a leftover file
 * is theirs: `"just now"`, `"12 minutes ago"`, `"3 hours ago"`, `"5 days ago"`.
 *
 * Deliberately coarse and single-unit — the readout answers "is this from the
 * batch I started a minute ago, or from last week?", which no second unit makes
 * clearer. `0` (an mtime nothing could read) has no answer at all, and falls in
 * with "just now" — the CAUTIOUS end for a delete decision, since a file that
 * might be seconds old might also still be running. It is not the reassuring
 * reading; nothing here should reassure on no evidence.
 */
export function formatAgo(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'just now'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/**
 * The scene file a mode's job row OPENS for `scenePath`: the saved ROM
 * animation for `export-only` (that is where the built ROM lives — the
 * generated script maps it back to this scene for every scene-keyed lookup),
 * the scene itself otherwise.
 */
export function jobSceneForMode(mode: ExportMode, scenePath: string): string {
  return mode === 'export-only' ? romAnimationPath(scenePath) : scenePath
}

/**
 * Scene key → the export-dir-RELATIVE FOLDER that scene exports into: just
 * `<scene's export subfolder>`, from the SAME subfolder map the generated
 * export block embeds (falling back to the scene-file stem exactly like the
 * runtime). '' = that scene exports into the export dir itself. The one folder
 * rule the export watch AND the housekeeping share.
 *
 * Flat since schema v29 — the v27 `<houdini project folder>/dth-export/`
 * prefix is gone with the export directory's whole dependency on Houdini. The
 * `{folder, sub}` shape stays because callers need the bare subfolder too
 * (it names the export files — {@link sceneExportName}).
 */
export function sceneExportFolderRel(
  character: Character,
  scenesRootAbs?: string,
): Record<string, { folder: string; sub: string }> {
  const subfolders = sceneExportSubfolders(character, scenesRootAbs)
  const map: Record<string, { folder: string; sub: string }> = {}
  for (const scene of [character.scenePath, ...character.extraScenes]) {
    const key = normalizeSceneKey(scene)
    if (!key) continue
    const stem = (key.split('/').pop() ?? '').replace(/\.[^.]+$/, '')
    const sub = subfolders[key] ?? stem
    map[key] = { folder: sub, sub }
  }
  return map
}

/**
 * Where a RECORDED export folder belongs under the fixed v29 export root: the
 * retired `<houdini project folder>/dth-export/` nesting stripped off, the rest
 * kept verbatim so a nested scene subfolder survives the move. A folder
 * recorded under the flat layout has no prefix and is already its own
 * destination. Used by the one-time export-root migration (api/characters.ts);
 * exported so its mapping is testable without the filesystem.
 */
export function migratedExportFolder(rel: string): string {
  return rel.replace(/^.*?\/dth-export\//, '')
}

/** Per-character export-folder record (in the character's `.dcsmeta` folder,
 *  alongside the run log): the export-dir-relative folders the last GENERATED
 *  layout comprises — what the housekeeping may delete once they fall out of it. */
export const EXPORT_FOLDERS_FILE = '.dth_export_folders.json'

export interface ExportFoldersRecord {
  version: 1
  /** The export dir the folders are relative to (the character's `exportPath`
   *  when the record was written) — a mismatch disables deletion entirely. */
  exportDir: string
  folders: Array<string>
}

/**
 * The DISTINCT export-dir-relative folders the character's current layout
 * exports into ({@link sceneExportFolderRel} values, deduped case-insensitively,
 * '' dropped) — what the housekeeping records after every generation.
 */
export function expectedSceneExportFolders(
  character: Character,
  scenesRootAbs?: string,
): Array<string> {
  const out: Array<string> = []
  const seen = new Set<string>()
  for (const { folder } of Object.values(sceneExportFolderRel(character, scenesRootAbs))) {
    if (!folder) continue
    const norm = folder.toLowerCase()
    if (seen.has(norm)) continue
    seen.add(norm)
    out.push(folder)
  }
  return out
}

/** Parse a stored export-folder record, tolerating garbage (no record = nothing
 *  is known to be ours = nothing to delete). */
export function parseExportFoldersRecord(text: string): ExportFoldersRecord | null {
  try {
    const raw = JSON.parse(text) as Partial<ExportFoldersRecord> | null
    if (raw && raw.version === 1 && typeof raw.exportDir === 'string' && Array.isArray(raw.folders)) {
      return {
        version: 1,
        exportDir: raw.exportDir,
        folders: raw.folders.filter((f): f is string => typeof f === 'string'),
      }
    }
  } catch {
    // fall through
  }
  return null
}

/**
 * The recorded export folders a layout change left behind — the housekeeping
 * DELETE set. Deliberately conservative, deletion is forever:
 *
 * - The record must be for the CURRENT export dir — a changed `exportPath`
 *   orphans its folders instead of reaching into a location the character no
 *   longer points at.
 * - Only plain relative paths qualify: no absolute/drive/UNC forms, no `..`
 *   or empty segments — a tampered record must not be able to aim the delete
 *   outside the export dir.
 * - A folder that IS or CONTAINS one of the expected folders is kept (a scene
 *   subfolder can be named like a project folder, and subfolders nest).
 */
export function staleExportFolders(
  recorded: ExportFoldersRecord,
  exportDir: string,
  expected: Array<string>,
): Array<string> {
  const normDir = (p: string) => {
    let clean = p.trim().replace(/\\/g, '/')
    while (clean.endsWith('/')) clean = clean.slice(0, -1)
    return clean.toLowerCase()
  }
  if (normDir(recorded.exportDir) !== normDir(exportDir)) return []
  const keep = expected.map((f) => f.trim().replace(/\\/g, '/').toLowerCase())
  const out: Array<string> = []
  for (const rel of recorded.folders) {
    const clean = rel.trim().replace(/\\/g, '/')
    if (!clean || clean.startsWith('/') || clean.includes(':')) continue
    const segments = clean.split('/')
    if (segments.some((s) => s === '' || s === '.' || s === '..')) continue
    const norm = clean.toLowerCase()
    if (keep.some((k) => k === norm || k.startsWith(`${norm}/`))) continue
    out.push(clean)
  }
  return out
}

/** Character fields that don't influence what a ROM run produces (cosmetic,
 *  provenance, scan data, Houdini-side links) — changes here must not re-flag
 *  scenes as affected. `sceneOverrides` is excluded because it's folded in
 *  per scene by {@link executeSceneSignature}. */
const SIGNATURE_EXCLUDED_FIELDS = new Set<string>([
  'image',
  'imageScene',
  'createdAt',
  'updatedAt',
  'studioVersion',
  'generatedDthVersion',
  'schemaVersion',
  'houdiniProjects',
  'sceneOverrides',
])

/** JSON.stringify with recursively sorted object keys, so the same data always
 *  yields the same text regardless of property insertion order. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record)
      .filter((k) => record[k] !== undefined)
      .sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** FNV-1a over `text`, twice with different offset bases, hex-joined — a cheap
 *  64-bit-ish content fingerprint (no crypto needed; a collision merely skips
 *  one re-run, and Ctrl+Execute-all forces past it). */
function fnvHash(text: string): string {
  const pass = (offset: number) => {
    let hash = offset >>> 0
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i)
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
    return hash.toString(16).padStart(8, '0')
  }
  return pass(0x811c9dc5) + pass(0x9dc5811c)
}

/**
 * The change signature of ONE scene's effective inputs: the base definition
 * (minus the excluded fields) PLUS that scene's own override record (or null).
 * The base rides along for EVERY scene — non-primary scenes inherit it, so a
 * base edit changes their output too, and they must re-flag as affected. The
 * `.duf` file itself is tracked separately (mtime+size in {@link ExecuteStamp}).
 */
export function executeSceneSignature(character: Character, scenePath: string): string {
  const base: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(character)) {
    if (!SIGNATURE_EXCLUDED_FIELDS.has(key)) base[key] = value
  }
  const key = normalizeSceneKey(scenePath)
  const record =
    character.sceneOverrides.find((o) => normalizeSceneKey(o.scenePath) === key) ?? null
  return fnvHash(canonicalJson({ base, record }))
}

/**
 * Parse a (pending or running) job file, tolerating garbage: a torn read (the
 * Runner rewrites the running file after every row), a foreign file, a future
 * version or an unknown `type` all return null — the caller just retries on its
 * next poll. Rows are kept tolerant too: entries missing a scene path are
 * dropped, a missing `scriptPath` reads as '' (legal on an `open-scene` row),
 * and missing/unknown statuses read as 'pending'.
 */
export function parseJobFileJson(text: string): ExporterJobFile | null {
  const types: ReadonlySet<ExporterJobType> = new Set<ExporterJobType>(['bulk-export', 'open-scene'])
  try {
    const raw = JSON.parse(text) as Partial<ExporterJobFile> | null
    if (!raw || raw.version !== 1 || !Array.isArray(raw.jobs)) return null
    // An absent type reads as the default (matches the Runner's own parser); an
    // unknown one is somebody else's file and must not be touched.
    const type: ExporterJobType = raw.type ?? 'bulk-export'
    if (!types.has(type)) return null
    const statuses: ReadonlySet<ExporterJobEntry['status']> = new Set([
      'pending',
      'running',
      'done',
      'failed',
    ])
    const isStatus = (value: unknown): value is ExporterJobEntry['status'] =>
      typeof value === 'string' && statuses.has(value as ExporterJobEntry['status'])
    const jobs: Array<ExporterJobEntry> = []
    for (const job of raw.jobs) {
      if (!job || typeof job.scenePath !== 'string') continue
      jobs.push({
        scenePath: job.scenePath,
        scriptPath: typeof job.scriptPath === 'string' ? job.scriptPath : '',
        status: isStatus(job.status) ? job.status : 'pending',
        ...(typeof job.error === 'string' && job.error !== '' ? { error: job.error } : {}),
      })
    }
    const progress = typeof raw.progress === 'number' ? Math.max(0, Math.min(100, raw.progress)) : 0
    // The Runner-written processed counter (v1.1.1+) — older files derive it
    // from the row statuses at the call site.
    const jobsDone =
      typeof raw.jobsDone === 'number'
        ? Math.max(0, Math.min(jobs.length, Math.floor(raw.jobsDone)))
        : undefined
    // Carried through rather than dropped: the field is part of the shape this
    // module WRITES, so a reader that trusts {@link ExporterJobFile} must not
    // get `undefined` for a file that plainly has it. Absent on every handoff
    // that arms no log, and on the rewrite of a pre-v1.2.0 Runner.
    const progressLogPath =
      typeof raw.progressLogPath === 'string' && raw.progressLogPath !== ''
        ? raw.progressLogPath
        : undefined
    return {
      version: 1,
      type,
      progress,
      ...(jobsDone !== undefined ? { jobsDone } : {}),
      ...(progressLogPath !== undefined ? { progressLogPath } : {}),
      jobs,
    }
  } catch {
    return null
  }
}

/** Parse a stored stamps file, tolerating garbage (a bad file = no stamps = the
 *  first-run "everything is affected" behaviour). */
export function parseExecuteStamps(text: string): ExecuteStamps {
  try {
    const raw = JSON.parse(text) as Partial<ExecuteStamps> | null
    if (raw && raw.version === 1 && raw.scenes && typeof raw.scenes === 'object') {
      const scenes: Record<string, ExecuteStamp> = {}
      for (const [key, stamp] of Object.entries(raw.scenes)) {
        if (
          stamp &&
          typeof stamp.mtimeMs === 'number' &&
          typeof stamp.size === 'number' &&
          typeof stamp.signature === 'string'
        ) {
          scenes[key] = { mtimeMs: stamp.mtimeMs, size: stamp.size, signature: stamp.signature }
        }
      }
      return { version: 1, scenes }
    }
  } catch {
    // fall through — treat as empty
  }
  return { version: 1, scenes: {} }
}
