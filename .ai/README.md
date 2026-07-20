# .ai — agent documentation

Deep-dive docs for AI coding agents (and curious humans) working on this repo.
`CLAUDE.md` at the repo root is the entry point and stays short; these files hold
the detail so a fresh session doesn't need to re-scan the codebase to understand
it. Generated from a full source scan + accumulated project knowledge
(2026-07-20); update them when the facts they state change — they are
documentation, not archaeology.

| File | Read it when… |
|---|---|
| [architecture.md](architecture.md) | you need the lay of the land: packages, routes, the lib/ native boundary, the FFI surface, the projects model. |
| [domain.md](domain.md) | you touch generation, frames, sections, the PoseAsset CSV, the DTH runtime, or anything Daz/Houdini-semantic. |
| [conventions.md](conventions.md) | you change the character schema, the FFI surface, settings, versioning — the rituals live here. |
| [testing.md](testing.md) | you write or run tests: the four layers, what pins what, the screenshot suite. |
| [release.md](release.md) | you ship: the release train, the signing gate, publish troubleshooting. |
| [gotchas.md](gotchas.md) | before debugging anything weird — measured Daz/Tauri/build facts that code alone won't tell you. |

Ground rules for editing these docs:

- **Facts only, paths always.** Every claim should be checkable against a file;
  prefer `path/file.ts` references over prose.
- **No secrets, no personal/machine specifics.** This folder is public.
- Keep CLAUDE.md the short version — if something is needed on *every* task it
  belongs there; if it's needed when working *in an area*, it belongs here.
