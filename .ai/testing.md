# Testing

Four layers, cheapest first. Run everything: `pnpm -r test && pnpm -r typecheck
&& pnpm lint` (lint from the repo root). CI (`validate-pull-request.yml`) runs
lint → typecheck → per-package tests → web build, plus `smoke` and `rust`
(clippy `-D warnings` + `cargo test`) as separate jobs.

## 1. Unit tests (vitest, per package)

- **`packages/rom`** — the heavyweight suite. `generate.test.ts` pins generated
  output **byte-identically** (template splice offsets: G9 base custom @328,
  +GP @432, +PHY @475; G8.1 @188), guards injection escaping, the top-level
  `include()` regression, the exporter↔CSV reference-frame 1:1 mapping, and a
  frame-alignment property test (CSV ↔ Daz config can never drift).
  `migrate.test.ts` has a case per schema version; `types.test.ts` pins schema
  behavior (healing, bounds, section modes); plus timeline/validation/daz-csv/
  product-scan tests. **If you change generation, these tests are the spec.**
- **`apps/web`** — storage/CRUD over an in-memory fs mock, pure helpers,
  `runtime.test.ts` (hash-pins the bundled `.dsa` runtime — intentional runtime
  edits must update it), `preset-frames.test.ts` (frame-alignment invariant),
  staleness sweep, the character-draft save/settle machinery
  (`use-character-draft.test.tsx` — extend it for any new settle semantics), a
  few component tests (jsdom + Testing Library), and FFI integration tests
  (`install.integration.test.ts`, `mockIPC`-based). The in-memory plugin-fs
  mocks require `rename` (+ `copyFile` where copies run) since the atomic-write
  helper landed; **poison sets** (`failRenameSrcs`, `unreadableDirs`) are the
  established pattern for exercising partial-failure paths (move rollback, GC
  abort).
- **`packages/ui`** — TooltipHost, MultiSelect (full keyboard model),
  NumberField.

Single file: `pnpm --filter @dth/rom test src/daz-csv.test.ts`; by name:
`pnpm --filter @dth/rom test -t "<name>"`.

## 2. FFI contract tests (both sides of the wire)

Shared fixtures in **`contracts/`** (repo root) are the canonical wire format of
every structured Rust return:

- Rust half: `apps/desktop/src/contract_tests.rs` — serde round-trip, byte-identical.
- TS half: `apps/web/src/lib/rom/api/native-contract.test.ts` — zod parse of the
  same bytes, `parse(wire)` must deep-equal `wire`.

A new structured return = fixture + schema + a case on both sides. `cargo test`
also runs ~50 Rust module unit tests (zip-bomb bounds, content detection, dedup
quarantine, delete rails, `.duf` parsing).

## 3. Playwright smoke (`pnpm --filter @dth/web smoke`)

The **real SPA in a real browser** against an in-memory fake of the native layer
— no Tauri build needed:

- `apps/web/smoke/tauri-mock.ts` — `installTauriMock(seed)`, serialized into the
  page via `addInitScript` (must stay self-contained). Fakes `isTauri` +
  `__TAURI_INTERNALS__.invoke`: plugin-fs contract over a `Map`, dialogs,
  events, and the app's own Rust commands. **Unknown commands are recorded AND
  rejected**; specs assert `unhandled == []` — the mock can't silently drift.
- `apps/web/smoke/fixtures.ts` — `buildSeed(opts)` builds the world (project
  "Demo", character "Kira", DTH release tree). The character goes through the
  **real `characterSchema`**, so schema bumps fail here loudly.
- `smoke/*.smoke.ts` — `studio.smoke.ts` (one test per window kind) +
  `override.smoke.ts` (the per-scene ROM override flow end to end); both assert
  through the whole api→storage stack by reading back
  `__tauriMock.files`/`calls`.
- **This layer is where browser-only bugs reproduce.** A window-freezing React
  render loop passed every jsdom test and only showed here — when a UI
  interaction "works in tests" but misbehaves in the app, write the repro as a
  smoke spec first (a hung `locator.click` + a stack sample via CDP
  `Debugger.pause` localizes it fast).
- **Locate by ROLE, not `getByTitle`** — the ui kit's TooltipHost rewrites a
  hovered control's `title` into `data-tooltip`/`aria-label`, so title locators
  stop matching controls the test already touched (see `.ai/gotchas.md`).

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
  changing is expected), commit the lot. The only hand-tuned knobs are the crop
  constants in `guide.screenshots.ts` (`HEADER` + a few per-shot
  `headerOffset`/`hideHeader`) — they mirror the app's sticky-chrome heights
  (page header / pinned ROM section title / pinned column headers), so adjust
  them once if the restyle changes those heights.
- **Not covered:** the guide's Daz-/Houdini-side photos (the
  `user-attachments` CDN links in `docs/guide/*.md`) are manual captures inside
  Daz/Houdini — an app restyle doesn't affect them.
- Navigate by clicking header links, not `page.goto` (a goto re-runs `main.tsx`
  startup navigation).
- **Interaction GIFs** (`pnpm gifs` → `docs/guide/gifs/*.gif`) are the moving
  siblings: `smoke/guide.gifs.ts` scripts each interaction as a FIXED frame
  sequence — a fake cursor overlay glides between UI states (headless Chromium
  draws no OS pointer), every frame is a screenshot, `gifenc` encodes them
  byte-reproducibly (no video capture, no ffmpeg). Same fixtures/frozen clock;
  transitions are pinned to 0ms while recording; the coverage test guards
  gifs/ ↔ guide references too. Machinery: `smoke/gif-recorder.ts`.
