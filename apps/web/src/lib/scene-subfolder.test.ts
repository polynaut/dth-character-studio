import { describe, expect, it } from 'vitest'

import {
  deriveScenesRootRel,
  hipAnchorDirs,
  sceneSubfolderConflict,
  suggestSceneSubfolder,
} from './scene-subfolder'

describe('suggestSceneSubfolder', () => {
  it('drops the character name and generation markers, keeps the identity', () => {
    expect(suggestSceneSubfolder('X:\\scenes\\Electra_G9_Beach Armor.duf', 'Electra')).toBe(
      'Beach_Armor',
    )
    expect(suggestSceneSubfolder('X:\\scenes\\Kira_Genesis8.1_Casual.duf', 'Kira')).toBe('Casual')
    expect(suggestSceneSubfolder('X:\\scenes\\genesis9_armor.duf', 'Electra')).toBe('armor')
  })

  it('drops the DTH noise words (gen, golden palace, dicktator, dqs, gp/dk)', () => {
    expect(suggestSceneSubfolder('X:\\s\\Ita_G9_GoldenPalace_Beach.duf', 'Ita')).toBe('Beach')
    expect(suggestSceneSubfolder('X:\\s\\Rok_DQS_Dicktator_Gym.duf', 'Rok')).toBe('Gym')
    expect(suggestSceneSubfolder('X:\\s\\Ita_gen_gp_dk_Party.duf', 'Ita')).toBe('Party')
  })

  it('matches the character name case-insensitively and mid-word (squeezed variants)', () => {
    expect(suggestSceneSubfolder('X:\\s\\electraG9Armor.duf', 'Electra')).toBe('Armor')
  })

  it('never returns empty — a scene named purely after the character falls back', () => {
    expect(suggestSceneSubfolder('X:\\s\\Electra_G9.duf', 'Electra')).toBe('scene')
    expect(suggestSceneSubfolder('', 'Electra')).toBe('scene')
  })

  it('strips filesystem-illegal characters', () => {
    expect(suggestSceneSubfolder('X:\\s\\What_Is: This?.duf', 'Y')).toBe('What_Is_This')
  })
})

describe('deriveScenesRootRel', () => {
  it('uses the project dazSubdir prefix when the primary sits under it', () => {
    expect(deriveScenesRootRel('daz3d/primary', 'daz3d')).toBe('daz3d')
    expect(deriveScenesRootRel('daz3d', 'daz3d')).toBe('daz3d') // legacy: primary in the root
    expect(deriveScenesRootRel('DAZ3D/primary', 'daz3d')).toBe('DAZ3D') // case survives
  })

  it('strips a trailing "primary" segment for a renamed root', () => {
    expect(deriveScenesRootRel('scenes/primary', 'daz3d')).toBe('scenes')
    expect(deriveScenesRootRel('scenes/PRIMARY', 'daz3d')).toBe('scenes')
  })

  it('falls back to the primary dir itself (legacy custom root)', () => {
    expect(deriveScenesRootRel('scenes', 'daz3d')).toBe('scenes')
    expect(deriveScenesRootRel('', 'daz3d')).toBe('')
  })
})

describe('hipAnchorDirs — where $HIP-relative reference paths can anchor', () => {
  it('returns the distinct folders of linked .hips INSIDE the character folder', () => {
    expect(
      hipAnchorDirs(
        [
          'D:/lib/Electra/houdini/Electra.hiplc',
          'D:\\lib\\Electra\\houdini\\Electra_v2.hiplc', // same folder, backslashes
          'D:/lib/Electra/archive/Old.hip', // hand-linked, still inside → anchors too
        ],
        'D:\\lib\\Electra',
      ),
    ).toEqual(['D:/lib/Electra/houdini', 'D:/lib/Electra/archive'])
  })

  it('a project linked OUTSIDE the character folder never anchors — the studio puts no junction in a tree it does not own', () => {
    expect(hipAnchorDirs(['E:/elsewhere/Electra.hip'], 'D:/lib/Electra')).toEqual([])
    // A sibling folder sharing the prefix as a STRING is still outside.
    expect(hipAnchorDirs(['D:/lib/Electra2/Electra.hip'], 'D:/lib/Electra')).toEqual([])
  })

  it('dedupes case-insensitively (Windows paths)', () => {
    expect(
      hipAnchorDirs(
        ['D:/lib/Electra/houdini/A.hiplc', 'd:/lib/electra/HOUDINI/B.hiplc'],
        'D:/lib/Electra',
      ),
    ).toEqual(['D:/lib/Electra/houdini'])
  })

  it('a .hip directly in the character folder anchors the folder itself', () => {
    expect(hipAnchorDirs(['D:/lib/Electra/Electra.hip'], 'D:/lib/Electra/')).toEqual([
      'D:/lib/Electra',
    ])
  })

  it('no projects / no folder → nothing anchors', () => {
    expect(hipAnchorDirs([], 'D:/lib/Electra')).toEqual([])
    expect(hipAnchorDirs(['D:/lib/Electra/houdini/A.hiplc'], '')).toEqual([])
  })
})

describe('sceneSubfolderConflict — names the studio already owns', () => {
  it('refuses the export folder, whatever its casing', () => {
    // <char>/<dazSubdir>/dth-exports sits at exactly the level scene
    // subfolders do, so a scene moved there would fight the export root.
    expect(sceneSubfolderConflict('dth-exports')).toContain('exports')
    expect(sceneSubfolderConflict('DTH-Exports')).toContain('exports')
  })

  it('allows an ordinary name', () => {
    expect(sceneSubfolderConflict('summertide')).toBe('')
    expect(sceneSubfolderConflict('primary')).toBe('')
    // Only a WHOLE segment is reserved — a longer name merely containing it is fine.
    expect(sceneSubfolderConflict('dth-exports-old')).toBe('')
  })

  it('judges the FIRST segment — the one landing under the scenes root', () => {
    expect(sceneSubfolderConflict('dth-exports/beach')).toContain('exports')
    // Nested deeper, it collides with nothing the studio writes.
    expect(sceneSubfolderConflict('outfits/dth-exports')).toBe('')
  })

  it('ignores leading separators and empty input', () => {
    expect(sceneSubfolderConflict('/dth-exports')).toContain('exports')
    expect(sceneSubfolderConflict('\\dth-exports')).toContain('exports')
    expect(sceneSubfolderConflict('')).toBe('')
  })
})
