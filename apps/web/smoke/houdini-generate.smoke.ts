import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// `exact: true` throughout: the dialog's own InfoPopup trigger is a button named
// "Generate Houdini project — more information", which a substring match (the
// Playwright default) resolves alongside the real Generate button.

// Generate project, through the real dialog: which Daz scene the new network
// imports, and where Houdini is told to write.
//
// Everything worth asserting reaches the native layer in ONE argument —
// `prefillJson`, the values hython stamps onto the fresh network — so these
// specs read it back out of the recorded call rather than pretending to run
// Houdini.

const commandCalls = (page: Page, cmd: string) =>
  page.evaluate(
    (c) =>
      ((window as any).__tauriMock.calls as Array<{ cmd: string; args: any }>)
        .filter((call) => call.cmd === c)
        .map((call) => call.args),
    cmd,
  )

/** The prefill the studio sent with the last Generate. */
async function lastPrefill(page: Page): Promise<Record<string, string>> {
  const calls = await commandCalls(page, 'create_houdini_project')
  expect(calls.length).toBeGreaterThan(0)
  return JSON.parse(calls[calls.length - 1].request.prefillJson) as Record<string, string>
}

/** Generate runs hython, so the fixture needs an installation and its
 *  VERSION-MATCHED documents folder — the api layer refuses without both. */
const HOUDINI_INSTALL = 'C:/Program Files/Side Effects Software/Houdini 22.0.368'
const HOUDINI_DOCS = 'C:/Users/You/Documents/houdini22.0'

async function openGenerateDialog(
  page: Page,
  opts: { extraScene?: boolean; noProjects?: boolean } = {},
) {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true, extraScene: opts.extraScene })
  const settingsPath = `${P.appData}/settings.json`
  seed.files[settingsPath] = JSON.stringify({
    ...JSON.parse(seed.files[settingsPath] ?? '{}'),
    houdiniInstallFolder: HOUDINI_INSTALL,
    houdiniDocsFolder: HOUDINI_DOCS,
  })
  if (opts.noProjects) {
    // The FIRST-project state: the demo character links one Houdini project,
    // and the scene picker only appears from the second project on.
    const charPath = `${P.charFolder}/Kira.json`
    const char = JSON.parse(seed.files[charPath] ?? '{}') as Record<string, unknown>
    char.houdiniProjects = []
    seed.files[charPath] = JSON.stringify(char, null, 2)
  }
  seed.files[`${HOUDINI_INSTALL}/bin/hython.exe`] = 'hython-exe-fixture'
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()
  await page.getByRole('button', { name: 'Generate project' }).click()
  return page.getByRole('dialog')
}

test('a single-scene character is not asked which scene — there is only one', async ({ page }) => {
  const dialog = await openGenerateDialog(page)

  await expect(dialog.getByLabel('Daz scene to import')).toHaveCount(0)
  // …but it SAYS which scene it is for. Without the picker there was nothing
  // naming the scene at all, and a generated project's whole identity is which
  // export set it imports.
  await expect(dialog).toContainText('KiraDefault_G9_GP')
  await expect(dialog).toContainText('(primary)')
  await dialog.getByRole('button', { name: 'Generate', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  // And so does the confirmation, after the dialog is gone.
  await expect(page.getByText(/Houdini project generated for KiraDefault_G9_GP/)).toBeVisible()

  const prefill = await lastPrefill(page)
  // The fixture's scenes sit directly in `daz3d/`, so each export subfolder is
  // the scene's own stem rather than the `primary/` of the standard layout.
  expect(prefill.dth).toBe('$HIP/daz-export/KiraDefault_G9_GP/Kira.dth')
  expect(await commandCalls(page, 'create_houdini_project')).toHaveLength(1)
})

test('the first project is not asked either — it is the primary scene\'s', async ({ page }) => {
  const dialog = await openGenerateDialog(page, { extraScene: true, noProjects: true })

  // TWO scenes are linked, but no Houdini project is yet: the character's
  // first project is its main one, wired to the primary without a question.
  await expect(dialog.getByLabel('Daz scene to import')).toHaveCount(0)
  // The one that MATTERS: two scenes linked, no picker — so the line naming
  // the primary is the only thing telling the user which of them this project
  // will be wired to.
  await expect(dialog).toContainText('KiraDefault_G9_GP')
  await expect(dialog).not.toContainText('KiraSummertide')
  await dialog.getByRole('button', { name: 'Generate', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  const prefill = await lastPrefill(page)
  expect(prefill.dth).toBe('$HIP/daz-export/KiraDefault_G9_GP/Kira.dth')
  expect(prefill.dth).not.toContain('KiraSummertide')
})

test('the chosen scene decides the import paths', async ({ page }) => {
  const dialog = await openGenerateDialog(page, { extraScene: true })

  // With two scenes AND a project already linked (the demo's — load-bearing:
  // the first project never asks) the picker appears, defaulting to the
  // primary.
  const picker = dialog.getByLabel('Daz scene to import')
  await expect(picker).toBeVisible()
  await picker.click()
  await page.getByRole('option', { name: /KiraSummertide/ }).click()
  await dialog.getByRole('button', { name: 'Generate', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // Every import path is the OUTFIT scene's export set — before the picker
  // existed these all came out as the primary's, and re-aiming them was five
  // hand edits inside Houdini.
  const prefill = await lastPrefill(page)
  const dir = '$HIP/daz-export/KiraSummertide_G9_GP'
  expect(prefill.dth).toBe(`${dir}/Kira_KiraSummertide_G9_GP.dth`)
  expect(prefill.abc).toBe(`${dir}/Kira_KiraSummertide_G9_GP.abc`)
  expect(prefill.csv).toBe(`${dir}/Kira_KiraSummertide_G9_GP_pose_asset.csv`)
  // …and NOT the primary's, which is what a project got before the picker.
  expect(prefill.dth).not.toContain('KiraDefault')
})

test('Houdini is told to write into the character export folder, not daz-export', async ({
  page,
}) => {
  // The two are different ends of the pipeline: `daz-export` holds the
  // Daz→Houdini intermediates the imports READ (large, regenerable, not backed
  // up), while `export/` is what Houdini produces for Unreal. Until v0.68 this
  // parm carried the export ROOT, quietly aiming Houdini's output into the
  // throwaway tree.
  const dialog = await openGenerateDialog(page)
  await dialog.getByRole('button', { name: 'Generate', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  const prefill = await lastPrefill(page)
  // Trailing slash is load-bearing — the HDA concatenates it with the name.
  expect(prefill.exportDirectory).toBe('$JOB/export/')
  expect(prefill.exportDirectory).not.toContain('daz-export')
})
