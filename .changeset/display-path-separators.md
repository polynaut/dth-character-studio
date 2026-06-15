---
"@dth/web": patch
---

Display all filesystem paths with the OS-native separator. A new `displayPath`
helper rewrites every `/` and `\` to the current platform separator, so the
editor's definition path, the "Path in project" field, the generate output
folders, the projects overview, and Settings no longer show a wild mix of
forward and back slashes.
