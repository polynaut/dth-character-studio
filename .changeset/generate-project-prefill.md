---
'@dth/web': minor
'@dth/desktop': minor
---

Generate project hands over a **wired** network: the import file paths
(`.dth`, FBX, Alembic, ROM FBX), the PoseAsset **CSV path**, the **export
directory** and the **Skinning method** are prefilled for the primary scene —
`$HIP`-relative by default, absolute when the project opted out of junctions —
and the character name is set with them (prefilled paths may bypass the HDA's
auto-fill). Parameters your installed DazToHue doesn't have yet are skipped
one by one (the CSV path needs the release with the CSV-driven PoseAsset
node); prefilling can never fail a generation.
