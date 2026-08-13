// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const setUnrealProjects = vi.fn(async (_: { data: { projectId: string; paths: Array<string> } }) => {})
const unrealDthContentPresent = vi.fn(async (_: { data: { uprojectPath: string } }) => true)
const unrealProjectState = vi.fn(async (_: { data: { uprojectPath: string } }) => ({
  engineAssociation: '5.7',
  dthPresent: false,
  installedPlugins: [] as Array<string>,
}))
vi.mock('#/lib/rom/api.ts', () => ({
  setUnrealProjects: (args: { data: { projectId: string; paths: Array<string> } }) =>
    setUnrealProjects(args),
  unrealDthContentPresent: (args: { data: { uprojectPath: string } }) =>
    unrealDthContentPresent(args),
  unrealProjectState: (args: { data: { uprojectPath: string } }) => unrealProjectState(args),
  scanUnrealPlugins: async () => [],
  detectUnrealEngines: async () => ({ installs: [] }),
  installUnrealDthContent: async () => 0,
  installUnrealPlugin: async () => 0,
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
    expect(screen.getByLabelText('Install DTH content and plugins into B')).toHaveProperty(
      'disabled',
      true,
    )
    // A disabled unlink can't even open its confirm — no interleaved write.
    fireEvent.click(screen.getByLabelText('Unlink B'))
    expect(setUnrealProjects).toHaveBeenCalledTimes(1)

    finish()
    await waitFor(() =>
      expect(screen.getByLabelText('Unlink B')).toHaveProperty('disabled', false),
    )
  })

  it('a failed Content/DazToHue probe leaves the install button usable (unknown ≠ disabled)', async () => {
    unrealDthContentPresent.mockRejectedValueOnce(new Error('share offline'))
    render(<UnrealProjectsBar project={projectWith([A])} />)

    await waitFor(() => expect(unrealDthContentPresent).toHaveBeenCalledTimes(1))
    // The probe only drives the button's dim — the dialog does its own probing,
    // so a failed (or pending) probe must never disable the entry point.
    expect(screen.getByLabelText('Install DTH content and plugins into A')).toHaveProperty(
      'disabled',
      false,
    )
  })

  it('the install button opens the install dialog for that project', async () => {
    unrealDthContentPresent.mockResolvedValueOnce(false)
    render(<UnrealProjectsBar project={projectWith([A])} />)

    // The CARD already probes this project once, for the bridge-staleness
    // warning — so the dialog's own probe is the second call, not the first.
    await waitFor(() => expect(unrealProjectState).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByLabelText('Install DTH content and plugins into A'))
    // The dialog probes THIS project and renders its checklist.
    await waitFor(() => expect(unrealProjectState).toHaveBeenCalledTimes(2))
    expect(unrealProjectState.mock.calls[1][0].data.uprojectPath).toBe(A)
    await waitFor(() => expect(screen.getByText('DTH content')).toBeTruthy())
    expect(screen.getByRole('button', { name: /Install$/ })).toBeTruthy()
  })
})
