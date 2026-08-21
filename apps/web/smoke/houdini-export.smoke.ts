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
      // The batch may already sit CLAIMED (a spec that staged mid-run progress
      // first) — finish whichever file holds it.
      const job = JSON.parse(files.get(pending) ?? files.get(running) ?? '{}')
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

/** Stand in for 456.py MID-node: the result file says "running" with the live
 *  `activity` channel — the lines ActivityCapture caught from the HDA's own
 *  output while its synchronous do_export works. */
async function houdiniReportsExporting(page: Page) {
  await page.evaluate(
    ([result]) => {
      const mock = (window as any).__tauriMock
      ;(mock.files as Map<string, string>).set(result, JSON.stringify({
        version: 1,
        state: 'running',
        total: 1,
        done: 0,
        nodes: [],
        activity: {
          node: '/obj/DazToHue1/export',
          scene: 'KiraDefault_G9_GP',
          dth: 'D:/DTH Projects/Demo/Kira/houdini/daz-export/KiraDefault_G9_GP/Kira.dth',
          lines: ['Importing Alembic…', 'Baking textures 3/12…'],
          startedAtMs: Date.now(),
          updatedAtMs: Date.now(),
        },
      }))
    },
    [HOUDINI_RESULT],
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
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true, dazInstallFolder: DAZ_INSTALL, landedExports: true })
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
  // The headless launch probes hython.exe (the export leg never opens the GUI).
  seed.files[`${HOUDINI_INSTALL}/bin/hython.exe`] = 'hython-exe-fixture'
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
  // …carrying the verbose-progress contract (Runner v1.2.0): the log path and
  // the per-scene step scale (5 = open/ROM/character/CSV/hair).
  const pending = JSON.parse((await fileContent(page, PENDING_JOB))!) as {
    progressLogPath: string
    jobs: Array<{ steps: number }>
  }
  expect(pending.progressLogPath).toBe(`${P.appData}/export-progress.log`)
  expect(pending.jobs[0].steps).toBe(5)
  // The header grew the run's TASK LIST: the scene, then the Houdini project —
  // all still waiting (the Runner hasn't picked the batch up yet). The scene
  // row says what the run is about to do to it, which is the whole choice the
  // dialog made a minute ago.
  await expect(page.locator(`[data-task="daz:${P.scene}"]`)).toBeVisible()
  await expect(page.locator(`[data-task="daz:${P.scene}"]`)).toContainText('ROM + Export')
  await expect(page.locator(`[data-task="hou:${P.houdini}"]`)).toBeVisible()
  // …and the bar's status line ALREADY says what is being waited for. Daz was
  // not running here, so the handoff started it: the opening line says so (a
  // blank line read as "nothing is happening" while Daz takes its tens of
  // seconds to come up).
  await expect(page.locator('[data-export-status]')).toHaveText('Opening Daz Studio')

  // The Runner claims the batch and works the scene: the running job file +
  // the verbose progress log. The scene row goes ACTIVE and the bar's status
  // line follows the per-step lines.
  await page.evaluate(
    ([pendingPath, runningPath, progressPath]) => {
      const mock = (window as any).__tauriMock
      // A sub-100 running file with no Daz alive reads as a DEAD run (the
      // liveness rule) — the mid-run stage needs the fake Daz up.
      mock.dazRunning = true
      const files = mock.files as Map<string, string>
      const job = JSON.parse(files.get(pendingPath) ?? '{}')
      files.delete(pendingPath)
      files.set(runningPath, JSON.stringify({
        ...job,
        progress: 10,
        jobsDone: 0,
        jobs: job.jobs.map((row: Record<string, unknown>) => ({ ...row, status: 'running' })),
      }))
      files.set(progressPath, [
        '[0] KiraDefault_G9_GP: opening scene',
        '[20] KiraDefault_G9_GP: scene opened',
        '[40] KiraDefault_G9_GP: ROM generated',
        '',
      ].join('\n'))
    },
    [PENDING_JOB, RUNNING_JOB, `${P.appData}/export-progress.log`],
  )
  // ONE status line, display-clean: no percent bracket and no scene prefix
  // (the row carries the scene, the bar the percent), capitalized — the raw
  // log line is lowercase — and only the NEWEST one.
  await expect(page.locator('[data-export-status]')).toHaveText('ROM generated', {
    timeout: 15_000,
  })
  await expect(page.locator(`[data-task="daz:${P.scene}"]`)).toHaveAttribute(
    'data-task-status',
    'active',
  )
  // The numbered row: chronological ordinal, stable for the whole run.
  await expect(page.locator(`[data-task="daz:${P.scene}"]`)).toContainText('1.')
  // ONE bar, and it measures the WHOLE run: two rows (a scene + a project),
  // the scene 40% through its own steps → 20%.
  await expect(page.locator('[data-progressbar="run"]')).toHaveAttribute('data-percent', '20')
  await expect(page.locator('[data-progressbar]')).toHaveCount(1)
  // …and picked up + finished by the Runner. NO toast on the baton pass (a
  // mid-run toast reads as an outcome) and NO finish toast yet — the batch
  // outcome is stashed for the one end-of-everything report.
  await runnerFinishesBatch(page)
  await expect(page.getByText(/Starting the Houdini export/)).toHaveCount(0)
  await expect(page.getByText(/DTH Export finished/)).toHaveCount(0)
  // The baton passed: the Houdini project's row is the active one now, and the
  // finished scene row RETIRES — it wears its tick for a beat, then leaves, so
  // the rows still to come are not pushed out of the box behind work that is
  // over (`useRetiringTasks`). The dwell itself is a transient and belongs to
  // the panel's own unit tests; what a spec can assert without racing it is
  // that the row does eventually go.
  await expect(page.locator(`[data-task="hou:${P.houdini}"]`)).toHaveAttribute(
    'data-task-status',
    'active',
    { timeout: 15_000 },
  )
  await expect(page.locator(`[data-task="daz:${P.scene}"]`)).toHaveCount(0, { timeout: 15_000 })

  // The hand-over: the job file lands in the character folder, both runner
  // scripts are staged in app-data, and HEADLESS hython is launched at them.
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
  expect(launch.request.hythonPath).toBe(`${HOUDINI_INSTALL}/bin/hython.exe`)
  expect(launch.request.scenePath).toBe(P.houdini)
  expect(launch.request.jobPath).toBe(HOUDINI_JOB)
  expect(launch.request.houdiniPrefDir).toBe(HOUDINI_DOCS)
  // The full console (C++ cook chatter included) streams into a per-run log
  // in the character folder — the reason the leg went headless.
  expect(launch.request.logPath).toBe(`${P.charFolder}/.dth_houdini_console.log`)
  // NO scriptPath: putting the studio's folder on HOUDINI_SCRIPT_PATH made the
  // startup EMPTY scene run 456.py and eat the job (measured on the first
  // headless run) — the bootstrap execs it, exactly once, after the load.
  expect(launch.request.scriptPath).toBeUndefined()
  expect(launch.request.runnerPath).toMatch(/\/headless_export\.py$/)
  const scriptsDir = launch.request.runnerPath.replace(/\/headless_export\.py$/, '')
  expect(await fileKeys(page)).toContain(`${scriptsDir}/456.py`)
  expect(await fileKeys(page)).toContain(`${scriptsDir}/headless_export.py`)

  // Mid-node, the result's `activity` channel carries what the HDA is saying —
  // the status line shows the NEWEST captured line and nothing else. The chip
  // itself stays a constant "Working" (the numbers live in the panel).
  await houdiniReportsExporting(page)
  // Prefixed with the app it came from — the HDA's own lines say nothing about
  // WHERE, while the studio's own status lines name their app themselves.
  await expect(page.locator('[data-export-status]')).toHaveText(
    'Houdini; Baking textures 3/12…',
    { timeout: 15_000 },
  )
  await expect(page.getByRole('button', { name: /Working/ })).toBeVisible()
  // …and the run's own list is still the whole story: the finished Daz scene
  // has retired off the top of it, leaving the Houdini row being worked.
  await expect(page.locator(`[data-task="daz:${P.scene}"]`)).toHaveCount(0)
  await expect(page.locator(`[data-task="hou:${P.houdini}"]`)).toHaveAttribute(
    'data-task-status',
    'active',
  )
  // ONE bar, over the whole run: the scene row is done and the Houdini row is
  // roughly a fifth in (2 of the ~9 phase lines a full node run emits — the
  // only signal hython's console gives) → (1 + 0.22) / 2.
  await expect(page.locator('[data-progressbar="run"]')).toHaveAttribute('data-percent', '61')
  await expect(page.locator('[data-progressbar]')).toHaveCount(1)

  // 456.py works through it and reports — and NOW the one summary toast fires,
  // covering the whole process: the Daz leg and the Houdini leg, per line.
  await houdiniReportsDone(page)
  await expect(page.getByText(/DTH Export finished/)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/Daz: 1\/1 scene exported/)).toBeVisible()
  // The summary NOTES the warnings without carrying them — the leg line stays
  // one line, and the report keeps its own (success) state.
  await expect(page.getByText(/Kira: 1 exported.*finished with warnings/)).toBeVisible()
  // The HDA's pre-flight complaint reaches the user as its OWN warning toast
  // beside the report, in its own state. 456.py answers its "Continue anyway?"
  // with Yes, so this is its ONLY surface — and the result file holding it is
  // deleted immediately below. "Export worked" and "this network complained"
  // are different messages; welding them into one green toast is how a run
  // full of warnings wore a checkmark.
  await expect(page.getByText('Kira: exported with warnings')).toBeVisible()
  await expect(page.getByText(/No bone scale reference found/)).toBeVisible()

  // THE POINT: the handoff cleans up after itself. Both files used to be left
  // in the character folder for good.
  await expect.poll(() => fileKeys(page)).not.toContain(HOUDINI_JOB)
  expect(await fileKeys(page)).not.toContain(HOUDINI_RESULT)
  // The run is over — the task list and its meter left with it.
  await expect(page.locator('[data-task]')).toHaveCount(0)
  await expect(page.locator('[data-progressbar]')).toHaveCount(0)

  expect(await unhandledCommands(page)).toEqual([])
})

