import { describe, expect, it } from 'vitest'

import { characterSchema, type Character } from '@dth/rom'

import {
  EXPORTER_JOB_FILE,
  RUNNING_JOB_FILE,
  executeSceneSignature,
  jobSceneForMode,
  jobScriptForMode,
  expectedSceneExportFolders,
  isReclaimableBatch,
  migratedExportFolder,
  jobFileJson,
  normalizeSceneKey,
  openSceneJobFileJson,
  parseExecuteStamps,
  parseExportFoldersRecord,
  parseJobFileJson,
  staleExportFolders,
} from './execute-jobs'

function makeCharacter(over: Partial<Character> = {}): Character {
  return characterSchema.parse({
    id: 'c1',
    name: 'Electra',
    genesis: 'G9',
    gender: 'female',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    scenePath: 'X:\\proj\\Electra\\daz3d\\Electra.duf',
    extraScenes: ['X:\\proj\\Electra\\daz3d\\Electra_Armor.duf'],
    ...over,
  })
}

const PRIMARY = 'X:\\proj\\Electra\\daz3d\\Electra.duf'
const EXTRA = 'X:\\proj\\Electra\\daz3d\\Electra_Armor.duf'

describe('the JSON job file (contract v2)', () => {
  it('the running file is the pending name with the running_ prefix', () => {
    expect(EXPORTER_JOB_FILE).toBe('dth_exporter_jobs.json')
    expect(RUNNING_JOB_FILE).toBe('running_dth_exporter_jobs.json')
  })

  it('jobFileJson: version/type/progress 0 + one pending row per job', () => {
    const text = jobFileJson([
      { scenePath: 'X:\\scenes\\A.duf', scriptPath: 'X:\\lib\\Scripts\\.Bulk_ROM_Export.dsa' },
      { scenePath: 'X:\\scenes\\B.duf', scriptPath: 'X:\\lib\\Scripts\\.Bulk_ROM_Export.dsa' },
    ])
    expect(text.endsWith('\n')).toBe(true)
    expect(JSON.parse(text)).toEqual({
      version: 1,
      type: 'bulk-export',
      progress: 0,
      jobs: [
        {
          scenePath: 'X:\\scenes\\A.duf',
          scriptPath: 'X:\\lib\\Scripts\\.Bulk_ROM_Export.dsa',
          status: 'pending',
        },
        {
          scenePath: 'X:\\scenes\\B.duf',
          scriptPath: 'X:\\lib\\Scripts\\.Bulk_ROM_Export.dsa',
          status: 'pending',
        },
      ],
    })
  })

  it('round-trips through parseJobFileJson', () => {
    const jobs = [{ scenePath: 'X:\\a.duf', scriptPath: 'X:\\s.dsa' }]
    const parsed = parseJobFileJson(jobFileJson(jobs))
    expect(parsed).toEqual({
      version: 1,
      type: 'bulk-export',
      progress: 0,
      jobs: [{ scenePath: 'X:\\a.duf', scriptPath: 'X:\\s.dsa', status: 'pending' }],
    })
  })

  it('parseJobFileJson reads Runner-updated progress + statuses + errors', () => {
    const parsed = parseJobFileJson(
      JSON.stringify({
        version: 1,
        type: 'bulk-export',
        progress: 50,
        jobs: [
          { scenePath: 'X:\\a.duf', scriptPath: 'X:\\s.dsa', status: 'done' },
          { scenePath: 'X:\\b.duf', scriptPath: 'X:\\s.dsa', status: 'failed', error: 'scene not found' },
        ],
      }),
    )
    expect(parsed?.progress).toBe(50)
    expect(parsed?.jobs[0].status).toBe('done')
    expect(parsed?.jobs[1]).toEqual({
      scenePath: 'X:\\b.duf',
      scriptPath: 'X:\\s.dsa',
      status: 'failed',
      error: 'scene not found',
    })
  })

  it('tolerates garbage: torn reads, foreign files, future versions → null', () => {
    expect(parseJobFileJson('')).toBeNull()
    expect(parseJobFileJson('{"version":1,"type":"bulk-export","progress":4')).toBeNull() // torn
    expect(parseJobFileJson('{"version":2,"jobs":[]}')).toBeNull()
    expect(parseJobFileJson('not json at all')).toBeNull()
    // Rows missing paths drop; unknown statuses read as pending; progress clamps.
    const parsed = parseJobFileJson(
      JSON.stringify({
        version: 1,
        progress: 250,
        jobs: [{ scenePath: 'X:\\a.duf', scriptPath: 'X:\\s.dsa', status: 'sideways' }, { nope: true }],
      }),
    )
    expect(parsed?.progress).toBe(100)
    expect(parsed?.jobs).toEqual([
      { scenePath: 'X:\\a.duf', scriptPath: 'X:\\s.dsa', status: 'pending' },
    ])
  })
})

