# Schema and runtime version history

The per-version meaning of the two version constants in `packages/rom/src/types.ts`:
what each number changed, and whether it needed a migration step.

This is a **lookup table, not a changelog**. Git records when a constant was bumped;
what it does not give you is "a character JSON says `schemaVersion: 14` — what shape is
that, and why did it need no migration step?" without bisecting for the commit that set
it. That question is asked every time someone writes a migration, which is why the
answers are kept — just not inline in the type definitions, where they cost every reader
of that file ~12k tokens to scroll past.

**Bumping a version means adding its entry here**, in the same commit.

## Character schema versions (`CHARACTER_SCHEMA_VERSION`)

```text
  1 — initial versioned schema (the shape as of its introduction).
  2 — added `projectName` + `projectPath`.
  3 — added `exportPath`.
  4 — added `exportSceneSubfolders`.
  5 — added `exportWithRomScript`.
  6 — removed `targetSkeleton` (was never used in generation).
  7 — added `generatedDthVersion` (the DTH release the PoseAsset CSV was last
      generated for; additive with a '' default — no migration step needed).
  8 — added `products` / `productsUnmatched` / `productsScannedAt` (the Daz
      Products scan; additive with [] / '' defaults — no migration step needed).
  9 — added `applyUE5TearUV` (G9 tear-UV toggle; additive with a `false` default
      — no migration step needed).
 10 — replaced the per-pose free-text `referenceFbx` path with a `boneScaleRef`
      boolean. The DTH Exporter now auto-generates the reference-skeleton FBXs and
      the studio computes their CSV paths, so the manual path is gone (migration
      step: a non-empty old path → `true`).
 11 — removed `resetGenBeforeApplying` (removal — zod strips it, no migration
      step). Block tails never leaking is runtime v26 behavior now, not a
      choice: the generated FBM meta always sets the reset flags, and the
      gen-block close-out is unconditional. The off position only reproduced
      the dangling-tail bug.
 12 — added `imageScene` (the linked scene whose preview the avatar mirrors,
      so the editor can re-sync it when Daz rewrites the preview on a scene
      save; additive with a '' default — no migration step. Pre-existing
      scene-derived avatars self-heal: the sync adopts a source scene when
      the stored avatar still byte-matches that scene's current preview).
 13 — added `groomNodes` (hair items excluded from the DTH export via
      unfit+unparent around doExport; additive with a [] default — no
      migration step).
 14 — added `groomMode` ('scene' = groom lives in the ROM scene and the
      groom bracket excludes it at export; 'separate' = classic
      separate-scene workflow, lists inert; additive with a 'scene' default —
      no migration step).
 15 — `groomNodes` (v13, never released) became the per-SCENE `groomScenes`
      (a character's outfit scenes carry different hair styles; the script
      resolves the open scene's list at run time). Removal+addition — zod
      strips the old flat list and fills the new default; no migration step.
 16 — a JCM "Modify frames" rule's split `positive[]` / `negative[]` drive
      lists merged into one signed `drives[]`; direction is inferred from each
      drive's angle-range sign now (the positive/negative selector was
      redundant). Restructure — migration step concatenates the two lists.
 17 — added `sceneOverrides` (per-Daz-scene ROM overrides: replaced rows +
      appended frames for outfit scenes; additive with a [] default — no
      migration step needed).
 18 — added a stable `id` to each JCM "Modify frames" rule AND drive (grid row
      keys; minted on read via a zod default — no migration step). Never
      reaches the generated output: `jcmMorphModForRuntime` emits drives without
      it, so the runtime contract stays byte-for-byte unchanged.
 19 — added a stable `id` to each pose MORPH row (and thereby each
      art-direction morph row — both are `morphSchema`), mirroring v18:
      grid row keys, minted on read via a zod default — no migration step.
      Never reaches the generated output: `morphJson` emits
      node/prop/value/base/autoBase only on every path (extraFrames,
      gp/dkArtDirection), so the .dsa config contract stays byte-for-byte
      unchanged.
 20 — added per-scene `identity` (G9 FACS/flexion/tear-UV), `groom` (hair
      gate) and `preserve` (own preserve-morph / node-transform lists) blocks
      to `sceneOverrideSchema`, generalizing per-scene overrides beyond ROM.
      Additive nested objects with zod defaults — no migration step (hair
      lists stay in `groomScenes`; `groom.enabled` is just the panel opt-in).
      The ROM `enabled` gate's default flipped true → false so a fresh override
      starts fully disabled; this needs no step either — every stored override
      already carries an explicit `enabled`, so nothing relies on the default
      on read. Also REMOVED `groomMode` (the "hair lives in scenes" toggle):
      hair is now always per-scene by presence — a scene's `groomScenes` items
      ARE its hair, none means none. A removed field needs no step (zod strips
      the old value on read); the old 'separate' choice just stops excluding.
 21 — added `sceneOverride.sectionOverrides` (whole-section ROM overrides — a
      scene's complete groups for a section, stored when a structural edit
      reorders / inserts / adds / removes frames, which the sparse
      poses/additions can't represent). Additive array with a zod default — no
      migration step; `applySceneOverride` prefers it over the sparse layer.
 22 — added `sceneOverride.sectionEnabled` (per-scene enable/disable of a ROM
      section — an outfit scene that drops GEN, or turns a section on, instead
      of clearing its rows). Additive array with a zod default — no migration
      step; `applySceneOverride` flips the base section's `enabled` per entry.
 23 — a scene can now override the WHOLE section config per scene (mode, preset
      asset, GEN art direction, custom JCM path), not just custom rows: the
      whole-section override entry changed from `{section, groups}` to
      `{section, config: RomSectionConfig}`. RESTRUCTURE — migration step wraps
      old `groups` into a `custom` config. Also added a `jcm` override block
      (per-scene `jcmMorphMods`, a runtime delta like `preserve`) — additive,
      no step. `applySceneOverride` now applies the owned config wholesale.
 24 — the scene-override RESTRUCTURE: the four parallel ROM arrays
      (`poses`/`additions`/`sectionOverrides`/`sectionEnabled`) became ONE
      section-keyed `rom` record (`{enabled?, owned?, replaced, added}` per
      section — escalation clears the sparse layers at the same key); the
      per-scene panels went PRESENCE-armed (`identity`/`preserve`/`jcm`
      blocks exist iff armed — the stored `enabled` booleans and the derived
      ROM gate are gone); and the character-level `groomScenes` map folded
      into the records as `hair` (the primary scene may now carry a
      hair-only record). Migration step converts everything; sparse entries
      that were dead (orphaned ids, disarmed panels' stored payloads) are
      dropped rather than carried as unreachable data.
 25 — added `exportHairAssets` (run the hair/groom export right after the
      main export inside the carrying script; additive with a false default —
      no migration step).
 26 — removed `exportSceneSubfolders` (no step — zod strips it). Exports now
      ALWAYS nest under a per-scene subfolder, named after the folder each
      linked scene lives in (see `sceneExportSubfolders` in dsa.ts) — every
      scene has its own subfolder now (primary → "primary", extras seeded
      from the sanitized scene name). The Refresh sweep also moves legacy
      root-dwelling scene files into their subfolders (host-side, not a
      migration step — file moves need the fs).
 27 — added `houdiniProjectFolder` (character-level, '' default) + the
      per-scene `sceneOverride.houdiniProjectFolder` (present = overrides,
      like hair it rides its map by presence and never arms). When
      set, exports nest under `<exportPath>/<folder>/dth-export/<scene-sub>/`
      so a Houdini project can Set Project there and import JOB-relative.
      Additive with defaults — no migration step: existing characters read
      as '' and keep today's flat `<exportPath>/<scene-sub>/` layout. Only
      the NEW-character creation flow seeds `<Project>_<Character>`.
 28 — added `frameZeroMorphs` (morphs set + keyed at frame 0, applied across
      the whole figure tree — clothing fit morphs like "Expand All") and the
      per-scene `sceneOverride.frameZero` replacement list (present = armed,
      like `preserve`/`jcm`). Additive with defaults — no migration step.
 29 — removed `houdiniProjectFolder` (character-level AND the per-scene
      `sceneOverride.houdiniProjectFolder`), retiring the whole v27 export
      nesting: the export directory is no longer user data and no longer
      owes anything to Houdini. `exportPath` is DERIVED as
      `<character>/<dazSubdir>/dth-exports` (host-resolved in web
      `parseCharacter` — Case C), every scene exports flat into
      `<exportPath>/<scene-subfolder>/`, and Houdini reaches those files
      through a `dth-exports` JUNCTION inside one shared, fixed-name
      `houdini-project` folder. Both removals are zod-stripped, but a step
      PRUNES the scene records the override removal itself empties (a
      project-folder-only record is a dead stub once the field is gone —
      schema v24's rule; records that were already empty are left alone).
 30 — removed `products` / `productsUnmatched` / `productsScannedAt` (added in
      v8). Daz-product scan results are machine-derived provenance that never
      affected generation, and storing a few hundred rows of them inflated a
      definition meant to be read and shared. They moved to the character's own
      meta folder (`.dcsmeta/characters/<folder>/products.json`), written
      unattended when the studio picks up what the Daz scan wrote — which is
      also what retired the "review, then store" dialog. Removals are
      zod-stripped, so no migration step; the web layer carries an existing
      definition's stored products into the new file BEFORE the save that
      strips them (`carryStoredProductsToMeta`, api/products.ts).
 31 — the per-morph `autoBase` zod default flipped false → true: resolving a
      morph's sawtooth floor from its own frame-0 scene value is the default
      now, and off is the opt-out. A pre-v31 definition stored the flag ONLY
      when it was on (the editor wrote `undefined` for off), so absent is
      indistinguishable from "never touched" — the default therefore turns
      auto-base ON for every existing morph on read, which IS the intended
      one-time migration; no step. It is deliberately NOT the v20 treatment
      (that step preserved the old meaning of an omitted flag) because here
      the flip is the point: a morph the character dials as part of its base
      shape must return to that value, and a morph that isn't dialed reads 0
      at frame 0 and behaves exactly as before. `.default` (not `.optional`)
      also makes the field REQUIRED on the parsed type, so every
      morph-creation site has to state its intent — see `newMorph`.
 32 — added `node` to `preserveMorphSchema` + `frameZeroMorphSchema` (and so
      to the per-scene `preserve.morphs` / `frameZero` replacement lists that
      embed them): the morph autocomplete always KNEW which node a suggestion
      lives on but the pick discarded it, so a frame-0 row broadcast to every
      node carrying the name (auto-follow twins put a fit dial like
      "FBMExpandAll" on EVERY conformed item) and a preserve row for a
      clothing morph silently missed (the runtime only searched the figure
      root). `''` keeps each list's old reach — broadcast for frame-0,
      figure root for preserve. Additive with defaults — no migration step.
```

