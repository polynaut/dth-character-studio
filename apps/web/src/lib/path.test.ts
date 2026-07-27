import { describe, expect, it } from 'vitest'

import { extrasWithoutPrimary, middleTruncatePath } from './path.ts'

describe('middleTruncatePath', () => {
  it('keeps short paths untouched', () => {
    expect(middleTruncatePath('D:\\UE\\A.uproject', 34)).toBe('D:\\UE\\A.uproject')
  })

  it('ellipsizes the middle: the path start AND the whole file name survive', () => {
    const path = 'D:\\Unreal Projects\\Thick_Raider_FOUNDRY\\Thick_Raider_FOUNDRY.uproject'
    const out = middleTruncatePath(path, 34)
    expect(out).toBe('D:\\…\\Thick_Raider_FOUNDRY.uproject')
    expect(out.length).toBeLessThanOrEqual(34)
  })

  it('truncates the file name from ITS start only when it alone exceeds the budget', () => {
    const path = 'D:\\x\\An_Extremely_Long_Project_File_Name_That_Never_Ends.uproject'
    const out = middleTruncatePath(path, 24)
    expect(out.length).toBe(24)
    expect(out.startsWith('…')).toBe(true)
    expect(out.endsWith('.uproject')).toBe(true)
  })

  it('handles forward-slash paths the same way', () => {
    expect(middleTruncatePath('/home/user/projects/deep/nested/Game.uproject', 30)).toBe(
      '/home/user/proj…/Game.uproject',
    )
  })

  it('caps the shown start at maxHead once truncation kicks in (full name gets the budget)', () => {
    const path = 'D:\\Unreal Projects\\Thick_Raider_FOUNDRY\\Thick_Raider_FOUNDRY'
    expect(middleTruncatePath(path, 40, 8)).toBe('D:\\Unrea…\\Thick_Raider_FOUNDRY')
    // A path that FITS is untouched — the cap only applies to truncated output.
    expect(middleTruncatePath('D:\\UE\\Game', 40, 8)).toBe('D:\\UE\\Game')
  })
})

describe('extrasWithoutPrimary', () => {
  it('drops the newly-primary path from the extras (a scene is linked at most once)', () => {
    expect(
      extrasWithoutPrimary(['D:/p/Beach.duf', 'D:/p/Office.duf'], 'D:/p/Beach.duf'),
    ).toEqual(['D:/p/Office.duf'])
  })

  it('matches case- and separator-insensitively (Windows)', () => {
    expect(
      extrasWithoutPrimary(['D:\\p\\beach.duf', 'D:/p/Office.duf'], 'D:/p/BEACH.duf'),
    ).toEqual(['D:/p/Office.duf'])
  })

  it('leaves the list untouched when the primary was not an extra', () => {
    const extras = ['D:/p/Beach.duf', 'D:/p/Office.duf']
    expect(extrasWithoutPrimary(extras, 'D:/p/Primary.duf')).toEqual(extras)
  })

  it('removes every copy if the primary somehow appeared more than once', () => {
    expect(
      extrasWithoutPrimary(['D:/p/Beach.duf', 'D:\\p\\Beach.duf'], 'D:/p/Beach.duf'),
    ).toEqual([])
  })
})
