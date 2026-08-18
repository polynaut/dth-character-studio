import { beforeEach, describe, expect, it, vi } from 'vitest'

// What a finished DTH Export is allowed to CLAIM.
//
// The Runner's contract ends at "the script I started returned" — so a row
// whose script refused the scene, bailed for want of a runtime, or failed
// mid-ROM comes back `done`, byte-identical to one that exported. Believing
// the rows alone reported a run that wrote nothing at all as "1 scene
// exported" (measured 2026-08-14: the ROM script's runtime include came up
// empty, the script bailed 2 ms in, and the studio toasted success while the
// export folder still held the previous run's files).
//
// The scripts do say what happened — in their own channel, the character's ROM
// run log. These pin that the finish report reads it, and reads it the way the
// two files it can live in actually behave.

const files = new Map<string, string>()
const dirs = new Set<string>()

function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/g, '')
}
function addDir(p: string): void {
  let path = norm(p)
  while (path && path !== '/') {
    dirs.add(path)
    const idx = path.lastIndexOf('/')
    path = idx > 0 ? path.slice(0, idx) : ''
  }
}

vi.mock('@tauri-apps/api/path', () => ({
  appLocalDataDir: async () => '/appdata',
  sep: () => '/',
}))
vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '0.0.0' }))
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  convertFileSrc: (p: string) => p,
  // Daz never running: the handoff then launches it and returns without the
  // pickup wait, which is all these tests need out of the arm.
  invoke: async (cmd: string) => (cmd === 'daz_studio_running' ? false : cmd === 'launch_daz_studio' ? '' : null),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  async exists(p: string) {
    const t = norm(p).toLowerCase()
    for (const k of files.keys()) if (k.toLowerCase() === t) return true
    for (const k of dirs) if (k.toLowerCase() === t) return true
    return false
  },
  async remove(p: string, opts?: { recursive?: boolean }) {
    const t = norm(p).toLowerCase()
    for (const k of [...files.keys()]) {
      const lower = k.toLowerCase()
      if (lower === t || (opts?.recursive && lower.startsWith(`${t}/`))) files.delete(k)
    }
    for (const k of [...dirs]) {
      const lower = k.toLowerCase()
      if (lower === t || (opts?.recursive && lower.startsWith(`${t}/`))) dirs.delete(k)
    }
  },
  async mkdir(p: string) {
    addDir(p)
  },
  async readTextFile(p: string) {
    const v = files.get(norm(p))
    if (v == null) throw new Error(`ENOENT ${p}`)
    return v
  },
  async writeTextFile(p: string, c: string) {
    files.set(norm(p), c)
  },
  async rename(a: string, b: string) {
    const from = norm(a)
    const to = norm(b)
    for (const k of [...files.keys()]) {
      if (k === from) {
        files.set(to, files.get(k)!)
        files.delete(k)
      }
    }
  },
  async stat(p: string) {
    const path = norm(p)
    if (files.has(path)) {
      return { isDirectory: false, isFile: true, mtime: new Date(1000), size: files.get(path)!.length }
    }
    if (dirs.has(path)) return { isDirectory: true, isFile: false, mtime: new Date(0), size: 0 }
    throw new Error(`ENOENT ${p}`)
  },
  async readDir(p: string) {
    const path = norm(p)
    if (!dirs.has(path)) throw new Error(`ENOTDIR ${path}`)
    const prefix = `${path}/`
    const out = new Map<string, { name: string; isFile: boolean; isDirectory: boolean }>()
    for (const k of files.keys()) {
      if (!k.startsWith(prefix)) continue
      const rest = k.slice(prefix.length)
      const name = rest.split('/')[0]
      const isFile = !rest.includes('/')
      if (!out.has(name)) out.set(name, { name, isFile, isDirectory: !isFile })
    }
    for (const k of dirs) {
      if (!k.startsWith(prefix)) continue
      const name = k.slice(prefix.length).split('/')[0]
      if (!out.has(name)) out.set(name, { name, isFile: false, isDirectory: true })
    }
    return [...out.values()]
  },
}))

