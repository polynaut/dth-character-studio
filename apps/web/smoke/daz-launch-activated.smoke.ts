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
const DS6 = 'C:/Program Files/DAZ 3D/DAZStudio6'

const callsNamed = (page: Page, cmd: string) =>
  page.evaluate(
    (name) =>
      ((window as any).__tauriMock.calls as Array<{ cmd: string; args: any }>)
        .filter((c) => c.cmd === name)
        .map((c) => c.args),
    cmd,
  )

async function openCharacter(
  page: Page,
  extra: Record<string, string> = {},
  settings: Record<string, unknown> = {},
) {
  const seed = buildSeed({ demo: true, activeProjectFile: P.dcsp, dazInstallFolder: DS4 })
  for (const [path, body] of Object.entries(extra)) seed.files[path] = body
  const settingsPath = `${P.appData}/settings.json`
  if (Object.keys(settings).length > 0) {
    seed.files[settingsPath] = JSON.stringify({
      ...JSON.parse(seed.files[settingsPath] ?? '{}'),
      ...settings,
    })
  }
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

test('“Export only”: an open DS6 does not count as the DS4 the batch needs', async ({ page }) => {
  // The measured bug. With DS6 activated and "Export only" pointing at DS4, the
  // handoff asked the GLOBAL "is Daz running?" — an open DS6 answered yes, so
  // the studio concluded there was nothing to launch, and the batch meant for
  // DS4 sat in a pending job file no Runner ever claimed. Both installs ship an
  // executable called DAZStudio.exe; only the install FOLDER tells them apart.
  await openCharacter(
    page,
    { [`${P.scriptsDir}/.Bulk_ROM_Export.dsa`]: '// bulk-export fixture' },
    {
      dazInstallKey: 'dzstudio6installdir-64',
      dazInstallFolder: DS6,
      dazExportInstallKey: 'dzstudio4installdir-64',
      dazExportInstallFolder: DS4,
    },
  )
  // A Daz is up — and it is DS6, the one the batch is NOT for.
  await page.evaluate(() => {
    const mock = (window as any).__tauriMock
    mock.dazRunning = true
    mock.dazRunningFolder = 'C:/Program Files/DAZ 3D/DAZStudio6'
  })

  await page.getByRole('button', { name: 'DTH Export' }).click()
  await page.getByRole('button', { name: 'Start' }).click()

  // The probe is asked about the EXPORT install…
  await expect
    .poll(() => callsNamed(page, 'daz_studio_running'))
    .toContainEqual({ installFolder: DS4 })
  // …and, since that one is closed, DS4 is actually started.
  await expect
    .poll(() => callsNamed(page, 'launch_daz_studio'))
    .toContainEqual({ installFolder: DS4, scenePath: '' })
})
