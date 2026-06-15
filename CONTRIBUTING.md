# Contributing

## Repo layout

A 2-layer pnpm monorepo:

```
apps/
  web/        @dth/web      — React SPA frontend (Vite). Runnable standalone.
  desktop/    @dth/desktop  — Tauri 2 shell (Rust). Loads apps/web; the shippable app.
packages/
  rom/        @dth/rom      — pure ROM/CSV/DSA generation core (no I/O).
```

## Develop

```bash
pnpm install
pnpm dev            # web SPA only, in a browser (http://localhost:4330)
pnpm dev:desktop    # the Tauri app (starts the web dev server + the native window)
pnpm -r test        # all tests
pnpm -r typecheck
```

Rust is required for the desktop app (`rustup`, plus WebView2 on Windows — preinstalled on Win11).

## Branch & PR policy

`main` is protected — **no direct pushes**. Everything goes through a pull request:

1. Branch off `main` (`feature/…`, `fix/…`).
2. Make your change. Add a changeset describing it: `pnpm changeset` (pick
   patch/minor/major; `@dth/web`/`@dth/desktop`/`@dth/rom` are versioned in
   lockstep). Commit the generated file.
3. Open a PR. CI must be green and the PR reviewed/approved before merge.

## Releases (automated)

You don't tag or publish by hand — see `docs/devops.md`:

1. PRs with changesets land on `main`.
2. The **Version** workflow maintains a "version packages" PR (bumps versions +
   writes `CHANGELOG.md`).
3. Merging that PR changes the version → the **Release** workflow builds the
   Tauri app and publishes a GitHub Release (installer + auto-update `latest.json`).
4. Installed apps pick up the update on next launch.
