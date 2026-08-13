---
'@dth/web': minor
'@dth/rom': minor
---

**A DTH Export run can be interrupted — it stops at the next point where
stopping is safe.**

Until now a started run had to be waited out. Holding **Ctrl** on the working
button offered **Abort** (Daz leg) or **Stop watching** (Houdini leg), and both
were honest about being escape hatches for the *studio*: they delete a job file
or drop a watch, while Daz keeps grinding through the batch and Houdini keeps
exporting. There was no way to say "stop".

There is now an **Interrupt** button beside the working button, through both
legs — no modifier, since stopping something you started is not an expert
manoeuvre. It stops the run itself:

- The **ROM build** stops between two ROM blocks — or between two custom
  frames, which the runtime checks about once a second.
- The **export that would have followed** is skipped, and so is every scene
  still queued behind it. A queued scene still opens in Daz (the Runner owns the
  batch and cannot be told otherwise) and then does no work.
- The **Houdini leg** stops between export nodes and closes its own background
  Houdini; projects still queued never start.

Everything already written stays where it is. Nothing is killed mid-write:
whatever synchronous call is running at that moment — a Daz scene load, one DTH
Exporter export, one DazToHue node — finishes first, which is why the button can
sit at **Stopping…** for a while on a long node. That wait is the price of
stopping cleanly, and the tooltip says so rather than promising an instant halt.

The report says **DTH Export interrupted**, and deliberately quotes **no scene
counts**: once the flag is down, a scene that exported and a scene whose script
skipped itself both come back as `done`, and the studio will not guess between
them. The character's ROM run log names the scene that was cut off mid-build.
An interrupted Daz batch also never continues into its Houdini projects — the
point of stopping is that the rest does not happen.

**The two Ctrl affordances are gone with it.** Both stopped the studio rather
than the run, which was all that was possible before — keeping them beside
Interrupt just put two stop-flavoured buttons on one run with nothing on them to
say which was which. The one thing only Abort could do — clear a job file that
nothing will ever finish, because a Daz stuck on a dialog reads no flag — is not
lost, it moved to where housekeeping belongs: **Settings → App Data** clears a
stuck batch handoff, exactly as it already did.

Mechanically it is one flag file in the character's meta folder that every
runtime the studio owns polls: the generated `.dsa` carriers, the DTH runtime
(now **v73** — regenerate, or Tools → Refresh assets, to get it) and the Houdini
runner. It is dropped when a run ends and cleared before every new one, so it
can never quietly skip a run nobody meant to stop. The Runner plugin needs no
change; the job-file contract documents the optional plugin-side half for later.
