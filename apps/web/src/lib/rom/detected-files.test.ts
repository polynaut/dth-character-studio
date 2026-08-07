import { describe, expect, it } from 'vitest'

import { detectNewFiles, detectedIgnoreJson, parseDetectedIgnore } from './detected-files.ts'

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
