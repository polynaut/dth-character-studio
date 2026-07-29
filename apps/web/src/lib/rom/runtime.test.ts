import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { runInNewContext } from 'node:vm'

import { RUNTIME_VERSION } from '@dth/rom'
import { describe, expect, it } from 'vitest'

// The DTH Daz runtime (.dsa) is bundled + installed by the studio; it descends
// from soltude/DazToHue-Scripts but is studio-owned now (the upstream twin-sync
// ended when the repo went dormant). Nothing else guards against an ACCIDENTAL
// edit to the bundled copy. This test pins a hash of the runtime so any change
// is deliberate:
//
//   When you intentionally change a runtime file you MUST, together:
//     1. update EXPECTED_RUNTIME_HASH below to the value this test prints,
//     2. bump RUNTIME_VERSION in packages/rom/src/types.ts (so Refresh assets
//        reinstalls the runtime + regenerates character scripts).
//
// A silent edit that skips either is exactly what this catches.

const RUNTIME_FILES = [
  'DthWorkflow.dsa',
  'DthUtils.dsa',
  'DthOptions.dsa',
  'DthProducts.dsa',
  'DthScanMorphs.dsa',
  'DthScanFrames.dsa',
  'Build_Genesis_Index.dsa',
  'Scan_Frames.dsa',
]

// Bump this together with RUNTIME_VERSION whenever a runtime file legitimately
// changes (this run prints the new value in the failure message).
const EXPECTED_RUNTIME_HASH = '2e41b314f928828b2ef9d74ad7364060a340306a1ca9c29411c9bbe88124251b'

function runtimeHash(): string {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'runtime')
  const h = createHash('sha256')
  for (const file of RUNTIME_FILES) {
    h.update(file)
    // Normalise CRLF → LF so a line-ending flip on checkout doesn't false-fail.
    h.update(readFileSync(join(dir, file), 'utf8').replace(/\r\n/g, '\n'))
  }
  return h.digest('hex')
}

describe('bundled DTH runtime (.dsa)', () => {
  it('has not changed without bumping RUNTIME_VERSION + updating the hash', () => {
    const actual = runtimeHash()
    expect(
      actual,
      `The bundled runtime .dsa files changed. If intentional: set EXPECTED_RUNTIME_HASH = "${actual}" and bump RUNTIME_VERSION (currently ${RUNTIME_VERSION}) in packages/rom/src/types.ts.`,
    ).toBe(EXPECTED_RUNTIME_HASH)
  })

  // The core-invariant guard: preset-block lengths must be MEASURED (threaded in as
  // options.presetFrames), never hard-coded. A literal frame count in the runtime is
  // exactly how the Daz timeline could silently drift from the PoseAsset CSV.
  it('sizes every preset block from measured presetFrames — no hard-coded frame count', () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), 'runtime')
    const workflow = readFileSync(join(dir, 'DthWorkflow.dsa'), 'utf8')
    // No numeric literal assigned to a *FrameCount var, and no `iRomFrames = 328 : 617`.
    expect(workflow).not.toMatch(/FrameCount\s*=\s*\d/)
    expect(workflow).not.toMatch(/iRomFrames\s*=\s*[^;\n]*\d/)
    expect(workflow).not.toMatch(/\?\s*328\s*:\s*617/)
    // Each block reads its measured length via the fail-loud helper instead.
    for (const key of ['base', 'gp', 'dk', 'phys']) {
      expect(workflow).toContain(`getPresetFrameCount(options, "${key}")`)
    }
  })
})

/**
 * The geograft glob is the one asset lookup in Build_Genesis_Index that CANNOT be
 * pinned to a path: Golden Palace / Dicktator are third-party and reship under new
 * names and folders. So it globs the whole `People` tree for the product name and
 * RANKS what comes back — and the same glob finds the older generation's version of
 * both products, which must never be fitted to a Genesis 9 figure.
 *
 * The runtime is plain ECMAScript (it only calls Daz APIs from inside functions), so
 * the shipped ranking functions are loaded here and driven directly. The fixture is
 * the real candidate set measured off a full library (2026-07-29) — the exact rows
 * that a `*Golden*Palace*` / `*Dicktator*` glob returns.
 */
