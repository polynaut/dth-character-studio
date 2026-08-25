import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { runInNewContext } from 'node:vm'

import { describe, expect, it } from 'vitest'

/**
 * restoreZeroedDials (runtime v101) — dials a ROM preset zeroed FLAT come back.
 *
 * The pass exists because of a measured preset fact (DTH 2.5, 2026-08-25):
 * every G9 base-ROM `.duf` carries ~698 all-zero value channels — all 13 stock
 * breast pose controls among them, keyed to 0 with CONSTANT keys at frames
 * 0/2/3/105 — an accidental capture of the preset author's zeroed scene. The
 * G8/G8.1 base ROMs carry none, which is why the v35/v83 preserve-morphs
 * retirement premise ("DTH holds morph values across the ROM load") held on
 * G8 and failed on G9: no hold survives an explicit key inside a loaded
 * preset.
 *
 * The baseline is a RAW snapshot (memorizeRawDials): getRawValue keeps any
 * ERC contribution out of the stored number, so restoring writes back only
 * what the user dialed — a driven channel's controller share rides on top
 * again by itself. Only a Daz build WITHOUT getRawValue falls back to the
 * evaluated value + skip-driven behaviour.
 *
 * The shipped `DthUtils.dsa` runs for real in a sandbox (the same harness as
 * dialed-walked-gate.test.ts) over fake Daz nodes/properties. Properties
 * pinned here:
 *   1. a dialed channel the preset zeroed flat is flattened back to its
 *      pre-ROM baseline, on every key;
 *   2. a genuinely WALKED channel (any non-zero key) is never touched — no
 *      ROM information can be lost;
 *   3. a channel whose baseline is 0, or that the preset never keyed, is
 *      untouched;
 *   4. with a raw snapshot, a dialed channel is restored even when it HAS
 *      controllers (raw restores raw — no double-apply is possible), and a
 *      purely driven half (raw 0) is never a candidate;
 *   5. the no-getRawValue fallback skips driven channels, loudly;
 *   6. end to end with memorizeRawDials: snapshot → preset stomp → restore.
 */

const TICKS = 160

interface RawSnapshot {
  raw: boolean
  values: Record<string, number>
}

interface UtilsModule {
  memorizeRawDials: (nodes: Array<unknown>) => RawSnapshot
  restoreZeroedDials: (nodes: Array<unknown>, baseline: RawSnapshot) => number
}

/** A DzFloatProperty as far as the pass is concerned: a raw dial value, an
 *  ERC controller count, and a real key list `setValue(t, v)` writes through.
 *  `hasRawValue: false` models an old Daz build without getRawValue. */
class FakeProp {
  name: string
  dial: number
  controllers: number
  /** [time, value] pairs, kept sorted by time. */
  keys: Array<[number, number]>
  /** Parameter-group path — only read on the node-property route. */
  path: string
  getRawValue?: () => number

  constructor(
    name: string,
    dial: number,
    keys: Array<[number, number]> = [],
    controllers = 0,
    hasRawValue = true,
    path = '/Pose Controls/Torso/Feminine',
  ) {
    this.path = path
    this.name = name
    this.dial = dial
    this.keys = [...keys].sort((a, b) => a[0] - b[0])
    this.controllers = controllers
    if (hasRawValue) this.getRawValue = () => this.dial
  }

  getName() {
    return this.name
  }
  getLabel() {
    return `${this.name} label`
  }
  getPath() {
    return this.path
  }
  inherits(type: string) {
    return type === 'DzFloatProperty'
  }
  getNumControllers() {
    return this.controllers
  }
  getValue(_time: number) {
    return this.dial
  }
  getNumKeys() {
    return this.keys.length
  }
  getKeyTime(i: number) {
    return this.keys[i][0]
  }
  getKeyValue(i: number) {
    return this.keys[i][1]
  }
  setValue(time: number, value: number) {
    const existing = this.keys.find((k) => k[0] === time)
    if (existing) existing[1] = value
    else {
      this.keys.push([time, value])
      this.keys.sort((a, b) => a[0] - b[0])
    }
  }
}

