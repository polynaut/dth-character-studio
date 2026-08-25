import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { runInNewContext } from 'node:vm'

import { RUNTIME_VERSION, nonAsciiStringLiterals } from '@dth/rom'
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
  'DthShellSurfaces.dsa',
  'DthKillAnimation.dsa',
  'Build_Genesis_Index.dsa',
  'Build_Genesis_Index_Bulk.dsa',
  'Scan_Scene_Bulk.dsa',
  'Scan_Frames.dsa',
  'Fix_Graft_Shell_Surfaces.dsa',
  'Kill_Animation.dsa',
]

// The visible scripts' Content Library artwork, installed beside them. Hashed as
// BYTES (no line-ending normalisation) and folded into the same guard: the
// installed-marker skip means a changed icon only reaches an existing install
// through a RUNTIME_VERSION bump, exactly like a changed script.
const RUNTIME_ASSETS = [
  'Build_Genesis_Index.png',
  'Build_Genesis_Index.tip.png',
  'Scan_Frames.png',
  'Scan_Frames.tip.png',
  'Fix_Graft_Shell_Surfaces.png',
  'Fix_Graft_Shell_Surfaces.tip.png',
  'Kill_Animation.png',
  'Kill_Animation.tip.png',
]

// Bump this together with RUNTIME_VERSION whenever a runtime file legitimately
// changes (this run prints the new value in the failure message).
const EXPECTED_RUNTIME_HASH =
  'f7afb0048bec83d9dbf2045b30f637f64003a592e569ea9e26d0823e5a501c2d'

function runtimeHash(): string {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'runtime')
  const h = createHash('sha256')
  for (const file of RUNTIME_FILES) {
    h.update(file)
    // Normalise CRLF → LF so a line-ending flip on checkout doesn't false-fail.
    h.update(readFileSync(join(dir, file), 'utf8').replace(/\r\n/g, '\n'))
  }
  for (const asset of RUNTIME_ASSETS) {
    h.update(asset)
    h.update(readFileSync(join(dir, asset))) // binary — hash the bytes as they are
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

  // Daz cannot carry non-ASCII out of a script (measured 2026-08-14, DS4 4.24:
  // an arrow written to the run log through DzFile.write reached the studio as
  // `?`, an em dash printed to the Daz log as mojibake). The GENERATED carriers
  // are held to this by generate-golden.test.ts; these files are the studio's
  // other .dsa surface — shipped as source and installed verbatim — and were
  // carrying 13 violations while that guard read as covering the rule, among
  // them a diagnostics heading written straight to a file.
  //
  // Same scanner as the golden test (@dth/rom's dsa-ascii), so the two halves
  // cannot drift apart on what the rule means.
  for (const file of RUNTIME_FILES) {
    it(`holds only ASCII string literals in ${file}`, () => {
      const dir = join(dirname(fileURLToPath(import.meta.url)), 'runtime')
      expect(nonAsciiStringLiterals(readFileSync(join(dir, file), 'utf8'))).toEqual([])
    })
  }
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

/**
 * The SCENE morph scan (DthScanMorphs.dsa, runtime v53): what a saved scene adds
 * on top of the stock-figure base index — clothing, hair, third-party grafts —
 * filed under that scene so the studio's autocomplete can scope it.
 *
 * The merge is where the risk is, so it is driven here against a fake DzFile:
 * a re-scan must REPLACE that scene's contribution (clothing removed from a
 * scene has to disappear from its suggestions) while leaving every other
 * scene's alone, and a dial found in two scenes has to carry both.
 */
interface SceneScanModule {
  dthSceneKey: (path: string) => string
  dthBaseIndexKeys: (outDir: string, genesis: string) => Record<string, boolean>
  dthHasBaseIndex: (outDir: string, genesis: string) => boolean
  dthWriteSceneIndex: (
    outDir: string,
    genesis: string,
    found: Array<{ node: string; nodeLabel: string; label: string; name: string }>,
    scenePath: string,
    sceneName: string,
  ) => boolean
  dthKnownGenesis: (value: unknown) => string
}

interface SceneIndexFile {
  version: number
  genesis: string
  scenes: Array<{ path: string; name: string }>
  morphs: Array<{ node: string; label: string; name: string; scenes: Array<string> }>
}

const SCENE_EXPORTS =
  'dthSceneKey, dthBaseIndexKeys, dthHasBaseIndex, dthWriteSceneIndex, dthKnownGenesis'

/** Load DthScanMorphs.dsa over an in-memory filesystem, so the index reads and
 *  writes are real code paths against fake files. */
function loadSceneScan(files: Map<string, string>): SceneScanModule {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'runtime')
  const src = readFileSync(join(dir, 'DthScanMorphs.dsa'), 'utf8')
  class DzFile {
    static ReadOnly = 1
    static WriteOnly = 2
    static Truncate = 4
    ReadOnly = 1
    WriteOnly = 2
    Truncate = 4
    path: string
    mode = 0
    constructor(path: string) {
      this.path = path
    }
    open(mode: number) {
      // Write modes always succeed; a read only when the file is there.
      if ((mode & 2) !== 0) {
        this.mode = mode
        return true
      }
      if (!files.has(this.path)) return false
      this.mode = mode
      return true
    }
    read() {
      return files.get(this.path) ?? ''
    }
    write(text: string) {
      files.set(this.path, text)
    }
    close() {}
  }
  return runInNewContext(`${src}\n;({ ${SCENE_EXPORTS} })`, {
    print: () => {},
    DzFile,
    Date,
    JSON,
    // Supplied by DthUtils.dsa at runtime (every script includes it first).
    // The sandbox loads this ONE file, so the table it leans on is injected;
    // the real one is pinned in asset-identity.test.ts.
    dthGenerationAssetFiles: (genesis: string) =>
      ({
        G9: ['genesis9.dsf'],
        'G8.1': ['genesis8_1female.dsf', 'genesis8_1male.dsf'],
        G8: ['genesis8female.dsf', 'genesis8male.dsf'],
        G3: ['genesis3female.dsf', 'genesis3male.dsf'],
      })[genesis] ?? null,
  }) as SceneScanModule
}

const OUT = 'C:/appdata'
const SCENE_INDEX = `${OUT}/morphs_scenes_G9.json`
const morph = (node: string, name: string) => ({ node, nodeLabel: node, label: name, name })

