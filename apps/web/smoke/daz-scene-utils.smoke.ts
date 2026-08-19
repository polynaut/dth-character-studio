import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// The Daz scene cards' Utils drawer — the per-scene twin of the Houdini one
// (its button reads "Scene utils" so the two stay apart by accessible name).
// One General tab: the two scene scans of Tools → Scan project narrowed to the
// one scene, and the per-scene "Export hair items" switch on the DTH Export
// flow's hair pass (schema v37: primary defaults ON, extras OFF, the stored
// value exists only while the choice differs from that default).

const SCRIPTS_ROOT = `${P.dazLib}/Scripts/DTH-Character-Studio`
const SCENE_SCRIPT = `${SCRIPTS_ROOT}/.Scan_Scene_Bulk.dsa`
const SCAN_CONFIG = `${SCRIPTS_ROOT}/dth_scan_config.json`
const PENDING_JOB = `${SCRIPTS_ROOT}/dth_exporter_jobs.json`
/** A configured install folder the mock can't read resolves to an UNREADABLE
 *  runner state, which deliberately never blocks (see fixtures.ts). */
const DAZ_INSTALL = 'C:/Program Files/DAZ 3D/DAZStudio4 64-bit'

const fileContent = (page: Page, path: string) =>
  page.evaluate((p) => ((window as any).__tauriMock.files.get(p) ?? null) as string | null, path)
const calledCommands = (page: Page) =>
  page.evaluate(() => ((window as any).__tauriMock.calls as Array<{ cmd: string }>).map((c) => c.cmd))
const unhandledCommands = (page: Page) =>
  page.evaluate(() => (window as any).__tauriMock.unhandled as Array<string>)

async function openCharacter(page: Page) {
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()
}

/** The scene cards' Scene-utils buttons, in card order (primary first). */
const utilsButtons = (page: Page) => page.getByRole('button', { name: /^Scene utils/ })

test('hair-export switch: primary ON / extra OFF by default, a choice persists + regenerates', async ({
  page,
}) => {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true, extraScene: true })
  // An export dir is what makes generation emit the bulk DTH-Export carrier —
  // the script whose per-scene gate map the switch must reach.
  const kira = JSON.parse(seed.files[`${P.charFolder}/Kira.json`]) as Record<string, unknown>
  kira.exportPath = 'X:/exports/kira'
  seed.files[`${P.charFolder}/Kira.json`] = JSON.stringify(kira, null, 2)
  await page.addInitScript(installTauriMock, seed)
  await openCharacter(page)

  // Primary scene: the switch reads its default — ON.
  await utilsButtons(page).first().click()
  const drawer = page.getByRole('dialog')
  await expect(drawer.getByText('Daz scene utils')).toBeVisible()
  await expect(drawer.getByRole('switch')).toBeChecked()
  await page.keyboard.press('Escape')
  await expect(drawer).not.toBeVisible()

  // Extra (outfit) scene: default OFF; switching it ON persists + regenerates.
  await utilsButtons(page).nth(1).click()
  await expect(drawer.getByRole('switch')).not.toBeChecked()
  await drawer.getByRole('switch').click()
  await expect(page.getByText(/Hair items export for this scene/)).toBeVisible()

  // The stored record: ONLY the divergent choice is materialized — the extra
  // scene's record gains `exportHair: true`, the primary record stays without
  // the field (its default is live, not frozen into the JSON).
  const saved = JSON.parse((await fileContent(page, `${P.charFolder}/Kira.json`))!) as {
    sceneOverrides: Array<{ scenePath: string; exportHair?: boolean }>
  }
  expect(saved.sceneOverrides.find((o) => o.scenePath === P.scene2)?.exportHair).toBe(true)
  expect(saved.sceneOverrides.find((o) => o.scenePath === P.scene)?.exportHair).toBeUndefined()

  // The regenerated bulk carrier (what a DTH Export run executes) embeds the
  // per-scene gate the runtime resolves for the open scene.
  const bulk = (await fileContent(page, `${P.scriptsDir}/.Bulk_ROM_Export.dsa`))!
  expect(bulk).toContain(
    `var dthHairExportByScene = {"${P.scene.toLowerCase()}":true,"${P.scene2.toLowerCase()}":true};`,
  )
  expect(bulk).toContain('var dthHairExportOn = dthHairExportByScene[dthGroomScene] === true;')

  // And the other direction: switching the PRIMARY off stores `false` there.
  await page.keyboard.press('Escape')
  await utilsButtons(page).first().click()
  await drawer.getByRole('switch').click()
  await expect(page.getByText(/Hair export off for this scene/)).toBeVisible()
  const again = JSON.parse((await fileContent(page, `${P.charFolder}/Kira.json`))!) as {
    sceneOverrides: Array<{ scenePath: string; exportHair?: boolean }>
  }
  expect(again.sceneOverrides.find((o) => o.scenePath === P.scene)?.exportHair).toBe(false)
  const bulkOff = (await fileContent(page, `${P.scriptsDir}/.Bulk_ROM_Export.dsa`))!
  expect(bulkOff).toContain(`"${P.scene.toLowerCase()}":false`)

  expect(await unhandledCommands(page)).toEqual([])
})

