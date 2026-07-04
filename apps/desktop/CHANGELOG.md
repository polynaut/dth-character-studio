# @dth/desktop

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
