import { expect, test, type Locator, type Page } from '@playwright/test'

import { buildSeed, DIM_FOLDER, P, UPROJECT, prime, settle, type SeedOptions } from './fixtures.ts'

// Documentation screenshots for docs/guide/*. Reuses the smoke Tauri fake +
// fixture world (one project "Demo", one character "Kira"). Each `test`
// navigates to a screen/state and writes a PNG; the final `coverage` test is
// the only assertion — it keeps the guide and this suite in lockstep.
//
// ── REGENERATING EVERYTHING (e.g. after a restyle) ──────────────────────────
// One command, from the repo root:
//
//     pnpm screenshots
//
// That regenerates every PNG in docs/guide/screenshots/ deterministically:
//  - the world is the in-memory fixture (no real Daz install, no personal data),
//  - the clock is FROZEN (prime() pins Date/Date.now via page.clock), and the
//    config pins locale + timezone — so file dates and "saved …" strings render
//    identically on every machine and every run,
//  - viewport (1280×720 @2x, dark) and the self-hosted font are fixed by the
//    config — no OS fonts, no theme drift.
// Contract: a SECOND full run right after the first must leave `git diff`
// empty. If it doesn't, a new source of nondeterminism crept in — fix it here
// (never hand-revert PNGs as a workaround).
// After a restyle, every PNG changing is EXPECTED — review the diff visually,
// commit the lot. The only knobs that may need a one-time touch are the crop
// constants below (HEADER + per-shot headerOffset/hideHeader): they mirror the
// app's sticky-chrome heights (page header ~128px, pinned ROM section title,
// pinned column headers). If the restyle changes those heights, adjust HEADER
// (and the few explicit headerOffset values) once — nothing else is tuned by
// hand.
// NOT covered here: the guide's Daz-/Houdini-side photos (user-attachments
// CDN links in docs/guide/*.md) — those are taken manually in Daz/Houdini and
// are unaffected by an app restyle.
//
// To ADD a screenshot: write a test that navigates/clicks to the state, then
// call `shoot(page, join(OUT, '<name>.png'), <feature?>)` and reference the
// PNG from a guide page (the coverage test fails on unreferenced or missing
// shots). Pass a `feature` locator when the doc is about one region so the
// shot trims to it; omit it to grab the realistic 16:9 viewport from the top.
// Keep the width constant (never override it) so every image lines up.

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readdir, readFile } from 'node:fs/promises'

// Absolute output dir (repo/docs/guide/screenshots) — a relative path resolves
// against Playwright's cwd, which isn't the repo root.
const OUT = join(dirname(fileURLToPath(import.meta.url)), '../../../docs/guide/screenshots')

/** App width (px) — kept constant across every shot so the guide lines up. */
const VW = 1280
/** 16:9 of the width — a realistic widescreen viewport; the height cap. */
const MAX_H = 720

// prime() (frozen clock + devtools flag + Tauri fake) and settle() are shared
// with guide.clips.ts — they live in fixtures.ts (see FIXED_TIME there).

/**
 * Screenshot the documented feature at a realistic height — you work on a 16:9
 * screen and don't see a whole tall page at once. Always the constant app width.
 *
 * - no `feature`: the viewport from the top (VW×MAX_H) — for pages whose start
 *   is the point.
 * - a small `feature` (fits under MAX_H): height trimmed to the feature so the
 *   whole thing shows and nothing else.
 * - a big `feature`: capped at MAX_H, aligned to the feature's top (its start /
 *   most important part visible).
 */
/** Assumed sticky-header height — we scroll the feature to the top then back off
 *  by this so the pinned header sits above it. A fixed value is generic and good
 *  in ~99% of cases (exact header measurement fought the inner-scroll container). */
const HEADER = 150

