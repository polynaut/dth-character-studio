---
"@dth/web": patch
---

Tidy the Settings page: the per-field/section help text now lives in an info ("i")
popup next to each title instead of as inline sub-text. `FolderField` shows one
popup (its rich `info`, falling back to `help`) and no longer renders a sub-line;
the General tab's field hints and the Refresh assets / App data folder / Network
drives section descriptions moved into popups beside their headings.
