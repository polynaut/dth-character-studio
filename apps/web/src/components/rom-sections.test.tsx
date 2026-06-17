// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { RomSections } from './rom-sections'
import { defaultSections } from '@dth/rom'

import type { RomSections as RomSectionsModel } from '@dth/rom'

function sectionsWithMultiMorphPose(): RomSectionsModel {
  const sections = defaultSections()
  sections.FBM.groups = [
    {
      id: 'g1',
      label: '',
      suffix: 'centre',
      method: 'individual',
    calculateFrom: 'default',
      poses: [
        {
          id: 'p1',
          name: 'SLGlutes SS',
          referenceFbx: '',
          morphs: [
            { node: 'Genesis9', prop: 'SL_Glutes SS Left', value: 1 },
            { node: 'Genesis9', prop: 'SL_Glutes SS Right', value: 1 },
          ],
        },
      ],
    },
  ]
  return sections
}

describe('RomSections multi-morph editor', () => {
  it('shows the morph property names in the expansion', () => {
    render(
      <RomSections
        sections={sectionsWithMultiMorphPose()}
        genesis="G9"
        gender="female"
        skinning="dqs"
        catalog={{ folder: '', assets: [], error: null }}
        presetFrames={{ base: 328, gp: 104, dk: 54, phys: 43 }}
        onChange={() => {}}
      />,
    )
    // Open the FBM section accordion.
    fireEvent.click(screen.getByText('Full Body'))
    // Expand the pose's morph list — the column header marks the editor.
    fireEvent.click(screen.getByTitle('Combine multiple Daz morphs into this single generated morph'))
    const expansion = screen
      .getByTitle('The internal property name of the Daz morph')
      .closest('td') as HTMLElement
    const inputs = within(expansion).getAllByRole('textbox')
    const values = inputs.map((input) => (input as HTMLInputElement).value)
    expect(values).toContain('SL_Glutes SS Left')
    expect(values).toContain('SL_Glutes SS Right')
  })
})
