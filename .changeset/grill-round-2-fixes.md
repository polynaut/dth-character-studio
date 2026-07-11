---
'@dth/web': patch
---

Fixes from a full code/architecture/security review:

- **Actually wire in the zod FFI validation** — `native-types.ts` schemas were
  defined but imported nowhere (the api layer still used bare `invoke<T>()`
  casts against duplicate interfaces). `install.ts`/`maintenance.ts` now
  `Schema.parse(await invoke(...))` at each boundary, so a renamed Rust serde
  field throws where it happens instead of handing the UI `undefined`.
- **NumberField data-corruption fix**: it never re-synced its draft, so removing
  a non-last preserve-morph row showed (and could commit) the previous row's
  number. Adds the missing `value`-change effect.
- **Notes tab** no longer renders the ROM editor + Delete section below the
  notes (wrong tab condition).
- **Settings** unsaved-changes guard now covers Project-tab edits too (was
  machine-fields only — project edits could be discarded silently).
- **Security**: anchor the `shell.open` allowlist regex (it was substring-
  matchable via an unanchored middle branch, e.g. `x.pdf.exe`).
- Editor "experimental" badge passes `gpFrames`; the G9 strength-dial gate reads
  the `GENERATIONS` table; `romFields` typed (dropped an `as unknown as`);
  ImageDialog avatar-save rolls back + toasts on failure; InfoPopup treats
  protocol-relative `//host` links as external.
- Docs: release sign/publish split + `CHANGESETS_TOKEN` documented; dropped the
  phantom "web-only e2e" claim.
