import { describe, expect, it } from 'vitest'

import { characterSchema, type Character } from '@dth/rom'

import {
  EXPORTER_JOB_HEADER,
  characterJobScriptNames,
  executeSceneSignature,
  expectedSceneCsvRel,
  expectedSceneExportFolders,
  jobFileCsv,
  normalizeSceneKey,
  parseExecuteStamps,
  parseExportFoldersRecord,
  parseJobFileCsv,
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

describe('jobFileCsv', () => {
  it('writes the header plus one row per job, LF-terminated', () => {
    const csv = jobFileCsv([
      { scenePath: 'X:\\scenes\\A.duf', scriptPath: 'X:\\lib\\Scripts\\ROM_A.dsa' },
      { scenePath: 'X:\\scenes\\B.duf', scriptPath: 'X:\\lib\\Scripts\\ROM_B.dsa' },
    ])
    expect(csv).toBe(
      `${EXPORTER_JOB_HEADER}\n` +
        'X:\\scenes\\A.duf,X:\\lib\\Scripts\\ROM_A.dsa\n' +
        'X:\\scenes\\B.duf,X:\\lib\\Scripts\\ROM_B.dsa\n',
    )
  })

  it('quotes fields containing commas or quotes (RFC 4180)', () => {
    const csv = jobFileCsv([
      { scenePath: 'X:\\my, scenes\\A.duf', scriptPath: 'X:\\lib\\"quoted".dsa' },
    ])
    expect(csv.split('\n')[1]).toBe('"X:\\my, scenes\\A.duf","X:\\lib\\""quoted"".dsa"')
  })
})

describe('characterJobScriptNames — every job row runs the hidden bulk script', () => {
  it('is always .Bulk_ROM_Export.dsa — the toggles only govern the visible scripts', () => {
    expect(characterJobScriptNames(makeCharacter())).toEqual(['.Bulk_ROM_Export.dsa'])
    expect(
      characterJobScriptNames(makeCharacter({ exportPath: 'X:\\out', exportWithRomScript: true })),
    ).toEqual(['.Bulk_ROM_Export.dsa'])
    // Even with the export split off: the bulk script always builds + exports
    // everything itself — no Export_ row needed.
    expect(
      characterJobScriptNames(makeCharacter({ exportPath: 'X:\\out', exportWithRomScript: false })),
    ).toEqual(['.Bulk_ROM_Export.dsa'])
  })
})

describe('expectedSceneCsvRel — where the export watch looks for delivered CSVs', () => {
  it('maps every linked scene to <its subfolder>/<base csv> under the scenes root', () => {
    const c = makeCharacter({
      scenePath: 'X:\\proj\\Electra\\daz3d\\primary\\Electra.duf',
      extraScenes: ['X:\\proj\\Electra\\daz3d\\armor\\Electra_Armor.duf'],
    })
    const map = expectedSceneCsvRel(c, 'X:/proj/Electra/daz3d')
    expect(map[normalizeSceneKey(c.scenePath)]).toBe('primary/Electra_pose_asset.csv')
    expect(map[normalizeSceneKey(c.extraScenes[0])]).toBe('armor/Electra_pose_asset.csv')
  })

  it('falls back to the scene-file stem without a scenes root (the runtime fallback)', () => {
    const map = expectedSceneCsvRel(makeCharacter())
    expect(map[normalizeSceneKey(PRIMARY)]).toBe('Electra/Electra_pose_asset.csv')
    expect(map[normalizeSceneKey(EXTRA)]).toBe('Electra_Armor/Electra_pose_asset.csv')
  })

  it('prefixes <project>/dth-export/ when a Houdini project folder resolves (schema v27)', () => {
    const c = makeCharacter({
      scenePath: 'X:\\proj\\Electra\\daz3d\\primary\\Electra.duf',
      extraScenes: [
        'X:\\proj\\Electra\\daz3d\\armor\\Electra_Armor.duf',
        'X:\\proj\\Electra\\daz3d\\beach\\Electra_Beach.duf',
      ],
      houdiniProjectFolder: 'MyProj_Electra',
      sceneOverrides: [
        // Overridden to '' — this scene delivers flat, exactly like pre-v27.
        {
          scenePath: 'X:\\proj\\Electra\\daz3d\\beach\\Electra_Beach.duf',
          houdiniProjectFolder: '',
        },
      ],
    } as Partial<Character>)
    const map = expectedSceneCsvRel(c, 'X:/proj/Electra/daz3d')
    expect(map[normalizeSceneKey(c.scenePath)]).toBe(
      'MyProj_Electra/dth-export/primary/Electra_pose_asset.csv',
    )
    expect(map[normalizeSceneKey(c.extraScenes[0])]).toBe(
      'MyProj_Electra/dth-export/armor/Electra_pose_asset.csv',
    )
    expect(map[normalizeSceneKey(c.extraScenes[1])]).toBe('beach/Electra_pose_asset.csv')
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

  it('expectedSceneExportFolders: project layout nests under <proj>/dth-export, deduped', () => {
    const c = layoutChar({
      houdiniProjectFolder: 'MyProj_Electra',
      sceneOverrides: [
        {
          scenePath: 'X:\\proj\\Electra\\daz3d\\armor\\Electra_Armor.duf',
          houdiniProjectFolder: '',
        },
      ],
    } as Partial<Character>)
    expect(expectedSceneExportFolders(c, 'X:/proj/Electra/daz3d')).toEqual([
      'MyProj_Electra/dth-export/primary',
      'armor',
    ])
  })

  it('staleExportFolders: the layout change delete set — recorded minus expected', () => {
    const recorded = {
      version: 1 as const,
      exportDir: 'X:/exports/electra',
      folders: ['primary', 'armor'],
    }
    // Moved into a project folder: the old flat scene folders are stale.
    expect(
      staleExportFolders(recorded, 'X:\\exports\\electra\\', [
        'MyProj_Electra/dth-export/primary',
        'MyProj_Electra/dth-export/armor',
      ]),
    ).toEqual(['primary', 'armor'])
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

describe('parseJobFileCsv', () => {
  it('round-trips jobFileCsv output, including quoted fields', () => {
    const jobs = [
      { scenePath: 'X:\\scenes\\A.duf', scriptPath: 'X:\\lib\\ROM_A.dsa' },
      { scenePath: 'X:\\my, scenes\\B.duf', scriptPath: 'X:\\lib\\"quoted".dsa' },
    ]
    expect(parseJobFileCsv(jobFileCsv(jobs))).toEqual(jobs)
  })

  it('accepts CRLF line endings and ignores extra columns', () => {
    const text = `${EXPORTER_JOB_HEADER},future-column\r\nX:\\a.duf,X:\\a.dsa,ignored\r\n`
    expect(parseJobFileCsv(text)).toEqual([{ scenePath: 'X:\\a.duf', scriptPath: 'X:\\a.dsa' }])
  })

  it('skips blank/short rows and yields nothing for an empty file', () => {
    expect(parseJobFileCsv('')).toEqual([])
    expect(parseJobFileCsv(`${EXPORTER_JOB_HEADER}\n\nonly-one-field\n`)).toEqual([])
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
