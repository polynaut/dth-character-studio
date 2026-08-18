import { describe, expect, it } from 'vitest'

import { sourceCharacterCandidates } from './shared.ts'

describe('sourceCharacterCandidates', () => {
  const char = (id: string, ...houdiniProjects: Array<string>) => ({ id, houdiniProjects })

  it('offers the current character once the target project is taken out', () => {
    // The whole point of including it: copying a setup between two projects of
    // the SAME character (a _TEST project from the real one, say).
    const result = sourceCharacterCandidates(
      [char('me', 'X:/lara/LaraCroft_TEST.hiplc', 'X:/lara/LaraCroft_GP.hiplc')],
      'me',
      'X:/lara/LaraCroft_TEST.hiplc',
    )
    expect(result).toEqual([char('me', 'X:/lara/LaraCroft_GP.hiplc')])
  })

  it('drops a character whose only project is the target', () => {
    const result = sourceCharacterCandidates(
      [char('me', 'X:/lara/LaraCroft_TEST.hiplc'), char('other', 'X:/ita/Ita.hiplc')],
      'me',
      'X:/lara/LaraCroft_TEST.hiplc',
    )
    expect(result).toEqual([char('other', 'X:/ita/Ita.hiplc')])
  })

  it('matches the target across separator and case differences', () => {
    // The drawer's targetHip and a stored character path can disagree on
    // slashes/case on Windows while naming the same file.
    const result = sourceCharacterCandidates(
      [char('me', 'X:\\Lara\\LaraCroft_TEST.hiplc')],
      'me',
      'x:/lara/laracroft_test.hiplc',
    )
    expect(result).toEqual([])
  })

  it('sorts the current character first and keeps the rest in order', () => {
    const result = sourceCharacterCandidates(
      [char('a', 'X:/a.hiplc'), char('b', 'X:/b.hiplc'), char('me', 'X:/me.hiplc')],
      'me',
      'X:/target.hiplc',
    )
    expect(result.map((c) => c.id)).toEqual(['me', 'a', 'b'])
  })
})
