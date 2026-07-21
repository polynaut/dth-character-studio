---
'@dth/web': patch
'@dth/desktop': patch
'@dth/ui': patch
---

Folder moves now share one robust helper. Before any move, the app checks whether a file under the folder is open in Daz Studio or Houdini; if so, it shows a dialog — "some files are still open, close all Daz Studio and Houdini instances and press Continue" — listing the blocked files, with Continue (retry) and Cancel, instead of a half-finished move. The character page's folder chip gains an inline edit-to-move (the same move as Advanced options → Storage location), and abort actions (move Cancel, the export-directory Clear) now use a red "ghost" button so they read as undo/abort.
