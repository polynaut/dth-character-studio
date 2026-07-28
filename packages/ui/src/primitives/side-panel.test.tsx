// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SidePanel } from './side-panel.tsx'

afterEach(cleanup)

function renderPanel(onClose = vi.fn()) {
  const utils = render(
    <SidePanel open title="Panel" onClose={onClose}>
      <button type="button">First</button>
      <button type="button">Second</button>
    </SidePanel>,
  )
  return { ...utils, onClose }
}

describe('SidePanel', () => {
  it('declares dialog semantics and moves focus onto the panel on open', () => {
    const { getByRole } = renderPanel()
    const panel = getByRole('dialog')
    expect(panel.getAttribute('aria-modal')).toBe('true')
    const labelledBy = panel.getAttribute('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    expect(document.getElementById(labelledBy!)?.textContent).toBe('Panel')
    expect(document.activeElement).toBe(panel)
  })

  it('contains Tab: wraps from the last focusable to the first and back', () => {
    const { getByRole, getByText } = renderPanel()
    // First tabbable is the ✕ close button (panel header), last is "Second".
    const close = getByRole('button', { name: 'Close' })
    const second = getByText('Second')
    second.focus()
    fireEvent.keyDown(second, { key: 'Tab' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(second)
  })

  it('Escape dismisses via onClose', () => {
    const { onClose } = renderPanel()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('swallows the backdrop click that re-focuses the window; the next one dismisses', async () => {
    const { onClose } = renderPanel()
    // Radix arms its outside-pointerdown listener a tick after mount.
    await new Promise((resolve) => setTimeout(resolve, 0))
    window.dispatchEvent(new Event('blur'))
    window.dispatchEvent(new Event('focus'))
    fireEvent.pointerDown(document.body)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.pointerDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('an outside click well after an Alt-Tab refocus still dismisses', async () => {
    vi.useFakeTimers()
    try {
      const { onClose } = renderPanel()
      vi.advanceTimersByTime(1)
      window.dispatchEvent(new Event('blur'))
      // Re-focused without a click (Alt-Tab); the click follows past the grace.
      window.dispatchEvent(new Event('focus'))
      vi.advanceTimersByTime(500)
      fireEvent.pointerDown(document.body)
      expect(onClose).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('restores focus to the opener once fully closed', async () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const onClose = vi.fn()
    const panel = (open: boolean) => (
      <SidePanel open={open} title="Panel" onClose={onClose}>
        <button type="button">Inside</button>
      </SidePanel>
    )
    const { rerender, getByRole } = render(panel(true))
    expect(document.activeElement).toBe(getByRole('dialog'))
    rerender(panel(false))
    // The panel keeps its DOM for the 300 ms slide-out, then unmounts and
    // Radix restores focus (itself deferred a tick).
    await new Promise((resolve) => setTimeout(resolve, 350))
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})
