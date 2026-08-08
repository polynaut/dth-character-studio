---
'@dth/web': minor
'@dth/ui': patch
---

Unlinking a scene and unlinking a Houdini project now work the same way

The two remove dialogs asked the same question in opposite directions. A Daz
scene offered **“Delete file on disk”**, off by default; a Houdini project
offered **“Keep houdini files”**, on by default — the same choice, inverted, in
different words, next to a button that said *Unlink* either way. They read as
two unrelated features.

They are one dialog now, with one toggle in one direction, and the confirm
button says what will actually happen:

- **A file inside the character folder** — the studio's own copy, put there when
  you created, copied or generated it — defaults to **Remove**: the card goes
  and the file goes with it. Turn the toggle off and it becomes an *Unlink*.
- **A file linked in place**, in your own tree, can only ever be **Unlink**. The
  toggle is shown but locked off, so “this one can't be deleted” is visible
  rather than a silently missing option.