import { CHARACTER_SCHEMA_VERSION, characterSchema, defaultSections, ROM_RUN_LOG_FILE } from '@dth/rom'
import * as storage from './storage'
import {
  dismissExportRun,
  executeCharacterJobs,
  fetchExportRunProgress,
  generateRomAnimation,
} from './api/execute'
import { fetchRomRunLog } from './api/characters.ts'
import { EXPORTER_JOB_FILE, RUNNING_JOB_FILE, scriptFailureLines, tidyRunErrors } from './execute-jobs'
import { LAST_ROM_RUN_FILE } from './character-internals.ts'

const PROJECT = '/games/P'
const SCENE = `${PROJECT}/Ita/daz3d/Ita.duf`
const SCENE_B = `${PROJECT}/Ita/daz3d/Ita_Yoga.duf`
const SCRIPTS_ROOT = '/daz/Scripts/DTH-Character-Studio'
const SCRIPT = `${SCRIPTS_ROOT}/P/Ita/.Bulk_ROM_Export.dsa`
const PENDING = `${SCRIPTS_ROOT}/${EXPORTER_JOB_FILE}`
const RUNNING = `${SCRIPTS_ROOT}/${RUNNING_JOB_FILE}`
const META = storage.characterMetaDir(PROJECT, 'Ita', 'c1')

beforeEach(async () => {
  files.clear()
  dirs.clear()
  await dismissExportRun()
  files.set('/appdata/settings.json', JSON.stringify({ dazLibraryFolder: '/daz' }))
})

/** Seed project + character + scenes + script, then hand the batch off — which
 *  arms the in-memory export watch (and stamps its `startedAtMs`). */
async function armRun(scenes: Array<string> = [SCENE]): Promise<void> {
  await storage.createProjectManifest(PROJECT, 'P')
  const character = characterSchema.parse({
    id: 'c1',
    name: 'Ita',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    sections: defaultSections(),
    scenePath: SCENE,
    extraScenes: scenes.filter((s) => s !== SCENE),
    exportPath: '/exports',
  })
  addDir(`${PROJECT}/Ita`)
  files.set(
    `${PROJECT}/Ita/Ita.json`,
    JSON.stringify({ ...character, schemaVersion: CHARACTER_SCHEMA_VERSION }),
  )
  for (const scene of scenes) files.set(scene, 'DUF')
  files.set(SCRIPT, 'SCRIPT')
  await executeCharacterJobs({ data: { projectId: PROJECT, id: 'c1', scenes, mode: 'rom-export' } })
  files.set(RUNNING, files.get(PENDING)!)
  files.delete(PENDING)
}

/** The Runner's view at the end of the batch: every row `done` (its contract)
 *  unless a row is explicitly named as failed. */
function batchFinished(rows: Array<{ scene: string; status?: 'done' | 'failed'; error?: string }>): void {
  files.set(
    RUNNING,
    JSON.stringify({
      version: 1,
      type: 'bulk-export',
      progress: 100,
      jobsDone: rows.length,
      jobs: rows.map((r) => ({
        scenePath: r.scene,
        scriptPath: SCRIPT,
        status: r.status ?? 'done',
        ...(r.error ? { error: r.error } : {}),
      })),
    }),
  )
}

/** One scene's entry in a ROM run log, `at` ms from now (negative = before
 *  this run started). */
function sceneRun(
  scene: string,
  ok: boolean,
  at: number,
  errors: Array<string> = [],
  failedMorphs: Array<{ frame: number; node: string; prop: string; reason: string }> = [],
) {
  return {
    scene,
    sceneName: scene.split('/').pop()?.replace(/\.duf$/i, '') ?? '',
    finishedAt: new Date(Date.now() + at).toString(),
    finishedAtMs: Date.now() + at,
    ok,
    errors,
    failedMorphs,
  }
}

function writeRunLog(name: string, runs: Array<ReturnType<typeof sceneRun>>): void {
  files.set(`${META}/${name}`, JSON.stringify({ logVersion: 2, character: 'Ita', ok: false, runs }))
}

const RUNTIME_GONE = 'The DTH runtime could not be loaded, so the ROM was NOT built.'

