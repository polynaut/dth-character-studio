import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { unrealEngineInstallSchema } from '#/lib/rom/api/native-types.ts'
import {
  allPluginBuilds,
  buildUnrealScan,
  defaultUnrealEngine,
  engineVersionFromAssociation,
  isZippedPlugin,
  matchPluginsToEngine,
  pluginBuildMismatch,
  pluginMatchesEngine,
  pluginVersionLabel,
  unrealProjectNameError,
  unrealProjectNameFrom,
  uprojectFileContent,
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

  it('preselects the newest install that is actually on disk', () => {
    const scan = buildUnrealScan(
      [
        { version: '5.7', path: 'D:/gone' },
        { version: '5.6', path: 'D:/UE_5.6' },
      ],
      new Set(['D:/UE_5.6']),
    )
    expect(defaultUnrealEngine(scan.installs)?.version).toBe('5.6')
    expect(defaultUnrealEngine([])).toBeNull()
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

describe('generate-project helpers', () => {
  it('validates project names by Unreal rules', () => {
    expect(unrealProjectNameError('MyGame')).toBeNull()
    expect(unrealProjectNameError('My_Game2')).toBeNull()
    expect(unrealProjectNameError('')).toMatch(/Enter/)
    expect(unrealProjectNameError('2Fast')).toMatch(/digit/)
    expect(unrealProjectNameError('My Game')).toMatch(/letters/)
    expect(unrealProjectNameError('Game-One')).toMatch(/letters/)
  })

  it('derives a LEGAL prefill from a DTH project name', () => {
    // The two namespaces disagree: a .dcsp may be called anything, Unreal may
    // not. "3d-workflow" is a real project here and breaks both rules, so a
    // raw prefill would open the dialog on its own validation error.
    expect(unrealProjectNameFrom('3d-workflow')).toBe('_3d_workflow')
    expect(unrealProjectNameFrom('PlaygroundAssets')).toBe('PlaygroundAssets')
    expect(unrealProjectNameFrom('My Game (2026)')).toBe('My_Game_2026')
    // A leading `_` is LEGAL Unreal, so it survives: renaming `_Sandbox` to
    // `Sandbox` would be the suggestion quietly disagreeing with the project.
    expect(unrealProjectNameFrom('_Sandbox')).toBe('_Sandbox')
    // The contract, stated exactly: anything it returns NON-empty is a name the
    // validator accepts. (Empty is the "no prefill" answer — its own test below;
    // the validator rejects '' by design, so it can't be folded in here.)
    for (const raw of ['3d-workflow', 'My Game (2026)', '  spaced  ', 'a.b.c', '_Sandbox', '99']) {
      const derived = unrealProjectNameFrom(raw)
      expect(derived).not.toBe('')
      expect(unrealProjectNameError(derived)).toBeNull()
    }
  })

  it('prefills nothing rather than something meaningless', () => {
    // No usable characters left — an empty field the user fills in beats a
    // suggestion like "_" that only looks like a name.
    expect(unrealProjectNameFrom('---')).toBe('')
    expect(unrealProjectNameFrom('   ')).toBe('')
  })

  it('writes a Blueprint-only .uproject bound to the engine version', () => {
    const raw = uprojectFileContent('5.7')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    expect(parsed).toEqual({
      FileVersion: 3,
      EngineAssociation: '5.7',
      Category: '',
      Description: '',
    })
    expect(raw.endsWith('\n')).toBe(true)
  })
})
