import { describe, expect, it } from 'vitest'

import { genesisRank } from './dedup-report-list.tsx'

// Mirrors the Rust `genesis_rank` test (apps/desktop/src/dedup.rs) case for case —
// the UI's "◀ keeps" marker must agree with the install's actual winner, so any
// divergence between the two implementations is a bug on one side.
describe('genesisRank (mirrors Rust genesis_rank)', () => {
  it('reads the number after the genesis token', () => {
    expect(genesisRank('_genesis 9')).toBe(9)
    expect(genesisRank('_genesis 8')).toBe(8)
    expect(genesisRank('_genesis 3')).toBe(3)
    expect(genesisRank('my daz assets')).toBe(0) // no genesis token → unranked
    expect(genesisRank('_genesis 9')).toBeGreaterThan(genesisRank('_genesis 8'))
  })

  it('takes the FIRST digit run after "genesis" — trailing years/minors never hijack the rank', () => {
    // The old last-run impl returned 2024 here, inverting "newer genesis wins"
    // and marking the LOSING copy as the keeper.
    expect(genesisRank('_genesis 9 (2024)')).toBe(9)
    expect(genesisRank('Genesis 8.1')).toBe(8) // not 1
    expect(genesisRank('_genesis 9 (2020)')).toBeGreaterThan(genesisRank('_genesis 8 (2024)'))
    expect(genesisRank('Genesis')).toBe(0) // token, no number
  })
})
