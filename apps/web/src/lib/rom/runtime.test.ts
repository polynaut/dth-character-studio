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
const EXPECTED_RUNTIME_HASH = '450ede325253145786ce266a92f629d4845b45e9685aa38a2f25e0c26a3febb2'

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
interface FigureSpec {
  label: string
  short: string
  asset?: string
  graftAsset?: string
  graft?: { name: string; pick: PickSpec }
}
interface GenerationSpec {
  genesis: string
  figures: Array<FigureSpec>
  ready?: Array<FigureSpec>
}
interface PlanReport {
  buildable: Array<GenerationSpec>
  skippedGenesis: Array<string>
  skippedFigures: Array<string>
  missingGrafts: Array<string>
  grafts: Array<string>
}
interface ScannerModule {
  dthGenesisBuildPlan: () => Array<GenerationSpec>
  dthScoreCandidate: (candidate: GlobCandidate, pick: PickSpec) => number
  dthCandBeats: (a: GlobCandidate, aScore: number, b: GlobCandidate, bScore: number) => boolean
  dthContentRoots: (scriptDir: string) => Array<string>
  dthResolvePlan: (plan: Array<GenerationSpec>, roots: Array<string>) => PlanReport
  dthFigureBuildLabel: (spec: FigureSpec) => string
  dthGenesisLabel: (genesis: string) => string
  DTH_PICK_REJECT: RegExp
}

const SCANNER_EXPORTS =
  'dthGenesisBuildPlan, dthScoreCandidate, dthCandBeats, dthContentRoots, dthResolvePlan, dthFigureBuildLabel, dthGenesisLabel, DTH_PICK_REJECT'

function loadScanner(globals: Record<string, unknown> = {}): ScannerModule {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'runtime')
  const src = readFileSync(join(dir, 'DthScanMorphs.dsa'), 'utf8')
  // A sandbox holding only `print` (plus whatever a test fakes) — nothing else of
  // Daz is defined. That's also a canary: if a future edit calls a Daz API at load
  // time (rather than inside a function), this throws "X is not defined" instead
  // of failing mysteriously in Daz, where a broken script logs nothing at all.
  return runInNewContext(`${src}\n;({ ${SCANNER_EXPORTS} })`, {
    print: () => {},
    ...globals,
  }) as ScannerModule
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

/**
 * Pre-flight. Every asset resolves BEFORE the scene is touched, so a library
 * missing a generation — or missing everything — never costs the user their open
 * scene for nothing, and the confirm dialog can name what will actually happen.
 * That makes the whole decision pure, so it's driven here against a fake content
 * tree: the Daz file APIs are the only thing stubbed, `dthResolvePlan` is the
 * shipped one.
 */
const FAKE_LIB = 'C:/lib'
const FULL_TREE = [
  'People/Genesis 3 Female/Genesis 3 Female.duf',
  'People/Genesis 3 Male/Genesis 3 Male.duf',
  'People/Genesis 8 Female/Genesis 8 Basic Female.duf',
  'People/Genesis 8 Female/Genesis 8.1 Basic Female.duf',
  'People/Genesis 8 Male/Genesis 8 Basic Male.duf',
  'People/Genesis 8 Male/Genesis 8.1 Basic Male.duf',
  'People/Genesis 9/Genesis 9.duf',
  'People/Genesis 9/Anatomy/Golden Palace/2a-Golden Palace Smart_Vanilla.duf',
  'People/Genesis 9/Anatomy/Dicktator/1-Dicktator_Smart.duf',
]

/** Minimal DzDir/DzFileInfo/DzFile/App over an in-memory path list. */
function fakeContent(relPaths: Array<string>): Record<string, unknown> {
  const files = new Set(relPaths.map((p) => `${FAKE_LIB}/${p}`))
  const dirs = new Set<string>()
  for (const file of files) {
    let at = file.lastIndexOf('/')
    while (at > FAKE_LIB.length) {
      dirs.add(file.slice(0, at))
      at = file.lastIndexOf('/', at - 1)
    }
    dirs.add(FAKE_LIB)
  }
  const childrenOf = (dir: string, want: 'files' | 'dirs') => {
    const out: Array<string> = []
    for (const p of want === 'files' ? files : dirs) {
      if (p.lastIndexOf('/') === dir.length && p.startsWith(`${dir}/`)) out.push(p.slice(dir.length + 1))
    }
    return out
  }
  class DzDir {
    p: string
    constructor(p: string) {
      this.p = p
    }
    exists() {
      return dirs.has(this.p)
    }
    entryList() {
      return [...childrenOf(this.p, 'files'), ...childrenOf(this.p, 'dirs')]
    }
    getSubdirList() {
      return childrenOf(this.p, 'dirs')
    }
  }
  class DzFileInfo {
    p: string
    constructor(p: string) {
      this.p = p
    }
    exists() {
      return files.has(this.p)
    }
  }
  class DzFile {
    static ReadOnly = 1
    open() {
      return false
    }
    close() {}
  }
  return {
    DzDir,
    DzFileInfo,
    DzFile,
    // No getNumContentDirectories: the enumeration is typeof-guarded, so the
    // only root is the one derived from the script's own install path.
    App: {
      getContentMgr: () => ({
        findFile: (rel: string) => (files.has(`${FAKE_LIB}/${rel}`) ? `${FAKE_LIB}/${rel}` : ''),
      }),
    },
  }
}

