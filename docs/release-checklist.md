# Release smoke checklist

The manual pass behind a **risky release** — schema or generation changes,
native/Rust changes, installer/updater work — and any **milestone release**
(x.0.0). Everyday patches ride on the automated tests (`pnpm -r test`,
typecheck, lint) and don't need this.

Copy the list into the release PR (or an issue) and tick it there.

## Install & update

- [ ] Install the **previous** release fresh, then update to the candidate via
      the in-app updater (verifies the signed `latest.json` end-to-end).
- [ ] Double-clicking a `.dcsp` opens the project in its own window (file
      association + single-instance routing).

## Core flow — once per claimed Daz Studio version (4.x **and** 6)

- [ ] New project → new character (G9) → add a custom FBM morph → **Save**
      passes validation.
- [ ] **Generate**: `ROM_<Name>_<Genesis>.dsa` + `<Name>_pose_asset.csv` are
      written; the script lands under
      `Scripts/DTH-Character-Studio/<project>/<character>/`.
- [ ] Run the script in Daz Studio — the ROM builds; the run report is clean
      (or lists exactly the expected failures, and the studio shows them).
- [ ] Direct export with an export directory set — `.abc`, `.dth` and the CSV
      land in the export folder.
- [ ] A **Bone scale** frame produces
      `Reference Skeletons/<Name>_frame_<N>.fbx`, and the copied CSV points at
      it with an absolute path.
- [ ] Import the CSV in Houdini's PoseAsset — frames land where expected; the
      reference FBX resolves.

## Migrations & upgrade safety

- [ ] Open a project with characters saved by the **previous** release — they
      load, and **Tools → Refresh assets** migrates + regenerates them without
      data loss.

## Housekeeping

- [ ] Tools → housekeeping runs clean; run logs / scan outputs / quarantine
      aren't growing without bound.
