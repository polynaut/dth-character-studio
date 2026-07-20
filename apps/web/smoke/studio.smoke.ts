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
  await page.addInitScript(installTauriMock, buildSeed({ activeProjectFile: P.dcsp }))
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

  // Toggle the GEN section on → the editor must re-measure, now including the
  // Golden Palace ROM (female character). This exercises presetFramesSignature
  // → resolvePresetFrames → the native measurement end-to-end.
  await page
    .locator('div.rounded-lg.border')
    .filter({ has: page.getByText('GEN', { exact: true }) })
    .getByRole('switch')
    .click()
  await expect
    .poll(() => commandCalls(page, 'pose_asset_frames'))
    .toContainEqual({ paths: expect.arrayContaining([DUF.gp]) })

  // Save → persists the JSON and regenerates BOTH artifacts in one step.
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText(/Saved “Kira”/)).toBeVisible()

  const written = await filesWritten(page)
  // Houdini PoseAsset CSV → next to the definition in the character folder.
  expect(written).toContain(`${P.charFolder}/Kira_pose_asset.csv`)
  // Daz script → the per-character scripts folder in the DAZ library, with the
  // shared runtime installed at the scripts root.
  const dsa = await fileContent(page, `${P.scriptsDir}/ROM_Kira_G9.dsa`)
  expect(dsa).toContain('ApplyDTHCharacter')
  expect(dsa).toMatch(/DTH-Runtime: v\d+/)
  expect(written).toContain(`${P.dazLib}/Scripts/DTH-Character-Studio/.DthUtils.dsa`)
  // Frame alignment reaches the artifacts: the script's config carries the
  // MEASURED preset block lengths (base ROM + the just-enabled Golden Palace).
  expect(dsa).toMatch(new RegExp(`"base":\\s*${FRAMES.base}`))
  expect(dsa).toMatch(new RegExp(`"gp":\\s*${FRAMES.gp}`))
  // The definition's provenance was re-stamped by the save.
  const definition = await fileContent(page, `${P.charFolder}/Kira.json`)
  expect(JSON.parse(definition!).generatedDthVersion).toBe('2.4.3')

  // The completeness guard: every native call the flow made was one this mock
  // (and therefore the map it encodes) knows about.
  expect(await unhandledCommands(page)).toEqual([])
})

test('project window: inline rename moves the folder and regenerates the script', async ({
  page,
}) => {
  await page.addInitScript(installTauriMock, buildSeed({ activeProjectFile: P.dcsp }))
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText('G9 · DQS · 0 custom ROM frames')).toBeVisible()

  // Rename via the title: the heading is a real button (EditableTitle), which
  // opens an inline input; Enter commits → onRenameCharacter saves + regenerates.
  await page.getByRole('button', { name: /Rename — Kira/ }).click()
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

  expect(await unhandledCommands(page)).toEqual([])
})
