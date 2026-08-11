import { describe, expect, it } from 'vitest'

import { HEALTHY, validateHoudiniProject } from './houdini-validate.ts'
import {
  emptyScanStore,
  freshScan,
  hdaLibraryKey,
  scanCacheKey,
  withScanResults,
} from './houdini-project-cache.ts'

import type { MaterialScanProject } from './api/native-types.ts'

const CHAR = 'D:/proj/Kira'

function scanned(over: Partial<MaterialScanProject> = {}): MaterialScanProject {
  return {
    hipPath: `${CHAR}/houdini/Kira.hiplc`,
    ok: true,
    error: '',
    nodes: [],
    job: CHAR,
    fps: 30,
    refs: { collapsible: 0, foreign: 0, broken: [], hipRelative: [] },
    prefill: { fillable: [], missing: [] },
    ...over,
  }
}

describe('validateHoudiniProject', () => {
  it('a wired project reports nothing', () => {
    expect(validateHoudiniProject(scanned(), CHAR)).toEqual(HEALTHY)
  })

  it('an unscanned project is not a fault', () => {
    // The badge must not appear while the background scan is still running —
    // otherwise every character page flashes a warning on load.
    expect(validateHoudiniProject(null, CHAR).ok).toBe(true)
    expect(validateHoudiniProject(undefined, CHAR).ok).toBe(true)
  })

  it('blames only the read failure when the project would not open', () => {
    // A file hython could not read reports no $JOB either — listing that too
    // would blame the wrong thing and bury the actual error.
    const health = validateHoudiniProject(
      scanned({ ok: false, error: 'hython exited 1', job: '', prefill: { fillable: ['x'], missing: [] } }),
      CHAR,
    )
    expect(health.problems.map((p) => p.code)).toEqual(['unreadable'])
    expect(health.summary).toContain('hython exited 1')
  })

  it('catches a $JOB pointing somewhere else — the copied-project case', () => {
    const health = validateHoudiniProject(scanned({ job: 'D:/proj/Ita' }), CHAR)
    expect(health.ok).toBe(false)
    expect(health.problems.map((p) => p.code)).toEqual(['job-differs'])
    expect(health.summary).toContain('D:/proj/Ita')
  })

  it('accepts a $JOB that differs only by separator or case', () => {
    expect(validateHoudiniProject(scanned({ job: 'd:\\proj\\kira' }), CHAR).ok).toBe(true)
    expect(validateHoudiniProject(scanned({ job: `${CHAR}/` }), CHAR).ok).toBe(true)
  })

  it('catches a timeline that is not the pipeline’s 30 fps', () => {
    // Houdini's own default is 24. A ROM is one pose per FRAME at 30, so every
    // imported frame would land between two of the scene's own.
    const health = validateHoudiniProject(scanned({ fps: 24 }), CHAR)
    expect(health.ok).toBe(false)
    expect(health.problems.map((p) => p.code)).toEqual(['fps-differs'])
    expect(health.summary).toContain('24')
    expect(health.summary).toContain('30')
  })

  it('an FPS the scan has no value for is never a fault', () => {
    // 0 is "nobody read it" — a project that would not open, or an entry stored
    // before the scan reported FPS at all. Badging that would invent a fault,
    // and the repair skips it for the same reason.
    expect(validateHoudiniProject(scanned({ fps: 0 }), CHAR).ok).toBe(true)
    // Float noise is not a difference either — Houdini's FPS is a float that
    // made a JSON round trip.
    expect(validateHoudiniProject(scanned({ fps: 30.0000001 }), CHAR).ok).toBe(true)
    // …but a real broadcast rate IS one: 29.97 is not 30.
    expect(validateHoudiniProject(scanned({ fps: 29.97 }), CHAR).ok).toBe(false)
  })

  it('reports unresolved import paths and blank parms, and names them', () => {
    const health = validateHoudiniProject(
      scanned({
        refs: {
          collapsible: 0,
          foreign: 2,
          broken: ['/obj/import import_character_dtu_file'],
          hipRelative: [],
        },
        prefill: { fillable: ['export_directory'], missing: ['pose_asset_csv_file_path'] },
      }),
      CHAR,
    )
    expect(health.problems.map((p) => p.code)).toEqual(['broken-refs', 'blank-parms'])
    expect(health.summary).toContain('import_character_dtu_file')
    expect(health.summary).toContain('export_directory')
    // `missing` is the DazToHue RELEASE lacking a parm — not this project's
    // fault and not something the user can fix, so it is never a problem.
    expect(health.summary).not.toContain('pose_asset_csv_file_path')
  })

  it('flags a pre-v63 project still anchored on $HIP, and names the fix', () => {
    // These RESOLVE — that is why nothing caught them before. They are a fault
    // because `$HIP` encodes the scene's depth and disagrees with what
    // Houdini's own picker writes into the same node.
    const health = validateHoudiniProject(
      scanned({
        refs: {
          collapsible: 0,
          foreign: 0,
          broken: [],
          hipRelative: ['/obj/dth import_character_dtu_file', '/obj/dth import_character_fbx_file'],
        },
      }),
      CHAR,
    )
    expect(health.ok).toBe(false)
    expect(health.problems.map((p) => p.code)).toEqual(['hip-relative'])
    expect(health.summary).toContain('$JOB')
    // The badge is only useful if it says where the repair lives.
    expect(health.summary).toContain('Make paths portable')
  })

  it('foreign references alone are not a fault', () => {
    // A texture outside the Daz library cannot be made portable; it is reported
    // by the repath flow, but it does not stop the project working.
    expect(
      validateHoudiniProject(
        scanned({ refs: { collapsible: 3, foreign: 5, broken: [], hipRelative: [] } }),
        CHAR,
      ).ok,
    ).toBe(true)
  })
})

