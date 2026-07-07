---
'@dth/web': patch
---

**Insert ROM frames in place.** Every row in a ROM pose grid now has a small
`+` behind its frame number — it opens a tiny menu right there with **Add
before** / **Add after**, so a new frame can be slotted between existing ones
without appending at the end and dragging it up. The new pose inherits its
neighbor's node, and the frame numbers simply renumber (they're computed from
order, never stored).
