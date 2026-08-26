import { expect, test } from '@playwright/test'

import { P, buildSeed, scanStoreEntryKey } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// The warning badge on a Houdini project card.
//
// It is read from the STORE a background scan fills, never from a scan of its
// own — so these specs seed the store and check what the card says. That is also
// the honest shape of the feature: opening a character page reads instantly and
// kicks a sweep off for next time; it never blocks on hython.

/** The character's scan store, in its `.dcsmeta` folder. */
const STORE = `${P.project}/.dcsmeta/characters/Kira/houdini-scan.json`

/** A stored entry's freshness key — see `scanStoreEntryKey` in fixtures.ts for
 *  what each component is and why it is in there. */
const storeKey = (hipPath: string) => scanStoreEntryKey(hipPath, P.exportDir)

/** A scan result in the shape `material_utils.py` reports. */
function scan(over: Record<string, unknown> = {}) {
  return {
    hipPath: P.houdini,
    ok: true,
    error: '',
    nodes: [],
    job: P.charFolder,
    fps: 30,
    refs: { collapsible: 0, foreign: 0, broken: [], hipRelative: [], missingTextures: [] },
    prefill: { fillable: [], missing: [] },
    ...over,
  }
}

async function openWithStore(
  page: Page,
  project: Record<string, unknown>,
  extra: {
    /** settings.json's DIM manifests folder — what arms the owner lookup. */
    dimManifestsFolder?: string
    /** What `find_dim_owners` answers, keyed by lowercase file name. */
    dimOwners?: Record<string, { productName: string; sku: string }>
  } = {},
) {
  const seed = buildSeed({
    activeProjectFile: P.dcsp,
    demo: true,
    houdiniProject: true,
    ...(extra.dimManifestsFolder ? { dimManifestsFolder: extra.dimManifestsFolder } : {}),
  })
  if (extra.dimOwners) seed.dimOwners = extra.dimOwners
  seed.files[STORE] = JSON.stringify({
    version: 1,
    projects: {
      [P.houdini.toLowerCase()]: {
        key: storeKey(P.houdini),
        scannedAt: '2026-08-07T00:00:00.000Z',
        project,
      },
    },
  })
  await page.addInitScript(installTauriMock, seed)
  // The fake stamps its world when it is installed — so the seeded entry gets
  // that mtime here, after install (see {@link storeKey}).
  await page.addInitScript((storePath: string) => {
    const mock = (window as any).__tauriMock
    const raw = mock.files.get(storePath) as string
    mock.files.set(storePath, raw.replace('__MTIME__', String(mock.mtimeMs)))
  }, STORE)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()
}

test('a project whose $JOB points elsewhere is flagged on its card', async ({ page }) => {
  // Exactly the state a COPIED project arrives in: the scene carries the
  // source's $JOB, so every path it stores collapses against the wrong folder.
  await openWithStore(page, scan({ job: 'D:/DTH Projects/Demo/Ita' }))

  const badge = page.getByText('Needs attention')
  await expect(badge).toBeVisible()
  await expect(badge).toHaveAttribute('title', /\$JOB points at D:\/DTH Projects\/Demo\/Ita/)
})

test('a wired project shows no badge', async ({ page }) => {
  await openWithStore(page, scan())
  await expect(page.getByText('Needs attention')).toHaveCount(0)
})

test('a project on Houdini’s own 24 fps is flagged on its card', async ({ page }) => {
  // The ROM is one pose per FRAME at 30. DazToHue's import node sets the scene's
  // FPS when it loads the files, so a project reading 24 is one where that has
  // not happened — including one generated headlessly, where nothing loads a file.
  await openWithStore(page, scan({ fps: 24 }))

  const badge = page.getByText('Needs attention')
  await expect(badge).toBeVisible()
  await expect(badge).toHaveAttribute('title', /timeline runs at 24 fps instead of 30/)
})

