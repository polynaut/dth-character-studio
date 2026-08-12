import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

// Reloading the app WHILE the Houdini leg works.
//
// The Daz leg has survived this since the run sidecar landed; the Houdini leg
// had nothing. Its watch is memory, and the leg is headless — so a reload lost
// it silently: the export finished inside hython, the studio never reported
// it, and every project queued behind it never started at all. The run's own
// sidecar (`.dth_houdini_run.json`, beside the job/result files it describes)
// carries the current project, the queue, the scene scope, the start time and
// the report so far; the editor adopts it on mount.

const HOUDINI_INSTALL = 'C:/Program Files/Side Effects Software/Houdini 22.0.368'
const HOUDINI_DOCS = 'C:/Users/dev/Documents/houdini22.0'
const HOUDINI_JOB = `${P.charFolder}/.dth_houdini_job.json`
const HOUDINI_RESULT = `${P.charFolder}/.dth_houdini_result.json`
const RUN_PLAN = `${P.charFolder}/.dth_houdini_run.json`
/** A second linked project, still queued behind the one being exported. */
const HOUDINI_2 = 'D:/DTH Projects/Demo/Kira/houdini/KiraSecond.hip'

const fileContent = (page: import('@playwright/test').Page, path: string) =>
  page.evaluate((p) => ((window as any).__tauriMock.files.get(p) ?? null) as string | null, path)

/** A window opening onto a Houdini leg that is already running: the result
 *  file says "running", Houdini is up, and the plan names what is left. */
async function openMidLeg(
  page: import('@playwright/test').Page,
  plan: Record<string, unknown>,
) {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true, houdiniProject: true })
  const character = JSON.parse(seed.files[`${P.charFolder}/Kira.json`]) as Record<string, unknown>
  character.houdiniProjects = [P.houdini, HOUDINI_2]
  seed.files[`${P.charFolder}/Kira.json`] = JSON.stringify(character)
  seed.files[HOUDINI_2] = 'hip-fixture'
  seed.houdiniRunning = true
  const settingsPath = `${P.appData}/settings.json`
  seed.files[settingsPath] = JSON.stringify({
    ...JSON.parse(seed.files[settingsPath] ?? '{}'),
    houdiniInstallFolder: HOUDINI_INSTALL,
    houdiniDocsFolder: HOUDINI_DOCS,
  })
  seed.files[`${HOUDINI_INSTALL}/bin/hython.exe`] = 'hython-exe-fixture'
  seed.files[HOUDINI_JOB] = JSON.stringify({ version: 1, scenes: [], resultPath: HOUDINI_RESULT })
  seed.files[HOUDINI_RESULT] = JSON.stringify({
    version: 1,
    state: 'running',
    total: 1,
    done: 0,
    nodes: [],
    activity: {
      node: '/obj/DazToHue1/export',
      scene: 'KiraDefault_G9_GP',
      dth: `${P.exportDir}/KiraDefault_G9_GP/Kira.dth`,
      lines: ['Baking textures 7/12…'],
      startedAtMs: Date.now(),
      updatedAtMs: Date.now(),
    },
  })
  seed.files[RUN_PLAN] = JSON.stringify(plan)
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()
}

/** Stand in for 456.py finishing the project it was working on. */
async function houdiniReportsDone(page: import('@playwright/test').Page) {
  await page.evaluate(
    ([result]) => {
      ;((window as any).__tauriMock.files as Map<string, string>).set(result, JSON.stringify({
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
            seconds: 9.5,
          },
        ],
      }))
    },
    [HOUDINI_RESULT],
  )
}

test('a reload mid-Houdini-leg keeps watching, and the QUEUED project still runs', async ({
  page,
}) => {
  await openMidLeg(page, {
    characterId: 'char-kira',
    hipPath: P.houdini,
    jobPath: HOUDINI_JOB,
    resultPath: HOUDINI_RESULT,
    scenes: 1,
    startedAtMs: Date.now() - 90_000,
    remaining: [HOUDINI_2],
    sceneScope: [P.scene],
    reportLines: ['Daz: 1/1 scene exported'],
    anyFailed: false,
  })

  // The watch is back: the live button, both projects' cards (the one being
  // worked and the one still queued) and the HDA's own lines.
  await expect(page.getByRole('button', { name: /Working/ })).toBeVisible({ timeout: 15_000 })
  await expect(page.locator(`[data-task="hou:${P.houdini}"]`)).toBeVisible()
  await expect(page.locator(`[data-task="hou:${HOUDINI_2}"]`)).toBeVisible()
  // …and in the RIGHT states. `toBeVisible` alone can't tell: a card marked
  // done is visible for the ~450 ms of its fly-out, which is longer than the
  // first check takes, so it passed while the running project's card was
  // quietly sailing off screen. The status attribute is the honest assertion.
  // (It was: the inherited report lines were counted as finished PROJECTS,
  // and one Daz line was enough to mark card #1 done on arrival.)
  await expect(page.locator(`[data-task="hou:${P.houdini}"]`)).toHaveAttribute(
    'data-task-status',
    'active',
  )
  await expect(page.locator(`[data-task="hou:${HOUDINI_2}"]`)).toHaveAttribute(
    'data-task-status',
    'waiting',
  )
  await expect(page.locator('[data-export-log]')).toContainText('Baking textures 7/12…')

  // THE POINT: when this project finishes, the queued one starts — that is
  // what a reload used to drop on the floor, with no error anywhere.
  await houdiniReportsDone(page)
  // Poll the LAUNCH, not the job file: the job file is seeded (the run was
  // already in flight), so it proves nothing about the queue moving on.
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          ((window as any).__tauriMock.calls as Array<{ cmd: string; args: any }>)
            .filter((c) => c.cmd === 'launch_houdini_job')
            // The command takes ONE `request` struct (camelCase serde) — the
            // scene path is inside it.
            .map((c) => c.args.request.scenePath as string),
        ),
      { timeout: 20_000 },
    )
    .toContain(HOUDINI_2)
})

test('the restored run still delivers ONE report, naming the legs it never saw', async ({
  page,
}) => {
  // No queue this time: the last project of the run. The Daz leg's line was
  // written by the window that reloaded away — it rides in the plan so the
  // report is still whole.
  await openMidLeg(page, {
    characterId: 'char-kira',
    hipPath: P.houdini,
    jobPath: HOUDINI_JOB,
    resultPath: HOUDINI_RESULT,
    scenes: 1,
    startedAtMs: Date.now() - 120_000,
    remaining: [],
    sceneScope: [P.scene],
    reportLines: ['Daz: 1/1 scene exported in 2m 03s'],
    anyFailed: false,
  })
  await expect(page.getByRole('button', { name: /Working/ })).toBeVisible({ timeout: 15_000 })

  await houdiniReportsDone(page)
  await expect(page.getByText(/DTH Export finished/)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/Daz: 1\/1 scene exported in 2m 03s/)).toBeVisible()
  await expect(page.getByText(/Kira: 1 exported/)).toBeVisible()
  // The plan dies with the run — a later reload must not adopt a finished one.
  await expect.poll(() => fileContent(page, RUN_PLAN)).toBeNull()
})
