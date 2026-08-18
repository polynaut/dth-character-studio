import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// **A new run retires the old report.** The ROM run report is the last run's
// verdict — a red banner, a red "Errors in the last ROM run" jump button in the
// sticky header, and red rows on every ROM row walking a failed morph. It used
// to survive the START of the next run and sit there over a live progress bar
// until Daz eventually wrote a fresh log, which reads as "the run I just
// started is already broken".
//
// Both halves are here: the on-screen state goes at the handoff, and the STORE
// goes with it — the character page re-reads the log on every window focus (the
// user is about to alt-tab to Daz), and the ingest merges per scene, so a
// surviving store would put the old failures straight back.
//
// PER SCENE on both paths (`scenesRetiredByRun`): a run retires the scenes it
// re-runs and nothing else, so findings for a scene it never opens survive —
// nothing is coming to rewrite those.

const DAZ_INSTALL = 'C:/Program Files/DAZ 3D/DAZStudio4'
const SCRIPTS_ROOT = `${P.dazLib}/Scripts/DTH-Character-Studio`
const PENDING_JOB = `${SCRIPTS_ROOT}/dth_exporter_jobs.json`
/** The studio's stored copy of the last run log (`LAST_ROM_RUN_FILE`). */
const STORED_LOG = `${P.charMeta}/.last_rom_run.json`

/** A log v2 record: one failing run per named scene, each with a failed morph —
 *  the state that paints the banner red and marks those scenes' ROM rows. */
function failedRunLog(...scenes: Array<string>): string {
  return JSON.stringify({
    logVersion: 2,
    character: 'Kira',
    ok: false,
    runs: scenes.map((scene) => ({
      scene,
      sceneName: scene.split('/').pop()?.replace(/\.duf$/, ''),
      finishedAt: 'Mon Jan 5 10:00:00 2026',
      finishedAtMs: Date.parse('2026-01-05T10:00:00Z'),
      ok: false,
      errors: ['A morph in the ROM could not be applied.'],
      failedMorphs: [{ frame: 12, node: 'Genesis9', prop: 'CTRLNotThere', reason: 'no such morph' }],
    })),
  })
}

const hasFile = (page: Page, path: string) =>
  page.evaluate((p) => ((window as any).__tauriMock.files as Map<string, string>).has(p), path)
const storedLogScenes = (page: Page) =>
  page.evaluate((p) => {
    const text = ((window as any).__tauriMock.files as Map<string, string>).get(p)
    return text ? (JSON.parse(text).runs as Array<{ scene: string }>).map((r) => r.scene) : null
  }, STORED_LOG)

test('starting a DTH Export run clears the previous run’s errors — banner, jump button and store', async ({
  page,
}) => {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true, dazInstallFolder: DAZ_INSTALL })
  seed.files[`${SCRIPTS_ROOT}/Demo/Kira/.Bulk_ROM_Export.dsa`] = '// bulk-export fixture'
  seed.files[STORED_LOG] = failedRunLog(P.scene)
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()

  // The state the user is looking at when they press DTH Export again.
  const report = page.getByRole('heading', { name: /The last ROM run in Daz reported/ })
  await expect(report).toBeVisible()

  await page.getByRole('button', { name: 'DTH Export' }).click()
  await page.getByRole('button', { name: 'Start' }).click()

  // The handoff went out…
  await expect.poll(() => hasFile(page, PENDING_JOB)).toBe(true)
  // …and the previous run's verdict went with it, on screen…
  await expect(report).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Errors in the last ROM run/ })).toHaveCount(0)
  // …and on disk, so the on-focus refetch cannot bring it back.
  expect(await hasFile(page, STORED_LOG)).toBe(false)
})

test('“Generate new ROM” retires ONLY the scene it rebuilds', async ({ page }) => {
  // The single-scene counterpart. It re-runs one scene and supersedes nothing
  // else, so the other scene's findings have to survive — nothing is coming to
  // rewrite them.
  const seed = buildSeed({
    activeProjectFile: P.dcsp,
    demo: true,
    extraScene: true,
    dazInstallFolder: DAZ_INSTALL,
  })
  seed.files[`${SCRIPTS_ROOT}/Demo/Kira/.Build_ROM_Animation.dsa`] = '// rom-build fixture'
  seed.files[STORED_LOG] = failedRunLog(P.scene, P.scene2)
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()

  // Both scenes are reporting.
  // One error + one failed morph per scene = four problems across two scenes.
  await expect(
    page.getByRole('heading', { name: /reported 4 problems across 2 scenes/ }),
  ).toBeVisible()

  // The primary scene's card → its open menu → rebuild. No saved ROM animation
  // exists in this seed, so the menu offers the rebuild outright.
  await page.getByRole('button', { name: /Open in Daz/ }).first().click()
  await page.getByRole('button', { name: /Generate new ROM/ }).click()

  // The report SURVIVES — narrowed to the scene that was not rebuilt.
  await expect(page.getByRole('heading', { name: /reported 2 problems$/ })).toBeVisible()
  await expect.poll(() => storedLogScenes(page)).toEqual([P.scene2])
})

test('a DTH Export batch retires only the scenes it RUNS', async ({ page }) => {
  // The batch is a selection, so it supersedes a selection. Unticking the extra
  // scene has to leave that scene's findings standing — nothing else is going
  // to re-run it and rewrite them.
  const seed = buildSeed({
    activeProjectFile: P.dcsp,
    demo: true,
    extraScene: true,
    dazInstallFolder: DAZ_INSTALL,
  })
  seed.files[`${SCRIPTS_ROOT}/Demo/Kira/.Bulk_ROM_Export.dsa`] = '// bulk-export fixture'
  seed.files[STORED_LOG] = failedRunLog(P.scene, P.scene2)
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()

  // Both scenes are reporting: one error + one failed morph each.
  await expect(
    page.getByRole('heading', { name: /reported 4 problems across 2 scenes/ }),
  ).toBeVisible()

  const dialog = page.getByRole('dialog')
  await page.getByRole('button', { name: 'DTH Export' }).click()
  await dialog.getByRole('checkbox', { name: /Export KiraSummertide/ }).uncheck()
  await page.getByRole('button', { name: 'Start' }).click()

  await expect.poll(() => hasFile(page, PENDING_JOB)).toBe(true)
  // The report SURVIVES — narrowed to the scene the batch left alone, on screen
  // and in the store the focus refetch reads.
  await expect(page.getByRole('heading', { name: /reported 2 problems$/ })).toBeVisible()
  await expect.poll(() => storedLogScenes(page)).toEqual([P.scene2])
})
