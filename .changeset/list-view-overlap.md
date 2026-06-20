---
'@dth/web': patch
---

List view: the row action controls (rename/move buttons, selection checkbox) no longer overlap the row content (date, metadata). In list view they're now laid out as a flex sibling that reserves its own space, instead of being absolutely positioned over a fixed-width padding gap. Grid view is unchanged.