describe('scene morph scan (DthScanMorphs.dsa)', () => {
  it('keys scenes the way the studio does — separators and case folded', () => {
    const scan = loadSceneScan(new Map())
    // Must agree with normalizeSceneKey (execute-jobs.ts), or a scene could
    // never find its own suggestions back.
    expect(scan.dthSceneKey('D:\\Chars\\Kira\\Kira.duf')).toBe('d:/chars/kira/kira.duf')
    expect(scan.dthSceneKey('  D:/Chars/Kira.duf  ')).toBe('d:/chars/kira.duf')
  })

  it('reads the base index as the filter set, and treats a missing one as empty', () => {
    const files = new Map([
      [
        `${OUT}/morphs_G9.json`,
        JSON.stringify({ morphs: [morph('Genesis9', 'body_bs_BodyTone')] }),
      ],
    ])
    const scan = loadSceneScan(files)
    expect(scan.dthBaseIndexKeys(OUT, 'G9')['Genesis9|body_bs_BodyTone']).toBe(true)
    // No base index at all: this function still reports an empty filter set —
    // the REFUSAL to scan on that basis is dthHasBaseIndex's job, below.
    expect(Object.keys(scan.dthBaseIndexKeys(OUT, 'G8'))).toEqual([])
  })

  /**
   * The guard on the studio-declared generation — the fallback for a scene
   * whose figures carry no readable asset identity (Daz Studio 4 answers with
   * none, and every scan there was skipped as "no Genesis figure").
   *
   * It has to be a value the index can be read back under: the generation names
   * the file (`morphs_scenes_<G>.json`) and picks the base index to subtract, so
   * a string nothing else knows would write a file no reader ever opens.
   */
  describe('dthKnownGenesis', () => {
    const scan = () => loadSceneScan(new Map())

    it('passes the four generations the index actually uses', () => {
      for (const g of ['G9', 'G8.1', 'G8', 'G3']) expect(scan().dthKnownGenesis(g)).toBe(g)
    })

    it('trims, because it arrives from a config file', () => {
      expect(scan().dthKnownGenesis('  G8.1  ')).toBe('G8.1')
    })

    it('refuses anything else — a fallback may not invent a generation', () => {
      for (const value of ['G10', 'g9', 'Genesis 9', '', '  ', null, undefined, 9]) {
        expect(scan().dthKnownGenesis(value)).toBe('')
      }
    })
  })

  /**
   * The guard behind DthScanSceneMorphs' refusal.
   *
   * With no base index there is nothing to subtract, so the whole stock figure
   * files itself as "what this scene adds". Before runtime v55 only the Tools
   * batch could reach that (it enqueues the base row first on purpose); since
   * v55 every ROM/export run scans the open scene, so a plain export on a
   * machine that never built the index hit it silently.
   */
  describe('dthHasBaseIndex', () => {
    const withBase = () =>
      new Map([
        [
          `${OUT}/morphs_G9.json`,
          JSON.stringify({ morphs: [morph('Genesis9', 'body_bs_BodyTone')] }),
        ],
      ])

    it('is true for a generation whose base index holds morphs', () => {
      expect(loadSceneScan(withBase()).dthHasBaseIndex(OUT, 'G9')).toBe(true)
    })

    it('is false when the file is not there at all', () => {
      expect(loadSceneScan(withBase()).dthHasBaseIndex(OUT, 'G8')).toBe(false)
    })

    it('is false for an index holding ZERO morphs', () => {
      // It cannot be a stock figure's dial list, and subtracting it would
      // misfile in exactly the same way as having no file — so it must not
      // read as "present".
      const files = new Map([[`${OUT}/morphs_G9.json`, JSON.stringify({ morphs: [] })]])
      expect(loadSceneScan(files).dthHasBaseIndex(OUT, 'G9')).toBe(false)
    })

    it('is false for a file that is not valid JSON', () => {
      const files = new Map([[`${OUT}/morphs_G9.json`, '{ truncated']])
      expect(loadSceneScan(files).dthHasBaseIndex(OUT, 'G9')).toBe(false)
    })

    it('is false for JSON with no morphs array', () => {
      const files = new Map([[`${OUT}/morphs_G9.json`, JSON.stringify({ version: 3 })]])
      expect(loadSceneScan(files).dthHasBaseIndex(OUT, 'G9')).toBe(false)
    })

    it('reads the same path the filter set reads, trailing separator or not', () => {
      const files = withBase()
      expect(loadSceneScan(files).dthHasBaseIndex(`${OUT}/`, 'G9')).toBe(true)
      expect(loadSceneScan(files).dthHasBaseIndex(OUT.replace(/\//g, '\\'), 'G9')).toBe(true)
    })
  })

  it('files a scene’s finds under that scene', () => {
    const files = new Map<string, string>()
    const scan = loadSceneScan(files)
    scan.dthWriteSceneIndex(OUT, 'G9', [morph('Jacket', 'ExpandAll')], 'D:/S/Kira.duf', 'Kira')
    const out = JSON.parse(files.get(SCENE_INDEX) ?? '{}') as SceneIndexFile
    expect(out.morphs).toHaveLength(1)
    expect(out.morphs[0]).toMatchObject({ node: 'Jacket', name: 'ExpandAll' })
    expect(out.morphs[0].scenes).toEqual(['D:/S/Kira.duf'])
    expect(out.scenes.map((s) => s.name)).toEqual(['Kira'])
  })

  it('adds a second scene to a dial both scenes have, without duplicating it', () => {
    const files = new Map<string, string>()
    const scan = loadSceneScan(files)
    scan.dthWriteSceneIndex(OUT, 'G9', [morph('Jacket', 'ExpandAll')], 'D:/S/A.duf', 'A')
    scan.dthWriteSceneIndex(OUT, 'G9', [morph('Jacket', 'ExpandAll')], 'D:/S/B.duf', 'B')
    const out = JSON.parse(files.get(SCENE_INDEX) ?? '{}') as SceneIndexFile
    expect(out.morphs).toHaveLength(1)
    expect(out.morphs[0].scenes).toEqual(['D:/S/A.duf', 'D:/S/B.duf'])
    expect(out.scenes).toHaveLength(2)
  })

  it('REPLACES a scene’s contribution on a re-scan — removed clothing stops being suggested', () => {
    const files = new Map<string, string>()
    const scan = loadSceneScan(files)
    scan.dthWriteSceneIndex(
      OUT,
      'G9',
      [morph('Jacket', 'ExpandAll'), morph('Boots', 'Widen')],
      'D:/S/A.duf',
      'A',
    )
    // The jacket was taken off the scene and it was scanned again.
    scan.dthWriteSceneIndex(OUT, 'G9', [morph('Boots', 'Widen')], 'D:/S/A.duf', 'A')
    const out = JSON.parse(files.get(SCENE_INDEX) ?? '{}') as SceneIndexFile
    expect(out.morphs.map((m) => m.node)).toEqual(['Boots'])
    expect(out.scenes).toHaveLength(1) // the scene is re-recorded, not doubled
  })

  it('leaves OTHER scenes’ entries alone when one is re-scanned', () => {
    const files = new Map<string, string>()
    const scan = loadSceneScan(files)
    scan.dthWriteSceneIndex(OUT, 'G9', [morph('Jacket', 'ExpandAll')], 'D:/S/A.duf', 'A')
    scan.dthWriteSceneIndex(OUT, 'G9', [morph('Dress', 'Flare')], 'D:/S/B.duf', 'B')
    // Re-scanning A empty must not touch B's dress.
    scan.dthWriteSceneIndex(OUT, 'G9', [], 'D:/S/A.duf', 'A')
    const out = JSON.parse(files.get(SCENE_INDEX) ?? '{}') as SceneIndexFile
    expect(out.morphs.map((m) => m.node)).toEqual(['Dress'])
    expect(out.morphs[0].scenes).toEqual(['D:/S/B.duf'])
  })

  it('drops a shared dial from only the re-scanned scene, keeping the other', () => {
    const files = new Map<string, string>()
    const scan = loadSceneScan(files)
    scan.dthWriteSceneIndex(OUT, 'G9', [morph('Jacket', 'ExpandAll')], 'D:/S/A.duf', 'A')
    scan.dthWriteSceneIndex(OUT, 'G9', [morph('Jacket', 'ExpandAll')], 'D:/S/B.duf', 'B')
    scan.dthWriteSceneIndex(OUT, 'G9', [], 'D:/S/A.duf', 'A')
    const out = JSON.parse(files.get(SCENE_INDEX) ?? '{}') as SceneIndexFile
    expect(out.morphs).toHaveLength(1)
    expect(out.morphs[0].scenes).toEqual(['D:/S/B.duf'])
  })

  it('matches a stored scene by KEY, so a re-scan under a different spelling still replaces', () => {
    const files = new Map<string, string>()
    const scan = loadSceneScan(files)
    scan.dthWriteSceneIndex(OUT, 'G9', [morph('Jacket', 'ExpandAll')], 'D:/S/A.duf', 'A')
    // Same file, backslashes + different case — must not become a second scene.
    scan.dthWriteSceneIndex(OUT, 'G9', [morph('Boots', 'Widen')], 'D:\\s\\a.duf', 'A')
    const out = JSON.parse(files.get(SCENE_INDEX) ?? '{}') as SceneIndexFile
    expect(out.morphs.map((m) => m.node)).toEqual(['Boots'])
    expect(out.scenes).toHaveLength(1)
  })
})

/**
 * Geoshell surface hygiene (DthShellSurfaces.dsa). The decision logic is pure —
 * which shells are in scope, which fitted figure contributed a surface row, and
 * which rows get switched off — so it is driven here directly, exactly as it
 * runs in Daz.
 *
 * The fixtures are the REAL surface labels measured off a Genesis 9 + Golden
 * Palace + STX nipples/navel scene (DS 6, 2026-07-31): the shell exposes one
 * DzBoolProperty per surface, labelled `<graftNodeName>_<materialName>` for a
 * graft-contributed row and the bare `<materialName>` for the figure's own.
 */
interface ShellModule {
  dthShellNorm: (s: string) => string
  dthShellFamilyFor: (name: string, label: string) => string
  dthShellSurfaceOwner: (surfaceLabel: string, contribNames: Array<string>) => string
  dthShellOwnerByPrefix: (
    shellName: string,
    contribNames: Array<string>,
  ) => { name: string; best: number; runnerUp: number }
  dthShellSurfacesToClear: (
    surfaces: Array<{ label: string; on: boolean }>,
    contribNames: Array<string>,
    ownerName: string,
  ) => Array<{ label: string; from: string }>
}

const SHELL_EXPORTS =
  'dthShellNorm, dthShellFamilyFor, dthShellSurfaceOwner, dthShellOwnerByPrefix, dthShellSurfacesToClear'

function loadShellSurfaces(): ShellModule {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'runtime')
  const src = readFileSync(join(dir, 'DthShellSurfaces.dsa'), 'utf8')
  // Same canary as loadScanner: a sandbox with only `print`, so a Daz API called
  // at load time throws here instead of failing silently in Daz.
  return runInNewContext(`${src}\n;({ ${SHELL_EXPORTS} })`, { print: () => {} }) as ShellModule
}

// The fitted figures in the measured scene, by node name.
const CONTRIB = [
  'Genesis9Tear',
  'Genesis9Eyes',
  'Genesis9Mouth',
  'stx_gen_9_nipples_feminine',
  'stx_genesis_9_navel_71',
  'GoldenPalace_G9_9694',
]

// The 15 surface rows of GoldenPalaceG9_Shell_Minora, with the values a FRESH
// (unfixed) scene has: the GP rows on, the base figure's own off, and the two
// STX rows on — which is the bug this fixes.
const MINORA_SURFACES = [
  { label: 'Legs', on: false },
  { label: 'Arms', on: false },
  { label: 'Fingernails', on: false },
  { label: 'Toenails', on: false },
  { label: 'Mouth Cavity', on: false },
  { label: 'Head', on: false },
  { label: 'Body', on: false },
  { label: 'GoldenPalace_G9_9694_GP_Torso', on: true },
  { label: 'GoldenPalace_G9_9694_GP_Torso_Back', on: true },
  { label: 'GoldenPalace_G9_9694_GP_Vagina', on: true },
  { label: 'GoldenPalace_G9_9694_GP_Labia Minora', on: true },
  { label: 'GoldenPalace_G9_9694_GP_Rectum', on: true },
  { label: 'GoldenPalace_G9_9694_GP_Urethra', on: true },
  { label: 'stx_gen_9_nipples_feminine_Body', on: true },
  { label: 'stx_genesis_9_navel_71_Body', on: true },
]

describe('geoshell surface hygiene (DthShellSurfaces.dsa)', () => {
  const shell = loadShellSurfaces()

  it('matches a shell to its product family across naming styles', () => {
    for (const name of [
      'GoldenPalace_G9_Shell_Minora',
      'GoldenPalaceG9_Shell_Majora',
      'Golden Palace G9 Shell',
      'golden-palace shell',
    ]) {
      expect(shell.dthShellFamilyFor(name, '')).toBe('Golden Palace')
    }
    expect(shell.dthShellFamilyFor('DicktatorG9_Shell', '')).toBe('Dicktator')
    expect(shell.dthShellFamilyFor('DicktatorG9_ForeskinShell', '')).toBe('Dicktator')
    // The label alone is enough — a renamed node still matches on what Daz shows.
    expect(shell.dthShellFamilyFor('Shell_3', 'GoldenPalace Shell')).toBe('Golden Palace')
  })

  it('leaves every OTHER geoshell out of scope — a tattoo shell wants the graft surfaces on', () => {
    expect(shell.dthShellFamilyFor('Tattoo_Shell', 'Tattoo Shell')).toBe('')
    expect(shell.dthShellFamilyFor('Genesis9_Nails_Shell', 'Nails')).toBe('')
    expect(shell.dthShellFamilyFor('Genesis9', 'Genesis 9')).toBe('')
  })

  it('reads a surface row back to the figure that contributed it', () => {
    expect(shell.dthShellSurfaceOwner('stx_gen_9_nipples_feminine_Body', CONTRIB)).toBe(
      'stx_gen_9_nipples_feminine',
    )
    expect(shell.dthShellSurfaceOwner('GoldenPalace_G9_9694_GP_Labia Minora', CONTRIB)).toBe(
      'GoldenPalace_G9_9694',
    )
    // The base figure's own surfaces carry no contributor prefix.
    expect(shell.dthShellSurfaceOwner('Body', CONTRIB)).toBe('')
    expect(shell.dthShellSurfaceOwner('Mouth Cavity', CONTRIB)).toBe('')
  })

  it('gives a row to the LONGEST matching name, so a name that prefixes another cannot steal it', () => {
    const names = ['stx_navel', 'stx_navel_71']
    expect(shell.dthShellSurfaceOwner('stx_navel_71_Body', names)).toBe('stx_navel_71')
    expect(shell.dthShellSurfaceOwner('stx_navel_Body', names)).toBe('stx_navel')
  })

  it('clears exactly the foreign-graft rows on the GP shell — its own and the figure\u2019s stay', () => {
    const cleared = shell.dthShellSurfacesToClear(MINORA_SURFACES, CONTRIB, 'GoldenPalace_G9_9694')
    expect(cleared.map((c) => c.label)).toEqual([
      'stx_gen_9_nipples_feminine_Body',
      'stx_genesis_9_navel_71_Body',
    ])
    expect(cleared.map((c) => c.from)).toEqual([
      'stx_gen_9_nipples_feminine',
      'stx_genesis_9_navel_71',
    ])
  })

  it('is a no-op on an already-fixed scene — only rows that are ON get written', () => {
    const fixed = MINORA_SURFACES.map((s) =>
      s.label.startsWith('stx_') ? { ...s, on: false } : s,
    )
    expect(shell.dthShellSurfacesToClear(fixed, CONTRIB, 'GoldenPalace_G9_9694')).toEqual([])
  })

  it('never clears a row when the shell itself is the owner of everything foreign', () => {
    // A DK shell on a figure carrying GP too: each shell only keeps its own.
    const dkContrib = ['DicktatorG9_1234', 'GoldenPalace_G9_9694']
    const surfaces = [
      { label: 'DicktatorG9_1234_DK_Shaft', on: true },
      { label: 'GoldenPalace_G9_9694_GP_Torso', on: true },
    ]
    expect(
      shell.dthShellSurfacesToClear(surfaces, dkContrib, 'DicktatorG9_1234').map((c) => c.label),
    ).toEqual(['GoldenPalace_G9_9694_GP_Torso'])
  })

  it('falls back to a name-prefix owner, and refuses to guess when it is short or tied', () => {
    // A renamed GP graft node still shares the shell's leading run.
    expect(
      shell.dthShellOwnerByPrefix('GoldenPalace_G9_Shell_Minora', [
        'GoldenPalace_G9_renamed',
        'stx_genesis_9_navel_71',
      ]).name,
    ).toBe('GoldenPalace_G9_renamed')
    // Two equally-good candidates: no answer, so the caller skips the shell.
    expect(
      shell.dthShellOwnerByPrefix('GoldenPalace_G9_Shell_Minora', [
        'GoldenPalace_G9_a',
        'GoldenPalace_G9_b',
      ]).name,
    ).toBe('')
    // Nothing close enough to be evidence.
    expect(shell.dthShellOwnerByPrefix('GP_Shell', ['stx_genesis_9_navel_71']).name).toBe('')
  })
})

/**
 * Kill_Animation's pure half (DthKillAnimation.dsa).
 *
 * The script itself is unverifiable here — it deletes keys through the Daz API,
 * which does not exist in this process. What IS testable is the arithmetic the
 * user is shown before agreeing to lose their animation, and the wording of the
 * three outcomes: a destructive tool that says "removed 0 keys" where it means
 * "there was nothing to remove" is how one stops being trusted.
 */
interface KillAnimModule {
  dthKillAnimFrameSpan: (times: Array<number>, timeStep: number) => number
  dthKillAnimSummary: (report: Record<string, unknown>) => string
  DTH_KILL_ANIM_DEFAULT_FRAMES: number
}

const KILL_ANIM_EXPORTS =
  'dthKillAnimFrameSpan, dthKillAnimSummary, DTH_KILL_ANIM_DEFAULT_FRAMES'

function loadKillAnimation(): KillAnimModule {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'runtime')
  const src = readFileSync(join(dir, 'DthKillAnimation.dsa'), 'utf8')
  // Same canary as the others: only `print` in the sandbox, so a Daz API touched
  // at LOAD time throws here rather than failing silently inside Daz.
  return runInNewContext(`${src}\n;({ ${KILL_ANIM_EXPORTS} })`, {
    print: () => {},
  }) as KillAnimModule
}

describe('kill animation (DthKillAnimation.dsa)', () => {
  const kill = loadKillAnimation()
  // One Daz frame at 30 fps, in ticks — the unit Scene.getTimeStep() returns.
  const STEP = 4800

  it('leaves a default Daz timeline behind', () => {
    expect(kill.DTH_KILL_ANIM_DEFAULT_FRAMES).toBe(30)
  })

  it('counts frames the way the studio measures a scene (last key + 1, 0-based)', () => {
    // poses.rs: max key time × 30 fps, + 1 for the 0-based count.
    expect(kill.dthKillAnimFrameSpan([0, 10 * STEP, 103 * STEP], STEP)).toBe(104)
    // A lone key at frame 0 is one frame — the normal saved-scene state, and
    // exactly the `animationFrames <= 1` the add-scene check accepts.
    expect(kill.dthKillAnimFrameSpan([0], STEP)).toBe(1)
    expect(kill.dthKillAnimFrameSpan([], STEP)).toBe(0)
  })

  it('never divides by a time step it could not read', () => {
    // getTimeStep() failing comes back as 0 through the safe-wrapper; a NaN or
    // an Infinity in the confirm dialog is worse than a plain 0.
    expect(kill.dthKillAnimFrameSpan([10 * STEP], 0)).toBe(0)
  })

  it('ignores a key time it cannot read rather than poisoning the count', () => {
    expect(kill.dthKillAnimFrameSpan([0, Number.NaN, 5 * STEP], STEP)).toBe(6)
  })

  it('says "nothing to do" instead of reporting a successful deletion of nothing', () => {
    expect(kill.dthKillAnimSummary({ cleared: 0, keys: 0, frames: 0 })).toContain(
      'already empty',
    )
  })

  it('an all-failed run does NOT borrow the "already empty" wording', () => {
    // cleared 0 with failures means the scene is still animated — the real run
    // subtracts failed properties from cleared/keys, so this is exactly the
    // report an all-failed run hands in. "Already empty" here would tell the
    // user a still-animated scene is clean.
    const summary = kill.dthKillAnimSummary({
      cleared: 0,
      keys: 0,
      frames: 88,
      failed: ['Genesis9:/Hip/YRotate'],
    })
    expect(summary).toContain('kept its keys')
    expect(summary).not.toContain('already empty')
  })

  it('singularises what it removed, because the report is the only receipt', () => {
    expect(kill.dthKillAnimSummary({ cleared: 1, keys: 1, frames: 1 })).toBe(
      'Removed 1 key from 1 property (1 frame of animation).',
    )
    expect(kill.dthKillAnimSummary({ cleared: 812, keys: 9431, frames: 617 })).toBe(
      'Removed 9431 keys from 812 properties (617 frames of animation).',
    )
  })
})

/* ── The product scan's unattended contract (DthProducts.dsa) ─────────────────
 *
 * `DthScanProductsQuiet` runs INSIDE every ROM/export run — including the rows
 * the Runner drives through a minimized Daz. It sets `bulk` for exactly one
 * reason, spelled out in its own doc comment: "A missing DIM folder or an
 * unwritable output dir must not put up a dialog in a minimized Daz." Until
 * runtime v85 neither of those two functions took the flag, so both did — a
 * modal in an unattended run waits forever for a click nobody can make and
 * stops the whole batch, not just the row (see gotchas-daz.md).
 *
 * Behavioural, not a text scan: the point is which BRANCH runs, and the failure
 * paths are the ones no golden and no `MessageBox`-grep over the generated
 * carriers can reach — a carrier is a thin call into this runtime.
 */
interface ProductsModule {
  getInstalledProducts: (dimManifestPath: string, quiet?: boolean) => Array<unknown>
  writeProductsCsv: (
    outputCsvPath: string,
    matchResults: { matches: Array<unknown>; unmatched: Array<unknown> },
    sceneName: string,
    scenePath: string,
    quiet?: boolean,
  ) => boolean
}

const PRODUCTS_EXPORTS = 'getInstalledProducts, writeProductsCsv'

/**
 * Load DthProducts.dsa with every filesystem call failing — the state both
 * refusals are reached from — and a MessageBox that records instead of blocking.
 * `verbose` is injected so the top-level `include(DthUtils)` is skipped (the
 * same typeof guard the real runtime uses when the wrapper included it first).
 */
function loadProducts(): { products: ProductsModule; dialogs: Array<string> } {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'runtime')
  const src = readFileSync(join(dir, 'DthProducts.dsa'), 'utf8')
  const dialogs: Array<string> = []
  // Records the TITLE (arg 2) — short, stable, and enough to tell the three
  // dialogs apart without pinning prose.
  const box = (_message: unknown, title: unknown) => {
    dialogs.push(String(title))
  }
  class DzDir {
    constructor(public path: string) {}
    exists() {
      return false // the moved folder / unmounted drive this test is about
    }
    filePath(name: string) {
      return `${this.path}/${name}`
    }
    mkpath() {
      return false
    }
    entryList() {
      return []
    }
  }
  class DzFileInfo {
    constructor(public full: string) {}
    path() {
      return this.full.split('/').slice(0, -1).join('/')
    }
  }
  class DzFile {
    WriteOnly = 2
    Truncate = 4
    constructor(public path: string) {}
    open() {
      return false // an unwritable output dir
    }
    write() {}
    close() {}
  }
  const products = runInNewContext(`${src}\n;({ ${PRODUCTS_EXPORTS} })`, {
    print: () => {},
    verbose: () => {},
    getScriptFileName: () => 'C:/runtime/.DthProducts.dsa',
    include: () => {
      throw new Error('the sandbox must not include a sibling runtime')
    },
    DzDir,
    DzFile,
    DzFileInfo,
    JSON,
    MessageBox: { information: box, warning: box, critical: box },
  }) as ProductsModule
  return { products, dialogs }
}