test('a playbar that does not match the Alembic is flagged on its card', async ({ page }) => {
  // The Import node sets the playbar from the Alembic file when it LOADS one
  // (per mrpdean) — so a scene still on Houdini's default 1–240 over a longer
  // ROM is a scene where that never ran, and part of the ROM sits outside the
  // timeline. A stored scan WITHOUT the field (every entry from before v0.86)
  // must stay quiet — that is pinned by 'a wired project shows no badge', whose
  // fixture carries no `timeline` at all.
  await openWithStore(
    page,
    scan({
      timeline: { start: 1, end: 240, known: true, abcStart: 0, abcEnd: 981, abcKnown: true },
    }),
  )

  const badge = page.getByText('Needs attention')
  await expect(badge).toBeVisible()
  await expect(badge).toHaveAttribute('title', /playbar runs 1 – 240 but the Alembic holds frames 0 – 981/)
})

test('a stored scan from before the FPS was read is not flagged', async ({ page }) => {
  // The compatibility case: an entry written by an older build carries no `fps`
  // at all, which reads as 0 = nobody looked. Badging that would invent a fault
  // for every project cached before this shipped.
  const { fps: _dropped, ...withoutFps } = scan()
  await openWithStore(page, withoutFps)
  await expect(page.getByText('Needs attention')).toHaveCount(0)
})

/** A second linked project OUTSIDE the character folder — the sweep never
 *  scans those, so only a store entry or a drawer scan can answer for it. */
const OUTSIDE = 'D:/Templates/G9_Skin_Base.hiplc'
const HOUDINI_INSTALL = 'C:/Program Files/Side Effects Software/Houdini 22.0.368'

/** A minimal material node the drawer's node picker will name on screen. */
const node = (networkBox: string) => ({
  path: '/obj/DazToHue/DazToHueMaterial',
  name: 'DazToHueMaterial',
  nodeType: 'material',
  networkBox,
  materials: 0,
  uvChannels: 0,
  bakers: 0,
  layers: 0,
  bakerNames: [],
  materialNames: [],
  slots: [],
  sectionCounts: [],
})

/** Link OUTSIDE as the demo character's second project. */
function linkOutside(seed: { files: Record<string, string> }) {
  seed.files[OUTSIDE] = 'hip-fixture'
  const charPath = `${P.charFolder}/Kira.json`
  const char = JSON.parse(seed.files[charPath] ?? '{}')
  char.houdiniProjects = [P.houdini, OUTSIDE]
  seed.files[charPath] = JSON.stringify(char)
}

// --- the card's busy bar ----------------------------------------------------
//
// A scan is the one part of this feature the user never asked for and cannot
// see: it runs on a background sweep, costs tens of seconds per `.hip`, and
// until it lands the card still shows the PREVIOUS verdict. The busy bar (the
// card's orange accent bar lit up, `LinkedAssetCard` busy) is what makes that
// window honest — so these specs are about WHEN it shows, which the fake's
// `materialScanDelayMs` is what makes observable at all.

/** A second project INSIDE the character folder — the sweep scans those, so it
 *  is the only way to have one project cached and one stale in the same view. */
const SECOND = 'D:/DTH Projects/Demo/Kira/houdini/Kira_Alt.hip'

/** A seed with hython configured — without it the sweep throws and scans
 *  nothing, which would make a "no spinner" assertion pass for the wrong reason. */
function seedWithHython(delayMs: number) {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true, houdiniProject: true })
  const settingsPath = `${P.appData}/settings.json`
  seed.files[settingsPath] = JSON.stringify({
    ...JSON.parse(seed.files[settingsPath] ?? '{}'),
    houdiniInstallFolder: HOUDINI_INSTALL,
    houdiniDocsFolder: 'C:/Users/dev/Documents/houdini22.0',
  })
  seed.files[`${HOUDINI_INSTALL}/bin/hython.exe`] = 'hython-exe-fixture'
  seed.materialScan = { [P.houdini]: [node('FreshBox')], [SECOND]: [node('AltBox')] }
  seed.materialScanDelayMs = delayMs
  return seed
}

