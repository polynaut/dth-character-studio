import { describe, expect, it } from 'vitest'

import {
  UNREAL_JOB_VERSION,
  bridgeUpluginJson,
  bridgeVersionFrom,
  dthExportFiles,
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
      files: ['D:\\p\\Kira\\export\\Kira\\Skeletal Meshes\\SKM_Kira.fbx'],
    })
    const job = JSON.parse(raw) as Record<string, unknown>
    expect(job.version).toBe(UNREAL_JOB_VERSION)
    // Python's os.path handles either, but a JSON file full of `\p` is a
    // string-escape accident waiting to happen.
    expect(job.dth).toBe('D:/p/Kira/export/Kira/DTH_Kira.dth')
    expect(job.files).toEqual(['D:/p/Kira/export/Kira/Skeletal Meshes/SKM_Kira.fbx'])
    expect(raw.endsWith('\n')).toBe(true)
  })
})

describe('dthExportFiles', () => {
  // The real shape, from an export on this machine (DTH 2.5): absolute paths,
  // one skeletal mesh, and five sections that were all empty there.
  const MANIFEST = JSON.stringify({
    animation_curves: [
      { file: 'D:/p/Lara/export/LaraCroft/Animation Curves/MorphCurves0.txt', type: 'MOR' },
    ],
    character_name: 'LaraCroft',
    cloth_panel_proxies: [],
    cloth_panels: [],
    collision_proxy: {},
    detached_props: [],
    dth_version: '2.5',
    pose_assets: [],
    skeletal_meshes: [
      {
        file: 'D:/p/Lara/export/LaraCroft/Skeletal Meshes/SKM_LaraCroft.fbx',
        materials: [{ slot: 'Body', textures: { colour: 'd:/lib/body.jpg' }, type: 'Iray Uber' }],
        name: 'SKM_LaraCroft',
      },
    ],
    skinning_method: 'DQS',
  })

  it('takes the FBX the export declares, and nothing else', () => {
    expect(dthExportFiles(MANIFEST)).toEqual([
      'D:/p/Lara/export/LaraCroft/Skeletal Meshes/SKM_LaraCroft.fbx',
    ])
  })

  it('finds an FBX in a section this machine has never seen filled', () => {
    // Deliberately NOT keyed off `skeletal_meshes`: cloth panels, props and
    // proxies were empty in every export measured, so their shape is unknown —
    // and a future DTH may add sections nobody has seen at all.
    const withProps = JSON.stringify({
      skeletal_meshes: [{ file: 'D:/x/SKM_A.fbx' }],
      detached_props: [{ file: 'D:/x/Props/SM_Sword.fbx', name: 'Sword' }],
      cloth_panels: [{ panels: [{ file: 'D:/x/Cloth/SKM_Cape.fbx' }] }],
    })
    expect(dthExportFiles(withProps)).toEqual([
      'D:/x/Cloth/SKM_Cape.fbx',
      'D:/x/Props/SM_Sword.fbx',
      'D:/x/SKM_A.fbx',
    ])
  })

  it('normalizes, dedupes case-insensitively, and survives a bad manifest', () => {
    const dupes = JSON.stringify({ a: 'D:\\x\\SKM_A.fbx', b: 'd:/x/skm_a.FBX' })
    expect(dthExportFiles(dupes)).toEqual(['D:/x/SKM_A.fbx'])
    // An unreadable `.dth` means no matching, never a refusal to send: the
    // importer reports a broken manifest far better than a path scan could.
    expect(dthExportFiles('not json')).toEqual([])
    expect(dthExportFiles('')).toEqual([])
  })
})

describe('bridgeVersionFrom', () => {
  it('reads the version the installed bridge declares', () => {
    // Same field `bridgeUpluginJson` stamps — that is the whole point: the
    // studio can tell a stale bridge BEFORE queueing a job it would refuse.
    expect(bridgeVersionFrom(bridgeUpluginJson())).toBe(UNREAL_JOB_VERSION)
  })

  it('answers 0 for anything it cannot read — the same as no bridge at all', () => {
    expect(bridgeVersionFrom('{"Version":1}')).toBe(1)
    expect(bridgeVersionFrom('{"FriendlyName":"x"}')).toBe(0)
    expect(bridgeVersionFrom('{"Version":"2"}')).toBe(0)
    expect(bridgeVersionFrom('half-written {')).toBe(0)
    expect(bridgeVersionFrom('')).toBe(0)
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
    expect(
      unrealImportStateFrom(
        false,
        result({ assets: ['/Game/a', '/Game/b'], destination: '/Game/DazToHue/Kira' }),
      ),
    ).toEqual({
      state: 'finished',
      assets: 2,
      error: '',
      mode: 'import',
      destination: '/Game/DazToHue/Kira',
    })
  })

  it('carries the re-import verdict and the folder it actually landed in', () => {
    // A re-import lands where the assets ALREADY were — which may be nowhere
    // near the destination the job asked for, so the toast has to read it off
    // the result rather than repeat what it sent.
    expect(
      unrealImportStateFrom(
        false,
        result({ mode: 'reimport', destination: '/Game/Characters/Kira' }),
      ),
    ).toMatchObject({ state: 'finished', mode: 'reimport', destination: '/Game/Characters/Kira' })
  })

  it('reads a version-1 bridge\'s result as a plain import', () => {
    // The field is defaulted, so an older bridge (no `mode`) still parses —
    // it only ever did fresh imports, which is exactly what the default says.
    expect(unrealImportStateFrom(false, result())).toMatchObject({ mode: 'import' })
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
