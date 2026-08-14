import { beforeEach, describe, expect, it, vi } from 'vitest'

// Which Daz launches are allowed to take over the screen.
//
// The studio starts Daz for two very different reasons, and they go through the
// same `launch_daz_studio` command:
//
//   - UNATTENDED SCANS — a project or scene scan. The Runner drives a Daz nobody
//     is watching (every script handed to it is dialog-free by construction for
//     exactly that reason), so it has no business jumping in front of what the
//     user is doing. These ask the native watch to minimize Daz once its main
//     window appears.
//   - The user asking for a SCENE — "Open and Generate ROM Animation" on a scene
//     card leaves the built ROM on the timeline to look at. Minimizing that would
//     hide the thing that was asked for.
//   - An EXPORT handoff — also visible. It used to minimize (#799), but the
//     minimize is fire-and-forget and never actually worked, so a successful
//     launch produced no window: identical, from the user's chair, to a launch
//     that failed, while the studio insisted it was "Opening Daz Studio". A run
//     whose progress the user is sitting and watching is not unattended.
//
// The split is one argument (`DazLaunchVisibility`) at five call sites, so it is
// exactly the kind of thing a later "simplification" collapses to one behaviour.
// These pin both sides. (The plain scene-card OPEN never comes through here at
// all — it launches Daz with the scene as its argument, in api/attachments.ts.)

const files = new Map<string, string>()
const dirs = new Set<string>()

let dazRunning = false
/** The exe path the fake `launch_daz_studio` answers with — the minimize watch
 *  must hunt exactly this (DS4 and DS6 are both `DAZStudio.exe`, so a bare
 *  NAME could match the other install's window; the full path cannot). */
const LAUNCHED_EXE = 'C:/Daz4/DAZStudio.exe'
/** `launch_daz_studio` calls, in order. */
const launches: Array<string> = []
/** `minimize_app_window` calls with their args — the assertion target. */
const minimizes: Array<{ exePaths: Array<string>; timeoutMs: number }> = []

function norm(p: string): string {
  let s = p.replace(/\\/g, '/')
  while (s.endsWith('/')) s = s.slice(0, -1)
  return s
}
function addDir(p: string): void {
  let path = norm(p)
  while (path && path !== '/') {
    dirs.add(path)
    const idx = path.lastIndexOf('/')
    path = idx > 0 ? path.slice(0, idx) : ''
  }
}
function addFile(p: string, body = 'x'): void {
  files.set(norm(p), body)
  const idx = norm(p).lastIndexOf('/')
  if (idx > 0) addDir(norm(p).slice(0, idx))
}

