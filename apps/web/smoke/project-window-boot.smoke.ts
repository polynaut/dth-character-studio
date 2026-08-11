import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

// A project window must never paint the Home (recents) screen on its way to the
// project it was opened for.
//
// Every window loads the SAME document, so the URL it starts on says nothing
// about which project it is for — the config window starts on `/`, which the
// Home route matches. Mounting the router before the window→project lookup had
// resolved therefore made "recents for half a second, then a jump" the designed
// boot order rather than a race that is sometimes lost: Home's loader is one
// small local read, while the project's is a manifest read plus a character
// scan, so Home always won. `main.tsx` now resolves and LOADS the destination
// before the first render; these specs are the guard that it stays that way.

/** Watch from the first byte: did the Home screen ever reach the DOM? "Open
 *  project…" is Home's alone (the assets grid's "Open project in Houdini" does
 *  not contain the ellipsis form). */
const watchForHome = () => {
  const flag = window as unknown as { __sawHome: boolean }
  flag.__sawHome = false
  const look = () => {
    if (document.body?.textContent?.includes('Open project…')) flag.__sawHome = true
  }
  // An init script runs at document_start, where `document.documentElement` is
  // not there yet — observing it directly throws and the watcher dies silently
  // (measured: the flag then reads false even for a window that DID render
  // Home). The poll is the safety net that works from the first tick; the
  // observer takes over for exactness once there is a tree to watch.
  const poll = setInterval(look, 8)
  document.addEventListener('DOMContentLoaded', () => {
    clearInterval(poll)
    look()
    new MutationObserver(look).observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    })
  })
}

const sawHome = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { __sawHome: boolean }).__sawHome)

/**
 * Make one command take as long as real IPC does. Without this the test has no
 * teeth: this fake answers `active_project_file` from an in-memory map in well
 * under a frame, so even the OLD boot order won its race here and never painted
 * Home — while on a real machine that same lookup is a round trip into Rust and
 * always lost it. 300ms is the flash the bug report described, simulated.
 *
 * Wraps the mock's own `invoke`, so it must be added AFTER `installTauriMock`.
 */
const slowCommand = ({ cmd, ms }: { cmd: string; ms: number }) => {
  const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: Function } })
    .__TAURI_INTERNALS__
  const inner = internals.invoke
  internals.invoke = async (c: string, args: unknown, options: unknown) => {
    if (c === cmd) await new Promise((resolve) => setTimeout(resolve, ms))
    return inner(c, args, options)
  }
}

test('a project window lands on the project without flashing Home', async ({ page }) => {
  await page.addInitScript(watchForHome)
  await page.addInitScript(installTauriMock, buildSeed({ demo: true, activeProjectFile: P.dcsp }))
  await page.addInitScript(slowCommand, { cmd: 'active_project_file', ms: 300 })
  await page.goto('/')

  // The project overview is what this window is for…
  await expect(page.getByRole('link', { name: /Kira/ })).toBeVisible()
  // …and the recents screen was never on the way there.
  expect(await sawHome(page)).toBe(false)
})

test('a Home window still lands on Home', async ({ page }) => {
  // The other half of the same boot decision: no `.dcsp` pinned to this window
  // means the recents screen IS the destination, not a flash.
  await page.addInitScript(watchForHome)
  await page.addInitScript(installTauriMock, buildSeed({ activeProjectFile: '' }))
  await page.goto('/')

  await expect(page.getByRole('button', { name: 'Open project…' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'New project' })).toBeVisible()
  // Proves the flash detector above actually fires — a guard that never trips
  // would make the project-window test pass for the wrong reason.
  expect(await sawHome(page)).toBe(true)
})

test('the native New Project menu still opens the create panel on a fresh Home window', async ({
  page,
}) => {
  // `?new=1` is how the native menu asks a BRAND NEW window to open the
  // create-project panel (an event would race the webview's listener). It rides
  // on the start location, so the pre-paint routing must preserve it.
  await page.addInitScript(installTauriMock, buildSeed({ activeProjectFile: '' }))
  await page.goto('/?new=1')

  await expect(page.getByRole('heading', { name: 'New project' })).toBeVisible()
})
