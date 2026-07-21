// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Field } from './field.tsx'

afterEach(cleanup)

describe('Field', () => {
  it('wires the label and points aria-describedby at the error line', () => {
    const { getByRole, getByText } = render(
      <Field label="Name" error="Required">
        <input />
      </Field>,
    )
    const input = getByRole('textbox')
    expect(getByText('Name').getAttribute('for')).toBe(input.id)
    const describedBy = input.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy!)?.textContent).toBe('Required')
  })

  it('merges the error id into an existing aria-describedby instead of dropping it', () => {
    const { getByRole } = render(
      <>
        <p id="hint">Use the full name.</p>
        <Field label="Name" error="Required">
          <input aria-describedby="hint" />
        </Field>
      </>,
    )
    const ids = (getByRole('textbox').getAttribute('aria-describedby') ?? '').split(' ')
    expect(ids).toContain('hint')
    const errorId = ids.find((id) => id !== 'hint')
    expect(errorId).toBeTruthy()
    expect(document.getElementById(errorId!)?.textContent).toBe('Required')
  })

  it('leaves a child aria-describedby untouched when there is no error', () => {
    const { getByRole } = render(
      <Field label="Name">
        <input aria-describedby="hint" />
      </Field>,
    )
    expect(getByRole('textbox').getAttribute('aria-describedby')).toBe('hint')
  })
})
