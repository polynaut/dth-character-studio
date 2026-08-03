import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// Tools → Scan project: the one-click pass over everything a project can be
// scanned for. The user ticks what they want, presses Start, and waits — the
// studio hands the Runner ONE batch: the base index row first (the scene scans
// filter themselves against it), then one row per linked scene of every
// character, with a sidecar config saying what each scene is due for. One row
// per SCENE rather than per scene-and-kind, because opening a scene is the slow
// part and both scans share the one open.

const SCRIPTS_ROOT = `${P.dazLib}/Scripts/DTH-Character-Studio`
const INDEX_SCRIPT = `${SCRIPTS_ROOT}/.Build_Genesis_Index_Bulk.dsa`
const SCENE_SCRIPT = `${SCRIPTS_ROOT}/.Scan_Scene_Bulk.dsa`
const SCAN_CONFIG = `${SCRIPTS_ROOT}/dth_scan_config.json`
const PENDING_JOB = `${SCRIPTS_ROOT}/dth_exporter_jobs.json`
const RUNNING_JOB = `${SCRIPTS_ROOT}/running_dth_exporter_jobs.json`
/** A configured install folder the mock can't read resolves to an UNREADABLE
 *  runner state, which deliberately never blocks (see fixtures.ts). */
const DAZ_INSTALL = 'C:/Program Files/DAZ 3D/DAZStudio4 64-bit'

interface JobFile {
  type: string
  jobs: Array<{ scenePath: string; scriptPath: string; status: string }>
  progress?: number
  jobsDone?: number
}
interface ScanConfig {
  version: number
  scenes: Record<string, { morphs: boolean; products?: { characterName: string; outputDir: string } }>
}

const fileContent = (page: Page, path: string) =>
  page.evaluate((p) => ((window as any).__tauriMock.files.get(p) ?? null) as string | null, path)
const calledCommands = (page: Page) =>
  page.evaluate(() => ((window as any).__tauriMock.calls as Array<{ cmd: string }>).map((c) => c.cmd))
const unhandledCommands = (page: Page) =>
  page.evaluate(() => (window as any).__tauriMock.unhandled as Array<string>)

/** Reach the tab by CLICKING, never `page.goto('/tools')`: main.tsx runs a
 *  one-time startup navigation (active project → its route) that a hard goto
 *  re-triggers, bouncing straight back out of Tools. */
async function openScanTab(page: Page) {
  await page.getByRole('link', { name: 'Tools' }).click()
  await page.getByRole('tab', { name: 'Scan & index' }).click()
}

const startButton = (page: Page) =>
  page.getByRole('tabpanel').getByRole('button', { name: /Start scan|Scanning|Waiting for Daz/ })

test('scan project: base row first, then one row per scene, with the sidecar config', async ({
  page,
}) => {
  // Two linked scenes on the demo character (primary + the outfit variant).
  const seed = buildSeed({
    activeProjectFile: P.dcsp,
    demo: true,
    extraScene: true,
    dazInstallFolder: DAZ_INSTALL,
  })
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await openScanTab(page)

  // Base morphs + character morphs are the default ticks; Products is off (the
  // demo project has the Daz Products feature disabled).
  await expect(page.getByText(/2 linked scenes/)).toBeVisible()
  await startButton(page).click()
  await expect(page.getByRole('button', { name: /Waiting for Daz Studio/ })).toBeVisible()

  // The batch: the base index row FIRST (empty scenePath — the contract's "new
  // empty scene"), then one row per linked scene pointing at the scene worker.
  const job = JSON.parse((await fileContent(page, PENDING_JOB))!) as JobFile
  expect(job.type).toBe('bulk-export')
  expect(job.jobs).toEqual([
    { scenePath: '', scriptPath: INDEX_SCRIPT, status: 'pending' },
    { scenePath: P.scene, scriptPath: SCENE_SCRIPT, status: 'pending' },
    { scenePath: P.scene2, scriptPath: SCENE_SCRIPT, status: 'pending' },
  ])

  // The sidecar the worker looks itself up in — keyed the way the .dsa
  // normalizes `Scene.getFilename()`, morphs on, no product config.
  const config = JSON.parse((await fileContent(page, SCAN_CONFIG))!) as ScanConfig
  expect(config.version).toBe(1)
  expect(Object.keys(config.scenes).sort()).toEqual(
    [P.scene.toLowerCase(), P.scene2.toLowerCase()].sort(),
  )
  expect(config.scenes[P.scene.toLowerCase()]).toEqual({ morphs: true })

  // The scene worker self-installed with the app-data output path baked in.
  const installed = await fileContent(page, SCENE_SCRIPT)
  expect(installed).toContain(P.appData)
  expect(installed).toContain('DthScanSceneMorphs')

  // Daz was closed in the fixture, so the handoff starts it.
  expect(await calledCommands(page)).toContain('launch_daz_studio')
  expect(await unhandledCommands(page)).toEqual([])
})

