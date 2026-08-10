import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { runInNewContext } from 'node:vm'

import { describe, expect, it } from 'vitest'

/**
 * Reading a figure's SOURCE ASSET — which is how the studio knows what
 * generation a scene holds.
 *
 * The bug these pin (measured 2026-08-10, Daz Studio 4, a G8.1 scene):
 * `dthNodeAssetPath` asked the NODE for its asset URI and nothing else. DS4
 * answers with nothing there, so `dthDetectGenesis` found no generation, and
 * the scene morph scan skipped every scene with *"No Genesis 3, 8, 8.1 or 9
 * figure could be found"* — seven seconds before the same run keyed morphs on
 * `Genesis8_1Female`. The asset rides on the OBJECT (or its shape/geometry),
 * which is exactly what the product scan had always walked, and does resolve in
 * DS4.
 *
 * Driven against the SHIPPED `DthUtils.dsa` over fake Daz objects, so this is
 * the real code path rather than a model of it.
 */

interface AssetModule {
  dthNodeAssetPath: (node: unknown) => string
  dthElementAssetPath: (el: unknown) => string
  dthGenerationAssetFiles: (genesis: string) => Array<string> | null
}

const EXPORTS = 'dthNodeAssetPath, dthElementAssetPath, dthGenerationAssetFiles'

function loadUtils(): AssetModule {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'runtime')
  const src = readFileSync(join(dir, 'DthUtils.dsa'), 'utf8')
  return runInNewContext(`${src}\n;({ ${EXPORTS} })`, {
    print: () => {},
    Date,
    JSON,
    // DthUtils touches these at CALL time only, so the sandbox just has to
    // supply the names — nothing here constructs one.
    DzFile: function DzFile() {},
    DzFileInfo: function DzFileInfo() {},
    Scene: { getFilename: () => '' },
  }) as AssetModule
}

/** A Daz-ish element exposing an asset URI the way DS6 does. */
const withUri = (path: string) => ({ getAssetUri: () => ({ getFilePath: () => path }) })
/** …and one that answers nothing at all, the way DS4 answers a NODE. */
const silent = () => ({ getAssetUri: () => null })

const G81 = '/data/Daz 3D/Genesis 8_1/Female/Genesis8_1Female.dsf'

/** `dthKnownGenesis` lives in DthScanMorphs.dsa and calls into DthUtils.dsa —
 *  load both, in the order the runtime includes them. */
function loadKnownGenesis(): (value: unknown) => string {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'runtime')
  const src = [
    readFileSync(join(dir, 'DthUtils.dsa'), 'utf8'),
    readFileSync(join(dir, 'DthScanMorphs.dsa'), 'utf8'),
  ].join('\n')
  return runInNewContext(`${src}\n;dthKnownGenesis`, {
    print: () => {},
    Date,
    JSON,
    DzFile: function DzFile() {},
    DzFileInfo: function DzFileInfo() {},
    MessageBox: { information: () => {} },
    Scene: { getFilename: () => '' },
  }) as (value: unknown) => string
}

