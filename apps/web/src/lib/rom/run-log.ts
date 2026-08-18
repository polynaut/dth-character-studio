import { normalizeSceneKey } from './execute-jobs.ts'

/**
 * The ROM run log — the pure parts (types, parsing, per-scene merging), kept
 * out of the I/O layer so they stay unit-testable, exactly like `execute-jobs.ts`
 * is to `api/execute.ts`. The reading/writing/ingesting lives in
 * `api/characters.ts` (`fetchRomRunLog`).
 *
 * The shape is per SCENE (log v2, runtime v54). A DTH Export batch works one row
 * per scene and every row's script writes the same per-character log file, so a
 * single flat log could only ever hold the LAST scene that ran — the scenes that
 * failed before it were destroyed silently, which is the bug this shape fixes.
 */

export interface RomRunFailedMorph {
  frame: number
  node: string
  prop: string
  /** What is wrong with THIS dial — a one-liner. Anything the offenders share
   *  belongs in the report's per-{@link kind} explainer, not repeated here. */
  reason: string
  /** Groups entries that share an explanation, so the report can state it once
   *  above the list (runtime v86). `''` = no shared explanation; the reason
   *  stands alone. Absent in logs written before v86, hence the tolerant parse.
   *  The one kind so far is `dialed-walked` — see `dialedWalkedReason` in
   *  `runtime/DthUtils.dsa`, which is the other half of this contract. */
  kind: string
}

/** The failed morphs that share an explanation the report states ONCE, keyed on
 *  {@link RomRunFailedMorph.kind}. The runtime hardcodes the same string
 *  (`logRunFailedMorph(…, "dialed-walked")` in `runtime/DthUtils.dsa`) and
 *  nothing at runtime joins the two — a rename on either side would just stop
 *  the explainer from ever rendering, silently. So the join is a TEST:
 *  `dialed-walked-gate.test.ts` boots the shipped `DthUtils.dsa` in a sandbox
 *  and asserts the kind it logs against THIS constant, on both legs of the
 *  gate. Change one side and that test says so. */
export const DIALED_WALKED_KIND = 'dialed-walked'

/**
 * ONE key the Daz-side LINEAR interpolation pass could not stamp, named well
 * enough to go and look at it (runtime v79).
 *
 * It exists because the counts alone were unchaseable: a run reporting "4 of
 * 7968 key(s) would not read back LINEAR" told nobody which node, which dial or
 * which frame — and until v79 that anonymous 4 also blocked the whole export.
 * The runtime caps the list per kind (the message carries the exact totals).
 */
export interface RomRunKeyProblem {
  /**
   * The runtime's own kinds — `failed` (rewritten, still not LINEAR), `stuck`
   * (the value would not move, so Daz never rewrote the key), `value-lost` (the
   * key's VALUE is wrong — the one kind that still fails a run) and `frame-zero`
   * (the channel kept Daz's implicit, un-typed key at frame 0). Kept as a plain
   * string so a kind added by a newer runtime still displays instead of vanishing.
   */
  kind: string
  /** The node's path in the scene tree, e.g. `Genesis9/hip/abdomenLower`. */
  node: string
  prop: string
  /** The dial's display label, when it differs from `prop`. */
  propLabel?: string
  /** The property's group path in the Parameters pane, when Daz offered one. */
  path?: string
  /** Key index on the channel; -1 for a whole-channel problem (`frame-zero`). */
  key: number
  /**
   * How many keys the channel holds. The number that answers "does this key's
   * interpolation span anything?" — one key spans nothing, so it cannot matter.
   * 0 in a log written before runtime v80 recorded it.
   */
  keys: number
  /** -1 when the runtime could not resolve what a frame is worth. */
  frame: number
  /** What Daz reports for this key AFTER the pass, e.g. `CONSTANT (1)`. '' when
   *  the Daz build has no `getKeyInterpolationType` to ask. */
  interp: string
  reason: string
}

/**
 * ONE scene's run inside a run log. A DTH Export batch works a row per scene,
 * so a log holds one of these per scene it ran — and every problem is
 * attributable to the scene that produced it, which is what lets the report
 * select that scene and mark the right rows red (frame numbers are per scene
 * once a scene override reorders the ROM).
 */
export interface RomRunSceneRun {
  /** Absolute path of the Daz scene this run ran in. '' for an unsaved scene —
   *  and for a v1 log, which predates scene tagging. */
  scene: string
  /** The scene file's stem, as the UI labels it ('' when unknown). */
  sceneName: string
  finishedAt: string
  finishedAtMs: number
  framesTotal?: number
  /** Errors and failed morphs only. A run can be `ok` and still have warnings —
   *  that is the point of the split (see {@link RomRunSceneRun.warnings}). */
  ok: boolean
  errors: Array<string>
  /**
   * Problems the run reported that do NOT condemn the ROM: the export ran.
   * A warning must still be shown — the failure this channel was added for was
   * invisible, not harmless (a row marked "done" that exported nothing).
   * Empty for a log written by a runtime older than v79.
   */
  warnings: Array<string>
  failedMorphs: Array<RomRunFailedMorph>
  keyProblems: Array<RomRunKeyProblem>
}