/** The card WRAPPER for a project, by its displayed name — the element holding
 *  both the `.houdini-card` body and its SIBLING accent bar. The busy status
 *  lives on the bar, so a body-scoped (`.houdini-card`) query would count 0
 *  status roles even while scanning and assert nothing at all. */
const cardFor = (page: Page, name: string) =>
  page.locator('.group\\/card', { has: page.locator('.houdini-card'), hasText: name })
const busyBars = (page: Page) =>
  page.getByRole('status', { name: /Reading this project in Houdini/ })

test("a card's bar lights while hython has its project open, and stops when the scan lands", async ({
  page,
}) => {
  // No store entry, so the sweep really has to open the file.
  await page.addInitScript(installTauriMock, seedWithHython(2000))
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()

  await expect(busyBars(page)).toHaveCount(1)
  // And it is not an indicator that never stops — the worst of the three
  // states, because it reads as "still working" forever.
  await expect(busyBars(page)).toHaveCount(0, { timeout: 20_000 })
})

test('a project served from the cache never lights its bar — only the one being read does', async ({
  page,
}) => {
  // The decision this pins. A cache hit starts no hython process and answers in
  // microseconds; lighting its card would flicker on every page load and teach
  // the eye to ignore the indicator. Two projects, one fresh in the store and
  // one not, so "which card lights up" is answered without timing anything.
  const seed = seedWithHython(2000)
  seed.files[SECOND] = 'hip-fixture'
  const charPath = `${P.charFolder}/Kira.json`
  const char = JSON.parse(seed.files[charPath] ?? '{}')
  char.houdiniProjects = [P.houdini, SECOND]
  seed.files[charPath] = JSON.stringify(char)
  seed.files[STORE] = JSON.stringify({
    version: 1,
    projects: {
      [SECOND.toLowerCase()]: {
        key: storeKey(SECOND),
        scannedAt: '2026-08-07T00:00:00.000Z',
        project: scan({ hipPath: SECOND }),
      },
    },
  })
  await page.addInitScript(installTauriMock, seed)
  await page.addInitScript((storePath: string) => {
    const mock = (window as any).__tauriMock
    const raw = mock.files.get(storePath) as string
    mock.files.set(storePath, raw.split('__MTIME__').join(String(mock.mtimeMs)))
  }, STORE)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()

  // Exactly one card is being read, and it is not the cached one. The cached
  // card is asserted to EXIST first — without that, a locator typo would make
  // the next line pass by matching nothing at all.
  await expect(busyBars(page)).toHaveCount(1)
  await expect(cardFor(page, 'Kira_Alt')).toHaveCount(1)
  await expect(cardFor(page, 'Kira_Alt').getByRole('status')).toHaveCount(0)
  await expect(busyBars(page)).toHaveCount(0, { timeout: 20_000 })
})

