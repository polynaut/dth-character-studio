// The in-memory fake of the native (Tauri) layer for the e2e smoke tests.
//
// The app's entire native surface funnels through two globals the real runtime
// injects: `globalThis.isTauri` (what `isTauri()` reads) and
// `window.__TAURI_INTERNALS__.invoke` (every command — the app's own Rust
// commands AND the plugin commands like `plugin:fs|read_text_file`). Faking
// those two before any app module runs puts the REAL, unpatched app in front
// of a scripted backend: files live in a Map, `.duf` frame measurement returns
// seeded numbers, windows/dialogs no-op.
//
// `installTauriMock` is passed to Playwright's `page.addInitScript(fn, seed)`,
// which serializes the function into the page — so it must stay fully
// self-contained (no imports, no outer-scope references).
//
// Any command this fake doesn't know is recorded in `__tauriMock.unhandled`
// AND rejected — defensive call sites degrade like they would on a real error,
// load-bearing ones fail visibly, and the spec's final `unhandled == []`
// assertion catches surface this mock silently grew out of sync with.

export interface TauriMockSeed {
  /** Initial filesystem: absolute '/'-separated path → text content. */
  files: Record<string, string>
  /** Measured frame count per absolute `.duf` path (`pose_asset_frames`). */
  dufFrames: Record<string, number>
  /** What `appLocalDataDir()` resolves to. */
  appDataDir: string
  /** The `.dcsp` this "window" was opened with — '' for a Home window. */
  activeProjectFile: string
  /** What `getVersion()` reports. */
  version: string
}

/** What the spec reads back via `page.evaluate` from `window.__tauriMock`. */
export interface TauriMockState {
  files: Map<string, string>
  calls: Array<{ cmd: string; args: unknown }>
  unhandled: Array<string>
}

