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
  /** What `configDir()` resolves to — Windows `%APPDATA%` (Roaming), where the
   *  DAZ Install Manager keeps the settings the studio reads. Optional: a spec
   *  that omits it gets a plausible default and simply has no DIM files there. */
  roamingDir?: string
  /** What `publicDir()` resolves to — the DIM manifests' default home lives
   *  under its `Documents`. */
  publicDir?: string
  /** What `documentDir()` / `homeDir()` resolve to — the two roots Houdini's
   *  `houdini<major>.<minor>` preferences folders are looked for under. */
  documentDir?: string
  homeDir?: string
  /** What `resolveResource()` resolves against — the app's bundled resources
   *  (the DTH Runner plugin DLLs under `resources/dth-runner/{ds4,ds6}`). A
   *  spec that seeds files there gets a real bundled-Runner state; one that
   *  doesn't gets "this build carries no bundled Runner", like a dev checkout. */
  resourceDir?: string
  /** What `houdini_installs` reports — the registry, as the studio sees it.
   *  Omit for a machine with no Houdini installed. */
  houdiniInstalls?: Array<{ version: string; path: string }>
  /** What `unreal_engine_installs` reports — Epic's registry + launcher
   *  manifest, as the studio sees it. Omit for a machine with no Unreal Engine
   *  installed. `buildId` is the engine's own id out of
   *  `Engine/Binaries/Win64/UnrealEditor.modules`; omit it for an engine whose
   *  id could not be read (which the studio never treats as a mismatch). */
  unrealEngineInstalls?: Array<{ version: string; path: string; buildId?: string }>
  /** Plugin builds `scan_unreal_plugins` finds — the real folder walk has no
   *  disk to walk here, so a spec states the builds; the mock serves each scan
   *  filtered to the folders it was asked about (matched on `sourceFolder`).
   *  `buildId` is what the build's binaries were compiled against; omit it for
   *  a content-only plugin. */
  unrealPlugins?: Array<{
    name: string
    path: string
    engineVersion: string
    sourceFolder: string
    buildId?: string
  }>
  /** The `.dcsp` this "window" was opened with — '' for a Home window. */
  activeProjectFile: string
  /** What `getVersion()` reports. */
  version: string
  /** What the native file/folder picker (`plugin:dialog|open`) returns — a path
   *  to simulate a pick, or undefined for "cancelled" (the default). */
  dialogPath?: string
  /** Files `probe_locked_files` reports as locked (open in Daz/Houdini) — drives
   *  the "close those apps" move dialog. Default: nothing locked. */
  lockedFiles?: Array<string>
  /** Conformed items a scene's `.duf` reports (`scene_wearables`), PER scene
   *  path — the groom picker's suggestions; a listed hair item resolves against
   *  its own scene's entry. Per-scene on purpose: a flat list served for every
   *  scene made each scene "carry" the other's hair, tripping the unlisted-hair
   *  warning in every multi-scene state. */
  sceneWearables?: Record<string, Array<{ id: string; label: string; conformTarget: string }>>
  /** The base figure node a scene reports (`scene_wearables`) — the create
   *  dialog's Genesis/gender auto-select source. Default: null (none found). */
  sceneFigure?: { id: string; label: string } | null
  /** Keyed frames on a scene's timeline (`scene_wearables`), PER scene path.
   *  Default 1 — an EMPTY timeline, which is what ADDING a scene demands. The
   *  Import-from-Daz-scene check inverts that (the keys are what it reads), so
   *  a spec driving a scan seeds a real count here. */
  sceneAnimationFrames?: Record<string, number>
  /** What `elevated_session` answers — an elevated (UAC) window. Default false. */
  elevated?: boolean
  /** Absolute paths whose fs commands are HELD — the invoke neither resolves
   *  nor rejects until the spec calls `__tauriMock.releaseHeld()` (which also
   *  stops holding future calls). Lets a spec freeze an async probe mid-flight
   *  — e.g. hold the execute-stamps file to keep the DTH Export dialog's scene
   *  probe from landing. Default: nothing held. */
  holdPaths?: Array<string>
  /** What `houdini_running` answers — the "Export too" liveness probe. Default
   *  false. A spec driving a LIVE run seeds this true for its whole duration:
   *  the app's 2.5s poll reads "no result + not running" as a dead run and
   *  kills the watch, so leaving it false until the result write is a flake
   *  window, not a neutral default. Exercising the dead path is what flipping
   *  `__tauriMock.houdiniRunning` to false mid-run is for. */
  houdiniRunning?: boolean
  /** DazToHue nodes the fake material-utility SCAN reports, per `.hip` path —
   *  what the Utils drawer lists as targets and sources. Node objects are
   *  passed through verbatim and must satisfy `materialNodeInfoSchema` (the
   *  app parses them); `contracts/material-util-report.json` is the shape.
   *  A path with no entry scans as a readable project with NO nodes, which is
   *  exactly what a scene that never got a DTH network looks like. */
  materialScan?: Record<string, Array<Record<string, unknown>>>
  /** Hold a `scan` op open for this many ms before answering.
   *
   *  The fake answers instantly, which is right for every spec about what a
   *  scan SAYS — but wrong for the ones about what the UI does WHILE one runs.
   *  A real scan is a whole hython start plus seconds per `.hip`, and the card
   *  spinner exists for exactly that window; without a delay it opens and closes
   *  inside one frame and no spec could ever see it. Scans only: the other ops
   *  have no such window. */
  materialScanDelayMs?: number
  /** The `$JOB` a scanned project reports — the General tab's input. Omit and
   *  the project reads as unreadable, which the tab reports and never repairs. */
  materialJob?: Record<string, string>
  /** The timeline FPS a scanned project reports, per `.hip` path. Omit and the
   *  project reads as the pipeline's 30 — i.e. nothing to repair, which is what
   *  keeps the General tab quiet in every spec that isn't about this. */
  materialFps?: Record<string, number>
  /** What the DazToHue shelf's "Refresh Assets" answered for a project, per
   *  `.hip` path. The real op executes a shelf tool that nothing here can
   *  impersonate, so a spec states the outcome; omit and the tool ran and the
   *  scene came back modified. */
  materialRefresh?: Record<
    string,
    {
      ok?: boolean
      error?: string
      /** The shelf tool's label, as the report shows it. */
      tool?: string
      /** Whether the scene reported unsaved changes once the tool had run. */
      changed?: boolean
      /** What the DazToHue shelf carried, when the refresh tool wasn't on it. */
      availableTools?: Array<string>
    }
  >
  /** What `read_character_zip_manifest` returns for a picked/dropped character
   *  export zip (the manifest JSON text). Omit for "not a character export". */
  characterZipManifest?: string
  /** What `extract_character_zip` inflates: zip-relative path → content,
   *  written under the requested staging dir. The zip bytes themselves never
   *  exist in the fake — the entries ARE the archive. */
  characterZipEntries?: Record<string, string>
}

