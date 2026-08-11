---
"@dth/web": minor
"@dth/desktop": minor
---

Character **Export & Import** — the character page's Operations card packs the whole character into a self-contained `<Name>_<date>.dcsc.zip` (definition, notes, all Daz scenes, all Houdini projects, avatar and studio metadata always; the regenerable `daz-export` / final `export` trees behind two toggles; already-compressed content is stored, the rest fast-deflated), saved to a folder you pick. Importing the zip onto a character opens an **import wizard** (Fill-style): rename the character (pre-filled from the zip), pick the ROM sections/extras to take over, the Daz scenes to restore (primary mandatory — existing scenes are always replaced) and the Houdini projects (added beside or replacing the character's own); the character entity persists. Dropped on a project page, the zip restores wholesale as a new character. Every stored path is repointed to the new location — including the Houdini projects' `$JOB` and references (via the Utils drawer's repair ops) — and the generated artifacts are refreshed.
