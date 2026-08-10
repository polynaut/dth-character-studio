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
/** Every `installFolder` a `daz_studio_running` call asked about, in order. */
const dazRunningAsked: Array<string> = []
/** Lower-cased paths whose `remove` fails, as a file locked by Daz would. */
const lockedForRemove = new Set<string>()

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
  invoke: async (cmd: string, args?: { installFolder?: string }) => {
    if (cmd === 'daz_studio_running') {
      // WHICH install each caller asks about is the load-bearing part (see
      // DazRunningScope) — record it so a test can assert the scope, not just
      // the answer.
      dazRunningAsked.push(args?.installFolder ?? '')
      return dazRunning
    }
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
    // A locked file (open in Daz) is the failure this action actually meets.
    if (lockedForRemove.has(t)) throw new Error(`EBUSY ${p}`)
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
  clearExporterJobFiles,
  dismissExportRun,
  executeCharacterJobs,
  ExporterJobFilesChangedError,
  exporterJobFilesSignature,
  exporterJobsWorking,
  fetchExportRunProgress,
  fetchExporterJobFiles,
  launchDazForPendingJobs,
} from './api/execute'
import { EXPORTER_JOB_FILE, RUNNING_JOB_FILE, jobFileJson } from './execute-jobs'

const PROJECT = '/games/P'
const SCENE = `${PROJECT}/Ita/daz3d/Ita.duf`
const SCRIPTS_ROOT = '/daz/Scripts/DTH-Character-Studio'
const SCRIPT = `${SCRIPTS_ROOT}/P/Ita/.Bulk_ROM_Export.dsa`
const PENDING = `${SCRIPTS_ROOT}/${EXPORTER_JOB_FILE}`
const RUNNING = `${SCRIPTS_ROOT}/${RUNNING_JOB_FILE}`
const DS4 = 'C:/Program Files/DAZ 3D/DAZStudio4'
const DS6 = 'C:/Program Files/DAZ 3D/DAZStudio6'

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
  dazRunningAsked.length = 0
  lockedForRemove.clear()
  dazRunning = false
  dismissExportRun()
  files.set('/appdata/settings.json', JSON.stringify({ dazLibraryFolder: '/daz' }))
})

/** Settings naming a DIFFERENT installation for export batches than the active
 *  one — the "Export only" arrangement, and the only shape in which the two
 *  scopes are distinguishable at all. */
function seedExportOnlyInstall(): void {
  files.set(
    '/appdata/settings.json',
    JSON.stringify({
      dazLibraryFolder: '/daz',
      dazInstallKey: 'dzstudio6installdir-64',
      dazInstallFolder: DS6,
      dazExportInstallKey: 'dzstudio4installdir-64',
      dazExportInstallFolder: DS4,
    }),
  )
}

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

// The split `DazRunningScope` documents, made checkable. It is the whole point
// of the install-aware probe, and it is invisible in every other test here
// because the two scopes only differ when "Export only" names a DIFFERENT
// installation from the active one. Getting one of these backwards is silent:
// a launch decision scoped to 'any' is the original bug (an open DS6 answers
// for the DS4 the batch needs, so nothing starts), and a destructive reader
// scoped to 'export' deletes a live batch whenever the configured folder and
// the running exe's path disagree.
describe('WHICH Daz each caller asks about', () => {
  it('a LAUNCH decision asks about the export installation', async () => {
    seedExportOnlyInstall()
    files.set(PENDING, jobFileJson([{ scenePath: SCENE, scriptPath: SCRIPT }]))

    await launchDazForPendingJobs()

    expect(dazRunningAsked).toEqual([DS4])
  })

  it('the DEAD-RUN cleanup asks about ANY Daz — it is about to delete a file', async () => {
    seedExportOnlyInstall()
    await armClaimedRun()
    dazRunningAsked.length = 0
    // A claimed batch with Daz gone is the state that reads as a dead run.
    await fetchExportRunProgress()

    // '' is "any Daz". Scoped to the export install, a stale/moved folder would
    // read as "gone" and this path would bin somebody's live batch.
    expect(dazRunningAsked).toEqual([''])
  })

  it("the stale-`running_` overwrite asks about ANY Daz for the same reason", async () => {
    seedExportOnlyInstall()
    await armClaimedRun()
    // Somebody else's claimed, part-worked batch is in the way of a new handoff.
    seedClaimedWorked()
    dazRunning = true
    dazRunningAsked.length = 0

    await expect(
      executeCharacterJobs({
        data: { projectId: PROJECT, id: 'c1', scenes: [SCENE], mode: 'rom-export' },
      }),
    ).rejects.toThrow(/working through a batch/)

    expect(dazRunningAsked).toEqual([''])
  })
})

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

