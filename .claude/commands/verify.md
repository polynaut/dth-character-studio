---
description: "Run the full verification gate (typecheck, lint, tests, smoke, cargo) and fix any failures"
---

Run DTH Character Studio's verification gate, in order. Stop and fix on the first failure.

1. `pnpm -r typecheck`
2. `pnpm lint`  (oxlint — the CI gate; `pnpm lint:fix` autofixes the mechanical ones)
3. `pnpm -r test`  (vitest)
4. `pnpm --filter @dth/web smoke`  (Playwright browser smoke)
5. Rust crate: `cargo check` then `cargo test` (run from `apps/desktop`)

If a route **file** was added or removed, also run `pnpm generate-routes` and confirm `routeTree.gen.ts` is up to date.

If this is a feature branch, confirm a changeset exists (`.changeset/*.md`); if not, add one with `pnpm changeset` (or `pnpm changeset --empty` for a docs/CI-only change).

**Failure strategy — fix and retry:**

1. Read the failure; find the root cause (test, implementation, or config).
2. Fix one issue at a time.
3. Re-run only the failed check to confirm the fix.
4. Repeat until green (max 3 attempts per check, then ask for help).
