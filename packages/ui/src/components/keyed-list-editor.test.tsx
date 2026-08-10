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

  // Rows used to be keyed by index: deleting a middle row handed its key — and
  // any transient DOM/focus state — to the row after it. Uncontrolled inputs
  // (defaultValue only applies at mount) make that visible: with index keys the
  // last row would still show the DELETED row's value after the parent applies
  // the removal.
  it('deleting a middle row keeps the following rows’ DOM state (stable keys)', () => {
    const items: Array<Row> = [{ name: 'a' }, { name: 'b' }, { name: 'c' }]
    const editor = (list: Array<Row>) => (
      <KeyedListEditor items={list} onChange={vi.fn()} newItem={() => ({ name: '' })} addLabel="Add row">
        {(item, _set, index) => <input aria-label={`Row ${index}`} defaultValue={item.name} />}
      </KeyedListEditor>
    )
    const view = render(editor(items))
    view.rerender(editor([items[0], items[2]]))
    const values = view.getAllByRole('textbox').map((el) => (el as HTMLInputElement).value)
    expect(values).toEqual(['a', 'c'])
  })

  it('an edit keeps its row mounted — set() hands the uid to the replacement object', () => {
    let items: Array<Row> = [{ name: 'a' }, { name: 'b' }]
    const editor = () => (
      <KeyedListEditor
        items={items}
        onChange={(next) => {
          items = next
        }}
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
      </KeyedListEditor>
    )
    const view = render(editor())
    const before = view.getByLabelText('Row 1')
    fireEvent.change(before, { target: { value: 'B!' } })
    view.rerender(editor())
    // A remount (key change) would produce a NEW element; same node = key held.
    expect(view.getByLabelText('Row 1')).toBe(before)
    expect((view.getByLabelText('Row 1') as HTMLInputElement).value).toBe('B!')
  })
})