/** A node whose object enumerates DzMorph modifiers AND that owns node
 *  properties — the two routes forEachZeroableDial visits. G9 pose controls
 *  are node-owned (measured 2026-08-25), so `nodeProps` is the route the
 *  reported dial actually takes. */
function morphNode(name: string, props: Array<FakeProp>, nodeProps: Array<FakeProp> = []) {
  const mods = props.map((p) => ({
    getName: () => p.name,
    inherits: (t: string) => t === 'DzMorph',
    getValueControl: () => p,
  }))
  return {
    getName: () => name,
    getLabel: () => name,
    getObject: () => ({
      getNumModifiers: () => mods.length,
      getModifier: (i: number) => mods[i] ?? null,
    }),
    getNumProperties: () => nodeProps.length,
    getProperty: (i: number) => nodeProps[i] ?? null,
  }
}

function loadUtils(): { utils: UtilsModule; printed: () => string } {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'runtime')
  const src = readFileSync(join(dir, 'DthUtils.dsa'), 'utf8')
  const lines: Array<string> = []
  const utils = runInNewContext(
    `${src}\n;({ memorizeRawDials: memorizeRawDials, restoreZeroedDials: restoreZeroedDials })`,
    {
      print: (...args: Array<unknown>) => lines.push(args.map(String).join(' ')),
      Math,
      Date,
      JSON,
      DzFloatProperty: { LINEAR_INTERP: 0, CONSTANT_INTERP: 1, TCB_INTERP: 2 },
      DzProperty: { InterpLinear: 0, InterpConstant: 1 },
      Scene: {
        setDefaultKeyInterpolationType: () => {},
        getTimeStep: () => TICKS,
      },
    },
  ) as UtilsModule
  return { utils, printed: () => lines.join('\n') }
}

function raw(values: Record<string, number>, rawFlag = true): RawSnapshot {
  return { raw: rawFlag, values }
}

/** The measured stomp: CONSTANT zero keys at frames 0/2/3/105 (in ticks). */
const stompKeys = (): Array<[number, number]> => [
  [0, 0],
  [2 * TICKS, 0],
  [3 * TICKS, 0],
  [105 * TICKS, 0],
]

