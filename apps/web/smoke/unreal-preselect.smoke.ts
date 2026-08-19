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

// The DTH Export panel's UNREAL pre-selection, end to end through the fake:
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
// project with no ticked set held Start. Which sets go is the studio's own
// answer now, and the run's task cards say it per set.
//
// And the send is RE-import only: a project holding nothing this run makes has
// an inert row, and a set the project never held is dropped from the job (and
// said out loud). The first import of a character into an Unreal project is
// made in Unreal itself — a placement decision, not a batch continuation.

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

/**
 * The dialog over a seeded world, with the three facts that decide the Unreal
 * section held APART on purpose:
 *
 * - `onDisk` — export sets already in the character's export folder (what a
 *   PREVIOUS run left, and all `Skip Houdini` can ever send),
 * - `scans` — what each linked Houdini project's STORED scan says it writes
 *   (what THIS run puts in play; omit a project to leave it unscanned),
 * - `inUnreal` — sets DemoGame already holds, under a folder of the user's own
 *   choosing rather than `DazToHue/`.
 *
 * They are independent because the states worth testing are the ones where they
 * disagree — above all "the run writes a set that is not on disk yet", which is
 * the whole reason this section was rewritten.
 */
async function openDialogWith(
  page: import('@playwright/test').Page,
  opts: {
    onDisk?: Array<string>
    scans?: Array<{ hipPath: string; exportSets: Array<string> }>
    inUnreal?: Array<string>
  } = {},
) {
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
  for (const name of opts.onDisk ?? []) {
    seed.files[`${EXPORT_ROOT}/${name}/DTH_${name}.dth`] = '{}'
  }
  // `locateSets` finds a set by an asset named `*_<set>.uasset`, wherever it
  // sits under Content/ — which is how the studio can say "that project already
  // has it" without asking a running editor.
  for (const name of opts.inUnreal ?? []) {
    seed.files[`${UPROJECT_DIR}/Content/Characters/Kira/SKM_${name}.uasset`] = 'uasset-fixture'
  }
  const scans = opts.scans ?? []
  if (scans.length > 0) {
    seed.files[STORE] = JSON.stringify({
      version: 1,
      projects: Object.fromEntries(
        scans.map((entry) => [
          entry.hipPath.toLowerCase(),
          {
            key: storeKey(entry.hipPath),
            scannedAt: '2026-08-12T00:00:00.000Z',
            project: scan(entry.hipPath, entry.exportSets),
          },
        ]),
      ),
    })
  }
  await page.addInitScript(installTauriMock, seed)
  if (scans.length > 0) {
    await page.addInitScript((storePath: string) => {
      const mock = (window as any).__tauriMock
      const raw = mock.files.get(storePath) as string
      mock.files.set(storePath, raw.replace(/__MTIME__/g, String(mock.mtimeMs)))
    }, STORE)
  }
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()
  await page.getByRole('button', { name: 'DTH Export' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  return dialog
}

/** The baseline world: two export sets on disk, only KiraDefault imported in
 *  Unreal, and each Houdini project scanned as writing one of them. */
const openDialog = (page: import('@playwright/test').Page) =>
  openDialogWith(page, {
    onDisk: ['KiraDefault', 'KiraSummertide'],
    inUnreal: ['KiraDefault'],
    scans: [
      { hipPath: P.houdini, exportSets: ['KiraDefault'] },
      { hipPath: HOUDINI_2, exportSets: ['KiraSummertide'] },
    ],
  })

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
  await expect(dialog.getByText('Already has what this run sends')).toBeVisible()
})

test('…and goes INERT for a run whose variant that project has never seen', async ({ page }) => {
  const dialog = await openDialog(page)

  // The other project: it writes KiraSummertide, which DemoGame has no assets
  // for. Nothing to re-import — and the send is re-import ONLY, so the row is
  // not merely unticked but inert, and it says where the first import is made
  // instead.
  await dialog.getByRole('checkbox', { name: 'Run in KiraSummertide' }).check()
  await dialog.getByRole('checkbox', { name: 'Run in Kira', exact: true }).uncheck()
  const send = dialog.getByRole('checkbox', { name: 'Send to DemoGame' })
  await expect(send).not.toBeChecked()
  await expect(send).toBeDisabled()
  // …and the row doesn't claim otherwise: this project holds a DIFFERENT
  // variant, which is not "has what this run makes".
  await expect(dialog.getByText('Already has what this run sends')).toHaveCount(0)
  await expect(dialog.getByText(/make the first import in Unreal/)).toBeVisible()
})

