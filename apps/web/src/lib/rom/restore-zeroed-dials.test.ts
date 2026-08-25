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
 * The shipped `DthUtils.dsa` runs for real in a sandbox (the same harness as
 * dialed-walked-gate.test.ts) over fake Daz nodes/properties. Properties
 * pinned here:
 *   1. a dialed channel the preset zeroed flat is flattened back to its
 *      pre-ROM baseline, on every key;
 *   2. a genuinely WALKED channel (any non-zero key) is never touched — no
 *      ROM information can be lost;
 *   3. a channel whose baseline is 0, or that the preset never keyed, is
 *      untouched;
 *   4. an ERC-driven channel is skipped — its master restores it, and a raw
 *      restore would double-apply;
 *   5. end to end with memorizeBaseMorphs: snapshot → preset stomp → restore.
 */

const TICKS = 160

interface UtilsModule {
  memorizeBaseMorphs: (nodes: Array<unknown>) => Record<string, number>
  restoreZeroedDials: (nodes: Array<unknown>, baseline: Record<string, number>) => number
}

/** A DzFloatProperty as far as the pass is concerned: a dial value, ERC
 *  controller count, and a real key list `setValue(t, v)` writes through. */
class FakeProp {
  name: string
  dial: number
  controllers: number
  /** [time, value] pairs, kept sorted by time. */
  keys: Array<[number, number]>

  constructor(name: string, dial: number, keys: Array<[number, number]> = [], controllers = 0) {
    this.name = name
    this.dial = dial
    this.keys = [...keys].sort((a, b) => a[0] - b[0])
    this.controllers = controllers
  }

  getName() {
    return this.name
  }
  getLabel() {
    return `${this.name} label`
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

/** A node whose object enumerates DzMorph modifiers — the iteration path
 *  memorizeBaseMorphs and restoreZeroedDials share. */
function morphNode(name: string, props: Array<FakeProp>) {
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
  }
}

function loadUtils(): { utils: UtilsModule; printed: () => string } {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'runtime')
  const src = readFileSync(join(dir, 'DthUtils.dsa'), 'utf8')
  const lines: Array<string> = []
  const utils = runInNewContext(
    `${src}\n;({ memorizeBaseMorphs: memorizeBaseMorphs, restoreZeroedDials: restoreZeroedDials })`,
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

    const restored = utils.restoreZeroedDials([root], { 'body_ctrl_BreastsUp-Down': 1 })

    expect(restored).toBe(1)
    expect(breasts.keys.map(([, v]) => v)).toEqual([1, 1, 1, 1])
    // The keys the preset wrote are rewritten in place — none added, none lost.
    expect(breasts.keys.map(([t]) => t)).toEqual([0, 2 * TICKS, 3 * TICKS, 105 * TICKS])
    expect(printed()).toContain('Restored zeroed dial: body_ctrl_BreastsUp-Down label back to 1')
  })

  it('never touches a walked channel — one non-zero key disqualifies it', () => {
    const { utils } = loadUtils()
    const walked = new FakeProp('FBMHeavy', 0, [
      [0, 0],
      [330 * TICKS, 1],
      [331 * TICKS, 0],
    ])
    const root = morphNode('Genesis9', [walked])

    const restored = utils.restoreZeroedDials([root], { FBMHeavy: 0.5 })

    expect(restored).toBe(0)
    expect(walked.keys.map(([, v]) => v)).toEqual([0, 1, 0])
  })

  it('skips a zero baseline, an unkeyed channel, and baseline noise below the tolerance', () => {
    const { utils } = loadUtils()
    const zeroBase = new FakeProp('body_ctrl_BreastsSide-Side', 0, stompKeys())
    const untouched = new FakeProp('FBMPearFigure', 0.4)
    const noise = new FakeProp('body_ctrl_BreastsIn-Out', 0, stompKeys())
    const root = morphNode('Genesis9', [zeroBase, untouched, noise])

    const restored = utils.restoreZeroedDials([root], {
      'body_ctrl_BreastsSide-Side': 0,
      FBMPearFigure: 0.4,
      'body_ctrl_BreastsIn-Out': 0.00005,
    })

    expect(restored).toBe(0)
    expect(zeroBase.keys.map(([, v]) => v)).toEqual([0, 0, 0, 0])
    expect(untouched.keys).toEqual([])
    expect(noise.keys.map(([, v]) => v)).toEqual([0, 0, 0, 0])
  })

  it('skips an ERC-driven channel — the master restores it', () => {
    const { utils } = loadUtils()
    const master = new FakeProp('body_ctrl_BreastsUp-Down', 0, stompKeys())
    const drivenHalf = new FakeProp('body_ctrl_lBreastUp-Down', 0, stompKeys(), 1)
    const root = morphNode('Genesis9', [master, drivenHalf])

    const restored = utils.restoreZeroedDials([root], {
      'body_ctrl_BreastsUp-Down': 1,
      'body_ctrl_lBreastUp-Down': 1,
    })

    expect(restored).toBe(1)
    expect(master.keys.map(([, v]) => v)).toEqual([1, 1, 1, 1])
    expect(drivenHalf.keys.map(([, v]) => v)).toEqual([0, 0, 0, 0])
  })

  it('round-trips with memorizeBaseMorphs: snapshot, preset stomp, restore', () => {
    const { utils } = loadUtils()
    const breasts = new FakeProp('body_ctrl_BreastsUp-Down', 1)
    const clean = new FakeProp('body_ctrl_BreastsFlatten', 0)
    const root = morphNode('Genesis9', [breasts, clean])

    const baseline = utils.memorizeBaseMorphs([root])
    expect(baseline).toEqual({ 'body_ctrl_BreastsUp-Down': 1, 'body_ctrl_BreastsFlatten': 0 })

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
