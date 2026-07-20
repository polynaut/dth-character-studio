# Release train

Fully automated — **never tag or publish by hand**. `docs/devops.md` is the
authoritative pipeline/signing doc; this page is the operational summary an agent
needs.

## The train

```
feature PR (with changeset) ──merge──▶ main
  └─ Version workflow opens/updates the "chore: version packages" PR
       └─ merging THAT PR bumps the fixed group + consumes changesets
            └─ Release workflow: check → build-win (+build-mac) → sign → publish
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
- **build-mac** is opt-in via the `ENABLE_MAC_RELEASE` repo variable
  (arm64-only, Developer-ID-signed + notarized).

## Signing (the human gate)

The `sign` job runs on a self-hosted runner (labels
`self-hosted, linux, certum-signer`) inside the **`release-signing` protected
environment — every release pauses for a manual approval** by the repo owner
before the Certum/SimplySign signing happens. Only this job sees the real updater
private key; the hosted build jobs sign with a throwaway key. Updater `.sig` and
`latest.json` are regenerated **after** Authenticode signing (signing changes the
installer bytes). Details, session keepalive, and troubleshooting:
`docs/devops.md` § Code signing.

## Publishing

The `publish` job (hosted runner) creates the GitHub release with all assets +
one cross-platform `latest.json`.

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

## Housekeeping

`release-housekeeping.yml` (daily cron) strips binary assets from old releases —
keeps the newest 20, the first 3 ever, and every `x.y.0`; releases/tags/notes
themselves are kept. The updater only ever reads the newest release, so this is
safe.
