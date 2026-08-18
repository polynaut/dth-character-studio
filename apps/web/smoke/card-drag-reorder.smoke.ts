/* oxlint-disable no-await-in-loop -- a drag is an ordered input stream: each
   pointer move must land before the next one is sent, or dnd-kit sees a single
   jump instead of a travelling pointer. Running them in parallel is not a
   faster version of this helper, it is a different (broken) gesture. */
import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// **Cards re-order by dragging their grip, and the order is the array.**
// The card lists render in `extraScenes` / `houdiniProjects` order, so a drop
// persists the reordered array through `persistPatch` — same validation,
// single-flight and regeneration as any link/unlink.
//
// A real pointer drag is the only thing that proves this: the wiring is dnd-kit
// sensors, an activation distance and collision detection, none of which a
// render test exercises. So this spec drags with the mouse, in steps, the way a
// user does.
//
// It also pins the grip's ABSENCE. One card has nothing to re-order against, so
// its grip would be a control that does nothing — and a single linked Houdini
// project is the ordinary case, not an edge case.

const CHAR_JSON = `${P.charFolder}/Kira.json`
const HIP_B = 'D:/DTH Projects/Demo/Kira/houdini/KiraOutfit.hip'
/** Every grip on the page. This seed links no extra Daz scenes, so the only
 *  sortable cards are the Houdini ones. */
const grips = (page: Page) => page.getByRole('button', { name: 'Drag to reorder' })

/** The character as it currently sits on disk in the mock. */
const savedProjects = (page: Page) =>
  page.evaluate((p) => {
    const text = ((window as any).__tauriMock.files as Map<string, string>).get(p)
    return text ? (JSON.parse(text) as { houdiniProjects: Array<string> }).houdiniProjects : null
  }, CHAR_JSON)

/** Drag from one point to another in steps — dnd-kit has to clear its 4px
 *  activation distance and then see the pointer travel over the drop target,
 *  which a single jump does not produce. */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  // Clear the 4px activation constraint on its own first — dnd-kit measures the
  // droppables when the drag ACTIVATES, so a single uninterrupted sweep can
  // travel the whole way before there is anything to collide with.
  await page.mouse.move(from.x + 8, from.y)
  await page.waitForTimeout(50)
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / 12, from.y + ((to.y - from.y) * i) / 12)
    await page.waitForTimeout(20)
  }
  await page.waitForTimeout(50)
  await page.mouse.up()
}

const centre = (b: { x: number; y: number; width: number; height: number }) => ({
  x: b.x + b.width / 2,
  y: b.y + b.height / 2,
})

async function openCharacter(page: Page) {
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()
}

test('dragging a Houdini card’s grip re-orders the projects — and persists', async ({ page }) => {
  // The demo character with a SECOND linked project, both present on disk.
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true })
  const character = JSON.parse(seed.files[CHAR_JSON]) as { houdiniProjects: Array<string> }
  character.houdiniProjects = [P.houdini, HIP_B]
  seed.files[CHAR_JSON] = JSON.stringify(character, null, 2)
  seed.files[HIP_B] = 'hip-fixture'

  await page.addInitScript(installTauriMock, seed)
  await openCharacter(page)

  // Two cards, two grips, and the order on disk before anything is dragged.
  await expect(grips(page)).toHaveCount(2)
  expect(await savedProjects(page)).toEqual([P.houdini, HIP_B])

  // Scroll the cards into view BEFORE measuring. `boundingBox()` reports
  // viewport coordinates even for an element below the fold, and `mouse.move`
  // clamps to the viewport — so measuring first silently drags somewhere else
  // entirely and the test fails with no drag ever having started.
  await grips(page).nth(1).scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)

  // Drag the SECOND card by its grip onto the first — the drop lands that
  // project in the first slot.
  const from = centre((await grips(page).nth(1).boundingBox())!)
  const to = centre((await grips(page).nth(0).boundingBox())!)
  await drag(page, from, to)

  // The new order reached disk — through persistPatch, so it is a real save.
  await expect.poll(() => savedProjects(page)).toEqual([HIP_B, P.houdini])
})

