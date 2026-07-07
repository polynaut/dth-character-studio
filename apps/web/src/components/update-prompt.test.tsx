// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(cleanup)

// The dialog itself only appears when a real update exists, so the markdown
// rendering + link behavior are verified on the exported ReleaseNotes directly.

const openExternal = vi.fn()
vi.mock('#/lib/desktop.ts', () => ({ openExternal: (url: string) => openExternal(url) }))

import { ReleaseNotes, UpdatePromptHost } from './update-prompt'
import {
  clearUpdatePrompt,
  requestUpdatePrompt,
  skippedVersionsBetween,
} from '#/lib/update-prompt.ts'

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

describe('skippedVersionsBetween', () => {
  const TAGS = ['v0.33.0', 'v0.32.3', 'v0.32.2', 'v0.32.1', 'v0.32.0', 'v0.31.3', 'v0.28.0']

  it('lists strictly-between versions, newest first, capped at 3, latest excluded', () => {
    const skipped = skippedVersionsBetween(TAGS, '0.28.0', '0.33.0')
    expect(skipped.map((s) => s.version)).toEqual(['0.32.3', '0.32.2', '0.32.1'])
    expect(skipped[0].url).toBe(
      'https://github.com/polynaut/dth-character-studio/releases/tag/v0.32.3',
    )
  })

  it('is empty for an adjacent update (nothing in between)', () => {
    expect(skippedVersionsBetween(TAGS, '0.32.3', '0.33.0')).toEqual([])
  })

  it('excludes the installed version itself', () => {
    const skipped = skippedVersionsBetween(TAGS, '0.32.1', '0.33.0')
    expect(skipped.map((s) => s.version)).toEqual(['0.32.3', '0.32.2'])
  })
})

describe('update dialog skipped-versions list', () => {
  it('renders the skipped releases as externally-opening links', () => {
    requestUpdatePrompt({
      version: '0.33.0',
      notes: '## What changed',
      skipped: [
        {
          version: '0.32.3',
          url: 'https://github.com/polynaut/dth-character-studio/releases/tag/v0.32.3',
        },
        {
          version: '0.32.2',
          url: 'https://github.com/polynaut/dth-character-studio/releases/tag/v0.32.2',
        },
      ],
      install: async () => {},
    })
    render(<UpdatePromptHost />)
    expect(screen.getByText('Also included since your version:')).toBeTruthy()
    const link = screen.getByRole('link', { name: 'v0.32.3 — release notes' })
    fireEvent.click(link)
    expect(openExternal).toHaveBeenCalledWith(
      'https://github.com/polynaut/dth-character-studio/releases/tag/v0.32.3',
    )
    clearUpdatePrompt()
  })
})
