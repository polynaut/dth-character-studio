---
"@dth/web": patch
---

The Unreal projects footer's "Add" button now stretches to the same height as
the linked project cards beside it (they share an `items-center` row), so it
reads as a sibling of the cards rather than a shorter afterthought. The `sm`
button's height floor is preserved for the empty "Link" state where no card
sets the row height.
