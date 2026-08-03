import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// Tools → Build Genesis Index: one button that hands the visible
// `Build_Genesis_Index.dsa` to the Runner plugin, so Daz builds and scans every
// generation's stock figures unattended. The row carries an EMPTY scenePath —
// the job contract's "run this script in a new empty scene the plugin creates",
// which is what keeps whatever the user had open out of the scan.

const SCRIPTS_ROOT = `${P.dazLib}/Scripts/DTH-Character-Studio`
const INDEX_SCRIPT = `${SCRIPTS_ROOT}/Build_Genesis_Index.dsa`
const PENDING_JOB = `${SCRIPTS_ROOT}/dth_exporter_jobs.json`

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

test('build genesis index: hands the root script to the Runner in an empty scene', async ({
  page,
}) => {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true })
  // The script is installed at the scripts-folder ROOT (it belongs to no
  // character) — the handoff refuses without it.
  seed.files[INDEX_SCRIPT] = '// Build_Genesis_Index fixture'
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

test('build genesis index: refuses when the script is not installed', async ({ page }) => {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true })
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await openIndexTab(page)

  // Scoped + exact: the tab trigger and the "…— more information" info popup
  // both carry the same words (name matching is substring by default).
  await page
    .getByRole('tabpanel')
    .getByRole('button', { name: 'Build Genesis Index', exact: true })
    .click()
  // Named, with the fix — not a bare failure.
  await expect(page.getByText(/index script is not installed/)).toBeVisible()
  await expect(page.getByText(/Run Tools → Refresh assets to install it/)).toBeVisible()
  // Nothing was handed over, and Daz was left alone.
  expect(await fileContent(page, PENDING_JOB)).toBeNull()
  expect(await calledCommands(page)).not.toContain('launch_daz_studio')

  expect(await unhandledCommands(page)).toEqual([])
})
