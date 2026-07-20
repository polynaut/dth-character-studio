# @dth/web

## 0.44.8

### Patch Changes

- [#389](https://github.com/polynaut/dth-character-studio/pull/389) [`314ec06`](https://github.com/polynaut/dth-character-studio/commit/314ec06e7095b8d26f62370ce4393cee23916b53) Thanks [@polynaut](https://github.com/polynaut)! - Modify JCM frames: dropped the redundant per-drive positive/negative selector — a drive's direction is now read from its angle range's sign (e.g. `Angle to` −115 = the negative bend), so a rule holds one signed drive list. Existing characters migrate automatically (the two lists merge) and the generated Daz script is byte-for-byte unchanged.

- Updated dependencies []:
  - @dth/rom@0.44.8
  - @dth/ui@0.44.8

## 0.44.7

### Patch Changes

- [#386](https://github.com/polynaut/dth-character-studio/pull/386) [`72fb0d1`](https://github.com/polynaut/dth-character-studio/commit/72fb0d1195204fdfcaa9b1976ca458c90095cdf4) Thanks [@polynaut](https://github.com/polynaut)! - Advanced options and Modify JCM frames now show and edit morph values as Daz-style percentages (e.g. `100%`, `33%`) instead of raw `0–1` numbers, matching the ROM pose value cells. Values are still stored 0–1, so generation is unchanged.

- Updated dependencies []:
  - @dth/rom@0.44.7
  - @dth/ui@0.44.7

## 0.44.6

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.44.6
  - @dth/ui@0.44.6

## 0.44.5

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.44.5
  - @dth/ui@0.44.5

## 0.44.4

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.44.4
  - @dth/ui@0.44.4

## 0.44.3

### Patch Changes

- [#362](https://github.com/polynaut/dth-character-studio/pull/362) [`fddd2f8`](https://github.com/polynaut/dth-character-studio/commit/fddd2f8637fb24e51272a1422eb5323a613d7103) Thanks [@polynaut](https://github.com/polynaut)! - The "unsaved changes — leave and lose them?" prompt and the "move character folders?" confirm now render in the app's own themed modal (focus trap, Escape/backdrop = cancel, "Leave"/"Move folders" buttons) instead of a native OS dialog. A single `ConfirmProvider` hosts an app-styled, promise-based confirm at the root, so both the route-navigation guard and the Tauri window-close (✕) path go through it; the native `confirmDialog` helper is gone. The browser-reload `beforeunload` prompt stays native — it can't be styled and only affects the web build.

- [#354](https://github.com/polynaut/dth-character-studio/pull/354) [`98de896`](https://github.com/polynaut/dth-character-studio/commit/98de896b234423b327dbe1db868d8edd76fadd25) Thanks [@polynaut](https://github.com/polynaut)! - Keyboard and screen-reader accessibility sweep: a new `Modal` primitive (Radix Dialog — real focus trap, initial focus, focus restore, Escape/backdrop dismissal, proper dialog semantics) now backs every previously hand-rolled overlay (remove-asset, bulk-delete, scene-copy, avatar image, scene-copy prompt and the "Daz already open" notice — the avatar dialog gains Escape support it never had). The side panel manages focus properly instead of declaring `aria-modal` without containment. ROM section headers are real accordion buttons (focusable, Enter/Space, `aria-expanded`) instead of click-only divs. `Field` labels are programmatically associated with their controls and errors (`htmlFor`/`aria-describedby`). The linked-asset card's corner-open control works from the keyboard, `NumberField` commits on Enter, the editable page title keeps its heading semantics for assistive tech, the Home screen's "remove from recents" button becomes visible on keyboard focus, and the UI-config provider no longer re-renders all consumers on every host render.

- [#360](https://github.com/polynaut/dth-character-studio/pull/360) [`847e9dd`](https://github.com/polynaut/dth-character-studio/commit/847e9ddfef123a0c42573b5808301893f2b4530e) Thanks [@polynaut](https://github.com/polynaut)! - Groom (hair) exclusion is hide-only now (runtime v31). DTH Exporter Plugin 2.0.1 moved the unfit+unparent step into the plugin — it unparents any hidden child node before exporting and reparents it after — so the generated script only has to HIDE the groom items and the plugin excludes them from both the FBX and the alembic. The script's own detach path (unfit+unparent+refit) and the app-global "Solve hair assets by hiding" setting are gone; hiding is the single mechanism. Refresh assets regenerates existing characters onto the simpler export block. Because hide-only now needs Exporter Plugin 2.0.1+ (an older one would export the hidden hair into the FBX), the character editor's groom section reads the installed plugin's DLL version and warns clearly when it's too old.

- [#361](https://github.com/polynaut/dth-character-studio/pull/361) [`0e33b5e`](https://github.com/polynaut/dth-character-studio/commit/0e33b5e84ad54af0b51398be6926aa5a9ae0cb5f) Thanks [@polynaut](https://github.com/polynaut)! - Consistent naming: in the Daz side it's "hair", not "groom" (it only becomes a "groom" downstream in Houdini/Unreal). The standalone hair-export script is now `Export_Hair_<Name>_<Genesis>.dsa` (was `Export_Groom_…`), and every user-facing Daz string — the generated script's log/dialog lines, the character editor's hair section, and the guide — reads "hair". The Houdini-bound artifacts keep their downstream term: the exported `_grooms.abc` and Houdini's DazToHueGroom Import are unchanged. Regenerating a character sweeps the old `Export_Groom_…` script from its folder. The guide's hair section also drops the stale unfit/refit + "Solve hair assets by hiding" wording (hiding has been the single mechanism since the Exporter Plugin 2.0.1 change).

- [#356](https://github.com/polynaut/dth-character-studio/pull/356) [`0b2c8dd`](https://github.com/polynaut/dth-character-studio/commit/0b2c8dd8739f2e6531d6c1dc9dac74a603337cb3) Thanks [@polynaut](https://github.com/polynaut)! - Opportunistic cleanups: the Deduplicate tool's shared-file groups gain the "Accept" button its help text always promised — marking a group as legitimately shared now actually persists (it stopped appearing on the next scan) instead of being a dead code path. The Settings route's release/exporter pickers and the network-drives section move into `components/settings/`, and the UI kit's public surface drops exports nothing consumes (the unused `Slider` primitive, plus internal-only helpers). Inside the generation core, the thrice-copied groom "hide-tree" DzScript snippet is extracted into one name-parameterised builder (byte-identical output, pinned by the existing tests). Two more Playwright smoke flows cover the character editor's inline rename end-to-end.

- [#350](https://github.com/polynaut/dth-character-studio/pull/350) [`0348765`](https://github.com/polynaut/dth-character-studio/commit/0348765bd88b4c64f5708a3f70a8f83e67140dc7) Thanks [@polynaut](https://github.com/polynaut)! - The network-drive remap result (`ensure_network_drives`) now goes through the FFI contract regime like every other structured return: zod-parsed at the invoke boundary (no more bare `invoke<T>()` cast) and pinned by a shared `contracts/remap-results.json` fixture tested on both the serde and zod side. The phantom `'unsupported'` status that no Rust path ever produced is gone from both sides. Remap failures for Explorer "reconnect at sign-in" mappings (Windows errors 1201/1202) now get actionable messages instead of a bare error number, and very long UNC paths no longer misreport as "unmapped".

- [#351](https://github.com/polynaut/dth-character-studio/pull/351) [`b243f48`](https://github.com/polynaut/dth-character-studio/commit/b243f48bcb978e381daa0ba777fd0235cb0ec23d) Thanks [@polynaut](https://github.com/polynaut)! - ROM-core hardening from the 2026-07-18 review: generated Daz scripts escape U+2028/U+2029 in every embedded string (a shared definition carrying one no longer breaks the whole script — Daz's engine treats them as line terminators); the exporter and the PoseAsset CSV now share one sanitized figure name, so a comma in a character name can't make the CSV point at a reference FBX the exporter never writes; the PHY preset block's start frame derives from the single frame-math source (`presetEndFrame`) instead of a private sum; a custom PHY section flags its CSV as experimental until the physics payload is modeled; art-direction frame offsets must be whole and non-negative; sections in unsupported modes (e.g. a crafted RET-custom) are rejected at parse instead of silently shifting every custom frame, while files missing section keys now heal to defaults; duplicate pose names within one suffix scope are flagged before they collide into the same Unreal morph; the Daz morph-CSV import handles BOMs and quoted fields (RFC-4180) instead of naive comma-splitting; `mirrorGroup` no longer corrupts non-sided names like CleftChin; and a corrupt (non-object) character JSON fails validation cleanly instead of throwing.

- [#352](https://github.com/polynaut/dth-character-studio/pull/352) [`afb2f96`](https://github.com/polynaut/dth-character-studio/commit/afb2f968429896def140b5b89432d4839b039631) Thanks [@polynaut](https://github.com/polynaut)! - Multi-window write safety for the machine settings: saving settings now merges by baseline — only the fields you actually changed on that page win, everything else is re-read fresh from disk — so with one project per window, a save in one window no longer silently reverts what another window saved in the meantime. The Tools page now arms the unsaved-changes guard like Settings and the character editor (navigating away or closing the window with unsaved Tools edits asks first). A corrupt settings.json is surfaced once at startup instead of silently resetting every tool path to defaults. The Project tab's defaults now come from the single canonical copy instead of a second hardcoded list.

- [#353](https://github.com/polynaut/dth-character-studio/pull/353) [`b645619`](https://github.com/polynaut/dth-character-studio/commit/b645619abaca8f76b75697ac9f00da391a984d43) Thanks [@polynaut](https://github.com/polynaut)! - Web-layer robustness: all file/folder pickers no-op in a plain browser like the rest of the native boundary (Browse buttons were unhandled rejections there); the export-section switches are single-flight — two quick toggles can no longer run overlapping save+generate rounds that settle the editor to the older result; hovering a character card no longer ingests (and deletes) the Daz-written ROM run log mid-write — ingestion happens only on real visits and the window-focus refetch; a failed inline rename rolls the optimistic name back instead of leaving it as a phantom dirty edit; the network-drive "Forget" and DIM-folder auto-detect surface their errors instead of rejecting silently; the unsaved-changes prompt always shows its current message; and the `dirOf` path helper lives once in lib/path instead of twice inline.

- Updated dependencies [[`98de896`](https://github.com/polynaut/dth-character-studio/commit/98de896b234423b327dbe1db868d8edd76fadd25), [`847e9dd`](https://github.com/polynaut/dth-character-studio/commit/847e9ddfef123a0c42573b5808301893f2b4530e), [`0e33b5e`](https://github.com/polynaut/dth-character-studio/commit/0e33b5e84ad54af0b51398be6926aa5a9ae0cb5f), [`0b2c8dd`](https://github.com/polynaut/dth-character-studio/commit/0b2c8dd8739f2e6531d6c1dc9dac74a603337cb3), [`b243f48`](https://github.com/polynaut/dth-character-studio/commit/b243f48bcb978e381daa0ba777fd0235cb0ec23d)]:
  - @dth/ui@0.44.3
  - @dth/rom@0.44.3

## 0.44.2

### Patch Changes

- [#357](https://github.com/polynaut/dth-character-studio/pull/357) [`5aa6386`](https://github.com/polynaut/dth-character-studio/commit/5aa63862b5a8785640afbc3a0faa4bdf60e55878) Thanks [@polynaut](https://github.com/polynaut)! - Fix a ROM-build regression (runtime v30): the base-ROM tail close-out no longer double-applies character-owned morphs. Since v26 it ran a whole-figure re-key at the FAC→GEN boundary using each morph's post-ROM value; for a morph the character or a GP/character preset drives (e.g. ProportionHeight), that stacked the value on top of the ERC-driven contribution, so a -10% dialed height showed as -20% by frame 327. The runtime now snapshots the morph baseline before the ROM loads and leaves any character-dialed (non-zero base) morph untouched — only pure ROM poses (the final FAC neck pose that v26 was added to fix) still close their dangling tail. Re-run the ROM script in Daz (Tools → Refresh assets) to rebuild affected timelines. Found by Soltude80's testing.

- Updated dependencies [[`5aa6386`](https://github.com/polynaut/dth-character-studio/commit/5aa63862b5a8785640afbc3a0faa4bdf60e55878)]:
  - @dth/rom@0.44.2
  - @dth/ui@0.44.2

## 0.44.1

### Patch Changes

- [#347](https://github.com/polynaut/dth-character-studio/pull/347) [`22c7071`](https://github.com/polynaut/dth-character-studio/commit/22c70712bf37a3cce5a26f2194b4bfad6dc51432) Thanks [@polynaut](https://github.com/polynaut)! - Groom UI polish: the switch reads "Hair items (groom) live in the Daz scenes" (bold On/Off in its popup), and the label + popup over the per-scene picker are gone — the selected scene card right above is the context, and the full how-it-works moved into the guide's new "Hair items (groom)" section.

- Updated dependencies []:
  - @dth/rom@0.44.1
  - @dth/ui@0.44.1

## 0.44.0

### Minor Changes

- [#345](https://github.com/polynaut/dth-character-studio/pull/345) [`05d3a78`](https://github.com/polynaut/dth-character-studio/commit/05d3a781f16303b3d929fe287bae5cec383305c1) Thanks [@polynaut](https://github.com/polynaut)! - The groom (hair) settings moved up under the Daz scene cards — the lists are per scene, so selecting a card now visibly swaps the hair list right beneath it. The list itself is a new multi-select combobox (new `MultiSelect` in `@dth/ui`): the selected items sit in one always-rendered field as removable pills, clicking into it lists the scene's remaining wearables (hair-ish first, type to filter), and a label the scan doesn't offer can still be typed and added. A pill whose label isn't found in the scene turns amber with a tooltip. The combobox implements the full ARIA pattern (active-descendant list, wrap-around arrow keys, Home/End, match highlighting) — pills are keyboard-reachable via ArrowLeft, Backspace asks twice before dropping one, and Escape closing the list won't also close a surrounding dialog.

### Patch Changes

- Updated dependencies [[`05d3a78`](https://github.com/polynaut/dth-character-studio/commit/05d3a781f16303b3d929fe287bae5cec383305c1)]:
  - @dth/ui@0.44.0
  - @dth/rom@0.44.0

## 0.43.1

### Patch Changes

- [#343](https://github.com/polynaut/dth-character-studio/pull/343) [`4b63955`](https://github.com/polynaut/dth-character-studio/commit/4b639551258fc175716b8dac3d4ecec2420f860e) Thanks [@polynaut](https://github.com/polynaut)! - The "Solve hair assets by hiding" setting is labeled experimental: as of Exporter Plugin 2.0 (preview), hiding keeps hair out of the Alembic but not yet the FBX — the default detach mechanism covers both.

- Updated dependencies []:
  - @dth/rom@0.43.1
  - @dth/ui@0.43.1

## 0.43.0

### Minor Changes

- [#341](https://github.com/polynaut/dth-character-studio/pull/341) [`31bd91e`](https://github.com/polynaut/dth-character-studio/commit/31bd91e785fab9be00c76291d114724ff628146e) Thanks [@polynaut](https://github.com/polynaut)! - The ROM script now finds and selects the character's figure by itself (runtime v28). Forgetting to select the figure — or having something else selected — no longer aborts the run: the runtime locates the scene's figure of the character's Genesis generation by its source-asset identity, which survives any node renaming (labels and names are user-editable; the `.dsf` a figure was instantiated from is not), selects it and proceeds. With several matching figures in a scene the first one wins. Only a scene containing no figure of the character's generation still stops with an error.

- [#340](https://github.com/polynaut/dth-character-studio/pull/340) [`fe041b9`](https://github.com/polynaut/dth-character-studio/commit/fe041b91aff2a745b02a1a974072313ebe21308f) Thanks [@polynaut](https://github.com/polynaut)! - Scene-derived avatars stay in sync with their Daz scene. Daz rewrites a scene's preview image on every scene save, but the studio copied it exactly once — now the character remembers which linked scene its avatar mirrors (schema v12, additive `imageScene`), and the editor re-copies the preview whenever it drifts: on opening the character and every time the app window regains focus (tabbing back from Daz is enough — no reload needed). Custom-uploaded images and external URLs are never touched, and picking a different linked scene's preview in the image dialog re-targets the sync to that scene. Characters created before this release self-heal: when the stored avatar still matches a linked scene's current preview, that scene is adopted as the source automatically.

- [#338](https://github.com/polynaut/dth-character-studio/pull/338) [`f335e6e`](https://github.com/polynaut/dth-character-studio/commit/f335e6e09b21d0c839128fc098da01bf97a47961) Thanks [@polynaut](https://github.com/polynaut)! - Groom workflow: one scene can carry full hair while the ROM export stays clean. A new "Groom items" list on the character's Export section names the fitted hair items (usually just the cap — its children ride along); the generated script unfits + unparents each one right before the DTH Exporter runs and restores it afterwards, even when the export fails (hide-based exclusion was measured insufficient: the FBX exporter includes hidden nodes even on plugin 2.0 — only the alembic honors them). A mistyped label aborts the export loudly instead of silently shipping a hair-polluted FBX. The groom list suggests candidates straight from the character's linked scene: a native command reads the scene `.duf` (no Daz needed) and offers the items conformed to the figure as one-click chips, hair-ish names first — and warns when a listed label isn't in the scene. Groom lists are per SCENE — outfit scenes carry different hair styles — and the single generated script bakes the whole map, resolving the open scene's list at run time by filename (a scene without a list exports as-is). The Daz scene cards are selectable (click selects — the corner icon opens; the primary scene is selected on entry), and the groom editor edits the selected scene's list. A per-character groom mode still chooses the workflow: hair in the ROM scenes (default) or the classic separate-scene files. Character schema v15 (`groomScenes` + `groomMode`, additive — no migration needed). Characters with groom lists also get an `Export_Groom_<Name>.dsa`: it hides everything worn EXCEPT the groom and runs the exporter's dedicated groom action (`doExportAlembicGroomPoses`), producing the `_grooms.abc` Houdini's DazToHueGroom Import node wants. A new global setting, "Solve hair assets by hiding" (Settings → General, off by default), switches the ROM-export exclusion from the detach bracket to hiding the items with all their children — for DTH Exporter Plugin 2.0+, which skips hidden nodes.

### Patch Changes

- [#335](https://github.com/polynaut/dth-character-studio/pull/335) [`0b498e9`](https://github.com/polynaut/dth-character-studio/commit/0b498e9da7d9710c9d72118050f6e8d2d562f704) Thanks [@polynaut](https://github.com/polynaut)! - The DTH runtime is inline-config only now (runtime v27). The file-based config paths of the old wrapper-script era — the `extraJSONs` (`*_FBMs.json`) list, the GP9/DK9 art-direction JSON path fallbacks and the unused CSV reader — are removed; the runtime is studio-owned and everything arrives inline via the single `ApplyDTHCharacter(config)` call. A config that still passes file-based options aborts loudly with a regenerate-in-studio error instead of silently building a ROM without its custom frames. The GP/DK block-tail close-outs are unconditional now (their gating meta flags no longer exist — the option behind them was removed in the previous release), and the FBM-start art-morph reset is retired since the boundary close-out covers it. Dead migration code for the long-renamed `resetGPBeforeApplying` field is cleaned up too — old definitions still parse fine (unknown keys are stripped on read, as always).

- Updated dependencies [[`31bd91e`](https://github.com/polynaut/dth-character-studio/commit/31bd91e785fab9be00c76291d114724ff628146e), [`fe041b9`](https://github.com/polynaut/dth-character-studio/commit/fe041b91aff2a745b02a1a974072313ebe21308f), [`f335e6e`](https://github.com/polynaut/dth-character-studio/commit/f335e6e09b21d0c839128fc098da01bf97a47961), [`0b498e9`](https://github.com/polynaut/dth-character-studio/commit/0b498e9da7d9710c9d72118050f6e8d2d562f704)]:
  - @dth/rom@0.43.0
  - @dth/ui@0.43.0

## 0.42.6

### Patch Changes

- [#333](https://github.com/polynaut/dth-character-studio/pull/333) [`fe2c809`](https://github.com/polynaut/dth-character-studio/commit/fe2c809951a7e274249d5ef227970bb0b48648b7) Thanks [@polynaut](https://github.com/polynaut)! - ROM block tails no longer leak into the blocks after them (runtime v26). A pose preset can only key frames inside its own range, so a block's final pose had no ramp-down key past the block end and held its value through everything that followed — the base ROM's last FAC pose (a neck morph) showed as neck/throat morph deltas across the whole GEN range in Houdini. After the base block loads, the runtime now keys any morph not back at its frame-0 value to that value at the first post-base frame (figure and G9 mouth alike), completing the sawtooth the preset couldn't author. The GP and DK blocks get the same close-out on their own node at the next block boundary — closing the gaps the FBM-start art-morph reset left (.duf-baked gen morphs, characters without art direction, and a Physics block between GEN and the custom sections). The "Reset genitalia morphs before extra frames" character option is removed (schema v11): tails never leaking is behavior now, not a choice — its off position only reproduced the bug. Re-run the character's ROM script in Daz to rebuild existing timelines; Tools → Refresh assets flags characters generated on older runtimes as stale.

- Updated dependencies [[`fe2c809`](https://github.com/polynaut/dth-character-studio/commit/fe2c809951a7e274249d5ef227970bb0b48648b7)]:
  - @dth/rom@0.42.6
  - @dth/ui@0.42.6

## 0.42.5

### Patch Changes

- [#331](https://github.com/polynaut/dth-character-studio/pull/331) [`25e3cab`](https://github.com/polynaut/dth-character-studio/commit/25e3cab3cfdf3fa9e6766a33243c0d025ff2eddb) Thanks [@polynaut](https://github.com/polynaut)! - The character editor's Discard/Save buttons keep their large "at the top" size on pages too short to scroll (e.g. the Notes tab) — the same inactive-scroll-timeline quirk as the Back-link fix: with no scrollable overflow the shrink animation yields no values, so the buttons fell to their collapsed default size while the rest of the header showed its expanded state.

- Updated dependencies []:
  - @dth/rom@0.42.5
  - @dth/ui@0.42.5

## 0.42.4

### Patch Changes

- [#330](https://github.com/polynaut/dth-character-studio/pull/330) [`0b0805f`](https://github.com/polynaut/dth-character-studio/commit/0b0805f2af9127432643bd695272035d4165bdca) Thanks [@polynaut](https://github.com/polynaut)! - Two editor fixes: the sticky header's scroll-in "Back" link no longer shows up immediately on the Notes tab (on a page too short to scroll the scroll timeline is inactive, so the link fell back to its visible base state — it now defaults to hidden, and the run-error hint gets the same guard), and the "Modify JCM frames" header is no longer a button wrapping the info popup's button (invalid HTML that React flagged and assistive tech misreads). Under the hood, the Rust↔TS boundary is now pinned by shared contract fixtures — serde round-trips and the api layer's zod schemas validate the same JSON on both sides, and the frame-measurement result is parsed at the boundary instead of blindly cast.

- [#328](https://github.com/polynaut/dth-character-studio/pull/328) [`1e768f4`](https://github.com/polynaut/dth-character-studio/commit/1e768f42efd0b94b0be77b4bbd6a63050127d22d) Thanks [@polynaut](https://github.com/polynaut)! - Hardening pass on hand-mirrored knowledge (the pattern behind the FAC staleness bug): the reference-FBX rule (`isBoneScaleRefPose`/`boneScaleRefPoses`) and the per-section preset availability (`sectionPresetAvailable`) now live once in `@dth/rom` — the editor's bone-scale warning, the CSV file column, the exporter frames and the "no asset" chip all derive from the same definitions, with tests coupling availability to path resolution. App settings collapse to ONE tolerant zod schema (`studioSettingsSchema`) covering the field list, defaults, the settings.json read and the save input; the per-project behaviour defaults are shared between the manifest and the save schema. No behaviour change.

- Updated dependencies [[`1e768f4`](https://github.com/polynaut/dth-character-studio/commit/1e768f42efd0b94b0be77b4bbd6a63050127d22d)]:
  - @dth/rom@0.42.4
  - @dth/ui@0.42.4

## 0.42.3

### Patch Changes

- [#327](https://github.com/polynaut/dth-character-studio/pull/327) [`b8aedf7`](https://github.com/polynaut/dth-character-studio/commit/b8aedf77311c07c39adff083cd892fa702fa4a1b) Thanks [@polynaut](https://github.com/polynaut)! - Internal refactor: the character editor's draft machinery (dirty tracking against the last-persisted baseline, the unsaved-changes guard, and the save → generate → settle choreography) moved out of the route into a `useCharacterDraft` hook. No behaviour change.

- [#322](https://github.com/polynaut/dth-character-studio/pull/322) [`da0f89e`](https://github.com/polynaut/dth-character-studio/commit/da0f89e61f6280ef53f5b3afce629f219a090fb6) Thanks [@polynaut](https://github.com/polynaut)! - Toggling the FAC section now re-measures the preset ROM block lengths in the character editor. The FAC preset steers which JCM base asset the ROM resolves to (with vs. without the facial block), but the editor's re-measure trigger didn't watch it — so the timeline and frame numbers could show the stale previous length until an unrelated change. The trigger's field list now lives in `@dth/rom` next to the path resolution itself (`presetFramesSignature`), with a test coupling the two so a future resolver input can't silently go missing again.

- Updated dependencies [[`da0f89e`](https://github.com/polynaut/dth-character-studio/commit/da0f89e61f6280ef53f5b3afce629f219a090fb6), [`4a172dc`](https://github.com/polynaut/dth-character-studio/commit/4a172dce43131e9a3b491554ae64529b1cbd09fd)]:
  - @dth/rom@0.42.3
  - @dth/ui@0.42.3

## 0.42.2

### Patch Changes

- [#320](https://github.com/polynaut/dth-character-studio/pull/320) [`8a696af`](https://github.com/polynaut/dth-character-studio/commit/8a696af01729c03795373c6ac05a87d9bd3d31d4) Thanks [@polynaut](https://github.com/polynaut)! - Enabling a section now defaults to the pre-defined DTH asset when the installed release ships one for the character's generation (PHY included — it wrongly defaulted to the custom morph list), falling back to custom only when no asset exists or the section already carries your own groups. Also: the FAC preset description explains the Genesis 9 Mouth companion in plain words, and the Art direction explainer moved into an info popup next to its title.

- Updated dependencies [[`8a696af`](https://github.com/polynaut/dth-character-studio/commit/8a696af01729c03795373c6ac05a87d9bd3d31d4)]:
  - @dth/rom@0.42.2
  - @dth/ui@0.42.2

## 0.42.1

### Patch Changes

- [#318](https://github.com/polynaut/dth-character-studio/pull/318) [`822ceaf`](https://github.com/polynaut/dth-character-studio/commit/822ceafafb2d9b12a8a97383a4676bdfd04c7651) Thanks [@polynaut](https://github.com/polynaut)! - Settings grew an "App Data" tab (app data folder + storage housekeeping, moved out of General/Tools), the Project tab leads in project windows, network drives got their own pane at the bottom of General, and the import picker's rows expand to a copyable path chip instead of a tooltip. Tooltips app-wide now wrap long paths correctly. The "Empty quarantine" button is gone — the dedup quarantine is a plain folder you manage yourself in Explorer.

- Updated dependencies [[`822ceaf`](https://github.com/polynaut/dth-character-studio/commit/822ceafafb2d9b12a8a97383a4676bdfd04c7651)]:
  - @dth/ui@0.42.1
  - @dth/rom@0.42.1

## 0.42.0

### Minor Changes

- [#316](https://github.com/polynaut/dth-character-studio/pull/316) [`ca0fb2f`](https://github.com/polynaut/dth-character-studio/commit/ca0fb2fe9903ddacf18d5acd89f39631e7bce20d) Thanks [@polynaut](https://github.com/polynaut)! - Scan_Frames ships with the studio: the keyframe-scan script (formerly DazToHue-Scripts' DthScanFrames) installs into Scripts/DTH-Character-Studio like the other scan scripts and writes its CSV — one per Daz scene — into the studio's own scan folder. "Import from CSV" now opens a picker listing those scans (newest first) with a Browse fallback for hand-curated files. The Tools → DazToHue-Scripts download/installer is gone — everything the workflow needs is bundled; the scan folder is bounded by the housekeeping sweep (30 days).

### Patch Changes

- Updated dependencies [[`ca0fb2f`](https://github.com/polynaut/dth-character-studio/commit/ca0fb2fe9903ddacf18d5acd89f39631e7bce20d)]:
  - @dth/rom@0.42.0
  - @dth/ui@0.42.0

## 0.41.42

### Patch Changes

- [#314](https://github.com/polynaut/dth-character-studio/pull/314) [`d1ab6e7`](https://github.com/polynaut/dth-character-studio/commit/d1ab6e7c355bd038c954959b6695ee4e1af4c98c) Thanks [@polynaut](https://github.com/polynaut)! - Character page polish: wider Genesis/Gender selects, the Genesis 9 box now stays visible with its fields disabled on non-G9 characters (instead of disappearing), the "experimental" tag is gone, and Genesis 3 is selectable — DazToHue ships a subset of G3 pose assets, so the studio offers what the release provides.

- Updated dependencies []:
  - @dth/rom@0.41.42
  - @dth/ui@0.41.42

## 0.41.41

### Patch Changes

- [#312](https://github.com/polynaut/dth-character-studio/pull/312) [`f8b478a`](https://github.com/polynaut/dth-character-studio/commit/f8b478ae51bfec1999a5b8e29a658a21b954f740) Thanks [@polynaut](https://github.com/polynaut)! - Genesis 9 box rearranged: the strength dials sit on top (baseline-aligned with Genesis/Gender, as before the toggle moved in) and the UE5 tear UV toggle sits below them.

- Updated dependencies []:
  - @dth/rom@0.41.41
  - @dth/ui@0.41.41

## 0.41.40

### Patch Changes

- [#310](https://github.com/polynaut/dth-character-studio/pull/310) [`32d9ac7`](https://github.com/polynaut/dth-character-studio/commit/32d9ac73b77b969cbade32eb0b21317f110c3206) Thanks [@polynaut](https://github.com/polynaut)! - Genesis/Gender now sit on the same baseline as the Genesis 9 box's first row (the tear-UV toggle) — matched content-top offsets and label line heights.

- Updated dependencies []:
  - @dth/rom@0.41.40
  - @dth/ui@0.41.40

## 0.41.39

### Patch Changes

- [#306](https://github.com/polynaut/dth-character-studio/pull/306) [`feafd91`](https://github.com/polynaut/dth-character-studio/commit/feafd9150fb1bbcf3f49fed6ed2c9eb020238736) Thanks [@polynaut](https://github.com/polynaut)! - The FACS detail / Flexion strength dials now show Daz-style percentages (0–100 %, with a % suffix) like every morph value field, and the Genesis 9 box got more breathing room between the tear-UV toggle and the dials. Stored values are unchanged (raw 1 = 100 %) — no migration needed.

- Updated dependencies [[`feafd91`](https://github.com/polynaut/dth-character-studio/commit/feafd9150fb1bbcf3f49fed6ed2c9eb020238736)]:
  - @dth/ui@0.41.39
  - @dth/rom@0.41.39

## 0.41.38

### Patch Changes

- [#303](https://github.com/polynaut/dth-character-studio/pull/303) [`28dd7b2`](https://github.com/polynaut/dth-character-studio/commit/28dd7b2ef178732f804899341d110cae9cea4a99) Thanks [@polynaut](https://github.com/polynaut)! - The "Set UE5 tear UV" toggle moved from the Advanced options panel into the "Genesis 9 specific" box (above the FACS/Flexion strength dials) — it's a G9-only setting, so that's where it belongs.

- Updated dependencies []:
  - @dth/rom@0.41.38
  - @dth/ui@0.41.38

## 0.41.37

### Patch Changes

- [#301](https://github.com/polynaut/dth-character-studio/pull/301) [`06f58ba`](https://github.com/polynaut/dth-character-studio/commit/06f58ba8a2fe485b066b10054e44221e118cabc7) Thanks [@polynaut](https://github.com/polynaut)! - Bone scale is now limited to GEN and FBM poses — a reference-FBX path on a MIS row breaks the DazToHue HDA's CSV import (verified in Houdini), so the toggle is hidden in MISC and generation never emits reference paths or exporter reference frames there. Refresh assets regenerates any CSV that carried one.

- Updated dependencies [[`06f58ba`](https://github.com/polynaut/dth-character-studio/commit/06f58ba8a2fe485b066b10054e44221e118cabc7)]:
  - @dth/rom@0.41.37
  - @dth/ui@0.41.37

## 0.41.36

### Patch Changes

- [#299](https://github.com/polynaut/dth-character-studio/pull/299) [`4109c82`](https://github.com/polynaut/dth-character-studio/commit/4109c820ccc55a77e182e6b75f49db90af1e44f9) Thanks [@polynaut](https://github.com/polynaut)! - About page: a "Report a problem" link that opens a prefilled GitHub bug form (app version included), plus a pointer to the new Discussions Q&A. The repo also gains bug/feature issue templates, an honest per-figure support matrix in the README, and a release smoke checklist.

- Updated dependencies []:
  - @dth/rom@0.41.36
  - @dth/ui@0.41.36

## 0.41.35

### Patch Changes

- [#296](https://github.com/polynaut/dth-character-studio/pull/296) [`0b3c955`](https://github.com/polynaut/dth-character-studio/commit/0b3c955131285eff5a34ce75042d7dad6103432e) Thanks [@polynaut](https://github.com/polynaut)! - Kill the last 1px layout shift between an empty group and its first morph row — the placeholder now mirrors the name input's exact vertical metrics instead of a hard-coded height.

- Updated dependencies []:
  - @dth/rom@0.41.35
  - @dth/ui@0.41.35

## 0.41.34

### Patch Changes

- [#294](https://github.com/polynaut/dth-character-studio/pull/294) [`9478e53`](https://github.com/polynaut/dth-character-studio/commit/9478e533275a64ac02f984880171777799a46658) Thanks [@polynaut](https://github.com/polynaut)! - Fix a layout shift when adding the first pose to an empty ROM group. The "No poses in this group yet." placeholder was taller than a real pose row, so adding the first morph made the list jump. The empty state now matches a pose row's height.

- Updated dependencies []:
  - @dth/rom@0.41.34
  - @dth/ui@0.41.34

## 0.41.33

### Patch Changes

- [#292](https://github.com/polynaut/dth-character-studio/pull/292) [`065544c`](https://github.com/polynaut/dth-character-studio/commit/065544c7fcc626646898d8ef04f494fa4f1b6a47) Thanks [@polynaut](https://github.com/polynaut)! - Guide the export-directory picker to a sensible starting folder. When no export directory is set yet, the **Choose folder…** dialog now opens in the character's own folder — already inside its Houdini subfolder when that exists — so the export lands where it usually should with one click. Re-choosing an existing directory opens at the current one. You can still browse anywhere; it only changes where the dialog starts.

- Updated dependencies []:
  - @dth/rom@0.41.33
  - @dth/ui@0.41.33

## 0.41.32

### Patch Changes

- [#289](https://github.com/polynaut/dth-character-studio/pull/289) [`1610a5b`](https://github.com/polynaut/dth-character-studio/commit/1610a5b3cba977537bd232024f1be93b4aafe7e9) Thanks [@polynaut](https://github.com/polynaut)! - Reference-skeleton FBX is now a **Bone scale** toggle instead of a free-text path. Turn it on for a morph that scales bones (e.g. Torso Length, Proportion Height) and the studio does the rest: the DTH Exporter already generates the per-frame reference-skeleton FBX, and the PoseAsset CSV's `file` column is now auto-filled with that FBX's absolute path — no more typing or drift.

  The path is resolved bulletproof at run time: the studio writes a `{{DTH_EXPORT_DIR}}` token into the CSV, and the generated Daz script substitutes the real export dir (scene subfolder included) when it copies the CSV next to the exporter output — so Houdini gets the exact absolute path it wants. A warning appears if bone-scale frames are set without an export directory (the exporter needs one to produce the FBX). Existing `referenceFbx` paths migrate to the toggle automatically.

- Updated dependencies [[`1610a5b`](https://github.com/polynaut/dth-character-studio/commit/1610a5b3cba977537bd232024f1be93b4aafe7e9)]:
  - @dth/rom@0.41.32
  - @dth/ui@0.41.32

## 0.41.31

### Patch Changes

- [#287](https://github.com/polynaut/dth-character-studio/pull/287) [`5b17fb9`](https://github.com/polynaut/dth-character-studio/commit/5b17fb956d00c417a505d0356dab99c12ea2137e) Thanks [@polynaut](https://github.com/polynaut)! - When a blocked Save jumps to the offending pose row, focus the field that's actually flagged. It used to focus the first _empty_ input in the row, which for a filled-but-invalid name (e.g. one with a space) landed on the empty optional Reference FBX field instead. It now prefers the red-bordered (`aria-invalid`) input and only falls back to the first empty one — so the cursor lands where the error is.

- Updated dependencies []:
  - @dth/rom@0.41.31
  - @dth/ui@0.41.31

## 0.41.30

### Patch Changes

- [#285](https://github.com/polynaut/dth-character-studio/pull/285) [`1f56e4c`](https://github.com/polynaut/dth-character-studio/commit/1f56e4cb152c32b201bb09634268543faafb6689) Thanks [@polynaut](https://github.com/polynaut)! - Block Save (and generation) on a custom pose name that isn't Houdini-safe, not just on empty fields. The Name cell already flags spaces/punctuation with a red border (Houdini accepts only letters, numbers and underscores), but the save gate only checked for empty fields — so a red-bordered name could still be saved. `romValidationErrors` now mirrors the cell rule, so a flagged field can't slip past Save.

- Updated dependencies [[`1f56e4c`](https://github.com/polynaut/dth-character-studio/commit/1f56e4cb152c32b201bb09634268543faafb6689)]:
  - @dth/rom@0.41.30
  - @dth/ui@0.41.30

## 0.41.29

### Patch Changes

- [#283](https://github.com/polynaut/dth-character-studio/pull/283) [`19c3a12`](https://github.com/polynaut/dth-character-studio/commit/19c3a126a621bd75f5b4c79387a5b0196721b507) Thanks [@polynaut](https://github.com/polynaut)! - Remove the generated `Open_Scene_<Character>.dsa` script and rework the "Daz Studio is already open" dialog. Opening a character always launches a fresh Daz, so the dialog now asks you to close Daz Studio first — once it has fully quit (polled every couple of seconds), the button switches from "Open anyway" to "Open now" and launches it cleanly. Any leftover `Open_Scene_*` scripts are cleaned up on the next regeneration (Tools → Refresh assets).

- Updated dependencies [[`19c3a12`](https://github.com/polynaut/dth-character-studio/commit/19c3a126a621bd75f5b4c79387a5b0196721b507)]:
  - @dth/rom@0.41.29
  - @dth/ui@0.41.29

## 0.41.28

### Patch Changes

- [#281](https://github.com/polynaut/dth-character-studio/pull/281) [`690844d`](https://github.com/polynaut/dth-character-studio/commit/690844d6e3ae0a38448892581eb2e4d25f2b04fb) Thanks [@polynaut](https://github.com/polynaut)! - Make input validation errors clearer. Invalid fields now show a **more visible red
  border** (a 2px destructive ring instead of a faint 1px border — both the ROM cell
  inputs and the shared `Input` primitive), and a field whose error lived in a `title`
  attribute (the ROM name/morph cells) now shows it in a proper **alert-style tooltip**
  (red background, light text) via a new `data-tooltip-variant="error"` on the global
  tooltip.
- Updated dependencies [[`690844d`](https://github.com/polynaut/dth-character-studio/commit/690844d6e3ae0a38448892581eb2e4d25f2b04fb)]:
  - @dth/ui@0.41.28
  - @dth/rom@0.41.28

## 0.41.27

### Patch Changes

- Updated dependencies [[`b0125f0`](https://github.com/polynaut/dth-character-studio/commit/b0125f0baa6191c188f95a5fa6575b77ce7fb150)]:
  - @dth/ui@0.41.27
  - @dth/rom@0.41.27

## 0.41.26

### Patch Changes

- [#277](https://github.com/polynaut/dth-character-studio/pull/277) [`2a125ef`](https://github.com/polynaut/dth-character-studio/commit/2a125ef49d35d60fde8437fcabcf31ba8de29643) Thanks [@polynaut](https://github.com/polynaut)! - Add a **Set UE5 tear UV** toggle to a character's Advanced options (Genesis 9 only,
  opt-in, off by default). When enabled, the generated ROM script switches the
  Genesis 9 Tear figure's shader UV set to "UE5" during the build — so DTH's Lacrimal
  Fluid material lines up without the manual Surfaces-tab step, and it can't be
  forgotten. Character schema → v9 (additive `applyUE5TearUV`, no migration step).
- Updated dependencies [[`2a125ef`](https://github.com/polynaut/dth-character-studio/commit/2a125ef49d35d60fde8437fcabcf31ba8de29643)]:
  - @dth/rom@0.41.26
  - @dth/ui@0.41.26

## 0.41.25

### Patch Changes

- [#275](https://github.com/polynaut/dth-character-studio/pull/275) [`90354b6`](https://github.com/polynaut/dth-character-studio/commit/90354b6bc1d71883ed5cb56dd3ca3f18a7f6ed82) Thanks [@polynaut](https://github.com/polynaut)! - Keep spellcheck on the Notes field. Spellcheck is disabled app-wide (the technical
  fields hold morph names and paths), but Notes are freeform prose, so re-enable it
  there with `spellCheck` on the textarea to override the inherited default.
- Updated dependencies []:
  - @dth/rom@0.41.25
  - @dth/ui@0.41.25

## 0.41.24

### Patch Changes

- [#272](https://github.com/polynaut/dth-character-studio/pull/272) [`c6d0167`](https://github.com/polynaut/dth-character-studio/commit/c6d01670bbf89b19ca3f812f6da838e63dff411e) Thanks [@polynaut](https://github.com/polynaut)! - Turn off browser spellcheck across the app. The text fields hold morph/property
  names, node labels and paths (e.g. `GP_Vagina_Open_Stretch`), not prose, so the red
  squiggly underline was pure noise. Set `spellcheck="false"` on `<body>` — it's an
  inherited attribute, so it covers every input, including the raw ROM-cell fields.
- Updated dependencies []:
  - @dth/rom@0.41.24
  - @dth/ui@0.41.24

## 0.41.23

### Patch Changes

- Updated dependencies [[`543b7ce`](https://github.com/polynaut/dth-character-studio/commit/543b7ce6e093878ed07ad044f02fe5ae07de065c)]:
  - @dth/rom@0.41.23
  - @dth/ui@0.41.23

## 0.41.22

### Patch Changes

- [#259](https://github.com/polynaut/dth-character-studio/pull/259) [`cfed18c`](https://github.com/polynaut/dth-character-studio/commit/cfed18ca90713f600dc25eb747707b4388c6b7fe) Thanks [@polynaut](https://github.com/polynaut)! - Add a reliable way to open a character's scene when Daz Studio is already running.
  The studio can't switch a running Daz's scene itself (a forwarded open is dropped
  once a scene is loaded), so generation now writes a per-character
  `Open_Scene_<Character>.dsa` into the Content Library that opens the scene from
  inside Daz (replacing the current one, after a save warning). Clicking a scene card
  while Daz is open now shows a dialog pointing at that script, with an "Open anyway"
  that still forwards (which works when Daz has no scene loaded). With Daz closed,
  cards open as before.
- Updated dependencies []:
  - @dth/rom@0.41.22
  - @dth/ui@0.41.22

## 0.41.21

### Patch Changes

- [#257](https://github.com/polynaut/dth-character-studio/pull/257) [`58d6219`](https://github.com/polynaut/dth-character-studio/commit/58d6219bf47d5365fd5f62eb22f1285e9226af21) Thanks [@polynaut](https://github.com/polynaut)! - Fix "Open in Daz" not loading the scene when Daz already has one open. The bridge
  called `openFile(path)` without the `merge` argument, which merges the character
  into the current scene instead of replacing it — so opening a new card looked like
  nothing happened (into an empty Daz there was nothing to merge with, so it seemed
  fine). It now calls `openFile(path, false)`, which clears the scene and opens the
  file fresh.
- Updated dependencies []:
  - @dth/rom@0.41.21
  - @dth/ui@0.41.21

## 0.41.20

### Patch Changes

- [#255](https://github.com/polynaut/dth-character-studio/pull/255) [`e2791bc`](https://github.com/polynaut/dth-character-studio/commit/e2791bc4b0aa171e039339c8619186c5f40289ab) Thanks [@polynaut](https://github.com/polynaut)! - Fix "Open in Daz" sometimes not loading the scene when Daz is already open. The
  scene-open bridge always wrote the same `dth_open_scene.dsa`, and a running Daz can
  ignore a repeated open of an identical path — so a second click looked like nothing
  happened. The bridge filename now rotates across a small fixed pool, so consecutive
  opens never hand Daz the same path twice.
- Updated dependencies []:
  - @dth/rom@0.41.20
  - @dth/ui@0.41.20

## 0.41.19

### Patch Changes

- [#252](https://github.com/polynaut/dth-character-studio/pull/252) [`45ec4d4`](https://github.com/polynaut/dth-character-studio/commit/45ec4d4ee707dcd73aba47ec59468241a6567ad5) Thanks [@polynaut](https://github.com/polynaut)! - Bring the target app to the foreground after "Open in …". Opening a scene in an
  already-running Daz Studio (or a Houdini `.hip` / Unreal `.uproject`) loaded it
  behind the studio window; the studio now focuses the app's window afterwards. It's
  best-effort and Windows-only — a no-op when the app isn't running yet (a fresh
  launch focuses itself) or on other platforms.
- Updated dependencies []:
  - @dth/rom@0.41.19
  - @dth/ui@0.41.19

## 0.41.18

### Patch Changes

- [#248](https://github.com/polynaut/dth-character-studio/pull/248) [`d0dcec9`](https://github.com/polynaut/dth-character-studio/commit/d0dcec95e8dad7a81653819ca27d65c2d1189ba7) Thanks [@polynaut](https://github.com/polynaut)! - Self-host the Manrope font instead of loading it from Google Fonts. The packaged
  app's CSP (`style-src 'self'`) blocked the external `@import`, so installed builds
  silently fell back to a system font — and it added a network dependency to an
  offline-capable desktop tool. Manrope is now bundled via `@fontsource-variable/manrope`,
  so it renders correctly, works offline, and passes the CSP with no policy changes.
- Updated dependencies []:
  - @dth/rom@0.41.18
  - @dth/ui@0.41.18

## 0.41.17

### Patch Changes

- [#245](https://github.com/polynaut/dth-character-studio/pull/245) [`b8a4296`](https://github.com/polynaut/dth-character-studio/commit/b8a4296dcebb3a0f53890ab16a5f282d4b643c1b) Thanks [@polynaut](https://github.com/polynaut)! - Enable the WebView2 inspector (right-click → Inspect, F12) in installed/release
  builds, not just dev — this is a self-hosted tool and it helps debug the shipped
  app against a live Daz Studio.

  Make "Open in Daz" observable when a running Daz doesn't react: the bridge script
  now reports a failed open with a message box (so it's no longer silent — and if
  no box appears at all, the running instance never executed the forwarded script),
  and the web side logs which Daz executable it launched to the console.

- Updated dependencies []:
  - @dth/rom@0.41.17
  - @dth/ui@0.41.17

## 0.41.16

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.41.16
  - @dth/ui@0.41.16

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
- Updated dependencies []:
  - @dth/rom@0.41.15
  - @dth/ui@0.41.15

## 0.41.14

### Patch Changes

- [#238](https://github.com/polynaut/dth-character-studio/pull/238) [`5df102a`](https://github.com/polynaut/dth-character-studio/commit/5df102a20ba8f1cd8a74a3f42829ed105eef2a33) Thanks [@polynaut](https://github.com/polynaut)! - Block saving a character while a custom section has empty required fields (a pose
  with no name, no morph, or an empty morph name), and jump straight to the problem:
  the offending section opens, its pose row scrolls into view and the first empty
  field is focused. A toast names the first error (or the count when there are
  several).
- Updated dependencies [[`5df102a`](https://github.com/polynaut/dth-character-studio/commit/5df102a20ba8f1cd8a74a3f42829ed105eef2a33)]:
  - @dth/rom@0.41.14
  - @dth/ui@0.41.14

## 0.41.13

### Patch Changes

- [#234](https://github.com/polynaut/dth-character-studio/pull/234) [`0e6fc32`](https://github.com/polynaut/dth-character-studio/commit/0e6fc32344c8904a29085414e7416a2dfe1b99a4) Thanks [@polynaut](https://github.com/polynaut)! - Settings: hide the "Network drives" section entirely when no mapped network
  drives are detected (previously it showed an explanatory paragraph). Users who
  don't use network drives no longer see an empty, potentially confusing block.
- Updated dependencies []:
  - @dth/rom@0.41.13
  - @dth/ui@0.41.13

## 0.41.12

### Patch Changes

- [#228](https://github.com/polynaut/dth-character-studio/pull/228) [`66fbb06`](https://github.com/polynaut/dth-character-studio/commit/66fbb062e02b2c5e28650587cec94a554df80069) Thanks [@polynaut](https://github.com/polynaut)! - Settings → DTH release install: the **Daz** install/dry-run report now appears
  directly under the "My DAZ 3D Library" buttons (instead of at the bottom of the
  whole section), while the **Houdini** report stays at the bottom. The single
  shared report was split per target so each result shows next to the buttons that
  produced it.
- Updated dependencies []:
  - @dth/rom@0.41.12
  - @dth/ui@0.41.12

## 0.41.11

### Patch Changes

- [#224](https://github.com/polynaut/dth-character-studio/pull/224) [`562b541`](https://github.com/polynaut/dth-character-studio/commit/562b541981b18a4a20d2b8adbc90cc93a20f531e) Thanks [@polynaut](https://github.com/polynaut)! - - **ROM frame-timeline**: a proportional, labelled strip on the character page
  showing the measured preset ROM blocks (base, GP/DK, Physics) and each custom
  section at their exact frames — driven by the same frame math as generation,
  so it visualises precisely what ships. Makes the frame-alignment invariant
  visible and surfaces config mistakes at a glance.
  - **Internal**: FFI integration tests (mockIPC) covering the invoke bridge's
    request shape + zod return-validation, and `tools.tsx` (1580 lines) broken up
    into `components/tools/*` — no behaviour change.
- Updated dependencies []:
  - @dth/rom@0.41.11
  - @dth/ui@0.41.11

## 0.41.10

### Patch Changes

- [#221](https://github.com/polynaut/dth-character-studio/pull/221) [`a088970`](https://github.com/polynaut/dth-character-studio/commit/a0889706aa78ce540a7005fd128e166aba2836e9) Thanks [@polynaut](https://github.com/polynaut)! - Fixes from a full code/architecture/security review:

  - **Actually wire in the zod FFI validation** — `native-types.ts` schemas were
    defined but imported nowhere (the api layer still used bare `invoke<T>()`
    casts against duplicate interfaces). `install.ts`/`maintenance.ts` now
    `Schema.parse(await invoke(...))` at each boundary, so a renamed Rust serde
    field throws where it happens instead of handing the UI `undefined`.
  - **NumberField data-corruption fix**: it never re-synced its draft, so removing
    a non-last preserve-morph row showed (and could commit) the previous row's
    number. Adds the missing `value`-change effect.
  - **Notes tab** no longer renders the ROM editor + Delete section below the
    notes (wrong tab condition).
  - **Settings** unsaved-changes guard now covers Project-tab edits too (was
    machine-fields only — project edits could be discarded silently).
  - **Security**: anchor the `shell.open` allowlist regex (it was substring-
    matchable via an unanchored middle branch, e.g. `x.pdf.exe`).
  - Editor "experimental" badge passes `gpFrames`; the G9 strength-dial gate reads
    the `GENERATIONS` table; `romFields` typed (dropped an `as unknown as`);
    ImageDialog avatar-save rolls back + toasts on failure; InfoPopup treats
    protocol-relative `//host` links as external.
  - Docs: release sign/publish split + `CHANGESETS_TOKEN` documented; dropped the
    phantom "web-only e2e" claim.

- Updated dependencies []:
  - @dth/rom@0.41.10
  - @dth/ui@0.41.10

## 0.41.9

### Patch Changes

- [#219](https://github.com/polynaut/dth-character-studio/pull/219) [`74f2203`](https://github.com/polynaut/dth-character-studio/commit/74f220345b1c2eeeeb51ee2ad4937b955c657f56) Thanks [@polynaut](https://github.com/polynaut)! - JCM "Modify JCM frames": add a **Mirror** button on each rule that copies it to
  the other side — swapping Left/Right and L/R side tokens in the bone label and
  morph names (shared centre controllers like `!Hip Bend Controller` are left
  untouched; angles/values are copied verbatim). Also set the grid off from the
  base-ROM fields above with a divider + spacing.
- Updated dependencies []:
  - @dth/rom@0.41.9
  - @dth/ui@0.41.9

## 0.41.8

### Patch Changes

- [#217](https://github.com/polynaut/dth-character-studio/pull/217) [`05e9f34`](https://github.com/polynaut/dth-character-studio/commit/05e9f342a05620c5437ebaa93812e21c973e5448) Thanks [@polynaut](https://github.com/polynaut)! - Fix broken linked-asset cards (Daz scene / Houdini project cards rendered too
  narrow with the open icon misplaced). The `@dth/ui` package's Tailwind `@source`
  directive was missing, so utility classes used only in the kit — notably the
  card's `w-80` and `group/card` — were never generated, collapsing the cards to
  content width. Re-added the `@source` scan of `packages/ui/src`.
- Updated dependencies []:
  - @dth/rom@0.41.8
  - @dth/ui@0.41.8

## 0.41.7

### Patch Changes

- [#215](https://github.com/polynaut/dth-character-studio/pull/215) [`8333af9`](https://github.com/polynaut/dth-character-studio/commit/8333af9416d2e461eec2152c5f15dbd200dce350) Thanks [@polynaut](https://github.com/polynaut)! - Follow-up cleanup (no user-facing change): route native app-menu actions through
  a new `desktop.onMenu()` helper so the last raw `@tauri-apps/api/event` import
  leaves the routes (`__root.tsx`, `index.tsx`) — the native boundary is now fully
  concentrated in `lib/desktop.ts`. Also consolidate the reinvented path-normalize
  lambdas into `normalizePath` / `normalizePathLower` in `lib/path.ts`.
- Updated dependencies []:
  - @dth/rom@0.41.7
  - @dth/ui@0.41.7

## 0.41.6

### Patch Changes

- [#213](https://github.com/polynaut/dth-character-studio/pull/213) [`42310c2`](https://github.com/polynaut/dth-character-studio/commit/42310c2bedd7827159c26b9f3a7d3ac2fbabb1c3) Thanks [@polynaut](https://github.com/polynaut)! - Internal architecture hardening (no user-facing behaviour change):

  - Adopt **oxlint** (type-aware) as the lint gate — fixes a handful of real
    latent bugs it surfaced (fire-and-forget promises, object-to-string coercions).
  - CI: the "version packages" PR is now authored with a dedicated token so its
    checks run on their own; PRs must carry a changeset; the release is split into
    a self-hosted **sign** step and a hosted **publish** step.
  - Extract a new **`@dth/ui`** package — an app-agnostic React kit (primitives,
    hooks, and composable components with no Tauri/router/filesystem coupling) so
    the UI is reusable by a future online build and the app stops carrying
    thousand-line god-files.
  - Core (`@dth/rom`) and the Rust backend get cohesion + safety cleanups
    (single frame-offset source, typed FFI returns, env-derived paths).

- Updated dependencies []:
  - @dth/rom@0.41.6
  - @dth/ui@0.41.6

## 0.41.5

### Patch Changes

- [#211](https://github.com/polynaut/dth-character-studio/pull/211) [`7b3b101`](https://github.com/polynaut/dth-character-studio/commit/7b3b101d0d490fb3cc941509b0d3f881c94ea374) Thanks [@polynaut](https://github.com/polynaut)! - Pressing Alt while hovering a reveal target (path chip, Daz/Houdini/Unreal
  card) no longer arms the native menu bar — the key is treated as the
  show-in-Explorer modifier there. Alt anywhere else keeps its normal menu
  behavior.
- Updated dependencies [[`7b3b101`](https://github.com/polynaut/dth-character-studio/commit/7b3b101d0d490fb3cc941509b0d3f881c94ea374)]:
  - @dth/rom@0.41.5

## 0.41.4

### Patch Changes

- [#209](https://github.com/polynaut/dth-character-studio/pull/209) [`4df5164`](https://github.com/polynaut/dth-character-studio/commit/4df5164c8d82d8f9b960272df4d182d4b55e7ec0) Thanks [@polynaut](https://github.com/polynaut)! - The character page's Back links are truly gray now (the global link color was
  overriding them), and holding Alt over a Daz scene / Houdini / Unreal card
  swaps its open icon for a folder icon — previewing the show-in-Explorer click,
  same as the path chips. The Daz scenes / Houdini chips dim everything through
  the character folder, so only the actual subfolder reads bright.

  The reveal hotkey moved from Shift+click to **Alt+click** everywhere (chips and
  cards) — Shift+click was selecting text along the way.

- Updated dependencies [[`4df5164`](https://github.com/polynaut/dth-character-studio/commit/4df5164c8d82d8f9b960272df4d182d4b55e7ec0)]:
  - @dth/rom@0.41.4

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
- Updated dependencies [[`2d3e0c0`](https://github.com/polynaut/dth-character-studio/commit/2d3e0c060a740a2e306e37331def93553081f02b), [`2d3e0c0`](https://github.com/polynaut/dth-character-studio/commit/2d3e0c060a740a2e306e37331def93553081f02b), [`2d3e0c0`](https://github.com/polynaut/dth-character-studio/commit/2d3e0c060a740a2e306e37331def93553081f02b)]:
  - @dth/rom@0.41.3

## 0.41.2

### Patch Changes

- [#205](https://github.com/polynaut/dth-character-studio/pull/205) [`cb72bf3`](https://github.com/polynaut/dth-character-studio/commit/cb72bf3ec92d0f0d46e0590d14ae85e6529201c8) Thanks [@polynaut](https://github.com/polynaut)! - The Unreal card's install button keeps it short — tooltip is just "Install DTH
  Content" — and holding Ctrl lights the dimmed button back up on already-
  bootstrapped projects, hinting that a click now re-installs. Path chips
  preview their alternate action too: holding Shift swaps the hover copy icon
  for an open-folder icon.
- Updated dependencies [[`cb72bf3`](https://github.com/polynaut/dth-character-studio/commit/cb72bf3ec92d0f0d46e0590d14ae85e6529201c8)]:
  - @dth/rom@0.41.2

## 0.41.1

### Patch Changes

- [#203](https://github.com/polynaut/dth-character-studio/pull/203) [`69d0105`](https://github.com/polynaut/dth-character-studio/commit/69d01052a02439ba34ebed68e99c4eb418ddd838) Thanks [@polynaut](https://github.com/polynaut)! - Shift+click "show in Explorer" now also works on the Daz scene cards and the
  Houdini project cards — the one hotkey everywhere: plain click opens the file
  in its app, Shift+click reveals its folder.
- Updated dependencies [[`69d0105`](https://github.com/polynaut/dth-character-studio/commit/69d01052a02439ba34ebed68e99c4eb418ddd838)]:
  - @dth/rom@0.41.1

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
- Updated dependencies [[`00912f4`](https://github.com/polynaut/dth-character-studio/commit/00912f4e02bda8aa62a2e0ab2d67f3961362970f), [`00912f4`](https://github.com/polynaut/dth-character-studio/commit/00912f4e02bda8aa62a2e0ab2d67f3961362970f), [`635ce6f`](https://github.com/polynaut/dth-character-studio/commit/635ce6f3fff7f57b86f9a3873bb8fee7192ba1aa)]:
  - @dth/rom@0.41.0

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

### Patch Changes

- Updated dependencies [[`9fa6c2e`](https://github.com/polynaut/dth-character-studio/commit/9fa6c2e036d401dcfe272e0c877f308252ed6776)]:
  - @dth/rom@0.40.0

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

### Patch Changes

- Updated dependencies [[`8702758`](https://github.com/polynaut/dth-character-studio/commit/870275802ebc6f36bf4cdf8b5f45f1cb4fbcc4ae)]:
  - @dth/rom@0.39.0

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

### Patch Changes

- Updated dependencies [[`98228d1`](https://github.com/polynaut/dth-character-studio/commit/98228d1c66f4498bdb66a782d0e416600f751260), [`dbdc712`](https://github.com/polynaut/dth-character-studio/commit/dbdc7121ece1a21127abd3457d96769c502e8f0a)]:
  - @dth/rom@0.38.0

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
- Updated dependencies [[`2efabc0`](https://github.com/polynaut/dth-character-studio/commit/2efabc06c603eff60fe697c319fa35b072966285), [`910f80f`](https://github.com/polynaut/dth-character-studio/commit/910f80f20d8a6e1d7c6614883f5b306e8254cd96)]:
  - @dth/rom@0.37.0

## 0.36.3

### Patch Changes

- [#187](https://github.com/polynaut/dth-character-studio/pull/187) [`c3261bf`](https://github.com/polynaut/dth-character-studio/commit/c3261bfd824987ed2936b72c75d38a563a8bbc55) Thanks [@polynaut](https://github.com/polynaut)! - Hardening: zip extraction is bounded (ratio-based size + entry caps) against decompression bombs; recursive-delete rails run on canonicalized paths; a hostile manifest charactersSubdir can no longer traverse outside the project; character schema strings carry generous size bounds; the app has a styled root error boundary.

- [#182](https://github.com/polynaut/dth-character-studio/pull/182) [`2cd7be6`](https://github.com/polynaut/dth-character-studio/commit/2cd7be6b451a63f9ade98e047a860833627e8435) Thanks [@polynaut](https://github.com/polynaut)! - Fix batch: character notes now follow renames and moves (`<Name>.notes.md` is renamed with the definition in save/move/library-root moves, and removed with a loose definition on delete — previously a rename silently orphaned the notes); the unsaved-changes guard now intercepts the native window close (Tauri's ✕ never delivered `beforeunload`); the selection pill floats above the Unreal footer bar instead of overlapping it; styled tooltips track live `title` changes so PathCode's "Copied!" feedback actually shows; non-G9 characters carry an "experimental" chip until the G8/G8.1 CSV path is validated in Houdini.

- [#188](https://github.com/polynaut/dth-character-studio/pull/188) [`198ea5a`](https://github.com/polynaut/dth-character-studio/commit/198ea5a43a4bb5a626f2999954435d501f83d2b8) Thanks [@polynaut](https://github.com/polynaut)! - Notes integrity: autosave failures surface as a toast, and concurrent edits from a second window are detected instead of silently overwritten (reload option offered). Note media is garbage-collected — unreferenced files are removed after an hour on save, with a 7-day housekeeping backstop — and `.duf` preset decompression is bounded.

- [#189](https://github.com/polynaut/dth-character-studio/pull/189) [`aace849`](https://github.com/polynaut/dth-character-studio/commit/aace849c42851c6c2e6dbadc225691fd494d9789) Thanks [@polynaut](https://github.com/polynaut)! - Performance: morph index / character lookup / product scans are cached with cheap staleness checks (no more full re-reads per navigation or window focus); the cross-project prefill list loads lazily instead of stalling the project page on cold network shares; morph autocomplete is indexed and deferred; large product reports skip offscreen rendering; the update dialog's markdown renderer no longer ships in the startup chunk; removed the unused TanStack Query dependency.

- [#184](https://github.com/polynaut/dth-character-studio/pull/184) [`d821d34`](https://github.com/polynaut/dth-character-studio/commit/d821d3431fa5115081960ff0b9090fea822c7089) Thanks [@polynaut](https://github.com/polynaut)! - Internal: split the ROM sections editor into focused components (no behavior change).

- [#186](https://github.com/polynaut/dth-character-studio/pull/186) [`f26a231`](https://github.com/polynaut/dth-character-studio/commit/f26a231e084da6af82815366742c2e95c1b82ee0) Thanks [@polynaut](https://github.com/polynaut)! - Internal: split the storage substrate into focused modules behind the existing barrel (no behavior change) and add baseline tests for settings + library scanning.

- Updated dependencies [[`c3261bf`](https://github.com/polynaut/dth-character-studio/commit/c3261bfd824987ed2936b72c75d38a563a8bbc55)]:
  - @dth/rom@0.36.3

## 0.36.2

### Patch Changes

- [#179](https://github.com/polynaut/dth-character-studio/pull/179) [`a868c65`](https://github.com/polynaut/dth-character-studio/commit/a868c650705ade11ff970c307debb5adced1f0d9) Thanks [@polynaut](https://github.com/polynaut)! - The slide-in drawers (New project, Create character, …) animate reliably again
  — they used to pop in without the transition when the open raced the first
  paint.

- [#180](https://github.com/polynaut/dth-character-studio/pull/180) [`01d5a0f`](https://github.com/polynaut/dth-character-studio/commit/01d5a0f9de90b2ebaa63b8614bf213312e6be4b3) Thanks [@polynaut](https://github.com/polynaut)! - Linked Unreal projects moved into a footer bar docked to the bottom of the
  project window — always visible, compact chips that open the project in Unreal
  on click (folder in the tooltip, hover ✕ unlinks), with the picker and
  drag-drop linking right on the bar.
- Updated dependencies [[`a868c65`](https://github.com/polynaut/dth-character-studio/commit/a868c650705ade11ff970c307debb5adced1f0d9), [`01d5a0f`](https://github.com/polynaut/dth-character-studio/commit/01d5a0f9de90b2ebaa63b8614bf213312e6be4b3)]:
  - @dth/rom@0.36.2

## 0.36.1

### Patch Changes

- [#177](https://github.com/polynaut/dth-character-studio/pull/177) [`172029c`](https://github.com/polynaut/dth-character-studio/commit/172029c552f2fe0e6e6ee0f7da70dda9a838714d) Thanks [@polynaut](https://github.com/polynaut)! - Opening linked Unreal projects works now — the desktop shell-open scope only
  allowed `.duf`/`.hip` files (and https links), so clicking an Unreal card,
  Ctrl+clicking a path chip (folder reveal) or opening non-image note media was
  silently refused. The scope now covers `.uproject`, folders, and the common
  image/video/audio/document/3D media formats (executables stay refused), and
  those open actions surface errors as a toast instead of doing nothing.
- Updated dependencies [[`172029c`](https://github.com/polynaut/dth-character-studio/commit/172029c552f2fe0e6e6ee0f7da70dda9a838714d)]:
  - @dth/rom@0.36.1

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
- Updated dependencies [[`a2accc6`](https://github.com/polynaut/dth-character-studio/commit/a2accc6ae3bd75041a894904789be7e4f54e7477), [`90c52f7`](https://github.com/polynaut/dth-character-studio/commit/90c52f7003c51dd52a83f3c17bea56fd70042239), [`a2accc6`](https://github.com/polynaut/dth-character-studio/commit/a2accc6ae3bd75041a894904789be7e4f54e7477), [`8f96436`](https://github.com/polynaut/dth-character-studio/commit/8f96436a67608dc1115a7add87cfe239d5c21bb3), [`0f7db81`](https://github.com/polynaut/dth-character-studio/commit/0f7db818b6675ca6afd515eb7d54254adec7ceec)]:
  - @dth/rom@0.36.0

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
- Updated dependencies [[`14f3ed3`](https://github.com/polynaut/dth-character-studio/commit/14f3ed3c9899cfd732530f7293557a6e05a9df58), [`bb695ef`](https://github.com/polynaut/dth-character-studio/commit/bb695efae90d970981a36fd191045a94f3c8a9c8), [`1e1ae08`](https://github.com/polynaut/dth-character-studio/commit/1e1ae082e238f41dbfc2c508809c3340adec18bd)]:
  - @dth/rom@0.35.0

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

- [#160](https://github.com/polynaut/dth-character-studio/pull/160) [`bdedd9d`](https://github.com/polynaut/dth-character-studio/commit/bdedd9df93ae57a737be4131c9e7ef960ae0c0ec) Thanks [@polynaut](https://github.com/polynaut)! - **Refresh assets now always covers every known project.** Running it from a
  project window used to scope the sweep to that project only — the same button
  meant different things in different windows. It now behaves identically
  everywhere: every known (recent) project is detected and refreshed, plus the
  current window's project even if it isn't in recents yet.

- [#161](https://github.com/polynaut/dth-character-studio/pull/161) [`db82ae3`](https://github.com/polynaut/dth-character-studio/commit/db82ae383cd475d7ed39c193c0c460f14d318afe) Thanks [@polynaut](https://github.com/polynaut)! - **Removed the "Example" ROM prefill.** New characters start Empty or prefill
  from one of your own characters (any project) — the bundled example character
  is gone from the create panel, the API and the guide.

- [#164](https://github.com/polynaut/dth-character-studio/pull/164) [`8ef6ec5`](https://github.com/polynaut/dth-character-studio/commit/8ef6ec58ef04bcf87bd6fab67a5fea0356bc409b) Thanks [@polynaut](https://github.com/polynaut)! - **ROM grid: explained columns + Houdini-safe names.**

  - The **Name** and **Morph name** column headers got info popups: _Name_ is the
    one value that travels to Houdini and later Unreal Engine; _Morph name_ must
    exactly match the morph's internal name in Daz Studio.
  - Names are now normalized as you type: letters, numbers and underscores only —
    Houdini rejects anything else, so spaces/special characters are stripped on
    commit (the same rule the CSV generator already applied).
  - The **Value** column title now sits flush over its numbers instead of
    floating at the column's left edge.
  - The column titles are **sticky** too: they pin right under the sticky section
    title while the grid scrolls - frame numbers, names and values always have
    their labels in view.

- Updated dependencies [[`f6259cd`](https://github.com/polynaut/dth-character-studio/commit/f6259cdd2261697ec4bf4e2dd82649beadc9371b), [`fd9fdd9`](https://github.com/polynaut/dth-character-studio/commit/fd9fdd927501acca778b606bb259d41655accb71)]:
  - @dth/rom@0.34.0

## 0.33.0

### Patch Changes

- [#158](https://github.com/polynaut/dth-character-studio/pull/158) [`70b1f54`](https://github.com/polynaut/dth-character-studio/commit/70b1f54fa7c6638274adf34b084e1975b3814212) Thanks [@polynaut](https://github.com/polynaut)! - **The update dialog now shows what you skipped.** When the installed version is
  several releases behind, the dialog still renders the latest release's notes in
  full — and below them lists the in-between releases (newest first, up to 3) as
  links to their GitHub release pages, so the catch-up path is one click away.
- Updated dependencies [[`ce86c32`](https://github.com/polynaut/dth-character-studio/commit/ce86c32397d2138ece891b98551cad000c35fd3c)]:
  - @dth/rom@0.33.0

## 0.32.3

### Patch Changes

- [#155](https://github.com/polynaut/dth-character-studio/pull/155) [`ca93cfd`](https://github.com/polynaut/dth-character-studio/commit/ca93cfda17e084a5a48ea7409794a76de6e087f1) Thanks [@polynaut](https://github.com/polynaut)! - **ROM editor: insert frames in place + sticky section titles.**

  - Every pose row has a small `+` behind its frame number opening **Add before /
    Add after** right at the icon — a new frame slots in between existing ones
    (inheriting the neighbor's node), the new row's name field is focused
    immediately, and frame numbers simply renumber (computed from order, never
    stored).
  - The ROM section titles (RET, JCM, FAC, …) are now sticky iOS-contacts style:
    the current section's title stays pinned below the page header while its rows
    scroll, and the next section's title pushes it out as it arrives — pure CSS,
    no scroll listeners.

- [#154](https://github.com/polynaut/dth-character-studio/pull/154) [`86a7930`](https://github.com/polynaut/dth-character-studio/commit/86a7930dab6d0d37bf654018bcf1ddbfa271056b) Thanks [@polynaut](https://github.com/polynaut)! - **Settings and Tools got the character editor's sticky header.** The page title
  and back navigation stay visible while the form scrolls, and **Discard / Save**
  now ride the header (top right) — always one click away instead of buried at the
  bottom of a tab. On Settings the header buttons cover both scopes at once: the
  machine settings (General) and, in a project window, the project settings
  (Project tab) — Save persists everything pending, Discard reverts it.
- Updated dependencies []:
  - @dth/rom@0.32.3

## 0.32.2

### Patch Changes

- [#149](https://github.com/polynaut/dth-character-studio/pull/149) [`779339e`](https://github.com/polynaut/dth-character-studio/commit/779339e23d19ee526f500eac1b3ecb59b6225888) Thanks [@polynaut](https://github.com/polynaut)! - **The update dialog now renders its release notes as real markdown** — headings,
  bullets, bold, inline code and links instead of raw `##`/`**` syntax — and the
  dialog is larger with a much taller notes area, so more of the changelog is
  readable at once. Links in the notes open in your browser (never inside the app).
- Updated dependencies []:
  - @dth/rom@0.32.2

## 0.32.1

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.32.1

## 0.32.0

### Patch Changes

- [#142](https://github.com/polynaut/dth-character-studio/pull/142) [`62c4adf`](https://github.com/polynaut/dth-character-studio/commit/62c4adfd171a8287f13172c87548ea7122e01573) Thanks [@polynaut](https://github.com/polynaut)! - **Fix: a JCM base ROM without FAC no longer aborts the run.** The Daz runtime's
  base-ROM loader only reported success when the FAC/mouth ROM also loaded — so a
  character with JCM enabled but FAC disabled (e.g. a custom JCM base asset) loaded
  its base ROM, then silently aborted the rest of the workflow (custom frames never
  applied) and marked the run failed. The base ROM alone now counts as success; FAC
  stays optional. (Pre-existing bug surfaced by the runtime-v16 validation.)
- Updated dependencies [[`bdacdba`](https://github.com/polynaut/dth-character-studio/commit/bdacdba1f4df07e0553ba29ed0ee74eae289a9fc)]:
  - @dth/rom@0.32.0

## 0.31.3

### Patch Changes

- [#135](https://github.com/polynaut/dth-character-studio/pull/135) [`cfa5c6f`](https://github.com/polynaut/dth-character-studio/commit/cfa5c6f9ea55b858f88a212a36ecff45a51754a5) Thanks [@polynaut](https://github.com/polynaut)! - **The "update available" prompt is now an in-app dialog** instead of the native OS
  dialog. When a new version is found, the confirm is rendered in React in the app's
  own style (matching the other dialogs) — with the version, release notes, and
  **Later** / **Update now**. The dialog also shows a "Downloading and installing…"
  state while it works and surfaces any install error inline, then restarts the app.
- Updated dependencies []:
  - @dth/rom@0.31.3

## 0.31.2

### Patch Changes

- [#134](https://github.com/polynaut/dth-character-studio/pull/134) [`05a6233`](https://github.com/polynaut/dth-character-studio/commit/05a62336c617cab8b29e035fa0040f600e1d9dfc) Thanks [@polynaut](https://github.com/polynaut)! - **Rename the per-project "Assets" feature to "Attachments".**

  The optional per-project feature for attaching reusable Daz `.duf` scenes (bases,
  props, looks) now reads as **Attachments** everywhere in the UI — the `Enable
attachments` toggle, the `Characters / Attachments` tab, the `Character / Attachment`
  add choice, and the attachment cards/messages. This removes the confusing overlap
  with the Tools page's **Daz assets** install section (which installs downloaded Daz
  products), so the docs no longer need a "two different things called Daz assets"
  disclaimer. Internal storage is unchanged (`.assets/` folder + `assetsEnabled`
  manifest key), so existing projects keep working with no migration.

- Updated dependencies []:
  - @dth/rom@0.31.2

## 0.31.1

### Patch Changes

- [#130](https://github.com/polynaut/dth-character-studio/pull/130) [`b0058d1`](https://github.com/polynaut/dth-character-studio/commit/b0058d109b71c64d111376dc7546396b20703e78) Thanks [@polynaut](https://github.com/polynaut)! - **Tidy the Home empty-state copy and add deep-dive docs for the optional features.**

  - The "No recent projects" line no longer repeats the "drop one anywhere on the
    page" hint (still shown in the create-project instructions just below).
  - New guide pages document the optional, never-required features: the Tools page,
    the per-project Daz assets feature, and Daz product scanning.

- Updated dependencies []:
  - @dth/rom@0.31.1

## 0.31.0

### Minor Changes

- [#122](https://github.com/polynaut/dth-character-studio/pull/122) [`3e4bd09`](https://github.com/polynaut/dth-character-studio/commit/3e4bd09012b3a47a69d9440428888fa407a8bae7) Thanks [@polynaut](https://github.com/polynaut)! - **Fix a frame-alignment off-by-one + harden generated scripts against injection** (from a full app audit).

  - **Base-less characters no longer desync from Daz.** A character with no preset ROM block (FBM-only, or custom JCM groups) started its first custom frame at 1 in the PoseAsset CSV / exporter reference frames, while Daz built it at 0 — a one-frame misalignment for the whole custom sequence (the exact class of bug the "frames are computed, never stored" invariant exists to prevent). Removed the `Math.max(…, 0)` clamp in all three consumers. Runtime bumped to **v15** so **Tools → Refresh assets** regenerates affected characters' scripts/CSVs.
  - **Daz Script injection closed.** A character `name` containing a newline could break out of the generated `.dsa`'s `//` comment header into executable DzScript — reachable by opening/generating a shared malicious definition. Control chars (CR/LF/U+2028/U+2029) are now stripped from names in comment headers.
  - **CSV injection closed.** Group labels and reference-FBX paths are stripped of commas/newlines so they can't inject extra columns/rows into the Houdini PoseAsset CSV.

### Patch Changes

- [#125](https://github.com/polynaut/dth-character-studio/pull/125) [`cc6f9ad`](https://github.com/polynaut/dth-character-studio/commit/cc6f9ad94b087637afc20fc1199e0c6708045c04) Thanks [@polynaut](https://github.com/polynaut)! - **Persistence + safety fixes** (from a full app audit):

  - **The one-time project-file migration no longer clobbers your settings.** When a project was unreachable (offline drive) during the migration, every relaunch re-wrote _all_ the already-migrated projects' `.dcsp` manifests back to defaults — silently losing per-project settings (and, if `charactersSubdir` had been changed, hiding that project's characters). It now skips any project that already has a manifest.
  - **Changing the characters subfolder now asks first** and moves atomically: it confirms before the (destructive) folder move, and pre-checks every destination for collisions before moving anything — so a collision partway through can't strand some characters at the new root while the manifest still points at the old one.
  - **A manifest with no id gets a stable id** (persisted once) instead of minting a fresh one on every read.
  - **"Open scene" only opens local scene/project files** (`.duf`/`.hip`), refusing arbitrary URLs — a shared character definition can't turn it into a phishing launcher.
  - **External links go through one guarded helper**, so "open on GitHub"-style links also work in the plain-browser build (they previously threw outside the desktop app).

- Updated dependencies [[`3e4bd09`](https://github.com/polynaut/dth-character-studio/commit/3e4bd09012b3a47a69d9440428888fa407a8bae7)]:
  - @dth/rom@0.31.0

## 0.30.0

### Minor Changes

- [#120](https://github.com/polynaut/dth-character-studio/pull/120) [`ce51879`](https://github.com/polynaut/dth-character-studio/commit/ce51879339675f325938d2011c9e422a26eb168b) Thanks [@polynaut](https://github.com/polynaut)! - **Housekeeping: the studio's own generated data can no longer fill your disk.** The two things that used to accumulate unbounded are now managed:

  - **Product-scan files** (the per-Daz-scene CSVs + diagnostics under app-data) **age out after 30 days** — swept automatically on every app launch, and on demand via a new **Tools → Storage & housekeeping → "Clean up now"** button (reports how much it freed). Deleting a character now also removes its scan folder and avatar immediately, so nothing orphans.
  - **The dedup quarantine** (redundant Daz assets you moved aside — a large, reversible backup) is shown with its size in the same section, with an **"Empty quarantine"** button (with a confirm). It's never emptied automatically — you decide when the backup is safe to reclaim.

  Everything else the app writes was already bounded (run logs overwrite, generated artifacts self-prune, temp files self-delete, recents capped). New native commands: `housekeeping_sweep`, `folder_stats`, `empty_folder`.

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.30.0

## 0.29.2

### Patch Changes

- [#115](https://github.com/polynaut/dth-character-studio/pull/115) [`a91d48c`](https://github.com/polynaut/dth-character-studio/commit/a91d48c23720b7271dced957d7ce619a862cad56) Thanks [@polynaut](https://github.com/polynaut)! - **Run-report UX polish.** When the last ROM run had problems, a top-centered "Errors in the last ROM run" mini-alert fades into the sticky character header as you scroll (hidden at the top, where the full report banner is already visible); clicking it scrolls the page back up to the report. In the report, each failed morph is now **clickable** — it opens the ROM section that holds that frame and scrolls the (red-marked) row into view, so you can go straight from the error to the field to fix.

- Updated dependencies []:
  - @dth/rom@0.29.2

## 0.29.1

### Patch Changes

- [#113](https://github.com/polynaut/dth-character-studio/pull/113) [`d7f5d16`](https://github.com/polynaut/dth-character-studio/commit/d7f5d1651bbdf33f8cc50ff18d2d618fe16f1315) Thanks [@polynaut](https://github.com/polynaut)! - **Hotfix: every v0.29.0 ROM script failed with `URIError: !{{ Legacy Include }}`.** Daz resolves `include()` through its legacy-include mechanism, which fails inside a `try/catch` — and v0.29.0's catch-all wrapper had moved the runtime include into one. The include is back at the top level (with a regression-guard test), a `typeof` check covers a missing runtime instead, and the export block is now skipped when the ROM build aborts. **Save each character (or run Tools → Refresh assets once) to regenerate the broken scripts** (script runtime v14).

  Run-report UX, reworked: the Daz dialog is short and generic ("Something went wrong while building the ROM — switch back to DTH Character Studio to see what failed") — the details live in the studio. The studio now **ingests** the Daz-written log into its own `.last_rom_run.json` store and deletes the Daz file (throwaway transport). The report shows above the tabs, **failed morphs mark their rows red in the ROM editor**, and when the report is scrolled off-screen a floating "Errors in the last ROM run — click to see details" hint jumps to it.

- Updated dependencies [[`d7f5d16`](https://github.com/polynaut/dth-character-studio/commit/d7f5d1651bbdf33f8cc50ff18d2d618fe16f1315)]:
  - @dth/rom@0.29.1

## 0.29.0

### Minor Changes

- [#111](https://github.com/polynaut/dth-character-studio/pull/111) [`35ffc96`](https://github.com/polynaut/dth-character-studio/commit/35ffc96a0e31f5e7e62ec7eab51617355dfc3302) Thanks [@polynaut](https://github.com/polynaut)! - **ROM runs now report their problems back to the studio.** The generated Daz script writes a run log (`dth_rom_run_log.json` in the character folder) after every run — listing each morph that couldn't be applied (frame, node, reason) and any other error, including unexpected script failures (a catch-all reports even a missing runtime or a crash mid-run). When something failed, the script ends with a dialog pointing back to the studio, and the character page shows the full list the moment you switch back to it (re-checked on window focus), with a Dismiss button. A clean run clears the previous report automatically.

  **A missing morph can no longer break the ROM's frame alignment.** Frame slots come from the character's declaration, not from what actually applied: a morph that isn't found in the scene is logged and skipped while its frames stay in the ROM (empty), invalid frame numbers are logged instead of silently shortening the timeline, and the legacy per-frame loop no longer drops the rest of a frame's morphs on the first miss — one bad morph costs exactly that morph, nothing else.

  **The character script is now always named `ROM_<Name>_<Genesis>.dsa`** — previously the `ROM_` prefix appeared only in split-export mode. The stale un-prefixed script is cleaned up on the next Save; **Tools → Refresh assets** regenerates all characters (script runtime v13).

### Patch Changes

- Updated dependencies [[`35ffc96`](https://github.com/polynaut/dth-character-studio/commit/35ffc96a0e31f5e7e62ec7eab51617355dfc3302)]:
  - @dth/rom@0.29.0

## 0.28.0

### Minor Changes

- [#106](https://github.com/polynaut/dth-character-studio/pull/106) [`18e6787`](https://github.com/polynaut/dth-character-studio/commit/18e6787b82c74d7291c7164692487490ede09613) Thanks [@polynaut](https://github.com/polynaut)! - **Setup DTH Release** split into two independent installs, each with its own Dry run / Install buttons placed directly under its destination folder field: **Daz content** under "My DAZ 3D Library", **Houdini assets** under "Houdini documents folder". Each half is enabled by its own prerequisites (a resolved DTH release + its destination folder), so you can install only the Daz side or only the Houdini side. The Daz install still re-scans the release's poses on success; the native `install_dth_release` command gained a `target` selector (`daz` / `houdini` / `all`).

### Patch Changes

- [#104](https://github.com/polynaut/dth-character-studio/pull/104) [`d6db042`](https://github.com/polynaut/dth-character-studio/commit/d6db042511c6da702c8a2f02a81fc663f7df537b) Thanks [@polynaut](https://github.com/polynaut)! - Settings: the **DAZ Install Manager manifests folder** field (+ its "Detect installed location" button) moved from the General tab to the **Project tab, directly under the "Enable Daz Products" toggle** it belongs with. It remains a machine-wide setting (stored with the app, shared by all projects — the info popup now says so); the Project tab's Save persists it alongside the project settings. The character page's "set it in Settings" hint points at the new location.

- Updated dependencies []:
  - @dth/rom@0.28.0

## 0.27.0

### Minor Changes

- [#101](https://github.com/polynaut/dth-character-studio/pull/101) [`38aafd3`](https://github.com/polynaut/dth-character-studio/commit/38aafd3a0e5bfd3a0669b60800e4e6e27f4ec7fc) Thanks [@polynaut](https://github.com/polynaut)! - **Install Daz assets** report: each source folder is now a collapsible section. The folder header row (with an asset count) toggles its group of asset rows, so long multi-folder scan reports can be skimmed folder by folder. Folders that need attention (files to copy, or a scan error) start expanded; all-skipped folders ("already installed") start collapsed. The per-asset "files to copy" expansion works as before, and reports without folder headers (DTH release/plugin installs, morphs, Houdini presets) render unchanged.

- [#101](https://github.com/polynaut/dth-character-studio/pull/101) [`38aafd3`](https://github.com/polynaut/dth-character-studio/commit/38aafd3a0e5bfd3a0669b60800e4e6e27f4ec7fc) Thanks [@polynaut](https://github.com/polynaut)! - Add **Daz Products** — an opt-in, per-project scan of which Daz products a character uses. Turn it on in **Settings → Project → Enable Daz Products** (off by default). Each character then gets a generated **`Scan_Products_<Character>.dsa`** alongside its ROM script. Open the character's scene in Daz, run the script, and it analyses the open scene — walking used nodes + non-zero morphs and each node's material texture paths — then matches them to your installed products and writes a CSV the studio reads back.

  Set the **DAZ Install Manager manifests folder** in **Settings → General** (with a one-click **Detect installed location**) so the scan can resolve assets to real product **names, SKUs, artists and versions**; without it the scan still lists the used assets. Back on the character page, enabling the feature splits the editor into **Character** and **Products** tabs (the tabs appear only when Daz Products is on, so the scan never crowds the character form). The **Products** tab surfaces the results — a table of matched products plus an expandable list of unmatched assets (with their source files) — and a **Store on character** action persists them onto the character definition. A **Clear** button (active only while there are scan results to discard) wipes the per-scene CSVs to start fresh, leaving any products already stored on the character untouched. The tab is split into two panels: a **Scan files** panel that always shows which per-scene CSVs back the results — their output folder, and a row per scene with its source `.duf` path, product/unmatched counts and when it was last written — so it's clear what Check / Clear / Store act on and which Daz scene each scan came from; and a separate **Matched products** panel with the listing itself. Once you've stored products, a status banner makes the relationship to the files on disk explicit either way: a green **Up to date** when nothing on disk is newer than your last save, or an amber **scan changed since you last stored** (with the counts — e.g. "11 found now vs 9 stored" — and the save time) when a re-scan has produced new results. The store button follows suit, settling into a disabled **Stored — up to date** instead of an always-active "Update stored products". Each product row **expands** to list the exact scene morph(s)/node(s) that found it (each tagged Morph/Node), so you can see precisely why it's there. Store products (those with a DIM SKU) link out to their **Daz product page**, and scene render-setting singletons (the Tonemapper/Environment "Options" nodes) are excluded so they don't clutter the unmatched list. The **Match** column header carries an info popup explaining each match method (File/Texture, SKU, Keyword, Third-Party, Genesis Base, Parent/Group, Manifest).

  Scans are tracked **per Daz scene**, so a character's outfit/look variants don't overwrite each other. The runtime reads the open scene (`Scene.getFilename()`) and writes one CSV per scene; the studio reads them all and merges, so each product and unmatched asset is tagged with the scene(s) it was found in — a **Scene(s)** column appears once more than one scene has been scanned. When more than one scene has been scanned, a **View** switch ("All scenes" plus one chip per scene) lets you flip between the merged table and a single scene's products; scoping to one scene drops the now-redundant Scene(s) column. Products and unmatched assets are listed **alphabetically**. Open an outfit scene, run the scan, repeat for the next outfit, and the results accumulate with their scene attribution.

  Each matched product shows **what it was used for** in the scene — a heuristic role (Morph, Clothing, Hair, Genitalia, Geograft, Accessory, Figure, …) derived from the assets that matched it, with the specific assets on hover — so you can tell _why_ a product is in the scene. Matching links a used item to its product even when their names share nothing (e.g. a glove node "ACGloves" from "Adventure Outfit"): it reads the node's **material texture paths** — the one file reference Daz exposes for a scene node — across _every_ map channel (diffuse, normal, bump, roughness, metallic, …, not just the base color, so a metal zipper or a procedurally-tinted flower with no diffuse map still matches) and maps their `vendor/product` folder to the product that installed it. A geograft wearing a _copy_ of the figure's body skin (common — the copy-textures workflow) is recognised: the figure's own skin folders are excluded so the geograft isn't mis-identified as the skin product. A texture-folder match is treated as proof the product is genuinely used, so it intentionally bypasses the Genesis prefilter — that's how a G8 outfit auto-fitted onto a G9 figure still matches. An unmatched clothing **sub-part** — a zipper, a flower trim, a dForce layer that loads as its own node parented to the garment — inherits the product its parent matched (a "Parent Match"), provided that parent isn't the base figure, so these stop landing in "unmatched". Sub-parts the scene parents to the _figure_ rather than the garment (so parent-inheritance can't reach them) are caught by a final **"Manifest Match"**: an unmatched node whose name is the basename of a file a product installs (a "Frangipani"/"Zipper" node ↔ `Frangipani.dsf`/`Zipper.dsf`) is attributed to that product — but only to a product _already matched elsewhere in the same scene_, so a generic part name can't pull in an unrelated library product. And a decoration that loads as an empty **group/null node** (no geometry, texture or own file) whose real parts are matched children inherits its children's product (a "Group Match"). Beyond that it is **prefiltered by the character's known Genesis version** (from the studio, not guessed): products for a different generation are rejected and, when several editions of a product are installed (e.g. a G8 _and_ a G9 Golden Palace), the one matching the character's generation wins. It also needs stronger keyword confidence (two distinct shared keywords — a lone generic word like "top" or "inside" can't anchor a match) and pulls in manually-installed (non-DIM) products from `LOCAL_USER_*` metadata so they match instead of landing in "unmatched". As a final resort it **synthesizes products from the content library's `data/<Vendor>/<Product>` folders** ("Content Folder Match"), so content that carries _no_ DIM or `LOCAL_USER` metadata at all — e.g. unofficial products — is still recognised, named by its folder and attributed to its vendor (with the real artist/version read from the content's own files). These run only after the metadata-backed products and are skipped when a real product already owns the folder/name, so they never duplicate or override a properly-tracked product. Products and unmatched assets are enriched with **artist + version read straight from each asset's own `.dsf`/`.duf` metadata** (the vendor's `author` + `revision`), which the DIM install manifests don't carry — content-relative paths are resolved under the library so the real revision surfaces instead of just the DIM build number, and for a matched product a representative file from its file list is read as a fallback. That file list comes from the DIM manifest for store products and from the `LOCAL_USER_*` metadata's own asset list for manual installs — so a manually-installed product like Golden Palace now surfaces its real vendor `author` + `revision` (read from its own `.duf`/`.dsf`) instead of "Unknown". Unmatched assets still show whatever artist/version their files carry.

  Mechanics: a new bundled runtime (`DthProducts.dsa`) is installed once next to the other DTH runtime files; each scan writes a per-scene CSV into an app-local-data folder keyed by project + character id; the character schema gains additive `products` / `productsUnmatched` / `productsScannedAt` fields (each product/asset also carrying the `scenes` it was found in — no migration needed). The runtime version bumped, so **Tools → Refresh assets** regenerates existing characters' scan scripts to the per-scene layout.

- [#101](https://github.com/polynaut/dth-character-studio/pull/101) [`38aafd3`](https://github.com/polynaut/dth-character-studio/commit/38aafd3a0e5bfd3a0669b60800e4e6e27f4ec7fc) Thanks [@polynaut](https://github.com/polynaut)! - Add **assets** — reusable Daz scenes you build characters on top of. Assets are **per-project and opt-in**: turn them on for a project in **Settings → Project → Enable assets** (off by default, so a project shows characters only). Once enabled, the project page gains a **Characters / Assets** tab and the create side panel a matching **Asset** tab. There is no global/shared asset library — assets always live inside their project's `.assets` folder.

  On the Asset tab you pick a `.duf`, give it a name (prefilled from the file) and an optional description, then either **copy it into a hidden `.assets` folder** (optionally under a subfolder) or **link it in place**. The assets grid shows each scene's thumbnail with open-in-Daz and remove actions; removing a copied asset can keep or delete its files, while a linked asset's source is never touched.

  Each project can also set a **Characters subfolder** (Settings → Project): the relative folder character folders are stored under — e.g. `assets/characters` stores them at `<project>/assets/characters/<Character>/`. Empty (the default) keeps them directly in the project root, as before. Changing it **moves the existing character folders** to the new location and repoints the scene / Houdini links inside them.

  Inside a project (with assets enabled), dropping a Daz scene (`.duf`) opens the create panel and the picked scene is carried across a Character/Asset tab switch instead of being lost. On the home page, dropping a project (`.dcsp`) opens it and dropping a folder starts a new project there.

- [#101](https://github.com/polynaut/dth-character-studio/pull/101) [`38aafd3`](https://github.com/polynaut/dth-character-studio/commit/38aafd3a0e5bfd3a0669b60800e4e6e27f4ec7fc) Thanks [@polynaut](https://github.com/polynaut)! - **Tools → DazToHue-Scripts now tracks versions.** Installing records the exact commit it downloaded: the installer resolves the HEAD of `soltude/DazToHue-Scripts` `main`, downloads _that commit's_ tree (so the files always match the recorded SHA), and writes a `.dth-version.json` marker beside them. The tab then shows whether the installed scripts are **up to date** or an **update is available** by comparing that commit against the latest on GitHub — phrased and styled to match the DTH Exporter Plugin status (a green ✓ "Already installed (X) — up to date." line, **Install / Update / Reinstall** button). The check runs when the page opens and degrades to "couldn't check" when offline or rate-limited.

  The DTH Exporter Plugin status in Settings gets the matching treatment too — the same green checkmark on its "Already installed … up to date." line and consistent text sizing across all of its status lines.

- [#101](https://github.com/polynaut/dth-character-studio/pull/101) [`38aafd3`](https://github.com/polynaut/dth-character-studio/commit/38aafd3a0e5bfd3a0669b60800e4e6e27f4ec7fc) Thanks [@polynaut](https://github.com/polynaut)! - Projects are now **`.dcsp` files** ("DTH Character Studio Project") you can scatter anywhere on disk and open by double-clicking.

  - **File association + per-window projects.** The installer registers `.dcsp`; opening one launches (or, if the app is already running, adds) a window pinned to that project. Launching the app directly shows a **Home** launcher — recently opened projects plus **New project** / **Open project…** — and the app menu gains **New Project** (opens Home). Each window works on exactly one project.
  - **Self-contained projects.** A `.dcsp` is a small JSON manifest beside your character folders; per-project meta (avatars) lives next to it in a hidden `.dcsmeta/`. The app-data folder now holds only volatile, machine-specific state (the recent-projects list, machine/tool settings, network drives) — no project registry, no avatars.
  - **Split settings.** Machine/tool paths (DAZ library, Daz install, Houdini docs, DTH release/exporter) stay in **Settings**; per-project behaviour (the Daz/Houdini subfolder names) moved into each project's manifest and is edited from the project page's **Project settings**.
  - **Automatic one-time migration.** On first launch after updating, each previously known project gets a `.dcsp` (seeded from your old settings), its avatars move into the project's `.dcsmeta`, the recents list is built, and the old `projects.json` + app-data `images/` are removed. Unreachable projects are skipped and retried next launch.

- [#101](https://github.com/polynaut/dth-character-studio/pull/101) [`38aafd3`](https://github.com/polynaut/dth-character-studio/commit/38aafd3a0e5bfd3a0669b60800e4e6e27f4ec7fc) Thanks [@polynaut](https://github.com/polynaut)! - Refresh assets is now its own tab under **Tools → Refresh assets**, backed by a version-detection pass. Each of a character's three artifact groups is tracked by exactly one version:

  - **Daz scripts** (ROM + Export `.dsa`, plus the bundled runtime) → the **script runtime version** (new `RUNTIME_VERSION`), stamped in each script header. A bump means the scripts' call API changed, so refresh re-installs the runtime files **and** regenerates the character scripts.
  - **PoseAsset CSV** → the **DTH release**, via CSV-format _eras_ (`POSEASSET_CSV_BREAKING_VERSIONS`, starting at 2.4.3). A CSV is only out of date when the release it was generated for is in a different era than the active release — so moving from 2.4.3 to a non-breaking 2.4.4 stays "all good", while a future breaking release (e.g. 2.5.0, shipped alongside a new CSV variant) flags a refresh. The release the CSV was generated for is recorded in the character JSON (`generatedDthVersion`, schema **v7**) since the CSV itself can't carry a version.
  - **Character JSON** → the **schema version** (migrated + re-saved on refresh).

  The result is a compact **local-vs-app table** (DTH version, character schema, script runtime): each row is green with a checkmark when local matches what the app generates, or red with a yellow warning when it differs. A "refresh needed" banner and the (enlarged, pulsing-when-needed) **Refresh assets** button sit above it. About shows a short summary linking to the page, and on startup — right after the update check — the app routes you to Refresh assets when work is needed.

  **Refresh is now selective:** when something is out of date, each character regenerates only its affected artifact(s); characters that are current are skipped. With nothing out of date, clicking Refresh still force-regenerates everything.

  Refresh and its version table are **scoped to the window**: from a **project window** they cover that project; from the **Home window** they cover every **known** project (the recents list). With no global registry, recents is the set of projects the app knows about, so refreshing from Home brings everything up to date in one pass.

  Also adds a **character-schema migration framework** in `@dth/rom` (`migrateCharacterData` + the `characterMigrations` registry). The pre-versioning shape fix-ups move into it from the web storage layer, and future breaking schema changes register one idempotent step each (additive fields like v7's `generatedDthVersion` need none).

- [#101](https://github.com/polynaut/dth-character-studio/pull/101) [`38aafd3`](https://github.com/polynaut/dth-character-studio/commit/38aafd3a0e5bfd3a0669b60800e4e6e27f4ec7fc) Thanks [@polynaut](https://github.com/polynaut)! - Remove the **Clone character** action from the character page. Creating a character already supports prefilling its ROM definitions from an existing character (Create → prefill), which covers the same need, so the separate clone flow (and its dialog) is gone — the Operations section now just has **Delete**.

### Patch Changes

- [#101](https://github.com/polynaut/dth-character-studio/pull/101) [`38aafd3`](https://github.com/polynaut/dth-character-studio/commit/38aafd3a0e5bfd3a0669b60800e4e6e27f4ec7fc) Thanks [@polynaut](https://github.com/polynaut)! - Smaller UX fixes:

  - **Delete can keep the Houdini files.** When a character's folder has a Houdini subfolder, the delete dialog now offers a second toggle to keep it on disk — mirroring the existing "keep the Daz files" option, and shown only when such a folder actually exists.
  - **Avatar picker works with a single linked scene.** The scene-thumbnail choices in the avatar dialog now appear whenever at least one Daz scene is linked (previously they only showed with two or more), so you can switch the avatar back after unlinking a second scene.
  - **Settings → General is split into two panels:** the settings you can change, and a read-only panel for the app-data folder and detected network drives. The refresh-assets controls have moved out to their own Tools tab.

- Updated dependencies [[`38aafd3`](https://github.com/polynaut/dth-character-studio/commit/38aafd3a0e5bfd3a0669b60800e4e6e27f4ec7fc)]:
  - @dth/rom@0.27.0

## 0.26.1

### Patch Changes

- [#92](https://github.com/polynaut/dth-character-studio/pull/92) [`bdfc23d`](https://github.com/polynaut/dth-character-studio/commit/bdfc23d07aeb3796d4d9ebc5f8d73dea533cbdc3) Thanks [@polynaut](https://github.com/polynaut)! - Fix five bugs in the bundled DTH Daz runtime (`DthUtils.dsa`), surfaced from a generated ROM script's log:

  - **Fence poses restored at bogus frames.** `setFencePoses` iterated the fence-frame array with `for…in`, which in Daz's script engine also yields enumerable `Array.prototype` members — restoring the figure at `function f(){…}` (NaN time) and `""`. Switched to an indexed loop so only the real fence frames are restored.
  - **"Too many arguments" flood.** `getValueChannel(0)` logged `Too many arguments, ignoring 1` on every morph lookup (the method takes no args). Dropped the argument.
  - **Art-direction "Property not found".** Morph resolution now falls back to `findProperty`/`findPropertyByLabel`, so geo-graft "preset" morphs exposed on the figure as alias properties (e.g. Golden Palace `GP_PR_*`) resolve instead of being skipped.
  - **False "Failed to set property".** `setPropertyByName` verifies by reading the value back instead of trusting `setValue`'s return, so a no-op (value already at target, e.g. FACS Detail Strength) no longer logs a false failure.
  - **Implicit-global hygiene.** `oProp`/`oMod`/`oMorph`/`oContentMgr` are now proper `var` declarations, silencing the "used before declaration" warning.

- Updated dependencies []:
  - @dth/rom@0.26.1

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

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.26.0

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
