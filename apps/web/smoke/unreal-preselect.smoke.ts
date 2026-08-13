import { expect, test } from '@playwright/test'

import { P, UPROJECT, buildSeed, scanStoreEntryKey } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'
import { UNREAL_BRIDGE_VERSION } from '../src/lib/rom/unreal-jobs.ts'

/** The commands the fake recorded, newest last — see the twin in
 *  daz-launch-activated.smoke.ts. */
const callsNamed = (page: import('@playwright/test').Page, cmd: string) =>
  page.evaluate(
    (name) =>
      ((window as any).__tauriMock.calls as Array<{ cmd: string; args: any }>)
        .filter((c) => c.cmd === name)
        .map((c) => c.args),
    cmd,
  )

// The DTH Export dialog's UNREAL pre-selection, end to end through the fake:
// stored scan (`exportSets`) → what this run writes → is any of THAT already in
// the Unreal project → tick.
//
// Reported twice, and the reason this spec exists at all: picking the THICK
// scene and its project pre-ticked the Unreal project, because that project
// held a DIFFERENT variant of the same character. "Has this character" is not
// "has what this run makes", and the two are only distinguishable once the scan
// reports each project's export-set names.

const STORE = `${P.project}/.dcsmeta/characters/Kira/houdini-scan.json`
const HOUDINI_2 = 'D:/DTH Projects/Demo/Kira/houdini/KiraSummertide.hip'
const UPROJECT_DIR = UPROJECT.replace(/\/[^/]*$/, '')
/** The character's FINAL export folder — one subfolder per export set, each
 *  holding the `DTH_<set>.dth` the send hands over. Not `daz-export`. */
const EXPORT_ROOT = `${P.charFolder}/export`
/** In the Unreal project, in a folder of the USER's choosing — the shape that
 *  broke the first implementation, which only ever looked under DazToHue/. */
const IMPORTED = `${UPROJECT_DIR}/Content/Characters/Kira/SKM_KiraDefault.uasset`

const storeKey = (hipPath: string) => scanStoreEntryKey(hipPath, P.exportDir)

function scan(hipPath: string, exportSets: Array<string>) {
  return {
    hipPath,
    ok: true,
    error: '',
    nodes: [],
    job: P.charFolder,
    fps: 30,
    // Left empty on purpose: this spec is about what a project WRITES, and the
    // import-based scene matching has its own spec. An empty `imports` never
    // un-ticks a project (the studio cannot know), so both stay selectable.
    imports: [],
    exportSets,
    refs: { collapsible: 0, foreign: 0, broken: [], hipRelative: [] },
    prefill: { fillable: [], missing: [] },
  }
}

