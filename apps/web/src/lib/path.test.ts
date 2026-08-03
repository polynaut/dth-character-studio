import { describe, expect, it } from 'vitest'

import { browseStart, extrasWithoutPrimary, middleTruncatePath, parentDir } from './path.ts'

describe('browseStart — where a Browse dialog opens', () => {
  it('uses the path the field already holds', () => {
    expect(browseStart('D:\\DazToHue\\Releases')).toBe('D:/DazToHue/Releases')
  })

  it('falls through blanks to the closest thing the caller offered', () => {
    // The whole point: an unset field is not a reason to dump the user at
    // whatever folder the OS remembers.
    expect(browseStart('', '   ', 'D:/Projects')).toBe('D:/Projects')
    expect(browseStart(undefined, 'D:/Projects')).toBe('D:/Projects')
  })

  it('prefers the set value over every fallback', () => {
    expect(browseStart('D:/Set', 'D:/Fallback')).toBe('D:/Set')
  })

  it('is undefined when nothing sensible is known — the OS decides', () => {
    expect(browseStart('', undefined, '  ')).toBeUndefined()
    expect(browseStart()).toBeUndefined()
  })

  it('preserves a leading UNC \\\\server\\share prefix (network paths)', () => {
    // Collapsing the leading double separator would make the dialog plugin's
    // PathBuf rebuild produce a drive-relative path whose SetFolder fails.
    expect(browseStart('\\\\NAS\\share\\x')).toBe('//NAS/share/x')
  })

  it('preserves the UNC prefix on a fallback candidate too', () => {
    expect(browseStart('', undefined, '\\\\NAS\\share\\proj')).toBe('//NAS/share/proj')
    // …and a local first candidate still wins over a UNC fallback, un-prefixed.
    expect(browseStart('D:\\Set', '\\\\NAS\\share\\proj')).toBe('D:/Set')
  })
})

describe('parentDir', () => {
  it('returns the normalized parent folder', () => {
    expect(parentDir('D:\\Projects\\Scenes\\Beach.duf')).toBe('D:/Projects/Scenes')
  })

  it('returns the drive ROOT (not a drive-relative bare letter) at the top', () => {
    // 'D:' alone means "the current directory on D:" on Windows — a dialog
    // opened there lands wherever the process last was on that drive.
    expect(parentDir('D:/Proj')).toBe('D:/')
    expect(parentDir('D:\\Proj')).toBe('D:/')
  })
})

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
