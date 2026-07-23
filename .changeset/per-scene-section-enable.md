---
'@dth/web': patch
---

feat(web): enable/disable a ROM section per Daz scene

Locking the section on/off toggle on a non-primary scene forced users to clear a
whole section's rows just to drop it for one outfit. The toggle is now live per
scene: flipping it stores a `sectionEnabled` override (only when it differs from the
primary), the section reads as overridden like any other field — the title carries
the green handle, and its reset restores the primary's on/off state. `applySceneOverride`
flips the base section's `enabled` per entry (mode/groups untouched), so a disabled
section drops from the scene's frames and CSV while an enabled one uses the base config.
Works for preset sections too — no need to have a custom row list to toggle.
