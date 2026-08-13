---
'@dth/web': patch
---

The export run's task cards name every Houdini network, not just the finished
ones. A project with two DazToHue networks showed the first by name and the
second as "Network 2" — a count, where the user has a name for it. The run
already knew both the moment it collected them, so it says so up front, and the
card carries the title of the **network box** around each one: the nodes are all
`DazToHueExport`, `…1`, `…2`, so the box title is the only human-meaningful name
a multi-network project has.
