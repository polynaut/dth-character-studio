import { beforeEach, describe, expect, it, vi } from 'vitest'

// --- In-memory fs mock ----------------------------------------------------
// The project-files.test.ts mock, extended with per-file mtimes + sizes so the
// mtime-based notes conflict detection and the age-based media GC are testable.

const files = new Map<string, { data: string | Uint8Array; mtime: number }>()
const dirs = new Set<string>()
// Monotonic write clock: every write gets a fresh, strictly increasing mtime.
let writeClock = 0
function nextMtime(): number {
  writeClock = Math.max(Date.now(), writeClock + 1)
  return writeClock
}

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
/** Seed a file with explicit content and (optionally) an explicit mtime. */
function setFile(p: string, data: string | Uint8Array, mtime = nextMtime()): void {
  const path = norm(p)
  files.set(path, { data, mtime })
  addDir(path.slice(0, path.lastIndexOf('/')))
}

vi.mock('@tauri-apps/api/path', () => ({ appLocalDataDir: async () => '/appdata' }))
vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '0.0.0' }))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async () => null,
  isTauri: () => false,
  convertFileSrc: (p: string) => p,
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('@tauri-apps/plugin-fs', () => ({
  async exists(p: string) {
    p = norm(p)
    return files.has(p) || dirs.has(p)
  },
  async mkdir(p: string) {
    addDir(p)
  },
  async readTextFile(p: string) {
    p = norm(p)
    const v = files.get(p)
    if (v == null) throw new Error(`ENOENT ${p}`)
    return typeof v.data === 'string' ? v.data : new TextDecoder().decode(v.data)
  },
  async writeTextFile(p: string, c: string) {
    setFile(p, c)
  },
  async readFile(p: string) {
    p = norm(p)
    const v = files.get(p)
    if (v == null) throw new Error(`ENOENT ${p}`)
    return typeof v.data === 'string' ? new TextEncoder().encode(v.data) : v.data
  },
  async writeFile(p: string, b: Uint8Array) {
    setFile(p, b)
  },
  async remove(p: string, opts?: { recursive?: boolean }) {
    p = norm(p)
    files.delete(p)
    dirs.delete(p)
    if (opts?.recursive) {
      for (const k of [...files.keys()]) if (k.startsWith(`${p}/`)) files.delete(k)
      for (const k of [...dirs]) if (k.startsWith(`${p}/`)) dirs.delete(k)
    }
  },
  async stat(p: string) {
    p = norm(p)
    const file = files.get(p)
    if (!file && !dirs.has(p)) throw new Error(`ENOENT ${p}`)
    return {
      isDirectory: dirs.has(p),
      isFile: files.has(p),
      mtime: file ? new Date(file.mtime) : new Date(0),
      birthtime: new Date(0),
      size: file ? (typeof file.data === 'string' ? file.data.length : file.data.length) : 0,
    }
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

import * as storage from './storage'
import { setActiveProjectDir } from './api/core'
import { fetchNotes, gcNoteMedia, MEDIA_GC_GRACE_MS, NotesConflictError, saveNotes } from './api/notes'
import { sweepNoteMedia } from './api/maintenance'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const PROJECT = '/games/Nova'
const MEDIA = `${PROJECT}/.dcsmeta/media`

beforeEach(async () => {
  files.clear()
  dirs.clear()
  setActiveProjectDir('')
  await storage.createProjectManifest(PROJECT, 'Nova')
  addDir(MEDIA)
})

async function save(text: string, expectedMtime: number | null = null): Promise<number | null> {
  return saveNotes({ data: { projectId: PROJECT, text, expectedMtime } })
}

describe('notes conflict detection (mtime)', () => {
  it('fetchNotes returns the file mtime, or null when there are no notes yet', async () => {
    expect(await fetchNotes({ data: { projectId: PROJECT } })).toEqual({ text: '', mtime: null })
    setFile(`${PROJECT}/notes.md`, 'hello', 12_345)
    expect(await fetchNotes({ data: { projectId: PROJECT } })).toEqual({
      text: 'hello',
      mtime: 12_345,
    })
  })

  it('saves through the fetched mtime and returns the new one', async () => {
    const first = await save('v1')
    expect(first).not.toBeNull()
    const { mtime } = await fetchNotes({ data: { projectId: PROJECT } })
    expect(mtime).toBe(first)

    const second = await save('v2', mtime)
    expect(second).not.toBeNull()
    expect(second).not.toBe(first)
    expect((await fetchNotes({ data: { projectId: PROJECT } })).text).toBe('v2')
  })

  it('a conflicting save throws and does NOT write', async () => {
    setFile(`${PROJECT}/notes.md`, 'theirs', 5_000)
    await expect(save('mine', 4_999)).rejects.toBeInstanceOf(NotesConflictError)
    expect(files.get(`${PROJECT}/notes.md`)?.data).toBe('theirs')

    // A window that loaded "no file yet" (null) conflicts once another window
    // created the file in the meantime.
    await expect(save('mine', null)).rejects.toBeInstanceOf(NotesConflictError)
    expect(files.get(`${PROJECT}/notes.md`)?.data).toBe('theirs')
  })

  it('clearing the text removes the file (guarded by the same mtime check)', async () => {
    setFile(`${PROJECT}/notes.md`, 'theirs', 5_000)
    await expect(save('', 4_999)).rejects.toBeInstanceOf(NotesConflictError)
    expect(files.has(`${PROJECT}/notes.md`)).toBe(true)

    expect(await save('', 5_000)).toBeNull()
    expect(files.has(`${PROJECT}/notes.md`)).toBe(false)
  })
})

describe('save-time media GC (1-hour grace)', () => {
  it('referenced media survives, however old', async () => {
    const old = Date.now() - 30 * DAY
    setFile(`${MEDIA}/${old}-kept.png`, 'png')
    await save(`![ref](media://${old}-kept.png)`)
    expect(files.has(`${MEDIA}/${old}-kept.png`)).toBe(true)
  })

  it('media referenced by ANOTHER character\'s notes survives a project-notes save', async () => {
    const old = Date.now() - 2 * HOUR
    setFile(`${MEDIA}/${old}-shared.png`, 'png')
    setFile(`${PROJECT}/Kira/Kira.notes.md`, `![shared](media://${old}-shared.png)`)
    await save('project notes without references')
    expect(files.has(`${MEDIA}/${old}-shared.png`)).toBe(true)
  })

  it('unreferenced-but-young media survives (cut/paste grace)', async () => {
    const young = Date.now() - 5 * 60 * 1000 // dropped 5 minutes ago
    setFile(`${MEDIA}/${young}-draft.png`, 'png')
    await save('no references')
    expect(files.has(`${MEDIA}/${young}-draft.png`)).toBe(true)
  })

  it('unreferenced media older than an hour is deleted (age from the filename prefix)', async () => {
    const old = Date.now() - 2 * HOUR
    // The filename prefix wins over the (recent) mtime.
    setFile(`${MEDIA}/${old}-stale.png`, 'png', Date.now())
    await save('no references')
    expect(files.has(`${MEDIA}/${old}-stale.png`)).toBe(false)
  })

  it('falls back to the file mtime when the name has no timestamp prefix', async () => {
    setFile(`${MEDIA}/no-prefix-old.png`, 'png', Date.now() - 2 * HOUR)
    setFile(`${MEDIA}/no-prefix-young.png`, 'png', Date.now())
    await save('no references')
    expect(files.has(`${MEDIA}/no-prefix-old.png`)).toBe(false)
    expect(files.has(`${MEDIA}/no-prefix-young.png`)).toBe(true)
  })

  it('a save that only clears the notes still GCs the now-unreferenced media', async () => {
    const old = Date.now() - 2 * HOUR
    setFile(`${MEDIA}/${old}-was-referenced.png`, 'png')
    setFile(`${PROJECT}/notes.md`, `![ref](media://${old}-was-referenced.png)`, 5_000)
    await save('', 5_000)
    expect(files.has(`${MEDIA}/${old}-was-referenced.png`)).toBe(false)
  })

  it('gcNoteMedia reports what it freed', async () => {
    const old = Date.now() - 2 * HOUR
    setFile(`${MEDIA}/${old}-a.png`, '12345')
    setFile(`${MEDIA}/${old}-b.png`, '123')
    const result = await gcNoteMedia(PROJECT, MEDIA_GC_GRACE_MS)
    expect(result).toEqual({ filesDeleted: 2, bytesFreed: 8 })
  })
})

describe('housekeeping sweep backstop (7 days, all known projects)', () => {
  beforeEach(async () => {
    await storage.rememberRecent(`${PROJECT}/Nova.dcsp`, 'Nova')
  })

  it('keeps unreferenced media younger than 7 days, deletes older', async () => {
    const sixDays = Date.now() - 6 * DAY
    const eightDays = Date.now() - 8 * DAY
    setFile(`${MEDIA}/${sixDays}-young.png`, 'png')
    setFile(`${MEDIA}/${eightDays}-old.png`, 'png')

    const result = await sweepNoteMedia()

    expect(files.has(`${MEDIA}/${sixDays}-young.png`)).toBe(true)
    expect(files.has(`${MEDIA}/${eightDays}-old.png`)).toBe(false)
    expect(result.filesDeleted).toBe(1)
  })

  it('referenced media survives the sweep even past 7 days', async () => {
    const eightDays = Date.now() - 8 * DAY
    setFile(`${MEDIA}/${eightDays}-kept.png`, 'png')
    setFile(`${PROJECT}/notes.md`, `[file](media://${eightDays}-kept.png)`)

    await sweepNoteMedia()

    expect(files.has(`${MEDIA}/${eightDays}-kept.png`)).toBe(true)
  })

  it('covers every known project and skips unreachable ones silently', async () => {
    await storage.createProjectManifest('/games/Beta', 'Beta')
    await storage.rememberRecent('/games/Beta/Beta.dcsp', 'Beta')
    // A recent whose folder no longer exists must not fail the sweep.
    await storage.rememberRecent('/gone/Lost.dcsp', 'Lost')
    const eightDays = Date.now() - 8 * DAY
    addDir('/games/Beta/.dcsmeta/media')
    setFile(`/games/Beta/.dcsmeta/media/${eightDays}-old.png`, 'png')
    setFile(`${MEDIA}/${eightDays}-old.png`, 'png')

    const result = await sweepNoteMedia()

    expect(result.filesDeleted).toBe(2)
    expect(files.has(`/games/Beta/.dcsmeta/media/${eightDays}-old.png`)).toBe(false)
    expect(files.has(`${MEDIA}/${eightDays}-old.png`)).toBe(false)
  })
})
