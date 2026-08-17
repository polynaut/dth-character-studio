import { expect, test } from '@playwright/test'

// The real path rule (leaf module — the package root's `?raw` imports don't
// resolve node-side, see rom-animation.ts).
import { romAnimationPath } from '../../../packages/rom/src/rom-animation.ts'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// The primary scene card's browse-to-REPLACE flow: the folder button runs the
// regular Add-scene dialog (validation, copy-vs-link), but the confirm swaps
// `scenePath`, re-derives GEN from the new scene, and (toggle, default on for
// an in-folder old primary) deletes the old scene's files.
//
// It is offered ONLY while the primary is the character's only scene — see the
// gate test for why.
//
// Also here: the missing-primary RELINK flow (the "Primary scene missing"
// panel) — a relink targets the SAME scene at a new path, so the hair record
// REPOINTS to the final path (a curated list follows the file) and a
// record-less scene seeds its detected hair like every other linking path.

const NEW_SCENE = 'X:/scenes/NewLook_G9.duf'
/** Where the replacement lands once copied in (every scene gets its own
 *  subfolder; the primary's is "primary"). */
const COPIED_SCENE = `${P.charFolder}/daz3d/primary/NewLook_G9.duf`
/** The replacement scene's own hair — a different style from the old primary's,
 *  so the seeded list can only have come from the NEW scene's read. */
const NEW_HAIR = 'Aria Braids Hair'

const fileKeys = (page: Page) =>
  page.evaluate(() => [...(window as any).__tauriMock.files.keys()] as Array<string>)
const fileContent = (page: Page, path: string) =>
  page.evaluate((p) => ((window as any).__tauriMock.files.get(p) ?? null) as string | null, path)
const unhandledCommands = (page: Page) =>
  page.evaluate(() => (window as any).__tauriMock.unhandled as Array<string>)

test('replace primary: validates, swaps, derives GEN, seeds hair, deletes the old copy', async ({
  page,
}) => {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true })
  seed.files[NEW_SCENE] = 'duf-fixture-new'
  // The old primary's saved ROM animation — stale the moment the primary is
  // another scene, so the replace must take it along (asserted below).
  seed.files[romAnimationPath(P.scene)] = 'duf-rom-animation'
  seed.dialogPath = NEW_SCENE
  seed.sceneFigure = { id: 'Genesis9', label: 'Kira' }
  // The replacement carries its own hair — keyed on BOTH paths: the dialog
  // validates the picked file, the seeding scans the copied-in one.
  const newHair = [{ id: 'aria-braids-hair', label: NEW_HAIR, conformTarget: '#Genesis9' }]
  seed.sceneWearables = {
    ...(seed.sceneWearables ?? {}),
    [NEW_SCENE]: newHair,
    [COPIED_SCENE]: newHair,
  }
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()

  // The primary card's hover folder button opens the replace dialog.
  await page.getByRole('button', { name: 'Replace with another Daz scene…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Replace the primary Daz scene?' })
  await expect(dialog).toBeVisible()
  // The old primary is an in-folder copy — no toggle, no notice: replacing
  // always deletes the studio-owned old copy (asserted on the fs below).

  await dialog.getByRole('button', { name: 'Copy & replace' }).click()
  await expect(page.getByText('Replaced the primary Daz scene')).toBeVisible()
  // The new scene carries no GP/DK geograft — the derivation announces the flip.
  await expect(page.getByText(/Genitalia section disabled/)).toBeVisible()

  // Persisted: scenePath swapped to the in-folder copy — in the primary's own
  // "primary" subfolder (every scene lives in its own subfolder now) — and GEN
  // re-derived.
  const json = JSON.parse((await fileContent(page, `${P.charFolder}/Kira.json`))!) as {
    scenePath: string
    sections: { GEN: { enabled: boolean } }
    sceneOverrides: Array<{ scenePath: string; hair: Array<{ nodeLabel: string }> }>
  }
  expect(json.scenePath).toBe(COPIED_SCENE)
  expect(json.sections.GEN.enabled).toBe(false)

  // The new primary's own hair is pre-selected — a replacement is a different
  // scene with different hair, and unlisted hair rides into the FBX.
  const seeded = json.sceneOverrides.find((o) => o.scenePath === COPIED_SCENE)
  expect(seeded?.hair.map((h) => h.nodeLabel)).toEqual([NEW_HAIR])

  // Filesystem: the new copy exists, the OLD primary's files are gone — its
  // stale saved ROM animation included. The old primary sits directly in the
  // shared daz3d/ root (legacy layout), so only ITS files go, never the root.
  const keys = await fileKeys(page)
  expect(keys).toContain(COPIED_SCENE)
  expect(keys).not.toContain(P.scene)
  expect(keys).not.toContain(`${P.scene}.tip.png`)
  expect(keys).not.toContain(romAnimationPath(P.scene))

  expect(await unhandledCommands(page)).toEqual([])
})

