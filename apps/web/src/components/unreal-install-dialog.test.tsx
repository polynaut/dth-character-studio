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
// `buildId` on every entry — the native scan always sends the field, and a mock
// that omits it types itself without one, so a per-test override could not
// express a build id at all (measured: TS2353 on the first test that tried).
const scanUnrealPlugins = vi.fn(async () => [
  {
    name: 'DazToUnreal',
    path: 'D:/bridge/UE_5.7/Plugins/DazToUnreal',
    engineVersion: '5.7',
    sourceFolder: 'D:/bridge',
    buildId: '',
  },
  {
    name: 'DazToUnreal',
    path: 'D:/bridge/UE_5.6/Plugins/DazToUnreal',
    engineVersion: '5.6',
    sourceFolder: 'D:/bridge',
    buildId: '',
  },
  {
    name: 'AnyTool',
    path: 'D:/any/AnyTool',
    engineVersion: '',
    sourceFolder: 'D:/any',
    buildId: '',
  },
])
/** The reported shape: an `any engine` build (its folder writes the version
 *  with underscores, so nothing reads as a version) whose BINARIES are 5.7. */
const KAWAII = {
  name: 'KawaiiPhysics',
  path: 'X:/plugins/KawaiiPhysics_5_7_1_v1.19.1__recompiled/Plugins/KawaiiPhysics',
  engineVersion: '',
  sourceFolder: 'X:/plugins',
  buildId: '47537391',
}
const installUnrealDthContent = vi.fn(
  async (_: { data: { uprojectPath: string; overwrite: boolean } }) => 12,
)
const installUnrealPlugin = vi.fn(
  async (_: { data: { pluginPath: string; uprojectPath: string; overwrite: boolean } }) => 5,
)
const installUnrealBridge = vi.fn(async (_: { data: { uprojectPath: string } }) => 3)
const detectUnrealEngines = vi.fn(async () => ({
  installs: [
    { version: '5.7', path: 'D:/UE_5.7', name: 'Unreal Engine 5.7', exists: true, buildId: '47537391' },
    { version: '5.6', path: 'D:/UE_5.6', name: 'Unreal Engine 5.6', exists: true, buildId: '43139311' },
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
  installUnrealBridge: (args: { data: { uprojectPath: string } }) => installUnrealBridge(args),
  detectUnrealEngines: () => detectUnrealEngines(),
}))

import { UnrealInstallDialog } from './unreal-install-dialog'

const UPROJECT = 'C:/UE/Game/Game.uproject'

describe('UnrealInstallDialog', () => {
  it('pre-checks DTH content, the bridge, and the builds matching the project engine', async () => {
    render(<UnrealInstallDialog uprojectPath={UPROJECT} onClose={() => {}} onInstalled={() => {}} />)
    await waitFor(() => expect(screen.getByText('DTH content')).toBeTruthy())

    // Engine read from the .uproject; the 5.6 build is filtered out — ONE
    // DazToUnreal row (the 5.7 build), plus the any-engine tool, plus the
    // studio's own two engine-independent entries.
    expect(screen.getByText('Unreal Engine 5.7')).toBeTruthy()
    const boxes = screen.getAllByRole('checkbox') as Array<HTMLInputElement>
    expect(boxes).toHaveLength(4)
    expect(boxes.every((box) => box.checked)).toBe(true)
    expect(screen.getByText('Plugins/DTHCharacterStudioRunner')).toBeTruthy()
    expect(screen.getByText('DazToUnreal')).toBeTruthy()
    expect(screen.getByText('AnyTool')).toBeTruthy()
    // Exactly one row is the app's own — the scanned builds must not claim it.
    expect(screen.getAllByText('built in')).toHaveLength(1)
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

  it('installs the bridge from the checklist — and says when the project has it', async () => {
    // The studio's own plugin is an ITEM, not a side effect of sending a
    // character: it lands in the user's `Plugins/` only because they ticked it,
    // and a project that already has it says so like any other install.
    unrealProjectState.mockResolvedValueOnce({
      engineAssociation: '5.7',
      dthPresent: false,
      installedPlugins: ['DTHCharacterStudioRunner'],
    })
    render(<UnrealInstallDialog uprojectPath={UPROJECT} onClose={() => {}} onInstalled={() => {}} />)
    await waitFor(() => expect(screen.getByText('Plugins/DTHCharacterStudioRunner')).toBeTruthy())

    const row = screen.getByText('Plugins/DTHCharacterStudioRunner').closest('label')!
    expect(row.textContent).toContain('Plugins/DTHCharacterStudioRunner')
    // Marked as OURS: every other row is a plugin the user downloaded and
    // pointed the studio at, and this one arrives out of the app itself.
    expect(row.textContent).toContain('built in')
    expect(row.textContent).toContain('installed — a check overwrites it')
    expect(row.querySelector('input')!.checked).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /Install$/ }))
    await waitFor(() => expect(installUnrealBridge).toHaveBeenCalledTimes(1))
    expect(installUnrealBridge.mock.calls[0][0].data).toEqual({ uprojectPath: UPROJECT })
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
    // ALL builds listed (both DazToUnreal builds + AnyTool + the studio's two)…
    const boxes = screen.getAllByRole('checkbox') as Array<HTMLInputElement>
    expect(boxes).toHaveLength(5)
    // …but only the engine-independent pair starts checked: DTH content and the
    // bridge carry no binaries, so an unknown engine cannot make them wrong.
    expect(boxes.filter((box) => box.checked)).toHaveLength(2)
  })

  it('marks and unchecks a build whose binaries are for another engine build', async () => {
    // The reported failure, in the dialog it actually happened in: the engine
    // is looked up by the version the `.uproject` associates (5.7 here), and a
    // break there would silently answer "cannot tell" for every build, with
    // nothing to see.
    scanUnrealPlugins.mockResolvedValueOnce([{ ...KAWAII, buildId: '55116800' }])
    render(<UnrealInstallDialog uprojectPath={UPROJECT} onClose={() => {}} onInstalled={() => {}} />)
    await waitFor(() => expect(screen.getByText('KawaiiPhysics')).toBeTruthy())

    expect(screen.getByText(/built for another engine build/)).toBeTruthy()
    const kawaii = screen.getByText('KawaiiPhysics').closest('label')!.querySelector('input')!
    expect(kawaii.checked).toBe(false)
    // DTH content and the bridge are engine-independent and stay ticked.
    const boxes = screen.getAllByRole('checkbox') as Array<HTMLInputElement>
    expect(boxes.filter((box) => box.checked)).toHaveLength(2)
  })

  it('offers the build that FITS when two of them look identical by label', async () => {
    // Two `any engine` builds of one plugin — the underscore-versioned folders
    // the reporter had. Offering one per name is right (one install target),
    // but picking the alphabetically first one meant offering the unloadable
    // build and hiding the good one. The BuildId decides.
    scanUnrealPlugins.mockResolvedValueOnce([
      { ...KAWAII, path: 'X:/plugins/KawaiiPhysics_5_8_0/Plugins/KawaiiPhysics', buildId: '55116800' },
      { ...KAWAII, path: 'X:/plugins/KawaiiPhysics_5_7_1/Plugins/KawaiiPhysics', buildId: '47537391' },
    ])
    render(<UnrealInstallDialog uprojectPath={UPROJECT} onClose={() => {}} onInstalled={() => {}} />)
    await waitFor(() => expect(screen.getByText('KawaiiPhysics')).toBeTruthy())

    // ONE row, no warning on it, and pre-checked — it is the 5.7-matching build.
    expect(screen.getAllByText('KawaiiPhysics')).toHaveLength(1)
    expect(screen.queryByText(/built for another engine build/)).toBeNull()
    const boxes = screen.getAllByRole('checkbox') as Array<HTMLInputElement>
    expect(boxes).toHaveLength(3)
    expect(boxes.every((box) => box.checked)).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /Install$/ }))
    await waitFor(() => expect(installUnrealPlugin).toHaveBeenCalledTimes(1))
    expect(installUnrealPlugin.mock.calls[0][0].data.pluginPath).toBe(
      'X:/plugins/KawaiiPhysics_5_7_1/Plugins/KawaiiPhysics',
    )
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
    // Only the FAILED items stay checked for the retry — the DTH content and
    // bridge that succeeded are unchecked, so a second Install redoes just what
    // went wrong.
    await waitFor(() => {
      const boxes = screen.getAllByRole('checkbox') as Array<HTMLInputElement>
      expect(boxes.map((box) => box.checked)).toEqual([false, false, true, true])
    })
  })
})
