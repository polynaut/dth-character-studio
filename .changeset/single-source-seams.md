---
'@dth/rom': patch
'@dth/web': patch
---

Hardening pass on hand-mirrored knowledge (the pattern behind the FAC staleness bug): the reference-FBX rule (`isBoneScaleRefPose`/`boneScaleRefPoses`) and the per-section preset availability (`sectionPresetAvailable`) now live once in `@dth/rom` — the editor's bone-scale warning, the CSV file column, the exporter frames and the "no asset" chip all derive from the same definitions, with tests coupling availability to path resolution. App settings collapse to ONE tolerant zod schema (`studioSettingsSchema`) covering the field list, defaults, the settings.json read and the save input; the per-project behaviour defaults are shared between the manifest and the save schema. No behaviour change.