export function installTauriMock(seed: TauriMockSeed): void {
  const files = new Map(Object.entries(seed.files))
  const extraDirs = new Set<string>()
  const calls: Array<{ cmd: string; args: unknown }> = []
  const unhandled: Array<string> = []
  let nextId = 1

  const norm = (p: string) => p.replaceAll('\\', '/').replace(/\/+$/, '')
  const isFile = (p: string) => files.has(p)
  const isDir = (p: string) => {
    if (extraDirs.has(p)) return true
    const prefix = `${p}/`
    for (const k of files.keys()) if (k.startsWith(prefix)) return true
    for (const d of extraDirs) if (d.startsWith(prefix)) return true
    return false
  }
  const mustRead = (p: string): string => {
    const content = files.get(p)
    if (content === undefined) throw new Error(`[tauri-mock] no such file: ${p}`)
    return content
  }
  /** Immediate children of a dir, from the file map + explicit mkdirs. */
  const listDir = (p: string) => {
    if (!isDir(p)) throw new Error(`[tauri-mock] no such directory: ${p}`)
    const prefix = `${p}/`
    const names = new Map<string, boolean>() // name → isFile
    for (const k of files.keys()) {
      if (!k.startsWith(prefix)) continue
      const rest = k.slice(prefix.length)
      const slash = rest.indexOf('/')
      if (slash === -1) names.set(rest, true)
      else if (!names.has(rest.slice(0, slash))) names.set(rest.slice(0, slash), false)
    }
    for (const d of extraDirs) {
      if (!d.startsWith(prefix)) continue
      const first = d.slice(prefix.length).split('/')[0]
      if (!names.has(first)) names.set(first, false)
    }
    return [...names].map(([name, file]) => ({
      name,
      isFile: file,
      isDirectory: !file,
      isSymlink: false,
    }))
  }
  const statOf = (p: string) => {
    if (!isFile(p) && !isDir(p)) throw new Error(`[tauri-mock] no such path: ${p}`)
    const file = isFile(p)
    const now = Date.now()
    return {
      isFile: file,
      isDirectory: !file,
      isSymlink: false,
      size: file ? files.get(p)!.length : 0,
      mtime: now,
      atime: now,
      birthtime: now,
      readonly: false,
    }
  }
  /** write_file / write_text_file carry the path URI-encoded in the headers and
   *  the payload as the raw invoke body (2nd arg) — see plugin-fs dist-js. */
  const headerPath = (options: { headers?: Record<string, string> } | undefined) =>
    norm(decodeURIComponent(options?.headers?.path ?? ''))

  async function invoke(cmd: string, args?: any, options?: any): Promise<unknown> {
    const isWrite = cmd === 'plugin:fs|write_text_file' || cmd === 'plugin:fs|write_file'
    // Don't record write payloads (bytes) — just the target path.
    calls.push({ cmd, args: isWrite ? { path: headerPath(options) } : args })

    switch (cmd) {
      // --- filesystem (plugin-fs 2.5.x contract) ---------------------------
      case 'plugin:fs|exists':
        return isFile(norm(args.path)) || isDir(norm(args.path))
      case 'plugin:fs|read_text_file':
      case 'plugin:fs|read_file':
        // The wrapper expects BYTES (ArrayBuffer / number[]) and decodes itself.
        return new TextEncoder().encode(mustRead(norm(args.path))).buffer
      case 'plugin:fs|write_text_file':
      case 'plugin:fs|write_file':
        files.set(headerPath(options), new TextDecoder().decode(args))
        return null
      case 'plugin:fs|read_dir':
        return listDir(norm(args.path))
      case 'plugin:fs|mkdir': {
        // Recursive by default — register every ancestor so exists() sees them.
        const parts = norm(args.path).split('/')
        for (let i = 2; i <= parts.length; i++) extraDirs.add(parts.slice(0, i).join('/'))
        return null
      }
      case 'plugin:fs|remove': {
        const p = norm(args.path)
        if (isFile(p)) {
          files.delete(p)
          return null
        }
        if (!isDir(p)) throw new Error(`[tauri-mock] remove: no such path: ${p}`)
        const prefix = `${p}/`
        for (const k of [...files.keys()]) if (k.startsWith(prefix)) files.delete(k)
        for (const d of [...extraDirs]) if (d === p || d.startsWith(prefix)) extraDirs.delete(d)
        return null
      }
      case 'plugin:fs|rename': {
        const from = norm(args.oldPath)
        const to = norm(args.newPath)
        if (isFile(from)) {
          files.set(to, mustRead(from))
          files.delete(from)
          return null
        }
        const prefix = `${from}/`
        for (const k of [...files.keys()]) {
          if (k.startsWith(prefix)) {
            files.set(`${to}/${k.slice(prefix.length)}`, files.get(k)!)
            files.delete(k)
          }
        }
        for (const d of [...extraDirs]) {
          if (d === from || d.startsWith(prefix)) {
            extraDirs.delete(d)
            extraDirs.add(d === from ? to : `${to}/${d.slice(prefix.length)}`)
          }
        }
        return null
      }
      case 'plugin:fs|copy_file':
        files.set(norm(args.toPath), mustRead(norm(args.fromPath)))
        return null
      case 'plugin:fs|stat':
      case 'plugin:fs|lstat':
        return statOf(norm(args.path))

      // --- other plugins ---------------------------------------------------
      case 'plugin:path|resolve_directory':
        return seed.appDataDir
      case 'plugin:app|version':
        return seed.version
      case 'plugin:event|listen':
        return nextId++
      case 'plugin:event|unlisten':
      case 'plugin:event|emit':
        return null
      case 'plugin:updater|check':
        return null // "up to date"
      case 'plugin:dialog|open':
        return null // "picker cancelled"
      case 'plugin:dialog|ask':
      case 'plugin:dialog|message':
        return true
      case 'plugin:shell|open':
        return null

      // --- the app's own Rust commands --------------------------------------
      case 'active_project_file':
        return seed.activeProjectFile
      case 'open_project_window': // opens a separate OS window on the desktop —
      case 'open_home_window': //    recorded (see `calls`), nothing to do here
        return null
      case 'scan_duf_files': {
        const folder = norm(args.folder)
        const prefix = `${folder}/`
        return [...files.keys()]
          .filter((k) => k.startsWith(prefix) && k.toLowerCase().endsWith('.duf'))
          .map((k) => k.slice(prefix.length))
      }
      case 'pose_asset_frames':
        return (args.paths as Array<string>).map((path) => {
          const frames = seed.dufFrames[norm(path)]
          return frames === undefined
            ? { path, frames: 0, error: `[tauri-mock] no seeded frames for: ${path}` }
            : { path, frames, error: '' }
        })
      case 'scene_wearables':
        // Groom suggestions are best-effort; the fixture scene has no wearables.
        return { items: [], error: '' }
      case 'housekeeping_sweep':
        return { filesDeleted: 0, bytesFreed: 0 }
      case 'unc_for_path':
        return null
      case 'ensure_network_drives':
        return []
      case 'daz_studio_running':
        return false

      default:
        unhandled.push(cmd)
        throw new Error(`[tauri-mock] unhandled command: ${cmd}`)
    }
  }

  const w = window as any
  // What isTauri() actually reads — without this the native layer no-ops.
  w.isTauri = true
  w.__TAURI_INTERNALS__ = {
    invoke,
    transformCallback: (cb: (r: unknown) => void) => {
      const id = nextId++
      w[`_${id}`] = cb
      return id
    },
    unregisterCallback: (id: number) => {
      delete w[`_${id}`]
    },
    convertFileSrc: (p: string) => `asset://${p}`,
    plugins: { path: { sep: '/', delimiter: ';' } },
    // Read SYNCHRONOUSLY by getCurrentWindow()/getCurrentWebview() — the file
    // drop + close-guard hooks crash the page without it.
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
  }
  // event.js unlisten() bypasses invoke and calls this global directly.
  w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} }
  // The spec's window into this fake (page.evaluate).
  w.__tauriMock = { files, calls, unhandled } satisfies TauriMockState
}
