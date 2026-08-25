// @vitest-environment jsdom
import { cleanup, render, renderHook, act } from '@testing-library/react'
import { useLayoutEffect, useRef } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { useDraftValue } from './use-draft-value.ts'

afterEach(cleanup)

describe('useDraftValue', () => {
  it('keeps local edits while the committed value is unchanged', () => {
    const { result, rerender } = renderHook(({ v }) => useDraftValue(v), {
      initialProps: { v: 'a' },
    })
    act(() => result.current[1]('typed'))
    expect(result.current[0]).toBe('typed')
    // A re-render with the SAME value must not clobber what the user typed.
    rerender({ v: 'a' })
    expect(result.current[0]).toBe('typed')
  })

  it('resets the draft when the committed value changes underneath it', () => {
    const { result, rerender } = renderHook(({ v }) => useDraftValue(v), {
      initialProps: { v: 'a' },
    })
    act(() => result.current[1]('typed'))
    rerender({ v: 'b' })
    expect(result.current[0]).toBe('b')
  })

  it('never COMMITS the stale draft — the reset lands in the same commit', () => {
    // This is the whole reason the hook exists rather than an effect: the old
    // `useEffect(() => setDraft(value), [value])` form committed the stale draft
    // to the DOM first and corrected it one frame later.
    //
    // Measured from a layout effect, which runs after React has mutated the DOM
    // and before paint — so this log is the sequence of values that actually
    // REACHED the DOM. (The render body is deliberately not the probe: React
    // does invoke it once with the stale draft, then throws that render away
    // without committing it. Renders are not commits.)
    const committed: Array<string> = []
    function Child({ value }: { value: string }) {
      const [draft, setDraft] = useDraftValue(value)
      const ref = useRef<HTMLInputElement>(null)
      useLayoutEffect(() => {
        if (ref.current) committed.push(ref.current.value)
      })
      return <input ref={ref} value={draft} onChange={(e) => setDraft(e.target.value)} readOnly />
    }
    const { rerender } = render(<Child value="a" />)
    committed.length = 0
    rerender(<Child value="b" />)
    // With the old effect form this log would read ['a', 'b'] — one stale frame.
    expect(committed).toEqual(['b'])
  })

  it('compares by VALUE, so a recomputed but equal value is not a reset', () => {
    // The callers format before handing the value over (`useDraftValue(
    // format(value))`), so every render builds a fresh string. Comparing by
    // value is what keeps that from clobbering the user's edit each render.
    const format = (n: number) => String(n * 100)
    const { result, rerender } = renderHook(({ n }) => useDraftValue(format(n)), {
      initialProps: { n: 0.42 },
    })
    act(() => result.current[1]('typed'))
    rerender({ n: 0.42 })
    expect(result.current[0]).toBe('typed')
    // A genuinely different number does reset it.
    rerender({ n: 0.5 })
    expect(result.current[0]).toBe('50')
  })
})
