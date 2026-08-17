import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { runInNewContext } from 'node:vm'

import { describe, expect, it } from 'vitest'

import { parseRomRunLogText } from './run-log.ts'

/**
 * The LINEAR key-interpolation pass — what it BLOCKS and what it can NAME.
 *
 * Both halves are regressions from a measured failure (LaraCroft_G81, DS 4.24,
 * 2026-08-16): a ROM run reported `4 of 7968 key(s) would not read back LINEAR`,
 * that line was a run-log ERROR, an error makes `ApplyDTHCharacter` return
 * false, and the generated script's export gate then skipped the export
 * entirely. The row still said `done`. Nothing named the 4 keys, so there was
 * nothing to chase — not the node, not the dial, not the frame.
 *
 * So the two properties pinned here are:
 *   1. an interpolation failure WARNS and the run stays exportable, while a lost
 *      VALUE still fails the run (that one makes a pose frame wrong);
 *   2. every unfixable key is named — node, dial, key index, FRAME, and the
 *      interpolation Daz actually reports — in the run log the studio reads.
 *
 * The shipped `DthUtils.dsa` runs for real in a sandbox over fake Daz property
 * objects whose behaviour is the MEASURED behaviour: `setKeyInterpolationType`
 * does nothing, `setValue` is what rewrites a key, and a channel that cannot
 * move its value never gets rewritten at all (see .ai/gotchas-daz.md).
 */

/** Ticks per frame — a real Daz time step, so "frame 88" has to be derived and
 *  cannot accidentally pass by reading a raw tick count back out. */
const TICKS = 160

interface KeyProblem {
  kind: string
  node: string
  prop: string
  propLabel?: string
  path?: string
  key: number
  /** How many keys the channel holds — one key spans nothing. */
  keys: number
  frame: number
  interp: string
  reason: string
}

interface RunLog {
  errors: Array<string>
  warnings: Array<string>
  keyProblems: Array<KeyProblem>
}

interface UtilsModule {
  setLinearInterp: (nodes: Array<unknown>) => void
  resetRunLog: () => void
  runLogProblemCount: () => number
  getRunLog: () => RunLog
}

const LINEAR = 0
const CONSTANT = 1

/**
 * How a channel misbehaves. Each mode is one of the outcomes the pass
 * distinguishes, modelled at the `setValue` level rather than faked at the
 * result level — so the sandbox exercises the real decision tree.
 */
type Mode =
  /** setValue rewrites value AND interpolation: the pass works. */
  | 'normal'
  /** Locked/driven: the value cannot move, so Daz never rewrites the key. */
  | 'locked'
  /** The value moves (so the key IS rewritten) and the interpolation never lands. */
  | 'stubborn'
  /** The value cannot be put back — the one outcome that corrupts a pose frame. */
  | 'lossy'

interface FakeKey {
  time: number
  value: number
  interp: number
}

/** A DzFloatProperty, as far as this pass is concerned. */
class FakeProp {
  name: string
  mode: Mode
  keys: Array<FakeKey>
  controllers: number

  constructor(name: string, mode: Mode, frames: Array<number>, controllers = 0) {
    this.name = name
    this.mode = mode
    this.controllers = controllers
    // Every key starts CONSTANT — how a ROM's preset-loaded keys really arrive.
    this.keys = frames.map((f) => ({ time: f * TICKS, value: 1, interp: CONSTANT }))
  }

