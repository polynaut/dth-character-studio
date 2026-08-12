import { describe, expect, it } from 'vitest'

import {
  UNREAL_JOB_VERSION,
  bridgeUpluginJson,
  parseUnrealResult,
  unrealDestinationFor,
  unrealImportStateFrom,
  unrealJobJson,
  unrealJobPaths,
} from './unreal-jobs.ts'

// The Unreal handoff is pure by construction so the protocol can be pinned
// without an editor — which matters more here than for Daz or Houdini, because
// starting Unreal to check a path costs minutes.

const UPROJECT = 'D:/Unreal Projects/DemoGame/DemoGame.uproject'

describe('unrealJobPaths', () => {
  it('puts the handoff in the project\'s own Saved/, never Content/', () => {
    const p = unrealJobPaths(UPROJECT)
    expect(p.projectDir).toBe('D:/Unreal Projects/DemoGame')
    expect(p.jobFile).toBe('D:/Unreal Projects/DemoGame/Saved/DTHStudio/job.json')
    expect(p.claimedFile).toBe('D:/Unreal Projects/DemoGame/Saved/DTHStudio/running_job.json')
    expect(p.resultFile).toBe('D:/Unreal Projects/DemoGame/Saved/DTHStudio/result.json')
    // Anything under Content/ would be mistaken for an asset by the editor.
    expect(p.jobFile).not.toMatch(/\/Content\//)
    expect(p.bridgeDir).toBe('D:/Unreal Projects/DemoGame/Plugins/DTHStudioBridge')
  })

  it('accepts a Windows path verbatim — the picker returns backslashes', () => {
    expect(unrealJobPaths('D:\\UE\\Game\\Game.uproject').jobDir).toBe('D:/UE/Game/Saved/DTHStudio')
  })
})

describe('unrealDestinationFor', () => {
  it('is one folder per character under the DazToHue content root', () => {
    expect(unrealDestinationFor('Kira')).toBe('/Game/DazToHue/Kira')
  })

  it('makes an Unreal-legal folder out of any character name', () => {
    // Unreal content paths are not filesystem paths — a space or a dash in a
    // package path is a problem the import would surface much later.
    expect(unrealDestinationFor('Lara Croft G8.1')).toBe('/Game/DazToHue/Lara_Croft_G8_1')
    expect(unrealDestinationFor('  ')).toBe('/Game/DazToHue/Character')
  })
})

describe('unrealJobJson', () => {
  it('writes the version the bridge checks, and forward-slashed paths', () => {
    const raw = unrealJobJson({
      dth: 'D:\\p\\Kira\\export\\Kira\\DTH_Kira.dth',
      destination: '/Game/DazToHue/Kira',
      character: 'Kira',
    })
    const job = JSON.parse(raw) as Record<string, unknown>
    expect(job.version).toBe(UNREAL_JOB_VERSION)
    // Python's os.path handles either, but a JSON file full of `\p` is a
    // string-escape accident waiting to happen.
    expect(job.dth).toBe('D:/p/Kira/export/Kira/DTH_Kira.dth')
    expect(raw.endsWith('\n')).toBe(true)
  })
})

describe('bridgeUpluginJson', () => {
  it('is content-only and needs PythonScriptPlugin', () => {
    const manifest = JSON.parse(bridgeUpluginJson()) as Record<string, unknown>
    // A code module would need compiling per engine version — the one thing
    // that would make the bridge stop working on a new UE.
    expect(manifest.Modules).toBeUndefined()
    expect(manifest.CanContainContent).toBe(true)
    expect(manifest.EnabledByDefault).toBe(true)
    expect(manifest.Plugins).toEqual([{ Name: 'PythonScriptPlugin', Enabled: true }])
  })
})

describe('unrealImportStateFrom', () => {
  const result = (over: Record<string, unknown> = {}) =>
    parseUnrealResult(JSON.stringify({ version: 1, state: 'done', assets: ['/Game/x'], ...over }))!

  it('is WAITING while the job sits unclaimed — Unreal is not watching yet', () => {
    // The stretch the user sees first, and the one that must not read as an
    // error: an editor takes minutes to come up.
    expect(unrealImportStateFrom(true, null)).toEqual({ state: 'waiting' })
  })

  it('is running once the job has been claimed but no result exists yet', () => {
    expect(unrealImportStateFrom(false, null)).toEqual({ state: 'running' })
    expect(unrealImportStateFrom(false, result({ state: 'running', assets: [] }))).toEqual({
      state: 'running',
    })
  })

  it('reports what landed when it finishes', () => {
    expect(unrealImportStateFrom(false, result({ assets: ['/Game/a', '/Game/b'] }))).toEqual({
      state: 'finished',
      assets: 2,
      error: '',
    })
  })

  it('never reports a failure without something to show', () => {
    expect(unrealImportStateFrom(false, result({ state: 'failed', error: '' }))).toMatchObject({
      state: 'finished',
      error: 'the import failed in Unreal',
    })
  })

  it('treats a torn read as "ask again", not as a failure', () => {
    expect(parseUnrealResult('{"version":1,"sta')).toBeNull()
    expect(parseUnrealResult('')).toBeNull()
  })
})
