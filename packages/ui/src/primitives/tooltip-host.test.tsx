// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TooltipHost } from './tooltip-host'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('TooltipHost (global title → floating tooltip)', () => {
  it('steals the native title and shows the styled tooltip after the hover delay', async () => {
    render(
      <>
        {/* icon-only: no visible text — the svg stands in for a lucide icon */}
        <button title="Insert a frame here">
          <svg />
        </button>
        <TooltipHost />
      </>,
    )
    const button = screen.getByRole('button')
    fireEvent.mouseOver(button)

    // The native title is gone immediately (no double tooltip)…
    expect(button.getAttribute('title')).toBeNull()
    expect(button.getAttribute('data-tooltip')).toBe('Insert a frame here')
    // …and the icon-only control keeps an accessible name.
    expect(button.getAttribute('aria-label')).toBe('Insert a frame here')

    const tip = screen.getByRole('tooltip', { hidden: true })
    expect(tip.style.display).toBe('none')
    await vi.advanceTimersByTimeAsync(400)
    expect(tip.style.display).toBe('block')
    expect(tip.textContent).toBe('Insert a frame here')

    // Leaving hides it.
    fireEvent.mouseLeave(button)
    expect(tip.style.display).toBe('none')
  })

  it('updates a visible tooltip live when the anchor title changes (e.g. "Copied!")', async () => {
    render(
      <>
        <button title="Click to copy">path</button>
        <TooltipHost />
      </>,
    )
    const button = screen.getByRole('button')
    fireEvent.mouseOver(button)
    await vi.advanceTimersByTimeAsync(400)
    const tip = screen.getByRole('tooltip', { hidden: true })
    expect(tip.textContent).toBe('Click to copy')

    // A React re-render writes a fresh title (React diffs against its own vdom,
    // not the stolen DOM attribute) — the tooltip must track it live.
    button.setAttribute('title', 'Copied!')
    await vi.advanceTimersByTimeAsync(0) // flush the MutationObserver microtask

    expect(button.getAttribute('title')).toBeNull() // re-stolen
    expect(button.getAttribute('data-tooltip')).toBe('Copied!')
    expect(tip.style.display).toBe('block')
    expect(tip.textContent).toBe('Copied!')
  })

  it('sweeping across children of one anchor does not restart the hover delay', async () => {
    render(
      <>
        {/* A multi-child card: every child mouseover resolves to the same
            [title] anchor via closest(). */}
        <div title="Card tooltip">
          <span data-testid="child-a">thumb</span>
          <span data-testid="child-b">title</span>
          <span data-testid="child-c">path</span>
        </div>
        <TooltipHost />
      </>,
    )
    fireEvent.mouseOver(screen.getByTestId('child-a'))
    await vi.advanceTimersByTimeAsync(150)
    fireEvent.mouseOver(screen.getByTestId('child-b'))
    await vi.advanceTimersByTimeAsync(150)
    fireEvent.mouseOver(screen.getByTestId('child-c'))
    // 150+150+100 = 400ms since the FIRST enter — if each child restarted the
    // 350ms delay, the tooltip would still be hidden here.
    await vi.advanceTimersByTimeAsync(100)
    const tip = screen.getByRole('tooltip', { hidden: true })
    expect(tip.style.display).toBe('block')
    expect(tip.textContent).toBe('Card tooltip')
  })

  it('shows immediately on keyboard focus and never overwrites an existing label', async () => {
    render(
      <>
        <button title="Save the character" aria-label="Save">
          Save
        </button>
        <TooltipHost />
      </>,
    )
    const button = screen.getByRole('button')
    fireEvent.focusIn(button)
    expect(button.getAttribute('aria-label')).toBe('Save') // untouched
    await vi.advanceTimersByTimeAsync(0)
    expect(screen.getByRole('tooltip', { hidden: true }).textContent).toBe('Save the character')
  })
})
