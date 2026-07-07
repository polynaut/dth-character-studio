# Tauri migration plan

**✅ COMPLETED (June 2026)** — the migration shipped; every release since runs on
Tauri. Kept as a historical record of the decision + plan.

**Decision (2026-06-14):** migrate the desktop app from Electron to **Tauri 2.x**.
The app is inherently local-first (it reads the user's Daz content, FBX files, and
writes `.dsa`/CSV to disk) and its core value — the ROM/CSV/DSA generation — is
pure TypeScript. The Node-server-in-Electron design (TanStack Start SSR + 13
`createServerFn` server functions + a forked `srvx` server) is a heavyweight way
to get local FS access. Tauri gives the same access via native plugins, a ~10×
smaller binary (~10–20 MB vs ~80–150 MB), and lower RAM.

## Target architecture

- **Frontend:** `apps/web` becomes a **client-rendered SPA** (Vite + React +
  TanStack Router, **no SSR**, no server functions). The `routes/` tree and all
  UI components stay; only the build/entry and the data layer change.
- **Native shell:** `apps/web/src-tauri/` (Rust). Minimal custom Rust — only the
  official plugins are wired up.
- **`apps/desktop` (Electron) is removed** once Tauri is proven. The server
  bundling work (`server/standalone.js`, `bundle-server.mjs`) is Electron-only
  and gets deleted with it; `apps/web/server/` (the SSR listen entry) goes too.
- **Web deploy still possible:** the SPA is a static bundle — `vite build` +
  any static host (or `vite preview`). Local FS access only exists in the Tauri
  build (the web build degrades the file features).

## Data-layer port (the only real work)

All Node I/O lives in `src/lib/rom/api.ts` (13 fns), `src/lib/rom/storage.ts`,
`src/server/paths.ts`, and `src/routes/api.character-images.$fileName.ts`.

| Current | Tauri |
|---|---|
| `node:fs/promises` mkdir/readFile/readdir/rm/stat/writeFile | `@tauri-apps/plugin-fs` (`mkdir`, `readTextFile`, `readDir`, `remove`, `stat`, `writeTextFile`, `writeFile`, `exists`) |
| `DATA_DIR = DTH_DATA_DIR \|\| cwd/data` | `appLocalDataDir()` (`@tauri-apps/api/path`) — per-user, survives updates |
| `node:path` `join`/`basename` | `@tauri-apps/api/path` `join`/`basename` (or a tiny JS helper) |
| `pickFbxFile` PowerShell `OpenFileDialog` | `@tauri-apps/plugin-dialog` `open({ filters: [{ name: 'FBX', extensions: ['fbx'] }] })` |
| `uploadCharacterImage` write base64 → file | fs `writeFile` (Uint8Array from `atob`) |
| `api.character-images/:file` route | `convertFileSrc(path)` (asset protocol) — no route needed |
| `importCharacterFromJson` read arbitrary path | dialog `open()` → fs `readTextFile(picked)` |
| `listPoseAssets` recursive `.duf` scan | fs `readDir(folder, { recursive })` filter `.duf` |
| `generateAll` / `resolveRomPaths` (pure TS) | **unchanged**, runs client-side |
| `writeFilesToFolder` (external dazScriptsFolder) | fs `writeTextFile` (needs broad fs scope — see below) |

**Strategy:** rewrite `api.ts` into a plain async client module with the **same
function names + return shapes** so the UI/TanStack-Query call sites barely
change. `storage.ts` logic (the v1→v3 character migration, pose-asset
classification) is pure aside from the `fs` calls — keep it, swap the `fs` import
for the Tauri fs wrapper. Drop `createServerFn`, `paths.ts` (replaced by
`appLocalDataDir`), the image route, and `lib/desktop.ts` (the Electron bridge).

## FS scoping (Tauri security)

Tauri's fs plugin is **scoped**. The app needs:
- read/write under `$APPLOCALDATA/**` (characters, settings, out, images) — easy.
- read an **arbitrary user-picked** `.duf` Poses folder and write to an
  **arbitrary** DazToHue-Scripts folder. These aren't known at build time.

Options: (a) broad scope (`$HOME/**` or all) — simplest for a local power tool,
least secure; (b) rely on dialog-granted access + `fs:scope` additions at runtime.
**Plan:** scope `$APPLOCALDATA/**` by default, and allow a broad read/write scope
for the user-configured folders (documented as an explicit power-tool tradeoff).
Revisit if we want tighter scoping.

## Auto-update (Tauri updater, Windows-first)

- `@tauri-apps/plugin-updater` + `plugin-process` (for relaunch).
- Artifacts are **minisign-signed**: generate a keypair (`pnpm tauri signer
  generate`), keep the private key as a CI secret (`TAURI_SIGNING_PRIVATE_KEY`
  + `..._PASSWORD`), put the **public key** in `tauri.conf.json` `plugins.updater.pubkey`.
- `bundle.createUpdaterArtifacts: true` emits the `.sig` + `latest.json`.
- Updater endpoint: the GitHub Releases `latest.json` (release workflow uploads it).
- App side: on startup `check()` → if update, prompt → `downloadAndInstall()` →
  `relaunch()`. No notarization needed on Windows (unsigned NSIS is fine; the
  minisign signature is what the updater verifies).

## Release pipeline (carried over, retargeted)

- **Changesets + branch policy**: framework-agnostic, already started — keep.
- **`release.yml`**: on version bump (Version Packages PR merged), build the
  Tauri app on `windows-latest`, sign updater artifacts, create tag + GitHub
  Release with the NSIS installer + `latest.json` + `.sig`. (Use
  `tauri-apps/tauri-action` or `tauri build` + `gh release`.)
- macOS is a **later step** (needs Apple signing/notarization — see the Electron
  research notes captured this session; the same Apple cert/API-key apply).

## Phases

- [x] **0. Prereq:** install Rust (`rustup`). WebView2 already present. *(user)*
- [x] **1. Scaffold:** `src-tauri/` (Cargo.toml, tauri.conf.json, main.rs, lib.rs,
      build.rs, capabilities), Tauri npm deps, `tauri` script. *(additive, done)*
- [x] **2. SPA conversion:** drop `tanstackStart()` from vite.config; add
      `index.html` + client `main.tsx` entry; switch router to client
      `@tanstack/react-router`; remove SSR/server entries. Verify `vite build` + vitest.
- [x] **3. Data-layer port:** rewrite `api.ts` → Tauri client module; swap
      `storage.ts` fs; drop `paths.ts`/image route/`lib/desktop.ts`. Typecheck.
- [x] **4. Updater:** wire `plugin-updater` in lib.rs + a client `updater.ts`
      (check→prompt→install→relaunch); generate signing keypair.
- [x] **5. Build + run:** `pnpm tauri dev`, then `pnpm tauri build` (needs Rust).
- [x] **6. Remove Electron:** delete `apps/desktop`, `apps/web/server/`,
      `bundle-server.mjs`/`standalone.js`; update changesets config + scripts.
- [x] **7. Release pipeline:** `release.yml` for Tauri; updater secrets; first release.

## Toolchain notes

- Tauri CLI: `@tauri-apps/cli@2` (run via `pnpm tauri ...`).
- Rust: install via `winget install -e --id Rustlang.Rustup` then restart shell.
- WebView2: present on this machine (149.x) — no bootstrapper needed on Win11.
- Icons: generate with `pnpm tauri icon <path-to-1024px.png>` (writes `src-tauri/icons/`).
