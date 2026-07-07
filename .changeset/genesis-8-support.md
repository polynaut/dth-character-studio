---
'@dth/rom': minor
'@dth/web': minor
'@dth/desktop': minor
---

Genesis 8 / 8.1 support. Both generations are now selectable for characters;
everything is driven by what the installed DTH release actually ships per
generation: G8.1 gets the full JCM (DQS/Linear) + FAC flow, plain G8 is
Linear-only (no DQS/FAC assets exist), and Golden Palace / Dicktator / Physics
remain G9-only — enabling a section whose asset doesn't exist for the
generation fails loud with a clear message. New ROM entries default to the
generation's base-figure node (Genesis8_1Female, Genesis8Male, …) instead of
always Genesis9, skinning defaults to Linear where DTH ships no DQS ROM, and
the runtime (v19) skips the G9-only mouth ROM pass and FACS/flexion strength
dials on non-G9 figures instead of failing or logging spurious errors. The
PoseAsset CSV for non-G9 characters uses the measured custom-sections path
(the G9 ground-truth template stays G9-only for now).
