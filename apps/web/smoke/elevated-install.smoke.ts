import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'
import type { TauriMockSeed } from './tauri-mock.ts'

// Issue #342: installing into Program Files means running elevated, and Windows
// UIPI then silently kills drag-and-drop from a normal-elevation Explorer into
// the elevated window. After a SUCCESSFUL real plugin install the studio now
// offers the way back: a "Restart normally" notice whose button relaunches
// de-elevated (Explorer hands off the launch; the project reopens via its
// .dcsp association). The notice must NOT show on a dry run, on a failed
// install (the error hint owns that), or in a normal-elevation session.

const EXPORTER_DIR = 'X:/DazToHue/Exporter'
const DAZ_INSTALL = 'C:/Program Files/DAZ 3D/DAZStudio4'
const SETTINGS = `${P.appData}/settings.json`

function elevatedSeed(elevated: boolean): TauriMockSeed {
  const seed = buildSeed({ activeProjectFile: P.dcsp, dazInstallFolder: DAZ_INSTALL })
  seed.elevated = elevated
  // A single-mode Exporter release: the folder itself holds the DLL (its fake
  // bytes carry no PE version resource — version stays '', which is allowed).
  seed.files[`${EXPORTER_DIR}/dth_exporter.dll`] = 'dll-fixture'
  seed.files[SETTINGS] = JSON.stringify({
    ...(JSON.parse(seed.files[SETTINGS]) as Record<string, unknown>),
    dthExporterFolder: EXPORTER_DIR,
  })
  return seed
}

async function openGeneralSettings(page: Page, seed: TauriMockSeed) {
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  // Via the header link, never a hard goto (main.tsx's one-time startup
  // navigation bounces a reload straight back home).
  await page.getByRole('link', { name: 'Settings' }).click()
  await page.getByRole('tab', { name: 'General' }).click()
  await expect(page.getByText('Setup DTH Exporter Plugin Release')).toBeVisible()
}

/** The Exporter install section (the Runner section repeats the button names). */
const exporterSection = (page: Page) =>
  page.locator('section').filter({ hasText: 'Setup DTH Exporter Plugin Release' })

const relaunchCalls = (page: Page) =>
  page.evaluate(
    () =>
      (window as any).__tauriMock.calls.filter(
        (c: { cmd: string }) => c.cmd === 'relaunch_deelevated',
      ) as Array<{ cmd: string; args: { projectFile: string } }>,
  )

test('elevated: successful install offers the de-elevated restart, dry run does not', async ({
  page,
}) => {
  await openGeneralSettings(page, elevatedSeed(true))
  const section = exporterSection(page)

  // A dry run also produces a report — but nothing was installed, so no notice.
  await section.getByRole('button', { name: 'Dry run' }).click()
  await expect(page.getByText(/Dry run — would copy/)).toBeVisible()
  await expect(section.getByText(/Restart normally/)).not.toBeVisible()

  // The real install: report + toast + the restart offer.
  await section.getByRole('button', { name: 'Install', exact: true }).click()
  await expect(page.getByText('Installed 1 file(s)')).toBeVisible()
  await expect(
    section.getByText(/running as administrator, and Windows silently blocks drag-and-drop/),
  ).toBeVisible()

  // The one-click restart hands off with THIS window's project file, so the
  // de-elevated instance reopens the same project.
  await section.getByRole('button', { name: 'Restart normally' }).click()
  await expect
    .poll(async () => (await relaunchCalls(page)).map((c) => c.args.projectFile))
    .toEqual([P.dcsp])

  expect(
    await page.evaluate(() => (window as any).__tauriMock.unhandled as Array<string>),
  ).toEqual([])
})

test('not elevated: a successful install shows no restart notice', async ({ page }) => {
  await openGeneralSettings(page, elevatedSeed(false))
  const section = exporterSection(page)

  await section.getByRole('button', { name: 'Install', exact: true }).click()
  await expect(page.getByText('Installed 1 file(s)')).toBeVisible()
  await expect(section.getByText(/Restart normally/)).not.toBeVisible()

  expect(
    await page.evaluate(() => (window as any).__tauriMock.unhandled as Array<string>),
  ).toEqual([])
})
