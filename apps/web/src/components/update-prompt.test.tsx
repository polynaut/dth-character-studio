// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(cleanup)

// The dialog itself only appears when a real update exists, so the markdown
// rendering + link behavior are verified on the exported ReleaseNotes directly.

const openExternal = vi.fn()
vi.mock('#/lib/desktop.ts', () => ({ openExternal: (url: string) => openExternal(url) }))

import { ReleaseNotes } from './update-prompt'

const NOTES = `## What's changed

- **Webview hardening: strict CSP.** The webview previously ran with \`csp: null\`.
- Fixed by [@polynaut](https://github.com/polynaut) in [#144](https://github.com/polynaut/dth-character-studio/pull/144).
`

describe('ReleaseNotes', () => {
  it('renders changesets markdown as elements, not literal syntax', () => {
    render(<ReleaseNotes markdown={NOTES} />)
    // Heading became a real heading — no literal '##' anywhere.
    expect(screen.getByRole('heading', { name: "What's changed" })).toBeTruthy()
    expect(document.body.textContent).not.toContain('##')
    // Bold + inline code rendered as elements, ** and backticks gone.
    expect(document.querySelector('strong')?.textContent).toContain('Webview hardening')
    expect(document.querySelector('code')?.textContent).toBe('csp: null')
    expect(document.body.textContent).not.toContain('**')
    // List rendered as a real list.
    expect(document.querySelectorAll('ul li').length).toBe(2)
  })

  it('opens links externally instead of navigating the webview', () => {
    render(<ReleaseNotes markdown={NOTES} />)
    const link = screen.getByRole('link', { name: '#144' })
    fireEvent.click(link)
    expect(openExternal).toHaveBeenCalledWith(
      'https://github.com/polynaut/dth-character-studio/pull/144',
    )
  })
})
