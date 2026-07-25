import { describe, expect, it } from 'vitest'

import { extrasWithoutPrimary } from './path.ts'

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
