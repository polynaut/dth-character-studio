# Audit follow-ups

Hardening and refactor tasks left over from the July 2026 app audit. The
**exploitable** bugs the audit found were fixed in PRs #122/#124/#125/#126/#127/#128
(frame off-by-one, script/CSV injection, destructive-command path rails,
symlink-safe walks, atomic installs, the inverted dedup winner, migration
clobber, the CI Rust gate + required checks, …). What's left below is
**defense-in-depth and cleanup** — none of it is a live exploit, but each is
worth doing. Every item needs a bit of hands-on validation that couldn't be done
in the fix pass, which is why it's here rather than already merged.

Tackle in any order; each is independent.

**Status (July 2026):**
1. ✅ Done — runtime v16 (#137 + #142): preset lengths measured, fail-loud, guarded
   by a no-literal CI test + cross-artifact alignment tests. Daz-validated (stock
   G9, custom-JCM base of non-standard length, old-script fail-loud).
2. ✅ CSP done / fs documented — strict prod `csp` + `devCsp`, asset protocol
   **disabled** (nothing used it; images are inlined `data:` URLs). The broad `fs:`
   scope stays **by design**: projects are user-chosen folders anywhere on disk and
   `storage.ts` works there directly; destructive rails live in the Rust commands.
   Long-term option: route JS-side remove/rename through validated Rust commands.
3. ✅ Done (#140) — throwaway updater key in the build job (real key only on the
   signer), tauri-action + rust-toolchain SHA-pinned.
4. ◐ Tests done (#139: `resolvePresetFrames`); the god-module *split* remains open.
5. ✅ Done (#138) — clippy `-D warnings` gate in CI, pre-existing lints cleared.

---

## 1. Single-source the preset-block frame counts

**Why:** the Daz runtime hardcodes each preset block's length (`DthWorkflow.dsa`:
`iRomFrames = bDQS ? 328 : 617`, `dk9FrameCount = 54`, `gpFrameCount = 104`,
`physFrameCount = 43`) while the studio/CSV/exporter *measure* them live
(`pose_asset_frames` → `duf_frame_count`). They agree for the stock DTH assets, so
everything ships correct today — but a **custom JCM base ROM** of non-standard
length, or a future DTH release that changes a preset's frame count, would silently
desync the Daz timeline from the PoseAsset CSV.

**Do:** thread the measured `PresetFrames` into the character config
(`packages/rom/src/generate.ts`) and have `DthWorkflow.dsa` size each block from
those values (with the current literals as a fallback so stock behaviour is
unchanged). Bump `RUNTIME_VERSION`; mirror the runtime change into DazToHue-Scripts.

**Verify:** requires a **real Daz run** — build a ROM with a non-standard custom
JCM base ROM and confirm the custom frames still line up with the CSV. (This is why
it wasn't merged blind.)

**Files:** `packages/rom/src/generate.ts`, `apps/web/src/lib/rom/runtime/DthWorkflow.dsa`,
`packages/rom/src/types.ts` (RUNTIME_VERSION).

---

## 2. Tighten the Tauri capabilities: CSP + fs scope

**Why:** `apps/desktop/tauri.conf.json` sets `"csp": null` and
`apps/desktop/capabilities/default.json` grants `fs:` read/write/remove/rename over
`"**"`. There's no current XSS sink, so this is defense-in-depth — but if one ever
appeared the blast radius would be the whole disk. The app already routes heavy fs
work through validated Rust commands, so some of the JS `fs` breadth is more than
the design needs.

**Do:** set a restrictive CSP that still allows what the app uses (the `asset:`
protocol, `data:` images, inline styles if Vite needs them), and narrow the fs
scope where feasible — the destructive `fs:allow-remove`/`allow-rename` at `**` are
the sharpest edges (note: JS `storage.ts`/`moveCharactersRoot` currently uses
`remove`/`rename` directly, so check what actually needs them before dropping).

**Verify:** requires the **running packaged app** — a too-strict CSP silently breaks
avatars/updater/routes and would ship in an auto-update. Test in `pnpm dev:desktop`
and a local `pnpm build:desktop` before merging.

**Files:** `apps/desktop/tauri.conf.json`, `apps/desktop/capabilities/default.json`.

---

## 3. Shrink the updater-signing key's exposure in CI

**Why:** the updater private key (`TAURI_SIGNING_PRIVATE_KEY`) signs the
auto-updates every installed app trusts. The signer CLI is now pinned to an exact
version (#126), but two edges remain: the **build** job still holds the real key
while running floating third-party actions (`tauri-apps/tauri-action@v0`,
`dtolnay/rust-toolchain@stable`) even though its `.sig` is discarded, and those
actions aren't SHA-pinned.

**Do:** (a) give the build job a **throwaway** updater keypair (generate one in the
job) so the real key lives only on the signer; the build's `.sig` is thrown away
and regenerated over the signed bytes anyway. (b) Pin `tauri-action` and
`rust-toolchain` to full commit SHAs (accept the manual-bump maintenance).

**Verify:** run the **Signing smoke test** workflow after changing `release.yml` to
confirm the pipeline still produces a valid signed installer before the next real
release depends on it.

**Files:** `.github/workflows/release.yml` (build + sign-publish jobs).

---

## 4. Break up the god-modules + test the orchestration layer

**Why:** `apps/web/src/lib/rom/api.ts` (~2300 lines, the whole native bridge),
`storage.ts` (~1800), and the character route
(`routes/projects.$projectId.characters.$characterId.tsx`, ~2700) have grown into
god-modules. `api.ts` in particular — including `refreshAllAssets` /
`generateCharacterFiles` / the frame-refresh logic that protects the "artifacts
stay frame-aligned" invariant — has **no direct test coverage** (it's the single
largest untested surface; `generate.ts` and the Rust crate are well covered).

**Do:** split `api.ts` by concern (e.g. `api/{projects,characters,assets,install}.ts`),
lift the sub-components out of the character route into `components/`, and add unit
tests for the mostly-pure orchestration (`refreshAllAssets` / `isCharacterStale` /
`resolvePresetFrames`) mocking storage the way `project-files.test.ts` already does.

**Verify:** typecheck + the full test suite; it's a mechanical refactor, so do it as
its own focused effort (don't fold into unrelated changes).

---

## 5. Add a `clippy` gate to CI

**Why:** the PR Rust job runs `cargo test --locked` but not `clippy` — the crate has
~10 pre-existing lints (a few `Error::other` simplifications, two `too_many_arguments`,
a `needless_range_loop`, some `needless_return`), so a `-D warnings` gate can't be
added until they're cleared.

**Do:** run `cargo clippy --fix` for the auto-fixable ones, `#[allow(...)]` the
structural ones with a one-line justification (or bundle the wide arg-lists into
structs), then add `cargo clippy --locked -- -D warnings` to the `rust` job in
`.github/workflows/validate-pull-request.yml`.

**Verify:** `cargo clippy --manifest-path apps/desktop/Cargo.toml --locked -- -D warnings`
passes locally.
