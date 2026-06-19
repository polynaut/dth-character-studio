---
"@dth/web": patch
---

When a character has an export directory set, the generated PoseAsset CSV is now
also written into that folder — so it sits next to the exporter's output
(`<name>.fbx` / `.abc` / `.dth` / …) and the whole package ends up in one folder
for the next step. The CSV still lives in the character folder too; writing to
the export folder is best-effort and never fails generation.
