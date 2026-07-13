---
'@dth/rom': patch
'@dth/web': patch
'@dth/desktop': patch
---

Block saving a character while a custom section has empty required fields (a pose
with no name, no morph, or an empty morph name), and jump straight to the problem:
the offending section opens, its pose row scrolls into view and the first empty
field is focused. A toast names the first error (or the count when there are
several).