  getName() {
    return this.name
  }
  getLabel() {
    return `${this.name} label`
  }
  getPath() {
    return '/Pose Controls/Head'
  }
  inherits(type: string) {
    return type === 'DzFloatProperty'
  }
  getNumKeys() {
    return this.keys.length
  }
  getKeyTime(i: number) {
    return this.keys[i].time
  }
  getKeyValue(i: number) {
    return this.keys[i].value
  }
  getKeyInterpolationType(i: number) {
    return this.keys[i].interp
  }
  /** Measured on DS 4.24: zero of 7747 keys changed. It is called and ignored. */
  setKeyInterpolationType() {}
  getNumControllers() {
    return this.controllers
  }
  getValue(time: number) {
    const key = this.keys.find((k) => k.time === time)
    return key ? key.value : this.keys[0].value
  }
  setValue(time: number, value: number, interp?: number) {
    if (this.mode === 'locked') return // min == max — nothing to move
    // A channel that will not hold what it is given: every write lands half a
    // unit off, so the restore can never succeed.
    const stored = this.mode === 'lossy' ? value + 0.5 : value
    const key = this.keys.find((k) => k.time === time)
    if (!key) {
      this.keys.push({ time, value: stored, interp: interp ?? LINEAR })
      this.keys.sort((a, b) => a.time - b.time)
      return
    }
    key.value = stored
    if (this.mode !== 'stubborn' && interp !== undefined) key.interp = interp
  }
}

/** A node carrying `props`, optionally parented (so the reported path has depth). */
function fakeNode(name: string, props: Array<FakeProp>, parent: unknown = null) {
  return {
    getName: () => name,
    getNodeParent: () => parent,
    getObject: () => null,
    getNumProperties: () => props.length,
    getProperty: (i: number) => props[i],
  }
}

/** Load the shipped runtime with just enough Daz around it, and run the pass. */
function runPass(nodes: Array<unknown>): { log: RunLog; problems: number; printed: string } {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'runtime')
  const src = readFileSync(join(dir, 'DthUtils.dsa'), 'utf8')
  const lines: Array<string> = []
  const utils = runInNewContext(
    `${src}\n;({ setLinearInterp: setLinearInterp, resetRunLog: resetRunLog,` +
      ` runLogProblemCount: runLogProblemCount, getRunLog: function(){ return DTH_RUN_LOG; } })`,
    {
      print: (...args: Array<unknown>) => lines.push(args.map(String).join(' ')),
      Math,
      Date,
      JSON,
      // The two enum spellings this build defines (both measured to exist on
      // DS 4.24, both 0 for LINEAR).
      DzFloatProperty: { LINEAR_INTERP: LINEAR, CONSTANT_INTERP: CONSTANT, TCB_INTERP: 2 },
      DzProperty: { InterpLinear: LINEAR, InterpConstant: CONSTANT },
      Scene: {
        setDefaultKeyInterpolationType: () => {},
        getTimeStep: () => TICKS,
      },
    },
  ) as UtilsModule
  utils.resetRunLog()
  utils.setLinearInterp(nodes)
  return { log: utils.getRunLog(), problems: utils.runLogProblemCount(), printed: lines.join('\n') }
}

describe('the LINEAR interpolation pass decides what may stop an export', () => {
  it('does NOT block the export for keys that keep the wrong interpolation', () => {
    // The measured failure, in miniature: one channel out of several whose keys
    // are rewritten and still do not read back LINEAR.
    const good = new FakeProp('CTRLSmile', 'normal', [0, 44])
    const bad = new FakeProp('facs_bs_MouthOpen', 'stubborn', [0, 88])
    const { log, problems } = runPass([fakeNode('Genesis9', [good, bad])])

    // THE regression: a run problem is what makes ApplyDTHCharacter return
    // false, which is what makes the generated script skip the export. Zero of
    // them here — the character's Houdini side is not held hostage by 2 keys.
    expect(problems).toBe(0)
    expect(log.errors).toEqual([])
    expect(log.warnings.join('\n')).toContain('would not read back LINEAR')
    // And the good channel really was fixed, so the fake isn't just inert.
    expect(good.keys.map((k) => k.interp)).toEqual([LINEAR, LINEAR])
  })

  it('DOES block the export when a key lost its value', () => {
    // The one outcome that makes a POSE FRAME wrong rather than the motion
    // between two of them. It must stay fatal.
    const lossy = new FakeProp('CTRLHeadTurn', 'lossy', [0, 12])
    const { log, problems } = runPass([fakeNode('Genesis9', [lossy])])

    expect(problems).toBeGreaterThan(0)
    expect(log.errors.join('\n')).toContain('could not be restored to their original value')
    expect(log.keyProblems.some((k) => k.kind === 'value-lost')).toBe(true)
  })

  it('treats a build that cannot read interpolation back as unverified, not failed', () => {
    // "This Daz cannot answer the question" is not evidence of a bad answer —
    // and blocking on it would make such a build unable to export at all.
    const prop = new FakeProp('CTRLSmile', 'normal', [0, 44])
    // @ts-expect-error — deliberately removing the API this Daz build lacks.
    prop.getKeyInterpolationType = undefined
    const { log, problems } = runPass([fakeNode('Genesis9', [prop])])

    expect(problems).toBe(0)
    expect(log.warnings.join('\n')).toContain('has no getKeyInterpolationType')
  })
})

