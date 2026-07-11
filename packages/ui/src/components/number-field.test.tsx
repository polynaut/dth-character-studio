// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NumberField } from './number-field.tsx'

afterEach(cleanup)

describe('NumberField', () => {
  it('re-syncs its draft when the value prop changes underneath it', () => {
    // Reproduces the KeyedListEditor index-key case: the same instance is reused
    // with a new value after a mid-list row removal. Without the re-sync effect
    // the field would keep showing (and could commit) the old number.
    const { getByRole, rerender } = render(<NumberField value={1} onCommit={vi.fn()} />)
    const input = getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('1')
    rerender(<NumberField value={2} onCommit={vi.fn()} />)
    expect(input.value).toBe('2')
  })

  it('commits the parsed number on blur', () => {
    const onCommit = vi.fn()
    const { getByRole } = render(<NumberField value={0} onCommit={onCommit} />)
    const input = getByRole('textbox')
    fireEvent.change(input, { target: { value: '37.5' } })
    fireEvent.blur(input)
    expect(onCommit).toHaveBeenCalledWith(37.5)
  })

  it('reverts to the prop value on blur when the draft is not a number', () => {
    const onCommit = vi.fn()
    const { getByRole } = render(<NumberField value={5} onCommit={onCommit} />)
    const input = getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'abc' } })
    fireEvent.blur(input)
    expect(onCommit).not.toHaveBeenCalled()
    expect(input.value).toBe('5')
  })
})
