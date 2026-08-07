import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// New files saved into the character's folder (a Daz outfit variant, a Houdini
// project) are detected on page load AND on window focus, surfaced as a
// non-modal banner, and handled through the multi-page wizard: Add links the
// file through the same rules as the pick/drop flows, Skip permanently ignores
// it (`.dcsmeta/characters/<folder>/detected-ignore.json`). Files that appear
// WHILE the wizard is open append as pages (the detection keeps rescanning on
// focus). Generated trees (dth-exports, rom-animations, Houdini backup/) and
// already-linked files must never be offered.

const NEW_SCENE = `${P.charFolder}/daz3d/beach/KiraBeach_G9.duf`
const NEW_SCENE_2 = `${P.charFolder}/daz3d/party/KiraParty_G9.duf`
const NEW_HIP = `${P.charFolder}/houdini/KiraExtra.hip`
const NEW_HIP_2 = `${P.charFolder}/KiraLoose.hip`
const IGNORE_FILE = `${P.project}/.dcsmeta/characters/Kira/detected-ignore.json`

const fileContent = (page: Page, path: string) =>
  page.evaluate((p) => ((window as any).__tauriMock.files.get(p) ?? null) as string | null, path)
const unhandledCommands = (page: Page) =>
  page.evaluate(() => (window as any).__tauriMock.unhandled as Array<string>)
/** Drop a file into the fake fs and re-fire the focus rescan — "the user saved
 *  a new file in Daz/Houdini and tabbed back". */
const saveFileAndRefocus = (page: Page, path: string, content: string) =>
  page.evaluate(
    ([p, c]) => {
      ;(window as any).__tauriMock.files.set(p, c)
      window.dispatchEvent(new Event('focus'))
    },
    [path, content],
  )

test('new files: banner on load + focus, wizard adds/skips, live-appends while open', async ({
  page,
}) => {
  const seed = buildSeed({ activeProjectFile: P.dcsp, houdiniProject: true })
  // One unlinked scene + one unlinked .hip present at load…
  seed.files[NEW_SCENE] = 'duf-fixture-new'
  seed.files[NEW_HIP] = 'hip-fixture-new'
  // …and decoys that must NOT be detected: generated Daz output, a ROM
  // animation, Houdini's auto-backup, and the already-linked scene/.hip
  // (P.scene / P.houdini are linked by the seed itself).
  seed.files[`${P.charFolder}/daz3d/dth-exports/primary/Kira_export.duf`] = 'duf-fixture'
  seed.files[`${P.charFolder}/daz3d/rom-animations/KiraDefault_ROM.duf`] = 'duf-fixture'
  seed.files[`${P.charFolder}/houdini/backup/Kira_bak1.hip`] = 'hip-fixture'
  // The add validation reads the scene — one G9 figure, empty timeline (the
  // mock's defaults once a figure is seeded), so every check passes.
  seed.sceneFigure = { id: 'Genesis9', label: 'Kira' }
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()

  // Load-time detection: exactly the two candidates, none of the decoys.
  const banner = page.getByText(/found in this character's folder/)
  await expect(banner).toBeVisible()
  await expect(banner).toContainText('1 new Daz scene and 1 new Houdini project')

  // ✕ hides the banner for the session…
  await page.getByRole('button', { name: 'Dismiss' }).click()
  await expect(banner).not.toBeVisible()

  // …but a NEW file (saved in Daz, then tabbing back = a focus event) re-shows
  // it with the grown count.
  await saveFileAndRefocus(page, NEW_SCENE_2, 'duf-fixture-new')
  await expect(banner).toBeVisible()
  await expect(banner).toContainText('2 new Daz scenes and 1 new Houdini project')

  // Review opens the wizard: one page per file.
  await page.getByRole('button', { name: 'Review' }).click()
  const wizard = page.getByRole('dialog', { name: /New files? found/ })
  await expect(wizard).toBeVisible()
  await expect(wizard).toContainText('1 of 3')

  // A file saved WHILE the wizard is open appends as a page.
  await saveFileAndRefocus(page, NEW_HIP_2, 'hip-fixture-new')
  await expect(wizard).toContainText('1 of 4')

  // Page 1 (beach scene): validation passes → Add links it as an extra scene.
  await expect(wizard).toContainText('KiraBeach_G9.duf')
  const addScene = wizard.getByRole('button', { name: 'Add scene' })
  await expect(addScene).toBeEnabled()
  await addScene.click()
  await expect(page.getByText('Added Daz scene')).toBeVisible()
  const afterAdd = JSON.parse((await fileContent(page, `${P.charFolder}/Kira.json`))!) as {
    extraScenes: Array<string>
  }
  expect(afterAdd.extraScenes).toContain(NEW_SCENE)

  // The handled page is gone; the party scene is next — Skip = permanent ignore.
  await expect(wizard).toContainText('1 of 3')
  await expect(wizard).toContainText('KiraParty_G9.duf')
  await wizard.getByRole('button', { name: 'Skip' }).click()
  await expect(wizard).toContainText('1 of 2')
  const ignored = JSON.parse((await fileContent(page, IGNORE_FILE))!) as {
    ignored: Array<string>
  }
  expect(ignored.ignored).toEqual(['daz3d/party/KiraParty_G9.duf'])

  // The two Houdini pages: link one, skip the other — the wizard closes itself
  // once every page is handled.
  await wizard.getByRole('button', { name: 'Add project' }).click()
  await expect(page.getByText('Linked Houdini project')).toBeVisible()
  // One page left — the title drops the counter for a single file.
  await expect(wizard).toContainText('New file found in the character folder')
  await wizard.getByRole('button', { name: 'Skip' }).click()
  await expect(wizard).not.toBeVisible()

  // Everything is linked or ignored — no banner left.
  await expect(banner).not.toBeVisible()
  const json = JSON.parse((await fileContent(page, `${P.charFolder}/Kira.json`))!) as {
    extraScenes: Array<string>
    houdiniProjects: Array<string>
  }
  expect(json.extraScenes).toEqual([NEW_SCENE])
  expect(json.houdiniProjects).toHaveLength(2)
  const ignoredAfter = JSON.parse((await fileContent(page, IGNORE_FILE))!) as {
    ignored: Array<string>
  }
  expect(ignoredAfter.ignored).toHaveLength(2)

  expect(await unhandledCommands(page)).toEqual([])
})