async function shoot(
  page: Page,
  path: string,
  feature?: Locator,
  opts: { hideHeader?: boolean; headerOffset?: number } = {},
) {
  await page.mouse.move(0, 0) // park the cursor off any control so no hover state is caught
  await settle(page)
  if (!feature) {
    await page.screenshot({ path })
    return
  }
  // How far below the top to land the feature — enough to clear the sticky
  // header. A page with a SECOND sticky layer (the character page pins a section
  // title under its header) needs a taller offset so the feature's own label
  // isn't tucked under it; those shots pass `headerOffset`.
  const offset = opts.headerOffset ?? HEADER
  // Room for the header + a capped feature; the pages are taller than this so
  // they still scroll (needed to reach the feature).
  const VH = MAX_H + offset
  await page.setViewportSize({ width: VW, height: VH })
  // Edge case: a feature pinned too near the page top (e.g. the last card in a
  // short form) can't scroll far enough to clear the sticky header, which then
  // overlaps it. For those, drop the header entirely and align the feature to
  // the very top (no room reserved for a header that's no longer there).
  if (opts.hideHeader) {
    await page
      .locator('header.sticky')
      .first()
      .evaluate((el) => {
        ;(el as HTMLElement).style.display = 'none'
      })
  }
  // Scroll the feature just below the header via native `scroll-margin-top` —
  // the browser picks the right scroll container and leaves HEADER px above the
  // feature, so the pinned header ends up above it (not overlapping). With the
  // header dropped, leave a small margin instead so the feature doesn't hug the
  // top edge of the frame.
  const topGap = 28
  await feature.evaluate((el, back) => {
    ;(el as HTMLElement).style.scrollMarginTop = `${back}px`
    el.scrollIntoView({ block: 'start' })
  }, opts.hideHeader ? topGap : offset)
  await settle(page)
  const rect = await feature.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { top: r.top, height: r.height }
  })
  const pad = 24
  const height = Math.min(Math.max(0, Math.round(rect.top)) + Math.ceil(rect.height) + pad, VH)
  await page.screenshot({ path, clip: { x: 0, y: 0, width: VW, height } })
}

/**
 * A tight, full-width horizontal strip framing one region (`topEl` → `bottomEl`,
 * or just `topEl`): scrolls it into view, drops any sticky header so it can't
 * overlap, and clips exactly the region (+pad). The width stays VW like every
 * other shot, so a small control (a single toggle row, the footer bar) documents
 * as a clean band instead of the whole page.
 */
async function shootStrip(page: Page, path: string, topEl: Locator, bottomEl?: Locator) {
  await page.mouse.move(0, 0) // park the cursor off any control so no hover state is caught
  await settle(page)
  await page.setViewportSize({ width: VW, height: MAX_H + HEADER })
  // Drop the sticky page header (if any) so a mid-page strip can't sit under it.
  // A one-shot querySelector — NOT a locator, whose auto-wait would hang for the
  // full timeout on pages without one (the project overview). The pinned ROM
  // section title / column headers are left alone (they're wanted as context).
  await page.evaluate(() => {
    const h = document.querySelector('header.sticky')
    if (h) (h as HTMLElement).style.display = 'none'
  })
  await topEl.evaluate((el) => {
    ;(el as HTMLElement).style.scrollMarginTop = '32px'
    el.scrollIntoView({ block: 'start' })
  })
  await settle(page)
  const top = await topEl.evaluate((el) => Math.floor(el.getBoundingClientRect().top))
  const bottom = await (bottomEl ?? topEl).evaluate((el) =>
    Math.ceil(el.getBoundingClientRect().bottom),
  )
  const pad = 20
  const y = Math.max(0, top - pad)
  const height = Math.max(1, bottom - y + pad)
  await page.screenshot({ path, clip: { x: 0, y, width: VW, height } })
}

test('home', async ({ page }) => {
  await prime(page, buildSeed())
  await page.goto('/')
  await page.getByRole('heading', { name: 'DTH Character Studio' }).waitFor()
  await shoot(page, join(OUT, 'home.png'))
})

