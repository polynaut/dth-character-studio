import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// Tools → Build Genesis Index: one button that hands the hidden
// `.Build_Genesis_Index_Bulk.dsa` (the dialog-free twin of the visible script —
// a Runner batch runs inside a possibly minimized Daz, where a modal is an
// invisible dead stop) to the Runner plugin, so Daz builds and scans every
// generation's stock figures unattended. The row carries an EMPTY scenePath —
// the job contract's "run this script in a new empty scene the plugin creates",
// which is what keeps whatever the user had open out of the scan.

const SCRIPTS_ROOT = `${P.dazLib}/Scripts/DTH-Character-Studio`
const INDEX_SCRIPT = `${SCRIPTS_ROOT}/.Build_Genesis_Index_Bulk.dsa`
const PENDING_JOB = `${SCRIPTS_ROOT}/dth_exporter_jobs.json`
const RUNNING_JOB = `${SCRIPTS_ROOT}/running_dth_exporter_jobs.json`
/** The section gates on the Runner plugin like the export dialog; a configured
 *  install folder the mock can't read resolves to an UNREADABLE runner state,
 *  which deliberately never blocks (see fixtures.ts `dazInstallFolder`). */
const DAZ_INSTALL = 'C:/Program Files/DAZ 3D/DAZStudio4 64-bit'

const fileContent = (page: Page, path: string) =>
  page.evaluate((p) => ((window as any).__tauriMock.files.get(p) ?? null) as string | null, path)
const calledCommands = (page: Page) =>
  page.evaluate(() => ((window as any).__tauriMock.calls as Array<{ cmd: string }>).map((c) => c.cmd))
const unhandledCommands = (page: Page) =>
  page.evaluate(() => (window as any).__tauriMock.unhandled as Array<string>)

/** Reach the tab by CLICKING, never `page.goto('/tools')`: main.tsx runs a
 *  one-time startup navigation (active project → its route) that a hard goto
 *  re-triggers, bouncing straight back out of Tools. */
async function openIndexTab(page: Page) {
  await page.getByRole('link', { name: 'Tools' }).click()
  await page.getByRole('tab', { name: 'Build Genesis Index' }).click()
}

test('build genesis index: installs the runtime and hands the bulk script to the Runner in an empty scene', async ({
  page,
}) => {
  // NOTHING seeded at the scripts root: the handoff self-heals via
  // copyRuntimeFiles first (an app updated since the last save has the new
  // runtime bundled but not installed), so the hidden bulk script must appear
  // on disk — with the studio's app-data folder baked in — before the job
  // points at it.
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true, dazInstallFolder: DAZ_INSTALL })
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await openIndexTab(page)

  // Scoped + exact: the tab trigger and the "…— more information" info popup
  // both carry the same words (name matching is substring by default).
  await page
    .getByRole('tabpanel')
    .getByRole('button', { name: 'Build Genesis Index', exact: true })
    .click()
  await expect(page.getByText(/builds the index in a fresh scene/)).toBeVisible()
  // The handoff is waiting for the launched Daz — un-renamed, so abortable.
  await expect(page.getByRole('button', { name: /Waiting for Daz Studio/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Abort' })).toBeVisible()

  // The self-installed bulk script: dialog-free (`bulk: true`) with the
  // app-data output path baked in at install time.
  const installed = await fileContent(page, INDEX_SCRIPT)
  expect(installed).toContain('bulk: true')
  expect(installed).toContain(P.appData)

  const job = JSON.parse((await fileContent(page, PENDING_JOB))!) as {
    type: string
    jobs: Array<{ scenePath: string; scriptPath: string; status: string }>
  }
  expect(job.type).toBe('bulk-export')
  expect(job.jobs).toEqual([
    // EMPTY scenePath is the contract's "new empty scene" — load-bearing here.
    { scenePath: '', scriptPath: INDEX_SCRIPT, status: 'pending' },
  ])
  // Daz was closed in the fixture, so the handoff starts it.
  expect(await calledCommands(page)).toContain('launch_daz_studio')

  expect(await unhandledCommands(page)).toEqual([])
})

test('build genesis index: reports the finished run with a toast on the Tools panel', async ({
  page,
}) => {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true, dazInstallFolder: DAZ_INSTALL })
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await openIndexTab(page)

  await page
    .getByRole('tabpanel')
    .getByRole('button', { name: 'Build Genesis Index', exact: true })
    .click()
  await expect(page.getByRole('button', { name: /Waiting for Daz Studio/ })).toBeVisible()

  // The Runner's pickup, exactly per the contract (see tauri-mock's
  // launch_daz_studio note): rename the job file to `running_` — the claim —
  // and keep the fake Daz "alive" so a sub-100 file doesn't read as a dead run.
  await page.evaluate(
    ([pending, running]) => {
      const mock = (window as any).__tauriMock
      mock.dazRunning = true
      const job = JSON.parse(mock.files.get(pending) as string) as {
        jobs: Array<{ status: string }>
      }
      job.jobs[0].status = 'running'
      mock.files.delete(pending)
      mock.files.set(running, JSON.stringify(job))
    },
    [PENDING_JOB, RUNNING_JOB],
  )
  // The claim ends the abortable pending state; the panel's poll flips to the
  // Runner-owned live state. (The poll runs every 2.5s — give it headroom.)
  await expect(page.getByRole('button', { name: /Building in Daz Studio/ })).toBeVisible({
    timeout: 10_000,
  })
  await expect(page.getByRole('button', { name: 'Abort' })).toBeHidden()

  // The Runner finishes the row and writes progress 100 — the PANEL (the run's
  // owner on the shared watch) consumes the file and toasts the outcome.
  await page.evaluate(
    ([running]) => {
      const mock = (window as any).__tauriMock
      const job = JSON.parse(mock.files.get(running) as string) as {
        progress: number
        jobsDone?: number
        jobs: Array<{ status: string }>
      }
      job.jobs[0].status = 'done'
      job.progress = 100
      job.jobsDone = 1
      mock.files.set(running, JSON.stringify(job))
    },
    [RUNNING_JOB],
  )
  await expect(page.getByText(/Genesis index rebuilt/)).toBeVisible({ timeout: 10_000 })
  // Destructive consumption is the OWNER's: the finished file is gone.
  expect(await fileContent(page, RUNNING_JOB)).toBeNull()

  expect(await unhandledCommands(page)).toEqual([])
})