/** What the spec reads back via `page.evaluate` from `window.__tauriMock`. */
export interface TauriMockState {
  files: Map<string, string>
  /** The mtime every file in the fake world reports — stable per page, so a
   *  spec can seed an mtime-keyed cache entry that reads as fresh. */
  mtimeMs: number
  /** Override ONE path's mtime from here on. The world's fixed stamp can't
   *  express "this file was written later in the run", which is what a
   *  freshness check (did THIS run write it, or is it last run's leftover?)
   *  is looking at. `Date.now()` is the usual argument. */
  setMtime: (path: string, ms: number) => void
  calls: Array<{ cmd: string; args: unknown }>
  /** Every material-utility request the studio wrote, parsed, oldest first.
   *
   * Kept here because the studio DELETES its request file as soon as the run
   * returns (per-run names, swept in a `finally`), so a spec asserting what was
   * asked for cannot read it back off the fake filesystem afterwards. */
  materialRequests: Array<Record<string, unknown>>
  unhandled: Array<string>
  /** What `daz_studio_running` reports — false until a spec flips it (the way
   *  a spec keeps a claimed batch's Daz "alive" while driving its progress). */
  dazRunning?: boolean
  /** WHICH installation the running fake Daz belongs to (an install folder).
   *  Unset = it answers for whichever install is asked about. Set it to make
   *  the fake a specific Studio — how a spec reproduces "DS6 is open, the batch
   *  belongs to DS4" (see daz-launch-activated.smoke.ts). */
  dazRunningFolder?: string
  /** Let every command held on a `holdPaths` path proceed, and stop holding. */
  releaseHeld: () => void
  /** Mutable: the answer `houdini_running` gives from now on. */
  houdiniRunning: boolean
}