// NOTE: navigate to /tools and /settings by CLICKING the header links, not
// page.goto — main.tsx runs a one-time startup navigation (project → its route,
// else → '/') that a hard goto/reload would re-trigger, bouncing the shot back
// to the home screen. A client-side Link click doesn't reload, so the route sticks.
test('tools-page', async ({ page }) => {
  await openTools(page)
  await shoot(page, join(OUT, 'tools-page.png'))
})

test('tools-daz-assets', async ({ page }) => {
  await openTools(page)
  await shoot(page, join(OUT, 'tools-daz-assets.png'), card(page, 'Daz assets'))
})

test('tools-deduplicate', async ({ page }) => {
  await openTools(page)
  await shoot(page, join(OUT, 'tools-deduplicate.png'), card(page, 'Deduplicate'))
})

test('tools-danger-zone', async ({ page }) => {
  await openTools(page)
  await shoot(page, join(OUT, 'tools-danger-zone.png'), card(page, 'Danger zone'))
})

test('tools-refresh', async ({ page }) => {
  await openTools(page)
  await page.getByRole('tab', { name: 'Refresh assets' }).click()
  await shoot(page, join(OUT, 'tools-refresh.png'))
})

/** The `<section>` card that contains a given heading — the app's consistent
 *  card wrapper, so a feature crops to exactly its card. */
function card(page: Page, heading: string): Locator {
  return page.locator('section').filter({ has: page.getByRole('heading', { name: heading }) })
}

/** Open the Tools page (Home window → header "Tools" link). */
async function openTools(page: Page) {
  await prime(page, buildSeed())
  await page.goto('/')
  await page.getByRole('heading', { name: 'DTH Character Studio' }).waitFor()
  await page.getByRole('link', { name: 'Tools' }).click()
}

/** Open the demo character's editor in a project window. Extra seed options tune
 *  the project (e.g. `dazProductsEnabled` to reveal the Products tab). */
async function openCharacter(page: Page, seedOpts: SeedOptions = {}) {
  await prime(page, buildSeed({ demo: true, activeProjectFile: P.dcsp, ...seedOpts }))
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()
}

/** Open the demo project's overview (character list + Unreal footer). */
async function openProject(page: Page, seedOpts: SeedOptions = {}) {
  await prime(page, buildSeed({ demo: true, activeProjectFile: P.dcsp, ...seedOpts }))
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).waitFor()
}

/** Open Settings in a project window (its Project tab leads) via the header link. */
async function openProjectSettings(page: Page, seedOpts: SeedOptions = {}) {
  await openProject(page, seedOpts)
  await page.getByRole('link', { name: 'Settings' }).click()
  await page.getByRole('tab', { name: 'Project' }).waitFor()
}

/** The `.dcsp`-manifest toggle row (Settings → Project) carrying a given label. */
function projectRow(page: Page, label: string): Locator {
  return page.locator('div.border-t', { hasText: label })
}

test('settings-dth-release', async ({ page }) => {
  await prime(page, buildSeed())
  await page.goto('/')
  await page.getByRole('heading', { name: 'DTH Character Studio' }).waitFor()
  await page.getByRole('link', { name: 'Settings' }).click()
  await shoot(page, join(OUT, 'settings-dth-release.png'), card(page, 'Setup DTH Release'))
})

test('home-new-project', async ({ page }) => {
  // First-run Home (no recents) + a seeded folder pick, so the create form fills
  // in with a chosen folder and its auto-derived name instead of staying empty.
  await prime(page, buildSeed({ emptyRecents: true, dialogPath: P.project }))
  await page.goto('/')
  await page.getByRole('heading', { name: 'DTH Character Studio' }).waitFor()
  await page.getByRole('button', { name: 'New project' }).first().click()
  await page.getByRole('button', { name: /Choose folder/ }).click()
  // The picked folder + auto-filled name now show — wait for the Create button.
  await page.getByRole('button', { name: 'Create' }).waitFor()
  await shoot(page, join(OUT, 'home-new-project.png'), page.getByRole('dialog'))
})

