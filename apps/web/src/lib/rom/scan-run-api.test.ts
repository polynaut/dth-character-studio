import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The headless-scan handoff, through the real api: what `startSceneScan` puts on
// disk before Daz opens, and what the poll makes of each state of the result
// file. The Daz half cannot run here — this pins the studio's half of it.

const files = new Map<string, string>()
const dirs = new Set<string>()
/** Per-file mtime in ms. Absent = 0, which the poll's freshness guard reads as
 *  "unknown" — every test that doesn't care about mtimes is unaffected. */
const mtimes = new Map<string, number>()
let dazRunning = false
const launches: Array<string> = []

function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/g, '')
}
function addDir(p: string): void {
  let path = norm(p)
  while (path && path !== '/') {
    dirs.add(path)
    const idx = path.lastIndexOf('/')
    path = idx > 0 ? path.slice(0, idx) : ''
  }
}

vi.mock('@tauri-apps/api/path', () => ({
  appLocalDataDir: async () => '/appdata',
  sep: () => '/',
}))
vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '0.0.0' }))
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  convertFileSrc: (p: string) => p,
  invoke: async (cmd: string) => {
    if (cmd === 'daz_studio_running') return dazRunning
    if (cmd === 'launch_daz_studio') {
      launches.push(cmd)
      return ''
    }
    return null
  },
}))
vi.mock('@tauri-apps/plugin-fs', () => ({
  async exists(p: string) {
    const t = norm(p).toLowerCase()
    for (const k of files.keys()) if (k.toLowerCase() === t) return true
    for (const k of dirs) if (k.toLowerCase() === t) return true
    return false
  },
  async remove(p: string) {
    files.delete(norm(p))
    dirs.delete(norm(p))
  },
  async mkdir(p: string) {
    addDir(p)
  },
  async readTextFile(p: string) {
    const v = files.get(norm(p))
    if (v == null) throw new Error(`ENOENT ${p}`)
    return v
  },
  async writeTextFile(p: string, c: string) {
    files.set(norm(p), c)
  },
  async rename(a: string, b: string) {
    const v = files.get(norm(a))
    if (v != null) {
      files.set(norm(b), v)
      files.delete(norm(a))
    }
  },
  async stat(p: string) {
    const ms = mtimes.get(norm(p)) ?? 0
    return { isDirectory: false, isFile: true, mtime: new Date(ms), birthtime: new Date(ms) }
  },
  async readDir() {
    return []
  },
}))

import { abortSceneScan, fetchSceneScanProgress, startSceneScan } from './api/execute'

const LIB = '/daz/My DAZ 3D Library'
const SCRIPTS = `${LIB}/Scripts/DTH-Character-Studio`
const PENDING = `${SCRIPTS}/dth_exporter_jobs.json`
const RUNNING = `${SCRIPTS}/running_dth_exporter_jobs.json`
const SCENE = 'D:/scenes/Kira_G9.duf'
const OUT = '/appdata/scan-frames'
const CSV = `${OUT}/Kira_G9.csv`
const RESULT = `${OUT}/Kira_G9.scan.json`

beforeEach(() => {
  files.clear()
  dirs.clear()
  mtimes.clear()
  launches.length = 0
  dazRunning = false
  addDir('/appdata')
  files.set('/appdata/settings.json', JSON.stringify({ dazLibraryFolder: LIB }))
  // The installed runtime the per-run script includes — its absence is its own
  // refusal (see the last test).
  files.set(`${SCRIPTS}/.DthUtils.dsa`, 'runtime')
})