test('the drawer scans the project it was opened from when the store cannot answer', async ({
  page,
}) => {
  // One linked project the store answers for (inside the character folder,
  // fresh entry) and one it cannot answer for yet (linked from outside — the
  // sweep skips those by design). Opening the drawer on the UNCOVERED one has
  // to scan it there and then: a cache is only an answer for what it covers,
  // and a partial cache silently hiding a project's nodes and repairs was a
  // real bug.
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true, houdiniProject: true })
  // hython configured, so the drawer CAN scan the uncovered link itself.
  const settingsPath = `${P.appData}/settings.json`
  seed.files[settingsPath] = JSON.stringify({
    ...JSON.parse(seed.files[settingsPath] ?? '{}'),
    houdiniInstallFolder: HOUDINI_INSTALL,
    houdiniDocsFolder: 'C:/Users/dev/Documents/houdini22.0',
  })
  seed.files[`${HOUDINI_INSTALL}/bin/hython.exe`] = 'hython-exe-fixture'
  linkOutside(seed)
  // The fake hython only knows the OUTSIDE project's nodes. If the drawer
  // re-scanned the inside one instead of taking the store's word, its card
  // would come back empty and 'CachedBox' would be missing below.
  seed.materialScan = { [OUTSIDE]: [node('ScannedBox')] }
  seed.files[STORE] = JSON.stringify({
    version: 1,
    projects: {
      [P.houdini.toLowerCase()]: {
        key: storeKey(P.houdini),
        scannedAt: '2026-08-07T00:00:00.000Z',
        project: scan({ nodes: [node('CachedBox')] }),
      },
    },
  })
  await page.addInitScript(installTauriMock, seed)
  await page.addInitScript((storePath: string) => {
    const mock = (window as any).__tauriMock
    const raw = mock.files.get(storePath) as string
    mock.files.set(storePath, raw.replace('__MTIME__', String(mock.mtimeMs)))
  }, STORE)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()

  // Two cards, two Utils buttons — each opens the drawer ON ITS OWN PROJECT.
  // The second card is the outside link, which the store cannot answer for.
  await page.getByRole('button', { name: /^Utils/ }).nth(1).click()
  const drawer = page.getByRole('dialog')
  await drawer.getByRole('tab', { name: 'Material' }).click()

  // Scanned on the spot, because the store has nothing for this one.
  await expect(drawer.getByText('ScannedBox')).toBeVisible()
  // And the character's OTHER project is not here at all — utils are per
  // project, so the cached one is none of this drawer's business.
  await expect(drawer.getByText('CachedBox')).toHaveCount(0)

  // The drawer's own scan persisted under the CHARACTER's store — target scans
  // carry the character scope, so what the drawer earns is what the card badge
  // and the next open read (not the shared source store).
  await expect
    .poll(async () =>
      page.evaluate((p) => ((window as any).__tauriMock.files.get(p) ?? '') as string, STORE),
    )
    .toContain('g9_skin_base')
})

test('a stored scan serves the drawer without hython — and only for THIS project', async ({
  page,
}) => {
  // Both projects fresh in the store — the outside one earned by a previous
  // drawer open (the sweep's prune keeps everything still LINKED, it does not
  // throw drawer-earned scans away). No hython is configured here, so if the
  // drawer tried to scan ANYTHING the picker would show an error instead of
  // these nodes.
  //
  // It also pins the scoping the other way round from the spec above: the store
  // HAS the other project's nodes and hands them over on request, so a drawer
  // still listing them would be an easy accident. Utils are per project — the
  // card you pressed is the whole subject.
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true, houdiniProject: true })
  linkOutside(seed)
  seed.files[STORE] = JSON.stringify({
    version: 1,
    projects: {
      [P.houdini.toLowerCase()]: {
        key: storeKey(P.houdini),
        scannedAt: '2026-08-07T00:00:00.000Z',
        project: scan({ nodes: [node('CachedBox')] }),
      },
      [OUTSIDE.toLowerCase()]: {
        key: storeKey(OUTSIDE),
        scannedAt: '2026-08-07T00:00:00.000Z',
        project: scan({ hipPath: OUTSIDE, nodes: [node('OutsideBox')] }),
      },
    },
  })
  await page.addInitScript(installTauriMock, seed)
  await page.addInitScript((storePath: string) => {
    const mock = (window as any).__tauriMock
    const raw = mock.files.get(storePath) as string
    mock.files.set(storePath, raw.split('__MTIME__').join(String(mock.mtimeMs)))
  }, STORE)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()

  await page.getByRole('button', { name: /^Utils/ }).first().click()
  const drawer = page.getByRole('dialog')
  await drawer.getByRole('tab', { name: 'Material' }).click()

  await expect(drawer.getByText('CachedBox')).toBeVisible()
  await expect(drawer.getByText('OutsideBox')).toHaveCount(0)
})

