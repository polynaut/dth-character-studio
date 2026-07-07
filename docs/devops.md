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

(Require a PR before merging + block force-pushes/deletion.) The PR CI
(`validate-pull-request.yml`) runs the JS **validate** job (typecheck / tests /
web build) and a **rust** job (cargo test `--locked` + a guard that fails if the
brotli `alloc-*` pins were reverted). Both are set as **required status checks**
on `main`, so a red PR — including a broken Rust build or a reverted pin — can't
merge and trigger a signed release.

## Cutting a release

1. Land feature PRs that include changesets.
2. Merge the auto-opened **"version packages"** PR.
3. The Release workflow builds, **Authenticode-signs**, and publishes
   `v<version>` automatically (see "Code signing" below — the signer session
   is kept alive automatically by the NAS keepalive robot).

To force a release of the current version, ensure `apps/desktop/package.json`
has the intended version and that tag `v<version>` doesn't already exist.

## Code signing (Certum SimplySign on the NAS runner)

Releases are Authenticode-signed with a **Certum Open Source Code Signing
certificate in the cloud (SimplySign)** — this is what stops Defender/
SmartScreen from flagging the installer and the auto-updater. There is no local
key file: the private key lives in Certum's cloud and is exposed as a PKCS#11
token by **SimplySign Desktop**, which runs headless in a container on polynaut's private NAS
([hpvb/certum-container](https://github.com/hpvb/certum-container)).

### Architecture

```
release.yml
  build         (windows-latest)             → unsigned NSIS installer artifact
  sign-publish  (self-hosted, certum-signer) → osslsigncode sign (PKCS#11 over
                                               the p11-kit socket shared from
                                               certum-container)
                                             → regenerate updater .sig over the
                                               signed bytes + build latest.json
                                             → gh release create (tag + assets)
```

Both signing jobs run in the protected **`release-signing` environment**
(required reviewer: `polynaut`, deployments restricted to `main`) — every
release and smoke test **pauses for manual approval** in the Actions UI before
anything touches the SimplySign session.

The NAS runs two containers:

- **certum-container** — SimplySign Desktop in Xvnc, exposing the virtual card
  through a p11-kit server socket (`p11kit.sock`) on a shared volume.
- **the Actions runner** (`jebpot-certum-signer`, labels
  `self-hosted, linux, certum-signer`) — has `osslsigncode`, `node`, `gh`,
  `p11tool` and the `p11-kit-client.so` module; mounts the same socket volume.
  In the current QNAP deployment the runner sees the socket at
  `/run/p11-kit/p11kit.sock` — recorded in the `CERTUM_P11_SOCKET` repo
  **variable**, which all signing workflows read (workflow inputs can
  override it per run).

### The SimplySign session (fully automated — no phone, no manual step)

SimplySign sessions live ~2 hours, but the login is **fully automated on the
NAS**: the Certum OTP mechanics were rebuilt so OTPs are generated without the
SimplySign mobile app, and a **keepalive robot refreshes SimplySign Desktop in
the container before the session invalidates** — so the token is always armed
and signing is zero-touch, indefinitely. No VNC, no phone, no interaction.

Sanity checks (both manual, from the Actions tab) if you ever doubt the state:
- **Runner self-check** — socket present + token listed.
- **Signing smoke test** — downloads a previous installer, signs and
  verifies it on the runner. Publishes nothing. Green = releases will sign.

### The signer script

Both workflows sign through **`sign-installer.sh`** (lives on the runner, in
PATH): `sign-installer.sh <in.exe> <out.exe> ["Product Name"] [project-url]`.
It signs, timestamps (`http://time.certum.pl/`), and **embeds the Certum
intermediate** so the chain is self-contained. Its final verify (and the
workflows' `osslsigncode verify`) is **informational only** — offline
chain-anchoring on Certum's cross-signed roots is fussy; a produced file is a
valid signature.

### Repo configuration

| Kind | Name | Holds |
|---|---|---|
| variable | `CERTUM_P11_SOCKET` | socket path in the runner (set: `/run/p11-kit/p11kit.sock`) |

**No PIN anywhere:** the SimplySign virtual card takes an empty PIN — the
(automated) SimplySign login *is* the auth. A `Key handle invalid` signing
error is NOT a PIN problem — check the container/keepalive state on the NAS.

### Gotchas

- **Order matters:** Authenticode signing changes the installer bytes, so the
  updater `.sig` and `latest.json` are regenerated on the signer AFTER signing
  (a `.sig` from build time would not verify).
- GitHub rewrites spaces in release asset names to dots
  (`DTH Character Studio_…` → `DTH.Character.Studio_…`); `latest.json` must
  point at the rewritten name. The workflow handles this.
- **The SimplySign session lives ~2 hours** (Certum's documented lifetime,
  verified in practice). **The NAS keepalive robot refreshes SimplySign Desktop
  BEFORE the session invalidates** (proactive, since 2026-07-07; OTPs are
  generated without the mobile app), so signing stays zero-touch indefinitely.
  Two lessons baked into it: a re-login alone is NOT a re-arm — after an expiry
  the p11-kit server still holds the dead session's module state and must be
  bounced (the runner talks to the p11-kit server, not to SimplySign Desktop) —
  and the keepalive must verify the token is visible *through the shared
  socket* afterwards. If a `sign-publish` job ever fails on a dead session:
  check the keepalive robot on the NAS, then re-run the job (the release-signing
  gate can also simply be left unapproved until the session is confirmed fresh).
- **The self-hosted runner's workspace persists between runs** — the
  `sign-publish` job cleans `dist/` before downloading the artifact and matches
  the installer by version; keep it that way or a previous release's installer
  gets picked up.
- Only the **installer** is signed for now; the app `.exe` inside it is not
  (would require signing during the Windows build, i.e. a cross-machine
  `signCommand` — revisit if Defender flags the installed binary).

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
