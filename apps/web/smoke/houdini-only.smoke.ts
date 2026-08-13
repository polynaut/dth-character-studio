import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// "Houdini only" end to end — the DTH Export panel's fourth mode: no Daz run,
// no Runner. The selected scenes' LAST-delivered exports are handed straight to
// Houdini, which opens the chosen project and runs its DazToHue export nodes.
// The same Houdini leg "Export too" continues into after its Daz batch — this
// spec proves the leg stands on its own, and that no Daz job file is ever
// written on the way.

const HOUDINI_INSTALL = 'C:/Program Files/Side Effects Software/Houdini 22.0.368'
const HOUDINI_DOCS = 'C:/Users/dev/Documents/houdini22.0'

const SCRIPTS_ROOT = `${P.dazLib}/Scripts/DTH-Character-Studio`
const PENDING_JOB = `${SCRIPTS_ROOT}/dth_exporter_jobs.json`
const HOUDINI_JOB = `${P.charFolder}/.dth_houdini_job.json`
const HOUDINI_RESULT = `${P.charFolder}/.dth_houdini_result.json`
// The demo character's primary delivers into this export set (same derivation
// the export-too spec pins) — the `.dth` here IS the mode's per-scene gate.
const DELIVERED_DTH = `${P.exportDir}/KiraDefault_G9_GP/Kira.dth`

const fileKeys = (page: Page) =>
  page.evaluate(() => [...(window as any).__tauriMock.files.keys()] as Array<string>)
const fileContent = (page: Page, path: string) =>
  page.evaluate((p) => ((window as any).__tauriMock.files.get(p) ?? null) as string | null, path)
const callsNamed = (page: Page, cmd: string) =>
  page.evaluate(
    (name) =>
      ((window as any).__tauriMock.calls as Array<{ cmd: string; args: any }>)
        .filter((c) => c.cmd === name)
        .map((c) => c.args),
    cmd,
  )
const unhandledCommands = (page: Page) =>
  page.evaluate(() => (window as any).__tauriMock.unhandled as Array<string>)

/** Seed a project whose Houdini half is fully configured (install + matching
 *  docs folder), with or without the delivered `.dth` on disk. */
function houdiniSeed(withExport: boolean) {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true })
  // Houdini "runs" for the whole spec — the poll reads "no result + not
  // running" as a dead run (same flake window the export-too spec closes).
  seed.houdiniRunning = true
  const settingsPath = `${P.appData}/settings.json`
  seed.files[settingsPath] = JSON.stringify({
    ...JSON.parse(seed.files[settingsPath] ?? '{}'),
    houdiniInstallFolder: HOUDINI_INSTALL,
    houdiniDocsFolder: HOUDINI_DOCS,
  })
  // The headless launch probes hython.exe (the export leg never opens the GUI).
  seed.files[`${HOUDINI_INSTALL}/bin/hython.exe`] = 'hython-exe-fixture'
  if (withExport) seed.files[DELIVERED_DTH] = 'dth-fixture'
  return seed
}

/** Stand in for 456.py reporting the one node done. */
async function houdiniReportsDone(page: Page) {
  await page.evaluate(
    ([result]) => {
      const mock = (window as any).__tauriMock
      ;(mock.files as Map<string, string>).set(result, JSON.stringify({
        version: 1,
        state: 'done',
        total: 1,
        done: 1,
        nodes: [
          {
            node: '/obj/DazToHue1/export',
            type: 'daztohueexport',
            scene: 'Kira',
            status: 'ok',
            problems: [],
            seconds: 8.25,
          },
        ],
      }))
    },
    [HOUDINI_RESULT],
  )
}

test('houdini only: hands the scenes straight to Houdini — no Daz job at all', async ({
  page,
}) => {
  await page.addInitScript(installTauriMock, houdiniSeed(true))
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()

  await page.getByRole('button', { name: 'DTH Export' }).click()
  // Skip Daz is the Daz Mode dropdown's fourth option now.
  await page.locator('#daz-mode').click()
  await page.getByRole('option', { name: /Skip Daz/ }).click()

  // The scene with a delivered export comes PRE-checked, wearing its hint; the
  // linked Houdini project was auto-selected (its default mode is the export).
  await expect(page.getByText(/last Daz export as it stands/)).toBeVisible()
  await expect(page.getByRole('checkbox', { name: /Export Kira/ })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: /Run in Kira/ })).toBeChecked()
  await page.getByRole('button', { name: 'Start' }).click()

  // Straight to Houdini: the job file lands with the scene's `.dth`, Houdini is
  // launched at the linked project — and NO Daz job file was ever written. No
  // hand-over toast (mid-run toasts read as outcomes) — the live "Working"
  // button is the run's signal until the one end report.
  await expect(page.getByRole('button', { name: /Working/ })).toBeVisible()
  await expect.poll(() => fileContent(page, HOUDINI_JOB), { timeout: 15_000 }).not.toBeNull()
  const job = JSON.parse((await fileContent(page, HOUDINI_JOB))!) as {
    scenes: Array<{ dth: string; label: string }>
  }
  expect(job.scenes).toEqual([{ dth: DELIVERED_DTH, label: 'KiraDefault_G9_GP' }])
  const [launch] = await callsNamed(page, 'launch_houdini_job')
  expect(launch.request.scenePath).toBe(P.houdini)
  expect(await fileKeys(page)).not.toContain(PENDING_JOB)

  // 456.py reports, and the end-of-everything summary fires (no Daz line — no
  // Daz leg ran) — the header watch was armed directly by the dialog.
  await houdiniReportsDone(page)
  await expect(page.getByText(/DTH Export finished/)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/Kira: 1 exported/)).toBeVisible()
  await expect.poll(() => fileKeys(page)).not.toContain(HOUDINI_JOB)
  expect(await fileKeys(page)).not.toContain(HOUDINI_RESULT)

  expect(await unhandledCommands(page)).toEqual([])
})

