# @dth/web

## 0.4.0

### Minor Changes

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - Cache the DTH pose-preset catalog so opening a character is instant.

  Scanning the DTH release folder used to run on every character open — with many
  releases in the folder that took several seconds each time. Now scanning is a
  one-off, explicit step: "Scan DTH release" in Settings resolves the
  highest-versioned release (when the folder holds several), scans + classifies
  its presets, and writes them to a `pose-catalog.json` cache in the app folder.
  Opening or generating a character reads only that cache; it never walks the
  release folder. Zipped releases aren't auto-extracted yet — extract the latest
  one first (the scan reports this). If the catalog hasn't been built, the editor
  points you to Settings to scan.

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - Rework the "new character" form around a Daz scene file. Instead of a free-text
  name, you pick a Daz Studio scene (`.duf`); a second row then appears with a
  **Filepath** (rendered like the editor's, with a `\project\` prefix — prefilled
  `<scene>/<scene>.json`, editable; the subfolder and character name are derived
  from it, and a bare `Name.json` stores in the project root). Genesis and Gender
  stay. The
  scene's `<scene>.tip.png` thumbnail is used as the avatar automatically. The old
  "seed from FBM JSON" field is replaced by an **Optional: Prefill** dropdown
  (Empty / Example) — "Example" seeds the ROM definitions from a bundled example
  character.

  Selecting a scene shows a live avatar preview (its `.tip.png`) under the scene
  field. And if the picked scene lives outside the project, Create asks (in a
  modal) whether to copy it into the character's folder — with a "Subfolder" field
  prefilled `daz3d` — copying the `.duf` plus its `.png` / `.tip.png` thumbnails.

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - Character editor: the **Filepath** field now spans the full width of the card
  (it sits on its own row below the settings instead of being squeezed beside the
  Genesis-specific box), so long paths are fully visible. Characters created from a
  Daz scene now record that scene's path, shown read-only as a **Daz scene** field
  beneath the Filepath. Adds an optional `scenePath` to the character schema
  (empty for characters made before the scene-based create flow).

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - JCM can use a custom pose preset. The Joint Corrective section's second mode is
  now "Custom JCM asset": enter a path to a `.duf` (or pick it with a file dialog)
  and it's loaded as the base ROM exactly like a pre-defined DTH JCM asset —
  driving the skinning (DQS/linear from the file name), the frame layout, and the
  generated `jcmRomPath`. FAC stays a separate section (it mirrors the Houdini
  PoseAsset node), so its optional Mouth asset is still picked there.

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - Add **Open in Daz** / **Link Daz scene** to the character editor. When a
  character's linked scene exists on disk, an "Open in Daz" button opens that
  `.duf` straight into Daz Studio. When the scene is missing (deleted or renamed)
  or was never linked, the button becomes "Link Daz scene": it opens a file picker
  and — if the chosen scene lives outside the project — offers (via the same modal
  as create) to copy it and its thumbnails into the character's folder. Linking
  persists immediately and refreshes the avatar from the new scene. The desktop
  shell `open` scope is widened to permit `.duf` paths (was http/tel/mailto only).

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - Generate one self-contained Daz script per character instead of a pile of files.

  Save now produces a single `<CharacterName>_<Genesis>.dsa` that makes one
  `ApplyDTHCharacter({ … })` call carrying the full character config **and** all ROM
  morph definitions inline — no more separate `_FBMs.json`, `_FBMs.csv`, wrapper
  `.dsa`, or `_*ArtDirection.json` files. It's installed into a shared
  `<My DAZ 3D Library>\Scripts\DTH-Character-Studio` folder, alongside the DTH
  runtime files it imports — `.DthWorkflow.dsa`, `.DthUtils.dsa`, `.DthOptions.dsa`
  (dot-prefixed so they read as hidden; ScanKeyFrames is merged into DthWorkflow),
  copied there from the configured DazToHue-Scripts folder. The Houdini
  `<Name>_PoseAsset.csv` is written into the character's own folder next to its
  definition.

  Requires the matching DazToHue-Scripts runtime that adds the `ApplyDTHCharacter`
  entry point and inline-data support.