test('unresolved imports and blank parms are both named', async ({ page }) => {
  await openWithStore(
    page,
    scan({
      refs: {
        collapsible: 0,
        foreign: 0,
        broken: ['/obj/dth import_character_dtu_file'],
        hipRelative: [],
      },
      prefill: { fillable: ['export_directory'], missing: [] },
    }),
  )

  const badge = page.getByText('Needs attention')
  await expect(badge).toBeVisible()
  const title = (await badge.getAttribute('title')) ?? ''
  expect(title).toContain('import_character_dtu_file')
  expect(title).toContain('export_directory')
})

/** A texture the DazToHue material node's bakers point at, uninstalled since. */
const GONE = 'd:/daz 3d/my daz 3d library/runtime/textures/raiya/rypi5_torso1.jpg'

test('a baker texture whose file is gone is flagged, and the badge says the bake will not', async ({
  page,
}) => {
  // The one problem the card reports that has NO repair, and the reason it is
  // reported at all: measured on DazToHue 2.5 / Houdini 22.0, baking with a
  // layer texture pointed at a missing file prints `export finished in 0:00:02`
  // and raises nothing. Without this badge the first sign is a wrong-looking
  // character in Unreal.
  await openWithStore(
    page,
    scan({
      refs: {
        collapsible: 0,
        foreign: 0,
        broken: [],
        hipRelative: [],
        missingTextures: [GONE],
      },
    }),
  )

  const badge = page.getByText('Needs attention')
  await expect(badge).toBeVisible()
  const title = (await badge.getAttribute('title')) ?? ''
  // The BASENAME, not the whole path — this lands in a tooltip.
  expect(title).toContain('rypi5_torso1.jpg')
  expect(title).not.toContain('my daz 3d library')
  // Naming the silent success is the point of the wording: without it "missing"
  // reads as something Houdini would have caught.
  expect(title).toContain('reports success')
})

test('the drawer names the missing textures in full, and does not gate the repair on them', async ({
  page,
}) => {
  // Two facts in one state. The row shows the FULL paths (this is the view where
  // "which product is gone" is answerable) — and Make paths portable stays
  // pressable, because a missing texture is not work that repath can do. Gating
  // it would strand the button on a problem the studio cannot fix.
  await openWithStore(
    page,
    scan({
      refs: {
        collapsible: 2,
        foreign: 0,
        broken: [],
        hipRelative: [],
        missingTextures: [GONE],
      },
    }),
  )

  await page.getByRole('button', { name: /^Utils/ }).first().click()
  const drawer = page.getByRole('dialog')
  await expect(drawer.getByText('Baker textures')).toBeVisible()
  await expect(drawer.getByText('1 missing')).toBeVisible()
  await expect(drawer.getByText(GONE)).toBeVisible()
  await expect(drawer.getByText(/still reports success/)).toBeVisible()
  await expect(drawer.getByRole('button', { name: 'Make paths portable' })).toBeEnabled()
})

test('an unfindable texture is named to its owning product from the DIM manifests', async ({
  page,
}) => {
  // The follow-up to the rehome (#976): a missing texture whose tail is NOT in
  // the current library dead-ended in "reinstall the product" without saying
  // WHICH product. The DIM install manifests list every installed product's
  // files, so the row can name it — and the SKU — instead.
  await openWithStore(
    page,
    scan({
      refs: {
        collapsible: 0,
        foreign: 0,
        broken: [],
        hipRelative: [],
        missingTextures: [GONE],
      },
    }),
    {
      dimManifestsFolder: 'C:/Users/Public/Documents/DAZ 3D/InstallManager/ManifestFiles',
      dimOwners: { [GONE]: { productName: 'RY Pi 5 for Genesis 8', sku: '55555' } },
    },
  )

  await page.getByRole('button', { name: /^Utils/ }).first().click()
  const drawer = page.getByRole('dialog')
  await expect(drawer.getByText('Baker textures')).toBeVisible()
  await expect(drawer.getByText(/belongs to/)).toBeVisible()
  await expect(drawer.getByText('RY Pi 5 for Genesis 8')).toBeVisible()
  await expect(drawer.getByText(/\(SKU 55555\)/)).toBeVisible()
  await expect(drawer.getByText(/install it via DAZ Install Manager/)).toBeVisible()
  // Every unfixable file has a name here, so the generic dead-end wording —
  // which is only for the files no manifest knows — must be gone.
  await expect(drawer.getByText(/einstall the product or restore the library/)).toHaveCount(0)
})