describe('dthNodeAssetPath — where the asset identity actually lives', () => {
  const utils = loadUtils()

  it('takes the node’s own URI when the node has one (the DS6 path)', () => {
    expect(utils.dthNodeAssetPath(withUri(G81))).toBe(G81.toLowerCase())
  })

  it('falls through to the OBJECT when the node answers nothing (the DS4 bug)', () => {
    const node = { ...silent(), getObject: () => withUri(G81) }
    expect(utils.dthNodeAssetPath(node)).toBe(G81.toLowerCase())
  })

  it('…and on to the SHAPE, and its GEOMETRY', () => {
    const viaShape = {
      ...silent(),
      getObject: () => ({ ...silent(), getCurrentShape: () => withUri(G81) }),
    }
    expect(utils.dthNodeAssetPath(viaShape)).toBe(G81.toLowerCase())

    const viaGeometry = {
      ...silent(),
      getObject: () => ({
        ...silent(),
        getCurrentShape: () => ({ ...silent(), getGeometry: () => withUri(G81) }),
      }),
    }
    expect(utils.dthNodeAssetPath(viaGeometry)).toBe(G81.toLowerCase())
  })

  it('reads getAssetFileInfo() where getAssetUri() is absent', () => {
    const node = { getAssetFileInfo: () => ({ getFilePath: () => G81 }) }
    expect(utils.dthNodeAssetPath(node)).toBe(G81.toLowerCase())
  })

  it('is lowercased, so the generation match is case-insensitive', () => {
    // dthDetectGenesis compares against lowercase file names — a Windows path
    // with the vendor's capitalisation must still match.
    expect(utils.dthNodeAssetPath(withUri('/DATA/Genesis8_1Female.DSF'))).toBe(
      '/data/genesis8_1female.dsf',
    )
  })

  it('returns "" when nothing in the chain can answer — never throws', () => {
    expect(utils.dthNodeAssetPath(null)).toBe('')
    expect(utils.dthNodeAssetPath({})).toBe('')
    expect(utils.dthNodeAssetPath(silent())).toBe('')
    // A whole chain of silent elements is still an honest '' rather than a crash.
    const deep = {
      ...silent(),
      getObject: () => ({ ...silent(), getCurrentShape: () => ({ ...silent(), getGeometry: () => null }) }),
    }
    expect(utils.dthNodeAssetPath(deep)).toBe('')
  })

  it('survives an API that THROWS instead of returning nothing', () => {
    const hostile = {
      getAssetUri: () => {
        throw new Error('not in this Studio')
      },
      getObject: () => withUri(G81),
    }
    expect(utils.dthNodeAssetPath(hostile)).toBe(G81.toLowerCase())
  })
})

describe('the generation table the match runs against', () => {
  const utils = loadUtils()

  it('knows the four generations, and only those', () => {
    // `dthKnownGenesis` (DthScanMorphs) gates the studio-declared fallback on
    // exactly this: a value this table doesn't know must never name an index
    // file, or nothing could read it back.
    for (const g of ['G9', 'G8.1', 'G8', 'G3']) expect(utils.dthGenerationAssetFiles(g)).toBeTruthy()
    for (const g of ['G10', 'g9', '', 'Genesis 9']) {
      expect(utils.dthGenerationAssetFiles(g)).toBeNull()
    }
  })

  it('the G8.1 files are the ones the failing scene’s figure would match', () => {
    expect(utils.dthGenerationAssetFiles('G8.1')).toContain('genesis8_1female.dsf')
  })
})

/**
 * The other half of the DS4 fix: when no figure in the scene can be identified,
 * a studio-started run falls back to the CHARACTER's declared generation. That
 * value comes from outside the scene, so it is gated — an index file named
 * after a generation the reader doesn't know is one nothing can ever read back.
 *
 * Driven against the shipped `DthScanMorphs.dsa` (loaded over `DthUtils.dsa`,
 * which it requires), so this is the real gate rather than a model of it.
 */
describe('dthKnownGenesis — the fallback is trusted only as far as the index is', () => {
  const known = loadKnownGenesis()

  it('accepts exactly the generations the index can name', () => {
    for (const g of ['G9', 'G8.1', 'G8', 'G3']) expect(known(g)).toBe(g)
  })

  it('refuses anything the reader would not recognise', () => {
    // A future generation, a typo, wrong case — each would write
    // `morphs_scenes_<G>.json` under a name no reader looks for, which is
    // worse than the skip this fallback exists to prevent.
    for (const g of ['G10', 'g9', 'Genesis 9', 'G8_1', 'nonsense']) expect(known(g)).toBe('')
  })

  it('treats "no answer" as no answer, never as a value', () => {
    // The standalone script passes nothing at all; the bulk sidecar can carry
    // an absent or blank field. All of those must fall through to the error.
    expect(known(undefined)).toBe('')
    expect(known(null)).toBe('')
    expect(known('')).toBe('')
    expect(known('   ')).toBe('')
  })

  it('tolerates the whitespace a hand-edited sidecar can carry', () => {
    expect(known('  G8.1  ')).toBe('G8.1')
  })
})
