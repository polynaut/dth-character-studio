# @dth/rom

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

## 0.33.0

### Minor Changes

- [#157](https://github.com/polynaut/dth-character-studio/pull/157) [`ce86c32`](https://github.com/polynaut/dth-character-studio/commit/ce86c32397d2138ece891b98551cad000c35fd3c) Thanks [@polynaut](https://github.com/polynaut)! - **Daz Studio 6: ROM keyframes no longer drift.** DS6's animation engine drifts
  LINEAR-interpolated ROM keys across the timeline (poses creeping over frames —
  mrpdean's June 2026 warning, e.g. the G9 DQS JCM FAC cheek poses). The runtime
  now detects Daz Studio 6 and stamps every ROM morph key **Constant** instead of
  Linear (his validated workaround), leaving Daz Studio 4 on the proven Linear
  behavior. The final interpolation pass also covers the FAC mouth node, whose
  keys a root-only pass never touched. Runtime bumped to **v17** — Tools →
  Refresh assets regenerates existing characters' scripts.

## 0.32.3

## 0.32.2

## 0.32.1

## 0.32.0

### Minor Changes

- [#137](https://github.com/polynaut/dth-character-studio/pull/137) [`bdacdba`](https://github.com/polynaut/dth-character-studio/commit/bdacdba1f4df07e0553ba29ed0ee74eae289a9fc) Thanks [@polynaut](https://github.com/polynaut)! - **Frame alignment: preset-block lengths are never hard-coded.** The Daz runtime no
  longer bakes in `iRomFrames 328/617`, `gpFrameCount 104`, `dk9FrameCount 54`,
  `physFrameCount 43`. Instead the studio measures each block from the actual `.duf`
  (it already did, for the CSV) and threads them into the generated script as
  `presetFrames`; the runtime sizes every block from those measured counts and **fails
  loud** (logs + aborts) if one is missing — so a custom or future-DTH preset of
  non-standard length can't silently desync the Daz timeline from the PoseAsset CSV.

  Guarded by two new tests: one fails CI if any frame-count literal reappears in the
  runtime, and a cross-artifact property test proving the CSV and the Daz script derive
  every custom frame's position from the same measured lengths across a config matrix.

  Runtime bumped to **v16** — Tools → Refresh assets regenerates existing characters'
  scripts to carry the measured `presetFrames`.

## 0.31.3

## 0.31.2

## 0.31.1

## 0.31.0

### Minor Changes

- [#122](https://github.com/polynaut/dth-character-studio/pull/122) [`3e4bd09`](https://github.com/polynaut/dth-character-studio/commit/3e4bd09012b3a47a69d9440428888fa407a8bae7) Thanks [@polynaut](https://github.com/polynaut)! - **Fix a frame-alignment off-by-one + harden generated scripts against injection** (from a full app audit).

  - **Base-less characters no longer desync from Daz.** A character with no preset ROM block (FBM-only, or custom JCM groups) started its first custom frame at 1 in the PoseAsset CSV / exporter reference frames, while Daz built it at 0 — a one-frame misalignment for the whole custom sequence (the exact class of bug the "frames are computed, never stored" invariant exists to prevent). Removed the `Math.max(…, 0)` clamp in all three consumers. Runtime bumped to **v15** so **Tools → Refresh assets** regenerates affected characters' scripts/CSVs.
  - **Daz Script injection closed.** A character `name` containing a newline could break out of the generated `.dsa`'s `//` comment header into executable DzScript — reachable by opening/generating a shared malicious definition. Control chars (CR/LF/U+2028/U+2029) are now stripped from names in comment headers.
  - **CSV injection closed.** Group labels and reference-FBX paths are stripped of commas/newlines so they can't inject extra columns/rows into the Houdini PoseAsset CSV.

## 0.30.0

## 0.29.2

## 0.29.1

### Patch Changes

- [#113](https://github.com/polynaut/dth-character-studio/pull/113) [`d7f5d16`](https://github.com/polynaut/dth-character-studio/commit/d7f5d1651bbdf33f8cc50ff18d2d618fe16f1315) Thanks [@polynaut](https://github.com/polynaut)! - **Hotfix: every v0.29.0 ROM script failed with `URIError: !{{ Legacy Include }}`.** Daz resolves `include()` through its legacy-include mechanism, which fails inside a `try/catch` — and v0.29.0's catch-all wrapper had moved the runtime include into one. The include is back at the top level (with a regression-guard test), a `typeof` check covers a missing runtime instead, and the export block is now skipped when the ROM build aborts. **Save each character (or run Tools → Refresh assets once) to regenerate the broken scripts** (script runtime v14).

  Run-report UX, reworked: the Daz dialog is short and generic ("Something went wrong while building the ROM — switch back to DTH Character Studio to see what failed") — the details live in the studio. The studio now **ingests** the Daz-written log into its own `.last_rom_run.json` store and deletes the Daz file (throwaway transport). The report shows above the tabs, **failed morphs mark their rows red in the ROM editor**, and when the report is scrolled off-screen a floating "Errors in the last ROM run — click to see details" hint jumps to it.

## 0.29.0

### Minor Changes

- [#111](https://github.com/polynaut/dth-character-studio/pull/111) [`35ffc96`](https://github.com/polynaut/dth-character-studio/commit/35ffc96a0e31f5e7e62ec7eab51617355dfc3302) Thanks [@polynaut](https://github.com/polynaut)! - **ROM runs now report their problems back to the studio.** The generated Daz script writes a run log (`dth_rom_run_log.json` in the character folder) after every run — listing each morph that couldn't be applied (frame, node, reason) and any other error, including unexpected script failures (a catch-all reports even a missing runtime or a crash mid-run). When something failed, the script ends with a dialog pointing back to the studio, and the character page shows the full list the moment you switch back to it (re-checked on window focus), with a Dismiss button. A clean run clears the previous report automatically.

  **A missing morph can no longer break the ROM's frame alignment.** Frame slots come from the character's declaration, not from what actually applied: a morph that isn't found in the scene is logged and skipped while its frames stay in the ROM (empty), invalid frame numbers are logged instead of silently shortening the timeline, and the legacy per-frame loop no longer drops the rest of a frame's morphs on the first miss — one bad morph costs exactly that morph, nothing else.

  **The character script is now always named `ROM_<Name>_<Genesis>.dsa`** — previously the `ROM_` prefix appeared only in split-export mode. The stale un-prefixed script is cleaned up on the next Save; **Tools → Refresh assets** regenerates all characters (script runtime v13).

## 0.28.0

## 0.27.0

### Minor Changes

- [#101](https://github.com/polynaut/dth-character-studio/pull/101) [`38aafd3`](https://github.com/polynaut/dth-character-studio/commit/38aafd3a0e5bfd3a0669b60800e4e6e27f4ec7fc) Thanks [@polynaut](https://github.com/polynaut)! - Add **Daz Products** — an opt-in, per-project scan of which Daz products a character uses. Turn it on in **Settings → Project → Enable Daz Products** (off by default). Each character then gets a generated **`Scan_Products_<Character>.dsa`** alongside its ROM script. Open the character's scene in Daz, run the script, and it analyses the open scene — walking used nodes + non-zero morphs and each node's material texture paths — then matches them to your installed products and writes a CSV the studio reads back.

  Set the **DAZ Install Manager manifests folder** in **Settings → General** (with a one-click **Detect installed location**) so the scan can resolve assets to real product **names, SKUs, artists and versions**; without it the scan still lists the used assets. Back on the character page, enabling the feature splits the editor into **Character** and **Products** tabs (the tabs appear only when Daz Products is on, so the scan never crowds the character form). The **Products** tab surfaces the results — a table of matched products plus an expandable list of unmatched assets (with their source files) — and a **Store on character** action persists them onto the character definition. A **Clear** button (active only while there are scan results to discard) wipes the per-scene CSVs to start fresh, leaving any products already stored on the character untouched. The tab is split into two panels: a **Scan files** panel that always shows which per-scene CSVs back the results — their output folder, and a row per scene with its source `.duf` path, product/unmatched counts and when it was last written — so it's clear what Check / Clear / Store act on and which Daz scene each scan came from; and a separate **Matched products** panel with the listing itself. Once you've stored products, a status banner makes the relationship to the files on disk explicit either way: a green **Up to date** when nothing on disk is newer than your last save, or an amber **scan changed since you last stored** (with the counts — e.g. "11 found now vs 9 stored" — and the save time) when a re-scan has produced new results. The store button follows suit, settling into a disabled **Stored — up to date** instead of an always-active "Update stored products". Each product row **expands** to list the exact scene morph(s)/node(s) that found it (each tagged Morph/Node), so you can see precisely why it's there. Store products (those with a DIM SKU) link out to their **Daz product page**, and scene render-setting singletons (the Tonemapper/Environment "Options" nodes) are excluded so they don't clutter the unmatched list. The **Match** column header carries an info popup explaining each match method (File/Texture, SKU, Keyword, Third-Party, Genesis Base, Parent/Group, Manifest).

  Scans are tracked **per Daz scene**, so a character's outfit/look variants don't overwrite each other. The runtime reads the open scene (`Scene.getFilename()`) and writes one CSV per scene; the studio reads them all and merges, so each product and unmatched asset is tagged with the scene(s) it was found in — a **Scene(s)** column appears once more than one scene has been scanned. When more than one scene has been scanned, a **View** switch ("All scenes" plus one chip per scene) lets you flip between the merged table and a single scene's products; scoping to one scene drops the now-redundant Scene(s) column. Products and unmatched assets are listed **alphabetically**. Open an outfit scene, run the scan, repeat for the next outfit, and the results accumulate with their scene attribution.

  Each matched product shows **what it was used for** in the scene — a heuristic role (Morph, Clothing, Hair, Genitalia, Geograft, Accessory, Figure, …) derived from the assets that matched it, with the specific assets on hover — so you can tell _why_ a product is in the scene. Matching links a used item to its product even when their names share nothing (e.g. a glove node "ACGloves" from "Adventure Outfit"): it reads the node's **material texture paths** — the one file reference Daz exposes for a scene node — across _every_ map channel (diffuse, normal, bump, roughness, metallic, …, not just the base color, so a metal zipper or a procedurally-tinted flower with no diffuse map still matches) and maps their `vendor/product` folder to the product that installed it. A geograft wearing a _copy_ of the figure's body skin (common — the copy-textures workflow) is recognised: the figure's own skin folders are excluded so the geograft isn't mis-identified as the skin product. A texture-folder match is treated as proof the product is genuinely used, so it intentionally bypasses the Genesis prefilter — that's how a G8 outfit auto-fitted onto a G9 figure still matches. An unmatched clothing **sub-part** — a zipper, a flower trim, a dForce layer that loads as its own node parented to the garment — inherits the product its parent matched (a "Parent Match"), provided that parent isn't the base figure, so these stop landing in "unmatched". Sub-parts the scene parents to the _figure_ rather than the garment (so parent-inheritance can't reach them) are caught by a final **"Manifest Match"**: an unmatched node whose name is the basename of a file a product installs (a "Frangipani"/"Zipper" node ↔ `Frangipani.dsf`/`Zipper.dsf`) is attributed to that product — but only to a product _already matched elsewhere in the same scene_, so a generic part name can't pull in an unrelated library product. And a decoration that loads as an empty **group/null node** (no geometry, texture or own file) whose real parts are matched children inherits its children's product (a "Group Match"). Beyond that it is **prefiltered by the character's known Genesis version** (from the studio, not guessed): products for a different generation are rejected and, when several editions of a product are installed (e.g. a G8 _and_ a G9 Golden Palace), the one matching the character's generation wins. It also needs stronger keyword confidence (two distinct shared keywords — a lone generic word like "top" or "inside" can't anchor a match) and pulls in manually-installed (non-DIM) products from `LOCAL_USER_*` metadata so they match instead of landing in "unmatched". As a final resort it **synthesizes products from the content library's `data/<Vendor>/<Product>` folders** ("Content Folder Match"), so content that carries _no_ DIM or `LOCAL_USER` metadata at all — e.g. unofficial products — is still recognised, named by its folder and attributed to its vendor (with the real artist/version read from the content's own files). These run only after the metadata-backed products and are skipped when a real product already owns the folder/name, so they never duplicate or override a properly-tracked product. Products and unmatched assets are enriched with **artist + version read straight from each asset's own `.dsf`/`.duf` metadata** (the vendor's `author` + `revision`), which the DIM install manifests don't carry — content-relative paths are resolved under the library so the real revision surfaces instead of just the DIM build number, and for a matched product a representative file from its file list is read as a fallback. That file list comes from the DIM manifest for store products and from the `LOCAL_USER_*` metadata's own asset list for manual installs — so a manually-installed product like Golden Palace now surfaces its real vendor `author` + `revision` (read from its own `.duf`/`.dsf`) instead of "Unknown". Unmatched assets still show whatever artist/version their files carry.

  Mechanics: a new bundled runtime (`DthProducts.dsa`) is installed once next to the other DTH runtime files; each scan writes a per-scene CSV into an app-local-data folder keyed by project + character id; the character schema gains additive `products` / `productsUnmatched` / `productsScannedAt` fields (each product/asset also carrying the `scenes` it was found in — no migration needed). The runtime version bumped, so **Tools → Refresh assets** regenerates existing characters' scan scripts to the per-scene layout.

## 0.26.1

## 0.26.0

## 0.25.0

## 0.24.1

## 0.24.0

## 0.23.1

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

### Minor Changes

- [#57](https://github.com/polynaut/dth-character-studio/pull/57) [`b4359a3`](https://github.com/polynaut/dth-character-studio/commit/b4359a3df854de73243a37d06ee8d53a4d469b94) Thanks [@polynaut](https://github.com/polynaut)! - Add a **"Generate subfolders based on Daz scenes"** toggle to the character
  editor's Export directory panel. When on, the generated Daz script resolves the
  open scene at run time via `Scene.getFilename()` and nests the export under a
  subfolder named after it (the exporter's own `<characterName>` subfolder is
  created inside that) — so a character's scene/outfit variants export side by
  side. Falls back to the export root when no scene is saved. Adds
  `exportSceneSubfolders` to the character schema (→ `CHARACTER_SCHEMA_VERSION` 4).

## 0.18.0

### Minor Changes

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

- [#55](https://github.com/polynaut/dth-character-studio/pull/55) [`9c2bbf4`](https://github.com/polynaut/dth-character-studio/commit/9c2bbf4c633fe930d05b21b929fca548044f61f8) Thanks [@polynaut](https://github.com/polynaut)! - Rename the generated PoseAsset CSV to DTH's convention: `<name>_pose_asset.csv`
  (was `<name>_PoseAsset.csv`). The legacy-cased file is cleaned up from the
  character folder and the export folder on the next generate.

## 0.17.0

## 0.16.0

## 0.15.1

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

## 0.14.0

### Minor Changes

- [#40](https://github.com/polynaut/dth-character-studio/pull/40) [`2d28983`](https://github.com/polynaut/dth-character-studio/commit/2d28983450883ccd0248d116b121a79d5b38518f) Thanks [@polynaut](https://github.com/polynaut)! - Generalize the "Reset GP before applying extra frames" option: it's now **"Reset genitalia morphs before extra frames"** with a clear description, and it applies to whichever genital ROM is active — Golden Palace _or_ Dicktator — not just GP. The character field `resetGPBeforeApplying` was renamed to `resetGenBeforeApplying` (old definitions migrate automatically on load), and generation now emits the per-block reset flags the DTH runtime understands for both GP and DK.

- [#41](https://github.com/polynaut/dth-character-studio/pull/41) [`ce6d790`](https://github.com/polynaut/dth-character-studio/commit/ce6d790f69901930ed48642636a527094167348c) Thanks [@polynaut](https://github.com/polynaut)! - Generated Daz scripts are now installed into a per-character subfolder —
  `…/Scripts/DTH-Character-Studio/<project>/<character>/<Name>_<Genesis>.dsa` —
  instead of all sitting flat in the `DTH-Character-Studio` root. The DTH runtime
  (`.DthWorkflow.dsa` + `.DthUtils.dsa` + `.DthOptions.dsa`) is installed **once**
  in that root, and each character script now imports it from two levels up. A
  character rename moves its subfolder, and any flat-layout script left by an
  earlier version is cleaned up on the next generate.

## 0.13.0

## 0.12.0

## 0.11.0

### Minor Changes

- [#33](https://github.com/polynaut/dth-character-studio/pull/33) [`60d6eb2`](https://github.com/polynaut/dth-character-studio/commit/60d6eb2f0010bf7ea21379dfc1ffeafe3b469366) Thanks [@polynaut](https://github.com/polynaut)! - Record the DTH Character Studio version for traceability: each character JSON now carries a `studioVersion` field stamped on every save, and the generated Daz scripts include the version in their header comment ("generated by DTH Character Studio vX.Y.Z"). The version is read from the app at runtime (blank in the web-only build).

## 0.10.0

### Minor Changes

- [#32](https://github.com/polynaut/dth-character-studio/pull/32) [`528ba6f`](https://github.com/polynaut/dth-character-studio/commit/528ba6fd041761fa29d5c4cd64f3b8394efe80a6) Thanks [@polynaut](https://github.com/polynaut)! - Measure pose-asset ROM frame lengths on the fly from the actual `.duf` files instead of hard-coding them. A native command (`pose_asset_frames`) reads each preset's DSON (gunzipping if needed) and returns `round(maxKeyTime × 30) + 1`; the base ROM, Golden Palace, Dicktator and Physics blocks are all measured per character — so custom assets (e.g. a user's own JCM `.duf`) work exactly like the DTH ones, and the generated PoseAsset CSV frame offsets are always correct. The editor's absolute frame numbers re-measure live as preset/custom selections change. Generation **hard-errors** if an included asset can't be read (never a silently wrong-length ROM); the `BASE_FRAMES_*`/`GP_FRAMES`/`DK_FRAMES`/`PHYS_FRAMES` constants are gone.

## 0.9.0

## 0.8.0

## 0.7.0

## 0.6.0

### Minor Changes

- [#22](https://github.com/polynaut/dth-character-studio/pull/22) [`55fd976`](https://github.com/polynaut/dth-character-studio/commit/55fd976ef77eaa6c6b9f9c135a0f48e537a2be72) Thanks [@polynaut](https://github.com/polynaut)! - Characters can now link Houdini projects and open them directly in Houdini. Houdini projects are linked in place and never copied, so their stored absolute import paths keep working. New characters get an empty Houdini folder seeded so there is an obvious place to save the project — both the folder name and whether it is created are configurable in Settings.

- [#22](https://github.com/polynaut/dth-character-studio/pull/22) [`55fd976`](https://github.com/polynaut/dth-character-studio/commit/55fd976ef77eaa6c6b9f9c135a0f48e537a2be72) Thanks [@polynaut](https://github.com/polynaut)! - Characters can now link more than one Daz scene. Adding a scene from outside the character folder offers to copy or move it into a chosen subfolder, the scene folder can be relinked if it is renamed outside the app, and each scene can be unlinked (optionally deleting it from disk). Every scene shows as a card with its Daz `.tip.png` portrait, and clicking it opens the scene in Daz Studio.

## 0.5.0

## 0.4.0

### Minor Changes

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - Character editor: the **Filepath** field now spans the full width of the card
  (it sits on its own row below the settings instead of being squeezed beside the
  Genesis-specific box), so long paths are fully visible. Characters created from a
  Daz scene now record that scene's path, shown read-only as a **Daz scene** field
  beneath the Filepath. Adds an optional `scenePath` to the character schema
  (empty for characters made before the scene-based create flow).

## 0.3.2

## 0.3.1

## 0.3.0

## 0.2.1

## 0.2.0

### Minor Changes

- [#2](https://github.com/polynaut/dth-character-studio/pull/2) [`7131015`](https://github.com/polynaut/dth-character-studio/commit/71310154dfd5b07d4f2d1f150c0a66e5c6ac652d) Thanks [@polynaut](https://github.com/polynaut)! - Migrate the desktop runtime from Electron to Tauri 2, convert the frontend to a client-rendered SPA, and restructure into a 2-layer monorepo: `@dth/web` (SPA frontend), `@dth/desktop` (Tauri shell), `@dth/rom` (pure generation core). Adds in-app auto-update (GitHub Releases) and a changesets-driven release pipeline.
