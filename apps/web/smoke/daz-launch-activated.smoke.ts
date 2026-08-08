import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// WHICH Daz the studio starts.
//
// The bug this guards: nothing carried the activated installation to the
// launchers. Opening a scene went through the shell, so Windows' `.duf`
// association decided — whichever Daz registered the file type last — and the
// exporter's launch fell back to a hardcoded newest-first probe. On a machine
// with DS4 and DS6 installed, activating DS4 in Settings changed neither, while
// the Exporter plugin was installed into DS4. The studio started DS6 and the
// plugin appeared missing.

const DS4 = 'C:/Program Files/DAZ 3D/DAZStudio4'

const callsNamed = (page: Page, cmd: string) =>
  page.evaluate(
    (name) =>
      ((window as any).__tauriMock.calls as Array<{ cmd: string; args: any }>)
        .filter((c) => c.cmd === name)
        .map((c) => c.args),
    cmd,
  )

async function openCharacter(page: Page, extra: Record<string, string> = {}) {
  const seed = buildSeed({ demo: true, activeProjectFile: P.dcsp, dazInstallFolder: DS4 })
  for (const [path, body] of Object.entries(extra)) seed.files[path] = body
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()
}

test('opening a scene starts the ACTIVATED Daz, not the file association', async ({ page }) => {
  await openCharacter(page)

  // The card's open icon is a MENU (Open Original / Open ROM Animation) — a
  // plain click only opens it.
  await page.getByRole('button', { name: /Open in Daz/ }).first().click()
  await page.getByRole('button', { name: /Open Original/ }).click()

  await expect
    .poll(() => callsNamed(page, 'launch_daz_studio'))
    .toEqual([{ installFolder: DS4, scenePath: P.scene }])
  // NOT handed to the shell: that route obeys the OS association, which is the
  // whole reason the wrong Daz opened.
  expect(await callsNamed(page, 'shell_open_file')).toEqual([])
})

test('the exporter launch carries the activated installation too', async ({ page }) => {
  // The batch runs the HIDDEN bulk script; a missing one is refused before any
  // job file is written, so there would be no launch to assert.
  await openCharacter(page, {
    [`${P.scriptsDir}/.Bulk_ROM_Export.dsa`]: '// bulk-export fixture',
  })
  await page.getByRole('button', { name: 'DTH Export' }).click()
  await page.getByRole('button', { name: 'Start' }).click()

  // Scene-less startup — the Runner plugin picks the job file up — but it must
  // still start the Daz the user activated.
  await expect
    .poll(() => callsNamed(page, 'launch_daz_studio'))
    .toContainEqual({ installFolder: DS4, scenePath: '' })
})
