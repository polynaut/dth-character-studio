// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

afterEach(cleanup)

import { RomSections } from './rom-sections'
import { defaultSections } from '@dth/rom'

import type { RomSections as RomSectionsModel } from '@dth/rom'

function sectionsWithMultiMorphPose(): RomSectionsModel {
  const sections = defaultSections()
  sections.FBM.enabled = true
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

describe('insert frame between rows (the “+” behind the frame number)', () => {
  it('inserts an empty pose before/after the row, inheriting the neighbor node', () => {
    let next: RomSectionsModel | null = null
    render(
      <RomSections
        sections={sectionsWithMultiMorphPose()}
        genesis="G9"
        gender="female"
        skinning="dqs"
        catalog={{ folder: '', assets: [], error: null }}
        presetFrames={{ base: 328, gp: 104, dk: 54, phys: 43 }}
        onChange={(s) => {
          next = s
        }}
      />,
    )
    fireEvent.click(screen.getByText('Full Body'))

    // "Add after" the (only) row → new empty pose at index 1.
    fireEvent.click(screen.getAllByLabelText('Insert a frame here')[0])
    fireEvent.click(screen.getByText('Add after'))
    let poses = next!.FBM.groups[0].poses
    expect(poses).toHaveLength(2)
    expect(poses[1].name).toBe('')
    // Node inherited from the neighboring pose, not a blank default.
    expect(poses[1].morphs[0].node).toBe('Genesis9')

    // "Add before" the same row → new empty pose at index 0 (the sections prop
    // is unchanged between clicks, so this inserts into the original list).
    fireEvent.click(screen.getAllByLabelText('Insert a frame here')[0])
    fireEvent.click(screen.getByText('Add before'))
    poses = next!.FBM.groups[0].poses
    expect(poses).toHaveLength(2)
    expect(poses[0].name).toBe('')
    expect(poses[1].name).toBe('SLGlutes SS')
  })

  it('focuses the new row’s name field once it renders (controlled flow)', () => {
    // A controlled harness — the insert flows through onChange back into the
    // sections prop, so the new row actually renders (like the real editor).
    function Controlled() {
      const [sections, setSections] = useState(sectionsWithMultiMorphPose())
      return (
        <RomSections
          sections={sections}
          genesis="G9"
          gender="female"
          skinning="dqs"
          catalog={{ folder: '', assets: [], error: null }}
          presetFrames={{ base: 328, gp: 104, dk: 54, phys: 43 }}
          onChange={setSections}
        />
      )
    }
    render(<Controlled />)
    fireEvent.click(screen.getByText('Full Body'))
    fireEvent.click(screen.getAllByLabelText('Insert a frame here')[0])
    fireEvent.click(screen.getByText('Add after'))

    const active = document.activeElement as HTMLInputElement
    expect(active.getAttribute('data-pose-input')).toBeTruthy()
    expect(active.value).toBe('') // the freshly inserted (empty) pose's name field
  })
})