export function installTauriMock(seed: TauriMockSeed): void {
  const files = new Map(Object.entries(seed.files))
  /**
   * Every file's mtime in the fake world — see `stat`.
   *
   * Stable (so mtime-keyed caches can actually hit) but NOT a fixed date in the
   * past: age-based housekeeping compares against the real clock, and a world
   * whose files all look months old gets its just-written run files swept out
   * from under it. Stamped once, when the fake is installed. Exposed on
   * `__tauriMock` so a spec can seed a cache entry that reads as fresh.
   */
  const FAKE_MTIME_MS = Date.now()
  /** Per-path mtime overrides — see `TauriMockState.setMtime`. */
  const mtimeOverrides = new Map<string, number>()
  const extraDirs = new Set<string>()
  const calls: Array<{ cmd: string; args: unknown }> = []
  const materialRequests: Array<Record<string, unknown>> = []
  const unhandled: Array<string> = []
  // The single object both the command switch and the spec hold — mutating
  // `state.houdiniRunning` from a spec is how a run goes live and then exits.
  const state: TauriMockState = {
    files,
    /** The mtime every file reports — a spec seeding an mtime-keyed cache needs it. */
    mtimeMs: FAKE_MTIME_MS,
    setMtime: (path, ms) => {
      mtimeOverrides.set(norm(path), ms)
    },
    calls,
    materialRequests,
    unhandled,
    houdiniRunning: seed.houdiniRunning ?? false,
    releaseHeld: () => {
      holdPaths.clear()
      for (const resolve of held.splice(0)) resolve()
    },
  }
  let nextId = 1

  // Trailing slashes trimmed with string ops, not `/\/+$/` — the repo-wide rule
  // (CodeQL js/polynomial-redos). Inlined rather than imported: this function is
  // serialized into the page by addInitScript and must stay self-contained.
  const norm = (p: string) => {
    let s = p.replaceAll('\\', '/')
    while (s.endsWith('/')) s = s.slice(0, -1)
    return s
  }
  // Commands whose `args.path` is listed here PAUSE (before dispatch) until the
  // spec calls releaseHeld() — which drains the queue AND clears the set, so
  // later calls to the same path run normally.
  const holdPaths = new Set((seed.holdPaths ?? []).map(norm))
  const held: Array<() => void> = []
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
  /** The base64 payload of a binary entry stored as a data:URL, else undefined. */
  const dataUrlB64 = (content: string) => /^data:[^,]*;base64,(.*)$/s.exec(content)?.[1]
  /** A stored file as raw bytes: a binary entry (seeded/written as a
   *  `data:…;base64,…` URL, e.g. a scene `.tip.png`) returns its real decoded
   *  bytes — text-encoding binary would corrupt it; text is UTF-8 encoded. */
  const readBytes = (p: string): ArrayBuffer => {
    const content = mustRead(p)
    const b64 = dataUrlB64(content)
    if (b64) return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer
    return new TextEncoder().encode(content).buffer
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
  /** Reported byte size of an entry: binary entries (base64 data:URLs, see
   *  write_file) decode to their real byte length — the URL string's length
   *  would be ~4/3 of it. Text entries report the string length, i.e. UTF-16
   *  code units, which under-counts multi-byte UTF-8 on-disk bytes — fine for
   *  the smoke specs, which only care about zero vs non-zero / rough size. */
  const sizeOf = (content: string): number => {
    const b64 = dataUrlB64(content)
    return b64 === undefined ? content.length : atob(b64).length
  }
  const statOf = (p: string) => {
    if (!isFile(p) && !isDir(p)) throw new Error(`[tauri-mock] no such path: ${p}`)
    const file = isFile(p)
    // A FIXED stamp, not Date.now(): a file's mtime must not change just because
    // somebody looked at it. With a fresh value per call every mtime-keyed cache
    // in the studio missed on every read — which looks exactly like a cache that
    // works, and hid the fact that none of them were ever exercised here.
    // A spec that needs one file to look NEWER than the world says so
    // explicitly, via `__tauriMock.setMtime` (see TauriMockState).
    const now = mtimeOverrides.get(p) ?? FAKE_MTIME_MS
    return {
      isFile: file,
      isDirectory: !file,
      isSymlink: false,
      size: file ? sizeOf(files.get(p)!) : 0,
      // DATES, like the real plugin returns — the studio's mtime caches all call
      // `.getTime()`/`.toISOString()` on these, so numbers made every one of them
      // silently inert in the fake (a cache that never hits looks like a cache
      // that works).
      mtime: new Date(now),
      atime: new Date(now),
      birthtime: new Date(now),
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

    if (typeof args?.path === 'string' && holdPaths.has(norm(args.path))) {
      await new Promise<void>((resolve) => held.push(resolve))
    }

    switch (cmd) {
      // --- filesystem (plugin-fs 2.5.x contract) ---------------------------
      case 'plugin:fs|exists':
        return isFile(norm(args.path)) || isDir(norm(args.path))
      case 'plugin:fs|read_text_file':
      case 'plugin:fs|read_file':
        // The wrapper expects BYTES (ArrayBuffer / number[]) and decodes itself.
        return readBytes(norm(args.path))
      case 'plugin:fs|write_text_file':
      case 'plugin:fs|write_file': {
        // The payload arrives as raw bytes. Text stays a plain string in the
        // map (specs read `files` contents directly) — but a BINARY payload
        // (non-UTF-8, e.g. a copied image) is stored as a base64 data URL, the
        // same form binary SEEDS use, so read_file above returns the exact
        // bytes instead of a lossily TextDecoder-mangled string.
        const path = headerPath(options)
        const bytes = args instanceof Uint8Array ? args : new Uint8Array(args)
        try {
          // ignoreBOM: without it the decoder EATS a leading EF BB BF, so a
          // BOM'd UTF-8 payload would round-trip 3 bytes short through the map.
          files.set(path, new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes))
        } catch {
          let bin = ''
          for (let i = 0; i < bytes.length; i += 0x8000)
            bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
          files.set(path, `data:application/octet-stream;base64,${btoa(bin)}`)
        }
        return null
      }
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
        // BaseDirectory: 3 = Config (Windows Roaming), 9 = Public, 15 =
        // AppLocalData. Only these three are asked for; anything else keeps the
        // app-data answer this fake gave before there was more than one.
        // 6 = Document and 21 = Home are where Houdini's `houdini<X>.<Y>` prefs
        // folders live — both, because Houdini falls back to home when it can't
        // use Documents (and Documents is routinely redirected off C:).
        if (args.directory === 3) return seed.roamingDir ?? 'C:/Users/dev/AppData/Roaming'
        if (args.directory === 9) return seed.publicDir ?? 'C:/Users/Public'
        if (args.directory === 6) return seed.documentDir ?? 'C:/Users/dev/Documents'
        if (args.directory === 21) return seed.homeDir ?? 'C:/Users/dev'
        // 11 = Resource — `resolveResource(p)` asks for it WITH a path, and the
        // answer is the joined one (the bundled Runner DLLs live there).
        if (args.directory === 11) {
          const base = seed.resourceDir ?? 'C:/Program Files/DTH Character Studio'
          const rel = String(args.path ?? '').replace(/^[\\/]+/, '')
          return rel ? `${base}/${rel}` : base
        }
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
        // A seeded path simulates a pick (the scene picker in the create flow);
        // undefined = the user cancelled.
        return seed.dialogPath ?? null
      case 'plugin:dialog|ask':
      case 'plugin:dialog|message':
        return true
      case 'plugin:shell|open':
        return null

      // --- the app's own Rust commands --------------------------------------
      case 'active_project_file':
        return seed.activeProjectFile
      case 'upscale_avatar_file':
        // No real image processing in the mock — stored avatar bytes are left as
        // written (`false` = "nothing upscaled"). Keeps avatar-set flows off the
        // unhandled-command guard.
        return false
      case 'downscale_avatar_png':
        // Ditto: return the stored avatar bytes unchanged (the real command's own
        // "source already ≤ size" path). The header's exact-size variant then
        // just equals the full image.
        return readBytes(norm(args.path))
      case 'probe_locked_files':
        return seed.lockedFiles ?? []
      case 'remove_junction':
        // The retired `dth-exports` junction feature: every generation now
        // SWEEPS the links the old versions planted (reparse-point-verified on
        // the Rust side), so the mock has to know this command or `unhandled`
        // fills up on ordinary saves. The fixture world never contains a
        // junction — 'absent' is the truthful answer; the call itself is
        // recorded (see `calls`) so a spec can assert the sweep ran.
        return 'absent'
      case 'move_exports': {
        // The export-root relocation (schema v29, and the export-root move of the root
        // itself). The real command moves whole folder TREES and reports the
        // ones it could not; this world has no locking, so every move succeeds
        // and the failure list comes back empty. Modelled as a prefix rename
        // over the flat file map, which is what a tree move is here.
        const moves = (args.request.moves ?? []) as Array<{ from: string; to: string }>
        for (const move of moves) {
          const from = norm(move.from)
          const to = norm(move.to)
          for (const key of [...files.keys()]) {
            if (key !== from && !key.startsWith(`${from}/`)) continue
            files.set(to + key.slice(from.length), files.get(key)!)
            files.delete(key)
          }
        }
        return []
      }
      case 'remove_dir_if_empty':
        // The retired `houdini-project` folder (v0.68), swept by the same
        // generation funnel as the junctions above — so the mock has to know
        // it or `unhandled` fills up on ordinary saves. The fixture world
        // never contains one, and 'absent' is the truthful answer; the call is
        // recorded (see `calls`) so a spec can assert the sweep ran.
        return 'absent'
      case 'create_houdini_project': {
        // Generate project. The real command runs hython, which this fake never
        // starts — but everything worth asserting is already in the REQUEST:
        // `prefillJson` is the whole wiring decision (which scene's export set
        // the imports point at, where Houdini writes). So write the `.hiplc` the
        // caller then links, and report a network that was created and filled.
        files.set(norm(args.request.scenePath), 'hiplc-fixture')
        // The fourth field is the FPS the saved scene reports. The real command
        // reads it back off `hou.fps()` AFTER setting it, so echoing the
        // request is the honest fake here: this world has no Houdini that could
        // refuse the call.
        return `daztohueimport|daztohueimport|import_character_dtu_file|${args.request.fps ?? 0}`
      }
      case 'open_project_window': // opens a separate OS window on the desktop —
        return null //              recorded (see `calls`), nothing to do here
      case 'shell_open_file': // Explorer-style double-click (openScene's `.hip`/
        return null //          `.uproject` path) — recorded; the spec asserts the path
      case 'focus_app_window': // best-effort foregrounding after that open —
        return null //           there is no window here to pull forward
      case 'minimize_app_window': // its twin, on the UNATTENDED launches — no
        return false //           window here either; specs assert via `calls`
      case 'scan_duf_files': {
        const folder = norm(args.folder)
        const prefix = `${folder}/`
        return [...files.keys()]
          .filter((k) => k.startsWith(prefix) && k.toLowerCase().endsWith('.duf'))
          .map((k) => k.slice(prefix.length))
      }
      case 'scan_files_by_ext': {
        // The native detection walk: extensions matched case-insensitively,
        // named directories pruned at ANY depth (the real one prunes before
        // descending; here it is the same predicate applied to the path).
        const folder = norm(args.folder)
        const prefix = `${folder}/`
        const exts = (args.exts as Array<string>).map((e) => `.${e.toLowerCase()}`)
        const skip = (args.skipDirs as Array<string>).map((d) => d.toLowerCase())
        return [...files.keys()]
          .filter((k) => k.startsWith(prefix))
          .map((k) => k.slice(prefix.length))
          .filter((rel) => {
            const lower = rel.toLowerCase()
            if (!exts.some((ext) => lower.endsWith(ext))) return false
            return !lower
              .split('/')
              .slice(0, -1)
              .some((dir) => skip.includes(dir))
          })
          .sort()
      }
      case 'pose_asset_frames':
        return (args.paths as Array<string>).map((path) => {
          const frames = seed.dufFrames[norm(path)]
          return frames === undefined
            ? { path, frames: 0, error: `[tauri-mock] no seeded frames for: ${path}` }
            : { path, frames, error: '' }
        })
      case 'scene_wearables':
        // Groom suggestions: THIS scene's seeded wearables (so a listed hair item
        // resolves instead of flashing "not found" — and another scene's hair
        // never leaks in as "unlisted"), else empty. `figure` feeds the create
        // dialog's Genesis auto-select; `figures`/`animationFrames` the add-scene
        // validation (one figure, empty timeline — all checks pass by default).
        return {
          items: seed.sceneWearables?.[norm(args.path)] ?? [],
          figure: seed.sceneFigure ?? null,
          figures: seed.sceneFigure ? [seed.sceneFigure] : [],
          animationFrames: seed.sceneAnimationFrames?.[norm(args.path)] ?? 1,
          error: '',
        }
      case 'write_text_file_if_unchanged': {
        // The recents registry's cross-window compare-and-swap (fsutil.rs).
        // One webview here, so the compare virtually always matches — but the
        // mock keeps the contract honest: a stale `expected` conflicts and
        // writes nothing, exactly like the native command.
        const { path, expected, next } = args.request as {
          path: string
          expected: string
          next: string
        }
        const key = norm(path)
        const current = isFile(key) ? String(files.get(key)) : ''
        if (current !== expected) return 'conflict'
        files.set(key, next)
        return 'written'
      }
      case 'housekeeping_sweep':
        return { filesDeleted: 0, bytesFreed: 0 }
      case 'elevated_session':
        return seed.elevated ?? false
      case 'relaunch_deelevated':
        // The real command exits the app — here the spec just reads the call
        // (and its projectFile arg) out of `calls`.
        return null
      case 'install_dth_plugin': {
        // Canned success: the copy itself is native Rust; the smoke pins the
        // UI around the report (toast, step list, post-install notices).
        const req = (args as { request: { dryRun?: boolean; label?: string } }).request
        return {
          dryRun: req.dryRun ?? false,
          steps: [
            {
              label: req.label ?? 'DTH Exporter Plugin',
              files: 1,
              status: 'ok',
              detail: '',
              filesList: ['dth_exporter.dll'],
            },
          ],
          totalFiles: 1,
        }
      }
      case 'unc_for_path':
        return null
      case 'ensure_network_drives':
        return []
      case 'daz_studio_running': {
        // False until a spec flips `__tauriMock.dazRunning` — how a spec keeps
        // the fake Daz "alive" while it drives a claimed batch's progress
        // (the studio treats a sub-100 running file with Daz gone as a DEAD run).
        if ((window as any).__tauriMock?.dazRunning !== true) return false
        // The real probe is INSTALL-AWARE: an empty installFolder asks "any
        // Daz", a folder asks "is THAT installation up" — DS4 and DS6 both run
        // an executable called DAZStudio.exe, so only the path can tell them
        // apart. `dazRunningFolder` is which install the fake Daz belongs to;
        // unset means "whichever you ask about", which is what every spec that
        // doesn't care about the distinction wants.
        const asked = String(args?.installFolder ?? '')
        const where = String((window as any).__tauriMock?.dazRunningFolder ?? '')
        if (!asked || !where) return true
        const flat = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
        return flat(asked) === flat(where)
      }
      case 'launch_daz_studio':
        // Nothing to start. The batch is claimed by the Runner INSIDE Daz,
        // which this fake does not impersonate — a spec plays that part by
        // renaming the job file to `running_…` and driving its progress, which
        // is exactly the contract the plugin follows.
        return ''
      case 'launch_houdini_job':
        // Same deal for Houdini: the launch is recorded in `calls` (the spec
        // asserts the job path, the `;&` script path and the version-matched
        // prefs dir), and the spec then plays 456.py by writing the result file.
        return null
      case 'houdini_running':
        return state.houdiniRunning
      case 'run_houdini_material_util': {
        // The studio writes its request to disk and hands hython the two paths,
        // so this fake reads the SAME request file the real Python parses —
        // the op and its arguments come from there, never from a second source
        // of truth that could drift from what the app actually asked for.
        const request = JSON.parse(mustRead(norm(args.request.requestPath)))
        // Kept for the spec: the studio removes this file the moment the run
        // returns, so asserting what it asked for has to happen here.
        materialRequests.push(request)
        // What `_backup` in material_utils.py leaves on disk before a real
        // save: one rolling copy per project, inside Houdini's own `backup/`
        // folder. Modelled (file and all) rather than reported as an empty
        // string, because the drawer's close prompt collects exactly these.
        const backupFor = (hipPath: string): string => {
          if (request.dryRun) return ''
          const path = norm(hipPath)
          const dir = path.replace(/\/[^/]*$/, '')
          const name = path.slice(dir.length + 1)
          const dot = name.lastIndexOf('.')
          const stem = dot === -1 ? name : name.slice(0, dot)
          const ext = dot === -1 ? '' : name.slice(dot)
          const backup = `${dir}/backup/${stem}_dthbak${ext}`
          files.set(backup, files.get(path) ?? 'hip-fixture')
          return backup
        }
        const base = {
          op: request.op,
          ok: true,
          error: '',
          projects: [],
          targets: [],
          defaults: [],
          repath: [],
          prefill: [],
          refresh: [],
          sourceBakers: 0,
          sourceLayers: 0,
          sourceBakerNames: [],
          sections: request.sections ?? [],
          materials: request.materials ?? [],
          useLibVar: request.useLibVar ?? false,
          rewrittenPaths: 0,
          foreignPaths: [],
          dryRun: request.dryRun ?? false,
          replace: request.replace ?? false,
        }
        if (request.op === 'scan') {
          // See `materialScanDelayMs` — the window the card spinner lives in.
          if (seed.materialScanDelayMs) {
            await new Promise((resolve) => setTimeout(resolve, seed.materialScanDelayMs))
          }
          return {
            ...base,
            projects: (request.hipPaths as Array<string>).map((hipPath) => ({
              hipPath,
              ok: true,
              error: '',
              nodes: seed.materialScan?.[norm(hipPath)] ?? [],
              // $JOB/$HIP come off the same scan in the real Python. The seed
              // may name a $JOB; without one the project reads as already
              // correct, so the General tab is quiet unless a spec asks for it.
              job: seed.materialJob?.[norm(hipPath)] ?? '',
              // The timeline, off the same scan. Defaults to the pipeline's 30
              // so a project reads as already correct — a spec that wants the
              // General tab to complain seeds another number.
              fps: seed.materialFps?.[norm(hipPath)] ?? 30,
              // No hython here to read real parms: a scanned project reports
              // nothing to repath, so the General tab's reference rows stay
              // quiet unless a spec seeds them.
              refs: { collapsible: 0, foreign: 0, broken: [], hipRelative: []  },
              prefill: { fillable: [], missing: [] },
              hipDir: norm(hipPath).replace(/\/[^/]*$/, ''),
            })),
          }
        }
        if (request.op === 'prefill') {
          return {
            ...base,
            prefill: (request.targets as Array<{ hipPath: string }>).map((t) => ({
              hipPath: t.hipPath,
              ok: true,
              error: '',
              filled: [],
              skippedMissing: [],
              skippedSet: [],
              backupPath: backupFor(t.hipPath),
            })),
          }
        }
        if (request.op === 'repath') {
          return {
            ...base,
            repath: (request.targets as Array<{ hipPath: string }>).map((t) => ({
              hipPath: t.hipPath,
              ok: true,
              error: '',
              collapsed: 0,
              repaired: [],
              foreign: [],
              backupPath: backupFor(t.hipPath),
            })),
          }
        }
        if (request.op === 'refresh') {
          // The real op executes the DazToHue shelf tool, which nothing here
          // impersonates. A spec names the outcome instead: `materialRefresh`
          // is what the shelf answered per project — absent means it ran and
          // the scene came back modified, which is the ordinary case.
          return {
            ...base,
            refresh: (request.targets as Array<{ hipPath: string }>).map((t) => {
              const over = seed.materialRefresh?.[norm(t.hipPath)] ?? {}
              const ok = over.ok ?? true
              const changed = ok && (over.changed ?? true)
              return {
                hipPath: t.hipPath,
                ok,
                error: over.error ?? '',
                tool: ok ? (over.tool ?? 'Refresh Assets') : '',
                changed,
                availableTools: over.availableTools ?? [],
                // Mirrors the Python: a backup is taken only when the scene
                // actually reported changes and the run is for real.
                backupPath: changed ? backupFor(t.hipPath) : '',
              }
            }),
          }
        }
        if (request.op === 'defaults') {
          // Same posture as the transfer below: the call and its request file
          // are what a spec asserts — nothing here pretends a .hip was written.
          return {
            ...base,
            defaults: (
              request.targets as Array<{ hipPath: string; jobDir: string; fps?: number }>
            ).map((t) => {
              const previousJob = seed.materialJob?.[norm(t.hipPath)] ?? ''
              const previousFps = seed.materialFps?.[norm(t.hipPath)] ?? 30
              const wantFps = t.fps ?? 0
              // Each value is compared on its own, exactly as `op_defaults`
              // does — so a spec that seeds only a stale $JOB gets a report
              // that says the timeline was left alone. And exactly like the
              // real op, an UNKNOWN value ('' / 0 — nobody read one) is never
              // claimed repaired, even when the project was queued for the
              // other value.
              const changedJob =
                previousJob !== '' && previousJob.toLowerCase() !== t.jobDir.toLowerCase()
              const changedFps =
                wantFps > 0 && previousFps > 0 && Math.abs(previousFps - wantFps) >= 0.001
              const changed = changedJob || changedFps
              return {
                hipPath: t.hipPath,
                ok: true,
                error: '',
                previousJob,
                job: changedJob ? t.jobDir : previousJob,
                previousFps,
                fps: changedFps ? wantFps : previousFps,
                changed,
                changedJob,
                changedFps,
                backupPath: changed ? backupFor(t.hipPath) : '',
              }
            }),
          }
        }
        // No hython here, so no transfer really happens: each target reports
        // ok with NOTHING moved. Deliberately not a fabricated success — a spec
        // asserts the call and the request file, never a copy this made up.
        return {
          ...base,
          targets: (request.targets as Array<{ hipPath: string; nodePath: string }>).map((t) => ({
            hipPath: t.hipPath,
            nodePath: t.nodePath,
            ok: true,
            error: '',
            sections: [],
            added: [],
            replaced: Boolean(request.replace),
            missingMaterials: [],
            missingGroups: [],
            missingUvSources: [],
            unclaimedSurfaces: [],
            backupPath: backupFor(t.hipPath),
          })),
        }
      }
      case 'houdini_installs':
        // The Windows registry read (houdini_install.rs) has nothing to stand
        // in for it here, so a spec states what the machine has.
        return seed.houdiniInstalls ?? []
      case 'restore_houdini_backup': {
        // The revert a failed run offers: a plain file copy in the real Rust,
        // so the fake does exactly that against its in-memory files. Refusing
        // a missing backup here keeps the failure path honest — the studio
        // reports it rather than truncating the project.
        const backup = norm(args.request.backupPath)
        const hip = norm(args.request.hipPath)
        if (!isFile(backup)) throw new Error(`The backup is no longer there:\n${backup}`)
        files.set(hip, mustRead(backup))
        return null
      }
      case 'export_character_zip':
        // Packing happens in Rust on the desktop; the fake acknowledges with a
        // plausible report — specs assert the REQUEST shape via `calls`.
        return { files: 7, bytes: 12345, skippedLinks: 0 }
      case 'read_character_zip_manifest': {
        if (!seed.characterZipManifest) {
          throw new Error(
            'This zip is not a DTH Character Studio character export (no manifest.json at its root).',
          )
        }
        return seed.characterZipManifest
      }
      case 'list_character_zip_entries':
        // The seeded entries ARE the archive; manifest.json always sits beside them.
        return ['manifest.json', ...Object.keys(seed.characterZipEntries ?? {})]
      case 'read_character_zip_entry': {
        const entry = (seed.characterZipEntries ?? {})[args.request.entryPath]
        if (entry === undefined) {
          throw new Error(`the zip has no "${args.request.entryPath}" entry`)
        }
        return entry
      }
      case 'extract_character_zip': {
        const dest = norm(args.request.destDir)
        const entries = Object.entries(seed.characterZipEntries ?? {})
        for (const [rel, content] of entries) files.set(`${dest}/${rel}`, content)
        return entries.length
      }
      case 'unreal_dth_present': {
        // Derived from the fake fs (not a constant): an install in the same
        // spec marks the folder, and a re-probe must then say so.
        const dir = norm(args.uprojectPath)
        return isDir(`${dir.slice(0, dir.lastIndexOf('/'))}/Content/DazToHue`)
      }
      case 'unreal_engine_installs':
        // The Windows registry read (unreal_install.rs) has nothing to stand
        // in for it here, so a spec states what the machine has.
        return seed.unrealEngineInstalls ?? []
      case 'scan_unreal_plugins': {
        // Filtered to the folders THIS scan asked about, so the Settings
        // panel's per-folder preview behaves like the real walk.
        const asked = (args.folders as Array<string>).map(norm)
        return (seed.unrealPlugins ?? []).filter((p) => asked.includes(norm(p.sourceFolder)))
      }
      case 'unreal_project_state': {
        const up = norm(args.uprojectPath)
        if (!isFile(up)) throw new Error('Not an Unreal project file (.uproject).')
        const dir = up.slice(0, up.lastIndexOf('/'))
        let engineAssociation = ''
        try {
          const parsed = JSON.parse(mustRead(up)) as { EngineAssociation?: unknown }
          engineAssociation = typeof parsed.EngineAssociation === 'string' ? parsed.EngineAssociation : ''
        } catch {
          // a fixture .uproject that isn't JSON reads as "no association"
        }
        const pluginsDir = `${dir}/Plugins`
        return {
          engineAssociation,
          dthPresent: isDir(`${dir}/Content/DazToHue`),
          installedPlugins: isDir(pluginsDir)
            ? listDir(pluginsDir)
                .filter((e) => e.isDirectory)
                .map((e) => e.name)
                .sort()
            : [],
        }
      }
      case 'install_unreal_dth': {
        // The real command copies the release's Unreal content; the fake marks
        // the destination folder so presence probes flip, and answers with a
        // plausible file count — specs assert the REQUEST shape via `calls`.
        const up = norm(args.request.uprojectPath)
        extraDirs.add(`${up.slice(0, up.lastIndexOf('/'))}/Content/DazToHue`)
        return 7
      }
      case 'install_unreal_plugin': {
        const src = norm(args.request.pluginPath)
        const plugin = (seed.unrealPlugins ?? []).find((p) => norm(p.path) === src)
        if (!plugin) throw new Error('Not an Unreal plugin folder (no .uplugin inside).')
        const up = norm(args.request.uprojectPath)
        extraDirs.add(`${up.slice(0, up.lastIndexOf('/'))}/Plugins/${plugin.name}`)
        return 3
      }

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
  // The spec's window into this fake (page.evaluate). `state` is the same
  // object the command switch reads, so a spec flipping `houdiniRunning`
  // changes what the next `houdini_running` poll answers — and its
  // `releaseHeld` drains the `holdPaths` queue the invoke wrapper parks on.
  w.__tauriMock = state
}