describe('startSceneScan', () => {
  it('writes the per-run script beside the runtime it includes', async () => {
    const started = await startSceneScan({ data: { scenePath: SCENE, genesis: 'G9' } })

    const script = files.get(`${SCRIPTS}/.dth_scan_run.dsa`)
    expect(script).toBeDefined()
    // Silent, carrying the generation the run selects the figure by, and
    // pointing at the result the poll below reads.
    expect(script).toContain('silent: true')
    expect(script).toContain('genesis: "G9"')
    expect(script).toContain(RESULT)
    expect(started).toMatchObject({ csvPath: CSV, resultPath: RESULT })
  })

  it('hands the runner the scene AND that script, and starts a closed Daz', async () => {
    await startSceneScan({ data: { scenePath: SCENE, genesis: 'G9' } })

    const job = [...files.entries()].find(([path]) => path.endsWith('.json') && path.includes('job'))
    expect(job?.[1]).toContain(SCENE)
    expect(job?.[1]).toContain('.dth_scan_run.dsa')
    expect(launches).toHaveLength(1)
  })

  it('deletes a previous RESULT — but keeps the CSV it belongs to', async () => {
    // The poll terminates on "the result appeared". A leftover from last time
    // would be read instantly and the dialog would call the new scan finished
    // before Daz had opened anything — so the result has to go.
    files.set(RESULT, '{"ok":true,"csvPath":"' + CSV + '","frames":9}')
    files.set(CSV, 'old,scan')

    await startSceneScan({ data: { scenePath: SCENE, genesis: 'G9' } })

    expect(files.has(RESULT)).toBe(false)
    // The CSV is a working import until a new one replaces it. Deleting it up
    // front would mean a scan that fails (wrong figure, Daz never opened) costs
    // the user the scan they already had — for nothing: the poll's `startedAtMs`
    // guard already refuses to read an old file as this run's.
    expect(files.get(CSV)).toBe('old,scan')
  })

  it('refuses while another batch owns the handoff', async () => {
    await startSceneScan({ data: { scenePath: SCENE, genesis: 'G9' } })
    // The job file this run just wrote is still pending — a second start must
    // not clobber it.
    await expect(startSceneScan({ data: { scenePath: SCENE, genesis: 'G9' } })).rejects.toThrow(
      /waiting for Daz Studio/,
    )
  })

  it('refuses when the runtime is not installed, instead of writing a script that cannot run', async () => {
    files.delete(`${SCRIPTS}/.DthUtils.dsa`)
    await expect(startSceneScan({ data: { scenePath: SCENE, genesis: 'G9' } })).rejects.toThrow(
      /runtime is not installed/,
    )
  })
})

describe('startSceneScan — the claim-wait on a Daz that is already up', () => {
  // Every other handoff writer waits for the Runner to RENAME the job file (the
  // rename is the claim) and takes it back when the rename never comes. Without
  // it a Daz running without the Runner plugin — the one requirement of this
  // feature nothing else can check — leaves the global job file pending
  // forever, and every later export and scan refuses with "a batch is waiting".
  beforeEach(() => {
    dazRunning = true
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns as soon as the Runner claims the batch, without launching Daz', async () => {
    const started = startSceneScan({ data: { scenePath: SCENE, genesis: 'G9' } })
    // The Runner renames the file one poll tick in.
    await vi.advanceTimersByTimeAsync(400)
    files.delete(PENDING)
    await vi.advanceTimersByTimeAsync(400)

    await expect(started).resolves.toMatchObject({ resultPath: RESULT, dazWasRunning: true })
    expect(launches).toHaveLength(0)
  })

  it('takes the handoff BACK when nobody claims it, and says why', async () => {
    const started = startSceneScan({ data: { scenePath: SCENE, genesis: 'G9' } })
    const rejects = expect(started).rejects.toThrow(/never picked the scan up/)
    await vi.advanceTimersByTimeAsync(11_000)
    await rejects
    // The whole point: no stranded job file blocking the next export or scan.
    expect(files.has(PENDING)).toBe(false)
  })
})

describe('abortSceneScan', () => {
  it('takes back a scan of ours that is still pending', async () => {
    await startSceneScan({ data: { scenePath: SCENE, genesis: 'G9' } })
    expect(files.has(PENDING)).toBe(true)

    await abortSceneScan()

    expect(files.has(PENDING)).toBe(false)
  })

  it("leaves somebody else's batch alone — taking it would strand that run", async () => {
    files.set(
      PENDING,
      JSON.stringify({
        version: 1,
        type: 'bulk-export',
        progress: 0,
        jobs: [{ scenePath: SCENE, scriptPath: `${SCRIPTS}/Kira/DTH_Export.dsa`, status: 'pending' }],
      }),
    )

    await abortSceneScan()

    expect(files.has(PENDING)).toBe(true)
  })

  it('leaves a CLAIMED scan alone — the rename means Daz is running it', async () => {
    await startSceneScan({ data: { scenePath: SCENE, genesis: 'G9' } })
    const claimed = files.get(PENDING)!
    files.delete(PENDING)
    files.set(RUNNING, claimed)

    await abortSceneScan()

    expect(files.get(RUNNING)).toBe(claimed)
  })

  it('is a no-op when there is nothing pending', async () => {
    await expect(abortSceneScan()).resolves.toBeUndefined()
  })
})

