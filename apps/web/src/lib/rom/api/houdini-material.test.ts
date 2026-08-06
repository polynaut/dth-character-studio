import { describe, expect, it } from 'vitest'

import { isSameNode, transferHoudiniMaterials } from './houdini-material.ts'

// The transfer itself needs hython and a real `.hip`, so what is unit-testable
// here is the guard that decides a transfer must not run at all — the one rule
// that protects a user's project from being opened and re-saved as its own
// target (append would double the node's bakers; replace would rewrite the file
// to produce what it already had).

describe('isSameNode', () => {
  const node = { hipPath: 'D:/chars/Ita/houdini/Ita.hiplc', nodePath: '/obj/DazToHue/DazToHueMaterial' }

  it('matches the same node regardless of separators or case', () => {
    // The target list comes from a Houdini scan, the source may come from a
    // file picker — the two spellings of one file must not read as two files.
    expect(
      isSameNode(node, {
        hipPath: 'd:\\chars\\Ita\\houdini\\ita.hiplc',
        nodePath: '/obj/DazToHue/DazToHueMaterial',
      }),
    ).toBe(true)
  })

  it('does not match a different node in the same project', () => {
    expect(isSameNode(node, { ...node, nodePath: '/obj/DazToHue/DazToHueMaterial1' })).toBe(false)
  })

  it('does not match the same node path in a different project', () => {
    expect(isSameNode(node, { ...node, hipPath: 'D:/chars/Kira/houdini/Kira.hiplc' })).toBe(false)
  })

  it('compares node paths case-SENSITIVELY (Houdini node names are)', () => {
    expect(isSameNode(node, { ...node, nodePath: '/obj/daztohue/daztohuematerial' })).toBe(false)
  })
})

describe('transferHoudiniMaterials', () => {
  const source = {
    hipPath: 'D:/chars/Kira/houdini/Kira.hiplc',
    nodePath: '/obj/DazToHue/DazToHueMaterial',
  }

  it('refuses a run whose target list contains the source node', async () => {
    await expect(
      transferHoudiniMaterials({
        data: {
          source,
          targets: [{ hipPath: 'd:\\chars\\Kira\\houdini\\kira.hiplc', nodePath: source.nodePath }],
          replace: false,
          dryRun: false,
        },
      }),
    ).rejects.toThrow(/source node is also a target/i)
  })

  it('rejects an empty target list at the schema boundary', async () => {
    await expect(
      transferHoudiniMaterials({
        data: { source, targets: [], replace: false, dryRun: true },
      }),
    ).rejects.toThrow()
  })
})
