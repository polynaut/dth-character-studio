# Backlog — ready-to-paste prompts (collected week ending 2026-08-03)

Each item is written as a self-contained prompt you can paste straight into a fresh
Claude Code session in this repo. Tags: `[verify]` = test/reproduce first, `[external]` =
depends on mrpdean / upstream, `[research]` = open question to answer before building.

**North star** (paste as extra context with any pipeline-related prompt):

```text
Context — the end state this work serves: I add a new FBM to the ROM definition, hit
"DTH Export" (all scenes pre-selected because the change touches them all), pick the
already-set-up Houdini project and press "Start". The studio generates and exports via
the DTH Exporter in Daz for all scenes, opens the Houdini project (which refreshes the
PoseAsset node from the freshly written CSV) and runs export on all involved DTH networks.
~40 minutes later for two scenes, the only manual step left is "Re-import" on the
skeletal meshes in the UE project.
```

---

## Documentation improvements

**D1. One script per character**

```text
Document (user guide, docs/guide/) that the studio generates ONLY one script per
character: Daz scene overrides are baked into a single script each (ROM, Export_Hair),
and the script smartly chooses the right dataset based on the opened Daz scene's
filename. Make the consequence loud and unmissable: never rename a Daz scene outside
the studio, or the script will pick the wrong (or no) dataset.
```

**D2. Bulk-export DS6 limitation**

```text
Document that bulk export (and scripted export in general) only works with Daz Studio 6,
not Daz Studio 4. Place the note wherever bulk export is documented and in the UI docs
if we surface it there.
```

**D3. Houdini project setup guide (recommended flow)**

```text
Write a user-guide section on setting up Houdini when using the Houdini project folder
(the recommended way):
1. Create a new project file and save it with any name at the main Houdini folder (the
   same level the project folder is on).
2. Before doing anything else: File -> Set Project, choose the Houdini project folder,
   then save again.
3. Import everything with "$JOB/dth-exports/..." for character data and "$DAZ3D_LIB/"
   for Daz texture files.
Also explain the grouping freedom: by overriding the Houdini project folder per scene,
the user controls precisely which Daz scenes/outfit variants land in one Houdini
project — all variants of a character in one project, only the primary there and a new
project per non-primary scene, or any grouping in between.
```

**D4. First-Houdini-project-generation explainer**

```text
Document (and consider an in-app explainer on very first Houdini project generation)
what happens with the Houdini project folder: it is auto-generated with the first
project and automatically set; it contains a symlink "dth-exports" pointing to all Daz
exports; all later generated projects share the same project folder; there is one
folder per character.
```

**D5. "Set Project" for existing projects**

```text
Document which folder to choose for File -> Set Project in Houdini when adding an
EXISTING Houdini project to a character — and make clear that using Set Project is
entirely optional in that case.
```

**D6. Movable Houdini projects via env variables**

```text
Document that using the env variable $DAZ3D_LIB in Houdini texture file paths, combined
with consistently using $HIP, gives a fully movable Houdini project with no absolute
path baked in anywhere — and that "Generate project" already does all this basic setup
for you.
```

**D7. Bulk-jobs docs**

```text
Write user-guide docs for the new bulk jobs. Frame it around the promise that a user
probably never needs to execute a script manually again — especially once each ROM is
also saved as a scene: after a bulk export the studio holds all ROM scenes, all export
files, all stats, and knows all products and all morphs of the project.
```

**D8. Central-scripts docs**

```text
Improve the docs for the central scripts that are not tied to a specific character:
Scan Frames, Scan Morphs, Scan Products. Explain what each one does, when to run it,
and how they relate to the per-character generated scripts.
```

---

## Code improvements


### Houdini integration

**C9. Track DTH version per generated Houdini project + Refresh-Assets warning**

```text
Track in app metadata which Houdini projects were created through Character Studio and
especially which DTH version was used at that moment. When the user later switches the
DTH release in settings to another version, detect that a generated Houdini project is
stale and show a warning on its Houdini project card: the user must open the project
and run "Refresh Assets" from the DazToHue shelf. The warning must be manually
acknowledged and then goes away — we have no way to detect whether Refresh Assets was
actually executed.
```


### Daz integration


**C14. Skip Export_Hair for identical hair**

```text
When a non-primary scene has exactly the same hair items as the primary scene, skip the
export-hair step for that scene — those hairs already exist at that point from the
primary scene's export.
```

**C15. Hair-items override styling** `[verify]`

```text
Test the hair-items field styling with a second scene that has the SAME hair items as
the primary: it must render standard-styled (not override-styled), because it is not
overridden — any divergence from the primary means "overridden". Also test with
multiple hair items. Fix the styling logic if it doesn't behave that way.
```

**C16. Affected-scene selection correctness** `[verify]`

```text
Verify the "affected scenes" selection logic in DTH Export: do scene file updates mark
exactly the affected scenes? Do base param changes mark ALL scenes? Do override changes
mark only their scene? Does a new DTH Exporter release mark EVERYTHING as affected?
Also reproduce this suspected bug: merely opening a Daz primary scene made it show up
as affected/selected again in DTH Export. Find the cause and fix it.
```

**C17. Gate the DTH Export button on installed DLLs**

```text
Only show the DTH Export button when BOTH DLLs are installed: the Exporter plugin and
the Runner.
```

### Project operations

**C18. Project Backup + Restore**

```text
Add project-level "Backup" and "Restore" operations:
- Backup produces a zip of all project data/metadata with the dedicated extension
  ".dcsp.zip".
- Restore lets the user choose the project name (initial value taken from the backup)
  and the target folder on disk, in a side-panel dialog like Create Project.
- A backup zip can be drag-and-dropped onto the main window (the same place where
  projects are created) to start a restore.
```

### Product catalog & licensing (big initiative)

**C22. Product catalog enrichment + licensing overview**

```text
Design the product-catalog and licensing feature: an enriched product listing inside
the app (images, descriptions), the ability to attach a license to each product and to
the DTH release, and a per-project overview showing whether all characters are properly
licensed. Start with an architecture proposal (data sources, consent, storage) before
implementing anything.
```

### Misc features & polish

**C23. "Assets" feature for animations**

```text
Design the new "assets" feature for animations: retargeting support, multiple Daz scene
cards and multiple Houdini project cards per character/project.
```

**C24. Simple telemetry**

```text
Add super simple telemetry: how many installations exist, which versions are installed,
which features are used the most, and how many instances are open right now.
```

**C25. AI loader animation**

```text
Build an "AI loader" UI element: a transparent spherical loader with gradient animation
and an inner bubbling-lava effect emerging from blur (reference: an Instagram
HTML/CSS code-animation post). Use it where the app has longer-running operations.
```
