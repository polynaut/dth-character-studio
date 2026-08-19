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
  // `genesis` is the owning character's own — what the worker files this
  // scene's morphs under when its figures carry no readable asset identity
  // (Daz Studio 4 answers with none; runtime v68).
  expect(config.scenes[P.scene.toLowerCase()]).toEqual({ morphs: true, genesis: 'G9' })

  // NOTHING was seeded at the scripts root: the handoff self-heals via
  // copyRuntimeFiles first (an app updated since the last save has the new
  // runtime bundled but not installed), so BOTH scripts must be on disk — with
  // the studio's app-data folder baked in — before the job points at them.
  const installed = await fileContent(page, SCENE_SCRIPT)
  expect(installed).toContain(P.appData)
  expect(installed).toContain('DthScanSceneMorphs')
  // The base row's script is the dialog-free bulk twin (`bulk: true`), not the
  // visible one whose dialogs would dead-stop a minimized Daz.
  const indexInstalled = await fileContent(page, INDEX_SCRIPT)
  expect(indexInstalled).toContain('bulk: true')
  expect(indexInstalled).toContain(P.appData)

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

test('scan project: the scene picker narrows the batch to the chosen scene', async ({ page }) => {
  // Each scene row is a full Daz open, so "re-scan just this one outfit" has to
  // be reachable — a project with dozens of scenes must not force an all-or-
  // nothing run.
  const seed = buildSeed({
    activeProjectFile: P.dcsp,
    demo: true,
    extraScene: true,
    dazInstallFolder: DAZ_INSTALL,
  })
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await openScanTab(page)

  // Collapsed by default, and covering everything until told otherwise.
  const panel = page.getByRole('tabpanel')
  await expect(panel.getByText('all 2 scenes')).toBeVisible()
  await panel.getByRole('button', { name: 'Scenes to scan' }).click()

  // Drop the outfit variant, keep the primary.
  const sceneStem = (p: string) => p.split('/').pop()!.replace(/\.duf$/i, '')
  await panel.getByRole('checkbox', { name: sceneStem(P.scene2) }).uncheck()
  await expect(panel.getByText('1 of 2')).toBeVisible()
  // The job count follows the pick, not the project's scene total.
  await expect(panel.getByText(/2 jobs to run/)).toBeVisible()

  await startButton(page).click()
  await expect(page.getByRole('button', { name: /Waiting for Daz Studio/ })).toBeVisible()

  const job = JSON.parse((await fileContent(page, PENDING_JOB))!) as JobFile
  expect(job.jobs).toEqual([
    { scenePath: '', scriptPath: INDEX_SCRIPT, status: 'pending' },
    { scenePath: P.scene, scriptPath: SCENE_SCRIPT, status: 'pending' },
  ])
  // The deselected scene is absent from the sidecar too — no orphan config.
  const config = JSON.parse((await fileContent(page, SCAN_CONFIG))!) as ScanConfig
  expect(Object.keys(config.scenes)).toEqual([P.scene.toLowerCase()])

  expect(await unhandledCommands(page)).toEqual([])
})

test('scan project: deselecting every scene blocks Start instead of sending an empty batch', async ({
  page,
}) => {
  const seed = buildSeed({
    activeProjectFile: P.dcsp,
    demo: true,
    extraScene: true,
    dazInstallFolder: DAZ_INSTALL,
  })
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await openScanTab(page)

  const panel = page.getByRole('tabpanel')
  // Untick the base pass so the batch would be scenes-only, then clear them.
  await panel.getByRole('checkbox', { name: /Base morphs/ }).uncheck()
  await panel.getByRole('button', { name: 'None' }).click()
  await expect(panel.getByText(/No scenes selected/)).toBeVisible()
  await expect(startButton(page)).toBeDisabled()
  // Nothing was handed over.
  expect(await fileContent(page, PENDING_JOB)).toBeNull()
})

test('scan project: from Home the base pass still runs, the scene passes are off', async ({
  page,
}) => {
  // No `activeProjectFile` — the Tools page reached from the Home window. This
  // panel replaced the standalone Build Genesis Index one, so the base pass has
  // to stay reachable here or that capability would simply be gone.
  const seed = buildSeed({ demo: true, dazInstallFolder: DAZ_INSTALL })
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await openScanTab(page)

  await expect(page.getByText(/No project open/)).toBeVisible()
  await expect(page.getByRole('checkbox', { name: /Character morphs/ })).toBeDisabled()
  await expect(page.getByRole('checkbox', { name: /Products/ })).toBeDisabled()
  // Base morphs stays tickable, and Start stays live off it alone.
  await expect(page.getByRole('checkbox', { name: /Base morphs/ })).toBeEnabled()
  await startButton(page).click()
  await expect(page.getByRole('button', { name: /Waiting for Daz Studio/ })).toBeVisible()

  const job = JSON.parse((await fileContent(page, PENDING_JOB))!) as JobFile
  // Exactly the batch the old standalone panel produced: one empty-scene row.
  expect(job.jobs).toEqual([{ scenePath: '', scriptPath: INDEX_SCRIPT, status: 'pending' }])
  expect(await unhandledCommands(page)).toEqual([])
})

test('scan project: two Daz Studios open — the handoff refuses with the close-one dialog', async ({
  page,
}) => {
  const seed = buildSeed({ demo: true, dazInstallFolder: DAZ_INSTALL })
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await openScanTab(page)

  // Two `DAZStudio.exe` processes = two installations open side by side (each
  // install is single-instance) — the state every batch handoff refuses.
  await page.evaluate(() => {
    ;(window as any).__tauriMock.dazInstances = 2
  })
  await startButton(page).click()

  await expect(page.getByRole('dialog', { name: /More than one Daz Studio/ })).toBeVisible()
  // Refused BEFORE anything touched disk: no job file went out.
  expect(await fileContent(page, PENDING_JOB)).toBeNull()
  await page.getByRole('button', { name: 'Got it' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
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
