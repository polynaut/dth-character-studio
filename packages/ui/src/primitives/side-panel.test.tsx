// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SidePanel } from './side-panel.tsx'
import { UiConfigProvider } from '../config.tsx'

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

  it('renders the footer OUTSIDE the scrolling body, and keeps it in the focus order', () => {
    const { getByRole, getByText } = render(
      <SidePanel open title="Panel" onClose={vi.fn()} footer={<button type="button">Start</button>}>
        <button type="button">First</button>
      </SidePanel>,
    )
    const start = getByText('Start')
    // Not a descendant of the body that scrolls — that is the whole point: the
    // action stays on the panel's bottom edge however long the body gets.
    expect(getByText('First').parentElement?.contains(start)).toBe(false)
    // …and it is still inside the panel, so the focus trap includes it.
    expect(getByRole('dialog').contains(start)).toBe(true)
  })

  it('Escape dismisses via onClose', () => {
    const { onClose } = renderPanel()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('not dismissible: Escape and the backdrop are ignored, and the ✕ SAYS so', async () => {
    const onClose = vi.fn()
    const { getByRole } = render(
      <SidePanel open title="Panel" onClose={onClose} dismissible={false}>
        <button type="button">First</button>
      </SidePanel>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    fireEvent.pointerDown(document.body)
    fireEvent.pointerDown(document.body)
    expect(onClose).not.toHaveBeenCalled()
    // Disabled, not merely inert: a live-looking ✕ that does nothing is the
    // thing this prop exists to prevent (the caller's Cancel greys out too).
    expect((getByRole('button', { name: 'Close' }) as HTMLButtonElement).disabled).toBe(true)
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

  it('sweeps the host toasts on open, not on mount-closed', () => {
    const dismissToasts = vi.fn()
    const panel = (open: boolean) => (
      <UiConfigProvider value={{ dismissToasts }}>
        <SidePanel open={open} title="Panel" onClose={vi.fn()}>
          <button type="button">Inside</button>
        </SidePanel>
      </UiConfigProvider>
    )
    const { rerender } = render(panel(false))
    expect(dismissToasts).not.toHaveBeenCalled()
    rerender(panel(true))
    expect(dismissToasts).toHaveBeenCalledTimes(1)
  })
})
