// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BoneNameCell, indexBones } from './bone-name-cell.tsx'

afterEach(cleanup)

const BONES = indexBones([
  { name: 'lThighBend', label: 'Left Thigh Bend' },
  { name: 'rThighBend', label: 'Right Thigh Bend' },
  { name: 'lShin', label: 'Left Shin' },
])

function renderCell(value = '') {
  const onCommit = vi.fn()
  render(<BoneNameCell value={value} bones={BONES} onCommit={onCommit} placeholder="bone" />)
  return { onCommit, input: screen.getByRole('combobox') as HTMLInputElement }
}

describe('BoneNameCell', () => {
  it('suggests bones matching the UI label and picking inserts the label', () => {
    const { onCommit, input } = renderCell()
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'thigh' } })

    // Both thigh bones match the label; the shin does not. (The label text is
    // split by the match <mark>, so assert on the option's textContent.)
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(2)
    expect(options[0].textContent).toContain('Left Thigh Bend')

    // mousedown (not click) fires before the input blur — that's the real pick.
    fireEvent.mouseDown(options[0])
    expect(onCommit).toHaveBeenCalledWith('Left Thigh Bend')
  })

  it('matches on the internal name too', () => {
    const { input } = renderCell()
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'lshin' } })
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0].textContent).toContain('Left Shin')
  })

  it('ArrowDown + Enter picks the active suggestion', () => {
    const { onCommit, input } = renderCell()
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'thigh' } })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledWith('Left Thigh Bend')
  })

  it('still commits free-typed text on blur (unscanned/custom bone)', () => {
    const { onCommit, input } = renderCell()
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'MyCustomBone' } })
    fireEvent.blur(input)
    expect(onCommit).toHaveBeenCalledWith('MyCustomBone')
  })

  it('offers nothing when no bones are scanned', () => {
    const onCommit = vi.fn()
    render(<BoneNameCell value="" bones={[]} onCommit={onCommit} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'thigh' } })
    expect(screen.queryByRole('option')).toBeNull()
  })
})
