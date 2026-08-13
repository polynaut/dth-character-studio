import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { unrealEngineInstallSchema } from '#/lib/rom/api/native-types.ts'
import {
  allPluginBuilds,
  buildUnrealScan,
  engineVersionFromAssociation,
  isZippedPlugin,
  matchPluginsToEngine,
  pluginBuildMismatch,
  pluginMatchesEngine,
  pluginVersionLabel,
  type UnrealPluginSource,
} from './unreal-install.ts'

const plugin = (over: Partial<UnrealPluginSource>): UnrealPluginSource => ({
  name: 'DazToUnreal',
  path: 'D:/plugins/DazToUnreal',
  engineVersion: '5.7',
  sourceFolder: 'D:/plugins',
  ...over,
})

describe('buildUnrealScan', () => {
  it('sorts newest first, numerically — 5.10 beats 5.7', () => {
    const scan = buildUnrealScan(
      [
        { version: '5.7', path: 'D:/UE_5.7' },
        { version: '5.10', path: 'D:/UE_5.10' },
        { version: '4.27', path: 'C:/UE_4.27' },
      ],
      new Set(['D:/UE_5.7', 'D:/UE_5.10']),
    )
    expect(scan.installs.map((i) => i.version)).toEqual(['5.10', '5.7', '4.27'])
    expect(scan.installs[0]?.name).toBe('Unreal Engine 5.10')
    // The uninstalled-but-still-registered engine is flagged, not dropped.
    expect(scan.installs.map((i) => i.exists)).toEqual([true, true, false])
  })

  it('carries the native fields THROUGH to the UI — buildId included', () => {
    // The gap that made the BuildId check inert: this function used to rebuild
    // each install field by field, so `buildId` never reached the dialog and
    // every mismatch check answered "cannot tell". The dialog tests mock
    // `detectUnrealEngines`, so nothing between the schema and the UI was
    // covered. Asserted end-to-end here — parse the wire shape, run the real
    // scan, and ask the real matcher.
    const parsed = z.array(unrealEngineInstallSchema).parse([
      { version: '5.8', path: 'D:/UE_5.8', buildId: '55116800' },
    ])
    const scan = buildUnrealScan(parsed, new Set(['D:/UE_5.8']))
    expect(scan.installs[0]?.buildId).toBe('55116800')
    // …and the verdict the checklist actually asks for, off that same object.
    expect(pluginBuildMismatch({ buildId: '47537391' }, scan.installs[0])).toBe(true)
    expect(pluginBuildMismatch({ buildId: '55116800' }, scan.installs[0])).toBe(false)
  })
})

describe('engineVersionFromAssociation', () => {
  it('accepts launcher versions, normalized to major.minor', () => {
    expect(engineVersionFromAssociation('5.7')).toBe('5.7')
    expect(engineVersionFromAssociation(' 5.7 ')).toBe('5.7')
    expect(engineVersionFromAssociation('5.7.1')).toBe('5.7')
  })

  it('names no matchable version for GUIDs, empties and custom ids', () => {
    expect(engineVersionFromAssociation('')).toBeNull()
    expect(engineVersionFromAssociation('{1AC42E62-5A4F-2D31-A3C4-9DA2BBBB78A2}')).toBeNull()
    expect(engineVersionFromAssociation('MySourceBuild')).toBeNull()
    expect(engineVersionFromAssociation('5')).toBeNull()
  })
})