test('replace primary is refused while the character has other scenes', async ({ page }) => {
  // Every extra scene was validated against the CURRENT primary — same Genesis,
  // one figure, empty timeline, and the same GP/DK geograft, because every
  // scene must produce the primary's skeleton. Swapping the primary re-decides
  // that reference: a replacement without Golden Palace would leave a set of
  // validated extras silently mismatched, and nothing re-checks them. So the
  // user unlinks first and re-adds against the new primary, which runs the real
  // validation for each one.
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true, extraScene: true })
  seed.files[NEW_SCENE] = 'duf-fixture-new'
  seed.dialogPath = NEW_SCENE
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()

  // The button is still THERE — a control that vanishes reads as a missing
  // feature — but it refuses, and its tooltip says what to do about it.
  const replace = page.getByRole('button', { name: /Unlink the other scene/ })
  await expect(replace).toBeVisible()
  await expect(replace).toBeDisabled()
  // …and no replace dialog can be reached.
  await expect(
    page.getByRole('dialog', { name: 'Replace the primary Daz scene?' }),
  ).toHaveCount(0)

  expect(await unhandledCommands(page)).toEqual([])
})

/** Where the missing primary "turns up" for the relink tests — the same scene
 *  renamed on disk, still inside the character folder (so the pick links in
 *  place, no copy dialog). */
const RELINKED_SCENE = `${P.charFolder}/daz3d/KiraRenamed_G9_GP.duf`
/** The relinked scene's wearables: the curated hair item PLUS a second
 *  detectable style (so a re-seed would provably differ from the curated
 *  list) and a GP geograft (so the GEN derivation stays put — no toast). */
const RELINK_WEARABLES = [
  { id: 'cht-sevenly-hair', label: 'CHT Sevenly Hair', conformTarget: '#Genesis9' },
  { id: 'aria-braids-hair', label: NEW_HAIR, conformTarget: '#Genesis9' },
  { id: 'GoldenPalace_G9', label: 'Golden Palace', conformTarget: '#Genesis9' },
]

/** Seed the relink state: the primary's `.duf` is GONE (renamed outside the
 *  app — its folder and tip sidecar remain, so the panel offers the file-level
 *  Relink, not the folder relink), the renamed file exists, and the picker
 *  returns it. */
function buildRelinkSeed() {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true })
  delete seed.files[P.scene]
  seed.files[RELINKED_SCENE] = 'duf-fixture'
  seed.dialogPath = RELINKED_SCENE
  seed.sceneFigure = { id: 'Genesis9', label: 'Kira' }
  seed.sceneWearables = {
    ...(seed.sceneWearables ?? {}),
    [RELINKED_SCENE]: RELINK_WEARABLES,
  }
  return seed
}

type PersistedOverrides = {
  scenePath: string
  sceneOverrides: Array<{ scenePath: string; hair: Array<{ nodeLabel: string }> }>
}

test('relink missing primary: the curated hair record FOLLOWS to the new path', async ({
  page,
}) => {
  // The demo character curates ONE hair item on the primary — the relinked
  // scene detects TWO, so a wrong re-seed is distinguishable from the repoint.
  const seed = buildRelinkSeed()
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText('Primary scene missing.').waitFor()
  await page.getByRole('button', { name: 'Relink', exact: true }).click()
  await expect(page.getByText('Linked Daz scene')).toBeVisible()

  const json = JSON.parse(
    (await fileContent(page, `${P.charFolder}/Kira.json`))!,
  ) as PersistedOverrides
  expect(json.scenePath).toBe(RELINKED_SCENE)
  // Repointed, NOT re-seeded: the record keeps the curated single item (a seed
  // would have listed both detected styles) and nothing strands on the dead
  // old path, where the export's groom map would never match it again.
  const record = json.sceneOverrides.find((o) => o.scenePath === RELINKED_SCENE)
  expect(record?.hair.map((h) => h.nodeLabel)).toEqual(['CHT Sevenly Hair'])
  expect(json.sceneOverrides.some((o) => o.scenePath === P.scene)).toBe(false)

  expect(await unhandledCommands(page)).toEqual([])
})

test('relink missing primary: a record-less scene seeds its detected hair', async ({
  page,
}) => {
  const seed = buildRelinkSeed()
  // Strip the curated record — the relinked primary has nothing to repoint, so
  // the shared seeding rule must kick in (same as every other linking path).
  const charFile = `${P.charFolder}/Kira.json`
  const character = JSON.parse(seed.files[charFile]) as { sceneOverrides: Array<unknown> }
  character.sceneOverrides = []
  seed.files[charFile] = JSON.stringify(character, null, 2)
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText('Primary scene missing.').waitFor()
  await page.getByRole('button', { name: 'Relink', exact: true }).click()
  await expect(page.getByText('Linked Daz scene')).toBeVisible()

  const json = JSON.parse((await fileContent(page, charFile))!) as PersistedOverrides
  expect(json.scenePath).toBe(RELINKED_SCENE)
  const record = json.sceneOverrides.find((o) => o.scenePath === RELINKED_SCENE)
  // Alphabetical — the detection sorts hair-ish labels by localeCompare.
  expect(record?.hair.map((h) => h.nodeLabel)).toEqual([NEW_HAIR, 'CHT Sevenly Hair'])

  expect(await unhandledCommands(page)).toEqual([])
})
