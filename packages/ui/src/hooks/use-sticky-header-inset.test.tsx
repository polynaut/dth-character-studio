// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { useStickyHeaderInset } from './use-sticky-header-inset.ts'

beforeAll(() => {
  // The hook observes its header with a ResizeObserver, which jsdom lacks.
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver
})

afterEach(cleanup)

function Header({ height }: { height: number }) {
  const ref = useRef<HTMLElement>(null)
  useStickyHeaderInset(ref)
  return (
    <header
      ref={(el) => {
        ref.current = el
        // jsdom reports offsetHeight as 0; force a real value so the publish is observable.
        if (el) Object.defineProperty(el, 'offsetHeight', { value: height, configurable: true })
      }}
    />
  )
}

describe('useStickyHeaderInset', () => {
  it('publishes the header height as --sticky-header-h and clears it on unmount', () => {
    const root = document.documentElement
    expect(root.style.getPropertyValue('--sticky-header-h')).toBe('')
    const { unmount } = render(<Header height={96} />)
    expect(root.style.getPropertyValue('--sticky-header-h')).toBe('96px')
    // A plain page (no header) must read nothing so consumers fall back.
    unmount()
    expect(root.style.getPropertyValue('--sticky-header-h')).toBe('')
  })
})