const NO_MATCHES = { matches: [], unmatched: [] }

describe('product scan under the Runner (DthProducts.dsa)', () => {
  it('opens no dialog when the baked DIM manifests folder is gone', () => {
    const { products, dialogs } = loadProducts()
    expect(products.getInstalledProducts('D:/DIM/ManifestFiles', true)).toEqual([])
    expect(dialogs).toEqual([])
  })

  it('opens no dialog when no DIM manifests folder was baked in at all', () => {
    const { products, dialogs } = loadProducts()
    expect(products.getInstalledProducts('', true)).toEqual([])
    expect(dialogs).toEqual([])
  })

  it('opens no dialog when the scan CSV cannot be written', () => {
    const { products, dialogs } = loadProducts()
    // false, not a throw: DthScanProducts turns it into one under bulk, which
    // fails the ROW loudly instead of parking the batch on a modal.
    expect(products.writeProductsCsv('C:/out/scene.csv', NO_MATCHES, 'Scene', 'C:/s.duf', true))
      .toBe(false)
    expect(dialogs).toEqual([])
  })

  it('still warns the HUMAN who ran the visible Scan_Products script', () => {
    // Not a ban on dialogs — a rule about who is watching. The attended path
    // keeps all three, or a hand-run scan fails with nothing on screen.
    const { products, dialogs } = loadProducts()
    products.getInstalledProducts('D:/DIM/ManifestFiles')
    products.getInstalledProducts('')
    products.writeProductsCsv('C:/out/scene.csv', NO_MATCHES, 'Scene', 'C:/s.duf')
    expect(dialogs).toEqual(['Directory Not Found', 'DIM Manifests Folder Not Set', 'DTH Product Scan'])
  })
})

