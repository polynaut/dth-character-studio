# Gotchas — Releases

Part of the gotchas set — `.ai/gotchas.md` is the index. Learned by measurement or painful debugging; verify details against the current code, but assume the *lesson* still holds. New facts in this area land HERE, in the same PR that earned them.

## Releases

- **GitHub releases are immutable** (since v0.44.7): a published release and its
  `latest.json` cannot be edited afterward. Never hand-publish without being sure
  `latest.json` is right — a broken one can't be fixed in place.
- **The version PR's checks sat `action_required` until manually approved — and
  bulk-approving stale runs cancels the current head's run** (measured
  2026-08-03, the v0.61 train). Two separate mechanisms. The first is resolved:
  a `github-actions[bot]`-pushed head trips the public-repo
  first-time-contributor approval gate on each refresh, and under
  changesets/action v1 the branch push used the checkout's persisted
  credentials while the PAT only reached the PR API — the why and the current
  v2 token plumbing live as comments in `version.yml` (the PAT now feeds the
  `github-token` input, which v2 uses for the API-side branch push too). The
  second is still live: ALL of a PR's validation runs share one
  concurrency group (`validate-refs/pull/<n>/merge`, cancel-in-progress), so
  approving/re-running several held runs in one sweep lets the LAST click
  cancel the in-flight ones — the survivor can green-light a STALE head while
  the current head keeps red "cancelled" required checks. Only ever approve or
  re-run the NEWEST run; for a cancelled current head,
  `gh run rerun <run-id> --failed` re-runs just the killed jobs.
