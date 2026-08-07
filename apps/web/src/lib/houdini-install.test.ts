import { describe, expect, it } from 'vitest'

import {
  buildHoudiniScan,
  defaultHoudiniInstall,
  deriveHoudiniPaths,
} from './houdini-install.ts'

// The fixtures are this machine's real layout (measured 2026-08-07): two
// registered Houdini installs, a Documents folder REDIRECTED to another drive
// holding three `houdini<major>.<minor>` folders — one of them left behind by a
// version that is no longer installed — plus stray copies under %USERPROFILE%.

const INSTALLS = [
  // Registry order, which is NOT release order — the scan has to sort.
  { version: '20.5.0.864', path: 'C:/Program Files/Side Effects Software/Houdini 20.5.864' },
  { version: '22.0.0.368', path: 'C:/Program Files/Side Effects Software/Houdini 22.0.368' },
]

const DOCS = [
  'D:/User Data/Documents/houdini20.5',
  'D:/User Data/Documents/houdini21.0',
  'D:/User Data/Documents/houdini22.0',
]

const BOTH_EXIST = new Set(INSTALLS.map((i) => i.path))

describe('buildHoudiniScan', () => {
  it('pairs each install with its own major.minor prefs folder', () => {
    const scan = buildHoudiniScan(INSTALLS, DOCS, BOTH_EXIST)
    expect(scan.installs.map((i) => [i.release, i.docsFolder])).toEqual([
      ['22.0', 'D:/User Data/Documents/houdini22.0'],
      ['20.5', 'D:/User Data/Documents/houdini20.5'],
    ])
  })

  it('puts the newest release first, whatever order the registry gave', () => {
    expect(buildHoudiniScan(INSTALLS, DOCS, BOTH_EXIST).installs.map((i) => i.version)).toEqual([
      '22.0.0.368',
      '20.5.0.864',
    ])
  })

  it('orders releases numerically, not as strings', () => {
    // '9.5' sorts after '20.0' as a string. A machine keeping an old major
    // would otherwise recommend the OLDEST Houdini.
    const scan = buildHoudiniScan(
      [
        { version: '9.5.0.1', path: 'C:/sesi/Houdini 9.5.1' },
        { version: '20.0.0.1', path: 'C:/sesi/Houdini 20.0.1' },
      ],
      [],
      new Set(['C:/sesi/Houdini 9.5.1', 'C:/sesi/Houdini 20.0.1']),
    )
    expect(scan.installs.map((i) => i.release)).toEqual(['20.0', '9.5'])
  })

  it('orders two builds of one release by build number', () => {
    const scan = buildHoudiniScan(
      [
        { version: '22.0.0.368', path: 'C:/sesi/Houdini 22.0.368' },
        { version: '22.0.0.402', path: 'C:/sesi/Houdini 22.0.402' },
      ],
      [],
      new Set(),
    )
    expect(scan.installs.map((i) => i.version)).toEqual(['22.0.0.402', '22.0.0.368'])
  })

  it('names a card after its install folder, not the registry version', () => {
    // `22.0.0.368` in the registry, `Houdini 22.0.368` on disk and in the Start
    // menu. The folder's spelling is the one the user recognises.
    expect(buildHoudiniScan(INSTALLS, DOCS, BOTH_EXIST).installs[0]?.name).toBe('Houdini 22.0.368')
  })

  it('reports an install with no matching prefs folder rather than hiding it', () => {
    const scan = buildHoudiniScan(INSTALLS, ['D:/User Data/Documents/houdini22.0'], BOTH_EXIST)
    expect(scan.installs.find((i) => i.release === '20.5')?.docsFolder).toBe('')
  })

  it('keeps every prefs folder found, including one no install claims', () => {
    // houdini21.0 is a leftover — worth showing, never silently dropped.
    expect(buildHoudiniScan(INSTALLS, DOCS, BOTH_EXIST).docsFolders).toContain(
      'D:/User Data/Documents/houdini21.0',
    )
  })

  it('marks an install whose folder is gone', () => {
    const scan = buildHoudiniScan(INSTALLS, DOCS, new Set([INSTALLS[1].path]))
    expect(scan.installs.find((i) => i.release === '20.5')?.exists).toBe(false)
  })
})

describe('defaultHoudiniInstall', () => {
  it('recommends the newest install that has a prefs folder', () => {
    const scan = buildHoudiniScan(INSTALLS, DOCS, BOTH_EXIST)
    expect(defaultHoudiniInstall(scan.installs)?.release).toBe('22.0')
  })

  it('skips the newest when it has no prefs folder to pair with', () => {
    // hython run against a missing HOUDINI_USER_PREF_DIR loads no DazToHue
    // otls at all, so recommending it would recommend the broken one.
    const scan = buildHoudiniScan(INSTALLS, ['D:/User Data/Documents/houdini20.5'], BOTH_EXIST)
    expect(defaultHoudiniInstall(scan.installs)?.release).toBe('20.5')
  })

  it('still offers the newest present install when none has prefs', () => {
    const scan = buildHoudiniScan(INSTALLS, [], BOTH_EXIST)
    expect(defaultHoudiniInstall(scan.installs)?.release).toBe('22.0')
  })

  it('offers nothing when every install folder is gone', () => {
    expect(defaultHoudiniInstall(buildHoudiniScan(INSTALLS, DOCS, new Set()).installs)).toBeNull()
    expect(defaultHoudiniInstall([])).toBeNull()
  })
})

describe('deriveHoudiniPaths', () => {
  const scan = buildHoudiniScan(INSTALLS, DOCS, BOTH_EXIST)

  it('derives the install folder and its paired prefs folder', () => {
    expect(deriveHoudiniPaths(scan, '22.0.0.368')).toEqual({
      houdiniInstallFolder: 'C:/Program Files/Side Effects Software/Houdini 22.0.368',
      houdiniDocsFolder: 'D:/User Data/Documents/houdini22.0',
    })
  })

  it('follows the activated card, not the newest install', () => {
    expect(deriveHoudiniPaths(scan, '20.5.0.864')?.houdiniDocsFolder).toBe(
      'D:/User Data/Documents/houdini20.5',
    )
  })

  it('derives nothing for a version this machine no longer has', () => {
    expect(deriveHoudiniPaths(scan, '19.5.0.1')).toBeNull()
  })
})