test('project-open-window', async ({ page }) => {
  // The just-created project, opened in its own window: no characters yet.
  await prime(page, buildSeed({ activeProjectFile: P.dcsp, emptyProject: true }))
  await page.goto('/')
  await page.getByText('No characters yet').waitFor()
  await shoot(page, join(OUT, 'project-open-window.png'))
})

/** Exception to the 16:9 cap: shoot from the top of the page DOWN THROUGH
 *  `endFeature`, so a feature below the fold (e.g. the linked Daz scene card)
 *  isn't cut off. Grows the viewport first so everything renders in one frame. */
async function shootTopThrough(page: Page, path: string, endFeature: Locator) {
  await page.mouse.move(0, 0) // park the cursor off any control so no hover state is caught
  await page.setViewportSize({ width: VW, height: 1500 })
  await settle(page)
  // Selecting a scene card (openCharacterOnOutfitScene) scrolls the page down to
  // click it; anchor back at the top so the from-top clip stays in-bounds.
  await page.evaluate(() => window.scrollTo(0, 0))
  const bottom = await endFeature.evaluate((el) => Math.ceil(el.getBoundingClientRect().bottom))
  await page.screenshot({
    path,
    clip: { x: 0, y: 0, width: VW, height: bottom + 24 },
  })
}

test('character-settings', async ({ page }) => {
  await openCharacter(page)
  // The top of the character page ("Character settings"): Genesis/Gender + the
  // Genesis-9-specific box, the primary Daz scene card, the Hair-items toggle +
  // selected item, and the linked Houdini project. Taller than 16:9 (an exception).
  await shootTopThrough(
    page,
    join(OUT, 'character-settings.png'),
    page.getByRole('button', { name: /Add project/ }),
  )
})

test('character-header', async ({ page }) => {
  await openCharacter(page)
  await shootTopThrough(page, join(OUT, 'character-header.png'), page.getByRole('tab', { name: 'Character' }))
})

test('character-rom-sections', async ({ page }) => {
  await openCharacter(page)
  // Extra offset so the full ROM timeline bar (+ its legend) clears the collapsed
  // header instead of being clipped at the top.
  await shoot(page, join(OUT, 'character-rom-sections.png'), card(page, 'ROM'), {
    headerOffset: 220,
  })
})

test('character-export-directory', async ({ page }) => {
  await openCharacter(page)
  // This card sits near the top of the form, too high to scroll clear of the
  // sticky header — so drop the header for this one shot.
  await shoot(page, join(OUT, 'character-export-directory.png'), card(page, 'Export directory'), {
    hideHeader: true,
  })
})

test('character-advanced-options', async ({ page }) => {
  await openCharacter(page)
  await page.locator('summary', { hasText: 'Advanced options' }).click()
  await shoot(
    page,
    join(OUT, 'character-advanced-options.png'),
    page.locator('details').filter({ hasText: 'Advanced options' }),
  )
})

test('jcm-modify-grid', async ({ page }) => {
  await openCharacter(page)
  // Expand the JCM ROM section, then its "Modify JCM frames" grid (the fixture
  // seeds two real thigh-bone rules driving glute morphs).
  await page.getByRole('button', { name: /Joint Corrective/ }).click()
  await page.getByText('Modify JCM frames').click()
  const grid = page
    .getByText('Modify JCM frames')
    .locator('xpath=ancestor::div[contains(@class,"rounded-md")][1]')
  // The character page pins a section title under its header, so land the grid
  // lower than the default so its own "Modify JCM frames" label stays visible.
  await shoot(page, join(OUT, 'jcm-modify-grid.png'), grid, { headerOffset: 210 })
})