/** The run log the generated ROM script writes into the character folder after
 *  every run in Daz (success too). `unreadable` marks an existing-but-corrupt
 *  log — itself surfaced as a problem. */
export interface RomRunLog {
  character: string
  finishedAt: string
  finishedAtMs: number
  framesTotal?: number
  /** Clean only when EVERY scene's run came back clean. */
  ok: boolean
  /** Per-scene runs, newest write last. Always at least one entry. */
  runs: Array<RomRunSceneRun>
  /** Flattened across every scene — the "what went wrong" view. Use
   *  {@link runs} whenever a problem has to be attributed to a scene. */
  errors: Array<string>
  warnings: Array<string>
  failedMorphs: Array<RomRunFailedMorph>
  keyProblems: Array<RomRunKeyProblem>
  unreadable?: boolean
}

/**
 * Identity of a morph across scenes and edits — the definition's pose morphs
 * and the log's failed morphs both carry the `node`/`prop` pair verbatim (the
 * runtime's dialed-walked gate even keys its own dedup as `node|prop`,
 * `checkDialedWalkedMorphs` in DthUtils.dsa). Frame numbers are computed from
 * row order at generation time, so a frame stored in a log goes stale the
 * moment the ROM is edited — matching editor rows by frame marked whatever
 * POSITION the failure once had, not the morph that failed. The pair doesn't
 * move. `|` is safe: both halves are Daz names, which never contain it.
 */
export function morphKey(node: string, prop: string): string {
  return `${node}|${prop}`
}

/**
 * The failed morphs' identities ({@link morphKey}), bucketed by the SCENE whose
 * run reported them (`normalizeSceneKey`; `''` = an untagged run — an unsaved
 * scene, or a v1 log that predates scene tagging). Undefined when the log has
 * nothing failed to mark.
 *
 * Per scene because a failure is a per-scene fact: the gate reads the DIAL
 * VALUES of the scene the row ran in, so "PBMBreastsHeavy dialed at 0.089" in
 * the primary scene says nothing about the THICK scene, where the same dial
 * may be clean — one shared set kept the other scene's grid red over rows the
 * report never accused (2026-08-18). Consumers go through
 * {@link failedMorphKeysForScene}, never `.get()` on this map directly.
 */
export function failedMorphKeysByScene(log: RomRunLog): Map<string, Set<string>> | undefined {
  const byScene = new Map<string, Set<string>>()
  for (const run of log.runs) {
    if (run.failedMorphs.length === 0) continue
    const sceneKey = run.scene ? normalizeSceneKey(run.scene) : ''
    let keys = byScene.get(sceneKey)
    if (!keys) {
      keys = new Set()
      byScene.set(sceneKey, keys)
    }
    for (const morph of run.failedMorphs) keys.add(morphKey(morph.node, morph.prop))
  }
  return byScene.size > 0 ? byScene : undefined
}

/**
 * The red-row marker set for ONE scene's grid: that scene's bucket plus the
 * untagged `''` bucket — a failure that names no scene cannot be pinned on one,
 * and hiding it everywhere would un-mark a real problem, so it marks every
 * scene's grid (the honest fallback). Undefined when nothing applies.
 *
 * Normalizes `scenePath` HERE, at the accessor — the map is keyed by
 * `normalizeSceneKey` and callers hold the character's stored spelling, which
 * on a real Windows path never matches raw (.ai/gotchas-web.md).
 */
export function failedMorphKeysForScene(
  byScene: Map<string, Set<string>> | undefined,
  scenePath: string,
): Set<string> | undefined {
  if (!byScene) return undefined
  const own = byScene.get(scenePath ? normalizeSceneKey(scenePath) : '')
  const untagged = scenePath ? byScene.get('') : undefined
  if (!own) return untagged
  if (!untagged) return own
  return new Set([...own, ...untagged])
}

/**
 * A run's scene resolved to the character's STORED spelling — the only spelling
 * `selectScene`/`effectiveScene` honor (`linkedScenes.includes` is an exact
 * string match). The log's spelling is Daz's `Scene.getFilename()` — forward
 * slashes — while the stored one came from the picker, so on a real Windows
 * path they never match raw and a raw `selectScene(run.scene)` silently
 * no-oped back to the primary scene (.ai/gotchas-web.md; same resolution as
 * `buildExecuteJob`). Undefined when the scene is untagged or no longer linked
 * — the caller reveals in place instead of falsely switching.
 */