test('a reloaded window ADOPTS the in-flight batch — rows from the job file, status from the log', async ({
  page,
}) => {
  // The batch is already running when the window opens (a reload mid-run, or
  // another window's run): no armed watch, no memory of the start — the whole
  // display must be rebuilt from what is ON DISK. The row comes from the job
  // file's own rows, the status line and bar from the global progress log; the
  // Houdini queue, the elapsed clock and the run's MODE (memory-only, or on a
  // sidecar this window has no claim to) stay absent.
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true })
  seed.files[RUNNING_JOB] = JSON.stringify({
    version: 1,
    type: 'bulk-export',
    progress: 40,
    jobsDone: 0,
    jobs: [
      {
        scenePath: P.scene,
        scriptPath: `${SCRIPTS_ROOT}/Demo/Kira/.Bulk_ROM_Export.dsa`,
        status: 'running',
      },
    ],
  })
  seed.files[`${P.appData}/export-progress.log`] = [
    '[0] KiraDefault_G9_GP: opening scene',
    '[20] KiraDefault_G9_GP: scene opened',
    '[40] KiraDefault_G9_GP: ROM generated',
    '',
  ].join('\n')
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  // The fake Daz is alive and working the batch (set before the character
  // page's first poll).
  await page.evaluate(() => {
    ;(window as any).__tauriMock.dazRunning = true
  })
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()

  await expect(page.locator(`[data-task="daz:${P.scene}"]`)).toHaveAttribute(
    'data-task-status',
    'active',
    { timeout: 15_000 },
  )
  await expect(page.locator('[data-export-status]')).toHaveText('ROM generated')
  // One row, 40% into its own steps — the whole run, as far as this window can
  // see it.
  await expect(page.locator('[data-progressbar="run"]')).toHaveAttribute('data-percent', '40')
  // …and it does NOT claim to know what the run does to that scene: an adopted
  // window reads a job file, which never carried the panel's choice.
  await expect(page.locator(`[data-task="daz:${P.scene}"]`)).not.toContainText('ROM + Export')
  await expect(page.locator('[data-task^="hou:"]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Working/ })).toBeVisible()

  // …and it LETS GO again. The batch's owner finishes it and deletes the job
  // file; this window's poll then finds nothing — and since an adoption owns
  // no outcome, that null is the only signal it ever gets. Without an explicit
  // clear the rows and a still-ticking meter hung in the header for good (the
  // poll interval stops with the watch, so nothing would ever come back to
  // tidy them).
  await page.evaluate(
    ([running]) => {
      ;((window as any).__tauriMock.files as Map<string, string>).delete(running)
    },
    [RUNNING_JOB],
  )
  await expect(page.locator('[data-task]')).toHaveCount(0, { timeout: 15_000 })
  await expect(page.locator('[data-export-status]')).toHaveCount(0)
  await expect(page.locator('[data-progressbar]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Working/ })).toHaveCount(0)
})

test('the run OWNER reloads mid-batch: the sidecar restores clock, Houdini card AND the continuation', async ({
  page,
}) => {
  // Same in-flight batch as the adoption spec — but the handoff's sidecar
  // names THIS character as the owner, so the editor restores the FULL watch
  // instead of the display-only adoption: the clock ticks again (persisted
  // start time), the chosen Houdini project's card is back, and — the part
  // that used to be silently LOST on reload — the "Export too" continuation
  // still fires when the batch finishes.
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true, landedExports: true })
  seed.files[RUNNING_JOB] = JSON.stringify({
    version: 1,
    type: 'bulk-export',
    progress: 40,
    jobsDone: 0,
    jobs: [
      {
        scenePath: P.scene,
        scriptPath: `${SCRIPTS_ROOT}/Demo/Kira/.Bulk_ROM_Export.dsa`,
        status: 'running',
      },
    ],
  })
  seed.files[`${P.appData}/export-run.json`] = JSON.stringify({
    characterId: 'char-kira',
    total: 1,
    startedAtMs: Date.now() - 65_000,
    houdiniProjects: [P.houdini],
    houdiniMode: 'export-selected',
    scenes: [P.scene],
  })
  seed.files[`${P.appData}/export-progress.log`] = '[40] KiraDefault_G9_GP: ROM generated\n'
  // The continuation launches headless hython — same install/docs pairing the
  // full round-trip spec seeds.
  seed.houdiniRunning = true
  const settingsPath = `${P.appData}/settings.json`
  seed.files[settingsPath] = JSON.stringify({
    ...JSON.parse(seed.files[settingsPath] ?? '{}'),
    houdiniInstallFolder: HOUDINI_INSTALL,
    houdiniDocsFolder: HOUDINI_DOCS,
  })
  seed.files[`${HOUDINI_INSTALL}/bin/hython.exe`] = 'hython-exe-fixture'
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.evaluate(() => {
    ;(window as any).__tauriMock.dazRunning = true
  })
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()

  // Both legs' cards are back — and the clock (the run started ~a minute ago).
  await expect(page.locator(`[data-task="daz:${P.scene}"]`)).toHaveAttribute(
    'data-task-status',
    'active',
    { timeout: 15_000 },
  )
  await expect(page.locator(`[data-task="hou:${P.houdini}"]`)).toHaveAttribute(
    'data-task-status',
    'waiting',
  )
  await expect(page.getByRole('button', { name: /Working \d+:\d{2}/ })).toBeVisible()

  // The batch finishes — the RESTORED watch owns the outcome: the Houdini
  // handoff lands, written by this reloaded window.
  await runnerFinishesBatch(page)
  await expect.poll(() => fileContent(page, HOUDINI_JOB), { timeout: 15_000 }).not.toBeNull()
  // …and the Houdini card is still there for the leg it hands over to. (The
  // re-arm used to need a 'running' poll: a reload whose first poll found the
  // batch already finished ran the whole Houdini leg with an empty column.)
  await expect(page.locator(`[data-task="hou:${P.houdini}"]`)).toBeVisible()
})

