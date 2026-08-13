import { expect, test } from '@playwright/test'

import { P, buildSeed, scanStoreEntryKey } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// The Utils drawer's two occlusion tabs.
//
// The transfer itself needs hython and a real `.hip`, so what a browser spec can
// prove is the half that decides what the run will be ASKED to do: that each tab
// lists only its own node kind, offers only that kind's sections, and keeps its
// ticks separate from the other tabs'. A section list bleeding across kinds is
// the failure that matters here — the Python filters to the sections it knows,
// so a stray one would be dropped there and the run would report success having
// copied nothing.

const STORE = `${P.project}/.dcsmeta/characters/Kira/houdini-scan.json`

const storeKey = (hipPath: string) => scanStoreEntryKey(hipPath, P.exportDir)

/** A scanned node in the shape `material_utils.py` reports one. The occlusion
 *  kinds carry their counts in `sectionCounts` (the folder kinds' shape), which
 *  is what the picker line and the checkbox counts both read. */
function node(
  nodeType: string,
  name: string,
  sectionCounts: Array<{ key: string; label: string; count: number }>,
) {
  return {
    path: `/obj/DazToHue/${name}`,
    name,
    nodeType,
    networkBox: '',
    materials: 0,
    uvChannels: 0,
    bakers: 0,
    layers: 0,
    bakerNames: [],
    materialNames: [],
    slots: [],
    sectionCounts,
  }
}

/** A material node in the SAME project — the drawer used to preselect every
 *  node of the card it was opened from, all kinds at once, so this is what used
 *  to be counted into an occlusion run. The preseed is gone (#817), but the
 *  node stays here: what this spec pins is that the count follows the ACTIVE
 *  kind, and it can only pin that with a wrong-kind node present to be ignored. */
const MATERIAL = node('material', 'DazToHueMaterial', [])
const OCCLUSION = node('occlusion', 'DazToHueOcclusion', [
  { key: 'visualise', label: 'Visualise', count: 2 },
  { key: 'culling', label: 'Occlusion Culling', count: 7 },
])
const GROOM = node('groomOcclusion', 'DazToHueGroomOcclusion', [
  { key: 'visualise', label: 'Visualise', count: 1 },
  { key: 'options', label: 'Options', count: 4 },
  { key: 'skin', label: 'Skin', count: 2 },
  { key: 'occlusionMask', label: 'Occlusion Mask', count: 5 },
  { key: 'textureStamp', label: 'Texture Stamp', count: 3 },
])

/** A template project OUTSIDE the character, holding one occlusion node — the
 *  only way to have a source the run will accept (a target that IS the source
 *  is refused). Reached through Browse…, which the fake answers with
 *  `dialogPath`. */
const TEMPLATE = 'D:/Templates/Occlusion_Base.hiplc'
const HOUDINI_INSTALL = 'C:/Program Files/Side Effects Software/Houdini 22.0.368'