const DTH_LIB = 'D:/DAZ 3D/My DAZ 3D Library'
const GLOB_FIXTURE = [
  // Genesis 9 — the wanted generation.
  'People/Genesis 9/Anatomy/Golden Palace/2a-Golden Palace Smart_Vanilla.duf',
  'People/Genesis 9/Anatomy/Golden Palace/2a-Golden Palace Smart_Wild.duf',
  'People/Genesis 9/Anatomy/Golden Palace/00-Manual Setup/2-Golden Palace Graft.duf',
  'People/Genesis 9/Anatomy/Golden Palace/00-Manual Setup/4-Golden Palace_Geoshell_Minora.duf',
  'People/Genesis 9/Anatomy/Golden Palace/00-Manual Setup/6-Golden Palace_Geoshell_Majora.duf',
  'People/Genesis 9/Anatomy/Golden Palace/05-Hair/Manual Loaders/Hair 1_Golden Palace.duf',
  'People/Genesis 9/Anatomy/Dicktator/1-Dicktator_Smart.duf',
  'People/Genesis 9/Anatomy/Dicktator/00-Manual Setup/1-Dicktator.duf',
  'People/Genesis 9/Anatomy/Dicktator/00-Manual Setup/3a-Dicktator Shell.duf',
  'People/Genesis 9/Anatomy/Dicktator/00-Manual Setup/3b-Dicktator Foreskin Shell.duf',
  'People/Genesis 9/Anatomy/Dicktator/03-Shape Presets/Zero Dicktator Shape.duf',
  // Genesis 8 — same products, wrong generation. These are the trap.
  'People/Genesis 8 Female/Anatomy/Golden Palace v2/1-GoldenPalace_Genitalia_v2.duf',
  'People/Genesis 8 Female/Anatomy/Golden Palace v2/1-GoldenPalace_Genitalia_v2_Rigidity.duf',
  'People/Genesis 8 Female/Anatomy/Golden Palace v2/2-GoldenPalace_Shell_v2.duf',
  'People/Genesis 8 Female/Anatomy/Golden Palace v2/3c-GoldenPalace_UV Fix.duf',
  'People/Genesis 8 Female/Anatomy/Golden Palace v2/9-Genesis 8_1/1-GoldenPalace_Genitalia_v2.duf',
  'People/Genesis 8 Male/Anatomy/Dicktator v3/1_Dicktator Genitalia 0.3.duf',
  'People/Genesis 8 Male/Anatomy/Dicktator v3/3_Dicktator_Shell.duf',
  'People/Genesis 8 Male/Anatomy/Dicktator v3/2c-Dicktator_UV Fix.duf',
  'People/Genesis 8 Male/Anatomy/Dicktator v3/3_Bonus v3/Shaft Bondage/Dicktator Shaft Bondage 0.3.duf',
]

interface GlobCandidate {
  path: string
  name: string
}
interface PickSpec {
  glob: RegExp
  prefer?: Array<{ rx: RegExp; score: number }>
}
interface ScannerModule {
  dthGenesisBuildPlan: () => Array<{
    genesis: string
    figures: Array<{ graft?: { name: string; pick: PickSpec } }>
  }>
  dthScoreCandidate: (candidate: GlobCandidate, pick: PickSpec) => number
  dthCandBeats: (a: GlobCandidate, aScore: number, b: GlobCandidate, bScore: number) => boolean
  DTH_PICK_REJECT: RegExp
}

function loadScanner(): ScannerModule {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'runtime')
  const src = readFileSync(join(dir, 'DthScanMorphs.dsa'), 'utf8')
  // A sandbox holding ONLY `print` — the one Daz global the runtime's top level
  // could reach. That's also a canary: if a future edit calls a Daz API at load
  // time (rather than inside a function), this throws "X is not defined" instead
  // of failing mysteriously in Daz, where a broken script logs nothing at all.
  return runInNewContext(
    `${src}\n;({ dthGenesisBuildPlan, dthScoreCandidate, dthCandBeats, DTH_PICK_REJECT })`,
    { print: () => {} },
  ) as ScannerModule
}

