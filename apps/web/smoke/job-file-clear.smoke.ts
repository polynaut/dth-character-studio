import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// Settings → App Data can clear a STRANDED exporter job file.
//
// One file in the Daz library carries every batch handoff, and every writer
// refuses while one is there ("a batch is waiting for Daz Studio"). When the
// batch never starts — Daz closed mid-handoff, the Runner never picked it up —
// nothing else in the app can remove it: Abort lives on the character that
// started the batch, and a batch nobody owns has no such page. So the readout
// has to name what is there, how old it is, and whether Daz might still be
// working through it, before offering to delete it.

const JOBS_ROOT = `${P.dazLib}/Scripts/DTH-Character-Studio`
const PENDING = `${JOBS_ROOT}/dth_exporter_jobs.json`
const RUNNING = `${JOBS_ROOT}/running_dth_exporter_jobs.json`

const mockFiles = (page: Page) =>
  page.evaluate(() => [...((window as any).__tauriMock.files as Map<string, string>).keys()])

const jobFile = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    version: 1,
    type: 'bulk-export',
    progress: 0,
    jobs: [
      { scenePath: P.scene, scriptPath: `${P.scriptsDir}/.Bulk_ROM_Export.dsa`, status: 'pending' },
    ],
    ...over,
  })

/** Settings → App Data, in a project window. */
async function openAppData(page: Page, files: Record<string, string> = {}) {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true })
  for (const [path, body] of Object.entries(files)) seed.files[path] = body
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: 'Settings' }).click()
  await page.getByRole('tab', { name: 'App Data' }).click()
}

test('no job file: the readout says so, and offers nothing to delete', async ({ page }) => {
  await openAppData(page)
  await expect(page.getByText(/No job file/)).toBeVisible()
  await expect(page.getByRole('button', { name: /Delete job file/ })).toHaveCount(0)
})

test('a stranded pending file is named, dated, and cleared on confirm', async ({ page }) => {
  await openAppData(page, { [PENDING]: jobFile() })

  // Named by the file that is actually there — a user has to be able to find it
  // in the Daz library — with what it holds and how old it is.
  await expect(page.getByText('dth_exporter_jobs.json')).toBeVisible()
  await expect(page.getByText(/written, never claimed/)).toBeVisible()
  await expect(page.getByText(/1 job/)).toBeVisible()
  // Never claimed by a Runner ⇒ no "may be live" warning.
  await expect(page.getByText(/may be working through this batch/)).toHaveCount(0)

  // Deleting is two-step, like every other destructive action here.
  await page.getByRole('button', { name: /Delete job file/ }).click()
  await page.getByRole('button', { name: 'Yes, delete' }).click()

  await expect.poll(() => mockFiles(page)).not.toContain(PENDING)
  await expect(page.getByText(/No job file/)).toBeVisible()
})

test('a part-worked claimed file warns first — deleting it strands a live run', async ({ page }) => {
  await openAppData(page, {
    [RUNNING]: jobFile({
      progress: 50,
      jobsDone: 1,
      jobs: [
        { scenePath: P.scene, scriptPath: `${P.scriptsDir}/.Bulk_ROM_Export.dsa`, status: 'done' },
        { scenePath: P.scene2, scriptPath: `${P.scriptsDir}/.Bulk_ROM_Export.dsa`, status: 'pending' },
      ],
    }),
  })

  await expect(page.getByText('running_dth_exporter_jobs.json')).toBeVisible()
  await expect(page.getByText(/claimed by the Runner — 50% done/)).toBeVisible()
  // The judgement that separates housekeeping from sabotage.
  await expect(page.getByText(/may be working through this batch/)).toBeVisible()
  // Still deletable — a Daz that died holding it is exactly why this exists —
  // but only after the warning and the confirm.
  await page.getByRole('button', { name: /Delete job file/ }).click()
  await page.getByRole('button', { name: 'Yes, delete' }).click()
  await expect.poll(() => mockFiles(page)).not.toContain(RUNNING)
})
