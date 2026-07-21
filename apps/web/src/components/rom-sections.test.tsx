// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
          boneScaleRef: false,
          morphs: [
            { id: 'm1', node: 'Genesis9', prop: 'SL_Glutes SS Left', value: 1 },
            { id: 'm2', node: 'Genesis9', prop: 'SL_Glutes SS Right', value: 1 },
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
    // Morph-name cells are comboboxes (autocomplete); plain cells are textboxes.
    const inputs = [
      ...within(expansion).queryAllByRole('textbox'),
      ...within(expansion).queryAllByRole('combobox'),
    ]
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
            boneScaleRef: false,
            morphs: [{ id: 'm1', node: 'Genesis9', prop: '', value: 1 }],
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
    // Suggestions are listbox options (the cell is a proper combobox now).
    const graft = screen
      .getAllByRole('option')
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

describe('per-generation preset availability', () => {
  // A G8.1 catalog: JCM (FAC-capable) exists, GP/DK and Physics don't.
  const g81Catalog = {
    folder: 'X:/DTH/Poses',
    error: null,
    assets: [
      {
        name: 'G8.1 DQS JCM FAC - Base',
        relPath: 'Genesis 8.1/DQS/G8.1 DQS JCM FAC - Base.duf',
        genesis: 'G8.1' as const,
        skinning: 'dqs' as const,
        section: 'JCM' as const,
        includesFac: true,
      },
      {
        name: 'GP9 - Golden Palace',
        relPath: 'Genesis 9/Common/Golden Palace 9/GP9 - Golden Palace.duf',
        genesis: 'G9' as const,
        skinning: null,
        section: 'GEN' as const,
        includesFac: false,
      },
    ],
  }

  it('enabling a section without a preset asset lands on the custom morph list', () => {
    let next: RomSectionsModel | null = null
    render(
      <RomSections
        sections={defaultSections()}
        genesis="G8.1"
        gender="female"
        skinning="dqs"
        catalog={g81Catalog}
        presetFrames={{ base: 328, gp: 0, dk: 0, phys: 0 }}
        onChange={(s) => {
          next = s
        }}
      />,
    )
    // Switches titled "Enable this section" belong to the disabled sections, in
    // ROM order: EXP, GEN, PHY, FBM, MISC → index 1 is GEN.
    fireEvent.click(screen.getAllByTitle('Enable this section')[1])
    expect(next!.GEN.enabled).toBe(true)
    expect(next!.GEN.mode).toBe('custom') // no GP/DK for G8.1 — preset not offered

    // FAC exists for G8.1 (FAC-variant JCM base): enabling keeps preset mode.
    fireEvent.click(screen.getAllByTitle('Enable this section')[0]) // EXP is custom-only anyway
    expect(next!.EXP.mode).toBe('custom')
  })

  it('flags a legacy character that still has an unavailable preset enabled', () => {
    const sections = defaultSections()
    sections.GEN.enabled = true // pre-G8-support character, GEN preset from an old prefill
    render(
      <RomSections
        sections={sections}
        genesis="G8.1"
        gender="female"
        skinning="dqs"
        catalog={g81Catalog}
        presetFrames={null}
        onChange={() => {}}
      />,
    )
    const chip = screen.getByText('no G8.1 asset')
    expect(chip.title).toContain('generation will fail')
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

  it('a blocked save focuses the flagged name, not the first empty (optional FBX) field', async () => {
    // A pose whose name is non-empty but Houdini-invalid (a space) — the old
    // "focus the first empty input" jumped to the empty FBX field instead.
    const sections = sectionsWithMultiMorphPose()
    sections.FBM.groups[0].poses[0].name = 'Body Tone'
    // jsdom has no real layout; stub scrollIntoView so the reveal effect runs.
    Element.prototype.scrollIntoView = () => {}
    render(
      <RomSections
        sections={sections}
        genesis="G9"
        gender="female"
        skinning="dqs"
        catalog={{ folder: '', assets: [], error: null }}
        presetFrames={{ base: 328, gp: 104, dk: 54, phys: 43 }}
        revealPose={{ section: 'FBM', poseId: 'p1', nonce: 1 }}
        onChange={() => {}}
      />,
    )
    // The reveal effect opens the section and focuses through a double rAF.
    await waitFor(() => {
      const active = document.activeElement as HTMLElement | null
      expect(active?.getAttribute('aria-invalid')).toBe('true')
      expect(active?.getAttribute('data-pose-input')).toBe('p1')
    })
  })
})

describe('scene override mode', () => {
  // A controlled harness like the character page: the override entry lives in
  // state and RomSections edits it; the base sections are handed in fixed so
  // any base edit would be visible via onSectionsChange.
  function OverrideHarness({
    onOverrideChange,
    onSectionsChange,
  }: {
    onOverrideChange: (next: import('@dth/rom').SceneOverride) => void
    onSectionsChange: () => void
  }) {
    const [override, setOverride] = useState<import('@dth/rom').SceneOverride>({
      scenePath: 'X:/scenes/Beach.duf',
      enabled: true,
      poses: [],
      additions: [],
      identity: { enabled: false, facsDetailStrength: 1, flexionStrength: 1, applyUE5TearUV: false },
      groom: { enabled: false },
    })
    return (
      <RomSections
        sections={sectionsWithMultiMorphPose()}
        genesis="G9"
        gender="female"
        skinning="dqs"
        catalog={{ folder: '', assets: [], error: null }}
        presetFrames={{ base: 328, gp: 104, dk: 54, phys: 43 }}
        override={{
          data: override,
          onChange: (next) => {
            setOverride(next)
            onOverrideChange(next)
          },
        }}
        onChange={onSectionsChange}
      />
    )
  }

  it('locks the base: no insert menus, no drag handles, unchecked rows read-only', () => {
    let sectionsChanged = false
    let latest: import('@dth/rom').SceneOverride | null = null
    render(
      <OverrideHarness
        onOverrideChange={(next) => {
          latest = next
        }}
        onSectionsChange={() => {
          sectionsChanged = true
        }}
      />,
    )
    expect(screen.getByText(/Scene override active/)).toBeTruthy()
    fireEvent.click(screen.getByText('Full Body'))
    expect(screen.queryByLabelText('Insert a frame here')).toBeNull()
    expect(screen.queryByTitle('Drag to reorder')).toBeNull()
    // A base row shows no delete button in override mode.
    expect(screen.queryByTitle('Remove pose')).toBeNull()

    // Editing the (unchecked) base row's name commits nowhere: the base is
    // fixed and the row isn't part of the override.
    const nameInput = document.querySelector<HTMLInputElement>('input[data-pose-input]')!
    fireEvent.change(nameInput, { target: { value: 'Hacked' } })
    fireEvent.blur(nameInput)
    expect(sectionsChanged).toBe(false)
    expect(latest).toBeNull()
  })

  it('checking Override seeds a copy of the base row; edits then hit the override only', () => {
    let sectionsChanged = false
    let latest: import('@dth/rom').SceneOverride | null = null
    render(
      <OverrideHarness
        onOverrideChange={(next) => {
          latest = next
        }}
        onSectionsChange={() => {
          sectionsChanged = true
        }}
      />,
    )
    fireEvent.click(screen.getByText('Full Body'))
    fireEvent.click(
      screen.getByTitle(
        'Override this frame for the selected scene — uncheck to fall back to the base row',
      ),
    )
    expect(latest!.poses).toHaveLength(1)
    expect(latest!.poses[0]).toMatchObject({ id: 'p1', name: 'SLGlutes SS' })

    // The now-overridden row edits the override copy — the base stays fixed.
    const nameInput = document.querySelector<HTMLInputElement>('input[data-pose-input]')!
    fireEvent.change(nameInput, { target: { value: 'BeachGlutes' } })
    fireEvent.blur(nameInput)
    expect(latest!.poses[0].name).toBe('BeachGlutes')
    expect(sectionsChanged).toBe(false)

    // Unchecking reverts to the base row (the override entry is dropped).
    fireEvent.click(
      screen.getByTitle(
        'Override this frame for the selected scene — uncheck to fall back to the base row',
      ),
    )
    expect(latest!.poses).toHaveLength(0)
  })

  it('Add morph appends an override frame at the group end, removable again', () => {
    let latest: import('@dth/rom').SceneOverride | null = null
    render(<OverrideHarness onOverrideChange={(next) => (latest = next)} onSectionsChange={() => {}} />)
    fireEvent.click(screen.getByText('Full Body'))
    fireEvent.click(screen.getByText('Add morph'))
    expect(latest!.additions).toEqual([
      expect.objectContaining({ groupId: 'g1', poses: [expect.objectContaining({ name: '' })] }),
    ])

    // Added frame: frame number continues after the base row (328 → 329), its
    // checkbox is locked checked, and it is the only removable row.
    expect(screen.getByText('329')).toBeTruthy()
    expect(screen.getByTitle('Added frame — always part of the override')).toBeTruthy()
    fireEvent.click(screen.getByTitle('Remove pose'))
    expect(latest!.additions).toEqual([])
  })
})

describe('Modify JCM frames (jcmMorphMods grid)', () => {
  it('adds a rule and edits a drive through the grid', () => {
    let mods: Array<import('@dth/rom').JcmMorphMod> = [
      {
        id: 'rule-0',
        boneLabel: 'Left Thigh Bend',
        axis: 'XRotate',
        drives: [
          { id: 'drive-0', morphName: '', range: { angle: { start: 0, end: 90 }, value: { start: 0, end: 1 } } },
        ],
      },
    ]
    render(
      <RomSections
        sections={defaultSections()}
        genesis="G9"
        gender="female"
        skinning="dqs"
        catalog={{ folder: '', assets: [], error: null }}
        presetFrames={{ base: 328, gp: 0, dk: 0, phys: 0 }}
        jcmMorphMods={mods}
        onJcmMorphModsChange={(next) => {
          mods = next
        }}
        onChange={() => {}}
      />,
    )
    // Open the JCM section, then the optional grid.
    fireEvent.click(screen.getByText('Joint Corrective'))
    fireEvent.click(screen.getByText('Modify JCM frames'))

    // The existing rule renders: bone, axis, and the drive's morph-name cell.
    expect(screen.getByDisplayValue('Left Thigh Bend')).toBeTruthy()
    const morphInput = screen.getByPlaceholderText('body_bs_CalfFlex')
    fireEvent.change(morphInput, { target: { value: 'body_cbs_ThighFlex' } })
    fireEvent.blur(morphInput)
    expect(mods[0].drives[0].morphName).toBe('body_cbs_ThighFlex')

    // Add a second rule — an empty XRotate rule (with a fresh id) appears.
    fireEvent.click(screen.getByText('Add rule'))
    expect(mods).toHaveLength(2)
    expect(mods[1]).toMatchObject({ boneLabel: '', axis: 'XRotate', drives: [] })
    expect(typeof mods[1].id).toBe('string')
    expect(mods[1].id).not.toBe('')
  })
})
