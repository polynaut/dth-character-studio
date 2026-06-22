---
'@dth/web': minor
---

Export: new **"Run the export with the ROM script"** toggle (in a character's Export directory section). On (default) keeps one combined `<Name>_<Genesis>.dsa` that builds the ROM and runs the export. Off splits it into `ROM_<Name>_<Genesis>.dsa` (builds the ROM) and `Export_<Name>_<Genesis>.dsa` (only runs the exporter + delivers the PoseAsset CSV) — so you can re-export, for another Daz scene or after a failed export, without rebuilding the slow ROM. Run the Export script after the ROM script in the same Daz session.
