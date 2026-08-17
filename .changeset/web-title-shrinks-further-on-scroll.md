---
'@dth/web': patch
---

The character name shrinks further when the editor header collapses on scroll —
the `dth-title-text` keyframes now end at 2rem instead of 2.75rem, giving the
form more room once you have scrolled past the avatar.

The animation's starting size is unchanged (3.25rem), so it still matches the
size the header renders the title at when it is expanded, and the transition
into the scroll timeline stays jump-free.
