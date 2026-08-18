import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { runInNewContext } from 'node:vm'

import { describe, expect, it } from 'vitest'

import {
  failedMorphKeysByScene,
  failedMorphKeysForScene,
  matchLinkedScene,
  mergeRomRunLogs,
  morphKey,
  parseRomRunLogText,
  unreadableRomRunLog,
} from './run-log.ts'

/**
 * MULTI-SCENE run logs (the DTH Export bulk batch).
 *
 * A bulk run works one row per scene, back to back, inside a Daz nobody is
 * watching — and every row's script writes the SAME per-character run log. So
 * the question these tests pin is: after three scenes have run and two of them
 * failed, what does the studio still have to show?
 *
 * The writer is the shipped `writeRunLog` from DthUtils.dsa, driven over an
 * in-memory filesystem, so this is the real code path rather than a model of it.
 */

interface RunLogEntry {
  scene: string
  sceneName: string
  ok: boolean
  errors: Array<string>
  failedMorphs: Array<{ frame: number; node: string; prop: string; reason: string }>
}

interface UtilsModule {
  writeRunLog: (path: string, summary: Record<string, unknown>) => boolean
  resetRunLog: () => void
  logRunError: (message: string) => void
  logRunFailedMorph: (frame: number, node: string, prop: string, reason: string) => void
  runLogProblemCount: () => number
}

const UTILS_EXPORTS =
  'writeRunLog, resetRunLog, logRunError, logRunFailedMorph, runLogProblemCount'

/** Load DthUtils.dsa over an in-memory filesystem + a fake open scene. */
function loadUtils(files: Map<string, string>, scene: { path: string }): UtilsModule {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'runtime')
  const src = readFileSync(join(dir, 'DthUtils.dsa'), 'utf8')
  class DzFile {
    static ReadOnly = 1
    ReadOnly = 1
    WriteOnly = 2
    Truncate = 4
    path: string
    constructor(path: string) {
      this.path = path
    }
    open(mode: number) {
      if ((mode & 2) !== 0) return true
      return files.has(this.path)
    }
    read() {
      return files.get(this.path) ?? ''
    }
    write(text: string) {
      files.set(this.path, text)
    }
    close() {}
  }
  class DzFileInfo {
    p: string
    constructor(p: string) {
      this.p = p
    }
    completeBaseName() {
      return (this.p.split(/[\\/]/).pop() ?? '').replace(/\.duf$/i, '')
    }
  }
  return runInNewContext(`${src}\n;({ ${UTILS_EXPORTS} })`, {
    print: () => {},
    Date,
    JSON,
    DzFile,
    DzFileInfo,
    // The runtime reads the open scene's path off Scene.getFilename().
    Scene: { getFilename: () => scene.path },
  }) as UtilsModule
}

const CHAR_DIR = 'D:/proj/Kira'
const LOG = `${CHAR_DIR}/dth_rom_run_log.json`
const SCENE_A = 'D:/proj/Kira/daz3d/KiraDefault.duf'
const SCENE_B = 'D:/proj/Kira/daz3d/KiraSummer.duf'
const SCENE_C = 'D:/proj/Kira/daz3d/KiraWinter.duf'

/** Run one scene's script end-to-end: reset the log, record its failures, write. */
function runScene(
  files: Map<string, string>,
  scenePath: string,
  failures: Array<{ frame: number; prop: string }>,
) {
  const scene = { path: scenePath }
  const utils = loadUtils(files, scene)
  utils.resetRunLog()
  for (const f of failures) {
    utils.logRunFailedMorph(f.frame, 'Genesis9', f.prop, 'property not found')
  }
  utils.writeRunLog(LOG, {
    character: 'Kira',
    ok: utils.runLogProblemCount() === 0,
  })
}

/** Every run the written log holds, whatever shape it is stored in. */
function storedRuns(files: Map<string, string>): Array<RunLogEntry> {
  const raw = files.get(LOG)
  if (!raw) return []
  const parsed = JSON.parse(raw) as Record<string, unknown>
  const runs = Array.isArray(parsed.runs) ? (parsed.runs as Array<RunLogEntry>) : [parsed as unknown as RunLogEntry]
  return runs
}