describe('a finished batch reports what the SCRIPTS did, not just what the Runner did', () => {
  it('a `done` row whose script logged a failure is a failure', async () => {
    await armRun()
    batchFinished([{ scene: SCENE }])
    writeRunLog(ROM_RUN_LOG_FILE, [sceneRun(SCENE, false, 500, [RUNTIME_GONE])])

    const run = await fetchExportRunProgress('c1')

    expect(run?.state).toBe('finished')
    // The Runner saw nothing wrong — this is exactly the lie being fixed.
    if (run?.state !== 'finished') throw new Error('not finished')
    expect(run.failed).toBe(0)
    expect(run.scriptFailures).toHaveLength(1)
    expect(run.scriptFailures[0]?.sceneName).toBe('Ita')
    expect(run.scriptFailures[0]?.errors).toEqual([RUNTIME_GONE])
  })

  it('reads the STORED copy too — the character page may have ingested the transport already', async () => {
    await armRun()
    batchFinished([{ scene: SCENE }])
    // `fetchRomRunLog` merges the Daz-written file into this one and DELETES
    // it, so whether the transport still exists depends only on whether the
    // user tabbed back mid-batch. Both spellings must report.
    writeRunLog(LAST_ROM_RUN_FILE, [sceneRun(SCENE, false, 500, [RUNTIME_GONE])])

    const run = await fetchExportRunProgress('c1')

    if (run?.state !== 'finished') throw new Error('not finished')
    expect(run.scriptFailures).toHaveLength(1)
  })

  it('does NOT resurrect a failure from BEFORE this run', async () => {
    await armRun()
    batchFinished([{ scene: SCENE }])
    // The user saw this one, fixed it, and re-ran. A finish report that keeps
    // showing it would make every later run look broken.
    writeRunLog(LAST_ROM_RUN_FILE, [sceneRun(SCENE, false, -60_000, ['an old problem'])])

    const run = await fetchExportRunProgress('c1')

    if (run?.state !== 'finished') throw new Error('not finished')
    expect(run.scriptFailures).toEqual([])
  })

  it('a clean run stays clean', async () => {
    await armRun()
    batchFinished([{ scene: SCENE }])
    writeRunLog(ROM_RUN_LOG_FILE, [sceneRun(SCENE, true, 500)])

    const run = await fetchExportRunProgress('c1')

    if (run?.state !== 'finished') throw new Error('not finished')
    expect(run.failed).toBe(0)
    expect(run.scriptFailures).toEqual([])
  })

  it('never counts one scene twice — a row the Runner FAILED is not also a script failure', async () => {
    await armRun([SCENE, SCENE_B])
    batchFinished([
      { scene: SCENE, status: 'failed', error: 'Daz died' },
      { scene: SCENE_B },
    ])
    // RAW spellings on purpose: the run log carries whatever Daz reported —
    // backslashes, drive-letter case, the lot — and a normalized-key lookup
    // that trusts its caller misses every real path (see houdini-jobs #637).
    writeRunLog(ROM_RUN_LOG_FILE, [
      sceneRun(SCENE.replace(/\//g, '\\').toUpperCase(), false, 500, ['Daz died']),
      sceneRun(SCENE_B, false, 500, [RUNTIME_GONE]),
    ])

    const run = await fetchExportRunProgress('c1')

    if (run?.state !== 'finished') throw new Error('not finished')
    expect(run.failed).toBe(1)
    // Only the SECOND scene is new information; the first is already counted.
    expect(run.scriptFailures.map((f) => f.errors)).toEqual([[RUNTIME_GONE]])
    expect(run.failed + run.scriptFailures.length).toBe(2)
  })

  it('a morph that would not apply is NOT a failed export', async () => {
    await armRun()
    batchFinished([{ scene: SCENE }])
    // The runtime writes `ok: bFinished && errors + failedMorphs === 0`, so a
    // single unappliable dial makes an otherwise perfect run `ok: false`. But a
    // failed morph is a per-dial partial the product treats as routine — its
    // frame stays in the ROM (empty), the export runs, the character page lists
    // it for repair. Counting it here would report a clean export as "1 of 1
    // scene failed" AND, because both continuations gate on `failed < total`,
    // silently drop the Houdini and Unreal legs of a run that worked.
    writeRunLog(ROM_RUN_LOG_FILE, [
      sceneRun(SCENE, false, 500, [], [{ frame: 12, node: 'Genesis9', prop: 'Nope', reason: 'not found' }]),
    ])

    const run = await fetchExportRunProgress('c1')

    if (run?.state !== 'finished') throw new Error('not finished')
    expect(run.scriptFailures).toEqual([])
  })

  it('a scene that failed AND lost morphs still counts once, as a failure', async () => {
    await armRun()
    batchFinished([{ scene: SCENE }])
    // The exclusion above is about failed morphs ALONE — an error means the
    // scene produced nothing, whatever else it also recorded.
    writeRunLog(ROM_RUN_LOG_FILE, [
      sceneRun(SCENE, false, 500, [RUNTIME_GONE], [{ frame: 3, node: 'G9', prop: 'X', reason: 'gone' }]),
    ])

    const run = await fetchExportRunProgress('c1')

    if (run?.state !== 'finished') throw new Error('not finished')
    expect(run.scriptFailures).toHaveLength(1)
  })

  it('a run that bailed with NOTHING to say is still a failure', async () => {
    await armRun()
    batchFinished([{ scene: SCENE }])
    // ApplyDTHWorkflow has `return false` paths that log nothing. A silent bail
    // is a failure whose message got lost — not a success.
    writeRunLog(ROM_RUN_LOG_FILE, [sceneRun(SCENE, false, 500)])

    const run = await fetchExportRunProgress('c1')

    if (run?.state !== 'finished') throw new Error('not finished')
    expect(run.scriptFailures).toHaveLength(1)
  })

  it('an unreadable run log is not evidence of success — nor of failure', async () => {
    await armRun()
    batchFinished([{ scene: SCENE }])
    files.set(`${META}/${ROM_RUN_LOG_FILE}`, '{ torn half-writ')

    const run = await fetchExportRunProgress('c1')

    // No crash, no invented failure: the run reports what it can read.
    if (run?.state !== 'finished') throw new Error('not finished')
    expect(run.scriptFailures).toEqual([])
  })
})

describe('scriptFailureLines', () => {
  it('leads with the scene, so a batch failure says WHICH scene produced nothing', () => {
    expect(
      scriptFailureLines([{ scene: '/p/Ita_Yoga.duf', sceneName: 'Ita_Yoga', errors: [RUNTIME_GONE] }]),
    ).toEqual([`Ita_Yoga: ${RUNTIME_GONE}`])
  })

  it('still reports a failure that could not be attributed to a scene', () => {
    // A script generated before runtime v75 logged its failure untagged
    // whenever the studio had already ingested the previous run.
    expect(scriptFailureLines([{ scene: '', sceneName: '', errors: [RUNTIME_GONE] }])).toEqual([
      RUNTIME_GONE,
    ])
  })

  it('falls back to the scene FILE name when the log carries no sceneName', () => {
    expect(
      scriptFailureLines([{ scene: 'D:\\games\\P\\Ita\\Ita.duf', sceneName: '', errors: ['boom'] }]),
    ).toEqual(['Ita.duf: boom'])
  })

  it('does not cap or dedup — one tidy runs over the WHOLE list at the call site', () => {
    // These lines are concatenated with the Runner's own before display. Capping
    // here too would turn this half's "…and N more" into an ordinary line that
    // the outer tidy could truncate again, counting the same tail twice.
    const many = Array.from({ length: 6 }, (_, i) => ({
      scene: `/p/S${i}.duf`,
      sceneName: `S${i}`,
      errors: ['boom'],
    }))
    expect(scriptFailureLines(many)).toHaveLength(6)
    expect(scriptFailureLines(many).some((l) => l.includes('more'))).toBe(false)
    // The composed list is what gets capped, once.
    expect(tidyRunErrors(['runner said no', ...scriptFailureLines(many)])).toEqual([
      'runner said no',
      'S0: boom',
      'S1: boom',
      'S2: boom',
      '…and 3 more',
    ])
  })
})

describe('a handoff retires the PREVIOUS run report', () => {
  it('drops both run-log files, so the old failures cannot outlive the run', async () => {
    // The state the user sees: a red "errors in the last ROM run" banner and
    // red morph rows from the run before. Starting a new run must end them —
    // on disk as well as on screen, because the character page re-reads these
    // files on every window focus.
    await storage.createProjectManifest(PROJECT, 'P')
    writeRunLog(LAST_ROM_RUN_FILE, [sceneRun(SCENE, false, -60_000, ['an old problem'])])
    writeRunLog(ROM_RUN_LOG_FILE, [sceneRun(SCENE, false, -60_000, ['an old problem'])])

    await armRun()

    expect(files.has(`${META}/${LAST_ROM_RUN_FILE}`)).toBe(false)
    expect(files.has(`${META}/${ROM_RUN_LOG_FILE}`)).toBe(false)
  })

  it('the cleared store cannot merge into the new run’s report', async () => {
    // `fetchRomRunLog` merges the transport into the store BY SCENE. Scene B's
    // old failure would otherwise ride along into a run that only touched
    // scene A, and the banner would never clear.
    await storage.createProjectManifest(PROJECT, 'P')
    writeRunLog(LAST_ROM_RUN_FILE, [sceneRun(SCENE_B, false, -60_000, ['an old problem'])])

    await armRun([SCENE])
    batchFinished([{ scene: SCENE }])
    writeRunLog(ROM_RUN_LOG_FILE, [sceneRun(SCENE, true, 500)])

    const run = await fetchExportRunProgress('c1')

    if (run?.state !== 'finished') throw new Error('not finished')
    expect(run.scriptFailures).toEqual([])
    expect(await fetchRomRunLog({ data: { projectId: PROJECT, id: 'c1' } })).toMatchObject({
      ok: true,
      runs: [{ scene: SCENE, ok: true }],
    })
  })
})

describe('a SINGLE-SCENE rebuild retires only that scene', () => {
  /** Seed the project + character + both scenes + the ROM-build script, without
   *  handing anything off — "Generate new ROM" is its own flow. */
  async function seedForRebuild(): Promise<void> {
    await storage.createProjectManifest(PROJECT, 'P')
    const character = characterSchema.parse({
      id: 'c1',
      name: 'Ita',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      sections: defaultSections(),
      scenePath: SCENE,
      extraScenes: [SCENE_B],
      exportPath: '/exports',
    })
    addDir(`${PROJECT}/Ita`)
    files.set(
      `${PROJECT}/Ita/Ita.json`,
      JSON.stringify({ ...character, schemaVersion: CHARACTER_SCHEMA_VERSION }),
    )
    files.set(SCENE, 'DUF')
    files.set(SCENE_B, 'DUF')
    files.set(`${SCRIPTS_ROOT}/P/Ita/.Build_ROM_Animation.dsa`, 'SCRIPT')
  }

  it('drops its own scene from the store and LEAVES the other scene’s findings', async () => {
    await seedForRebuild()
    writeRunLog(LAST_ROM_RUN_FILE, [
      sceneRun(SCENE, false, -60_000, ['scene A failed']),
      sceneRun(SCENE_B, false, -60_000, ['scene B failed']),
    ])

    await generateRomAnimation({ data: { projectId: PROJECT, id: 'c1', scenePath: SCENE } })

    // Wiping the log here would throw away B's findings for good — nothing is
    // going to re-run B and rewrite them.
    const log = await fetchRomRunLog({ data: { projectId: PROJECT, id: 'c1' } })
    expect(log?.runs.map((r) => r.scene)).toEqual([SCENE_B])
    expect(log?.errors).toEqual(['scene B failed'])
    expect(log?.ok).toBe(false)
  })

  it('deletes the file outright when its scene was the only one in it', async () => {
    await seedForRebuild()
    writeRunLog(LAST_ROM_RUN_FILE, [sceneRun(SCENE, false, -60_000, ['scene A failed'])])

    await generateRomAnimation({ data: { projectId: PROJECT, id: 'c1', scenePath: SCENE } })

    expect(files.has(`${META}/${LAST_ROM_RUN_FILE}`)).toBe(false)
    expect(await fetchRomRunLog({ data: { projectId: PROJECT, id: 'c1' } })).toBeNull()
  })

  it('reaches the un-ingested TRANSPORT too, so the next ingest cannot revive it', async () => {
    await seedForRebuild()
    // The user never tabbed back after the last run, so the Daz-written file is
    // still sitting there waiting to be merged in.
    writeRunLog(ROM_RUN_LOG_FILE, [
      sceneRun(SCENE, false, -60_000, ['scene A failed']),
      sceneRun(SCENE_B, false, -60_000, ['scene B failed']),
    ])

    await generateRomAnimation({ data: { projectId: PROJECT, id: 'c1', scenePath: SCENE } })

    const log = await fetchRomRunLog({ data: { projectId: PROJECT, id: 'c1' } })
    expect(log?.runs.map((r) => r.scene)).toEqual([SCENE_B])
  })
})
