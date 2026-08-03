// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MorphIndexProvider } from './morph-index-provider.tsx'
import { MorphNameCell } from './morph-name-cell.tsx'

import type { MorphIndexEntry } from '#/lib/rom/api.ts'

afterEach(cleanup)

// The index the autocomplete reads: base entries the stock figure carries (no
// `scenes`) plus scene-scanned extras, each tagged with the scene(s) it was
// found in. THAT distinction is what the provider filters on.
const KIRA = 'd:/chars/kira/kira.duf'
const ITA = 'd:/chars/ita/ita.duf'

const INDEX: Array<MorphIndexEntry> = [
  // Base — the figure's own dial, always offered.
  { node: 'Genesis9', nodeLabel: 'Genesis 9', label: 'Expand All Base', name: 'ExpandAllBase' },
  // Two different jackets, each only in its own scene.
  {
    node: 'KiraJacket',
    nodeLabel: 'Kira Jacket',
    label: 'Expand All',
    name: 'ExpandAllKira',
    scenes: [KIRA],
  },
  {
    node: 'ItaCoat',
    nodeLabel: 'Ita Coat',
    label: 'Expand All',
    name: 'ExpandAllIta',
    scenes: [ITA],
  },
  // Shared prop worn in both scenes.
  {
    node: 'Boots',
    nodeLabel: 'Boots',
    label: 'Expand All Boots',
    name: 'ExpandAllBoots',
    scenes: [KIRA, ITA],
  },
]

/** Render the Morph-name cell under the provider for `scenePath` and type
 *  `query`, returning the suggested internal names in order. Unmounts any
 *  previous render first, so a test may compare two scenes back to back. */
function suggest(scenePath: string | undefined, query = 'expandall'): Array<string> {
  cleanup()
  render(
    <MorphIndexProvider morphIndex={INDEX} scenePath={scenePath}>
      <MorphNameCell value="" onCommit={vi.fn()} onPick={vi.fn()} />
    </MorphIndexProvider>,
  )
  const input = screen.getByRole('combobox')
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: query } })
  return screen
    .queryAllByRole('option')
    .map((o) => o.querySelector('.font-medium')?.textContent ?? '')
}

describe('MorphIndexProvider — scene-scoped suggestions', () => {
  it('offers a scene’s own clothing dial and hides the other scene’s', () => {
    // The whole point of the scene scan: two jackets, two scenes, one "Expand
    // All" each — only the one actually in this scene may be suggested.
    expect(suggest(KIRA)).toEqual(['ExpandAllBase', 'ExpandAllKira', 'ExpandAllBoots'])
    expect(suggest(ITA)).toEqual(['ExpandAllBase', 'ExpandAllIta', 'ExpandAllBoots'])
  })

  it('matches the scene case- and separator-insensitively', () => {
    // The editor hands over the linked path verbatim; the index stores the
    // normalized key. They must still meet.
    expect(suggest('D:\\Chars\\Kira\\Kira.duf')).toEqual([
      'ExpandAllBase',
      'ExpandAllKira',
      'ExpandAllBoots',
    ])
  })

  it('drops every scene entry when no scene is selected, keeping the base ones', () => {
    // An unfiltered mix is exactly the noise the scan exists to remove — a
    // sceneless definition sees the stock figure's dials and nothing else.
    expect(suggest('')).toEqual(['ExpandAllBase'])
    expect(suggest(undefined)).toEqual(['ExpandAllBase'])
  })

  it('drops scene entries for a scene that has never been scanned', () => {
    expect(suggest('d:/chars/unscanned/unscanned.duf')).toEqual(['ExpandAllBase'])
  })

  it('badges a scene-scoped suggestion, so a filtered-out one is not a mystery', () => {
    render(
      <MorphIndexProvider morphIndex={INDEX} scenePath={KIRA}>
        <MorphNameCell value="" onCommit={vi.fn()} onPick={vi.fn()} />
      </MorphIndexProvider>,
    )
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'expandall' } })
    const options = screen.getAllByRole('option')
    // Base entry: no badge. Scene entry: badged.
    expect(options[0].textContent).not.toContain('this scene')
    expect(options[1].textContent).toContain('this scene')
  })
})
