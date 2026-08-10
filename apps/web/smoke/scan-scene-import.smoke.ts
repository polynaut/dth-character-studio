import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// Import from Daz scene: the studio runs Scan_Frames for you. Unit tests pin
// the api's half of the handoff (scan-run-api.test.ts) and the checks
// (scene-compat.test.tsx); what only this layer can see is the WIRING — the
// dialog reaching the api, the poll landing in the frame-range picker, and the
// two states that used to leak: an abandoned job file, and a dropped scene
// surviving into the next import.

const SCRIPTS_ROOT = `${P.dazLib}/Scripts/DTH-Character-Studio`
const PENDING_JOB = `${SCRIPTS_ROOT}/dth_exporter_jobs.json`
const RUN_SCRIPT = `${SCRIPTS_ROOT}/.dth_scan_run.dsa`
const SCAN_DIR = `${P.appData}/scan-frames`
/** A ROM scene of the character's own generation, with keys on the timeline. */
const ROM_SCENE = 'D:/DTH Projects/Demo/Kira/daz3d/Kira_ROM_G9.duf'
const SCAN_CSV = `${SCAN_DIR}/Kira_ROM_G9.csv`
const SCAN_RESULT = `${SCAN_DIR}/Kira_ROM_G9.scan.json`

const fileContent = (page: Page, path: string) =>
  page.evaluate((p) => ((window as any).__tauriMock.files.get(p) ?? null) as string | null, path)
const hasFile = (page: Page, path: string) =>
  page.evaluate((p) => (window as any).__tauriMock.files.has(p) as boolean, path)
const unhandledCommands = (page: Page) =>
  page.evaluate(() => (window as any).__tauriMock.unhandled as Array<string>)

/** Write the files a finished Daz-side scan leaves behind.
 *
 * The CSV's mtime has to be stamped explicitly: the fake gives every file one
 * fixed mtime from page-install time, and the poll refuses a CSV older than the
 * run that claims it — which is exactly the guard that keeps a silently-failed
 * `printCSV` from importing the PREVIOUS scan's frames as this one's. */
const finishScan = (page: Page, frames: number) =>
  page.evaluate(
    ([csv, result, csvRows, n]) => {
      const mock = (window as any).__tauriMock
      mock.files.set(csv, csvRows)
      mock.setMtime(csv, Date.now())
      mock.files.set(result, JSON.stringify({ ok: true, error: '', csvPath: csv, frames: n }))
    },
    [
      SCAN_CSV,
      SCAN_RESULT,
      // Two keyed frames of one morph — enough for the frame-range picker.
      '188,,,Genesis9,FBMBodyTone,1\n189,,,Genesis9,FBMBodyThin,1\n',
      frames,
    ] as const,
  )

function seed() {
  const base = buildSeed({
    activeProjectFile: P.dcsp,
    demo: true,
    // The picker returns the ROM scene; the scene reports one G9 figure (demo)
    // and a full timeline, so all three checks pass.
    dialogPath: ROM_SCENE,
    sceneAnimationFrames: { [ROM_SCENE]: 260 },
  })
  // The per-run script `include`s the runtime from its own folder, so the studio
  // refuses to write one before the runtime is installed. A character that has
  // ever been saved has it; seed it rather than saving first.
  base.files[`${SCRIPTS_ROOT}/.DthUtils.dsa`] = '// runtime'
  return base
}

/** Open the demo character and its populated FBM section, then the import
 *  dialog. Returns nothing — every spec below starts from the same place. */
async function openImportDialog(page: Page) {
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByRole('button', { name: 'FBM Full Body' }).click()
  await page.getByRole('button', { name: 'Import from Daz scene' }).first().click()
  await expect(page.getByRole('heading', { name: /Import into Full Body/ })).toBeVisible()
}

