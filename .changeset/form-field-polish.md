---
"@dth/web": patch
---

Form-field polish: lighter input backgrounds in dark mode (Input, MultiSelect,
Select and Textarea move from `bg-input/30` to `/50`); the `NumberField` "%" suffix
now fades together with its number when the field is disabled (a locked
preserve/identity fieldset); and the "Hair items" label sits tight to its field
like every other field's label — the override toggle is absolutely positioned so
its height can't inflate the label row.
