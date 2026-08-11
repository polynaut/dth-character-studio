import { describe, expect, it } from 'vitest'

import { characterSchema } from '@dth/rom'

import {
  buildHoudiniJob,
  buildHoudiniPrefill,
  houdiniResultSummary,
  houdiniRunFilesToClear,
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
    exportPath: 'X:\\p\\Kira\\houdini\\daz-export',
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
      'X:/p/Kira/houdini/daz-export/primary/Kira.dth',
    )
    // An extra scene carries its subfolder in the name, exactly like the files
    // the exporter writes beside it.
    expect(sceneDthPath(kira(), EXTRA, ROOT)).toBe(
      'X:/p/Kira/houdini/daz-export/summertide/Kira_Summertide.dth',
    )
  })

  it('resolves a RAW stored scene path, not only a normalized key', () => {
    // The regression that made "Export too" fail on every real run: the folder
    // map is keyed lowercase, but the export dialog passes the character's
    // stored paths verbatim — and every Windows path has a capital in it, so
    // the lookup missed, the job came out with zero scenes, and the run died on
    // "none of these scenes has an export path".
    expect(sceneDthPath(kira(), 'X:\\p\\Kira\\daz3d\\primary\\Kira.duf', ROOT)).toBe(
      'X:/p/Kira/houdini/daz-export/primary/Kira.dth',
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
      { dth: 'X:/p/Kira/houdini/daz-export/primary/Kira.dth', label: 'Kira' },
      { dth: 'X:/p/Kira/houdini/daz-export/summertide/Kira_Summertide.dth', label: 'KiraSummertide' },
    ])
    // Paths travel forward-slashed — Houdini's own convention, and what the
    // node parms hold.
    expect(job.resultPath).toBe('X:/p/Kira/.dth_houdini_result.json')
    expect(job.exportDirectory).toBe('X:/unreal/Kira')
  })

  it('accepts the raw stored paths the export dialog actually passes', () => {
    const job = buildHoudiniJob(
      kira(),
      ['X:\\p\\Kira\\daz3d\\primary\\Kira.duf', 'X:\\p\\Kira\\daz3d\\summertide\\KiraSummertide.duf'],
      { resultPath: 'r.json', scenesRootAbs: ROOT },
    )
    expect(job.scenes).toEqual([
      { dth: 'X:/p/Kira/houdini/daz-export/primary/Kira.dth', label: 'Kira' },
      { dth: 'X:/p/Kira/houdini/daz-export/summertide/Kira_Summertide.dth', label: 'KiraSummertide' },
    ])
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

  it('prefill: primary-scene paths ride the $JOB prefix, export directory keeps its slash', () => {
    const prefill = buildHoudiniPrefill(kira(), {
      hipRefPrefix: '$JOB/houdini/daz-export',
      scenesRootAbs: ROOT,
      finalExportDir: '$JOB/export',
    })
    expect(prefill).toEqual({
      characterName: 'Kira',
      // G9 with no explicit preset pick assumes the DTH-recommended DQS —
      // which the Import node's menu spells 'dualquat'.
      skinning: 'dualquat',
      csv: '$JOB/houdini/daz-export/primary/Kira_pose_asset.csv',
      dth: '$JOB/houdini/daz-export/primary/Kira.dth',
      fbx: '$JOB/houdini/daz-export/primary/Kira.fbx',
      abc: '$JOB/houdini/daz-export/primary/Kira.abc',
      romFbx: '$JOB/houdini/daz-export/primary/Kira_experimental_rom.fbx',
      // Houdini WRITES here, so it is the character's own export/ folder — NOT
      // the daz-export the imports above read. The HDA concatenates
      // export_directory + character_name, so the trailing slash is
      // load-bearing (456.py's measured facts).
      exportDirectory: '$JOB/export/',
    })
  })

  it('prefill: an empty prefix (absolute style) uses the folders verbatim', () => {
    const prefill = buildHoudiniPrefill(kira(), {
      hipRefPrefix: '',
      scenesRootAbs: ROOT,
      finalExportDir: 'X:/p/Kira/export',
    })
    expect(prefill.dth).toBe('X:/p/Kira/houdini/daz-export/primary/Kira.dth')
    expect(prefill.exportDirectory).toBe('X:/p/Kira/export/')
  })

  it('prefill: the chosen scene decides which export set the imports point at', () => {
    // The Generate dialog's scene picker. Every scene exports into its own
    // subfolder under a name carrying that scene, so this is the whole
    // difference between a project wired to the outfit and one wired to the
    // primary — five paths, and no way to fix it but by hand.
    const prefill = buildHoudiniPrefill(kira(), {
      hipRefPrefix: '$JOB/houdini/daz-export',
      scenesRootAbs: ROOT,
      // The RAW stored value, backslashes and all — the dialog passes whatever
      // `extraScenes` holds, and matching normalizes separators + case itself.
      scenePath: 'X:\\p\\Kira\\daz3d\\summertide\\KiraSummertide.duf',
      finalExportDir: '$JOB/export',
    })
    expect(prefill.dth).toBe('$JOB/houdini/daz-export/summertide/Kira_Summertide.dth')
    expect(prefill.csv).toBe(
      '$JOB/houdini/daz-export/summertide/Kira_Summertide_pose_asset.csv',
    )
    // One export folder per CHARACTER, not per scene — Houdini's output for
    // every variant collects in the same place.
    expect(prefill.exportDirectory).toBe('$JOB/export/')
  })

  it('prefill: a scene this character does not link falls back to the primary', () => {
    // Never silently wire a path from a scene the character has nothing to do
    // with: a stale pick (the scene was unlinked meanwhile) must degrade to the
    // one scene every character has.
    const prefill = buildHoudiniPrefill(kira(), {
      hipRefPrefix: '$JOB/houdini/daz-export',
      scenesRootAbs: ROOT,
      scenePath: 'X:/somewhere/else/Foreign.duf',
      finalExportDir: '$JOB/export',
    })
    expect(prefill.dth).toBe('$JOB/houdini/daz-export/primary/Kira.dth')
  })

  it('prefill: no export directory still fills name + skinning, paths stay empty', () => {
    const prefill = buildHoudiniPrefill(kira({ exportPath: '' }), {
      hipRefPrefix: '$JOB/houdini/daz-export',
      scenesRootAbs: ROOT,
    })
    expect(prefill.characterName).toBe('Kira')
    expect(prefill.skinning).toBe('dualquat')
    expect(prefill.csv).toBe('')
    expect(prefill.exportDirectory).toBe('')
  })

  it('prefill: a Linear-only generation maps to the linear menu token', () => {
    // G8 ships no DQS ROM, so the auto-selected skinning is Linear.
    const prefill = buildHoudiniPrefill(kira({ genesis: 'G8' }), {
      hipRefPrefix: '$JOB/houdini/daz-export',
      scenesRootAbs: ROOT,
    })
    expect(prefill.skinning).toBe('linear')
  })

  it('carries closeWhenDone when asked, and defaults it to false', () => {
    // The DTH Export flow always sets it — its Houdini instance exists to
    // carry the batch, and 456.py closes it again after the final result.
    const closing = buildHoudiniJob(kira(), [PRIMARY], {
      resultPath: 'r.json',
      scenesRootAbs: ROOT,
      closeWhenDone: true,
    })
    expect(closing.closeWhenDone).toBe(true)
    const plain = buildHoudiniJob(kira(), [PRIMARY], { resultPath: 'r.json', scenesRootAbs: ROOT })
    expect(plain.closeWhenDone).toBe(false)
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

  it('carries the live mid-node activity — only when it has something to say', () => {
    // 456.py streams the HDA's own output (stdout/status bar) into the result
    // while a node's synchronous do_export runs — the studio's only window
    // into the minutes-long call.
    const withActivity = result({
      activity: {
        node: '/obj/DazToHue1/export',
        scene: 'KiraDefault',
        lines: ['Baking textures…', 'Exporting FBX…'],
        updatedAtMs: 123,
      },
    })
    expect(houdiniRunStateFrom(withActivity, true)).toEqual({
      state: 'running',
      done: 1,
      total: 3,
      activity: {
        node: '/obj/DazToHue1/export',
        scene: 'KiraDefault',
        lines: ['Baking textures…', 'Exporting FBX…'],
        updatedAtMs: 123,
      },
    })
    // An EMPTY channel is dropped — the UI must not clear its last-activity
    // line between nodes for nothing.
    const emptyActivity = result({ activity: { node: '/obj/x', scene: '', lines: [] } })
    expect(houdiniRunStateFrom(emptyActivity, true)).toEqual({ state: 'running', done: 1, total: 3 })
  })

  it('keeps a node’s captured log tail on its report entry', () => {
    const done = parseHoudiniResult(
      JSON.stringify({
        state: 'done',
        total: 1,
        done: 1,
        nodes: [{ node: '/obj/a', status: 'ok', log: ['line one', 'line two'] }],
      }),
    )!
    expect(done.nodes[0].log).toEqual(['line one', 'line two'])
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
      problems: [],
    })
  })

  it('carries the auto-answered HDA problems out, labelled by scene', () => {
    // 456.py answers the HDA's "Continue anyway?" with Yes, so the run state is
    // the ONLY place those warnings can still be seen — the result file that
    // held them is deleted the moment the run is reported.
    const done = parseHoudiniResult(
      JSON.stringify({
        state: 'done',
        nodes: [
          {
            node: '/obj/DazToHue1/export',
            scene: 'Kira',
            status: 'ok',
            problems: ['No pose asset CSV found', 'Bone scale reference missing'],
          },
          // No scene label (a network the job matched by path only) — the node
          // path stands in, never an unlabelled bare problem string.
          { node: '/obj/DazToHue2/export', status: 'ok', problems: ['Missing groom'] },
        ],
      }),
    )!
    expect(houdiniRunStateFrom(done, true)).toMatchObject({
      problems: [
        'Kira: No pose asset CSV found',
        'Kira: Bone scale reference missing',
        '/obj/DazToHue2/export: Missing groom',
      ],
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

describe('houdiniRunFilesToClear — the handoff cleans up after itself', () => {
  const paths = { jobPath: 'X:/p/Kira/.dth_houdini_job.json', resultPath: 'X:/p/Kira/.dth_houdini_result.json' }

  it('clears nothing while the run is still going', () => {
    expect(houdiniRunFilesToClear({ state: 'starting', hasResult: false, ...paths })).toEqual([])
    expect(houdiniRunFilesToClear({ state: 'running', hasResult: true, ...paths })).toEqual([])
  })

  it('clears both files once the run has finished', () => {
    // The leftovers this fixes: neither file was ever deleted, so every
    // character that had run an export kept a job + result pair for good.
    expect(houdiniRunFilesToClear({ state: 'finished', hasResult: true, ...paths })).toEqual([
      paths.resultPath,
      paths.jobPath,
    ])
  })

  it('clears both when a started run died half-way', () => {
    expect(houdiniRunFilesToClear({ state: 'dead', hasResult: true, ...paths })).toEqual([
      paths.resultPath,
      paths.jobPath,
    ])
  })

  it('keeps the job of a run that never wrote a result', () => {
    // "dead" without a result can be a Houdini that just hasn't shown up in the
    // process list yet — deleting the job it is about to read would break it.
    // The next run overwrites it anyway, so leaving it costs nothing.
    expect(houdiniRunFilesToClear({ state: 'dead', hasResult: false, ...paths })).toEqual([])
  })
})
