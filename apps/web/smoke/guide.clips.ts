import { expect, test, type Page } from '@playwright/test'

import { buildSeed, P, prime, settle } from './fixtures.ts'
import { WebpRecorder } from './webp-recorder.ts'

import type { Locator } from '@playwright/test'

// Interaction clips (animated WebP) for docs/guide/* — the moving-picture
// siblings of guide.screenshots.ts. Same fixture world, same determinism
// contract (regenerating leaves `git diff` empty): interactions are scripted as
// FIXED frame sequences — a fake cursor glides between UI states, every frame is
// a plain screenshot, sharp encodes them to a lossless animated WebP. See
// smoke/webp-recorder.ts for the machinery.
//
// Run: pnpm --filter @dth/web clips

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../../../docs/guide/clips')

// prime()/settle()/FIXED_TIME are shared with guide.screenshots.ts — they live
// in fixtures.ts. Only the clipboard stub is clip-specific:
// headless Chromium rejects the async clipboard API (permission grants
// included proved flaky) — stub it so click-to-copy takes its SUCCESS path
// and the "Copied" check badge shows in recordings. The app code path is
// unchanged; only the OS clipboard itself is faked.
const stubClipboard = (page: Page) =>
  page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.resolve() },
    })
  })

test('path-chip-copy', async ({ page }) => {
  await prime(page, buildSeed({ demo: true, activeProjectFile: P.dcsp }))
  await stubClipboard(page)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).waitFor()
  await settle(page)

  const chip = page.getByRole('button', { name: 'Copy path' }).first()
  const box = (await chip.boundingBox())!
  const target = { x: box.x + box.width * 0.55, y: box.y + box.height * 0.6 }

  // Clip: the chip's neighbourhood, wide enough to show the approach.
  const rec = new WebpRecorder(page, {
    x: Math.max(0, box.x - 120),
    y: Math.max(0, box.y - 56),
    width: box.width + 240,
    height: box.height + 112,
  })
  await rec.install()
  await rec.placeAt(target.x + 170, target.y + 46) // enter from bottom-right
  await rec.hold(500)
  await rec.glideTo(target.x, target.y, 10) // hover: the copy badge pops in
  await rec.hold(600)
  await rec.click() // click: copies — the badge flips to the check mark
  // The copy must actually land (clipboard stub!) — otherwise the clip silently
  // records a click with no feedback. NOTE: assert via a name-stable locator;
  // the `chip` locator above filters BY the name 'Copy path' and so can never
  // observe the 'Copied' state itself.
  await expect(page.locator('span[data-alt-reveal]').first()).toHaveAccessibleName('Copied')
  await rec.hold(1400)
  await rec.save(join(OUT, 'path-chip-copy.webp'))
})

// ── Per-scene overrides ──────────────────────────────────────────────────────
// Three clips for advanced.md's "edit to override": the cubes appearing when a
// non-primary scene is selected, a field going green as it is edited, and the
// green cube turning into the reset that undoes it.
//
// They are clips rather than screenshots because each one IS a transition — the
// override has no switch to photograph, only a before and an after, and a still
// of either half is the half that doesn't explain it.
//
// All three work the character page's **Daz scenes** block, where the scene
// cards and the per-scene identity dials sit side by side: one region holds the
// thing you click and the thing that changes.

/** The character page with an outfit scene linked, ready to record. */
async function openTwoSceneCharacter(page: Page) {
  await prime(page, buildSeed({ demo: true, activeProjectFile: P.dcsp, extraScene: true }))
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()
  await settle(page)
}

/** Select the outfit scene — the card's cover button, clicked over the avatar
 *  strip (the title is the inline-rename button and the card centre holds the
 *  path chip; both sit above the cover and would swallow the click). */
const outfitCard = (page: Page) =>
  page.getByRole('button', { name: 'KiraSummertide_G9_GP', exact: true })

