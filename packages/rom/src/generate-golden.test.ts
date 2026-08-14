import { describe, expect, it } from 'vitest'

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
        morphs: [{ id: `${id}-m1`, node: 'Genesis9', prop: 'body_bs_BodyTone', value: 1, autoBase: true }],
        boneScaleRef: false,
      },
      {
        id: `${id}-p2`,
        name: 'Glute UpDown',
        morphs: [
          { id: `${id}-m2`, node: 'Genesis9', prop: 'SS_body_bs_Glute UpDown', value: -1, autoBase: true },
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
  // prose into a template, hence this check. Comments are exempt: they are for
  // whoever opens the `.dsa`, and Daz only ever parses them.
  //
  // Deliberately string literals only, not "the file is ASCII": stripping
  // comments to check the rest would false-PASS on any literal it mistook for
  // a comment, and the literals are the whole surface that matters. (The
  // golden character is ASCII throughout; a user with an accented character
  // name legitimately produces non-ASCII data, which is not this rule.)
  for (const file of files.filter((f) => f.fileName.endsWith('.dsa'))) {
    it(`emits only ASCII string literals in ${file.fileName}`, () => {
      // No newline inside the class: a DzScript literal cannot span lines, and
      // allowing it let the match run from a quote in one COMMENT line to a
      // quote in the next and swallow the prose between them.
      const literals = file.content.match(/"(?:[^"\\\n]|\\.)*"/g) ?? []
      expect(literals.filter((literal) => /[^\x20-\x7E]/.test(literal))).toEqual([])
    })
  }
})
