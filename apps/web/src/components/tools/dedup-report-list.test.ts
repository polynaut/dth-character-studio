import { describe, expect, it } from 'vitest'

import { conflictWinner, genesisRank } from './dedup-report-list.tsx'

import type { ConflictCopy } from '#/lib/rom/api.ts'

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

  it('saturates a u32-overflowing digit run to 0 — twin of the Rust parse().unwrap_or(0)', () => {
    // Rust parses the run into a u32, so "_genesis 4294967296" fails the parse
    // and ranks 0 there. A bare Number() here returns the huge value and
    // inverts the "◀ keeps" marker against the install's actual winner.
    expect(genesisRank('_genesis 4294967296')).toBe(0) // u32::MAX + 1
    expect(genesisRank('_genesis 99999999999999999999')).toBe(0)
    expect(genesisRank('_genesis 4294967295')).toBe(0xffffffff) // u32::MAX still parses on both sides
  })
})

// Mirrors the Rust winner resolution (`winner_skip_map`, apps/desktop/src/assets.rs):
// the "◀ keeps" marker must agree with the copy the install actually writes.
describe('conflictWinner (mirrors Rust winner_skip_map)', () => {
  const copy = (label: string, source: string, size: number, path: string): ConflictCopy => ({
    label,
    source,
    size,
    inZip: false,
    path,
  })

  it('newer genesis wins, then bigger size', () => {
    const g8 = copy('Old', '_genesis 8', 9999, 'X:/g8/Old')
    const g9 = copy('New', '_genesis 9', 1, 'X:/g9/New')
    expect(conflictWinner([g8, g9])).toBe(g9)
    const small = copy('Small', '_genesis 9', 10, 'X:/g9/Small')
    const big = copy('Big', '_genesis 9', 20, 'X:/g9/Big')
    expect(conflictWinner([small, big])).toBe(big)
  })

  it('breaks a FULL (genesis, size) tie by the lexicographically first asset path', () => {
    // Twin of the Rust `winner_tie_breaks_deterministically_by_asset_path`
    // (assets.rs): equal rank, equal size, Alpha vs Bravo — the install keeps
    // Alpha's copy, so the marker must too, in EITHER scan order (it used to
    // keep whichever copy the report listed first).
    const alpha = copy('Alpha', 'src', 4, 'X:/src/Alpha')
    const bravo = copy('Bravo', 'src', 4, 'X:/src/Bravo')
    expect(conflictWinner([alpha, bravo])).toBe(alpha)
    expect(conflictWinner([bravo, alpha])).toBe(alpha)
  })
})
