---
'@dth/web': patch
---

Fix broken linked-asset cards (Daz scene / Houdini project cards rendered too
narrow with the open icon misplaced). The `@dth/ui` package's Tailwind `@source`
directive was missing, so utility classes used only in the kit — notably the
card's `w-80` and `group/card` — were never generated, collapsing the cards to
content width. Re-added the `@source` scan of `packages/ui/src`.
