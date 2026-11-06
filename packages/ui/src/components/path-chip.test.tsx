// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { UiConfigProvider } from '../config.tsx'
import { PathChip } from './path-chip.tsx'

afterEach(cleanup)

const dimmedText = () => document.querySelector('.text-muted-foreground\\/60')?.textContent ?? ''

function renderWithReveal(ui: ReactElement) {
  const onRevealPath = vi.fn()
  render(<UiConfigProvider value={{ onRevealPath }}>{ui}</UiConfigProvider>)
  return onRevealPath
}

describe('PathChip edit affordance', () => {
  it('shows no pencil without onEdit', () => {
    render(<PathChip path="C:/proj/char/daz3d" />)
    expect(screen.queryByLabelText('Edit path')).toBeNull()
  })

  it('Alt+click reveals in Explorer instead of copying (no tooltip on the chip)', () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    const onRevealPath = renderWithReveal(<PathChip path="C:/proj/char/daz3d" />)
    const chip = screen.getByLabelText('Copy path')
    expect(chip.getAttribute('title')).toBeNull()
    fireEvent.click(chip, { altKey: true })
    expect(onRevealPath).toHaveBeenCalledWith('C:/proj/char/daz3d')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('renders the pencil in front and clicking it edits WITHOUT copying', () => {
    const onEdit = vi.fn()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<PathChip path="C:/proj/char/daz3d" onEdit={onEdit} />)

    const pencil = screen.getByLabelText('Edit path')
    const code = pencil.parentElement!.querySelector('code')!
    expect(pencil.compareDocumentPosition(code) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.click(pencil)
    expect(onEdit).toHaveBeenCalledOnce()
    expect(writeText).not.toHaveBeenCalled()
  })
})

describe('PathChip alt-hover preview', () => {
  it('swaps the copy overlay to an open-folder icon while Alt is held', () => {
    const { container } = render(<PathChip path="C:/proj/char" />)
    expect(container.querySelector('.lucide-copy')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Alt' })
    expect(container.querySelector('.lucide-folder-open')).toBeTruthy()
    expect(container.querySelector('.lucide-copy')).toBeNull()
    fireEvent.keyUp(window, { key: 'Alt' })
    expect(container.querySelector('.lucide-copy')).toBeTruthy()
  })
})

describe('PathChip root dimming', () => {
  it('shows display while copying path', () => {
    render(<PathChip path="D:/full" display="rel/Kira" />)
    expect(screen.getByLabelText('Copy path').textContent).toBe('rel/Kira')
  })

  it('dims the root case-insensitively', () => {
    render(<PathChip path="d:/x" display="D:/Proj/Kira" roots={['d:/proj']} />)
    expect(dimmedText()).toBe('D:/Proj')
  })

  it('shows everything bright when no root matches', () => {
    render(<PathChip path="x" display="E:/Other" roots={['d:/proj']} />)
    expect(dimmedText()).toBe('')
  })

  it('uses the first matching root, so most-specific-first order holds', () => {
    render(<PathChip path="x" display="D:/Proj/Kira/daz" roots={['D:/Proj/Kira', 'D:/Proj']} />)
    expect(dimmedText()).toBe('D:/Proj/Kira')
  })

  it('children win over display and roots', () => {
    render(
      <PathChip path="x" display="D:/Proj/Kira" roots={['D:/Proj']}>
        custom
      </PathChip>,
    )
    expect(screen.getByLabelText('Copy path').textContent).toBe('custom')
  })
})
