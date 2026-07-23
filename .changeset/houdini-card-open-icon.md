---
"@dth/ui": patch
"@dth/web": patch
---

Houdini project cards now open only from the corner icon. A Houdini project has
no per-card state to select (unlike a Daz scene), so clicking anywhere else on
the card is a no-op instead of opening the project — and the inert card no
longer carries a redundant project-name tooltip.
