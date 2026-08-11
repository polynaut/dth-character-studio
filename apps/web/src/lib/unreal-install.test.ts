import { describe, expect, it } from 'vitest'

import {
  allPluginBuilds,
  buildUnrealScan,
  defaultUnrealEngine,
  engineVersionFromAssociation,
  matchPluginsToEngine,
  pluginMatchesEngine,
  pluginVersionLabel,
  unrealProjectNameError,
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
