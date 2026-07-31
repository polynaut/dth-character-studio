---
'@dth/rom': minor
'@dth/web': minor
---

feat: the saved-ROM folder is `rom-animations`, and `dth-exports` can't be taken by a scene

The folder holding your saved ROM animations was hidden and called `.ROM_Animations` — odd for a folder whose whole purpose is scenes you open by hand. It's now a normal visible `rom-animations/`, matching the naming of the other studio folders (`dth-exports`, `houdini-project`). An existing `.ROM_Animations` beside a linked scene is renamed for you the next time the character is saved, so nothing already saved is orphaned; if both folders somehow exist, the old one is left alone rather than merged.

Scene subfolders can no longer be named **`dth-exports`**. That name belongs to the character's export root, which sits at exactly the level scene subfolders do, so a scene moved there would have fought the studio for the same directory. It's refused wherever a subfolder is chosen — adding or replacing a scene with a copy, and renaming one from its card. (`rom-animations` needs no such rule: it lives inside each scene's own subfolder, one level below where a collision could happen.)

Runtime v48 — Refresh assets regenerates the scripts and performs the rename.
