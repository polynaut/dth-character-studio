// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const setUnrealProjects = vi.fn(async (_: { data: { projectId: string; paths: Array<string> } }) => {})
const unrealDthContentPresent = vi.fn(async (_: { data: { uprojectPath: string } }) => true)
const installUnrealDthContent = vi.fn(
  async (_: { data: { uprojectPath: string; overwrite: boolean } }) => 0,
)
vi.mock('#/lib/rom/api.ts', () => ({
  setUnrealProjects: (args: { data: { projectId: string; paths: Array<string> } }) =>
    setUnrealProjects(args),
  unrealDthContentPresent: (args: { data: { uprojectPath: string } }) =>
    unrealDthContentPresent(args),
  installUnrealDthContent: (args: { data: { uprojectPath: string; overwrite: boolean } }) =>
    installUnrealDthContent(args),
  openScene: async () => {},
  revealPath: async () => {},
}))
vi.mock('#/lib/desktop.ts', () => ({ pickUprojectPath: async () => '' }))
// The drop-zone hook registers Tauri webview listeners — inert in jsdom.
vi.mock('#/lib/file-drop.ts', () => ({ useFileDrop: () => ({ id: 1, isOver: false }) }))
const invalidate = vi.fn()
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate }) }))

import { UnrealProjectsBar } from './unreal-projects-field'

import type { ProjectInfo } from '#/lib/rom/api.ts'

const A = 'C:/UE/A.uproject'
const B = 'C:/UE/B.uproject'

function projectWith(paths: Array<string>): ProjectInfo {
  return { path: 'C:/proj', name: 'Proj', unrealProjects: paths } as unknown as ProjectInfo
}

describe('UnrealProjectsBar mutations', () => {
  it('computes a second unlink from the just-written list, not the stale loader prop', async () => {
    // router.invalidate never refreshes the prop here — exactly the window in
    // which the bug lived: unlink A, then unlink B before the loader lands.
    render(<UnrealProjectsBar project={projectWith([A, B])} />)

    // The ✕ pauses on the confirm dialog now — the write fires on its Unlink.
    fireEvent.click(screen.getByLabelText('Unlink A'))
    fireEvent.click(screen.getByRole('button', { name: 'Unlink' }))
    await waitFor(() => expect(setUnrealProjects).toHaveBeenCalledTimes(1))
    expect(setUnrealProjects.mock.calls[0][0].data.paths).toEqual([B])
    // The dialog closes once the write lands.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Unlink' })).toBeNull())

    // The prop still lists [A, B] (no invalidate/rerender happened) — the next
    // write must build on the freshest list [B], not resurrect A.
    fireEvent.click(screen.getByLabelText('Unlink B'))
    fireEvent.click(screen.getByRole('button', { name: 'Unlink' }))
    await waitFor(() => expect(setUnrealProjects).toHaveBeenCalledTimes(2))
    expect(setUnrealProjects.mock.calls[1][0].data.paths).toEqual([])
  })

  it('is single-flight: while a write is in flight the card unlink/install buttons disable', async () => {
    let finish!: () => void
    setUnrealProjects.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finish = resolve)),
    )
    render(<UnrealProjectsBar project={projectWith([A, B])} />)

    fireEvent.click(screen.getByLabelText('Unlink A'))
    fireEvent.click(screen.getByRole('button', { name: 'Unlink' }))
    await waitFor(() => expect(setUnrealProjects).toHaveBeenCalledTimes(1))

    // Every other mutating control is disabled while the write is pending. The
    // busy dialog is modal (the background tree is aria-hidden), so the cards
    // are reached by their labels, not by role.
    expect(screen.getByLabelText('Unlink B')).toHaveProperty('disabled', true)
    expect(screen.getByLabelText('Install DTH content into B')).toHaveProperty('disabled', true)
    // A disabled unlink can't even open its confirm — no interleaved write.
    fireEvent.click(screen.getByLabelText('Unlink B'))
    expect(setUnrealProjects).toHaveBeenCalledTimes(1)

    finish()
    await waitFor(() =>
      expect(screen.getByLabelText('Unlink B')).toHaveProperty('disabled', false),
    )
  })

  it('a failed Content/DazToHue probe enables the install button (unknown ≠ disabled forever)', async () => {
    unrealDthContentPresent.mockRejectedValueOnce(new Error('share offline'))
    render(<UnrealProjectsBar project={projectWith([A])} />)

    await waitFor(() => expect(unrealDthContentPresent).toHaveBeenCalledTimes(1))
    // The probe failed → treated as "not installed": the button is usable, not
    // permanently disabled with no explanation.
    await waitFor(() =>
      expect(screen.getByLabelText('Install DTH content into A')).toHaveProperty(
        'disabled',
        false,
      ),
    )
  })

  it('Ctrl+click sends overwrite even when the probe said absent (user intent wins)', async () => {
    // The probe is WRONG here: content exists on disk but it reported absent
    // (e.g. the probe failed and defaulted to false). `overwrite: !!present`
    // alone made Ctrl+click a dead end — the error said "Ctrl+click to
    // overwrite" while Ctrl+click still sent overwrite:false.
    unrealDthContentPresent.mockResolvedValueOnce(false)
    render(<UnrealProjectsBar project={projectWith([A])} />)
    const install = screen.getByLabelText('Install DTH content into A')
    await waitFor(() => expect(install).toHaveProperty('disabled', false))

    fireEvent.click(install, { ctrlKey: true })
    await waitFor(() => expect(installUnrealDthContent).toHaveBeenCalledTimes(1))
    expect(installUnrealDthContent.mock.calls[0][0].data.overwrite).toBe(true)
  })

  it('an "already exists" install error flips the status to installed (no dead-end loop)', async () => {
    unrealDthContentPresent.mockResolvedValueOnce(false)
    installUnrealDthContent.mockRejectedValueOnce(
      new Error('Content/DazToHue already exists in this project — Ctrl+click to overwrite.'),
    )
    render(<UnrealProjectsBar project={projectWith([A])} />)
    const install = screen.getByLabelText('Install DTH content into A')
    await waitFor(() => expect(install).toHaveProperty('disabled', false))

    // Plain click with the wrong probe → the install itself reports "already
    // exists" — that truth replaces the stale probe result.
    fireEvent.click(install)
    await waitFor(() => expect(installUnrealDthContent).toHaveBeenCalledTimes(1))
    expect(installUnrealDthContent.mock.calls[0][0].data.overwrite).toBe(false)

    // The flipped status dims the button (the "installed" look)…
    await waitFor(() => expect(install.className).toContain('text-muted-foreground/50'))
    // …and the next plain click hits the "already installed — Ctrl+click" hint
    // instead of re-running the same failing install.
    fireEvent.click(install)
    expect(installUnrealDthContent).toHaveBeenCalledTimes(1)
  })
})
