import { describe, expect, it } from 'vitest'

import { characterSchema, type Character } from '@dth/rom'

import {
  EXPORTER_JOB_HEADER,
  characterJobScriptNames,
  executeSceneSignature,
  jobFileCsv,
  normalizeSceneKey,
  parseExecuteStamps,
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

describe('characterJobScriptNames', () => {
  it('is the one ROM script by default (it carries the export when set)', () => {
    expect(characterJobScriptNames(makeCharacter())).toEqual(['ROM_Electra_G9.dsa'])
    expect(
      characterJobScriptNames(makeCharacter({ exportPath: 'X:\\out', exportWithRomScript: true })),
    ).toEqual(['ROM_Electra_G9.dsa'])
  })

  it('appends the split Export script when the export is split off', () => {
    expect(
      characterJobScriptNames(makeCharacter({ exportPath: 'X:\\out', exportWithRomScript: false })),
    ).toEqual(['ROM_Electra_G9.dsa', 'Export_Electra_G9.dsa'])
  })

  it('ignores the split flag without an export directory', () => {
    expect(characterJobScriptNames(makeCharacter({ exportWithRomScript: false }))).toEqual([
      'ROM_Electra_G9.dsa',
    ])
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
