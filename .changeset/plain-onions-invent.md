---
'@dth/desktop': patch
'@dth/web': patch
---

Unreal plugin scan: a plugin's own version is no longer read as the engine's.
`KawaiiPhysics_5.7_1.21.0.zip` and `KawaiiPhysics_5.8_1.21.0.zip` both listed as
**UE 1.21** — the engine is named first and the plugin's version last, and the
last version-looking number won. An Unreal Engine major is between 4 and 9
(`.uplugin` starts at UE4, and a two-digit number in a plugin name is a year or
the plugin's own version, never an engine), so anything outside that is now
skipped wherever it sits in the name, and the two builds read as 5.7 and 5.8.

The same rule applies to a `.uplugin` whose `EngineVersion` holds the plugin's
version: an impossible version means **no** constraint — the build is offered
for every engine — rather than a constraint no project can satisfy, which would
have dropped it out of every install checklist without saying so. Where a build
is offered for every engine, the BuildId check still marks it if its binaries
were made for a different engine build.
