---
'@dth/desktop': patch
'@dth/web': patch
'@dth/rom': patch
'@dth/ui': patch
---

Fixes DTH Export batches losing every scene's problems but the last one.

A batch runs one row per Daz scene and each row's script wrote the same
per-character run log, truncating it — so after exporting three scenes, the
studio only ever showed the problems of whichever scene ran last. Failures in
the earlier scenes were destroyed silently, and there was nothing in the log
saying which scene a failure came from.

The log now keeps one entry **per scene**. The problem report groups failures
under the scene that produced them, and clicking one **switches to that scene**
before jumping to the frame. The red row markers in the ROM sections are scoped
to the selected scene too — that was an outright wrong-row bug, since a scene
override can reorder, insert and delete ROM frames, so frame 40 in one scene is
a different pose than frame 40 in another.

Logs written by an older runtime still report as before.
