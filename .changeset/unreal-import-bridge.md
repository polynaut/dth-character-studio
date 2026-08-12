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
side that "other side" is a small **bridge plugin** the studio installs into the
project — `Plugins/DTHStudioBridge`, content-only, pure Python — which watches
`Saved/DTHStudio/job.json` and runs the import. The import itself is
**mrpdean's DazToHue pipeline, unmodified**: meshes, textures, materials,
animation curves, the post-process anim blueprint. The bridge decides only
*when*.

**The studio never starts Unreal.** An editor takes minutes to come up and holds
its project, so a "launch it and wait" leg would be worse than useless — and a
headless commandlet writing into `Content/` behind a running editor is worse
still. The job is queued instead: an open editor picks it up within about a
second, and one opened later claims it on startup, exactly like a Daz that was
closed when a batch was queued.

The bridge is rewritten into the project on every send, so a project can never
hold a bridge older than the app talking to it. It lives in its own plugin
rather than inside the DazToHue one, which is beta and iterating — nothing here
forks or edits mrpdean's files.
