# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets). It
drives versioning + changelogs for this monorepo.

**Workflow**

1. In your feature PR, run `pnpm changeset` and describe the change (pick
   patch/minor/major). This writes a small markdown file here — commit it.
2. The `@dth/web`, `@dth/desktop`, and `@dth/rom` packages are **fixed** together,
   so they always share one product version.
3. When PRs with changesets land on `main`, the **Version** workflow opens/updates
   a "version packages" PR that bumps the versions and writes `CHANGELOG.md`.
4. Merging that PR changes the version → the **Release** workflow builds the Tauri
   app and publishes a GitHub Release (installer + updater `latest.json`).

See `docs/devops.md` for the full pipeline.
