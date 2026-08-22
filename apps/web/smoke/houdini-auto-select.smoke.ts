import { expect, test } from '@playwright/test'

import { P, buildSeed, scanStoreEntryKey } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

// The DTH Export panel's Houdini list FOLLOWS the scene selection.
//
// A project belongs in the run when one of its networks imports a selected
// scene's `.dth` — the same key 456.py matches nodes on at export time, read
// once by the background scan and stored (`imports`), so the dialog never has
// to open a `.hip`. Names are deliberately not consulted: users rename
// networks and copy projects between characters.
//
// The honest edge is the whole reason this is testable: a project the scan has
// NOT reached is never un-ticked on that ignorance — the studio cannot know
// what it imports, and silently dropping it would skip the Houdini half of a
// run the user asked for.

const STORE = `${P.project}/.dcsmeta/characters/Kira/houdini-scan.json`
/** The sweep needs a Houdini to run hython from — same pair the export specs use. */
const HOUDINI_INSTALL = 'C:/Program Files/Side Effects Software/Houdini 22.0.368'
const HOUDINI_DOCS = 'C:/Users/dev/Documents/houdini22.0'
/** The second linked project, importing only the SUMMERTIDE scene. */
const HOUDINI_2 = 'D:/DTH Projects/Demo/Kira/houdini/KiraSummertide.hip'
/** The `.dth` each scene exports to — `<exportPath>/<scene folder>/<name>.dth`,
 *  the rule `sceneDthPath` applies (the primary keeps the bare character name,
 *  an extra carries its subfolder). Lowercased like a scan records them. */
const DTH_PRIMARY = `${P.exportDir}/KiraDefault_G9_GP/Kira.dth`.toLowerCase()
const DTH_EXTRA = `${P.exportDir}/KiraSummertide_G9_GP/Kira_KiraSummertide_G9_GP.dth`.toLowerCase()

/** A stored scan entry's freshness key — see `scanStoreEntryKey` in fixtures.ts. */
const storeKey = (hipPath: string) => scanStoreEntryKey(hipPath, P.exportDir)

function scan(hipPath: string, imports: Array<string>) {
  return {
    hipPath,
    ok: true,
    error: '',
    nodes: [],
    job: P.charFolder,
    fps: 30,
    imports,
    refs: { collapsible: 0, foreign: 0, broken: [], hipRelative: [] },
    prefill: { fillable: [], missing: [] },
  }
}

/** Two linked projects; `scans` decides which of them the store knows about. */
async function openDialog(
  page: import('@playwright/test').Page,
  scans: Array<{ hipPath: string; imports: Array<string> }>,
) {
  const seed = buildSeed({
    activeProjectFile: P.dcsp,
    demo: true,
    houdiniProject: true,
    extraScene: true,
  })
  // A second project beside the fixture's one, and both on disk (a missing
  // `.hip` is refused up front, which would mask what this spec measures).
  const character = JSON.parse(seed.files[`${P.charFolder}/Kira.json`]) as Record<string, unknown>
  character.houdiniProjects = [P.houdini, HOUDINI_2]
  seed.files[`${P.charFolder}/Kira.json`] = JSON.stringify(character)
  seed.files[HOUDINI_2] = 'hip-fixture'
  seed.files[STORE] = JSON.stringify({
    version: 1,
    projects: Object.fromEntries(
      scans.map((entry) => [
        entry.hipPath.toLowerCase(),
        {
          key: storeKey(entry.hipPath),
          scannedAt: '2026-08-12T00:00:00.000Z',
          project: scan(entry.hipPath, entry.imports),
        },
      ]),
    ),
  })
  await page.addInitScript(installTauriMock, seed)
  // The fake stamps its world at install time — the seeded entries take that
  // mtime, or every one of them reads as stale.
  await page.addInitScript((storePath: string) => {
    const mock = (window as any).__tauriMock
    const raw = mock.files.get(storePath) as string
    mock.files.set(storePath, raw.replace(/__MTIME__/g, String(mock.mtimeMs)))
  }, STORE)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()
  await page.getByRole('button', { name: 'DTH Export' }).click()
}

test('the Houdini list follows the scene selection — by what each project IMPORTS', async ({
  page,
}) => {
  await openDialog(page, [
    { hipPath: P.houdini, imports: [DTH_PRIMARY] },
    { hipPath: HOUDINI_2, imports: [DTH_EXTRA] },
  ])

  const primaryScene = page.getByRole('checkbox', { name: /Export KiraDefault/ })
  const extraScene = page.getByRole('checkbox', { name: /Export KiraSummertide/ })
  const projectOne = page.getByRole('checkbox', { name: /Run in Kira\b/ })
  const projectTwo = page.getByRole('checkbox', { name: /Run in KiraSummertide/ })

  // Both scenes start checked (both are affected) → both projects join.
  await expect(primaryScene).toBeChecked()
  await expect(extraScene).toBeChecked()
  await expect(projectOne).toBeChecked()
  await expect(projectTwo).toBeChecked()

  // Untick the extra scene: the project that ONLY imports it leaves the run,
  // and the one importing the still-selected scene stays.
  await extraScene.uncheck()
  await expect(projectTwo).not.toBeChecked()
  await expect(projectOne).toBeChecked()

  // …and back: re-ticking the scene brings its project with it.
  await extraScene.check()
  await expect(projectTwo).toBeChecked()
})