test('character-bone-scale-toggle', async ({ page }) => {
  await openCharacter(page)
  // Expand the FBM section (a big custom morph list) — its pose table carries the
  // per-row "Bone scale" column (the reference-skeleton FBX marker).
  await page.getByRole('button', { name: /FBM/ }).click()
  const boxes = page.getByTitle(
    'This morph scales bones — export a reference-skeleton FBX for it',
  )
  await boxes.first().waitFor()
  // Tick the 2nd pose's Bone scale box, then park the cursor so the column's hover
  // tooltip closes before the shot.
  await boxes.nth(1).check()
  await page.mouse.move(0, 0)
  await settle(page)
  await page.setViewportSize({ width: VW, height: 900 })
  // Un-stick the page chrome so a short crop of the top rows has no pinned overlap
  // (the character page stacks a header + section title + column headers, all
  // sticky), then bring the pose table's column headers to the top.
  await page.evaluate(() => {
    const h = document.querySelector('header.sticky')
    if (h) (h as HTMLElement).style.display = 'none'
    document.querySelectorAll('.sticky').forEach((el) => {
      ;(el as HTMLElement).style.position = 'static'
    })
  })
  const thead = page.locator('table').first().locator('thead')
  await thead.evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await settle(page)
  const top = await thead.evaluate((el) => Math.floor(el.getBoundingClientRect().top))
  const theadH = await thead.evaluate((el) => el.getBoundingClientRect().height)
  const rowH = await boxes
    .nth(0)
    .locator('xpath=ancestor::tr[1]')
    .evaluate((el) => el.getBoundingClientRect().height)
  // Header + exactly 3 pose rows (nth(2).bottom mis-measures with the un-stuck table).
  const y = Math.max(0, top - 8)
  const height = Math.ceil(theadH + 3 * rowH + 8)
  await page.screenshot({
    path: join(OUT, 'character-bone-scale-toggle.png'),
    clip: { x: 0, y, width: VW, height },
  })
})

test('gen-art-direction', async ({ page }) => {
  await openCharacter(page)
  // Expand the GEN section (preset Golden Palace), then its VaginaOpen art-direction
  // frame — the fixture seeds one morph on it, the rest read "preset default".
  await page.getByRole('button', { name: /Genitalia/ }).click()
  await page.getByText('VaginaOpen').click()
  const gen = page
    .getByRole('button', { name: /Genitalia/ })
    .locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]')
  await shoot(page, join(OUT, 'gen-art-direction.png'), gen, { headerOffset: 210 })
})

test('combine-morphs', async ({ page }) => {
  await openCharacter(page)
  await page.getByRole('button', { name: /FBM/ }).click()
  // Two real multi-morph poses from the fixture: SLGlutesSS (4 morphs) and
  // SLGlutesHipBendSpandex (2) — expand both to show the combined-morph editor.
  // Also expand the last single-morph row (InvictaWaistGarterBelt — the one right
  // above the combined examples) so the shot shows all three cases back to back:
  // an expanded single morph, then the 4- and 2-morph combined poses.
  await page.getByText('morphs', { exact: true }).last().click()
  await page.getByText('4 morphs', { exact: true }).click()
  await page.getByText('2 morphs', { exact: true }).click()
  await page.mouse.move(0, 0)
  await settle(page)
  await page.setViewportSize({ width: VW, height: 1000 })
  // Scroll the expanded single-morph row just below the pinned FBM section title +
  // column headers, so all three expanded examples sit under them (the real
  // scrolled view — poses above are hidden behind the pinned headers).
  const firstRow = page
    .getByText('morphs', { exact: true })
    .last()
    .locator('xpath=ancestor::tr[1]')
  await firstRow.evaluate((el) => {
    ;(el as HTMLElement).style.scrollMarginTop = '250px'
    el.scrollIntoView({ block: 'start' })
  })
  await settle(page)
  // Capture from the pinned section title (context) down through the 2nd example —
  // dropping the character page header above it (start the clip at the title).
  const title = page
    .getByRole('button', { name: /FBM/ })
    .locator('xpath=ancestor::div[contains(@class,"sticky")][1]')
  const top = await title.evaluate((el) => Math.floor(el.getBoundingClientRect().top))
  const bottom = await page
    .getByRole('button', { name: 'Add morph', exact: true })
    .last()
    .evaluate((el) => Math.ceil(el.getBoundingClientRect().bottom))
  const y = Math.max(0, top)
  await page.screenshot({
    path: join(OUT, 'combine-morphs.png'),
    clip: { x: 0, y, width: VW, height: Math.min(bottom - y + 24, 1000 - y) },
  })
})

