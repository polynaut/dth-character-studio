// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

afterEach(cleanup)

// The dialog itself only appears when a real update exists, so the markdown
// rendering + link behavior are verified on the exported ReleaseNotes directly.

const openExternal = vi.fn()
vi.mock('#/lib/desktop.ts', () => ({ openExternal: (url: string) => openExternal(url) }))

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    success: (...args: Array<unknown>) => toastSuccess(...args),
    error: (...args: Array<unknown>) => toastError(...args),
  },
}))

import { ReleaseNotes } from './release-notes'
import { UpdatePromptHost } from './update-prompt'
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
      relaunch: async () => {},
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

describe('update dialog hide-while-busy flow', () => {
  beforeEach(() => {
    toastSuccess.mockClear()
    toastError.mockClear()
  })
  afterEach(() => {
    // Unmount BEFORE clearing the store, so the clear can't re-render a
    // mounted host outside act().
    cleanup()
    clearUpdatePrompt()
  })

  it('hidden + success: persistent "restart to apply" toast, NO auto-relaunch', async () => {
    let resolveInstall!: () => void
    const relaunch = vi.fn(async () => {})
    requestUpdatePrompt({
      version: '0.99.0',
      install: () =>
        new Promise<void>((resolve) => {
          resolveInstall = resolve
        }),
      relaunch,
    })
    render(<UpdatePromptHost />)
    fireEvent.click(screen.getByRole('button', { name: 'Update now' }))
    // Busy: the dismiss button reads Hide, and hiding unmounts the dialog while
    // the download keeps running.
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }))
    expect(screen.queryByText('Update available')).toBeNull()

    resolveInstall()
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
    const [message, opts] = toastSuccess.mock.calls[0] as [
      string,
      { duration: number; action: { label: string; onClick: () => void } },
    ]
    expect(message).toBe('Update ready — restart to apply')
    // A hidden run must never yank the app away — the toast's action is the
    // only relaunch trigger.
    expect(relaunch).not.toHaveBeenCalled()
    opts.action.onClick()
    expect(relaunch).toHaveBeenCalledTimes(1)
  })

  it('hidden + failure: error toast instead of a dialog that no longer exists', async () => {
    let rejectInstall!: (e: Error) => void
    const relaunch = vi.fn(async () => {})
    requestUpdatePrompt({
      version: '0.99.0',
      install: () =>
        new Promise<void>((_resolve, reject) => {
          rejectInstall = reject
        }),
      relaunch,
    })
    render(<UpdatePromptHost />)
    fireEvent.click(screen.getByRole('button', { name: 'Update now' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }))

    rejectInstall(new Error('feed unreachable'))
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Update failed — feed unreachable'),
    )
    expect(relaunch).not.toHaveBeenCalled()
  })

  it('visible + success: relaunches immediately, no toast', async () => {
    const relaunch = vi.fn(async () => {})
    requestUpdatePrompt({ version: '0.99.0', install: async () => {}, relaunch })
    render(<UpdatePromptHost />)
    fireEvent.click(screen.getByRole('button', { name: 'Update now' }))
    await waitFor(() => expect(relaunch).toHaveBeenCalledTimes(1))
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('a second prompt while an install runs refuses to start another download', async () => {
    let resolveFirst!: () => void
    requestUpdatePrompt({
      version: '0.99.0',
      install: () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve
        }),
      relaunch: async () => {},
    })
    render(<UpdatePromptHost />)
    fireEvent.click(screen.getByRole('button', { name: 'Update now' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }))

    // A manual "Check for updates" mounts a fresh prompt for the same version —
    // its Update button must NOT start a second downloadAndInstall under the
    // one still running.
    const secondInstall = vi.fn(async () => {})
    act(() =>
      requestUpdatePrompt({ version: '0.99.0', install: secondInstall, relaunch: async () => {} }),
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Update now' }))
    expect(secondInstall).not.toHaveBeenCalled()
    expect(screen.getByText(/already downloading/)).toBeTruthy()

    // Let the first install finish so the module-level flag resets.
    resolveFirst()
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
  })
})
