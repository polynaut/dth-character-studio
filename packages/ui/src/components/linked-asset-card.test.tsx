// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LinkedAssetCard } from './linked-asset-card.tsx'

afterEach(cleanup)

function renderCard(props: Partial<Parameters<typeof LinkedAssetCard>[0]> = {}) {
  return render(
    <LinkedAssetCard
      title="Kira"
      media={<img alt="" src="/placeholder.png" />}
      altHeld={false}
      openTitle="Open in Houdini"
      onOpen={vi.fn()}
      openIconOnly
      {...props}
    />,
  )
}

describe('LinkedAssetCard busy', () => {
  it('shows no spinner at rest', () => {
    renderCard()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('gives the spinner its label as an accessible name, not a bare icon', () => {
    // A spinner with no accessible name is invisible to a screen reader — the
    // card would simply say nothing about a scan that takes tens of seconds.
    // Queried BY that name, so the assertion IS the accessible name — whether a
    // real screen reader announces a live region that arrives with its content
    // already in it is a separate question, and not one jsdom can answer.
    renderCard({ busy: true, busyLabel: 'Reading this project in Houdini…' })
    expect(screen.getByRole('status', { name: 'Reading this project in Houdini…' })).toBeTruthy()
  })

  it('leaves the card fully usable while busy', () => {
    // The scan is something the studio starts on its own; taking the user's
    // controls away for it would be a worse bug than showing no spinner.
    renderCard({ busy: true, onRemove: vi.fn(), onUtils: vi.fn() })
    for (const name of ['Open in Houdini', 'Remove', 'Utils']) {
      const button = screen.getByRole('button', { name }) as HTMLButtonElement
      expect(button.disabled).toBe(false)
    }
  })

  it('does not swallow clicks aimed at the card underneath', () => {
    // The spinner overlays the media, so it has to be click-transparent.
    renderCard({ busy: true })
    expect(screen.getByRole('status').className).toContain('pointer-events-none')
  })
})
