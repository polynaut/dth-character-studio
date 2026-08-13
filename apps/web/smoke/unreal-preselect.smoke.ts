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
//
// Nothing sits UNDER the project rows any more. There was a second tick list
// there, built from the export folder — i.e. from what a PREVIOUS run wrote —
// so the sets a run was about to make were not in it at all, and a ticked
// project with no ticked set held Start. That made the one thing it existed for
// (putting a NEW character into an Unreal project) impossible. Which sets go is
// the studio's own answer now, and the run's task cards say it per set.

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
  // The row says WHY it is ticked — this project already holds what this run
  // refreshes — and that is the whole of what the section asks and answers.
  await expect(dialog.getByText('Already has this character')).toBeVisible()
})

test('…and does NOT tick for a run whose variant that project has never seen', async ({ page }) => {
  const dialog = await openDialog(page)

  // The other project: it writes KiraSummertide, which DemoGame has no assets
  // for. Nothing to refresh — so nothing is pre-selected, and a first import
  // stays the user's own decision.
  await dialog.getByRole('checkbox', { name: 'Run in KiraSummertide' }).check()
  await dialog.getByRole('checkbox', { name: 'Run in Kira', exact: true }).uncheck()
  await expect(dialog.getByRole('checkbox', { name: 'Send to DemoGame' })).not.toBeChecked()
  // …and the row doesn't claim otherwise: this project holds a DIFFERENT
  // variant, which is not "has what this run makes".
  await expect(dialog.getByText('Already has this character')).toHaveCount(0)
  // Ticking it is all it takes — the tick list that used to sit under here
  // could not offer a set that isn't on disk yet, so it made the first import
  // of a new variant impossible.
  await dialog.getByRole('checkbox', { name: 'Send to DemoGame' }).check()
  await expect(dialog.getByRole('checkbox', { name: 'Send to DemoGame' })).toBeChecked()
})

test('ONE task row per re-import — two sets into one project are two jobs', async ({ page }) => {
  // The third leg speaks where the other two do: the run's own task list and
  // its one status line. And it says so per JOB — two export sets going into
  // one Unreal project are two imports, so they are two rows, both naming the
  // project they land in. One row per PROJECT read as "one thing is happening"
  // about work that is two.
  const seed = buildSeed({
    activeProjectFile: P.dcsp,
    demo: true,
    houdiniProject: true,
    unrealProjects: [UPROJECT],
  })
  seed.files[`${EXPORT_ROOT}/KiraDefault/DTH_KiraDefault.dth`] = '{}'
  seed.files[`${EXPORT_ROOT}/KiraSummertide/DTH_KiraSummertide.dth`] = '{}'
  // Only KiraDefault is already in that project — so its row is a RE-import
  // and the other one's is a first import. The studio located them itself.
  seed.files[IMPORTED] = 'uasset-fixture'
  seed.files[`${UPROJECT_DIR}/Plugins/DTHCharacterStudioRunner/DTHCharacterStudioRunner.uplugin`] = JSON.stringify({
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
  // "Use last exports" hands over what is ON DISK — both sets, worked out
  // rather than picked.
  await dialog.getByRole('checkbox', { name: 'Send to DemoGame' }).check()
  await dialog.getByRole('button', { name: 'Start' }).click()

  // TWO rows for the ONE project, each named by the export set it carries —
  // the "final character" that lands in Unreal — and each saying which of the
  // two things it is about to do.
  const rows = page.locator('[data-task^="ue:"]')
  await expect(rows).toHaveCount(2, { timeout: 15_000 })
  await expect(rows.filter({ hasText: 'KiraDefault' })).toContainText('Re-import · DemoGame')
  await expect(rows.filter({ hasText: 'KiraSummertide' })).toContainText('First import · DemoGame')

  // The status line carries the leg's newest word — one line, not a transcript.
  await expect(page.locator('[data-export-status]')).toContainText(
    /Unreal; queued for DemoGame/,
  )

  // …and when the editor finally answers, the outcome becomes that line.
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
  await expect(page.locator('[data-export-status]')).toContainText(
    /Unreal; re-imported 1 asset in .Game.Characters.Kira/,
    { timeout: 15_000 },
  )
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
  seed.files[`${UPROJECT_DIR}/Plugins/DTHCharacterStudioRunner/DTHCharacterStudioRunner.uplugin`] = JSON.stringify({
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
  await dialog.getByRole('button', { name: 'Start' }).click()

  await expect(page.getByText(/Unreal: queued for DemoGame/)).toBeVisible()
  // Nothing claims it (no editor in the fake world), so after the grace period
  // the project is handed to the OS the same way a `.hip` or `.duf` is.
  await expect
    .poll(() => callsNamed(page, 'shell_open_file'), { timeout: 15_000 })
    .toEqual([{ path: UPROJECT }])
})
