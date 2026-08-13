import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// "Export only" runs the exporter over each scene's SAVED ROM animation, so a
// scene without one has nothing to export. Once the panel's scene probe has
// landed, the row controls keep such scenes out of the selection — so the gate
// exists for the two windows the controls cannot cover, and that is what these
// specs demonstrate:
//
// 1. The probe is STILL RUNNING: rows are checkable while nothing is known, so
//    Start waits as a disabled "Checking scenes…" until the probe lands.
// 2. The landed status has gone STALE under the selection (the ROM animation
//    deleted after the check): Start re-verifies at the decision point and
//    refuses IN the dialog — fresh row states, the notice naming the scene,
//    and no handoff written.

const DAZ_INSTALL = 'C:/Program Files/DAZ 3D/DAZStudio4'
/** Where a scene's saved ROM animation lives: `<dir>/rom-animations/<stem>_ROM.duf`. */
const romAnimation = (scene: string) => {
  const slash = scene.lastIndexOf('/')
  const dir = scene.slice(0, slash)
  const stem = scene.slice(slash + 1).replace(/\.duf$/i, '')
  return `${dir}/rom-animations/${stem}_ROM.duf`
}
/** The handoff-stamps file the scene probe (fetchExecuteScenes) reads FIRST —
 *  holding it holds the whole probe with the panel's status un-landed. */
const STAMPS = `${P.charMeta}/.dth_execute_stamps.json`

const unhandledCommands = (page: Page) =>
  page.evaluate(() => (window as any).__tauriMock.unhandled as Array<string>)
/** Every path in the fake filesystem — for "no job file was written" checks. */
const mockFiles = (page: Page) =>
  page.evaluate(() => [...((window as any).__tauriMock.files as Map<string, string>).keys()])

async function openExportOnly(page: Page) {
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()
  await page.getByRole('button', { name: 'DTH Export' }).click()
  // One page now — what the run does is the Daz Mode dropdown.
  await page.locator('#daz-mode').click()
  await page.getByRole('option', { name: /Export only/ }).click()
}

test('start waits out the scene probe — a row checked mid-flight cannot slip through', async ({
  page,
}) => {
  const seed = buildSeed({
    activeProjectFile: P.dcsp,
    demo: true,
    extraScene: true,
    dazInstallFolder: DAZ_INSTALL,
  })
  // Only the PRIMARY has a saved ROM animation…
  seed.files[romAnimation(P.scene)] = 'duf-rom-animation'
  // …and the scene probe is frozen mid-flight, on its very first read.
  seed.holdPaths = [STAMPS]
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await openExportOnly(page)

  // While nothing is known every row is checkable — tick the no-ROM outfit.
  const outfit = page.getByRole('checkbox', { name: /Export KiraSummertide/ })
  await expect(outfit).toBeEnabled()
  await outfit.check()

  // The gate: no Start while the probe is in flight — the button says why.
  await expect(page.getByRole('button', { name: 'Checking scenes…' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Start' })).toHaveCount(0)

  // The probe lands: the pre-selection re-seeds (primary only — its saved ROM
  // is unexported), the no-ROM row is refused, and Start opens for the VALID
  // selection — the gate blocks the unknown window, not the feature.
  await page.evaluate(() => (window as any).__tauriMock.releaseHeld())
  await expect(page.getByRole('checkbox', { name: /Export KiraDefault/ })).toBeChecked()
  await expect(outfit).not.toBeChecked()
  await expect(outfit).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Start' })).toBeEnabled()

  // Nothing was handed to Daz while the gate held.
  expect((await mockFiles(page)).filter((p) => p.endsWith('dth_exporter_jobs.json'))).toEqual([])
  expect(await unhandledCommands(page)).toEqual([])
})

test('start re-verifies the ROM animations — one deleted after the probe refuses in the dialog', async ({
  page,
}) => {
  const seed = buildSeed({
    activeProjectFile: P.dcsp,
    demo: true,
    extraScene: true,
    dazInstallFolder: DAZ_INSTALL,
  })
  // Only the PRIMARY has a saved ROM animation; the probe pre-checks it (never
  // exported ⇒ outstanding) and Start opens.
  seed.files[romAnimation(P.scene)] = 'duf-rom-animation'
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await openExportOnly(page)

  const primary = page.getByRole('checkbox', { name: /Export KiraDefault/ })
  await expect(primary).toBeChecked()
  const start = page.getByRole('button', { name: 'Start' })
  await expect(start).toBeEnabled()

  // The ROM animation vanishes AFTER the check (deleted or moved in Daz) — the
  // panel's status is now stale under a checked row.
  await page.evaluate((path) => {
    ;((window as any).__tauriMock.files as Map<string, string>).delete(path)
  }, romAnimation(P.scene))

  // Start re-probes at the decision point and refuses IN the dialog: fresh row
  // states, the gate's notice naming the scene, Start off — and no handoff.
  await start.click()
  await expect(page.getByText(/No saved ROM animation for KiraDefault/)).toBeVisible()
  await expect(page.getByText(/one selected scene has none/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start' })).toBeDisabled()
  expect((await mockFiles(page)).filter((p) => p.endsWith('dth_exporter_jobs.json'))).toEqual([])

  // The refused row is checked-but-refused — UNCHECKING must still work (the
  // notice says "unselect it"), and doing so clears the gate's notice.
  await expect(primary).toBeEnabled()
  await primary.uncheck()
  await expect(page.getByText(/one selected scene has none/)).toHaveCount(0)
  // Start stays off now for the plain reason: nothing is selected anymore.
  await expect(page.getByRole('button', { name: 'Start' })).toBeDisabled()

  expect(await unhandledCommands(page)).toEqual([])
})