test('a project the scan has never reached is never un-ticked on that ignorance', async ({
  page,
}) => {
  // Only the FIRST project is in the store; the second is unscanned (outside
  // the sweep, or saved since it last ran).
  await openDialog(page, [{ hipPath: P.houdini, imports: [DTH_PRIMARY] }])

  const extraScene = page.getByRole('checkbox', { name: /Export KiraSummertide/ })
  const projectTwo = page.getByRole('checkbox', { name: /Run in KiraSummertide/ })
  await expect(projectTwo).toBeChecked()

  // Deselecting every scene the KNOWN project covers must not touch the
  // unknown one — the studio has no basis to drop it.
  await extraScene.uncheck()
  await expect(projectTwo).toBeChecked()
})

test('a scan that lands WHILE the dialog is open reaches it — chips, tick and task count', async ({
  page,
}) => {
  // Reported live 2026-08-22, straight after the scan-version bump (v9)
  // invalidated every stored scan at once: pick a scene and no Houdini project
  // ticks itself, and the Networks/Characters chips are gone. The scan was
  // fine — a sweep had re-earned it correctly minutes later — but the dialog
  // read the store ONCE on mount and never again, so a panel opened during the
  // sweep kept the unscanned answer for its whole life.
  //
  // The trap is that "unscanned" and "writes nothing" are deliberately the same
  // value everywhere here (empty = NOT KNOWN), so the dialog had no way to tell
  // "nobody has looked yet" from "looked, found nothing" — it simply showed the
  // honest empty state forever.
  //
  // No stored scan at all here; the SWEEP is what fills it, mid-dialog.
  const seed = buildSeed({
    activeProjectFile: P.dcsp,
    demo: true,
    houdiniProject: true,
    dazInstallFolder: 'C:/Program Files/DAZ 3D/DAZStudio4',
  })
  const settingsPath = `${P.appData}/settings.json`
  seed.files[settingsPath] = JSON.stringify({
    ...JSON.parse(seed.files[settingsPath] ?? '{}'),
    houdiniInstallFolder: HOUDINI_INSTALL,
    houdiniDocsFolder: HOUDINI_DOCS,
  })
  seed.files[`${HOUDINI_INSTALL}/bin/hython.exe`] = 'hython-exe-fixture'
  seed.files[`${P.dazLib}/Scripts/DTH-Character-Studio/Demo/Kira/.Bulk_ROM_Export.dsa`] =
    '// bulk-export fixture'
  // The RACE, made deterministic. Without a delay the fake answers instantly and
  // the character page's own sweep is finished before the dialog is even opened
  // — so the dialog's first read is already warm and this spec passes with the
  // bug still in. A real sweep is one hython start per project (tens of
  // seconds); 2.5 s is enough to make the dialog open into the same gap the
  // live report came from.
  seed.materialScanDelayMs = 2500
  // What the sweep will find: ONE project holding TWO DazToHue networks — the
  // very shape #946 taught the scan to read, and the reason the task list should
  // say two rows before anything starts.
  // Keyed as the fake's `norm()` spells it — separators folded, case KEPT. A
  // lowercased key here silently misses and the seed reads as "scanned, writes
  // nothing", which is the same empty this whole spec is about.
  seed.materialExportSets = { [P.houdini]: ['KiraClassic', 'KiraNaked'] }
  seed.materialImports = { [P.houdini]: [DTH_PRIMARY] }
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()
  await page.getByRole('button', { name: 'DTH Export' }).click()

  // The dialog is ALREADY open. Everything below has to arrive into it — no
  // reopening, which is what made this look like a broken release.
  // The CHIPS are the load-bearing assertion: they render only from scan
  // data and `SetChips` returns null on an empty list, so their presence
  // cannot come from anywhere else. (The project checkbox is pre-ticked by
  // default whenever scenes are, so asserting it alone would pass WITHOUT
  // the fix — which is exactly how the first draft of this spec fooled
  // itself.)
  const chips = page.locator('[data-sets="houdini"]').first()
  await expect(chips.locator('[data-set="KiraClassic"]')).toBeVisible({ timeout: 15_000 })
  await expect(chips.locator('[data-set="KiraNaked"]')).toBeVisible()
  await expect(page.getByRole('checkbox', { name: /Run in Kira\b/ })).toBeChecked()

  // …and the count those names buy: the task list says ONE ROW PER NETWORK
  // before anything runs, instead of a single row for a `.hip` that exports
  // two. This is the half the live report was actually about — a manual
  // Rescan filled the store and the list STILL showed one row, because the
  // names behind it were read once when the editor mounted and never again.
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.locator(`[data-task="hou:${P.houdini}#0"]`)).toBeVisible({ timeout: 15_000 })
  await expect(page.locator(`[data-task="hou:${P.houdini}#1"]`)).toBeVisible()
  await expect(page.locator(`[data-task="hou:${P.houdini}"]`)).toHaveCount(0)
})
