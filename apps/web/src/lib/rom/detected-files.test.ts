import { describe, expect, it } from 'vitest'

import {
  attributeToOwners,
  detectNewFiles,
  detectedIgnoreJson,
  parseDetectedIgnore,
} from './detected-files.ts'

// The rule that decides which files in a character folder are offered by the
// "new files found" banner/wizard. Everything here is subtraction: on disk,
// minus generated trees, minus what is already linked, minus what the user
// permanently skipped — all case-insensitive, because Windows paths are.

const CHAR = 'D:/DTH Projects/Demo/Kira'

function detect(relFiles: Array<string>, overrides: Partial<Parameters<typeof detectNewFiles>[0]> = {}) {
  return detectNewFiles({
    relFiles,
    charFolder: CHAR,
    linkedScenes: [],
    linkedHoudini: [],
    ignored: [],
    ...overrides,
  })
}

describe('detectNewFiles', () => {
  it('finds unlinked scenes and houdini projects anywhere in the folder', () => {
    const out = detect([
      'daz3d/beach/KiraBeach.duf',
      'stray.duf',
      'houdini/KiraExtra.hip',
      'somewhere/deep/proj.hipnc',
      'other/proj.HIPLC',
      'readme.txt',
      'daz3d/beach/KiraBeach.tip.png',
    ])
    expect(out.scenes).toEqual(['daz3d/beach/KiraBeach.duf', 'stray.duf'])
    expect(out.houdini).toEqual(['houdini/KiraExtra.hip', 'other/proj.HIPLC', 'somewhere/deep/proj.hipnc'])
  })

  it('excludes generated trees and ROM animations for scenes', () => {
    const out = detect([
      'daz3d/dth-exports/primary/export.duf',
      '.dcsmeta/whatever/thing.duf',
      'daz3d/rom-animations/Kira_ROM.duf',
      'daz3d/beach/KiraBeach_rom.DUF',
      'daz3d/beach/KiraBeach.duf',
    ])
    expect(out.scenes).toEqual(['daz3d/beach/KiraBeach.duf'])
  })

  it('excludes .dcsmeta and Houdini backup dirs for houdini projects', () => {
    const out = detect([
      'houdini/backup/Kira_bak1.hip',
      'deep/Backup/old.hiplc',
      '.dcsmeta/x/y.hip',
      'houdini/KiraExtra.hip',
    ])
    expect(out.houdini).toEqual(['houdini/KiraExtra.hip'])
  })

  it('subtracts linked paths case- and separator-insensitively', () => {
    const out = detect(['daz3d/KiraDefault.duf', 'daz3d/KiraBeach.duf', 'houdini/Kira.hip'], {
      linkedScenes: ['D:\\DTH Projects\\Demo\\Kira\\daz3d\\KIRADEFAULT.DUF'],
      linkedHoudini: ['d:/dth projects/demo/kira/houdini/kira.hip'],
    })
    expect(out.scenes).toEqual(['daz3d/KiraBeach.duf'])
    expect(out.houdini).toEqual([])
  })

  it('subtracts ignored relative paths case-insensitively', () => {
    const out = detect(['daz3d/KiraBeach.duf', 'houdini/KiraExtra.hip'], {
      ignored: ['DAZ3D/kirabeach.duf'],
    })
    expect(out.scenes).toEqual([])
    expect(out.houdini).toEqual(['houdini/KiraExtra.hip'])
  })

  it('sorts each list', () => {
    const out = detect(['b.duf', 'a.duf', 'z/b.hip', 'a/z.hip'])
    expect(out.scenes).toEqual(['a.duf', 'b.duf'])
    expect(out.houdini).toEqual(['a/z.hip', 'z/b.hip'])
  })
})

describe('detected-ignore store parsing', () => {
  it('round-trips through detectedIgnoreJson', () => {
    const json = detectedIgnoreJson(['daz3d/KiraBeach.duf', 'houdini/KiraExtra.hip'])
    expect(parseDetectedIgnore(json)).toEqual(['daz3d/KiraBeach.duf', 'houdini/KiraExtra.hip'])
  })

  it('tolerates garbage: bad JSON, wrong shape, non-string entries', () => {
    expect(parseDetectedIgnore('not json')).toEqual([])
    expect(parseDetectedIgnore('{"nope": 1}')).toEqual([])
    expect(parseDetectedIgnore('{"ignored": ["ok.duf", 5, null]}')).toEqual(['ok.duf'])
  })
})

describe('attributing a project-wide sweep to characters', () => {
  // The sweep walks the characters ROOT once — one native call instead of one
  // per character — so every hit arrives root-relative and has to be handed
  // back to an owner before the candidate rule can judge it.
  const OWNERS = [
    { id: 'kira', relFolder: 'Kira' },
    { id: 'ita', relFolder: 'Ita' },
  ]

  it('hands each file to the character whose folder it is under', () => {
    const byOwner = attributeToOwners(
      ['Kira/daz3d/Kira_Yoga.duf', 'Ita/houdini/Ita.hiplc', 'Kira/daz3d/primary/Kira.duf'],
      OWNERS,
    )
    expect(byOwner.get('kira')).toEqual(['daz3d/Kira_Yoga.duf', 'daz3d/primary/Kira.duf'])
    expect(byOwner.get('ita')).toEqual(['houdini/Ita.hiplc'])
  })

  it('gives a NESTED character its own files — longest folder wins', () => {
    // Nothing stops a character folder inside another; shortest-first matching
    // would let the outer one claim the inner one's scenes and offer them on
    // the wrong page.
    const nested = [...OWNERS, { id: 'young', relFolder: 'Kira/Variants/Kira Young' }]
    const byOwner = attributeToOwners(
      ['Kira/Variants/Kira Young/daz3d/Y.duf', 'Kira/daz3d/K.duf'],
      nested,
    )
    expect(byOwner.get('young')).toEqual(['daz3d/Y.duf'])
    expect(byOwner.get('kira')).toEqual(['daz3d/K.duf'])
  })

  it('drops a file that belongs to no character', () => {
    // The characters root can hold anything; "somewhere in the project" is not
    // something the wizard could offer to link.
    expect(attributeToOwners(['loose/Whatever.duf', 'AtTheRoot.duf'], OWNERS).size).toBe(0)
  })

  it('matches a folder by case and separator, like every other path compare', () => {
    const byOwner = attributeToOwners(['KIRA/daz3d/x.duf'], OWNERS)
    expect(byOwner.get('kira')).toEqual(['daz3d/x.duf'])
  })
})