test('a reload whose FIRST poll finds the batch finished still shows the Houdini card', async ({
  page,
}) => {
  // The gap the spec above cannot catch: it reloads while the batch is still
  // running. Here the window opens onto a batch that is ALREADY at 100 — the
  // continuation path is the first thing that runs, and it used to arm no
  // cards at all (the re-arm lived in the 'running' branch alone).
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true, landedExports: true })
  seed.files[RUNNING_JOB] = JSON.stringify({
    version: 1,
    type: 'bulk-export',
    progress: 100,
    jobsDone: 1,
    jobs: [
      {
        scenePath: P.scene,
        scriptPath: `${SCRIPTS_ROOT}/Demo/Kira/.Bulk_ROM_Export.dsa`,
        status: 'done',
      },
    ],
  })
  seed.files[`${P.appData}/export-run.json`] = JSON.stringify({
    characterId: 'char-kira',
    total: 1,
    startedAtMs: Date.now() - 120_000,
    houdiniProjects: [P.houdini],
    houdiniMode: 'export-selected',
    scenes: [P.scene],
  })
  seed.houdiniRunning = true
  const settingsPath = `${P.appData}/settings.json`
  seed.files[settingsPath] = JSON.stringify({
    ...JSON.parse(seed.files[settingsPath] ?? '{}'),
    houdiniInstallFolder: HOUDINI_INSTALL,
    houdiniDocsFolder: HOUDINI_DOCS,
  })
  seed.files[`${HOUDINI_INSTALL}/bin/hython.exe`] = 'hython-exe-fixture'
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()

  // The continuation runs (the sidecar carried the plan) AND wears its card.
  await expect.poll(() => fileContent(page, HOUDINI_JOB), { timeout: 15_000 }).not.toBeNull()
  await expect(page.locator(`[data-task="hou:${P.houdini}"]`)).toBeVisible()
})

