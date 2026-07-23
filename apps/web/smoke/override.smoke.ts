import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

const filesWritten = (page: Page) =>
  page.evaluate(() => [...(window as any).__tauriMock.files.keys()] as Array<string>)
const fileContent = (page: Page, path: string) =>
  page.evaluate((p) => ((window as any).__tauriMock.files.get(p) ?? null) as string | null, path)
const unhandledCommands = (page: Page) =>
  page.evaluate(() => (window as any).__tauriMock.unhandled as Array<string>)

// A per-scene ROM override end-to-end: select an extra scene, EDIT a base ROM row
// (implicit arm-on-edit — no toggle, no checkbox), save — the scene gets its own
// CSV plus a shared script embedding its override, next to the defaults. The value
// edit doubles as the freeze regression: an unstable table `data` identity once fed
// an endless sync re-render loop right here.
test('project window: a scene override saves scene-specific artifacts', async ({ page }) => {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true })
  const extraScene = `${P.charFolder}/daz3d/KiraBeach.duf`
  const kira = JSON.parse(seed.files[`${P.charFolder}/Kira.json`])
  kira.extraScenes = [extraScene]
  seed.files[`${P.charFolder}/Kira.json`] = JSON.stringify(kira, null, 2)
  seed.files[extraScene] = 'duf-fixture'
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()

  // Selecting a non-primary scene puts the ROM grid in override mode — no toggle,
  // no checkbox (the footer names the scene: "KiraBeach" reads "Beach").
  await page.getByText('KiraBeach', { exact: true }).first().click()
  await expect(page.getByText('Beach', { exact: true }).first()).toBeVisible()

  // Editing a base ROM row arms it as a per-scene override (implicit — the row turns
  // green). Expand FBM and change the first frame's value.
  await page.getByRole('button', { name: /FBM Full Body/ }).click()
  const value = page.locator('table input[inputmode="decimal"]').first()
  await value.fill('42')
  await value.press('Enter')
  await expect(value).toHaveValue('42')

  // Save → the scene's own artifacts land next to the default ones.
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText(/Saved “Kira”/)).toBeVisible()
  const written = await filesWritten(page)
  expect(written).toContain(`${P.charFolder}/Kira_pose_asset.csv`)
  // The ROM-override scene still gets its OWN PoseAsset CSV (Houdini has no
  // runtime to select frames)…
  expect(written).toContain(`${P.charFolder}/Kira_KiraBeach_pose_asset.csv`)
  // …but there's now just ONE ROM script: it embeds every scene's override in a
  // dthSceneOverrides map and selects the open scene at run time, so the old
  // per-scene ROM_…_<Scene>.dsa is gone.
  expect(written).toContain(`${P.scriptsDir}/ROM_Kira_G9.dsa`)
  expect(written).not.toContain(`${P.scriptsDir}/ROM_Kira_G9_KiraBeach.dsa`)
  const romDsa = await fileContent(page, `${P.scriptsDir}/ROM_Kira_G9.dsa`)
  expect(romDsa).toContain('ApplyDTHCharacter')
  expect(romDsa).toContain('dthSceneOverrides')
  // The KiraBeach delta is keyed by the open scene's normalized (lowercased) path.
  expect(romDsa).toContain(extraScene.toLowerCase())

  // The persisted definition carries the override entry: the scene's OWN snapshot
  // of the edited section (any divergence from the primary is the override).
  const definition = JSON.parse((await fileContent(page, `${P.charFolder}/Kira.json`))!)
  expect(definition.sceneOverrides).toHaveLength(1)
  expect(definition.sceneOverrides[0]).toMatchObject({ scenePath: extraScene, enabled: true })
  expect(definition.sceneOverrides[0].sections.FBM).toBeDefined()

  // The completeness guard: every native call the flow made was one this mock
  // (and therefore the map it encodes) knows about.
  expect(await unhandledCommands(page)).toEqual([])
})
