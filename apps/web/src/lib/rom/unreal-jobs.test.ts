import { describe, expect, it } from 'vitest'

import {
  UNREAL_BRIDGE_VERSION,
  UNREAL_JOB_VERSION,
  bridgeOutdated,
  bridgeUpluginJson,
  bridgeVersionFrom,
  dthExportFiles,
  parseUnrealJob,
  parseUnrealResult,
  unidentifiedEditorTargets,
  unrealContentPath,
  unrealDestinationFor,
  unrealImportAbandoned,
  unrealImportStateFrom,
  unrealJobJson,
  unrealJobPaths,
  unrealLaunchVerdict,
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
    expect(p.bridgeDir).toBe('D:/Unreal Projects/DemoGame/Plugins/DTHCharacterStudioRunner')
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

describe('unrealContentPath', () => {
  const PROJECT = 'D:/Perforce/3d-workflow/unreal/workflow3d'

  it('maps a folder under Content/ to the path Unreal knows it by', () => {
    // The real one, measured: the character the bridge failed to find sat here,
    // and this is how the studio hands its location over instead.
    expect(unrealContentPath(PROJECT, `${PROJECT}/Content/Characters/Lara`)).toBe(
      '/Game/Characters/Lara',
    )
    expect(unrealContentPath(PROJECT, `${PROJECT}/Content`)).toBe('/Game')
    // Windows separators and a trailing slash both arrive from real callers.
    expect(unrealContentPath(PROJECT, `${PROJECT}\\Content\\DazToHue\\LaraClassic\\`)).toBe(
      '/Game/DazToHue/LaraClassic',
    )
  })

  it('answers nothing for a folder outside Content/', () => {
    // '' is "no destination", never a guess — the caller falls back to the
    // default rather than importing somewhere invented.
    expect(unrealContentPath(PROJECT, `${PROJECT}/Plugins/DTHCharacterStudioRunner`)).toBe('')
    expect(unrealContentPath(PROJECT, 'D:/elsewhere/Content/X')).toBe('')
    expect(unrealContentPath(PROJECT, '')).toBe('')
  })
})

describe('unrealJobJson', () => {
  it('writes the version the bridge checks, and forward-slashed paths', () => {
    const raw = unrealJobJson([
      {
        dth: 'D:\\p\\Kira\\export\\Kira\\DTH_Kira.dth',
        destination: '/Game/DazToHue/Kira',
        existing: false,
        character: 'Kira',
        files: ['D:\\p\\Kira\\export\\Kira\\Skeletal Meshes\\SKM_Kira.fbx'],
      },
    ])
    const job = JSON.parse(raw) as { version: number; imports: Array<Record<string, unknown>> }
    expect(job.version).toBe(UNREAL_JOB_VERSION)
    // Python's os.path handles either, but a JSON file full of `\p` is a
    // string-escape accident waiting to happen.
    expect(job.imports[0].dth).toBe('D:/p/Kira/export/Kira/DTH_Kira.dth')
    expect(job.imports[0].files).toEqual(['D:/p/Kira/export/Kira/Skeletal Meshes/SKM_Kira.fbx'])
    expect(raw.endsWith('\n')).toBe(true)
  })

  it('carries EVERY export set in one job — the handoff is a single file', () => {
    // A character's export folder holds one set per HDA `character_name`
    // (measured: three outfit variants). Sending them as separate jobs would
    // mean each one replacing the last before the editor ever claimed it.
    const job = JSON.parse(
      unrealJobJson([
        { dth: 'D:/x/LaraCroft/DTH_LaraCroft.dth', destination: '/Game/Characters/Lara', existing: true, character: 'LaraCroft', files: [] },
        { dth: 'D:/x/LaraNaked/DTH_LaraNaked.dth', destination: '/Game/DazToHue/LaraNaked', existing: false, character: 'LaraNaked', files: [] },
      ]),
    ) as { imports: Array<{ character: string }> }
    expect(job.imports.map((one) => one.character)).toEqual(['LaraCroft', 'LaraNaked'])
  })
})

describe('parseUnrealJob', () => {
  it('round-trips what unrealJobJson writes', () => {
    const job = parseUnrealJob(
      unrealJobJson([
        {
          dth: 'D:/p/Kira/export/Kira/DTH_Kira.dth',
          destination: '/Game/Characters/Kira',
          existing: true,
          character: 'Kira',
          files: ['D:/p/Kira/export/Kira/Skeletal Meshes/SKM_Kira.fbx'],
        },
      ]),
    )
    expect(job?.version).toBe(UNREAL_JOB_VERSION)
    expect(job?.imports).toEqual([
      {
        dth: 'D:/p/Kira/export/Kira/DTH_Kira.dth',
        destination: '/Game/Characters/Kira',
        existing: true,
        character: 'Kira',
        files: ['D:/p/Kira/export/Kira/Skeletal Meshes/SKM_Kira.fbx'],
      },
    ])
  })

  it('tolerates missing fields and refuses garbage — null, never a throw', () => {
    // A job an older (or newer) studio wrote still answers "whose is it": the
    // adoption only needs `dth` and `character`, defaulted when absent.
    expect(parseUnrealJob('{"imports":[{"dth":"D:/x/DTH_X.dth"}]}')).toEqual({
      version: 0,
      imports: [{ dth: 'D:/x/DTH_X.dth', destination: '', existing: false, character: '', files: [] }],
    })
    expect(parseUnrealJob('{"version":4,"imp')).toBeNull()
    expect(parseUnrealJob('')).toBeNull()
    expect(parseUnrealJob('[]')).toBeNull()
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
    // The PLUGIN's version, not the job contract's: a fix to the Python ships
    // without changing what the two sides must agree on.
    expect(bridgeVersionFrom(bridgeUpluginJson())).toBe(UNREAL_BRIDGE_VERSION)
  })

  it('calls a bridge stale only when there IS one', () => {
    // 0 is "not installed", which needs a different message and a different
    // fix — crying "out of date" at a project nobody installed into is noise.
    expect(bridgeOutdated(0)).toBe(false)
    expect(bridgeOutdated(UNREAL_BRIDGE_VERSION)).toBe(false)
    // Any other NON-ZERO version is stale — older after a fix ships, and newer
    // if a project was installed into by a later build of the app. Both mean
    // "not the copy this app ships", and both are fixed by re-installing.
    expect(bridgeOutdated(UNREAL_BRIDGE_VERSION + 1)).toBe(true)
    expect(bridgeOutdated(99)).toBe(true)
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
  const oneImport = (over: Record<string, unknown> = {}) => ({
    character: 'Kira',
    destination: '/Game/DazToHue/Kira',
    mode: 'import',
    assets: ['/Game/x'],
    ...over,
  })
  const result = (over: Record<string, unknown> = {}) =>
    parseUnrealResult(
      JSON.stringify({ version: 3, state: 'done', imports: [oneImport()], ...over }),
    )!

  it('is WAITING while the job sits unclaimed — Unreal is not watching yet', () => {
    // The stretch the user sees first, and the one that must not read as an
    // error: an editor takes minutes to come up.
    expect(unrealImportStateFrom(true, null)).toEqual({ state: 'waiting' })
  })

  it('is running once the job has been claimed but no result exists yet', () => {
    expect(unrealImportStateFrom(false, null)).toEqual({ state: 'running' })
    expect(unrealImportStateFrom(false, result({ state: 'running', imports: [] }))).toEqual({
      state: 'running',
    })
  })

  it('reports what landed when it finishes', () => {
    expect(
      unrealImportStateFrom(false, result({ imports: [oneImport({ assets: ['/Game/a', '/Game/b'] })] })),
    ).toEqual({
      state: 'finished',
      assets: 2,
      error: '',
      sets: 1,
      reimported: false,
      destination: '/Game/DazToHue/Kira',
    })
  })

  it('sums several export sets and names no single folder', () => {
    // Three outfit variants of one character land in three content folders —
    // a toast listing all of them is a wall, so the count carries it.
    const state = unrealImportStateFrom(
      false,
      result({
        imports: [
          oneImport({ assets: ['/Game/a'] }),
          oneImport({ character: 'LaraNaked', destination: '/Game/DazToHue/LaraNaked', assets: ['/Game/b', '/Game/c'] }),
        ],
      }),
    )
    expect(state).toMatchObject({ state: 'finished', assets: 3, sets: 2, destination: '' })
  })

  it('carries the re-import verdict and the folder it actually landed in', () => {
    // A re-import lands where the assets ALREADY were — which may be nowhere
    // near the destination the job asked for, so the toast has to read it off
    // the result rather than repeat what it sent.
    expect(
      unrealImportStateFrom(
        false,
        result({ imports: [oneImport({ mode: 'reimport', destination: '/Game/Characters/Kira' })] }),
      ),
    ).toMatchObject({ state: 'finished', reimported: true, destination: '/Game/Characters/Kira' })
  })

  it('never reports a failure without something to show', () => {
    expect(unrealImportStateFrom(false, result({ state: 'failed', error: '' }))).toMatchObject({
      state: 'finished',
      error: 'the import failed in Unreal',
    })
  })

  it('does not call a PARTLY failed job a success', () => {
    // The bridge imports each export set on its own and reports `done` as long
    // as one landed, carrying the rest's errors in `error` — so a job where two
    // sets imported and a third blew up arrives as state 'done' WITH an error.
    // Reading that field only on 'failed' reported the whole thing as clean,
    // which is the one thing this leg must never do: the user is told their
    // character reached Unreal while a variant of it silently did not.
    const partial = unrealImportStateFrom(
      false,
      result({
        state: 'done',
        error: 'LaraNaked: RuntimeError: duplicate_asset returned None',
        imports: [oneImport(), oneImport({ character: 'LaraClassic' })],
      }),
    )
    expect(partial).toMatchObject({
      state: 'finished',
      // BOTH halves survive: what landed, and what did not.
      sets: 2,
      error: 'LaraNaked: RuntimeError: duplicate_asset returned None',
    })
  })

  it('leaves the error empty when nothing went wrong', () => {
    // The other side of the same change — carrying `error` unconditionally must
    // not invent one for a clean run.
    expect(unrealImportStateFrom(false, result({ state: 'done', error: '' }))).toMatchObject({
      error: '',
    })
  })

  it('treats a torn read as "ask again", not as a failure', () => {
    expect(parseUnrealResult('{"version":1,"sta')).toBeNull()
    expect(parseUnrealResult('')).toBeNull()
  })
})

describe('unrealLaunchVerdict', () => {
  const probe = (editors: number, projects: Array<string>, unknown: number) => ({
    editors,
    projects,
    unknown,
  })

  it('launches when nothing is running at all', () => {
    expect(unrealLaunchVerdict(probe(0, [], 0), UPROJECT)).toEqual({
      launch: true,
      reason: 'no-editor',
    })
  })

  it('never launches a second editor of the TARGET — spelling notwithstanding', () => {
    // The probe reports what the editor's command line said, which on a real
    // machine (measured 2026-08-20) is backslashed while the linked project is
    // stored with whatever slashes the picker returned. Same project.
    const open = probe(1, ['D:\\Unreal Projects\\DemoGame\\DEMOGAME.uproject'], 0)
    expect(unrealLaunchVerdict(open, UPROJECT)).toEqual({ launch: false, reason: 'target-open' })
  })

  it('launches the target BESIDE identified editors of other projects', () => {
    // The reported bug: a different project open meant nothing was ever
    // launched and the job sat unclaimed forever. Editors of different
    // projects run side by side by design.
    const open = probe(1, ['D:/Other/Other.uproject'], 0)
    expect(unrealLaunchVerdict(open, UPROJECT)).toEqual({
      launch: true,
      reason: 'other-project',
    })
  })

  it('refuses to launch blind next to an editor it cannot identify', () => {
    // The unidentified editor might BE the target — a wrong guess costs a
    // duplicate editor, not launching costs a job that waits and says so.
    const open = probe(2, ['D:/Other/Other.uproject'], 1)
    expect(unrealLaunchVerdict(open, UPROJECT)).toEqual({
      launch: false,
      reason: 'unknown-editor',
    })
  })

  it('an unidentified editor never overrides a SEEN target', () => {
    const open = probe(2, [UPROJECT], 1)
    expect(unrealLaunchVerdict(open, UPROJECT)).toEqual({ launch: false, reason: 'target-open' })
  })
})

describe('unidentifiedEditorTargets', () => {
  const OTHER = 'D:/Unreal Projects/Other/Other.uproject'

  it('warns about nothing when every editor is identified', () => {
    // Identified editors are the launch verdict's business — either the
    // target is open (claims the job) or it gets opened beside them.
    expect(
      unidentifiedEditorTargets({ editors: 1, projects: [OTHER], unknown: 0 }, [UPROJECT]),
    ).toEqual([])
    expect(unidentifiedEditorTargets({ editors: 0, projects: [], unknown: 0 }, [UPROJECT])).toEqual(
      [],
    )
  })

  it('names the targets an unidentified editor might be holding', () => {
    expect(
      unidentifiedEditorTargets({ editors: 1, projects: [], unknown: 1 }, [UPROJECT, OTHER]),
    ).toEqual([UPROJECT, OTHER])
  })

  it('a target SEEN open needs no warning even next to an unknown editor', () => {
    // Its job gets claimed by the editor that has it — the unknown one is
    // irrelevant to this target.
    expect(
      unidentifiedEditorTargets(
        { editors: 2, projects: ['d:\\unreal projects\\demogame\\demogame.uproject'], unknown: 1 },
        [UPROJECT, OTHER],
      ),
    ).toEqual([OTHER])
  })
})

describe('unrealImportAbandoned', () => {
  // Only ever asked about a CLAIMED job — the liveness verdict that ended the
  // forever-Working state the first real editor crash left behind
  // (2026-08-25): a claimed import no editor could be running is dead.
  const target = 'D:/Unreal Projects/DemoGame/DemoGame.uproject'

  it('no editor process at all: dead — a crashed editor has no process', () => {
    expect(unrealImportAbandoned({ editors: 0, projects: [], unknown: 0 }, target)).toBe(true)
  })

  it('an unidentified editor might be the target: not dead', () => {
    expect(unrealImportAbandoned({ editors: 1, projects: [], unknown: 1 }, target)).toBe(false)
  })

  it('every editor identified and none holds the project: dead', () => {
    expect(
      unrealImportAbandoned(
        { editors: 1, projects: ['D:/Unreal Projects/Other/Other.uproject'], unknown: 0 },
        target,
      ),
    ).toBe(true)
  })

  it('the target is open (any path spelling): alive', () => {
    expect(
      unrealImportAbandoned(
        { editors: 1, projects: ['D:\\Unreal Projects\\DemoGame\\DEMOGAME.UPROJECT'], unknown: 0 },
        target,
      ),
    ).toBe(false)
  })
})
