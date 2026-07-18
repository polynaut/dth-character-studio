# @dth/rom

## 0.44.1

## 0.44.0

## 0.43.1

## 0.43.0

### Minor Changes

- [#341](https://github.com/polynaut/dth-character-studio/pull/341) [`31bd91e`](https://github.com/polynaut/dth-character-studio/commit/31bd91e785fab9be00c76291d114724ff628146e) Thanks [@polynaut](https://github.com/polynaut)! - The ROM script now finds and selects the character's figure by itself (runtime v28). Forgetting to select the figure — or having something else selected — no longer aborts the run: the runtime locates the scene's figure of the character's Genesis generation by its source-asset identity, which survives any node renaming (labels and names are user-editable; the `.dsf` a figure was instantiated from is not), selects it and proceeds. With several matching figures in a scene the first one wins. Only a scene containing no figure of the character's generation still stops with an error.

- [#340](https://github.com/polynaut/dth-character-studio/pull/340) [`fe041b9`](https://github.com/polynaut/dth-character-studio/commit/fe041b91aff2a745b02a1a974072313ebe21308f) Thanks [@polynaut](https://github.com/polynaut)! - Scene-derived avatars stay in sync with their Daz scene. Daz rewrites a scene's preview image on every scene save, but the studio copied it exactly once — now the character remembers which linked scene its avatar mirrors (schema v12, additive `imageScene`), and the editor re-copies the preview whenever it drifts: on opening the character and every time the app window regains focus (tabbing back from Daz is enough — no reload needed). Custom-uploaded images and external URLs are never touched, and picking a different linked scene's preview in the image dialog re-targets the sync to that scene. Characters created before this release self-heal: when the stored avatar still matches a linked scene's current preview, that scene is adopted as the source automatically.

- [#338](https://github.com/polynaut/dth-character-studio/pull/338) [`f335e6e`](https://github.com/polynaut/dth-character-studio/commit/f335e6e09b21d0c839128fc098da01bf97a47961) Thanks [@polynaut](https://github.com/polynaut)! - Groom workflow: one scene can carry full hair while the ROM export stays clean. A new "Groom items" list on the character's Export section names the fitted hair items (usually just the cap — its children ride along); the generated script unfits + unparents each one right before the DTH Exporter runs and restores it afterwards, even when the export fails (hide-based exclusion was measured insufficient: the FBX exporter includes hidden nodes even on plugin 2.0 — only the alembic honors them). A mistyped label aborts the export loudly instead of silently shipping a hair-polluted FBX. The groom list suggests candidates straight from the character's linked scene: a native command reads the scene `.duf` (no Daz needed) and offers the items conformed to the figure as one-click chips, hair-ish names first — and warns when a listed label isn't in the scene. Groom lists are per SCENE — outfit scenes carry different hair styles — and the single generated script bakes the whole map, resolving the open scene's list at run time by filename (a scene without a list exports as-is). The Daz scene cards are selectable (click selects — the corner icon opens; the primary scene is selected on entry), and the groom editor edits the selected scene's list. A per-character groom mode still chooses the workflow: hair in the ROM scenes (default) or the classic separate-scene files. Character schema v15 (`groomScenes` + `groomMode`, additive — no migration needed). Characters with groom lists also get an `Export_Groom_<Name>.dsa`: it hides everything worn EXCEPT the groom and runs the exporter's dedicated groom action (`doExportAlembicGroomPoses`), producing the `_grooms.abc` Houdini's DazToHueGroom Import node wants. A new global setting, "Solve hair assets by hiding" (Settings → General, off by default), switches the ROM-export exclusion from the detach bracket to hiding the items with all their children — for DTH Exporter Plugin 2.0+, which skips hidden nodes.

### Patch Changes

- [#335](https://github.com/polynaut/dth-character-studio/pull/335) [`0b498e9`](https://github.com/polynaut/dth-character-studio/commit/0b498e9da7d9710c9d72118050f6e8d2d562f704) Thanks [@polynaut](https://github.com/polynaut)! - The DTH runtime is inline-config only now (runtime v27). The file-based config paths of the old wrapper-script era — the `extraJSONs` (`*_FBMs.json`) list, the GP9/DK9 art-direction JSON path fallbacks and the unused CSV reader — are removed; the runtime is studio-owned and everything arrives inline via the single `ApplyDTHCharacter(config)` call. A config that still passes file-based options aborts loudly with a regenerate-in-studio error instead of silently building a ROM without its custom frames. The GP/DK block-tail close-outs are unconditional now (their gating meta flags no longer exist — the option behind them was removed in the previous release), and the FBM-start art-morph reset is retired since the boundary close-out covers it. Dead migration code for the long-renamed `resetGPBeforeApplying` field is cleaned up too — old definitions still parse fine (unknown keys are stripped on read, as always).

## 0.42.6

### Patch Changes

- [#333](https://github.com/polynaut/dth-character-studio/pull/333) [`fe2c809`](https://github.com/polynaut/dth-character-studio/commit/fe2c809951a7e274249d5ef227970bb0b48648b7) Thanks [@polynaut](https://github.com/polynaut)! - ROM block tails no longer leak into the blocks after them (runtime v26). A pose preset can only key frames inside its own range, so a block's final pose had no ramp-down key past the block end and held its value through everything that followed — the base ROM's last FAC pose (a neck morph) showed as neck/throat morph deltas across the whole GEN range in Houdini. After the base block loads, the runtime now keys any morph not back at its frame-0 value to that value at the first post-base frame (figure and G9 mouth alike), completing the sawtooth the preset couldn't author. The GP and DK blocks get the same close-out on their own node at the next block boundary — closing the gaps the FBM-start art-morph reset left (.duf-baked gen morphs, characters without art direction, and a Physics block between GEN and the custom sections). The "Reset genitalia morphs before extra frames" character option is removed (schema v11): tails never leaking is behavior now, not a choice — its off position only reproduced the bug. Re-run the character's ROM script in Daz to rebuild existing timelines; Tools → Refresh assets flags characters generated on older runtimes as stale.

## 0.42.5

## 0.42.4

### Patch Changes

- [#328](https://github.com/polynaut/dth-character-studio/pull/328) [`1e768f4`](https://github.com/polynaut/dth-character-studio/commit/1e768f42efd0b94b0be77b4bbd6a63050127d22d) Thanks [@polynaut](https://github.com/polynaut)! - Hardening pass on hand-mirrored knowledge (the pattern behind the FAC staleness bug): the reference-FBX rule (`isBoneScaleRefPose`/`boneScaleRefPoses`) and the per-section preset availability (`sectionPresetAvailable`) now live once in `@dth/rom` — the editor's bone-scale warning, the CSV file column, the exporter frames and the "no asset" chip all derive from the same definitions, with tests coupling availability to path resolution. App settings collapse to ONE tolerant zod schema (`studioSettingsSchema`) covering the field list, defaults, the settings.json read and the save input; the per-project behaviour defaults are shared between the manifest and the save schema. No behaviour change.

## 0.42.3

### Patch Changes

- [#322](https://github.com/polynaut/dth-character-studio/pull/322) [`da0f89e`](https://github.com/polynaut/dth-character-studio/commit/da0f89e61f6280ef53f5b3afce629f219a090fb6) Thanks [@polynaut](https://github.com/polynaut)! - Toggling the FAC section now re-measures the preset ROM block lengths in the character editor. The FAC preset steers which JCM base asset the ROM resolves to (with vs. without the facial block), but the editor's re-measure trigger didn't watch it — so the timeline and frame numbers could show the stale previous length until an unrelated change. The trigger's field list now lives in `@dth/rom` next to the path resolution itself (`presetFramesSignature`), with a test coupling the two so a future resolver input can't silently go missing again.

- [#325](https://github.com/polynaut/dth-character-studio/pull/325) [`4a172dc`](https://github.com/polynaut/dth-character-studio/commit/4a172dce43131e9a3b491554ae64529b1cbd09fd) Thanks [@polynaut](https://github.com/polynaut)! - Internal refactor: the frame math + ROM walks (presetEndFrame, walkCustomPoses, flattenRom, …) moved out of types.ts into their own frames.ts module — the schemas and the `Character` model stay in types.ts. The `@dth/rom` export surface is unchanged; no behaviour change.

## 0.42.2

### Patch Changes

- [#320](https://github.com/polynaut/dth-character-studio/pull/320) [`8a696af`](https://github.com/polynaut/dth-character-studio/commit/8a696af01729c03795373c6ac05a87d9bd3d31d4) Thanks [@polynaut](https://github.com/polynaut)! - Enabling a section now defaults to the pre-defined DTH asset when the installed release ships one for the character's generation (PHY included — it wrongly defaulted to the custom morph list), falling back to custom only when no asset exists or the section already carries your own groups. Also: the FAC preset description explains the Genesis 9 Mouth companion in plain words, and the Art direction explainer moved into an info popup next to its title.

## 0.42.1

## 0.42.0

### Patch Changes

- [#316](https://github.com/polynaut/dth-character-studio/pull/316) [`ca0fb2f`](https://github.com/polynaut/dth-character-studio/commit/ca0fb2fe9903ddacf18d5acd89f39631e7bce20d) Thanks [@polynaut](https://github.com/polynaut)! - Scan_Frames ships with the studio: the keyframe-scan script (formerly DazToHue-Scripts' DthScanFrames) installs into Scripts/DTH-Character-Studio like the other scan scripts and writes its CSV — one per Daz scene — into the studio's own scan folder. "Import from CSV" now opens a picker listing those scans (newest first) with a Browse fallback for hand-curated files. The Tools → DazToHue-Scripts download/installer is gone — everything the workflow needs is bundled; the scan folder is bounded by the housekeeping sweep (30 days).

## 0.41.42

## 0.41.41

## 0.41.40

## 0.41.39

## 0.41.38

## 0.41.37

### Patch Changes

- [#301](https://github.com/polynaut/dth-character-studio/pull/301) [`06f58ba`](https://github.com/polynaut/dth-character-studio/commit/06f58ba8a2fe485b066b10054e44221e118cabc7) Thanks [@polynaut](https://github.com/polynaut)! - Bone scale is now limited to GEN and FBM poses — a reference-FBX path on a MIS row breaks the DazToHue HDA's CSV import (verified in Houdini), so the toggle is hidden in MISC and generation never emits reference paths or exporter reference frames there. Refresh assets regenerates any CSV that carried one.

## 0.41.36

## 0.41.35

## 0.41.34

## 0.41.33

## 0.41.32

### Patch Changes

- [#289](https://github.com/polynaut/dth-character-studio/pull/289) [`1610a5b`](https://github.com/polynaut/dth-character-studio/commit/1610a5b3cba977537bd232024f1be93b4aafe7e9) Thanks [@polynaut](https://github.com/polynaut)! - Reference-skeleton FBX is now a **Bone scale** toggle instead of a free-text path. Turn it on for a morph that scales bones (e.g. Torso Length, Proportion Height) and the studio does the rest: the DTH Exporter already generates the per-frame reference-skeleton FBX, and the PoseAsset CSV's `file` column is now auto-filled with that FBX's absolute path — no more typing or drift.

  The path is resolved bulletproof at run time: the studio writes a `{{DTH_EXPORT_DIR}}` token into the CSV, and the generated Daz script substitutes the real export dir (scene subfolder included) when it copies the CSV next to the exporter output — so Houdini gets the exact absolute path it wants. A warning appears if bone-scale frames are set without an export directory (the exporter needs one to produce the FBX). Existing `referenceFbx` paths migrate to the toggle automatically.

## 0.41.31

## 0.41.30

### Patch Changes

- [#285](https://github.com/polynaut/dth-character-studio/pull/285) [`1f56e4c`](https://github.com/polynaut/dth-character-studio/commit/1f56e4cb152c32b201bb09634268543faafb6689) Thanks [@polynaut](https://github.com/polynaut)! - Block Save (and generation) on a custom pose name that isn't Houdini-safe, not just on empty fields. The Name cell already flags spaces/punctuation with a red border (Houdini accepts only letters, numbers and underscores), but the save gate only checked for empty fields — so a red-bordered name could still be saved. `romValidationErrors` now mirrors the cell rule, so a flagged field can't slip past Save.

## 0.41.29

### Patch Changes

- [#283](https://github.com/polynaut/dth-character-studio/pull/283) [`19c3a12`](https://github.com/polynaut/dth-character-studio/commit/19c3a126a621bd75f5b4c79387a5b0196721b507) Thanks [@polynaut](https://github.com/polynaut)! - Remove the generated `Open_Scene_<Character>.dsa` script and rework the "Daz Studio is already open" dialog. Opening a character always launches a fresh Daz, so the dialog now asks you to close Daz Studio first — once it has fully quit (polled every couple of seconds), the button switches from "Open anyway" to "Open now" and launches it cleanly. Any leftover `Open_Scene_*` scripts are cleaned up on the next regeneration (Tools → Refresh assets).

## 0.41.28

## 0.41.27

## 0.41.26

### Patch Changes

- [#277](https://github.com/polynaut/dth-character-studio/pull/277) [`2a125ef`](https://github.com/polynaut/dth-character-studio/commit/2a125ef49d35d60fde8437fcabcf31ba8de29643) Thanks [@polynaut](https://github.com/polynaut)! - Add a **Set UE5 tear UV** toggle to a character's Advanced options (Genesis 9 only,
  opt-in, off by default). When enabled, the generated ROM script switches the
  Genesis 9 Tear figure's shader UV set to "UE5" during the build — so DTH's Lacrimal
  Fluid material lines up without the manual Surfaces-tab step, and it can't be
  forgotten. Character schema → v9 (additive `applyUE5TearUV`, no migration step).

## 0.41.25

## 0.41.24

## 0.41.23

### Patch Changes

- [#261](https://github.com/polynaut/dth-character-studio/pull/261) [`543b7ce`](https://github.com/polynaut/dth-character-studio/commit/543b7ce6e093878ed07ad044f02fe5ae07de065c) Thanks [@polynaut](https://github.com/polynaut)! - Bump `RUNTIME_VERSION` (20 → 21) so **Refresh assets** flags every existing
  character stale and regenerates it — installing the new per-character
  `Open_Scene_<Character>.dsa` script for characters created before that feature. No
  runtime `.dsa` file changed; the bump is purely to trigger regeneration.

## 0.41.22

## 0.41.21

## 0.41.20

## 0.41.19

## 0.41.18

## 0.41.17

## 0.41.16

## 0.41.15

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