### Patch Changes

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - When creating a character and choosing to copy the Daz scene into the project,
  the character's stored `scenePath` now points at the in-project copy rather than
  the original external file (matching the editor's relink behaviour). Previously
  it kept the external path, so "Open in Daz" would open the outside-the-project
  original.

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - Display all filesystem paths with the OS-native separator. A new `displayPath`
  helper rewrites every `/` and `\` to the current platform separator, so the
  editor's definition path, the "Path in project" field, the generate output
  folders, the projects overview, and Settings no longer show a wild mix of
  forward and back slashes.

  Paths rendered as code chips are now click-to-copy via a shared `PathCode`
  component: clicking the chip copies the full path to the clipboard, with a copy
  icon that overlaps the top-right corner on hover.

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - Tidy the character editor's settings: drop the redundant Name field (the title
  is editable inline), group the genesis-specific tuning (FACS detail strength,
  Flexion strength) into a labelled fieldset ("Genesis 9 Specific", ready to swap
  per generation), promote the "Path in project" field to a second row of the base
  settings pane, and move "Reset GP before applying extra frames" into Advanced
  options.

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - The editor's Filepath prefix chip now shows the full project root path (e.g.
  `X:\_3d\dth-characters\`) instead of the `\project\` placeholder, now that the
  field spans the full width.

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - Use the full app-window width on every page (desktop layout) instead of a centered narrow column. Character and pose-preset grids gain columns on wide windows to use the space; forms and settings stay at a comfortable reading width, left-aligned. In the character editor, "Advanced workflow options" is renamed to "Advanced options" and now holds a single editable **Path in project** field — edit it to rename or reorganise a character (e.g. nest it in subfolders); collisions are rejected with a clear message.

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - Show absolute timeline frame numbers for GEN art-direction frames (e.g. 431 for
  ClitorisErect) instead of the relative offset (+103). The GP/DK block's absolute
  start is derived from the base ROM + skinning via a new `genRomStartFrame`
  helper.

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - In the character editor header, the title and its sibling lines now bottom-align
  with the avatar image (sitting lower) instead of being vertically centered.

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - Moving a character (via the Filepath **Move**) now repoints its linked Daz scene
  when the scene lives inside the character folder — the scene travels with the
  folder, so its stored path is rewritten to the new location instead of going
  "Missing". Scenes linked in place outside the character folder are left
  untouched (they didn't move). The editor's Daz scene field updates in step
  without discarding any unsaved edits.

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - Renaming a character now regenerates its files and cleans up the old script.

  A character's generated script is named `<Name>_<Genesis>.dsa`, so renaming
  changed the filename and left the old-named script orphaned in the shared
  `Scripts/DTH-Character-Studio` folder (while the new one wasn't written until the
  next save). Renaming now regenerates at the new name and removes the stale
  previous-named script — and likewise drops the old-named `<Name>_PoseAsset.csv`
  in the character's folder. (The folder itself moves with the rename.)

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - Make the library scan resilient to unreadable character folders. A locked or
  delete-pending folder on a network share makes `readDir`/`exists` throw — Tauri
  reports it as a "forbidden path" because it can't canonicalize the path for its
  fs scope check. The project overview no longer blanks on such a folder
  (`walkFiles` skips it and logs a warning), and creating a character whose target
  folder already exists _or_ can't be probed now rolls the numeric suffix
  (`Name (2)`) instead of failing.

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - Use the styled dropdown (the same shadcn Select as the Genesis/Gender fields)
  for the ROM section pickers — Mode, Asset, and the per-group Generation /
  Calculate-from / Suffix selects — instead of unstyled native `<select>`s, for a
  consistent look.

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - In the character editor, **Save** now also (re)generates all DTH files in the same step — the separate "Generate DTH files" button is gone. Save is the primary action, and a new **Discard** button reverts unsaved changes (enabled only when there are changes).

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - In the editor's Daz scene row, the Open in Daz / Link Daz scene button now sits
  to the left of the scene path chip.

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - Add toast notifications (via [Sonner](https://sonner.emilkowal.ski/)) for meaningful actions: saving + generating a character, creating / renaming / deleting projects and characters, moving a character, uploading an avatar, saving settings, and scanning the DTH release. Errors surface as toasts too.

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - The editor's **Daz scene** path now renders as the same two-tone copyable chip
  as the definition path under the title: the segment matching the project folder
  is dimmed and the rest emphasized, at the same size.
- Updated dependencies [[`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687)]:
  - @dth/rom@0.4.0

## 0.3.2

### Patch Changes

