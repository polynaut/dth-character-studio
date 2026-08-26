// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Modal } from './modal.tsx'

afterEach(cleanup)

function renderModal(onClose = vi.fn()) {
  const utils = render(
    <Modal open onClose={onClose} title="Dialog">
      <p>Body</p>
    </Modal>,
  )
  return { ...utils, onClose }
}

describe('Modal', () => {
  it('swallows the backdrop click that re-focuses the window; the next one dismisses', async () => {
    const { onClose } = renderModal()
    // Radix arms its outside-pointerdown listener a tick after mount.
    await new Promise((resolve) => setTimeout(resolve, 0))
    window.dispatchEvent(new Event('blur'))
    window.dispatchEvent(new Event('focus'))
    // Radix Dialog defers the outside dismiss to the click that follows the
    // pointerdown (its originalEvent stays the pointerdown the guard marked).
    fireEvent.pointerDown(document.body)
    fireEvent.click(document.body)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.pointerDown(document.body)
    fireEvent.click(document.body)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a click inside a dismiss-exempt region (the host toasts) never dismisses', async () => {
    // Same hole as SidePanel's: the toaster mounts outside the Radix layer, so
    // dismissing the toast an action raised would close the dialog that raised
    // it. See overlay-exempt.ts.
    const toastLayer = document.createElement('div')
    toastLayer.setAttribute('data-overlay-dismiss-exempt', '')
    const toastClose = document.createElement('button')
    toastLayer.appendChild(toastClose)
    document.body.appendChild(toastLayer)
    try {
      const { onClose } = renderModal()
      await new Promise((resolve) => setTimeout(resolve, 0))
      fireEvent.pointerDown(toastClose)
      fireEvent.click(toastClose)
      expect(onClose).not.toHaveBeenCalled()
      fireEvent.pointerDown(document.body)
      fireEvent.click(document.body)
      expect(onClose).toHaveBeenCalledTimes(1)
    } finally {
      toastLayer.remove()
    }
  })
})
