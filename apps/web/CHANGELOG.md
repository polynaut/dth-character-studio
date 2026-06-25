# @dth/web

## 0.25.0

### Minor Changes

- [#88](https://github.com/polynaut/dth-character-studio/pull/88) [`ffd930e`](https://github.com/polynaut/dth-character-studio/commit/ffd930e597a05df24e0b53b762065b3072444a9e) Thanks [@polynaut](https://github.com/polynaut)! - Character editor — Daz scene & Houdini project cards polish:

  - **Houdini project cards** now match the Daz scene cards: a gender-based character
    placeholder avatar (with the Houdini logo as a bottom-left badge), a folder path
    chip under the title (shown once a project is linked), a very light orange brand
    tint, and `%CHAR%` standing in for the character folder in the per-card path chip.
  - **Path chips** show `%CHAR%` (the character folder) as the prefix for relative
    paths, and match the header path chip's size.
  - **Card titles** drop the file extension (e.g. `KiraDefault_G9_GP`, `Kira`).
  - All cards share a **fixed width**, **top-aligned** title/chip (so they line up with
    or without a "primary" badge), and the open-in-app icon **pinned bottom-right**.

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.25.0

## 0.24.1

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.24.1

## 0.24.0

### Minor Changes

- [#83](https://github.com/polynaut/dth-character-studio/pull/83) [`a51a795`](https://github.com/polynaut/dth-character-studio/commit/a51a795db9bbbac2a12190226b3417904cbfb480) Thanks [@polynaut](https://github.com/polynaut)! - Character editor: **Import from CSV** now opens a frame-range dialog after you pick
  the file, so a full-scene morph scan (from `DthScanFrames.dsa`) can be sliced to
  just the frames that belong to the section you're importing into. The dialog shows
  the CSV's frame extent and a live in-range morph count, defaulting to the full
  range. Each "Import from CSV" button also gained an info popup explaining how to
  produce the CSV, with a link straight to the DazToHue-Scripts installer in Tools.

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

- Updated dependencies []:
  - @dth/rom@0.24.0

## 0.23.1

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.23.1

## 0.23.0

### Minor Changes

- [#72](https://github.com/polynaut/dth-character-studio/pull/72) [`86941a6`](https://github.com/polynaut/dth-character-studio/commit/86941a68a1a82cb9f402b7b00ddd2a14db39b452) Thanks [@polynaut](https://github.com/polynaut)! - New **Tools → "Daz Studio & Houdini"** page to install and tidy your _own_ Daz/Houdini content (a port of the dth-cli installers, minus the script-repo syncing). Lives under a new muted **Tools** nav item, separate from Settings.

  - **Daz assets** — add multiple asset source folders (Genesis 3/8/9; `.zip`s read from the central directory, no extraction). Content-aware (`data`/`People`/`Runtime`/`Documentation`); copies only files that are missing or a different size, so re-runs are cheap and "already installed" is read from the real files (not guessed). Read-only **Scan** + per-asset expandable file lists. Shared files between _different_ products auto-resolve on install — **newer Genesis wins, then the bigger file** — so only the winner is installed and folder order doesn't matter (your downloaded files are never edited).
  - **Deduplicate** — finds duplicate / version assets (folder or `.zip`) and, on Apply, moves the redundant copies to a quarantine folder you choose (reversible; you pick which copy to keep). Conflicting shared files are shown read-only with the auto-resolved winner marked.
  - **Custom morphs** + **Daz presets** — merge-only installs (add new files, never overwrite your edits), with source + destination folders.
  - **Houdini presets** — replaces the presets folder in your Houdini docs folder and wires `houdini.env` (`SHARED_PRESETS` + `HOUDINI_PATH`).
  - **Danger zone** — clean up leftover Daz folders after uninstalling Daz via Windows "Add or remove programs". "Prefill folder paths" adds the standard Daz locations that currently exist; a guarded "Uninstall Daz" deletes them (Dry run first; inline confirm).

  Each section has a Dry run and a dismissible install report. The copy/scan/dedup run in native Rust (parallelized across assets).

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.23.0

## 0.22.1

### Patch Changes

- [#78](https://github.com/polynaut/dth-character-studio/pull/78) [`b8c270c`](https://github.com/polynaut/dth-character-studio/commit/b8c270c6909e0ee58785956395f17d912c32dbeb) Thanks [@polynaut](https://github.com/polynaut)! - Move the **Daz scripts** write-path out of the character header into its own pane, **Daz scripts generated**, sitting just below the first pane. The header goes back to showing only the character-definition path, and the scripts location reads as a labelled card (with a short info note) — the same chip, now easier to find and less crowded in the header.

- Updated dependencies []:
  - @dth/rom@0.22.1

## 0.22.0

### Minor Changes

- [#76](https://github.com/polynaut/dth-character-studio/pull/76) [`4c3a1d6`](https://github.com/polynaut/dth-character-studio/commit/4c3a1d6342335ca648d1024b2240fc677ab9f180) Thanks [@polynaut](https://github.com/polynaut)! - Drag morphs between groups. The pose drag-and-drop now spans a whole section instead of being locked to one group, so you can move a morph (pose) from one group into another — drop it on a pose to insert at that spot, or on an empty group's body to append — not just reorder within a group. A drag overlay shows the morph you're moving. Handy after a CSV import to redistribute morphs across groups.

- [#76](https://github.com/polynaut/dth-character-studio/pull/76) [`4c3a1d6`](https://github.com/polynaut/dth-character-studio/commit/4c3a1d6342335ca648d1024b2240fc677ab9f180) Thanks [@polynaut](https://github.com/polynaut)! - Import custom morphs from a DAZ-exported CSV. Every section that holds custom morphs (FBM, MISC, EXP, FAC, GEN, PHY) gets an **Import from CSV** button that parses a DAZ morph dump (`frame, , , node, prop, value …`) into poses — one per row, named from a cleaned form of the morph property (`xMusc_body_bs_AnconeusL_B_HD2` → `AnconeusL`, with the raw property kept on the morph) — so you no longer hand-enter long lists of individual morphs (muscles, veins, nails, expressions). Grouped sections get a new group; the flat FBM/MISC list appends to it.

- [#75](https://github.com/polynaut/dth-character-studio/pull/75) [`47c3935`](https://github.com/polynaut/dth-character-studio/commit/47c3935e1f8c2680f6d23dd8844286f765ddcbab) Thanks [@polynaut](https://github.com/polynaut)! - Show the **Daz scripts write-path** as a chip at the top of the character page, so you can see at a glance where the generated `<Name>_<Genesis>.dsa` lands in your DAZ library (`…/Scripts/DTH-Character-Studio/<project>/<character>/`) — i.e. where to find and run it in Daz. Falls back to a hint when "My DAZ 3D Library" isn't set yet.

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.22.0

## 0.21.2

### Patch Changes

- [#73](https://github.com/polynaut/dth-character-studio/pull/73) [`c44e578`](https://github.com/polynaut/dth-character-studio/commit/c44e5788261742ea193a6dff83d26090cbbd61c0) Thanks [@polynaut](https://github.com/polynaut)! - Pose catalog is now scanned live into memory instead of cached on disk — fixing the "No pose catalog yet" errors and removing the whole class of stale/missing-cache problems.

  Previously the pose list was built into a `pose-catalog.json` file only when you pressed **Save** in Settings; installing a release saved the settings (which disabled Save), so a freshly-configured release could be left with no catalog and no way to build one. Now there is no on-disk catalog at all:

  - The active release's `Poses` folder is walked by a native Rust command (one call, ~4–5× faster than the old per-directory JS walk on a network share) and classified in memory.
  - It's scanned on app startup (after network drives are mapped), on first use, and re-scanned automatically whenever the release selection changes (Save or Install) — no manual "rebuild" step.
  - A missing/unreachable release shows a clear error that links to Settings; nothing can silently go stale.

- [#73](https://github.com/polynaut/dth-character-studio/pull/73) [`c44e578`](https://github.com/polynaut/dth-character-studio/commit/c44e5788261742ea193a6dff83d26090cbbd61c0) Thanks [@polynaut](https://github.com/polynaut)! - Daz scene cards on the character page now share a uniform height within a row — previously a card with the "primary" badge stood taller than its siblings.

- Updated dependencies []:
  - @dth/rom@0.21.2

## 0.21.1

### Patch Changes

- [#70](https://github.com/polynaut/dth-character-studio/pull/70) [`303d850`](https://github.com/polynaut/dth-character-studio/commit/303d8504cb9afb3aa9791069686decec2bc82079) Thanks [@polynaut](https://github.com/polynaut)! - Morph values (and the optional base value) are now shown and edited as Daz-style percentages (0–100%) with a "%" suffix, while still stored internally as 0–1 — so a stored value of `1` shows as `100%`, `0.5` as `50%`, matching Daz Studio's UI.

- [#70](https://github.com/polynaut/dth-character-studio/pull/70) [`303d850`](https://github.com/polynaut/dth-character-studio/commit/303d8504cb9afb3aa9791069686decec2bc82079) Thanks [@polynaut](https://github.com/polynaut)! - Scene card tidy-up: the "primary" indicator is now a left-aligned line under the path chip (instead of a top-right badge that crowded the title and widened the card), and the open-in-Daz icon sits bottom-right.

- Updated dependencies []:
  - @dth/rom@0.21.1

## 0.21.0

### Minor Changes

- [#68](https://github.com/polynaut/dth-character-studio/pull/68) [`11c1766`](https://github.com/polynaut/dth-character-studio/commit/11c1766f85494b1c97ff34acb29eb7e1f43b56d3) Thanks [@polynaut](https://github.com/polynaut)! - Export: new **"Run the export with the ROM script"** toggle (in a character's Export directory section). On (default) keeps one combined `<Name>_<Genesis>.dsa` that builds the ROM and runs the export. Off splits it into `ROM_<Name>_<Genesis>.dsa` (builds the ROM) and `Export_<Name>_<Genesis>.dsa` (only runs the exporter + delivers the PoseAsset CSV) — so you can re-export, for another Daz scene or after a failed export, without rebuilding the slow ROM. Run the Export script after the ROM script in the same Daz session.

### Patch Changes

- [#68](https://github.com/polynaut/dth-character-studio/pull/68) [`11c1766`](https://github.com/polynaut/dth-character-studio/commit/11c1766f85494b1c97ff34acb29eb7e1f43b56d3) Thanks [@polynaut](https://github.com/polynaut)! - Removed the "Generate" results panel from the character page — generation feedback is now a concise toast. The character-script install location is shown in Settings under "My DAZ 3D Library".

- [#68](https://github.com/polynaut/dth-character-studio/pull/68) [`11c1766`](https://github.com/polynaut/dth-character-studio/commit/11c1766f85494b1c97ff34acb29eb7e1f43b56d3) Thanks [@polynaut](https://github.com/polynaut)! - New characters created without a pre-filled ROM now start with the **FBM** (full-body morphs) section **disabled** — there's nothing to put there until you add morphs. Characters prefilled from the example or another character keep that source's sections.

- [#68](https://github.com/polynaut/dth-character-studio/pull/68) [`11c1766`](https://github.com/polynaut/dth-character-studio/commit/11c1766f85494b1c97ff34acb29eb7e1f43b56d3) Thanks [@polynaut](https://github.com/polynaut)! - The character's original (primary) Daz scene — the one it was created from — can no longer be unlinked. Its card shows a "primary" badge instead of the unlink ✕; extra scenes stay removable.

- [#68](https://github.com/polynaut/dth-character-studio/pull/68) [`11c1766`](https://github.com/polynaut/dth-character-studio/commit/11c1766f85494b1c97ff34acb29eb7e1f43b56d3) Thanks [@polynaut](https://github.com/polynaut)! - Removed the unused "Target skeleton" (UE5 / DTH) field. It was never read during generation — the PoseAsset CSV is always the UE5 template, and the DTH skeleton node doesn't support CSV import yet — so it was a choice that looked like it mattered but didn't. Dropped the dropdown, the list column, the schema field, and the prefill copy. Existing characters keep working (the stored value is simply ignored).

- Updated dependencies []:
  - @dth/rom@0.21.0

## 0.20.0

### Minor Changes

- [#66](https://github.com/polynaut/dth-character-studio/pull/66) [`4262113`](https://github.com/polynaut/dth-character-studio/commit/426211301ad5d33f7ee024e24c9581a987fb922f) Thanks [@polynaut](https://github.com/polynaut)! - ROM prefill (Create character) now lists matching characters from **all projects**, not just the current one — each labelled `ProjectName - CharacterName` — and copies the ROM from whichever you pick (the source is resolved across projects). Still filtered to the chosen Genesis + gender for ROM compatibility.

- [#66](https://github.com/polynaut/dth-character-studio/pull/66) [`4262113`](https://github.com/polynaut/dth-character-studio/commit/426211301ad5d33f7ee024e24c9581a987fb922f) Thanks [@polynaut](https://github.com/polynaut)! - Projects list (list view) is now an aligned table: the name and path columns size to their widest entry across rows, the path chip hugs its own text instead of stretching, and each project shows its **character count**. Projects added before creation dates were tracked now fall back to the project folder's filesystem creation time, so they're no longer dateless.

### Patch Changes

- [#66](https://github.com/polynaut/dth-character-studio/pull/66) [`4262113`](https://github.com/polynaut/dth-character-studio/commit/426211301ad5d33f7ee024e24c9581a987fb922f) Thanks [@polynaut](https://github.com/polynaut)! - Replaced personal example paths in folder/name input placeholders (DTH release / exporter / Houdini folders, custom JCM path, character name & directory, scene subfolder) with generic ones, so they read sensibly for everyone.

- [#66](https://github.com/polynaut/dth-character-studio/pull/66) [`4262113`](https://github.com/polynaut/dth-character-studio/commit/426211301ad5d33f7ee024e24c9581a987fb922f) Thanks [@polynaut](https://github.com/polynaut)! - List view: the row action controls (rename/move buttons, selection checkbox) no longer overlap the row content (date, metadata). In list view they're now laid out as a flex sibling that reserves its own space, instead of being absolutely positioned over a fixed-width padding gap. Grid view is unchanged.

- [#66](https://github.com/polynaut/dth-character-studio/pull/66) [`4262113`](https://github.com/polynaut/dth-character-studio/commit/426211301ad5d33f7ee024e24c9581a987fb922f) Thanks [@polynaut](https://github.com/polynaut)! - PoseAsset CSV export now **copies** the CSV into the resolved export dir instead of moving it. A move consumed the source after the first scene, so exporting a second Daz scene from the same character (e.g. `KiraDefault` then `KiraSummertide`) left that scene without a CSV. With a copy, every scene's subfolder gets its own CSV and the character folder keeps the canonical one.

- Updated dependencies []:
  - @dth/rom@0.20.0

## 0.19.2

### Patch Changes

- [#63](https://github.com/polynaut/dth-character-studio/pull/63) [`b14ebc2`](https://github.com/polynaut/dth-character-studio/commit/b14ebc21beec2d49d4ce75f2b0afe48016a748e2) Thanks [@polynaut](https://github.com/polynaut)! - Export directory fixes:

  - Changing the export folder (set/clear) or the "Generate subfolders based on Daz scenes" toggle now regenerates the character script immediately, so the generated `.dsa` actually picks up the DTH Exporter auto-export block instead of silently lagging behind the saved setting.
  - The generated script now **moves** the PoseAsset CSV into the resolved export dir at run time — next to the exporter's `<name>.abc`/`.dth`, and inside the scene subfolder when that option is on. Previously the studio dropped the CSV in the export root at generation time, where it couldn't account for the run-time scene subfolder (so it landed in the wrong place and was duplicated).
  - Dropped the false "this folder is inside the project" warning — exporting into a folder inside the project (e.g. a Perforce-tracked `characters/<Name>/houdini`) is a valid setup; the exporter's own character subfolder nests there fine.

- [#63](https://github.com/polynaut/dth-character-studio/pull/63) [`b14ebc2`](https://github.com/polynaut/dth-character-studio/commit/b14ebc21beec2d49d4ce75f2b0afe48016a748e2) Thanks [@polynaut](https://github.com/polynaut)! - Settings: the back link now returns you to wherever you opened Settings from (popping history, like the About page) instead of always jumping to the projects list — and names the destination (e.g. "Back to Kira") when you entered from a character page.

- Updated dependencies []:
  - @dth/rom@0.19.2

## 0.19.1

### Patch Changes

- [#59](https://github.com/polynaut/dth-character-studio/pull/59) [`561d50a`](https://github.com/polynaut/dth-character-studio/commit/561d50acc41855bb9d832a3f766049133295ab31) Thanks [@polynaut](https://github.com/polynaut)! - Always show the "Generate subfolders based on Daz scenes" toggle in the Export
  directory panel — it was previously hidden until an export folder was set, which
  made it undiscoverable. It now renders disabled and muted (with a hint in its
  info popup) until an export folder is chosen.
- Updated dependencies []:
  - @dth/rom@0.19.1

## 0.19.0

### Minor Changes

- [#57](https://github.com/polynaut/dth-character-studio/pull/57) [`b4359a3`](https://github.com/polynaut/dth-character-studio/commit/b4359a3df854de73243a37d06ee8d53a4d469b94) Thanks [@polynaut](https://github.com/polynaut)! - Add a **"Generate subfolders based on Daz scenes"** toggle to the character
  editor's Export directory panel. When on, the generated Daz script resolves the
  open scene at run time via `Scene.getFilename()` and nests the export under a
  subfolder named after it (the exporter's own `<characterName>` subfolder is
  created inside that) — so a character's scene/outfit variants export side by
  side. Falls back to the export root when no scene is saved. Adds
  `exportSceneSubfolders` to the character schema (→ `CHARACTER_SCHEMA_VERSION` 4).

### Patch Changes

- Updated dependencies [[`b4359a3`](https://github.com/polynaut/dth-character-studio/commit/b4359a3df854de73243a37d06ee8d53a4d469b94)]:
  - @dth/rom@0.19.0

## 0.18.0

### Minor Changes

- [#55](https://github.com/polynaut/dth-character-studio/pull/55) [`9c2bbf4`](https://github.com/polynaut/dth-character-studio/commit/9c2bbf4c633fe930d05b21b929fca548044f61f8) Thanks [@polynaut](https://github.com/polynaut)! - Add an **About** page: a new "About" link sits next to Settings on the projects
  home, opening a page with the large app logo, the title "DTH Character Studio
  v&lt;version&gt;" (the running app version), a short description of the studio,
  and a link to the GitHub repository (opens in the OS browser).

- [#55](https://github.com/polynaut/dth-character-studio/pull/55) [`9c2bbf4`](https://github.com/polynaut/dth-character-studio/commit/9c2bbf4c633fe930d05b21b929fca548044f61f8) Thanks [@polynaut](https://github.com/polynaut)! - The studio is now **self-contained**: the DTH runtime (`DthWorkflow.dsa` /
  `DthUtils.dsa` / `DthOptions.dsa`) is bundled into the app and installed from
  there, so it no longer needs a DazToHue-Scripts checkout. The "DazToHue-Scripts
  folder" setting is removed — generating a character installs the runtime
  straight from the bundled copy. (A runtime version, to flag when an app update
  should refresh the bundled files, is planned as a follow-up.)

- [#55](https://github.com/polynaut/dth-character-studio/pull/55) [`9c2bbf4`](https://github.com/polynaut/dth-character-studio/commit/9c2bbf4c633fe930d05b21b929fca548044f61f8) Thanks [@polynaut](https://github.com/polynaut)! - Integrate the DTH Exporter Plugin's new scripting hook (v1.8.1+). A character now
  has an **export directory** (editor → Export section); when set, the generated
  Daz script runs the exporter automatically after building the ROM —
  `dthExportAction.doExport(exportDir, characterName, referenceFrames, false)` — so
  one script builds _and_ exports, no dialog. The reference frames are derived from
  the ROM's reference-skeleton poses (the poses carrying a `referenceFbx`), passed
  space-separated. The exporter creates its own `<characterName>` subfolder, so the
  export directory should sit outside the project (the editor warns otherwise).
  Adds `exportPath` to the character schema (→ `CHARACTER_SCHEMA_VERSION` 3).

### Patch Changes

- [#55](https://github.com/polynaut/dth-character-studio/pull/55) [`9c2bbf4`](https://github.com/polynaut/dth-character-studio/commit/9c2bbf4c633fe930d05b21b929fca548044f61f8) Thanks [@polynaut](https://github.com/polynaut)! - Character editor tidy-up: the **Houdini projects** hint, the **Export directory**
  section intro, and the **ROM** section intro now live in "i" info popups next to
  their labels/headings instead of inline sub-lines, matching the Settings page.
  The "Export" and "Special operations" headings are renamed to "Export directory"
  and "Operations".

- [#55](https://github.com/polynaut/dth-character-studio/pull/55) [`9c2bbf4`](https://github.com/polynaut/dth-character-studio/commit/9c2bbf4c633fe930d05b21b929fca548044f61f8) Thanks [@polynaut](https://github.com/polynaut)! - When a character has an export directory set, the generated PoseAsset CSV is now
  also written into that folder — so it sits next to the exporter's output
  (`<name>.fbx` / `.abc` / `.dth` / …) and the whole package ends up in one folder
  for the next step. The CSV still lives in the character folder too; writing to
  the export folder is best-effort and never fails generation.

- [#55](https://github.com/polynaut/dth-character-studio/pull/55) [`9c2bbf4`](https://github.com/polynaut/dth-character-studio/commit/9c2bbf4c633fe930d05b21b929fca548044f61f8) Thanks [@polynaut](https://github.com/polynaut)! - Drop the first-run "Set your DAZ 3D Library" gate on the projects home — the
  app now opens straight to the projects list and lets you start working. The
  DAZ 3D Library path is still set in Settings, and missing prerequisites are
  surfaced where they matter (character detail / install steps) rather than via
  an upfront prompt.

- [#55](https://github.com/polynaut/dth-character-studio/pull/55) [`9c2bbf4`](https://github.com/polynaut/dth-character-studio/commit/9c2bbf4c633fe930d05b21b929fca548044f61f8) Thanks [@polynaut](https://github.com/polynaut)! - Rename the generated PoseAsset CSV to DTH's convention: `<name>_pose_asset.csv`
  (was `<name>_PoseAsset.csv`). The legacy-cased file is cleaned up from the
  character folder and the export folder on the next generate.

- [#55](https://github.com/polynaut/dth-character-studio/pull/55) [`9c2bbf4`](https://github.com/polynaut/dth-character-studio/commit/9c2bbf4c633fe930d05b21b929fca548044f61f8) Thanks [@polynaut](https://github.com/polynaut)! - **Refresh Assets** now also re-installs the bundled DTH runtime files (once, up
  front) — so after a studio update that ships a newer runtime, one Refresh Assets
  push it to the Daz library even when there are no characters to regenerate. The
  result panel reports the runtime refresh (and any failure).

- [#55](https://github.com/polynaut/dth-character-studio/pull/55) [`9c2bbf4`](https://github.com/polynaut/dth-character-studio/commit/9c2bbf4c633fe930d05b21b929fca548044f61f8) Thanks [@polynaut](https://github.com/polynaut)! - Settings page tidy-up: per-field help text now lives in an info ("i") popup next
  to its label instead of as an inline sub-line — `FolderField` shows one popup
  (its rich `info`, falling back to `help`), the General tab's subfolder fields got
  the same, and the General tab's section blurbs (Refresh assets, App data folder,
  Network drives) moved into popups next to their headings. The DazToHue tab's
  multi-step setup intros stay as visible subtitles. The Exporter install's "close
  all Daz/Houdini apps and restart as administrator" guidance now shows only when
  an install actually fails, styled as an error.
- Updated dependencies [[`9c2bbf4`](https://github.com/polynaut/dth-character-studio/commit/9c2bbf4c633fe930d05b21b929fca548044f61f8), [`9c2bbf4`](https://github.com/polynaut/dth-character-studio/commit/9c2bbf4c633fe930d05b21b929fca548044f61f8)]:
  - @dth/rom@0.18.0

## 0.17.0

### Minor Changes

- [#53](https://github.com/polynaut/dth-character-studio/pull/53) [`c080d34`](https://github.com/polynaut/dth-character-studio/commit/c080d3408c4fbfab2fce0afc03d1efb68e3b41d0) Thanks [@polynaut](https://github.com/polynaut)! - Deleting a project can now remove its files from disk. The project delete
  confirm has a **"Keep project files on disk"** toggle — **off by default**, so
  deleting a project now also deletes its library folder (all character data) and
  its generated-scripts subfolder. Turn the toggle on to remove only the project
  entry and leave every file in place (the previous behaviour). (The shared delete
  dialog was generalised; the character delete keeps its "Keep the Daz files
  folder" toggle, also off by default.)

- [#53](https://github.com/polynaut/dth-character-studio/pull/53) [`c080d34`](https://github.com/polynaut/dth-character-studio/commit/c080d3408c4fbfab2fce0afc03d1efb68e3b41d0) Thanks [@polynaut](https://github.com/polynaut)! - The "Create project" pane now accepts a **dragged-in folder** — drop a folder
  onto the pane to set it as the project's location (the name is suggested from the
  folder, editable), the same way the choose-folder button works. Dropping a file
  uses its containing folder. `FileDropZone` gained an `acceptFolders` mode, since
  folders can't be matched by file extension.

### Patch Changes

- [#53](https://github.com/polynaut/dth-character-studio/pull/53) [`c080d34`](https://github.com/polynaut/dth-character-studio/commit/c080d3408c4fbfab2fce0afc03d1efb68e3b41d0) Thanks [@polynaut](https://github.com/polynaut)! - Deleting a character or project now also removes its generated Daz script folder
  from the library (`…/Scripts/DTH-Character-Studio/<project>/<character>/` for a
  character, the whole `…/<project>/` folder for a project). These are derived
  artifacts that were previously orphaned on delete. The script cleanup runs
  regardless of the "keep files" toggles, since the scripts are always
  regenerated from the character definitions.

- [#53](https://github.com/polynaut/dth-character-studio/pull/53) [`c080d34`](https://github.com/polynaut/dth-character-studio/commit/c080d3408c4fbfab2fce0afc03d1efb68e3b41d0) Thanks [@polynaut](https://github.com/polynaut)! - Fix the generated Daz script failing with "ReferenceError: options is not
  defined". Since generated scripts moved into per-character subfolders, the DTH
  runtime's internal `include()`s (DthWorkflow → DthUtils / DthOptions) still
  resolved relative to the character folder instead of the runtime root, so
  DthOptions never loaded. Those includes are now rewritten to climb two levels to
  the root (matching the character script's own `../../.DthWorkflow.dsa` include).
  Re-generate (save a character, or Settings → Refresh Assets) to update the
  installed runtime.
- Updated dependencies []:
  - @dth/rom@0.17.0

## 0.16.0

### Minor Changes

- [#51](https://github.com/polynaut/dth-character-studio/pull/51) [`9628933`](https://github.com/polynaut/dth-character-studio/commit/9628933c612c8c3761489fb75d4a06d6b2b24690) Thanks [@polynaut](https://github.com/polynaut)! - Projects can now be renamed and moved from the overview. Each project card gets
  two hover actions: **Rename** (the light operation — just changes the name) and
  **Move** (the heavy one — relocates the project to a different folder). A move
  physically relocates all character data to the new folder and repoints every
  character's in-folder references (Daz scenes / Houdini projects stored inside the
  character folder) plus its stored project name/path; scenes linked in place
  outside the project folder are left untouched.

### Patch Changes

- [#51](https://github.com/polynaut/dth-character-studio/pull/51) [`9628933`](https://github.com/polynaut/dth-character-studio/commit/9628933c612c8c3761489fb75d4a06d6b2b24690) Thanks [@polynaut](https://github.com/polynaut)! - Fix Daz scenes becoming "unlinked" after renaming a character. Renaming renames
  the character's folder, but the stored scene/Houdini paths still pointed at the
  old folder name, breaking any scene stored inside the character folder. Renaming
  now repoints those in-folder paths to the new folder (scenes linked in place
  outside the folder are left untouched).
- Updated dependencies []:
  - @dth/rom@0.16.0

## 0.15.1

### Patch Changes

- [#49](https://github.com/polynaut/dth-character-studio/pull/49) [`1e69028`](https://github.com/polynaut/dth-character-studio/commit/1e690282161c797faea15c55352e4f4b73bfb76f) Thanks [@polynaut](https://github.com/polynaut)! - Cloning a character is now a proper flow. The **Clone** button opens a dialog to
  name the copy (pre-filled "<name> copy") and choose whether to **copy its Daz
  scenes** — scenes stored in the character folder are copied into the copy, while
  scenes linked in place are kept as links (their files untouched). After cloning,
  the editor now actually lands on the new copy: it's keyed by the character id, so
  an editor→editor navigation remounts and re-seeds from the copy (previously only
  the URL changed while the editor kept showing the original).

- [#48](https://github.com/polynaut/dth-character-studio/pull/48) [`96b8044`](https://github.com/polynaut/dth-character-studio/commit/96b8044db44d3add68e53790265ff1b976126079) Thanks [@polynaut](https://github.com/polynaut)! - Make asset removal safer so a user can never delete an original file by mistake:

  - **Houdini projects** are only ever linked in place, so the _Remove Houdini
    project_ dialog no longer offers "Delete file on disk" — removal is unlink-only.
  - **Daz scenes** linked in place (outside the character folder) are the user's
    originals, so the _Remove Daz scene_ dialog now shows the "Delete file on disk"
    toggle locked off, with a "Linked in place — your original file is kept" note.
    Scenes copied _into_ the character folder keep the toggle on, as before.

- Updated dependencies []:
  - @dth/rom@0.15.1

## 0.15.0

### Minor Changes

- [#47](https://github.com/polynaut/dth-character-studio/pull/47) [`99ba2ba`](https://github.com/polynaut/dth-character-studio/commit/99ba2ba0ef94c1ff76965f8607f1efe3023d20b2) Thanks [@polynaut](https://github.com/polynaut)! - Character JSONs now carry their owning project's **name and library path**
  (`projectName` / `projectPath`), stamped on every save. Being a shape change,
  this bumps `CHARACTER_SCHEMA_VERSION` to **2** — characters last written before
  this (read as version 1) gain the fields on their next save.

- [#43](https://github.com/polynaut/dth-character-studio/pull/43) [`11d9b77`](https://github.com/polynaut/dth-character-studio/commit/11d9b770b58a2ff059305e708df66bfe705a4c35) Thanks [@polynaut](https://github.com/polynaut)! - Add a **character-JSON schema version**, independent of the app version. A new
  `CHARACTER_SCHEMA_VERSION` constant (starting at `1`) is stamped onto every saved
  character as `schemaVersion`. It changes only when the stored character shape
  changes (a field added, renamed, or removed) — pure app improvements leave it
  untouched. Existing JSONs without the field read as version `1`. This is the
  groundwork for a future migration framework: a stored version below the constant
  marks a definition that needs upgrading.

### Patch Changes

- [#45](https://github.com/polynaut/dth-character-studio/pull/45) [`bf9f145`](https://github.com/polynaut/dth-character-studio/commit/bf9f145a193b6dc7a4b97be1d2ad98264ddf0ebd) Thanks [@polynaut](https://github.com/polynaut)! - Remove the "Keep Houdini files" option from the character delete dialog. Houdini
  projects are only ever linked in place (never copied into the character folder),
  so there was no Houdini subfolder to preserve — the toggle was misleading. The
  delete dialog now offers just "Keep the Daz files folder".
- Updated dependencies [[`99ba2ba`](https://github.com/polynaut/dth-character-studio/commit/99ba2ba0ef94c1ff76965f8607f1efe3023d20b2), [`11d9b77`](https://github.com/polynaut/dth-character-studio/commit/11d9b770b58a2ff059305e708df66bfe705a4c35)]:
  - @dth/rom@0.15.0

## 0.14.0

### Minor Changes

- [#41](https://github.com/polynaut/dth-character-studio/pull/41) [`ce6d790`](https://github.com/polynaut/dth-character-studio/commit/ce6d790f69901930ed48642636a527094167348c) Thanks [@polynaut](https://github.com/polynaut)! - Overhauled the project and character overviews with management controls. Both now have a **grid / list** view toggle and **sort** (name, newest, oldest); the character overview adds **Genesis** and **Gender** filters. Items are **selectable** — the per-item trash button is gone; instead, selecting one or more reveals a bulk-action bar with **Delete**, which opens a confirm modal (for characters, with options to **keep the Daz / Houdini files** on disk). Each character now also has a **Special operations** pane with **Clone** (duplicate into a new copy) and **Delete**.

- [#40](https://github.com/polynaut/dth-character-studio/pull/40) [`2d28983`](https://github.com/polynaut/dth-character-studio/commit/2d28983450883ccd0248d116b121a79d5b38518f) Thanks [@polynaut](https://github.com/polynaut)! - Generalize the "Reset GP before applying extra frames" option: it's now **"Reset genitalia morphs before extra frames"** with a clear description, and it applies to whichever genital ROM is active — Golden Palace _or_ Dicktator — not just GP. The character field `resetGPBeforeApplying` was renamed to `resetGenBeforeApplying` (old definitions migrate automatically on load), and generation now emits the per-block reset flags the DTH runtime understands for both GP and DK.

- [#41](https://github.com/polynaut/dth-character-studio/pull/41) [`ce6d790`](https://github.com/polynaut/dth-character-studio/commit/ce6d790f69901930ed48642636a527094167348c) Thanks [@polynaut](https://github.com/polynaut)! - Generated Daz scripts are now installed into a per-character subfolder —
  `…/Scripts/DTH-Character-Studio/<project>/<character>/<Name>_<Genesis>.dsa` —
  instead of all sitting flat in the `DTH-Character-Studio` root. The DTH runtime
  (`.DthWorkflow.dsa` + `.DthUtils.dsa` + `.DthOptions.dsa`) is installed **once**
  in that root, and each character script now imports it from two levels up. A
  character rename moves its subfolder, and any flat-layout script left by an
  earlier version is cleaned up on the next generate.

### Patch Changes

- [#39](https://github.com/polynaut/dth-character-studio/pull/39) [`e2be4c4`](https://github.com/polynaut/dth-character-studio/commit/e2be4c43415abe4753987b6379a319fa2f6e128b) Thanks [@polynaut](https://github.com/polynaut)! - Give the file drag-and-drop highlight some breathing room — the dashed overlay now floats just outside the content instead of hugging it tightly.

- Updated dependencies [[`2d28983`](https://github.com/polynaut/dth-character-studio/commit/2d28983450883ccd0248d116b121a79d5b38518f), [`ce6d790`](https://github.com/polynaut/dth-character-studio/commit/ce6d790f69901930ed48642636a527094167348c)]:
  - @dth/rom@0.14.0

## 0.13.0

### Minor Changes

- [#37](https://github.com/polynaut/dth-character-studio/pull/37) [`981567d`](https://github.com/polynaut/dth-character-studio/commit/981567dd2c5c2aac6a237a3ab1221ad0555caa7d) Thanks [@polynaut](https://github.com/polynaut)! - Add a **Refresh Assets** button in Settings → General that re-generates the Daz scripts and PoseAsset CSVs for every character across all projects — run it after updating the studio or switching DTH release so every character's generated files match the current version. Per-character failures are reported rather than aborting the sweep, and character definition JSONs are left untouched (they self-migrate on open/save).

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.13.0

## 0.12.0

### Minor Changes

- [#35](https://github.com/polynaut/dth-character-studio/pull/35) [`36310ad`](https://github.com/polynaut/dth-character-studio/commit/36310ad1ff67db36af9348aebfe2c94373bcbaf4) Thanks [@polynaut](https://github.com/polynaut)! - Native OS drag-and-drop for Daz scenes (`.duf`), Houdini projects (`.hip`/`.hipnc`/`.hiplc`) and the character avatar image: drag a file from Explorer onto the **pane** where it's added — the whole area is the drop target, no need to aim at the Browse button, and it highlights while a supported file hovers it. Wired into the new-character scene picker, the editor's Daz scenes and Houdini projects fields, and the avatar image dialog. Built on Tauri's native webview drag-drop (hit-tested to the pane under the cursor), so it works with real Explorer files (HTML5 file drops don't fire when the webview captures OS drops).

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.12.0

## 0.11.0

### Minor Changes

- [#33](https://github.com/polynaut/dth-character-studio/pull/33) [`60d6eb2`](https://github.com/polynaut/dth-character-studio/commit/60d6eb2f0010bf7ea21379dfc1ffeafe3b469366) Thanks [@polynaut](https://github.com/polynaut)! - Show the app data folder in General settings — a read-only path chip pointing at where the app keeps its settings, project list, pose catalog and avatar images, so it's easy to find and back up.

- [#33](https://github.com/polynaut/dth-character-studio/pull/33) [`60d6eb2`](https://github.com/polynaut/dth-character-studio/commit/60d6eb2f0010bf7ea21379dfc1ffeafe3b469366) Thanks [@polynaut](https://github.com/polynaut)! - Record the DTH Character Studio version for traceability: each character JSON now carries a `studioVersion` field stamped on every save, and the generated Daz scripts include the version in their header comment ("generated by DTH Character Studio vX.Y.Z"). The version is read from the app at runtime (blank in the web-only build).

### Patch Changes

- Updated dependencies [[`60d6eb2`](https://github.com/polynaut/dth-character-studio/commit/60d6eb2f0010bf7ea21379dfc1ffeafe3b469366)]:
  - @dth/rom@0.11.0

## 0.10.0

### Minor Changes

- [#32](https://github.com/polynaut/dth-character-studio/pull/32) [`528ba6f`](https://github.com/polynaut/dth-character-studio/commit/528ba6fd041761fa29d5c4cd64f3b8394efe80a6) Thanks [@polynaut](https://github.com/polynaut)! - Measure pose-asset ROM frame lengths on the fly from the actual `.duf` files instead of hard-coding them. A native command (`pose_asset_frames`) reads each preset's DSON (gunzipping if needed) and returns `round(maxKeyTime × 30) + 1`; the base ROM, Golden Palace, Dicktator and Physics blocks are all measured per character — so custom assets (e.g. a user's own JCM `.duf`) work exactly like the DTH ones, and the generated PoseAsset CSV frame offsets are always correct. The editor's absolute frame numbers re-measure live as preset/custom selections change. Generation **hard-errors** if an included asset can't be read (never a silently wrong-length ROM); the `BASE_FRAMES_*`/`GP_FRAMES`/`DK_FRAMES`/`PHYS_FRAMES` constants are gone.

- [#30](https://github.com/polynaut/dth-character-studio/pull/30) [`f3f70d4`](https://github.com/polynaut/dth-character-studio/commit/f3f70d4a4578d60a459e79b63876d6bac5474096) Thanks [@polynaut](https://github.com/polynaut)! - Reorganized the DazToHue settings into two self-contained panes: **Setup DTH Release** (DTH release selection + My DAZ 3D Library + Houdini documents folder + install) and **Setup DTH Exporter Plugin Release** (Exporter Plugin selection + Daz Studio install folder + install). Each has its own dry-run, gating, and report, and the admin-sensitive plugin step fails with a clear "close all Daz and Houdini apps and restart as administrator" message. The Exporter pane also reads the version already installed in the Daz plugins folder and shows up-to-date / update-available, labelling its button Install / Update / Reinstall accordingly. The DazToHue-Scripts folder moved to General settings.

### Patch Changes

- Updated dependencies [[`528ba6f`](https://github.com/polynaut/dth-character-studio/commit/528ba6fd041761fa29d5c4cd64f3b8394efe80a6)]:
  - @dth/rom@0.10.0

## 0.9.0

### Minor Changes

- [#28](https://github.com/polynaut/dth-character-studio/pull/28) [`0bb2151`](https://github.com/polynaut/dth-character-studio/commit/0bb2151e5c351d24f0b17b107bcba5349f420d3a) Thanks [@polynaut](https://github.com/polynaut)! - Remember mapped network drives (X: → \\host\share) as you pick paths and re-map any that are missing on startup — so the app keeps working after you relaunch it as administrator, when Windows hides your interactive drive mappings from the elevated session. A new "Network drives" section in Settings → General lists them with their status, a manual re-map, and a Forget action.

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.9.0

## 0.8.0

### Minor Changes

- [#26](https://github.com/polynaut/dth-character-studio/pull/26) [`eb4a91b`](https://github.com/polynaut/dth-character-studio/commit/eb4a91b24abe0348344d903db9d9458579a5724d) Thanks [@polynaut](https://github.com/polynaut)! - Add an "i" info popup: hover to peek the rich-text content like a tooltip, click the "i" to pin it open for reading longer text and following links (closes on outside click / Escape). Positioned with Floating UI — it flips to wherever there's room and the arrow always points at the trigger. First used on the DTH Exporter Plugin field in Settings.

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.8.0

## 0.7.0

### Minor Changes

- [#24](https://github.com/polynaut/dth-character-studio/pull/24) [`d6d1f1e`](https://github.com/polynaut/dth-character-studio/commit/d6d1f1e01a20dfb0b4d3a6fec25287f253e193d9) Thanks [@polynaut](https://github.com/polynaut)! - Select a DTH Exporter Plugin release in Settings — point at the plugin folder (or a folder of versioned plugin folders) and the version is read straight from the exporter DLL.

- [#24](https://github.com/polynaut/dth-character-studio/pull/24) [`d6d1f1e`](https://github.com/polynaut/dth-character-studio/commit/d6d1f1e01a20dfb0b4d3a6fec25287f253e193d9) Thanks [@polynaut](https://github.com/polynaut)! - One-click install of a DTH release and the Exporter Plugin into your local Daz Studio and Houdini — a native (Rust) port of the dth-cli install commands, with a dry-run preview and new optional settings for the Daz Studio install folder and the Houdini documents folder.

- [#24](https://github.com/polynaut/dth-character-studio/pull/24) [`d6d1f1e`](https://github.com/polynaut/dth-character-studio/commit/d6d1f1e01a20dfb0b4d3a6fec25287f253e193d9) Thanks [@polynaut](https://github.com/polynaut)! - Settings is now organized into **General** and **DazToHue** tabs.

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.7.0

## 0.6.0

### Minor Changes

- [#22](https://github.com/polynaut/dth-character-studio/pull/22) [`55fd976`](https://github.com/polynaut/dth-character-studio/commit/55fd976ef77eaa6c6b9f9c135a0f48e537a2be72) Thanks [@polynaut](https://github.com/polynaut)! - Reworked the creation flows. The new-character form is browse-only with an explicit name (the character folder and its definition file follow that name), and it can prefill its ROM from an existing character of the same Genesis and gender. New projects are created folder-first, suggesting the name from the chosen folder.

- [#22](https://github.com/polynaut/dth-character-studio/pull/22) [`55fd976`](https://github.com/polynaut/dth-character-studio/commit/55fd976ef77eaa6c6b9f9c135a0f48e537a2be72) Thanks [@polynaut](https://github.com/polynaut)! - Characters can now link Houdini projects and open them directly in Houdini. Houdini projects are linked in place and never copied, so their stored absolute import paths keep working. New characters get an empty Houdini folder seeded so there is an obvious place to save the project — both the folder name and whether it is created are configurable in Settings.

- [#22](https://github.com/polynaut/dth-character-studio/pull/22) [`55fd976`](https://github.com/polynaut/dth-character-studio/commit/55fd976ef77eaa6c6b9f9c135a0f48e537a2be72) Thanks [@polynaut](https://github.com/polynaut)! - Characters can now link more than one Daz scene. Adding a scene from outside the character folder offers to copy or move it into a chosen subfolder, the scene folder can be relinked if it is renamed outside the app, and each scene can be unlinked (optionally deleting it from disk). Every scene shows as a card with its Daz `.tip.png` portrait, and clicking it opens the scene in Daz Studio.

### Patch Changes

- [#22](https://github.com/polynaut/dth-character-studio/pull/22) [`55fd976`](https://github.com/polynaut/dth-character-studio/commit/55fd976ef77eaa6c6b9f9c135a0f48e537a2be72) Thanks [@polynaut](https://github.com/polynaut)! - Editor and settings polish: a reusable zoomed-portrait component and Daz-branded scene cards, the character-file path management moved into Advanced options, and new default Daz / Houdini subfolder settings.

- [#22](https://github.com/polynaut/dth-character-studio/pull/22) [`55fd976`](https://github.com/polynaut/dth-character-studio/commit/55fd976ef77eaa6c6b9f9c135a0f48e537a2be72) Thanks [@polynaut](https://github.com/polynaut)! - The character editor's header (avatar + title) now sticks to the top of the
  viewport as the form scrolls beneath it (the Back / Discard / Save row above it
  scrolls away normally). The avatar also **shrinks over the first ~300px of
  scroll and then settles**, so the pinned header collapses to a compact bar — a
  pure CSS scroll-driven animation, which simply no-ops on browsers without scroll
  timelines.
- Updated dependencies [[`55fd976`](https://github.com/polynaut/dth-character-studio/commit/55fd976ef77eaa6c6b9f9c135a0f48e537a2be72), [`55fd976`](https://github.com/polynaut/dth-character-studio/commit/55fd976ef77eaa6c6b9f9c135a0f48e537a2be72)]:
  - @dth/rom@0.6.0

## 0.5.0

### Minor Changes

- [#20](https://github.com/polynaut/dth-character-studio/pull/20) [`4f00e2a`](https://github.com/polynaut/dth-character-studio/commit/4f00e2a1eeda2a2ca23c5027f36b38c24c5119e0) Thanks [@polynaut](https://github.com/polynaut)! - Rework the DTH release settings. The folder now accepts exactly two shapes: a
  single DTH release (detected by its `copyright.txt`), or a folder of versioned
  release folders. A multi-release folder shows a **version dropdown**; the chosen
  version is stored as `currentDthVersion` (`CURRENT_DTH_VERSION`) and, once set,
  newer releases dropped in later don't switch it automatically — you pick and
  save. When unset it pre-selects the latest extracted release and flags the form
  so you save once to record it.

  Saving now (re)builds the pose catalog for the active release — the separate
  "Scan DTH release" button is gone. Zipped releases are listed in the dropdown so
  you can see they exist, but they can't be used directly (Daz can't load poses
  from inside an archive); selecting one shows an "extract the release zip first"
  warning. The "point directly at a Poses folder" option was dropped — we always
  work with a full DTH release.

### Patch Changes

- [#19](https://github.com/polynaut/dth-character-studio/pull/19) [`2fa47cf`](https://github.com/polynaut/dth-character-studio/commit/2fa47cfdd80408c721605d5ca52aab102403cb7f) Thanks [@polynaut](https://github.com/polynaut)! - Remove the "DAZ 3D Library: …path… · change" line from the Projects overview —
  it's redundant there since the library is managed in Settings (reachable via the
  header link). The first-run prompt to set the library (shown only when none is
  configured) is kept.
- Updated dependencies []:
  - @dth/rom@0.5.0

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
