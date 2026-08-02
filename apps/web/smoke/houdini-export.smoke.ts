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

/** Stand in for 456.py: Houdini is up, and the result file reports one node
 *  exported — carrying a `problems` entry, which the HDA's auto-answered
 *  "Continue anyway?" dialog produced and which nothing else would ever show. */
async function houdiniReportsDone(page: Page) {
  await page.evaluate(
    ([result]) => {
      const mock = (window as any).__tauriMock
      mock.houdiniRunning = true
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

  // Step 1: what the run does. Step 2: the scenes + the after-export pick.
  await page.getByRole('button', { name: 'DTH Export' }).click()
  await page.getByRole('button', { name: /ROM \+ Export/ }).click()
  await page.getByRole('combobox').filter({ hasText: /Kira|Don't open/ }).click()
  await page.getByRole('option', { name: 'Kira' }).click()
  // The toggle only exists once a project is picked — it has nothing to run in
  // otherwise, which is exactly what shipped broken in #627.
  await page.getByRole('switch', { name: 'Export too' }).click()
  await page.getByRole('button', { name: 'Start' }).click()

  // The Daz batch is handed off…
  await expect.poll(() => fileContent(page, PENDING_JOB)).not.toBeNull()
  // …and picked up + finished by the Runner.
  await runnerFinishesBatch(page)
  await expect(page.getByText(/DTH Export finished/)).toBeVisible()

  // Which hands over to Houdini: the job file lands in the character folder,
  // 456.py is staged in app-data, and Houdini is launched pointed at both.
  await expect(page.getByText(/Opening the Houdini project to export/)).toBeVisible()
  await expect.poll(() => fileContent(page, HOUDINI_JOB), { timeout: 15_000 }).not.toBeNull()
  const job = JSON.parse((await fileContent(page, HOUDINI_JOB))!) as {
    version: number
    scenes: Array<{ dth: string; label: string }>
    exportDirectory: string
    resultPath: string
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
  expect(job.exportDirectory).toBe(P.exportDir)

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

  // 456.py works through it and reports.
  await houdiniReportsDone(page)
  await expect(page.getByText(/Houdini export finished — 1 exported/)).toBeVisible({
    timeout: 15_000,
  })
  // The HDA's pre-flight complaint reaches the user. 456.py answers its
  // "Continue anyway?" with Yes, so this toast is its ONLY surface — and the
  // file holding it is deleted immediately below.
  await expect(page.getByText(/No bone scale reference found/)).toBeVisible()

  // THE POINT: the handoff cleans up after itself. Both files used to be left
  // in the character folder for good.
  await expect.poll(() => fileKeys(page)).not.toContain(HOUDINI_JOB)
  expect(await fileKeys(page)).not.toContain(HOUDINI_RESULT)

  expect(await unhandledCommands(page)).toEqual([])
})