test('the live Houdini button is inert — Interrupt is the way out', async ({ page }) => {
  // A plain click on the working button is deliberately ignored: a stray one
  // used to silently drop the watch AND every project queued behind it. The
  // deliberate way out sits beside it, unmodified and unmodifiered.
  //
  // (Until v0.77 the way out was Ctrl → **Stop watching**, which let go of the
  // run rather than stopping it — the leg is headless, so there wasn't even a
  // window to close. Interrupt does the thing that only approximated.)
  await page.addInitScript(installTauriMock, houdiniSeed(true))
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()

  await page.getByRole('button', { name: 'DTH Export' }).click()
  await page.locator('#daz-mode').click()
  await page.getByRole('option', { name: /Skip Daz/ }).click()
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByRole('button', { name: /Working/ })).toBeVisible({ timeout: 15_000 })

  // A plain click changes nothing — no modifier makes it do anything either.
  await page.getByRole('button', { name: /Working/ }).click()
  await expect(page.getByRole('button', { name: /Working/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Interrupt' })).toBeVisible()

  await page.getByRole('button', { name: 'Interrupt' }).click()

  // The flag is down and the leg says so; the run is NOT torn down here — the
  // watch stays until 456.py reports that it stopped, which is the difference
  // from the old "stop watching".
  await expect(page.getByText(/Stopping the export at the next safe point/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stopping…' })).toBeDisabled()
  await expect(page.getByRole('button', { name: /Houdini Stopping/ })).toBeVisible()

  // Nothing was deleted under Houdini — its job file is still there for the
  // run that is still working through it.
  expect(await fileKeys(page)).toContain(HOUDINI_JOB)

  expect(await unhandledCommands(page)).toEqual([])
})

test('houdini only: a scene with no export on disk is disabled and blocks Start', async ({
  page,
}) => {
  await page.addInitScript(installTauriMock, houdiniSeed(false))
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()

  await page.getByRole('button', { name: 'DTH Export' }).click()
  await page.locator('#daz-mode').click()
  await page.getByRole('option', { name: /Skip Daz/ }).click()

  // Nothing delivered → the row says so, stays unchecked and un-checkable, and
  // Start has nothing it could run.
  await expect(page.getByText(/No Daz export on disk yet/)).toBeVisible()
  await expect(page.getByRole('checkbox', { name: /Export Kira/ })).not.toBeChecked()
  await expect(page.getByRole('checkbox', { name: /Export Kira/ })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Start' })).toBeDisabled()

  expect(await unhandledCommands(page)).toEqual([])
})

test('changing the Mode keeps a selection the user made themselves', async ({ page }) => {
  // Each Daz mode has its own "outstanding work" rule, and switching used to
  // re-run it over the whole list — so picking one scene and then changing the
  // dropdown re-checked every scene the new mode liked, and the Houdini list
  // (which follows the scenes) came along. Seeding is a courtesy for an
  // untouched list; after that it is the user's list.
  const seed = buildSeed({
    activeProjectFile: P.dcsp,
    demo: true,
    houdiniProject: true,
    extraScene: true,
  })
  // Both scenes have an export on disk, so "Skip Daz" would seed BOTH.
  seed.files[`${P.exportDir}/KiraDefault_G9_GP/Kira.dth`] = '{}'
  seed.files[`${P.exportDir}/KiraSummertide_G9_GP/Kira_KiraSummertide_G9_GP.dth`] = '{}'
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()
  await page.getByRole('button', { name: 'DTH Export' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()

  // One scene, by hand.
  const primary = dialog.getByRole('checkbox', { name: /Export KiraDefault/ })
  const extra = dialog.getByRole('checkbox', { name: /Export KiraSummertide/ })
  await extra.uncheck()
  await primary.check()

  await dialog.locator('#daz-mode').click()
  await page.getByRole('option', { name: /Skip Daz/ }).click()

  // Still exactly what was picked.
  await expect(primary).toBeChecked()
  await expect(extra).not.toBeChecked()
})