describe('the scan store', () => {
  const HIP = `${CHAR}/houdini/Kira.hiplc`

  it('serves a scan back only while the file is unchanged', () => {
    const key = scanCacheKey(HIP, 1000)
    const store = withScanResults(emptyScanStore(), [{ hipPath: HIP, key, project: scanned() }], 'now')

    expect(freshScan(store, HIP, key)?.job).toBe(CHAR)
    // Saved in Houdini since — a new mtime, so the entry no longer applies.
    expect(freshScan(store, HIP, scanCacheKey(HIP, 2000))).toBeNull()
  })

  it('a MOVED export root invalidates the entry, though the .hip never changed', () => {
    // The export-root move relocated every file the import paths name, and no
    // `.hip` at all. On path+mtime alone the store answered "all resolve" for
    // exactly the projects it had just broken — a scan's verdict is about the
    // file AND its surroundings, so the surroundings are in the key.
    const oldRoot = `${CHAR}/daz3d/dth-exports`
    const key = scanCacheKey(HIP, 1000, oldRoot)
    const store = withScanResults(emptyScanStore(), [{ hipPath: HIP, key, project: scanned() }], 'now')

    expect(freshScan(store, HIP, key)).not.toBeNull()
    expect(freshScan(store, HIP, scanCacheKey(HIP, 1000, `${CHAR}/houdini/daz-export`))).toBeNull()
    // Normalised like every other path lookup — separators and case.
    expect(
      freshScan(store, HIP, scanCacheKey(HIP, 1000, `${CHAR}\\daz3d\\DTH-Exports`)),
    ).not.toBeNull()
  })

  it('a NEWER installed HDA invalidates the entry, though the .hip never changed', () => {
    // The bug this pins, measured 2026-08-10: a scan's `prefill.missing` says
    // "your DazToHue version has no pose_asset_csv_file_path", which was true
    // when it ran and stopped being true the moment a DazToHuePoseAsset.hda
    // carrying that parm landed in `otls/`. Neither the `.hip` nor the export
    // root changed, so the store kept serving the obsolete verdict — and the
    // drawer's Rescan reads through this same cache, so the UI had no way out.
    const before = hdaLibraryKey([{ name: 'DazToHue.hda', mtimeMs: 1000, size: 5604603 }])
    const after = hdaLibraryKey([
      { name: 'DazToHue.hda', mtimeMs: 1000, size: 5604603 },
      { name: 'DazToHuePoseAsset.hda', mtimeMs: 2000, size: 460423 },
    ])
    const key = scanCacheKey(HIP, 1000, '', before)
    const store = withScanResults(emptyScanStore(), [{ hipPath: HIP, key, project: scanned() }], 'now')

    expect(freshScan(store, HIP, key)).not.toBeNull()
    expect(freshScan(store, HIP, scanCacheKey(HIP, 1000, '', after))).toBeNull()
  })

  it('a library REPLACED in place invalidates too — same name, new bytes', () => {
    // The other half of the same install: mrpdean ships a new DazToHue.hda over
    // the old one. Name-only would call that unchanged.
    const before = hdaLibraryKey([{ name: 'DazToHue.hda', mtimeMs: 1000, size: 10 }])
    const key = scanCacheKey(HIP, 1000, '', before)
    const store = withScanResults(emptyScanStore(), [{ hipPath: HIP, key, project: scanned() }], 'now')

    const newMtime = hdaLibraryKey([{ name: 'DazToHue.hda', mtimeMs: 2000, size: 10 }])
    const newSize = hdaLibraryKey([{ name: 'DazToHue.hda', mtimeMs: 1000, size: 11 }])
    expect(freshScan(store, HIP, scanCacheKey(HIP, 1000, '', newMtime))).toBeNull()
    expect(freshScan(store, HIP, scanCacheKey(HIP, 1000, '', newSize))).toBeNull()
  })

  it('the HDA fingerprint ignores directory order and name case, nothing else', () => {
    const a = { name: 'DazToHue.hda', mtimeMs: 1, size: 2 }
    const b = { name: 'DazToHuePoseAsset.hda', mtimeMs: 3, size: 4 }
    expect(hdaLibraryKey([a, b])).toBe(hdaLibraryKey([b, a]))
    expect(hdaLibraryKey([{ ...a, name: 'DAZTOHUE.HDA' }])).toBe(hdaLibraryKey([a]))
    // An unreadable stat is a value, not a wildcard: it must not match a read one.
    expect(hdaLibraryKey([{ name: a.name }])).not.toBe(hdaLibraryKey([a]))
    // No libraries at all (or none readable) is the '' key — which is exactly
    // what the impure half falls back to, so a blind scan stays invalidatable.
    expect(hdaLibraryKey([])).toBe('')
  })

  it('matches a path by separator and case, like every other lookup', () => {
    const key = scanCacheKey(HIP, 1000)
    const store = withScanResults(emptyScanStore(), [{ hipPath: HIP, key, project: scanned() }], 'now')
    expect(freshScan(store, 'D:\\proj\\Kira\\houdini\\KIRA.hiplc', scanCacheKey(HIP, 1000))).not.toBeNull()
  })

  it('never stores an entry for a file it could not stat', () => {
    // No mtime = no key = an entry nothing could ever match OR invalidate.
    const store = withScanResults(
      emptyScanStore(),
      [{ hipPath: HIP, key: scanCacheKey(HIP, undefined), project: scanned() }],
      'now',
    )
    expect(store.projects).toEqual({})
  })

  it('replaces one project and leaves the others', () => {
    const other = `${CHAR}/houdini/Kira_Look.hiplc`
    let store = withScanResults(
      emptyScanStore(),
      [
        { hipPath: HIP, key: scanCacheKey(HIP, 1), project: scanned() },
        { hipPath: other, key: scanCacheKey(other, 1), project: scanned({ hipPath: other }) },
      ],
      'now',
    )
    store = withScanResults(
      store,
      [{ hipPath: HIP, key: scanCacheKey(HIP, 2), project: scanned({ job: 'changed' }) }],
      'later',
    )
    expect(freshScan(store, HIP, scanCacheKey(HIP, 2))?.job).toBe('changed')
    expect(freshScan(store, other, scanCacheKey(other, 1))).not.toBeNull()
  })

  it('prunes projects that left the character, but only when asked', () => {
    const gone = `${CHAR}/houdini/Old.hiplc`
    const store = withScanResults(
      emptyScanStore(),
      [
        { hipPath: HIP, key: scanCacheKey(HIP, 1), project: scanned() },
        { hipPath: gone, key: scanCacheKey(gone, 1), project: scanned({ hipPath: gone }) },
      ],
      'now',
    )
    // The character store prunes: an unlinked project shouldn't be cached forever.
    const pruned = withScanResults(store, [], 'now', [HIP])
    expect(Object.keys(pruned.projects)).toEqual([HIP.toLowerCase()])
    // The SOURCE store doesn't: a template stays cached across the characters
    // it is copied into, which is the whole reason it is a separate store.
    expect(Object.keys(withScanResults(store, [], 'now').projects)).toHaveLength(2)
  })
})
