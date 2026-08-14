# Gotchas — generation core

Part of the gotchas set — `.ai/gotchas.md` is the index. Learned by measurement or painful debugging; verify details against the current code, but assume the *lesson* still holds. New facts in this area land HERE, in the same PR that earned them.

## Generation core

- **Export outputs are never housekept by the studio.** Everything under the
  character's export directory is written Daz-side at script run time (the
  Exporter Plugin's `.abc`/`.fbx`/`Reference Skeletons/`, the script-copied
  CSV). A layout change — renaming a scene's subfolder (which renames its
  export subfolder), or the runtime-v37 always-subfolder switch itself — only
  changes where FUTURE runs land; previous outputs stay at the old spot, so
  layouts can coexist until the user cleans up. Deliberate so far: exports are
  user deliverables (large, possibly open in Houdini) — don't auto-move/delete
  them without an explicit user action.

- **Frame math returns -1, not 0, for "no preset block"** — `presetEndFrame` is
  designed so the first custom pose lands at frame 0. Clamping to 0 introduces an
  off-by-one that `generate.test.ts` guards explicitly.
- **`mirrorGroup` flips word-initial Left/Right tokens plus the four side-marker
  case twins** (`_l`/`_L` suffix, `l_`/`L_` prefix — stock Daz JCMs use `_L`, G9
  bones use `l_`). Mid-word letters must survive: `CleftChin`, `Ball_Large`,
  `Curl_lower` are all test-pinned. A new marker pattern needs BOTH cases.
- **U+2028/U+2029 are line terminators to Daz's JS engine** — every string
  embedded in a generated `.dsa` goes through `dazJson`/`commentSafe` escaping. A
  shared character definition carrying one used to break the whole script.
- **Byte-identical output tests are the contract.** Refactors of `generate.ts`
  must not change a single output byte unless the change is the point (then the
  templates/tests move with it and `RUNTIME_VERSION` is bumped).
- **zod 4's `z.number()` already rejects `Infinity`/`-Infinity`/`NaN`** (verified
  against zod 4.3.6) — do NOT add `.finite()` (dead noise); the reject posture is
  pinned by tests in `types.test.ts` instead so a zod major bump can't silently
  regress it.
- **The validated G9 template ships label-less `GENGROUP` rows** (`GENGROUP,0,0,1`;
  `FACGROUP` has no label column at all) — an empty bones label is a VALID state
  for GEN custom groups. Only JCM/PHY groups require a driver bone, and
  `romValidationErrors` enforces exactly that split.
- **Per-scene override deltas merge SET-ONLY at runtime — disabling a preset block
  for a scene leaves the base's block keys stale on the config, and only the
  runtime's `bIncludeX` gate stops them leaking.** `buildSceneConfigMap` (`dsa.ts`)
  emits a scene's config as a whitelist-DIFF; the generated `sceneConfigLookupSnippet`
  applies it with `config[k] = delta[k]` — it can SET a key, never delete one. So a
  scene that turns a base-enabled preset OFF emits `bIncludeGP:false` while the base's
  `gpArtDirection`/`gpRomPath`/`presetFrames.gp` ride through unchanged. That is only
  safe because `DthWorkflow.dsa` dispatches each block builder under its flag
  (`if(options.bIncludeGP){ ApplyGP9(…) }`) and reads the block's `gpArtDirection`/
  `gpRomPath` INSIDE that builder — a stale key is never read while its `bIncludeX` is
  false. Two rules keep it that way: keep every block-scoped read behind its
  `bIncludeX` in the runtime, and keep all five `bIncludeJCM/FAC/DK/GP/Physics` in
  `SCENE_CONFIG_DIFF_KEYS` (they carry the OFF into the delta, which neutralizes the
  stale keys). A future runtime that reads a block field WITHOUT its `bIncludeX` gate
  would silently apply the base's value to a scene that disabled that block. Pinned by
  `scene-override.test.ts` "disabling a preset GEN for a scene now emits
  bIncludeGP:false".