// The other end of the same story: when NO rescue applies — the batch was never
// claimed, or was claimed by a Daz that is long gone and no character owns it
// anymore — the file just sits there, and every later export AND scan refuses
// over it. Settings → App Data is the escape hatch, so it has to be able to say
// what is there and take it away.
describe('fetchExporterJobFiles — what is actually lying in the scripts root', () => {
  it('nothing on disk → nothing to report', async () => {
    await expect(fetchExporterJobFiles()).resolves.toEqual([])
  })

  it('reports the PENDING file by name, with its rows and an age', async () => {
    files.set(PENDING, jobFileJson([{ scenePath: SCENE, scriptPath: SCRIPT }]))
    const [file, ...rest] = await fetchExporterJobFiles()
    expect(rest).toEqual([])
    expect(file).toMatchObject({
      kind: 'pending',
      fileName: EXPORTER_JOB_FILE,
      path: PENDING,
      jobs: 1,
      progress: 0,
      type: 'bulk-export',
      // Never claimed: clearing it can't strand anything.
      mayBeLive: false,
    })
    expect(file?.ageMs).toBeGreaterThan(0)
  })

  it('reports a claimed file as claimed — and a part-worked one as maybe LIVE', async () => {
    seedClaimedWorked()
    await expect(fetchExporterJobFiles()).resolves.toMatchObject([
      { kind: 'running', fileName: RUNNING_JOB_FILE, jobs: 1, progress: 50, mayBeLive: true },
    ])
  })

  it('an unreadable file is still reported — that is the state people come here to clear', async () => {
    files.set(RUNNING, '{"version":1,"type":"bulk-exp')
    await expect(fetchExporterJobFiles()).resolves.toMatchObject([
      { kind: 'running', jobs: 0, type: null, mayBeLive: true },
    ])
  })

  it('reports BOTH names when both exist — no readout that hides one of them', async () => {
    files.set(PENDING, jobFileJson([{ scenePath: SCENE, scriptPath: SCRIPT }]))
    seedClaimedWorked()
    const found = await fetchExporterJobFiles()
    expect(found.map((f) => f.kind)).toEqual(['pending', 'running'])
  })
})

describe('clearExporterJobFiles — the manual way out of a stranded handoff', () => {
  it('deletes what is there and names it', async () => {
    files.set(PENDING, jobFileJson([{ scenePath: SCENE, scriptPath: SCRIPT }]))
    seedClaimedWorked()
    await expect(clearExporterJobFiles()).resolves.toEqual([EXPORTER_JOB_FILE, RUNNING_JOB_FILE])
    expect(files.has(PENDING)).toBe(false)
    expect(files.has(RUNNING)).toBe(false)
  })

  it('nothing to delete is not a failure', async () => {
    await expect(clearExporterJobFiles()).resolves.toEqual([])
  })

  it('drops the export watch with the file — no "run died" toast for a deliberate clear', async () => {
    await armClaimedRun()
    // The watch is armed on this character's batch…
    await expect(fetchExportRunProgress()).resolves.toMatchObject({ characterId: 'c1' })
    await expect(clearExporterJobFiles()).resolves.toEqual([RUNNING_JOB_FILE])
    // …and is gone with it, rather than reporting a death the user caused.
    await expect(fetchExportRunProgress()).resolves.toBeNull()
  })

  it('a LOCKED file still lets the other one go, and still drops the watch', async () => {
    // Two separate files: one being locked (open in Daz) is not a reason to
    // leave the other in place — and letting the rejection escape before the
    // watch is dropped would produce the very "run died" toast the deliberate
    // clear exists to avoid.
    await armClaimedRun()
    files.set(PENDING, jobFileJson([{ scenePath: SCENE, scriptPath: SCRIPT }]))
    lockedForRemove.add(RUNNING.toLowerCase())

    await expect(clearExporterJobFiles()).rejects.toThrow(/EBUSY/)

    expect(files.has(PENDING)).toBe(false)
    expect(files.has(RUNNING)).toBe(true)
    // The watch no longer claims THIS character's run. (The locked file is
    // still on disk, so it is still reported — as the unowned batch it now is,
    // which is honest; what must not happen is this character being told its
    // run died because the user cleared it.)
    await expect(fetchExportRunProgress()).resolves.not.toMatchObject({ characterId: 'c1' })
  })
})

describe('clearExporterJobFiles — the confirmation has to still be about this file', () => {
  // The readout is a snapshot (it refreshes on window focus, and nothing else),
  // but the pending → `running_` transition is made by the Runner INSIDE Daz, at
  // any moment. So the user can agree to delete "written, never claimed" — no
  // warning shown — and the file be LIVE by the time they click.
  it('refuses when the file became something else since it was shown', async () => {
    files.set(PENDING, jobFileJson([{ scenePath: SCENE, scriptPath: SCRIPT }]))
    const shown = exporterJobFilesSignature(await fetchExporterJobFiles())

    // The Runner claims it and starts working — exactly the case the amber
    // warning exists for, and the one the stale readout would have hidden.
    files.delete(PENDING)
    seedClaimedWorked()

    await expect(clearExporterJobFiles(shown)).rejects.toThrow(ExporterJobFilesChangedError)
    expect(files.has(RUNNING)).toBe(true)
  })

  it('goes ahead when nothing changed', async () => {
    files.set(PENDING, jobFileJson([{ scenePath: SCENE, scriptPath: SCRIPT }]))
    const shown = exporterJobFilesSignature(await fetchExporterJobFiles())

    await expect(clearExporterJobFiles(shown)).resolves.toEqual([EXPORTER_JOB_FILE])
  })

  it('ignores AGE — it ticks every second and changes no judgement', async () => {
    files.set(PENDING, jobFileJson([{ scenePath: SCENE, scriptPath: SCRIPT }]))
    const before = await fetchExporterJobFiles()
    const later = before.map((f) => ({ ...f, ageMs: f.ageMs + 60_000 }))
    expect(exporterJobFilesSignature(later)).toBe(exporterJobFilesSignature(before))
  })
})
