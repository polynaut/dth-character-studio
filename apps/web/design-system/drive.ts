const TIMEOUT_MS = 5000

const INTERACTIVE = 'button, a[href], [role="button"], [role="tab"], [role="menuitem"], [role="link"], [role="checkbox"], [role="switch"], [role="option"]'

const matches = (text: string, name: string | RegExp) =>
  typeof name === 'string' ? text.trim() === name : name.test(text)

// Containers (dialog, tablist, region) are excluded by INTERACTIVE, so a regex can't hit an ancestor of the real control.
function find(root: HTMLElement, name: string | RegExp): HTMLElement | undefined {
  for (const el of root.querySelectorAll<HTMLElement>(INTERACTIVE)) {
    const label = el.getAttribute('aria-label') ?? el.textContent ?? ''
    const disabled = el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true'
    if (!disabled && el.getClientRects().length > 0 && matches(label, name)) return el
  }
  return undefined
}

/** Click the first enabled, visible button/link/tab-like element whose ARIA label or text matches. */
export async function clickByName(root: HTMLElement, name: string | RegExp): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    const el = find(root, name)
    if (el) {
      // Radix triggers (tabs, menus) activate on mousedown, not click.
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }))
      }
      return
    }
    // Polling is inherently sequential.
    // oxlint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`clickByName: nothing named ${String(name)} within ${TIMEOUT_MS}ms`)
}

/** Resolve once `cond` is truthy; for state that lands after a click (a scan, a panel). */
export async function waitFor(cond: () => unknown): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    if (cond()) return
    // oxlint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`waitFor: ${cond.toString()} not met within ${TIMEOUT_MS}ms`)
}
