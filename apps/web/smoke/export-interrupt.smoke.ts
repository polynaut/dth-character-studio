import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// **Interrupt** — stopping the RUN, not the studio's view of it.
//
// The studio cannot reach into either half of a DTH Export: Daz Studio is
// driven by a plugin that only watches the filesystem, and the Houdini leg is a
// headless hython. What it CAN do is drop a flag file that the code it wrote —
// the generated `.dsa` carriers, the DTH runtime, `456.py` — probes at every
// point where stopping leaves nothing half-written. This spec covers the
// studio's half of that contract: the flag lands, the button says what is
// happening, and an interrupted batch is reported as interrupted and never
// continues into Houdini.
//
// The other half (a Daz script that actually skips its scene) cannot be smoked
// — it runs inside Daz Studio. It is covered by the generated-script assertions
// in packages/rom's generate.test.ts.

const DAZ_INSTALL = 'C:/Program Files/DAZ 3D/DAZStudio4'
const SCRIPTS_ROOT = `${P.dazLib}/Scripts/DTH-Character-Studio`
const PENDING_JOB = `${SCRIPTS_ROOT}/dth_exporter_jobs.json`
const RUNNING_JOB = `${SCRIPTS_ROOT}/running_dth_exporter_jobs.json`
/** The flag itself — `EXPORT_CANCEL_FILE` in the character's `.dcsmeta`. */
const CANCEL_FLAG = `${P.charMeta}/.dth_export_cancel`

const fileExists = (page: Page, path: string) =>
  page.evaluate((p) => ((window as any).__tauriMock.files as Map<string, string>).has(p), path)
const unhandledCommands = (page: Page) =>
  page.evaluate(() => (window as any).__tauriMock.unhandled as Array<string>)

/** Stand in for a Runner that claimed the batch and is working it (the same
 *  fake the abort spec uses — the claim is what makes the run live). */
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

/** The batch drains: every row comes back `done` and progress hits 100 — which
 *  is EXACTLY what an interrupted batch looks like from outside, because a row
 *  whose script saw the flag and returned is indistinguishable from one that
 *  exported. Believing those counts is the thing the feature must not do. */
async function runnerFinishesBatch(page: Page) {
  await page.evaluate((running) => {
    const files = (window as any).__tauriMock.files as Map<string, string>
    const job = JSON.parse(files.get(running) ?? '{}')
    files.set(
      running,
      JSON.stringify({
        ...job,
        progress: 100,
        jobsDone: (job.jobs ?? []).length,
        jobs: (job.jobs ?? []).map((row: Record<string, unknown>) => ({ ...row, status: 'done' })),
      }),
    )
  }, RUNNING_JOB)
}

/** Hand the character's scene off with the Houdini project selected too, then
 *  have the Runner claim it. Leaves the header in its live "Working" state with
 *  a Houdini continuation armed behind it. */
async function startAndClaim(page: Page) {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true, dazInstallFolder: DAZ_INSTALL })
  seed.files[`${SCRIPTS_ROOT}/Demo/Kira/.Bulk_ROM_Export.dsa`] = '// bulk-export fixture'
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()
  await page.getByRole('button', { name: 'DTH Export' }).click()
  await page.getByRole('button', { name: 'Start' }).click()
  await expect.poll(() => fileExists(page, PENDING_JOB)).toBe(true)
  await runnerClaimsBatch(page)
  await expect(page.getByRole('button', { name: /Working/ })).toBeVisible({ timeout: 15_000 })
}

test('the working button IS the interrupt — it says so, and a click drops the flag', async ({
  page,
}) => {
  // The interrupt used to be a second button beside an inert Working button;
  // now the working button itself is the run's one control: hovering swaps
  // its spinner for a stop mark and the tooltip leads with what a click does.
  await startAndClaim(page)

  // The tooltip may live in `title` OR `data-tooltip` — TooltipHost steals a
  // hovered control's title (see override.smoke.ts), and a Playwright click
  // hovers. Read whichever holds it.
  const tooltip = (name: RegExp) =>
    page
      .getByRole('button', { name })
      .evaluate((el) => el.getAttribute('title') ?? el.getAttribute('data-tooltip') ?? '')

  const working = page.getByRole('button', { name: /Working/ })
  expect(await tooltip(/Working/)).toMatch(/Click to interrupt/)
  // The old second button is gone — one run, one control.
  await expect(page.getByRole('button', { name: 'Interrupt' })).toHaveCount(0)

  expect(await fileExists(page, CANCEL_FLAG)).toBe(false)
  await working.click()

  // The flag is what the runtimes obey; everything else is reporting.
  await expect.poll(() => fileExists(page, CANCEL_FLAG)).toBe(true)
  await expect(page.getByText(/Stopping the export at the next safe point/)).toBeVisible()
  // …and the live progress button stops claiming to be plain "Working".
  await expect(page.getByRole('button', { name: /Daz Studio Stopping/ })).toBeVisible()
  // Pressed once, it stops offering itself — the flag is on disk, and a
  // button still promising "Click to interrupt" would read as "that didn't
  // work". A second click changes nothing.
  await expect.poll(() => tooltip(/Stopping/)).not.toMatch(/Click to interrupt/)
  await page.getByRole('button', { name: /Stopping/ }).click()
  // The run is NOT killed: the claimed job file is still there and Daz keeps
  // working through it (this is the whole difference from the old Abort).
  expect(await fileExists(page, RUNNING_JOB)).toBe(true)
  expect(await unhandledCommands(page)).toEqual([])
})

test('an interrupted batch reports as interrupted and never continues into Houdini', async ({
  page,
}) => {
  await startAndClaim(page)
  await page.getByRole('button', { name: /Working/ }).click()
  await expect.poll(() => fileExists(page, CANCEL_FLAG)).toBe(true)

  await runnerFinishesBatch(page)

  // Reported as an interrupt — never "1 scene exported", which the row
  // statuses would happily support and which would be a lie.
  await expect(page.getByText(/DTH Export interrupted/)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/scenes? exported/)).toHaveCount(0)
  // The Houdini leg was selected in the dialog and must NOT have started.
  await expect(page.getByRole('button', { name: /Working/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'DTH Export' })).toBeVisible()
  // The flag does not outlive the run it stopped: a leftover would silently
  // skip every scene of the NEXT export.
  await expect.poll(() => fileExists(page, CANCEL_FLAG)).toBe(false)
  expect(await unhandledCommands(page)).toEqual([])
})
