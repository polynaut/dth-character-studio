---
'@dth/ui': patch
'@dth/web': patch
---

The busy accent bar animates with moving stripes — and keeps moving under reduced motion

The single travelling glint was the wrong shape for a 6px bar: most of each
cycle the bar looked idle (the glint was off-screen) and the moving edge was
too subtle to register. It is the barber-pole from the classic CSS-Tricks
progress bar instead — a 45° stripe pattern shifted one tile per cycle — so
something is always moving.

More importantly, the bar no longer switches its animation OFF under
`prefers-reduced-motion: reduce`; it slows down. The stripes are a background
image, so stopping them left a static striped bar that read as decoration while
the "this project is being re-read" signal was silently gone — which is what
happened on a Windows machine with Accessibility → Visual effects → Animation
effects turned off. A loading indicator is the essential-motion case.