/** Open the demo character with the second (outfit) scene linked and SELECT it —
 *  the state the multi-scene docs describe (per-scene hair, header tag, override). */
async function openCharacterOnOutfitScene(page: Page) {
  await openCharacter(page, { extraScene: true })
  await page.getByText('KiraSummertide_G9_GP', { exact: true }).first().click()
}

test('character-daz-scenes', async ({ page }) => {
  await openCharacterOnOutfitScene(page)
  // The Daz scenes block: both cards (outfit selected) + its per-scene hair
  // list. The hair picker (an unnamed combobox) is the page's last combobox.
  await shootStrip(
    page,
    join(OUT, 'character-daz-scenes.png'),
    page.getByText('Daz scenes', { exact: true }),
    page.getByRole('combobox').last(),
  )
})

test('character-scene-tag', async ({ page }) => {
  await openCharacterOnOutfitScene(page)
  // The header with the selected scene tagged next to the character name.
  await shootTopThrough(
    page,
    join(OUT, 'character-scene-tag.png'),
    page.getByRole('tab', { name: 'Character' }),
  )
})

test('rom-override-toggle', async ({ page }) => {
  await openCharacterOnOutfitScene(page)
  await page.getByRole('switch', { name: /Override ROM frames/ }).click()
  // The ROM header row (Override armed + on) down through the timeline and the
  // first (now-locked) section — the "Scene override active" banner is gone.
  await shootStrip(
    page,
    join(OUT, 'rom-override-toggle.png'),
    page.getByRole('heading', { name: /^ROM/ }).locator('xpath=..'),
    page.getByText('Retargeting', { exact: true }),
  )
})

test('rom-override-grid', async ({ page }) => {
  await openCharacterOnOutfitScene(page)
  await page.getByRole('switch', { name: /Override ROM frames/ }).click()
  await page.getByRole('button', { name: /FBM/ }).click()
  // Override the SECOND row, so the shot shows a replaced (full-strength) row
  // between untouched (dimmed, read-only) base rows.
  await page.getByRole('checkbox', { name: /Override this frame/ }).nth(1).check()
  await page.mouse.move(0, 0)
  await settle(page)
  await page.setViewportSize({ width: VW, height: 900 })
  // Same un-stick + slice approach as the bone-scale shot: column headers + the
  // first pose rows, without the page's stacked sticky chrome overlapping.
  await page.evaluate(() => {
    const h = document.querySelector('header.sticky')
    if (h) (h as HTMLElement).style.display = 'none'
    document.querySelectorAll('.sticky').forEach((el) => {
      ;(el as HTMLElement).style.position = 'static'
    })
  })
  const thead = page.locator('table').first().locator('thead')
  await thead.evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await settle(page)
  const top = await thead.evaluate((el) => Math.floor(el.getBoundingClientRect().top))
  const theadH = await thead.evaluate((el) => el.getBoundingClientRect().height)
  const rowH = await page
    .getByRole('checkbox', { name: /Override this frame/ })
    .first()
    .locator('xpath=ancestor::tr[1]')
    .evaluate((el) => el.getBoundingClientRect().height)
  const y = Math.max(0, top - 8)
  const height = Math.ceil(theadH + 4 * rowH + 8)
  await page.screenshot({
    path: join(OUT, 'rom-override-grid.png'),
    clip: { x: 0, y, width: VW, height },
  })
})

test('products-tab', async ({ page }) => {
  // Daz Products on + a seeded per-scene scan CSV → the character page splits into
  // Character / Products, and the Products tab renders the matched-products table.
  await openCharacter(page, {
    dazProductsEnabled: true,
    dimManifestsFolder: DIM_FOLDER,
    productScan: true,
  })
  await page.getByRole('tab', { name: 'Products' }).click()
  await page.getByRole('heading', { name: 'Matched products' }).waitFor()
  await shoot(page, join(OUT, 'products-tab.png'), card(page, 'Matched products'))
})

