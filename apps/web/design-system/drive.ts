const TIMEOUT_MS = 5000

const matches = (text: string, name: string | RegExp) =>
  typeof name === 'string' ? text.trim() === name : name.test(text)

function find(root: HTMLElement, name: string | RegExp): HTMLElement | undefined {
  const all = root.querySelectorAll<HTMLElement>('button, a, [role]')
  for (const el of all) {
    const label = el.getAttribute('aria-label') ?? el.textContent ?? ''
    if (matches(label, name)) return el
  }
  return undefined
}

/** Click the first button/link/role element whose ARIA label or text matches. */
export async function clickByName(root: HTMLElement, name: string | RegExp): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    const el = find(root, name)
    if (el) {
      el.click()
      return
    }
    // Polling is inherently sequential.
    // oxlint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`clickByName: nothing named ${String(name)} within ${TIMEOUT_MS}ms`)
}