describe('the LINEAR interpolation pass names the keys it could not fix', () => {
  it('reports node, dial, key index, FRAME and the interpolation Daz holds', () => {
    // A single key at frame 88 (tick 14080): the pass first gives the channel a
    // real key at frame 0 — which succeeds and stays LINEAR — and then fails on
    // the preset's own key, so the report has to point at the SECOND one.
    const bad = new FakeProp('facs_bs_MouthOpen', 'stubborn', [88])
    const head = fakeNode('head', [bad], fakeNode('Genesis9', []))
    const { log, printed } = runPass([head])

    const named = log.keyProblems.filter((k) => k.kind === 'failed')
    // One channel contributes ONE name per kind, not one per key.
    expect(named).toHaveLength(1)
    const [entry] = named
    expect(entry.node).toBe('Genesis9/head')
    expect(entry.prop).toBe('facs_bs_MouthOpen')
    // The FRAME, derived from the time step — not the raw tick count.
    expect(entry.frame).toBe(88)
    expect(entry.key).toBe(1)
    // The count that says whether this key's interpolation spans anything.
    expect(entry.keys).toBe(2)
    // What Daz actually holds, named rather than left as a number to decode.
    expect(entry.interp).toBe('CONSTANT (1)')
    expect(entry.path).toBe('/Pose Controls/Head')
    expect(entry.reason).toContain('does not read back LINEAR')
    // The same detail reaches the Daz log, which is all a user has mid-run.
    expect(printed).toContain('Genesis9/head / facs_bs_MouthOpen')
  })

  it('a lone key at frame 0 spans nothing — even when its value moved', () => {
    // The first REAL report (2026-08-17, LaraCroft_G81) found 4 unfixable keys
    // in 7968, and every one was this: a channel holding ONE key at frame 0
    // whose value moved but whose interpolation would not read back LINEAR.
    // They were Bone Fill/Edge Opacity — VIEWPORT DRAWING dials nobody animated,
    // which only reach the walk because Daz reports an implicit frame-0 key for
    // never-keyed channels. One key has no second key to interpolate towards, so
    // there is nothing to report, whatever the stamp did.
    //
    // The old rule granted that only to keys whose value REFUSED to move, which
    // was an accident of the sample it was measured on, not a property of spans.
    const viewportDial = new FakeProp('Bone Fill Opacity', 'stubborn', [0])
    const { log, problems, printed } = runPass([
      fakeNode('LeonyPonytail_257085', [viewportDial]),
    ])

    expect(problems).toBe(0)
    expect(log.keyProblems).toEqual([])
    expect(log.warnings.join('\n')).not.toContain('would not read back LINEAR')
    // Counted and explained, never silently dropped.
    expect(printed).toContain('1 span nothing')
  })

  it('separates a key that spans nothing from one that is genuinely stuck', () => {
    // A locked channel with a SINGLE key at frame 0 is the benign case measured
    // on a saved-and-reloaded ROM (310 of 1500): interpolation spans nothing
    // there. The same refusal on a multi-key channel is a real finding.
    const benign = new FakeProp('CTRLMDsHidden', 'locked', [0])
    const stuck = new FakeProp('lThighBend?rotate/x', 'locked', [0, 120])
    const { log, problems } = runPass([fakeNode('Genesis9', [benign, stuck])])

    expect(problems).toBe(0)
    const kinds = log.keyProblems.map((k) => k.kind)
    expect(kinds).toContain('stuck')
    // The benign one is counted and explained, never named as a problem.
    expect(log.keyProblems.some((k) => k.prop === 'CTRLMDsHidden')).toBe(false)
    expect(log.warnings.join('\n')).toContain('keep their old interpolation')
    // Both of the stuck channel's keys refuse; it contributes its FIRST one, so
    // the report points at a key that exists rather than at a summary.
    expect(log.keyProblems.find((k) => k.kind === 'stuck')?.key).toBe(0)
    expect(log.warnings.join('\n')).toContain('2 key(s) on multi-key')
  })

  it('names the channels that kept an implicit frame-0 key', () => {
    // ERC-driven: keying frame 0 from getValue would double-apply the
    // controller's contribution, so the pass leaves it — and now says which.
    const driven = new FakeProp('CTRLBodyScale', 'normal', [30, 60], 1)
    const { log, problems } = runPass([fakeNode('Genesis9', [driven])])

    expect(problems).toBe(0)
    const zero = log.keyProblems.filter((k) => k.kind === 'frame-zero')
    expect(zero).toHaveLength(1)
    expect(zero[0].prop).toBe('CTRLBodyScale')
    // No key index to point at — the whole point is that frame 0 has no key.
    expect(zero[0].key).toBe(-1)
    expect(zero[0].reason).toContain('driven by a controller')
    expect(log.warnings.join('\n')).toContain('implicit frame-0 key')
  })

  it('caps the named list per kind and says how many it left out', () => {
    // A pathological run must not flood the Daz log or the studio report — but
    // the COUNTS stay exact, and one kind flooding must not squeeze out another.
    const props = Array.from(
      { length: 12 },
      (_, i) => new FakeProp(`facs_bs_Morph${i}`, 'stubborn', [0, 88]),
    )
    const { log } = runPass([fakeNode('Genesis9', props)])

    const named = log.keyProblems.filter((k) => k.kind === 'failed')
    expect(named).toHaveLength(8) // DTH_KEY_PROBLEM_CAP
    // 12 channels x 2 keys, all of them failing — reported exactly.
    const warning = log.warnings.join('\n')
    expect(warning).toContain('24 of 24 key(s) would not read back LINEAR')
    expect(warning).toContain('and 21 more')
  })
})

