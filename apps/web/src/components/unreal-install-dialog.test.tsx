// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const state = {
  engineAssociation: '5.7',
  dthPresent: false,
  installedPlugins: [] as Array<string>,
}
const unrealProjectState = vi.fn(async (_: { data: { uprojectPath: string } }) => ({ ...state }))
const scanUnrealPlugins = vi.fn(async () => [
  {
    name: 'DazToUnreal',
    path: 'D:/bridge/UE_5.7/Plugins/DazToUnreal',
    engineVersion: '5.7',
    sourceFolder: 'D:/bridge',
  },
  {
    name: 'DazToUnreal',
    path: 'D:/bridge/UE_5.6/Plugins/DazToUnreal',
    engineVersion: '5.6',
    sourceFolder: 'D:/bridge',
  },
  { name: 'AnyTool', path: 'D:/any/AnyTool', engineVersion: '', sourceFolder: 'D:/any' },
])
const installUnrealDthContent = vi.fn(
  async (_: { data: { uprojectPath: string; overwrite: boolean } }) => 12,
)
const installUnrealPlugin = vi.fn(
  async (_: { data: { pluginPath: string; uprojectPath: string; overwrite: boolean } }) => 5,
)
const createUnrealProject = vi.fn(
  async (_: { data: { parentDir: string; name: string; engineVersion: string } }) => ({
    uprojectPath: 'D:/UE/New/New.uproject',
    projectDir: 'D:/UE/New',
  }),
)
const detectUnrealEngines = vi.fn(async () => ({
  installs: [
    { version: '5.7', path: 'D:/UE_5.7', name: 'Unreal Engine 5.7', exists: true },
    { version: '5.6', path: 'D:/UE_5.6', name: 'Unreal Engine 5.6', exists: true },
  ],
}))
vi.mock('#/lib/rom/api.ts', () => ({
  unrealProjectState: (args: { data: { uprojectPath: string } }) => unrealProjectState(args),
  scanUnrealPlugins: () => scanUnrealPlugins(),
  installUnrealDthContent: (args: { data: { uprojectPath: string; overwrite: boolean } }) =>
    installUnrealDthContent(args),
  installUnrealPlugin: (args: {
    data: { pluginPath: string; uprojectPath: string; overwrite: boolean }
  }) => installUnrealPlugin(args),
  createUnrealProject: (args: { data: { parentDir: string; name: string; engineVersion: string } }) =>
    createUnrealProject(args),
  detectUnrealEngines: () => detectUnrealEngines(),
  fileExists: async () => false,
}))
vi.mock('#/lib/desktop.ts', () => ({ pickFolder: async () => '' }))

import { UnrealGenerateDialog, UnrealInstallDialog } from './unreal-install-dialog'

const UPROJECT = 'C:/UE/Game/Game.uproject'

