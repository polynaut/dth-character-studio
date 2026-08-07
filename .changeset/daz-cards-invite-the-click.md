---
'@dth/desktop': patch
'@dth/web': patch
'@dth/rom': patch
'@dth/ui': patch
---

The Daz installation cards now say what to do with them. They only changed on
hover, so two correctly-detected installations read as a status display and the
paths below stayed empty — the click that fills them was never asked for.

Each installation that isn't active now carries a visible **Activate** button,
and while none is active the section says so in a line: *"Pick the installation
your Daz paths should come from — they are filled in and saved the moment you
do."*
