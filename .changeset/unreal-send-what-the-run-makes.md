---
'@dth/web': minor
---

**The DTH Export dialog's Unreal section is one tick per project again — the
export-set list is gone.**

Under the Unreal projects there was a second tick list, one row per export set,
built from the character's `export/` folder — i.e. from what an EARLIER run had
produced. On a THICK variant whose Houdini project writes `LaraClassic_THICK`
and `LaraNaked_THICK` it offered `LaraClassic` and `LaraNaked`, because those
were the folders on disk. The sets the run was about to make were not in the
list at all, and since a ticked project with no ticked set held Start, the one
thing the list made impossible was the thing it existed for: putting a **new**
character into an Unreal project. It could only ever re-pick the past.

Nothing to pick now. What goes is the export sets this run puts in play — named
by the checked Houdini projects' own scan, or, under *Skip Houdini — use last
exports*, the exports already on disk. Whether each one refreshes what that
project has or arrives as a new character is worked out from the project's
`Content/`, as it always was, and the run's task list names every set with the
project it lands in. Ticking the project is the whole decision.

The project rows still pre-tick on "does it already hold what this run makes",
which is what keeps a variant from landing in Unreal unasked — but the answer is
now actionable either way. A Houdini project the background scan has never
reached still names nothing, so nothing pre-ticks and the section says plainly
that sending anyway hands over the whole export folder; one **Rescan** (Utils
drawer) narrows it back to what the run makes.

The standing line under the section — *"Queued for import when the whole export
finishes…"* — is gone with it. It described the feature to somebody who had just
ticked a box to use it. The section now says something only when it cannot send:
no export to send from, an empty export folder, Houdini projects that write no
set at all.
