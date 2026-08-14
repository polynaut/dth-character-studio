# Testing

Four layers, cheapest first. Run everything: `pnpm -r test && pnpm -r typecheck
&& pnpm lint` (lint from the repo root). CI (`validate-pull-request.yml`) runs
lint → typecheck → per-package tests → web build → `pnpm build:guide` (the
guide-site guards fail the PR), plus `smoke`, `rust` (clippy `-D warnings` +
`cargo test`) and `changeset` as separate jobs — all four are required checks.

## 1. Unit tests (vitest, per package)

- **`packages/rom`** — the heavyweight suite. `generate.test.ts` pins generated
  output **byte-identically** (template splice offsets: G9 base custom @328,
  +GP @432, +PHY @475; G8.1 @188), guards injection escaping, the top-level
  `include()` regression, the exporter↔CSV reference-frame 1:1 mapping, and a
  frame-alignment property test (CSV ↔ Daz config can never drift).
  `migrate.test.ts` has a case per schema version; `types.test.ts` pins schema
  behavior (healing, bounds, section modes); `index-sync.test.ts` pins that
  every generated ROM/export script emits `DthScanSceneMorphsQuiet` (and
  `DthScanProductsQuiet` with a DIM manifests folder set) and their ORDER relative to the
  wrong-scene guard; plus timeline/validation/daz-csv/product-scan/
  scene-override tests. **If you change generation, these tests are the spec.**
- **`apps/web`** — storage/CRUD over an in-memory fs mock, pure helpers,
  `runtime.test.ts` (hash-pins the bundled `.dsa` runtime — intentional runtime
  edits must update it), `preset-frames.test.ts` (frame-alignment invariant),
  `execute-jobs.test.ts` (the DTH Export job-file contract v2) +
  `houdini-jobs.test.ts`, `run-log-multi-scene.test.ts` (executes the shipped
  `DthUtils.dsa` `writeRunLog` under `node:vm`), `morph-index-provider.test.tsx`
  (the scene-scoped autocomplete filter),
  staleness sweep, the character-draft save/settle machinery
  (`use-character-draft.test.tsx` — extend it for any new settle semantics), a
  few component tests (jsdom + Testing Library), and FFI integration tests
  (`install.integration.test.ts`, `mockIPC`-based). The in-memory plugin-fs
  mocks require `rename` (+ `copyFile` where copies run) since the atomic-write
  helper landed; **poison sets** (`failRenameSrcs`, `unreadableDirs`) are the
  established pattern for exercising partial-failure paths (move rollback, GC
  abort).
- **`packages/ui`** — ~10 suites: TooltipHost, MultiSelect (full keyboard
  model), NumberField, the overlay semantics (Modal / SidePanel / InfoPopup),
  KeyedListEditor, EditableTitle, useStickyHeaderInset.

Single file: `pnpm --filter @dth/rom test src/daz-csv.test.ts`; by name:
`pnpm --filter @dth/rom test -t "<name>"`.

## 2. FFI contract tests (both sides of the wire)

Shared fixtures in **`contracts/`** (repo root) are the canonical wire format of
every structured Rust return:

- Rust half: `apps/desktop/src/contract_tests.rs` — serde round-trip, byte-identical.
- TS half: `apps/web/src/lib/rom/api/native-contract.test.ts` — zod parse of the
  same bytes, `parse(wire)` must deep-equal `wire`.

A new structured return = fixture + schema + a case on both sides. `cargo test`
also runs ~77 Rust module unit tests (zip-bomb bounds, content detection, dedup
quarantine, delete rails, `.duf` parsing, the junction-leftover sweep's
reparse-point rails, window-lock
ordering).

## 3. Playwright smoke (`pnpm --filter @dth/web smoke`)

The **real SPA in a real browser** against an in-memory fake of the native layer
— no Tauri build needed:

- `apps/web/smoke/tauri-mock.ts` — `installTauriMock(seed)`, serialized into the
  page via `addInitScript` (must stay self-contained). Fakes `isTauri` +
  `__TAURI_INTERNALS__.invoke`: plugin-fs contract over a `Map`, dialogs,
  events, and the app's own Rust commands. **Unknown commands are recorded AND
  rejected**; specs assert `unhandled == []` — the mock can't silently drift.
