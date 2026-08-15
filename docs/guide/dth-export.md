# The DTH Export batch

Running the ROM script in Daz yourself is one way
([Build the ROM in Daz Studio](./05-rom-in-daz.md)) — the **DTH Export** button
in the character header does the whole round trip for you instead: every scene
you pick gets its ROM built and exported in Daz, the Houdini projects that read
those exports run their own DazToHue exports straight afterwards, and a finished
export can be queued for re-import into a linked Unreal project.

One run, one report. This page is that button.

<p align="center">
  <img width="900" alt="the DTH Export panel — Daz scenes and Houdini projects, each with their Mode" src="screenshots/dth-export-panel.png" />
  <br>
  <sub><em>Pick the Daz scenes and their run, then the Houdini projects that carry on with the results.</em></sub>
</p>

**Daz scenes** lists every linked scene; the ones with outstanding work come
pre-checked (the wand picks a single scene, a double-click selects all). The
**Mode** below the list decides what their run does:

- **ROM + Export** — the full run: a fresh ROM, the saved ROM animation scene,
  and the export of everything (skeletal mesh and hair).
- **ROM only** — build the ROM and save the
  [`rom-animations` scene](./05-rom-in-daz.md#direct-export-optional-recommended),
  skipping the export entirely.
- **Export only** — export the saved ROM animations as they stand, hair
  included, without rebuilding them. This is the one for a ROM you tweaked by
  hand in Daz: it pre-selects exactly the scenes whose ROM animation is newer
  than their last export, and skips scenes that have no ROM animation yet.
- **Skip Daz — use last exports** — nothing runs in Daz at all: the Houdini
  projects below work off each selected scene's **last Daz export** as it
  stands on disk. For when the Daz side hasn't changed and only Houdini needs
  a fresh pass. Scenes that never delivered an export are kept out of the run
  (there is nothing to rely on).

**Houdini projects** lists the character's linked projects the same way — the
ones that carry on with the results once the Daz side is done. They come
pre-selected whenever scenes are, so a plain **Start** does the whole round
trip; untick them and the run ends with Daz. Their own **Mode**:

- **Export selected scenes** — the default: run the projects' DazToHue
  exports for the checked Daz scenes.
- **Skip Houdini — use last exports** — run no Houdini at all and hand the
  exports already on disk to the Unreal projects below. Offered only when the
  studio project has a linked `.uproject`, since without one it would mean
  "do nothing".

**The project list follows the scene selection.** Untick a Daz scene and the
projects that only import *that* scene leave the run with it; tick it back on
and they return. The match is the one Houdini itself makes at export time — a
project belongs in the run when one of its networks imports a selected scene's
`.dth` file — so what the panel shows and what the run exports can't disagree.
Names are deliberately not consulted: networks and projects get renamed and
copied around, the import path doesn't. A project only ever *leaves* the run
when its imports actually name a scene you unticked; one the background scan
hasn't reached yet, or whose imports match none of this character's scenes
either way, keeps whatever you have — the studio can't know there, and quietly
dropping a project would skip the Houdini half of a run you asked for.

Several selected projects run **one after another**: each loads and exports,
then the next starts — the outcome waits for the single report at the end.

**ROM only** is the exception: it builds no fresh export, so there is nothing
for a Houdini export to pick up — the projects don't pre-select there, and the
export mode is disabled.

> To just **open** a Houdini project, use the open button on its card — the
> panel runs the pipeline, and a mode that ran nothing sat oddly in it. And
> "export every scene" is what checking every scene in the list above means, so
> that mode is gone too.

**Unreal projects** is the third leg, and appears once the studio project has
[linked `.uproject` files](./03-first-project.md#linking-unreal-projects). Tick
one and the finished export is **queued for import** when the whole run ends, in
one job. Nothing waits on Unreal: the job is a file, and the project's
[DTH Character Studio Runner](./06-into-houdini.md#send-to-unreal) picks it up whenever
that editor is next open.

**The project is the only thing you tick.** Which export sets go is worked out,
not asked: the ones the checked Houdini projects write (their export nodes name
them, read when the project is scanned), or — under *Skip Houdini* — the exports
already on disk. Whether each one is a refresh of what that project has or a new
character in it is worked out too, from the project's own `Content/`, and the
run's task list names every set with the project it lands in once you press
Start.

Like the other two lists, it **pre-selects what the run is for**: a project that
already holds one of the sets this run makes starts ticked (it is a refresh).
The send is **re-import only** — it lands an updated export on assets that are
already in the project. A project that holds nothing this run makes has nothing
to re-import, so its row goes inert and says so: a character's **first import**
into an Unreal project is made in Unreal itself (open the project and import the
DazToHue `.dth` once — that is where you decide where in the project the
character lives). From then on, runs re-import it in place, wherever you put it.

A Houdini project the background scan hasn't reached yet says nothing about what
it writes, so nothing is pre-ticked and the section says so: send it anyway and
**everything** in the export folder that the project already holds is
re-imported. **Rescan** those projects (Utils drawer) and the run sends only
what it makes.

The section needs somewhere to send from: tick a Houdini project to export
first, or pick **Skip Houdini — use last exports** to send the exports already
on disk.

Press **Start**: the panel closes at once and the batch is handed to Daz Studio,
where the bundled [**Runner plugin**](./02-setup.md#daz-studio-plugins)
works through it unattended — every scene gets its full ROM build, export and
delivered CSV, exactly as if you had run the scripts by hand. A closed Daz is
**opened where you can see it**: this is a run you are watching, and a visible
window is the difference between a launch that worked and one that silently
didn't. A running Daz picks the batch up by itself and is left exactly as you had
it.

> An unattended **scan** is the other case and still starts Daz **minimized** —
> [Tools → Scan project](./tools.md#tab-1--scan-amp-index) and the
> [morph scan](./custom-morphs.md) are meant to stay out of your way.

The panel refuses to start while the Runner plugin is missing or older than
the one bundled with the app — the notice links straight to Settings to update
it first. (A skip-Daz run doesn't need the Runner at all.)

## Watching the run

The character header becomes the run's own display for as long as it lasts:

<p align="center">
  <img width="900" alt="the character header mid-run — the run's task list and its progress bar" src="screenshots/dth-export-running.png" />
  <br>
  <sub><em>The live pipeline: one list of what the run does, and how far through it is.</em></sub>
</p>

- **One task list**, numbered in run order and stacked **bottom-up** like a
  log — the first job sits at the bottom, later ones pile above it, and the
  row being worked stays at the bottom edge right above the bar while finished
  rows slide below the fold. **One row per job**, which is what makes it worth
  reading:
  - every selected **Daz scene**, saying what the run does to it (*ROM +
    Export*, *Export only*, …);
  - every **DazToHue network**, not merely every `.hip` — a project holding two
    networks is two rows, each named as the network is, with its project beside
    it;
  - every **export set going into an Unreal project** — two characters
    re-imported into the same project are two imports, so they are two rows,
    each saying *Re-import* and which project it lands in. A set the project
    has never held is not sent (and gets no row): the report names it instead,
    since its first import is made in Unreal itself.

  The row being worked spins; a finished one is ticked off and stays, so the
  list reads as the whole run rather than only what is left. The mark on the
  right is the application doing it.
- **One progress bar** underneath, across the whole run, with the **newest thing
  the run said** printed on it as a single line. The Daz scripts report each step
  as they start it *and* as it lands (*generating ROM* → *ROM generated*); the
  Houdini leg passes on the DazToHue HDA's own output; the Unreal leg says when
  the job was queued and how the import ended.

Only the newest line is shown. The full output of each leg stays on disk, which
is where a post-mortem is read from anyway: the Runner's progress log, the
Houdini console log (`.dth_houdini_console.log` in the character folder) and the
Unreal editor's own log.

The button beside it simply reads **Working** with the elapsed time; the numbers
live in the display. Nothing is announced mid-run: **one report** at the very
end covers both legs, with any per-scene failures and the total time, and stays
on screen until you close it (or start a new run).

**A run that produced nothing is never reported as a success.** The Runner's
contract ends at *"the script I started returned"*, so a scene whose generated
script refused the scene, bailed for want of the DTH runtime, or failed mid-ROM
comes back looking exactly like one that exported. The report reads the
character's own **ROM run log** as well — the channel the Daz scripts themselves
write, shown on the character page under the run report — counts those scenes as
**failures**, names them — and when nothing survived, the Houdini and Unreal legs
are **held back** rather than run against files that were never written.

One thing deliberately does *not* count as a failure: a **morph that could not be
applied**. Its frame stays in the ROM (empty) and the export still runs, so a
scene whose only problem was a missing dial is still a scene that exported.

> **"The DTH runtime could not be loaded"** now says what it found rather than
> guessing. A runtime file that is **missing** gets the reinstall advice
> ([Tools → Refresh assets](./tools.md#tab-3--refresh-assets)); one that is
> **present** gets *run the export again* — Daz failed to load a file that is
> there, which reinstalling does not fix. A failed script include logs nothing at
> all in Daz, so this report is the only evidence such a run leaves behind.

**The working button is also the interrupt.** Hover it while a run is live and
its spinner becomes a stop mark — *Click to interrupt* — through both legs. It
is the one control that reaches into the work rather than into the studio's
view of it:

- The **ROM build stops** where it happens to be — between two ROM blocks, or
  between two custom frames.
- The **export that would have followed it is skipped**, and so is every scene
  still queued behind it. A queued scene still opens in Daz (the Runner owns the
  batch and can't be told otherwise), it just does no work.
- The **Houdini leg stops between export nodes** and closes its own background
  Houdini; projects still queued never start.
- The report says **DTH Export interrupted**, never *"n scenes exported"* —
  after an interrupt the studio can no longer tell a scene that exported from
  one that was skipped, so it doesn't guess. The character's ROM run log names
  the scene that was cut off mid-build.

What is already written stays. And what the interrupt cannot do is cut a
*synchronous call inside someone else's plugin* short: a Daz scene load, one DTH
Exporter export, one DazToHue node. Whichever of those is running finishes first
— that wait is the price of stopping cleanly instead of killing a process
mid-write, so on a long node the button can sit at **Stopping** for a while.

A click never merely drops the studio's *watch* on the run (a stray one used to,
which read as *"the export vanished"*): the one thing the button does while a
run is live is ask the run itself to stop, and it says so before you click.

> **If a run is stuck rather than running** — Daz sitting on a dialog, or a
> batch this window is only *showing* and can never finish — nothing is left to
> read the interrupt. That is housekeeping, not a run control:
> [Settings → App Data](./02-setup.md#the-app-data-tab) clears a stuck batch
> handoff, so the next export isn't refused with *"a batch is waiting for Daz
> Studio"*. (Before v0.77 that same clean-up hid behind **Ctrl** on the progress
> button, as **Abort** / **Stop watching**. Both stopped the studio rather than
> the run — which was all that was possible then.)

Before Daz has picked the batch up at all the button reads **Abort** without any
modifier: nothing has started yet.

**Reloading the app doesn't lose the run.** Every handoff writes its plan down
beside its own files, so the character's editor picks the run back up when it
opens: the elapsed clock, the task list, the Houdini projects still to come and
the report so far. Any *other* window shows the same run read-only.

## Carry on into Houdini

With Houdini projects selected in an exporting mode, the round trip's last
manual step is gone — each project **runs its own DazToHue exports** for the
scenes in scope, right after the Daz batch delivers (or immediately, with
**Skip Daz**).

What happens:

1. Daz finishes the batch and the Houdini leg starts straight away — the report
   waits until the *whole* round trip is done.
2. Houdini runs the project **headless**: `hython` loads it in the background,
   works the batch and exits again. No window opens, so there is nothing to wait
   for while a big project loads and nothing of yours to close — the task list
   in the header is where you watch it. Want a project open to work in instead?
   Open it from its card on the character page; this panel runs the pipeline.
3. Only the networks importing **the scenes you ticked** export. A project
   holding networks for other scenes — or other characters — is left alone.
4. After the last project, **one report** names every leg — *"Daz: 2/2 scenes
   exported in 3m 10s"*, then a line per Houdini project (*"Kira_Look: 2
   exported, 1 skipped"*) — under a single *DTH Export finished in …* headline
   with the total time.

Two things it deliberately won't do:

- **Overwrite an export directory you configured.** A node with one set exports
  where you told it to; only a blank one is filled in from the run.
- **Save the project.** Nothing about your `.hip` changes on disk — any
  parameter it touches is put back afterwards.

If the DazToHue pre-flight check reports problems, the studio answers its
*"Continue anyway?"* prompt for you and **keeps the message**, so those
problems reach the report instead of vanishing behind an unattended dialog.

Everything Houdini printed on its way through — the HDA's own output and
Houdini's console chatter with it — lands in **`.dth_houdini_console.log`** in
the character folder. It is deliberately *not* cleaned up with the run's other
files: it's the file to open when a run did something puzzling (a run that
matched no export nodes records exactly what it looked for and what it found),
and it is one file per character, overwritten by that character's next run.

&nbsp;

[← Build the ROM in Daz Studio](./05-rom-in-daz.md) · [Next: Into Houdini →](./06-into-houdini.md)
