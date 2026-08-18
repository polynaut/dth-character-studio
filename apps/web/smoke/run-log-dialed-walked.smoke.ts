import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

// **One explanation, however many offenders.** The runtime used to put the whole
// "why a walked morph must sit at 0" paragraph inside EVERY failed-morph reason,
// so three dialed morphs meant three identical ~330-character essays and the
// only part that differs between them — the value, and whether the dial is
// ERC-driven — sat buried at the front of each.
//
// Since runtime v86 the row is a one-liner and the shared half is stated ONCE by
// the report, keyed on the entry's `kind`. That keying is the whole feature and
// it lives only in the component, so it is pinned here: the explainer appears
// once for N offenders, and NOT AT ALL for a log written before v86 — those rows
// carry the explanation inline, and an explainer would then say it twice.

const STORED_LOG = `${P.charMeta}/.last_rom_run.json`

/** A log v2 record with `failedMorphs` verbatim — the shape the runtime writes. */
function runLog(failedMorphs: Array<Record<string, unknown>>): string {
  return JSON.stringify({
    logVersion: 2,
    character: 'Kira',
    ok: false,
    runs: [
      {
        scene: P.scene,
        sceneName: 'KiraDefault_G9_GP',
        finishedAt: 'Mon Jan 5 10:00:00 2026',
        finishedAtMs: Date.parse('2026-01-05T10:00:00Z'),
        ok: false,
        errors: [],
        warnings: [],
        failedMorphs,
      },
    ],
  })
}

/** The sentence only the shared explainer says — never a row. */
const EXPLAINER = /walked by the ROM but not at 0 in the scene/

test('three dialed-walked rows get ONE explainer, and the rows stay one-liners', async ({
  page,
}) => {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true })
  seed.files[STORED_LOG] = runLog([
    { frame: 196, node: 'Genesis9', prop: 'PBMBreastsHeavy', reason: 'dialed at 0.089 - DRIVEN, zero the controlling dial and rebuild', kind: 'dialed-walked' },
    { frame: 204, node: 'Genesis9', prop: 'PBMHeavy', reason: 'dialed at 0.3 - zero it and rebuild', kind: 'dialed-walked' },
    { frame: 212, node: 'Genesis9', prop: 'body_bs_LegsLength', reason: 'dialed at 0.5 - zero it and rebuild', kind: 'dialed-walked' },
    // A different kind in the same list: it must not gain the explainer, and
    // must not stop the three above from getting theirs.
    { frame: 300, node: 'Genesis9', prop: 'CTRLNotThere', reason: 'property not found', kind: '' },
  ])
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()

  await expect(page.getByRole('heading', { name: /reported 4 problems/ })).toBeVisible()
  // ONCE. Four offenders, three of them sharing an explanation — one paragraph.
  await expect(page.getByText(EXPLAINER)).toHaveCount(1)
  // And it says where the fix happens, which the generic banner cannot: the
  // dial is zeroed in Daz, not in the studio.
  await expect(page.getByText(/in the Daz scene/)).toBeVisible()

  // The rows themselves carry no part of the shared half any more.
  const row = page.getByRole('button', { name: /PBMBreastsHeavy/ })
  await expect(row).toContainText('dialed at 0.089 - DRIVEN, zero the controlling dial and rebuild')
  await expect(row).not.toContainText('FBX')
  await expect(row).not.toContainText('alembic')
})

test('a pre-v86 log gets NO explainer — its rows already carry the paragraph', async ({ page }) => {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true })
  // Written by runtime v85 or earlier: no `kind`, and the whole explanation
  // inside the reason. Saying it again above the list is the one thing worse
  // than saying it three times.
  seed.files[STORED_LOG] = runLog([
    {
      frame: 196,
      node: 'Genesis9',
      prop: 'PBMBreastsHeavy',
      reason:
        'dialed at 0.089 in the scene - a walked morph must be at 0, or the exported FBX base loses it while the alembic keeps it (the shapes drift). Zero the dial (it is DRIVEN - zero the controlling dial) and rebuild; its shape reaches Unreal through the generated morph instead.',
    },
  ])
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()

  await expect(page.getByRole('heading', { name: /reported 1 problem/ })).toBeVisible()
  // The old row still reads in full…
  await expect(page.getByRole('button', { name: /PBMBreastsHeavy/ })).toContainText(
    'the alembic keeps it',
  )
  // …and nothing was added above it.
  await expect(page.getByText(EXPLAINER)).toHaveCount(0)
})
