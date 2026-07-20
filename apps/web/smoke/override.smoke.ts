import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

const filesWritten = (page: Page) =>
  page.evaluate(() => [...(window as any).__tauriMock.files.keys()] as Array<string>)
const fileContent = (page: Page, path: string) =>
  page.evaluate((p) => ((window as any).__tauriMock.files.get(p) ?? null) as string | null, path)

// A per-scene ROM override end-to-end: select an extra scene, arm the Override
// toggle, check a row, save — the scene gets its own script + CSV next to the
// defaults. The checkbox click doubles as the freeze regression: an unstable
// table `data` identity once fed an endless sync re-render loop right here.
// NB: locators go by ROLE, not title — the ui kit's tooltip host rewrites a
// hovered element's `title` into `data-tooltip`/`aria-label`, so a title
// locator silently stops matching the very control the test just touched.
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

  // With several scenes linked the title row tags the SELECTED scene (primary
  // by default) — the tag follows the card selection.
  const titleRow = page.locator('.title-scroll')
  await expect(titleRow.getByText('KiraDefault_G9_GP')).toBeVisible()

  // The toggle arms only once a non-primary scene is selected (its title —
  // and so its accessible name — flips with that state).
  await expect(
    page.getByRole('switch', { name: /Select one of the extra Daz scenes/ }),
  ).toBeDisabled()
  await page.getByText('KiraBeach', { exact: true }).first().click()
  await expect(titleRow.getByText('KiraBeach')).toBeVisible()
  await page.getByRole('switch', { name: /Override ROM frames/ }).click()
  await expect(page.getByText(/Scene override active/)).toBeVisible()

  // Check the first FBM row's Override box — the row joins the override.
  await page.getByRole('button', { name: /FBM Full Body/ }).click()
  const checkbox = page.getByRole('checkbox', { name: /Override this frame/ }).first()
  await checkbox.click()
  await expect(checkbox).toBeChecked()

  // Save → the scene's own artifacts land next to the default ones.
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText(/Saved “Kira”/)).toBeVisible()
  const written = await filesWritten(page)
  expect(written).toContain(`${P.charFolder}/Kira_pose_asset.csv`)
  expect(written).toContain(`${P.charFolder}/Kira_KiraBeach_pose_asset.csv`)
  expect(written).toContain(`${P.scriptsDir}/ROM_Kira_G9.dsa`)
  const sceneDsa = await fileContent(page, `${P.scriptsDir}/ROM_Kira_G9_KiraBeach.dsa`)
  expect(sceneDsa).toContain('ApplyDTHCharacter')
  expect(sceneDsa).toContain('Scene override "KiraBeach"')

  // The persisted definition carries the override entry.
  const definition = JSON.parse((await fileContent(page, `${P.charFolder}/Kira.json`))!)
  expect(definition.sceneOverrides).toHaveLength(1)
  expect(definition.sceneOverrides[0]).toMatchObject({ scenePath: extraScene, enabled: true })
  expect(definition.sceneOverrides[0].poses).toHaveLength(1)
})