test('scan this scene: a one-row morphs batch for THIS scene only, abortable while pending', async ({
  page,
}) => {
  const seed = buildSeed({
    activeProjectFile: P.dcsp,
    demo: true,
    extraScene: true,
    dazInstallFolder: DAZ_INSTALL,
  })
  await page.addInitScript(installTauriMock, seed)
  await openCharacter(page)

  await utilsButtons(page).nth(1).click()
  const drawer = page.getByRole('dialog')
  // The demo project has the Daz Products feature disabled — the button says
  // why instead of failing on click.
  await expect(drawer.getByRole('button', { name: 'Scan products of this scene' })).toBeDisabled()

  await drawer.getByRole('button', { name: 'Scan morphs of this scene' }).click()
  await expect(drawer.getByText(/Waiting for Daz Studio/)).toBeVisible()

  // ONE row — the scene whose drawer this is, nothing else, no base row.
  const job = JSON.parse((await fileContent(page, PENDING_JOB))!) as {
    jobs: Array<{ scenePath: string; scriptPath: string }>
  }
  expect(job.jobs).toEqual([{ scenePath: P.scene2, scriptPath: SCENE_SCRIPT, status: 'pending' }])
  const config = JSON.parse((await fileContent(page, SCAN_CONFIG))!) as {
    scenes: Record<string, { morphs: boolean }>
  }
  expect(Object.keys(config.scenes)).toEqual([P.scene2.toLowerCase()])
  expect(config.scenes[P.scene2.toLowerCase()]?.morphs).toBe(true)
  // Daz was closed in the fixture, so the handoff starts it.
  expect(await calledCommands(page)).toContain('launch_daz_studio')

  // Abort while pending deletes the handoff — nothing will run.
  await drawer.getByRole('button', { name: 'Abort' }).click()
  await expect(page.getByText(/Scan aborted/)).toBeVisible()
  expect(await fileContent(page, PENDING_JOB)).toBeNull()

  expect(await unhandledCommands(page)).toEqual([])
})

test('scan this scene: with Daz Products on, the product pass carries this scene alone', async ({
  page,
}) => {
  const seed = buildSeed({
    activeProjectFile: P.dcsp,
    demo: true,
    extraScene: true,
    dazProductsEnabled: true,
    dimManifestsFolder: 'C:/DAZ 3D/Install Manager/ManifestFiles',
    dazInstallFolder: DAZ_INSTALL,
  })
  await page.addInitScript(installTauriMock, seed)
  await openCharacter(page)

  await utilsButtons(page).nth(1).click()
  const drawer = page.getByRole('dialog')
  await drawer.getByRole('button', { name: 'Scan products of this scene' }).click()
  await expect(drawer.getByText(/Waiting for Daz Studio/)).toBeVisible()

  const job = JSON.parse((await fileContent(page, PENDING_JOB))!) as {
    jobs: Array<{ scenePath: string }>
  }
  expect(job.jobs.map((j) => j.scenePath)).toEqual([P.scene2])
  const config = JSON.parse((await fileContent(page, SCAN_CONFIG))!) as {
    scenes: Record<string, { morphs: boolean; products?: { characterName: string } }>
  }
  const entry = config.scenes[P.scene2.toLowerCase()]
  // The products button runs the PRODUCT pass — the morph scan stays its own
  // button (unlike Tools, where one row can be due for both).
  expect(entry?.morphs).toBe(false)
  expect(entry?.products?.characterName).toBe('Kira')

  expect(await unhandledCommands(page)).toEqual([])
})
