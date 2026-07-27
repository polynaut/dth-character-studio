---
"@dth/web": patch
"@dth/ui": patch
---

Dialog polish: all modals are roomier (the shared Modal default grew from
28rem to 36rem — full file paths and the Validation table no longer wrap or
cramp), the Validation table's permanent hint paragraph is gone — a FAILED
check row now explains itself on hover instead (what the check demands and
why), the create dialog's read-only Gender moved to its own row so it no
longer sits between two real selects looking like a broken one, and the
override handles (the small cube) on the editor's field labels only render
while a non-primary scene is selected — with the primary selected there is
nothing to override. The Unreal project cards were reworked too: the card
body is inert (only the explicit open/install buttons act), the folder line
is now a real path chip (click = copy, Alt+click = Explorer), and the path
middle-ellipsizes to a fixed width — ".uproject" stripped from the display —
so the drive and the project name both stay readable and every card lines up.
