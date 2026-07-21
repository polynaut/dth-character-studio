---
description: "Adversarial staff-engineer review of the branch diff — SHIP IT / NEEDS WORK / BLOCK"
---

Adversarial code review. Don't let me ship until the changes pass your scrutiny.

Steps:

1. `git diff main...HEAD` to see all changes on this branch.
2. Review every change as a skeptical staff engineer:
   - Logic errors, edge cases, missing tests for new/changed behavior.
   - **The core invariant:** frame numbers are never stored — they're computed at generation time so the Daz `.dsa` and Houdini CSV stay frame-aligned. Any change to generation must preserve that both artifacts derive from one source.
   - **Native boundary:** native access stays in `lib/` (`isTauri()`-guarded), not in routes/components. Structured Rust returns parse through the `api/native-types.ts` zod schemas — never a bare `invoke<T>()` cast — and a new structured return needs a schema + a `contracts/` fixture + a test on both the serde and zod sides.
   - **Schema changes:** persisted `Character` shape bumps `CHARACTER_SCHEMA_VERSION` with a `migrate.ts` step (when needed) + a `migrate.test.ts` case.
   - Security, performance regressions, breaking changes to public APIs.
   - Typecheck and lint pass (`pnpm -r typecheck`, `pnpm lint`).
   - Feature PRs carry a changeset (`.changeset/*.md`).
   - Non-obvious decisions, footguns, or workarounds that belong in `.ai/gotchas.md` (or the right `.ai/` doc) but aren't captured.
3. Rate the changes: **SHIP IT** / **NEEDS WORK** / **BLOCK**.
4. If NEEDS WORK or BLOCK: list each issue with file, line, and the fix.
5. After I make fixes, re-review from step 1.
6. Only give **SHIP IT** when every issue is resolved.