- [#13](https://github.com/polynaut/dth-character-studio/pull/13) [`26df863`](https://github.com/polynaut/dth-character-studio/commit/26df8634c08d082818fc4fce02abad46fde405a0) Thanks [@polynaut](https://github.com/polynaut)! - Rename a character inline from its page — hover the name, click the pencil, edit, and Enter or click away to save (the same interaction as renaming a project). Extracts a shared `EditableTitle` used by both.

- Updated dependencies []:
  - @dth/rom@0.3.2

## 0.3.1

### Patch Changes

- [#11](https://github.com/polynaut/dth-character-studio/pull/11) [`f9e8268`](https://github.com/polynaut/dth-character-studio/commit/f9e826844eeed6a5df53fd20db23c5a29a46bde2) Thanks [@polynaut](https://github.com/polynaut)! - Rename a project inline from its page: hover the title to reveal a pencil, click it to edit, and press Enter or click away to save.

- [#11](https://github.com/polynaut/dth-character-studio/pull/11) [`f9e8268`](https://github.com/polynaut/dth-character-studio/commit/f9e826844eeed6a5df53fd20db23c5a29a46bde2) Thanks [@polynaut](https://github.com/polynaut)! - Switch the UI accent color from teal to the logo's orange (`#fe5c01`) — primary buttons, links, and focus rings.

- Updated dependencies []:
  - @dth/rom@0.3.1

## 0.3.0

### Minor Changes

- [#9](https://github.com/polynaut/dth-character-studio/pull/9) [`03f575d`](https://github.com/polynaut/dth-character-studio/commit/03f575d9d4e77926870c8369fb9d1e4714596b36) Thanks [@polynaut](https://github.com/polynaut)! - Support multiple game projects, each with its own character library. On first run the studio asks for your **"My DAZ 3D Library"** path; the home screen is now a **projects** list — each project is a name + a folder that holds that project's characters. Open a project to manage its characters, with the project name and folder shown.

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.3.0

## 0.2.1

### Patch Changes

- [#6](https://github.com/polynaut/dth-character-studio/pull/6) [`d78e690`](https://github.com/polynaut/dth-character-studio/commit/d78e690659c17d20baef8aa23385c91d9515c08b) Thanks [@polynaut](https://github.com/polynaut)! - Restyle the UI to match Daz Studio's dark palette — warm-neutral grays with a teal/spring-green accent — as a single dark-only theme (no light mode, since Daz and Houdini have none). Removes the leftover light-theme template CSS.

- [#6](https://github.com/polynaut/dth-character-studio/pull/6) [`d78e690`](https://github.com/polynaut/dth-character-studio/commit/d78e690659c17d20baef8aa23385c91d9515c08b) Thanks [@polynaut](https://github.com/polynaut)! - Only render the TanStack DevTools button in development — it was shipping in installed/production builds. Gated on `import.meta.env.DEV`, so the production bundle also drops the devtools code.

- Updated dependencies []:
  - @dth/rom@0.2.1

## 0.2.0

### Minor Changes

- [#2](https://github.com/polynaut/dth-character-studio/pull/2) [`7131015`](https://github.com/polynaut/dth-character-studio/commit/71310154dfd5b07d4f2d1f150c0a66e5c6ac652d) Thanks [@polynaut](https://github.com/polynaut)! - Separate app data from a user-owned character library. Settings and avatars stay
  in the app's private folder; each character now lives in its own folder
  (`<library>/<Name>/`) holding its definition **and** its generated files
  (`.dsa`, FBM JSON, PoseAsset CSV), inside a library folder the user picks and
  backs up. Adds a first-run folder picker, native folder pickers in Settings, and
  a per-character "Storage location" panel to view the absolute path and move a
  character into subfolders.

- [#2](https://github.com/polynaut/dth-character-studio/pull/2) [`7131015`](https://github.com/polynaut/dth-character-studio/commit/71310154dfd5b07d4f2d1f150c0a66e5c6ac652d) Thanks [@polynaut](https://github.com/polynaut)! - Migrate the desktop runtime from Electron to Tauri 2, convert the frontend to a client-rendered SPA, and restructure into a 2-layer monorepo: `@dth/web` (SPA frontend), `@dth/desktop` (Tauri shell), `@dth/rom` (pure generation core). Adds in-app auto-update (GitHub Releases) and a changesets-driven release pipeline.

### Patch Changes

- [#2](https://github.com/polynaut/dth-character-studio/pull/2) [`7131015`](https://github.com/polynaut/dth-character-studio/commit/71310154dfd5b07d4f2d1f150c0a66e5c6ac652d) Thanks [@polynaut](https://github.com/polynaut)! - Store character avatars as a portable reference (a filename or an external URL) instead of a machine-specific asset URL, and resolve the loadable image at render time. Shared character JSON no longer embeds local paths, and a missing local avatar falls back to the initial-letter placeholder instead of a broken image. Legacy avatar values (old asset/Electron-route URLs) migrate to the new form on load.

- Updated dependencies [[`7131015`](https://github.com/polynaut/dth-character-studio/commit/71310154dfd5b07d4f2d1f150c0a66e5c6ac652d)]:
  - @dth/rom@0.2.0
