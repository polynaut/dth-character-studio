import { normalizeSceneKey } from './execute-jobs.ts'

/**
 * The ROM run log — the pure parts (types, parsing, per-scene merging), kept
 * out of the I/O layer so they stay unit-testable, exactly like `execute-jobs.ts`
 * is to `api/execute.ts`. The reading/writing/ingesting lives in
 * `api/characters.ts` (`fetchRomRunLog`).
 *
 * The shape is per SCENE (log v2, runtime v53). A DTH Export batch works one row
 * per scene and every row's script writes the same per-character log file, so a
 * single flat log could only ever hold the LAST scene that ran — the scenes that
 * failed before it were destroyed silently, which is the bug this shape fixes.
 */

export interface RomRunFailedMorph {
  frame: number
  node: string
  prop: string
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
  ok: boolean
  errors: Array<string>
  failedMorphs: Array<RomRunFailedMorph>
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
  failedMorphs: Array<RomRunFailedMorph>
  unreadable?: boolean
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
    failedMorphs: parseFailedMorphs(record.failedMorphs),
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
    failedMorphs: runs.flatMap((r) => r.failedMorphs),
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
    failedMorphs: runs.flatMap((r) => r.failedMorphs),
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
        failedMorphs: [],
      },
    ],
    errors: [message],
    failedMorphs: [],
  }
}
