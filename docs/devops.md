# DevOps: versioning, releases, auto-update

## Pipeline overview

```
feature PR (+ changeset)  ──►  main
                                 │  Version workflow (.github/workflows/version.yml)
                                 ▼
                       "version packages" PR  ──►  main   (bumps versions + CHANGELOG)
                                                     │  Release workflow (.github/workflows/release.yml)
                                                     ▼
                                    GitHub Release  v<version>
                                    (NSIS installer + latest.json + .sig)
                                                     │  @tauri-apps/plugin-updater
                                                     ▼
                                    installed app self-updates on next launch
```

- **Versioning:** [Changesets](.changeset/config.json). `@dth/web`, `@dth/desktop`,
  `@dth/rom` are a **fixed** group → one product version. The Tauri app reads its
  version from `apps/desktop/package.json` (`tauri.conf.json` → `"version": "package.json"`),
  which Changesets bumps — so version → tag → installer stay in sync.
- **Release gate:** `release.yml` builds only when there are **no pending
  changesets** (so the "version packages" PR has merged and bumped the version)
  **and** the tag `v<version>` doesn't exist yet. Feature merges still carrying
  changesets are skipped — they just feed the version packages PR. Idempotent.
- **Auto-update:** `apps/web/src/lib/updater.ts` runs `check()` on startup
  (no-ops outside the packaged app), prompts, then `downloadAndInstall()` +
  `relaunch()`.

## One-time setup (required before the first real release)

### 1. Updater signing keypair

The updater verifies releases with a minisign keypair.

```bash
pnpm --filter @dth/desktop tauri signer generate -w ./dth-updater.key
```

- Put the **public** key into `apps/desktop/tauri.conf.json` →
  `plugins.updater.pubkey` (replace `REPLACE_WITH_TAURI_UPDATER_PUBKEY`). It's
  public — safe to commit.
- Keep the **private** key + its password OUT of git. Store them in a password
  manager and add as GitHub Actions secrets (below). Then delete the local
  `dth-updater.key`.

### 2. GitHub Actions secrets

| Secret | Holds |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | contents of the generated private key |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | the password set during generation |

`GITHUB_TOKEN` is provided automatically — no secret needed.

### 3. Branch protection (main is PR-only)

⚠️ This repo's `gh` is authenticated as **`rvetere` (READ-only here)** — branch
protection + releases require the **`polynaut`** admin identity (the SSH/1Password
account). Do it via the GitHub web UI (Settings → Rules → Rulesets), or with `gh`
authenticated as `polynaut`:

```bash
gh api -X POST repos/polynaut/dth-character-studio/rulesets \
  -f name='main protection' -f target=branch -f enforcement=active \
  -F 'conditions[ref_name][include][]=refs/heads/main' \
  -F 'rules[][type]=pull_request' \
  -F 'rules[][type]=non_fast_forward'
```

(Require a PR before merging + block force-pushes/deletion. Add a required
status-check rule once CI check names are stable.)

## Cutting a release

1. Land feature PRs that include changesets.
2. Merge the auto-opened **"version packages"** PR.
3. The Release workflow builds + publishes `v<version>` automatically.

To force a release of the current version, ensure `apps/desktop/package.json`
has the intended version and that tag `v<version>` doesn't already exist.

## Known temporary pin

`Cargo.lock` pins `alloc-stdlib = 0.2.2` + `alloc-no-stdlib = 2.0.4`. `alloc-no-stdlib`
3.0.0 (published 2026-06-14) creates a duplicate version that breaks `brotli 8.0.3`
(Tauri's default asset `compression`) — see tauri-apps/tauri#15540/#15541,
dropbox/rust-brotli#256. Re-pin if a `cargo update` reverts it:
`cargo update -p alloc-stdlib --precise 0.2.2 -p alloc-no-stdlib --precise 2.0.4`.
Remove once upstream ships a fix.

## Later: macOS

Windows-first for now. macOS needs Apple signing + notarization (Developer ID
cert as `CSC_LINK`/`CSC_KEY_PASSWORD`, notarytool API key as
`APPLE_API_KEY`/`APPLE_API_KEY_ID`/`APPLE_API_ISSUER`), a `zip` updater target,
hardened runtime + entitlements (allow-jit / allow-unsigned-executable-memory),
and a `macos-latest` matrix leg in `release.yml`.
