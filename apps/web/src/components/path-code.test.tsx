// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(cleanup)

import { PathCode } from './path-code'

describe('PathCode edit affordance', () => {
  it('shows no pencil without onEdit', () => {
    render(<PathCode path="C:/proj/char/daz3d" />)
    expect(screen.queryByLabelText('Edit path')).toBeNull()
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