export function matchLinkedScene(
  linkedScenes: ReadonlyArray<string>,
  scene: string,
): string | undefined {
  if (!scene) return undefined
  const key = normalizeSceneKey(scene)
  return linkedScenes.find((s) => normalizeSceneKey(s) === key)
}

/** The failed morphs of one raw log record. */
export function parseFailedMorphs(value: unknown): Array<RomRunFailedMorph> {
  if (!Array.isArray(value)) return []
  return value.map((m) => {
    const entry = (m ?? {}) as Record<string, unknown>
    return {
      frame: typeof entry.frame === 'number' ? entry.frame : -1,
      node: typeof entry.node === 'string' ? entry.node : '',
      prop: typeof entry.prop === 'string' ? entry.prop : '',
      reason: typeof entry.reason === 'string' ? entry.reason : '',
      // Absent in every log written before runtime v86 — those rows carried the
      // shared explanation inline, so no kind means no explainer, which is
      // exactly right for them.
      kind: typeof entry.kind === 'string' ? entry.kind : '',
    }
  })
}

/** The named key problems of one raw log record (absent before runtime v79). */
export function parseKeyProblems(value: unknown): Array<RomRunKeyProblem> {
  if (!Array.isArray(value)) return []
  return value.map((k) => {
    const entry = (k ?? {}) as Record<string, unknown>
    return {
      kind: typeof entry.kind === 'string' ? entry.kind : '',
      node: typeof entry.node === 'string' ? entry.node : '',
      prop: typeof entry.prop === 'string' ? entry.prop : '',
      propLabel: typeof entry.propLabel === 'string' ? entry.propLabel : undefined,
      path: typeof entry.path === 'string' ? entry.path : undefined,
      key: typeof entry.key === 'number' ? entry.key : -1,
      keys: typeof entry.keys === 'number' ? entry.keys : 0,
      frame: typeof entry.frame === 'number' ? entry.frame : -1,
      interp: typeof entry.interp === 'string' ? entry.interp : '',
      reason: typeof entry.reason === 'string' ? entry.reason : '',
    }
  })
}

/** One scene's run out of a raw log record (v2 `runs[]` entry, or a whole v1
 *  log — which predates scene tagging and so lands under scene ''). */
export function parseSceneRun(value: unknown): RomRunSceneRun {
  const record = (value ?? {}) as Record<string, unknown>
  return {
    scene: typeof record.scene === 'string' ? record.scene : '',
    sceneName: typeof record.sceneName === 'string' ? record.sceneName : '',
    finishedAt: typeof record.finishedAt === 'string' ? record.finishedAt : '',
    finishedAtMs: typeof record.finishedAtMs === 'number' ? record.finishedAtMs : 0,
    framesTotal: typeof record.framesTotal === 'number' ? record.framesTotal : undefined,
    ok: record.ok === true,
    errors: Array.isArray(record.errors) ? record.errors.map((e) => String(e)) : [],
    // Absent in every log written before runtime v79 — an older log simply has
    // nothing to say here, which is not the same as having been clean.
    warnings: Array.isArray(record.warnings) ? record.warnings.map((w) => String(w)) : [],
    failedMorphs: parseFailedMorphs(record.failedMorphs),
    keyProblems: parseKeyProblems(record.keyProblems),
  }
}

/**
 * Parse run-log JSON into the normalized shape (throws on unparseable text).
 *
 * Two on-disk shapes: **v2** carries a `runs[]` array, one entry per SCENE (a
 * DTH Export batch runs a row per scene and each writes this file, so a single
 * flat log could only ever hold the last one). **v1** is a single run as the
 * top-level object — read as one untagged run so a log written by an older
 * runtime, or already sitting in a character folder at upgrade time, still
 * reports instead of vanishing.
 *
 * `errors` / `failedMorphs` stay on the top level as the FLATTENED view across
 * every scene, so consumers that only want "what went wrong" need not walk the
 * runs; anything that must attribute a problem to a scene reads `runs`.
 */