describe('run log across a multi-scene bulk export', () => {
  it('keeps EVERY failing scene, not just the last one to run', () => {
    // The batch: A fails, B fails differently, C is clean. All three write the
    // same per-character log file, back to back, with no studio ingest between
    // rows (the batch runs unattended — the studio only polls the job file).
    const files = new Map<string, string>()
    runScene(files, SCENE_A, [{ frame: 12, prop: 'ExpandAll' }])
    runScene(files, SCENE_B, [{ frame: 40, prop: 'JacketFlare' }])
    runScene(files, SCENE_C, [])

    const runs = storedRuns(files)
    const scenes = runs.map((r) => r.scene)
    // Every scene that ran is represented — a clean run too (it clears that
    // scene's previous failures in the studio).
    expect(scenes).toContain(SCENE_A)
    expect(scenes).toContain(SCENE_B)
    expect(scenes).toContain(SCENE_C)

    // …and each keeps ITS OWN failures.
    const a = runs.find((r) => r.scene === SCENE_A)
    const b = runs.find((r) => r.scene === SCENE_B)
    expect(a?.failedMorphs.map((m) => m.prop)).toEqual(['ExpandAll'])
    expect(a?.failedMorphs.map((m) => m.frame)).toEqual([12])
    expect(b?.failedMorphs.map((m) => m.prop)).toEqual(['JacketFlare'])
    expect(b?.failedMorphs.map((m) => m.frame)).toEqual([40])
    expect(runs.find((r) => r.scene === SCENE_C)?.ok).toBe(true)
  })

  it('tags every run with the scene it ran in, so the UI can attribute it', () => {
    // Without this the studio cannot select the matching scene for an error —
    // there is nothing in the log that says which scene produced it.
    const files = new Map<string, string>()
    runScene(files, SCENE_B, [{ frame: 7, prop: 'Widen' }])
    const [run] = storedRuns(files)
    expect(run.scene).toBe(SCENE_B)
    expect(run.sceneName).toBe('KiraSummer')
  })

  it('REPLACES a scene’s own previous result when that scene runs again', () => {
    // Re-running one scene must not leave its stale failures behind, and must
    // not touch the other scene's.
    const files = new Map<string, string>()
    runScene(files, SCENE_A, [{ frame: 12, prop: 'ExpandAll' }])
    runScene(files, SCENE_B, [{ frame: 40, prop: 'JacketFlare' }])
    // A re-run of A, now clean.
    runScene(files, SCENE_A, [])

    const runs = storedRuns(files)
    expect(runs.find((r) => r.scene === SCENE_A)?.failedMorphs).toEqual([])
    expect(runs.find((r) => r.scene === SCENE_A)?.ok).toBe(true)
    // B is untouched.
    expect(runs.find((r) => r.scene === SCENE_B)?.failedMorphs.map((m) => m.frame)).toEqual([40])
    // One entry per scene — a re-run replaces, never appends.
    expect(runs.filter((r) => r.scene === SCENE_A)).toHaveLength(1)
  })
})

// --- The STUDIO side: parsing those logs and merging them into the store -----

