import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// Ctrl on the live **Working..** button turns it into **Abort**.
//
// Once the Runner RENAMES the job file (the claim), aborting used to be over:
// the button only offered "stop watching", and the claimed file stayed on disk
// — so a batch that stalled inside a Daz that is still running left every later
// export and scan refusing with "a batch is waiting for Daz Studio", with no way
// out from the character page. Holding Ctrl deletes the file and resets the
// button; a plain click still only stops the watch, and must not delete
// anything.

const DAZ_INSTALL = 'C:/Program Files/DAZ 3D/DAZStudio4'
const SCRIPTS_ROOT = `${P.dazLib}/Scripts/DTH-Character-Studio`
const PENDING_JOB = `${SCRIPTS_ROOT}/dth_exporter_jobs.json`
const RUNNING_JOB = `${SCRIPTS_ROOT}/running_dth_exporter_jobs.json`

const fileExists = (page: Page, path: string) =>
  page.evaluate((p) => ((window as any).__tauriMock.files as Map<string, string>).has(p), path)
const unhandledCommands = (page: Page) =>
  page.evaluate(() => (window as any).__tauriMock.unhandled as Array<string>)

/**
 * Stand in for a Runner that CLAIMED the batch and is working it: the pending
 * file is renamed (the claim) and carries a sub-100 progress — and Daz counts
 * as running from now on, without which the studio would read the same file as
 * a dead run and clean it up itself.
 */
async function runnerClaimsBatch(page: Page) {
  await page.evaluate(
    ([pending, running]) => {
      const mock = (window as any).__tauriMock
      const files = mock.files as Map<string, string>
      const job = JSON.parse(files.get(pending) ?? '{}')
      files.delete(pending)
      files.set(
        running,
        JSON.stringify({
          ...job,
          progress: 50,
          jobsDone: 0,
          jobs: job.jobs.map((row: Record<string, unknown>) => ({ ...row, status: 'running' })),
        }),
      )
      mock.dazRunning = true
    },
    [PENDING_JOB, RUNNING_JOB],
  )
}

/** Hand the character's one scene off, then have the Runner claim it. Leaves the
 *  header button in its live "Working.." state. */
async function startAndClaim(page: Page) {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true, dazInstallFolder: DAZ_INSTALL })
  seed.files[`${SCRIPTS_ROOT}/Demo/Kira/.Bulk_ROM_Export.dsa`] = '// bulk-export fixture'
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()
  await page.getByRole('button', { name: 'DTH Export' }).click()
  // Daz only: the linked Houdini project comes pre-selected, and this spec is
  // about the Daz leg's own button.
  await page.getByRole('checkbox', { name: /Run in Kira/ }).uncheck()
  await page.getByRole('button', { name: 'Start' }).click()
  // Daz was not running, so the handoff returns as soon as the file is written.
  await expect.poll(() => fileExists(page, PENDING_JOB)).toBe(true)
  await runnerClaimsBatch(page)
  await expect(page.getByRole('button', { name: /Working\.\./ })).toBeVisible({ timeout: 15_000 })
}

test('Ctrl turns the running export into Abort — and it deletes the claimed job file', async ({
  page,
}) => {
  await startAndClaim(page)

  await page.keyboard.down('Control')
  const abort = page.getByRole('button', { name: 'Abort' })
  await expect(abort).toBeVisible()
  await abort.click()
  await page.keyboard.up('Control')

  // The claimed file is gone, the button is back to a normal export, and the
  // toast says what happened to the run still going in Daz.
  await expect.poll(() => fileExists(page, RUNNING_JOB)).toBe(false)
  await expect(page.getByText(/Export aborted/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'DTH Export' })).toBeVisible()
  expect(await unhandledCommands(page)).toEqual([])
})

test('releasing Ctrl puts the progress button back — the run is untouched', async ({ page }) => {
  await startAndClaim(page)

  await page.keyboard.down('Control')
  await expect(page.getByRole('button', { name: 'Abort' })).toBeVisible()
  await page.keyboard.up('Control')
  await expect(page.getByRole('button', { name: /Working\.\./ })).toBeVisible()
  expect(await fileExists(page, RUNNING_JOB)).toBe(true)
})

test('a plain click still only stops watching — the job file stays', async ({ page }) => {
  await startAndClaim(page)

  await page.getByRole('button', { name: /Working\.\./ }).click()
  // The watch is dropped; the file on disk is deliberately NOT touched (the
  // batch belongs to Daz, and the next handoff cleans a leftover up).
  expect(await fileExists(page, RUNNING_JOB)).toBe(true)
  await expect(page.getByText(/Export aborted/)).toHaveCount(0)
})
