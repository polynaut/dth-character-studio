import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// The Houdini Utils drawer's backup lifecycle: a real run leaves one rolling
// copy per project it wrote, the drawer says nothing about it while things
// work, and CLOSING the drawer is where the copies are collected — because
// that is the moment they stop being useful.
//
// Neither Houdini nor hython exists here; the fake answers the material-util
// command from the request file the studio writes and models `_backup` the way
// the Python does (a real file at `<dir>/backup/<name>_dthbak<ext>`), so what
// this spec asserts is the studio's own half: what it tracks, what it asks, and
// which files it removes.

const HOUDINI_INSTALL = 'C:/Program Files/Side Effects Software/Houdini 22.0.368'
const HOUDINI_DOCS = 'C:/Users/dev/Documents/houdini22.0'
/** Where the fake's `_backup` lands for the demo character's linked project. */
const BACKUP = `${P.charFolder}/houdini/backup/Kira_dthbak.hip`

const fileKeys = (page: Page) =>
  page.evaluate(() => [...(window as any).__tauriMock.files.keys()] as Array<string>)

/** The demo project with a pre-v0.64 `$JOB` — the one case the General tab's
 *  Repair exists for, and the cheapest way to get a run that writes. */
function staleJobSeed() {
  const seed = buildSeed({ demo: true, activeProjectFile: P.dcsp })
  const settingsPath = `${P.appData}/settings.json`
  seed.files[settingsPath] = JSON.stringify({
    ...JSON.parse(seed.files[settingsPath] ?? '{}'),
    houdiniInstallFolder: HOUDINI_INSTALL,
    houdiniDocsFolder: HOUDINI_DOCS,
  })
  seed.files[`${HOUDINI_INSTALL}/bin/hython.exe`] = 'hython-exe-fixture'
  seed.materialScan = { [P.houdini]: [] }
  seed.materialJob = { [P.houdini]: `${P.charFolder}/houdini/houdini-project` }
  return seed
}

/** Open the drawer (it opens on General) and run the `$JOB` repair for real. */
async function repairJob(page: Page) {
  await page.addInitScript(installTauriMock, staleJobSeed())
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()
  await page.getByRole('button', { name: /^Utils/ }).click()
  const drawer = page.getByRole('dialog')
  // The scan landed, and it found the stale `$JOB` the repair acts on.
  await expect(drawer.getByText('Project folder ($JOB)')).toBeVisible()
  await expect(drawer.getByText('differs')).toBeVisible()

  await drawer.getByRole('button', { name: 'Repair project settings' }).click()
  const confirm = page.getByRole('dialog', { name: 'Repair the project settings?' })
  await confirm.getByRole('button', { name: 'Run', exact: true }).click()
  // Named by what the run actually rewrote: this project's timeline was already
  // 30, so the toast must not claim it touched that too.
  await expect(page.getByText(/Repaired \$JOB on 1 project/)).toBeVisible()
  return drawer
}

test('a timeline-only repair says so — and leaves the unread $JOB alone', async ({ page }) => {
  // Queued for its 24 fps alone: without a `materialJob` seed the scan reports
  // no $JOB at all — a value nobody read. The run must fix the timeline and
  // neither make nor claim a $JOB repair on top of it (`op_defaults` skips an
  // unknown value even when the project was queued for the other one).
  const seed = staleJobSeed()
  delete seed.materialJob
  seed.materialFps = { [P.houdini]: 24 }
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()
  await page.getByRole('button', { name: /^Utils/ }).click()
  const drawer = page.getByRole('dialog')

  // The scan landed: the timeline differs — and that alone arms the repair.
  await expect(drawer.getByText('Timeline (FPS)')).toBeVisible()
  await expect(drawer.getByText('differs')).toBeVisible()

  await drawer.getByRole('button', { name: 'Repair project settings' }).click()
  const confirm = page.getByRole('dialog', { name: 'Repair the project settings?' })
  await confirm.getByRole('button', { name: 'Run', exact: true }).click()

  // Anchored on purpose: "$JOB on …" anywhere in this toast would be a claim
  // about a value the scan never read.
  await expect(page.getByText(/^Repaired the timeline on 1 project\.$/)).toBeVisible()
  // The report agrees — the rate moved, and there is no $JOB line to show.
  await expect(drawer.getByText('24 fps → 30 fps')).toBeVisible()
})

test('a run backs the project up silently — the report never mentions it', async ({ page }) => {
  const drawer = await repairJob(page)

  // The copy is on disk…
  expect(await fileKeys(page)).toContain(BACKUP)
  // …and nothing in the drawer says so. "· backup written" on every success
  // only teaches the eye to skip the line that matters.
  await expect(drawer.getByText(/backup/i)).toHaveCount(0)
})

test('closing the drawer offers to remove the session backups', async ({ page }) => {
  const drawer = await repairJob(page)
  await drawer.getByRole('button', { name: 'Close' }).click()

  const ask = page.getByRole('dialog', { name: "Remove this session's backups?" })
  await expect(ask).toBeVisible()
  await expect(ask.getByText('Kira_dthbak.hip')).toBeVisible()

  await ask.getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByText('1 backup removed.')).toBeVisible()
  expect(await fileKeys(page)).not.toContain(BACKUP)
})

test('"Keep them" closes the drawer and leaves the copies alone', async ({ page }) => {
  const drawer = await repairJob(page)
  await drawer.getByRole('button', { name: 'Close' }).click()

  const ask = page.getByRole('dialog', { name: "Remove this session's backups?" })
  // Cancel goes back to the drawer — closing is not forced by asking.
  await ask.getByRole('button', { name: 'Cancel' }).click()
  await expect(drawer).toBeVisible()

  await drawer.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: 'Keep them' }).click()
  await expect(drawer).toHaveCount(0)
  expect(await fileKeys(page)).toContain(BACKUP)
})
