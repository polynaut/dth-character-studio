---
'@dth/web': minor
---

**The DTH Export dialog's Unreal section lists what the run sends, instead of
asking you to pick from what a previous run wrote.**

Under the Unreal projects there was a second tick list, one row per export set,
and it was built from the character's `export/` folder — i.e. from what an
EARLIER run had already produced. On a THICK variant whose Houdini project
writes `LaraClassic_THICK` and `LaraNaked_THICK` it offered `LaraClassic` and
`LaraNaked` to tick, because those were the folders on disk. The sets the run
was about to make were not in the list at all, and since a ticked project with
no ticked set held Start, the one thing the list made impossible was the thing
it existed for: putting a **new** character into an Unreal project. It could
only ever re-pick the past.

The list is gone. What is left says what Start does: the export sets this run
puts in play — named by the checked Houdini projects' own scan, or, under *Skip
Houdini — use last exports*, the exports already on disk — each with the content
folder it lands in. A set the ticked project already keeps is refreshed where it
is; one it has never seen shows the `/Game/DazToHue/<Set>` it will be created
in. Ticking the project is the whole decision.

The project rows still pre-tick on "does it already hold what this run makes",
which is what keeps a variant from landing in Unreal unasked — but the answer is
now actionable either way. A Houdini project the background scan has never
reached still names nothing, so nothing pre-ticks and the section says plainly
that sending anyway hands over the whole export folder; one **Rescan** (Utils
drawer) narrows it back to what the run makes.