// Contract v3 (docs/exporter-plugin-job-file.md): a one-row, script-less batch
// that just opens a scene in the ALREADY-RUNNING Daz and raises its window —
// the thing a forwarded command-line open can't do once a scene is loaded.
describe('open-scene jobs', () => {
  it('openSceneJobFileJson: one row, the type, and no script to run', () => {
    const parsed = JSON.parse(openSceneJobFileJson('X:\\scenes\\Ita.duf')) as unknown
    expect(parsed).toEqual({
      version: 1,
      type: 'open-scene',
      progress: 0,
      jobs: [{ scenePath: 'X:\\scenes\\Ita.duf', scriptPath: '', status: 'pending' }],
    })
  })

  it('round-trips its type instead of collapsing to bulk-export', () => {
    // Regression: the parser used to hard-code `type: 'bulk-export'`, so the
    // studio could not tell its own scene handoff from an export batch.
    expect(parseJobFileJson(openSceneJobFileJson('X:\\a.duf'))?.type).toBe('open-scene')
    expect(parseJobFileJson(jobFileJson([{ scenePath: 'X:\\a.duf', scriptPath: 'X:\\s.dsa' }]))?.type).toBe(
      'bulk-export',
    )
  })

  it('keeps a script-less row (it is legal for this type)', () => {
    // The Runner rewrites the file with statuses as it works; reading that back
    // must not drop the very row the batch is about.
    const parsed = parseJobFileJson(
      JSON.stringify({
        version: 1,
        type: 'open-scene',
        progress: 100,
        jobs: [{ scenePath: 'X:\\a.duf', status: 'done' }],
      }),
    )
    expect(parsed?.jobs).toEqual([{ scenePath: 'X:\\a.duf', scriptPath: '', status: 'done' }])
  })

  it('an ABSENT type still reads as bulk-export, matching the Runner parser', () => {
    expect(
      parseJobFileJson(JSON.stringify({ version: 1, progress: 0, jobs: [] }))?.type,
    ).toBe('bulk-export')
  })

  it('an UNKNOWN type is foreign → null', () => {
    // This is load-bearing for the fallback: an old Runner treats an unknown
    // type as foreign and never renames the file, and the studio must read a
    // future type the same way rather than acting on it.
    expect(parseJobFileJson(JSON.stringify({ version: 1, type: 'teleport', jobs: [] }))).toBeNull()
  })
})

describe('isReclaimableBatch — a batch a CLOSING Daz claimed but never ran', () => {
  const batch = (over: Record<string, unknown>) =>
    parseJobFileJson(
      JSON.stringify({
        version: 1,
        type: 'bulk-export',
        progress: 0,
        jobs: [
          { scenePath: 'X:\\a.duf', scriptPath: 'X:\\s.dsa', status: 'pending' },
          { scenePath: 'X:\\b.duf', scriptPath: 'X:\\s.dsa', status: 'pending' },
        ],
        ...over,
      }),
    )

  it('reclaims an untouched batch — the whole point of the rescue', () => {
    // The Runner renames the file to claim it and then Daz exits; nothing polls
    // for the renamed name, so without this the batch is orphaned forever.
    expect(isReclaimableBatch(batch({}))).toBe(true)
  })

  it('refuses one that already ran a row — re-running costs a ROM build each', () => {
    expect(
      isReclaimableBatch(
        batch({
          jobs: [
            { scenePath: 'X:\\a.duf', scriptPath: 'X:\\s.dsa', status: 'done' },
            { scenePath: 'X:\\b.duf', scriptPath: 'X:\\s.dsa', status: 'pending' },
          ],
        }),
      ),
    ).toBe(false)
    // …including the row that was mid-flight when Daz died.
    expect(
      isReclaimableBatch(
        batch({ jobs: [{ scenePath: 'X:\\a.duf', scriptPath: 'X:\\s.dsa', status: 'running' }] }),
      ),
    ).toBe(false)
  })

  it('refuses one with progress on the clock', () => {
    expect(isReclaimableBatch(batch({ progress: 50 }))).toBe(false)
  })

  it('refuses a torn or foreign read outright', () => {
    expect(isReclaimableBatch(null)).toBe(false)
  })

  it('refuses a non-export TYPE — an orphaned open-scene handoff is no batch to requeue', () => {
    // parseJobFileJson happily returns an open-scene file; requeueing it as
    // pending would make the next Daz start yank a scene open out of nowhere.
    const openScene = batch({
      type: 'open-scene',
      jobs: [{ scenePath: 'X:\\a.duf', status: 'pending' }],
    })
    expect(openScene?.type).toBe('open-scene') // the parse itself is fine
    expect(isReclaimableBatch(openScene)).toBe(false)
  })
})

