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

  it('typing filters the list and picking an option adds it', () => {
    const onChange = vi.fn()
    const { getByRole, getAllByRole } = render(
      <MultiSelect values={['Apple']} options={OPTIONS} onChange={onChange} />,
    )
    const input = getByRole('combobox')
    fireEvent.change(input, { target: { value: 'ban' } })
    const rows = getAllByRole('option')
    expect(rows.map((el) => el.textContent)).toEqual(['Banana'])
    fireEvent.mouseDown(rows[0])
    expect(onChange).toHaveBeenCalledWith(['Apple', 'Banana'])
  })

  it('the pill × and Backspace-on-empty both remove', () => {
    const onChange = vi.fn()
    const { getByLabelText, getByRole } = render(
      <MultiSelect values={['Apple', 'Banana']} options={OPTIONS} onChange={onChange} />,
    )
    fireEvent.click(getByLabelText('Remove Apple'))
    expect(onChange).toHaveBeenCalledWith(['Banana'])
    fireEvent.keyDown(getByRole('combobox'), { key: 'Backspace' })
    expect(onChange).toHaveBeenCalledWith(['Apple'])
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
