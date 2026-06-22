# DTH PoseAsset node — CSV import/export format

Authoritative spec, reverse-engineered June 12 2026 from `import_from_csv()`
inside `DazToHue.hda` (Release 2.4.3, `Houdini Assets/otls/`). This is the
format the studio's PoseAsset CSV generator must emit.

## General

- Plain CSV, no header row. Column 0 is the row type.
- Group rows open a group; subsequent pose rows belong to the most recent group.
- All enum columns are **menu indices**, not strings.
- Empty columns are skipped (the parser only sets non-empty values), so
  trailing columns may be omitted.

## Row types and columns

| Type | Columns (after type) |
| --- | --- |
| `RET` | frame, name |
| `JCMGROUP` | generation_method, suffix, bones |
| `JCM` | frame, name |
| `FACGROUP` | calculate_from, generation_method, suffix |
| `FAC` | frame, name |
| `EXPGROUP` | calculate_from, generation_method, suffix |
| `EXP` | frame, name |
| `GENGROUP` | calculate_from, generation_method, suffix, bones |
| `GEN` | frame, name, file |
| `PHYGROUP` | calculate_from, suffix, bones, offset_distance, radius |
| `PHY` | frame, name, offset_x, offset_y, offset_z |
| `FBM` | frame, name, file |
| `MIS` | frame, name, file |
| `CURVEGROUP` | type, bone |
| `CURVE` | name |

Notes:

- **FBM and MIS are flat lists** — no group rows, no generation method of
  their own (the node has a separate *Global Generation Method*).
- **PHY groups have no generation method**; instead they carry physics
  parameters (offset distance, radius) and each pose has an XYZ offset.
- `file` on GEN/FBM/MIS poses = the per-pose **reference skeleton FBX**.
- The section keyword for Miscellaneous is **`MIS`**, not `MISC`.
- `CURVEGROUP`/`CURVE` is an additional category (animation/material curves)
  the studio does not model yet.

## Menu index mappings

Generation method (per group; `Default` = inherit the global setting):

| Index | Meaning |
| --- | --- |
| 0 | Default |
| 1 | Individual |
| 2 | Additive |
| 3 | Cumulative |
| 4 | Advanced Additive |

Suffix (note: there is **no "none"**):

| Index | Meaning |
| --- | --- |
| 0 | Left |
| 1 | Centre |
| 2 | Right |

Calculate From:

| Index | Meaning |
| --- | --- |
| 0 | Default |
| 1 | Rest Pose |
| 2 | Animation Frame |

## Worked example (mrpdean's sample)

```
RET,0,RestPose          → retargeting pose, frame 0, name RestPose
RET,1,UnrealPose
RET,2,TPose
JCMGROUP,0,0,ball_l     → JCM group: method Default, suffix Left, driver bone ball_l
JCM,3,BallBD40          → pose at frame 3, name BallBD40
JCM,4,BallBU60
```

## Physics example ROM layout (decoded from the .duf keyframes)

`G9 Physics Example.duf` (43 frames, 23 channels — all `dth_phy_*` morphs):

| Frames | Block | Morph sweep |
| --- | --- | --- |
| 0–8 | breast left | out 0–1 → up 1–3 → in 3–5 → down 5–7 → out 7, hang 8 |
| 9–17 | breast right | out 9–10 → up 10–12 → in 12–14 → down 14–16 → out 16, hang 17 |
| 18–25 | glute left | out 18–19 → up 19–21 → in 21–23 → down 23–25 → out 25 |
| 26–33 | glute right | out 26–27 → up 27–29 → in 29–31 → down 31–33 → out 33 |
| 34–42 | stomach | left 34–35 → up 35–37 → right 37–39 → down 39–41 → left 41, hang 42 |

**RESOLVED (June 13 2026)** from a PHY-filled node export — stored verbatim as
`src/lib/rom/templates/poseasset-physics-g9.csv` and emitted as a fixed preset
block. 5 groups / 43 poses, all `PHYGROUP,0,<suffix>,<bone>,5.0,5.0`:

| `PHYGROUP` bone | suffix | poses |
| --- | --- | --- |
| `breast_l` / `breast_r` | 0 / 2 | 9 each (8-point circle + HangForward) |
| `glute_l` / `glute_r` | 0 / 2 | 8 each (8-point circle, no HangForward) |
| `stomach` | 0 | 9 (8-point circle + HangForward) |

`PHY` rows are `PHY,<frame>,<name>,<x>,<y>,<z>`, XYZ being the push direction —
an 8-point circle of radius 5 in the bone's plane (Out `±5,0,0`, Up `0,5,0`, In,
Down, …) plus `HangForward` (`…,0,-5`). Left/right groups mirror X. The glute
*Up* pose (`0,5,0`) is named `GluteUp`.

## Consequences for the studio model

- The studio's `suffix: none` has no CSV equivalent — map to Centre (index 1)
  or require a suffix in group-based sections.
- The studio's method enum lacks `Default` and `Advanced Additive`.
- Generation method applies to JCM/FAC/EXP/GEN groups — not PHY, not
  FBM/MIS (flat). The studio currently shows the select on all groups.
- Reference FBX applies to GEN, FBM **and MIS** (studio currently GEN/FBM only).
- PHY offset/radius group fields and per-pose XYZ offsets are now mapped from a
  node export (`poseasset-physics-g9.csv`) and emitted as a fixed preset block.
- EXP is group-based in the node (studio currently treats it as flat).
