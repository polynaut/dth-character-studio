// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

afterEach(cleanup)

import { RomSections } from './rom-sections'
import { defaultSections } from '@dth/rom'

import type { MorphIndexEntry } from '#/lib/rom/api.ts'
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

describe('Morph name autocomplete (scanned index)', () => {
  function sectionsWithSingleMorphPose(): RomSectionsModel {
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
            name: 'BodyTone',
            referenceFbx: '',
            morphs: [{ node: 'Genesis9', prop: '', value: 1 }],
          },
        ],
      },
    ]
    return sections
  }
  const morphIndex: Array<MorphIndexEntry> = [
    { node: 'Genesis9', nodeLabel: 'Genesis 9', label: 'Body Tone', name: 'body_bs_BodyTone' },
    { node: 'GoldenPalace_G9', nodeLabel: 'GoldenPalace_G9', label: 'Spread All', name: 'GP_Spread_All' },
  ]

  it('matches UI label or internal name, tags the hit, and picking sets prop AND node', () => {
    let next: RomSectionsModel | null = null
    render(
      <RomSections
        sections={sectionsWithSingleMorphPose()}
        genesis="G9"
        gender="female"
        skinning="dqs"
        catalog={{ folder: '', assets: [], error: null }}
        presetFrames={{ base: 328, gp: 104, dk: 54, phys: 43 }}
        morphIndex={morphIndex}
        onChange={(s) => {
          next = s
        }}
      />,
    )
    fireEvent.click(screen.getByText('Full Body'))
    const input = screen.getByPlaceholderText('body_bs_BodyTone')

    // A UI-label hit ("Body Tone" has a space, the internal name doesn't):
    // the suggestion shows the internal name plus a "UI name" match tag.
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'body tone' } })
    const suggestion = screen.getByText('body_bs_BodyTone').closest('button')!
    expect(suggestion.textContent).toContain('UI name')
    expect(suggestion.textContent).toContain('Genesis9')
    // …and the matched substring is visibly highlighted (in the label here —
    // the internal name has an underscore where the query has a space).
    expect(within(suggestion).getByText('Body Tone', { selector: 'mark' })).toBeTruthy()

    // An internal-name hit on a graft morph — picking it (mousedown, which fires
    // before the input's blur) sets the morph's prop AND its node.
    fireEvent.change(input, { target: { value: 'spread' } })
    // The mark splits the name across text nodes — match on full textContent.
    const graft = screen
      .getAllByRole('button')
      .find((b) => b.textContent?.includes('GP_Spread_All'))!
    expect(graft.textContent).toContain('internal')
    // "spread" hits the internal name AND the UI label — both get a highlight.
    expect(within(graft).getAllByText('Spread', { selector: 'mark' })).toHaveLength(2)
    fireEvent.mouseDown(graft)
    const morph = next!.FBM.groups[0].poses[0].morphs[0]
    expect(morph.prop).toBe('GP_Spread_All')
    expect(morph.node).toBe('GoldenPalace_G9')
  })

  it('stays quiet without an index and below two typed characters', () => {
    render(
      <RomSections
        sections={sectionsWithSingleMorphPose()}
        genesis="G9"
        gender="female"
        skinning="dqs"
        catalog={{ folder: '', assets: [], error: null }}
        presetFrames={{ base: 328, gp: 104, dk: 54, phys: 43 }}
        morphIndex={morphIndex}
        onChange={() => {}}
      />,
    )
    fireEvent.click(screen.getByText('Full Body'))
    const input = screen.getByPlaceholderText('body_bs_BodyTone')
    fireEvent.focus(input)
    // One character — no dropdown yet.
    fireEvent.change(input, { target: { value: 'b' } })
    expect(screen.queryByText('body_bs_BodyTone', { selector: 'span' })).toBeNull()
  })
})

describe('pose Name validation (Houdini-safe)', () => {
  it('flags invalid characters without rewriting the value', () => {
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
    const nameInput = document.querySelector<HTMLInputElement>('input[data-pose-input]')!

    // Invalid chars: flagged live, committed AS TYPED (never silently rewritten).
    fireEvent.change(nameInput, { target: { value: 'Glute Up-Down (v2)!' } })
    expect(nameInput.getAttribute('aria-invalid')).toBe('true')
    expect(nameInput.title).toContain('letters, numbers and underscores')
    fireEvent.blur(nameInput)
    expect(next!.FBM.groups[0].poses[0].name).toBe('Glute Up-Down (v2)!')

    // Underscores are fine — no flag.
    fireEvent.change(nameInput, { target: { value: 'Belly_Muscular2' } })
    expect(nameInput.getAttribute('aria-invalid')).toBeNull()
  })
})