## Generated-runtime versions (`RUNTIME_VERSION`)

> **This list is 23 versions behind the constant.** It runs 1–51;
> `RUNTIME_VERSION` is currently **74**. The gap is pre-existing — it was found
> when these entries were lifted out of `types.ts`, where a stale log sitting hundreds of
> lines inside a 2,000-line file was invisible to everyone. The missing versions are
> recoverable from git (`git log -S'RUNTIME_VERSION = <n>' -- packages/rom/src/types.ts`)
> and have not been backfilled. Treat an absent entry as "undocumented", never as
> "nothing changed".

```text
  1 — initial runtime version (the runtime + generated-script shape as of its
      introduction; earlier scripts carry no marker and read as out-of-date).
  2 — added the DthProducts.dsa runtime + the generated Scan_Products_<Name>.dsa
      script (the Daz Products scan feature).
  3 — product scan keys its output by the open Daz scene (per-scene CSVs in a
      per-character folder) and reads texture-based matching, so existing scan
      scripts must be regenerated to write the new per-scene layout.
  4 — product scan attributes an unmatched decorative node (a zipper, a flower
      trim) to a product already matched in the same scene when the node's name
      is the basename of a file that product installs ("Manifest Match"), so
      figure-parented sub-parts stop landing in "unmatched".
  5 — product scan reads ALL of a node's material map channels (normal, bump,
      roughness, metallic, …), not just the diffuse map, so a sub-part whose only
      file texture is on a non-diffuse channel still texture-folder matches.
  6 — product scan attributes an unmatched GROUP/null node to the product its
      matched children belong to ("Group Match"), and writes an unmatched-node
      diagnostics file next to each per-scene CSV.
  7 — product scan runs its structural attribution passes (parent→child, name↔file,
      child→parent) to a fixpoint, so a match made by one pass unblocks another
      (e.g. a decoration parented to a node that only the group pass matches).
  8 — keyword matching requires TWO distinct shared keywords (the scene-Genesis
      bonus only ranks, never promotes a one-word match) and folds in the morph
      parameter path, so a morph like "SL_Glutes Top Inflate" stops mis-filing
      under "Summertide Swimwear Top" and matches its real product instead.
  9 — product scan writes the unmatched-node diagnostics file only when something
      is unmatched (a clean scan writes none and removes a stale prior report).
 10 — product scan writes a temporary "_debug-matches-<scene>.txt" dumping the
      asset fields behind each match (to diagnose a surprising keyword attribution).
 11 — keyword matcher counts distinct shared keywords with arrays + hasOwnProperty
      instead of `for…in` over a plain object: Daz's QtScript leaves enumerable
      members on Object.prototype, which inflated the count and silently defeated
      the two-keyword gate (e.g. "GP_Minora_Inflate Inside" → "Inside the Asylum
      Bundle" on the lone word "inside"). Temporary match-debug dump removed.
 12 — product scan synthesizes products from the content library's
      data/<Vendor>/<Product> folders as a last resort, so content with no DIM /
      LOCAL_USER metadata (e.g. unofficial products) is still recognised — named by
      its folder, with artist/version read from the content's own files.
 13 — the ROM script writes a run log (dth_rom_run_log.json in the character
      folder) recording every morph that couldn't be applied and any unexpected
      error, and ends with a dialog when there were problems (the studio reads
      the log back). Missing morphs can no longer shorten the timeline: frame
      slots come from the declaration, NaN frames are logged + skipped, and the
      legacy per-frame loop no longer aborts a frame on the first missing morph.
      The character script is now always named ROM_<Name>_<Genesis>.dsa.
 14 — v13 regression fix: the generated script's include() moved back to the
      TOP level — Daz resolves include() via its legacy-include mechanism,
      which fails inside try/catch ("URIError: Legacy Include"), breaking every
      v13 script before it ran. The catch-all now guards only the call (a
      typeof check covers a missing runtime), the export block is skipped when
      the ROM build aborts, and the Daz dialogs are short + generic — the
      details live in the studio, which ingests the run log.
 15 — generator fix (not a runtime-API change; bumped to force regeneration of
      affected scripts): a base-less character (no JCM/GEN/PHY preset — e.g.
      FBM-only, or custom JCM groups) now starts its first custom frame at 0
      instead of 1, re-aligning the PoseAsset CSV / exporter reference frames
      with the Daz timeline (removed a Math.max(...,0) off-by-one). Also
      hardens the generated .dsa/CSV against injection: control chars are
      stripped from names in comment headers, commas/newlines from CSV group
      labels + reference-FBX paths.
 16 — runtime-API change: preset-block lengths (base/gp/dk/phys) are no longer
      hard-coded in the runtime (was iRomFrames 328/617, gp 104, dk 54, phys 43).
      The studio measures each from the actual .duf and threads them in as
      config/options.presetFrames; the runtime sizes every block from those and
      fails loud (logRunError + abort) if a count is missing — so a custom or
      future-DTH preset of non-standard length can't silently desync the Daz
      timeline from the PoseAsset CSV. Scripts generated before v16 carry no
      presetFrames and must be regenerated (Tools → Refresh assets).
 17 — DS6 keyframe-drift workaround: on Daz Studio 6 every ROM morph key is
      stamped CONSTANT instead of LINEAR (and the session default matches).
      DS6's animation engine drifts Linear ROM keys across the timeline
      (mrpdean, June 2026); converting all keys to Constant after applying
      is his validated fix. DS4 behavior unchanged (Linear). The final
      interpolation pass now also covers the FAC mouth node, whose keys a
      root-only pass never touched.
 18 — Scan_Morphs_<Genesis>.dsa scripts (G9/G8.1/G8/G3) + the shared
      .DthScanMorphs.dsa runtime: scan every morph dial (DzMorph modifiers +
      controller float properties) on a selected unrenamed figure AND its
      descendants (grafts, clothing) into a per-generation
      JSON in the studio's app-data folder — the Morph-name autocomplete's
      index. Install-time templating bakes the app-data path into the
      wrappers; no generated-script API change.
 19 — Genesis 8/8.1 support: the mouth ROM pass now runs only when a mouth
      pose asset was actually resolved (G9 is the only generation that ships
      one — G8.1's FAC frames live in its base ROM, and its figures have no
      separate mouth node to require). The figure-root error message no
      longer claims "Genesis 9" (the root has always come from the user's
      selection, any generation works). Non-G9 generated configs zero the
      G9-only FACS-detail/flexion strengths so runs don't log a spurious
      "property not found" failure.
 20 — ApplyDTHCharacter returns FULL success (finished AND zero run-log
      problems) instead of just "didn't abort". The generated combined
      script gates its export block on it, so a ROM with failed morphs no
      longer ships a PoseAsset CSV/FBX as if it were good — fix and re-run.
      Regenerate scripts (Tools → Refresh assets) to pick up the stricter
      `=== true` gate.
 21 — Generation now writes a per-character `Open_Scene_<Character>.dsa` (opens
      the scene in an already-running Daz from the Content Library, since the
      studio can't forward it in). No runtime `.dsa` change — bumped purely so
      Refresh assets regenerates existing characters to install the new script.
 22 — Removed the `Open_Scene_<Character>.dsa` script again (a plugin-based
      solution is coming instead). No runtime `.dsa` change — bumped so Refresh
      assets regenerates existing characters and cleans up the leftover script.
 23 — Bone-scale reference frames: the PoseAsset CSV's `file` column now carries
      a `{{DTH_EXPORT_DIR}}` token for bone-scale frames, and the generated
      script resolves it to the real export dir when it copies the CSV (was a
      plain file copy). No runtime `.dsa` change — bumped so Refresh assets
      regenerates existing scripts with the token-aware copy.
 24 — Bone scale restricted to GEN/FBM: a non-empty `file` on a MIS row makes
      the HDA's import_from_csv fail (no matching node parameter — measured on
      2.4.3), so generation no longer emits reference FBX paths or exporter
      reference frames for MISC poses. No runtime `.dsa` change — bumped so
      Refresh assets regenerates any CSV that carried a MIS file entry.
 25 — Scan_Frames.dsa ships with the studio: the keyframe-scan functions moved
      out of DthWorkflow.dsa into the shared .DthScanFrames.dsa runtime
      (DthWorkflow includes it; generated-script behaviour unchanged), and a
      visible Scan_Frames.dsa wrapper exports the open scene's keyed frames
      into the studio's app-data scan-frames folder for "Import from CSV" —
      replacing the DazToHue-Scripts DthScanFrames workflow. Bumped so Refresh
      assets installs the new scripts.
 26 — ROM block tails no longer leak into later blocks: a pose preset can
      only key frames inside its own range, so a block's LAST pose had no
      ramp-down key and held its value through everything after — the base
      ROM's final FAC neck pose showed as neck/throat morph deltas across the
      whole GEN range in Houdini. After the base block loads, any keyed morph
      on the figure (and the G9 mouth) not back at its frame-0 value gets that
      value keyed at the first post-base frame, completing the sawtooth the
      preset couldn't. The GP/DK blocks get the same close-out on their own
      node at the next block boundary (the FBM-start art-morph reset alone
      missed .duf-baked gen morphs, skipped characters without art direction,
      and never protected a Physics block between GEN and the customs). The
      `resetGenBeforeApplying` character option is gone with it (schema v11):
      tails never leaking is behavior now, not a choice — the studio always
      emits the FBM meta reset flags; only legacy file-based configs can still
      turn them off. Re-run the ROM script in Daz to rebuild existing
      timelines.
 27 — Inline-config only: the runtime no longer reads file-based configs — the
      extraJSONs (*_FBMs.json) list, the GP9/DK9 art-direction JSON path
      fallbacks and the readPropsCSV reader of the old wrapper-script era are
      gone (the runtime is studio-owned; everything arrives inline via
      ApplyDTHCharacter). A config that still passes them aborts LOUD with a
      regenerate-in-studio error instead of building a ROM without its custom
      frames. The GP/DK block-tail close-outs are unconditional now (the meta
      reset flags are gone — with the resetGenBeforeApplying option removed
      in schema v11 they no longer had an off position), and the FBM-start
      art-morph reset is retired: the boundary close-out covers it.
 28 — Auto-select the character's figure: a missing or wrong selection no
      longer aborts the ROM — the runtime finds the scene's figure of the
      config's generation by its source-ASSET identity (labels/names are
      user-renamable; the instantiating .dsf is not) and selects it, first
      match winning when a scene holds several. Legacy configs without a
      genesis, and Daz builds without a readable asset URI, keep the old
      select-it-yourself behavior unchanged.
 29 — The auto-select's unreadable-asset tolerance is restricted to actual
      FIGURES: a selected non-figure (a prop, Environment Options, …) is
      never accepted as the export root anymore — it auto-selects the real
      figure or fails loud (found by deliberate wrong-selection testing).
 30 — The base-ROM tail close-out (closeDanglingMorphKeys, runtime v26) no
      longer double-applies character-owned morphs. It ran a whole-figure
      re-key at the FAC→GEN boundary using each morph's post-ROM value; for a
      morph the character/GP/character-preset drives (e.g. ProportionHeight),
      that stacked the value on top of the ERC-driven contribution, so a -10%
      dialed height read as -20% by frame 327. The runtime now snapshots the
      morph baseline BEFORE the ROM (memorizeBaseMorphs) and leaves any
      character-dialed (non-zero base) morph untouched — only pure ROM poses
      (base ~0, e.g. the final FAC neck pose that v26 was added to fix) still
      close their dangling tail. The DK/GP geograft and mouth close-outs are
      unchanged. Re-run the ROM script in Daz to rebuild affected timelines.
 31 — Groom (hair) exclusion is HIDE-only now. The generated export block used
      to unfit+unparent the groom items itself (because Daz's FBX exporter
      ignores visibility on fitted followers), with an opt-in hide variant.
      The DTH Exporter Plugin now unparents any HIDDEN child node before
      exporting and reparents it after, so the script only hides the groom
      items and lets the plugin exclude them from BOTH the FBX and the alembic.
      The detach path and the "Solve hair assets by hiding" setting are gone.
      NB: requires the plugin build that does the hidden-node unparent — an
      older Exporter would leak hair back into the FBX. Refresh assets to
      regenerate existing characters onto the hide-only export block.
 32 — Per-scene overrides collapse into the ONE character script. The
      generated `ROM_<Name>_<Genesis>.dsa` now embeds a `dthSceneOverrides`
      map (normalized open-scene path → the few config fields that scene
      changes) and merges the open scene's delta onto dthCharacterConfig
      before the build — so one script serves the primary AND every outfit
      scene, instead of a separate `ROM_…_<Scene>.dsa` per override. The
      export block likewise selects the scene's PoseAsset CSV by open scene.
      Refresh assets to regenerate onto the one script (the old per-scene
      scripts are swept on the next save/refresh).
 33 — The Hair export (`Export_Hair_…`) exports EACH hair item on its own now,
      named `<Name>_Hair_<item>`, instead of one combined `<Name>_groom` .abc.
      For every item in the open scene's list it hides every OTHER wearable
      (including the other hair items) and exports just that one, so Houdini
      gets one alembic per hair asset. Refresh assets to regenerate.
 34 — The morph scanner (`DthScanMorphs`) now also collects the figure's BONES
      into a `bones` array in the scan index (`morphs_<G>.json`, version 2),
      feeding the new bone autocomplete in the "Modify JCM frames" editor. No
      change to any GENERATED script — bumped only so Refresh assets reinstalls
      the updated scanner. Re-run Scan_Morphs in Daz to populate the bone list.
 35 — The v17 DS6 keyframe workaround is ROLLED BACK: every ROM morph key is
      LINEAR again on DS4 AND DS6 (session default included), and the DS6
      version detection is gone. Constant keys didn't actually solve DS6's
      drift and introduced headaches with the DK9 ROM — mrpdean is rolling
      the same workaround out of the next DTH release (July 2026), so the
      studio returns to Linear in lockstep. Refresh assets (or re-save) to
      reinstall the runtime; re-run the ROM script in Daz to re-key.
 36 — generated-script change only (runtime files untouched): every
      per-character script (ROM_, Export_, Export_Hair_, Scan_Products_)
      leads with the wrong-scene guard — it refuses to run (error dialog,
      ROM_ also writes the run log) when the OPEN Daz scene isn't one of the
      character's linked scenes; running Kira's script on Ita's scene used
      to apply everything silently. Bumped so Refresh assets regenerates
      every existing script with the guard.
 37 — generated-script change only (runtime files untouched): the export
      block ALWAYS nests the export dir under a per-scene subfolder (the
      `exportSceneSubfolders` toggle is gone). The subfolder comes from an
      embedded map — normalized open-scene path → the folder name that scene
      lives in (`sceneExportSubfolders`) — with the old scene-file-stem
      nesting as the run-time fallback for a scene missing from the map.
      Bumped so Refresh assets regenerates every script onto the new layout.
 38 — generated-script change only (runtime files untouched): the
      "bulk-export" script argument (`BULK_EXPORT_ARG`). The DTH Exporter
      Plugin passes it on every job-file run (the studio's DTH Export
      button); the ROM script then always exports — the export block is now
      embedded even with `exportWithRomScript` off (run-time gated) — and
      the hair pass runs past a disabled `exportHairAssets` too: a bulk job
      exists to deliver the complete export set. A manual run (no argument)
      behaves exactly like the toggles say. Bumped so Refresh assets
      regenerates every script with the argument gate.
 39 — runtime change: one `Build_Genesis_Index.dsa` replaces the four visible
      `Scan_Morphs_<Genesis>.dsa` wrappers. It builds the stock figures for
      every generation itself (G3/G8/G8.1 female + male; Genesis 9 twice —
      gender-neutral, so the pair differs by geograft: Golden Palace vs
      Dicktator), scans every figure root in the scene bucketed by detected
      generation, and writes all four `morphs_<G>.json` indexes in one run
      (now index `version: 3`, with a `figures` array). Bumped so Refresh
      assets reinstalls the runtime and sweeps the retired wrappers.
      Also: every Daz script the studio installs now carries Content Library
      artwork beside it — the two visible runtime scripts, and each generated
      per-character script (its `icon` tag picks the art; a ROM script that
      also exports looks different from one that doesn't). Script CONTENT is
      unchanged by that, but the artwork only lands on a (re)generate, which
      this bump makes Refresh assets do.
 40 — generated-script change only (runtime files untouched): the figure
      name handed to the exporter's `doExport` is scene-suffixed at run time
      — base name + "_" + the open scene's export subfolder, first letter of
      each segment capitalized ("Kira" in "summertide/" exports as
      "Kira_Summertide") — so each subfolder's files carry their scene
      instead of every subfolder holding an identically named export. The
      PRIMARY scene keeps the bare base name ("Kira", never "Kira_Primary")
      while still exporting into its subfolder. The CSV's bone-scale
      reference-FBX paths bake a
      {{DTH_EXPORT_NAME}} token the CSV-copy step substitutes with the same
      run-time name (alongside {{DTH_EXPORT_DIR}}), keeping exporter output
      and CSV pointers in lockstep — and the CSV copy is DELIVERED as
      `<dthExportName>_pose_asset.csv`, the same scene-suffixed base as the
      files beside it (the source CSV keeps its studio name). Also (schema v27): with a
      `houdiniProjectFolder` set, the export dir first nests under
      `<folder>/dth-export` before the scene subfolder — a Houdini project
      Set-Project'd to `<exportPath>/<folder>` imports everything
      JOB-relative. Per-scene overrides resolve through an embedded map
      ('' = that scene exports flat); characters without the folder ('' —
      every pre-v27 character) emit the layout unchanged. Also RETIRES the
      v38 "bulk-export" script argument (it never reached getArguments()
      through the Runner's DzScript::execute) — bulk runs now execute a
      dedicated hidden `.Bulk_ROM_Export.dsa` (the combined script with both
      export toggles forced on; generated whenever an export dir is set),
      and the visible ROM script carries an export block only in combined
      mode again (pre-v38 behavior). And: after a CLEAN ROM build every
      ROM-building script saves the scene as `<stem>_ROM.duf` into the
      hidden `.ROM_Animations/` subfolder beside the source scene (before
      any export) — the generated ROM animation stays reopenable without a
      rebuild. The save-as repoints Scene.getFilename(), so all scene-keyed
      lookups read the `dthOpenSceneFile` capture taken at script start.
      Bumped so Refresh
      assets regenerates every script + CSV onto the new naming.
 41 — runtime change: `Build_Genesis_Index` CLEARS THE SCENE when it finishes,
      not just between generations — the last generation's figures are wiped
      once they're scanned, so a build ends on an empty scene instead of
      leaving stock figures loaded. Build path only; scanning the OPEN scene
      still never touches it. No change to any GENERATED script — bumped so
      Refresh assets reinstalls the updated scanner.
 42 — generated-script change only: the v40 ROM-scene auto-save never worked
      in DS6 — `DzContentMgr.saveScene` does not exist there (TypeError,
      swallowed by the best-effort guard: the `.ROM_Animations/` folder was
      created, the `.duf` never written). The save now feature-detects: the
      DS4 content-manager call when present, else DS6's `Scene.saveScene`
      (probe-measured 2026-07-30, saves silently incl. the `.tip.png`
      thumbnail). Bumped so Refresh assets regenerates every script with the
      working save.
 43 — generated-script addition: every character now also gets the hidden
      `.Build_ROM_Animation.dsa` — the ROM-only mirror of the bulk script
      (export forced OFF): builds the ROM and saves the reopenable
      `.ROM_Animations/<stem>_ROM.duf`, nothing else. Backs the scene
      card's "Open and Generate ROM Animation". Needs no export dir.
      Bumped so Refresh assets generates it for existing characters.
 44 — runtime change: "Add morphs on frame 0" (config/options.frameZeroMorphs,
      [{name, value}]). After the ROM blocks + preserve restores, each listed
      morph is set + keyed at frame 0 on EVERY node of the figure tree that
      carries it (figure, geografts, fitted clothing — one "Expand All" row
      reaches every outfit piece of the open scene); with no other keys the
      value holds across the whole ROM. A morph no node carries is a Daz-log
      warning, never a run-log failure (a scene without that clothing is an
      expected state). Refresh assets to regenerate scripts onto the new
      runtime.
 45 — generated-script fix (runtime files untouched): the ROM-scene save
      reported success by TRUTHINESS, but `DzScene::saveScene` returns a
      **DzError** — where 0 IS success (SDK header, DS4 + DS6) — so every
      successful DS6 save logged "Could not save the ROM scene". Only
      `App.getContentMgr().saveScene` answers a plain bool; the check now
      accepts either convention. Bumped so Refresh assets regenerates the
      scripts whose log line lies.
 46 — generated-script change: DTH Export's three modes. A new hidden
      `.Bulk_Export_Only.dsa` (emitted with an export dir, beside
      `.Bulk_ROM_Export.dsa`) runs the exporter + hair pass over the ROM
      already on the timeline — no rebuild — for job rows that open a SAVED
      ROM animation. To make that work, every generated script now embeds
      `dthRomSourceScenes` (ROM-animation path → source scene) right after
      the open-scene capture and resolves the capture through it, and the
      wrong-scene guard reads that capture instead of `Scene.getFilename()`
      — so a run on a `.ROM_Animations/<stem>_ROM.duf` resolves its
      per-scene config, hair list, export subfolder and CSV as the source
      scene, where it used to be refused as a foreign scene. Refresh assets
      to regenerate.
 47 — generated-script change (runtime files untouched): the export dir is
      FLAT again. Schema v29 retired `houdiniProjectFolder`, so the run-time
      `dthExportProj` resolution and the `<project>/dth-export` prefix are
      gone from every carrier (ROM/bulk, Export_, Export_Hair_) — a scene
      exports straight into `<exportPath>/<scene-subfolder>/`. The export
      path itself is now derived (`<char>/<dazSubdir>/dth-exports`), and
      Houdini reaches it through a junction rather than by containing it.
      Refresh assets to regenerate scripts still carrying the old nesting.
 48 — generated-script change: the saved-ROM folder is `rom-animations`,
      renamed from the hidden `.ROM_Animations`. It holds scenes the user is
      meant to OPEN, so hiding it was wrong, and the name now matches the
      lowercase-hyphenated convention the other studio folders use
      (`dth-exports`, `houdini-project`). One spelling for both sides now —
      `ROM_ANIMATIONS_FOLDER` in rom-animation.ts, which `romAnimationPath`
      and the emitted `.dsa` both read, so the host can't stat a path Daz never
      wrote. Refresh assets regenerates the scripts AND renames an existing
      `.ROM_Animations` folder beside each linked scene, so already-saved
      ROM animations follow rather than being orphaned.
 49 — generated-script fixes, both found on a live Daz 4.24 run:
      (a) A SKIPPED EXPORT IS NOW LOUD, and distinguishes its two causes.
      It only `print()`ed, so the ROM finished "successfully" while the
      export silently never ran — the failure existed only in Daz's log.
      `findAction` matches on CLASS name: DS6 registers
      `DazToHueExporterAction`, DS4 registers class `ExporterAction` /
      name `DazToHue_Action`, so the lookup reported "not installed" for a
      plugin that was right there. It now falls back to the name — but
      PRESENCE IS NOT CAPABILITY: being callable from Daz script is a DAZ
      STUDIO 6 plugin feature (exporter 1.8.1), and the DS4 build registers
      its action while exposing only inherited DzAction members. Measured on
      a DS4 install reporting 2.0.1 in its own dialog: 28 methods, no
      doExport, and a sweep of all 912 actions + the global scope found no
      doExport* anywhere. The gate is therefore
      `typeof doExport == "function"`, with three distinct messages:
      exportable, present-but-unscriptable (run from DS6 / export by hand),
      and absent. Every alert goes through one emitted `dthExportAlert`,
      which ALWAYS records the problem in the studio's run log and raises a
      dialog only in a hand-run carrier — a modal inside the Runner's hidden
      scripts blocks the batch on a click nobody is there to make, so the run
      log is those carriers' only channel. It appends to the existing log
      rather than overwriting, so a successful ROM keeps its ok flag, frame
      count and failed morphs; with no log at all (an export-only run) it
      writes one with ok:false. Self-contained because the split `Export_`
      carriers do not include the runtime.
      (b) The ROM-scene save is verified by STATTING THE FILE, never by the
      return value. Every Daz build disagrees about that value — plain bool,
      DzError-where-0-is-success (DS6, the v45 fix), and void in DS4, which
      logged a successful save as "Could not save" while Daz's own log said
      "Saved Scene". Chasing conventions per version is a losing game.
 50 — generated-script fix: the ROM-scene save is verified by the file's
      TIMESTAMP MOVING, not merely by the file existing. v49 swapped an
      unreliable return value for `DzFileInfo.exists()`, which is a false
      POSITIVE here: this file is overwritten every run, so from the second
      run on it already exists and a failed save reported success while the
      stale previous ROM sat on disk waiting to be exported as fresh. Now the
      mtime is read before and after and must differ; a file that wasn't
      there before is proof by itself, and if neither timestamp can be read
      existence is accepted rather than crying wolf.
      Also fixes the v48 rename MIGRATION, which shipped a no-op: a bulk
      rename had set `LEGACY_ROM_ANIMATIONS_FOLDER` to the NEW name, so the
      host renamed `rom-animations` → `rom-animations` and every already-saved
      ROM animation stayed stranded in the hidden `.ROM_Animations` while Daz
      began filling the new folder beside it. And ROM animations are HOUSEKEPT
      now: renaming a scene used to leave its old `<stem>_ROM.duf` (plus Daz's
      two thumbnails) behind forever, since the name follows the source
      scene's stem — `orphanedRomAnimations` retires them on the next
      generation, matching only the studio's own naming and only beside scenes
      the character still links.
 51 — runtime-file change (generated scripts untouched): a new visible
      `Fix_Graft_Shell_Surfaces.dsa` + its `DthShellSurfaces.dsa` module.
      Fitting a nipple/navel geograft adds ITS surfaces, switched ON, to the
      Golden Palace / Dicktator geoshells already on the figure, so the shell
      renders over the new graft; the script switches those foreign rows off
      on GP/DK shells only. Bumped so Refresh assets installs the two new
      files into an existing scripts root (the install skips wholesale when
      the marker already matches this RUNTIME_VERSION).
v52 — `.Build_Genesis_Index_Bulk.dsa`, the Runner's dialog-free twin of the
      visible index builder (DthScanMorphs.dsa learns `bulk`): the Tools
      handoff runs inside a possibly minimized Daz, where the visible
      script's confirm/summary dialogs invisibly blocked the whole batch.
      Bulk resolves questions to their stock-figures default, logs instead
      of toasting modally, and throws on failure so the row fails loudly.
v53 — the SCENE morph scan: `DthScanSceneMorphs()` in DthScanMorphs.dsa scans
      an open scene for the dials the base index doesn't carry (fitted
      clothing, hair, third-party grafts) and files them under that scene in
      `morphs_scenes_<G>.json`, and `.Scan_Scene_Bulk.dsa` is the Runner's
      per-scene worker for Tools → Scan project (scene morphs and/or the
      product scan off one open, driven by the `dth_scan_config.json`
      sidecar). DthProducts.dsa learns the same `bulk` contract.
v54 — the ROM run log is PER SCENE (log v2). `writeRunLog` merged by scene
      instead of truncating: a DTH Export batch runs one row per scene and
      every row wrote the same per-character log, so only the LAST scene's
      problems ever reached the studio and earlier failures were destroyed
      silently. Each run is now tagged with its scene (so the report can
      select it) and stored under it; a re-run replaces only its own entry.
v55 — every ROM/export run SCANS the scene it just verified: the generated
      scripts call DthScanSceneMorphsQuiet (and, when the project has Daz
      Products on, DthScanProductsQuiet) right after the wrong-scene guard,
      so the morph index and product results stay current off the app's core
      flow alone. Both are best-effort and never throw — a scan problem must
      not fail an export row that succeeded. DthScanSceneMorphs and
      DthScanProducts take a `scenePath` override so a run whose open file is
      a saved ROM animation still files under the SOURCE scene.
v56 — the morph scans skip cameras and lights ANYWHERE in the hierarchy, not
      only at the scene root: one parented into a figure or prop (a light
      rig, a camera mount) walked straight past the root-level guard, and
      its float dials (focal length, intensity, falloff) landed in the
      scene index as morph suggestions. The node's children still scan.
v57 — no script-API change: the bump the junction removal (v0.63) should
      have shipped with. Bone-scale reference paths swapped from
      `$HIP/dth-exports/…` (junction-resolved) to plain-relative
      `$HIP/../<dazSubdir>/dth-exports/…` — emitted CONTENT changed, so
      every character's scripts must regenerate (which also runs the
      junction-leftover sweep). Without the bump nothing read as stale and
      no refresh was forced. Lesson: a change to what the generators EMIT
      bumps this version even when the runtime files' API is untouched.
v58 — the scene morph scan REFUSES to file anything when the generation has
      no base index (`dthHasBaseIndex`, DthScanMorphs.dsa). The scan reports
      what a scene adds ON TOP of the stock figures by subtracting that
      index; with nothing to subtract, the whole stock figure filed itself
      as the scene's contribution and the Parameter-name autocomplete
      drowned in it with nothing saying why. Harmless before v55 (only the
      Tools batch scanned scenes, and it enqueues the base row first on
      purpose) — v55 put the scene scan on EVERY ROM/export run, which put
      it in front of anyone who had never built the index. Nothing is lost
      by refusing: a later scan replaces a scene's contribution wholesale,
      so the first run after the base index exists files it correctly.
v59 — no script-API change: the app's own per-character files moved out of the
      character folder into `.dcsmeta/characters/<folder>` (the project's
      hidden meta folder). Two of them are baked into the generated scripts —
      the PoseAsset CSV the export block copies, and the `runLogPath` the
      runtime writes — so the emitted CONTENT changed and every character's
      scripts must regenerate. The bump is also what carries the one-time file
      MOVE across a library: Refresh assets regenerates each character, and
      that pass is where the old files are relocated.
v60 — no script-API change: the Daz-product scan is now armed by the DIM
      manifests folder being set in Settings, not by the per-project "Daz
      Products" toggle (which now only decides whether the character page
      shows the tab). Projects with the toggle off therefore emit the scan
      config and the `Scan_Products_<Name>.dsa` for the first time, so the
      generated content changed and every character must regenerate.
v61 — the product-scan CSV writer closes each file with an `end` row, and the
      studio's pickup consumes a CSV immediately only when that row is present
      (proof the write finished; a terminator-less file must first sit
      unmodified past a settle window). Ships in the same release as v60 —
      the bump exists for pre-release installs already stamped v60.
v62 — a new VISIBLE script joins the Content Library: `Kill_Animation.dsa`
      (+ its `DthKillAnimation.dsa` runtime and its artwork). It strips every
      key off the open scene and puts the timeline back to a default 0-30, so
      an old scene that survives only as its full ROM animation can be
      recovered into an addable character scene (the studio requires an empty
      timeline). Nothing the generated per-character scripts emit changed —
      the bump is what INSTALLS the new script: `copyRuntimeFiles` skips the
      whole install while the marker matches, so without it no existing
      library would ever see the file.
v63 — generated project-relative reference paths are anchored on **`$JOB`**
      instead of `$HIP`: `$JOB/daz3d/dth-exports/…` where it was
      `$HIP/../daz3d/dth-exports/…` (`hipRefPrefixFor`). `$JOB` IS the
      character folder (v0.64), so the export tree is one hop from it — and
      that is what Houdini's own file picker writes, so a hand-picked path
      and a generated one finally agree in the same node. The `$HIP` form was
      never a preference: before v0.64 `$JOB` sat BELOW the exports and could
      not express them. It encodes the `.hip`'s DEPTH, so a project one
      folder deeper broke every path, and it needed every project in ONE
      folder for a single prefix to be right — neither limit survives.
      The emitted bone-scale reference-skeleton paths change, hence the bump;
      projects generated earlier keep the old form, are flagged by the card's
      `hip-relative` check, and are rewritten by Utils → Make paths portable.
v64 — the export root MOVED and was renamed: `<char>/<houdiniSubdir>/daz-export`
      where it was `<char>/<dazSubdir>/dth-exports`. Nothing in Daz ever opens
      these files again — the `.dth`/`.fbx`/`.abc` exist to be imported by
      Houdini — so they now sit one hop from the `.hip` that reads them, and
      the name says whose output it is rather than which tool wrote it. The
      emitted export/reference paths change (`$JOB/houdini/daz-export/…`),
      hence the bump. Existing characters keep their files: the next save
      carries them across (`migrateExportRoot`) and removes the emptied old
      root. A Houdini project generated earlier still names the OLD folder, so
      its imports report as broken until Utils → Make paths portable rebuilds
      them from the character's current export root.
v65 — audit fix-pass over the emitted scripts: the per-scene config lookup
      reads the `dthOpenSceneFile` capture (a run from a saved ROM animation
      used to miss its scene's frame-layout override while delivering that
      scene's CSV — the artifact desync the product exists to prevent);
      reference-skeleton frames follow the OPEN scene's merged walk;
      export/CSV-delivery failures land in the v2 run log's per-scene runs
      (top-level pushes were invisible to the studio's reader) and the
      catastrophic-failure log merges per scene instead of truncating; a
      cleared per-scene art direction emits an explicit null; the split
      Export_ and the groom script carry the indexSync scan.
v66 — the reference prefix anchors on `$HIP` again where it can:
      `$HIP/daz-export/…` instead of `$JOB/<houdiniSubdir>/daz-export/…`.
      Not a reversal of v63 but its consequence — v64 moved the exports
      INSIDE the houdini folder, so `$HIP` reaches them without the `..` that
      made it depth-fragile, and Houdini's own picker collapses them that way
      (measured 2026-08-10, `hou.text.collapseCommonVars`), so generated and
      hand-picked paths agree in the same node. `$HIP` is DERIVED from where
      the `.hip` sits, so unlike `$JOB` it cannot drift — a project whose
      `$JOB` points at another character still resolves its own imports.
      `$JOB` remains for what `$HIP` cannot reach without climbing out
      (`<char>/export`, and any layout whose exports sit beside rather than
      under the houdini folder) and for projects spread across FOLDERS, where
      there is no single `$HIP`. The emitted bone-scale reference-skeleton
      paths change, hence the bump. Projects generated under v63–v65 keep the
      `$JOB` form — it resolves, so it is NOT flagged; Utils → Make paths
      portable shortens it (`_shorten_job_ref`).
v67 — `DthScanFrames` gained a SILENT mode, for the studio to run it through
      the job runner instead of the user running it by hand in Daz: it
      auto-selects the figure (`dthFindGenerationFigure`, the same asset-identity
      match the ROM script uses, so a renamed node still resolves), opens no
      MessageBox, and reports through a small JSON result file. A modal in a
      batch run would block the runner on a Daz nobody is looking at, and
      without the result file every failure — no figure, no keyed frames, an
      unwritable folder — looks identical from outside: no CSV appears and a
      waiting dialog spins with nothing to say. The interactive path is
      unchanged.
v68 — the scene morph scan works in Daz Studio 4. It identified a figure's
      generation from the source asset of the NODE alone, which DS4 answers
      with nothing — so every scene scanned there was skipped with "no
      Genesis figure could be found", about the figure the same run was
      keying morphs on (measured 2026-08-10, G8.1). Two changes, either of
      which fixes it: `dthNodeAssetPath` now walks node → object → shape →
      geometry (the walk the product scan already used, which does resolve
      in DS4), and the studio's own runs pass the CHARACTER's generation as
      a fallback — `DthScanSceneMorphsQuiet(dir, scene, genesis)` from the
      generated script, `genesis` per scene in the bulk scan's sidecar.
      Detection still wins where it works; the fallback only fills a blank.
v69 — the export block clears the scene's PREVIOUS export set before running
      the exporter. Measured 2026-08-11 (DS4 exporter plugin 2.0.2, DS
      4.24): a scripted `doExport` whose output files already exist SKIPS
      the per-frame ROM walk and rewrites them as a single static frame —
      fresh mtimes, rest-pose content, no error anywhere (the Alembic
      carries the full time range with every sample identical). Deleting
      the set first forces the real walk; DS6 never had the problem, and
      clearing also stops stale files (renamed hair items' grooms, a
      changed frame layout's reference skeletons) lingering beside a fresh
      set. Only the set's own name patterns are removed — anything else in
      the folder is the user's.
v70 — auto-base is the default (schema v31), so the emitted `config.extraFrames`
      now carries `"autoBase": true` on every morph that hasn't opted out and
      the runtime resolves each morph's sawtooth floor from its own frame-0
      scene value. The `.dsa` runtime FILES are unchanged (resolveAutoBaseValues
      has honoured the flag since it was introduced) — what changed is the
      generated script's config. Bumped even though the v31 schema bump already
      marks every existing character stale: saving a character in the editor
      re-stamps its schemaVersion WITHOUT regenerating, which would otherwise
      hide a pre-v70 script on disk from the staleness check for good.
v71 — the generated scripts pause ~1 s at the automation seams: the BULK
      (Runner) ROM script settles right after the scene load, before the
      first scripted work; every export — bulk or manual — settles after
      the ROM build, before the exporter starts. `dthSettle` sleeps in
      50 ms slices WITH processEvents between them, so the pause drains
      the event loop instead of blocking it (a plain sleep would hold the
      very queue the pause exists to flush). Capability-gated: a Daz build
      missing either global proceeds immediately.
v72 — the generated carriers append their finished steps to the Runner
      v1.2.0 verbose progress log (`dthProgressLog`, baked
      `dthProgressLogPath` from app-data): "[<percent>] <scene>: <message>"
      per step, on the job row's step scale — ROM 40 / character 60 /
      CSV 80 / hair 100 in the 5-step bulk ROM+export, 50/75/100 in the
      4-step export-only, ROM 100 in the 2-step rom-only. The Runner writes
      the scene-open and terminal lines; the studio watches the file for
      the live per-scene progress display. Steps also log a START marker
      ("generating ROM", "exporting character", "delivering PoseAsset
      CSV", "exporting hair items") at the percent already reached, so the
      display can name what is running, not only what finished. A script
      without a baked path (manual/legacy) logs nothing.
v73 — INTERRUPT. A DTH Export run can be stopped from the studio, and both
      the generated carriers and the runtime stop at the next point where
      stopping leaves nothing half-written. The signal is a flag file in the
      character's `.dcsmeta` folder ({@link EXPORT_CANCEL_FILE}), baked into
      every carrier as `dthCancelPath` and handed to the runtime as
      `config.cancelPath`. Stop points: the carrier's own entry (a queued
      row skips its whole scene and logs "skipped - the export was
      interrupted"), the runtime's block boundaries (JCM/DK/GP/Physics/
      custom frames) and its frame-apply loop (throttled to one probe per
      750 ms — the flag may live on a network drive), and the gate before
      the exporter runs. An interrupted ROM returns false, so the existing
      export gate skips the export by itself; the run log carries one error
      line naming the interrupt (plus `interrupted: true`) and NO dialog is
      shown — an interrupt only ever happens in an unattended batch, where
      a modal would block every row behind it. A script generated without a
      meta folder bakes '' and can never be interrupted, exactly as before.
v74 — `preserveMorphs` / `frameZeroMorphs` rows honour an optional `node`
      (schema v32): `applyFrameZeroMorphs` applies a scoped row only on the
      node(s) matching it by internal name or label instead of on every
      carrier of the morph name, and `restorePreservedMorphs` resolves a
      scoped row's node anywhere in the figure tree (same name-or-label
      match as `applyKeyData`) instead of searching the figure root alone.
      A row without `node` behaves exactly as before (broadcast / figure
      root), so pre-v74 configs are unchanged; a scoped node that is not in
      the scene logs a Daz-log warning naming it, never a run-log failure.
      Same bump (v74 never shipped between them), two ORDER fixes in
      ApplyDTHWorkflow: `applyFrameZeroMorphs` moved to the very START of
      the build (after ApplyInitialValues, before every preset block) —
      frame-0 rows define the base state the ROM builds on, and the passes
      that READ scene state (memorizeBaseMorphs' close-out baseline,
      resolveAutoBaseValues' sawtooth floors) must see them; and
      `restorePreservedMorphs` moved to the very END (after the custom
      frames) and OUT of the JCM branch — the pass flattens each listed
      morph's animation to keepValue, and from its old spot right after the
      base preset load every later block re-keyed over it (the G8.1 Physics
      block keys the breast dials to 100%: a 60% hold showed 100%), while a
      base-less ROM never ran it at all.
v75 — Truthful failure reporting from the generated carriers, plus the ASCII
      sweep across both .dsa surfaces.
      `dthWriteFailureLog` now ALWAYS writes a log-v2 record: the v1 fallback
      it replaced carried no `scene` field, and since the studio DELETES the
      transport log when it ingests one, the common case — a second run after
      the studio had read the first — wrote its failure UNTAGGED, and the run
      report showed a problem it could attribute to no scene (measured
      2026-08-14 on a real run). The runtime-missing branch now PROBES for
      .DthWorkflow.dsa and reports what it found: missing gets the reinstall
      advice, present gets "Daz failed to load it, run the export again" —
      a failed include() logs NOTHING in Daz, so this probe is the only
      evidence such a run leaves behind. And every string the scripts write
      or display is ASCII now (bullet, em dash and the → arrow all
      became - / >): Daz's file writer cannot carry non-ASCII, so they
      reached the run log as ? and the Daz log as mojibake. The same sweep
      covers the BUNDLED RUNTIME (DthProducts.dsa, DthScanMorphs.dsa — 13
      literals, one of them a diagnostics heading written straight to a
      file), so this bump also carries a runtime-file change and its
      EXPECTED_RUNTIME_HASH update. One scanner
      (`@dth/rom`'s `nonAsciiStringLiterals`) now guards both surfaces.
v76 — the generated `Scan_Products_<Name>.dsa` carries Content Library artwork
      (`icon: 'scan-products'`), the last per-character script that had none.
      Script CONTENT is unchanged — same reasoning as v39, which introduced the
      artwork mechanism: the tiles land only on a (re)generate, and this bump is
      what makes Refresh assets do it. Its artwork also joins the removal
      sweep's `iconBearing` list, so turning Daz Products off retires the tiles
      with the script instead of leaving a tile pointing at nothing.
```

