import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// "Export only" runs the exporter over each scene's SAVED ROM animation, so a
// scene without one has nothing to export. The row controls refuse those rows,
// but the rule also has to hold at the decision point — the selection outlives
// the controls (rows are checkable while the affected-probe runs, and a failed
// probe leaves every row reading "no ROM" without re-seeding). Without the gate
// the run reaches the api layer, which throws AFTER the dialog has closed.

const DAZ_INSTALL = 'C:/Program Files/DAZ 3D/DAZStudio4'
/** Where a scene's saved ROM animation lives: `<dir>/rom-animations/<stem>_ROM.duf`. */
const romAnimation = (scene: string) => {
  const slash = scene.lastIndexOf('/')
  const dir = scene.slice(0, slash)
  const stem = scene.slice(slash + 1).replace(/\.duf$/i, '')
  return `${dir}/rom-animations/${stem}_ROM.duf`
}

const unhandledCommands = (page: Page) =>
  page.evaluate(() => (window as any).__tauriMock.unhandled as Array<string>)

async function openExportDialog(page: Page) {
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()
  await page.getByRole('button', { name: 'DTH Export' }).click()
}

test('export only: refuses to start while a selected scene has no ROM animation', async ({
  page,
}) => {
  // Two linked scenes, and a saved ROM animation for NEITHER.
  const seed = buildSeed({
    activeProjectFile: P.dcsp,
    demo: true,
    extraScene: true,
    dazInstallFolder: DAZ_INSTALL,
  })
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await openExportDialog(page)
  await page.getByRole('button', { name: /Export only/ }).click()

  // Nothing is pre-checked (no scene has an unexported ROM), so tick one by
  // hand — its checkbox is disabled, which is the FIRST line of defence.
  const row = page.getByRole('checkbox', { name: /Export KiraDefault/ })
  await expect(row).toBeDisabled()
  // …and with nothing selectable, Start stays off for the plain reason.
  await expect(page.getByRole('button', { name: 'Start' })).toBeDisabled()

  expect(await unhandledCommands(page)).toEqual([])
})

test('export only: one scene with a ROM animation, one without — the run is gated on the pair', async ({
  page,
}) => {
  const seed = buildSeed({
    activeProjectFile: P.dcsp,
    demo: true,
    extraScene: true,
    dazInstallFolder: DAZ_INSTALL,
  })
  // Only the PRIMARY has a saved ROM animation; the outfit scene does not.
  seed.files[romAnimation(P.scene)] = 'duf-rom-animation'
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await openExportDialog(page)
  await page.getByRole('button', { name: /Export only/ }).click()

  // The scene WITH a ROM animation is selectable and pre-checked (it has never
  // been exported, so its ROM is outstanding); the one without is refused.
  const primary = page.getByRole('checkbox', { name: /Export KiraDefault/ })
  const outfit = page.getByRole('checkbox', { name: /Export KiraSummertide/ })
  await expect(primary).toBeEnabled()
  await expect(primary).toBeChecked()
  await expect(outfit).toBeDisabled()

  // Start is available for the valid selection — the gate blocks a bad pair,
  // not the feature.
  await expect(page.getByRole('button', { name: 'Start' })).toBeEnabled()
  await expect(page.getByText(/exports the saved ROM animation/)).toHaveCount(0)

  expect(await unhandledCommands(page)).toEqual([])
})
