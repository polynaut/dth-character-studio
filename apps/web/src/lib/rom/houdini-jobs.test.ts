import { describe, expect, it } from 'vitest'

import { characterSchema } from '@dth/rom'

import {
  buildHoudiniJob,
  houdiniResultSummary,
  houdiniRunStateFrom,
  houdiniScriptPathValue,
  parseHoudiniResult,
  sceneDthPath,
} from './houdini-jobs.ts'

import type { Character } from '@dth/rom'

/** A character with two linked scenes in the standard subfolder layout. */
function kira(over: Partial<Character> = {}): Character {
  return characterSchema.parse({
    id: 'c1',
    name: 'Kira',
    genesis: 'G9',
    gender: 'female',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    exportPath: 'X:\\p\\Kira\\daz3d\\dth-exports',
    scenePath: 'X:\\p\\Kira\\daz3d\\primary\\Kira.duf',
    extraScenes: ['X:\\p\\Kira\\daz3d\\summertide\\KiraSummertide.duf'],
    ...over,
  })
}

const ROOT = 'X:/p/Kira/daz3d'
const PRIMARY = 'x:/p/kira/daz3d/primary/kira.duf'
const EXTRA = 'x:/p/kira/daz3d/summertide/kirasummertide.duf'

describe('sceneDthPath — the match key handed to Houdini', () => {
  it('is <exportPath>/<scene folder>/<export name>.dth, primary keeping the bare name', () => {
    expect(sceneDthPath(kira(), PRIMARY, ROOT)).toBe(
      'X:/p/Kira/daz3d/dth-exports/primary/Kira.dth',
    )
    // An extra scene carries its subfolder in the name, exactly like the files
    // the exporter writes beside it.
    expect(sceneDthPath(kira(), EXTRA, ROOT)).toBe(
      'X:/p/Kira/daz3d/dth-exports/summertide/Kira_Summertide.dth',
    )
  })

  it('is empty without an export directory — nothing could have been imported', () => {
    expect(sceneDthPath(kira({ exportPath: '' }), PRIMARY, ROOT)).toBe('')
  })

  it('is empty for a scene the character does not link', () => {
    expect(sceneDthPath(kira(), 'x:/p/kira/daz3d/other/Other.duf', ROOT)).toBe('')
  })
})

describe('buildHoudiniJob', () => {
  it('carries one entry per selected scene, labelled by the scene file', () => {
    const job = buildHoudiniJob(kira(), [PRIMARY, EXTRA], {
      resultPath: 'X:\\p\\Kira\\.dth_houdini_result.json',
      exportDirectory: 'X:\\unreal\\Kira',
      scenesRootAbs: ROOT,
    })
    expect(job.scenes).toEqual([
      { dth: 'X:/p/Kira/daz3d/dth-exports/primary/Kira.dth', label: 'Kira' },
      { dth: 'X:/p/Kira/daz3d/dth-exports/summertide/Kira_Summertide.dth', label: 'KiraSummertide' },
    ])
    // Paths travel forward-slashed — Houdini's own convention, and what the
    // node parms hold.
    expect(job.resultPath).toBe('X:/p/Kira/.dth_houdini_result.json')
    expect(job.exportDirectory).toBe('X:/unreal/Kira')
  })

  it('drops scenes with no resolvable .dth instead of sending unmatchable rows', () => {
    const job = buildHoudiniJob(kira({ exportPath: '' }), [PRIMARY, EXTRA], {
      resultPath: 'r.json',
    })
    expect(job.scenes).toEqual([])
  })

  it('dedupes two scenes that would resolve to the same file', () => {
    const job = buildHoudiniJob(kira(), [PRIMARY, PRIMARY], { resultPath: 'r.json' })
    expect(job.scenes).toHaveLength(1)
  })
})

describe('parseHoudiniResult — read while it is being written', () => {
  it('fills defaults for a partially written report', () => {
    const result = parseHoudiniResult('{"state":"running","total":2}')
    expect(result?.state).toBe('running')
    expect(result?.nodes).toEqual([])
    expect(result?.done).toBe(0)
  })

  it('returns null on a torn read rather than reporting a failed run', () => {
    expect(parseHoudiniResult('{"state":"run')).toBeNull()
  })

  it('keeps the HDA problems that the auto-answered dialog would have hidden', () => {
    const result = parseHoudiniResult(
      JSON.stringify({
        state: 'done',
        total: 1,
        done: 1,
        nodes: [
          {
            node: '/obj/DazToHue/DazToHueExport',
            status: 'ok',
            problems: ['Missing pose asset for JCM'],
          },
        ],
      }),
    )
    expect(result?.nodes[0].problems).toEqual(['Missing pose asset for JCM'])
  })
})

