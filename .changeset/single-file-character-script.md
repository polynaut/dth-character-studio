---
"@dth/web": minor
---

Generate one self-contained Daz script per character instead of a pile of files.

Save now produces a single `<CharacterName>_<Genesis>.dsa` that makes one
`ApplyDTHCharacter({ … })` call carrying the full character config **and** all ROM
morph definitions inline — no more separate `_FBMs.json`, `_FBMs.csv`, wrapper
`.dsa`, or `_*ArtDirection.json` files. It's installed into a shared
`<My DAZ 3D Library>\Scripts\DTH-Character-Studio` folder, alongside the DTH
runtime files it imports (DthWorkflow / DthUtils / DthOptions / ScanKeyFrames),
which are copied there from the configured DazToHue-Scripts folder. The Houdini
`PoseAsset.csv` is written into the character's own folder next to its definition.

Requires the matching DazToHue-Scripts runtime that adds the `ApplyDTHCharacter`
entry point and inline-data support.