export function parseRomRunLogText(text: string): RomRunLog {
  const record = (JSON.parse(text) ?? {}) as Record<string, unknown>
  const runs: Array<RomRunSceneRun> = Array.isArray(record.runs)
    ? record.runs.map(parseSceneRun)
    : // v1: the log IS the run.
      [parseSceneRun(record)]
  return {
    character: typeof record.character === 'string' ? record.character : '',
    finishedAt: typeof record.finishedAt === 'string' ? record.finishedAt : '',
    finishedAtMs: typeof record.finishedAtMs === 'number' ? record.finishedAtMs : 0,
    framesTotal: typeof record.framesTotal === 'number' ? record.framesTotal : undefined,
    // A batch is clean only when EVERY scene came back clean. v1 logs carry the
    // verdict on the top level, so fall back to it when there are no runs.
    ok: runs.length > 0 ? runs.every((r) => r.ok) : record.ok === true,
    runs,
    errors: runs.flatMap((r) => r.errors),
    warnings: runs.flatMap((r) => r.warnings),
    failedMorphs: runs.flatMap((r) => r.failedMorphs),
    keyProblems: runs.flatMap((r) => r.keyProblems),
    unreadable: record.unreadable === true || undefined,
  }
}

/**
 * Merge a freshly ingested log over the stored one, PER SCENE: a scene present
 * in `fresh` replaces its stored entry (a re-run's result supersedes, clean or
 * not), every other stored scene survives.
 *
 * This is what makes a mid-batch ingest safe. The studio deletes the transport
 * file when it ingests, so a batch of five scenes interrupted by one alt-tab
 * arrives as two logs; without the merge the second would erase the first.
 *
 * An `unreadable` fresh log is the exception — it describes a broken FILE, not
 * a scene's result, so it replaces outright rather than being filed under ''
 * next to real runs the user can still act on.
 */
export function mergeRomRunLogs(stored: RomRunLog, fresh: RomRunLog): RomRunLog {
  if (fresh.unreadable) return fresh
  const freshKeys = new Set(fresh.runs.map((r) => normalizeSceneKey(r.scene)))
  const runs = [...stored.runs.filter((r) => !freshKeys.has(normalizeSceneKey(r.scene))), ...fresh.runs]
  return {
    ...fresh,
    ok: runs.every((r) => r.ok),
    runs,
    errors: runs.flatMap((r) => r.errors),
    warnings: runs.flatMap((r) => r.warnings),
    failedMorphs: runs.flatMap((r) => r.failedMorphs),
    keyProblems: runs.flatMap((r) => r.keyProblems),
  }
}

/**
 * The log with the named scenes' runs removed, aggregates recomputed — `null`
 * when that leaves nothing worth keeping (the caller deletes the file / clears
 * the banner), and the SAME object back when none of them had an entry, so an
 * identity check is a valid "nothing changed" test (the memoized ROM subtree
 * depends on the log's identity — see `useRomRunLog`).
 *
 * A run retires exactly the verdicts it supersedes, which is per SCENE on both
 * paths: the single-scene rebuild ("Generate new ROM" on a scene card) re-runs
 * one scene, and a DTH Export batch re-runs the scenes the user ticked — a
 * scene neither one touches keeps its findings, because nothing is coming to
 * rewrite them. Which scenes a batch retires is `scenesRetiredByRun`
 * (`execute-jobs.ts`), the one rule both the store and the screen read.
 *
 * An `unreadable` log is dropped whole: it describes a broken FILE, not a
 * scene's result, so there is no per-scene entry to keep — and the run about to
 * start writes a fresh one. A v1 log (pre-runtime-v54) and a run from an
 * unsaved scene both sit under scene `''`, so they are retired only by a caller
 * that passes `''` — which a ROM-rebuilding batch does, or they would pin the
 * report through every future run.
 */
export function dropSceneRuns(log: RomRunLog, scenePaths: ReadonlyArray<string>): RomRunLog | null {
  if (log.unreadable) return null
  const keys = new Set(scenePaths.map(normalizeSceneKey))
  const runs = log.runs.filter((r) => !keys.has(normalizeSceneKey(r.scene)))
  if (runs.length === log.runs.length) return log
  if (runs.length === 0) return null
  return {
    ...log,
    ok: runs.every((r) => r.ok),
    runs,
    errors: runs.flatMap((r) => r.errors),
    warnings: runs.flatMap((r) => r.warnings),
    failedMorphs: runs.flatMap((r) => r.failedMorphs),
    keyProblems: runs.flatMap((r) => r.keyProblems),
  }
}

/** An existing-but-corrupt log still surfaces as a problem instead of throwing. */
export function unreadableRomRunLog(): RomRunLog {
  const message =
    'The ROM run log exists but could not be read — the run may have crashed while writing it. Re-run the ROM script in Daz.'
  return {
    character: '',
    finishedAt: '',
    finishedAtMs: Date.now(),
    ok: false,
    unreadable: true,
    runs: [
      {
        scene: '',
        sceneName: '',
        finishedAt: '',
        finishedAtMs: Date.now(),
        ok: false,
        errors: [message],
        warnings: [],
        failedMorphs: [],
        keyProblems: [],
      },
    ],
    errors: [message],
    warnings: [],
    failedMorphs: [],
    keyProblems: [],
  }
}
