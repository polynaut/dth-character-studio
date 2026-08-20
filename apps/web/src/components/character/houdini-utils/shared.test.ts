import { beforeEach, describe, expect, it, vi } from 'vitest'

const sonner = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast: sonner }))

import {
  TRANSIENT_TOAST_MS,
  hipStem,
  sourceCharacterCandidates,
  utilsToast,
} from './shared.ts'

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

describe('hipStem', () => {
  it('is the file name with the extension off, dotfiles kept whole', () => {
    expect(hipStem('X:/lara/houdini/LaraCroft_G81_TEST.hiplc')).toBe('LaraCroft_G81_TEST')
    expect(hipStem('LaraCroft.v2.hip')).toBe('LaraCroft.v2')
    expect(hipStem('.hidden')).toBe('.hidden')
  })
})

/**
 * The drawer's sticky-toast rule is one spread order in `utilsToast`, and the
 * backup sweep's auto-hide is the single caller that depends on the caller
 * winning it. Flipping to `{ ...options, duration: Infinity }` — a plausible
 * "the rule is absolute" tightening — would revert that with every other gate
 * still green, so it is pinned here.
 */
describe('utilsToast', () => {
  beforeEach(() => {
    sonner.success.mockClear()
    sonner.error.mockClear()
  })

  it('pins an outcome until it is dismissed, successes and failures alike', () => {
    utilsToast.success('Transferred to 3 projects.')
    utilsToast.error('os error 32: the file is open in Houdini.')
    expect(sonner.success).toHaveBeenCalledWith('Transferred to 3 projects.', {
      duration: Infinity,
    })
    expect(sonner.error).toHaveBeenCalledWith('os error 32: the file is open in Houdini.', {
      duration: Infinity,
    })
  })

  it("lets a caller's own duration win — the backup sweep's opt-out", () => {
    utilsToast.success('3 backups removed.', { duration: TRANSIENT_TOAST_MS })
    expect(sonner.success.mock.calls[0]?.[1]?.duration).toBe(TRANSIENT_TOAST_MS)
    expect(Number.isFinite(TRANSIENT_TOAST_MS)).toBe(true)
  })

  it('keeps the sticky default when the caller passes some OTHER option', () => {
    // Opting out has to be deliberate: passing a description must not quietly
    // hand a hython report a four-second life.
    utilsToast.success('Repathed 2 projects.', { description: 'One layer left absolute.' })
    expect(sonner.success).toHaveBeenCalledWith('Repathed 2 projects.', {
      duration: Infinity,
      description: 'One layer left absolute.',
    })
  })
})