// The set this run WRITES is not in the export folder yet — the actual reported
// shape (a THICK variant nothing had exported). The pre-tick asks "does that
// project already hold what this run makes", and it answers from a probe that
// reads the EXPORT FOLDER's set names: left to itself it reports "not in that
// project" about a name it never looked for, and a re-import reads as a first
// import. Both halves are tested here — when the project has it, and when it
// genuinely does not.
test('a set this run CREATES is looked for in Unreal, not assumed missing', async ({ page }) => {
  const dialog = await openDialogWith(page, {
    // KiraSummertide is NOT on disk — this run would be its first export from
    // this studio project…
    onDisk: ['KiraDefault'],
    scans: [
      { hipPath: P.houdini, exportSets: ['KiraDefault'] },
      { hipPath: HOUDINI_2, exportSets: ['KiraSummertide'] },
    ],
    // …but DemoGame already holds it, in the user's own folder. So it is a
    // REFRESH, and the send will import it where those assets already are.
    inUnreal: ['KiraDefault', 'KiraSummertide'],
  })

  await dialog.getByRole('checkbox', { name: 'Run in KiraSummertide' }).check()
  await dialog.getByRole('checkbox', { name: 'Run in Kira', exact: true }).uncheck()
  await expect(dialog.getByRole('checkbox', { name: 'Send to DemoGame' })).toBeChecked()
  await expect(dialog.getByText('Already has what this run sends')).toBeVisible()
})

test('…and one that is genuinely nowhere cannot be sent at all', async ({ page }) => {
  const dialog = await openDialogWith(page, {
    onDisk: ['KiraDefault'],
    scans: [
      { hipPath: P.houdini, exportSets: ['KiraDefault'] },
      { hipPath: HOUDINI_2, exportSets: ['KiraSummertide'] },
    ],
    // Not on disk, and not in DemoGame either — the probe now asks, and the
    // answer is a real no. Without this half, "probe for everything" would
    // pass the test above by ticking indiscriminately.
    inUnreal: ['KiraDefault'],
  })

  await dialog.getByRole('checkbox', { name: 'Run in KiraSummertide' }).check()
  await dialog.getByRole('checkbox', { name: 'Run in Kira', exact: true }).uncheck()
  const send = dialog.getByRole('checkbox', { name: 'Send to DemoGame' })
  await expect(send).not.toBeChecked()
  // Re-import only: nothing of this run's is in there, so there is nothing
  // this leg could do — the first import is made in Unreal itself.
  await expect(send).toBeDisabled()
  await expect(dialog.getByText('Already has what this run sends')).toHaveCount(0)
})

// The two states where the studio KNOWS the run puts nothing in play. They must
// not send: an empty set list reaches `startUnrealImport` as "every set in the
// export folder", so a run believed to produce nothing would hand over a stale
// export. The rows go inert instead — the distinction `sendSets: null`
// ("cannot say") vs `[]` ("nothing") exists for exactly this.
test('“use last exports” with an empty export folder sends nothing, and says why', async ({
  page,
}) => {
  const dialog = await openDialogWith(page, { onDisk: [], inUnreal: ['KiraDefault'] })

  await dialog.locator('#daz-mode').click()
  await page.getByRole('option', { name: /Skip Daz/ }).click()
  await dialog.locator('#houdini-mode').click()
  await page.getByRole('option', { name: /Skip Houdini/ }).click()

  await expect(dialog.getByText(/Nothing in the export folder yet/)).toBeVisible()
  // Inert, not merely unticked: a tickable row here would arm a send of "every
  // set in the export folder" on a run that has none.
  await expect(dialog.getByRole('checkbox', { name: 'Send to DemoGame' })).toBeDisabled()
  // The send IS the whole run in this mode, so there is nothing left to start.
  await expect(dialog.getByRole('button', { name: 'Start' })).toBeDisabled()
})