/* ── Matching for hand-installed content (DthProducts.dsa, runtime v88) ───────
 *
 * A manually-installed product (no DIM manifest, no LOCAL_USER metadata) is only
 * recognisable from the content tree itself, and hand-installed MORPHS live under
 * the base-figure root ("data/DAZ 3D/Genesis 8/Female/Morphs/<Vendor>/<Product>")
 * that the folder heuristics used to write off wholesale as base content — the
 * real-library case these rules were built from ("GC BodyMorph") sat unmatched
 * for exactly that reason. These tests drive the actual runtime matchers over an
 * in-memory directory tree, so the folder-key extraction, the morph-root
 * synthesis, the multi-directory walk and the end-to-end match are all pinned
 * without a Daz install.
 */
interface MatchingModule {
  productFolderKey: (p: string) => string
  getContentDirectories: (lib: string) => Array<string>
  getContentFolderProducts: (
    dirs: Array<string>,
    real: Array<Record<string, unknown>>,
  ) => Array<{ name: string; artist: string; folders: Array<string>; productType: string }>
  findProductMatches: (
    usedAssets: Array<Record<string, unknown>>,
    installed: Array<Record<string, unknown>>,
    genesis: number,
    synth: Array<Record<string, unknown>>,
  ) => {
    matches: Array<{ product: { name: string }; method: string }>
    unmatched: Array<{ name: string }>
  }
  parseManifestFile: (
    path: string,
  ) => { name: string; files: Array<string>; morphKeys: Array<string>; morphGens: Array<number> } | null
  getUsedAssets: () => Array<{ type: string; name: string }>
}

