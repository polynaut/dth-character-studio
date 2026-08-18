import { describe, expect, it } from 'vitest'

import { frameZeroMorphsKey, labelsKey, preserveNodesKey } from './preserve-diff.ts'

describe('preserve-diff — multiset keys (not set membership)', () => {
  it('reordering a list yields the same key (never spuriously arms)', () => {
    expect(preserveNodesKey([{ nodeLabel: 'Head' }, { nodeLabel: 'Neck' }])).toBe(
      preserveNodesKey([{ nodeLabel: 'Neck' }, { nodeLabel: 'Head' }]),
    )
    expect(frameZeroMorphsKey([{ name: 'A', value: 1 }, { name: 'B', value: 0.5 }])).toBe(
      frameZeroMorphsKey([{ name: 'B', value: 0.5 }, { name: 'A', value: 1 }]),
    )
  })

  it('a duplicated key that drops a distinct one DIFFERS (a Set compare misses this)', () => {
    // [Head, Neck] → [Head, Head]: same length, both labels ∈ {Head, Neck}, so a
    // Set/length compare calls it equal. The multiset key must not.
    expect(preserveNodesKey([{ nodeLabel: 'Head' }, { nodeLabel: 'Head' }])).not.toBe(
      preserveNodesKey([{ nodeLabel: 'Head' }, { nodeLabel: 'Neck' }]),
    )
    expect(frameZeroMorphsKey([{ name: 'A', value: 1 }, { name: 'A', value: 1 }])).not.toBe(
      frameZeroMorphsKey([{ name: 'A', value: 1 }, { name: 'B', value: 1 }]),
    )
    expect(labelsKey(['Hair', 'Hair'])).not.toBe(labelsKey(['Hair', 'Cap']))
  })

  it('a value change on the same morph name DIFFERS', () => {
    expect(frameZeroMorphsKey([{ name: 'A', value: 1 }])).not.toBe(
      frameZeroMorphsKey([{ name: 'A', value: 0.5 }]),
    )
  })

  it('identical lists match', () => {
    expect(preserveNodesKey([{ nodeLabel: 'Head' }])).toBe(preserveNodesKey([{ nodeLabel: 'Head' }]))
    expect(labelsKey(['Hair', 'Cap'])).toBe(labelsKey(['Cap', 'Hair']))
  })
})