describe('plugin matching', () => {
  it('matches on the exact release, and any-engine builds always', () => {
    expect(pluginMatchesEngine(plugin({ engineVersion: '5.7' }), '5.7')).toBe(true)
    expect(pluginMatchesEngine(plugin({ engineVersion: '5.6' }), '5.7')).toBe(false)
    expect(pluginMatchesEngine(plugin({ engineVersion: '' }), '5.7')).toBe(true)
  })

  it('offers ONE build per plugin name — the exact match beats any-engine', () => {
    const offered = matchPluginsToEngine(
      [
        plugin({ engineVersion: '', path: 'D:/a/DazToUnreal' }),
        plugin({ engineVersion: '5.7', path: 'D:/b/UE_5.7/DazToUnreal' }),
        plugin({ engineVersion: '5.6', path: 'D:/b/UE_5.6/DazToUnreal' }),
        plugin({ name: 'Other', engineVersion: '5.7', path: 'D:/c/Other' }),
      ],
      '5.7',
    )
    expect(offered.map((p) => [p.name, p.path])).toEqual([
      ['DazToUnreal', 'D:/b/UE_5.7/DazToUnreal'],
      ['Other', 'D:/c/Other'],
    ])
  })

  it('keeps the scan order on a same-version tie (the scan sorts by path — deterministic)', () => {
    const offered = matchPluginsToEngine(
      [
        plugin({ engineVersion: '5.7', path: 'D:/first/DazToUnreal' }),
        plugin({ engineVersion: '5.7', path: 'D:/second/DazToUnreal' }),
      ],
      '5.7',
    )
    expect(offered.map((p) => p.path)).toEqual(['D:/first/DazToUnreal'])
  })

  it('picks the build whose BINARIES fit over the one that merely sorts first', () => {
    // The reporter's own folder shape, and the case the version label cannot
    // reach: two KawaiiPhysics builds, BOTH reading as `any engine` (the
    // underscores are not a version), so the alphabetically first — 5.7 — used
    // to be the one offered to a 5.8 project. It was then marked unloadable
    // while the 5.8 build that WOULD have worked never appeared at all.
    const engine58 = { buildId: '55116800' }
    const offered = matchPluginsToEngine(
      [
        plugin({
          name: 'KawaiiPhysics',
          engineVersion: '',
          path: 'X:/p/KawaiiPhysics_5_7_1/Plugins/KawaiiPhysics',
          buildId: '47537391',
        }),
        plugin({
          name: 'KawaiiPhysics',
          engineVersion: '',
          path: 'X:/p/KawaiiPhysics_5_8_0/Plugins/KawaiiPhysics',
          buildId: '55116800',
        }),
      ],
      '5.8',
      engine58,
    )
    expect(offered.map((p) => p.path)).toEqual(['X:/p/KawaiiPhysics_5_8_0/Plugins/KawaiiPhysics'])
    expect(pluginBuildMismatch(offered[0], engine58)).toBe(false)
  })

  it('lets a proven BuildId outrank a version LABEL, in both directions', () => {
    const engine57 = { buildId: '47537391' }
    // An any-engine build proven to fit beats a 5.7-labelled build proven not
    // to: the label is what someone typed, the id is what the compiler wrote.
    const offered = matchPluginsToEngine(
      [
        plugin({ engineVersion: '5.7', path: 'D:/labelled', buildId: '55116800' }),
        plugin({ engineVersion: '', path: 'D:/proven', buildId: '47537391' }),
      ],
      '5.7',
      engine57,
    )
    expect(offered.map((p) => p.path)).toEqual(['D:/proven'])
  })

  it('falls back to the label rule EXACTLY when no BuildId is known', () => {
    // No engine passed (the install dialog's own engine wasn't detected) and no
    // ids on the builds: the older "exact version beats any-engine, ties keep
    // scan order" behaviour must be untouched.
    const noIds = [
      plugin({ engineVersion: '', path: 'D:/a/DazToUnreal' }),
      plugin({ engineVersion: '5.7', path: 'D:/b/DazToUnreal' }),
      plugin({ engineVersion: '5.7', path: 'D:/c/DazToUnreal' }),
    ]
    expect(matchPluginsToEngine(noIds, '5.7').map((p) => p.path)).toEqual(['D:/b/DazToUnreal'])
    expect(matchPluginsToEngine(noIds, '5.7', null).map((p) => p.path)).toEqual(['D:/b/DazToUnreal'])
    // An engine WITH an id changes nothing while the builds carry none.
    expect(
      matchPluginsToEngine(noIds, '5.7', { buildId: '47537391' }).map((p) => p.path),
    ).toEqual(['D:/b/DazToUnreal'])
  })

  it('still offers the ONE mismatching build when that is all there is', () => {
    // Ranking must not become filtering: a user with only a 5.7 build gets it
    // listed and marked, never an empty checklist that says nothing.
    const offered = matchPluginsToEngine(
      [plugin({ name: 'KawaiiPhysics', engineVersion: '', path: 'X:/p/K', buildId: '47537391' })],
      '5.8',
      { buildId: '55116800' },
    )
    expect(offered).toHaveLength(1)
    expect(pluginBuildMismatch(offered[0], { buildId: '55116800' })).toBe(true)
  })

  it('lists every distinct build for an unknown engine, deduped by path', () => {
    const all = allPluginBuilds([
      plugin({ engineVersion: '5.6', path: 'D:/x/UE_5.6/DazToUnreal' }),
      plugin({ engineVersion: '5.7', path: 'D:/x/UE_5.7/DazToUnreal' }),
      // The same build reached through two overlapping configured folders.
      plugin({ engineVersion: '5.7', path: 'D:\\x\\UE_5.7\\DazToUnreal' }),
    ])
    expect(all.map((p) => p.engineVersion)).toEqual(['5.6', '5.7'])
  })

  it('recognises a zipped build by its path', () => {
    expect(isZippedPlugin('X:/plugins/UE 5.7 Plugin/DazToHue.zip')).toBe(true)
    expect(isZippedPlugin('X:\\plugins\\DazToHue.ZIP')).toBe(true)
    expect(isZippedPlugin('X:/plugins/DazToUnreal')).toBe(false)
    // A FOLDER that merely has zip in its name is not an archive.
    expect(isZippedPlugin('X:/plugins/zipped/DazToUnreal')).toBe(false)
  })

  it('catches a build whose BINARIES are for another engine, whatever the label says', () => {
    // The real case, measured: a folder called "Unreal Engine 5.7 Plugin" whose
    // binaries were built for 5.8. Every label agreed; only the BuildId did not.
    const engine57 = { buildId: '47537391' }
    expect(pluginBuildMismatch({ buildId: '55116800' }, engine57)).toBe(true)
    expect(pluginBuildMismatch({ buildId: '47537391' }, engine57)).toBe(false)
    // Whitespace in a hand-edited .modules must not read as a different build.
    expect(pluginBuildMismatch({ buildId: ' 47537391 ' }, engine57)).toBe(false)
  })

  it('never claims a mismatch it cannot prove', () => {
    // A plugin with no binaries has nothing to mismatch; an engine whose id
    // could not be read is not evidence. A false alarm costs the user a plugin
    // that would have worked.
    expect(pluginBuildMismatch({ buildId: '' }, { buildId: '47537391' })).toBe(false)
    expect(pluginBuildMismatch({ buildId: '55116800' }, { buildId: '' })).toBe(false)
    expect(pluginBuildMismatch({ buildId: '55116800' }, null)).toBe(false)
    expect(pluginBuildMismatch({}, undefined)).toBe(false)
  })

  it('labels versions for the checklist', () => {
    expect(pluginVersionLabel('5.7')).toBe('UE 5.7')
    expect(pluginVersionLabel('')).toBe('any engine')
  })
})
