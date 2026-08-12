---
'@dth/web': minor
---

**Unreal plugins are checked against the engine's actual build, and engines the registry forgot are found.**

Two fixes for one real failure: a freshly generated project, everything
installed by the studio, and Unreal opening on *"The following modules are
missing or built with a different engine version"*.

**Engine detection now reads Epic's `LauncherInstalled.dat` as well as the
registry.** Measured: a machine with 5.6, 5.7 and 5.8 installed had **no
registry key for 5.8** — so the studio never offered it, the project was
generated for 5.7, and Unreal 5.8 opened it and rebound it. Both sources are
merged, the registry first.

**A plugin build is now judged by its `BuildId`, not by its folder name.** Every
built plugin carries one in `Binaries/Win64/UnrealEditor.modules`, and Unreal
refuses to load a plugin whose id differs from the engine's — that is exactly
what the missing-modules dialog is. The studio reads both (for a zipped plugin,
straight out of the archive — nothing is extracted) and marks a mismatched build
**built for another engine build**, leaving it unchecked rather than installing
something that cannot load.

This catches the case a version label structurally cannot. The plugin that broke
the run above was in a folder called `KawaiiPhysics_5_7_1_…` — a version written
with underscores, which reads as *no version signal at all*, so it matched every
project including a 5.8 one while its binaries were 5.7. A folder name is a
label; the BuildId is the engine's own identity check.

It warns rather than refuses: a mismatch is left listed and unchecked, because
you may know something the BuildId doesn't. And it never guesses — a plugin with
no binaries, or an engine whose id cannot be read, is never called a mismatch.
