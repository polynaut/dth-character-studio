import { describe, expect, it } from 'vitest'

import { nonAsciiStringLiterals } from './dsa-ascii'
import { generateAll } from './generate'
import { characterSchema, defaultSections } from './types'
import type { PresetFrames } from './frames'
import type { Character, RomGroup, RomSections } from './types'

/**
 * GOLDEN FILES for everything `generateAll` emits.
 *
 * The rest of the suite asserts that generated output CONTAINS the lines a
 * feature needs — 214 `toContain` checks at the time of writing, and not one
 * pin on the artifact as a whole. That leaves a gap this file closes: a change
 * to any line NOBODY thought to assert on passes every test and ships. Measured
 * 2026-08-14 — prefixing one line of the emitted DAZ Script with `export `
 * (an editing accident, and the exact way a mechanical refactor of `dsa.ts`
 * fails) left all 366 tests green. The `.dsa` is a program in another language:
 * TypeScript cannot typecheck it, so nothing but a byte-level pin catches it.
 *
 * These are DIFFS, not correctness proofs. A failure here means "the generated
 * artifact changed" — which is either the point of your change (read the diff,
 * confirm it is what you meant, and re-record) or a bug you just caught. The
 * artifacts are checked in, so the diff shows up in review as generated-output
 * lines, which is exactly where it should be argued about.
 *
 *   pnpm --filter @dth/rom test -u    # re-record after an INTENDED change
 *
 * The character below deliberately turns on more than any single feature test
 * needs — every section, both section modes, groom, the UE5 tear-UV pass, the
 * products scan and a second scene — because the point is coverage of the
 * emitted text, not of one behaviour.
 */

/** The validated DTH G9 preset-block lengths — same values the suite uses. */
const FRAMES: PresetFrames = { base: 328, gp: 104, dk: 54, phys: 43 }

/**
 * Fixed and POSIX-shaped on purpose: it is baked into the generated script, and
 * the golden files are compared on Windows AND on CI's Linux. `packages/rom` is
 * pure and platform-neutral, so nothing here may vary by host — if this ever
 * differs across platforms, that is a generator bug this pin should report.
 */
const META_DIR = 'C:/DTH/Project/.dcsmeta/characters/electra-g9'
const SCENES_ROOT = 'C:/DTH/Project/assets/characters/Electra G9/daz3d'

/** All three are host-derived absolute paths in real use; fixed here for the
 *  same reason {@link META_DIR} is. */
const SCAN_PRODUCTS = {
  dimManifestPath: 'C:/DAZ/ManifestFiles',
  outputDir: `${META_DIR}/product-scans`,
  dazLibraryFolder: 'C:/DAZ/Library',
}

/** The baked include-fallback root (host-resolved in real use; fixed like
 *  {@link META_DIR}) — pins the cold-start fallback emission. */
const RUNTIME_ROOT = 'C:/DAZ/Library/Scripts/DTH-Character-Studio'

function group(id: string, suffix: RomGroup['suffix']): RomGroup {
  return {
    id,
    label: '',
    suffix,
    method: 'individual',
    calculateFrom: 'default',
    poses: [
      {
        id: `${id}-p1`,
        name: 'BodyTone',
        morphs: [{ id: `${id}-m1`, node: 'Genesis9', prop: 'body_bs_BodyTone', value: 1 }],
        boneScaleRef: false,
      },
      {
        id: `${id}-p2`,
        name: 'Glute UpDown',
        morphs: [
          { id: `${id}-m2`, node: 'Genesis9', prop: 'SS_body_bs_Glute UpDown', value: -1 },
        ],
        boneScaleRef: true,
      },
    ],
  }
}

/** Every section on: the preset-driven ones in `preset`, the rest in `custom`. */
function allSections(): RomSections {
  const sections = defaultSections()
  for (const key of Object.keys(sections) as Array<keyof RomSections>) {
    sections[key].enabled = true
    if (sections[key].mode === 'custom') sections[key].groups = [group(`${key}-g1`, 'centre')]
  }
  return sections
}

