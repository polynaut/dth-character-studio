---
"@dth/web": patch
---

Settings page tidy-up: per-**field** help text now lives in an info ("i") popup
next to the field's label instead of as an inline sub-line — `FolderField` shows
one popup (its rich `info`, falling back to `help`) and the General tab's
subfolder fields got the same. Section intros stay as visible subtitles. The
Exporter install's "close all Daz/Houdini apps and restart as administrator"
guidance now shows only when an install actually fails, styled as an error.
