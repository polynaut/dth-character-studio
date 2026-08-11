---
# minor: a new user-facing capability on both sides — the Unreal install grew
# from a one-shot content copy into a dialog with plugin matching, Settings
# gained two panels + a settings field, and the desktop crate gained four
# commands (engine detection, plugin scan, project state, plugin install).
'@dth/web': minor
'@dth/desktop': minor
---

Unreal Engine plugins, an install dialog, and Generate Unreal project.

**Settings → General** gains two panels: **Unreal Engine** lists every engine
the Epic launcher has installed (informational — a `.uproject` names its own
engine, so there is nothing to activate), and **Unreal Engine Plugins** holds
the folders the studio scans for UE plugins — a plugin folder, a folder of
plugins, or a multi-build root like `DazToUnrealBridge\UE_5.7\Plugins`, with a
per-folder preview of every recognized build and the engine version it was
matched to (from the path, deepest segment first, else the `.uplugin`'s
`EngineVersion`; none = offered for every engine).

**The Unreal card's install button now opens a dialog**: DTH content plus every
plugin build matching the project's engine version — read from its `.uproject`
when the dialog opens — all pre-checked, uncheck what you don't want, one
primary **Install**. Checked items overwrite what is there (copy-over, never
delete-first); the old Ctrl+click-to-overwrite is retired with the dialog
carrying that intent explicitly. A source-build GUID association lists every
build unchecked instead — only the user knows what fits it.

**Generate Unreal project** (the bar's ✨) creates a fresh Blueprint-only
project bound to a detected engine version, installs the checked DTH content +
plugins into it in the same run, and links it — a DTH-ready Unreal project
without opening Unreal first. Opening the generated project in Unreal itself
has not been verified on a real engine install yet.