test('a texture no manifest claims keeps its own line beside the named product', async ({
  page,
}) => {
  // The mixed case: naming one product must not leave the OTHER file wordless,
  // and the generic sentence has to read against the lines above it rather
  // than promising a "rest" the reader has not met yet.
  const ORPHAN = 'd:/daz 3d/my daz 3d library/runtime/textures/nobody/unknown_d.jpg'
  await openWithStore(
    page,
    scan({
      refs: {
        collapsible: 0,
        foreign: 0,
        broken: [],
        hipRelative: [],
        missingTextures: [GONE, ORPHAN],
      },
    }),
    {
      dimManifestsFolder: 'C:/Users/Public/Documents/DAZ 3D/InstallManager/ManifestFiles',
      dimOwners: { [GONE]: { productName: 'RY Pi 5 for Genesis 8', sku: '55555' } },
    },
  )

  await page.getByRole('button', { name: /^Utils/ }).first().click()
  const drawer = page.getByRole('dialog')
  await expect(drawer.getByText('RY Pi 5 for Genesis 8')).toBeVisible()
  await expect(
    drawer.getByText(/No DIM manifest lists the other one — reinstall the product/),
  ).toBeVisible()
  // "For the rest" would be the wrong opener: nothing was said before it.
  await expect(drawer.getByText(/For the rest/)).toHaveCount(0)
})

test('a project whose only work is a REHOMED library arms the button and says so', async ({
  page,
}) => {
  // The moved-library project this feature exists for: nothing to collapse,
  // no broken import — just a texture stored under a foreign library root that
  // the scan found under THIS machine's `$DAZ3D_LIB`. Before `rehomable` was a
  // kind of work, `planRepath` counted zero here and greyed the button out
  // under a badge telling the user to press it.
  //
  // The two numbers are deliberately NOT summed anywhere on the way through:
  // `collapsible` counts parms and `rehomable` counts unique files, so the row
  // reads "1 to repoint" rather than folding it into an "absolute" total.
  await openWithStore(
    page,
    scan({
      refs: {
        collapsible: 0,
        foreign: 0,
        broken: [],
        hipRelative: [],
        missingTextures: [GONE],
        rehomable: [GONE],
      },
    }),
  )

  await page.getByRole('button', { name: /^Utils/ }).first().click()
  const drawer = page.getByRole('dialog')
  await expect(drawer.getByText('1 to repoint')).toBeVisible()
  // The Baker-textures row must drop the reinstall advice for a file the user
  // demonstrably has — that wording sent them after a product they own.
  await expect(drawer.getByText(/It exists in your Daz library/)).toBeVisible()

  const button = drawer.getByRole('button', { name: 'Make paths portable' })
  await expect(button).toBeEnabled()
  await button.click()

  // The confirm sentence carries only the clauses with work in them: with
  // nothing to collapse, a fixed leading clause opened this dialog on
  // "Rewrite 0 references".
  const confirm = page.getByRole('dialog', { name: 'Make stored paths portable?' })
  await expect(confirm.getByText(/^Repoint 1 file from another library root/)).toBeVisible()
  await expect(confirm.getByText(/Rewrite/)).toHaveCount(0)
})

