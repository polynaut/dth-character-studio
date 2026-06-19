---
"@dth/web": patch
---

Fix the generated Daz script failing with "ReferenceError: options is not
defined". Since generated scripts moved into per-character subfolders, the DTH
runtime's internal `include()`s (DthWorkflow → DthUtils / DthOptions) still
resolved relative to the character folder instead of the runtime root, so
DthOptions never loaded. Those includes are now rewritten to climb two levels to
the root (matching the character script's own `../../.DthWorkflow.dsa` include).
Re-generate (save a character, or Settings → Refresh Assets) to update the
installed runtime.
