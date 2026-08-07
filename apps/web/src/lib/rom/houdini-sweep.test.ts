import { beforeEach, describe, expect, it, vi } from 'vitest'

// The houdini-project leftover sweep: the state the Rust `remove_dir_if_empty`
// answers must map onto the removed/kept report the user sees — "kept" is the
// safety promise (a non-empty folder is the user's own pre-v0.64 output and is
// named in the Refresh report instead of disappearing), so the mapping is
// pinned here rather than trusted.

const invoked: Array<{ cmd: string; args: unknown }> = []
let dirState = 'absent'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args: unknown) => {
    invoked.push({ cmd, args })
    if (cmd === 'remove_dir_if_empty') return dirState
    return null
  },
  isTauri: () => true,
  convertFileSrc: (p: string) => p,
}))
vi.mock('@tauri-apps/api/path', () => ({ appLocalDataDir: async () => '/appdata' }))
vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '0.0.0' }))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))
vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: async () => false,
  mkdir: async () => undefined,
  readTextFile: async () => {
    throw new Error('ENOENT')
  },
  writeTextFile: async () => undefined,
  readFile: async () => {
    throw new Error('ENOENT')
  },
  writeFile: async () => undefined,
  readDir: async () => [],
  remove: async () => undefined,
  rename: async () => undefined,
  stat: async () => ({ isDirectory: false, isFile: false, mtime: new Date(0) }),
}))

import { sweepHoudiniProjectDirs } from './api/houdini'

beforeEach(() => {
  invoked.length = 0
  dirState = 'absent'
})

describe('sweepHoudiniProjectDirs', () => {
  const CHAR = 'D:/P/Kira'
  const PROJECT_DIR = 'D:/P/Kira/houdini/houdini-project'

  it('reports a removed empty leftover', async () => {
    dirState = 'removed'
    expect(await sweepHoudiniProjectDirs(CHAR, 'houdini')).toEqual({
      removed: [PROJECT_DIR],
      kept: [],
    })
    expect(invoked.map((c) => c.cmd)).toEqual(['remove_dir_if_empty'])
  })

  it('reports a KEPT non-empty folder — the user-facing safety promise', async () => {
    dirState = 'not-empty'
    expect(await sweepHoudiniProjectDirs(CHAR, 'houdini')).toEqual({
      removed: [],
      kept: [PROJECT_DIR],
    })
  })

  it('absent and not-a-directory both report nothing', async () => {
    expect(await sweepHoudiniProjectDirs(CHAR, 'houdini')).toEqual({ removed: [], kept: [] })
    dirState = 'not-a-directory'
    expect(await sweepHoudiniProjectDirs(CHAR, 'houdini')).toEqual({ removed: [], kept: [] })
  })

  it('an unexpected answer (locked folder, protocol drift) is swallowed, not thrown', async () => {
    dirState = 'garbage'
    expect(await sweepHoudiniProjectDirs(CHAR, 'houdini')).toEqual({ removed: [], kept: [] })
  })
})
