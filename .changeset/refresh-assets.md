---
"@dth/web": minor
---

Add a **Refresh Assets** button in Settings → General that re-generates the Daz scripts and PoseAsset CSVs for every character across all projects — run it after updating the studio or switching DTH release so every character's generated files match the current version. Per-character failures are reported rather than aborting the sweep, and character definition JSONs are left untouched (they self-migrate on open/save).
