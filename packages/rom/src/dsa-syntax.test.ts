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

  /**
   * A runtime-less carrier may not CALL what only the runtime defines.
   *
   * `new Script` above compiles; it cannot see that `dthFoo()` resolves to
   * nothing at run time. And the runtime-less carriers are exactly where that
   * bites hardest: `Export_<name>.dsa` and `.Bulk_Export_Only.dsa` carry NO
   * `include()` at all (deliberately — they must run after the ROM without a
   * runtime install), so a helper borrowed from DthUtils.dsa is a
   * ReferenceError thrown right after a SUCCESSFUL export, before
   * dthFinishPreviousSet runs. That leaves the previous set's `.dthprev`
   * backups standing, and the next run's sweep then reads them as the newest
   * finished copy and deletes the good live export beside them (the v99 corpse
   * rule). Caught in review on runtime v102's motion-summary gate.
   */
  const INCLUDE_RE = /^[^\n]*\binclude\s*\(/m

  for (const [name, character] of variants) {
    it(`a runtime-less carrier defines everything it calls — ${name}`, () => {
      const files = generateAll(character, {}, FRAMES, 'C:/DTH/Project/.dcsmeta/c', '2.4.3')
      const carriers = files
        .filter((f) => f.fileName.endsWith('.dsa'))
        .filter((f) => !INCLUDE_RE.test(f.content))
      // Not asserted non-empty here — the export-less variant emits none. The
      // guard test below pins that the export variants really do produce them.
      for (const file of carriers) {
        // Comments name helpers in prose; only real code counts.
        const code = file.content.replace(/^\s*\/\/.*$/gm, '')
        const defined = new Set<string>()
        for (const m of code.matchAll(/(?:function\s+(dth\w+)\s*\(|var\s+(dth\w+)\s*=\s*function)/g)) {
          defined.add(m[1] ?? m[2])
        }
        const called = new Set<string>()
        // `.dthFoo(` is a method on some object, not a free helper.
        for (const m of code.matchAll(/(^|[^\w.])(dth\w+)\s*\(/g)) called.add(m[2])
        const missing = [...called].filter((n) => !defined.has(n))
        expect(missing, `${file.fileName} (${name}) calls undefined helper(s)`).toEqual([])
      }
    })
  }

  it('the runtime-less carrier check really does see the export carriers', () => {
    // Guards the guard: if generateAll ever stopped emitting an include-free
    // carrier, the loop above would pass vacuously on an empty list.
    const files = generateAll(make(), {}, FRAMES, 'C:/DTH/Project/.dcsmeta/c', '2.4.3')
    const carriers = files.filter((f) => f.fileName.endsWith('.dsa') && !INCLUDE_RE.test(f.content))
    const names = carriers.map((f) => f.fileName)
    expect(names).toContain('Export_ElectraG9_G9.dsa')
    expect(names.some((n) => n.indexOf('Bulk_Export_Only') >= 0)).toBe(true)
    // And they really are the ones that run the exporter's motion audit.
    for (const f of carriers) {
      if (f.fileName.indexOf('Hair') >= 0) continue
      expect(f.content, f.fileName).toContain('dthMotionSummaryVerdict(')
    }
  })

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
