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
