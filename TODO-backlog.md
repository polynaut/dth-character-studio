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

### Bulk operations & scanning

**C1. Bulk product scanning**

```text
Add "scan products" as a bulk operation on project level, so all products across the
project's characters/scenes can be scanned in one action.
```

**C2. Bulk morph scanning**

```text
Add bulk morph scanning for an entire project, including base morphs — one single
one-click operation in the studio with a selection of what to scan: base morphs,
character morphs, products. The user starts it once and just waits.
```

**C3. Scan-on-export keeps the morph index in sync**

```text
Make every export directly scan the current scene's morphs, so the morph index is
always in sync and up to date through the app's core functionality alone (this only
works reliably when the user has a full morph scan: base figures + all Daz scenes of
the project — only then are all clothing morphs known). Consequences to implement:
- No dedicated "scan all scenes of my project" action is needed.
- Show a warning (alert) on character detail when the character has Daz scenes not yet
  scanned for morphs — so after creating a character or adding scenes, the user
  immediately sees a scan is due.
- The scan dynamically selects only the scenes in need (e.g. the primary was already
  scanned earlier -> it is skipped when the two later-added scenes get scanned). The
  bulk job is transported over the DTH Exporter plugin.
```

**C4. Genesis index: per-scene second mode**

```text
Extend "build genesis index" with a second mode targeting a specific Daz scene: it
scans all morphs of all children nodes of that scene, filters the result against the
existing index (the base scan across the base figures usually ran first), and adds all
newly found morphs (mostly from clothing) to the index together with a field
"daz-scene-name" recording which scene they were found in. Then use that field in the
morph auto-complete to filter for the currently selected Daz scene — e.g. only show the
"Expand All" morph of the 2 clothing assets that actually exist in that scene.
```

**C5. Central-scripts UI: selective scene scanning + product scanning**

```text
In the central scripts UI, always allow running the base script, and additionally let
the user choose from known project -> character -> scenes to include specific ones —
"scan morphs of these clothing assets too". Offer explicit Daz product scanning in the
same place.
```
*(Raw note started with "———", i.e. it continued an earlier thought — double-check the intent before building.)*

**C6. Bulk-export error handling** `[verify]`

```text
Test what happens when multiple script runs error in various scenes during one bulk
export run: are ALL errors visible in the UI? Does the UI jump correctly around to
focus the errored fields and select the matching Daz scene for each error? Fix whatever
falls short.
```

### Houdini integration

**C7. Pose-node prefills on project generation** `[external]`

```text
Once the Houdini DTH pose node can be driven from a CSV file path (instead of a
one-time import), extend Houdini project generation to prefill:
- the CSV pose-asset file path (always build paths with $HIP by default),
- the export file path,
- the import file paths (we may need to prefill the character name too, since this may
  bypass DTH's auto-fill feature),
- the Skinning setting ("Linear" / "Dual Quaternion") set correctly from the start,
- and possibly the skin node too, by intelligently selecting all clothing assets vs.
  the rest (the body).
```

**C8. CSV reload on every project start** `[external]`

```text
When the pose node is driven from a CSV file path, ensure the file is reloaded and the
pose-asset node updated on every project start — not just imported once. This is a
prerequisite for bulk auto-export of all found export nodes in an opened Houdini
project: we must be able to count on the pose-asset nodes being up to date before
exporting.
```

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

**C10. Automated version-control setup for the project folder**

```text
The guide already answers the ignore question (docs/guide/05-rom-in-daz.md: add the
"dth-exports" link to P4IGNORE / .gitignore, or delete the link). Build the remaining
part: have the studio do the version-control setup for the user automatically — detect
the VCS in use and write the right ignore entries, for Perforce, Git, and whatever else
makes sense.
```

**C11. Houdini presets as an asset type**

```text
Support Houdini presets as an attachable asset type, so a specific skeleton (jiggle)
setup can be stored and reused per project or per character.
```

### Daz integration

**C12. Geograft-shell visibility auto-fix**

```text
Assets that add extra shells on top of GP/DK geografts don't work well: the manual fix
is going into every GP/DK shell -> Parameters -> Visibility and turning "Off" all
entries added by the extra shell items (e.g. an additional geograft's own shell). Build
an auto-fix:
1. Check whether we can scan a Daz asset file for the nodes it adds to the GP/DK
   visibility listing.
2. If yes, build an index over the user's library of all assets that (a) add shells and
   (b) what those added nodes are named.
3. Using that index, auto-fix a character: if it has GP/DK and one of these shell
   assets attached, automatically turn "Off" all of that asset's listed nodes in the
   GP/DK shells.
```

**C13. Auto-detect newly saved Daz scenes**

```text
When the user keeps working on a Daz scene (outfit) and saves it as a NEW file into the
character's Daz folder, the studio should auto-detect the new file when it regains
focus and offer the "add scene to character" dialog for it.
```

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

**C19. Move character metadata out of the character root**

```text
Move the CSV that always sits in the character root into a hidden per-character
metadata folder (align the naming with the existing ".dcsmeta" convention) — and any
other meta files too, so the character folder always looks clean in Explorer. Note: the
generated Daz script bakes the CSV's absolute path, so the migration must regenerate
scripts, not just move the file. Handle existing characters on read/refresh.
```

### Installation & environment

**C20. Auto-detect installed Daz Studio / Houdini versions**

```text
Build detection of which Daz Studios and Houdinis are installed on the system, so the
studio can derive all needed paths on its own (the Daz Install Manager settings
basically know everything). Then improve the Settings UI: the user just picks a version
of each tool, like "Daz Studio 6" and "Houdini 22", and all manual folder settings
vanish.
```

**C21. One-click Unreal Engine plugin install** `[external]`

```text
Extend the install feature to a DTH Unreal Engine plugin (if/when one exists) — and
optionally other UE plugins: one click installs "DTH content + DTH plugin + custom
plugins" so a new UE project is immediately ready for the DTH importer and e.g. Kawaii
Physics. Add a folder setting in project settings where the user can point at a folder
of plugins that always get installed.
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
