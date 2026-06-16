---
"@dth/web": minor
---

JCM can use a custom pose preset. The Joint Corrective section's second mode is
now "Custom JCM asset": enter a path to a `.duf` (or pick it with a file dialog)
and it's loaded as the base ROM exactly like a pre-defined DTH JCM asset —
driving the skinning (DQS/linear from the file name), the frame layout, and the
generated `jcmRomPath`. FAC stays a separate section (it mirrors the Houdini
PoseAsset node), so its optional Mouth asset is still picked there.
