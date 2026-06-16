---
"@dth/web": patch
---

The character editor's header (avatar + title) now sticks to the top of the
viewport as the form scrolls beneath it (the Back / Discard / Save row above it
scrolls away normally). The avatar also **shrinks over the first ~300px of
scroll and then settles**, so the pinned header collapses to a compact bar — a
pure CSS scroll-driven animation, which simply no-ops on browsers without scroll
timelines.
