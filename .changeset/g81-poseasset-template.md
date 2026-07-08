---
'@dth/rom': minor
'@dth/web': minor
'@dth/desktop': minor
---

G8.1 PoseAsset CSVs are validated now — no more "experimental" for the
standard setup. Ground truth came from a working DTH 1.9.6 PoseAsset node
(old-Houdini pipeline): a G8.1 character with DQS + JCM/FAC presets and a
pre-2.0 DTH release selected gets the full 188-frame preset template spliced
with its custom sections, exactly like G9. The CSV "era" boundary moved to
DTH 2.0 where the control-row format actually flipped (CTL → CURVE — the G9
template now correctly requires a 2.0+ release, and releases 2.0–2.4.3 count
as one era, so switching among them no longer flags characters stale). The
editor's experimental tag now reflects the real per-configuration validation.
