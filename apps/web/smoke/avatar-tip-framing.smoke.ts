import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// Daz does not frame every Genesis generation the same way in the `.tip.png` it
// renders: G3/G8/G8.1 figures come out sitting noticeably HIGHER in the square
// than G9 does. The header portrait is a fixed pan over that square, so ONE set
// of offsets cannot serve both — the G9-tuned pan crops the top of a G8 head and
// leaves a band of empty tile under the chin.
//
// The offsets live in styles.css as `--dth-avatar-pan-*`; which pair applies is
// decided by `data-tip-framing` on the wrapper, from a Record keyed by every
// GenesisVersion (so a new generation can't silently inherit a framing nobody
// looked at). This pins the wiring end to end — the variable actually reaching
// the painted transform — rather than the attribute alone, which could be set
// and still do nothing.

/** The portrait's resting vertical offset in painted px (the pan's `from` end,
 *  which is what shows before the header starts collapsing at 130px). */
const panY = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector('.avatar-scroll-pan')
    if (!el) throw new Error('no .avatar-scroll-pan on the page')
    return new DOMMatrix(getComputedStyle(el).transform).f
  })

/** The LAYOUT height the percentage offsets resolve against — `offsetHeight`,
 *  not the bounding rect, which the collapsed state's `scale` would inflate. */
const panHeight = (page: Page) =>
  page.evaluate(() => (document.querySelector('.avatar-scroll-pan') as HTMLElement).offsetHeight)

/** Scroll past the pan's range end (248px) and let the scroll-driven animation
 *  settle, so the assertion sees the COLLAPSED end rather than the resting one. */
async function scrollPastTheCollapse(page: Page) {
  await page.evaluate(() => window.scrollTo(0, 400))
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  )
}

/** The project window, open on its overview, with the character re-stamped to
 *  `genesis`. `/` lands here directly because the seed pins an active project. */
async function openProject(page: Page, genesis: string, houdiniProject = false) {
  const seed = buildSeed({ activeProjectFile: P.dcsp, houdiniProject })
  const file = `${P.charFolder}/Kira.json`
  seed.files[file] = JSON.stringify({
    ...(JSON.parse(seed.files[file]!) as Record<string, unknown>),
    genesis,
    // A stored avatar, which the MINIMAL seed leaves empty — without one the
    // overview's tile renders the name-initial fallback and there is no <img> to
    // measure. The file itself is seeded unconditionally.
    image: 'char-kira--sc-1767225600000.png',
  })
  // The generated script's NAME carries the generation (`characterScriptName` =
  // slug_genesis), so re-stamping the character without moving its script leaves
  // the startup staleness probe seeing "runtime: not generated" — it redirects
  // the whole window to Refresh assets and there is no header to measure. Rename
  // rather than add: a leftover G9 script would be a second, stale generation.
  const g9 = `${P.scriptsDir}/ROM_Kira_G9.dsa`
  if (genesis !== 'G9') {
    seed.files[`${P.scriptsDir}/ROM_Kira_${genesis}.dsa`] = seed.files[g9]!
    delete seed.files[g9]
  }
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
}

async function openCharacter(page: Page, genesis: string, houdiniProject = false) {
  await openProject(page, genesis, houdiniProject)
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.locator('.avatar-scroll-pan').waitFor()
}

test('a G9 portrait pans 11% → 15%, resting and collapsed', async ({ page }) => {
  await openCharacter(page, 'G9')
  const height = await panHeight(page)
  // The offsets the pan was originally tuned to, on the generation it was tuned
  // against. Tolerant by a pixel: laid out in CSS px, read back as a float.
  expect(await panY(page)).toBeCloseTo(height * 0.11, 0)
  await scrollPastTheCollapse(page)
  expect(await panY(page)).toBeCloseTo(height * 0.15, 0)
})

for (const genesis of ['G8.1', 'G8', 'G3']) {
  test(`a ${genesis} portrait pans LOWER, where Daz puts that generation's face`, async ({
    page,
  }) => {
    await openCharacter(page, genesis)
    const height = await panHeight(page)
    // Further down at both ends, and by MORE once collapsed (4 points at rest,
    // 5 collapsed — the pans are not a constant offset apart). Asserted on the
    // PAINTED transform: the attribute could be set correctly and still do
    // nothing if the rule that reads it were wrong, and that failure is
    // invisible from the DOM.
    expect(await panY(page)).toBeCloseTo(height * 0.15, 0)
    // …and it must still be ON the scroll timeline. The pre-G9 rule swaps only
    // `animation-name`; had it used the `animation` shorthand it would have reset
    // `animation-timeline` to auto, freezing the portrait at its resting offset —
    // which the assertion above would have passed anyway.
    await scrollPastTheCollapse(page)
    expect(await panY(page)).toBeCloseTo(height * 0.2, 0)
  })
}

// The SMALL portraits are a second, independent framing: a fixed `scale-[2.3]`
// crop nudged up with translateY, on the cards rather than the header. They need
// the same per-generation correction — but ONLY where the picture is something
// Daz composed. A Houdini project's card wears the same portrait frame and is
// not a Genesis render at all; shifting it would be a crop applied for a reason
// that does not hold there. `Portrait` gets the generation only from Daz call
// sites, and omitting the prop is what guarantees the rest keep the default.