- **`github-actions[bot]` cannot create releases on this repo** (403 "Resource
  not accessible by integration" despite `contents: write`). The publish job runs
  on the `RELEASE_PAT` secret — if publishing ever 403s/401s again, **check the
  PAT's expiry first** before diagnosing anything else. See `.ai/release.md`.
- **`beforeBuildCommand` runs with CWD = `apps/desktop`** (the tauri config
  dir), not the repo root — a ROOT package.json script must be invoked as
  `pnpm -w <script>` or pnpm resolves it recursively and fails with
  "Command not found" (broke the v0.51.0 release build; the PR-CI rust job
  never runs the hook, so only a real release surfaces it).
- **`process.exit()` in a Node script that used `fetch` can crash on Windows**
  (Node 24 libuv assertion `!(handle->flags & UV_HANDLE_CLOSING)`, exit
  0xC0000409) — undici's handles are still winding down. Let the script end
  naturally instead (measured in scripts/fetch-runner.mjs's skip path).
- **tauri-build hard-fails on a `bundle.resources` glob that matches nothing**
  — a gitignored, build-time-staged resource dir needs a build.rs seed (see
  the dth-runner placeholder in apps/desktop/build.rs) or plain
  `cargo check`/`clippy` breaks on fresh clones and CI.
- **`/\/+$/` (and `/[\/]+$/`, `/[. ]+$/`) is a HIGH-severity CodeQL alert** —
  `js/polynomial-redos`. A `+` immediately before `$` makes the engine retry
  every split of the repetition against the anchor, so a string of many
  separators costs quadratic time; these run on stored project/character paths
  and user-typed names, which is what makes it an alert rather than a curiosity.
  It blocked a PR (#645) after being introduced, fixed, and then **reintroduced**
  — the regex form is simply what everyone reaches for. There is now ONE home
  for the linear versions: **`apps/web/src/lib/path-trim.ts`**
  (`stripTrailingSeparators` / `trimSeparators` / `stripTrailingDotsAndSpaces`)
  plus `stripTrailingSlashes` in `packages/rom/src/dsa.ts` for the pure core.
  `path-trim.ts` is deliberately a LEAF (imports nothing) because `lib/path.ts`
  imports the storage layer — homing the trims there is an `import/no-cycle`
  error the moment `storage/fs.ts` needs one. Note CodeQL gates only NEW alerts
  on a PR, so the old occurrences sat unflagged for a long time; the local gate
  (`lint`/`typecheck`/`test`/`smoke`) does not run CodeQL, so an alert like this
  first shows up on the PR.
  **The shape is `+` (or `*`) immediately before `$`, whatever the character
  class** — it is not a *path* problem, and reaching for `path-trim.ts` only
  when the string is a path misses it. Caught a third time in review on
  `/^_+|_+$/` trimming an Unreal project NAME (`unrealProjectNameFrom`,
  `lib/unreal-install.ts` — removed with the Generate Unreal project feature);
  that one became a `while (s.endsWith('_'))` loop.
  A *global, unanchored* replace (`/_+/g`, `/[^A-Za-z0-9_]+/g`) is fine — every
  match consumes, so there is nothing to backtrack.
- **Unreal decides a plugin fits by `BuildId` EQUALITY, not by any version
  label.** Measured 2026-08-12. The engine carries one in
  `Engine/Binaries/Win64/UnrealEditor.modules`, every built plugin in
  `Binaries/Win64/UnrealEditor.modules`, and *"The following modules are missing
  or built with a different engine version"* IS that comparison failing. A
  folder name (`Unreal Engine 5.7 Plugin`), a path segment, a `.uplugin`'s
  `EngineVersion` — all labels, and a folder like
  `KawaiiPhysics_5_7_1_v1.19.1` writes its version with underscores, so it
  parses as *no version at all* and matches every project including one it
  cannot load in. `pluginBuildMismatch` (`lib/unreal-install.ts`) is the check;
  either side reading `''` means "cannot tell" and must NEVER render as a
  mismatch — a false alarm costs the user a plugin that would have worked.
  **And the BuildId must PICK, not only warn.** `matchPluginsToEngine` offers
  ONE build per plugin name (the install target is `Plugins/<name>`), and its
  tie-break knew labels only — so with `KawaiiPhysics_5_7_1_…` and
  `KawaiiPhysics_5_8_…` side by side, both reading as `any engine`, the
  alphabetically first was offered to a 5.8 project, marked unloadable, and the
  build that WOULD have loaded was dropped from the list entirely. `buildRank`
  now orders them: proven match > exact version label > any-engine > proven
  mismatch. Ranking is NOT filtering — a lone mismatching build is still listed
  and marked, because an empty checklist explains nothing.
- **A vendor's zip name carries TWO versions, and the plugin's own can win.**
  Reported 2026-08-13: `KawaiiPhysics_5.7_1.21.0.zip` and
  `KawaiiPhysics_5.8_1.21.0.zip` in one folder both listed as **UE 1.21** — the
  engine is named first, the plugin's version last, and `ue_version_in` took the
  LAST bare `major.minor` ("versions suffix names"). So each build claimed an
  engine that has never existed, and the two claimed the SAME one, which is what
  made it visible: two identical rows for two different builds. The fix is not a
  position rule (first-wins loses to `Tool_1.21.0_5.7`) but a plausibility one —
  an engine major is `4..=9`, so anything outside that is skipped wherever it
  sits (`plausible_engine_major`, unreal_install.rs). Same rule on the
  `.uplugin`'s `EngineVersion` field: an impossible version becomes NO
  constraint (offered for every engine), never a constraint no project can
  satisfy. **The two bounds are not equally certain, and the asymmetry is the
  whole argument for the ceiling.** The floor is a fact (`.uplugin` starts at
  UE4); the ceiling is a judgement, taken because matching is by EQUALITY — a
  build labelled `2024.1` (a year version, a `Houdini_20.5` folder) fits no
  project and vanishes from every checklist SILENTLY, while disbelieving a real
  UE10 someday only makes it read as `any engine`, offered everywhere, with the
  BuildId check still marking it. Prefer the bound that fails loudly. Note how
  thin the label evidence is throughout — the BuildIds of these two zips
  (47537391 / 55116800) matched 5.7 and 5.8 exactly, so the binaries knew all
  along what the name got wrong.
- **A path-keyed cache is orphaned by a RENAME, and every reader then answers
  "never scanned".** Measured 2026-08-13, right after editable project names
  shipped: renaming a `.hip` left its scan entry under the old path, so the DTH
  Export panel stopped pre-selecting Unreal projects — it no longer knew which
  export sets those projects write — and the only cure was a Rescan the user had
  no reason to suspect. `renameScanEntry` (houdini-project-cache.ts) moves the
  entry: map key, the freshness key's first segment, and the project's own
  `hipPath`. Re-keying is honest ONLY because a rename touches neither mtime nor
  contents, so every other part of the verdict is still true — re-dating an
  entry would not be. The lesson generalises past this cache: anything keyed by
  path needs a hand-off wherever the studio itself moves a file.
- **`HKLM\SOFTWARE\EpicGames\Unreal Engine` can be MISSING an installed
  engine.** Measured 2026-08-12: a machine with 5.6, 5.7 and 5.8 installed had
  no 5.8 key, so the studio never offered it, a project was generated for 5.7,
  and 5.8 opened and rebound it — every 5.7-built plugin then unloadable.
  Second source: `%PROGRAMDATA%\Epic\UnrealEngineLauncher\LauncherInstalled.dat`
  (`merge_engine_installs`, unreal_install.rs). Two traps in it: only
  `UE_<major.minor>` entries are ENGINES — `QuixelBridge_5.8`, `FabPlugin_5.7`
  and friends are plugins installed INTO one and carry the same
  `InstallLocation`, so an unfiltered read offers the same engine several times;
  and the registry is preferred per version but must YIELD when its folder is
  gone, since "present but pointing nowhere" is the same staleness (an
  uninstalled 4.0 keeping its key is measured on this repo's own dev machine).
- **A mapper that names its fields silently drops the next one added.**
  `buildUnrealScan` rebuilt each engine field by field, so `buildId` — read in
  Rust, parsed by the zod schema, typed all the way down — never reached the
  dialog, and the whole plugin-build check answered "cannot tell" in the real
  app while every test passed. Nothing covered it because the dialog tests mock
  `detectUnrealEngines` and the pure tests call the matcher directly. Two
  lessons: **spread in a mapper** whose input is a wire type, and when a feature
  reads a NEW native field, cover the schema→transform→consumer path once, not
  just the leaf function.
- **An NTFS junction stores an ABSOLUTE target — anything that moves the
  target leaves the junction pointing at the old path**, silently (Windows
  happily keeps a dangling reparse point, and re-creating the old folder makes
  writes land in a resurrected tree instead of erroring). This is why the
  retired junction feature (pre-v0.63) had to refresh its links on EVERY
  generation, and one more reason the links are gone — a relative
  `$HIP/../…` path has no stored target to go stale; the same generation
  funnel now runs the leftover sweep instead (`sweepExportJunctions`,
  api/houdini.ts). The corollary OUTLIVES the feature, for DERIVED path
  fields: being re-derived on save does not
  exempt a field from `repointCharacterPaths` — `moveCharactersRoot` rewrites
  each moved definition directly (no `saveCharacter`, no re-derive), and
  `exportPath` staying stale until "some later save" was enough for a
  same-batch regenerate to aim reference paths at the old location (#647).

