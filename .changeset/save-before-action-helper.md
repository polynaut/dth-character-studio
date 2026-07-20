---
---

Internal refactor only — no user-facing change. Extracts the duplicated "save pending settings edits, then run the install/scan/dedup" logic (verbatim `runInstall` in both the Settings and Tools pages, plus the re-inlined save-before-action preamble) into one shared `useSettingsActions` hook.