const MATCHING_EXPORTS =
  'productFolderKey, getContentDirectories, getContentFolderProducts, findProductMatches, parseManifestFile, getUsedAssets'

/**
 * Load DthProducts.dsa over an in-memory directory tree (`dirs` are the existing
 * directories; `files` are full file paths, listed by their parent directory but
 * never openable — file CONTENT is irrelevant to the matchers under test).
 * `appContentDirs`, when given, backs a fake `App.getContentMgr()`. `extra` can
 * supply openable file contents (for parseManifestFile) and scene nodes (for
 * getUsedAssets).
 */
function loadMatching(
  dirs: Array<string> = [],
  appContentDirs?: Array<string>,
  files: Array<string> = [],
  extra: { fileContents?: Record<string, string>; sceneNodes?: Array<unknown> } = {},
): MatchingModule {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'runtime')
  const src = readFileSync(join(dir, 'DthProducts.dsa'), 'utf8')
  const dirSet = new Set(dirs.map((d) => d.toLowerCase()))
  const childrenOf = (p: string): Array<string> => {
    const prefix = `${p.toLowerCase()}/`
    const names = new Set<string>()
    for (const d of [...dirs, ...files]) {
      if (d.toLowerCase().startsWith(prefix)) names.add(d.slice(p.length + 1).split('/')[0])
    }
    return [...names]
  }
  class DzDir {
    constructor(public p: string) {}
    exists() {
      return dirSet.has(this.p.toLowerCase())
    }
    filePath(name: string) {
      return `${this.p}/${name}`
    }
    entryList() {
      return childrenOf(this.p)
    }
    getSubdirList() {
      return childrenOf(this.p)
    }
    mkpath() {
      return false
    }
  }
  class DzFileInfo {
    constructor(public full: string) {}
    path() {
      return this.full.split('/').slice(0, -1).join('/')
    }
  }
  const fileContents = extra.fileContents ?? {}
  class DzFile {
    WriteOnly = 2
    Truncate = 4
    constructor(public p: string) {}
    open() {
      return Object.hasOwn(fileContents, this.p)
    }
    read() {
      return fileContents[this.p] ?? ''
    }
    write() {}
    close() {}
  }
  const sandbox: Record<string, unknown> = {
    print: () => {},
    verbose: () => {},
    getScriptFileName: () => 'C:/runtime/.DthProducts.dsa',
    include: () => {
      throw new Error('the sandbox must not include a sibling runtime')
    },
    DzDir,
    DzFile,
    DzFileInfo,
    JSON,
    MessageBox: { information: () => {}, warning: () => {}, critical: () => {} },
    Scene: { getNodeList: () => extra.sceneNodes ?? [] },
  }
  if (appContentDirs) {
    sandbox.App = {
      getContentMgr: () => ({
        getNumContentDirectories: () => appContentDirs.length,
        getContentDirectoryPath: (i: number) => appContentDirs[i],
      }),
    }
  }
  return runInNewContext(`${src}\n;({ ${MATCHING_EXPORTS} })`, sandbox) as MatchingModule
}

describe('product folder keys (DthProducts.dsa)', () => {
  it('extracts vendor/product from the base-figure Morphs root', () => {
    const { productFolderKey } = loadMatching()
    expect(
      productFolderKey(
        '/data/DAZ 3D/Genesis 8/Female/Morphs/guhzcoituz/GC Bodymorph/GC BodyMorph.dsf',
      ),
    ).toBe('guhzcoituz/gc bodymorph')
    expect(productFolderKey('/data/Daz 3D/Genesis 9/Base/Morphs/VendorX/PackY/Waist Shape.dsf')).toBe(
      'vendorx/packy',
    )
  })

  it('still writes off official base content, even under a Morphs root', () => {
    const { productFolderKey } = loadMatching()
    expect(productFolderKey('/data/DAZ 3D/Genesis 8/Female/Genesis8Female.dsf')).toBe('')
    expect(productFolderKey('/data/DAZ 3D/Genesis 8/Female/Morphs/DAZ 3D/Base Pose/x.dsf')).toBe('')
    // A bare Morphs/<file> with no vendor/product pair below it is not a product key.
    expect(productFolderKey('/data/DAZ 3D/Genesis 8/Female/Morphs/loose.dsf')).toBe('')
  })

  it('keys a FLAT texture folder by the folder alone, never by folder/filename', () => {
    // Measured on a real freebie outfit ("GC Lara Croft COD"): its textures live
    // directly in Runtime/textures/<Product>/, and the old two-segment key
    // swallowed the FILENAME ("gc lara croft cod/backpack.jpg" — matched nothing).
    const { productFolderKey } = loadMatching()
    expect(productFolderKey('D:/Lib/Runtime/textures/GC Lara Croft COD/Backpack.jpg')).toBe(
      'gc lara croft cod',
    )
    // A flat DATA layout identifies nothing, and official base textures stay out.
    expect(productFolderKey('/data/SomeVendor/loose.dsf')).toBe('')
    expect(productFolderKey('D:/Lib/Runtime/textures/DAZ 3D/base.jpg')).toBe('')
  })

  it('keeps the vendor-rooted keys unchanged (no morph-segment stealing)', () => {
    // A vendor's own Morphs SUBfolder ("data/<Vendor>/<Product>/Morphs/…") keeps
    // identifying the product by its first two segments, as before.
    const { productFolderKey } = loadMatching()
    expect(productFolderKey('/data/Luthbellina/Adventure Clothes/Morphs/fit.dsf')).toBe(
      'luthbellina/adventure clothes',
    )
    expect(productFolderKey('C:/Lib/Runtime/Textures/Luthbellina/Adventure Clothes/x.jpg')).toBe(
      'luthbellina/adventure clothes',
    )
  })
})