test('scan project: the products tick adds the per-character product config to each scene', async ({
  page,
}) => {
  const seed = buildSeed({
    activeProjectFile: P.dcsp,
    demo: true,
    extraScene: true,
    dazProductsEnabled: true,
    dimManifestsFolder: 'C:/DAZ 3D/Install Manager/ManifestFiles',
    dazInstallFolder: DAZ_INSTALL,
  })
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await openScanTab(page)

  // Untick the base rebuild so the batch is scenes only, and tick Products.
  await page.getByRole('checkbox', { name: 'Base morphs' }).uncheck()
  await page.getByRole('checkbox', { name: 'Products' }).check()
  await startButton(page).click()
  await expect(page.getByRole('button', { name: /Waiting for Daz Studio/ })).toBeVisible()

  const job = JSON.parse((await fileContent(page, PENDING_JOB))!) as JobFile
  // No base row — every row is a scene row.
  expect(job.jobs.map((j) => j.scenePath)).toEqual([P.scene, P.scene2])

  // ONE row per scene even though the scene is due for BOTH scans: the whole
  // point of the sidecar is that a scene is opened once.
  const config = JSON.parse((await fileContent(page, SCAN_CONFIG))!) as ScanConfig
  const entry = config.scenes[P.scene.toLowerCase()]
  expect(entry.morphs).toBe(true)
  expect(entry.products?.characterName).toBe('Kira')
  expect(entry.products?.outputDir).toContain('product-scans')

  expect(await unhandledCommands(page)).toEqual([])
})

test('scan project: reports the finished batch with a toast on the Tools panel', async ({
  page,
}) => {
  const seed = buildSeed({
    activeProjectFile: P.dcsp,
    demo: true,
    dazInstallFolder: DAZ_INSTALL,
  })
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await openScanTab(page)

  await startButton(page).click()
  await expect(page.getByRole('button', { name: /Waiting for Daz Studio/ })).toBeVisible()

  // The Runner's pickup per the contract: rename to `running_` (the claim) and
  // keep the fake Daz alive so a sub-100 file doesn't read as a dead run.
  await page.evaluate(
    ([pending, running]) => {
      const mock = (window as any).__tauriMock
      mock.dazRunning = true
      const job = JSON.parse(mock.files.get(pending) as string) as JobFile
      job.jobs[0].status = 'running'
      mock.files.delete(pending)
      mock.files.set(running, JSON.stringify(job))
    },
    [PENDING_JOB, RUNNING_JOB],
  )
  await expect(page.getByRole('button', { name: /Scanning in Daz Studio/ })).toBeVisible({
    timeout: 10_000,
  })
  await expect(page.getByRole('button', { name: 'Abort' })).toBeHidden()

  // Every row done + progress 100 — the PANEL (the run's owner on the shared
  // watch) consumes the file and toasts the outcome.
  await page.evaluate(
    ([running]) => {
      const mock = (window as any).__tauriMock
      const job = JSON.parse(mock.files.get(running) as string) as JobFile
      for (const row of job.jobs) row.status = 'done'
      job.progress = 100
      job.jobsDone = job.jobs.length
      mock.files.set(running, JSON.stringify(job))
    },
    [RUNNING_JOB],
  )
  await expect(page.getByText(/Project scan complete/)).toBeVisible({ timeout: 10_000 })
  // Destructive consumption is the OWNER's: the finished file is gone.
  expect(await fileContent(page, RUNNING_JOB)).toBeNull()

  expect(await unhandledCommands(page)).toEqual([])
})
