import { describe, expect, it } from 'vitest'

import {
  CHARACTER_SCHEMA_VERSION,
  characterSchema,
  compareDthVersions,
  poseAssetCsvEra,
} from './types'

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

describe('generatedDthVersion (v7, additive)', () => {
  it('defaults to empty when absent (pre-v7 JSONs) — needs no migration step', () => {
    expect(characterSchema.parse(base).generatedDthVersion).toBe('')
  })

  it('preserves the stored value', () => {
    expect(characterSchema.parse({ ...base, generatedDthVersion: '2.4.3' }).generatedDthVersion).toBe(
      '2.4.3',
    )
  })
})

describe('compareDthVersions', () => {
  it('orders by numeric segments, not lexically', () => {
    expect(compareDthVersions('2.4.10', '2.4.3')).toBeGreaterThan(0)
    expect(compareDthVersions('2.4.3', '2.5.0')).toBeLessThan(0)
    expect(compareDthVersions('2.4.3', '2.4.3')).toBe(0)
  })

  it('treats missing segments as 0 and empty as lowest', () => {
    expect(compareDthVersions('2.4', '2.4.0')).toBe(0)
    expect(compareDthVersions('', '2.4.3')).toBeLessThan(0)
  })
})

describe('poseAssetCsvEra', () => {
  it('maps releases at/after a breaking version to that era', () => {
    expect(poseAssetCsvEra('2.4.3')).toBe('2.4.3')
    expect(poseAssetCsvEra('2.4.4')).toBe('2.4.3') // not a breaking release → same era
    expect(poseAssetCsvEra('2.9.0')).toBe('2.4.3') // until a newer breaking version is added
  })

  it('is empty for a release before the first baseline or when none is given', () => {
    expect(poseAssetCsvEra('2.4.2')).toBe('')
    expect(poseAssetCsvEra('')).toBe('')
  })
})
