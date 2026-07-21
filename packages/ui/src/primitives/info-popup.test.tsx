// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { InfoPopup } from './info-popup.tsx'
import { UiConfigProvider } from '../config.tsx'

beforeAll(() => {
  // @floating-ui's autoUpdate needs ResizeObserver, which jsdom doesn't provide.
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver

  // Emulate MOUSE modality. On close, FloatingFocusManager return-focuses the
  // trigger; floating-ui's useFocus re-peeks on any focus it considers
  // ":focus-visible" — and its matchesFocusVisible() hard-codes `true` under a
  // jsdom user agent, so the popup would reopen forever here, which a real
  // mouse-modality browser never does. Hide the jsdom UA so the real check
  // runs, and make that check report "not focus-visible" (= mouse modality).
  Object.defineProperty(navigator, 'userAgent', {
    value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36',
    configurable: true,
  })
  // (captured via descriptor — a bare method reference trips unbound-method)
  const realMatches = Object.getOwnPropertyDescriptor(Element.prototype, 'matches')?.value as (
    this: Element,
    selector: string,
  ) => boolean
  Element.prototype.matches = function (this: Element, selector: string) {
    if (selector === ':focus-visible') return false
    return realMatches.call(this, selector)
  } as typeof Element.prototype.matches
})

afterEach(cleanup)

function renderPopup(config: { onNavigate?: (p: string) => void; onOpenExternal?: (u: string) => void } = {}) {
  return render(
    <UiConfigProvider value={config}>
      <InfoPopup>
        Copy from <a href="/settings">Settings</a>, the{' '}
        <a href="https://example.com/docs">docs</a> or <a href="relative">nowhere</a>.
      </InfoPopup>
    </UiConfigProvider>,
  )
}

describe('InfoPopup', () => {
  it('click pins the dialog open; a second click unpins and closes', async () => {
    const { getByRole, queryByRole } = renderPopup()
    const trigger = getByRole('button', { name: 'More information' })
    fireEvent.click(trigger)
    await waitFor(() => expect(getByRole('dialog')).toBeTruthy())
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    // The close transition (150ms) keeps it mounted briefly, then it goes.
    await waitFor(() => expect(queryByRole('dialog')).toBeNull())
  })

  it('moves focus into the pinned dialog so its links are reachable', async () => {
    const { getByRole } = renderPopup()
    fireEvent.click(getByRole('button', { name: 'More information' }))
    const dialog = await waitFor(() => getByRole('dialog'))
    // FloatingFocusManager focuses the first tabbable link — or the popup
    // itself when tabbable detection can't run (jsdom has no layout).
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
  })

  it('intercepts an in-app link through UiConfig.onNavigate and closes', async () => {
    const onNavigate = vi.fn()
    const { getByRole, getByText, queryByRole } = renderPopup({ onNavigate })
    fireEvent.click(getByRole('button', { name: 'More information' }))
    await waitFor(() => expect(getByRole('dialog')).toBeTruthy())
    fireEvent.click(getByText('Settings'))
    expect(onNavigate).toHaveBeenCalledWith('/settings')
    await waitFor(() => expect(queryByRole('dialog')).toBeNull())
  })

  it('intercepts an external link through UiConfig.onOpenExternal and stays open', async () => {
    const onOpenExternal = vi.fn()
    const { getByRole, getByText } = renderPopup({ onOpenExternal })
    fireEvent.click(getByRole('button', { name: 'More information' }))
    await waitFor(() => expect(getByRole('dialog')).toBeTruthy())
    fireEvent.click(getByText('docs'))
    expect(onOpenExternal).toHaveBeenCalledWith('https://example.com/docs')
    expect(getByRole('dialog')).toBeTruthy()
  })

  it('eats a relative href instead of letting it replace the webview', async () => {
    const onNavigate = vi.fn()
    const onOpenExternal = vi.fn()
    const { getByRole, getByText } = renderPopup({ onNavigate, onOpenExternal })
    fireEvent.click(getByRole('button', { name: 'More information' }))
    await waitFor(() => expect(getByRole('dialog')).toBeTruthy())
    fireEvent.click(getByText('nowhere'))
    expect(onNavigate).not.toHaveBeenCalled()
    expect(onOpenExternal).not.toHaveBeenCalled()
  })
})
