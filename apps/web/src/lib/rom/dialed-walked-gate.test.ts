import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { runInNewContext } from 'node:vm'

import { describe, expect, it } from 'vitest'

/**
 * The dialed-walked-morph gate (runtime v82) — what it FAILS and what it spares.
 *
 * The gate exists because of a measured exporter fact (Female_G81, DS4 4.24,
 * exporter 2.0.2, 2026-08-17): the DTH Exporter's FBX pass excludes every
 * morph whose ROM keys VARY from the base mesh, while the alembic bakes the
 * true timeline. So a walked morph dialed non-zero at frame 0 can only ever
 * ship a drifting fbx/abc pair — the gate turns that into failed frames the
 * export gate refuses to export, instead of a silent drift.
 *
 * The shipped `DthUtils.dsa` runs for real in a sandbox (the same harness as
 * rom-key-interpolation.test.ts) over fake Daz nodes/properties. Properties
 * pinned here:
 *   1. a dialed walked morph fails EVERY frame that walks it, naming the value;
 *   2. a clean scene fails nothing, and dial noise below the tolerance passes;
 *   3. an ERC-driven dial says so, pointing the user at the CONTROLLING dial;
 *   4. an unresolvable prop is NOT the gate's failure (applyKeyData owns it);
 *   5. the art-direction leg: GP/DK art morphs never enter frameDatas, so
 *      applyArtDirectionData runs the same check per dial — reading the dial
 *      BEFORE keying the channel (keying destroys the evidence), reporting on
 *      the frame's ABSOLUTE frame number, and still applying the morph (the
 *      build continues; only the export is gated).
 */

const TICKS = 160

interface FailedMorph {
  frame: number
  node: string
  prop: string
  reason: string
}

interface RunLog {
  errors: Array<string>
  failedMorphs: Array<FailedMorph>
}

interface UtilsModule {
  checkDialedWalkedMorphs: (root: unknown, frameDatas: Array<unknown>) => number
  applyArtDirectionData: (json: unknown, root: unknown, startFrame: number) => boolean
  resetRunLog: () => void
  runLogProblemCount: () => number
  getRunLog: () => RunLog
}

/** A DzFloatProperty as far as the gate is concerned: a frame-0 scene value,
 *  an ERC controller count, and (for the art-direction leg) real keying. */
class FakeProp {
  name: string
  dial: number
  controllers: number
  /** Times `getValue(0)` was read — the gate must read a dial ONCE. */
  reads = 0
  /** setValue calls, as [frame, value] — proves a failed morph still applies. */
  writes: Array<[number, number]> = []