describe('job rows per export mode — which hidden script, on which scene file', () => {
  it('each mode runs its own hidden script (the visible toggles never matter)', () => {
    expect(jobScriptForMode('rom-export')).toBe('.Bulk_ROM_Export.dsa')
    expect(jobScriptForMode('rom-only')).toBe('.Build_ROM_Animation.dsa')
    expect(jobScriptForMode('export-only')).toBe('.Bulk_Export_Only.dsa')
  })

  it('export-only opens the SAVED ROM animation, the other modes the scene itself', () => {
    const scene = 'X:\\proj\\Electra\\daz3d\\primary\\Electra.duf'
    expect(jobSceneForMode('rom-export', scene)).toBe(scene)
    expect(jobSceneForMode('rom-only', scene)).toBe(scene)
    expect(jobSceneForMode('export-only', scene)).toBe(
      'X:/proj/Electra/daz3d/primary/rom-animations/Electra_ROM.duf',
    )
  })
})

describe('export-folder housekeeping (the record + the delete set)', () => {
  const layoutChar = (over: Partial<Character> = {}) =>
    makeCharacter({
      scenePath: 'X:\\proj\\Electra\\daz3d\\primary\\Electra.duf',
      extraScenes: ['X:\\proj\\Electra\\daz3d\\armor\\Electra_Armor.duf'],
      ...over,
    })

  it('expectedSceneExportFolders: flat layout = the scene subfolders', () => {
    expect(expectedSceneExportFolders(layoutChar(), 'X:/proj/Electra/daz3d')).toEqual([
      'primary',
      'armor',
    ])
  })

  it('migratedExportFolder: the v27 <project>/dth-export/ nesting is stripped, nesting kept', () => {
    // The v27 layout → the scene subfolder it always ended in.
    expect(migratedExportFolder('MyProj_Electra/dth-export/primary')).toBe('primary')
    // A NESTED scene subfolder survives whole — it names the export files.
    expect(migratedExportFolder('MyProj_Electra/dth-export/outfits/armor')).toBe('outfits/armor')
    // Already flat (pre-v27 / no project folder): unchanged.
    expect(migratedExportFolder('primary')).toBe('primary')
    expect(migratedExportFolder('outfits/armor')).toBe('outfits/armor')
    // A scene subfolder that merely CONTAINS the word is not a prefix match.
    expect(migratedExportFolder('dth-export-backup')).toBe('dth-export-backup')
  })

  it('staleExportFolders: the layout change delete set — recorded minus expected', () => {
    const recorded = {
      version: 1 as const,
      exportDir: 'X:/exports/electra',
      folders: ['primary', 'armor'],
    }
    // A renamed scene subfolder leaves the old export folders stale.
    expect(staleExportFolders(recorded, 'X:\\exports\\electra\\', ['suit', 'gown'])).toEqual([
      'primary',
      'armor',
    ])
    // Same layout → nothing to delete (case-insensitive match).
    expect(staleExportFolders(recorded, 'X:/exports/electra', ['Primary', 'ARMOR'])).toEqual([])
  })

  it('staleExportFolders: a changed export dir disables deletion entirely', () => {
    const recorded = { version: 1 as const, exportDir: 'X:/old/place', folders: ['primary'] }
    expect(staleExportFolders(recorded, 'X:/new/place', [])).toEqual([])
  })

  it('staleExportFolders: never deletes escapes, absolutes, or parents of kept folders', () => {
    const recorded = {
      version: 1 as const,
      exportDir: 'X:/exports/electra',
      folders: [
        '../outside', // escape
        'C:/windows', // absolute/drive
        '/root', // absolute
        'a/../b', // dot-dot segment
        '', // empty
        'MyProj', // PARENT of a kept folder — deleting it would kill the export
        'gone',
      ],
    }
    expect(
      staleExportFolders(recorded, 'X:/exports/electra', ['MyProj/dth-export/primary']),
    ).toEqual(['gone'])
  })

  it('parseExportFoldersRecord: tolerates garbage, keeps only string entries', () => {
    expect(parseExportFoldersRecord('not json')).toBeNull()
    expect(parseExportFoldersRecord('{"version":2,"exportDir":"x","folders":[]}')).toBeNull()
    expect(
      parseExportFoldersRecord(
        '{"version":1,"exportDir":"X:/e","folders":["a",42,null,"b/c"]}',
      ),
    ).toEqual({ version: 1, exportDir: 'X:/e', folders: ['a', 'b/c'] })
  })
})

