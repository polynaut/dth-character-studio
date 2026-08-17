// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { useCoalescedRefresh } from './use-coalesced-refresh.ts'

afterEach(cleanup)

/** A refresh whose completion the test controls: each call parks until the
 *  test releases it, and the call log is the assertion surface. */
function gatedRefresh() {
  const releases: Array<() => void> = []
  let calls = 0
  const refresh = () => {
    calls += 1
    return new Promise<void>((resolve) => releases.push(resolve))
  }
  return {
    refresh,
    get calls() {
      return calls
    },
    /** Complete the oldest in-flight call and let its continuations run. */
    async release() {
      releases.shift()?.()
      await Promise.resolve()
    },
  }
}

describe('useCoalescedRefresh', () => {
  it('runs a lone trigger once, with no follow-up', async () => {
    const gate = gatedRefresh()
    const { result } = renderHook(() => useCoalescedRefresh(gate.refresh))
    const done = result.current()
    expect(gate.calls).toBe(1)
    await gate.release()
    await done
    expect(gate.calls).toBe(1)
  })

  it('collapses any number of mid-flight triggers into ONE follow-up run', async () => {
    const gate = gatedRefresh()
    const { result } = renderHook(() => useCoalescedRefresh(gate.refresh))
    const done = result.current()
    // A burst while the first refresh is still reading — the destructive-read
    // scenario: none of these may start a second concurrent run.
    void result.current()
    void result.current()
    void result.current()
    expect(gate.calls).toBe(1)
    await gate.release()
    // The burst became exactly one follow-up, run AFTER the first.
    expect(gate.calls).toBe(2)
    await gate.release()
    await done
    expect(gate.calls).toBe(2)
  })

  it('releases the busy latch when the refresh throws', async () => {
    let attempts = 0
    const { result } = renderHook(() =>
      useCoalescedRefresh(() => {
        attempts += 1
        return attempts === 1 ? Promise.reject(new Error('boom')) : Promise.resolve()
      }),
    )
    await expect(result.current()).rejects.toThrow('boom')
    // A failed refresh must not wedge the funnel shut.
    await result.current()
    expect(attempts).toBe(2)
  })

  it('always calls the latest render’s refresh', async () => {
    const seen: Array<string> = []
    const { result, rerender } = renderHook(
      ({ tag }: { tag: string }) =>
        useCoalescedRefresh(() => {
          seen.push(tag)
          return Promise.resolve()
        }),
      { initialProps: { tag: 'first' } },
    )
    const stable = result.current
    rerender({ tag: 'second' })
    // The pre-rerender function reference reaches the post-rerender closure.
    expect(result.current).toBe(stable)
    await stable()
    expect(seen).toEqual(['second'])
  })
})
