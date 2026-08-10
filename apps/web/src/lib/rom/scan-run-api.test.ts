import { beforeEach, describe, expect, it, vi } from 'vitest'

// The headless-scan handoff, through the real api: what `startSceneScan` puts on
// disk before Daz opens, and what the poll makes of each state of the result
// file. The Daz half cannot run here — this pins the studio's half of it.

const files = new Map<string, string>()
const dirs = new Set<string>()
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
  async stat() {
    return { isDirectory: false, isFile: true, mtime: new Date(1000), birthtime: new Date(1000) }
  },
  async readDir() {
    return []
  },
}))

import { fetchSceneScanProgress, startSceneScan } from './api/execute'

const LIB = '/daz/My DAZ 3D Library'
const SCRIPTS = `${LIB}/Scripts/DTH-Character-Studio`
const SCENE = 'D:/scenes/Kira_G9.duf'
const OUT = '/appdata/scan-frames'
const CSV = `${OUT}/Kira_G9.csv`
const RESULT = `${OUT}/Kira_G9.scan.json`

beforeEach(() => {
  files.clear()
  dirs.clear()
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

  it('DELETES a previous scan of the same scene before starting', async () => {
    // The poll terminates on "the result appeared". A leftover from last time
    // would be read instantly, with a stale CSV behind it, and the dialog would
    // call the new scan finished before Daz had opened anything.
    files.set(RESULT, '{"ok":true,"csvPath":"' + CSV + '","frames":9}')
    files.set(CSV, 'old,scan')

    await startSceneScan({ data: { scenePath: SCENE, genesis: 'G9' } })

    expect(files.has(RESULT)).toBe(false)
    expect(files.has(CSV)).toBe(false)
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

  it('is DONE only when the CSV is actually there', async () => {
    files.set(RESULT, `{"ok":true,"csvPath":"${CSV}","frames":51}`)
    // The result says the script believed it wrote one; the import needs the file.
    expect((await poll()).state).toBe('failed')

    files.set(CSV, '188,,,Genesis9,FBMBodyTone,1')
    expect(await poll()).toEqual({ state: 'done', csvPath: CSV, frames: 51, error: '' })
  })
})