/**
 * Select the outfit scene, then anchor the page back at the top.
 *
 * The scroll is not cosmetic. Playwright scrolls an element into view before
 * clicking it, and where it lands varies run to run — so a clip box taken from
 * `boundingBox()` afterwards has a stable SIZE but a drifting ORIGIN, and every
 * frame comes out shifted by a pixel or two. That is a silent determinism break:
 * the recording is visually right and the bytes change on every regeneration.
 * Measured here before the fix — 19/19 frame hashes different between two runs
 * of an unchanged spec. `guide.screenshots.ts` anchors the same way for the same
 * reason.
 */
async function selectOutfitScene(page: Page) {
  await outfitCard(page).click({ position: { x: 40, y: 52 } })
  await page.evaluate(() => window.scrollTo(0, 0))
  await settle(page)
}

/** A clip box enclosing every given element, with breathing room. */
async function boxAround(locators: Array<Locator>, pad = 24) {
  const boxes = await Promise.all(locators.map(async (l) => (await l.boundingBox())!))
  const x = Math.min(...boxes.map((b) => b.x)) - pad
  const y = Math.min(...boxes.map((b) => b.y)) - pad
  return {
    x: Math.max(0, Math.round(x)),
    y: Math.max(0, Math.round(y)),
    width: Math.round(Math.max(...boxes.map((b) => b.x + b.width)) - x + pad),
    height: Math.round(Math.max(...boxes.map((b) => b.y + b.height)) - y + pad),
  }
}

/**
 * A cursor start point INSIDE the clip box — the approach has to be on camera.
 *
 * Starting outside it makes every glide frame identical until the cursor crosses
 * the edge, and libwebp merges identical frames: a 12-step glide that begins off
 * camera stores as one long hold and the pointer simply appears. Measured on the
 * first cut of these clips — 17 frames recorded, 9 written.
 */
const enterFrom = (clip: { x: number; y: number; width: number; height: number }) => ({
  x: clip.x + clip.width - 26,
  y: clip.y + clip.height - 20,
})

/**
 * Capture a frame AFTER the keystroke has been rendered.
 *
 * `keyboard.type()` resolves when the event is dispatched, not when React has
 * re-rendered off it — so screenshotting straight after races the paint and the
 * frame shows the old value about as often as the new one. That makes the clip
 * NON-DETERMINISTIC, which breaks this suite's contract (a second run must leave
 * `git diff` empty): measured here as the same recording writing 16396 bytes one
 * run and 16310 the next. `glideTo` already pays the same 30ms for hover states.
 */
async function typed(page: Page, rec: WebpRecorder, delay: number) {
  await page.waitForTimeout(60)
  await rec.frame(delay)
}

