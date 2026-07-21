---
'@dth/desktop': patch
'@dth/web': patch
'@dth/rom': patch
'@dth/ui': patch
---

Third full-codebase audit pass: a case-only character rename no longer deletes the just-written PoseAsset CSV, moving the scenes folder regenerates the scripts that embed scene paths, and the dedup report now marks the same keeper the install actually picks; menu actions hit only the focused window, the housekeeping sweep gained the same deletion rails as every other delete path, installs no longer hold every nested-zip inflation on disk at once, and saves stopped re-walking the library and rewriting the runtime scripts every time; clearing a pose-value cell reverts instead of committing 0, tab switches no longer trip a false unsaved-changes prompt, typing during a notes media drop is preserved, labels and errors are properly wired for assistive tech, Escape in a multi-select no longer closes the surrounding dialog, and a failed macOS build now blocks a release instead of silently shipping Windows-only.