describe('restoreZeroedDials', () => {
  it('flattens a zeroed-flat dialed channel back to its baseline, on every key', () => {
    const { utils, printed } = loadUtils()
    const breasts = new FakeProp('body_ctrl_BreastsUp-Down', 0, stompKeys())
    const root = morphNode('Genesis9', [breasts])

    const restored = utils.restoreZeroedDials([root], raw({ 'mod|body_ctrl_BreastsUp-Down': 1 }))

    expect(restored).toBe(1)
    expect(breasts.keys.map(([, v]) => v)).toEqual([1, 1, 1, 1])
    // The keys the preset wrote are rewritten in place — none added, none lost.
    expect(breasts.keys.map(([t]) => t)).toEqual([0, 2 * TICKS, 3 * TICKS, 105 * TICKS])
    expect(printed()).toContain('Restored zeroed dial: body_ctrl_BreastsUp-Down label back to 1')
  })

  it('never touches a walked channel — one non-zero key disqualifies it, and says so', () => {
    const { utils, printed } = loadUtils()
    const walked = new FakeProp('FBMHeavy', 0, [
      [0, 0],
      [330 * TICKS, 1],
      [331 * TICKS, 0],
    ])
    const root = morphNode('Genesis9', [walked])

    const restored = utils.restoreZeroedDials([root], raw({ 'mod|FBMHeavy': 0.5 }))

    expect(restored).toBe(0)
    expect(walked.keys.map(([, v]) => v)).toEqual([0, 1, 0])
    // The rejection names its evidence — six silent ones made a live run
    // undiagnosable (2026-08-25).
    expect(printed()).toContain('Zeroed-dial candidate left alone: FBMHeavy label dialed at 0.5')
  })

  it('names a keyed dial that is visible only through ERC (raw ~0) instead of skipping it silently', () => {
    const { utils, printed } = loadUtils()
    const driven = new FakeProp('body_ctrl_BreastsUp-Down', 0, stompKeys(), 2)
    const root = morphNode('Genesis9', [driven])

    const restored = utils.restoreZeroedDials([root], {
      raw: true,
      values: { 'mod|body_ctrl_BreastsUp-Down': 0 },
      evals: { 'mod|body_ctrl_BreastsUp-Down': 1 },
    } as never)

    expect(restored).toBe(0)
    expect(driven.keys.map(([, v]) => v)).toEqual([0, 0, 0, 0])
    expect(printed()).toContain('Zeroed dial (driven): body_ctrl_BreastsUp-Down label was visible at 1 but raw 0')
  })

  it('skips a zero baseline, an unkeyed channel, and baseline noise below the tolerance', () => {
    const { utils, printed } = loadUtils()
    const zeroBase = new FakeProp('body_ctrl_BreastsSide-Side', 0, stompKeys())
    const untouched = new FakeProp('FBMPearFigure', 0.4)
    const noise = new FakeProp('body_ctrl_BreastsIn-Out', 0, stompKeys())
    const root = morphNode('Genesis9', [zeroBase, untouched, noise])

    const restored = utils.restoreZeroedDials(
      [root],
      raw({
        'mod|body_ctrl_BreastsSide-Side': 0,
        'mod|FBMPearFigure': 0.4,
        'mod|body_ctrl_BreastsIn-Out': 0.00005,
      }),
    )

    expect(restored).toBe(0)
    expect(zeroBase.keys.map(([, v]) => v)).toEqual([0, 0, 0, 0])
    expect(untouched.keys).toEqual([])
    expect(noise.keys.map(([, v]) => v)).toEqual([0, 0, 0, 0])
    // The summary counts make a 0 diagnosable from the log alone.
    expect(printed()).toContain('1 dialed of 3 morph channel(s)')
  })

  it('with a raw snapshot, controllers do not block a dialed channel — and a driven half (raw 0) is no candidate', () => {
    const { utils } = loadUtils()
    // The reported live case: products wire ERC into the stock master, so it
    // HAS controllers — but the user's 100% is raw, and raw restores raw.
    const master = new FakeProp('body_ctrl_BreastsUp-Down', 0, stompKeys(), 2)
    const drivenHalf = new FakeProp('body_ctrl_lBreastUp-Down', 0, stompKeys(), 1)
    const root = morphNode('Genesis9', [master, drivenHalf])

    const restored = utils.restoreZeroedDials(
      [root],
      raw({
        'mod|body_ctrl_BreastsUp-Down': 1, // raw — dialed by the user
        'mod|body_ctrl_lBreastUp-Down': 0, // raw — its 100% was all ERC
      }),
    )

    expect(restored).toBe(1)
    expect(master.keys.map(([, v]) => v)).toEqual([1, 1, 1, 1])
    expect(drivenHalf.keys.map(([, v]) => v)).toEqual([0, 0, 0, 0])
  })

  it('the no-getRawValue fallback skips a driven channel, loudly, and still restores an undriven one', () => {
    const { utils, printed } = loadUtils()
    const driven = new FakeProp('body_ctrl_BreastsUp-Down', 0, stompKeys(), 2, false)
    const undriven = new FakeProp('body_ctrl_BreastsFlatten', 0, stompKeys(), 0, false)
    const root = morphNode('Genesis9', [driven, undriven])

    const restored = utils.restoreZeroedDials(
      [root],
      raw({ 'mod|body_ctrl_BreastsUp-Down': 1, 'mod|body_ctrl_BreastsFlatten': 0.6 }, false),
    )

    expect(restored).toBe(1)
    expect(driven.keys.map(([, v]) => v)).toEqual([0, 0, 0, 0])
    expect(undriven.keys.map(([, v]) => v)).toEqual([0.6, 0.6, 0.6, 0.6])
    expect(printed()).toContain('no getRawValue - skipped')
    expect(printed()).toContain('1 skipped as driven')
  })

  // The workflow is not executed in this sandbox, so its call site can drift
  // from the function's contract without any test noticing — which is exactly
  // what happened live on 2026-08-25: the workflow still passed the plain
  // memorizeBaseMorphs map, the .values guard early-returned, and the pass
  // silently did nothing. Pin the wiring textually.
  it('ApplyDTHWorkflow feeds the pass the RAW snapshot, not the close-out map', () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), 'runtime')
    const workflow = readFileSync(join(dir, 'DthWorkflow.dsa'), 'utf8')
    expect(workflow).toContain('var baseRawDials = memorizeRawDials([oNodeRoot])')
    expect(workflow).toContain('restoreZeroedDials([oNodeRoot], baseRawDials)')
    expect(workflow).not.toMatch(/restoreZeroedDials\(\[oNodeRoot\], baseMorphValues\)/)
  })

  // THE live case (measured 2026-08-25, DS4 probe): G9 pose controls are
  // node-owned properties under /Pose Controls — findModifier returns null
  // for them, so the modifier route alone missed the reported dial through
  // three diagnostic runs. The node route must see them; the /Pose Controls
  // path gate must keep transforms and other node floats out.
  it('restores a NODE-OWNED pose control, and the path gate excludes non-pose node floats', () => {
    const { utils, printed } = loadUtils()
    const poseCtrl = new FakeProp('body_ctrl_BreastsUp-Down', 0, stompKeys())
    const transform = new FakeProp('YTranslate', 0, stompKeys(), 0, true, '/General/Transforms')
    const root = morphNode('Genesis9', [], [poseCtrl, transform])

    const baseline = utils.memorizeRawDials([root])
    expect(baseline.values).toEqual({ 'prop|body_ctrl_BreastsUp-Down': 0 })

    const restored = utils.restoreZeroedDials(
      [root],
      raw({ 'prop|body_ctrl_BreastsUp-Down': 1, 'prop|YTranslate': 5 }),
    )

    expect(restored).toBe(1)
    expect(poseCtrl.keys.map(([, v]) => v)).toEqual([1, 1, 1, 1])
    // Even with a (hypothetical) dialed baseline, the transform is never
    // visited — the path gate keeps the pass out of /General.
    expect(transform.keys.map(([, v]) => v)).toEqual([0, 0, 0, 0])
    expect(printed()).toContain('Restored zeroed dial: body_ctrl_BreastsUp-Down label back to 1')
  })

  it('round-trips with memorizeRawDials: snapshot, preset stomp, restore', () => {
    const { utils } = loadUtils()
    const breasts = new FakeProp('body_ctrl_BreastsUp-Down', 1)
    const clean = new FakeProp('body_ctrl_BreastsFlatten', 0)
    const root = morphNode('Genesis9', [breasts, clean])

    const baseline = utils.memorizeRawDials([root])
    expect(baseline.raw).toBe(true)
    expect(baseline.values).toEqual({
      'mod|body_ctrl_BreastsUp-Down': 1,
      'mod|body_ctrl_BreastsFlatten': 0,
    })

    // The preset load: explicit zero keys land, the evaluated dial reads 0.
    for (const p of [breasts, clean]) {
      p.keys = stompKeys()
      p.dial = 0
    }

    const restored = utils.restoreZeroedDials([root], baseline)

    expect(restored).toBe(1)
    expect(breasts.keys.map(([, v]) => v)).toEqual([1, 1, 1, 1])
    expect(clean.keys.map(([, v]) => v)).toEqual([0, 0, 0, 0])
  })
})