test('scan a scene: the handoff goes out, the result comes back, the frames land', async ({
  page,
}) => {
  await page.addInitScript(installTauriMock, seed())
  await openImportDialog(page)

  // Nothing to scan until a scene is picked — Start only exists after one.
  await expect(page.getByRole('button', { name: 'Start scan' })).toHaveCount(0)
  await page.getByRole('button', { name: /Pick a scene/ }).click()

  // The three Import-from-Daz-scene checks, all passing on this scene. The
  // animation row is the one that INVERTS the add-scene rule.
  await expect(page.getByText('260 frames')).toBeVisible()
  const start = page.getByRole('button', { name: 'Start scan' })
  await expect(start).toBeEnabled()
  await start.click()

  // The per-run script lands beside the runtime it includes, silent and
  // carrying the generation the run selects its figure by.
  await expect.poll(() => fileContent(page, RUN_SCRIPT)).toContain('silent: true')
  expect(await fileContent(page, RUN_SCRIPT)).toContain('genesis: "G9"')
  // …and the job file hands the Runner that scene AND that script.
  const job = JSON.parse((await fileContent(page, PENDING_JOB))!)
  expect(job.jobs).toEqual([
    expect.objectContaining({ scenePath: ROM_SCENE, scriptPath: RUN_SCRIPT }),
  ])

  await expect(page.getByText(/scanning its frames/)).toBeVisible()

  // Daz finishes: the CSV and its result appear, the poll picks them up, and
  // the import continues into the frame-range picker.
  await finishScan(page, 260)
  // The frame-range picker, reading the CSV the scan just wrote. (Same dialog
  // title — its range line is what tells the two apart.)
  await expect(page.getByText(/The CSV holds frames 188–189/)).toBeVisible({ timeout: 10_000 })

  expect(await unhandledCommands(page)).toEqual([])
})

test('cancelling a scan takes the job file back, so the next batch is not blocked', async ({
  page,
}) => {
  // The failure this guards: a job file left pending refuses every later export
  // AND scan with "a batch is waiting for Daz Studio", with no way out.
  await page.addInitScript(installTauriMock, seed())
  await openImportDialog(page)
  await page.getByRole('button', { name: /Pick a scene/ }).click()
  await page.getByRole('button', { name: 'Start scan' }).click()
  await expect.poll(() => hasFile(page, PENDING_JOB)).toBe(true)

  await page.getByRole('button', { name: 'Cancel scan' }).click()

  await expect.poll(() => hasFile(page, PENDING_JOB)).toBe(false)
  // Back to the pickable state, ready to start again rather than stuck.
  await expect(page.getByRole('button', { name: 'Start scan' })).toBeEnabled()
})

test('closing the dialog mid-scan releases the handoff too', async ({ page }) => {
  // Same stranding, reached the other way — the Esc/Cancel exit is not a
  // different promise from the "Cancel scan" button.
  await page.addInitScript(installTauriMock, seed())
  await openImportDialog(page)
  await page.getByRole('button', { name: /Pick a scene/ }).click()
  await page.getByRole('button', { name: 'Start scan' }).click()
  await expect.poll(() => hasFile(page, PENDING_JOB)).toBe(true)

  await page.keyboard.press('Escape')

  await expect(page.getByRole('heading', { name: /Import into Full Body/ })).toHaveCount(0)
  await expect.poll(() => hasFile(page, PENDING_JOB)).toBe(false)
})

test('a finished import leaves the picker clean for the next one', async ({ page }) => {
  // The picked scene is per-OPENING state, and the path that used to keep it
  // was this one: finishing an import closes the picker WITHOUT clearing it, so
  // the next import came up already pointed at the old scene.
  //
  // Reproducing the leak end-to-end also needs a `.duf` DROPPED on the Import
  // button (the only thing that seeds that state), and the fake has no native
  // drag-drop — so this drives the close path that leaked and pins the
  // invariant, rather than the drop that exposed it. The drop half is held by
  // construction: one `closePicker()` owns both pieces of state.
  await page.addInitScript(installTauriMock, seed())
  await openImportDialog(page)
  await page.getByRole('button', { name: /Pick a scene/ }).click()
  await expect(page.getByText('260 frames')).toBeVisible()
  await page.getByRole('button', { name: 'Start scan' }).click()
  await finishScan(page, 260)

  // The import got as far as the frame-range picker — i.e. the scan dialog
  // closed through `loadCsv`, the path in question. Back out of it.
  await expect(page.getByText(/The CSV holds frames 188–189/)).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()

  await page.getByRole('button', { name: 'Import from Daz scene' }).first().click()
  await expect(page.getByRole('heading', { name: /Import into Full Body/ })).toBeVisible()
  // No scene carried over: no checks, and no Start to press by accident.
  await expect(page.getByText('260 frames')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Start scan' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Pick a scene…' })).toBeVisible()
})
