---
"@dth/web": minor
"@dth/desktop": minor
---

Adding another Daz scene to a character now pauses on a Validation table
(styled like the Refresh-assets version table) that checks the picked scene
before it links: same Genesis generation as the character, exactly one
character in the scene, an empty animation timeline (the generated ROM script
fills the timeline itself), and the same genital geograft (Golden Palace /
Dicktator) as the primary scene — the closest checkable proxy for "same
gender". Different hair, clothing and props stay untouched: outfit variants
are what extra scenes are for. A failed check blocks the add behind an
explicit "Add anyway" switch; a scene the studio can't read degrades to
"unchecked" and never blocks. The native `scene_wearables` read now also
reports every figure root and the timeline occupancy to power the checks, and
a scene already inside the character folder gets the same dialog (it used to
link silently).