describe('run-log parsing + per-scene merge (studio side)', () => {
  const run = (scene: string, frames: Array<number>) => ({
    scene,
    sceneName: scene.split('/').pop()?.replace(/\.duf$/, '') ?? '',
    finishedAt: 'now',
    finishedAtMs: 1,
    ok: frames.length === 0,
    errors: [],
    failedMorphs: frames.map((frame) => ({
      frame,
      node: 'Genesis9',
      prop: 'X',
      reason: 'missing',
    })),
  })

  it('reads a v2 log into one entry per scene, flattening the problem view', () => {
    const log = parseRomRunLogText(
      JSON.stringify({ logVersion: 2, runs: [run(SCENE_A, [12]), run(SCENE_B, [40])] }),
    )
    expect(log.runs.map((r) => r.scene)).toEqual([SCENE_A, SCENE_B])
    expect(log.failedMorphs.map((m) => m.frame)).toEqual([12, 40])
    expect(log.ok).toBe(false)
  })

  it('still reads a v1 log — one untagged run — so an upgrade loses nothing', () => {
    // A log already sitting in a character folder when the app updates.
    const log = parseRomRunLogText(
      JSON.stringify({
        logVersion: 1,
        character: 'Kira',
        ok: false,
        errors: ['boom'],
        failedMorphs: [{ frame: 3, node: 'Genesis9', prop: 'X', reason: 'missing' }],
      }),
    )
    expect(log.runs).toHaveLength(1)
    expect(log.runs[0].scene).toBe('') // untagged — applies to whatever is selected
    expect(log.errors).toEqual(['boom'])
    expect(log.ok).toBe(false)
  })

  it('is only ok when EVERY scene came back clean', () => {
    const mixed = parseRomRunLogText(
      JSON.stringify({ logVersion: 2, runs: [run(SCENE_A, []), run(SCENE_B, [40])] }),
    )
    expect(mixed.ok).toBe(false)
    const clean = parseRomRunLogText(
      JSON.stringify({ logVersion: 2, runs: [run(SCENE_A, []), run(SCENE_B, [])] }),
    )
    expect(clean.ok).toBe(true)
  })

  it('merges a mid-batch ingest instead of erasing the scenes that already ran', () => {
    // The user alt-tabs to the studio while Daz still has scenes to run: that
    // ingest DELETES the transport file, so scene A lives only in the store and
    // the next ingest brings B. Replacing would drop A exactly when they looked.
    const stored = parseRomRunLogText(JSON.stringify({ logVersion: 2, runs: [run(SCENE_A, [12])] }))
    const fresh = parseRomRunLogText(JSON.stringify({ logVersion: 2, runs: [run(SCENE_B, [40])] }))
    const merged = mergeRomRunLogs(stored, fresh)
    expect(merged.runs.map((r) => r.scene)).toEqual([SCENE_A, SCENE_B])
    expect(merged.failedMorphs.map((m) => m.frame)).toEqual([12, 40])
  })

  it('a re-run of one scene replaces only that scene in the store', () => {
    const stored = parseRomRunLogText(
      JSON.stringify({ logVersion: 2, runs: [run(SCENE_A, [12]), run(SCENE_B, [40])] }),
    )
    // A now passes.
    const fresh = parseRomRunLogText(JSON.stringify({ logVersion: 2, runs: [run(SCENE_A, [])] }))
    const merged = mergeRomRunLogs(stored, fresh)
    expect(merged.runs.find((r) => r.scene === SCENE_A)?.failedMorphs).toEqual([])
    expect(merged.runs.find((r) => r.scene === SCENE_B)?.failedMorphs.map((m) => m.frame)).toEqual([40])
    // Still failing overall — B's problem is untouched.
    expect(merged.ok).toBe(false)
  })

  it('matches stored scenes by KEY, so a separator/case difference still replaces', () => {
    const stored = parseRomRunLogText(JSON.stringify({ logVersion: 2, runs: [run(SCENE_A, [12])] }))
    const fresh = parseRomRunLogText(
      JSON.stringify({
        logVersion: 2,
        runs: [run(SCENE_A.replace(/\//g, '\\').toUpperCase(), [])],
      }),
    )
    expect(mergeRomRunLogs(stored, fresh).runs).toHaveLength(1)
  })

  it('an unreadable fresh log replaces outright — it describes a broken FILE', () => {
    const stored = parseRomRunLogText(JSON.stringify({ logVersion: 2, runs: [run(SCENE_A, [12])] }))
    const merged = mergeRomRunLogs(stored, unreadableRomRunLog())
    expect(merged.unreadable).toBe(true)
    expect(merged.runs).toHaveLength(1)
  })
})

describe('failedMorphKeysByScene / failedMorphKeysForScene — red rows per SELECTED scene', () => {
  /** One scene's run with named failed dials (distinct per scene, unlike the
   *  merge tests' fixed 'X' — WHICH morph failed WHERE is the point here). */
  const sceneRun = (scene: string, props: Array<string>) => ({
    scene,
    sceneName: scene.split('/').pop()?.replace(/\.duf$/, '') ?? '',
    finishedAt: 'now',
    finishedAtMs: 1,
    ok: props.length === 0,
    errors: [],
    failedMorphs: props.map((prop) => ({
      frame: 1,
      node: 'Genesis8_1Female',
      prop,
      reason: 'dialed at 0.089',
    })),
  })
  const log = (runs: Array<unknown>) =>
    parseRomRunLogText(JSON.stringify({ logVersion: 2, runs }))

  it("buckets failures by the scene whose run reported them — the primary's do not bleed into the THICK grid", () => {
    // The 2026-08-18 report: the primary's failures stayed red with the other
    // scene selected — but the gate read the PRIMARY's dial values, which say
    // nothing about the other scene.
    const byScene = failedMorphKeysByScene(
      log([sceneRun(SCENE_A, ['PBMBreastsHeavy']), sceneRun(SCENE_B, [])]),
    )
    expect(failedMorphKeysForScene(byScene, SCENE_A)).toEqual(
      new Set([morphKey('Genesis8_1Female', 'PBMBreastsHeavy')]),
    )
    expect(failedMorphKeysForScene(byScene, SCENE_B)).toBeUndefined()
  })

  it('the accessor normalizes the RAW stored spelling — backslashes and case still match', () => {
    // The character stores the path Windows-style; the log writes what Daz
    // reported. The map is keyed by normalizeSceneKey, so the accessor must
    // normalize — a raw .get() misses on every real Windows path.
    const byScene = failedMorphKeysByScene(log([sceneRun(SCENE_A, ['ShapeTHIGHSBIG'])]))
    const raw = SCENE_A.replace(/\//g, '\\').toUpperCase()
    expect(failedMorphKeysForScene(byScene, raw)).toEqual(
      new Set([morphKey('Genesis8_1Female', 'ShapeTHIGHSBIG')]),
    )
  })

  it("an UNTAGGED run (unsaved scene / v1 log) can't be pinned — it marks every scene's grid", () => {
    const byScene = failedMorphKeysByScene(
      log([sceneRun('', ['BreastPreset01']), sceneRun(SCENE_A, ['PBMBreastsHeavy'])]),
    )
    // Merged into a scene that has its own failures…
    expect(failedMorphKeysForScene(byScene, SCENE_A)).toEqual(
      new Set([
        morphKey('Genesis8_1Female', 'PBMBreastsHeavy'),
        morphKey('Genesis8_1Female', 'BreastPreset01'),
      ]),
    )
    // …and standing alone in one that has none.
    expect(failedMorphKeysForScene(byScene, SCENE_B)).toEqual(
      new Set([morphKey('Genesis8_1Female', 'BreastPreset01')]),
    )
  })

  it('a clean log yields nothing to mark', () => {
    expect(failedMorphKeysByScene(log([sceneRun(SCENE_A, [])]))).toBeUndefined()
    expect(failedMorphKeysForScene(undefined, SCENE_A)).toBeUndefined()
  })
})

describe("matchLinkedScene — the report's click resolves the log spelling to the STORED one", () => {
  // selectScene honors ONLY the stored spelling (linkedScenes.includes is an
  // exact string match), while the log carries Daz's Scene.getFilename() —
  // forward slashes. A raw selectScene(run.scene) silently no-oped back to the
  // primary scene, which under per-scene scoping means the clicked failure's
  // red rows never appeared at all.
  const stored = 'D:\\Proj\\Kira\\daz3d\\KiraSummer.duf'

  it('the RAW Daz spelling (forward slashes, different case) finds the stored spelling', () => {
    expect(matchLinkedScene([SCENE_A, stored], 'd:/proj/kira/daz3d/kirasummer.duf')).toBe(stored)
  })

  it('an untagged run or an unlinked scene resolves to nothing — reveal in place', () => {
    expect(matchLinkedScene([SCENE_A, stored], '')).toBeUndefined()
    expect(matchLinkedScene([SCENE_A], 'D:/proj/Kira/daz3d/Unlinked.duf')).toBeUndefined()
  })
})
