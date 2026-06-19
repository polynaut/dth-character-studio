---
"@dth/web": patch
---

Settings page tidy-up: per-field help text now lives in an info ("i") popup next
to its label instead of as an inline sub-line — `FolderField` shows one popup
(its rich `info`, falling back to `help`), the General tab's subfolder fields got
the same, and the General tab's section blurbs (Refresh assets, App data folder,
Network drives) moved into popups next to their headings. The DazToHue tab's
multi-step setup intros stay as visible subtitles. The Exporter install's "close
all Daz/Houdini apps and restart as administrator" guidance now shows only when
an install actually fails, styled as an error.
