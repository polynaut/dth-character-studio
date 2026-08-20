import { expect, test, type Locator, type Page } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

// The app's tooltips are the TOP floating layer (z-[100]), above the dialogs
// and side panels they would otherwise cover. Modal/SidePanel sweep them away
// on open — and then hand focus BACK to the control that opened them on close,
// which is the half that used to undo the sweep: a focus tooltip shows with no
// delay, so the tooltip returned over the app under a cursor that had never
// moved.
//
// Only a real browser can answer this: it needs a genuine mouse click, a real
// focus restore out of Radix's FocusScope, and a pointer that stays put.

/** The one tooltip host element's state. */
const tip = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector('[role="tooltip"]') as HTMLElement | null
    return { shown: el?.style.display === 'block', text: el?.textContent ?? '' }
  })

/** The character page with one linked Houdini project — whose card carries a
 *  Utils button that opens a SidePanel, the shape this spec is about. */
async function openCharacter(page: Page): Promise<Locator> {
  await page.addInitScript(
    installTauriMock,
    buildSeed({ demo: true, activeProjectFile: P.dcsp, houdiniProject: true }),
  )
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()
  return page.getByRole('button', { name: /^Utils/ }).first()
}

/** Hover the CARD, then the button. The card's control cluster is `opacity-0`
 *  until the card is hovered, and a single `hover()` straight onto a control in
 *  that state does not arm the tooltip in this harness (measured) — which is
 *  also the real interaction: you reach the wrench across its card. */
async function hoverInCluster(button: Locator) {
  await button.locator('xpath=ancestor::div[contains(@class,"group/card")][1]').hover({
    position: { x: 20, y: 20 },
  })
  await button.hover()
}

test('a tooltip swept away by a drawer does not come back when the drawer closes', async ({
  page,
}) => {
  const utils = await openCharacter(page)
  await hoverInCluster(utils)
  await expect.poll(async () => (await tip(page)).shown).toBe(true)
  const { text } = await tip(page)

  // Open it with a real click — the pointer never moves again after this.
  await utils.click()
  const drawer = page.getByRole('dialog')
  await expect(drawer).toBeVisible()
  expect((await tip(page)).shown).toBe(false)

  // Closing with the drawer's ✕ restores focus to the button under the cursor.
  // That focus is the APP's, not the user's, so it must not re-show anything.
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(drawer).toHaveCount(0)
  await page.waitForTimeout(400)
  expect(await tip(page)).toEqual({ shown: false, text })
})

test('…but a KEYBOARD close still describes the control focus lands on', async ({ page }) => {
  // The other half of the same rule: someone driving by keyboard closes with
  // Escape, focus returns to the button, and the description they cannot get by
  // hovering is exactly what they need.
  const utils = await openCharacter(page)
  await hoverInCluster(utils)
  await utils.focus()
  await page.keyboard.press('Enter')
  const drawer = page.getByRole('dialog')
  await expect(drawer).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
  await expect.poll(async () => (await tip(page)).shown).toBe(true)
})
