// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('#/lib/rom/api.ts', () => ({ revealPath: vi.fn().mockResolvedValue(undefined) }))

afterEach(cleanup)

import { PathCode } from './path-code'
import { revealPath } from '#/lib/rom/api.ts'

describe('PathCode edit affordance', () => {
  it('shows no pencil without onEdit', () => {
    render(<PathCode path="C:/proj/char/daz3d" />)
    expect(screen.queryByLabelText('Edit path')).toBeNull()
  })

  it('Shift+click reveals in Explorer instead of copying (no tooltip on the chip)', () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<PathCode path="C:/proj/char/daz3d" />)
    const chip = screen.getByLabelText('Copy path')
    expect(chip.getAttribute('title')).toBeNull() // behavior lives in the guide docs
    fireEvent.click(chip, { shiftKey: true })
    expect(revealPath).toHaveBeenCalledWith({ data: { path: 'C:/proj/char/daz3d' } })
    expect(writeText).not.toHaveBeenCalled()
  })

  it('renders the pencil in front and clicking it edits WITHOUT copying', () => {
    const onEdit = vi.fn()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<PathCode path="C:/proj/char/daz3d" onEdit={onEdit} />)

    const pencil = screen.getByLabelText('Edit path')
    // In front of the chip: the button precedes the <code> in DOM order.
    const code = pencil.parentElement!.querySelector('code')!
    expect(pencil.compareDocumentPosition(code) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.click(pencil)
    expect(onEdit).toHaveBeenCalledOnce()
    expect(writeText).not.toHaveBeenCalled() // stopPropagation kept the copy away
  })
})

describe('PathCode shift-hover preview', () => {
  it('swaps the copy overlay to an open-folder icon while Shift is held', () => {
    const { container } = render(<PathCode path="C:/proj/char" />)
    expect(container.querySelector('.lucide-copy')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Shift' })
    expect(container.querySelector('.lucide-folder-open')).toBeTruthy()
    expect(container.querySelector('.lucide-copy')).toBeNull()
    fireEvent.keyUp(window, { key: 'Shift' })
    expect(container.querySelector('.lucide-copy')).toBeTruthy()
  })
})
