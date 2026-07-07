---
'@dth/desktop': patch
'@dth/web': patch
'@dth/rom': patch
---

Opening linked Unreal projects works now — the desktop shell-open scope only
allowed `.duf`/`.hip` files (and https links), so clicking an Unreal card,
Ctrl+clicking a path chip (folder reveal) or opening non-image note media was
silently refused. The scope now covers `.uproject`, folders, and the common
image/video/audio/document/3D media formats (executables stay refused), and
those open actions surface errors as a toast instead of doing nothing.
