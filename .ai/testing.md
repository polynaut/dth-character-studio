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
  staleness sweep, a few component tests (jsdom + Testing Library), and FFI
  integration tests (`install.integration.test.ts`, `mockIPC`-based).
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

## 4. Guide screenshots (`pnpm --filter @dth/web screenshots`)

`smoke/guide.screenshots.ts` + `playwright.screenshots.config.ts` (own dev
server :4332, 1280×720 @2x, dark). Reuses the smoke mock/fixtures, navigates to
each documented screen/state, and **writes the PNGs the guide embeds** to
`docs/guide/screenshots/` — the guide's images are generated, not hand-shot.
Asserts nothing.

Regeneration workflow & gotchas:

- Run it after UI changes that touch documented screens; commit the changed PNGs
  with the feature.
- **Check `git diff` on the PNGs and revert drift-only changes** — the mock's
  `statOf` uses the live clock, so shots showing file timestamps (products tab,
  tools refresh) differ every run without any real change
  (`git checkout -- <png>`).
- The character page has three stacked sticky layers (header / section titles /
  column headers); the suite's `shoot(…, { headerOffset })` / `hideHeader` /
  un-stick helpers exist to keep crops clean. Follow existing shots' patterns.
- Navigate by clicking header links, not `page.goto` (a goto re-runs `main.tsx`
  startup navigation).