describe('content directories (DthProducts.dsa)', () => {
  it('unions the studio library with every directory Daz has mapped, deduped', () => {
    const { getContentDirectories } = loadMatching([], ['C:\\Lib\\', 'X:/NetLib'])
    expect(getContentDirectories('C:/Lib')).toEqual(['C:/Lib', 'X:/NetLib'])
  })

  it('falls back to the studio library alone when Daz exposes no content manager', () => {
    // No `App` in the sandbox at all — the reference throws and is swallowed.
    const { getContentDirectories } = loadMatching()
    expect(getContentDirectories('C:/Lib')).toEqual(['C:/Lib'])
  })
})

describe('content-folder product synthesis (DthProducts.dsa)', () => {
  const LIB = 'C:/Lib'
  const NET = 'X:/NetLib'
  const TREE = [
    // A regular hand-installed vendor product.
    `${LIB}/data/VendorA/ProdA`,
    // A hand-installed morph under the base-figure root — the GC BodyMorph shape.
    `${LIB}/data/DAZ 3D/Genesis 8/Female/Morphs/guhzcoituz/GC Bodymorph`,
    // Official base morphs must not become a product.
    `${LIB}/data/DAZ 3D/Genesis 8/Female/Morphs/DAZ 3D/Base Correctives`,
    // Content in a SECOND mapped library.
    `${NET}/data/VendorB/ProdB`,
  ].flatMap((leaf) => {
    const parts = leaf.split('/')
    return parts.map((_, i) => parts.slice(0, i + 1).join('/')).filter((p) => p.includes('/'))
  })

  it('synthesizes vendor products, morph-root products, and second-library products', () => {
    const { getContentFolderProducts } = loadMatching(TREE)
    const products = getContentFolderProducts([LIB, NET], [])
    const byName = Object.fromEntries(products.map((p) => [p.name, p]))
    expect(byName['ProdA']).toMatchObject({ artist: 'VendorA', folders: ['vendora/proda'] })
    expect(byName['GC Bodymorph']).toMatchObject({
      artist: 'guhzcoituz',
      folders: ['guhzcoituz/gc bodymorph'],
      productType: 'Content folder',
    })
    expect(byName['ProdB']).toMatchObject({ artist: 'VendorB', folders: ['vendorb/prodb'] })
    expect(byName['Base Correctives']).toBeUndefined()
  })

  it('skips folders a real product already owns', () => {
    const { getContentFolderProducts } = loadMatching(TREE)
    const real = [{ name: 'Adventure Things', folders: ['vendora/proda'], files: [] }]
    const products = getContentFolderProducts([LIB, NET], real)
    expect(products.map((p) => p.name).sort()).toEqual(['GC Bodymorph', 'ProdB'])
  })
})

describe('morph matching end-to-end (DthProducts.dsa)', () => {
  const LIB = 'C:/Lib'
  const morphAsset = (name: string, sourceFile: string) => ({
    type: 'Morph',
    name,
    technicalName: name,
    details: 'Value: 0.200',
    value: 0.2,
    sourceFile,
    path: '',
    textures: [],
  })

  it('places a hand-installed base-root morph on its synthesized folder product', () => {
    const mod = loadMatching(
      [
        'data',
        'data/DAZ 3D',
        'data/DAZ 3D/Genesis 8',
        'data/DAZ 3D/Genesis 8/Female',
        'data/DAZ 3D/Genesis 8/Female/Morphs',
        'data/DAZ 3D/Genesis 8/Female/Morphs/guhzcoituz',
        'data/DAZ 3D/Genesis 8/Female/Morphs/guhzcoituz/GC Bodymorph',
      ].map((p) => `${LIB}/${p}`),
    )
    const synth = mod.getContentFolderProducts([LIB], [])
    const result = mod.findProductMatches(
      [
        morphAsset(
          'GC BodyMorph',
          '/data/DAZ 3D/Genesis 8/Female/Morphs/guhzcoituz/GC Bodymorph/GC BodyMorph.dsf',
        ),
      ],
      [],
      8.1,
      synth,
    )
    expect(result.unmatched).toEqual([])
    expect(result.matches).toHaveLength(1)
    expect(result.matches[0].method).toBe('Content Folder Match')
    expect(result.matches[0].product.name).toBe('GC Bodymorph')
  })

  it('folder-matches a morph to a REAL product whose capped file list dropped it', () => {
    const { findProductMatches } = loadMatching()
    const pack = {
      name: 'Shapes for Genesis 8 Female',
      sku: '11111-1',
      artist: 'VendorX',
      version: '1.0',
      productType: 'Morphs',
      files: [], // the exact file fell off the 60-file manifest cap
      folders: ['vendorx/packy'],
    }
    const result = findProductMatches(
      [morphAsset('Waist Shape', '/data/DAZ 3D/Genesis 8/Female/Morphs/VendorX/PackY/Waist Shape.dsf')],
      [pack],
      8,
      [],
    )
    expect(result.unmatched).toEqual([])
    expect(result.matches[0].method).toBe('Folder Match')
    expect(result.matches[0].product.name).toBe('Shapes for Genesis 8 Female')
  })
})

describe('texture-folder products on demand (DthProducts.dsa)', () => {
  const nodeAsset = (name: string, technicalName: string, textures: Array<string>) => ({
    type: 'Node',
    name,
    technicalName,
    details: 'Rigged Item',
    value: null,
    sourceFile: '',
    parentName: 'Genesis8_1Female',
    textures,
  })

  it('groups flat-texture outfit parts under ONE product named by the folder', () => {
    // The real diagnostic data: Backpack/Boots expose ONLY flat texture paths
    // ("Runtime/textures/GC Lara Croft COD/…") and no source file at all.
    const { findProductMatches } = loadMatching()
    const result = findProductMatches(
      [
        nodeAsset('Backpack', 'Bags_11509', [
          'D:/Lib/Runtime/textures/GC Lara Croft COD/Backpack.jpg',
          'D:/Lib/Runtime/textures/GC Lara Croft COD/Belt_Metal_D.jpg',
        ]),
        nodeAsset('Boots', 'Boots_12736', ['D:/Lib/Runtime/textures/GC Lara Croft COD/Boots_d.jpg']),
      ],
      [],
      8.1,
      [],
    )
    expect(result.unmatched).toEqual([])
    expect(result.matches.map((m) => m.method)).toEqual([
      'Content Folder Match',
      'Content Folder Match',
    ])
    // One shared product, named with the folder's original casing.
    expect(new Set(result.matches.map((m) => m.product.name))).toEqual(new Set(['GC Lara Croft COD']))
  })

  it('names a nested texture folder product vendor-first', () => {
    const { findProductMatches } = loadMatching()
    const result = findProductMatches(
      [
        nodeAsset('SaltBikini_Bra', 'SaltBikini_Bra_2050', [
          'D:/Lib/Runtime/textures/LilFlameIV/SaltBikini/Salt_Bra_BM01.jpg',
        ]),
      ],
      [],
      8.1,
      [],
    )
    expect(result.unmatched).toEqual([])
    expect(result.matches[0].method).toBe('Content Folder Match')
    expect(result.matches[0].product).toMatchObject({ name: 'SaltBikini', artist: 'LilFlameIV' })
  })

  it('never synthesizes a product from the figure skin folders', () => {
    // A geograft carrying the figure's copied skin must not spawn (or match) a
    // product named after the SKIN's texture folder.
    const { findProductMatches } = loadMatching()
    const figure = {
      type: 'Node',
      name: 'Genesis 8.1 Female',
      technicalName: 'Genesis8_1Female',
      details: 'Figure',
      value: null,
      sourceFile: '',
      parentName: '',
      textures: ['D:/Lib/Runtime/textures/SomeSkin/face.jpg'],
    }
    const graft = nodeAsset('Attachment Thing', 'AttachmentThing', [
      'D:/Lib/Runtime/textures/SomeSkin/face.jpg',
    ])
    const result = findProductMatches([figure, graft], [], 8.1, [])
    expect(result.matches).toEqual([])
    expect(result.unmatched.map((u) => u.name).sort()).toEqual([
      'Attachment Thing',
      'Genesis 8.1 Female',
    ])
  })
})

