---
'@dth/rom': patch
'@dth/web': patch
---

**Hotfix: every v0.29.0 ROM script failed with `URIError: !{{ Legacy Include }}`.** Daz resolves `include()` through its legacy-include mechanism, which fails inside a `try/catch` — and v0.29.0's catch-all wrapper had moved the runtime include into one. The include is back at the top level (with a regression-guard test), a `typeof` check covers a missing runtime instead, and the export block is now skipped when the ROM build aborts. **Save each character (or run Tools → Refresh assets once) to regenerate the broken scripts** (script runtime v14).

Run-report UX, reworked: the Daz dialog is short and generic ("Something went wrong while building the ROM — switch back to DTH Character Studio to see what failed") — the details live in the studio. The studio now **ingests** the Daz-written log into its own `.last_rom_run.json` store and deletes the Daz file (throwaway transport). The report shows above the tabs, **failed morphs mark their rows red in the ROM editor**, and when the report is scrolled off-screen a floating "Errors in the last ROM run — click to see details" hint jumps to it.
