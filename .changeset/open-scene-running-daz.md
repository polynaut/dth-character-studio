---
'@dth/desktop': minor
'@dth/web': minor
'@dth/rom': minor
---

Opening a linked Daz scene now works while Daz Studio is already running. Daz
(DS 6) silently ignores scene files forwarded to a running instance — Explorer
double-click does nothing either. The studio detects the running instance and
routes the open through a one-shot script instead, which Daz forwards and
executes: the scene opens inside the running instance, with Daz's normal
unsaved-changes prompt. No instance running → unchanged direct open.