async function openDrawer(page: Page, opts: { withSourceTemplate?: boolean } = {}) {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true, houdiniProject: true })
  if (opts.withSourceTemplate) {
    // hython configured, so the drawer can scan the browsed file itself.
    const settingsPath = `${P.appData}/settings.json`
    seed.files[settingsPath] = JSON.stringify({
      ...JSON.parse(seed.files[settingsPath] ?? '{}'),
      houdiniInstallFolder: HOUDINI_INSTALL,
      houdiniDocsFolder: 'C:/Users/dev/Documents/houdini22.0',
    })
    seed.files[`${HOUDINI_INSTALL}/bin/hython.exe`] = 'hython-exe-fixture'
    seed.files[TEMPLATE] = 'hip-fixture'
    seed.dialogPath = TEMPLATE
    seed.materialScan = {
      [TEMPLATE]: [
        {
          ...node('occlusion', 'DazToHueOcclusion', [
            { key: 'visualise', label: 'Visualise', count: 3 },
            { key: 'culling', label: 'Occlusion Culling', count: 9 },
          ]),
          networkBox: 'TemplateOcclusion',
        },
      ],
    }
  }
  seed.files[STORE] = JSON.stringify({
    version: 1,
    projects: {
      [P.houdini.toLowerCase()]: {
        key: storeKey(P.houdini),
        scannedAt: '2026-08-07T00:00:00.000Z',
        project: {
          hipPath: P.houdini,
          ok: true,
          error: '',
          nodes: [MATERIAL, OCCLUSION, GROOM],
          job: P.charFolder,
          fps: 30,
          refs: { collapsible: 0, foreign: 0, broken: [], hipRelative: [] },
          prefill: { fillable: [], missing: [] },
        },
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
  await page.getByRole('button', { name: /^Utils/ }).click()
  return page.getByRole('dialog')
}

test('the Occlusion tab lists its own node and its own two sections', async ({ page }) => {
  const drawer = await openDrawer(page)
  await drawer.getByRole('tab', { name: 'Occlusion', exact: true }).click()

  // The node picker is filtered by kind: the groom node has no business here.
  await expect(drawer.getByText('DazToHueOcclusion', { exact: true }).first()).toBeVisible()
  await expect(drawer.getByText('DazToHueGroomOcclusion', { exact: true })).toHaveCount(0)
  // Its scanned section counts are the picker's summary line.
  await expect(drawer.getByText('Visualise 2 · Occlusion Culling 7')).toBeVisible()

  // Exactly its own sections — and NOT the groom node's, nor a skeleton one.
  await expect(drawer.getByRole('checkbox', { name: /Occlusion Culling/ })).toBeVisible()
  await expect(drawer.getByRole('checkbox', { name: /Visualise/ })).toBeVisible()
  await expect(drawer.getByRole('checkbox', { name: /Texture Stamp/ })).toHaveCount(0)
  await expect(drawer.getByRole('checkbox', { name: /Skin Weights/ })).toHaveCount(0)
  // Everything starts ticked, like every other transfer tab.
  await expect(drawer.getByRole('checkbox', { name: /Occlusion Culling/ })).toBeChecked()
})

test('the Groom occlusion tab is its own node, sections and selection', async ({ page }) => {
  const drawer = await openDrawer(page)
  await drawer.getByRole('tab', { name: 'Groom occlusion' }).click()

  await expect(drawer.getByText('DazToHueGroomOcclusion', { exact: true }).first()).toBeVisible()
  await expect(drawer.getByText('DazToHueOcclusion', { exact: true })).toHaveCount(0)
  await Promise.all(
    ['Options', 'Skin', 'Occlusion Mask', 'Texture Stamp', 'Visualise'].map((section) =>
      expect(drawer.getByRole('checkbox', { name: new RegExp(section) })).toBeVisible(),
    ),
  )
  // The character node's own section must not leak in — the two kinds SHARE the
  // `visualise` key and differ in every other one.
  await expect(drawer.getByRole('checkbox', { name: /Occlusion Culling/ })).toHaveCount(0)

  // Unticking here must not touch the other tab: the folder kinds keep one
  // selection each, not one shared set (they share a section KEY, so a single
  // set would have made `visualise` a global toggle).
  await drawer.getByRole('checkbox', { name: /Visualise/ }).uncheck()
  await drawer.getByRole('tab', { name: 'Occlusion', exact: true }).click()
  await expect(drawer.getByRole('checkbox', { name: /Visualise/ })).toBeChecked()
})

test('the confirm dialog offers no material knobs on an occlusion run', async ({ page }) => {
  // "Replace UV channels and bakers" is a MATERIAL control, and
  // `op_transfer_folders` never reads `replace` — a folder section is always
  // copied wholesale. Shown here it was a switch that could not do anything,
  // above a line about material slots merging by surface.
  const drawer = await openDrawer(page, { withSourceTemplate: true })
  await drawer.getByRole('tab', { name: 'Occlusion', exact: true }).click()
  await drawer.getByRole('checkbox', { name: /DazToHueOcclusion/ }).first().check()
  // A source from OUTSIDE the character — the transfer refuses a run whose
  // target list contains the source node.
  await drawer.getByRole('button', { name: 'Browse…' }).click()
  await drawer.getByRole('radio', { name: /TemplateOcclusion/ }).check()
  await drawer.getByRole('button', { name: /^Transfer/ }).click()

  const confirm = page.getByRole('dialog').filter({ hasText: 'Copy occlusion setup?' })
  await expect(confirm).toBeVisible()
  await expect(confirm.getByText(/Replace UV channels and bakers/)).toHaveCount(0)
  await expect(confirm.getByText(/copied wholesale, so there is no append mode/)).toBeVisible()

  // The dry run's outcome names the SECTIONS that travelled. Asking a folder
  // kind for slot/channel/baker counts yielded "0 slots, 0 channels, 0 bakers"
  // after a run that copied an occlusion setup perfectly well.
  await confirm.getByRole('button', { name: 'Dry run' }).click()
  await expect(confirm.getByText(/Occlusion Culling/).first()).toBeVisible()
})

test('the target count is the ACTIVE kind only, not every node of the project', async ({ page }) => {
  // The drawer used to preselect every node of the card it was opened from —
  // all kinds at once — so an occlusion run counted the material node too: "3
  // target nodes selected" under one visible ticked box. The Python refuses a
  // wrong-typed node per target, so nothing was ever written to one; the count
  // and the report were the lie. The preseed is gone (#817), so this now guards
  // the remaining half: `targetRefs` filters by the ACTIVE kind, and the count
  // it feeds may never name a node the tab isn't showing.
  const drawer = await openDrawer(page)
  await drawer.getByRole('tab', { name: 'Occlusion', exact: true }).click()
  await drawer.getByRole('checkbox', { name: /DazToHueOcclusion/ }).first().check()
  await expect(drawer.getByText(/target node/)).toHaveText('1 target node selected')
})