- **A feature that adds Rust commands ships smoke-BLIND until this mock learns
  them.** The unhandled-command guard only fires inside a flow some spec
  already drives — commands no spec reaches trip nothing, and a spec for the
  new flow can't be written until the mock knows them, so nothing fails
  anywhere. "Export too" (#637) shipped exactly that way: its commands
  (`launch_houdini_job`, `houdini_running`, `launch_daz_studio`) reached the
  mock only in #641 with the feature's first end-to-end spec — which
  immediately found the scene-key lookup bug that had made the feature a no-op
  on every real path. Teaching the mock the new commands (and writing the spec
  that drives them) is part of the feature PR, not a later test PR.
- **The mock answers instantly, so any UI state that exists only DURING an async
  op is untestable until the fake can hold that op open.** A spinner, a
  disabled-while-running control, a progress line: against an instant fake the
  window they live in opens and closes inside one frame and no spec can ever
  observe it — so the spec quietly asserts the finished state and the feature
  ships unpinned. The fix is a per-op delay knob on the seed, not a `waitFor` in
  the spec. `materialScanDelayMs` (#816) is the pattern: documented on
  `TauriMockSeed`, applied to the `scan` op only, and it is what makes "exactly
  one card spins, and the cached one does not" assertable without timing
  anything. A feature whose whole point is what the UI does while something runs
  needs one of these before it needs a spec.
- `apps/web/smoke/fixtures.ts` — `buildSeed(opts)` builds the world (project
  "Demo", character "Kira", DTH release tree). The character goes through the
  **real `characterSchema`**, so schema bumps fail here loudly.
- `smoke/*.smoke.ts` — 33 spec files / ~100 tests. The core families: `studio.smoke.ts`
  (one test per window kind), `override.smoke.ts` (the per-scene ROM override
  flow end to end), `houdini-export.smoke.ts` / `houdini-only.smoke.ts` /
  `export-only-gate.smoke.ts` (the DTH Export modes), and
  `project-scan.smoke.ts` (the Tools scan batch; absorbed the deleted
  `genesis-index.smoke.ts` in #657). Specs assert through the whole
  api→storage stack by reading back `__tauriMock.files`/`calls`.
- **The CI smoke wall time is CPU-bound — measured, not assumed.** Two runs on
  2026-08-10: 99 tests at Playwright's default 2 workers = 4.0m
  (run 31429667874); 105 tests at the pinned 4 workers = 3.9m (run
  31430433321). ~8% per test from doubling workers, because Chromium + the
  Vite dev server's on-the-fly transforms saturate the public runner's 4 vCPU
  at 2 workers already (a many-core dev machine does the suite in ~50s on raw
  CPU). **The 4-worker pin was reverted a day later (#790):** oversubscribing
  the saturated box bought ~0.1 min and paid in starvation flakes — six
  different houdini-* specs across five PR runs failed as timeouts on
  interactions that are instant locally, a different spec each run, one past
  a doubled 60 s budget; main stayed green only by scheduling luck. CI runs 2
  workers + a 60 s per-test budget now (`retries: 0` stayed here — a retry
  would hide exactly this class of nondeterminism; **reversed to `retries: 1`
  on CI once the class was understood, see the retry bullet below**).
  Consequences: adding workers on
  the 4-vCPU runner is a net loss; trimming specs WOULD
  cut wall time (it is linear when CPU-bound) but trades real coverage for
  ~2 minutes on an unwatched gate.
  Two related facts that keep coming up: the docs suites
  (`guide.screenshots.ts`, clips) are NOT in CI — `testMatch: /.*\.smoke\.ts/`
  excludes them; they run only via `pnpm screenshots` / `pnpm clips` under
  their own configs. And worker counts well past 4 are proven daily by local
  runs: tests share nothing but the stateless Vite server (every page
  installs its own in-memory fake), so per-file parallelism is safe.
- **CI serves a PREBUILT BUNDLE, and that is the answer to the starvation
  flakes.** Of the two levers named above, this is the one that was pulled
  (2026-08-13): `webServer.command` is `vite build && vite preview` under CI
  (`PREBUILT` in `playwright.config.ts`; `SMOKE_PREBUILT=1`/`=0` forces it
  either way locally, so the CI arrangement is reproducible). The reasoning is
  the measurement above read the other way round: if Chromium + *dev-mode
  transforms* saturate the box, the fix is not fewer browsers but a server that
  does no transforming. A build costs ~8 s ONCE, up front; `vite preview` then
  serves static files for essentially nothing while the specs run, so the cores
  go to the assertions. MEASURED on an 8-core dev box forced to CI's settings
  (`CI=1`), 144 specs, two samples each: dev 2.3m/2.3m → prebuilt 1.6m/1.7m,
  ~28% off wall time on a machine that is not even starved, 144 green both
  times. The evidence it was needed: 6 of 8 PR-validation failures in the ~42 h
  to 2026-08-13 were smoke, each a DIFFERENT spec (`jcm-bone-autocomplete`,
  `houdini-utils-backups` ×2, `houdini-occlusion-tabs`, `unlink-dialogs`,
  `houdini-refresh-assets`), every one green on rerun — contention picking a
  loser, not six broken tests.
  Two caveats worth keeping: the bundle is a PRODUCTION build, so
  `import.meta.env.DEV` is FALSE in CI — anything a spec needs must not sit
  behind that flag (`__dthToast` is read by nothing, `__dthHideDevtools` guards
  devtools a prod build never renders). **The `updater.ts` line in that original
  audit was wrong and is worth knowing about**: it does NOT early-return here.
  Its guard is `!isTauri() || import.meta.env.DEV`, the mock sets
  `isTauri = true`, and a prod build makes DEV false — so both halves are false
  and `checkForUpdates()` (awaited unconditionally in `main.tsx` at startup)
  really runs on every prebuilt page. It is harmless only because the mock
  ANSWERS `plugin:updater|check` with "up to date", so the flow returns quietly
  (verified 2026-08-13 by probing a prebuilt page: `unhandled == []`, no
  `[updater]` log). That mock case is therefore load-bearing under CI —
  deleting it as unused would fail every `unhandled == []` assertion, in CI
  only. The general lesson: under the prebuilt bundle, a DEV-gated path that
  "obviously no-ops" may be running for real, and the smoke mock is what
  absorbs it. **Whether this ends the flakes was left open — "watch the next
  handful of PR runs before calling it closed". ANSWERED 2026-08-13, same day,
  and the answer is NO.** PR #827's validation ran the prebuilt suite twice
  within half an hour and failed both times, on a DIFFERENT spec each time —
  `unlink-dialogs.smoke.ts:96`, then `scan-scene-import.smoke.ts:80` — both
  `locator.click: Test timeout of 60000ms exceeded`, i.e. the same starvation
  signature the bundle was pulled to remove, and `unlink-dialogs` was already
  on the victim list above. The same commit passes **155/155 against the same
  production bundle** on an 8-core dev box (`SMOKE_PREBUILT=1`, `SMOKE_PORT`
  set) in 49s, against CI's 3.4m — so the code is not the variable, the box is.
  The honest reading of the measurement: the build removes ~28% of the wall
  clock without removing the CONTENTION. Two Chromium workers saturate a 4-vCPU
  runner on their own; `vite dev`'s transforms were only ever part of what
  filled it, so taking them out moved the suite further from the cliff without
  stepping back off it. Sharding across runners is therefore no longer the
  merely-untaken lever — it is the only one left, and still the maintainer's
  call because it changes the required check's shape.
  Until then, read a CI smoke failure exactly as before: a different spec each
  run, instant locally, green on rerun. **Do not "fix" the spec it lands on.**
  Two reruns cost minutes; a day spent debugging a healthy test costs a day,
  and this one nearly took one — the first failure was read as a real break
  introduced by the PR, and only the SECOND failure landing on an unrelated
  spec proved otherwise. One rerun before any diagnosis is the cheap move.
- **`retries: 1` on CI — and a retry is not a skip.** With the flake class
  measured rather than mysterious, the manual rerun above is a human doing by
  hand what Playwright does in seconds, so CI retries once (locally still 0 — a
  dev box is not starved, and a retry there really would hide something).
  The distinction that makes this the right instrument, and the reason the
  obvious alternative is wrong: **a starved test passes on attempt two; a
  genuinely broken one fails BOTH and the check still goes red.** Skipping the
  spec that failed — what a red gate tempts you into — deletes real coverage AND
  does not work, because the flake is not a property of any spec. Contention
  picks a different loser every run (seven named victims so far), so skipping
  them one at a time ends with the suite gone and the gate still red.
  Playwright reports `flaky` separately from `passed`, so the rate stays
  VISIBLE — that number is the health signal now. If it climbs, the box is the
  problem again and sharding is the next lever.
  **A retry silently changes what "failure" means to everything downstream.**
  A flaky run exits **0**: the job is green, and every `if: failure()` step in
  the workflow is skipped. That is why the trace upload runs on `!cancelled()`
  instead — measured 2026-08-14, a flaky run exits 0 and still leaves
  `test-results/…/trace.zip` on disk, while a clean run leaves no trace files
  at all, so uploading unconditionally costs a green run nothing and is the
  ONLY way the starved attempt's evidence survives. Side effect worth having:
  a `playwright-traces-*` artifact on a GREEN run is now the visible mark that
  a retry was spent, which beats a number in a log nobody opens. Anything else
  added later that should react to a smoke failure has the same trap —
  `failure()` will not fire for the class this suite actually suffers from.
- **The starvation explanation did NOT survive its first direct test — don't
  treat it as settled.** Attempted 2026-08-13 on a 16-core Windows box under
  CI's own settings (`CI=1` → 2 workers, 60 s budget, prebuilt bundle;
  `SMOKE_PORT` set), with the CPU deliberately oversubscribed by spinner
  processes:

  | Condition | Result |
  |---|---|
  | idle | 155/155, 1.6m |
  | 12 spinners / 16 cores | 155/155, 1.7m |
  | ~36 spinners / 16 cores (2.2x oversubscribed) | 155/155, **2.8m** |
  | the overlay-heavy victims, `--repeat-each=6`, under load | 48/48 |

  Contention worse than CI's own ratio made the suite **75% slower across the
  board and broke nothing**. That is the shape starvation actually has: every
  test gets proportionally slower. The CI failure is not that shape — a
  `locator.click` dying at 60 s is a ~45x outlier against a 1.3s average, i.e.
  a STALL, something waiting forever until the budget expires. Uniform slowdown
  does not produce one.
  **What the test did NOT replicate, and why a local repro may be impossible:**
  CI is `ubuntu-latest` with 4 slow vCPUs; this was Windows with 16 fast cores
  oversubscribed. Oversubscription is not SCARCITY — 2 Chromium workers on 4
  cores have no headroom at all, where 16 cores always have some — and it is a
  different Chromium build, kernel scheduler and filesystem. So this weakens the
  theory without refuting it.
  **The consequence for whoever picks this up: stop reasoning and read the
  trace.** Playwright's actionability log records what it was waiting for and
  what was on top of the target at each retry, which separates "the box was
  busy" from "an overlay covered the button" in one look. The traces exist on
  every failure (`trace: 'retain-on-failure'`) and were being deleted with the
  runner until the upload step in `validate-pull-request.yml`. The next CI
  flake is the first one that will be diagnosable rather than inferable — and
  under `retries: 1` it will arrive on a GREEN run, as an artifact rather than
  as a red check (see the retry bullet).
  One pattern to check first when it lands: the victim list is **entirely**
  OVERLAY-driven specs — `unlink-dialogs`, `houdini-occlusion-tabs`,
  `houdini-utils-backups` x2, `houdini-refresh-assets`, `scan-scene-import`,
  `jcm-bone-autocomplete`, `houdini-project-health` (the last two added
  2026-08-13, the drawer spec observed live) — **eight failures across seven
  distinct specs**, not one of which lacks a dialog or a drawer.
  **And the mechanism was then found and fixed.** `closeAllInfoPopups` only ever
  registered popups that were ALREADY open, so a hover peek on its 90ms
  `useHover` open-delay was invisible to the sweep: it fired after the overlay
  mounted and painted at `z-[60]`, over the dialog's z-50. A tooltip there is
  harmless (`pointer-events-none`, hit-testing skips it) but an InfoPopup is
  INTERACTIVE — it swallows clicks aimed at whatever is underneath, which is
  exactly a click that never becomes actionable. Fixed in `info-popup.tsx` with
  a fail-then-pass unit test.
  **That is a matching signature, NOT yet a proven cause.** What would prove it
  is one trace naming an InfoPopup portal as the element on top. Until then the
  honest statement is: a real defect with this fingerprint existed and is gone;
  whether it was THE flake is unconfirmed.
  **Practical trap worth knowing: the trace upload only exists on the branch
  that adds it.** A `pull_request` run uses the workflow from the MERGE ref, so
  every other open PR still discards its traces — #830 flaked twice and produced
  no artifact for exactly that reason. The instrument has to land on `main`
  before it can catch anything anywhere else.
- **Do NOT run the whole smoke suite for every edit — CI is its gate.** Locally,
  run the specs covering what you changed (`pnpm --filter @dth/web smoke
  houdini-export` filters by filename substring). The full run is for CI, for a
  change to a shared primitive whose blast radius really is the whole app
  (`packages/ui` primitives, the app shell, the tauri mock), or as ONE pass
  before opening a PR — not as a reflex after each edit. The suite grew 7 → 42
  spec files in three weeks, it runs on the maintainer's own machine, and an
  agent rerunning all of it per change burns his wall clock for a signal CI
  already provides.
- **A local smoke result can be a LIE if another checkout holds the port.**
  `reuseExistingServer` is true off CI, so if a second clone/worktree of this
  repo has a smoke server on 4331, your run attaches to **its** bundle and
  reports pass/fail for code you never wrote. `--strictPort` does not save you:
  it only refuses a second server from STARTING, and reuse starts nothing.
  Measured 2026-08-13 — a review "proved" main was red across three runs, all
  three serving a sibling checkout's tree. Set `SMOKE_PORT=<free port>` when two
  checkouts are live, and treat a surprising local smoke result as a port
  question before a code question — surprising PASS included, which is the
  direction that gets trusted. The default is the `PORT` constant in
  `apps/web/playwright.config.ts`.
- **This layer is where browser-only bugs reproduce.** A window-freezing React
  render loop passed every jsdom test and only showed here — when a UI
  interaction "works in tests" but misbehaves in the app, write the repro as a
  smoke spec first (a hung `locator.click` + a stack sample via CDP
  `Debugger.pause` localizes it fast).
- **Locate by ROLE, not `getByTitle`** — the ui kit's TooltipHost rewrites a
  hovered control's `title` into `data-tooltip`/`aria-label`, so title locators
  stop matching controls the test already touched (see `.ai/gotchas.md`).
- **Read a CI-only failure as a BUDGET failure before a code failure.** The
  suite runs at Playwright's default 30s *per test*, and that budget covers the
  `goto` + navigation too — so a loaded runner surfaces as "Test timeout of
  30000ms exceeded" parked on a locator that resolves instantly everywhere else.
  Measured (#762, the copy-project move spec): the failing test burned 30.2s
  while its five siblings in the same file took 1.2–3.2s, the same commit was
  green on `main` two minutes earlier, and every spec passed locally. Check
  those three things before touching the app code; the wall-clock of the
  neighbours is the tell.
- **The fake answers instantly, so a LATENCY bug passes by default.** The mock
  serves `invoke` from an in-memory map in well under a frame, which means any
  bug whose cause is "the real IPC round trip is slower than the first paint"
  simply does not reproduce: the project-window Home flash (see `.ai/gotchas.md`)
  was invisible here until the spec wrapped the mock's own `invoke` to make
  `active_project_file` take 300ms — the delay a real window pays. Wrap it in a
  THIRD init script added after `installTauriMock` (they run in order), and say
  in a comment which real cost the number stands for.
  `apps/web/smoke/project-window-boot.smoke.ts` is the pattern.
- **An init script runs at `document_start`, where `document.documentElement`
  is still null** — `new MutationObserver(…).observe(document.documentElement)`
  throws there and the watcher dies SILENTLY, leaving its flag at the initial
  value forever. Measured while writing the boot spec above: the "did Home ever
  render?" flag read `false` even for a window that plainly rendered Home. Poll
  from the first tick and attach the observer on `DOMContentLoaded` — and prove
  the detector by asserting it TRIPS in the case where it should, or a
  never-firing guard passes for the wrong reason.
- **A destructive guarantee does not belong ONLY here.** When a flaky spec has
  to go, first ask what it was the only guard for. The move variant of the
  copy-project dialog (permanently deleting the user's own `.hip`) was pinned
  by nothing else, so it moved DOWN a layer to
  `src/lib/rom/houdini-copy-project.test.ts` — same guarantee, 3ms, no browser.
  What genuinely does not survive the move is the UI wiring (switch → state →
  api call); say so in the spec file rather than letting the deletion read as
  "covered elsewhere".

## 4. Guide screenshots (`pnpm screenshots` from the repo root)

`smoke/guide.screenshots.ts` + `playwright.screenshots.config.ts` (own dev
server :4332, 1280×720 @2x, dark, `locale`/`timezoneId` pinned). Reuses the
smoke mock/fixtures, navigates to each documented screen/state, and **writes
the PNGs the guide embeds** to `docs/guide/screenshots/` — the guide's images
are generated, not hand-shot. **The full runbook lives in the header comment of
`guide.screenshots.ts` — read it before touching shots.** The short version:

- **One command regenerates everything:** `pnpm screenshots`. Output is
  **deterministic across runs AND machines**: `prime()` freezes the in-page
  clock (`page.clock.setFixedTime` — covers the mock's file mtimes and every
  rendered date), the config pins locale + timezone, fonts are self-hosted.
  Contract: a second full run must leave `git diff` empty — if it doesn't, a
  new nondeterminism crept in; fix it at the source, never hand-revert PNGs.
- **The suite verifies its own completeness:** the final `coverage` test fails
  when a guide page references a PNG nothing generated, or a PNG in
  `screenshots/` is referenced by no guide page (orphans in either direction).
- **After a full restyle:** run it once, review the diff visually (every PNG
  changing is expected), commit the lot. There are NO hand-tuned crop
  constants: `shoot`/`shootStrip` drop the app's sticky chrome, scroll the
  feature to the top and clip tight to it, so a changed header/section-title
  height can't tuck a feature under the chrome. Only the constant app width
  (`VW = 1280`) is fixed.
- **Not covered:** the guide's Daz-/Houdini-side photos (the
  `user-attachments` CDN links in `docs/guide/*.md`) are manual captures inside
  Daz/Houdini — an app restyle doesn't affect them.
- Navigate by clicking header links, not `page.goto` (a goto re-runs `main.tsx`
  startup navigation).
- **Interaction clips** (`pnpm clips` → `docs/guide/clips/*.webp`, currently
  just `path-chip-copy.webp`) are the moving siblings: `smoke/guide.clips.ts`
  scripts each interaction as a FIXED frame sequence — a fake cursor overlay
  glides between UI states (headless Chromium draws no OS pointer), every
  frame is a screenshot, `sharp` (libwebp) encodes them into a lossless
  animated WebP (no video capture, no ffmpeg). Same fixtures/frozen clock;
  transitions are pinned to 0ms while recording; the screenshot suite's
  coverage test guards clips/ ↔ guide references too. Machinery:
  `smoke/webp-recorder.ts`; own config `playwright.clips.config.ts` (port
  4333, @1x — lossless WebP needs no 2x raster).

## 5. Full-codebase audits (measured method, 2026-07)

Four audit rounds ran across two days (PRs #435, #438, #441, #445); the yield
curve and the method are worth more than re-deriving them:

- **Yield converges per AREA, not per round**: 55 -> 58 -> 29 -> 10 findings,
  but the middle bump was a deliberate re-slice into never-audited surface
  (settings/notes/housekeeping/CI). Where coverage repeated, decay was steep
  (rom core: 5 -> 2 lows). Once every area has been swept twice, another full
  sweep re-reads verified-clean code - switch to per-PR review.
- **Diff-audit every large fix wave**: each ~2,000-line fix round introduced
  its own findings (29 on round three's diff, 10 on round four's), including
  2 highs CAUGHT BEFORE MERGE (a lock/canonicalize UI freeze; a version marker
  that neutered the forced runtime repair). A fix commit is new code with a
  defect rate - grill it like any other code, scoped to `git diff <fix>^ <fix>`.
- **Audit agents need**: verified-findings-only (read the code paths, no
  speculation), per-finding severity/file:line/failure-scenario/minimal-fix,
  explicit "clean" statements for what they checked, and cross-fix interaction
  questions when auditing parallel-written code. Fix agents need STRICTLY
  disjoint file ownership and targeted-tests-only (repo-wide gates run once at
  the end by the coordinator).
- **Fail-then-pass is the bar for regression tests**: temporarily re-introduce
  the bug, watch the new test fail, restore the fix. Several "pinning" tests
  written without this turned out to mask the exact bug they claimed to pin
  (the info-popup :focus-visible stub, the same-parent tie-break fixtures).
- **The local gate that matches CI**: `pnpm -r typecheck` + `pnpm lint` +
  `pnpm -r test` + `cargo clippy --locked --all-targets -- -D warnings` +
  `cargo test --locked` + `pnpm --filter @dth/web smoke`. No cargo fmt (see
  gotchas). Findings land as fixes + tests + a changeset + .ai learnings in
  ONE PR per round.
