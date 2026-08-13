---
'@dth/web': minor
---

**Send a character to Unreal — the third leg of the round trip.**

Daz builds the ROM, Houdini bakes it and exports for Unreal, and until now
somebody dragged the result into the editor by hand. A new **Send to Unreal**
panel on the character page (under the Houdini projects, and only when the
project has a linked `.uproject`) hands that export over.

It is the same handoff the other two legs use: the studio writes a job file,
the other side claims it by rename, the studio polls a result. On the Unreal
side that "other side" is a small **bridge plugin** — `Plugins/DTHStudioBridge`,
content-only, pure Python — which watches `Saved/DTHStudio/job.json` and runs the
import. The import itself is **mrpdean's DazToHue pipeline, unmodified**: meshes,
textures, materials, animation curves, the post-process anim blueprint. The
bridge decides only *when*.

**The bridge installs like any other plugin**, from the project card's install
dialog, where it is pre-checked next to DTH content — a plugin in your own
Unreal project is something you tick, not something that appears because you
sent a character. Sending to a project without it says exactly that. Unreal
loads plugins at startup, so the editor wants one restart after installing it —
which is where a restart is expected anyway.

**The studio never starts Unreal.** An editor takes minutes to come up and holds
its project, so a "launch it and wait" leg would be worse than useless — and a
headless commandlet writing into `Content/` behind a running editor is worse
still. The job is queued instead: an open editor picks it up within about a
second, and one opened later claims it on startup, exactly like a Daz that was
closed when a batch was queued.

**A second send re-imports what the project already has.** The job carries the
FBX files the export produced — the `.dth` names them — and the bridge looks for
them in the open project before importing anything. Found, wherever they are:
the import runs in **that** folder, on top of the existing assets, instead of
building a second set under `/Game/DazToHue/<Character>` and leaving you to
reconcile them. Not found: a fresh import at the studio's destination, exactly
as before. The finish toast says which happened and where.

It still imports the `.dth`, never the FBX files directly — the `.dth` is what
triggers the DazToHue pipeline, and importing the meshes on their own would lose
the materials, curves and anim blueprint it builds. The file list is for finding
assets, not for importing them.

Every Install rewrites the bridge, so a re-install refreshes it; and it lives in
its own plugin rather than inside the DazToHue one, which is beta and iterating
— nothing here forks or edits mrpdean's files. The studio reads the installed
bridge's version before sending, so an out-of-date one is named up front instead
of refusing the job from inside Unreal.
