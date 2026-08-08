---
'@dth/web': patch
'@dth/desktop': patch
---

Adding a Houdini project asks the way adding a Daz scene does — and Generate stops throwing a console window at you

**No more copy toggle above the buttons.** It had to be answered before you had
even picked a file, and it hinted at a folder choice that does not exist. Now
picking a `.hip` from outside the character folder asks the same question a Daz
scene asks — **Copy in** (with *Delete original after copying* when you meant to
move it) or **Link in place** — and a `.hip` that already sits inside the
character folder is just linked, because there is nothing to decide. A copy
still always lands in the character's Houdini folder; the dialog says so instead
of offering a subfolder field with no answer.

**Generate project no longer pops a console window.** `hython` was started
without the flag that suppresses it, so a black window appeared on top of the
dialog and took focus mid-generate. The material-utilities runner had always
suppressed it; this one simply never did.