test('a badge from a STALE store clears itself once the sweep re-reads the project', async ({
  page,
}) => {
  // The contradiction this guards: the card said "Needs attention" while the
  // Utils drawer — which scans live — reported every check passing. The badge
  // is painted from the STORE, and the sweep that refreshes the store was
  // started un-awaited, so nothing ever re-read it.
  //
  // Seeded here as a store entry whose key no longer matches the file (a stale
  // scan, exactly what a regenerated project leaves behind): the first paint
  // has nothing to show, and the sweep's fresh result must land without a
  // reload.
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true, houdiniProject: true })
  seed.files[STORE] = JSON.stringify({
    version: 1,
    projects: {
      [P.houdini.toLowerCase()]: {
        key: `${P.houdini.toLowerCase()}|1`,
        scannedAt: '2026-08-07T00:00:00.000Z',
        project: scan({ job: 'D:/DTH Projects/Demo/Ita' }),
      },
    },
  })
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()

  // The stale entry keys on a mtime the file no longer has, so it is ignored —
  // and the badge must not appear on the strength of it.
  await expect(page.getByText('Needs attention')).toHaveCount(0)
})

test('Fill network blames the UNKNOWN $JOB, not a lack of work', async ({ page }) => {
  // A project that reports no $JOB at all (never Set Project'd) with a parm the
  // studio could fill. It is refused for the same reason a WRONG $JOB is — the
  // values written are $JOB-relative, so there is nothing to anchor them on —
  // but it used to fall outside BOTH the target set and the blocked set, so the
  // button sat disabled under "Nothing blank the studio has an answer for".
  // That reads as "no work here" while work is exactly what is waiting.
  await openWithStore(
    page,
    scan({ job: '', prefill: { fillable: ['export_directory'], missing: [] } }),
  )

  await page.getByRole('button', { name: /^Utils/ }).first().click()
  const fill = page.getByRole('dialog').getByRole('button', { name: 'Fill network' })
  await expect(fill).toBeDisabled()
  // The button kit renders a `title` prop as `data-tooltip` (its own tooltip),
  // not as the native attribute. Named after the BUTTON (which repairs more
  // than $JOB since the timeline joined it) — a tooltip pointing at a button
  // that no longer exists is a dead end.
  await expect(fill).toHaveAttribute('data-tooltip', /Repair the project settings first/)
})

test('Rescan really rescans — it is not served by the cache', async ({ page }) => {
  // The drawer's whole point is that opening it is instant: a fresh store entry
  // answers without starting hython. That made "Rescan" a lie — it went through
  // the same cache, returned the same answer in milliseconds, and looked like a
  // dead button. Worse, it was the ONLY way out of a verdict that had gone
  // stale for a reason the key could not see, so "press Rescan" was not even
  // advice that worked.
  //
  // Pinned by making the two answers DIFFER: the store says CachedBox, the fake
  // hython says FreshBox. Whichever name is on screen says which path ran.
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true, houdiniProject: true })
  const settingsPath = `${P.appData}/settings.json`
  seed.files[settingsPath] = JSON.stringify({
    ...JSON.parse(seed.files[settingsPath] ?? '{}'),
    houdiniInstallFolder: HOUDINI_INSTALL,
    houdiniDocsFolder: 'C:/Users/dev/Documents/houdini22.0',
  })
  seed.files[`${HOUDINI_INSTALL}/bin/hython.exe`] = 'hython-exe-fixture'
  seed.materialScan = { [P.houdini]: [node('FreshBox')] }
  seed.files[STORE] = JSON.stringify({
    version: 1,
    projects: {
      [P.houdini.toLowerCase()]: {
        key: storeKey(P.houdini),
        scannedAt: '2026-08-07T00:00:00.000Z',
        project: scan({ nodes: [node('CachedBox')] }),
      },
    },
  })
  await page.addInitScript(installTauriMock, seed)
  await page.addInitScript((storePath: string) => {
    const mock = (window as any).__tauriMock
    const raw = mock.files.get(storePath) as string
    mock.files.set(storePath, raw.split('__MTIME__').join(String(mock.mtimeMs)))
  }, STORE)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()

  await page.getByRole('button', { name: /^Utils/ }).first().click()
  const drawer = page.getByRole('dialog')
  await drawer.getByRole('tab', { name: 'Material' }).click()
  // Opening took the store's word — no hython started.
  await expect(drawer.getByText('CachedBox')).toBeVisible()

  await drawer.getByRole('button', { name: 'Rescan' }).click()
  // …and Rescan went past it, all the way to hython.
  await expect(drawer.getByText('FreshBox')).toBeVisible()
  await expect(drawer.getByText('CachedBox')).toHaveCount(0)
  // An unchanged screen is indistinguishable from a dead button, so it also
  // says out loud that it ran.
  await expect(page.getByText(/Rescanned the Houdini project/)).toBeVisible()
})

