/* oxlint-disable no-await-in-loop -- a drag is an ordered input stream: each
   pointer move must land before the next one is sent, or dnd-kit sees a single
   jump instead of a travelling pointer. */
import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// **The ROM pose grid's table wiring** — the parts of `group-card.tsx` /
// `pose-table.tsx` that lean on TanStack Table internals rather than on our own
// state: column visibility (the Bone scale column), `row.index` (every edit,
// insert and remove addresses a pose by it) and the row model's order after a
// drag. Pinned when the grid moved to TanStack Table v9 (#773), where a feature
// that is not registered stops existing: calling its API is a type error, but
// passing its STATE slice (`state.columnVisibility`) compiles and is ignored —
// a column that never hides. Types can't tell an edit landing on the wrong pose.

const CHAR_JSON = `${P.charFolder}/Kira.json`

async function openCharacter(page: Page) {
  await page.addInitScript(installTauriMock, buildSeed({ activeProjectFile: P.dcsp, demo: true }))
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()
}

const poseRows = (page: Page) => page.locator('tbody tr[data-pose-id]')
const nameInput = (page: Page, i: number) =>
  poseRows(page).nth(i).locator('input[data-pose-input]')
const frameOf = (page: Page, i: number) => poseRows(page).nth(i).locator('td').nth(1)

/** The FBM poses as they sit on disk after a save, in order. */
const savedFbmNames = (page: Page) =>
  page.evaluate((p) => {
    const text = ((window as any).__tauriMock.files as Map<string, string>).get(p)
    const c = JSON.parse(text!) as {
      sections: { FBM: { groups: Array<{ poses: Array<{ name: string }> }> } }
    }
    return c.sections.FBM.groups[0].poses.map((pose) => pose.name)
  }, CHAR_JSON)

async function save(page: Page) {
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText(/Saved “Kira”/)).toBeVisible()
}

test('the Bone scale column shows only in the sections that export reference skeletons', async ({
  page,
}) => {
  await openCharacter(page)
  await page.getByRole('button', { name: /^FBM / }).click()
  const fbmHead = page.locator('table thead tr').first()
  await expect(fbmHead).toContainText('Bone scale')
  // One visible cell per header (plus the drag-grip cell on both sides).
  await expect(poseRows(page).first().locator('td')).toHaveCount(
    await fbmHead.locator('th').count(),
  )
  await expect(poseRows(page).first().getByRole('checkbox')).toBeVisible()

  // MISC is not a reference-FBX section: column visibility hides the column AND
  // its cells, so the grid stays rectangular.
  await page.getByRole('button', { name: /^FBM / }).click()
  await page.getByRole('button', { name: /^MISC / }).click()
  const miscHead = page.locator('table thead tr').first()
  await expect(miscHead).toContainText('Parameter name')
  await expect(miscHead).not.toContainText('Bone scale')
})

test('insert-after renumbers the frames and edits land on the pose they were made on', async ({
  page,
}) => {
  await openCharacter(page)
  await page.getByRole('button', { name: /^FBM / }).click()
  await expect(nameInput(page, 0)).toHaveValue('BodyTone')
  const first = Number(await frameOf(page, 0).textContent())

  await poseRows(page).nth(0).getByRole('button', { name: 'Insert a frame here' }).click()
  await page.getByRole('button', { name: 'Add after' }).click()

  // The empty pose lands at index 1 and takes focus; everything after shifts down
  // a frame (frames are computed from order, never stored).
  await expect(nameInput(page, 1)).toHaveValue('')
  await expect(nameInput(page, 1)).toBeFocused()
  await expect(nameInput(page, 2)).toHaveValue('TorsoMuscular')
  await expect(frameOf(page, 1)).toHaveText(String(first + 1))
  await expect(frameOf(page, 2)).toHaveText(String(first + 2))

  await nameInput(page, 1).fill('InsertedPose')
  await nameInput(page, 1).press('Enter')
  // A pose without a parameter name cannot save — give the new one a morph.
  const prop = poseRows(page).nth(1).getByPlaceholder('body_bs_BodyTone')
  await prop.fill('body_bs_Inserted')
  await prop.press('Enter')
  await nameInput(page, 3).fill('ArmsMuscularRenamed')
  await nameInput(page, 3).press('Enter')

  await save(page)
  const names = await savedFbmNames(page)
  expect(names.slice(0, 4)).toEqual([
    'BodyTone',
    'InsertedPose',
    'TorsoMuscular',
    'ArmsMuscularRenamed',
  ])
  expect(names).toHaveLength(50)
})

test('dragging a pose row’s grip re-orders the poses — and the frames follow the order', async ({
  page,
}) => {
  await openCharacter(page)
  await page.getByRole('button', { name: /^FBM / }).click()
  const first = Number(await frameOf(page, 0).textContent())

  const grip = poseRows(page).nth(0).getByRole('button', { name: 'Drag to reorder' })
  const from = (await grip.boundingBox())!
  const target = (await poseRows(page).nth(1).boundingBox())!
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 }
  // Past the second row's centre, so dnd-kit's closest-centre collision picks it.
  const end = { x: start.x, y: target.y + target.height * 0.9 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x, start.y + 8)
  await page.waitForTimeout(50)
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(start.x, start.y + ((end.y - start.y) * i) / 12)
    await page.waitForTimeout(20)
  }
  await page.waitForTimeout(50)
  await page.mouse.up()

  await expect(nameInput(page, 0)).toHaveValue('TorsoMuscular')
  await expect(nameInput(page, 1)).toHaveValue('BodyTone')
  // The frame column is positional: the first row still reads the first frame.
  await expect(frameOf(page, 0)).toHaveText(String(first))

  await save(page)
  expect((await savedFbmNames(page)).slice(0, 3)).toEqual([
    'TorsoMuscular',
    'BodyTone',
    'ArmsMuscular',
  ])
})
