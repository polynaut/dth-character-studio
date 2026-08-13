---
'@dth/web': patch
---

Renaming a Houdini project keeps its scan. The stored verdict is keyed by path,
so a rename orphaned it and everything that reads a scan went back to "never
scanned" — which showed up as the DTH Export dialog no longer pre-selecting
Unreal projects, since it no longer knew which export sets those projects write.
The scan now follows the file, and the only cure before this — a Rescan nobody
had a reason to suspect — is not needed.
