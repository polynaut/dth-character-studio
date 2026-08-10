import { describe, expect, it } from 'vitest'

import { characterSchema, generateAll } from './index.ts'
import type { Character, IndexSyncOptions, PresetFrames } from './index.ts'

/**
 * Scan-on-export: every generated ROM/export script scans the scene it has just
 * verified, so the studio's morph index — and, with Daz Products on, the product
 * results — stay current off the app's CORE flow, with no separate Tools pass.
 */

const FRAMES: PresetFrames = { base: 328, gp: 104, dk: 54, phys: 43 }

function character(over: Partial<Character> = {}): Character {
  return characterSchema.parse({
    id: 'c1',
    name: 'Kira',
    genesis: 'G9',
    gender: 'female',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    scenePath: 'D:/proj/Kira/daz3d/Kira.duf',
    exportPath: 'D:/exports',
    ...over,
  })
}

const SYNC: IndexSyncOptions = { morphIndexDir: 'C:/AppData/dth' }
const SYNC_WITH_PRODUCTS: IndexSyncOptions = {
  morphIndexDir: 'C:/AppData/dth',
  products: {
    characterId: 'c1',
    characterName: 'Kira',
    genesis: 'G9',
    dimManifestPath: 'C:/DAZ 3D/Install Manager/ManifestFiles',
    outputDir: 'C:/AppData/dth/product-scans/p/c1',
    dazLibraryFolder: 'D:/DAZ 3D/My DAZ 3D Library',
  },
}

/** The generated `.dsa` scripts of a run, by file name. */
function scripts(sync?: IndexSyncOptions): Record<string, string> {
  const files = generateAll(
    character(),
    {},
    FRAMES,
    'D:/proj/Kira',
    '2.4.4',
    undefined,
    {},
    {},
    undefined,
    '',
    sync,
  )
  const out: Record<string, string> = {}
  for (const f of files) if (f.fileName.endsWith('.dsa')) out[f.fileName] = f.content
  return out
}

/**
 * Every generated script that BUILDS or EXPORTS — derived from the output
 * rather than hard-coded, so a new script variant is covered automatically
 * instead of quietly escaping the rule. The product-scan script is excluded:
 * it is the standalone manual path, not a run.
 */
function runScripts(built: Record<string, string>): Array<string> {
  return Object.keys(built).filter((name) => !name.startsWith('Scan_Products_'))
}

/** Sanity: the shapes a DTH Export batch actually hands the Runner exist. */
const REQUIRED = ['.Bulk_ROM_Export.dsa', '.Bulk_Export_Only.dsa', '.Build_ROM_Animation.dsa']

describe('scan-on-export (indexSync)', () => {
  it('every ROM/export script scans the scene, and loads the runtime to do it', () => {
    const built = scripts(SYNC)
    for (const name of REQUIRED) expect(built[name], `${name} missing`).toBeDefined()
    for (const name of runScripts(built)) {
      expect(built[name], name).toContain('DthScanSceneMorphsQuiet')
      // The scan runtime has to be loaded, or the guarded call silently no-ops.
      expect(built[name], name).toContain('.DthScanMorphs.dsa')
      // Filed under the SOURCE scene: dthOpenSceneFile is the capture that a
      // ROM save-as / an opened ROM animation both resolve back to.
      expect(built[name], name).toContain('DthScanSceneMorphsQuiet("C:/AppData/dth", dthOpenSceneFile)')
    }
  })

  it('the SPLIT Export_ and the groom script scan too (the fixture blind spot)', () => {
    // The derived loop above only covers what the default fixture emits —
    // exportWithRomScript stays true there, so the standalone Export_ script
    // (and the groom script, which needs a hair list) never appeared in it and
    // their indexSync wiring escaped the very test built to catch new
    // variants. Pin them explicitly.
    const files = generateAll(
      character({
        exportWithRomScript: false,
        sceneOverrides: [
          { scenePath: 'D:/proj/Kira/daz3d/Kira.duf', rom: {}, hair: [{ nodeLabel: 'Kira Hair' }] },
        ],
      }),
      {},
      FRAMES,
      'D:/proj/Kira',
      '2.4.4',
      undefined,
      {},
      {},
      undefined,
      '',
      SYNC,
    )
    const byName: Record<string, string> = {}
    for (const f of files) if (f.fileName.endsWith('.dsa')) byName[f.fileName] = f.content
    for (const name of ['Export_Kira_G9.dsa', 'Export_Hair_Kira_G9.dsa']) {
      expect(byName[name], `${name} missing`).toBeDefined()
      expect(byName[name], name).toContain('.DthScanMorphs.dsa')
      expect(byName[name], name).toContain('DthScanSceneMorphsQuiet("C:/AppData/dth", dthOpenSceneFile)')
    }
  })

  it('scans BEFORE the ROM build — the scene is still pristine there', () => {
    // After ApplyDTHCharacter the ROM is dialled onto the figure and the scene
    // has been saved as <stem>_ROM.duf; scanning first is the truest picture of
    // what the scene actually wears.
    const rom = scripts(SYNC)['.Bulk_ROM_Export.dsa']
    expect(rom.indexOf('DthScanSceneMorphsQuiet')).toBeLessThan(
      rom.indexOf('ApplyDTHCharacter(dthCharacterConfig)'),
    )
  })

  it('scans only AFTER the wrong-scene guard has passed', () => {
    // Scanning a scene this character doesn't own would file another
    // character's clothing under it.
    const rom = scripts(SYNC)['.Bulk_ROM_Export.dsa']
    expect(rom.indexOf('dthSceneLinkError()')).toBeLessThan(rom.indexOf('DthScanSceneMorphsQuiet'))
  })

  it('adds the product scan only when the project enables Daz Products', () => {
    const without = scripts(SYNC)
    for (const name of runScripts(without)) {
      expect(without[name], name).not.toContain('DthScanProductsQuiet')
      expect(without[name], name).not.toContain('.DthProducts.dsa')
    }
    const withProducts = scripts(SYNC_WITH_PRODUCTS)
    for (const name of runScripts(withProducts)) {
      expect(withProducts[name], name).toContain('DthScanProductsQuiet')
      expect(withProducts[name], name).toContain('.DthProducts.dsa')
      // The scan is pointed at the SOURCE scene, like the morph one.
      expect(withProducts[name], name).toContain(
        'dthProductScanConfig.scenePath = dthOpenSceneFile',
      )
      // …and carries the same config the standalone script bakes in.
      expect(withProducts[name], name).toContain('C:/AppData/dth/product-scans/p/c1')
    }
  })

  it('emits nothing at all without indexSync — a pure/web build stays scan-free', () => {
    const built = scripts()
    for (const name of runScripts(built)) {
      expect(built[name], name).not.toContain('DthScanSceneMorphsQuiet')
      expect(built[name], name).not.toContain('DthScanProductsQuiet')
    }
  })

  it('keeps the standalone Scan_Products script — the manual path still exists', () => {
    const files = generateAll(
      character(),
      {},
      FRAMES,
      'D:/proj/Kira',
      '2.4.4',
      SYNC_WITH_PRODUCTS.products,
      {},
      {},
      undefined,
      '',
      SYNC_WITH_PRODUCTS,
    )
    expect(files.some((f) => f.fileName.startsWith('Scan_Products_'))).toBe(true)
  })
})