  constructor(name: string, dial: number, controllers = 0) {
    this.name = name
    this.dial = dial
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
  getValue(time: number) {
    if (time === 0) this.reads++
    return this.dial
  }
  setValue(time: number, value: number) {
    this.writes.push([time / TICKS, value])
  }
}

interface FakeNode {
  getName: () => string
  getLabel: () => string
  getObject: () => unknown
  findNodeChild: (n: string) => FakeNode | null
  findNodeChildByLabel: (n: string) => FakeNode | null
  findProperty: () => null
  findPropertyByLabel: () => null
}

/** A node whose object resolves `props` by modifier name — the primary lookup
 *  path (`getMorphPropFromNode`) both gate legs use. */
function fakeNode(name: string, props: Array<FakeProp>, children: Array<FakeNode> = []): FakeNode {
  const byName = new Map(props.map((p) => [p.name, p]))
  return {
    getName: () => name,
    getLabel: () => name,
    getObject: () => ({
      findModifier: (n: string) => {
        const prop = byName.get(n)
        return prop ? { getValueChannel: () => prop } : null
      },
      getNumModifiers: () => 0,
      getModifier: () => null,
    }),
    findNodeChild: (n: string) => children.find((c) => c.getName() === n) ?? null,
    findNodeChildByLabel: (n: string) => children.find((c) => c.getName() === n) ?? null,
    findProperty: () => null,
    findPropertyByLabel: () => null,
  }
}

/** One frameDatas slot the way processFrameDataJSON builds them. */
function walkFrame(frame: number, node: string, prop: string, value = 1) {
  return {
    frame,
    entry: {
      frameName: '',
      sectionName: '',
      keyDatas: [{ frameIdx: frame, nodeName: node, propName: prop, propValue: value }],
    },
  }
}

function loadUtils(): { utils: UtilsModule; printed: () => string } {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'runtime')
  const src = readFileSync(join(dir, 'DthUtils.dsa'), 'utf8')
  const lines: Array<string> = []
  const utils = runInNewContext(
    `${src}\n;({ checkDialedWalkedMorphs: checkDialedWalkedMorphs,` +
      ` applyArtDirectionData: applyArtDirectionData, resetRunLog: resetRunLog,` +
      ` runLogProblemCount: runLogProblemCount, getRunLog: function(){ return DTH_RUN_LOG; } })`,
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
  utils.resetRunLog()
  return { utils, printed: () => lines.join('\n') }
}

function gate(root: unknown, slots: Array<ReturnType<typeof walkFrame>>) {
  const { utils, printed } = loadUtils()
  const frameDatas: Array<unknown> = []
  for (const s of slots) frameDatas[s.frame] = s.entry
  const failed = utils.checkDialedWalkedMorphs(root, frameDatas)
  return { failed, log: utils.getRunLog(), problems: utils.runLogProblemCount(), printed: printed() }
}

describe('checkDialedWalkedMorphs — the frameDatas leg', () => {
  it('fails EVERY frame that walks a dialed morph, naming the value', () => {
    const dialed = new FakeProp('FBMHeavy', 0.5)
    const root = fakeNode('Genesis9', [dialed])
    const { failed, log, problems } = gate(root, [
      walkFrame(330, 'Genesis9', 'FBMHeavy'),
      walkFrame(345, 'Genesis9', 'FBMHeavy'),
    ])

    // Per WALKING FRAME, not per dial — that is what turns the studio's frame
    // markers red on exactly the frames that would drift.
    expect(failed).toBe(2)
    expect(log.failedMorphs.map((f) => f.frame)).toEqual([330, 345])
    expect(log.failedMorphs[0].prop).toBe('FBMHeavy')
    expect(log.failedMorphs[0].reason).toContain('dialed at 0.5')
    // failedMorphs count as run problems, which is what skips the export.
    expect(problems).toBe(2)
    // The dial itself is read once — the verdict is cached per dial.
    expect(dialed.reads).toBe(1)
  })

  it('passes a clean scene, dial noise below the tolerance, and a negative dial fails too', () => {
    const clean = new FakeProp('FBMPearFigure', 0)
    const noise = new FakeProp('FBMHeavy', 0.0005)
    const negative = new FakeProp('FBMEmaciated', -0.5)
    const root = fakeNode('Genesis9', [clean, noise, negative])
    const { failed, log, printed } = gate(root, [
      walkFrame(330, 'Genesis9', 'FBMPearFigure'),
      walkFrame(331, 'Genesis9', 'FBMHeavy'),
      walkFrame(332, 'Genesis9', 'FBMEmaciated'),
    ])

    expect(failed).toBe(1)
    expect(log.failedMorphs.map((f) => f.prop)).toEqual(['FBMEmaciated'])
    expect(log.failedMorphs[0].reason).toContain('dialed at -0.5')
    expect(printed).toContain('1 frame morph(s) failed')
  })

  it('names an ERC-driven dial so the user zeroes the CONTROLLING dial', () => {
    const driven = new FakeProp('body_bs_LegsLength', 0.3, 2)
    const root = fakeNode('Genesis9', [driven])
    const { log } = gate(root, [walkFrame(400, 'Genesis9', 'body_bs_LegsLength')])

    expect(log.failedMorphs[0].reason).toContain('DRIVEN - zero the controlling dial')
  })

  it('does not fail an unresolvable prop — applyKeyData owns that report', () => {
    const root = fakeNode('Genesis9', [])
    const { failed, problems, printed } = gate(root, [walkFrame(330, 'Genesis9', 'NoSuchMorph')])

    expect(failed).toBe(0)
    expect(problems).toBe(0)
    expect(printed).toContain('all walked morphs are at 0')
  })
})

describe('applyArtDirectionData — the art-direction leg of the gate', () => {
  const artJson = (frames: Array<{ frame: number; prop: string; value?: number }>) => ({
    frames: frames.map((f, i) => ({
      frame: f.frame,
      name: `Art${i}`,
      morphs: [{ node: 'GoldenPalace_G9', prop: f.prop, value: f.value ?? 0.8 }],
    })),
  })

  it('fails a dialed art-direction morph on its ABSOLUTE frame — and still applies it', () => {
    const dialed = new FakeProp('GP_Vagina_Open', 0.4)
    const gp = fakeNode('GoldenPalace_G9', [dialed])
    const root = fakeNode('Genesis9', [], [gp])
    const { utils } = loadUtils()

    utils.applyArtDirectionData(artJson([{ frame: 96, prop: 'GP_Vagina_Open' }]), root, 500)

    const log = utils.getRunLog()
    expect(log.failedMorphs).toHaveLength(1)
    expect(log.failedMorphs[0].frame).toBe(596) // startFrame + art frame
    expect(log.failedMorphs[0].reason).toContain('dialed at 0.4')
    expect(utils.runLogProblemCount()).toBe(1)
    // The build continues: the sawtooth is still keyed (floor 0, spike 0.8) —
    // only the EXPORT is gated, so one run reports every offender.
    expect(dialed.writes).toEqual([
      [595, 0],
      [597, 0],
      [596, 0.8],
    ])
    // The dial was read BEFORE those writes could destroy the evidence — once.
    expect(dialed.reads).toBe(1)
  })

  it('reports each art frame walking the same dialed morph, reading the dial once', () => {
    const dialed = new FakeProp('GP_Spread', 0.4)
    const gp = fakeNode('GoldenPalace_G9', [dialed])
    const root = fakeNode('Genesis9', [], [gp])
    const { utils } = loadUtils()

    utils.applyArtDirectionData(
      artJson([
        { frame: 96, prop: 'GP_Spread' },
        { frame: 100, prop: 'GP_Spread' },
      ]),
      root,
      500,
    )

    expect(utils.getRunLog().failedMorphs.map((f) => f.frame)).toEqual([596, 600])
    // Cached verdict: the second frame must NOT re-read the (by then keyed) dial.
    expect(dialed.reads).toBe(1)
  })

  it('a clean art-direction morph applies without a single failure', () => {
    const clean = new FakeProp('GP_Vagina_Open', 0)
    const gp = fakeNode('GoldenPalace_G9', [clean])
    const root = fakeNode('Genesis9', [], [gp])
    const { utils } = loadUtils()

    utils.applyArtDirectionData(artJson([{ frame: 96, prop: 'GP_Vagina_Open' }]), root, 500)

    expect(utils.getRunLog().failedMorphs).toEqual([])
    expect(utils.runLogProblemCount()).toBe(0)
    expect(clean.writes).toHaveLength(3)
  })
})
