---
'@dth/web': minor
'@dth/desktop': minor
---

**Setup DTH Release** split into two independent installs, each with its own Dry run / Install buttons placed directly under its destination folder field: **Daz content** under "My DAZ 3D Library", **Houdini assets** under "Houdini documents folder". Each half is enabled by its own prerequisites (a resolved DTH release + its destination folder), so you can install only the Daz side or only the Houdini side. The Daz install still re-scans the release's poses on success; the native `install_dth_release` command gained a `target` selector (`daz` / `houdini` / `all`).
