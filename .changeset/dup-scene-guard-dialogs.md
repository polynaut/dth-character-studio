---
'@dth/web': patch
'@dth/ui': patch
---

A Daz scene that already belongs to a character can't be linked again: both the create-character panel and the add-scene dialog validate the picked `.duf` against every character's scenes and hard-block on a hit (no "anyway" escape) — the error names the owning character and links straight to its page (unless it's the character you're on). Failed validation rows now read as one short sentence instead of a "rule — detail" split. The fill wizard's step 1 is one click per character (no radios, no Next), step 2 titles the source with its project and starts with JCM/RET unchecked, and the GEN section's enable rules moved from hidden Switch tooltips into an "i" popup on the section title. Side panels are 75vw (max 1000px), the add-scene dialog is wider, and the tall path chip grows with padding when a long path wraps instead of clipping.