describe('executeSceneSignature', () => {
  it('is stable for the same definition', () => {
    expect(executeSceneSignature(makeCharacter(), PRIMARY)).toBe(
      executeSceneSignature(makeCharacter(), PRIMARY),
    )
  })

  it('changes for EVERY scene when a base generation field changes', () => {
    const a = makeCharacter()
    const b = makeCharacter({ flexionStrength: 0.5 })
    expect(executeSceneSignature(b, PRIMARY)).not.toBe(executeSceneSignature(a, PRIMARY))
    expect(executeSceneSignature(b, EXTRA)).not.toBe(executeSceneSignature(a, EXTRA))
  })

  it('ignores cosmetic/provenance fields (image, updatedAt, studio/schema versions)', () => {
    const a = makeCharacter()
    const b = makeCharacter({
      image: 'portrait.png',
      updatedAt: '2026-07-29T12:00:00.000Z',
      studioVersion: '9.9.9',
      generatedDthVersion: '2.4.3',
    })
    expect(executeSceneSignature(b, PRIMARY)).toBe(executeSceneSignature(a, PRIMARY))
    expect(executeSceneSignature(b, EXTRA)).toBe(executeSceneSignature(a, EXTRA))
  })

  it("an override record changes only ITS scene's signature", () => {
    const a = makeCharacter()
    const b = makeCharacter({
      sceneOverrides: [{ scenePath: EXTRA, hair: [{ nodeLabel: 'Long Hair' }] }],
    } as Partial<Character>)
    expect(executeSceneSignature(b, EXTRA)).not.toBe(executeSceneSignature(a, EXTRA))
    expect(executeSceneSignature(b, PRIMARY)).toBe(executeSceneSignature(a, PRIMARY))
  })

  it('matches override records separator/case-insensitively (normalizeSceneKey)', () => {
    const c = makeCharacter({
      sceneOverrides: [{ scenePath: EXTRA, hair: [{ nodeLabel: 'Long Hair' }] }],
    } as Partial<Character>)
    const forwardSlashUpper = EXTRA.replace(/\\/g, '/').toUpperCase()
    expect(normalizeSceneKey(forwardSlashUpper)).toBe(normalizeSceneKey(EXTRA))
    expect(executeSceneSignature(c, forwardSlashUpper)).toBe(executeSceneSignature(c, EXTRA))
  })
})

describe('parseExecuteStamps', () => {
  it('round-trips a valid stamps file', () => {
    const stamps = {
      version: 1 as const,
      scenes: {
        [normalizeSceneKey(PRIMARY)]: { mtimeMs: 123, size: 456, signature: 'abc' },
      },
    }
    expect(parseExecuteStamps(JSON.stringify(stamps))).toEqual(stamps)
  })

  it('degrades garbage / wrong shapes to empty stamps (first-run behaviour)', () => {
    expect(parseExecuteStamps('not json').scenes).toEqual({})
    expect(parseExecuteStamps('{"version":2,"scenes":{}}').scenes).toEqual({})
    expect(
      parseExecuteStamps('{"version":1,"scenes":{"a":{"mtimeMs":"nope"}}}').scenes,
    ).toEqual({})
  })
})