test('rom only: the Houdini list cannot export — no auto-select, no continuation', async ({
  page,
}) => {
  // A ROM-only run writes no fresh `.dth`, so an export continuation would
  // re-consume the PREVIOUS exports while the report reads as "the new ROM
  // reached Houdini". The dialog therefore never auto-selects projects under
  // ROM only and the export mode is dead — the batch ends with the ROM build.
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true, dazInstallFolder: DAZ_INSTALL, landedExports: true })
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

  // Re-picking a project by hand is allowed, but it cannot export: the mode
  // lands on Skip Houdini and the export mode is dead.
  await page.getByRole('checkbox', { name: /Run in Kira/ }).check()
  await expect(page.locator('#houdini-mode')).toHaveText(/Skip Houdini/)
  await page.locator('#houdini-mode').click()
  await expect(page.getByRole('option', { name: /Export selected scenes/ })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Start' }).click()

  // The Daz batch is the ROM build…
  await expect.poll(() => fileContent(page, PENDING_JOB)).not.toBeNull()
  expect(await fileContent(page, PENDING_JOB)).toContain('.Build_ROM_Animation.dsa')
  await runnerFinishesBatch(page)

  // …and its finish IS the report: no Houdini job, no launch, nothing opened.
  await expect(page.getByText(/DTH Export finished — 1 scene exported/)).toBeVisible({
    timeout: 15_000,
  })
  expect(await callsNamed(page, 'launch_houdini_job')).toEqual([])
  expect(await callsNamed(page, 'shell_open_file')).toEqual([])
  expect(await fileKeys(page)).not.toContain(HOUDINI_JOB)

  expect(await unhandledCommands(page)).toEqual([])
})