describe('morph basename matching (DthProducts.dsa)', () => {
  it('matches a no-source-file morph to the morph-root folder holding its .dsf', () => {
    // Measured: a hand-installed G8.1 morph exposes NO source file to the scan
    // (getAssetUri / getAssetFileInfo / getAssetId all empty), so the folder key
    // has nothing to key on — the file's NAME inside the synthesized folder is
    // the only remaining evidence.
    const LIB = 'C:/Lib'
    const dirs = [
      'data',
      'data/DAZ 3D',
      'data/DAZ 3D/Genesis 8',
      'data/DAZ 3D/Genesis 8/Female',
      'data/DAZ 3D/Genesis 8/Female/Morphs',
      'data/DAZ 3D/Genesis 8/Female/Morphs/guhzcoituz',
      'data/DAZ 3D/Genesis 8/Female/Morphs/guhzcoituz/GC Bodymorph',
    ].map((p) => `${LIB}/${p}`)
    const files = [`${LIB}/data/DAZ 3D/Genesis 8/Female/Morphs/guhzcoituz/GC Bodymorph/GC BodyMorph.dsf`]
    const mod = loadMatching(dirs, undefined, files)
    const synth = mod.getContentFolderProducts([LIB], [])
    const result = mod.findProductMatches(
      [
        {
          type: 'Morph',
          name: 'GC BodyMorph',
          technicalName: 'GC BodyMorph',
          details: 'Value: 0.200',
          value: 0.2,
          sourceFile: '', // what the scan actually sees
          path: '',
          textures: [],
        },
      ],
      [],
      8.1,
      synth,
    )
    expect(result.unmatched).toEqual([])
    expect(result.matches[0].method).toBe('Content Folder Match')
    expect(result.matches[0].product.name).toBe('GC Bodymorph')
  })
})

describe('no-source-file morphs of REAL products (DthProducts.dsa)', () => {
  const morph = (name: string, path: string) => ({
    type: 'Morph',
    name,
    technicalName: name,
    details: 'Value: -0.167',
    value: -0.167,
    sourceFile: '', // what the scan actually sees (measured)
    path,
    textures: [],
  })
  const product = (name: string, files: Array<string>, folders: Array<string> = []) => ({
    name,
    sku: '23127-1',
    artist: 'Zev0',
    version: '1.0',
    productType: 'Morphs',
    files,
    folders,
  })

  it('matches through the manifest morph-file list ("Manifest Match")', () => {
    // The real Waist Shape case: a Shape Shift morph dialed on the figure,
    // exposing no source file — but the product's DIM manifest lists the .dsf.
    const { findProductMatches } = loadMatching()
    const result = findProductMatches(
      [morph('Waist Shape', 'Actor/Waist/Real World/Shape Shift/Waist')],
      [product('Shape Shift', ['data/daz 3d/genesis 8/female/morphs/zev0/shape shift/waist shape.dsf'])],
      8.1,
      [],
    )
    expect(result.unmatched).toEqual([])
    expect(result.matches[0].method).toBe('Manifest Match')
    expect(result.matches[0].product.name).toBe('Shape Shift')
  })

  it('prefers the file under the scene generation and the path-named product', () => {
    // Vendors ship the SAME basename per generation; the G8 scene must land on
    // the G8 product, not the G3 one that happens to sort first.
    const { findProductMatches } = loadMatching()
    const g3 = product('Shape Shift for Genesis 3', [
      'data/daz 3d/genesis 3/female/morphs/zev0/shape shift/waist shape.dsf',
    ])
    const g8 = product('Shape Shift Genesis 8', [
      'data/daz 3d/genesis 8/female/morphs/zev0/shape shift/waist shape.dsf',
    ])
    const result = findProductMatches(
      [morph('Waist Shape', 'Actor/Waist/Real World/Shape Shift/Waist')],
      [g3, g8],
      8,
      [],
    )
    expect(result.matches[0].product.name).toBe('Shape Shift Genesis 8')
  })

  it('lists a real product\'s OWNED morph folder for files past the manifest cap', () => {
    // The manifest's capped file list dropped the .dsf, but the product owns
    // the folder — the hidden ownedBy record lets the basename matcher list it
    // on disk and attribute the morph to the REAL product ("Folder Match").
    const LIB = 'C:/Lib'
    const dirs = [
      'data',
      'data/DAZ 3D',
      'data/DAZ 3D/Genesis 8',
      'data/DAZ 3D/Genesis 8/Female',
      'data/DAZ 3D/Genesis 8/Female/Morphs',
      'data/DAZ 3D/Genesis 8/Female/Morphs/Zev0',
      'data/DAZ 3D/Genesis 8/Female/Morphs/Zev0/Shape Shift',
    ].map((p) => `${LIB}/${p}`)
    const files = [`${LIB}/data/DAZ 3D/Genesis 8/Female/Morphs/Zev0/Shape Shift/Waist Shape.dsf`]
    const mod = loadMatching(dirs, undefined, files)
    const shapeShift = product('Shape Shift', [], ['zev0/shape shift'])
    const synth = mod.getContentFolderProducts([LIB], [shapeShift])
    const result = mod.findProductMatches(
      [morph('Waist Shape', 'Actor/Waist/Real World/Shape Shift/Waist')],
      [shapeShift],
      8.1,
      synth,
    )
    expect(result.unmatched).toEqual([])
    expect(result.matches[0].method).toBe('Folder Match')
    expect(result.matches[0].product.name).toBe('Shape Shift')
  })
})

