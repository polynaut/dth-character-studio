# Release train

Fully automated — **never tag or publish by hand**. `docs/devops.md` is the
authoritative pipeline/signing doc; this page is the operational summary an agent
needs.

## The train

```
feature PR (with changeset) ──merge──▶ main
  └─ Version workflow opens/updates the "🚢 chore: version packages" PR
     (the commit subject stays plain "chore: version packages")
       └─ merging THAT PR bumps the fixed group + consumes changesets
            └─ Release workflow: check → build-win (+build-mac) → sign-win + sign-mac → publish
```

- **Product version** = `apps/desktop/package.json` (tauri.conf.json:
  `"version": "package.json"`). The Rust crate's `0.1.0` is cosmetic.
- **Release gate** (`check` job in `.github/workflows/release.yml`): release only
  when there are **zero pending changesets** (a pending one means the version PR
  hasn't merged) AND tag `v<version>` doesn't exist. Idempotent — pushes that
  shouldn't release simply skip.
  - Consequence: **orphaned empty changesets block releasing.** Empty changesets
    from docs/CI PRs sit pending (they bump nothing, so no version PR consumes
    them until a real changeset joins) and pin `should_release=false`. A version
    whose publish failed can be *skipped entirely* if later changesets land —
    its changes just ship in the next version.
- **Release notes** are built from the four CHANGELOGs by
  `scripts/release-notes.mjs`, not from commit subjects.
- **The Version workflow needs `CHANGESETS_TOKEN` in TWO places** (version.yml):
  on `actions/checkout`'s `token:` AND in the changesets action's `env`. The
  action pushes `changeset-release/main` with the credentials checkout persists;
  the env token only reaches its PR API calls. Env-only ⇒ the push author is
  github-actions[bot] and every validation run on the version PR sits
  `action_required` until manually approved (measured 2026-08-03; fixed in
  #666). Falls back to `GITHUB_TOKEN` — expect that babysitting.
- **build-mac** is opt-in via the `ENABLE_MAC_RELEASE` repo variable
  (arm64-only, Developer-ID-signed + notarized).
- **Bundled Runner plugin**: `beforeBuildCommand` (tauri.conf.json) runs
  `pnpm -w fetch:runner` (`scripts/fetch-runner.mjs`; `-w` because the hook's
  CWD is apps/desktop, not the root) before every desktop build —
  it stages the LATEST `polynaut/dth-character-studio-runner` release's DLLs
  into `apps/desktop/resources/dth-runner/` (gitignored; bundled via
  `bundle.resources`). So the installer's Runner version floats with that
  repo's latest release at build time — ship a runner fix by releasing there,
  then cutting any studio release. `tar -xf` extracts the zips (bsdtar);
  a dev checkout runs `pnpm fetch:runner` once by hand.
  **The tauri-action build steps must pass `GITHUB_TOKEN`** (release.yml env)
  — the fetch hits the GitHub API, and unauthenticated calls share the hosted
  runner IP pool's rate limit: the v0.52.0 build-mac 403'd exactly there.
  **Load-test a runner release in Daz Studio BEFORE cutting a studio release
  that bundles it** (the log must say `successfully loaded`): v0.51.1 shipped
  Runner v1.0.0, which Daz refused to load — the studio build can't detect
  that, only Daz can. The plugin-SDK footguns live in the runner repo's
  README + pluginmain.cpp.

## Signing (the human gate)

The train's sign step is TWO parallel jobs: **`sign-win`** on the self-hosted
NAS runner (labels `self-hosted, linux, certum-signer`; Certum/SimplySign
Authenticode) and **`sign-mac`** on `macos-latest` (Developer-ID sign +
notarize/staple). Both run inside the **`release-signing` protected
environment — every release pauses for a manual approval of each** by the repo
owner. Only these two jobs see the real updater private key
(`TAURI_SIGNING_PRIVATE_KEY`); the hosted build jobs sign with a throwaway key.
Updater `.sig` and `latest.json` are regenerated **after** signing (signing
changes the artifact bytes). Details, session keepalive, and troubleshooting:
`docs/devops.md` § Code signing.

## Publishing

The `publish` job (hosted runner) creates the GitHub release with all assets +
one cross-platform `latest.json`.

- **The gate keys on job RESULTS, not repo variables:** publish requires
  `sign-win == success` and (`sign-mac == success` OR `build-mac == skipped`).
  `build-mac == skipped` ⟺ mac was disabled when the run scheduled — so a
  FAILED mac build blocks the release instead of silently shipping
  Windows-only, and flipping `ENABLE_MAC_RELEASE` mid-run can't invert the
  gate (an earlier version re-read the variable at publish time — it could).
  The `if` uses `!cancelled()`, never `always()`: `always()` runs through
  cancellation, and a cancelled run must not mint the immutable release.

- **It authenticates with the `RELEASE_PAT` secret** (fine-grained PAT, this repo,
  Contents: read+write), falling back to `GITHUB_TOKEN`. Reason:
  `github-actions[bot]` gets `403 Resource not accessible by integration` on
  `POST /releases` on this repo even with `contents: write` granted — verified
  2026-07-20 (v0.44.10 was built+signed but never released; shipped as v0.44.11).
- **If publish fails with 403/401: check the PAT's expiry first.** Regenerate,
  update the secret, then re-run **failed jobs only** — signed artifacts persist
  3 days, so no rebuild/re-sign is needed.
- **Releases are immutable** (repo setting): a published release and its
  `latest.json` cannot be edited afterward. Get `latest.json` right the first
  time; never hand-publish casually.
- GitHub rewrites spaces→dots in asset names; `latest.json` URLs use the
  rewritten names.

## Updater

Installed apps poll
`releases/latest/download/latest.json` (endpoint + minisign pubkey in
`tauri.conf.json` → `plugins.updater`). The web side triggers checks in
`apps/web/src/lib/updater.ts`.

## Housekeeping — none, and it cannot exist in this form

There WAS a `release-housekeeping.yml` (daily cron) that stripped binary assets
from old releases. It was removed 2026-08-07 because it can never work here:

```
DELETE /releases/assets/<id>
422 Validation Failed — "Cannot delete asset from an immutable release"
```

This repo's releases are **immutable** (see the note in `.ai/gotchas.md` — a
published release and its `latest.json` cannot be edited afterward), and that
covers their assets too. So every run failed on the first asset it tried to
delete, having deleted nothing. A daily red cron that is impossible by
construction is worse than no cron.

Consequence, deliberately accepted: every release keeps its installers forever.
If storage ever needs reclaiming, the only lever is deleting whole RELEASES —
and that is the one thing this repo must be careful with, because a deleted
release permanently burns its tag name (`.ai/gotchas.md`, the v0.44.7–v0.50.0
episode).