test('a Daz batch whose export set never landed FAILS its scene instead of cooking the corpse', async ({
  page,
}) => {
  // The measured 2026-08-21 cascade this guard exists for: the DTH Exporter
  // crashed Daz's script engine 2 s into the Alembic export — the Runner still
  // marked the row `done` (its contract: the script returned), the ROM run log
  // (stamped before the export block) said ok, and the Houdini leg cooked a
  // 0-byte `.dth` beside the sweep's un-restored `.dthprev` backups into a
  // 17-second "success". The disk is the one witness the crash cannot fake —
  // so the continuation judges it before Houdini gets the baton.
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true, dazInstallFolder: DAZ_INSTALL, landedExports: true })
  seed.houdiniRunning = true
  const settingsPath = `${P.appData}/settings.json`
  seed.files[settingsPath] = JSON.stringify({
    ...JSON.parse(seed.files[settingsPath] ?? '{}'),
    houdiniInstallFolder: HOUDINI_INSTALL,
    houdiniDocsFolder: HOUDINI_DOCS,
  })
  seed.files[`${HOUDINI_INSTALL}/bin/hython.exe`] = 'hython-exe-fixture'
  seed.files[`${SCRIPTS_ROOT}/Demo/Kira/.Bulk_ROM_Export.dsa`] = '// bulk-export fixture'
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()

  await page.getByRole('button', { name: 'DTH Export' }).click()
  await expect(page.getByRole('checkbox', { name: /Run in Kira/ })).toBeChecked()
  await page.getByRole('button', { name: 'Start' }).click()
  await expect.poll(() => fileContent(page, PENDING_JOB)).not.toBeNull()

  // The Daz leg "succeeds" — every row done — but what it leaves on disk is
  // the crash corpse: the 0-byte manifest and the backups the finish step
  // never got to purge.
  await page.evaluate(() => {
    const files = (window as any).__tauriMock.files as Map<string, string>
    const dth = 'D:/DTH Projects/Demo/Kira/houdini/daz-export/KiraDefault_G9_GP/Kira.dth'
    files.set(dth, '')
    files.set(`${dth}.dthprev`, '{"fixture":"the previous good export"}')
    files.set(`${dth.replace(/\.dth$/, '.abc')}.dthprev`, 'previous-abc')
  })
  await runnerFinishesBatch(page)

  // No baton: the Houdini leg never starts — no job file, no launch — and the
  // report says WHY, naming the scene and pointing back at Daz.
  await expect(page.getByText(/did not land/)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/export this scene again/)).toBeVisible()
  expect(await callsNamed(page, 'launch_houdini_job')).toEqual([])
  expect(await fileKeys(page)).not.toContain(HOUDINI_JOB)

  expect(await unhandledCommands(page)).toEqual([])
})

