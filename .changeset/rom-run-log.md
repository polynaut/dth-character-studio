---
'@dth/rom': minor
'@dth/web': minor
---

**ROM runs now report their problems back to the studio.** The generated Daz script writes a run log (`dth_rom_run_log.json` in the character folder) after every run — listing each morph that couldn't be applied (frame, node, reason) and any other error, including unexpected script failures (a catch-all reports even a missing runtime or a crash mid-run). When something failed, the script ends with a dialog pointing back to the studio, and the character page shows the full list the moment you switch back to it (re-checked on window focus), with a Dismiss button. A clean run clears the previous report automatically.

**A missing morph can no longer break the ROM's frame alignment.** Frame slots come from the character's declaration, not from what actually applied: a morph that isn't found in the scene is logged and skipped while its frames stay in the ROM (empty), invalid frame numbers are logged instead of silently shortening the timeline, and the legacy per-frame loop no longer drops the rest of a frame's morphs on the first miss — one bad morph costs exactly that morph, nothing else.

**The character script is now always named `ROM_<Name>_<Genesis>.dsa`** — previously the `ROM_` prefix appeared only in split-export mode. The stale un-prefixed script is cleaned up on the next Save; **Tools → Refresh assets** regenerates all characters (script runtime v13).