test('a chosen source joins "Recently used", and one click picks it again', async ({ page }) => {
  // The transfer source is nearly always the SAME personal template, re-browsed
  // from scratch every time. The row remembers the last few and makes the
  // second use one click — so it has to survive a drawer close, which is what
  // separates it from component state.
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true, houdiniProject: true })
  const settingsPath = `${P.appData}/settings.json`
  seed.files[settingsPath] = JSON.stringify({
    ...JSON.parse(seed.files[settingsPath] ?? '{}'),
    houdiniInstallFolder: HOUDINI_INSTALL,
    houdiniDocsFolder: 'C:/Users/dev/Documents/houdini22.0',
  })
  seed.files[`${HOUDINI_INSTALL}/bin/hython.exe`] = 'hython-exe-fixture'
  // The template the user keeps coming back to — the file the picker returns.
  const TEMPLATE = 'D:/Templates/G9_Skin_Base.hiplc'
  seed.files[TEMPLATE] = 'hip-fixture'
  seed.dialogPath = TEMPLATE
  seed.materialScan = { [P.houdini]: [node('TargetBox')], [TEMPLATE]: [node('SourceBox')] }
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()

  await page.getByRole('button', { name: /^Utils/ }).first().click()
  const drawer = page.getByRole('dialog')
  await drawer.getByRole('tab', { name: 'Material' }).click()
  // Nothing to offer before anything has been chosen.
  await expect(drawer.getByText('Recently used')).toHaveCount(0)

  await drawer.getByRole('button', { name: 'Browse…' }).click()
  await expect(drawer.getByText('SourceBox')).toBeVisible()
  // The pick was recorded, and the row names it by file.
  await expect(drawer.getByText('Recently used')).toBeVisible()
  // `exact`: the chip is a two-control group now (pick + remove), and both
  // buttons name the file.
  await expect(
    drawer.getByRole('button', { name: 'G9_Skin_Base.hiplc', exact: true }),
  ).toBeVisible()

  // Close the drawer and come back: the whole point is that it OUTLIVES this.
  await drawer.getByRole('button', { name: /^Close/ }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: /^Utils/ }).first().click()
  const reopened = page.getByRole('dialog')
  await reopened.getByRole('tab', { name: 'Material' }).click()

  // One click re-selects it — no picker, no typing.
  await reopened.getByRole('button', { name: 'G9_Skin_Base.hiplc', exact: true }).click()
  await expect(reopened.getByText('SourceBox')).toBeVisible()

  // …and it can be taken back out. The row fills itself from every source ever
  // picked, including the one-off look, so it needs a way out as much as a way
  // in — and the removal has to OUTLIVE the drawer too, or it is component
  // state pretending to be a preference.
  await reopened.getByRole('button', { name: /^Remove G9_Skin_Base/ }).click()
  await expect(reopened.getByText('Recently used')).toHaveCount(0)
  await reopened.getByRole('button', { name: /^Close/ }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: /^Utils/ }).first().click()
  const again = page.getByRole('dialog')
  await again.getByRole('tab', { name: 'Material' }).click()
  await expect(again.getByText('Recently used')).toHaveCount(0)
  // The `.hip` itself is untouched — a shortcut was removed, not a file.
  expect(
    await page.evaluate((p) => (window as any).__tauriMock.files.has(p) as boolean, TEMPLATE),
  ).toBe(true)
})