describe('houdiniResultSummary', () => {
  const make = (statuses: Array<'ok' | 'skipped' | 'failed'>) =>
    houdiniResultSchemaResult(statuses)

  function houdiniResultSchemaResult(statuses: Array<'ok' | 'skipped' | 'failed'>) {
    return parseHoudiniResult(
      JSON.stringify({
        state: 'done',
        nodes: statuses.map((status, i) => ({ node: `/obj/n${i}`, status })),
      }),
    )!
  }

  it('counts each outcome, omitting the empty ones', () => {
    expect(houdiniResultSummary(make(['ok', 'ok']))).toBe('2 exported')
    expect(houdiniResultSummary(make(['ok', 'skipped', 'failed']))).toBe(
      '1 exported, 1 skipped, 1 failed',
    )
    expect(houdiniResultSummary(make([]))).toBe('')
  })
})

describe('HOUDINI_SCRIPT_PATH composition', () => {
  it('keeps Houdini’s own default path with a trailing &', () => {
    // Without the `&` the variable REPLACES Houdini's default script path, and
    // the user's own startup scripts silently stop running for the session.
    expect(houdiniScriptPathValue('C:/Users/x/AppData/Local/dth/houdini-scripts')).toBe(
      'C:/Users/x/AppData/Local/dth/houdini-scripts;&',
    )
  })

  it('normalises separators and a trailing slash', () => {
    expect(houdiniScriptPathValue('C:\\Users\\x\\dth\\houdini-scripts\\')).toBe(
      'C:/Users/x/dth/houdini-scripts;&',
    )
  })

  it('degrades to the default path alone rather than emitting an empty entry', () => {
    expect(houdiniScriptPathValue('')).toBe('&')
    expect(houdiniScriptPathValue('   ')).toBe('&')
  })
})

describe('houdiniRunStateFrom', () => {
  const result = (over: Record<string, unknown>) =>
    parseHoudiniResult(JSON.stringify({ state: 'running', total: 3, done: 1, ...over }))!

  it('waits while Houdini is still opening the project (no result file yet)', () => {
    // 456.py only runs AFTER the scene finishes loading — on a big project that
    // is a long silence, and it is not a failure.
    expect(houdiniRunStateFrom(null, true)).toEqual({ state: 'starting' })
  })

  it('calls it dead when there is no Houdini left to write the file', () => {
    expect(houdiniRunStateFrom(null, false)).toEqual({ state: 'dead' })
  })

  it('reports node progress while the run works', () => {
    expect(houdiniRunStateFrom(result({}), true)).toEqual({ state: 'running', done: 1, total: 3 })
  })

  it('calls a half-finished run dead once Houdini exits — the poll must not spin', () => {
    // The user closed the window (or it crashed) mid-batch: the result file
    // stays at "running" forever, so liveness is the only way out.
    expect(houdiniRunStateFrom(result({}), false)).toEqual({ state: 'dead' })
  })

  it('summarises a finished run', () => {
    const done = parseHoudiniResult(
      JSON.stringify({
        state: 'done',
        total: 3,
        done: 3,
        nodes: [
          { node: '/obj/a', status: 'ok' },
          { node: '/obj/b', status: 'ok' },
          { node: '/obj/c', status: 'skipped' },
        ],
      }),
    )!
    expect(houdiniRunStateFrom(done, true)).toEqual({
      state: 'finished',
      ok: 2,
      skipped: 1,
      failed: 0,
      summary: '2 exported, 1 skipped',
      error: '',
    })
  })

  it('finishes (not dies) when Houdini has already been closed after a done run', () => {
    // The export ended, the user quit Houdini, and only then does the poll come
    // round: the outcome is still a real outcome and must be reported.
    const done = parseHoudiniResult(
      JSON.stringify({ state: 'done', nodes: [{ node: '/obj/a', status: 'ok' }] }),
    )!
    expect(houdiniRunStateFrom(done, false).state).toBe('finished')
  })

  it('carries the run-level error of a failed run', () => {
    const failed = parseHoudiniResult(
      JSON.stringify({ state: 'failed', error: 'Traceback (most recent call last)…', nodes: [] }),
    )!
    expect(houdiniRunStateFrom(failed, true)).toMatchObject({
      state: 'finished',
      summary: '',
      error: 'Traceback (most recent call last)…',
    })
  })

  it('never reports a failed run without something to show', () => {
    const failed = parseHoudiniResult(JSON.stringify({ state: 'failed', nodes: [] }))!
    expect(houdiniRunStateFrom(failed, true)).toMatchObject({
      state: 'finished',
      error: 'the run failed in Houdini',
    })
  })
})