describe('big morph packs past the caps (DthProducts.dsa)', () => {
  it('keeps EVERY morph basename from a manifest, past the 60-file cap', () => {
    // The measured Shape Shift case: the manifest lists 166 morph files and
    // "Waist Shape.dsf" is #163 — the capped `files` list drops it, and the
    // basename matcher needs exactly that name.
    const morphFiles = [
      ...Array.from({ length: 69 }, (_, i) => `Belly Fold ${String(i).padStart(2, '0')}.dsf`),
      'Waist Shape.dsf',
    ]
    const manifest =
      '<DAZInstallManifest VERSION="0.1">\n<ProductName VALUE="Shape Shift"/>\n' +
      morphFiles
        .map(
          (f) =>
            `<File TARGET="Content" ACTION="Install" VALUE="Content/data/DAZ 3D/Genesis 8/Female/Morphs/Zev0/Shape Shift/${f}"/>`,
        )
        .join('\n') +
      '\n</DAZInstallManifest>'
    const mod = loadMatching([], undefined, [], {
      fileContents: { 'D:/DIM/IM00045723-01_ShapeShift.dsx': manifest },
    })
    const product = mod.parseManifestFile('D:/DIM/IM00045723-01_ShapeShift.dsx')
    expect(product?.files).toHaveLength(60)
    expect(product?.morphKeys).toHaveLength(70)
    expect(product?.morphKeys).toContain('waistshape')
    // Every key carries ITS OWN file's generation tag, read case-immune from
    // the manifest's raw "Genesis 8" spelling.
    expect(product?.morphGens).toHaveLength(70)
    expect(product?.morphGens?.every((g: number) => g === 8)).toBe(true)
  })

  it('manifest-matches a morph whose file fell past the 60-file cap', () => {
    const { findProductMatches } = loadMatching()
    const shapeShift = {
      name: 'Shape Shift',
      sku: '45723-1',
      artist: 'Zev0',
      version: '1.0',
      productType: 'Morphs',
      files: [], // the capped list — Waist Shape fell off it
      folders: ['zev0/shape shift'],
      morphKeys: ['bellydiameter', 'waistshape'],
      morphSample: 'data/daz 3d/genesis 8/female/morphs/zev0/shape shift/belly diameter.dsf',
    }
    const result = findProductMatches(
      [
        {
          type: 'Morph',
          name: 'Waist Shape',
          technicalName: 'Waist Shape',
          details: 'Value: -0.167',
          value: -0.167,
          sourceFile: '',
          path: 'Actor/Waist/Real World/Shape Shift/Waist',
          textures: [],
        },
      ],
      [shapeShift],
      8.1,
      [],
    )
    expect(result.unmatched).toEqual([])
    expect(result.matches[0].method).toBe('Manifest Match')
    expect(result.matches[0].product.name).toBe('Shape Shift')
  })

  it('ranks by EACH file\'s generation, not the manifest\'s first sample', () => {
    // One manifest lists both generations' copies (the real Shape Shift shape):
    // the G3 copy sorts first, so a single morphSample would tag every key G3
    // — and the raw "Genesis 8" casing must not defeat the check either. The
    // morph's parameter path names neither product, so generation fit is the
    // only signal; the wrong-generation product comes FIRST in the index to
    // catch a first-wins tie.
    const { findProductMatches } = loadMatching()
    const wrongGen = {
      name: 'Slim Shapes for Genesis 3',
      sku: '11111-1',
      artist: 'Other',
      version: '1.0',
      productType: 'Morphs',
      files: [],
      folders: ['other/slim shapes'],
      morphKeys: ['waistshape'],
      morphGens: [3],
      morphSample: 'Content/data/DAZ 3D/Genesis 3/Female/Morphs/Other/Slim Shapes/Waist Shape.dsf',
    }
    const shapeShift = {
      name: 'Shape Shift',
      sku: '45723-1',
      artist: 'Zev0',
      version: '1.0',
      productType: 'Morphs',
      files: [],
      folders: ['zev0/shape shift'],
      morphKeys: ['bellydiameter', 'waistshape'],
      morphGens: [3, 8], // the G3 belly file is listed first — per-key tags matter
      morphSample: 'Content/data/DAZ 3D/Genesis 3/Female/Morphs/Zev0/Shape Shift/Belly Diameter.dsf',
    }
    const result = findProductMatches(
      [
        {
          type: 'Morph',
          name: 'Waist Shape',
          technicalName: 'Waist Shape',
          details: 'Value: -0.167',
          value: -0.167,
          sourceFile: '',
          path: 'Actor/Waist/Real World/Waist',
          textures: [],
        },
      ],
      [wrongGen, shapeShift],
      8.1,
      [],
    )
    expect(result.unmatched).toEqual([])
    expect(result.matches[0].method).toBe('Manifest Match')
    expect(result.matches[0].product.name).toBe('Shape Shift')
  })

  it('folder-lists past 80 files (the old per-folder cap)', () => {
    const LIB = 'C:/Lib'
    const FOLDER = 'data/DAZ 3D/Genesis 8/Female/Morphs/Zev0/Shape Shift'
    const dirs = [
      'data',
      'data/DAZ 3D',
      'data/DAZ 3D/Genesis 8',
      'data/DAZ 3D/Genesis 8/Female',
      'data/DAZ 3D/Genesis 8/Female/Morphs',
      'data/DAZ 3D/Genesis 8/Female/Morphs/Zev0',
      FOLDER,
    ].map((p) => `${LIB}/${p}`)
    // 120 files sorting before the target, mirroring the real 166-file folder.
    const files = [
      ...Array.from({ length: 120 }, (_, i) => `${LIB}/${FOLDER}/A Morph ${String(i).padStart(3, '0')}.dsf`),
      `${LIB}/${FOLDER}/Waist Shape.dsf`,
    ]
    const mod = loadMatching(dirs, undefined, files)
    const shapeShift = {
      name: 'Shape Shift',
      sku: '45723-1',
      artist: 'Zev0',
      version: '1.0',
      productType: 'Morphs',
      files: [],
      folders: ['zev0/shape shift'],
      // No morphKeys — the owned-folder listing is the only route.
    }
    const synth = mod.getContentFolderProducts([LIB], [shapeShift])
    const result = mod.findProductMatches(
      [
        {
          type: 'Morph',
          name: 'Waist Shape',
          technicalName: 'Waist Shape',
          details: 'Value: -0.167',
          value: -0.167,
          sourceFile: '',
          path: 'Actor/Waist/Real World/Shape Shift/Waist',
          textures: [],
        },
      ],
      [shapeShift],
      8.1,
      synth,
    )
    expect(result.unmatched).toEqual([])
    expect(result.matches[0].method).toBe('Folder Match')
    expect(result.matches[0].product.name).toBe('Shape Shift')
  })
})

describe('child-node morphs are the node product\'s own (DthProducts.dsa)', () => {
  it('collects morphs from the figure only, not from fitted items', () => {
    // The measured false positive: a generic "Expand_All" fit morph dialed on a
    // fitted bikini basename-matched an unrelated outfit's manifest. Morphs on
    // a CHILD node are always part of the product that brought the node.
    const channel = (v: number) => ({ getValue: () => v, getPath: () => 'Actor/Fit' })
    const dzMorph = (name: string, v: number) => ({
      inherits: (c: string) => c === 'DzMorph',
      getValueChannel: () => channel(v),
      getName: () => name,
      getLabel: () => name,
    })
    const node = (label: string, name: string, parent: unknown, morphs: Array<unknown>) => ({
      getLabel: () => label,
      getName: () => name,
      className: () => 'DzNode',
      getNodeParent: () => parent,
      getObject: () => ({
        getNumModifiers: () => morphs.length,
        getModifier: (i: number) => morphs[i],
        getCurrentShape: () => null,
      }),
    })
    const figure = node('Genesis 8.1 Female', 'Genesis8_1Female', null, [
      dzMorph('GC BodyMorph', 0.2),
    ])
    const bikini = node('SaltBikini_Bra', 'SaltBikini_Bra_2050', figure, [
      dzMorph('Expand_All', 0.6), // the item's own fit morph
      dzMorph('GC BodyMorph', 0.2), // an auto-follow projection of the figure morph
    ])
    const mod = loadMatching([], undefined, [], { sceneNodes: [figure, bikini] })
    const assets = mod.getUsedAssets()
    const morphs = assets.filter((a) => a.type === 'Morph').map((a) => a.name)
    expect(morphs).toEqual(['GC BodyMorph']) // the figure's copy only
    expect(assets.filter((a) => a.type === 'Node')).toHaveLength(2)
  })

  it('a FOLLOWING item never contributes morphs, even named after the figure', () => {
    // Geografts are routinely named for the figure ("Genesis 8 Female
    // Genitalia") — the genesis-name exception must not re-admit their
    // projected morphs. A follow target outranks any name: following = fitted.
    const channel = (v: number) => ({ getValue: () => v, getPath: () => 'Actor/Fit' })
    const dzMorph = (name: string, v: number) => ({
      inherits: (c: string) => c === 'DzMorph',
      getValueChannel: () => channel(v),
      getName: () => name,
      getLabel: () => name,
    })
    const node = (
      label: string,
      name: string,
      parent: unknown,
      morphs: Array<unknown>,
      followTarget: unknown = null,
    ) => ({
      getLabel: () => label,
      getName: () => name,
      className: () => 'DzNode',
      getNodeParent: () => parent,
      getFollowTarget: () => followTarget,
      getObject: () => ({
        getNumModifiers: () => morphs.length,
        getModifier: (i: number) => morphs[i],
        getCurrentShape: () => null,
      }),
    })
    const figure = node('Genesis 8.1 Female', 'Genesis8_1Female', null, [
      dzMorph('GC BodyMorph', 0.2),
    ])
    const graft = node(
      'Genesis 8 Female Genitalia',
      'Genesis8FemaleGenitalia',
      figure,
      [dzMorph('GC BodyMorph', 0.2)], // an auto-follow projection
      figure, // fitted: it follows the figure
    )
    const mod = loadMatching([], undefined, [], { sceneNodes: [figure, graft] })
    const morphs = mod
      .getUsedAssets()
      .filter((a) => a.type === 'Morph')
      .map((a) => a.name)
    expect(morphs).toEqual(['GC BodyMorph']) // the figure's copy only
  })
})