function goldenCharacter(): Character {
  const now = '2026-06-11T00:00:00.000Z'
  return characterSchema.parse({
    id: 'electra-g9',
    name: 'Electra G9',
    createdAt: now,
    updatedAt: now,
    generation: 'G9',
    sections: allSections(),
    applyUE5TearUV: true,
    scenePath: 'C:/DTH/Project/assets/characters/Electra G9/daz3d/Electra.duf',
    extraScenes: ['C:/DTH/Project/assets/characters/Electra G9/daz3d/Electra_Yoga.duf'],
    exportPath: 'C:/DTH/Export/Electra',
  })
}

describe('generated artifacts (golden)', () => {
  const files = generateAll(
    goldenCharacter(),
    {},
    FRAMES,
    META_DIR,
    '2.4.3',
    SCAN_PRODUCTS,
    {},
    {},
    SCENES_ROOT,
    '',
    undefined,
    '',
    RUNTIME_ROOT,
  )

  it('emits a stable set of files', async () => {
    await expect(files.map((f) => f.fileName).join('\n')).toMatchFileSnapshot(
      './__golden__/filelist.txt',
    )
  })

  it('is deterministic — generating twice produces identical bytes', () => {
    const again = generateAll(
      goldenCharacter(),
      {},
      FRAMES,
      META_DIR,
      '2.4.3',
      SCAN_PRODUCTS,
      {},
      {},
      SCENES_ROOT,
      '',
      undefined,
      '',
      RUNTIME_ROOT,
    )
    expect(again.map((f) => `${f.fileName}\n${f.content}`)).toEqual(
      files.map((f) => `${f.fileName}\n${f.content}`),
    )
  })

  for (const file of files) {
    it(`pins ${file.fileName}`, async () => {
      await expect(file.content).toMatchFileSnapshot(`./__golden__/${file.fileName}`)
    })
  }

  // Daz cannot carry non-ASCII out of a script: a `→` written into the run log
  // reached the studio as `?`, and an em dash printed to the Daz log arrived as
  // mojibake (measured 2026-08-14 on both). So every string the scripts WRITE
  // or DISPLAY has to be ASCII — which is a rule nobody remembers while typing
  // prose into a template, hence this check. The rule and the scanner live in
  // `dsa-ascii.ts`; the studio's OTHER `.dsa` surface, the bundled runtime, is
  // held to the same rule by the same scanner in `apps/web`'s runtime.test.ts.
  //
  // The golden character is ASCII throughout, so anything this finds came from
  // a template. (A user with an accented character name legitimately produces
  // non-ASCII DATA, which is a different problem and not this rule.)
  for (const file of files.filter((f) => f.fileName.endsWith('.dsa'))) {
    it(`emits only ASCII string literals in ${file.fileName}`, () => {
      expect(nonAsciiStringLiterals(file.content)).toEqual([])
    })
  }

  /**
   * A carrier the RUNNER executes must never open a modal.
   *
   * Measured 2026-08-16 (DS 4.24): a `MessageBox` in an unattended run waits
   * forever for a click nobody is there to make, and a blocked Daz is
   * indistinguishable from a hung `include()` — the log stops dead at "Loading
   * script", nothing is written after it, CPU goes flat, and the main window is
   * merely *disabled* rather than visibly modal. It cost hours of hunting a
   * runtime that was working perfectly, and it stops the whole batch, not just
   * the row.
   *
   * The hidden (dot-prefixed) scripts ARE the Runner's carriers — that is what
   * hidden means here. The visible ones are Content Library tiles a human
   * double-clicks, where a dialog is exactly right, so they are checked for the
   * opposite: this is a rule about who is watching, not a ban on dialogs.
   */
  const runnerCarriers = files.filter((f) => f.fileName.startsWith('.'))
  it('covers every hidden carrier (the list the modal rule is checked against)', () => {
    expect(runnerCarriers.map((f) => f.fileName).sort()).toEqual([
      '.Build_ROM_Animation.dsa',
      '.Bulk_Export_Only.dsa',
      '.Bulk_ROM_Export.dsa',
    ])
  })
  for (const file of runnerCarriers) {
    it(`opens no modal in ${file.fileName} — nobody is there to click it`, () => {
      expect(file.content).not.toMatch(/MessageBox\./)
    })
  }
  for (const file of files.filter((f) => f.fileName.endsWith('.dsa') && !f.fileName.startsWith('.'))) {
    it(`keeps its dialogs in ${file.fileName} — a human runs this one`, () => {
      expect(file.content).toMatch(/MessageBox\./)
    })
  }
})
