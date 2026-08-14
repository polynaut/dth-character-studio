# .ai — agent documentation

Deep-dive docs for AI coding agents (and curious humans) working on this repo.
`CLAUDE.md` at the repo root is the entry point and stays short; these files hold
the detail so a fresh session doesn't need to re-scan the codebase to understand
it. Generated from a full source scan + accumulated project knowledge
(2026-07-20); update them when the facts they state change — they are
documentation, not archaeology.

| File | Read it when… |
|---|---|
| [philosophy.md](philosophy.md) | **always — it is injected into every session** (with the Working rules) by `.claude/hooks/inject-agent-context.mjs`. Epistemic honesty over perceived helpfulness: what to do when the rules below don't cover the case. Model-agnostic. |
| [architecture.md](architecture.md) | you need the lay of the land: packages, routes, the lib/ native boundary, the FFI surface, the projects model. |
| [domain.md](domain.md) | you touch anything Daz/Houdini-semantic — it routes to [domain-rom.md](domain-rom.md) (frames, sections, artifacts, CSV eras, hard rules) and [domain-exporter.md](domain-exporter.md) (the measured DTH exporter contract). |
| [conventions.md](conventions.md) | you change the character schema, the FFI surface, settings, versioning — the rituals live here. Opens with the **Working rules** (hook-injected into every session's context) and the stacked-PR setup. |
| [schema-history.md](schema-history.md) | you need to know what a specific `schemaVersion` / `RUNTIME_VERSION` number *means* — the per-version lookup table the migration code is written against. Bumping either constant means adding its entry here. |
| [testing.md](testing.md) | you write or run tests: the four layers, what pins what, the screenshot suite. |
| [docs-site.md](docs-site.md) | you touch "the docs page": the public Pages site — `site/`, `docs/guide/`, the guide build/deploy, previews, guide search. |
| [release.md](release.md) | you ship: the release train, the signing gate, publish troubleshooting. |
| [gotchas.md](gotchas.md) | before debugging anything weird — it routes to the `gotchas-*.md` area files (core, daz, desktop, web, releases): measured facts that code alone won't tell you. |

Ground rules for editing these docs:

- **Facts only, paths always.** Every claim should be checkable against a file;
  prefer `path/file.ts` references over prose.
- **Missing beats wrong** (see [philosophy.md](philosophy.md)). A fact that can't
  be stated accurately is left out and flagged as unknown — a gap sends the next
  reader to the code, a confident error sends them down the wrong path.
- **No secrets, no personal/machine specifics.** This folder is public.
- Keep CLAUDE.md the short version — if something is needed on *every* task it
  belongs there; if it's needed when working *in an area*, it belongs here.
- **Capture learnings in the PR that earned them.** A session that debugs a
  footgun, measures a platform behavior, or establishes a new ritual folds it
  into the matching file right away — a lesson that only lives in a PR
  description or chat log is lost to the next session. New features update
  the `domain-*.md` files/`architecture.md` in the same PR too.
