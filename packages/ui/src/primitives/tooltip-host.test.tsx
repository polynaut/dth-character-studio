// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Modal } from './modal.tsx'
import { SidePanel } from './side-panel.tsx'
import { TooltipHost, closeTooltip } from './tooltip-host'

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
    await vi.advanceTimersByTimeAsync(700)
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
    await vi.advanceTimersByTimeAsync(700)
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
    await vi.advanceTimersByTimeAsync(300)
    fireEvent.mouseOver(screen.getByTestId('child-b'))
    await vi.advanceTimersByTimeAsync(300)
    fireEvent.mouseOver(screen.getByTestId('child-c'))
    // 300+300+150 = 750ms since the FIRST enter — if each child restarted the
    // 700ms delay, the tooltip would still be hidden here.
    await vi.advanceTimersByTimeAsync(150)
    const tip = screen.getByRole('tooltip', { hidden: true })
    expect(tip.style.display).toBe('block')
    expect(tip.textContent).toBe('Card tooltip')
  })

  it('hides when the anchor leaves the DOM under a stationary cursor', async () => {
    // A REMOVED element emits no mouseleave and no blur — a state swap under a
    // parked cursor (a progress button whose run just finished) stranded its
    // tooltip on screen forever, pinned to the detached node.
    render(
      <>
        <div data-testid="slot">
          <button title="Houdini is exporting — 0 of 1 node done. Click to stop watching.">
            Houdini 0/1
          </button>
        </div>
        <TooltipHost />
      </>,
    )
    const button = screen.getByRole('button')
    fireEvent.mouseOver(button)
    await vi.advanceTimersByTimeAsync(700)
    const tip = screen.getByRole('tooltip', { hidden: true })
    expect(tip.style.display).toBe('block')

    // The run finishes: the component swaps state and the button unmounts.
    button.remove()
    await vi.advanceTimersByTimeAsync(0) // flush the MutationObserver microtask

    expect(tip.style.display).toBe('none')
  })

  it('closeTooltip() hides a live tooltip and cancels one still counting down', async () => {
    render(
      <>
        <button title="Send to Unreal">Send</button>
        <TooltipHost />
      </>,
    )
    const button = screen.getByRole('button')
    const tip = screen.getByRole('tooltip', { hidden: true })

    fireEvent.mouseOver(button)
    await vi.advanceTimersByTimeAsync(700)
    expect(tip.style.display).toBe('block')
    closeTooltip()
    expect(tip.style.display).toBe('none')

    // A hover delay already counting down must be cancelled too — no hit-test
    // at show time can undo a tooltip that appears AFTER the overlay is up.
    fireEvent.mouseLeave(button)
    fireEvent.mouseOver(button)
    await vi.advanceTimersByTimeAsync(300)
    closeTooltip()
    await vi.advanceTimersByTimeAsync(400) // the rest of the 700ms delay
    expect(tip.style.display).toBe('none')
  })

  it('an opening dialog sweeps a live tooltip', async () => {
    // Tooltips are the TOP layer (z-[100], above the z-50 dialog), so one left
    // up by the button that opened the dialog floats over the dialog itself.
    const ui = (withModal: boolean) => (
      <>
        <button title="Export this character">Export</button>
        {withModal && (
          <Modal open onClose={() => {}} title="Export character">
            body
          </Modal>
        )}
        <TooltipHost />
      </>
    )
    const { rerender } = render(ui(false))
    const tip = screen.getByRole('tooltip', { hidden: true })
    fireEvent.mouseOver(screen.getByRole('button', { name: 'Export' }))
    await vi.advanceTimersByTimeAsync(700)
    expect(tip.style.display).toBe('block')

    rerender(ui(true))
    expect(tip.style.display).toBe('none')
  })

  it('an opening side panel sweeps a live tooltip', async () => {
    const ui = (withPanel: boolean) => (
      <>
        <button title="Open the Houdini utilities">Utils</button>
        {withPanel && (
          <SidePanel open onClose={() => {}} title="Houdini utilities">
            body
          </SidePanel>
        )}
        <TooltipHost />
      </>
    )
    const { rerender } = render(ui(false))
    const tip = screen.getByRole('tooltip', { hidden: true })
    fireEvent.mouseOver(screen.getByRole('button', { name: 'Utils' }))
    await vi.advanceTimersByTimeAsync(700)
    expect(tip.style.display).toBe('block')

    rerender(ui(true))
    expect(tip.style.display).toBe('none')
  })

  it('hides when the window loses focus to an external tool', async () => {
    // Launching Daz/Unreal/Houdini (or revealing a path in Explorer) moves the
    // pointer nowhere: no mouseleave, no anchor blur. Without this the tooltip
    // stays painted over the app while the other tool is in front.
    render(
      <>
        <button title="Open this scene in Daz Studio">Open</button>
        <TooltipHost />
      </>,
    )
    const tip = screen.getByRole('tooltip', { hidden: true })
    fireEvent.mouseOver(screen.getByRole('button'))
    await vi.advanceTimersByTimeAsync(700)
    expect(tip.style.display).toBe('block')

    fireEvent.blur(window)
    expect(tip.style.display).toBe('none')
  })

  it('hides when the window is hidden (minimized) without a blur', async () => {
    render(
      <>
        <button title="Open this scene in Daz Studio">Open</button>
        <TooltipHost />
      </>,
    )
    const tip = screen.getByRole('tooltip', { hidden: true })
    fireEvent.mouseOver(screen.getByRole('button'))
    await vi.advanceTimersByTimeAsync(700)
    expect(tip.style.display).toBe('block')

    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    fireEvent(document, new Event('visibilitychange'))
    expect(tip.style.display).toBe('none')
    hidden.mockRestore()
  })

  it('shows immediately on KEYBOARD focus and never overwrites an existing label', async () => {
    render(
      <>
        <button title="Save the character" aria-label="Save">
          Save
        </button>
        <TooltipHost />
      </>,
    )
    const button = screen.getByRole('button')
    // The keypress is the point, not test decoration: focus shows a tooltip
    // only when the user's last input was the keyboard (see the next test).
    fireEvent.keyDown(document, { key: 'Tab' })
    button.focus()
    expect(button.getAttribute('aria-label')).toBe('Save') // untouched
    await vi.advanceTimersByTimeAsync(0)
    expect(screen.getByRole('tooltip', { hidden: true }).textContent).toBe('Save the character')
  })

  it('stays hidden for focus the APP moved — a closing overlay restoring its opener', async () => {
    // The bug this guards: Modal/SidePanel sweep the tooltip away on open
    // (closeTooltip), then restore focus to the control that opened them on
    // close — and a focus tooltip shows at 0ms, so the tooltip the sweep hid
    // came straight back over the app, under a cursor that had never moved.
    render(
      <>
        <button title="Utils — install DTH content & plugins" aria-label="Utils">
          <svg />
        </button>
        <TooltipHost />
      </>,
    )
    const button = screen.getByRole('button')
    // The user CLICKED it open; they did not tab to it.
    fireEvent.pointerDown(button)
    // …and now the overlay closes and hands focus back, as Radix's FocusScope
    // does on unmount.
    button.focus()
    expect(document.activeElement).toBe(button)
    await vi.advanceTimersByTimeAsync(1000)
    expect(screen.getByRole('tooltip', { hidden: true }).style.display).toBe('none')
    // The gate is about FOCUS: a real hover over the same control still shows.
    fireEvent.mouseOver(button)
    await vi.advanceTimersByTimeAsync(1000)
    expect(screen.getByRole('tooltip', { hidden: true }).style.display).toBe('block')
  })
})
