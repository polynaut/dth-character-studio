---
'@dth/web': minor
---

Refresh assets offers to carry a new DazToHue release into your Houdini projects

A refresh only ever fixed half the pipeline. Your `.hip` files keep the DazToHue
asset definitions they were built with, so a new DazToHue release left every
project on the old ones until you opened each one in Houdini and pressed
**Refresh Assets** on the shelf. The studio could already run that tool headlessly
for one character (Utils → Refresh assets); it just never connected the two ends.

Now, when **Tools → Refresh assets** notices the DazToHue release has changed
since it last looked, it offers to sweep every linked Houdini project through
DazToHue's own tool — all of them, in one `hython` run, without opening Houdini.
The offer needs the Houdini installation folder and its matching documents folder
in Settings; without them it stays away.

It is still not a check, and does not pretend to be one. Nothing in a `.hip`
records which DazToHue release its assets came from, so what the studio keeps is
only its own record: which projects **it** has run this on, and under which
release. A project it has never swept reads as *"never refreshed by the studio"* —
the absence of a verdict, not a verdict. A project already refreshed under the
active release is skipped and said to be skipped.

The parts that decide what happens next are built so a bad run cannot strand
work. Dismissing writes nothing, so the offer returns on the next refresh. A
sweep where any project fails records the ones that worked but leaves the release
outstanding, so the next refresh re-offers exactly the remainder — the usual cause
of a failure here is DazToHue not being installed for the Houdini version the
studio points at, which is something you fix and then expect to retry.

Each project is copied into its `backup/` folder before it is saved, and this
report keeps **Undo this run** on the projects that succeeded, not only on the
ones that failed: putting one project back on the previous DazToHue release is a
want that arrives days later. Undoing also makes the studio stop counting that
project as refreshed, so it comes back into the offer instead of quietly reading
as done while sitting on the old assets.

That copy is **rolling — one per project** — so saving a project replaces whatever
is already beside it, which is precisely the copy somebody kept in order to go
back a release. It would have gone silently, inside a run started by a button
labelled "Refresh". Now it doesn't: if any project the sweep would touch already
has a studio backup, the dialog says so in red, lists them with their dates, and
**refuses to start** until you accept. Only the projects the run actually saves
lose their old copy — one that reports no change, or that fails, keeps what it
had — and a **dry run** is never held and never touches a backup at all.
