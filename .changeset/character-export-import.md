---
"@dth/web": minor
"@dth/desktop": minor
---

Character **Export & Import** — the character page's Operations card packs the whole character into a self-contained `<Name>_<date>.dcsc.zip` (definition, notes, all Daz scenes, all Houdini projects, avatar and studio metadata always; the regenerable `daz-export` / final `export` trees behind two toggles), saved to a folder you pick. The zip restores by dropping it on a character page (complete overwrite, confirmed) or on a project page (a new character with all of the zip's data) — every stored path is repointed to the new location, including the Houdini projects' `$JOB` and references (via the Utils drawer's repair ops), and the generated artifacts are refreshed.
