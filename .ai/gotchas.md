# Gotchas — hard-won facts that are invisible in the code

Things that were learned by measurement or painful debugging. Verify against the
current code before relying on details, but assume the *lesson* still holds.

## Generation core

- **Frame math returns -1, not 0, for "no preset block"** — `presetEndFrame` is
  designed so the first custom pose lands at frame 0. Clamping to 0 introduces an
  off-by-one that `generate.test.ts` guards explicitly.
- **`mirrorGroup` only flips word-initial Left/Right** tokens — `CleftChin` must
  survive mirroring (test-pinned).
- **U+2028/U+2029 are line terminators to Daz's JS engine** — every string
  embedded in a generated `.dsa` goes through `dazJson`/`commentSafe` escaping. A
  shared character definition carrying one used to break the whole script.
- **Byte-identical output tests are the contract.** Refactors of `generate.ts`
  must not change a single output byte unless the change is the point (then the
  templates/tests move with it and `RUNTIME_VERSION` is bumped).

## Daz Studio integration (measured behavior)

- **A failed script `include()`/load logs nothing** in Daz Studio. Diagnose with a
  minimal probe `.dsa` that logs before/after the suspect statement.
- **`include()` must be top-level** in DS6 — a legacy include inside a function
  throws `URIError: Legacy Include` (regression-guarded in `generate.test.ts`).
- **`App.openFile(path, false)` replaces the current scene without a save
  prompt** — the generated per-character `Open_Scene` script warns the user first.
- **Command-line forwarding to a running Daz instance stops working once a scene
  is loaded** — full "open in running instance" automation isn't possible from
  scripts alone; that's why the studio ships an Open_Scene script instead.
- **Fast runtime test loop:** copying an updated `.DthUtils.dsa`/`.DthWorkflow.dsa`
  over the installed one in `<Daz library>/Scripts/DTH-Character-Studio/` and
  re-running the character's ROM script is enough — no app rebuild needed.

## Desktop / Tauri

- **Never create a webview window from a synchronous `#[tauri::command]`** — it
  deadlocks (white frozen window). Use `#[tauri::command(async)]` and
  `tauri::async_runtime::spawn` (the single-instance handler does this).
- **The Rust crate version (`apps/desktop/Cargo.toml`, `0.1.0`) is cosmetic.**
  The product version lives in `apps/desktop/package.json`
  (`tauri.conf.json` has `"version": "package.json"`); Changesets bumps only the
  npm side. `cargo test` printing `v0.1.0` is expected.
- **`Cargo.lock` pins `alloc-stdlib = 0.2.2` + `alloc-no-stdlib = 2.0.4`** — newer
  versions break brotli 8 via Tauri's asset compression. CI greps the lockfile to
  enforce the pins; don't `cargo update` them (see `docs/devops.md` for the
  re-pin command).
- **Tauri fs plugin scope quirks:** on Unix the `**` glob doesn't match hidden
  dot-folders unless `plugins.fs.requireLiteralLeadingDot: false` is set in
  `tauri.conf.json` (it is — creating `.dcsmeta/images` failed on macOS without it).
- **I/O-heavy commands must be `#[tauri::command(async)]`** or they freeze the
  window during long scans/installs.

## Web app

- **`routeTree.gen.ts` is generated** — adding/removing a route *file* requires
  `pnpm generate-routes`; forgetting it is a silent 404.
- **Settings saves merge by baseline** — only fields changed on that page win,
  the rest re-read from disk (multi-window safety). A new settings field must be
  added to `studioSettingsSchema` AND covered by the page's `dirty` flag, or its
  value never reaches disk.
- **Character page sticky stack:** the character header (`sticky top-0`), ROM
  section titles (`top-[128px]`) and pose-table column headers (`top-[176px]`)
  overlap screenshots/crops — the guide-screenshot suite compensates per shot.

## Releases

- **GitHub releases are immutable** (since v0.44.7): a published release and its
  `latest.json` cannot be edited afterward. Never hand-publish without being sure
  `latest.json` is right — a broken one can't be fixed in place.
- **`github-actions[bot]` cannot create releases on this repo** (403 "Resource
  not accessible by integration" despite `contents: write`). The publish job runs
  on the `RELEASE_PAT` secret — if publishing ever 403s/401s again, **check the
  PAT's expiry first** before diagnosing anything else. See `.ai/release.md`.
