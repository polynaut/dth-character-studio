import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// Copying a Houdini project in, which was refused outright until the studio
// could see and repair what a copy breaks. These specs pin the file movement —
// the part that is not undoable — and the shape of the decision: it is asked
// AFTER the pick, on a file whose location the studio can see, exactly like the
// Daz-scene flow. A `.hip` already inside the character folder is never asked
// about at all.

/** A `.hip` living outside the character folder, the thing being brought in. */
const OUTSIDE = 'D:/Templates/G9_Skin_Base.hiplc'
const DEST = `${P.charFolder}/houdini/G9_Skin_Base.hiplc`
/** A `.hip` ALREADY under the character folder — nothing to decide. */
const INSIDE = `${P.charFolder}/houdini/Kira_Look.hiplc`

const has = (page: Page, path: string) =>
  page.evaluate((p) => (window as any).__tauriMock.files.has(p) as boolean, path)
const linked = (page: Page) =>
  page.evaluate(
    (p) => JSON.parse(((window as any).__tauriMock.files.get(p) ?? '{}') as string).houdiniProjects,
    `${P.charFolder}/Kira.json`,
  )

async function open(page: Page, pick = OUTSIDE, extra: Record<string, string> = {}) {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true, dialogPath: pick })
  seed.files[pick] = 'hip-fixture'
  for (const [path, body] of Object.entries(extra)) seed.files[path] = body
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()
}

/** Pick the project and land on the copy-vs-link dialog. */
async function addAndAsk(page: Page) {
  await page.getByRole('button', { name: 'Add project' }).click()
  return page.getByRole('dialog', { name: /Copy this Houdini project in, or link it\?/ })
}

test('the decision is asked after the pick, not as a toggle beforehand', async ({ page }) => {
  await open(page)
  // Nothing to answer until a file has been chosen — the field itself carries
  // no copy switch any more.
  await expect(page.getByText(/Copy into the character/)).toHaveCount(0)

  const ask = await addAndAsk(page)
  await expect(ask).toBeVisible()
  // The destination is fixed, so the dialog states it instead of offering a
  // subfolder field the user cannot meaningfully answer.
  await expect(ask.getByText(/lands in this character/)).toBeVisible()
  await expect(ask.getByLabel(/Subfolder/)).toHaveCount(0)
})

test('Link in place leaves the file where it is', async ({ page }) => {
  await open(page)
  const ask = await addAndAsk(page)
  await ask.getByRole('button', { name: 'Link in place' }).click()
  await expect(page.getByText(/Linked Houdini project/)).toBeVisible()

  expect(await has(page, OUTSIDE)).toBe(true)
  expect(await has(page, DEST)).toBe(false)
  expect(await linked(page)).toContain(OUTSIDE)
})

test('Copy in brings the file in and links the copy, leaving the original', async ({ page }) => {
  await open(page)
  const ask = await addAndAsk(page)
  await ask.getByRole('button', { name: 'Copy in' }).click()
  await expect(page.getByText(/Copied 1 Houdini project/)).toBeVisible({ timeout: 20_000 })

  expect(await has(page, DEST)).toBe(true)
  // A COPY leaves the source alone — that is the whole difference from move.
  expect(await has(page, OUTSIDE)).toBe(true)
  const projects = await linked(page)
  expect(projects).toContain(DEST)
  expect(projects).not.toContain(OUTSIDE)
})

test('"Delete original after copying" removes the source once the copy landed', async ({
  page,
}) => {
  await open(page)
  const ask = await addAndAsk(page)
  // The switch itself, not its caption: SceneCopyDialog renders them as
  // siblings rather than a <label>, so the text is not a click target.
  await ask.getByRole('switch').click()
  await ask.getByRole('button', { name: 'Copy in' }).click()
  await expect(page.getByText(/Moved 1 Houdini project/)).toBeVisible({ timeout: 20_000 })

  expect(await has(page, DEST)).toBe(true)
  expect(await has(page, OUTSIDE)).toBe(false)
})

test('a project already inside the character folder is linked without asking', async ({ page }) => {
  await open(page, INSIDE)
  await page.getByRole('button', { name: 'Add project' }).click()

  // Assert the PERSISTED outcome, not the toast. Linking a project that sits
  // inside the character folder also wakes the background scan sweep (that is
  // the half of the tree it covers), so this path can take noticeably longer on
  // a loaded CI runner than it does locally — and a toast is transient, so a
  // slow run misses the window and the spec fails for a reason that has nothing
  // to do with what it is testing. The definition on disk has no such window.
  await expect.poll(() => linked(page), { timeout: 20_000 }).toContain(INSIDE)
  // And it got there without a decision to make: it already lives where a copy
  // would have put it.
  await expect(page.getByRole('dialog', { name: /link it\?/ })).toHaveCount(0)
})

test('a name already in the folder is refused rather than overwritten', async ({ page }) => {
  await open(page, OUTSIDE, { [DEST]: 'somebody else’s project' })
  const ask = await addAndAsk(page)
  await ask.getByRole('button', { name: 'Copy in' }).click()

  await expect(page.getByText(/already in this character.s Houdini folder/)).toBeVisible()
  // Untouched — refusing has to mean refusing, not "overwrote and told you".
  expect(await page.evaluate((p) => (window as any).__tauriMock.files.get(p), DEST)).toBe(
    'somebody else’s project',
  )
})
