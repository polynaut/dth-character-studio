# @dth/desktop

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
