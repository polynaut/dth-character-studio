---
'@dth/web': minor
'@dth/rom': minor
---

feat(web,rom): every Daz scene lives in its **own subfolder** now — the primary in `primary` (created there on character creation), extra scenes in a folder seeded from the sanitized scene filename (character name and G9/Genesis/GP/DK-style noise stripped; editable, never empty — the scene location chips refuse an empty subfolder too). The **"Generate subfolders based on Daz scenes" switch is gone**: exports always nest under each scene's own subfolder name (schema v26, runtime v37), with the old scene-name nesting as the fallback for scenes linked outside the character folder. **Tools → Refresh assets migrates existing characters**: root-dwelling scene files are physically moved into their subfolders (primary → `primary`, extras → suggested names) with every linked path repointed — run it once after updating; a scene locked by an open Daz Studio is skipped with a note and picked up by the next refresh.
