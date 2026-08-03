import { beforeEach, describe, expect, it, vi } from 'vitest'

// The claimed-but-never-run rescue, end to end (docs/exporter-plugin-job-file.md
// "Reclaiming"): a CLOSING Daz can claim the batch — rename it `running_` — on a
// final poll tick and exit before running a row, and the Runner only ever polls
// for the PENDING name, so that file is orphaned unless the studio takes it
// back. Two pollers see the state and must converge on ONE decision:
//
//  - `launchDazForPendingJobs` (the wait-for-close modal's finish) OWNS the
//    reclaim — one atomic rename back to pending, then start Daz.
//  - the export watch (`fetchExportRunProgress`) only DETECTS it: an untouched
//    batch whose Daz is gone reads 'pending', never 'dead' — deleting there
//    used to race the modal's tick and strand the very batch this rescues, and
//    a 'dead' report disarmed the run and dropped its finish toast + the
//    "Export too" continuation.

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
  async remove(p: string, opts?: { recursive?: boolean }) {
    const t = norm(p).toLowerCase()
    for (const k of [...files.keys()]) {
      const lower = k.toLowerCase()
      if (lower === t || (opts?.recursive && lower.startsWith(`${t}/`))) files.delete(k)
    }
    for (const k of [...dirs]) {
      const lower = k.toLowerCase()
      if (lower === t || (opts?.recursive && lower.startsWith(`${t}/`))) dirs.delete(k)
    }
  },
  async mkdir(p: string) {
    addDir(p)
  },
  async readTextFile(p: string) {
    p = norm(p)
    const v = files.get(p)
    if (v == null) throw new Error(`ENOENT ${p}`)
    return v
  },
  async writeTextFile(p: string, c: string) {
    files.set(norm(p), c)
  },
  async rename(a: string, b: string) {
    a = norm(a)
    b = norm(b)
    const remap = (k: string) => b + k.slice(a.length)
    for (const k of [...files.keys()]) {
      if (k === a || k.startsWith(`${a}/`)) {
        files.set(remap(k), files.get(k)!)
        files.delete(k)
      }
    }
    for (const k of [...dirs]) {
      if (k === a || k.startsWith(`${a}/`)) {
        dirs.delete(k)
        dirs.add(remap(k))
      }
    }
  },
  async stat(p: string) {
    p = norm(p)
    if (files.has(p)) {
      return {
        isDirectory: false,
        isFile: true,
        mtime: new Date(1000),
        birthtime: new Date(1000),
        size: files.get(p)!.length,
      }
    }
    if (dirs.has(p)) {
      return { isDirectory: true, isFile: false, mtime: new Date(0), birthtime: new Date(0), size: 0 }
    }
    throw new Error(`ENOENT ${p}`)
  },
  async readDir(p: string) {
    p = norm(p)
    if (!dirs.has(p)) throw new Error(`ENOTDIR ${p}`)
    const prefix = `${p}/`
    const out = new Map<string, { name: string; isFile: boolean; isDirectory: boolean }>()
    for (const k of files.keys()) {
      if (!k.startsWith(prefix)) continue
      const rest = k.slice(prefix.length)
      const name = rest.split('/')[0]
      const isFile = !rest.includes('/')
      if (!out.has(name)) out.set(name, { name, isFile, isDirectory: !isFile })
    }
    for (const k of dirs) {
      if (!k.startsWith(prefix)) continue
      const name = k.slice(prefix.length).split('/')[0]
      if (!out.has(name)) out.set(name, { name, isFile: false, isDirectory: true })
    }
    return [...out.values()]
  },
}))

import { CHARACTER_SCHEMA_VERSION, characterSchema, defaultSections } from '@dth/rom'
import * as storage from './storage'
import {
  dismissExportRun,
  executeCharacterJobs,
  exporterJobsWorking,
  fetchExportRunProgress,
  launchDazForPendingJobs,
} from './api/execute'
import { EXPORTER_JOB_FILE, RUNNING_JOB_FILE, jobFileJson } from './execute-jobs'

