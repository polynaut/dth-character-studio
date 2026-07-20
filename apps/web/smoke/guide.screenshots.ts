import { test, type Locator, type Page } from '@playwright/test'

import { buildSeed, DIM_FOLDER, P, UPROJECT, type SeedOptions } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

// Documentation screenshots for docs/guide/*. Reuses the smoke Tauri fake +
// fixture world (one project "Smoke Project", one character "Kira"). Each
// `test` navigates to a screen/state and writes a PNG; nothing is asserted.
// Run: pnpm --filter @dth/web screenshots
//
// To ADD a screenshot: navigate/click to the state, then call
// `shoot(page, join(OUT, '<name>.png'), <feature?>)`. Pass a `feature` locator
// when the doc is about one region so the shot trims to it; omit it to grab the
// realistic 16:9 viewport from the top. Keep the width constant (never override
// it) so every image lines up in the guide.

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Absolute output dir (repo/docs/guide/screenshots) — a relative path resolves
// against Playwright's cwd, which isn't the repo root.
const OUT = join(dirname(fileURLToPath(import.meta.url)), '../../../docs/guide/screenshots')

/** App width (px) — kept constant across every shot so the guide lines up. */
const VW = 1280
/** 16:9 of the width — a realistic widescreen viewport; the height cap. */
const MAX_H = 720

/** Prime the page BEFORE the app bundle runs: set the flag that gates the dev
 *  TanStack devtools trigger off (so it stays out of the shots — a DOM/CSS hack
 *  loses to the widget re-mounting during the capture), then install the
 *  in-memory Tauri fake with the fixture world. */
async function prime(page: Page, seed: ReturnType<typeof buildSeed>) {
  await page.addInitScript(() => {
    ;(window as unknown as { __dthHideDevtools?: boolean }).__dthHideDevtools = true
  })
  await page.addInitScript(installTauriMock, seed)
}

/** Let the route settle (fonts/images/layout) before measuring or shooting. */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(400)
}

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

async function shoot(page: Page, path: string, feature?: Locator, opts: { hideHeader?: boolean } = {}) {
  await page.mouse.move(0, 0) // park the cursor off any control so no hover state is caught
  await settle(page)
  if (!feature) {
    await page.screenshot({ path })
    return
  }
  // Room for the header + a capped feature; the pages are taller than this so
  // they still scroll (needed to reach the feature).
  const VH = MAX_H + HEADER
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
  }, opts.hideHeader ? topGap : HEADER)
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
  // Drop the sticky header (if the page has one) so a mid-page strip can't sit
  // under it. A one-shot querySelector — NOT a locator, whose auto-wait would
  // hang for the full timeout on pages without one (the project overview).
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

test('settings-exporter-plugin', async ({ page }) => {
  await prime(page, buildSeed())
  await page.goto('/')
  await page.getByRole('heading', { name: 'DTH Character Studio' }).waitFor()
  await page.getByRole('link', { name: 'Settings' }).click()
  await shoot(
    page,
    join(OUT, 'settings-exporter-plugin.png'),
    card(page, 'Setup DTH Exporter Plugin'),
  )
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
  const bottom = await endFeature.evaluate((el) => Math.ceil(el.getBoundingClientRect().bottom))
  await page.screenshot({
    path,
    clip: { x: 0, y: 0, width: VW, height: bottom + 24 },
  })
}

test('character-page', async ({ page }) => {
  await openCharacter(page)
  // Taller than 16:9 (an exception) so the linked Daz scene card at the bottom
  // of the form isn't cut off — down through the Hair-items toggle below it.
  await shootTopThrough(
    page,
    join(OUT, 'character-page.png'),
    page.getByText('Hair items live in the Daz scenes'),
  )
})

test('character-header', async ({ page }) => {
  await openCharacter(page)
  await shootTopThrough(page, join(OUT, 'character-header.png'), page.getByRole('tab', { name: 'Character' }))
})

test('character-rom-sections', async ({ page }) => {
  await openCharacter(page)
  await shoot(page, join(OUT, 'character-rom-sections.png'), card(page, 'ROM'))
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
  await shoot(page, join(OUT, 'jcm-modify-grid.png'), grid)
})

test('character-bone-scale-toggle', async ({ page }) => {
  await openCharacter(page)
  // Expand the FBM section (a big custom morph list) — its pose table carries the
  // per-row "Bone scale" column (the reference-skeleton FBX marker).
  await page.getByRole('button', { name: /FBM/ }).click()
  await page
    .getByTitle('This morph scales bones — export a reference-skeleton FBX for it')
    .first()
    .waitFor()
  await shoot(page, join(OUT, 'character-bone-scale-toggle.png'), page.locator('table').first())
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
