import { describe, expect, it, vi } from 'vitest'

// releases.ts imports Tauri modules at the top level; the functions under test
// are pure, so empty-ish stubs are enough (nothing here touches the fs).
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
  readDir: async () => [],
  readFile: async () => new Uint8Array(),
  readTextFile: async () => '',
  remove: async () => undefined,
  rename: async () => undefined,
  stat: async () => ({ isFile: true, isDirectory: false }),
  writeTextFile: async () => undefined,
}))

import { fileVersionFromBytes, runnerGate, runnerInstalledNewer } from './releases'

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
