import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// "Export too" end to end — the feature that shipped (#637, #641) with no smoke
// coverage at all, because the mock had never been taught its two Rust commands.
//
// The chain: DTH Export hands a batch to Daz → the Runner works through it →
// the studio sees progress 100 → it writes the Houdini job, drops 456.py and
// launches Houdini with the job in its environment → 456.py reports back → the
// studio toasts the outcome and CLEARS BOTH FILES.
//
// Neither the Runner plugin nor Houdini exists here, so the spec plays both
// parts by writing exactly the files they write. That is the whole point of the
// handoff being files: the other side is replaceable.

const DAZ_INSTALL = 'C:/Program Files/DAZ 3D/DAZStudio4'
const HOUDINI_INSTALL = 'C:/Program Files/Side Effects Software/Houdini 22.0.368'
const HOUDINI_DOCS = 'C:/Users/dev/Documents/houdini22.0'

const SCRIPTS_ROOT = `${P.dazLib}/Scripts/DTH-Character-Studio`
const PENDING_JOB = `${SCRIPTS_ROOT}/dth_exporter_jobs.json`
const RUNNING_JOB = `${SCRIPTS_ROOT}/running_dth_exporter_jobs.json`
const HOUDINI_JOB = `${P.charFolder}/.dth_houdini_job.json`
const HOUDINI_RESULT = `${P.charFolder}/.dth_houdini_result.json`

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

/** Stand in for the Runner plugin finishing the batch: it RENAMES the pending
 *  job file (the `running_` prefix is the claim) and owns `progress` from then
 *  on. 100 = done, which is the studio's cue to report and hand over. */
async function runnerFinishesBatch(page: Page) {
  await page.evaluate(
    ([pending, running]) => {
      const files = (window as any).__tauriMock.files as Map<string, string>
      const job = JSON.parse(files.get(pending) ?? '{}')
      files.delete(pending)
      files.set(running, JSON.stringify({
        ...job,
        progress: 100,
        jobsDone: job.jobs.length,
        jobs: job.jobs.map((row: Record<string, unknown>) => ({ ...row, status: 'done' })),
      }))
    },
    [PENDING_JOB, RUNNING_JOB],
  )
}

/** Stand in for 456.py: the result file reports one node exported — carrying a
 *  `problems` entry, which the HDA's auto-answered "Continue anyway?" dialog
 *  produced and which nothing else would ever show. (Houdini itself has been
 *  "running" since the seed — see `houdiniRunning: true` below.) */
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
            problems: ['No bone scale reference found'],
            seconds: 12.5,
          },
        ],
      }))
    },
    [HOUDINI_RESULT],
  )
}

test('export too: hands the batch on to Houdini, then clears its own job files', async ({
  page,
}) => {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true, dazInstallFolder: DAZ_INSTALL })
  // Houdini counts as running for the whole spec. The app polls every 2.5s and
  // reads "no result + not running" as a DEAD run (it kills the watch and the
  // finished toast never comes) — so the seed's default `false` opened a flake
  // window between Start and `houdiniReportsDone` whenever the assertions in
  // between took one poll tick. The dead path is not what this spec tests.
  seed.houdiniRunning = true
  // The Houdini half needs an install AND a VERSION-MATCHED documents folder —
  // without the pairing, hython/Houdini can load another version's (or no) otls
  // and the DazToHue nodes this job drives would not exist.
  const settingsPath = `${P.appData}/settings.json`
  seed.files[settingsPath] = JSON.stringify({
    ...JSON.parse(seed.files[settingsPath] ?? '{}'),
    houdiniInstallFolder: HOUDINI_INSTALL,
    houdiniDocsFolder: HOUDINI_DOCS,
  })
  seed.files[`${HOUDINI_INSTALL}/bin/houdini.exe`] = 'houdini-exe-fixture'
  // The batch runs the HIDDEN bulk script, not the visible `ROM_…` one the
  // fixture seeds — a missing one is refused up front, before any job file.
  seed.files[`${SCRIPTS_ROOT}/Demo/Kira/.Bulk_ROM_Export.dsa`] = '// bulk-export fixture'
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()

  // ONE page now: the affected scene comes pre-checked, which auto-selects the
  // linked Houdini project — and the Houdini Mode defaults to "Export selected
  // scenes", so a plain Start does the whole round trip. (The old flow's mode
  // card + project dropdown + "Export too" switch are all gone.)
  await page.getByRole('button', { name: 'DTH Export' }).click()
  await expect(page.getByRole('checkbox', { name: /Export KiraDefault/ })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: /Run in Kira/ })).toBeChecked()
  await page.getByRole('button', { name: 'Start' }).click()

  // The Daz batch is handed off…
  await expect.poll(() => fileContent(page, PENDING_JOB)).not.toBeNull()
  // …and picked up + finished by the Runner. NO finish toast yet — the batch
  // outcome is stashed for the one end-of-everything report, and only the
  // transient hand-over info shows while Houdini takes over.
  await runnerFinishesBatch(page)
  await expect(page.getByText(/Opening the Houdini project to export/)).toBeVisible()
  await expect(page.getByText(/DTH Export finished/)).toHaveCount(0)

  // The hand-over: the job file lands in the character folder, 456.py is
  // staged in app-data, and Houdini is launched pointed at both.
  await expect.poll(() => fileContent(page, HOUDINI_JOB), { timeout: 15_000 }).not.toBeNull()
  const job = JSON.parse((await fileContent(page, HOUDINI_JOB))!) as {
    version: number
    scenes: Array<{ dth: string; label: string }>
    exportDirectory: string
    resultPath: string
    closeWhenDone: boolean
  }
  // Networks are matched by the `.dth` PATH — the studio wrote that file, so it
  // identifies the scene even after the user renames the network.
  // The demo character's primary sits directly in `daz3d/`, so its export
  // subfolder falls back to the scene stem (the same rule the runtime uses);
  // the FILE keeps the bare character name, because the primary is the
  // character. The label echoed back is the scene's own spelling.
  expect(job.scenes).toEqual([
    { dth: `${P.exportDir}/KiraDefault_G9_GP/Kira.dth`, label: 'KiraDefault_G9_GP' },
  ])
  expect(job.resultPath).toBe(HOUDINI_RESULT)
  // The blank-parm fallback aims at the character's FINAL export folder (where
  // Houdini writes for Unreal) — never the regenerable `daz-export`
  // intermediate the imports read (P.exportDir), which "Export too" used to
  // send even after Generate project stopped baking it.
  expect(job.exportDirectory).toBe(`${P.charFolder}/export`)
  // The batch's Houdini instance closes itself again when the exports are done.
  expect(job.closeWhenDone).toBe(true)

  const [launch] = await callsNamed(page, 'launch_houdini_job')
  expect(launch.request.scenePath).toBe(P.houdini)
  expect(launch.request.jobPath).toBe(HOUDINI_JOB)
  expect(launch.request.houdiniPrefDir).toBe(HOUDINI_DOCS)
  // The trailing `;&` is load-bearing: without it HOUDINI_SCRIPT_PATH REPLACES
  // Houdini's default and the user's own startup scripts stop running.
  expect(launch.request.scriptPath).toMatch(/;&$/)
  expect(await fileKeys(page)).toContain(
    `${launch.request.scriptPath.replace(/;&$/, '')}/456.py`,
  )

  // 456.py works through it and reports — and NOW the one summary toast fires,
  // covering the whole process: the Daz leg and the Houdini leg, per line.
  await houdiniReportsDone(page)
  await expect(page.getByText(/DTH Export finished/)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/Daz: 1\/1 scene exported/)).toBeVisible()
  await expect(page.getByText(/Kira: 1 exported/)).toBeVisible()
  // The HDA's pre-flight complaint reaches the user inside that report. 456.py
  // answers its "Continue anyway?" with Yes, so this is its ONLY surface — and
  // the file holding it is deleted immediately below.
  await expect(page.getByText(/No bone scale reference found/)).toBeVisible()

  // THE POINT: the handoff cleans up after itself. Both files used to be left
  // in the character folder for good.
  await expect.poll(() => fileKeys(page)).not.toContain(HOUDINI_JOB)
  expect(await fileKeys(page)).not.toContain(HOUDINI_RESULT)

  expect(await unhandledCommands(page)).toEqual([])
})

