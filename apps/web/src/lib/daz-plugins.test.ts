import { describe, expect, it } from 'vitest'

import {
  compareDottedVersions,
  dazFlavorFromExeVersion,
  dazFlavorFromMajor,
  exporterDllFlavor,
  flavorFromPathHint,
  newestReleasePerFlavor,
} from './daz-plugins'

import type { PluginRelease } from './daz-plugins'

// Which plugin binary belongs in which Daz. The pairing key is the DLL's NAME,
// because Daz Studio 6 refuses to load a plugin without the `dsp_` prefix — so
// the name is not a hint about the packager's intent, it is what the loader
// enforces.

describe('exporterDllFlavor — the generation is in the file name', () => {
  it('reads the real published layout', () => {
    // Measured: ExporterPlugin/Daz Studio 4/dth_exporter.dll
    //           ExporterPlugin/Daz Studio 6/dsp_dth_exporter.dll
    expect(exporterDllFlavor('dth_exporter.dll')).toBe('ds4')
    expect(exporterDllFlavor('dsp_dth_exporter.dll')).toBe('ds6')
  })

  it('is case-insensitive, like the filesystem it reads', () => {
    expect(exporterDllFlavor('DSP_DTH_Exporter.DLL')).toBe('ds6')
    expect(exporterDllFlavor('DTH_EXPORTER.DLL')).toBe('ds4')
  })

  it('ignores everything that is not an exporter DLL', () => {
    // The companion that ships beside the DS4 build must not read as a release
    // of its own — it has no version to compare and would double every row.
    expect(exporterDllFlavor('dth_tools.dll')).toBeNull()
    expect(exporterDllFlavor('dsp_dthcharacterstudiorunner.dll')).toBeNull()
    expect(exporterDllFlavor('readme.txt')).toBeNull()
    expect(exporterDllFlavor('dth_exporter.dll.bak')).toBeNull()
  })
})

describe('flavorFromPathHint — the folder name, as a cross-check only', () => {
  it('reads the generation out of the LAST segment', () => {
    expect(flavorFromPathHint('X:/_DazToHue/ExporterPlugin/Daz Studio 4')).toBe('ds4')
    expect(flavorFromPathHint('X:/_DazToHue/ExporterPlugin/Daz Studio 6')).toBe('ds6')
    expect(flavorFromPathHint('D:/plugins/DS4/')).toBe('ds4')
    expect(flavorFromPathHint('D:/plugins/ds6')).toBe('ds6')
  })

  it('never lets a PARENT folder decide', () => {
    // A DS4 release filed under a "Daz Studio 6 stuff" tree is still DS4 — the
    // hint has to be about the folder the binaries are actually in.
    expect(flavorFromPathHint('D:/Daz Studio 6 stuff/exporter-release')).toBeNull()
  })

  it('says nothing when the folder says nothing', () => {
    expect(flavorFromPathHint('D:/plugins/latest')).toBeNull()
    expect(flavorFromPathHint('')).toBeNull()
  })
})

describe('dazFlavorFromExeVersion / dazFlavorFromMajor — the ABI split is at 5', () => {
  it('splits 4 from 5+', () => {
    expect(dazFlavorFromExeVersion('4.22.0.16')).toBe('ds4')
    expect(dazFlavorFromExeVersion('5.0.0.0')).toBe('ds6')
    expect(dazFlavorFromExeVersion('6.1.2.3')).toBe('ds6')
    expect(dazFlavorFromMajor(4)).toBe('ds4')
    expect(dazFlavorFromMajor(7)).toBe('ds6')
  })

  it('refuses to guess from an unreadable version', () => {
    expect(dazFlavorFromExeVersion('')).toBeNull()
    expect(dazFlavorFromExeVersion('not a version')).toBeNull()
    expect(dazFlavorFromMajor(0)).toBeNull()
  })
})

describe('newestReleasePerFlavor — one build per generation', () => {
  const release = (over: Partial<PluginRelease>): PluginRelease => ({
    folder: 'X:/p',
    fileName: 'dth_exporter.dll',
    flavor: 'ds4',
    version: '1.0.0.0',
    pathHint: null,
    ...over,
  })

  it('keeps the highest version of each, independently', () => {
    const picked = newestReleasePerFlavor([
      release({ version: '2.0.1.0' }),
      release({ version: '2.0.2.0' }),
      release({ flavor: 'ds6', fileName: 'dsp_dth_exporter.dll', version: '1.9.0.0' }),
    ])
    expect(picked.ds4?.version).toBe('2.0.2.0')
    expect(picked.ds6?.version).toBe('1.9.0.0')
  })

  it('compares numerically, not as text', () => {
    // "10" > "9" only if the parts are numbers.
    const picked = newestReleasePerFlavor([
      release({ version: '2.0.9.0' }),
      release({ version: '2.0.10.0' }),
    ])
    expect(picked.ds4?.version).toBe('2.0.10.0')
  })

  it('a versionless DLL loses to any versioned one, and wins alone', () => {
    expect(
      newestReleasePerFlavor([release({ version: '' }), release({ version: '1.0.0.0' })]).ds4?.version,
    ).toBe('1.0.0.0')
    expect(newestReleasePerFlavor([release({ version: '' })]).ds4).not.toBeNull()
  })

  it('a generation with nothing found stays null — never borrows the other one', () => {
    // The whole point of the split: a DS4-only release folder must not put a
    // DS4 binary into a Daz Studio 6 that cannot load it.
    const picked = newestReleasePerFlavor([release({})])
    expect(picked.ds6).toBeNull()
  })

  it('ties keep the first seen — the user’s folder order decides', () => {
    const first = release({ folder: 'X:/first' })
    const second = release({ folder: 'X:/second' })
    expect(newestReleasePerFlavor([first, second]).ds4?.folder).toBe('X:/first')
  })
})

describe('compareDottedVersions', () => {
  it('treats missing components as 0', () => {
    expect(compareDottedVersions('2.0', '2.0.0.0')).toBe(0)
    expect(compareDottedVersions('2.0.1', '2.0')).toBeGreaterThan(0)
    expect(compareDottedVersions('', '0.0.0.1')).toBeLessThan(0)
  })
})
