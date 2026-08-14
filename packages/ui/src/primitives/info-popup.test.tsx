// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { InfoPopup } from './info-popup.tsx'
import { Modal } from './modal.tsx'
import { UiConfigProvider } from '../config.tsx'

beforeAll(() => {
  // @floating-ui's autoUpdate needs ResizeObserver, which jsdom doesn't provide.
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver

  // Emulate MOUSE modality by default. On close, FloatingFocusManager
  // return-focuses the trigger; floating-ui's useFocus re-peeks on any focus it
  // considers ":focus-visible" — and its matchesFocusVisible() hard-codes
  // `true` under a jsdom user agent, so the popup would reopen forever here,
  // which a real mouse-modality browser never does. Hide the jsdom UA so the
  // real check runs, and make that check report `focusVisible` (false = mouse
  // modality; a test flips it to true to emulate keyboard modality).
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
    if (selector === ':focus-visible') return focusVisible
    return realMatches.call(this, selector)
  } as typeof Element.prototype.matches
})

/** What the `:focus-visible` stub reports — see the modality note above. */
let focusVisible = false

afterEach(() => {
  focusVisible = false
  cleanup()
})

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

  it('Escape on a pinned dialog closes it for good — keyboard-modality return focus must not re-peek it', async () => {
    // KEYBOARD modality: the trigger reports :focus-visible when the focus
    // manager returns focus to it. useFocus must stay subscribed while pinned,
    // or its escape-key block-focus guard never arms and that return focus
    // immediately re-opens the popup.
    focusVisible = true
    const { getByRole, queryByRole } = renderPopup()
    const trigger = getByRole('button', { name: 'More information' })
    fireEvent.click(trigger) // pin
    const dialog = await waitFor(() => getByRole('dialog'))
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(queryByRole('dialog')).toBeNull())
    // FloatingFocusManager has returned focus to the "i"…
    await waitFor(() => expect(document.activeElement).toBe(trigger))
    // …and that :focus-visible focus must not have peeked the popup back open.
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(queryByRole('dialog')).toBeNull()
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

  it('an opening modal dialog sweeps the popup closed', async () => {
    // The popup portals ABOVE the dialog layer (z-[60] vs z-50), so a popup
    // still open when a dialog appears would float over it — Modal sweeps
    // them on open (closeAllInfoPopups).
    const ui = (withModal: boolean) => (
      <UiConfigProvider value={{}}>
        <InfoPopup>Some help text</InfoPopup>
        {withModal && (
          <Modal open onClose={() => {}} title="Busy work">
            body
          </Modal>
        )}
      </UiConfigProvider>
    )
    const { getByRole, rerender } = render(ui(false))
    const trigger = getByRole('button', { name: 'More information' })
    fireEvent.click(trigger) // pin it open
    await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('true'))
    rerender(ui(true))
    await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('false'))
  })

  it('a hover peek still COUNTING DOWN when a dialog opens must not land on top of it', async () => {
    // The sweep above only reaches popups that are already OPEN — `openPopups`
    // is registered from an effect guarded on `open`. A hover peek is on a 90ms
    // delay (useHover `delay: { open: 90 }`), so a pointer resting on the "i"
    // when an overlay opens leaves a timer the sweep cannot see: it fires after
    // the dialog is up and paints the popup at z-[60], OVER the z-50 dialog.
    //
    // Unlike a tooltip (pointer-events-none, so it can never take a click) this
    // popup is interactive, which means it does not merely look wrong — it
    // swallows clicks aimed at whatever is beneath it. That is the shape of the
    // CI smoke flake: `locator.click` waiting for actionability until the 60s
    // budget, on a different overlay-driven spec each run, never reproducible on
    // a fast machine where the 90ms window closes before the dialog opens.
    //
    // TooltipHost already guards exactly this ("cancel one that is counting down
    // to appear" — its hide() clears the pending timer). This is the same rule
    // for the other floating layer.
    const ui = (withModal: boolean) => (
      <UiConfigProvider value={{}}>
        <InfoPopup>Peeked help</InfoPopup>
        {withModal && (
          <Modal open onClose={() => {}} title="Busy work">
            body
          </Modal>
        )}
      </UiConfigProvider>
    )
    const { getByRole, queryByText, rerender } = render(ui(false))
    const trigger = getByRole('button', { name: 'More information' })
    // Pointer lands on the "i" — the peek is now counting down, NOT open.
    fireEvent.mouseEnter(trigger)
    // The dialog opens inside that window and sweeps what it can see.
    rerender(ui(true))
    // Let the pending peek fire.
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(queryByText('Peeked help')).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('a keyboard user can still open the "i" after a dialog has swept it', async () => {
    // The sweep marks EVERY mounted popup stale, and the stale flag is only
    // re-armed by `mouseenter` or a click on the trigger. A keyboard user has
    // neither: they Tab to the "i", and `useFocus` opens with reason 'focus'.
    // So a guard that refuses every open would leave every popup on the page
    // permanently unopenable-by-keyboard after the first dialog of the session
    // — and there is nothing to refuse in the first place, because a focus open
    // is synchronous. Only the 90ms HOVER delay can outlive a sweep.
    focusVisible = true // keyboard modality
    const ui = (withModal: boolean) => (
      <UiConfigProvider value={{}}>
        <InfoPopup>Keyboard help</InfoPopup>
        {withModal && (
          <Modal open onClose={() => {}} title="Busy work">
            body
          </Modal>
        )}
      </UiConfigProvider>
    )
    const { getByRole, rerender } = render(ui(false))
    const trigger = getByRole('button', { name: 'More information' })
    rerender(ui(true)) // a dialog opens and sweeps every mounted popup
    rerender(ui(false)) // …and is dismissed again
    fireEvent.focus(trigger) // Tab to the "i"
    await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('true'))
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
