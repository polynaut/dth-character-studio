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
  'e4d8c0b5ea83d0328bcefb5813382ca9542562f7525ad725f1c78e3d4fc79baf'

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
