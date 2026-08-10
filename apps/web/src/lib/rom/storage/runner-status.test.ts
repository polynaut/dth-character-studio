import { beforeEach, describe, expect, it, vi } from 'vitest'

// releases.ts imports Tauri modules at the top level; most functions under test
// are pure, so empty-ish stubs are enough. detectDazFlavor is the exception —
// it lists an install folder and reads exe bytes, so those two mocks read from
// the mutable `fs` seam below (empty by default = the old inert stubs).
const fs = vi.hoisted(() => ({
  dir: [] as Array<{ name: string; isFile: boolean; isDirectory: boolean }>,
  files: new Map<string, Uint8Array>(),
}))
vi.mock('@tauri-apps/api/path', () => ({
  appLocalDataDir: async () => '/appdata',
  resolveResource: async (p: string) => p,
}))
vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '0.0.0' }))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async () => null,
  isTauri: () => false,
  convertFileSrc: (p: string) => p,
}))
vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: async () => false,
  mkdir: async () => undefined,
  readDir: async () => fs.dir,
  readFile: async (p: string) =>
    fs.files.get(p.replace(/\\/g, '/')) ?? new Uint8Array(),
  readTextFile: async () => '',
  remove: async () => undefined,
  rename: async () => undefined,
  stat: async () => ({ isFile: true, isDirectory: false }),
  writeTextFile: async () => undefined,
}))

import {
  dazFlavorFromExeVersion,
  detectDazFlavor,
  fileVersionFromBytes,
  runnerGate,
  runnerInstalledNewer,
} from './releases'

beforeEach(() => {
  fs.dir = []
  fs.files.clear()
})

import type { RunnerStatus } from './releases'

/** A DLL-ish byte blob carrying a VS_FIXEDFILEINFO with the given version. */
function dllBytes(major: number, minor: number, rev: number, build: number): Uint8Array {
  const bytes = new Uint8Array(64)
  // Signature 0xFEEF04BD little-endian at offset 16, versions at +8/+12.
  const view = new DataView(bytes.buffer)
  view.setUint32(16, 0xfeef04bd, true)
  view.setUint32(24, (major << 16) | minor, true)
  view.setUint32(28, (rev << 16) | build, true)
  return bytes
}

function status(partial: Partial<RunnerStatus>): RunnerStatus {
  return {
    bundledVersion: '1.0.5',
    flavor: 'ds6',
    installed: 'current',
    installedVersion: '',
    error: null,
    ...partial,
  }
}

describe('fileVersionFromBytes', () => {
  it('reads major.minor.rev.build from the VS_FIXEDFILEINFO signature', () => {
    expect(fileVersionFromBytes(dllBytes(1, 0, 3, 4))).toBe('1.0.3.4')
  })

  it('returns "" when no signature is present', () => {
    expect(fileVersionFromBytes(new Uint8Array(64))).toBe('')
  })
})

describe('dazFlavorFromExeVersion', () => {
  it('maps major 4 → ds4 and 5+ → ds6', () => {
    expect(dazFlavorFromExeVersion('4.24.0.3')).toBe('ds4')
    expect(dazFlavorFromExeVersion('5.1.2.3')).toBe('ds6')
    expect(dazFlavorFromExeVersion('6.0.1.42')).toBe('ds6')
    // The rule is >= 5, so an eventual DS7 silently rides the ds6 path —
    // correct only while it keeps DS6's dsp_*.dll naming/ABI. The closed-world
    // sites to revisit that day are listed in the /upgrade-daz skill.
    expect(dazFlavorFromExeVersion('7.0.0.1')).toBe('ds6')
  })

  it('returns null for an unreadable version — never guess from folder names', () => {
    // "DAZStudio4 64-bit" contains a 6; only the exe's version resource counts.
    expect(dazFlavorFromExeVersion('')).toBeNull()
    expect(dazFlavorFromExeVersion('garbage')).toBeNull()
    expect(dazFlavorFromExeVersion('0.1.0.0')).toBeNull()
  })
})

describe('detectDazFlavor', () => {
  it('reads the version from a DAZStudio*.exe, ignoring other files', async () => {
    fs.dir = [
      { name: 'uninstall.exe', isFile: true, isDirectory: false },
      { name: 'shaders', isFile: false, isDirectory: true },
      { name: 'DAZStudio.exe', isFile: true, isDirectory: false },
    ]
    fs.files.set('C:/Program Files/DAZ 3D/DAZStudio6/DAZStudio.exe', dllBytes(6, 0, 1, 2))
    expect(await detectDazFlavor('C:/Program Files/DAZ 3D/DAZStudio6')).toBe('ds6')
  })

  it('null when no DAZStudio exe carries a readable version', async () => {
    // The exe exists but its bytes hold no VS_FIXEDFILEINFO → '' → null,
    // never a folder-name guess.
    fs.dir = [{ name: 'DAZStudio.exe', isFile: true, isDirectory: false }]
    expect(await detectDazFlavor('C:/Program Files/DAZ 3D/DAZStudio6')).toBeNull()
  })
})

describe('runnerInstalledNewer', () => {
  it('is true only for a differing install with a HIGHER version', () => {
    expect(
      runnerInstalledNewer(status({ installed: 'differs', installedVersion: '1.0.6' })),
    ).toBe(true)
    expect(
      runnerInstalledNewer(status({ installed: 'differs', installedVersion: '1.0.4' })),
    ).toBe(false)
    // Same version, different bytes (a rebuild) → not newer.
    expect(
      runnerInstalledNewer(status({ installed: 'differs', installedVersion: '1.0.5' })),
    ).toBe(false)
    // Unknown installed version (pre-1.0.3 DLL) → can't be called newer.
    expect(runnerInstalledNewer(status({ installed: 'differs', installedVersion: '' }))).toBe(false)
    // Byte-identical is never "newer", whatever the versions say.
    expect(
      runnerInstalledNewer(status({ installed: 'current', installedVersion: '1.0.6' })),
    ).toBe(false)
  })
})

describe('runnerGate', () => {
  it('passes an up-to-date install', () => {
    expect(runnerGate(status({ installed: 'current', installedVersion: '1.0.5' }))).toEqual({
      blocked: false,
    })
  })

  it('blocks when no runner is installed', () => {
    expect(runnerGate(status({ installed: 'none' }))).toEqual({
      blocked: true,
      reason: 'not-installed',
      bundledVersion: '1.0.5',
      installedVersion: '',
    })
  })

  it('blocks an older install as a pending update', () => {
    expect(runnerGate(status({ installed: 'differs', installedVersion: '1.0.3' }))).toEqual({
      blocked: true,
      reason: 'update-pending',
      bundledVersion: '1.0.5',
      installedVersion: '1.0.3',
    })
  })

  it('blocks a version-less (pre-1.0.3) install as a pending update', () => {
    expect(runnerGate(status({ installed: 'differs', installedVersion: '' }))).toMatchObject({
      blocked: true,
      reason: 'update-pending',
    })
  })

  it('passes an install NEWER than the bundle (updating would downgrade)', () => {
    expect(runnerGate(status({ installed: 'differs', installedVersion: '1.0.6' }))).toEqual({
      blocked: false,
    })
  })

  it('never blocks on an unreadable state — Settings surfaces the error', () => {
    expect(
      runnerGate(status({ installed: 'none', error: 'no bundled Runner in this build' })),
    ).toEqual({ blocked: false })
  })
})