/** Every zoomed card portrait on the page, tagged by the KIND of card holding it
 *  (`daz-card` / `houdini-card`, the classes LinkedAssetCard already carries for
 *  its accent colour). Tagging rather than indexing is what makes "the Daz one
 *  moved, the Houdini one did not" survive a change in render order. */
const cardCrops = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('img')]
      .filter((img) => img.className.includes('object-cover') && img.className.includes('scale-'))
      .map((img) => ({
        kind: img.closest('.daz-card') ? 'daz' : img.closest('.houdini-card') ? 'houdini' : 'other',
        translate: getComputedStyle(img).translate,
      }))
      .filter((c) => c.kind !== 'other'),
  )

test('G9: the Daz scene card and the Houdini card share one crop', async ({ page }) => {
  await openCharacter(page, 'G9', true)
  await expect.poll(() => cardCrops(page)).toEqual([
    { kind: 'daz', translate: '-2% -17%' },
    { kind: 'houdini', translate: '-2% -17%' },
  ])
})

test('pre-G9: the Daz scene card lifts less — and the Houdini card does NOT move', async ({
  page,
}) => {
  await openCharacter(page, 'G8.1', true)
  // The Houdini row is the point of this spec. Its thumbnail is not a Daz render
  // of anything, so a change made because Daz frames G8.1 high in a tip must not
  // reach it — a regression here would silently re-crop every Houdini card on
  // every pre-G9 character.
  await expect.poll(() => cardCrops(page)).toEqual([
    { kind: 'daz', translate: '-2% -5%' },
    { kind: 'houdini', translate: '-2% -17%' },
  ])
})

// The LANDSCAPE scene tiles (the footer's pills, the Tools scan rows) are a
// third framing: a `-50%` lift plus a per-size px correction. Those corrections
// are only derivable because of an invariant — within one framing every size
// lands the SAME painted lift, since where the face sits in a tip has nothing to
// do with how big the tile is. The px term exists purely to cancel the differing
// `-50%` baselines (of the CONTENT box: the frame's border-2 is 4px of it).
// Asserting the painted pixels, not the classes, is what keeps that honest: a
// size added with a mismatched pair reads fine in the source and clips the head
// on screen. NOTE this can only cover the sizes a page actually renders — the
// character page shows `md` alone. The invariant across ALL sizes (including
// `sm`, whose pre-G9 value is derived rather than measured) is pinned by
// `scene-tile-sizes.test.ts`.

/** Each landscape tile's painted lift in px — the gap between the frame's inner
 *  top edge and the image's painted top (`scale` is origin-top, so it leaves the
 *  top edge put and the whole gap IS the translate). */
const tileLifts = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('img')]
      // LANDSCAPE frames only — by shape, not by class: `sm` lifts with
      // `-translate-y-1/2` and `md` with a calc, and matching on the class text
      // also swept in the portrait CARDS (`-translate-y-[17%]` contains the same
      // substring), whose lift is a different framing with a different answer.
      .filter((img) => {
        const frame = img.parentElement as HTMLElement | null
        return (
          img.className.includes('scale-') && !!frame && frame.clientWidth > frame.clientHeight
        )
      })
      .map((img) => {
        const frame = img.parentElement as HTMLElement
        const border = (frame.getBoundingClientRect().height - frame.clientHeight) / 2
        // Rounded: every lift is a whole number of pixels by design, while an
        // `aspect-ratio` frame lays out fractionally (the 13/9 tile is 44.3px
        // tall) and `clientHeight` is an integer — which puts a tenth of a pixel
        // of noise on the border term, not on the value under test.
        return Math.round(
          img.getBoundingClientRect().top - frame.getBoundingClientRect().top - border,
        )
      }),
  )

test('landscape tiles: the rendered sizes land their painted lift, per generation', async ({
  page,
}) => {
  await openCharacter(page, 'G9')
  // Scrolled: the scene footer only docks once the up-page cards leave.
  await scrollPastTheCollapse(page)
  const g9 = await tileLifts(page)
  expect(g9.length).toBeGreaterThan(0)
  // −14px: −50% of sm's 28px content box, and −50% of md's 36 plus its +4.
  expect(g9).toEqual(g9.map(() => -14))

  await openCharacter(page, 'G8.1')
  await scrollPastTheCollapse(page)
  const preG9 = await tileLifts(page)
  expect(preG9.length).toBe(g9.length)
  // −6px, from the +12 measured on a real G8.1 tip at `md`. Any size that drifts
  // off this number is the mismatched-pair bug SCENE_TILE_SIZES exists to stop.
  expect(preG9).toEqual(preG9.map(() => -6))
})

test("the overview's LIST tile is a landscape crop too, and follows the generation", async ({
  page,
}) => {
  // The third landscape variant, and the one that expresses its lift as flat
  // pixels rather than `-50%` + a correction. It has to land the same painted
  // offset as the scene tiles — a character reads as the same face whichever
  // list it appears in.
  await openProject(page, 'G9')
  await page.getByRole('button', { name: 'List view' }).click()
  await expect.poll(() => tileLifts(page)).toEqual([-14])

  await openProject(page, 'G8.1')
  // The view is persisted (`dth.characters.view`), so the second window opens
  // in list view already — clicking again would toggle nothing, and asserting
  // straight away is the honest check that it stayed.
  await expect.poll(() => tileLifts(page)).toEqual([-6])
})