test('settings-attachments', async ({ page }) => {
  await openProjectSettings(page, { assetsEnabled: true })
  await shootStrip(page, join(OUT, 'settings-attachments.png'), projectRow(page, 'Enable attachments'))
})

test('settings-daz-products', async ({ page }) => {
  await openProjectSettings(page, { dazProductsEnabled: true, dimManifestsFolder: DIM_FOLDER })
  // Through the DIM field below the toggle — the whole product-scanning config.
  await shootStrip(
    page,
    join(OUT, 'settings-daz-products.png'),
    projectRow(page, 'Enable Daz Products'),
    page.getByRole('button', { name: /Detect installed location/ }),
  )
})

test('settings-dim-manifests', async ({ page }) => {
  await openProjectSettings(page, { dazProductsEnabled: true, dimManifestsFolder: DIM_FOLDER })
  const dim = page.getByRole('button', { name: /Detect installed location/ }).locator('xpath=..')
  await shootStrip(page, join(OUT, 'settings-dim-manifests.png'), dim)
})

test('attachment-add-panel', async ({ page }) => {
  await openProject(page, { assetsEnabled: true })
  await page.getByRole('button', { name: 'Add', exact: true }).first().click()
  // 'Attachment' (panel tab) is a substring of 'Attachments' (list tab) — exact.
  await page.getByRole('tab', { name: 'Attachment', exact: true }).click()
  await shoot(page, join(OUT, 'attachment-add-panel.png'), page.getByRole('dialog'))
})

test('project-unreal-footer', async ({ page }) => {
  await openProject(page, { unrealProjects: [UPROJECT] })
  // The linked-Unreal footer bar docked at the bottom of the viewport.
  const bar = page.getByText('Unreal projects', { exact: true }).locator('xpath=ancestor::div[1]')
  await shootStrip(page, join(OUT, 'project-unreal-footer.png'), bar)
})

test('character-create-panel', async ({ page }) => {
  // The picker returns the demo scene, so choosing it fills the create form
  // (scene preview, name, Genesis/Gender, ROM prefill) instead of staying empty.
  await openProject(page, { dialogPath: P.scene })
  await page.getByRole('button', { name: 'Add', exact: true }).first().click()
  await page.getByRole('button', { name: /Choose Daz scene/ }).click()
  await page.getByText('Character name').waitFor()
  await shoot(page, join(OUT, 'character-create-panel.png'), page.getByRole('dialog'))
})

/**
 * A tight detail crop around one element (+pad) — for the small `detail-*.png`
 * shots the guide shows at natural size (guide.css exempts them from the
 * column stretch). Deliberately does NOT park the mouse: hover states are
 * often the point of a detail shot.
 */
async function shootTight(page: Page, path: string, el: Locator) {
  // Room for the hover badge that overlaps the top-right corner; tight on the
  // other sides so neighbouring UI stays out of the crop.
  const pad = { top: 14, right: 14, bottom: 6, left: 6 }
  const b = (await el.boundingBox())!
  await page.screenshot({
    path,
    clip: {
      x: b.x - pad.left,
      y: b.y - pad.top,
      width: b.width + pad.left + pad.right,
      height: b.height + pad.top + pad.bottom,
    },
  })
}

// (The plain hover/copy interaction is a WebP clip now — guide.clips.ts' path-chip-copy.)

test('detail-path-chip-alt', async ({ page }) => {
  await openProject(page)
  // Alt held: the hover badge flips to the folder icon — previewing that
  // Alt+click opens the location in Explorer instead of copying.
  const chip = page.getByRole('button', { name: 'Copy path' }).first()
  await settle(page)
  await page.keyboard.down('Alt')
  await chip.hover()
  await page.waitForTimeout(250)
  await shootTight(page, join(OUT, 'detail-path-chip-alt.png'), chip)
  await page.keyboard.up('Alt')
})

