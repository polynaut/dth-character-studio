// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MultiSelect } from './multi-select.tsx'

afterEach(cleanup)

const OPTIONS = ['Apple', 'Apricot', 'Banana', 'Cherry']

describe('MultiSelect', () => {
  it('renders the selected values as pills and hides them from the list', () => {
    const { getByText, getByRole, queryAllByRole } = render(
      <MultiSelect values={['Apple']} options={OPTIONS} onChange={vi.fn()} />,
    )
    expect(getByText('Apple')).toBeTruthy()
    fireEvent.focus(getByRole('combobox'))
    const rows = queryAllByRole('option').map((el) => el.textContent)
    expect(rows).toEqual(['Apricot', 'Banana', 'Cherry'])
  })

  it('a single click into the unfocused field opens the list; the next toggles', () => {
    const { getByRole, queryByRole } = render(
      <MultiSelect values={[]} options={OPTIONS} onChange={vi.fn()} />,
    )
    const field = getByRole('combobox').parentElement as HTMLElement
    fireEvent.mouseDown(field) // focuses AND opens in one click
    expect(document.activeElement).toBe(getByRole('combobox'))
    expect(queryByRole('listbox')).toBeTruthy()
    fireEvent.mouseDown(field) // already focused: plain toggle
    expect(queryByRole('listbox')).toBeNull()
    fireEvent.mouseDown(field)
    expect(queryByRole('listbox')).toBeTruthy()
  })

  it('typing filters the list, bolds the match, and picking an option adds it', () => {
    const onChange = vi.fn()
    const { getByRole, getAllByRole } = render(
      <MultiSelect values={['Apple']} options={OPTIONS} onChange={onChange} />,
    )
    const input = getByRole('combobox')
    fireEvent.change(input, { target: { value: 'ban' } })
    const rows = getAllByRole('option')
    expect(rows.map((el) => el.textContent)).toEqual(['Banana'])
    expect(rows[0].querySelector('strong')?.textContent).toBe('Ban')
    fireEvent.mouseDown(rows[0])
    expect(onChange).toHaveBeenCalledWith(['Apple', 'Banana'])
  })

  it('wires the ARIA combobox pattern: listbox id + active descendant', () => {
    const { getByRole, getAllByRole } = render(
      <MultiSelect values={[]} options={OPTIONS} onChange={vi.fn()} />,
    )
    const input = getByRole('combobox')
    fireEvent.focus(input)
    expect(input.getAttribute('aria-controls')).toBe(getByRole('listbox').id)
    expect(input.getAttribute('aria-activedescendant')).toBe(getAllByRole('option')[0].id)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input.getAttribute('aria-activedescendant')).toBe(getAllByRole('option')[1].id)
  })

  it('arrow keys wrap around; Home/End jump; ArrowUp opens at the last row', () => {
    const { getByRole, getAllByRole } = render(
      <MultiSelect values={[]} options={OPTIONS} onChange={vi.fn()} />,
    )
    const input = getByRole('combobox')
    const active = () => input.getAttribute('aria-activedescendant')
    fireEvent.keyDown(input, { key: 'ArrowUp' }) // opens, highlights last
    const ids = getAllByRole('option').map((el) => el.id)
    expect(active()).toBe(ids[3])
    fireEvent.keyDown(input, { key: 'ArrowDown' }) // wraps to first
    expect(active()).toBe(ids[0])
    fireEvent.keyDown(input, { key: 'ArrowUp' }) // wraps back to last
    expect(active()).toBe(ids[3])
    fireEvent.keyDown(input, { key: 'Home' })
    expect(active()).toBe(ids[0])
    fireEvent.keyDown(input, { key: 'End' })
    expect(active()).toBe(ids[3])
  })

  it('the pill × removes; Backspace on empty input arms first, removes second', () => {
    const onChange = vi.fn()
    const { getByLabelText, getByRole } = render(
      <MultiSelect values={['Apple', 'Banana']} options={OPTIONS} onChange={onChange} />,
    )
    fireEvent.click(getByLabelText('Remove Apple'))
    expect(onChange).toHaveBeenCalledWith(['Banana'])
    const input = getByRole('combobox')
    fireEvent.keyDown(input, { key: 'Backspace' }) // arms only
    expect(onChange).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(input, { key: 'Backspace' })
    expect(onChange).toHaveBeenCalledWith(['Apple'])
  })

  it('ArrowLeft walks focus into the pills; Delete removes the focused one', () => {
    const onChange = vi.fn()
    const { getByRole, getByLabelText } = render(
      <MultiSelect values={['Apple', 'Banana']} options={OPTIONS} onChange={onChange} />,
    )
    fireEvent.keyDown(getByRole('combobox'), { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(getByLabelText('Remove Banana'))
    fireEvent.keyDown(getByLabelText('Remove Banana'), { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(getByLabelText('Remove Apple'))
    fireEvent.keyDown(getByLabelText('Remove Apple'), { key: 'Delete' })
    expect(onChange).toHaveBeenCalledWith(['Banana'])
  })

  it('Escape closes the list without reaching a surrounding dialog — even one dismissing from a document-level capture listener (Radix)', () => {
    const outer = vi.fn()
    // Radix overlays dismiss Escape from a document-level CAPTURE keydown
    // listener registered when the dialog mounts — i.e. BEFORE the option list
    // ever opens. Simulate exactly that: React stopPropagation alone can never
    // beat it, only the component's window-capture swallow can.
    const radixLikeCapture = vi.fn()
    document.addEventListener('keydown', radixLikeCapture, { capture: true })
    try {
      const { getByRole, queryByRole } = render(
        <div onKeyDown={outer}>
          <MultiSelect values={[]} options={OPTIONS} onChange={vi.fn()} />
        </div>,
      )
      const input = getByRole('combobox')
      // Real focus first — the swallow only claims an Escape while focus is
      // within the widget. The act-wrapped synthetic event then flushes the
      // open (a bare .focus() outside act may not).
      input.focus()
      fireEvent.focus(input)
      expect(queryByRole('listbox')).toBeTruthy()
      fireEvent.keyDown(input, { key: 'Escape' })
      expect(queryByRole('listbox')).toBeNull()
      expect(radixLikeCapture).not.toHaveBeenCalled()
      expect(outer).not.toHaveBeenCalled()
      fireEvent.keyDown(input, { key: 'Escape' }) // closed: propagates normally
      expect(radixLikeCapture).toHaveBeenCalledTimes(1)
      expect(outer).toHaveBeenCalled()
    } finally {
      document.removeEventListener('keydown', radixLikeCapture, { capture: true })
    }
  })

  it('leaves an Escape alone when focus is outside the widget — it belongs to another overlay (tooltip hide, hover-peeked popup)', () => {
    const docCapture = vi.fn()
    document.addEventListener('keydown', docCapture, { capture: true })
    try {
      const { getByRole, queryByRole } = render(
        <MultiSelect values={[]} options={OPTIONS} onChange={vi.fn()} />,
      )
      // A synthetic focus event opens the list WITHOUT moving real focus —
      // document.activeElement stays on <body>: exactly the open-but-not-
      // focus-within transient the guard covers.
      fireEvent.focus(getByRole('combobox'))
      expect(queryByRole('listbox')).toBeTruthy()
      expect(document.activeElement).toBe(document.body)
      fireEvent.keyDown(document.body, { key: 'Escape' })
      // Not ours to eat: document-level listeners still see it, and the
      // swallow neither closed the list nor consumed the event.
      expect(docCapture).toHaveBeenCalledTimes(1)
      expect(queryByRole('listbox')).toBeTruthy()
    } finally {
      document.removeEventListener('keydown', docCapture, { capture: true })
    }
  })

  it('ignores an IME-cancel Escape (isComposing) — the list stays open and the query survives', () => {
    const { getByRole, queryByRole } = render(
      <MultiSelect values={[]} options={OPTIONS} onChange={vi.fn()} />,
    )
    const input = getByRole('combobox') as HTMLInputElement
    input.focus()
    fireEvent.change(input, { target: { value: 'ban' } })
    expect(queryByRole('listbox')).toBeTruthy()
    // Firefox reports an Escape that cancels an IME composition with
    // isComposing: true — it dismisses the composition, not the list.
    fireEvent.keyDown(input, { key: 'Escape', isComposing: true })
    expect(queryByRole('listbox')).toBeTruthy()
    expect(input.value).toBe('ban')
  })

  it('allowCustom offers adding an unknown query via Enter', () => {
    const onChange = vi.fn()
    const { getByRole } = render(
      <MultiSelect values={[]} options={OPTIONS} onChange={onChange} allowCustom />,
    )
    const input = getByRole('combobox')
    fireEvent.change(input, { target: { value: 'Dragonfruit' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith(['Dragonfruit'])
  })

  it('allowCustom does not offer a case-variant of an already-selected value', () => {
    const onChange = vi.fn()
    const { getByRole, queryAllByRole } = render(
      <MultiSelect values={['Foo']} options={[]} onChange={onChange} allowCustom />,
    )
    const input = getByRole('combobox')
    fireEvent.change(input, { target: { value: 'foo' } })
    expect(queryAllByRole('option')).toHaveLength(0) // no "Add" row offered
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('without allowCustom an unknown query offers nothing', () => {
    const { getByRole, queryAllByRole, getByText } = render(
      <MultiSelect values={[]} options={OPTIONS} onChange={vi.fn()} />,
    )
    fireEvent.change(getByRole('combobox'), { target: { value: 'Dragonfruit' } })
    expect(queryAllByRole('option')).toHaveLength(0)
    expect(getByText('No matching items.')).toBeTruthy()
  })

  it('marks pills via pillWarning with the tooltip text', () => {
    const { getByText } = render(
      <MultiSelect
        values={['Ghost']}
        options={OPTIONS}
        onChange={vi.fn()}
        pillWarning={(v) => (v === 'Ghost' ? 'not found' : null)}
      />,
    )
    expect(getByText('Ghost').closest('[data-pill]')?.getAttribute('title')).toBe('not found')
  })
})
