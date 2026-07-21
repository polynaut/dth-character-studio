// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const setUnrealProjects = vi.fn(async (_: { data: { projectId: string; paths: Array<string> } }) => {})
vi.mock('#/lib/rom/api.ts', () => ({
  setUnrealProjects: (args: { data: { projectId: string; paths: Array<string> } }) =>
    setUnrealProjects(args),
  unrealDthContentPresent: async () => true,
  installUnrealDthContent: async () => 0,
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

    fireEvent.click(screen.getByLabelText('Unlink A'))
    await waitFor(() => expect(setUnrealProjects).toHaveBeenCalledTimes(1))
    expect(setUnrealProjects.mock.calls[0][0].data.paths).toEqual([B])

    // The prop still lists [A, B] (no invalidate/rerender happened) — the next
    // write must build on the freshest list [B], not resurrect A.
    fireEvent.click(screen.getByLabelText('Unlink B'))
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
    await waitFor(() => expect(setUnrealProjects).toHaveBeenCalledTimes(1))

    // Every other mutating control is disabled while the write is pending.
    expect(screen.getByLabelText('Unlink B')).toHaveProperty('disabled', true)
    expect(screen.getByLabelText('Install DTH content into B')).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: /Linking…/ })).toHaveProperty('disabled', true)
    // A disabled unlink can't fire — no interleaved second write.
    fireEvent.click(screen.getByLabelText('Unlink B'))
    expect(setUnrealProjects).toHaveBeenCalledTimes(1)

    finish()
    await waitFor(() =>
      expect(screen.getByLabelText('Unlink B')).toHaveProperty('disabled', false),
    )
  })
})
