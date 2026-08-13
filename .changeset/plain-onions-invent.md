---
'@dth/desktop': patch
'@dth/web': patch
---

Unreal plugin scan: a plugin's own version is no longer read as the engine's.
`KawaiiPhysics_5.7_1.21.0.zip` and `KawaiiPhysics_5.8_1.21.0.zip` both listed as
**UE 1.21** — the engine is named first and the plugin's version last, and the
last version-looking number won. A major below 4 cannot be an Unreal Engine
version (`.uplugin` starts at UE4), so it is now skipped wherever it sits in the
name, and the two builds read as 5.7 and 5.8. The same rule applies to a
`.uplugin` whose `EngineVersion` holds the plugin's version: an impossible
version means no constraint (offered for every engine), not one no project can
satisfy.