test('a scanned Houdini project that writes no export set arms no send', async ({ page }) => {
  const dialog = await openDialogWith(page, {
    // There IS a stale export on disk — precisely what must not go out on a run
    // that produces nothing.
    onDisk: ['KiraDefault'],
    inUnreal: ['KiraDefault'],
    scans: [{ hipPath: P.houdini, exportSets: [] }],
  })

  await dialog.getByRole('checkbox', { name: 'Run in Kira', exact: true }).check()
  await dialog.getByRole('checkbox', { name: 'Run in KiraSummertide' }).uncheck()
  await expect(dialog.getByText(/write no export set/)).toBeVisible()
  await expect(dialog.getByRole('checkbox', { name: 'Send to DemoGame' })).toBeDisabled()
  await expect(dialog.getByRole('checkbox', { name: 'Send to DemoGame' })).not.toBeChecked()
})

test('an unscanned Houdini project pre-selects nothing and says what sending anyway does', async ({
  page,
}) => {
  // No scan store at all: the studio cannot name what this run writes. That is
  // "cannot say", not "nothing" — the row stays tickable (sending hands over
  // the whole export folder) and the notice says so, rather than the row going
  // inert or Start being held with no way forward but a rescan.
  const dialog = await openDialogWith(page, {
    onDisk: ['KiraDefault', 'KiraSummertide'],
    inUnreal: ['KiraDefault'],
  })

  await dialog.getByRole('checkbox', { name: 'Run in Kira', exact: true }).check()
  // (No apostrophe in the pattern: the source spells it `&apos;`, which renders
  //  as a straight quote, not the curly one this file's prose uses.)
  await expect(dialog.getByText(/know yet which export sets/)).toBeVisible()
  await expect(dialog.getByText(/everything/)).toBeVisible()
  const send = dialog.getByRole('checkbox', { name: 'Send to DemoGame' })
  await expect(send).not.toBeChecked()
  await expect(send).toBeEnabled()
  await send.check()
  await expect(send).toBeChecked()
})

test('ONE task row per re-import — and a set the project never held is dropped, and said', async ({
  page,
}) => {
  // The third leg speaks where the other two do: the run's own task list and
  // its one status line. One row per JOB — an export set going into a project
  // is one import. And the send is RE-import only: a set that project has
  // never held is dropped from the job and NAMED in the report, never rows'd
  // as work about to happen (its first import is made in Unreal itself).
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

  // ONE row: KiraDefault is a re-import. KiraSummertide is on disk but has
  // never been in DemoGame, so it is NOT part of the run — no row promising an
  // import the send refuses to make.
  const rows = page.locator('[data-task^="ue:"]')
  await expect(rows).toHaveCount(1, { timeout: 15_000 })
  await expect(rows.filter({ hasText: 'KiraDefault' })).toContainText('Re-import · DemoGame')
  await expect(rows.filter({ hasText: 'KiraSummertide' })).toHaveCount(0)

  // The drop is SAID — silently skipping a set would read as "everything
  // reached Unreal".
  await expect(page.getByText(/not sent: KiraSummertide/)).toBeVisible({ timeout: 15_000 })

  // The status line carries the leg's newest word — one line, not a transcript.
  await expect(page.locator('[data-export-status]')).toContainText(
    /Unreal; queued for DemoGame/,
  )

  // …and when the editor finally answers, the outcome ENDS the run: a sticky
  // toast of its own, and the panel goes with the work it was showing — it
  // used to become the status line of a bar that then sat at 100% forever
  // (measured 2026-08-19, the first live in-place re-import).
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
  await expect(page.getByText(/Unreal: re-imported 1 asset in .Game.Characters.Kira/)).toBeVisible(
    { timeout: 15_000 },
  )
  await expect(rows).toHaveCount(0)
})