/** The centre of an element, in page coordinates. */
async function centre(locator: Locator) {
  const box = (await locator.boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/**
 * FACS's own override mark, scoped to its field.
 *
 * NOT `getByRole('button', { name: /Reset to the primary/ }).first()`: the hair
 * picker's mark reads "Reset to the primary scene's hair", the fixture arms it
 * on the outfit scene, and it sits ABOVE these dials — so the loose locator
 * silently resolves to hair, and an assertion on it passes before the dial has
 * been touched at all.
 */
const facsReset = (page: Page) =>
  page
    .locator('[class~="group/ovr"]')
    .filter({ hasText: 'FACS detail strength' })
    .getByRole('button', { name: /Reset to the primary/ })

test('scene-override-cubes', async ({ page }) => {
  await openTwoSceneCharacter(page)

  const card = outfitCard(page)
  // The whole Daz-scenes band: the card you click on the left, the dials that
  // grow cubes on the right. Both halves have to be in frame or the clip shows
  // a cause with no effect. (`#daz-scenes` is the section TITLE, not the block —
  // hence the union with the band's other two corners.)
  const clip = await boxAround(
    [
      page.locator('#daz-scenes'),
      page.getByRole('button', { name: 'Add scene', exact: true }),
      page.locator('input[inputmode="decimal"]').nth(1),
    ],
    18,
  )
  const rec = new WebpRecorder(page, clip)
  await rec.install()

  // With the PRIMARY selected there are no cubes at all — that is the state the
  // clip opens on, and half of what it is showing.
  await expect(page.locator('[title="Can be overridden per Daz scene"]')).toHaveCount(0)

  const box = (await card.boundingBox())!
  const target = { x: box.x + 40, y: box.y + 52 }
  // From under the dials on the right, across to the card — so the cubes appear
  // where the cursor just came from.
  await rec.placeAt(enterFrom(clip).x, enterFrom(clip).y)
  await rec.hold(900)
  await rec.glideTo(target.x, target.y, 14)
  await rec.hold(400)
  await rec.click()
  // The cubes are the point — never record the click without proving they came.
  await expect(page.locator('[title="Can be overridden per Daz scene"]').first()).toBeVisible()
  await rec.hold(1800)
  await rec.save(join(OUT, 'scene-override-cubes.webp'))
})

test('scene-override-edit', async ({ page }) => {
  await openTwoSceneCharacter(page)
  await selectOutfitScene(page)

  const facs = page.locator('input[inputmode="decimal"]').first()
  const flexion = page.locator('input[inputmode="decimal"]').nth(1)
  // FACS and its untouched neighbour: the clip has to show that ONE field goes
  // green, not the section.
  const clip = await boxAround([facs, flexion], 30)
  const rec = new WebpRecorder(page, clip)
  await rec.install()

  const target = await centre(facs)
  await rec.placeAt(enterFrom(clip).x, enterFrom(clip).y)
  await rec.hold(800)
  await rec.glideTo(target.x, target.y, 12)
  await rec.hold(300)
  await rec.click()
  await page.keyboard.press('ControlOrMeta+a')
  await typed(page, rec, 220)
  // Typed a digit at a time — the value visibly becoming something else is the
  // whole mechanism ("there is no override switch"). Unrolled deliberately: the
  // frames must be captured in order, so a loop here would be two more
  // `no-await-in-loop` warnings bought for nothing.
  await page.keyboard.type('6')
  await typed(page, rec, 260)
  await page.keyboard.type('0')
  await typed(page, rec, 260)
  await page.keyboard.press('Enter')
  // Commit is what arms the override; assert FACS's OWN green mark rather than
  // trusting the keystrokes to have landed.
  await expect(facsReset(page)).toBeVisible()
  await rec.frame(160)
  await rec.hold(2000)
  await rec.save(join(OUT, 'scene-override-edit.webp'))
})

test('scene-override-reset', async ({ page }) => {
  await openTwoSceneCharacter(page)
  await selectOutfitScene(page)

  // Arm the override BEFORE recording — this clip is about undoing one, so the
  // edit itself is setup (its own clip is `scene-override-edit`).
  const facs = page.locator('input[inputmode="decimal"]').first()
  await facs.fill('60')
  await facs.press('Enter')
  const reset = facsReset(page)
  await expect(reset).toBeVisible()
  await settle(page)

  const flexion = page.locator('input[inputmode="decimal"]').nth(1)
  const clip = await boxAround([facs, flexion], 30)
  const rec = new WebpRecorder(page, clip)
  await rec.install()

  const target = await centre(reset)
  await rec.placeAt(enterFrom(clip).x, enterFrom(clip).y)
  await rec.hold(900)
  // Approaching the green cube swaps its face for the reset icon — the reveal is
  // hover-only, so the glide IS the explanation.
  await rec.glideTo(target.x, target.y, 12)
  await rec.hold(900)
  await rec.click()
  // Back to the primary's value, and the mark is a plain cube again.
  await expect(facsReset(page)).toHaveCount(0)
  await expect(facs).toHaveValue(/100/)
  await rec.hold(1800)
  await rec.save(join(OUT, 'scene-override-reset.webp'))
})
