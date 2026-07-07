---
'@dth/web': patch
---

**ROM editor: insert frames in place + sticky section titles.**

- Every pose row has a small `+` behind its frame number opening **Add before /
  Add after** right at the icon — a new frame slots in between existing ones
  (inheriting the neighbor's node), the new row's name field is focused
  immediately, and frame numbers simply renumber (computed from order, never
  stored).
- The ROM section titles (RET, JCM, FAC, …) are now sticky iOS-contacts style:
  the current section's title stays pinned below the page header while its rows
  scroll, and the next section's title pushes it out as it arrives — pure CSS,
  no scroll listeners.
