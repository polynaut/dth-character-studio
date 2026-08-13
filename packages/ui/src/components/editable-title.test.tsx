// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EditableTitle } from './editable-title.tsx'
import { UiConfigProvider } from '../config.tsx'

afterEach(cleanup)

describe('EditableTitle', () => {
  it('click opens the inline input; Enter commits the trimmed value via onSave', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const { getByRole, getByLabelText, queryByLabelText } = render(
      <EditableTitle name="Aria" onSave={onSave} />,
    )
    fireEvent.click(getByRole('button', { name: 'Rename — Aria' }))
    const input = getByLabelText('Name') as HTMLInputElement
    expect(input.value).toBe('Aria') // starts from the current name
    fireEvent.change(input, { target: { value: '  Aria_G9  ' } })
    fireEvent.keyDown(input, { key: 'Enter' }) // Enter blurs → commit
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('Aria_G9'))
    // Back to the heading (the displayed name is prop-driven).
    await waitFor(() => expect(queryByLabelText('Name')).toBeNull())
    expect(getByRole('heading').textContent).toBe('Aria')
  })

  it('`subject` names WHAT is renamed, so two titles on one page differ', () => {
    // Measured on the character page: a generated Houdini project takes the
    // character's own name, so its card title and the page heading were BOTH
    // "Rename — Kira" — one accessible name for two different actions, with
    // only position to tell them apart. The subject is what separates them.
    const { getByRole } = render(
      <EditableTitle name="Kira" onSave={vi.fn()} subject="Houdini project" as="div" />,
    )
    expect(getByRole('button', { name: 'Rename Houdini project — Kira' })).toBeTruthy()
    // …and the plain form is untouched for a page's single subject.
    cleanup()
    const plain = render(<EditableTitle name="Kira" onSave={vi.fn()} />)
    expect(plain.getByRole('button', { name: 'Rename — Kira' })).toBeTruthy()
  })

  it('Escape reverts to the title without saving', () => {
    const onSave = vi.fn()
    const { getByRole, getByLabelText, queryByLabelText } = render(
      <EditableTitle name="Aria" onSave={onSave} />,
    )
    fireEvent.click(getByRole('button', { name: 'Rename — Aria' }))
    const input = getByLabelText('Name')
    fireEvent.change(input, { target: { value: 'Something else' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(queryByLabelText('Name')).toBeNull()
    expect(onSave).not.toHaveBeenCalled()
    expect(getByRole('heading').textContent).toBe('Aria')
  })

  it('an empty or unchanged value cancels instead of saving', async () => {
    const onSave = vi.fn()
    const { getByRole, getByLabelText, queryByLabelText } = render(
      <EditableTitle name="Aria" onSave={onSave} />,
    )
    fireEvent.click(getByRole('button', { name: 'Rename — Aria' }))
    const input = getByLabelText('Name')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.blur(input)
    await waitFor(() => expect(queryByLabelText('Name')).toBeNull())
    expect(onSave).not.toHaveBeenCalled()
  })

  it('a rejected save rolls back and routes the error through UiConfig.onError (the toast path)', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('disk full'))
    const onError = vi.fn()
    const { getByRole, getByLabelText, queryByLabelText } = render(
      <UiConfigProvider value={{ onError }}>
        <EditableTitle name="Aria" onSave={onSave} />
      </UiConfigProvider>,
    )
    fireEvent.click(getByRole('button', { name: 'Rename — Aria' }))
    fireEvent.change(getByLabelText('Name'), { target: { value: 'New name' } })
    fireEvent.blur(getByLabelText('Name'))
    await waitFor(() => expect(onError).toHaveBeenCalledWith('disk full'))
    // Rolled back and closed — the old name is shown again.
    expect(queryByLabelText('Name')).toBeNull()
    expect(getByRole('heading').textContent).toBe('Aria')
  })
})
