---
'@dth/web': patch
---

Internal architecture hardening (no user-facing behaviour change):

- Adopt **oxlint** (type-aware) as the lint gate — fixes a handful of real
  latent bugs it surfaced (fire-and-forget promises, object-to-string coercions).
- CI: the "version packages" PR is now authored with a dedicated token so its
  checks run on their own; PRs must carry a changeset; the release is split into
  a self-hosted **sign** step and a hosted **publish** step.
- Extract a new **`@dth/ui`** package — an app-agnostic React kit (primitives,
  hooks, and composable components with no Tauri/router/filesystem coupling) so
  the UI is reusable by a future online build and the app stops carrying
  thousand-line god-files.
- Core (`@dth/rom`) and the Rust backend get cohesion + safety cleanups
  (single frame-offset source, typed FFI returns, env-derived paths).
