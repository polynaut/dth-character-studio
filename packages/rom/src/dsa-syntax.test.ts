import { Script } from 'node:vm'

import { describe, expect, it } from 'vitest'

import { generateAll } from './generate'
import { characterSchema, defaultSections } from './types'
import type { PresetFrames } from './frames'
import type { Character, RomGroup, RomSections } from './types'

/**
 * The generated `.dsa` must at least PARSE.
 *
 * The goldens next door pin the emitted bytes, so they catch a *change*. They
 * cannot catch invalid *output*: a golden is re-recorded from whatever the
 * generator produced, so a script with an unbalanced brace pins itself and
 * ships. Nothing else here checks it either — TypeScript cannot typecheck a
 * program in another language, and the only other reader is Daz, where the
 * symptom is a batch row that dies at "Loading script".
 *
 * That gap is widest exactly where `dsa.ts` builds nesting by string
 * concatenation across VARIANTS, because the golden character only exercises
 * one of them. Runtime v85's export rework is the case in point: it wrapped the
 * export core and the hair pass in new `if (!dthExportLanded) { … } else { … }`
 * brackets, in a groom bracket that the golden character has no grooms to emit.
 *
 * `new Script` is the check — the emitted DAZ Script is plain ES3-shaped JS, so
 * a host parser is a real syntax check on it. `node:vm` COMPILES without
 * running, which is the whole contract wanted here: nothing must execute (every
 * Daz global would be undefined, and the scripts have top-level side effects).
 * Cheap, and it covers the combinations no golden does. Add a variant here
 * whenever a change gives the export block a new shape.
 */

const FRAMES: PresetFrames = { base: 328, gp: 104, dk: 54, phys: 43 }

function group(id: string): RomGroup {
  return {
    id,
    label: '',
    suffix: 'centre',
    method: 'individual',
    calculateFrom: 'default',
    poses: [
      {
        id: `${id}-p1`,
        name: 'BodyTone',
        morphs: [{ id: `${id}-m1`, node: 'Genesis9', prop: 'body_bs_BodyTone', value: 1 }],
        boneScaleRef: false,
      },
    ],
  }
}

function allSections(): RomSections {
  const sections = defaultSections()
  for (const key of Object.keys(sections) as Array<keyof RomSections>) {
    sections[key].enabled = true
    if (sections[key].mode === 'custom') sections[key].groups = [group(`${key}-g1`)]
  }
  return sections
}

const SCENE = 'C:/DTH/Project/Electra.duf'

function make(extra: Record<string, unknown> = {}): Character {
  const now = '2026-06-11T00:00:00.000Z'
  return characterSchema.parse({
    id: 'electra-g9',
    name: 'Electra G9',
    createdAt: now,
    updatedAt: now,
    generation: 'G9',
    sections: allSections(),
    scenePath: SCENE,
    exportPath: 'C:/DTH/Export/Electra',
    ...extra,
  })
}

/** A scene override whose hair list arms the groom bracket around the export core. */
const withHair = { sceneOverrides: [{ scenePath: SCENE, hair: [{ nodeLabel: 'Hair A' }] }] }

describe('generated DAZ Script parses', () => {
  const variants: Array<[string, Character]> = [
    ['no export at all', make({ exportPath: '' })],
    ['export, no grooms', make()],
    // The hair pass ships in the hidden bulk carriers only (schema v38), and
    // generateAll emits those whenever an export dir is set — so this fixture
    // covers both the passless visible scripts and the carriers that inline it.
    ['grooms (hair pass rides the bulk carriers)', make(withHair)],
  ]

  for (const [name, character] of variants) {
    it(`parses every .dsa — ${name}`, () => {
      const files = generateAll(character, {}, FRAMES, 'C:/DTH/Project/.dcsmeta/c', '2.4.3')
      const scripts = files.filter((f) => f.fileName.endsWith('.dsa'))
      expect(scripts.length).toBeGreaterThan(0)
      for (const file of scripts) {
        expect(() => new Script(file.content), `${file.fileName} (${name})`).not.toThrow()
      }
    })
  }

  it('the groom variant really does emit the groom bracket AND the hair pass', () => {
    // Guards the guard: `hair` hangs off a SCENE OVERRIDE, not the character, so
    // a wrong fixture shape would parse identical no-groom scripts and report
    // the uncovered path as covered. The bracket lives in the export block, so
    // it is the Export_/bulk scripts that carry it — never the ROM_ one.
    const files = generateAll(make(withHair), {}, FRAMES)
    const standalone = files.find((f) => f.fileName.startsWith('Export_'))
    expect(standalone?.content).toContain('dthGroomHideTree')
    expect(standalone?.content).toContain('dthExportLanded')
    const bulk = files.find((f) => f.fileName === '.Bulk_ROM_Export.dsa')
    expect(bulk?.content).toContain('dthGroomHideTree')
    expect(bulk?.content).toContain('doExportAlembicGroomPoses')
  })

  it('would actually FAIL on a broken script', () => {
    // A syntax check that cannot fail is worse than none — it reads as coverage.
    expect(() => new Script('if (a) { print("x");')).toThrow()
  })
})