test('the just-re-import run needs no Daz-mode change: no scenes + Skip Houdini starts the send', async ({
  page,
}) => {
  // The reported shape (2026-08-19): Daz mode left where it opened
  // ("ROM + Export"), "Skip Houdini — use last exports" picked, the Unreal
  // project ticked — and Start held on "Select at least one Daz scene" for a
  // run that needs none. The selection describes the run: no scenes and no
  // Houdini leaves only the send, the same run "Skip Daz" + "Skip Houdini"
  // always started.
  const seed = buildSeed({
    activeProjectFile: P.dcsp,
    demo: true,
    houdiniProject: true,
    unrealProjects: [UPROJECT],
  })
  seed.files[`${EXPORT_ROOT}/KiraDefault/DTH_KiraDefault.dth`] = '{}'
  seed.files[IMPORTED] = 'uasset-fixture'
  seed.files[`${UPROJECT_DIR}/Plugins/DTHCharacterStudioRunner/DTHCharacterStudioRunner.uplugin`] = JSON.stringify({
    Version: UNREAL_BRIDGE_VERSION,
  })
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()
  await page.getByRole('button', { name: 'DTH Export' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()

  // Wait out the scene probe (it seeds the pre-selection when it lands —
  // unchecking before that would be overwritten), then take the scene OFF the
  // run. The Daz mode dropdown is never touched.
  const scene = dialog.getByRole('checkbox', { name: /Export KiraDefault/ })
  await expect(scene).toBeChecked()
  await scene.uncheck()
  await dialog.locator('#houdini-mode').click()
  await page.getByRole('option', { name: /Skip Houdini/ }).click()
  await dialog.getByRole('checkbox', { name: 'Send to DemoGame' }).check()

  const start = dialog.getByRole('button', { name: 'Start' })
  await expect(start).toBeEnabled()
  await start.click()

  // The run IS the send: the task row + status line carry the queue — a clean
  // queue raises NO toast (that would repeat the progress bar; the leg's one
  // toast is its outcome, when the editor answers).
  await expect(page.locator('[data-export-status]')).toContainText(/Unreal; queued for DemoGame/)
  await expect(page.getByText(/Unreal: queued for DemoGame/)).toHaveCount(0)
})

test('nothing claims the job and no editor is running — the studio opens the project', async ({
  page,
}) => {
  // The studio does not start Unreal to RUN an import (an editor takes minutes
  // and holds its project), but a queued job with nothing watching is a run
  // that visibly does nothing. Opening the project is the rest of that leg: the
  // bridge claims the job on startup.
  //
  // Driven through the ONE way to send — the DTH Export panel, with both Daz
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

  // The queue shows in the run's own status line — no toast for a clean queue.
  await expect(page.locator('[data-export-status]')).toContainText(/Unreal; queued for DemoGame/)
  // Nothing claims it (no editor in the fake world), so after the grace period
  // the project is handed to the OS the same way a `.hip` or `.duf` is.
  await expect
    .poll(() => callsNamed(page, 'shell_open_file'), { timeout: 15_000 })
    .toEqual([{ path: UPROJECT }])
})

test('a REFUSED send fails its rows and complains as an error, not a shrug', async ({ page }) => {
  // The live shape (2026-08-19): the bridge plugin had been deleted from the
  // Unreal project (a `p4 clean` — it was neither in the depot nor ignored),
  // and the send's refusal rode a blue (i) toast while the task row spun
  // "Re-import · 0%" forever — nothing else ever advances a row whose job was
  // never written. The refusal must fail the row and speak as a failure.
  const seed = buildSeed({
    activeProjectFile: P.dcsp,
    demo: true,
    houdiniProject: true,
    unrealProjects: [UPROJECT],
  })
  seed.files[`${EXPORT_ROOT}/KiraDefault/DTH_KiraDefault.dth`] = '{}'
  seed.files[IMPORTED] = 'uasset-fixture'
  // NO bridge uplugin in the project — the send refuses before writing a job.
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
  await dialog.getByRole('button', { name: 'Start' }).click()

  // The refusal is a FAILURE toast naming the cause…
  await expect(
    page.getByText(/Unreal: not queued for DemoGame — The DTH Character Studio Runner is not installed/),
  ).toBeVisible()
  // …its row is failed, not forever "active" at 0%…
  await expect(page.locator('[data-task^="ue:"]')).toHaveAttribute('data-task-status', 'failed')
  // …and the "open the editor" hint stays off a send that queued nothing.
  await expect(page.getByText(/open the editor if it is closed/)).toHaveCount(0)
})