const PROJECT = '/games/P'
const SCENE = `${PROJECT}/Ita/daz3d/Ita.duf`
const SCRIPTS_ROOT = '/daz/Scripts/DTH-Character-Studio'
const SCRIPT = `${SCRIPTS_ROOT}/P/Ita/.Bulk_ROM_Export.dsa`
const PENDING = `${SCRIPTS_ROOT}/${EXPORTER_JOB_FILE}`
const RUNNING = `${SCRIPTS_ROOT}/${RUNNING_JOB_FILE}`

/** An untouched claimed batch — exactly what a closing Daz leaves behind. */
function seedClaimedUntouched(): string {
  const body = jobFileJson([{ scenePath: SCENE, scriptPath: SCRIPT }])
  files.set(RUNNING, body)
  return body
}

/** A claimed batch the Runner already worked a row of. */
function seedClaimedWorked(): void {
  files.set(
    RUNNING,
    JSON.stringify({
      version: 1,
      type: 'bulk-export',
      progress: 50,
      jobsDone: 1,
      jobs: [{ scenePath: SCENE, scriptPath: SCRIPT, status: 'done' }],
    }),
  )
}

beforeEach(() => {
  files.clear()
  dirs.clear()
  launches.length = 0
  dazRunning = false
  dismissExportRun()
  files.set('/appdata/settings.json', JSON.stringify({ dazLibraryFolder: '/daz' }))
})

/** Seed the project + character + scene + generated script, hand the batch off
 *  (arming the export watch), then claim it the way the Runner does — ONE
 *  rename of the pending file. Leaves the batch claimed-but-untouched. */
async function armClaimedRun(): Promise<void> {
  await storage.createProjectManifest(PROJECT, 'P')
  const character = characterSchema.parse({
    id: 'c1',
    name: 'Ita',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    sections: defaultSections(),
    scenePath: SCENE,
    exportPath: '/exports',
  })
  addDir(`${PROJECT}/Ita`)
  files.set(
    `${PROJECT}/Ita/Ita.json`,
    JSON.stringify({ ...character, schemaVersion: CHARACTER_SCHEMA_VERSION }),
  )
  files.set(SCENE, 'DUF')
  files.set(SCRIPT, 'SCRIPT')
  // Daz not running → the handoff launches it and returns without the pickup
  // wait; the in-memory watch (activeRun) is armed for this character.
  await executeCharacterJobs({
    data: { projectId: PROJECT, id: 'c1', scenes: [SCENE], mode: 'rom-export' },
  })
  expect(files.has(PENDING)).toBe(true)
  files.set(RUNNING, files.get(PENDING)!)
  files.delete(PENDING)
  launches.length = 0
}

describe('launchDazForPendingJobs — the reclaim owner', () => {
  it('starts Daz for a still-pending handoff', async () => {
    files.set(PENDING, jobFileJson([{ scenePath: SCENE, scriptPath: SCRIPT }]))
    await expect(launchDazForPendingJobs()).resolves.toBe(true)
    expect(launches).toHaveLength(1)
  })

  it('a Daz already running again (user-restarted) is success without a launch', async () => {
    files.set(PENDING, jobFileJson([{ scenePath: SCENE, scriptPath: SCRIPT }]))
    dazRunning = true
    await expect(launchDazForPendingJobs()).resolves.toBe(true)
    expect(launches).toHaveLength(0)
  })

  it('reclaims an untouched claimed batch: ONE atomic rename, bytes intact, Daz started', async () => {
    const body = seedClaimedUntouched()
    await expect(launchDazForPendingJobs()).resolves.toBe(true)
    // The rename outcome: the pending file IS the claimed file, byte for byte
    // (no re-serialization), and the running_ orphan is gone.
    expect(files.get(PENDING)).toBe(body)
    expect(files.has(RUNNING)).toBe(false)
    expect(launches).toHaveLength(1)
  })

  it('refuses a batch that already ran a row — that is a dead run, not a reclaim', async () => {
    seedClaimedWorked()
    await expect(launchDazForPendingJobs()).resolves.toBe(false)
    expect(files.has(RUNNING)).toBe(true) // left for the watch's dead-run report
    expect(files.has(PENDING)).toBe(false)
    expect(launches).toHaveLength(0)
  })

  it('refuses an orphaned open-scene handoff — not an export to requeue', async () => {
    files.set(
      RUNNING,
      JSON.stringify({
        version: 1,
        type: 'open-scene',
        progress: 0,
        jobs: [{ scenePath: SCENE, scriptPath: '', status: 'pending' }],
      }),
    )
    await expect(launchDazForPendingJobs()).resolves.toBe(false)
    expect(files.has(RUNNING)).toBe(true)
    expect(launches).toHaveLength(0)
  })

  it('nothing pending, nothing claimed → nothing to do', async () => {
    await expect(launchDazForPendingJobs()).resolves.toBe(false)
    expect(launches).toHaveLength(0)
  })
})