test('a single card has no grip — there is nothing to re-order against', async ({ page }) => {
  // The demo character ships with exactly one linked Houdini project and no
  // extra Daz scenes. A grip on either would promise a drag that cannot move
  // anything.
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true })
  await page.addInitScript(installTauriMock, seed)
  await openCharacter(page)

  // The Houdini card is there…
  await expect(page.getByRole('button', { name: /Open in Houdini/ }).first()).toBeVisible()
  // …and carries no grip.
  await expect(grips(page)).toHaveCount(0)
})

test('the grip re-orders by KEYBOARD too — space, arrow, space', async ({ page }) => {
  // `useSortable`'s attributes announce the grip as `aria-roledescription
  // ="sortable"` and point aria-describedby at dnd-kit's own "press the space
  // bar to pick up" text, which DndContext renders into the page. Without a
  // KeyboardSensor registered that instruction is a lie — so it is pinned.
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true })
  const character = JSON.parse(seed.files[CHAR_JSON]) as { houdiniProjects: Array<string> }
  character.houdiniProjects = [P.houdini, HIP_B]
  seed.files[CHAR_JSON] = JSON.stringify(character, null, 2)
  seed.files[HIP_B] = 'hip-fixture'

  await page.addInitScript(installTauriMock, seed)
  await openCharacter(page)
  await expect(grips(page)).toHaveCount(2)
  await grips(page).nth(1).scrollIntoViewIfNeeded()

  // Pick the second card up, walk it one slot left, drop it.
  await grips(page).nth(1).focus()
  await page.keyboard.press('Space')
  await page.waitForTimeout(100)
  await page.keyboard.press('ArrowLeft')
  await page.waitForTimeout(100)
  await page.keyboard.press('Space')

  await expect.poll(() => savedProjects(page)).toEqual([HIP_B, P.houdini])
})

test('a missing project shows its FILE NAME, and its grip clears that text', async ({ page }) => {
  // Two things at once, both about the missing-on-disk card — the one card in
  // these rows that is NOT the LinkedAssetCard shell.
  //
  // 1. It names the file by splitting on `[\\/]`, and the path is spelled with
  //    BACKSLASHES here on purpose: a Windows path is what a Tauri dialog hands
  //    back (hence `normalizePath` existing at all), and it is the only spelling
  //    that can tell a correct split from one that only handles `/`.
  // 2. Its grip cannot take the top-left corner the card shell leaves free —
  //    that corner is where this row's filename starts. The row reserves a left
  //    gutter instead, which is a geometric claim, so it is measured: the grip
  //    must end before the text begins.
  const missingHip = 'D:\\DTH Projects\\Demo\\Kira\\houdini\\KiraOutfit.hip'
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true })
  const character = JSON.parse(seed.files[CHAR_JSON]) as { houdiniProjects: Array<string> }
  character.houdiniProjects = [P.houdini, missingHip]
  seed.files[CHAR_JSON] = JSON.stringify(character, null, 2)
  // Deliberately NOT seeded as a file — that is what makes it "missing on disk".

  await page.addInitScript(installTauriMock, seed)
  await openCharacter(page)

  const missingCard = page
    .locator('[class*="group/sort"]')
    .filter({ hasText: 'is missing on disk' })
  await expect(missingCard).toHaveCount(1)

  // The file name alone — not the path it was split out of.
  const name = missingCard.locator('code')
  await expect(name).toHaveText('KiraOutfit.hip')

  // The grip sits in the reserved gutter, left of the text — no overlap.
  await missingCard.scrollIntoViewIfNeeded()
  const grip = missingCard.getByRole('button', { name: 'Drag to reorder' })
  const gripBox = (await grip.boundingBox())!
  const nameBox = (await name.boundingBox())!
  expect(gripBox.x + gripBox.width).toBeLessThanOrEqual(nameBox.x)
})
