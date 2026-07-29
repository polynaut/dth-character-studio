import { describe, expect, it } from 'vitest'

import { deriveScenesRootRel, suggestSceneSubfolder } from './scene-subfolder'

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
