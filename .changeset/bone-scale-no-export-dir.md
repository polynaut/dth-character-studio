---
'@dth/web': patch
---

Bone scale no longer requires an export directory. With none set, the studio just generates the ROM and a ticked Bone scale is a harmless no-op; set an export directory and it drives the DTH Exporter's per-frame reference-skeleton FBX and auto-fills the PoseAsset CSV path as before. The amber "set an export directory" warning is gone, and the guide is updated (bone scale, the character-settings chapter, and the combined-morphs / GEN art-direction screenshots).
