---
'@dth/web': patch
---

fix(web): a Houdini project can no longer be generated over an existing one — the Generate dialog validates the name live (already-linked project or `<name>.hiplc` on disk → Generate disabled with an inline message, re-checked at click time), so a collision reads as form validation instead of an error toast. The dialog blurb also shrinks to the essentials ("Creates `<name>.hiplc` into `.\houdini` next to the project folder").
