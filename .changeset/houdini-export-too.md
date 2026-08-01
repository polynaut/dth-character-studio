---
'@dth/desktop': minor
'@dth/web': minor
---

**"Export too" — the Daz batch now carries on into Houdini.** Pick a linked
Houdini project under *Open Houdini project after export* in the DTH Export
dialog and a new **Export too** switch appears beside it. Leave it on and the
project doesn't just open when the batch finishes — it runs its own **DazToHue
exports** for the scenes you ticked, which was the last step you still had to do
by hand, per network, every time.

The button keeps reporting: **Houdini opening…** while the scene loads, then
**Houdini 1/3** as nodes finish, then the outcome (*"2 exported, 1 skipped"*).
Houdini stays open with the project ready to work in.

It is off by default — it drives your Houdini, so you opt in — and it is
deliberately careful with the project: only the networks importing the selected
scenes run (one holding other characters' networks is untouched), an
`export_directory` you configured is never overwritten (only a blank one is
filled from the run), and the `.hip` is never saved. If the DazToHue pre-flight
check raises problems, its *"Continue anyway?"* prompt is answered for you and
the message is **kept**, so it reaches the report instead of vanishing behind an
unattended dialog.

Needs the Houdini installation folder and a matching Houdini documents folder in
Settings — the same pair *Generate project* already requires.
