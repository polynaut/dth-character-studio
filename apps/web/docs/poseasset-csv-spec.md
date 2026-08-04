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
| `CTLGROUP` | bone |
| `CTL` | name |

Notes:

- **FBM and MIS are flat lists** — no group rows, no generation method of
  their own (the node has a separate *Global Generation Method*).
- **PHY groups have no generation method**; instead they carry physics
  parameters (offset distance, radius) and each pose has an XYZ offset.
- `file` on GEN/FBM poses = the per-pose **reference skeleton FBX**. The studio
  fills this automatically for a pose flagged **Bone
  scale**: it emits a `{{DTH_EXPORT_DIR}}/Reference Skeletons/{{DTH_EXPORT_NAME}}_frame_<N>.fbx`
  token path, and the generated Daz script resolves both tokens — the export
  dir and the scene-suffixed figure name handed to `doExport` — when it copies
  the CSV next to the exporter output. The resolved dir is an **absolute
  path**, or — with the project's *Settings → Project → Houdini path style* on
  `hip` (the default; the `houdiniPathStyle` `.dcsp` manifest field) —
  **`$HIP/../<dazSubdir>/dth-exports/<scene subfolder>`**, plain relative
  navigation from the linked `.hip`s to the export root beside the scenes.
  One prefix must be right for **every** linked `.hip` (`hipRefPrefixFor` in
  `apps/web/src/lib/scene-subfolder.ts`); a character whose layout allows none
  — no linked project, a `.hip` outside the character folder, projects spread
  over two folders, a cross-drive export root — falls back to absolute.
- **`MIS` rows must leave `file` empty.** The parser reads the column, but the
  node has no matching parameter for Misc mappings, so a non-empty value makes
  the whole import fail (`AttributeError: 'NoneType' object has no attribute
  'set'`, line 255 — measured July 15 2026 on 2.4.3). The studio never emits it.
- The section keyword for Miscellaneous is **`MIS`**, not `MISC`.
- `CURVEGROUP`/`CURVE` is an additional category (animation/material curves)
  the studio does not model yet.
- `CTLGROUP`/`CTL` are the **pre-2.0 era** control rows — the old pipeline's
  equivalent of `CURVEGROUP`/`CURVE`. Columns are observed from the
  ground-truth G8.1 template
  (`packages/rom/src/templates/poseasset-g8.1-dqs-jcmfac-ue5.csv`), not from
  the 2.4.3 parser. The studio models neither — both pass through verbatim in
  the template splice (`packages/rom/src/csv.ts`).

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
`packages/rom/src/templates/poseasset-physics-g9.csv` and emitted as a fixed preset
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

- Suffix has no *none* in the node, and none in the studio either:
  `groupSuffixSchema` is `left`/`centre`/`right` (default Centre), mapping
  directly onto the menu indices.
- Generation method applies to JCM/FAC/EXP/GEN groups — not PHY, not
  FBM/MIS (flat). The studio matches (`METHOD_SECTIONS`).
- Reference FBX applies to GEN and FBM only (`REFERENCE_FBX_SECTIONS`), matching
  DTH's Custom ROM Guide. The parser also reads a `file` column on MIS rows, but
  a non-empty value there fails the import (see the note above) — never emit it.
- PHY offset/radius group fields and per-pose XYZ offsets are now mapped from a
  node export (`poseasset-physics-g9.csv`) and emitted as a fixed preset block.