test('settings-exporter-plugin', async ({ page }) => {
  await prime(page, buildSeed())
  await page.goto('/')
  await page.getByRole('heading', { name: 'DTH Character Studio' }).waitFor()
  await page.getByRole('link', { name: 'Settings' }).click()
  await shoot(
    page,
    join(OUT, 'settings-exporter-plugin.png'),
    card(page, 'Setup DTH Exporter Plugin Release'),
  )
})

test('detail-morph-autocomplete', async ({ page }) => {
  await openCharacter(page)
  await page.getByRole('button', { name: /FBM/ }).click()
  await settle(page)
  // Focus a Morph-name cell (found by its fixture value) and retype a prefix —
  // the seeded morphs_G9.json index answers with suggestions.
  const handle = await page.evaluateHandle(() => {
    const input = [...document.querySelectorAll('input')].find(
      (i) => i.value === 'SS_body_bs_Glute UpDown',
    )!
    input.scrollIntoView({ block: 'center' })
    return input
  })
  const input = handle.asElement()
  await input.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('Glute', { delay: 30 })
  const dropdown = page.locator('div.top-full.z-30')
  await dropdown.waitFor()
  await page.waitForTimeout(250)
  const a = (await input.boundingBox())!
  const b = (await dropdown.boundingBox())!
  const pad = 14
  const x = Math.min(a.x, b.x) - pad
  const y = Math.min(a.y, b.y) - pad
  await page.screenshot({
    path: join(OUT, 'detail-morph-autocomplete.png'),
    clip: {
      x,
      y,
      width: Math.max(a.x + a.width, b.x + b.width) - x + pad,
      height: Math.max(a.y + a.height, b.y + b.height) - y + pad,
    },
  })
})

// ── Coverage guard ───────────────────────────────────────────────────────────
// The one asserting test: keeps docs/guide and this suite in lockstep, both
// directions. Fails when a guide page references a PNG nothing generates
// (typo/rename/deleted test) or a PNG sits in screenshots/ that no guide page
// references anymore (orphan — delete its test + file, or reference it).
// Runs LAST (single worker, file order), so a full `pnpm screenshots` run
// verifies its own completeness.
test('coverage: guide references and generated screenshots match 1:1', async () => {
  const guideDir = join(OUT, '..')
  const referenced = new Set<string>()
  const referencedClips = new Set<string>()
  for (const md of (await readdir(guideDir)).filter((f) => f.endsWith('.md'))) {
    const text = await readFile(join(guideDir, md), 'utf8')
    for (const m of text.matchAll(/screenshots\/([\w.-]+\.png)/g)) referenced.add(m[1])
    for (const m of text.matchAll(/clips\/([\w.-]+\.webp)/g)) referencedClips.add(m[1])
  }
  const onDisk = (await readdir(OUT)).filter((f) => f.endsWith('.png'))
  const missing = [...referenced].filter((f) => !onDisk.includes(f)).sort()
  const orphans = onDisk.filter((f) => !referenced.has(f)).sort()
  expect(missing, `referenced in docs/guide but missing from screenshots/: ${missing.join(', ')}`).toEqual([])
  expect(orphans, `in screenshots/ but referenced by no guide page: ${orphans.join(', ')}`).toEqual([])
  // Same lockstep for the interaction clips (guide.clips.ts → docs/guide/clips).
  const clipsOnDisk = await readdir(join(guideDir, 'clips')).catch(() => [] as string[])
  const missingClips = [...referencedClips].filter((f) => !clipsOnDisk.includes(f)).sort()
  const orphanClips = clipsOnDisk.filter((f) => f.endsWith('.webp') && !referencedClips.has(f)).sort()
  expect(missingClips, `referenced in docs/guide but missing from clips/: ${missingClips.join(', ')}`).toEqual([])
  expect(orphanClips, `in clips/ but referenced by no guide page: ${orphanClips.join(', ')}`).toEqual([])
})