describe('fetchSceneScanProgress', () => {
  const poll = () => fetchSceneScanProgress({ data: { resultPath: RESULT } })

  it('is RUNNING while no result exists yet', async () => {
    expect((await poll()).state).toBe('running')
  })

  it('is RUNNING on a torn read — never a failure', async () => {
    // Daz writes this file while the studio is polling it.
    files.set(RESULT, '{"ok":tr')
    expect((await poll()).state).toBe('running')
  })

  it('reports the scan-side reason for a failure', async () => {
    files.set(RESULT, '{"ok":false,"error":"No keyed morph frames in this scene."}')
    const progress = await poll()
    expect(progress.state).toBe('failed')
    expect(progress.error).toContain('No keyed morph frames')
  })

  it('clears the finished job file the Runner left behind', async () => {
    // Measured on the first live run: the Runner renames the job file to
    // `running_…` and marks it done, and the EXPORT flow's watch is what
    // normally deletes it. A scan has no watch, so a finished file sat in the
    // user's scripts folder until the next scan swept it.
    const running = '/daz/My DAZ 3D Library/Scripts/DTH-Character-Studio/running_dth_exporter_jobs.json'
    files.set(running, JSON.stringify({ version: 1, progress: 100, jobs: [] }))
    files.set(RESULT, `{"ok":true,"csvPath":"${CSV}","frames":51}`)
    files.set(CSV, 'rows')

    expect((await poll()).state).toBe('done')
    expect(files.has(running)).toBe(false)
  })

  it('leaves a LIVE batch of somebody else alone — that file belongs to it', async () => {
    const running = '/daz/My DAZ 3D Library/Scripts/DTH-Character-Studio/running_dth_exporter_jobs.json'
    files.set(running, JSON.stringify({ version: 1, progress: 40, jobs: [] }))
    files.set(RESULT, '{"ok":false,"error":"nope"}')

    expect((await poll()).state).toBe('failed')
    expect(files.has(running)).toBe(true)
  })

  it('is DONE only when the CSV is actually there', async () => {
    files.set(RESULT, `{"ok":true,"csvPath":"${CSV}","frames":51}`)
    // The result says the script believed it wrote one; the import needs the file.
    expect((await poll()).state).toBe('failed')

    files.set(CSV, '188,,,Genesis9,FBMBodyTone,1')
    expect(await poll()).toEqual({ state: 'done', csvPath: CSV, frames: 51, error: '' })
  })

  describe('the startedAtMs freshness guard', () => {
    // What replaces deleting the old CSV up front: a `printCSV` that fails
    // silently (locked file, full disk) still reports ok, and the PREVIOUS
    // scan's file is sitting at exactly that path. Importing it would be the
    // worst outcome available — stale frames, reported as success.
    const pollAt = (startedAtMs: number) =>
      fetchSceneScanProgress({ data: { resultPath: RESULT, startedAtMs } })

    beforeEach(() => {
      files.set(RESULT, `{"ok":true,"csvPath":"${CSV}","frames":51}`)
      files.set(CSV, 'old,scan')
    })

    it('refuses a CSV that predates the run', async () => {
      mtimes.set(CSV, 1_000_000)
      const progress = await pollAt(2_000_000)
      expect(progress.state).toBe('failed')
      expect(progress.error).toMatch(/left the previous CSV in place/)
    })

    it('accepts one written by the run', async () => {
      mtimes.set(CSV, 2_000_500)
      expect((await pollAt(2_000_000)).state).toBe('done')
    })

    it('allows a coarse-timestamp filesystem a couple of seconds of slack', async () => {
      // FAT/exFAT round mtimes to 2s, so a file written right after the clock
      // reading can land just before it. A scan takes far longer than that.
      mtimes.set(CSV, 2_000_000 - 1_500)
      expect((await pollAt(2_000_000)).state).toBe('done')
    })

    it('is skipped entirely when no start time was given', async () => {
      mtimes.set(CSV, 1_000)
      expect((await pollAt(0)).state).toBe('done')
    })
  })
})
