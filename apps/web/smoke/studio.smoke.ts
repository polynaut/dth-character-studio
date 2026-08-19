import { expect, test } from '@playwright/test'

import { P, buildSeed, DUF, FRAMES } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// The browser smoke: the real SPA against the in-memory fake of the native
// layer (tauri-mock.ts). One test per WINDOW KIND, mirroring the desktop's
// one-project-per-window model: the Home/launcher window, and a project window
// (where `active_project_file` deep-links main.tsx into the project route).
//
// This is the integration coverage the unit tests structurally can't see:
// route-loader wiring, the editor's draft/save flow, and that a Save actually
// writes the generated artifacts through the whole api → storage stack.

// The spec's window into the fake backend (see TauriMockState in tauri-mock.ts).
const filesWritten = (page: Page) =>
  page.evaluate(() => [...(window as any).__tauriMock.files.keys()] as Array<string>)
const fileContent = (page: Page, path: string) =>
  page.evaluate((p) => ((window as any).__tauriMock.files.get(p) ?? null) as string | null, path)
const commandCalls = (page: Page, cmd: string) =>
  page.evaluate(
    (c) =>
      (window as any).__tauriMock.calls
        .filter((call: { cmd: string }) => call.cmd === c)
        .map((call: { args: unknown }) => call.args) as Array<unknown>,
    cmd,
  )
const unhandledCommands = (page: Page) =>
  page.evaluate(() => (window as any).__tauriMock.unhandled as Array<string>)

test('Home window: lists the recent project and opens it via the native shell', async ({
  page,
}) => {
  await page.addInitScript(installTauriMock, buildSeed())
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'DTH Character Studio' })).toBeVisible()
  await expect(page.getByText('1 recent project')).toBeVisible()

  // Clicking a recent hands off to the native shell (a new OS window on the
  // desktop) — assert the command went out with the right `.dcsp`.
  await page.getByRole('button', { name: /Demo/ }).click()
  await expect
    .poll(() => commandCalls(page, 'open_project_window'))
    .toEqual([{ path: P.dcsp }])

  expect(await unhandledCommands(page)).toEqual([])
})

test('project window: character editor measures, edits and saves both artifacts', async ({
  page,
}) => {
  // This "window" was opened with the project's .dcsp — main.tsx reads it via
  // active_project_file and navigates into the project route on its own.
  // `houdiniProject` links the .hip + export root so the save exercises the
  // $JOB-relative reference-path emission (asserted below).
  await page.addInitScript(
    installTauriMock,
    buildSeed({ activeProjectFile: P.dcsp, houdiniProject: true }),
  )
  await page.goto('/')

  // Project page: the character library lists the fixture character.
  await expect(page.getByRole('button', { name: 'Rename — Demo' })).toBeVisible()
  await page.getByRole('link', { name: /Kira/ }).click()

  // Character editor: header facts + the preset ROM measured from the fake
  // .duf assets (base block only — GEN/PHY are disabled by default).
  await expect(page.getByText('G9 · DQS · 0 custom ROM frames')).toBeVisible()
  await expect
    .poll(() => commandCalls(page, 'pose_asset_frames'))
    .toContainEqual({ paths: [DUF.base] })

  // The sticky header's scroll-in Back link is hidden at the top — including on
  // the SHORT Notes tab, where the page can't scroll and the scroll timeline is
  // inactive (the regression: an inactive timeline used to fall back to the
  // visible base state, doubling the Back link).
  const backlink = page.locator('.backlink-scroll')
  await expect(backlink).toHaveCSS('opacity', '0')
  await page.getByRole('tab', { name: 'Notes' }).click()
  await expect(backlink).toHaveCSS('opacity', '0')
  // Same inactive-timeline trap for the header actions: they must keep their
  // large "at the top" size (2.75rem = 44px), not fall to the collapsed default.
  await expect(page.getByRole('button', { name: 'Discard' })).toHaveCSS('height', '44px')
  await page.getByRole('tab', { name: 'Character' }).click()

  // Toggle the PHY section on → the editor must re-measure, now including the
  // Physics ROM block. This exercises presetFramesSignature
  // → resolvePresetFrames → the native measurement end-to-end. (GEN's toggle
  // is no longer user-operable — it follows the primary scene's geograft — so
  // PHY is the preset block a user can still flip by hand.)
  await page
    .locator('div.rounded-lg.border')
    .filter({ has: page.getByText('PHY', { exact: true }) })
    .getByRole('switch')
    .click()
  await expect
    // Generous timeout (default 5s): the toggle → debounced re-measure chain is
    // quick locally but has missed the default window on cold CI runners.
    .poll(() => commandCalls(page, 'pose_asset_frames'), { timeout: 15_000 })
    .toContainEqual({ paths: expect.arrayContaining([DUF.phys]) })

  // Save → persists the JSON and regenerates BOTH artifacts in one step.
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText(/Saved “Kira”/)).toBeVisible()

  const written = await filesWritten(page)
  // Houdini PoseAsset CSV → next to the definition in the character folder.
  expect(written).toContain(`${P.charMeta}/Kira_pose_asset.csv`)
  // Daz script → the per-character scripts folder in the DAZ library, with the
  // shared runtime installed at the scripts root.
  const dsa = await fileContent(page, `${P.scriptsDir}/ROM_Kira_G9.dsa`)
  expect(dsa).toContain('ApplyDTHCharacter')
  expect(dsa).toMatch(/DTH-Runtime: v\d+/)
  expect(written).toContain(`${P.dazLib}/Scripts/DTH-Character-Studio/.DthUtils.dsa`)
  // Frame alignment reaches the artifacts: the script's config carries the
  // MEASURED preset block lengths (base ROM + the just-enabled Physics block).
  expect(dsa).toMatch(new RegExp(`"base":\\s*${FRAMES.base}`))
  expect(dsa).toMatch(new RegExp(`"phys":\\s*${FRAMES.phys}`))
  // The definition's provenance was re-stamped by the save.
  const definition = await fileContent(page, `${P.charFolder}/Kira.json`)
  expect(JSON.parse(definition!).generatedDthVersion).toBe('2.4.3')
  // The save's generation emitted the bone-scale reference-skeleton paths
  // PROJECT-RELATIVE: the script swaps the export root for `$HIP/daz-export`
  // (runtime v66). The export tree sits INSIDE the houdini folder since v0.68,
  // so `$HIP` — the `.hip`'s own folder — reaches it with no `..`, which is
  // also what Houdini's own picker writes. Pins the emit decision end-to-end:
  // the manifest's default 'hip' style + the fixture's linked .hip inside the
  // character folder reach the emitted script. That script is the standalone
  // `Export_…` one since v38 — the ROM script carries no export at all.
  const exportDsa = await fileContent(page, `${P.scriptsDir}/Export_Kira_G9.dsa`)
  expect(exportDsa).toContain('"$HIP/daz-export"')
  expect(dsa).not.toContain('dthExportAction.doExport(')
  // …and the same funnel swept the retired junction feature's leftovers,
  // probing exactly where the old versions planted them (beside the linked
  // .hip here) — nothing to remove in the fixture world, but the sweep-on-
  // every-generation contract is what must not drift.
  expect(await commandCalls(page, 'remove_junction')).toContainEqual({
    request: { linkPath: `${P.houdiniDir}/dth-exports` },
  })

  // The completeness guard: every native call the flow made was one this mock
  // (and therefore the map it encodes) knows about.
  expect(await unhandledCommands(page)).toEqual([])
})