test('rom only: the Houdini list can only OPEN — no auto-select, no export continuation', async ({
  page,
}) => {
  // A ROM-only run writes no fresh `.dth`, so an export continuation would
  // re-consume the PREVIOUS exports while the report reads as "the new ROM
  // reached Houdini". The dialog therefore never auto-selects projects under
  // ROM only, offers Open only as the one live Houdini mode — and the batch
  // ends with the project OPENING, not exporting: no Houdini job, no launch.
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true, dazInstallFolder: DAZ_INSTALL })
  // ROM only runs the visible ROM-animation build script, not the bulk export.
  seed.files[`${SCRIPTS_ROOT}/Demo/Kira/.Build_ROM_Animation.dsa`] = '// rom-build fixture'
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()

  // The default mode (ROM + Export) auto-selects the linked project…
  await page.getByRole('button', { name: 'DTH Export' }).click()
  await expect(page.getByRole('checkbox', { name: /Export KiraDefault/ })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: /Run in Kira/ })).toBeChecked()

  // …and switching to ROM only takes the armed continuation away again.
  await page.locator('#daz-mode').click()
  await page.getByRole('option', { name: /ROM only/ }).click()
  await expect(page.getByRole('checkbox', { name: /Run in Kira/ })).not.toBeChecked()

  // Re-picking a project by hand is allowed — but only to OPEN it: the mode
  // lands on Open only and both export modes are dead.
  await page.getByRole('checkbox', { name: /Run in Kira/ }).check()
  await expect(page.locator('#houdini-mode')).toHaveText(/Open only/)
  await page.locator('#houdini-mode').click()
  await expect(page.getByRole('option', { name: /Export selected scenes/ })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  await expect(page.getByRole('option', { name: /Export all/ })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  await page.getByRole('option', { name: /Open only/ }).click()
  await page.getByRole('button', { name: 'Start' }).click()

  // The Daz batch is the ROM build…
  await expect.poll(() => fileContent(page, PENDING_JOB)).not.toBeNull()
  expect(await fileContent(page, PENDING_JOB)).toContain('.Build_ROM_Animation.dsa')
  await runnerFinishesBatch(page)

  // …and its finish IS the report (opening is not a watched leg): the project
  // opens like an Explorer double-click, and no Houdini job ever exists.
  await expect(page.getByText(/DTH Export finished — 1 scene exported/)).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByText(/Opening the Houdini project/)).toBeVisible()
  await expect.poll(() => callsNamed(page, 'shell_open_file')).toEqual([{ path: P.houdini }])
  expect(await callsNamed(page, 'launch_houdini_job')).toEqual([])
  expect(await fileKeys(page)).not.toContain(HOUDINI_JOB)

  expect(await unhandledCommands(page)).toEqual([])
})
