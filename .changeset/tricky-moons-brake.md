---
'@dth/web': patch
---

Changing the DTH Export dialog's **Mode** no longer throws away the scenes you
picked. Each mode has its own "outstanding work" rule and switching re-ran it
over the whole list, so choosing one scene and then switching to *Skip Daz*
re-checked every scene with an export on disk — and the Houdini list, which
follows the scenes, came with it. The pre-selection is a courtesy for a list
nobody has touched; once you have picked, it stays picked.