async function openDialog(page: import('@playwright/test').Page) {
  const seed = buildSeed({
    activeProjectFile: P.dcsp,
    demo: true,
    houdiniProject: true,
    extraScene: true,
    unrealProjects: [UPROJECT],
  })
  const character = JSON.parse(seed.files[`${P.charFolder}/Kira.json`]) as Record<string, unknown>
  character.houdiniProjects = [P.houdini, HOUDINI_2]
  seed.files[`${P.charFolder}/Kira.json`] = JSON.stringify(character)
  seed.files[HOUDINI_2] = 'hip-fixture'
  // Two export sets on disk. Only KiraDefault is imported in Unreal.
  seed.files[`${EXPORT_ROOT}/KiraDefault/DTH_KiraDefault.dth`] = '{}'
  seed.files[`${EXPORT_ROOT}/KiraSummertide/DTH_KiraSummertide.dth`] = '{}'
  seed.files[IMPORTED] = 'uasset-fixture'
  seed.files[STORE] = JSON.stringify({
    version: 1,
    projects: Object.fromEntries(
      [
        { hipPath: P.houdini, exportSets: ['KiraDefault'] },
        { hipPath: HOUDINI_2, exportSets: ['KiraSummertide'] },
      ].map((entry) => [
        entry.hipPath.toLowerCase(),
        {
          key: storeKey(entry.hipPath),
          scannedAt: '2026-08-12T00:00:00.000Z',
          project: scan(entry.hipPath, entry.exportSets),
        },
      ]),
    ),
  })
  await page.addInitScript(installTauriMock, seed)
  await page.addInitScript((storePath: string) => {
    const mock = (window as any).__tauriMock
    const raw = mock.files.get(storePath) as string
    mock.files.set(storePath, raw.replace(/__MTIME__/g, String(mock.mtimeMs)))
  }, STORE)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()
  await page.getByRole('button', { name: 'DTH Export' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  return dialog
}

test('the Unreal project ticks for a run that refreshes what it already holds', async ({
  page,
}) => {
  const dialog = await openDialog(page)

  // Only the project writing KiraDefault — the set that IS in DemoGame.
  await dialog.getByRole('checkbox', { name: 'Run in Kira', exact: true }).check()
  await dialog.getByRole('checkbox', { name: 'Run in KiraSummertide' }).uncheck()
  await expect(dialog.getByRole('checkbox', { name: 'Send to DemoGame' })).toBeChecked()
  // …and the set list says which one, and where it will land.
  const set = dialog.locator('li').filter({ hasText: 'KiraDefault' })
  await expect(set.getByText('/Game/Characters/Kira')).toBeVisible()
  await expect(set.getByRole('checkbox')).toBeChecked()
  // The set this project does NOT write stays off, whatever its own state.
  const other = dialog.locator('li').filter({ hasText: 'KiraSummertide' })
  await expect(other.getByRole('checkbox')).not.toBeChecked()
  await expect(other.getByText('not in this project')).toBeVisible()
})

test('…and does NOT tick for a run whose variant that project has never seen', async ({ page }) => {
  const dialog = await openDialog(page)

  // The other project: it writes KiraSummertide, which DemoGame has no assets
  // for. Nothing to refresh — so nothing is pre-selected, and a first import
  // stays the user's own decision.
  await dialog.getByRole('checkbox', { name: 'Run in KiraSummertide' }).check()
  await dialog.getByRole('checkbox', { name: 'Run in Kira', exact: true }).uncheck()
  await expect(dialog.getByRole('checkbox', { name: 'Send to DemoGame' })).not.toBeChecked()
  // Every set row unticked — including the one DemoGame HAS, since this run
  // does not touch it.
  const boxes = dialog.locator('li').filter({ hasText: /Kira(Default|Summertide)/ }).getByRole('checkbox')
  for (const box of await boxes.all()) await expect(box).not.toBeChecked()
})

test('the Unreal leg reports into the run’s own log window', async ({ page }) => {
  // The third leg speaks where the other two do. It briefly had a status panel
  // of its own on the character page — a second place to look for a third of
  // one run — and the transcript is where a run says what it is doing.
  const seed = buildSeed({
    activeProjectFile: P.dcsp,
    demo: true,
    houdiniProject: true,
    unrealProjects: [UPROJECT],
  })
  seed.files[`${EXPORT_ROOT}/KiraDefault/DTH_KiraDefault.dth`] = '{}'
  seed.files[IMPORTED] = 'uasset-fixture'
  seed.files[`${UPROJECT_DIR}/Plugins/DTHStudioBridge/DTHStudioBridge.uplugin`] = JSON.stringify({
    // From the source of truth, so bumping the bridge can never strand this
    // fixture into "your bridge is out of date" (the same rule the scan-store
    // key follows).
    Version: UNREAL_BRIDGE_VERSION,
  })
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()
  await page.getByRole('button', { name: 'DTH Export' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  await dialog.locator('#daz-mode').click()
  await page.getByRole('option', { name: /Skip Daz/ }).click()
  await dialog.locator('#houdini-mode').click()
  await page.getByRole('option', { name: /Skip Houdini/ }).click()
  await dialog.getByRole('checkbox', { name: 'Send to DemoGame' }).check()
  await dialog.locator('li').filter({ hasText: 'KiraDefault' }).getByRole('checkbox').check()
  await dialog.getByRole('button', { name: 'Start' }).click()

  // In the log window, stamped like every other line of the run.
  await expect(page.getByText(/Unreal; queued for DemoGame - KiraDefault/)).toBeVisible()
  await expect(page.getByText(/Unreal; waiting for the editor to pick the job up/)).toBeVisible()

  // …and when the editor finally answers, the outcome is a line too.
  await page.evaluate((dir: string) => {
    const mock = (window as any).__tauriMock
    mock.files.delete(`${dir}/Saved/DTHStudio/job.json`)
    mock.files.set(
      `${dir}/Saved/DTHStudio/result.json`,
      JSON.stringify({
        version: 4,
        state: 'done',
        error: '',
        imports: [
          {
            character: 'KiraDefault',
            destination: '/Game/Characters/Kira',
            mode: 'reimport',
            assets: ['/Game/Characters/Kira/SKM_KiraDefault'],
          },
        ],
      }),
    )
  }, UPROJECT_DIR)
  await expect(
    page.getByText(/Unreal; re-imported 1 asset in .Game.Characters.Kira/),
  ).toBeVisible({ timeout: 15_000 })
})

test('nothing claims the job and no editor is running — the studio opens the project', async ({
  page,
}) => {
  // The studio does not start Unreal to RUN an import (an editor takes minutes
  // and holds its project), but a queued job with nothing watching is a run
  // that visibly does nothing. Opening the project is the rest of that leg: the
  // bridge claims the job on startup.
  //
  // Driven through the ONE way to send — the DTH Export dialog, with both Daz
  // and Houdini skipped, which is the "just re-import in Unreal" run.
  const seed = buildSeed({
    activeProjectFile: P.dcsp,
    demo: true,
    houdiniProject: true,
    unrealProjects: [UPROJECT],
  })
  seed.files[`${EXPORT_ROOT}/KiraDefault/DTH_KiraDefault.dth`] = '{}'
  seed.files[IMPORTED] = 'uasset-fixture'
  // The bridge is installed and current, or the send refuses before it starts.
  seed.files[`${UPROJECT_DIR}/Plugins/DTHStudioBridge/DTHStudioBridge.uplugin`] = JSON.stringify({
    // From the source of truth, so bumping the bridge can never strand this
    // fixture into "your bridge is out of date" (the same rule the scan-store
    // key follows).
    Version: UNREAL_BRIDGE_VERSION,
  })
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()
  await page.getByRole('button', { name: 'DTH Export' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()

  // Skip Daz, skip Houdini: the whole run is the send.
  await dialog.locator('#daz-mode').click()
  await page.getByRole('option', { name: /Skip Daz/ }).click()
  await dialog.locator('#houdini-mode').click()
  await page.getByRole('option', { name: /Skip Houdini/ }).click()
  await dialog.getByRole('checkbox', { name: 'Send to DemoGame' }).check()
  await dialog.locator('li').filter({ hasText: 'KiraDefault' }).getByRole('checkbox').check()
  await dialog.getByRole('button', { name: 'Start' }).click()

  await expect(page.getByText(/Unreal: queued for DemoGame/)).toBeVisible()
  // Nothing claims it (no editor in the fake world), so after the grace period
  // the project is handed to the OS the same way a `.hip` or `.duf` is.
  await expect
    .poll(() => callsNamed(page, 'shell_open_file'), { timeout: 15_000 })
    .toEqual([{ path: UPROJECT }])
})