test('a Houdini leg that dies with nothing to say names its last step and its exit code', async ({
  page,
}) => {
  // The other half of the measured 2026-08-21 morning: the headless export
  // exited mid "exporting animation curves" with no traceback, no Houdini
  // crash log and no WER entry, and the only error-shaped line in the console
  // was a benign HDA load-time warning from minutes earlier — which the death
  // toast dutifully served as the cause. The rule since: a run that kept
  // narrating AFTER its newest error-shaped line survived that line, so the
  // honest answer is where it STOPPED, plus the exit code the fire-and-forget
  // spawn used to throw away (`houdini_job_exit_code`, FFI #57). This is the
  // only spec that drives a dead Houdini run, so it is also the only one that
  // reaches that command at all.
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true, dazInstallFolder: DAZ_INSTALL, landedExports: true })
  seed.houdiniRunning = true
  // 0xC0000005 as Windows spells it back through `ExitStatus::code()`.
  seed.houdiniExitCode = -1073741819
  const settingsPath = `${P.appData}/settings.json`
  seed.files[settingsPath] = JSON.stringify({
    ...JSON.parse(seed.files[settingsPath] ?? '{}'),
    houdiniInstallFolder: HOUDINI_INSTALL,
    houdiniDocsFolder: HOUDINI_DOCS,
  })
  seed.files[`${HOUDINI_INSTALL}/bin/hython.exe`] = 'hython-exe-fixture'
  seed.files[`${SCRIPTS_ROOT}/Demo/Kira/.Bulk_ROM_Export.dsa`] = '// bulk-export fixture'
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()

  await page.getByRole('button', { name: 'DTH Export' }).click()
  await page.getByRole('button', { name: 'Start' }).click()
  await expect.poll(() => fileContent(page, PENDING_JOB)).not.toBeNull()
  await runnerFinishesBatch(page)
  // The Daz half landed, so the baton passes — the Houdini job file is written
  // and hython "launched".
  await expect.poll(() => fileContent(page, HOUDINI_JOB), { timeout: 15_000 }).not.toBeNull()

  // Now hython dies: the console holds the shape of the measured log — a
  // load-time warning, then real progress, then silence — and no result file
  // is ever written. Houdini stops being "running", which is all the studio
  // can see from outside.
  await page.evaluate(
    ([consolePath]) => {
      const mock = (window as any).__tauriMock
      ;(mock.files as Map<string, string>).set(consolePath, [
        'DTH Character Studio: loading D:/DTH Projects/Demo/Kira/houdini/Kira.hiplc (headless)',
        "oplib:/Sop/DazToHuePoseAsset?Sop/DazToHuePoseAsset Warning(11): error binding handle sidefx_hud_button because it doesn't exist.",
        'DTH Character Studio: 1 export node(s) match the selected scenes',
        'DazToHue: export started',
        'DazToHue: exporting animation curves',
        '',
      ].join('\n'))
      mock.houdiniRunning = false
    },
    [`${P.charFolder}/.dth_houdini_console.log`],
  )

  // The toast names the last step reached — NOT the stale warning — and
  // carries the exit code the poll went and asked for, hex spelling included.
  const toast = page.getByText(/The Houdini export did not finish/)
  await expect(toast).toBeVisible({ timeout: 15_000 })
  await expect(toast).toContainText('exporting animation curves')
  await expect(toast).toContainText('0xC0000005')
  await expect(toast).not.toContainText('sidefx_hud_button')
  expect(await callsNamed(page, 'houdini_job_exit_code')).not.toEqual([])

  expect(await unhandledCommands(page)).toEqual([])
})