/** Rank the fixture exactly as dthPickAsset does, and return the winner. */
function pickFrom(scanner: ScannerModule, pick: PickSpec, paths: Array<string>): string | null {
  let best: GlobCandidate | null = null
  let bestScore = 0
  for (const rel of paths) {
    const name = rel.slice(rel.lastIndexOf('/') + 1)
    const low = name.toLowerCase()
    if (!pick.glob.test(low)) continue
    if (scanner.DTH_PICK_REJECT.test(low)) continue
    const candidate: GlobCandidate = { path: `${DTH_LIB}/${rel}`, name }
    const score = scanner.dthScoreCandidate(candidate, pick)
    if (score <= 0) continue
    if (best && !scanner.dthCandBeats(candidate, score, best, bestScore)) continue
    best = candidate
    bestScore = score
  }
  return best ? best.path.slice(DTH_LIB.length + 1) : null
}

function graftPick(scanner: ScannerModule, name: string): PickSpec {
  const g9 = scanner.dthGenesisBuildPlan().find((gen) => gen.genesis === 'G9')
  const figure = g9?.figures.find((f) => f.graft?.name === name)
  if (!figure?.graft) throw new Error(`no G9 figure carrying the ${name} graft in the build plan`)
  return figure.graft.pick
}

describe('Build_Genesis_Index geograft glob', () => {
  it('picks the Smart setup — the only variant that also brings the geoshells', () => {
    const scanner = loadScanner()
    // The Smart preset adds GoldenPalace_G9_Shell_Minora/_Majora and
    // DicktatorG9_Shell/_ForeskinShell alongside the graft; the 00-Manual Setup
    // graft adds the graft alone, so the shells would be missing from the scan.
    expect(pickFrom(scanner, graftPick(scanner, 'Golden Palace'), GLOB_FIXTURE)).toBe(
      'People/Genesis 9/Anatomy/Golden Palace/2a-Golden Palace Smart_Vanilla.duf',
    )
    expect(pickFrom(scanner, graftPick(scanner, 'Dicktator'), GLOB_FIXTURE)).toBe(
      'People/Genesis 9/Anatomy/Dicktator/1-Dicktator_Smart.duf',
    )
  })

  it('never picks the Genesis 8 version of either product', () => {
    const scanner = loadScanner()
    // With ONLY the G8 products installed there is no plausible candidate: the
    // generation term dominates, so the run reports "not installed" instead of
    // fitting a G8 geograft to a Genesis 9 figure.
    const g8Only = GLOB_FIXTURE.filter((p) => p.includes('Genesis 8'))
    expect(g8Only.length).toBeGreaterThan(0)
    expect(pickFrom(scanner, graftPick(scanner, 'Golden Palace'), g8Only)).toBeNull()
    expect(pickFrom(scanner, graftPick(scanner, 'Dicktator'), g8Only)).toBeNull()
  })

  it('rejects the shells, UV fixes, rigidity, pose/shape and hair loaders outright', () => {
    const { DTH_PICK_REJECT } = loadScanner()
    for (const name of [
      '4-Golden Palace_Geoshell_Minora.duf',
      '3b-Dicktator Foreskin Shell.duf',
      '3c-GoldenPalace_UV Fix.duf',
      '1-GoldenPalace_Genitalia_v2_Rigidity.duf',
      'Zero Dicktator Shape.duf',
      'Hair 1_Golden Palace.duf',
    ]) {
      expect(DTH_PICK_REJECT.test(name.toLowerCase()), name).toBe(true)
    }
    // …but never the setup files themselves.
    for (const name of [
      '2a-Golden Palace Smart_Vanilla.duf',
      '2-Golden Palace Graft.duf',
      '1-Dicktator_Smart.duf',
      '1-Dicktator.duf',
    ]) {
      expect(DTH_PICK_REJECT.test(name.toLowerCase()), name).toBe(false)
    }
  })

  it('breaks a score tie deterministically, not by directory order', () => {
    const scanner = loadScanner()
    const pick = graftPick(scanner, 'Golden Palace')
    // Vanilla and Wild are both complete Smart setups; the +vanilla term settles
    // it, so two runs over the same library can't disagree.
    const both = GLOB_FIXTURE.filter((p) => p.includes('Smart_'))
    expect(pickFrom(scanner, pick, both)).toBe(
      'People/Genesis 9/Anatomy/Golden Palace/2a-Golden Palace Smart_Vanilla.duf',
    )
    expect(pickFrom(scanner, pick, [...both].reverse())).toBe(
      'People/Genesis 9/Anatomy/Golden Palace/2a-Golden Palace Smart_Vanilla.duf',
    )
  })
})