vi.mock('@tauri-apps/api/path', () => ({
  appLocalDataDir: async () => '/appdata',
  sep: () => '/',
}))
vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '0.0.0' }))
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  convertFileSrc: (p: string) => p,
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === 'daz_studio_running') return dazRunning
    if (cmd === 'launch_daz_studio') {
      launches.push(cmd)
      return LAUNCHED_EXE
    }
    if (cmd === 'minimize_app_window') {
      minimizes.push({
        exePaths: (args?.exePaths as Array<string>) ?? [],
        timeoutMs: (args?.timeoutMs as number) ?? 0,
      })
      return true
    }
    return null
  },
}))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
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
    addFile(p, c)
  },
  async rename(a: string, b: string) {
    const v = files.get(norm(a))
    if (v != null) {
      files.set(norm(b), v)
      files.delete(norm(a))
    }
  },
  async stat(p: string) {
    return {
      isDirectory: dirs.has(norm(p)),
      isFile: files.has(norm(p)),
      mtime: new Date(0),
      birthtime: new Date(0),
    }
  },
  async readDir(p: string) {
    const dir = norm(p)
    if (!dirs.has(dir)) throw new Error(`ENOTDIR ${dir}`)
    const prefix = `${dir}/`
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

import { CHARACTER_SCHEMA_VERSION, characterSchema } from '@dth/rom'
import * as storage from './storage'
import {
  generateRomAnimation,
  launchDazForPendingJobs,
  startProjectScan,
  startSceneScan,
} from './api/execute'

/** The Daz library — where the job file and the generated scripts live. */
const DAZ_LIB = '/daz/My DAZ 3D Library'
const SCRIPTS = `${DAZ_LIB}/Scripts/DTH-Character-Studio`
const PENDING = `${SCRIPTS}/dth_exporter_jobs.json`
/** The project folder (its path IS the projectId) and its one character. */
const PROJECT = '/games/Nova'
const CHAR = `${PROJECT}/Kira`
const SCENE = `${CHAR}/daz3d/Kira.duf`
const CHARACTER_ID = 'kira-1'

beforeEach(() => {
  files.clear()
  dirs.clear()
  launches.length = 0
  minimizes.length = 0
  dazRunning = false
  addDir('/appdata')
  files.set('/appdata/settings.json', JSON.stringify({ dazLibraryFolder: DAZ_LIB }))
  // The installed runtime a per-run scan script includes.
  addFile(`${SCRIPTS}/.DthUtils.dsa`, 'runtime')
})

/** A project + one character with a linked scene and its generated ROM-animation
 *  script — everything `generateRomAnimation` checks before it launches. */
async function seedCharacter(): Promise<void> {
  await storage.createProjectManifest(PROJECT, 'Nova')
  const character = characterSchema.parse({
    id: CHARACTER_ID,
    name: 'Kira',
    genesis: 'G9',
    gender: 'female',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    scenePath: SCENE,
  })
  addFile(`${CHAR}/Kira.json`, JSON.stringify({ ...character, schemaVersion: CHARACTER_SCHEMA_VERSION }))
  addFile(SCENE)
  addFile(`${storage.studioCharScriptsDir(DAZ_LIB, 'Nova', 'Kira')}/.Build_ROM_Animation.dsa`)
}

describe('unattended SCAN launches start Daz minimized', () => {
  it('a scene scan asks for the Daz window to be minimized', async () => {
    await startSceneScan({ data: { scenePath: SCENE, genesis: 'G9' } })

    expect(launches).toHaveLength(1)
    expect(minimizes).toHaveLength(1)
    // The watch hunts the FULL path of the exe that was just launched — never
    // a bare name, which could match the OTHER install's open window (DS4 and
    // DS6 are both DAZStudio.exe) — with a timeout generous enough for a cold
    // Daz (which can take tens of seconds to paint a main window).
    expect(minimizes[0].exePaths).toEqual([LAUNCHED_EXE])
    expect(minimizes[0].timeoutMs).toBeGreaterThanOrEqual(30_000)
  })

  it('a project scan (base index pass) launches Daz minimized', async () => {
    addFile(`${SCRIPTS}/${storage.GENESIS_INDEX_BULK_SCRIPT}`)

    await startProjectScan({ data: { base: true, morphs: false, products: false } })

    expect(launches).toHaveLength(1)
    expect(minimizes).toHaveLength(1)
    expect(minimizes[0].exePaths).toEqual([LAUNCHED_EXE])
  })

  it('an EXPORT handoff launches Daz visible — the user is watching this one', async () => {
    addFile(PENDING, JSON.stringify({ version: 2, progress: 0, jobs: [] }))

    await expect(launchDazForPendingJobs()).resolves.toBe(true)

    expect(launches).toHaveLength(1)
    // Deliberately NOT minimized (this used to be, via #799). The minimize is
    // fire-and-forget and never actually worked, so a SUCCESSFUL launch left no
    // window to see — indistinguishable from a launch that failed, while the
    // studio said "Opening Daz Studio". An export whose progress the user is
    // sitting and watching is not an unattended run.
    expect(minimizes).toHaveLength(0)
  })

  it('does NOT launch at all when Daz is already running', async () => {
    addFile(PENDING, JSON.stringify({ version: 2, progress: 0, jobs: [] }))
    dazRunning = true

    await expect(launchDazForPendingJobs()).resolves.toBe(true)

    // Nothing was launched, so there is nothing of ours to minimize: a Daz the
    // user already has open is theirs, and yanking it down would be exactly the
    // surprise this feature exists to avoid.
    expect(launches).toHaveLength(0)
    expect(minimizes).toHaveLength(0)
  })
})

describe('the scene the user asked to see stays visible', () => {
  it('"Open and Generate ROM Animation" launches Daz WITHOUT minimizing it', async () => {
    await seedCharacter()

    const started = await generateRomAnimation({
      data: { projectId: PROJECT, id: CHARACTER_ID, scenePath: SCENE },
    })

    expect(started.dazWasRunning).toBe(false)
    expect(launches).toHaveLength(1) // it did start Daz…
    expect(minimizes).toHaveLength(0) // …and deliberately left it on screen
  })
})
