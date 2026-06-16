---
"@dth/web": patch
---

Display all filesystem paths with the OS-native separator. A new `displayPath`
helper rewrites every `/` and `\` to the current platform separator, so the
editor's definition path, the "Path in project" field, the generate output
folders, the projects overview, and Settings no longer show a wild mix of
forward and back slashes.

Paths rendered as code chips are now click-to-copy via a shared `PathCode`
component: clicking the chip copies the full path to the clipboard, with a copy
icon that overlaps the top-right corner on hover.
