// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useArmedWatch } from './use-armed-watch.ts'

afterEach(cleanup)

/** A start whose resolution the test controls — the async-arm window is
 *  exactly what the hook exists to get right. */
function gatedStart() {
  let resolve!: (stop: (() => void) | null) => void
  const promise = new Promise<(() => void) | null>((r) => {
    resolve = r
  })
  return { start: () => promise, resolve }
}

describe('useArmedWatch', () => {
  it('arms once start resolves a stopper, and stops on deactivate', async () => {
    const gate = gatedStart()
    const stop = vi.fn()
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useArmedWatch(active, gate.start),
      { initialProps: { active: true } },
    )
    expect(result.current).toBe(false)
    await act(async () => gate.resolve(stop))
    expect(result.current).toBe(true)
    expect(stop).not.toHaveBeenCalled()
    rerender({ active: false })
    expect(stop).toHaveBeenCalledOnce()
    expect(result.current).toBe(false)
  })

  it('stays unarmed when watching is unavailable (start resolves null)', async () => {
    const gate = gatedStart()
    const { result } = renderHook(() => useArmedWatch(true, gate.start))
    await act(async () => gate.resolve(null))
    // The caller's poll stays at full speed — null is a supported outcome.
    expect(result.current).toBe(false)
  })

  it('stops a watch whose start resolves only AFTER deactivation', async () => {
    const gate = gatedStart()
    const stop = vi.fn()
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useArmedWatch(active, gate.start),
      { initialProps: { active: true } },
    )
    rerender({ active: false })
    // The stopper lands in a torn-down effect: it must be stopped on the spot
    // and must never flip the armed flag.
    await act(async () => gate.resolve(stop))
    expect(stop).toHaveBeenCalledOnce()
    expect(result.current).toBe(false)
  })

  it('never starts while inactive', () => {
    const start = vi.fn(() => Promise.resolve(null))
    renderHook(() => useArmedWatch(false, start))
    expect(start).not.toHaveBeenCalled()
  })
})
