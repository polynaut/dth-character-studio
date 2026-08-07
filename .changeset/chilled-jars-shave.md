---
'@dth/desktop': minor
'@dth/web': minor
'@dth/rom': minor
---

The app's own files leave your character folders

A character folder collected five files nobody put there: `.dth_execute_stamps.json`,
`.dth_export_folders.json`, `.last_rom_run.json`, the Daz-written
`dth_rom_run_log.json`, and the generated `<Name>_pose_asset.csv`. All of them are
the studio talking to itself, and they sat right next to your Daz scenes and
Houdini projects.

They now live in the project's hidden meta folder, one folder per character:
`<project>/.dcsmeta/characters/<Character>/` — beside the avatars and note media
that were already there. Your character folder holds the definition and your own
files, nothing else.

**The move happens on its own.** Every save relocates that character's files; one
**Tools → Refresh assets** does the whole library (the script runtime bumped to
v59, so every character reads as out of date until it has run). The relocation
only ever touches names the studio itself wrote for that character — a CSV you
copied back out of an export folder is left exactly where you put it.

If you take the PoseAsset CSV by hand (no direct export), it is now at
`<project>/.dcsmeta/characters/<Character>/<Name>_pose_asset.csv`.