describe('the studio reads warnings and named keys back', () => {
  it('parses a v79 log and keeps the run exportable', () => {
    const parsed = parseRomRunLogText(
      JSON.stringify({
        character: 'Kira',
        runs: [
          {
            scene: 'D:/proj/Kira/daz3d/Kira.duf',
            sceneName: 'Kira',
            ok: true,
            errors: [],
            warnings: ['Key interpolation: 4 of 7968 key(s) would not read back LINEAR.'],
            failedMorphs: [],
            keyProblems: [
              {
                kind: 'failed',
                node: 'Genesis9/head',
                prop: 'facs_bs_MouthOpen',
                key: 3,
                frame: 88,
                interp: 'CONSTANT (1)',
                reason: 'the value moved',
              },
            ],
          },
        ],
      }),
    )

    // `ok` still means "the export ran" — warnings do not touch it.
    expect(parsed.ok).toBe(true)
    expect(parsed.warnings).toHaveLength(1)
    expect(parsed.keyProblems[0].frame).toBe(88)
    expect(parsed.keyProblems[0].node).toBe('Genesis9/head')
  })

  it('reads a pre-v79 log without inventing warnings', () => {
    // An older runtime simply has nothing to say here — which is not the same
    // as having reported a clean run.
    const parsed = parseRomRunLogText(
      JSON.stringify({
        character: 'Kira',
        runs: [{ scene: '', sceneName: '', ok: false, errors: ['boom'], failedMorphs: [] }],
      }),
    )
    expect(parsed.warnings).toEqual([])
    expect(parsed.keyProblems).toEqual([])
    expect(parsed.errors).toEqual(['boom'])
  })
})
