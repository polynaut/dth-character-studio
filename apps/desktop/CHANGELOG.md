# @dth/desktop

## 0.45.3

### Patch Changes

- [#441](https://github.com/polynaut/dth-character-studio/pull/441) [`0792e99`](https://github.com/polynaut/dth-character-studio/commit/0792e99d8a47b099bcdf976359db08eefe1f44ce) Thanks [@polynaut](https://github.com/polynaut)! - Third full-codebase audit pass: a case-only character rename no longer deletes the just-written PoseAsset CSV, moving the scenes folder regenerates the scripts that embed scene paths, and the dedup report now marks the same keeper the install actually picks; menu actions hit only the focused window, the housekeeping sweep gained the same deletion rails as every other delete path, installs no longer hold every nested-zip inflation on disk at once, and saves stopped re-walking the library and rewriting the runtime scripts every time; clearing a pose-value cell reverts instead of committing 0, tab switches no longer trip a false unsaved-changes prompt, typing during a notes media drop is preserved, labels and errors are properly wired for assistive tech, Escape in a multi-select no longer closes the surrounding dialog, and a failed macOS build now blocks a release instead of silently shipping Windows-only. A follow-up self-audit of these fixes also made the forced Tools → Refresh genuinely repair deleted or corrupted runtime scripts, let archives containing unsafe-named entries install their safe subset with an accurate message, and taught the dedup conflict view the installer's exact tie-breaking.

- [#438](https://github.com/polynaut/dth-character-studio/pull/438) [`38a7687`](https://github.com/polynaut/dth-character-studio/commit/38a76877937c074f5ab6e5aadaaf4668845105b3) Thanks [@polynaut](https://github.com/polynaut)! - Second full-codebase audit pass: the asset dedup now refuses duplicate-listed or nested source folders (previously it could quarantine the only real copy), quarantining a folder junction moves the link instead of copying its target, and zip installs refuse partial inventories; saves that persist but fail to regenerate scripts no longer report unsaved changes or roll back your edits, renaming inline can no longer race a running save, edits typed during a slow scene copy survive, case-only renames of character folders work on Windows, and notes autosave no longer rescans the whole library per pause; clearing a number field reverts instead of committing 0, the Tools page reconciles settings across windows like Settings does, mirrored pose groups now flip stock Daz `_L`/`l_` side markers, and the physics block length is validated against the PoseAsset template.

- [#445](https://github.com/polynaut/dth-character-studio/pull/445) [`364625a`](https://github.com/polynaut/dth-character-studio/commit/364625a9a4cdc4836120cd9499a457f8dba3ec0f) Thanks [@polynaut](https://github.com/polynaut)! - Audit tail closeout: edits typed while moving the scenes folder can no longer write a dead custom-asset path back to disk, one Refresh click now repairs a corrupted runtime install even when characters are also stale, the dedup conflict marker orders tied paths exactly like the installer (component-wise, not string-wise), "Clean up now" reports files it couldn't delete instead of claiming there was nothing to do, the missing-pinned-release warning updates right after any save, and two keyboard edge cases are fixed: an IME-cancel Escape no longer closes a surrounding dialog, and Shift+Tabbing out of a pinned info popup no longer dismisses it.

- [#451](https://github.com/polynaut/dth-character-studio/pull/451) [`9515a2a`](https://github.com/polynaut/dth-character-studio/commit/9515a2acca31ee1ec6ce1afe495fe9f1c2b89cab) Thanks [@polynaut](https://github.com/polynaut)! - Folder moves now share one robust helper. Before any move, the app checks whether a file under the folder is open in Daz Studio or Houdini; if so, it shows a dialog — "some files are still open, close all Daz Studio and Houdini instances and press Continue" — listing the blocked files, with Continue (retry) and Cancel, instead of a half-finished move. The character page's folder chip gains an inline edit-to-move (the same move as Advanced options → Storage location), and abort actions (move Cancel, the export-directory Clear) now use a red "ghost" button so they read as undo/abort.

- [#435](https://github.com/polynaut/dth-character-studio/pull/435) [`1c53147`](https://github.com/polynaut/dth-character-studio/commit/1c531470f82d5f4e2f7faad4f52d93af1dfe44b5) Thanks [@polynaut](https://github.com/polynaut)! - Full-codebase hardening pass: every file write is now atomic and newer-version character files are reported instead of silently stripped; dedup honors "keep this copy" across same-named duplicates, reports every failed quarantine move, and handles Windows case differences; linking scenes/Houdini projects/avatars validates and regenerates artifacts exactly like Save; dialogs, side panels and the morph autocomplete are fully keyboard-accessible; and Refresh, installs, pose measurement and heavy editor screens are significantly faster.

- [#449](https://github.com/polynaut/dth-character-studio/pull/449) [`61ebf5b`](https://github.com/polynaut/dth-character-studio/commit/61ebf5b8ed28536e03e6a5426fa13ab66e07361c) Thanks [@polynaut](https://github.com/polynaut)! - Renaming a project now renames its `.dcsp` file to match (it previously kept the old filename), and any open window for that project is live-re-titled to the new name — so the native title bar, the `.dcsp` filename, and the in-app name all stay in sync without closing and reopening the window.

## 0.45.2

### Patch Changes

- [#415](https://github.com/polynaut/dth-character-studio/pull/415) [`d575b9d`](https://github.com/polynaut/dth-character-studio/commit/d575b9dd39a5a665c36736fc2b19e090f2e00ab8) Thanks [@polynaut](https://github.com/polynaut)! - Fixes from a full codebase audit — mostly data-loss and correctness bugs in the character editor and project handling:

  - **Moving a character folder** now keeps every linked path intact. Previously only the primary Daz scene followed the move — extra outfit scenes, grooms, ROM scene-overrides and the avatar-source scene were orphaned, and the next save wrote those dead paths permanently.
  - **Moving the Daz scenes folder** no longer silently discards unsaved ROM edits (and no longer slips past the "unsaved changes" prompt).
  - **Edits typed while a save is in progress** are preserved instead of being reverted when the save finishes.
  - **Inline rename** now runs the same validation as Save, so it can't persist or regenerate an invalid character.
  - **Case-only renames** (e.g. `kira` → `Kira`) no longer fork the folder to `Kira (2)` or delete the freshly generated scripts.
  - **Importing a morph CSV** into an empty FBM/MISC section no longer drops that section's scene-override frames.
  - A **corrupt project file** (`.dcsp`) now surfaces an error instead of silently resetting the project's settings on the next save.
  - **Dedup** never destroys a downloaded asset: when quarantining across drives, a copy that succeeds is kept even if clearing the original partly fails.
  - Projects **opened by double-clicking a `.dcsp`** now appear in Recents.
  - Note attachments: only safe media/document types open from the app (a `.dsa` attachment can no longer run in Daz).
  - Assorted UI fixes: the Tools "Refresh assets" menu item switches tabs reliably, the Settings release/exporter spinner no longer sticks, bulk-delete refreshes the list on a partial failure, discarding edits asks first, and duplicate scene/Houdini/Unreal links are de-duplicated case-insensitively.
  - Performance: measured `.duf` frame counts and avatars are cached, and the character-library scan skips the app's own large media folders — noticeably faster on projects with many characters or on a network share.

## 0.45.1

## 0.45.0

## 0.44.11

## 0.44.10

## 0.44.9

### Patch Changes

- [#396](https://github.com/polynaut/dth-character-studio/pull/396) [`80c8353`](https://github.com/polynaut/dth-character-studio/commit/80c83532ca3667a926334fbbcfe9cac303e22c70) Thanks [@polynaut](https://github.com/polynaut)! - Dependency refresh: Tauri 2.11.5 and zip 4 in the desktop shell, TypeScript 7 in the toolchain, and updated CI actions.

## 0.44.8

## 0.44.7

## 0.44.6

### Patch Changes

- [#367](https://github.com/polynaut/dth-character-studio/pull/367) [`25ece9c`](https://github.com/polynaut/dth-character-studio/commit/25ece9c03719414da272a230be4e8cd9403ca1d8) Thanks [@polynaut](https://github.com/polynaut)! - Actually fix "forbidden path" on macOS/Linux project creation. The Tauri fs plugin defaults `requireLiteralLeadingDot` to true on Unix, so the `**` scope glob refuses to match hidden dot-folders like `.dcsmeta` — creating a project's `.dcsmeta/images` failed. Set `plugins.fs.requireLiteralLeadingDot: false` in tauri.conf.json (Windows was never affected — it defaults to false there). This supersedes the 0.44.5 `/**` scope attempt, which addressed the wrong cause.

  macOS release builds are now Apple Silicon (arm64) only, which roughly halves the mac build time (Intel Macs are no longer supported). The release also caches Cargo's downloaded crate sources (checksum-verified, never compiled artifacts) so the signed build stays a cold, reproducible compile.

## 0.44.5

### Patch Changes

- [#365](https://github.com/polynaut/dth-character-studio/pull/365) [`ed0e9a3`](https://github.com/polynaut/dth-character-studio/commit/ed0e9a3dc3efc75fe20d9788804856681abb080a) Thanks [@polynaut](https://github.com/polynaut)! - New dark macOS app icon — the logo now sits on a slate rounded background instead of a light one, so it reads cleanly in the Dock in both light and dark mode. The Windows icon is unchanged.

- [#365](https://github.com/polynaut/dth-character-studio/pull/365) [`ed0e9a3`](https://github.com/polynaut/dth-character-studio/commit/ed0e9a3dc3efc75fe20d9788804856681abb080a) Thanks [@polynaut](https://github.com/polynaut)! - Fix "forbidden path" when creating a project — or any new nested folder — on macOS/Linux. Tauri's fs plugin scope-checks a not-yet-existing path as a raw string, and the `**` scope glob doesn't match a POSIX absolute path's leading `/`, so creating `.dcsmeta/images` (and other new nested paths) failed on the macOS build. A `/**` scope now covers absolute Unix paths; Windows is unaffected.

## 0.44.4

### Patch Changes

- [#363](https://github.com/polynaut/dth-character-studio/pull/363) [`cc109bf`](https://github.com/polynaut/dth-character-studio/commit/cc109bf101c0d28ae730ce1d3b85a8c1e3451d7a) Thanks [@polynaut](https://github.com/polynaut)! - DTH Character Studio is now also built and published for **macOS** — a universal (Intel + Apple Silicon) `.dmg` / `.app`, Developer-ID-signed and Apple-notarized, published alongside the Windows installer. The auto-updater serves the matching platform from the same `latest.json`. (The Daz DTH Exporter Plugin is still Windows-only, so the far side of the pipeline continues to need Windows.)

## 0.44.3

### Patch Changes

- [#349](https://github.com/polynaut/dth-character-studio/pull/349) [`200d6bd`](https://github.com/polynaut/dth-character-studio/commit/200d6bd7254d91a97271af9c5f4f1e8fb870423c) Thanks [@polynaut](https://github.com/polynaut)! - Desktop robustness: every I/O-heavy native command now runs off the main thread (`#[tauri::command(async)]`), so large asset installs, dedup scans and network `.duf` walks no longer freeze the window. Also: asset installs skip directory junctions instead of following them (a junction cycle could previously loop forever while copying), nested asset zips share their outer archive's decompression budget instead of minting fresh allowances, a failed quarantine move cleans up its partial copy, GitHub release lookups time out after 10s instead of hanging, closed windows drop their project mapping, Home-window creation no longer races itself, and the New Project menu item builds its window off the main thread like every other window path.

- [#350](https://github.com/polynaut/dth-character-studio/pull/350) [`0348765`](https://github.com/polynaut/dth-character-studio/commit/0348765bd88b4c64f5708a3f70a8f83e67140dc7) Thanks [@polynaut](https://github.com/polynaut)! - The network-drive remap result (`ensure_network_drives`) now goes through the FFI contract regime like every other structured return: zod-parsed at the invoke boundary (no more bare `invoke<T>()` cast) and pinned by a shared `contracts/remap-results.json` fixture tested on both the serde and zod side. The phantom `'unsupported'` status that no Rust path ever produced is gone from both sides. Remap failures for Explorer "reconnect at sign-in" mappings (Windows errors 1201/1202) now get actionable messages instead of a bare error number, and very long UNC paths no longer misreport as "unmapped".

## 0.44.2

## 0.44.1

## 0.44.0

## 0.43.1

## 0.43.0

## 0.42.6

## 0.42.5

## 0.42.4

### Patch Changes

- [#330](https://github.com/polynaut/dth-character-studio/pull/330) [`0b0805f`](https://github.com/polynaut/dth-character-studio/commit/0b0805f2af9127432643bd695272035d4165bdca) Thanks [@polynaut](https://github.com/polynaut)! - Two editor fixes: the sticky header's scroll-in "Back" link no longer shows up immediately on the Notes tab (on a page too short to scroll the scroll timeline is inactive, so the link fell back to its visible base state — it now defaults to hidden, and the run-error hint gets the same guard), and the "Modify JCM frames" header is no longer a button wrapping the info popup's button (invalid HTML that React flagged and assistive tech misreads). Under the hood, the Rust↔TS boundary is now pinned by shared contract fixtures — serde round-trips and the api layer's zod schemas validate the same JSON on both sides, and the frame-measurement result is parsed at the boundary instead of blindly cast.

## 0.42.3

## 0.42.2

## 0.42.1

### Patch Changes

- [#318](https://github.com/polynaut/dth-character-studio/pull/318) [`822ceaf`](https://github.com/polynaut/dth-character-studio/commit/822ceafafb2d9b12a8a97383a4676bdfd04c7651) Thanks [@polynaut](https://github.com/polynaut)! - Settings grew an "App Data" tab (app data folder + storage housekeeping, moved out of General/Tools), the Project tab leads in project windows, network drives got their own pane at the bottom of General, and the import picker's rows expand to a copyable path chip instead of a tooltip. Tooltips app-wide now wrap long paths correctly. The "Empty quarantine" button is gone — the dedup quarantine is a plain folder you manage yourself in Explorer.

## 0.42.0

## 0.41.42

## 0.41.41

## 0.41.40

## 0.41.39

## 0.41.38

## 0.41.37

## 0.41.36

## 0.41.35

## 0.41.34

## 0.41.33

## 0.41.32

## 0.41.31

## 0.41.30

## 0.41.29

## 0.41.28

## 0.41.27

## 0.41.26

## 0.41.25

## 0.41.24

## 0.41.23

## 0.41.22

## 0.41.21

## 0.41.20

## 0.41.19

### Patch Changes

- [#252](https://github.com/polynaut/dth-character-studio/pull/252) [`45ec4d4`](https://github.com/polynaut/dth-character-studio/commit/45ec4d4ee707dcd73aba47ec59468241a6567ad5) Thanks [@polynaut](https://github.com/polynaut)! - Bring the target app to the foreground after "Open in …". Opening a scene in an
  already-running Daz Studio (or a Houdini `.hip` / Unreal `.uproject`) loaded it
  behind the studio window; the studio now focuses the app's window afterwards. It's
  best-effort and Windows-only — a no-op when the app isn't running yet (a fresh
  launch focuses itself) or on other platforms.

## 0.41.18

## 0.41.17

### Patch Changes

- [#245](https://github.com/polynaut/dth-character-studio/pull/245) [`b8a4296`](https://github.com/polynaut/dth-character-studio/commit/b8a4296dcebb3a0f53890ab16a5f282d4b643c1b) Thanks [@polynaut](https://github.com/polynaut)! - Enable the WebView2 inspector (right-click → Inspect, F12) in installed/release
  builds, not just dev — this is a self-hosted tool and it helps debug the shipped
  app against a live Daz Studio.

  Make "Open in Daz" observable when a running Daz doesn't react: the bridge script
  now reports a failed open with a message box (so it's no longer silent — and if
  no box appears at all, the running instance never executed the forwarded script),
  and the web side logs which Daz executable it launched to the console.

## 0.41.16

### Patch Changes

- [#242](https://github.com/polynaut/dth-character-studio/pull/242) [`0de21ad`](https://github.com/polynaut/dth-character-studio/commit/0de21ada2f04dd02f7583fa5fc3eaac80431fc6b) Thanks [@polynaut](https://github.com/polynaut)! - Show the native menu bar (Main / Help) on every window. Only the startup "main"
  window received the app menu; project windows and any extra Home windows opened at
  runtime came up with no menu bar. Each runtime window now builds and sets the same
  menu itself, so New Project / Refresh assets / About / Check for Updates are
  reachable from any window.

## 0.41.15

### Patch Changes

- [#240](https://github.com/polynaut/dth-character-studio/pull/240) [`0a66525`](https://github.com/polynaut/dth-character-studio/commit/0a66525d07d155dea9e04e1f996d4e2817a1f750) Thanks [@polynaut](https://github.com/polynaut)! - Fix "Open in Daz" launching the scene-open bridge script in a text editor instead
  of Daz Studio. Opening a scene while Daz is already running writes a one-shot
  `.dsa` and previously shell-opened it, which follows the OS file association — on
  machines where `.dsa` is bound to an editor (e.g. VS Code on a dev box) the script
  just opened as text and the scene never loaded. The bridge now launches the
  running Daz instance's own executable with the script as its argument
  (association-independent), and only falls back to the shell-open if the executable
  can't be located.

## 0.41.14

### Patch Changes

- [#238](https://github.com/polynaut/dth-character-studio/pull/238) [`5df102a`](https://github.com/polynaut/dth-character-studio/commit/5df102a20ba8f1cd8a74a3f42829ed105eef2a33) Thanks [@polynaut](https://github.com/polynaut)! - Block saving a character while a custom section has empty required fields (a pose
  with no name, no morph, or an empty morph name), and jump straight to the problem:
  the offending section opens, its pose row scrolls into view and the first empty
  field is focused. A toast names the first error (or the count when there are
  several).

## 0.41.13

## 0.41.12

## 0.41.11

## 0.41.10

## 0.41.9

## 0.41.8

## 0.41.7

## 0.41.6

## 0.41.5

### Patch Changes

- [#211](https://github.com/polynaut/dth-character-studio/pull/211) [`7b3b101`](https://github.com/polynaut/dth-character-studio/commit/7b3b101d0d490fb3cc941509b0d3f881c94ea374) Thanks [@polynaut](https://github.com/polynaut)! - Pressing Alt while hovering a reveal target (path chip, Daz/Houdini/Unreal
  card) no longer arms the native menu bar — the key is treated as the
  show-in-Explorer modifier there. Alt anywhere else keeps its normal menu
  behavior.

## 0.41.4

### Patch Changes

- [#209](https://github.com/polynaut/dth-character-studio/pull/209) [`4df5164`](https://github.com/polynaut/dth-character-studio/commit/4df5164c8d82d8f9b960272df4d182d4b55e7ec0) Thanks [@polynaut](https://github.com/polynaut)! - The character page's Back links are truly gray now (the global link color was
  overriding them), and holding Alt over a Daz scene / Houdini / Unreal card
  swaps its open icon for a folder icon — previewing the show-in-Explorer click,
  same as the path chips. The Daz scenes / Houdini chips dim everything through
  the character folder, so only the actual subfolder reads bright.

  The reveal hotkey moved from Shift+click to **Alt+click** everywhere (chips and
  cards) — Shift+click was selecting text along the way.

## 0.41.3

### Patch Changes

- [#207](https://github.com/polynaut/dth-character-studio/pull/207) [`2d3e0c0`](https://github.com/polynaut/dth-character-studio/commit/2d3e0c060a740a2e306e37331def93553081f02b) Thanks [@polynaut](https://github.com/polynaut)! - Back navigation aligned: every back link is simply "Back", always orange —
  and the character page's sticky header grows its own Back link that fades in
  as you scroll, so navigating back never requires scrolling up first. The
  Unreal bar's empty-state button is just "+ Link" now.

- [#207](https://github.com/polynaut/dth-character-studio/pull/207) [`2d3e0c0`](https://github.com/polynaut/dth-character-studio/commit/2d3e0c060a740a2e306e37331def93553081f02b) Thanks [@polynaut](https://github.com/polynaut)! - G8.1 characters no longer show the "experimental" tag when the standard
  DQS + JCM/FAC preset setup matches — regardless of which DTH release is
  active. G8.1 CSVs target the old-Houdini pipeline's HDA and the G8.1 assets
  are identical across releases, so the validated 188-frame template applies
  either way.

- [#207](https://github.com/polynaut/dth-character-studio/pull/207) [`2d3e0c0`](https://github.com/polynaut/dth-character-studio/commit/2d3e0c060a740a2e306e37331def93553081f02b) Thanks [@polynaut](https://github.com/polynaut)! - Notes render as markdown by default — the Write/Preview tabs are gone. A small
  pencil appears when hovering the notes (an empty note is fully clickable) to
  switch into the editor; Done or Escape returns to the rendered view.

## 0.41.2

### Patch Changes

- [#205](https://github.com/polynaut/dth-character-studio/pull/205) [`cb72bf3`](https://github.com/polynaut/dth-character-studio/commit/cb72bf3ec92d0f0d46e0590d14ae85e6529201c8) Thanks [@polynaut](https://github.com/polynaut)! - The Unreal card's install button keeps it short — tooltip is just "Install DTH
  Content" — and holding Ctrl lights the dimmed button back up on already-
  bootstrapped projects, hinting that a click now re-installs. Path chips
  preview their alternate action too: holding Shift swaps the hover copy icon
  for an open-folder icon.

## 0.41.1

### Patch Changes

- [#203](https://github.com/polynaut/dth-character-studio/pull/203) [`69d0105`](https://github.com/polynaut/dth-character-studio/commit/69d01052a02439ba34ebed68e99c4eb418ddd838) Thanks [@polynaut](https://github.com/polynaut)! - Shift+click "show in Explorer" now also works on the Daz scene cards and the
  Houdini project cards — the one hotkey everywhere: plain click opens the file
  in its app, Shift+click reveals its folder.

## 0.41.0

### Minor Changes

- [#200](https://github.com/polynaut/dth-character-studio/pull/200) [`00912f4`](https://github.com/polynaut/dth-character-studio/commit/00912f4e02bda8aa62a2e0ab2d67f3961362970f) Thanks [@polynaut](https://github.com/polynaut)! - "Modify JCM frames" — a proper grid UI in the JCM section for bone-rotation
  morph drives (formerly a raw JSON array buried in Advanced Options). Add rules
  (bone + rotation axis) and per-rule morph drives with angle→value ranges split
  by rotation direction; the Morph name field autocompletes from the scanned
  morph index. The old JSON textarea is gone.

- [#200](https://github.com/polynaut/dth-character-studio/pull/200) [`00912f4`](https://github.com/polynaut/dth-character-studio/commit/00912f4e02bda8aa62a2e0ab2d67f3961362970f) Thanks [@polynaut](https://github.com/polynaut)! - Unreal project cards grew up: bigger cards (name + folder) in the footer bar,
  each with a tiny install button that bootstraps the Unreal project with DTH —
  one click copies the linked DTH release's Unreal Engine content into the
  project's `Content/DazToHue`, making a fresh Unreal project DTH-ready in an
  instant. The button dims once the content exists; Ctrl+click always installs
  (overwrite from the currently selected release — files are copied over, never
  deleted first). Unreal linking + content syncing is now in the getting-started
  guide.

### Patch Changes

- [#201](https://github.com/polynaut/dth-character-studio/pull/201) [`635ce6f`](https://github.com/polynaut/dth-character-studio/commit/635ce6f3fff7f57b86f9a3873bb8fee7192ba1aa) Thanks [@polynaut](https://github.com/polynaut)! - Unreal cards now correctly detect installed DTH content (the check always read
  "missing" for normal Windows paths, leaving the install button hot on projects
  that already had `Content/DazToHue` — it re-checks natively now). And
  Shift+click is the app-wide "show in Explorer" hotkey: on an Unreal card it
  opens the project's folder, on any path chip it replaces the old Ctrl+click.
  The chips' hover tooltip is gone — the behaviors are documented in the guide.

## 0.40.0

### Minor Changes

- [#198](https://github.com/polynaut/dth-character-studio/pull/198) [`9fa6c2e`](https://github.com/polynaut/dth-character-studio/commit/9fa6c2e036d401dcfe272e0c877f308252ed6776) Thanks [@polynaut](https://github.com/polynaut)! - Unreal project cards grew up: bigger cards (name + folder) in the footer bar,
  each with a tiny install button that bootstraps the Unreal project with DTH —
  one click copies the linked DTH release's Unreal Engine content into the
  project's `Content/DazToHue`, making a fresh Unreal project DTH-ready in an
  instant. The button dims once the content exists; Ctrl+click always installs
  (overwrite from the currently selected release — files are copied over, never
  deleted first). Unreal linking + content syncing is now in the getting-started
  guide.

## 0.39.0

### Minor Changes

- [#196](https://github.com/polynaut/dth-character-studio/pull/196) [`8702758`](https://github.com/polynaut/dth-character-studio/commit/870275802ebc6f36bf4cdf8b5f45f1cb4fbcc4ae) Thanks [@polynaut](https://github.com/polynaut)! - G8.1 PoseAsset CSVs are validated now — no more "experimental" for the
  standard setup. Ground truth came from a working DTH 1.9.6 PoseAsset node
  (old-Houdini pipeline): a G8.1 character with DQS + JCM/FAC presets and a
  pre-2.0 DTH release selected gets the full 188-frame preset template spliced
  with its custom sections, exactly like G9. The CSV "era" boundary moved to
  DTH 2.0 where the control-row format actually flipped (CTL → CURVE — the G9
  template now correctly requires a 2.0+ release, and releases 2.0–2.4.3 count
  as one era, so switching among them no longer flags characters stale). The
  editor's experimental tag now reflects the real per-configuration validation.

## 0.38.0

### Minor Changes

- [#194](https://github.com/polynaut/dth-character-studio/pull/194) [`98228d1`](https://github.com/polynaut/dth-character-studio/commit/98228d1c66f4498bdb66a782d0e416600f751260) Thanks [@polynaut](https://github.com/polynaut)! - Multiple Houdini installations: Settings can now hold additional Houdini
  documents folders (older/parallel Houdini versions), each with its own Dry
  run/Install pair for the DTH release's Houdini assets. Pick an older release
  in the version dropdown, install it into the old Houdini's folder, switch the
  dropdown back — the old Houdini keeps the old DTH while your primary stays
  current.

- [#193](https://github.com/polynaut/dth-character-studio/pull/193) [`dbdc712`](https://github.com/polynaut/dth-character-studio/commit/dbdc7121ece1a21127abd3457d96769c502e8f0a) Thanks [@polynaut](https://github.com/polynaut)! - Opening a linked Daz scene now works while Daz Studio is already running. Daz
  (DS 6) silently ignores scene files forwarded to a running instance — Explorer
  double-click does nothing either. The studio detects the running instance and
  routes the open through a one-shot script instead, which Daz forwards and
  executes: the scene opens inside the running instance, with Daz's normal
  unsaved-changes prompt. No instance running → unchanged direct open.

## 0.37.0

### Minor Changes

- [#191](https://github.com/polynaut/dth-character-studio/pull/191) [`910f80f`](https://github.com/polynaut/dth-character-studio/commit/910f80f20d8a6e1d7c6614883f5b306e8254cd96) Thanks [@polynaut](https://github.com/polynaut)! - "Run the export with the ROM script" no longer exports when the ROM build had
  ANY problem. Runtime v20: failed morphs count as failure too (not just hard
  aborts), so a ROM with broken frames can never ship a PoseAsset CSV/FBX as if
  it were good — fix the problem and re-run. Regenerate scripts via Tools →
  Refresh assets (or any character save).

### Patch Changes

- [#190](https://github.com/polynaut/dth-character-studio/pull/190) [`2efabc0`](https://github.com/polynaut/dth-character-studio/commit/2efabc06c603eff60fe697c319fa35b072966285) Thanks [@polynaut](https://github.com/polynaut)! - Confirming "Yes" on the unsaved-changes dialog when closing the window now
  actually closes it. Registering a close-requested listener makes Tauri hold
  every close and destroy the window from the JS side afterwards — and that
  destroy call needed a permission the app never granted, so the window
  silently stayed open.

## 0.36.3

### Patch Changes

- [#187](https://github.com/polynaut/dth-character-studio/pull/187) [`c3261bf`](https://github.com/polynaut/dth-character-studio/commit/c3261bfd824987ed2936b72c75d38a563a8bbc55) Thanks [@polynaut](https://github.com/polynaut)! - Hardening: zip extraction is bounded (ratio-based size + entry caps) against decompression bombs; recursive-delete rails run on canonicalized paths; a hostile manifest charactersSubdir can no longer traverse outside the project; character schema strings carry generous size bounds; the app has a styled root error boundary.

- [#188](https://github.com/polynaut/dth-character-studio/pull/188) [`198ea5a`](https://github.com/polynaut/dth-character-studio/commit/198ea5a43a4bb5a626f2999954435d501f83d2b8) Thanks [@polynaut](https://github.com/polynaut)! - Notes integrity: autosave failures surface as a toast, and concurrent edits from a second window are detected instead of silently overwritten (reload option offered). Note media is garbage-collected — unreferenced files are removed after an hour on save, with a 7-day housekeeping backstop — and `.duf` preset decompression is bounded.

- [#185](https://github.com/polynaut/dth-character-studio/pull/185) [`f2eb122`](https://github.com/polynaut/dth-character-studio/commit/f2eb1228e74ccdd73b55a0390745394d7c984827) Thanks [@polynaut](https://github.com/polynaut)! - Internal: split the desktop crate's lib.rs into focused modules (no behavior change).

## 0.36.2

### Patch Changes

- [#179](https://github.com/polynaut/dth-character-studio/pull/179) [`a868c65`](https://github.com/polynaut/dth-character-studio/commit/a868c650705ade11ff970c307debb5adced1f0d9) Thanks [@polynaut](https://github.com/polynaut)! - The slide-in drawers (New project, Create character, …) animate reliably again
  — they used to pop in without the transition when the open raced the first
  paint.

- [#180](https://github.com/polynaut/dth-character-studio/pull/180) [`01d5a0f`](https://github.com/polynaut/dth-character-studio/commit/01d5a0f9de90b2ebaa63b8614bf213312e6be4b3) Thanks [@polynaut](https://github.com/polynaut)! - Linked Unreal projects moved into a footer bar docked to the bottom of the
  project window — always visible, compact chips that open the project in Unreal
  on click (folder in the tooltip, hover ✕ unlinks), with the picker and
  drag-drop linking right on the bar.

## 0.36.1

### Patch Changes

- [#177](https://github.com/polynaut/dth-character-studio/pull/177) [`172029c`](https://github.com/polynaut/dth-character-studio/commit/172029c552f2fe0e6e6ee0f7da70dda9a838714d) Thanks [@polynaut](https://github.com/polynaut)! - Opening linked Unreal projects works now — the desktop shell-open scope only
  allowed `.duf`/`.hip` files (and https links), so clicking an Unreal card,
  Ctrl+clicking a path chip (folder reveal) or opening non-image note media was
  silently refused. The scope now covers `.uproject`, folders, and the common
  image/video/audio/document/3D media formats (executables stay refused), and
  those open actions surface errors as a toast instead of doing nothing.

## 0.36.0

### Minor Changes

- [#172](https://github.com/polynaut/dth-character-studio/pull/172) [`a2accc6`](https://github.com/polynaut/dth-character-studio/commit/a2accc6ae3bd75041a894904789be7e4f54e7477) Thanks [@polynaut](https://github.com/polynaut)! - Project & character notes — a markdown editor (Write/Preview) on a new Notes
  tab of both the project page and the character page. Autosaves while you type,
  and dropped images/media files are stored with the project (like avatar
  images, under `.dcsmeta/media`) with the right markdown tag inserted at the
  cursor — images render inline in the preview, other media opens with its
  default app. Notes live as plain `notes.md` / `<Name>.notes.md` files next to
  what they describe, so they back up (and read) like everything else.

- [#171](https://github.com/polynaut/dth-character-studio/pull/171) [`8f96436`](https://github.com/polynaut/dth-character-studio/commit/8f96436a67608dc1115a7add87cfe239d5c21bb3) Thanks [@polynaut](https://github.com/polynaut)! - Link Unreal projects to a studio project. The project page gets an "Unreal
  projects" section above the character list: link one or more `.uproject` files
  (picker or drag-and-drop), shown as prominent cards like the character pages'
  Daz scenes / Houdini projects — clicking a card opens the project in Unreal
  Engine. Links only: files stay where they are, unlinking never deletes.

- [#175](https://github.com/polynaut/dth-character-studio/pull/175) [`0f7db81`](https://github.com/polynaut/dth-character-studio/commit/0f7db818b6675ca6afd515eb7d54254adec7ceec) Thanks [@polynaut](https://github.com/polynaut)! - Unsaved changes are guarded now: navigating away from a character editor (or
  the Settings page) with unsaved edits asks "leave and lose them?" first —
  closing or reloading the window warns too. Deleting the character skips the
  question (there is nothing left to save).

### Patch Changes

- [#172](https://github.com/polynaut/dth-character-studio/pull/172) [`a2accc6`](https://github.com/polynaut/dth-character-studio/commit/a2accc6ae3bd75041a894904789be7e4f54e7477) Thanks [@polynaut](https://github.com/polynaut)! - Path chips: Ctrl+click opens the path directly in the Windows Explorer (a file
  path opens its parent folder) — plain click still copies. And the Settings
  page now hints where a Daz Studio installation is usually found.

- [#173](https://github.com/polynaut/dth-character-studio/pull/173) [`90c52f7`](https://github.com/polynaut/dth-character-studio/commit/90c52f7003c51dd52a83f3c17bea56fd70042239) Thanks [@polynaut](https://github.com/polynaut)! - Morph autocomplete: suggestions now show the Daz UI name on its own labeled
  line ("Daz UI name: …"), never truncated — a match on the UI name (e.g.
  searching "GPL*…" where the internal name is "GP*…") is clearly readable
  instead of looking like a wrong suggestion. The match tag spells it out too
  ("UI name match" / "internal match").

## 0.35.0

### Minor Changes

- [#170](https://github.com/polynaut/dth-character-studio/pull/170) [`14f3ed3`](https://github.com/polynaut/dth-character-studio/commit/14f3ed3c9899cfd732530f7293557a6e05a9df58) Thanks [@polynaut](https://github.com/polynaut)! - The Daz scenes subfolder is now editable on an existing character: the scenes
  folder chip grows a small pencil — editing the subfolder physically moves the
  folder on disk and repoints every linked scene, so nothing breaks. Path chips
  in general now support an optional edit affordance.

- [#169](https://github.com/polynaut/dth-character-studio/pull/169) [`bb695ef`](https://github.com/polynaut/dth-character-studio/commit/bb695efae90d970981a36fd191045a94f3c8a9c8) Thanks [@polynaut](https://github.com/polynaut)! - App-styled tooltips everywhere. Every `title` attribute in the app now shows a
  proper tooltip — rounded, drop-shadowed, on the app's popover surface, smartly
  positioned by Floating UI (flips/shifts at viewport edges) — instead of the
  browser's plain native tooltip. One global host intercepts hover/focus, so all
  existing and future `title=` usage migrates automatically; keyboard focus shows
  the tooltip instantly, and icon-only controls keep an accessible name.

### Patch Changes

- [#167](https://github.com/polynaut/dth-character-studio/pull/167) [`1e1ae08`](https://github.com/polynaut/dth-character-studio/commit/1e1ae082e238f41dbfc2c508809c3340adec18bd) Thanks [@polynaut](https://github.com/polynaut)! - The update dialog now names the installed version as the reference point:
  "Version 0.34.0 is ready to install — you have 0.33.0."

## 0.34.0

### Minor Changes

- [#166](https://github.com/polynaut/dth-character-studio/pull/166) [`f6259cd`](https://github.com/polynaut/dth-character-studio/commit/f6259cdd2261697ec4bf4e2dd82649beadc9371b) Thanks [@polynaut](https://github.com/polynaut)! - Genesis 8 / 8.1 support. Both generations are now selectable for characters;
  everything is driven by what the installed DTH release actually ships per
  generation: G8.1 gets the full JCM (DQS/Linear) + FAC flow, plain G8 is
  Linear-only (no DQS/FAC assets exist), and Golden Palace / Dicktator / Physics
  remain G9-only — enabling a section whose asset doesn't exist for the
  generation fails loud with a clear message. New ROM entries default to the
  generation's base-figure node (Genesis8_1Female, Genesis8Male, …) instead of
  always Genesis9, skinning defaults to Linear where DTH ships no DQS ROM, and
  the runtime (v19) skips the G9-only mouth ROM pass and FACS/flexion strength
  dials on non-G9 figures instead of failing or logging spurious errors. The
  PoseAsset CSV for non-G9 characters uses the measured custom-sections path
  (the G9 ground-truth template stays G9-only for now).

- [#165](https://github.com/polynaut/dth-character-studio/pull/165) [`fd9fdd9`](https://github.com/polynaut/dth-character-studio/commit/fd9fdd927501acca778b606bb259d41655accb71) Thanks [@polynaut](https://github.com/polynaut)! - Morph scanner scripts + Morph-name autocomplete. The runtime install (v18) now
  also drops visible `Scan_Morphs_G9/G8.1/G8/G3` scripts into the DTH Character
  Studio scripts root: run one on a freshly created (unrenamed) figure in Daz and
  it scans everything dialable on the figure and all its descendants — delta
  morphs AND controller/ERC dials, across geografts like Golden Palace /
  Dicktator, nipples/navel add-ons, fitted clothing — into a per-generation
  JSON index in the studio's app folder. Once an index exists, the
  ROM editor's Morph name fields autocomplete against it: search by the Daz UI
  label or the internal name (each suggestion tags which one matched and the node
  the morph lives on), and picking a suggestion fills in both the internal morph
  name and the correct node.

### Patch Changes

- [#162](https://github.com/polynaut/dth-character-studio/pull/162) [`8888219`](https://github.com/polynaut/dth-character-studio/commit/88882194e18a8f366f95ca250c4fb6ab6af87b1d) Thanks [@polynaut](https://github.com/polynaut)! - **Main → New Project opens the create-project panel again.** The menu entry
  focused/opened the Home window but never opened the dialog. Now an
  already-running Home window gets told to open the panel, and a freshly created
  one starts with it open.

## 0.33.0

### Patch Changes

- [#158](https://github.com/polynaut/dth-character-studio/pull/158) [`70b1f54`](https://github.com/polynaut/dth-character-studio/commit/70b1f54fa7c6638274adf34b084e1975b3814212) Thanks [@polynaut](https://github.com/polynaut)! - **The update dialog now shows what you skipped.** When the installed version is
  several releases behind, the dialog still renders the latest release's notes in
  full — and below them lists the in-between releases (newest first, up to 3) as
  links to their GitHub release pages, so the catch-up path is one click away.

## 0.32.3

## 0.32.2

## 0.32.1

### Patch Changes

- [#144](https://github.com/polynaut/dth-character-studio/pull/144) [`37cd0dc`](https://github.com/polynaut/dth-character-studio/commit/37cd0dcd50ddda8e8f9be99a4f234a49120bb1d0) Thanks [@polynaut](https://github.com/polynaut)! - **Webview hardening: strict Content-Security-Policy + asset protocol disabled.**
  The webview previously ran with no CSP and an enabled asset protocol. Now: a
  strict production CSP (`default-src 'self'`, images restricted to inlined `data:`
  URLs, IPC-only network, no frames/objects) with a dev-only relaxation for Vite
  HMR, and the asset protocol is fully disabled — the app inlines all images and
  never used it. Defense-in-depth: an XSS would now be contained by the CSP instead
  of inheriting the webview's full reach.

## 0.32.0

## 0.31.3

## 0.31.2

## 0.31.1

## 0.31.0

### Patch Changes

- [#124](https://github.com/polynaut/dth-character-studio/pull/124) [`fff1b23`](https://github.com/polynaut/dth-character-studio/commit/fff1b236efbc85e37268d2665a9531000266b82c) Thanks [@polynaut](https://github.com/polynaut)! - **Harden the native file operations** (from a full app audit):

  - **Uninstall Daz can no longer wipe your Documents.** The "Prefill" list stopped deriving a delete candidate from the _parent_ of your DAZ library (typically your whole Documents folder) — it now lists the library folder itself. On top of that, `uninstall_daz`, `empty_folder` (quarantine), and the housekeeping sweep now refuse to recursively delete a drive/profile root or a too-shallow path, and the uninstall additionally refuses any folder that isn't Daz-owned ("DAZ" in the path) — so even a corrupt settings value can't trigger a catastrophic delete.
  - **Recursive walks no longer follow symlinks/junctions**, so the housekeeping sweep can't escape its tree to delete files elsewhere and can't loop forever on a junction cycle.
  - **Houdini presets now MERGE** instead of deleting the destination folder first — a mis-named source can't wipe an arbitrary Houdini subfolder, and a mid-copy failure can't leave a half-install.
  - **`houdini.env` is never clobbered** on a read error / non-UTF-8 content (it used to treat an unreadable file as empty and overwrite it).
  - **DazToHue-Scripts install swaps atomically** (old moved aside, restored on failure) instead of delete-then-copy.
  - **Dedup keeper selection fixed**: the Genesis rank read the _last_ number in the folder name, so "\_genesis 9 (2024)" ranked 2024 and the "newer Genesis wins" rule silently inverted — it now reads the first number after "genesis". Name collisions in the quarantine are disambiguated instead of silently leaving a duplicate installed.
  - Window-management commands recover from a poisoned lock, and opening a project holds the window map lock across the whole find→allocate→insert so two racing launches can't map to the wrong window.

## 0.30.0

### Minor Changes

- [#120](https://github.com/polynaut/dth-character-studio/pull/120) [`ce51879`](https://github.com/polynaut/dth-character-studio/commit/ce51879339675f325938d2011c9e422a26eb168b) Thanks [@polynaut](https://github.com/polynaut)! - **Housekeeping: the studio's own generated data can no longer fill your disk.** The two things that used to accumulate unbounded are now managed:

  - **Product-scan files** (the per-Daz-scene CSVs + diagnostics under app-data) **age out after 30 days** — swept automatically on every app launch, and on demand via a new **Tools → Storage & housekeeping → "Clean up now"** button (reports how much it freed). Deleting a character now also removes its scan folder and avatar immediately, so nothing orphans.
  - **The dedup quarantine** (redundant Daz assets you moved aside — a large, reversible backup) is shown with its size in the same section, with an **"Empty quarantine"** button (with a confirm). It's never emptied automatically — you decide when the backup is safe to reclaim.

  Everything else the app writes was already bounded (run logs overwrite, generated artifacts self-prune, temp files self-delete, recents capped). New native commands: `housekeeping_sweep`, `folder_stats`, `empty_folder`.

## 0.29.2

## 0.29.1

## 0.29.0

## 0.28.0

### Minor Changes

- [#106](https://github.com/polynaut/dth-character-studio/pull/106) [`18e6787`](https://github.com/polynaut/dth-character-studio/commit/18e6787b82c74d7291c7164692487490ede09613) Thanks [@polynaut](https://github.com/polynaut)! - **Setup DTH Release** split into two independent installs, each with its own Dry run / Install buttons placed directly under its destination folder field: **Daz content** under "My DAZ 3D Library", **Houdini assets** under "Houdini documents folder". Each half is enabled by its own prerequisites (a resolved DTH release + its destination folder), so you can install only the Daz side or only the Houdini side. The Daz install still re-scans the release's poses on success; the native `install_dth_release` command gained a `target` selector (`daz` / `houdini` / `all`).

## 0.27.0

### Minor Changes

- [#101](https://github.com/polynaut/dth-character-studio/pull/101) [`38aafd3`](https://github.com/polynaut/dth-character-studio/commit/38aafd3a0e5bfd3a0669b60800e4e6e27f4ec7fc) Thanks [@polynaut](https://github.com/polynaut)! - Add **Daz Products** — an opt-in, per-project scan of which Daz products a character uses. Turn it on in **Settings → Project → Enable Daz Products** (off by default). Each character then gets a generated **`Scan_Products_<Character>.dsa`** alongside its ROM script. Open the character's scene in Daz, run the script, and it analyses the open scene — walking used nodes + non-zero morphs and each node's material texture paths — then matches them to your installed products and writes a CSV the studio reads back.

  Set the **DAZ Install Manager manifests folder** in **Settings → General** (with a one-click **Detect installed location**) so the scan can resolve assets to real product **names, SKUs, artists and versions**; without it the scan still lists the used assets. Back on the character page, enabling the feature splits the editor into **Character** and **Products** tabs (the tabs appear only when Daz Products is on, so the scan never crowds the character form). The **Products** tab surfaces the results — a table of matched products plus an expandable list of unmatched assets (with their source files) — and a **Store on character** action persists them onto the character definition. A **Clear** button (active only while there are scan results to discard) wipes the per-scene CSVs to start fresh, leaving any products already stored on the character untouched. The tab is split into two panels: a **Scan files** panel that always shows which per-scene CSVs back the results — their output folder, and a row per scene with its source `.duf` path, product/unmatched counts and when it was last written — so it's clear what Check / Clear / Store act on and which Daz scene each scan came from; and a separate **Matched products** panel with the listing itself. Once you've stored products, a status banner makes the relationship to the files on disk explicit either way: a green **Up to date** when nothing on disk is newer than your last save, or an amber **scan changed since you last stored** (with the counts — e.g. "11 found now vs 9 stored" — and the save time) when a re-scan has produced new results. The store button follows suit, settling into a disabled **Stored — up to date** instead of an always-active "Update stored products". Each product row **expands** to list the exact scene morph(s)/node(s) that found it (each tagged Morph/Node), so you can see precisely why it's there. Store products (those with a DIM SKU) link out to their **Daz product page**, and scene render-setting singletons (the Tonemapper/Environment "Options" nodes) are excluded so they don't clutter the unmatched list. The **Match** column header carries an info popup explaining each match method (File/Texture, SKU, Keyword, Third-Party, Genesis Base, Parent/Group, Manifest).

  Scans are tracked **per Daz scene**, so a character's outfit/look variants don't overwrite each other. The runtime reads the open scene (`Scene.getFilename()`) and writes one CSV per scene; the studio reads them all and merges, so each product and unmatched asset is tagged with the scene(s) it was found in — a **Scene(s)** column appears once more than one scene has been scanned. When more than one scene has been scanned, a **View** switch ("All scenes" plus one chip per scene) lets you flip between the merged table and a single scene's products; scoping to one scene drops the now-redundant Scene(s) column. Products and unmatched assets are listed **alphabetically**. Open an outfit scene, run the scan, repeat for the next outfit, and the results accumulate with their scene attribution.

  Each matched product shows **what it was used for** in the scene — a heuristic role (Morph, Clothing, Hair, Genitalia, Geograft, Accessory, Figure, …) derived from the assets that matched it, with the specific assets on hover — so you can tell _why_ a product is in the scene. Matching links a used item to its product even when their names share nothing (e.g. a glove node "ACGloves" from "Adventure Outfit"): it reads the node's **material texture paths** — the one file reference Daz exposes for a scene node — across _every_ map channel (diffuse, normal, bump, roughness, metallic, …, not just the base color, so a metal zipper or a procedurally-tinted flower with no diffuse map still matches) and maps their `vendor/product` folder to the product that installed it. A geograft wearing a _copy_ of the figure's body skin (common — the copy-textures workflow) is recognised: the figure's own skin folders are excluded so the geograft isn't mis-identified as the skin product. A texture-folder match is treated as proof the product is genuinely used, so it intentionally bypasses the Genesis prefilter — that's how a G8 outfit auto-fitted onto a G9 figure still matches. An unmatched clothing **sub-part** — a zipper, a flower trim, a dForce layer that loads as its own node parented to the garment — inherits the product its parent matched (a "Parent Match"), provided that parent isn't the base figure, so these stop landing in "unmatched". Sub-parts the scene parents to the _figure_ rather than the garment (so parent-inheritance can't reach them) are caught by a final **"Manifest Match"**: an unmatched node whose name is the basename of a file a product installs (a "Frangipani"/"Zipper" node ↔ `Frangipani.dsf`/`Zipper.dsf`) is attributed to that product — but only to a product _already matched elsewhere in the same scene_, so a generic part name can't pull in an unrelated library product. And a decoration that loads as an empty **group/null node** (no geometry, texture or own file) whose real parts are matched children inherits its children's product (a "Group Match"). Beyond that it is **prefiltered by the character's known Genesis version** (from the studio, not guessed): products for a different generation are rejected and, when several editions of a product are installed (e.g. a G8 _and_ a G9 Golden Palace), the one matching the character's generation wins. It also needs stronger keyword confidence (two distinct shared keywords — a lone generic word like "top" or "inside" can't anchor a match) and pulls in manually-installed (non-DIM) products from `LOCAL_USER_*` metadata so they match instead of landing in "unmatched". As a final resort it **synthesizes products from the content library's `data/<Vendor>/<Product>` folders** ("Content Folder Match"), so content that carries _no_ DIM or `LOCAL_USER` metadata at all — e.g. unofficial products — is still recognised, named by its folder and attributed to its vendor (with the real artist/version read from the content's own files). These run only after the metadata-backed products and are skipped when a real product already owns the folder/name, so they never duplicate or override a properly-tracked product. Products and unmatched assets are enriched with **artist + version read straight from each asset's own `.dsf`/`.duf` metadata** (the vendor's `author` + `revision`), which the DIM install manifests don't carry — content-relative paths are resolved under the library so the real revision surfaces instead of just the DIM build number, and for a matched product a representative file from its file list is read as a fallback. That file list comes from the DIM manifest for store products and from the `LOCAL_USER_*` metadata's own asset list for manual installs — so a manually-installed product like Golden Palace now surfaces its real vendor `author` + `revision` (read from its own `.duf`/`.dsf`) instead of "Unknown". Unmatched assets still show whatever artist/version their files carry.

  Mechanics: a new bundled runtime (`DthProducts.dsa`) is installed once next to the other DTH runtime files; each scan writes a per-scene CSV into an app-local-data folder keyed by project + character id; the character schema gains additive `products` / `productsUnmatched` / `productsScannedAt` fields (each product/asset also carrying the `scenes` it was found in — no migration needed). The runtime version bumped, so **Tools → Refresh assets** regenerates existing characters' scan scripts to the per-scene layout.

- [#101](https://github.com/polynaut/dth-character-studio/pull/101) [`38aafd3`](https://github.com/polynaut/dth-character-studio/commit/38aafd3a0e5bfd3a0669b60800e4e6e27f4ec7fc) Thanks [@polynaut](https://github.com/polynaut)! - **Tools → DazToHue-Scripts now tracks versions.** Installing records the exact commit it downloaded: the installer resolves the HEAD of `soltude/DazToHue-Scripts` `main`, downloads _that commit's_ tree (so the files always match the recorded SHA), and writes a `.dth-version.json` marker beside them. The tab then shows whether the installed scripts are **up to date** or an **update is available** by comparing that commit against the latest on GitHub — phrased and styled to match the DTH Exporter Plugin status (a green ✓ "Already installed (X) — up to date." line, **Install / Update / Reinstall** button). The check runs when the page opens and degrades to "couldn't check" when offline or rate-limited.

  The DTH Exporter Plugin status in Settings gets the matching treatment too — the same green checkmark on its "Already installed … up to date." line and consistent text sizing across all of its status lines.

- [#101](https://github.com/polynaut/dth-character-studio/pull/101) [`38aafd3`](https://github.com/polynaut/dth-character-studio/commit/38aafd3a0e5bfd3a0669b60800e4e6e27f4ec7fc) Thanks [@polynaut](https://github.com/polynaut)! - Projects are now **`.dcsp` files** ("DTH Character Studio Project") you can scatter anywhere on disk and open by double-clicking.

  - **File association + per-window projects.** The installer registers `.dcsp`; opening one launches (or, if the app is already running, adds) a window pinned to that project. Launching the app directly shows a **Home** launcher — recently opened projects plus **New project** / **Open project…** — and the app menu gains **New Project** (opens Home). Each window works on exactly one project.
  - **Self-contained projects.** A `.dcsp` is a small JSON manifest beside your character folders; per-project meta (avatars) lives next to it in a hidden `.dcsmeta/`. The app-data folder now holds only volatile, machine-specific state (the recent-projects list, machine/tool settings, network drives) — no project registry, no avatars.
  - **Split settings.** Machine/tool paths (DAZ library, Daz install, Houdini docs, DTH release/exporter) stay in **Settings**; per-project behaviour (the Daz/Houdini subfolder names) moved into each project's manifest and is edited from the project page's **Project settings**.
  - **Automatic one-time migration.** On first launch after updating, each previously known project gets a `.dcsp` (seeded from your old settings), its avatars move into the project's `.dcsmeta`, the recents list is built, and the old `projects.json` + app-data `images/` are removed. Unreachable projects are skipped and retried next launch.

- [#101](https://github.com/polynaut/dth-character-studio/pull/101) [`38aafd3`](https://github.com/polynaut/dth-character-studio/commit/38aafd3a0e5bfd3a0669b60800e4e6e27f4ec7fc) Thanks [@polynaut](https://github.com/polynaut)! - **Install/scan Daz assets** now looks inside wrapper downloads (a zip holding the real package zip). Some stores ship a product as an outer zip that holds only the license/instructions PDFs, a `.dsx` manifest and the actual DIM package zip (`IM…_Product.zip`) — since the outer archive itself has no `data`/`People`/`Runtime` folders, these downloads reported **"no Daz content"** and never installed. When an archive holds no content folders, the scan/install/dedup now descends into the zips inside it (two levels deep) and resolves the product's content there — so a wrapper download diffs, installs, and dedups exactly like a flat zip of the same content (including the "same files as …" duplicate hint against a flat copy). Content found in the archive itself still wins: a `.zip` that is _part_ of a product's content is installed as a file, not descended into.

### Patch Changes

- [#101](https://github.com/polynaut/dth-character-studio/pull/101) [`38aafd3`](https://github.com/polynaut/dth-character-studio/commit/38aafd3a0e5bfd3a0669b60800e4e6e27f4ec7fc) Thanks [@polynaut](https://github.com/polynaut)! - Fix **Install Daz assets** silently installing only a product's readme. The installer's content-root finder stopped at the first folder level that held _any_ recognised folder — and since `Documentation` counts as a (fallback) metadata folder, a product packaged as a top-level `Documentation/` beside a `My Library/` (or `Content/`) wrapper that holds the real `data`/`Runtime` resolved to the **Documentation folder at the root** and never descended into the wrapper. The result: the install copied the product's `Documentation/…README.pdf` into the library and skipped every morph/texture, so the content looked installed but was missing in Daz (a "Missing Files" prompt when opening a scene that used it).

  Real content folders (`data`/`People`/`Runtime`) found at any depth now take precedence over a `Documentation`-only folder at a shallower level; a Documentation-only level wins only when there's no real content anywhere (so a genuinely docs-only asset still reports as installed). Applies to both folder and `.zip` sources. Re-run **Tools → Optional → Install Daz assets** to install content that previous runs left as readme-only.

## 0.26.1

## 0.26.0

### Minor Changes

- [`46703e1`](https://github.com/polynaut/dth-character-studio/commit/46703e1a2478734fbe2281923eb497e3570b5be5) Thanks [@polynaut](https://github.com/polynaut)! - - **Native app menu** (desktop): **Main → Refresh assets / Exit** and **Help →
  About / Check for Updates**. Check for Updates now reports "you're on the latest
  version" / "not available in dev" when invoked from the menu.
  - **Avatar picker**: in the character image dialog, a row of linked Daz scene
    thumbnails lets you switch the main avatar to any scene's render. Avatars now use
    a content-versioned filename, so changing one live-updates everywhere (dialog,
    header, lists) without a reload.
  - **Tools**: the **DazToHue-Scripts** tab is now first and the default; its Save
    button is gone (it has no settings); a clear error with a **Settings** link shows
    when "My DAZ 3D Library" isn't set; and the intro links to the repo.
  - **About**: a paragraph crediting Soltude's **DazToHue-Scripts** (optional add-on)
    with a link straight to the in-app installer.

## 0.25.0

## 0.24.1

### Patch Changes

- [#85](https://github.com/polynaut/dth-character-studio/pull/85) [`0612d1f`](https://github.com/polynaut/dth-character-studio/commit/0612d1f87b81d39f1d34f17f05f652fd85a668ce) Thanks [@polynaut](https://github.com/polynaut)! - Fix: opening a linked Houdini project failed for `.hiplc` / `.hipnc` files with
  "Scoped command argument … failed regex validation". The shell `open` scope only
  matched `.hip` (anchored at the end), so the indie/non-commercial Houdini
  extensions were rejected. It now accepts `.hip`, `.hipnc`, and `.hiplc` (alongside
  `.duf` and http/https links).

## 0.24.0

### Minor Changes

- [#83](https://github.com/polynaut/dth-character-studio/pull/83) [`a51a795`](https://github.com/polynaut/dth-character-studio/commit/a51a795db9bbbac2a12190226b3417904cbfb480) Thanks [@polynaut](https://github.com/polynaut)! - Tools: add a **DazToHue-Scripts** tab that downloads the companion
  [soltude/DazToHue-Scripts](https://github.com/soltude/DazToHue-Scripts) repo — the
  Daz Studio scripts behind DTH Character Studio — straight from GitHub and installs
  it into `<My DAZ 3D Library>/Scripts/DazToHue-Scripts`. It delivers
  `DthScanFrames.dsa`, which exports the full morph list of an open Daz scene as a CSV
  you can pull into a character's ROM section via a section's **Import from CSV**.

  The download + unpack run natively (the webview can't fetch the archive — codeload's
  CORS only allows render.githubusercontent.com); GitHub's top-level wrapper folder is
  stripped, the zip is unpacked beside the destination and swapped in (so a failed
  download never leaves a half-written install), and re-installing replaces the folder
  with the latest version. Reuses the reqwest/rustls (ring) stack already in the build
  via the updater, so no new dependencies.

### Patch Changes

- [#83](https://github.com/polynaut/dth-character-studio/pull/83) [`a51a795`](https://github.com/polynaut/dth-character-studio/commit/a51a795db9bbbac2a12190226b3417904cbfb480) Thanks [@polynaut](https://github.com/polynaut)! - Fix: external links — the About page's GitHub link and links inside info popups —
  now open in the system browser. The shell `open` scope was limited to `.duf` /
  `.hip` paths, which silently rejected `https://` URLs; it now also allows http/https.

## 0.23.1

### Patch Changes

- [#81](https://github.com/polynaut/dth-character-studio/pull/81) [`0ecbcc6`](https://github.com/polynaut/dth-character-studio/commit/0ecbcc6da374ef0198f615e6dfebadfa6f83fcc3) Thanks [@polynaut](https://github.com/polynaut)! - Danger zone (uninstall-Daz cleanup) tweaks:

  - "Prefill folder paths" now also offers the Daz Studio app install folders `C:\Program Files\DAZ 3D\DAZStudio6` and `C:\Program Files\DAZ 3D\DAZStudio4`, so a full cleanup can also remove the application itself — not just its content/library folders.
  - Prefill now adds the **full** standard-folder list regardless of whether each one currently exists (no longer filtered at prefill time). Existence is checked when deleting — missing folders are reported as "not found" — so the list stays complete no matter Daz's install state. The "Daz must be installed" info popup was removed accordingly.

## 0.23.0

## 0.22.1

## 0.22.0

## 0.21.2

## 0.21.1

## 0.21.0

## 0.20.0

## 0.19.2

## 0.19.1

## 0.19.0

## 0.18.0

## 0.17.0

## 0.16.0

## 0.15.1

## 0.15.0

## 0.14.0

## 0.13.0

## 0.12.0

### Minor Changes

- [#35](https://github.com/polynaut/dth-character-studio/pull/35) [`36310ad`](https://github.com/polynaut/dth-character-studio/commit/36310ad1ff67db36af9348aebfe2c94373bcbaf4) Thanks [@polynaut](https://github.com/polynaut)! - Native OS drag-and-drop for Daz scenes (`.duf`), Houdini projects (`.hip`/`.hipnc`/`.hiplc`) and the character avatar image: drag a file from Explorer onto the **pane** where it's added — the whole area is the drop target, no need to aim at the Browse button, and it highlights while a supported file hovers it. Wired into the new-character scene picker, the editor's Daz scenes and Houdini projects fields, and the avatar image dialog. Built on Tauri's native webview drag-drop (hit-tested to the pane under the cursor), so it works with real Explorer files (HTML5 file drops don't fire when the webview captures OS drops).

## 0.11.0

## 0.10.0

### Minor Changes

- [#32](https://github.com/polynaut/dth-character-studio/pull/32) [`528ba6f`](https://github.com/polynaut/dth-character-studio/commit/528ba6fd041761fa29d5c4cd64f3b8394efe80a6) Thanks [@polynaut](https://github.com/polynaut)! - Measure pose-asset ROM frame lengths on the fly from the actual `.duf` files instead of hard-coding them. A native command (`pose_asset_frames`) reads each preset's DSON (gunzipping if needed) and returns `round(maxKeyTime × 30) + 1`; the base ROM, Golden Palace, Dicktator and Physics blocks are all measured per character — so custom assets (e.g. a user's own JCM `.duf`) work exactly like the DTH ones, and the generated PoseAsset CSV frame offsets are always correct. The editor's absolute frame numbers re-measure live as preset/custom selections change. Generation **hard-errors** if an included asset can't be read (never a silently wrong-length ROM); the `BASE_FRAMES_*`/`GP_FRAMES`/`DK_FRAMES`/`PHYS_FRAMES` constants are gone.

- [#30](https://github.com/polynaut/dth-character-studio/pull/30) [`f3f70d4`](https://github.com/polynaut/dth-character-studio/commit/f3f70d4a4578d60a459e79b63876d6bac5474096) Thanks [@polynaut](https://github.com/polynaut)! - Reorganized the DazToHue settings into two self-contained panes: **Setup DTH Release** (DTH release selection + My DAZ 3D Library + Houdini documents folder + install) and **Setup DTH Exporter Plugin Release** (Exporter Plugin selection + Daz Studio install folder + install). Each has its own dry-run, gating, and report, and the admin-sensitive plugin step fails with a clear "close all Daz and Houdini apps and restart as administrator" message. The Exporter pane also reads the version already installed in the Daz plugins folder and shows up-to-date / update-available, labelling its button Install / Update / Reinstall accordingly. The DazToHue-Scripts folder moved to General settings.

## 0.9.0

### Minor Changes

- [#28](https://github.com/polynaut/dth-character-studio/pull/28) [`0bb2151`](https://github.com/polynaut/dth-character-studio/commit/0bb2151e5c351d24f0b17b107bcba5349f420d3a) Thanks [@polynaut](https://github.com/polynaut)! - Remember mapped network drives (X: → \\host\share) as you pick paths and re-map any that are missing on startup — so the app keeps working after you relaunch it as administrator, when Windows hides your interactive drive mappings from the elevated session. A new "Network drives" section in Settings → General lists them with their status, a manual re-map, and a Forget action.

## 0.8.0

## 0.7.0

### Minor Changes

- [#24](https://github.com/polynaut/dth-character-studio/pull/24) [`d6d1f1e`](https://github.com/polynaut/dth-character-studio/commit/d6d1f1e01a20dfb0b4d3a6fec25287f253e193d9) Thanks [@polynaut](https://github.com/polynaut)! - One-click install of a DTH release and the Exporter Plugin into your local Daz Studio and Houdini — a native (Rust) port of the dth-cli install commands, with a dry-run preview and new optional settings for the Daz Studio install folder and the Houdini documents folder.

## 0.6.0

## 0.5.0

## 0.4.0

### Minor Changes

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - Add **Open in Daz** / **Link Daz scene** to the character editor. When a
  character's linked scene exists on disk, an "Open in Daz" button opens that
  `.duf` straight into Daz Studio. When the scene is missing (deleted or renamed)
  or was never linked, the button becomes "Link Daz scene": it opens a file picker
  and — if the chosen scene lives outside the project — offers (via the same modal
  as create) to copy it and its thumbnails into the character's folder. Linking
  persists immediately and refreshes the avatar from the new scene. The desktop
  shell `open` scope is widened to permit `.duf` paths (was http/tel/mailto only).

## 0.3.2

## 0.3.1

## 0.3.0

## 0.2.1

### Patch Changes

- [#6](https://github.com/polynaut/dth-character-studio/pull/6) [`d78e690`](https://github.com/polynaut/dth-character-studio/commit/d78e690659c17d20baef8aa23385c91d9515c08b) Thanks [@polynaut](https://github.com/polynaut)! - New app icon — the flame-swirl character-profile logo — across the installer, window, and taskbar.

## 0.2.0

### Minor Changes

- [#2](https://github.com/polynaut/dth-character-studio/pull/2) [`7131015`](https://github.com/polynaut/dth-character-studio/commit/71310154dfd5b07d4f2d1f150c0a66e5c6ac652d) Thanks [@polynaut](https://github.com/polynaut)! - Migrate the desktop runtime from Electron to Tauri 2, convert the frontend to a client-rendered SPA, and restructure into a 2-layer monorepo: `@dth/web` (SPA frontend), `@dth/desktop` (Tauri shell), `@dth/rom` (pure generation core). Adds in-app auto-update (GitHub Releases) and a changesets-driven release pipeline.
