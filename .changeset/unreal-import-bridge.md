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

**The DTH Export dialog carries it too.** Under the Daz scenes and the Houdini
projects there is now an **Unreal projects** section, so one Start does the
whole round trip: Daz builds the ROM, Houdini exports, and the result is queued
for import when the last project finishes. It pre-selects the same way the other
two lists do — a project that already holds this character comes ticked, one
that doesn't waits for you, because putting a character into an Unreal project
the first time is a decision rather than a continuation. The selection rides the
run's sidecars, so a window reloaded mid-export still sends.

**The Houdini Mode dropdown is down to two.** `Open only` opened a project and
ran nothing — the project cards already do that, and a mode that ran no pipeline
sat oddly in the dialog that runs the pipeline. `Export all` exported every
linked scene instead of the checked ones, which is what checking every scene in
the list directly above it means. Both are gone. In their place, and only when
the project has a linked `.uproject`: **Skip Houdini — use last exports**, which
runs no Houdini and hands what is already on disk to the Unreal projects. With
Daz skipped as well, that is a one-click "re-import this character in Unreal"
from the same dialog as everything else.

**Every export set goes, not "the" export.** A character's `export/` folder holds
one folder per HDA *character name* — measured, one character here has three
(outfit variants) — and the studio cannot predict those names. It scans for them
now; the first version guessed `DTH_<character name>.dth` and would have found
nothing at all on that character. One job carries every set.

**A second send re-imports what the project already has.** Before sending, the
studio searches the project's `Content/` for each export set's assets — they are
all named `<PREFIX>_<set>`, so it finds them wherever they were moved — and
names that folder in the job. The import then runs **there**, on top of the
existing assets, instead of building a second set under
`/Game/DazToHue/<Character>` and leaving you to reconcile them. Nothing found: a
fresh import at the default, exactly as before. The finish toast says which
happened and where.

It still imports the `.dth`, never the FBX files directly — the `.dth` is what
triggers the DazToHue pipeline, and importing the meshes on their own would lose
the materials, curves and anim blueprint it builds. The file list is for finding
assets, not for importing them.

Every Install rewrites the bridge, so a re-install refreshes it; and it lives in
its own plugin rather than inside the DazToHue one, which is beta and iterating
— nothing here forks or edits mrpdean's files. The studio reads the installed
bridge's version before sending, so an out-of-date one is named up front instead
of refusing the job from inside Unreal.
