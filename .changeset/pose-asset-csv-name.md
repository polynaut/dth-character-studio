---
"@dth/web": patch
"@dth/rom": patch
---

Rename the generated PoseAsset CSV to DTH's convention: `<name>_pose_asset.csv`
(was `<name>_PoseAsset.csv`). The legacy-cased file is cleaned up from the
character folder and the export folder on the next generate.
