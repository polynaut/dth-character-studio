import { describe, expect, it } from 'vitest'

import {
  HOUDINI_SOURCE_RECENTS_MAX,
  parseHoudiniSources,
  withHoudiniSource,
  withoutHoudiniSource,
} from './storage/houdini-sources.ts'

// The Utils drawer's "Recently used" sources — the ordering rule only, which is
// the whole behaviour worth pinning: the list is a shortcut row, so being in the
// RIGHT ORDER and never growing is what makes it faster than browsing.

const at = (n: number) => `2026-08-1${n}T00:00:00.000Z`

describe('withHoudiniSource', () => {
  it('puts the newest first', () => {
    let list = withHoudiniSource([], 'D:/t/A.hiplc', at(0))
    list = withHoudiniSource(list, 'D:/t/B.hiplc', at(1))
    expect(list.map((r) => r.path)).toEqual(['D:/t/B.hiplc', 'D:/t/A.hiplc'])
  })

  it('re-picking an entry MOVES it rather than duplicating it', () => {
    // The point of the row: the file you keep coming back to keeps floating up,
    // and never occupies two of the five slots.
    let list = withHoudiniSource([], 'D:/t/A.hiplc', at(0))
    list = withHoudiniSource(list, 'D:/t/B.hiplc', at(1))
    list = withHoudiniSource(list, 'D:/t/A.hiplc', at(2))
    expect(list.map((r) => r.path)).toEqual(['D:/t/A.hiplc', 'D:/t/B.hiplc'])
  })

  it('matches the same file across separators and case — these are Windows paths', () => {
    const list = withHoudiniSource(
      withHoudiniSource([], 'D:/Templates/Base.hiplc', at(0)),
      'd:\\templates\\BASE.hiplc',
      at(1),
    )
    expect(list).toHaveLength(1)
    // The NEW spelling wins: it is the one the user just picked, so it is the
    // one their picker will show them next time.
    expect(list[0]?.path).toBe('d:\\templates\\BASE.hiplc')
  })

  it('never grows past the cap, dropping the OLDEST', () => {
    let list: ReturnType<typeof withHoudiniSource> = []
    for (let i = 0; i < HOUDINI_SOURCE_RECENTS_MAX + 3; i++) {
      list = withHoudiniSource(list, `D:/t/${i}.hiplc`, at(0))
    }
    expect(list).toHaveLength(HOUDINI_SOURCE_RECENTS_MAX)
    expect(list[0]?.path).toBe(`D:/t/${HOUDINI_SOURCE_RECENTS_MAX + 2}.hiplc`)
    expect(list.map((r) => r.path)).not.toContain('D:/t/0.hiplc')
  })

  it('ignores a blank path instead of storing an unopenable entry', () => {
    expect(withHoudiniSource([], '   ', at(0))).toEqual([])
  })
})

describe('withoutHoudiniSource', () => {
  it('drops the entry the user asked to forget, leaving the order alone', () => {
    let list = withHoudiniSource([], 'D:/t/A.hiplc', at(0))
    list = withHoudiniSource(list, 'D:/t/B.hiplc', at(1))
    list = withHoudiniSource(list, 'D:/t/C.hiplc', at(2))
    expect(withoutHoudiniSource(list, 'D:/t/B.hiplc').map((r) => r.path)).toEqual([
      'D:/t/C.hiplc',
      'D:/t/A.hiplc',
    ])
  })

  it('matches across separators and case, like every other path lookup here', () => {
    // The chip carries whatever spelling was stored; the click sends that back.
    // Anything less than the same fold would leave un-removable chips.
    const list = withHoudiniSource([], 'D:/Templates/Base.hiplc', at(0))
    expect(withoutHoudiniSource(list, 'd:\\templates\\BASE.hiplc')).toEqual([])
  })

  it('leaves the list alone for a blank or unknown path', () => {
    const list = withHoudiniSource([], 'D:/t/A.hiplc', at(0))
    expect(withoutHoudiniSource(list, '  ')).toEqual(list)
    expect(withoutHoudiniSource(list, 'D:/t/Nope.hiplc')).toEqual(list)
  })
})

describe('parseHoudiniSources', () => {
  it('reads a stored list', () => {
    const text = JSON.stringify({ version: 1, files: [{ path: 'D:/t/A.hiplc', usedAt: at(0) }] })
    expect(parseHoudiniSources(text).map((r) => r.path)).toEqual(['D:/t/A.hiplc'])
  })

  it('is EMPTY for anything unreadable, never a throw', () => {
    // A convenience row must not be able to take the drawer down with it.
    expect(parseHoudiniSources('not json')).toEqual([])
    expect(parseHoudiniSources('{"files":[{"nope":1}]}')).toEqual([])
    expect(parseHoudiniSources('')).toEqual([])
  })
})
