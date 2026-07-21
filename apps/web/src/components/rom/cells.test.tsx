// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NumberCell } from './cells.tsx'

afterEach(cleanup)

describe('NumberCell', () => {
  // `Number('')` is 0, not NaN — without the trim guard, blurring a cleared
  // cell silently committed 0 instead of reverting (the kit's NumberField got
  // the same fix).
  it('reverts a cleared cell on blur instead of committing 0', () => {
    const onCommit = vi.fn()
    render(<NumberCell value={0.5} onCommit={onCommit} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('50') // 0–1 stored, shown as a percentage

    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(onCommit).not.toHaveBeenCalled()
    expect(input.value).toBe('50')

    // Whitespace-only is the same non-entry (Number('  ') is also 0).
    fireEvent.change(input, { target: { value: '  ' } })
    fireEvent.blur(input)
    expect(onCommit).not.toHaveBeenCalled()
    expect(input.value).toBe('50')
  })

  it('still commits an explicitly typed 0', () => {
    const onCommit = vi.fn()
    render(<NumberCell value={0.5} onCommit={onCommit} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: '0' } })
    fireEvent.blur(input)
    expect(onCommit).toHaveBeenCalledWith(0)
  })
})
