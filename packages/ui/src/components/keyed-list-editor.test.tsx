// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { KeyedListEditor } from './keyed-list-editor.tsx'

afterEach(cleanup)

type Row = { name: string }

function renderEditor(items: Array<Row>) {
  const onChange = vi.fn()
  const utils = render(
    <KeyedListEditor
      items={items}
      onChange={onChange}
      newItem={() => ({ name: '' })}
      addLabel="Add row"
    >
      {(item, set, index) => (
        <input
          aria-label={`Row ${index}`}
          value={item.name}
          onChange={(e) => set({ ...item, name: e.target.value })}
        />
      )}
    </KeyedListEditor>,
  )
  return { onChange, ...utils }
}

describe('KeyedListEditor', () => {
  it('renders one row per item; add appends a fresh item from the factory', () => {
    const { onChange, getAllByRole, getByRole } = renderEditor([{ name: 'a' }, { name: 'b' }])
    expect(getAllByRole('textbox')).toHaveLength(2)
    fireEvent.click(getByRole('button', { name: 'Add row' }))
    expect(onChange).toHaveBeenCalledWith([{ name: 'a' }, { name: 'b' }, { name: '' }])
  })

  it('the per-row delete removes exactly that row', () => {
    const { onChange, getAllByRole } = renderEditor([{ name: 'a' }, { name: 'b' }, { name: 'c' }])
    fireEvent.click(getAllByRole('button', { name: 'Remove' })[1])
    expect(onChange).toHaveBeenCalledWith([{ name: 'a' }, { name: 'c' }])
  })

  it('set(next) replaces only its own row immutably, keeping sibling identities', () => {
    const items: Array<Row> = [{ name: 'a' }, { name: 'b' }]
    const { onChange, getByLabelText } = renderEditor(items)
    fireEvent.change(getByLabelText('Row 1'), { target: { value: 'B!' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0][0] as Array<Row>
    expect(next).toEqual([{ name: 'a' }, { name: 'B!' }])
    expect(next).not.toBe(items) // a new array…
    expect(next[0]).toBe(items[0]) // …with untouched rows kept by reference
  })
})
