---
"@dth/web": patch
"@dth/ui": patch
"@dth/desktop": patch
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
body is inert (only the explicit open/install buttons act), and the path
line is now a real path chip (click = copy, Alt+click = Explorer) that
middle-ellipsizes long paths — at most 8 leading characters once truncation
kicks in, so the full .uproject file name keeps the budget. The avatar tile
background darkened from #565963 to #262626 (Daz renders the .tip.png
previews against a dark viewport — the light tile washed them out), the
header shrink animation's border shades follow, and every small avatar
preview now wears the same #2d2d2d border as the main header avatar.
Existing avatar masters are flattened onto the OLD colour — run Tools →
Refresh assets with Ctrl held once to re-derive them onto the new tile.