describe('fetchExportRunProgress — detects the reclaimable state, defers to the reclaim', () => {
  it("an untouched claimed batch whose Daz is gone reads 'pending', not 'dead' — file untouched", async () => {
    await armClaimedRun()
    await expect(fetchExportRunProgress()).resolves.toEqual({
      state: 'pending',
      characterId: 'c1',
      total: 1,
    })
    // The watch touched NOTHING: the file is still there for the reclaim, and
    // the run stays armed (a second poll reads the same, not null/dead).
    expect(files.has(RUNNING)).toBe(true)
    await expect(fetchExportRunProgress()).resolves.toMatchObject({ state: 'pending' })
    // …and the reclaim still works after the watch's tick — the two pollers
    // converge instead of racing (the modal's launch restores the pending
    // file, which the armed watch then reports as the ordinary pending state).
    await expect(launchDazForPendingJobs()).resolves.toBe(true)
    expect(files.has(PENDING)).toBe(true)
    await expect(fetchExportRunProgress()).resolves.toEqual({
      state: 'pending',
      characterId: 'c1',
      total: 1,
    })
  })

  it("a claimed batch with Daz still up (the lingering process) reads 'running'", async () => {
    await armClaimedRun()
    dazRunning = true
    await expect(fetchExportRunProgress()).resolves.toMatchObject({
      state: 'running',
      characterId: 'c1',
      progress: 0,
      processed: 0,
    })
    expect(files.has(RUNNING)).toBe(true)
  })

  it("a WORKED batch whose Daz is gone is still a dead run: cleaned up, reported once", async () => {
    await armClaimedRun()
    seedClaimedWorked()
    await expect(fetchExportRunProgress()).resolves.toEqual({
      state: 'dead',
      characterId: 'c1',
      total: 1,
    })
    expect(files.has(RUNNING)).toBe(false)
    // Reported once: the run is disarmed, the next poll has nothing to show.
    await expect(fetchExportRunProgress()).resolves.toBeNull()
  })
})

describe("exporterJobsWorking — the wait-for-close modal's stand-down probe", () => {
  it('false without a claimed batch', async () => {
    await expect(exporterJobsWorking()).resolves.toBe(false)
  })

  it('false for a claimed-but-untouched batch (indistinguishable from the closing claim)', async () => {
    seedClaimedUntouched()
    await expect(exporterJobsWorking()).resolves.toBe(false)
  })

  it('true once the batch shows real work — the export watch owns it now', async () => {
    seedClaimedWorked()
    await expect(exporterJobsWorking()).resolves.toBe(true)
  })

  it('false on a torn read — keep waiting, the next tick parses clean', async () => {
    files.set(RUNNING, '{"version":1,"type":"bulk-export","progr')
    await expect(exporterJobsWorking()).resolves.toBe(false)
  })
})
