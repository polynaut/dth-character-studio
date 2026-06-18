import { describe, expect, it } from 'vitest'

import { CHARACTER_SCHEMA_VERSION, characterSchema } from './types'

const base = {
  id: 'abc',
  name: 'Electra',
  genesis: 'G9',
  gender: 'female',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('character schema version', () => {
  it('is a positive integer', () => {
    expect(Number.isInteger(CHARACTER_SCHEMA_VERSION)).toBe(true)
    expect(CHARACTER_SCHEMA_VERSION).toBeGreaterThanOrEqual(1)
  })

  it('defaults a missing schemaVersion to the baseline (1), not the live constant', () => {
    // Pre-versioning JSONs have no schemaVersion; they must read as 1 so a future
    // bump leaves them correctly *below* the current version (a migration target).
    const character = characterSchema.parse(base)
    expect(character.schemaVersion).toBe(1)
  })

  it('preserves an explicitly stored schemaVersion', () => {
    const character = characterSchema.parse({ ...base, schemaVersion: 3 })
    expect(character.schemaVersion).toBe(3)
  })
})

describe('project provenance fields', () => {
  it('default to empty when absent (pre-v2 JSONs)', () => {
    const character = characterSchema.parse(base)
    expect(character.projectName).toBe('')
    expect(character.projectPath).toBe('')
  })

  it('preserve stored project name + path', () => {
    const character = characterSchema.parse({
      ...base,
      projectName: 'Default',
      projectPath: 'X:/_3d/dth-characters',
    })
    expect(character.projectName).toBe('Default')
    expect(character.projectPath).toBe('X:/_3d/dth-characters')
  })
})
