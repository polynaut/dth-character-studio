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

describe('LinkedAssetCard control cluster', () => {
  it('orders the cluster destructive-to-primary: bin, replace, utils, open', () => {
    // The order IS the safety feature: the bin (unlink) sits farthest from the
    // always-present open icon — the one button every card visit targets — so a
    // hurried open never grazes the destructive action. DOM order is visual
    // order here (one flex row, no reordering classes), so asserting the
    // accessible names in sequence pins both.
    renderCard({ onRemove: vi.fn(), onReplace: vi.fn(), onUtils: vi.fn() })
    const names = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))
    expect(names).toEqual(['Remove', 'Replace', 'Utils', 'Open in Houdini'])
  })
})

describe('LinkedAssetCard busy', () => {
  it('shows no busy indicator at rest', () => {
    const { container } = renderCard({ barClass: 'bg-houdini-orange' })
    expect(screen.queryByRole('status')).toBeNull()
    expect(container.querySelector('.busy-bar-sweep')).toBeNull()
  })

  it('the accent bar becomes the labelled indicator, carrying the sweep segment', () => {
    // No extra spinner: the brand bar the card already owns lights up. An
    // indicator with no accessible name is invisible to a screen reader — the
    // card would simply say nothing about a scan that takes tens of seconds.
    // Queried BY that name, so the assertion IS the accessible name — whether a
    // real screen reader announces a live region that arrives with its content
    // already in it is a separate question, and not one jsdom can answer.
    renderCard({
      busy: true,
      busyLabel: 'Reading this project in Houdini…',
      barClass: 'bg-houdini-orange',
    })
    const bar = screen.getByRole('status', { name: 'Reading this project in Houdini…' })
    expect(bar.querySelector('.busy-bar-sweep')).not.toBeNull()
  })

  it('falls back to the corner spinner on a card without an accent bar', () => {
    // `busy` must never be silently invisible — a barless card keeps the old
    // spinner over the media corner, with the same labelled status role.
    renderCard({ busy: true, busyLabel: 'Working…' })
    const status = screen.getByRole('status', { name: 'Working…' })
    expect(status.querySelector('.busy-bar-sweep')).toBeNull()
  })

  it('leaves the card fully usable while busy', () => {
    // The scan is something the studio starts on its own; taking the user's
    // controls away for it would be a worse bug than showing no indicator.
    renderCard({ busy: true, barClass: 'bg-houdini-orange', onRemove: vi.fn(), onUtils: vi.fn() })
    for (const name of ['Open in Houdini', 'Remove', 'Utils']) {
      const button = screen.getByRole('button', { name }) as HTMLButtonElement
      expect(button.disabled).toBe(false)
    }
  })

  it('does not swallow clicks aimed at the card underneath', () => {
    // The lit bar overlays the card's left edge, so it has to stay
    // click-transparent — busy is an indicator, never a blocker.
    renderCard({ busy: true, barClass: 'bg-houdini-orange' })
    expect(screen.getByRole('status').className).toContain('pointer-events-none')
  })
})
