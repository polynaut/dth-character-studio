import { describe, expect, it } from 'vitest'

import { upsertHoudiniEnvVar } from './houdini-env'

// The one env-file edit rule: replace an existing assignment in place, else
// append a managed block — never touching anything else in the user's file.
describe('upsertHoudiniEnvVar', () => {
  it('appends the managed block to an empty file', () => {
    expect(upsertHoudiniEnvVar('', 'DAZ3D_LIB', 'X:/_3d/daz3d')).toBe(
      '# Managed by DTH Character Studio\nDAZ3D_LIB = "X:/_3d/daz3d"\n',
    )
  })

  it('appends below existing content, preserving it byte-for-byte', () => {
    const existing = 'HOUDINI_PATH = "&;D:/tools"\nSHARED_PRESETS = "D:/presets"\n'
    const next = upsertHoudiniEnvVar(existing, 'DAZ3D_LIB', 'X:/_3d/daz3d')
    expect(next).toBe(
      'HOUDINI_PATH = "&;D:/tools"\n' +
        'SHARED_PRESETS = "D:/presets"\n' +
        '\n' +
        '# Managed by DTH Character Studio\n' +
        'DAZ3D_LIB = "X:/_3d/daz3d"\n',
    )
  })

  it('replaces an existing assignment in place (whatever its spacing)', () => {
    const existing = 'A = "1"\n  DAZ3D_LIB="Y:/old"\nB = "2"\n'
    expect(upsertHoudiniEnvVar(existing, 'DAZ3D_LIB', 'X:/new')).toBe(
      'A = "1"\nDAZ3D_LIB = "X:/new"\nB = "2"\n',
    )
  })

  it('is idempotent — re-upserting the same value changes nothing', () => {
    const once = upsertHoudiniEnvVar('A = "1"\n', 'DAZ3D_LIB', 'X:/lib')
    expect(upsertHoudiniEnvVar(once, 'DAZ3D_LIB', 'X:/lib')).toBe(once)
  })

  it('never matches a LONGER variable name that merely starts with ours', () => {
    const existing = 'DAZ3D_LIB_EXTRA = "keep me"\n'
    const next = upsertHoudiniEnvVar(existing, 'DAZ3D_LIB', 'X:/lib')
    expect(next).toContain('DAZ3D_LIB_EXTRA = "keep me"')
    expect(next).toContain('DAZ3D_LIB = "X:/lib"')
  })

  it('keeps the file CRLF when it already is', () => {
    const existing = 'A = "1"\r\nDAZ3D_LIB = "old"\r\n'
    expect(upsertHoudiniEnvVar(existing, 'DAZ3D_LIB', 'X:/lib')).toBe(
      'A = "1"\r\nDAZ3D_LIB = "X:/lib"\r\n',
    )
  })
})
