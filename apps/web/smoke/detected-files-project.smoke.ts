import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// The PROJECT-WIDE half of detection (issue #740).
//
// The character page's own banner only runs while that character is open, so a
// Save As out of Daz while the studio was showing the project page — or
// Settings, or Tools — went unnoticed until the user happened to open that
// character. This banner sits above every page in the project window.
//
// It never adds anything itself: Open takes you to the owning character, whose
// existing banner and wizard do the work. And it excludes whichever character
// is already on screen, so the two banners can't double up.

const NEW_SCENE = `${P.charFolder}/daz3d/beach/KiraBeach_G9.duf`
const BANNER = /new file(s)? in Kira/

/** Drop a file into the fake fs and come back to the window — "saved in Daz,
 *  alt-tabbed to the studio". */
const saveAndReturn = (page: Page, path: string) =>
  page.evaluate((p) => {
    ;(window as any).__tauriMock.files.set(p, 'duf-fixture')
    window.dispatchEvent(new Event('focus'))
  }, path)

async function openProject(page: Page) {
  await page.addInitScript(installTauriMock, buildSeed({ demo: true, activeProjectFile: P.dcsp }))
  await page.goto('/')
  await expect(page.getByRole('link', { name: /Kira/ })).toBeVisible()
}

test('a scene saved while the project page is open is noticed there', async ({ page }) => {
  await openProject(page)
  // Nothing before the save — and nothing on plain load either.
  await expect(page.getByText(BANNER)).toHaveCount(0)

  await saveAndReturn(page, NEW_SCENE)
  const banner = page.getByText(BANNER)
  await expect(banner).toBeVisible()
})

test('Open takes you to the owning character, where the real wizard lives', async ({ page }) => {
  await openProject(page)
  await saveAndReturn(page, NEW_SCENE)

  await page.getByRole('button', { name: 'Open Kira' }).click()
  await expect(page).toHaveURL(/\/characters\//)
  // The character page's OWN banner takes over from here — one add flow, not
  // two — and the project-wide one steps aside for the character on screen.
  await expect(page.getByRole('button', { name: 'Review' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open Kira' })).toHaveCount(0)
})

test('the character already on screen is never announced twice', async ({ page }) => {
  await openProject(page)
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()

  await saveAndReturn(page, NEW_SCENE)
  // Kira's own page banner: yes. The project-wide one about Kira: no.
  await expect(page.getByRole('button', { name: 'Review' })).toBeVisible()
  await expect(page.getByText(BANNER)).toHaveCount(0)
})

test('dismissing hides it until something new turns up', async ({ page }) => {
  await openProject(page)
  await saveAndReturn(page, NEW_SCENE)
  await expect(page.getByText(BANNER)).toBeVisible()

  await page.getByRole('button', { name: 'Dismiss' }).click()
  await expect(page.getByText(BANNER)).toHaveCount(0)
  // A re-scan of the SAME finding stays hidden…
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByText(BANNER)).toHaveCount(0)
  // …but a genuinely new file is a new finding, so it speaks up again.
  await saveAndReturn(page, `${P.charFolder}/daz3d/party/KiraParty_G9.duf`)
  await expect(page.getByText(BANNER)).toBeVisible()
})

test('never offers the generated trees it is supposed to prune', async ({ page }) => {
  await openProject(page)
  // The Daz export tree and the studio's own ROM animations are `.duf`s living
  // in exactly the folders the sweep walks.
  await saveAndReturn(page, `${P.charFolder}/daz3d/dth-exports/primary/Kira.duf`)
  await saveAndReturn(page, `${P.charFolder}/daz3d/rom-animations/Kira_ROM.duf`)
  await expect(page.getByText(BANNER)).toHaveCount(0)
})