function preflight(tree: Array<string>) {
  const scanner = loadScanner(fakeContent(tree))
  const roots = scanner.dthContentRoots(`${FAKE_LIB}/Scripts/DTH-Character-Studio`)
  expect(roots).toEqual([FAKE_LIB]) // the install path IS a content root
  const report = scanner.dthResolvePlan(scanner.dthGenesisBuildPlan(), roots)
  return {
    report,
    /** What the confirm dialog would list, e.g. 'Genesis 9 - with Dicktator'. */
    lines: report.buildable.map(
      (gen) =>
        `${scanner.dthGenesisLabel(gen.genesis)} - ${(gen.ready ?? [])
          .map((f) => scanner.dthFigureBuildLabel(f))
          .join(', ')}`,
    ),
  }
}

describe('Build_Genesis_Index pre-flight', () => {
  it('plans every generation when the whole library is installed', () => {
    const { report, lines } = preflight(FULL_TREE)
    expect(lines).toEqual([
      'Genesis 3 - Female, Male',
      'Genesis 8 - Female, Male',
      'Genesis 8.1 - Female, Male',
      'Genesis 9 - with Golden Palace, with Dicktator',
    ])
    expect(report.skippedGenesis).toEqual([])
    expect(report.skippedFigures).toEqual([])
    expect(report.missingGrafts).toEqual([])
    expect(report.grafts).toEqual([
      'Golden Palace <- 2a-Golden Palace Smart_Vanilla.duf',
      'Dicktator <- 1-Dicktator_Smart.duf',
    ])
  })

  it('skips a generation that is not installed, and names it', () => {
    const { report, lines } = preflight(FULL_TREE.filter((p) => !p.includes('Genesis 3')))
    expect(lines).toEqual([
      'Genesis 8 - Female, Male',
      'Genesis 8.1 - Female, Male',
      'Genesis 9 - with Golden Palace, with Dicktator',
    ])
    expect(report.skippedGenesis).toEqual(['Genesis 3'])
    expect(report.skippedFigures).toEqual(['Genesis 3 Female', 'Genesis 3 Male'])
  })

  it('still builds a generation when only one gender is installed', () => {
    const { lines, report } = preflight(FULL_TREE.filter((p) => !p.includes('Genesis 3 Male')))
    expect(lines[0]).toBe('Genesis 3 - Female')
    expect(report.skippedGenesis).toEqual([])
    expect(report.skippedFigures).toEqual(['Genesis 3 Male'])
  })

  it('collapses the Genesis 9 pair to ONE plain figure when neither geograft is installed', () => {
    // Both G9 entries are the same figure asset differing only by geograft, so
    // without either one they would build and scan two identical figures.
    const { report, lines } = preflight(FULL_TREE.filter((p) => !p.includes('/Anatomy/')))
    expect(lines[3]).toBe('Genesis 9 - plain (no geograft installed)')
    expect(report.buildable[3]?.ready).toHaveLength(1)
    expect(report.missingGrafts).toEqual(['Golden Palace', 'Dicktator'])
  })

  it('drops the redundant plain figure when ONE geograft is installed', () => {
    // The grafted sibling's scan is a superset of the plain one's, so building
    // the plain figure too would only cost minutes.
    const { report, lines } = preflight(FULL_TREE.filter((p) => !p.includes('Golden Palace')))
    expect(lines[3]).toBe('Genesis 9 - with Dicktator')
    expect(report.buildable[3]?.ready).toHaveLength(1)
    expect(report.missingGrafts).toEqual(['Golden Palace'])
    expect(report.grafts).toEqual(['Dicktator <- 1-Dicktator_Smart.duf'])
  })

  it('finds nothing buildable on a library with no Genesis figure — the caller then leaves the scene alone', () => {
    const { report } = preflight([])
    expect(report.buildable).toEqual([])
    expect(report.skippedGenesis).toEqual([
      'Genesis 3',
      'Genesis 8',
      'Genesis 8.1',
      'Genesis 9',
    ])
  })
})
