---
"@dth/rom": patch
"@dth/web": patch
---

Per-scene form overrides — a character's extra (outfit) Daz scenes can now override more than just the ROM:

- With a **non-primary scene selected**, the overridable panels — **ROM**, the **Genesis-9 box** (FACS detail / flexion strengths, UE5 tear UV), the **hair list**, and the Advanced-options **preserve lists** (preserve morphs / node transforms) — disable by default, each with its own top-right **Override** toggle. A new scene starts fully disabled; you opt each panel in. Genesis/Gender, Houdini projects and the export directory are never per-scene (the export already nests per scene).
- Arming a panel edits **that scene's** values, starting as a copy of the base you can tweak — or, for the lists, add to and delete from. The ROM section locks read-only on a non-primary scene until you arm it (check **Override** on a row to replace it, or add frames at a group's end).
- **Hair simplified**: the "Hair items live in the Daz scenes" toggle is gone — hair is per scene by presence now (a scene's listed items ARE its hair; none listed, none excluded). For a hair-only variant, link it as its own scene or use Attachments.

Under the hood the per-scene artifacts collapse into the **one** character Daz script: it embeds every linked scene's overrides and picks the open scene's values at run time (the same trick the hair map already used), instead of a separate `ROM_…_<Scene>.dsa` per scene. A ROM-override scene still gets its own PoseAsset CSV (Houdini can't select frames), delivered by the same scene lookup. **Refresh assets** regenerates existing characters onto the one script and sweeps the old per-scene scripts.
