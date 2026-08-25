import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

// One script per job (schema v38). A Save on a character with an export
// directory writes THREE visible Daz scripts — ROM_ builds, Export_ exports,
// Export_Hair_ grooms — and the spec pins that each one carries only its own
// work. The two switches that used to shape this ("Run the export with the ROM
// script" / "Export hair assets too") are gone; the panel they lived in is now
// purely informational, so this also pins that it still reads out the Export
// directory beside where the scripts land.

test('a Save writes the three separate scripts, one job each', async ({ page }) => {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true })
  const kira = JSON.parse(seed.files[`${P.charFolder}/Kira.json`]) as Record<string, unknown>
  kira.exportPath = 'X:/exports/kira'
  seed.files[`${P.charFolder}/Kira.json`] = JSON.stringify(kira, null, 2)
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()

  // The panel and its directory sub-sections share one box (the standalone
  // Export directory box folded in here once the directory became derived and
  // read-only) — a split back into separate panels fails here. Both stages
  // show: the Daz export directory (scripts deliver, .hips read) and the
  // final Export directory (Houdini networks write, Unreal imports).
  const scripts = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Daz scripts generated' }) })
  // Anchored regexes: the headings' accessible names carry their info-popup
  // labels, so exact matching can't be used — and bare substrings would let
  // 'Export directory' match the Daz row too.
  await expect(scripts.getByRole('heading', { name: /^Daz export directory/ })).toBeVisible()
  await expect(scripts.getByRole('heading', { name: /^Export directory/ })).toBeVisible()
  await expect(scripts).toContainText(/exports/i)
  // Nothing left to toggle in here.
  await expect(scripts.getByRole('switch')).toHaveCount(0)

  // The save bar only appears once the draft is dirty, so make one edit first
  // (the PHY section switch — same lever studio.smoke.ts uses).
  await page
    .locator('div.rounded-lg.border')
    .filter({ has: page.getByText('PHY', { exact: true }) })
    .getByRole('switch')
    .click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()

  const read = async (name: string): Promise<string> =>
    await page.evaluate(
      (p) => ((window as any).__tauriMock.files.get(p) ?? '') as string,
      `${P.scriptsDir}/${name}`,
    )

  // ROM_: builds the ROM, exports nothing.
  await expect.poll(async () => await read('ROM_Kira_G9.dsa')).toContain('ApplyDTHCharacter(')
  const rom = await read('ROM_Kira_G9.dsa')
  expect(rom).not.toContain('dthExportAction.doExport(')
  expect(rom).not.toContain('doExportAlembicGroomPoses')

  // Export_: runs the exporter over the ROM already on the timeline — no
  // rebuild, and no grooms.
  await expect
    .poll(async () => await read('Export_Kira_G9.dsa'))
    .toContain('dthExportAction.doExport(')
  const exportScript = await read('Export_Kira_G9.dsa')
  expect(exportScript).not.toContain('ApplyDTHCharacter(')
  expect(exportScript).not.toContain('doExportAlembicGroomPoses')

  // Export_Hair_: the per-item groom pass, and only that.
  await expect
    .poll(async () => await read('Export_Hair_Kira_G9.dsa'))
    .toContain('doExportAlembicGroomPoses(dthExportDir, dthHairName, false)')
  const hair = await read('Export_Hair_Kira_G9.dsa')
  expect(hair).not.toContain('ApplyDTHCharacter(')
})

test('hair drift on the PRIMARY scene warns both ways — gone and unlisted', async ({ page }) => {
  // The reported shape (2026-08-19): the user re-styles the scene in Daz and
  // saves — the list still names the old hair (the export stops on a label it
  // cannot find) and the new hair is unlisted (it rides into the export).
  // The unlisted half used to be gated to outfit scenes on the "the primary
  // was seeded complete at creation" reasoning, so a drifted PRIMARY warned
  // about nothing at all.
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true })
  seed.sceneWearables = {
    [P.scene]: [
      { id: 'nova-ponytail-hair', label: 'Nova Ponytail Hair', conformTarget: '#Genesis9' },
    ],
  }
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()

  // Listed but gone from the scene…
  await expect(page.getByText(/Not found in .KiraDefault_G9_GP.+CHT Sevenly Hair/)).toBeVisible()
  // …and in the scene but not listed — on the primary, the new half.
  await expect(page.getByText(/Unlisted hair: Nova Ponytail Hair/)).toBeVisible()
})
