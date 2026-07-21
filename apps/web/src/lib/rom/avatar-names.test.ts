import { describe, expect, it } from 'vitest'

import {
  AVATAR_UPLOAD_HISTORY,
  avatarFileName,
  avatarIdOf,
  avatarsToPrune,
  parseAvatarName,
  uploadsNewestFirst,
} from './avatar-names.ts'

describe('avatarFileName / parseAvatarName round-trip', () => {
  it('builds and parses the kind + timestamp', () => {
    const name = avatarFileName('Kira', 'up', 1712345678901, 'png')
    expect(name).toBe('Kira--up-1712345678901.png')
    expect(parseAvatarName(name)).toEqual({
      id: 'Kira',
      kind: 'up',
      ts: 1712345678901,
      ext: 'png',
    })
  })

  it('parses ids that themselves contain single dashes (greedy id)', () => {
    expect(parseAvatarName('Kira-Nova--sc-42.png')).toMatchObject({ id: 'Kira-Nova', kind: 'sc' })
  })

  it('rejects non-avatar names (external URLs, legacy, unrelated)', () => {
    expect(parseAvatarName('https://example.com/a.png')).toBeNull()
    expect(parseAvatarName('Kira-1712345678901.png')).toBeNull() // legacy scheme
    expect(parseAvatarName('notes.md')).toBeNull()
  })
})

describe('avatarIdOf', () => {
  it('reads the id from the current scheme', () => {
    expect(avatarIdOf('Kira--up-42.png')).toBe('Kira')
  })
  it('falls back to the legacy <id>-<ts>.<ext> scheme', () => {
    expect(avatarIdOf('Kira-1712345678901.png')).toBe('Kira')
  })
  it('returns the name itself when nothing matches', () => {
    expect(avatarIdOf('https://x/y.png')).toBe('https://x/y.png')
  })
})

describe('uploadsNewestFirst', () => {
  it('returns only this id\'s uploads, newest first', () => {
    const files = [
      'Kira--up-100.png',
      'Kira--up-300.png',
      'Kira--sc-999.png', // a scene snapshot — excluded
      'Kira--up-200.png',
      'Other--up-500.png', // another character — excluded
      'legacy-1.png', // legacy — excluded
    ]
    expect(uploadsNewestFirst(files, 'Kira')).toEqual([
      'Kira--up-300.png',
      'Kira--up-200.png',
      'Kira--up-100.png',
    ])
  })
})

describe('avatarsToPrune', () => {
  it('keeps the newest N uploads + newest scene snapshot, prunes the rest', () => {
    const files = [
      ...Array.from({ length: 8 }, (_, i) => `Kira--up-${100 + i}.png`), // 8 uploads
      'Kira--sc-10.png',
      'Kira--sc-20.png', // newest scene
    ]
    const active = 'Kira--up-107.png' // the newest upload (just written)
    const pruned = avatarsToPrune(files, 'Kira', active)
    // 8 uploads → keep newest 6 (ts 102..107), prune 100 & 101; keep newest sc (20), prune 10.
    expect(pruned.sort()).toEqual(['Kira--sc-10.png', 'Kira--up-100.png', 'Kira--up-101.png'])
    expect(AVATAR_UPLOAD_HISTORY).toBe(6)
  })

  it('never prunes the active file even if it is old', () => {
    const files = Array.from({ length: 8 }, (_, i) => `Kira--up-${100 + i}.png`)
    const active = 'Kira--up-100.png' // oldest, but currently selected
    const pruned = avatarsToPrune(files, 'Kira', active)
    expect(pruned).not.toContain(active)
    // The active old one is spared, so only ONE other upload falls off the cap of 6
    // (7 survive: the 6 newest + the pinned active) → 1 pruned.
    expect(pruned).toHaveLength(1)
    expect(pruned[0]).toBe('Kira--up-101.png')
  })

  it('leaves other characters and unrecognized files untouched', () => {
    const files = ['Kira--up-1.png', 'Other--up-1.png', 'legacy-9.png', 'notes.md']
    expect(avatarsToPrune(files, 'Kira', 'Kira--up-1.png')).toEqual([])
  })
})
