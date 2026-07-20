---
'@dth/web': patch
---

Bone scale no longer requires an export directory. It only drives the DTH Exporter when an export directory is set (the studio then writes each frame's reference-skeleton FBX and fills its PoseAsset CSV path); with no export directory the studio generates the ROM only, so a ticked Bone scale is simply a no-op you can handle yourself — the amber "set an export directory" warning is gone, and the docs are updated.

Also guide-screenshot polish (docs only): dropped the redundant Setup-DTH-Exporter overview shot; automated the GEN art-direction, combined-morphs and (compact, one row ticked) bone-scale screenshots; the ROM-definition shot now shows GEN enabled + the Golden Palace timeline block; and the expanded-row value reference (Node/Property/Value/Base/Auto) moved out of a collapsed details block into the always-visible page content.