test('leftover backups beside a LANDED export warn — they do not fail the scene', async ({
  page,
}) => {
  // Measured 2026-08-21, live: the runtime's finish step failed to purge, so a
  // GOOD export (full-size .abc, 607 KB .dth, "doExport finished") sat beside
  // its own .dthprev files — and the guard failed that scene and dropped its
  // Houdini leg. The backups say the script did not finish TIDYING; only the
  // `.dth` says whether the export landed. Runtime v100 fixes the purge, but
  // every v99 script still in the field leaves them, so the studio has to be
  // right on its own.
  const seed = buildSeed({
    activeProjectFile: P.dcsp,
    demo: true,
    dazInstallFolder: DAZ_INSTALL,
    landedExports: true,
  })
  seed.houdiniRunning = true
  const settingsPath = `${P.appData}/settings.json`
  seed.files[settingsPath] = JSON.stringify({
    ...JSON.parse(seed.files[settingsPath] ?? '{}'),
    houdiniInstallFolder: HOUDINI_INSTALL,
    houdiniDocsFolder: HOUDINI_DOCS,
  })
  seed.files[`${HOUDINI_INSTALL}/bin/hython.exe`] = 'hython-exe-fixture'
  seed.files[`${SCRIPTS_ROOT}/Demo/Kira/.Bulk_ROM_Export.dsa`] = '// bulk-export fixture'
  // The landed set, plus the backups the v99 finish step failed to purge.
  seed.files[
    'D:/DTH Projects/Demo/Kira/houdini/daz-export/KiraDefault_G9_GP/Kira.abc.dthprev'
  ] = 'the previous export'
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()

  await page.getByRole('button', { name: 'DTH Export' }).click()
  await page.getByRole('button', { name: 'Start' }).click()
  await expect.poll(() => fileContent(page, PENDING_JOB)).not.toBeNull()
  await runnerFinishesBatch(page)

  // The baton PASSES: the export landed, so Houdini gets its job.
  await expect(page.locator(`[data-task="hou:${P.houdini}"]`)).toHaveAttribute(
    'data-task-status',
    'active',
    { timeout: 15_000 },
  )
  expect(await fileKeys(page)).toContain(HOUDINI_JOB)
  // …and nothing calls this scene a failed export.
  await expect(page.getByText(/did not land/)).toHaveCount(0)

  expect(await unhandledCommands(page)).toEqual([])
})
