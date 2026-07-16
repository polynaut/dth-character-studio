---
'@dth/rom': patch
---

Internal refactor: the frame math + ROM walks (presetEndFrame, walkCustomPoses, flattenRom, …) moved out of types.ts into their own frames.ts module — the schemas and the `Character` model stay in types.ts. The `@dth/rom` export surface is unchanged; no behaviour change.