test('project window: inline rename moves the folder and regenerates the script', async ({
  page,
}) => {
  await page.addInitScript(
    installTauriMock,
    buildSeed({ activeProjectFile: P.dcsp, houdiniProject: true }),
  )
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText('G9 · DQS · 0 custom ROM frames')).toBeVisible()

  // Rename via the title: the heading is a real button (EditableTitle), which
  // opens an inline input; Enter commits → onRenameCharacter saves + regenerates.
  // Exact: the linked scene's card carries its own "Rename — KiraDefault_G9_GP".
  await page.getByRole('button', { name: 'Rename — Kira', exact: true }).click()
  const input = page.getByRole('textbox').first()
  await input.fill('Nova')
  await input.press('Enter')
  await expect(page.getByText(/Renamed to “Nova”/)).toBeVisible()

  // The definition + generated Daz script now live under the new name; the
  // old-named script is gone (regeneration with previousName cleans it up).
  const written = await filesWritten(page)
  const novaFolder = `${P.project}/Nova`
  expect(written).toContain(`${novaFolder}/Nova.json`)
  expect(written).toContain(`${P.dazLib}/Scripts/DTH-Character-Studio/Demo/Nova/ROM_Nova_G9.dsa`)
  expect(JSON.parse((await fileContent(page, `${novaFolder}/Nova.json`))!).name).toBe('Nova')
  // The relative emission chased the rename: the regenerated script anchors
  // its prefix swap at the NEW folder's (re-derived) export root. The drift
  // class #647 fixed for junctions (an absolute link target still pointing
  // into the old "Kira" tree) structurally can't recur with relative paths —
  // but the ROOT the prefix replaces must still track the move.
  // Both of those live in the EXPORT script since v38 — and it had to follow
  // the rename into the new folder just as the ROM script did.
  const novaExport = await fileContent(
    page,
    `${P.dazLib}/Scripts/DTH-Character-Studio/Demo/Nova/Export_Nova_G9.dsa`,
  )
  expect(novaExport).toContain(`var dthRefRootAbs = "${novaFolder}/houdini/daz-export";`)
  expect(novaExport).toContain('"$HIP/daz-export"')
  // The app's own folder for this character followed the rename, and the script
  // reads its CSV from the new one — a stale path here would make every export
  // report "PoseAsset CSV not found" while the file sat under the old name.
  const novaMeta = `${P.project}/.dcsmeta/characters/Nova`
  expect(written).toContain(`${novaMeta}/Nova_pose_asset.csv`)
  expect(novaExport).toContain(`var dthCsvSrcDir = new DzDir("${novaMeta}");`)

  expect(await unhandledCommands(page)).toEqual([])
})