describe('UnrealInstallDialog', () => {
  it('pre-checks DTH content + the builds matching the project engine', async () => {
    render(<UnrealInstallDialog uprojectPath={UPROJECT} onClose={() => {}} onInstalled={() => {}} />)
    await waitFor(() => expect(screen.getByText('DTH content')).toBeTruthy())

    // Engine read from the .uproject; the 5.6 build is filtered out — ONE
    // DazToUnreal row (the 5.7 build), plus the any-engine tool.
    expect(screen.getByText('Unreal Engine 5.7')).toBeTruthy()
    const boxes = screen.getAllByRole('checkbox') as Array<HTMLInputElement>
    expect(boxes).toHaveLength(3)
    expect(boxes.every((box) => box.checked)).toBe(true)
    expect(screen.getByText('DazToUnreal')).toBeTruthy()
    expect(screen.getByText('AnyTool')).toBeTruthy()
  })

  it('installs the checked items with overwrite and reports back', async () => {
    const onClose = vi.fn()
    const onInstalled = vi.fn()
    render(<UnrealInstallDialog uprojectPath={UPROJECT} onClose={onClose} onInstalled={onInstalled} />)
    await waitFor(() => expect(screen.getByText('DTH content')).toBeTruthy())

    // Uncheck the any-engine tool — only DTH content + DazToUnreal install.
    const anyTool = screen.getByText('AnyTool').closest('label')!
    fireEvent.click(anyTool.querySelector('input')!)
    fireEvent.click(screen.getByRole('button', { name: /Install$/ }))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(installUnrealDthContent).toHaveBeenCalledTimes(1)
    expect(installUnrealDthContent.mock.calls[0][0].data).toEqual({
      uprojectPath: UPROJECT,
      overwrite: true,
    })
    expect(installUnrealPlugin).toHaveBeenCalledTimes(1)
    expect(installUnrealPlugin.mock.calls[0][0].data).toEqual({
      pluginPath: 'D:/bridge/UE_5.7/Plugins/DazToUnreal',
      uprojectPath: UPROJECT,
      overwrite: true,
    })
    expect(onInstalled).toHaveBeenCalledWith(true)
  })

  it('lists every build UNCHECKED when the engine association is a source-build GUID', async () => {
    unrealProjectState.mockResolvedValueOnce({
      engineAssociation: '{1AC42E62-5A4F-2D31-A3C4-9DA2BBBB78A2}',
      dthPresent: false,
      installedPlugins: [],
    })
    render(<UnrealInstallDialog uprojectPath={UPROJECT} onClose={() => {}} onInstalled={() => {}} />)
    await waitFor(() => expect(screen.getByText('DTH content')).toBeTruthy())

    expect(screen.getByText(/Engine version unknown/)).toBeTruthy()
    // ALL builds listed (both DazToUnreal builds + AnyTool + DTH content)…
    const boxes = screen.getAllByRole('checkbox') as Array<HTMLInputElement>
    expect(boxes).toHaveLength(4)
    // …but only the engine-independent DTH content starts checked.
    expect(boxes.filter((box) => box.checked)).toHaveLength(1)
  })

  it('stays open and re-probes when an install fails (the checklist must tell the truth)', async () => {
    const onClose = vi.fn()
    installUnrealPlugin.mockRejectedValue(new Error('locked'))
    render(<UnrealInstallDialog uprojectPath={UPROJECT} onClose={onClose} onInstalled={() => {}} />)
    await waitFor(() => expect(screen.getByText('DTH content')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /Install$/ }))
    // A failed item keeps the dialog open, and the state is re-read from disk.
    await waitFor(() => expect(unrealProjectState).toHaveBeenCalledTimes(2))
    expect(onClose).not.toHaveBeenCalled()
    // Only the FAILED items stay checked for the retry — the succeeded DTH
    // content is unchecked, so a second Install redoes just what went wrong.
    await waitFor(() => {
      const boxes = screen.getAllByRole('checkbox') as Array<HTMLInputElement>
      expect(boxes.map((box) => box.checked)).toEqual([false, true, true])
    })
  })
})

describe('UnrealGenerateDialog', () => {
  it('creates the project for the preselected newest engine, installs, links', async () => {
    const onClose = vi.fn()
    const onGenerated = vi.fn()
    render(<UnrealGenerateDialog suggestedDir="D:/UE" onClose={onClose} onGenerated={onGenerated} />)
    await waitFor(() => expect(screen.getByLabelText('Project name')).toBeTruthy())

    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'NewGame' } })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Create$/ })).toHaveProperty('disabled', false),
    )
    fireEvent.click(screen.getByRole('button', { name: /Create$/ }))

    await waitFor(() => expect(onGenerated).toHaveBeenCalledWith('D:/UE/New/New.uproject'))
    expect(createUnrealProject.mock.calls[0][0].data).toEqual({
      parentDir: 'D:/UE',
      name: 'NewGame',
      engineVersion: '5.7',
    })
    // The pre-checked items were installed into the CREATED project.
    expect(installUnrealDthContent.mock.calls[0][0].data.uprojectPath).toBe(
      'D:/UE/New/New.uproject',
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('says so when no engine is detected instead of offering a dead Create', async () => {
    detectUnrealEngines.mockResolvedValueOnce({ installs: [] })
    render(<UnrealGenerateDialog suggestedDir="" onClose={() => {}} onGenerated={() => {}} />)
    await waitFor(() => expect(screen.getByText(/No Unreal Engine detected/)).toBeTruthy())
    expect(screen.queryByRole('button', { name: /Create$/ })).toBeNull()
  })
})
