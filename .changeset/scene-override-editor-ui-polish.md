---
'@dth/web': patch
---

feat(web): scene-override editor UI polish

Clearer per-scene override state in the character editor, and no layout shift
when switching to a non-primary scene:

- ROM section titles carry the override mark at the END of the title, and it goes
  green whenever the section diverges from the primary in ANY way — a per-row
  value edit, an added frame, or a whole-section escalation. Its reset clears
  every override kind at once.
- An overridden section brightens its whole title row to white; overridable field
  labels dim to gray until overridden, then go white too.
- Added frames now show the same reset handle + bin as edited base rows, plus a
  green "*" new-row marker. The reset button's footprint and the name marker slot
  are reserved on every row, so scene switches (and a row becoming overridden)
  never shift the grid in X.
- The sticky page header now sits above inline info popups (still below dialogs),
  so a popup reaching into the header is covered instead of floating over it.
- The Unreal projects footer keeps a constant height whether empty or filled, and
  its add trigger is an icon-only "+". The footer scene ring sits flush (0 offset).
