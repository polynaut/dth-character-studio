# @dth/web

## 0.87.0


### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.87.0
  - @dth/ui@0.87.0

## 0.86.1

### Patch Changes

- [#926](https://github.com/polynaut/dth-character-studio/pull/926) [`2726f37`](https://github.com/polynaut/dth-character-studio/commit/2726f37d571ace2360515ffa73cd2278bbe4d929) Thanks [@polynaut](https://github.com/polynaut)! - The PRIMARY label leads the primary scene card's badge row, with the hair-export glyph to its right. The label is the card's identity and the glyph a per-scene state indicator — on the one card that shows both, identity reads first.
- Updated dependencies [[`fc17e9f`](https://github.com/polynaut/dth-character-studio/commit/fc17e9f72d3dfa5ebe1c664f18e908be22ee28b0), [`fc64c34`](https://github.com/polynaut/dth-character-studio/commit/fc64c34bf8489c09c7b75318308cd6b307e6fdce), [`05ebed1`](https://github.com/polynaut/dth-character-studio/commit/05ebed1f05ea1ae167ff3e00433b46509ac1d438)]:
  - @dth/rom@0.86.1
  - @dth/ui@0.86.1

## 0.86.0

### Minor Changes

- [#921](https://github.com/polynaut/dth-character-studio/pull/921) [`d7eb5d1`](https://github.com/polynaut/dth-character-studio/commit/d7eb5d1f898ea3b1fc46ded07db84d514d71bf64) Thanks [@polynaut](https://github.com/polynaut)! - Daz scene cards get a **Scene utils drawer** — the 🔧 in each card's corner cluster, the per-scene twin of the Houdini cards' Utils drawer. Its General tab holds two scene-scoped scans and one export switch:

  - **Scan products of this scene** / **Scan morphs of this scene** — the two scene passes of Tools → Scan project, narrowed to this one scene: Daz opens it once and runs just the pass you asked for (the same Runner handoff, abortable while it waits for pickup). The products button explains itself when the project's Daz Products feature is off or no DIM manifests folder is set.
  - **Export hair items** — a per-scene switch on the DTH Export flow's per-item hair pass (schema v37 `sceneOverrides[].exportHair`, runtime v96): **on by default for the primary scene, off for extra scenes**, and stored only while your choice differs from that default. The generated export block now embeds a per-scene gate the runtime resolves for the open scene, so one bulk run exports hair exactly where the switch says. Only the export pass is gated — a scene's hair items stay hidden from the main export either way, and the standalone `Export_Hair_…` script keeps working for every scene as the manual escape hatch.
  - The switch also follows your hair edits **automatically**: changing a non-primary scene's hair items arms the export when the list differs from the primary's — even partly — and clears it back to the default when the lists fully match again (adding an outfit scene whose detected hair differs arms it right away). Every scene card's badge row shows the effective state as a hair glyph — lit when the scene's hair items export, dimmed when they don't.

  Behavior note: DTH Export batches used to export **every** scene's hair items; with the new default, an extra scene's hair now exports only once its switch is flipped on.

### Patch Changes

- [#923](https://github.com/polynaut/dth-character-studio/pull/923) [`cf8b2d0`](https://github.com/polynaut/dth-character-studio/commit/cf8b2d086aaf5f9029996afad81c7064a9077760) Thanks [@polynaut](https://github.com/polynaut)! - The bin button leads the card's control cluster. On Daz scene cards and Houdini project cards the corner buttons now read bin, utils, open (left to right) — the destructive action sits farthest from the always-present open icon, so a hurried open never grazes the unlink.

- [#922](https://github.com/polynaut/dth-character-studio/pull/922) [`f5d6203`](https://github.com/polynaut/dth-character-studio/commit/f5d62036193b4648b292fefa0166215efeac9500) Thanks [@polynaut](https://github.com/polynaut)! - Hair drift is caught the moment it happens. The hair-items warnings re-check when the Daz scene file is saved on disk (a file watch on the scene's folder) — editing hair in Daz on a second monitor and saving no longer leaves the studio judging the old scene until the window regained focus. And the "unlisted hair — it'd ride into the export" warning now fires on the **primary** scene too, not only outfit scenes: the primary starts complete (seeded at creation) but drifts exactly the same way once the scene is re-styled and saved. Both warnings — a listed item gone from the scene (the export stops on it) and detected hair the list doesn't cover — come from one shared rule.

- [#918](https://github.com/polynaut/dth-character-studio/pull/918) [`2d01ef3`](https://github.com/polynaut/dth-character-studio/commit/2d01ef34e6d105a850bc2e690c44484003e9f278) Thanks [@polynaut](https://github.com/polynaut)! - A refused Unreal send now fails loudly instead of spinning politely. When the studio cannot queue an import at all (Runner bridge missing from the project, no export on disk, a vanished `.uproject`), the run's task rows for that project turn **failed** instead of spinning "Re-import · 0%" forever, the refusal arrives as an **error** toast rather than a blue info one, and the "open the editor" hint only accompanies sends that actually queued something.

- [#923](https://github.com/polynaut/dth-character-studio/pull/923) [`cf8b2d0`](https://github.com/polynaut/dth-character-studio/commit/cf8b2d086aaf5f9029996afad81c7064a9077760) Thanks [@polynaut](https://github.com/polynaut)! - The primary scene card's replace (folder) button no longer shows on an unhovered card. When replacing is blocked it stayed dimmed-but-visible at rest; now it hover-reveals like the rest of the corner cluster, still dimmed with its tooltip reason while blocked.

- [#913](https://github.com/polynaut/dth-character-studio/pull/913) [`934ec7e`](https://github.com/polynaut/dth-character-studio/commit/934ec7e19e295e6dd9b2c3e4839a2487b2d7eaa8) Thanks [@polynaut](https://github.com/polynaut)! - Opening a side panel now dismisses any toasts still on screen. Toasts stack above the drawer layer and outlive the action that raised them, so a stale one — an old export report, a copied-path notice — floated over the drawer as it slid in. The drawer's open sweep (the one that already clears leftover info popups and tooltips) now clears the toasts too.

- [#916](https://github.com/polynaut/dth-character-studio/pull/916) [`86b36a8`](https://github.com/polynaut/dth-character-studio/commit/86b36a84ee3a647621009b7e1fb4286e8b25aa83) Thanks [@polynaut](https://github.com/polynaut)! - The DTH Export finish report no longer welds warnings into its own (green) toast. The HDA's pre-flight complaints — the dialogs 456.py answers "Continue anyway?" to on your behalf — now arrive as **separate warning toasts**, one per distinct complaint per project, with the already-answered question stripped and per-node repeats collapsed. The summary keeps its own state and only notes "finished with warnings"; a run that worked still reads as a success, and a network's complaint no longer hides under a checkmark asking a question nobody can answer anymore.

- [#919](https://github.com/polynaut/dth-character-studio/pull/919) [`07f420e`](https://github.com/polynaut/dth-character-studio/commit/07f420e924b4f35cd4ebecbfdadaed8fe64f7e28) Thanks [@polynaut](https://github.com/polynaut)! - The Unreal leg now ends the run instead of parking it at 100%, and tells the truth in between. The editor's answer arrives as the leg's own sticky outcome toast (success / partial-warning / error) and clears the task panel — it used to become a status line under a bar frozen at 100% forever. The stretch before it stopped lying too: the status line now says when the studio is opening the editor, and flips to "importing — the editor freezes while the DazToHue pipeline runs" the moment the bridge claims the job, instead of sitting on "waiting for the editor to pick the job up" through the whole import. Queuing got quieter to match: a "use last exports" send raises no toast at all — not for the queue (the task rows and status line already carry it) and not for export-folder sets the target project never held, since refreshing what it holds is that send's whole promise and the warning re-fired on every repeat send. Only a refusal still toasts (as an error); a set a real export run produced that then didn't land still rides the final report. A Daz-run-plus-Skip-Houdini send now shows its own task rows instead of being invisible until the editor answered.

- [#920](https://github.com/polynaut/dth-character-studio/pull/920) [`525860b`](https://github.com/polynaut/dth-character-studio/commit/525860b0532435001e7e123b28270230897bc8f8) Thanks [@polynaut](https://github.com/polynaut)! - The Unreal leg survives a reload. Reloading the window — or just navigating away and coming back to the character — during the send used to "forget" the task rows, the status line and even the outcome toast, while the bridge kept working unwatched. The leg's own job files are its sidecar now, exactly like the Daz batch and the Houdini run: on mount the studio reads the linked projects' `job.json`/`running_job.json`/`result.json`, recognises this character's send by the `.dth` paths (or, for a finished result, by its export-set names), and re-arms the rows, the status line and the watch — so an import that finished while nobody was looking still lands as its outcome toast.

- [#917](https://github.com/polynaut/dth-character-studio/pull/917) [`c0f88ee`](https://github.com/polynaut/dth-character-studio/commit/c0f88eea95401547d3ffe77841cd872b6db1d675) Thanks [@polynaut](https://github.com/polynaut)! - The "just re-import into Unreal" run no longer hides behind the Daz mode dropdown. In DTH Export, leaving every Daz scene unticked with **Skip Houdini — use last exports** and a ticked Unreal project now starts the send under **any** Daz mode — Start used to hold on "Select at least one Daz scene" for a run that needs none, unless you also switched the Daz mode to "Skip Daz". The selection describes the run: no scenes and no Houdini leaves only the re-import, and the Runner-plugin gate (a Daz concern) no longer blocks or badges it.
- Updated dependencies [[`04af875`](https://github.com/polynaut/dth-character-studio/commit/04af875ad2b60cd3bf66a00feb95f8b3a0e3d207), [`cf8b2d0`](https://github.com/polynaut/dth-character-studio/commit/cf8b2d086aaf5f9029996afad81c7064a9077760), [`d7eb5d1`](https://github.com/polynaut/dth-character-studio/commit/d7eb5d1f898ea3b1fc46ded07db84d514d71bf64), [`d083435`](https://github.com/polynaut/dth-character-studio/commit/d083435fd116f957afe6cd18cb9c03a9abdd155c), [`cf8b2d0`](https://github.com/polynaut/dth-character-studio/commit/cf8b2d086aaf5f9029996afad81c7064a9077760), [`934ec7e`](https://github.com/polynaut/dth-character-studio/commit/934ec7e19e295e6dd9b2c3e4839a2487b2d7eaa8)]:
  - @dth/rom@0.86.0
  - @dth/ui@0.86.0

## 0.85.0

### Minor Changes

- [#907](https://github.com/polynaut/dth-character-studio/pull/907) [`712a4f8`](https://github.com/polynaut/dth-character-studio/commit/712a4f86a639af536eb155ec45253e3873159766) Thanks [@polynaut](https://github.com/polynaut)! - The Daz product scan now recognises **hand-installed content the old matchers could never see** (runtime v95), so far fewer used assets land in "unmatched". The gaps closed — each verified against a real library's scan diagnostics:

  - **Morphs installed under the figure's own data root** — the standard `data/DAZ 3D/Genesis 8/Female/Morphs/<Vendor>/<Product>/` layout — were written off wholesale as base DAZ content. The scan now synthesises a content-folder product for each such folder, and because a morph often exposes **no source file at all** to the scan APIs, it also matches a morph to the morph _file_ named like it — searching real products' DIM manifests, real products' installed Morphs folders, and the synthesised folders, preferring the scene's own Genesis generation when vendors ship the same filename for several.
  - **Flat texture folders** (`Runtime/textures/<Product>/<file>.jpg`, common for freebie outfits) produced garbage folder keys — the filename was mistaken for the product segment. The folder alone is now the key, and an unmatched item's own texture folder becomes a product **on demand**, grouping sibling parts (Backpack, Boots, Gloves…) under the one folder product they share. Nested unowned texture folders (`Textures/<Vendor>/<Product>/`) work the same way, with the vendor as artist.
  - **Every content directory Daz has mapped** is scanned, not just the one library configured in Settings — network drives and split libraries included. Local-install metadata and artist/version enrichment read all of them too.
  - A new **Folder Match** places an asset whose own source file lives under a real product's `<Vendor>/<Product>` folder — catching morphs from big packs whose exact file fell off the DIM manifest's capped file index. The basename matcher keeps **every** morph filename from a manifest (Shape Shift lists 166 — the old cap dropped the one that mattered).
  - **Morphs dialed on fitted items** (clothing, hair, geografts) are no longer matched independently — they're the item's own fit morphs or auto-follow projections, always part of the product that brought the item, and matching them produced false positives on generic names like `Expand_All`.

  Re-scan a scene (or just run the next export) to see previously unmatched assets resolve; Tools → Refresh assets regenerates the scan scripts on the new runtime.

### Patch Changes

- [#906](https://github.com/polynaut/dth-character-studio/pull/906) [`f5d835f`](https://github.com/polynaut/dth-character-studio/commit/f5d835fc9683beec84d90989907d97baeb621712) Thanks [@polynaut](https://github.com/polynaut)! - DTH Export runs no longer pause at the start of each step (runtime v88). The generated Daz scripts used to sleep ~1 second after the Runner's scene load and again between the ROM build and the exporter — up to ~2 seconds of artificial wait per scene, added as a precaution rather than against any measured failure. The Runner's job contract already has it drain Daz's event loop after opening a scene (docs/exporter-plugin-job-file.md), so the pauses bought nothing. Save the character (or Tools → Refresh assets) to regenerate scripts already on disk; older scripts keep the old pauses until regenerated.
- Updated dependencies [[`712a4f8`](https://github.com/polynaut/dth-character-studio/commit/712a4f86a639af536eb155ec45253e3873159766), [`f5d835f`](https://github.com/polynaut/dth-character-studio/commit/f5d835fc9683beec84d90989907d97baeb621712)]:
  - @dth/rom@0.85.0
  - @dth/ui@0.85.0

## 0.84.0

### Minor Changes

- [#903](https://github.com/polynaut/dth-character-studio/pull/903) [`0d09cc8`](https://github.com/polynaut/dth-character-studio/commit/0d09cc87af5551a570b26ad73cd7696e5c857167) Thanks [@polynaut](https://github.com/polynaut)! - The character image dialog gains a **vertical offset**: a slider (plus a number box and a Reset) that moves that character's picture up or down in every avatar and scene thumbnail in the app at once. Daz frames a figure in the previews it renders according to how tall that figure is, so a short or tall character comes out sitting high or low in the square and every crop of it misses the face by the same amount — one number now fixes all of them. The dialog shows two previews side by side while you tune: the stored square image, and how the character header will frame it.

  The value is a percentage of the picture itself rather than a pixel nudge, which is what lets a single setting land the same crop in the 224px header portrait and in a 32px scene chip. It defaults to 0 — the framing every character already had — so nothing moves until you move it.

  This replaces the per-Genesis-generation framing shipped in 0.83.0, which was the wrong model: the generation was never what decided it. Every character is back on one default crop, corrected per character where it needs correcting.

- [#898](https://github.com/polynaut/dth-character-studio/pull/898) [`9333041`](https://github.com/polynaut/dth-character-studio/commit/9333041154b2f74817a86dd2d8accb903f502c8e) Thanks [@polynaut](https://github.com/polynaut)! - The Daz scene cards and the Houdini project cards can now be re-ordered by drag-and-drop: a grip appears in a card's top-left corner on hover, and dropping it persists the new order with the character (the cards render in array order, so the order survives reloads and is what every list derived from it shows — the docked scene bar, the DTH Export rows). For Daz scenes the primary card keeps its place — it stays first and isn't draggable; the extra scenes re-order among themselves. A Houdini entry whose file is missing on disk still holds — and can still be moved to — its place in the order.

  A card with nothing to re-order against (a single Houdini project, a single extra scene) shows no grip at all, rather than one that cannot move anything. The grip is operable by keyboard as well as pointer.

### Patch Changes

- [#899](https://github.com/polynaut/dth-character-studio/pull/899) [`ffcd7da`](https://github.com/polynaut/dth-character-studio/commit/ffcd7da818f2086900730c0e344ad0d8ff834df7) Thanks [@polynaut](https://github.com/polynaut)! - The read-only Export directory info now lives at the bottom of the "Daz scripts generated" panel instead of its own panel. The three places that pointed at the old panel now say what to actually do: a character with no folder of its own has no export directory and nothing can be "set" there — move it into a folder (the DTH Export button's hint, the Generate project button's hint, and the DTH Export precondition error).

- [#902](https://github.com/polynaut/dth-character-studio/pull/902) [`08ff043`](https://github.com/polynaut/dth-character-studio/commit/08ff0436d503b93905a25b6f5948a249151f3621) Thanks [@polynaut](https://github.com/polynaut)! - The Houdini Utils "Copy from" source picker now offers the character you are on, so a setup can be copied between two of its own projects; only the drawer's own target project is left out. With 15 or fewer studio projects to offer, the picker is flat — one entry per Houdini project, named like the cards; above that it keeps the two-level character → project layout.
- Updated dependencies [[`0d09cc8`](https://github.com/polynaut/dth-character-studio/commit/0d09cc87af5551a570b26ad73cd7696e5c857167)]:
  - @dth/rom@0.84.0
  - @dth/ui@0.84.0

## 0.83.2

### Patch Changes

- [#894](https://github.com/polynaut/dth-character-studio/pull/894) [`025f6d5`](https://github.com/polynaut/dth-character-studio/commit/025f6d5898e5776348c0e6f0b2b197fbb2890aee) Thanks [@polynaut](https://github.com/polynaut)! - Two Runner-batch fixes in the generated Daz scripts (runtime v85). A batch no longer parks behind a dialog nobody is there to click: a ROM that built WITH problems, and a product scan that could not find the DAZ Install Manager manifests folder or write its CSV, each opened a modal over Daz mid-batch and blocked every queued scene behind it — the unattended carriers now tell the runtime nobody is watching, and it reports through the run log and the Daz log instead, while the visible, human-run scripts keep their dialogs. And a failed export can no longer cost the previous good export set: the pre-export sweep now moves the old files aside instead of deleting them, puts them back (PoseAsset CSV included) when the exporter produces nothing or throws, and only drops them once the new set has actually landed. Save the character (or Tools → Refresh assets) after updating to regenerate the scripts.

- [#895](https://github.com/polynaut/dth-character-studio/pull/895) [`6dc1ea4`](https://github.com/polynaut/dth-character-studio/commit/6dc1ea4d58b39f41cf281c0703e6ea3025d740ce) Thanks [@polynaut](https://github.com/polynaut)! - The "last ROM run reported problems" report no longer repeats the same paragraph on every row. A dialed walked morph used to carry a ~330-character explanation in its own line, so three offenders meant three identical essays and the part that actually differs between them — the value, and whether the dial is ERC-driven — was buried at the front of each.

  Each row is now a one-liner (`frame 196 · Genesis8_1Female / PBMBreastsHeavy — dialed at 0.089 - DRIVEN, zero the controlling dial and rebuild`), and the shared explanation is stated once above the list, where it also names where the zeroing happens: in the Daz scene. Needs runtime v86: Tools → Refresh assets after updating, or the next run still writes the old long reasons.

- Updated dependencies [[`025f6d5`](https://github.com/polynaut/dth-character-studio/commit/025f6d5898e5776348c0e6f0b2b197fbb2890aee), [`6dc1ea4`](https://github.com/polynaut/dth-character-studio/commit/6dc1ea4d58b39f41cf281c0703e6ea3025d740ce)]:
  - @dth/rom@0.83.2
  - @dth/ui@0.83.2

## 0.83.1

### Patch Changes

- [#890](https://github.com/polynaut/dth-character-studio/pull/890) [`832988d`](https://github.com/polynaut/dth-character-studio/commit/832988d0b8fbe2cbe8cb6a509d8452eafec6aa35) Thanks [@polynaut](https://github.com/polynaut)! - Generate Houdini project: no more red "name already exists" flash under the name input while the dialog closes after a successful generation — the dialog was catching its own freshly created project in the live collision check.

- [#889](https://github.com/polynaut/dth-character-studio/pull/889) [`d669744`](https://github.com/polynaut/dth-character-studio/commit/d6697440528acf09270ede94f2210895887e18a2) Thanks [@polynaut](https://github.com/polynaut)! - Internal, no behaviour change: the lint gate no longer carries a warning-count baseline. The 221 advisory warnings the repo kept on purpose are now exempted where they happen — a file-level `oxlint-disable` with its reason in the modules whose whole shape is ordered filesystem work, an `oxlint-disable-next-line` with its reason at one-off sites, and one rule turned off in `.oxlintrc.json` because its suggested fix (mutate in place) is wrong for immutable state. `pnpm lint` now runs `--deny-warnings` over a tree at zero, so any new warning fails outright instead of hiding inside a total.

- [#893](https://github.com/polynaut/dth-character-studio/pull/893) [`5fe2a9d`](https://github.com/polynaut/dth-character-studio/commit/5fe2a9d5e7a52da38b7100bce6d0bcca5f750b56) Thanks [@polynaut](https://github.com/polynaut)! - The generated Daz scripts no longer lose the DTH runtime on the first scene of a cold-started export or scan (runtime v84). On the first row of a Runner batch in a freshly launched Daz, `getScriptFileName()` could answer with a Daz-internal path, so the runtime include resolved into `DAZStudio4/resources/` and the row failed "runtime missing" with the runtime installed and intact.

  Nothing a batch row depends on reads that answer alone any more: every generated script (and the per-run scan script) probes the normal location first and falls back to the install root baked in by the studio; the installed runtime uses absolute includes; and the bulk scan carriers get their config/content-root folder baked in too, rather than deriving it from the same call. The failure report now names every probed location plus the script's raw self-reported folder.

  Save the character (or Tools → Refresh assets) after updating to regenerate the scripts.

- Updated dependencies [[`5fe2a9d`](https://github.com/polynaut/dth-character-studio/commit/5fe2a9d5e7a52da38b7100bce6d0bcca5f750b56)]:
  - @dth/rom@0.83.1
  - @dth/ui@0.83.1

## 0.83.0

### Patch Changes

- [#882](https://github.com/polynaut/dth-character-studio/pull/882) [`cf6e78b`](https://github.com/polynaut/dth-character-studio/commit/cf6e78ba32424d1f72ef04834db214e02089ddfa) Thanks [@polynaut](https://github.com/polynaut)! - Fix the "Waiting for Daz Studio to close…" flow: the studio now reliably starts Daz Studio itself once the closing process is gone — a failed launch is retried every second (and surfaced in the dialog after repeated failures), and a launch that dies against a not-fully-dead Daz instance is detected and relaunched instead of being reported as success. The dialog also can no longer get stuck open: it stands down as soon as the batch shows real work (including progress-log activity, which the old check missed for one-scene batches) and always closes itself once the batch finished or was aborted — the contradictory "export finished + still waiting for Daz to close" state is gone. Every other way out is bounded too: the relaunches are spaced and capped (a Daz that keeps exiting is reported instead of started once a second), a job file that stays unreadable ends the wait, and the retry message now names whether the launch or the status check is what failed.

- [#886](https://github.com/polynaut/dth-character-studio/pull/886) [`a158c5c`](https://github.com/polynaut/dth-character-studio/commit/a158c5c54e93f7f2d26827964274e9569ea0e983) Thanks [@polynaut](https://github.com/polynaut)! - Starting a new ROM run now clears the previous run's report instead of leaving it over a live progress bar. The red "Errors in the last ROM run" button and the red ROM rows used to disappear only when Daz eventually wrote a new log, so they sat there for the whole run. A run now retires exactly the scenes it re-runs — a **DTH Export** batch its selection, **"Generate new ROM"** the one scene it rebuilds — so the findings of a scene the run never opens survive, because nothing else is going to rewrite them. An **Export only** run retires nothing at all: it rebuilds no ROM, so the report still describes the ROM it is exporting. Both halves clear together, on disk as well as on screen — which also stops old failures from being merged into the new run's report (the run log merges per scene) and from being re-raised by the character page's on-focus refetch.

- [#884](https://github.com/polynaut/dth-character-studio/pull/884) [`83851f5`](https://github.com/polynaut/dth-character-studio/commit/83851f57995a09420574d5c10f48cc15342b68a0) Thanks [@polynaut](https://github.com/polynaut)! - Failed-morph red rows are now scoped to the scene whose run reported them: selecting another Daz scene no longer shows the primary scene's failures as red rows in its grid. A failure is a per-scene fact — the dialed-walked gate reads the dial values of the scene the row ran in. An untagged run (unsaved scene, or a pre-v54 log) still marks every scene's grid, since it cannot be pinned on one. Clicking a failure in the run report now actually switches to the scene that reported it: the log's path spelling (Daz's forward slashes) is resolved to the linked scene's stored spelling first — the raw path silently fell back to the primary scene.
- Updated dependencies [[`18ae7c5`](https://github.com/polynaut/dth-character-studio/commit/18ae7c521f01a6275e355b88bb6165388b7eff3e)]:
  - @dth/rom@0.83.0
  - @dth/ui@0.83.0

## 0.82.1

### Patch Changes

- [#880](https://github.com/polynaut/dth-character-studio/pull/880) [`d086181`](https://github.com/polynaut/dth-character-studio/commit/d08618141a4041c222545ede2f8973b4b8906518) Thanks [@polynaut](https://github.com/polynaut)! - Failed-morph rows in the ROM editor are now marked by the **morph itself**, not by its row position. The run report stores frame numbers from run time, while the grid renumbers frames on every edit — so after deleting or reordering rows, the red marks stayed on the old positions and lit up whatever morph had moved into them. Rows walking a reported morph are now red immediately when the report appears (no longer only after selecting the failing scene), stay red through edits, and clicking a failure in the report jumps to the morph's actual row.
- Updated dependencies []:
  - @dth/rom@0.82.1
  - @dth/ui@0.82.1

## 0.82.0

### Patch Changes

- [#875](https://github.com/polynaut/dth-character-studio/pull/875) [`1c58289`](https://github.com/polynaut/dth-character-studio/commit/1c58289c656d1307603239504a1ac70df89ab11a) Thanks [@polynaut](https://github.com/polynaut)! - Dependency refresh: TanStack Router 1.170.28 (+ router plugin and devtools), lucide-react 1.31.0 and sonner 2.0.8 in the app UI.

- [#863](https://github.com/polynaut/dth-character-studio/pull/863) [`79e7f92`](https://github.com/polynaut/dth-character-studio/commit/79e7f92f0d05c25107d69cd4623dfa359297d9ab) Thanks [@polynaut](https://github.com/polynaut)! - **Export only** disappears from the installation you activate.

  Activating the Daz install that was flagged **Export only** left its switch on
  screen — now on the _active_ card, still on — which reads as if activating had
  somehow demoted the install. It cannot mean anything there: the flag says "the
  export batch runs somewhere other than where everything else runs", and an
  installation that runs everything is exactly the case it excludes.

  So the switch is no longer offered on the active card, and activating a flagged
  install clears the stored flag in the same save. Hiding it alone would have been
  the worse half of the fix: the flag would stay armed with nothing on screen to
  disarm it, harmless only because it happened to point at the active folder
  anyway.

  A flag an earlier version already left stranded on the active installation is
  cleaned up the same way: the next activation — any activation — disarms it,
  instead of letting it spring back as a redirect to the previous Studio.

  Nothing changes for the arrangement the flag is actually for — a newer Studio
  running everything with the batch kept in an older one still works exactly as
  before.

- [#872](https://github.com/polynaut/dth-character-studio/pull/872) [`e6eff51`](https://github.com/polynaut/dth-character-studio/commit/e6eff5154d59ccbf5207a20b8225908c03283609) Thanks [@polynaut](https://github.com/polynaut)! - **Mesh SubD level is held back** — reverted before it reached a release.

  The feature stamps one subdivision level on the viewport dial and the render
  dial of every mesh under the figure, and it was built against **guessed Daz
  property names**: there was no live Daz Studio to measure them on. The design
  absorbs that (candidate names, then a search by shape, then a read-back of every
  setter, and a run warning when nothing is found), but "absorbs it" is not
  "verified", and the one thing the feature promises — that what you judge a pose
  on is what gets exported — is exactly the thing that cannot be claimed until a
  real figure has been stamped.

  So it comes out of this release rather than shipping unverified. Nothing changes
  for anyone: it merged and was reverted without a version in between, so no build
  ever offered the setting. It goes back in once the property names are measured.

- Updated dependencies [[`1c58289`](https://github.com/polynaut/dth-character-studio/commit/1c58289c656d1307603239504a1ac70df89ab11a), [`e6eff51`](https://github.com/polynaut/dth-character-studio/commit/e6eff5154d59ccbf5207a20b8225908c03283609), [`eafecf9`](https://github.com/polynaut/dth-character-studio/commit/eafecf960a10a9a9bec2a078c3926e4b7766af25)]:
  - @dth/ui@0.82.0
  - @dth/rom@0.82.0

## 0.81.0

### Minor Changes

- [#862](https://github.com/polynaut/dth-character-studio/pull/862) [`b21860c`](https://github.com/polynaut/dth-character-studio/commit/b21860c50f786ead4def890ad9de83f8b88b6b67) Thanks [@polynaut](https://github.com/polynaut)! - Deleting a Daz scene now cleans up after itself.

  Removing a scene with **Delete file on disk** ticked used to delete the scene
  file and its thumbnails but leave the scene's subfolder behind — with the saved
  `rom-animations/` inside it still filling the disk. Now the scene's own
  subfolder is deleted whole, saved ROM animations included.

  A scene that shares its folder with others (the pre-subfolder layout parked
  every scene directly in the scenes root) loses only its own files plus its own
  `rom-animations/<stem>_ROM.duf` — a folder any other linked scene still uses is
  never touched, and a linked-in-place scene stays unlink-only as before. The
  remove dialog now says which of the two a delete will do.

  Replacing the primary makes the same decision for the old copy: its subfolder
  goes whole when the replacement vacated it, and a shared folder loses the old
  scene's files plus its saved ROM animation — which used to be left behind as a
  stale `rom-animations/<oldStem>_ROM.duf` either way.

  The scene's **export folder** (`daz-export/<subfolder>/` — the generated
  `.dth`/FBX/Alembic/CSV) is cleaned up too, in both flows and both modes. Two
  guards there: an export folder a remaining scene uses is kept (a replacement
  landing in the same subfolder keeps the folder it's about to export into), and
  an export root outside the character folder (a pre-v29 hand-picked path,
  possibly shared between characters) is never deleted from. The remove dialog
  copy names everything a delete will take.

### Patch Changes

- [#860](https://github.com/polynaut/dth-character-studio/pull/860) [`e69428a`](https://github.com/polynaut/dth-character-studio/commit/e69428a15b20d1efb1b6da17c9ab7566d30c1304) Thanks [@polynaut](https://github.com/polynaut)! - The character header portrait now sits right for Genesis 3, 8 and 8.1.

  Daz doesn't frame every generation the same way in the tip image it renders — a
  G3/G8/G8.1 figure comes out sitting noticeably higher in the square than a G9
  one. The header pan was tuned against G9, so on those characters it clipped the
  top of the head and left a band of empty tile under the chin. They now get their
  own resting and collapsed offsets; G9 is unchanged.

  The smaller portrait tiles elsewhere still use one crop for every generation and
  are unchanged here.

- Updated dependencies []:
  - @dth/rom@0.81.0
  - @dth/ui@0.81.0

## 0.80.0

### Patch Changes

- [#857](https://github.com/polynaut/dth-character-studio/pull/857) [`a38e06d`](https://github.com/polynaut/dth-character-studio/commit/a38e06d6f584f072e24cae8f6837af61b0c89a3f) Thanks [@polynaut](https://github.com/polynaut)! - A ROM run no longer cancels its export over a handful of stubborn keys — and it
  tells you which keys they were.

  Measured on LaraCroft G8.1 (DS 4.24): a ROM+export run reported `4 of 7968
key(s) would not read back LINEAR`, and exported **nothing**. That line was
  filed as a run error; a run error makes the ROM "not clean"; and the generated
  script exports only when the ROM built clean. The batch row still finished as
  `done`, so what the user saw was a completed run, an empty export folder, and no
  reason short of opening the Daz log — while the character's Houdini scene failed
  its load-time cook for the FBX that was never written. The only way to
  regenerate it was another full ROM run, which hit the same gate every time.

  **Interpolation findings are now warnings, and the export runs.** A key that
  kept Daz's default interpolation still holds its own value, so every ROM pose
  frame is exact — only the motion _between_ pose frames on that channel differs,
  which a PoseAsset export does not sample. What still fails a run is a key whose
  **value** could not be restored, because that one does make a pose frame wrong.
  A Daz build too old to read interpolation back also warns rather than blocks:
  "this Daz cannot answer the question" is not evidence that the answer is bad.

  **Every unfixable key is now named** — node path, dial (with its Parameters
  path), key index, frame, and the interpolation Daz actually reports instead of
  Linear, e.g. `CONSTANT (1)`. Previously there was only a count, which nobody
  could act on: not the node, not the dial, not the frame. The list is capped per
  kind so a pathological run cannot flood the Daz log, with the exact totals in
  the message, and it goes into the run log the studio reads back — not only into
  the Daz log. The channels that keep an implicit frame-0 key are named the same
  way, with the reason each was left alone.

  The studio shows warnings as prominently as errors: the character page's run
  report now appears for a run that exported _and_ had something to say, in amber
  instead of red, with the same button in the sticky header.

  Not yet re-run in Daz — the behaviour is pinned by tests that drive the shipped
  runtime over the measured Daz semantics (`setKeyInterpolationType` does nothing,
  `setValue` is what rewrites a key), but the next real ROM run is what will show
  the named keys for the 4 that started this.

  One class of finding turned out not to be a finding at all. A key that is its
  channel's ONLY key, at frame 0, interpolates across nothing — there is no second
  key to travel to — so whether the stamp took cannot change any value anywhere.
  That exemption previously applied only to keys whose value REFUSED to move,
  which was an accident of the scene it was measured on rather than a property of
  spans. The first real run proved it: all four of its findings were single keys at
  frame 0 on `Bone Fill Opacity` / `Bone Edge Opacity` — viewport drawing dials
  under `/Display/Scene View/Bones` that nobody had animated, which reach the walk
  only because Daz reports an implicit frame-0 key for never-keyed channels. Those
  four are now correctly counted as spanning nothing, and each reported key also
  carries its channel's key COUNT, so "does this interpolation span anything?" is
  answerable from the report instead of requiring a scene to open.

  Regenerate the character (Tools > Refresh assets) and re-run the ROM to pick
  this up: runtime 78 -> 80.

- [#857](https://github.com/polynaut/dth-character-studio/pull/857) [`a38e06d`](https://github.com/polynaut/dth-character-studio/commit/a38e06d6f584f072e24cae8f6837af61b0c89a3f) Thanks [@polynaut](https://github.com/polynaut)! - A failed unattended run no longer freezes Daz Studio.

  Measured on DS 4.24: a `MessageBox` in a script the Runner executes waits
  forever for a click nobody is there to make. What that looks like from outside
  is not a dialog — it is Daz's log stopping dead at `Loading script` with nothing
  after it, no "Script executed successfully", CPU flat, and the batch row never
  completing. It is indistinguishable from a hung `include()`, which is exactly
  where the hunt goes; the runtime being blamed is working perfectly. The tell is
  that the script's own side effects already happened (the failure log is written,
  with the right content) and Daz's main window is _disabled_ rather than visibly
  modal.

  Every hidden (dot-prefixed) carrier — the ones the Runner executes — now reports
  its failures to the log and the run report instead of opening a dialog, and a
  test pins that. The visible Content Library scripts keep their dialogs: a human
  double-clicks those, and there the dialog is the point.

  Two of the three carriers were reachable in ways the existing guard missed.
  `.Build_ROM_Animation.dsa` is generated with `bulk = false` (it wants the
  interactive script's shape) yet is executed by the Runner, so gating dialogs on
  "is this the bulk variant" left precisely that carrier able to hang a run —
  "unattended" is now its own flag. And the export carrier's existing `unattended`
  switch only reached the export block, so the two guards that fire _first_ — the
  wrong scene, and no figure in the scene — could still stop everything.

  Also fixed: when the runtime genuinely cannot be loaded, the error named a path
  the script had never looked in (Daz's own `resources` folder), because the
  runtime files reassign the `dir_self` the message was built from. The script now
  captures its own folder before the first include and reports that, so the
  message stops accusing a healthy install of being broken.

- [#857](https://github.com/polynaut/dth-character-studio/pull/857) [`a38e06d`](https://github.com/polynaut/dth-character-studio/commit/a38e06d6f584f072e24cae8f6837af61b0c89a3f) Thanks [@polynaut](https://github.com/polynaut)! - The character name shrinks further when the editor header collapses on scroll —
  the `dth-title-text` keyframes now end at 2rem instead of 2.75rem, giving the
  form more room once you have scrolled past the avatar.

  The animation's starting size is unchanged (3.25rem), so it still matches the
  size the header renders the title at when it is expanded, and the transition
  into the scroll timeline stays jump-free.

- Updated dependencies [[`a38e06d`](https://github.com/polynaut/dth-character-studio/commit/a38e06d6f584f072e24cae8f6837af61b0c89a3f), [`a38e06d`](https://github.com/polynaut/dth-character-studio/commit/a38e06d6f584f072e24cae8f6837af61b0c89a3f)]:
  - @dth/rom@0.80.0
  - @dth/ui@0.80.0

## 0.79.2

### Patch Changes

- [#855](https://github.com/polynaut/dth-character-studio/pull/855) [`f9a7435`](https://github.com/polynaut/dth-character-studio/commit/f9a74359103e108965657e7073ed077f8d72aebc) Thanks [@polynaut](https://github.com/polynaut)! - Every ROM key is written LINEAR — including the one at frame 0.

  Measured on a shipped ROM animation (DS 4.24): of its 292 morph channels, 230
  came out CONSTANT and only 62 LINEAR, and all 1298 transform channels were
  CONSTANT. The split was never two kinds of morph — the CONSTANT ones are exactly
  the channels mrpdean's ROM **presets** key, which arrive carrying the
  interpolation stored in the preset `.duf`, and the LINEAR ones exactly the
  channels the runtime creates itself. The pass meant to make them agree had two
  faults: it skipped node properties wholesale (to protect transforms — but every
  control dial lives there, ~190 channels), and on the ones it did walk,
  **`setKeyInterpolationType` changed nothing at all** — measured over 7747 keys,
  in both overloads, with no error.

  What works, measured the same way, is rewriting the key through
  **`setValue(t, v, LINEAR)`**: the interpolation argument is what lands, it is a
  no-op unless the value changes (so the value is nudged off and put back
  exactly), and it holds at any time and inside an undo hold. That is what the
  pass does now, reading every key back to confirm rather than assuming.

  A few channels can never be re-keyed — locked transforms (`min == max`) and
  hidden ERC controllers refuse the nudge. Measured, every one of them is a single
  key at frame 0, where interpolation spans nothing. They are counted and
  reported separately instead of being treated as failures.

  Frame 0 is fixed too. Daz serializes a channel whose first real key sits later
  as `[0, value]` with no interpolation element, and such a key **loads back as
  TCB** — a spline key, not the Linear one the ROM intends. Those keys are now
  written explicitly.

  Transform and bone channels are included, on the same reasoning: values at the
  keyed pose frames are identical under either interpolation, so only the motion
  _between_ pose frames changes. The pass also covers every node under the figure
  — geografts and conformed clothing carry keys the run wrote too.

  Two long-standing latent bugs fell out of this: `DzProperty.Linear` does not
  exist on DS 4.24, so all three places the runtime passed it — the two
  `Scene.setDefaultKeyInterpolationType` calls and, the one that actually decides
  a key's interpolation, `setPropertyByName`'s `setValue(t, v, interp)` — had been
  handing Daz an undefined enum; and the key-interpolation pass had been silently
  ineffective for as long as it has shipped.

  One consequence to know about: with the session default finally getting a real
  constant, running a ROM script leaves your Daz creating **Linear** keys
  afterwards. The ROM does not depend on it — every key is stamped explicitly —
  but it is a setting the script changes and does not put back.

  The pass now reports only what it can prove. A key whose value will not move is
  called harmless only where this scene confirms it is that channel's one key at
  frame 0; anywhere else it is a logged failure. A Daz build that cannot read
  interpolation back gets "rewritten, unverified" rather than a clean bill. A
  nudge that cannot be put back is reported as the value problem it is, ahead of
  any interpolation complaint. And with no LINEAR constant available at all, the
  pass stops before touching the scene instead of nudging every value for nothing.

  Verified on a real ROM (LaraCroft G8.1, DS 4.24): 292 of 292 morph channels and
  1298 of 1298 transform channels come out LINEAR on every key, frame 0 included,
  with no channel missing its first-key interpolation — and every key value,
  including each morph's base and its full-strength spike, identical to before.

  Regenerate the character (Tools > Refresh assets) and re-run the ROM to pick
  this up: runtime 76 -> 78.

- Updated dependencies [[`f9a7435`](https://github.com/polynaut/dth-character-studio/commit/f9a74359103e108965657e7073ed077f8d72aebc)]:
  - @dth/rom@0.79.2
  - @dth/ui@0.79.2

## 0.79.1

### Patch Changes

- [#840](https://github.com/polynaut/dth-character-studio/pull/840) [`3b7dc64`](https://github.com/polynaut/dth-character-studio/commit/3b7dc64bf51ba948aa8d5fbecc400867674b1ab8) Thanks [@polynaut](https://github.com/polynaut)! - The busy accent bar animates with moving stripes — and keeps moving under reduced motion

  The single travelling glint was the wrong shape for a 6px bar: most of each
  cycle the bar looked idle (the glint was off-screen) and the moving edge was
  too subtle to register. It is the barber-pole from the classic CSS-Tricks
  progress bar instead — a 45° stripe pattern shifted one tile per cycle — so
  something is always moving.

  More importantly, the bar no longer switches its animation OFF under
  `prefers-reduced-motion: reduce`; it slows down. The stripes are a background
  image, so stopping them left a static striped bar that read as decoration while
  the "this project is being re-read" signal was silently gone — which is what
  happened on a Windows machine with Accessibility → Visual effects → Animation
  effects turned off. A loading indicator is the essential-motion case.

- [#846](https://github.com/polynaut/dth-character-studio/pull/846) [`e9d4ace`](https://github.com/polynaut/dth-character-studio/commit/e9d4aced08ac9545313deb378b84e67b8dda49a6) Thanks [@polynaut](https://github.com/polynaut)! - The DTH Export finish toast stops contradicting itself

  A run that exported one scene in 45s was titled exactly that, above a
  description of an earlier run's two scenes in 7m 50s and 25m 32s — the same Daz
  warning printed twice, a green tick over an Unreal failure, and every line
  welded into one paragraph.

  Five paths end a run and all write the same sticky toast. Sonner merges an
  update over the existing one, so a path that passed no description inherited the
  previous report's body; every path now passes it explicitly. The per-leg lines
  render as lines again (the newlines were collapsing), and the Daz problems are
  deduplicated, stripped of their "Continue anyway?" — a question the script
  answered minutes before anyone reads it — and capped, with the tail counted.

- [#843](https://github.com/polynaut/dth-character-studio/pull/843) [`04504b4`](https://github.com/polynaut/dth-character-studio/commit/04504b4c7d1337d0f13db47cbd8bbbff3b3eee92) Thanks [@polynaut](https://github.com/polynaut)! - DTH Export: Start closes the panel at once, and Daz opens where you can see it

  Three fixes to one flow:

  - **The wait was paid twice.** The panel awaited `executeCharacterJobs`, which
    blocked for up to 10s polling for the Runner to claim the batch — so Start sat
    on "Starting…" before the panel would close, and the run watch then waited all
    over again. The claim wait now belongs to the watch, where the run is already
    on screen and abortable; the panel closes the moment you click.
  - **An export no longer launches Daz minimized.** The minimize is
    fire-and-forget and never worked, so a successful launch left no window to
    see — indistinguishable from a launch that failed, while the studio said
    "Opening Daz Studio". Scans still minimize; a run you are watching does not.
  - **A claimed batch stops claiming to be unclaimed.** Between the claim and the
    Runner's first progress line, the status read "Waiting for Daz Studio to pick
    the batch up" at 0% — for the whole of a cold scene open.

- [#840](https://github.com/polynaut/dth-character-studio/pull/840) [`3b7dc64`](https://github.com/polynaut/dth-character-studio/commit/3b7dc64bf51ba948aa8d5fbecc400867674b1ab8) Thanks [@polynaut](https://github.com/polynaut)! - The Houdini card's rescan indicator is the orange bar itself, not a spinner

  While hython re-reads a project, the card's Houdini-orange left accent bar now
  lights up — a brighter glint sweeps down the stripe — instead of a small
  spinner appearing over the thumbnail. Same meaning ("this project is being
  re-read", cache hits never show it) and the same announcement to assistive
  tech; reduced-motion setups get a steadily lit bar instead of the sweep. The
  card stays fully usable throughout, exactly as before.

- [#844](https://github.com/polynaut/dth-character-studio/pull/844) [`8fdabb0`](https://github.com/polynaut/dth-character-studio/commit/8fdabb03f0de1122c32a46c92e687fd68bb3f576) Thanks [@polynaut](https://github.com/polynaut)! - Unlinking or deleting a Daz scene no longer re-offers it as a "new file"

  Removing a scene made it a discovery by definition — unlinked, still in the
  folder — so the banner announced it the moment the unlink saved. For a DELETE it
  was worse: the unlink persists before the file is removed (deliberately, so a
  failed save never points the character at deleted files), and persisting is what
  re-runs the folder scan, so the scan raced the delete and left a banner
  advertising a file that no longer existed until the next window focus. Removal
  now answers for the file in both cases.

- [#849](https://github.com/polynaut/dth-character-studio/pull/849) [`cfd063e`](https://github.com/polynaut/dth-character-studio/commit/cfd063e6527d8c1335cf41aa66089d308fc7804d) Thanks [@polynaut](https://github.com/polynaut)! - The per-character product-scan script gets a Content Library tile.

  `Scan_Products_<Name>.dsa` was the last generated script installed without
  artwork, so it showed up in Daz's Content Library as a broken-image placeholder
  next to the ROM and Export scripts that have had tiles since v0.68. It now
  carries its own, in both sizes Daz reads by name (the 91×91 tile and the 256×256
  hover preview).

  Turning Daz Products off retires the tiles along with the script, rather than
  leaving artwork behind pointing at a script that no longer exists.

  The scripts themselves are unchanged — but artwork only lands when a character
  regenerates, so this ships as a runtime-version bump: existing characters pick
  the tile up on their next save, or all at once via **Tools → Refresh assets**.

- [#847](https://github.com/polynaut/dth-character-studio/pull/847) [`397366f`](https://github.com/polynaut/dth-character-studio/commit/397366ffff5905c6ad490d6746d48f1cb5b94019) Thanks [@polynaut](https://github.com/polynaut)! - Start scan says it is working, and a blocked save paints the field that blocked it

  Two fixes that were written on 2026-08-10 and never opened as a PR:

  - **Start scan looked dead.** `startSceneScan` does not return quickly — on a
    Daz that is already up it waits for the Runner to claim the handoff, polling
    for up to 10s before it either resolves or takes the job back. The button sat
    there enabled and unchanged for that whole time, so the click read as ignored.
    It now shows that it is working.
  - **A blocked save only toasted.** A pose name Houdini will reject fails the
    save, but the offending row looked exactly like every other one — the user had
    to hunt for it. The failing field is now painted with the reason.

- [#848](https://github.com/polynaut/dth-character-studio/pull/848) [`0480f19`](https://github.com/polynaut/dth-character-studio/commit/0480f19155ceb3fd11b180464b515484d57dc65d) Thanks [@polynaut](https://github.com/polynaut)! - DTH Export can no longer report a run that produced nothing as a success.

  The Runner's contract ends at "the script I started returned", so a row whose
  generated script refused the scene, bailed for want of a runtime, or failed
  mid-ROM came back `done` — indistinguishable from one that exported. The finish
  report believed those rows, and a run that wrote no files toasted "1 scene
  exported" while the character page's own run report showed the failure right
  underneath it. It now reads the scripts' own channel (the ROM run log,
  restricted to entries written since the handoff and de-duplicated against rows
  the Runner already failed), counts those scenes as failures, names them in the
  report, and holds back the Houdini/Unreal continuation when nothing survived.

  A morph that could not be applied is deliberately not counted: its frame stays
  in the ROM (empty) and the export runs, so a scene whose only problem was a
  missing dial is still a scene that exported.

  Three fixes on the Daz side of the same story:

  - A catastrophic-failure log always tags its scene now. The old fallback shape
    had no `scene` field and fired whenever there was no previous log to merge —
    the common case, since the studio deletes the transport log as it ingests one
    — so a failure could reach the report attributed to no scene at all.
  - The "runtime could not be loaded" report probes for the runtime file and says
    what it found: missing gets the reinstall advice, present gets "Daz failed to
    load it — run the export again". A failed `include()` logs nothing in Daz, so
    this is the only evidence such a run leaves behind, and the blanket reinstall
    advice sent users to rebuild an install that was never broken.
  - Every string a DTH script writes or displays is ASCII — the generated
    carriers and the bundled runtime alike. Daz's file writer cannot carry
    anything else: the arrow in "Tools → Refresh assets" reached the run report as
    "Tools ? Refresh assets", and em dashes printed to the Daz log arrived as
    mojibake. The runtime's product- and morph-scan messages were carrying 13 of
    these, one of them a diagnostics heading written straight to a file.

- Updated dependencies [[`3b7dc64`](https://github.com/polynaut/dth-character-studio/commit/3b7dc64bf51ba948aa8d5fbecc400867674b1ab8), [`3b7dc64`](https://github.com/polynaut/dth-character-studio/commit/3b7dc64bf51ba948aa8d5fbecc400867674b1ab8), [`cfd063e`](https://github.com/polynaut/dth-character-studio/commit/cfd063e6527d8c1335cf41aa66089d308fc7804d), [`0480f19`](https://github.com/polynaut/dth-character-studio/commit/0480f19155ceb3fd11b180464b515484d57dc65d)]:
  - @dth/ui@0.79.1
  - @dth/rom@0.79.1

## 0.79.0

### Minor Changes

- [#837](https://github.com/polynaut/dth-character-studio/pull/837) [`61d969e`](https://github.com/polynaut/dth-character-studio/commit/61d969ea1429fd97769b0e57c72a634de6207383) Thanks [@polynaut](https://github.com/polynaut)! - Frame-0 and preserve morphs can be scoped to one scene item

  The morph autocomplete always knew which item a suggested dial lives on — the
  node badge on every suggestion — but picking one only kept the name. "Add
  morphs on frame 0" then applied the row on **every** node carrying that name,
  and auto-follow puts a figure morph's twin dial on every conformed item: a
  `FBMExpandAll -100%` meant for a backpack deformed the boots, gloves and
  holster too. "Preserve morphs" had the opposite failure — it only ever searched
  the figure root, so a clothing morph listed there silently did nothing.

  Both lists now carry an **Item** scope (schema v32, runtime v74). Picking a
  suggestion sets it — the index knows which item a dial lives on — and the row
  shows it as small labels under the name field, mirroring the suggestion that
  was picked (node badge, "this scene", the Daz UI name), with an ✕ that clears
  the scope. Empty keeps each list's old reach — every carrier for frame-0
  rows, the figure root for preserve rows — so existing characters generate
  unchanged. A scoped item
  that isn't in the open scene logs a Daz-log warning naming it, never a run-log
  failure, matching the lists' deliberately unvalidated design.

### Patch Changes

- [#841](https://github.com/polynaut/dth-character-studio/pull/841) [`c384999`](https://github.com/polynaut/dth-character-studio/commit/c384999b2ffee81556e166d2adb14663e4765539) Thanks [@polynaut](https://github.com/polynaut)! - Internal: the DTH Export API is four layered modules instead of one 2,400-line file

  No behaviour changes. `api/execute.ts` is now the front door — every symbol it
  exported before is still exported from it — and the implementation lives in
  `api/execute/`, in layers that only import downward: `primitives` (the
  character, the handoff stamps, the Daz probes and launch), `run-state` (the run
  sidecar, progress log, interrupt/abort), `jobs` (the handoff itself) and
  `scans` (the project and scene scans riding it).

  One deliberate change came with the split: the shared "which run does this
  window own" slot was a module-level `let`, which cannot be assigned across a
  module boundary, so it is now a holder object (`runOwner.current`). Same single
  slot, same semantics.

- [#836](https://github.com/polynaut/dth-character-studio/pull/836) [`f6bb3d7`](https://github.com/polynaut/dth-character-studio/commit/f6bb3d7f3549cbcc54f251e7161c001397de5872) Thanks [@polynaut](https://github.com/polynaut)! - DTH Export run display polish, and the Unreal leg becomes re-import only

  The run's task list now stacks bottom-up like a log — the first job at the
  bottom, the row being worked always right above the progress bar — with one
  line per row instead of two, and the whole panel is exactly as wide as the
  header's button row instead of out-growing it.

  The separate **Interrupt** button is gone: the **Working** button is the
  interrupt now. Hover it and the spinner becomes a stop mark (_Click to
  interrupt_); a click stops the run at its next safe point, exactly as before.

  And the Unreal leg only ever **re-imports**: a set the target project has never
  held is dropped from the send and named in the report, and a project holding
  nothing the run makes goes inert in the panel. A character's first import into
  an Unreal project is made in Unreal itself — from then on, runs re-import it in
  place.

- [#837](https://github.com/polynaut/dth-character-studio/pull/837) [`61d969e`](https://github.com/polynaut/dth-character-studio/commit/61d969ea1429fd97769b0e57c72a634de6207383) Thanks [@polynaut](https://github.com/polynaut)! - Preserve morphs now hold across the WHOLE ROM; frame-0 morphs apply first

  Two ordering fixes in the ROM build. "Preserve morphs after ROM loading" ran
  right after the base ROM preset — before the DK/GP/Physics blocks and the
  custom frames, so anything those later stages keyed won over the preserved
  value: the G8.1 Physics block keys the breast dials to 100%, and a 60% hold
  showed 100% on those frames. The restore now runs after every key-laying
  stage and flattens the listed morphs across the whole timeline — and it no
  longer sits inside the JCM branch, so a ROM without the base block preserves
  too (it previously skipped the restore entirely).

  "Add morphs on frame 0" applied after the preset blocks; it now applies at
  the very beginning of the build, so the frame-0 fit is the base state
  everything else builds on — including the passes that read scene values (the
  close-out baseline and the Auto sawtooth floors, which never saw frame-0
  morphs before).

- [#837](https://github.com/polynaut/dth-character-studio/pull/837) [`61d969e`](https://github.com/polynaut/dth-character-studio/commit/61d969ea1429fd97769b0e57c72a634de6207383) Thanks [@polynaut](https://github.com/polynaut)! - The scene card's open menu slims down: "Open last ROM" / "Generate new ROM"

  The stale hint under the second entry ("From an earlier run — the scene or the
  definition changed since") set the whole menu's width; it now lives in the
  row's tooltip instead. The two ROM entries are renamed — "Open ROM Animation"
  → **Open last ROM**, "Open and Generate ROM Animation" → **Generate new ROM**
  — so the menu is as wide as its labels. What each entry does, and when the
  rebuild is offered, is unchanged.

- [#839](https://github.com/polynaut/dth-character-studio/pull/839) [`e71c5eb`](https://github.com/polynaut/dth-character-studio/commit/e71c5ebc81afac4f33df37bbcf77349098bedfb5) Thanks [@polynaut](https://github.com/polynaut)! - Internal: the three largest source files are split into focused modules

  No behaviour changes — this is pure code motion, verified line by line. The
  Houdini utils drawer and the DTH Export panel each became a small set of
  modules along the seams they already had (the drawer's reports and rows hold no
  drawer state; the export button owns the run while the panel owns what is
  shown), and the character schema's append-only version log moved out of
  `packages/rom/src/types.ts` into `.ai/schema-history.md`, where a version-number
  lookup belongs. Working on any one of these no longer means loading all of it.

- [#837](https://github.com/polynaut/dth-character-studio/pull/837) [`61d969e`](https://github.com/polynaut/dth-character-studio/commit/61d969ea1429fd97769b0e57c72a634de6207383) Thanks [@polynaut](https://github.com/polynaut)! - Daz's undo entry for a ROM build reads "Undo Generating ROM"

  The ROM script's undo block was still labeled "DTH Workflow" — a leftover
  from the pre-studio script era that meant nothing in Daz's Edit menu.

- Updated dependencies [[`61d969e`](https://github.com/polynaut/dth-character-studio/commit/61d969ea1429fd97769b0e57c72a634de6207383), [`e71c5eb`](https://github.com/polynaut/dth-character-studio/commit/e71c5ebc81afac4f33df37bbcf77349098bedfb5)]:
  - @dth/rom@0.79.0
  - @dth/ui@0.79.0

## 0.78.0

### Minor Changes

- [#827](https://github.com/polynaut/dth-character-studio/pull/827) [`0935f74`](https://github.com/polynaut/dth-character-studio/commit/0935f7407feb333e8a31fa0c9080c3cc09748b4a) Thanks [@polynaut](https://github.com/polynaut)! - DTH Export opens in a side panel instead of a centered dialog

  The run has three stacked legs — Daz scenes, Houdini projects, Unreal projects
  — and the old dialog gave them a 576px column inside 85% of the window height,
  so the third one lived below the fold behind a scroll. It is now the same
  drawer the Houdini project utils use: full height, the lists at their natural
  width, and **Start** pinned to the panel's bottom edge where it can no longer
  scroll out of reach.

  Nothing about the run itself changed — the same scenes, modes, pre-selection,
  Runner gate and Interrupt, in a panel that fits them.

  One side effect worth knowing: a drawer, unlike the old dialog, leaves the page
  behind it live, so a file dropped on the dimmed editor while the panel is open
  now lands there (linking a scene, linking a project) instead of being ignored.
  The panel's own scene list still only reads disk when it opens, so a scene
  linked that way shows up the next time you open it. While a run is being handed
  off, Escape, the backdrop and ✕ are all refused, as before.

- [#825](https://github.com/polynaut/dth-character-studio/pull/825) [`938c693`](https://github.com/polynaut/dth-character-studio/commit/938c69334df44c8c6d0d9a95f7953ffed166b183) Thanks [@polynaut](https://github.com/polynaut)! - **A saved ROM animation can be opened whenever it exists — stale or not.**

  A scene card's open menu offered **Open ROM Animation** only while the saved
  `rom-animations/<scene>_ROM.duf` was _current_, and swapped it for **Open and
  Generate ROM Animation** the moment it wasn't. That threshold is far lower than
  it sounds: freshness is dated against the generated ROM script, which every
  character save rewrites, so editing anything at all makes every saved animation
  of that character stale. A primary scene whose ROM had been built and exported
  was therefore offered nothing but a rebuild — a Daz run of many minutes — with
  no way to open the file sitting right there.

  Both entries now stand on their own. The file is on disk, so it opens; when it
  predates the current definition the row says so (_From an earlier run — the
  scene or the definition changed since_) and opens it anyway, because stale is
  not wrong, it is "not from what the character says now" — the user's call. The
  rebuild sits under it whenever it is worth offering: no saved animation, a stale
  one, or Ctrl held to force a fresh build of a current one.

  **Open Original** is now **Open scene** — it opens the scene, and "original"
  only meant anything next to the entry it used to replace.

  While a rebuild is running, the open entry is disabled rather than merely the
  rebuild: the build overwrites the very file that entry points at, and opening it
  would hand the running Daz a scene switch mid-build. It comes back by itself
  when the freshly built animation opens.

- [#824](https://github.com/polynaut/dth-character-studio/pull/824) [`9357832`](https://github.com/polynaut/dth-character-studio/commit/9357832ead49971a89f997673efdaabf92193ef9) Thanks [@polynaut](https://github.com/polynaut)! - **The DTH Export dialog's Unreal section is one tick per project again — the
  export-set list is gone.**

  Under the Unreal projects there was a second tick list, one row per export set,
  built from the character's `export/` folder — i.e. from what an EARLIER run had
  produced. On a THICK variant whose Houdini project writes `LaraClassic_THICK`
  and `LaraNaked_THICK` it offered `LaraClassic` and `LaraNaked`, because those
  were the folders on disk. The sets the run was about to make were not in the
  list at all, and since a ticked project with no ticked set held Start, the one
  thing the list made impossible was the thing it existed for: putting a **new**
  character into an Unreal project. It could only ever re-pick the past.

  Nothing to pick now. What goes is the export sets this run puts in play — named
  by the checked Houdini projects' own scan, or, under _Skip Houdini — use last
  exports_, the exports already on disk. Whether each one refreshes what that
  project has or arrives as a new character is worked out from the project's
  `Content/`, as it always was, and the run's task list names every set with the
  project it lands in. Ticking the project is the whole decision.

  The project rows still pre-tick on "does it already hold what this run makes",
  which is what keeps a variant from landing in Unreal unasked — but the answer is
  now actionable either way. A Houdini project the background scan has never
  reached still names nothing, so nothing pre-ticks and the section says plainly
  that sending anyway hands over the whole export folder; one **Rescan** (Utils
  drawer) narrows it back to what the run makes.

  The standing line under the section — _"Queued for import when the whole export
  finishes…"_ — is gone with it. It described the feature to somebody who had just
  ticked a box to use it. The section now says something only when it cannot send:
  no export to send from, an empty export folder, Houdini projects that write no
  set at all.

  And the pre-tick is looked up for real. The studio checks each linked Unreal
  project for the sets **this run writes**, not only for the ones a previous run
  left in the export folder — so a variant you are exporting for the first time
  from this studio project, but which that Unreal project already holds, is
  correctly ticked as the refresh it is. It used to read as a first import,
  because the check had only ever asked about sets that were already on disk.

  A send whose set names no longer match what Houdini wrote now says so — naming
  both lists and pointing at **Rescan** — instead of reporting "no Houdini export
  found, run the Houdini export first" straight after one succeeded.

### Patch Changes

- Updated dependencies [[`0935f74`](https://github.com/polynaut/dth-character-studio/commit/0935f7407feb333e8a31fa0c9080c3cc09748b4a), [`a4ec3da`](https://github.com/polynaut/dth-character-studio/commit/a4ec3da38ff82d45c646168925b26da342b0c95e)]:
  - @dth/ui@0.78.0
  - @dth/rom@0.78.0

## 0.77.0

### Minor Changes

- [#820](https://github.com/polynaut/dth-character-studio/pull/820) [`590a94d`](https://github.com/polynaut/dth-character-studio/commit/590a94dae97ce5b345fecc7024c4ccd17b082dbd) Thanks [@polynaut](https://github.com/polynaut)! - **A DTH Export run can be interrupted — it stops at the next point where
  stopping is safe.**

  Until now a started run had to be waited out. Holding **Ctrl** on the working
  button offered **Abort** (Daz leg) or **Stop watching** (Houdini leg), and both
  were honest about being escape hatches for the _studio_: they delete a job file
  or drop a watch, while Daz keeps grinding through the batch and Houdini keeps
  exporting. There was no way to say "stop".

  There is now an **Interrupt** button beside the working button, through both
  legs — no modifier, since stopping something you started is not an expert
  manoeuvre. It stops the run itself:

  - The **ROM build** stops between two ROM blocks — or between two custom
    frames, which the runtime checks about once a second.
  - The **export that would have followed** is skipped, and so is every scene
    still queued behind it. A queued scene still opens in Daz (the Runner owns the
    batch and cannot be told otherwise) and then does no work.
  - The **Houdini leg** stops between export nodes and closes its own background
    Houdini; projects still queued never start.

  Everything already written stays where it is. Nothing is killed mid-write:
  whatever synchronous call is running at that moment — a Daz scene load, one DTH
  Exporter export, one DazToHue node — finishes first, which is why the button can
  sit at **Stopping…** for a while on a long node. That wait is the price of
  stopping cleanly, and the tooltip says so rather than promising an instant halt.

  The report says **DTH Export interrupted**, and deliberately quotes **no scene
  counts**: once the flag is down, a scene that exported and a scene whose script
  skipped itself both come back as `done`, and the studio will not guess between
  them. The character's ROM run log names the scene that was cut off mid-build.
  An interrupted Daz batch also never continues into its Houdini projects — the
  point of stopping is that the rest does not happen.

  **The two Ctrl affordances are gone with it.** Both stopped the studio rather
  than the run, which was all that was possible before — keeping them beside
  Interrupt just put two stop-flavoured buttons on one run with nothing on them to
  say which was which. The one thing only Abort could do — clear a job file that
  nothing will ever finish, because a Daz stuck on a dialog reads no flag — is not
  lost, it moved to where housekeeping belongs: **Settings → App Data** clears a
  stuck batch handoff, exactly as it already did.

  Mechanically it is one flag file in the character's meta folder that every
  runtime the studio owns polls: the generated `.dsa` carriers, the DTH runtime
  (now **v73** — regenerate, or Tools → Refresh assets, to get it) and the Houdini
  runner. It is dropped when a run ends and cleared before every new one, so it
  can never quietly skip a run nobody meant to stop. The Runner plugin needs no
  change; the job-file contract documents the optional plugin-side half for later.

- [#816](https://github.com/polynaut/dth-character-studio/pull/816) [`4958a3c`](https://github.com/polynaut/dth-character-studio/commit/4958a3c3de40d1e4c63f7f1be0b393e31ae43680) Thanks [@polynaut](https://github.com/polynaut)! - **A Houdini project card now shows a spinner while it is being read.**

  Checking a project means opening the whole scene in hython — tens of seconds per
  `.hip` — and it happens on a background sweep nobody asked for. Until it landed
  the card showed the _previous_ verdict with nothing to say it was out of date, so
  a badge that was about to appear (or clear) looked settled while it was still
  being decided. A small spinner now sits on the corner of the thumbnail while
  Houdini has that project open, and the card's verdict refreshes the moment its
  own scan lands rather than waiting for the whole sweep to finish.

  Only the projects actually being re-read show it. A project you haven't touched
  is answered from the cache without starting Houdini at all, so a quiet card means
  "nothing to do" — not "not checked yet". Marking those too would have flickered a
  spinner on every card on every page load, which is how a status indicator becomes
  something you stop looking at.

  The card stays fully usable while it spins: opening, renaming, unlinking and the
  Utils drawer all keep working. The scan is something the studio started on its
  own, and it has no business taking the controls away.

- [#815](https://github.com/polynaut/dth-character-studio/pull/815) [`ab222ae`](https://github.com/polynaut/dth-character-studio/commit/ab222ae1e85c13fdccf2854de04c89e195516fac) Thanks [@polynaut](https://github.com/polynaut)! - **Houdini project checks now catch baker textures whose file is gone.**

  A missing texture was the one failure in this pipeline that reported itself as
  success. Measured on DazToHue 2.5 / Houdini 22.0: point a material baker's layer
  texture at a file that does not exist, press Bake, and the Houdini console prints

  ```
  DazToHue: export started
  DazToHue: baking material textures
  DazToHue: export finished in 0:00:02
  ```

  No dialog, no node error, nothing in the log. The HDA is black-boxed so the cook
  itself can't be read, but its bake path can — `do_bake_material_textures` is a
  bare `cook(force=True)`, and the whole material PythonModule holds exactly one
  `os.path.exists`, in the texture browser's drag-and-drop handler. There is no
  check to inherit. The first sign was a wrong-looking character in Unreal.

  The card badge and the Utils drawer's General tab now report it. Like the import
  check, it is deliberately SCOPED — to the material node's
  `material_texture_baker_layer_texture*` parms — because "the file is missing" is
  not a usable definition of broken across a whole `.hip`: a healthy project names
  four of Houdini's own scratch files that simply don't exist until used. Measured
  on a real project (11 bakers, 43 layers): 51 of the material node's 86 file
  parms are these, and all 51 resolve. Zero false positives.

  Unlike everything else the badge reports, this one has no repair button, and
  that is on purpose — the fix is outside the studio (reinstall the product, or
  restore the library). It earns the badge anyway, because nothing else in the
  pipeline will tell you. The wording says so rather than letting "missing" read
  as something Houdini would have caught.

  Also fixed alongside it: a project hython could not open shipped a `refs` block
  without `hipRelative`, which the schema requires — so a single unreadable `.hip`
  failed the parse of the whole scan report and took every other project in the
  sweep with it.

- [#814](https://github.com/polynaut/dth-character-studio/pull/814) [`a5ec8cb`](https://github.com/polynaut/dth-character-studio/commit/a5ec8cb2f7ee92dcf5e5794466933ee838e01c48) Thanks [@polynaut](https://github.com/polynaut)! - **Houdini project names are editable.** Click a project card's name and type a
  new one — the file on disk is renamed with it and the link follows, so a
  generated `3d-workflow_LaraCroft_G81` can just become `Lara`. The same inline
  edit the character title and the Daz scene cards already had.

  The extension is carried over rather than assumed: `.hip`, `.hiplc` and `.hipnc`
  encode the licence tier, and rewriting a commercial `.hip` to `.hiplc` would
  tell Houdini the file is licence-limited. Typing the extension back yourself is
  fine — `Lara.hiplc` renames to `Lara.hiplc`, not `Lara.hiplc.hiplc` — and
  trailing dots or spaces are dropped, because Windows drops them too and the
  project would otherwise be saved under a name you cannot type back.

  Changing only the **capitalisation** is a real rename: `lara` → `Lara` renames
  the file and updates the card, instead of quietly doing nothing.

  Renaming is offered where _moving_ a project still isn't, and that is not an
  inconsistency: everything the studio bakes into a project is anchored on `$JOB`
  (the character folder) and `$HIP` (the folder the file sits in) — both
  **folders**, so the file's own name is the one part of its location nothing
  points at. Moving it would change both.

  Only projects inside the character folder are renamable. One you linked in place
  from your own tree is your file, in a tree the studio can't see the rest of, so
  its name has no pencil — the same rule the Daz scenes already apply.

- [#817](https://github.com/polynaut/dth-character-studio/pull/817) [`2ce67d6`](https://github.com/polynaut/dth-character-studio/commit/2ce67d68289e3758b5af30c418aeeb6d75227f90) Thanks [@polynaut](https://github.com/polynaut)! - **The Houdini Utils drawer now works on the one project you opened it from.**

  Utils are per project — that is why the 🔧 lives on the project card and not on
  the section header. The drawer took that as a starting point rather than a scope:
  it noted _"opened from Kira.hip"_ in its title and then listed every Houdini
  project the character had, offering their checks, their repairs and their nodes
  as transfer targets. Pressing Utils on one card put you in front of work
  belonging to three others.

  Now the card you pressed is the whole subject. The General tab checks that
  project and repairs that project; **Refresh assets**, **Repair project
  settings**, **Make paths portable** and **Fill network** act on it alone; and the
  transfer target is its own DazToHue nodes. To work on another project, open its
  own card's Utils.

  The **source** of a copy is unchanged and still cross-project — copying a setup
  means copying it _from_ somewhere else, which is the one thing here that
  legitimately names another project.

  Two side effects worth knowing:

  - Opening the drawer is cheaper. It used to scan every linked project the cache
    could not answer for; now it scans at most one.
  - Copying one source setup into several projects in a single run is gone. It was
    only reachable by ticking targets across projects in a drawer opened from one
    of them — do it per project instead.

  The guide and the drawer's own tooltips have been corrected along with it: the
  **Target** list never actually pre-ticked anything (the drawer opens on General,
  and moving to a transfer tab clears the selection), so the guide no longer says
  it does — tick the nodes that should receive the copy, which is also the right
  default for something that writes to a `.hip`.

- [#811](https://github.com/polynaut/dth-character-studio/pull/811) [`6c2cc20`](https://github.com/polynaut/dth-character-studio/commit/6c2cc204aded19515132d4b9262194fbdf5b3931) Thanks [@polynaut](https://github.com/polynaut)! - **The live run display is one task list and one progress bar.**

  It used to be three readouts side by side — a narrow column of task cards, a
  tail-mode log window and a two-level meter row — which between them said the
  same thing three ways and left no room for any of them to say anything useful.
  Now there is a single list of what the run does, and one bar underneath it
  carrying the newest thing the run said as a single line.

  **One row per job**, which is what the extra room bought:

  - every selected **Daz scene** says what the run does to it — _ROM + Export_,
    _ROM only_, _Export only_. That choice is made once, in a dropdown that is
    long closed by the time anyone is watching the run;
  - every **DazToHue network** is its own row, named as the network is, with the
    Houdini project it belongs to beside it;
  - every **export set going into an Unreal project** is its own row. Sending two
    characters to one Unreal project is two imports, so it is two rows — each
    naming the set, the project it lands in, and whether it is a **Re-import** of
    assets already there or a **First import**.

  Rows are ticked off as they finish and stay in the list, so it reads as the
  whole run rather than only what is left, and the mark on the right says which
  application is doing it. A row that **failed** is marked as such rather than
  ticked off — a DazToHue network that fell over, an Unreal import that came back
  with an error — because a run's own list is the worst possible place to be told
  everything went fine. The bar measures the whole run — every row, plus the share
  of the one being worked that its leg can actually report.

  The log window's **transcript** is what this gives up: only the newest line
  survives, on the bar. Each leg's full output is on disk either way — the
  Runner's progress log, `.dth_houdini_console.log` in the character folder, and
  the Unreal editor's own log — which is where a post-mortem was read from
  anyway.

- [#812](https://github.com/polynaut/dth-character-studio/pull/812) [`7029342`](https://github.com/polynaut/dth-character-studio/commit/7029342c40f2864afcdbffd8841a3240d632d79f) Thanks [@polynaut](https://github.com/polynaut)! - **Unreal plugins are checked against the engine's actual build, and engines the registry forgot are found.**

  Two fixes for one real failure: a freshly generated project, everything
  installed by the studio, and Unreal opening on _"The following modules are
  missing or built with a different engine version"_.

  **Engine detection now reads Epic's `LauncherInstalled.dat` as well as the
  registry.** Measured: a machine with 5.6, 5.7 and 5.8 installed had **no
  registry key for 5.8** — so the studio never offered it, the project was
  generated for 5.7, and Unreal 5.8 opened it and rebound it. Both sources are
  merged, the registry first — except where the registry names a folder that is
  no longer there and the launcher names one that is, which is the same staleness
  seen from the other side (an engine reinstalled elsewhere would otherwise be
  listed at its dead path while the live one stayed hidden).

  **A plugin build is now judged by its `BuildId`, not by its folder name.** Every
  built plugin carries one in `Binaries/Win64/UnrealEditor.modules`, and Unreal
  refuses to load a plugin whose id differs from the engine's — that is exactly
  what the missing-modules dialog is. The studio reads both (for a zipped plugin,
  straight out of the archive — nothing is extracted) and marks a mismatched build
  **built for another engine build**, leaving it unchecked rather than installing
  something that cannot load.

  This catches the case a version label structurally cannot. The plugin that broke
  the run above was in a folder called `KawaiiPhysics_5_7_1_…` — a version written
  with underscores, which reads as _no version signal at all_, so it matched every
  project including a 5.8 one while its binaries were 5.7. A folder name is a
  label; the BuildId is the engine's own identity check.

  **It also decides which build you are offered.** Only one build per plugin can
  be listed — they all install to the same `Plugins/<name>` — and that choice used
  to be made on labels alone. With `KawaiiPhysics_5_7_1_…` and
  `KawaiiPhysics_5_8_…` side by side, both reading as _any engine_, the studio
  offered the alphabetically first one and hid the other; for a 5.8 project that
  meant being shown the build that cannot load while the one that can never
  appeared. The BuildId now picks: a build proven to fit outranks a version label,
  which outranks an any-engine guess, which outranks a build proven not to fit.

  It warns rather than refuses: a mismatch is left listed and unchecked, because
  you may know something the BuildId doesn't. And it never guesses — a plugin with
  no binaries, or an engine whose id cannot be read, is never called a mismatch.

- [#811](https://github.com/polynaut/dth-character-studio/pull/811) [`6c2cc20`](https://github.com/polynaut/dth-character-studio/commit/6c2cc204aded19515132d4b9262194fbdf5b3931) Thanks [@polynaut](https://github.com/polynaut)! - **Send a character to Unreal — the third leg of the round trip.**

  Daz builds the ROM, Houdini bakes it and exports for Unreal, and until now
  somebody dragged the result into the editor by hand. The **DTH Export** dialog
  hands that export over itself — one Start for the whole round trip, and with
  both **Skip Daz** and **Skip Houdini** it becomes a plain "re-import this
  character in Unreal" with nothing else running. That dialog is the ONLY way to
  send, and the leg reports where the other two do — the run's own task list and
  status line, with **one row per import job**: two export sets going into one
  Unreal project are two imports, so they are two rows, each naming the set and
  whether it is a re-import or a first import. Its outcome arrives minutes later,
  from an editor that may not have been open when the job was queued, so the run's
  display stays up until it answers.

  It is the same handoff the other two legs use: the studio writes a job file,
  the other side claims it by rename, the studio polls a result. On the Unreal
  side that "other side" is the **DTH Character Studio Runner for Unreal** —
  `Plugins/DTHCharacterStudioRunner`, content-only, pure Python, the Unreal
  counterpart of the Runner plugin that drives Daz — which watches
  `Saved/DTHStudio/job.json` and runs the import. The import itself is **mrpdean's DazToHue pipeline, unmodified**: meshes,
  textures, materials, animation curves, the post-process anim blueprint. The
  Runner decides only _when_.

  **The Runner installs like any other plugin**, from the project card's install
  dialog, where it is pre-checked next to DTH content — a plugin in your own
  Unreal project is something you tick, not something that appears because you
  sent a character. Sending to a project without it says exactly that. Unreal
  loads plugins at startup, so the editor wants one restart after installing it —
  which is where a restart is expected anyway.

  **A closed project is opened for you** — five seconds after queueing, if the job
  is still unclaimed and no editor is running at all. That is the rest of the leg:
  the Runner claims a job on startup, so opening the project is what makes a
  queued send finish rather than wait. An editor that is already up is never
  doubled (a wrong guess there costs a duplicate editor and several gigabytes),
  and "is THAT project open" is not answerable from a process list — so the studio
  only acts on the two things it can prove: the job is still there, and nothing is
  running.

  **The studio still never starts Unreal to RUN an import.** An editor takes minutes to come up and holds
  its project, so a "launch it and wait" leg would be worse than useless — and a
  headless commandlet writing into `Content/` behind a running editor is worse
  still. The job is queued instead: an open editor picks it up within about a
  second, and one opened later claims it on startup, exactly like a Daz that was
  closed when a batch was queued.

  **The DTH Export dialog carries it too.** Under the Daz scenes and the Houdini
  projects there is now an **Unreal projects** section, so one Start does the
  whole round trip: Daz builds the ROM, Houdini exports, and the result is queued
  for import when the last project finishes. It pre-selects the same way the other
  two lists do — a project that already holds this character comes ticked, one
  that doesn't waits for you, because putting a character into an Unreal project
  the first time is a decision rather than a continuation. The selection rides the
  run's sidecars, so a window reloaded mid-export still sends.

  **The Houdini Mode dropdown is down to two.** `Open only` opened a project and
  ran nothing — the project cards already do that, and a mode that ran no pipeline
  sat oddly in the dialog that runs the pipeline. `Export all` exported every
  linked scene instead of the checked ones, which is what checking every scene in
  the list directly above it means. Both are gone. In their place, and only when
  the project has a linked `.uproject`: **Skip Houdini — use last exports**, which
  runs no Houdini and hands what is already on disk to the Unreal projects. With
  Daz skipped as well, that is a one-click "re-import this character in Unreal"
  from the same dialog as everything else.

  **A send is refused rather than faked.** A run that builds the ROM and stops
  (_ROM only_) writes no export, so it does not offer to send one — its send could
  only hand Unreal the PREVIOUS export while the run read as this ROM reaching the
  editor. Ticking an Unreal project but no export set holds Start with a reason
  instead of starting a run whose Unreal leg silently does nothing. And when the
  editor imports some of the sets and fails on another, the run says both — what
  landed AND what did not — rather than reporting the whole job as a success.

  **You pick which export sets go.** A character's `export/` folder holds one set
  per HDA character name — outfit variants, experiments — and a send used to take
  all of them, so a variant nobody had asked for could land in Unreal on its own.
  Both send surfaces now list the sets with checkboxes and pre-tick the same way:
  a set the project **already holds** shows the folder it will refresh and comes
  ticked; one it doesn't is marked _not in this project_ and waits to be asked
  for. The first import of anything into an Unreal project is a decision, not a
  continuation — the same rule the project rows already used, applied one level
  down.

  **Every export set the studio finds is offered, not "the" export.** A character's `export/` folder holds
  one folder per HDA _character name_ — measured, one character here has three
  (outfit variants) — and the studio cannot predict those names. It scans for them
  now; the first version guessed `DTH_<character name>.dth` and would have found
  nothing at all on that character. One job carries every set.

  **A second send re-imports what the project already has.** Before sending, the
  studio searches the project's `Content/` for each export set's assets — they are
  all named `<PREFIX>_<set>`, so it finds them wherever they were moved — and
  names that folder in the job. The import then runs **there**, on top of the
  existing assets, instead of building a second set under
  `/Game/DazToHue/<Character>` and leaving you to reconcile them. Nothing found: a
  fresh import at the default, exactly as before. The finish toast says which
  happened and where.

  **A re-import is Unreal's own Reimport.** Where the character is already in the
  project, the Runner reimports those assets from the FBX the export just wrote —
  the same action as right-click → _Reimport_. Meshes and their morph targets come
  back fresh; materials, curves and the anim blueprint stay as the first import
  built them. A second `.dth` import cannot do this at all: the DazToHue pipeline
  duplicates its master materials into names that already exist and fails, so
  "import over the existing set" has no path through it.

  A FIRST import still imports the `.dth`, never the FBX files directly — the `.dth` is what
  triggers the DazToHue pipeline, and importing the meshes on their own would lose
  the materials, curves and anim blueprint it builds. The file list is for finding
  assets, not for importing them.

  Every Install rewrites the Runner, so a re-install refreshes it; and it lives in
  its own plugin rather than inside the DazToHue one, which is beta and iterating
  — nothing here forks or edits mrpdean's files. The studio reads the installed
  Runner's version before sending, so an out-of-date one is named up front instead
  of refusing the job from inside Unreal.

### Patch Changes

- [#811](https://github.com/polynaut/dth-character-studio/pull/811) [`6c2cc20`](https://github.com/polynaut/dth-character-studio/commit/6c2cc204aded19515132d4b9262194fbdf5b3931) Thanks [@polynaut](https://github.com/polynaut)! - Renaming a Houdini project keeps its scan. The stored verdict is keyed by path,
  so a rename orphaned it and everything that reads a scan went back to "never
  scanned" — which showed up as the DTH Export dialog no longer pre-selecting
  Unreal projects, since it no longer knew which export sets those projects write.
  The scan now follows the file, and the only cure before this — a Rescan nobody
  had a reason to suspect — is not needed.

- [#809](https://github.com/polynaut/dth-character-studio/pull/809) [`6f77111`](https://github.com/polynaut/dth-character-studio/commit/6f77111564273db4561264cacfcfddba1e935629) Thanks [@polynaut](https://github.com/polynaut)! - **Generate Houdini project prefills the character's name, not the project's.**

  The name field opened on `<Project>_<Character>` — `3d-workflow_LaraCroft_G81`.
  A generated scene already lives inside its project, under
  `<project>/…/<character>/houdini/`, so repeating the project in the filename
  only made every scene longer without telling you anything the path doesn't.
  What tells one `.hiplc` from another in the folder it sits in is the character,
  and after that whatever you type.

  Existing projects keep their names — this is the suggestion the dialog opens
  with, nothing is renamed.

- [#811](https://github.com/polynaut/dth-character-studio/pull/811) [`6c2cc20`](https://github.com/polynaut/dth-character-studio/commit/6c2cc204aded19515132d4b9262194fbdf5b3931) Thanks [@polynaut](https://github.com/polynaut)! - The export run's task list names every Houdini network, not just the finished
  ones. A project with two DazToHue networks showed the first by name and the
  second as "Network 2" — a count, where the user has a name for it. The run
  already knew both the moment it collected them, so it says so up front, and the
  row carries the title of the **network box** around each one: the nodes are all
  `DazToHueExport`, `…1`, `…2`, so the box title is the only human-meaningful name
  a multi-network project has.

- [#811](https://github.com/polynaut/dth-character-studio/pull/811) [`6c2cc20`](https://github.com/polynaut/dth-character-studio/commit/6c2cc204aded19515132d4b9262194fbdf5b3931) Thanks [@polynaut](https://github.com/polynaut)! - Changing the DTH Export dialog's **Mode** no longer throws away the scenes you
  picked. Each mode has its own "outstanding work" rule and switching re-ran it
  over the whole list, so choosing one scene and then switching to _Skip Daz_
  re-checked every scene with an export on disk — and the Houdini list, which
  follows the scenes, came with it. The pre-selection is a courtesy for a list
  nobody has touched; once you have picked, it stays picked.
- Updated dependencies [[`590a94d`](https://github.com/polynaut/dth-character-studio/commit/590a94dae97ce5b345fecc7024c4ccd17b082dbd), [`4958a3c`](https://github.com/polynaut/dth-character-studio/commit/4958a3c3de40d1e4c63f7f1be0b393e31ae43680), [`6f1cc99`](https://github.com/polynaut/dth-character-studio/commit/6f1cc99505f0cb0c2c9509c7ac6232c5a82a19da)]:
  - @dth/rom@0.77.0
  - @dth/ui@0.77.0

## 0.76.0

### Minor Changes

- [#807](https://github.com/polynaut/dth-character-studio/pull/807) [`c51481b`](https://github.com/polynaut/dth-character-studio/commit/c51481bf6d33fd1da3eb719676e03d4db39f80d3) Thanks [@polynaut](https://github.com/polynaut)! - **A Recently used source can be taken back out.**

  The Utils drawer's shortcut row remembers every source you pick — including the
  one-off "let me just look at this file" — so it needed a way out as much as a
  way in. Each chip now carries a **✕**.

  Removing a shortcut is not removing a file: the entry is a remembered path, the
  `.hip` is untouched, and picking it again puts it straight back at the top of
  the row.

- [#803](https://github.com/polynaut/dth-character-studio/pull/803) [`6f20744`](https://github.com/polynaut/dth-character-studio/commit/6f2074494531ab2571eb37adfadda867b0ee3f1e) Thanks [@polynaut](https://github.com/polynaut)! - **The Utils drawer can copy an occlusion setup now — two new tabs, one per node.**

  **Occlusion** carries the `DazToHueOcclusion` node: **Occlusion Culling** (the
  manual occlusion attributes and the Auto-Occlusion operation list) and
  **Visualise**. **Groom occlusion** carries `DazToHueGroomOcclusion` with its own
  **Options**, **Skin**, **Occlusion Mask**, **Texture Stamp** and **Visualise**.
  They are separate tabs because they are separate nodes with different setups —
  one tab whose section list changed under you would be worse than two.

  They work exactly like the Skeleton tab: pick a source node (a project of your
  own, a Houdini template, or the **Recently used** row), tick the targets, tick
  the sections, **Dry run** to see what would change, **Run** to do it. Each
  section is a folder copied **wholesale** — its settings and any lists inside it
  replace the target's — so there is no _Replace at target_ toggle, and the count
  beside a section is how much is actually set there. The same silent backup as
  every other transfer is taken before anything is saved.

  The node's own **Linking** folder is deliberately not offered: it holds
  parameter references, and DTH node names are identical in every project, so a
  copied reference would rebind to the target project's own node and read the
  wrong values without erroring — the same rule the material transfer has always
  followed for a linked parameter.

  A folder transfer that cannot find one of its folders now **says so and copies
  nothing**, instead of quietly skipping that section and reporting _Transfer
  complete_ — if a DazToHue release renames a folder, the run fails with the name
  it looked for rather than leaving you to notice the setup never arrived. This
  applies to the Skeleton tab too.

  Also fixes a stale tooltip: the **What to copy** info popup explained the
  material node's baker/UV interdependency on _every_ transfer tab, including
  Skeleton, where none of it applied.

- [#808](https://github.com/polynaut/dth-character-studio/pull/808) [`0af7dd7`](https://github.com/polynaut/dth-character-studio/commit/0af7dd741005d7857e81b8f1dea73f5804d2f5a1) Thanks [@polynaut](https://github.com/polynaut)! - **Unreal plugins that ship as a zip are found and installed.**

  Some vendors don't ship a plugin folder — they ship `<Plugin>.zip` in a
  versioned folder and nothing else. The scan only ever looked for a loose
  `.uplugin`, so such a folder came back _"No Unreal plugin found here"_ about a
  folder that plainly has one.

  The plugin-folder scan now reads inside `.zip` files too. A zipped build is
  listed like any other, with a **zip** marker beside its engine version, and the
  engine it targets is worked out exactly as before: the folder path wins
  (`…/Unreal Engine 5.7 Plugin/DazToHue.zip` → 5.7), falling back to the
  `EngineVersion` inside the archived `.uplugin`.

  Installing one **extracts** rather than copies, and lands it where Unreal
  expects: everything under the archived `.uplugin`'s own folder is written to
  `Plugins/<Plugin>/` with that wrapping folder stripped — a zip that wraps its
  plugin in `DazToHue/` and one that holds the files at its root both come out as
  `Plugins/DazToHue/DazToHue.uplugin`. Anything sitting _beside_ the plugin folder
  in the archive (a README, a `__MACOSX` sidecar) is not the plugin and is not
  installed. Same copy-over rule as every other install: nothing is deleted first.

  Reading the archive is bounded the same way the Daz asset installs are — entry
  count and inflated size — and an entry whose name would escape the plugin folder
  is refused rather than resolved.

### Patch Changes

- [#802](https://github.com/polynaut/dth-character-studio/pull/802) [`8d1f976`](https://github.com/polynaut/dth-character-studio/commit/8d1f976a04ec2729af4f9eb5a67b4baea8db4739) Thanks [@polynaut](https://github.com/polynaut)! - The DTH Export progress meters carry no caption anymore. The overall bar used to
  label itself _"Scenes 0/2"_, which the numbered task-card column beside it
  already says — and the caption indented that track, leaving the two bars starting
  at different left edges. Both are now a track and a percent: the cards say what
  is running, the log window's newest line says how it is going, and the meters say
  how far. The caption was also the only thing NAMING these meters, so it moves to
  ARIA rather than disappearing — a screen reader still gets "Overall progress" and
  the value, instead of two anonymous bars.

  Also documents this release's Houdini work in the guide, which had gone out of
  step with it: the export leg is headless now (the guide still said Houdini
  "opens visibly so you can watch it work" and quoted button labels that no longer
  exist), the header shows the run live, **Ctrl** is what gets you out of one, a
  reload no longer loses either leg, and Generate project names the Daz scene it is
  generating for.

- [#804](https://github.com/polynaut/dth-character-studio/pull/804) [`bedd716`](https://github.com/polynaut/dth-character-studio/commit/bedd71611ffec9c5f03c541f7bfeeb88142c8641) Thanks [@polynaut](https://github.com/polynaut)! - **A Houdini export that dies now says why.**

  The headless export leg streams Houdini's whole console into
  `.dth_houdini_console.log` beside the character's job files, and that file is
  deliberately kept after a run — it is the diagnosis channel. But when the run
  died, the studio reported only _"The Houdini export did not finish — Houdini is
  no longer running"_: true, useless, and contradicted by the file it had just
  written itself.

  Measured on a real failed run: hython exited immediately because it could not
  get a Houdini license (headless hython needs one of its own, and the machine
  could not reach its license server), the log said exactly that in two lines, and
  the toast said Houdini had stopped.

  The failure toast now leads with what the log says — _"…did not finish — Houdini
  could not get a license."_ — and points at the file for the full output.
  Licensing is recognised by name because it is the one failure that says nothing
  about your project, your scene or the studio. Anything else is quoted straight
  out of the log, on the grounds that a raw error line beats a confident wrong
  summary — but only the _end_ of it, and only a line that actually looks like an
  error: the file is the whole console, cook chatter included, so a run that ended
  on a progress message still reads exactly as before. Better no reason than the
  wrong one.

- [#807](https://github.com/polynaut/dth-character-studio/pull/807) [`c51481b`](https://github.com/polynaut/dth-character-studio/commit/c51481bf6d33fd1da3eb719676e03d4db39f80d3) Thanks [@polynaut](https://github.com/polynaut)! - **Fixes from the occlusion tabs' first real outing.**

  **"No DazToHue occlusion nodes in this project" about a project full of them.**
  The Utils drawer reads a cached scan, and the cache key records _what the scan
  was asked_. Teaching the scan to see the occlusion node types changed the
  question without bumping that version, so every project scanned before the
  feature shipped kept serving its old answer — a node list with the material and
  skeleton nodes and no occlusion ones — and looked perfectly fresh doing it. The
  version is bumped, so the next look re-earns the answer. (Nothing to do by
  hand: the entries invalidate themselves.)

  **"3 target nodes selected" under one ticked box.** The drawer preselects every
  node of the card it was opened from — all kinds at once — and the run counted
  them all, so an occlusion transfer was pointed at the project's material and
  skeleton nodes too. The Python refuses a wrong-typed node per target, so nothing
  was ever written to one; the count and the report were the lie. Targets are now
  filtered to the tab's own kind, matching the list you can actually see and tick.

  **Each transfer tab explains itself.** The material node's texture-baker
  paragraph was printed at the top of every tab, including both occlusion ones —
  a note about bakers and UV names above a list of occlusion settings. And _"A
  occlusion section is copied wholesale"_ now reads _"An occlusion section"_.

  **No material knobs on a folder-kind run.** The confirm dialog offered
  **Replace UV channels and bakers** on both occlusion tabs — a material control
  the occlusion transfer never reads (a folder section is always copied
  wholesale), above a line about material slots merging by surface. And the
  success toast reported a folder run's outcome in material terms, which came out
  as _"Copied 0 slots, 0 channels, 0 bakers"_ after a transfer that worked. Both
  now say what the run actually did.

  **The drawer's outcome toasts stay until you dismiss them.** Every one of these
  reports a run that took hython tens of seconds and wrote to your projects —
  exactly the stretch during which nobody is watching this window. A toast that
  timed out while you were in Houdini took the only summary of what a
  transfer/repair/repath did with it. Errors too: a failure that scrolls past
  unseen is worse than a success that does.

- [#805](https://github.com/polynaut/dth-character-studio/pull/805) [`e2ac529`](https://github.com/polynaut/dth-character-studio/commit/e2ac52961353492b2e85ce5d80b631d4eead25ef) Thanks [@polynaut](https://github.com/polynaut)! - **Generate Unreal project opens prefilled.**

  **Create in** now defaults to an **`unreal` subfolder of the project folder** —
  beside `daz3d/` and the characters — instead of wherever the first already-linked
  Unreal project happened to sit. A generated project belongs to the DTH project
  that generated it, so that is where it lands unless you say otherwise: the path
  is an ordinary editable field, and **Browse** still puts it anywhere (an existing
  `D:\Unreal Projects`, another drive).

  **Project name** is prefilled with the DTH project's own name. The two
  namespaces don't agree — a `.dcsp` may be called anything, while Unreal accepts
  letters, digits and `_` and won't start with a digit — so the suggestion is
  made legal first: illegal characters become `_`, runs collapse, and a leading
  digit gets one `_` in front (`3d-workflow` → `_3d_workflow`). A name with
  nothing usable left prefills empty rather than suggesting something meaningless.

  With both filled, the common case — one DTH project, one Unreal project — is now
  open-dialog-and-press-Create.

- Updated dependencies []:
  - @dth/rom@0.76.0
  - @dth/ui@0.76.0

## 0.75.0

### Minor Changes

- [#798](https://github.com/polynaut/dth-character-studio/pull/798) [`cbbe84a`](https://github.com/polynaut/dth-character-studio/commit/cbbe84a33130d7853d5c93252617984452ecae45) Thanks [@polynaut](https://github.com/polynaut)! - Auto base is on by default for morphs.

  A ROM morph is keyed to its value on its own frame and pulled back down on the
  frames around it. Until now it was pulled back to zero unless you said
  otherwise — which is right for a morph the character doesn't otherwise use, and
  wrong for one it does. Reusing a few of the ROM's FBM morphs to build a "shaped"
  variant of a character is a perfectly ordinary thing to do, and it left the ROM
  flattening part of the base shape on every frame next to those poses.

  **Auto** on a morph row fixes exactly that: instead of a fixed **Base**, the
  script reads the morph's own value out of the open scene and returns it there.
  It is now on for every new morph, however the morph is added — typed in, picked
  from the autocomplete, added to a multi-morph row, or imported from a DAZ morph
  CSV — and it is turned on for the morphs of every character you already have.

  For the morphs a scene doesn't dial, this changes nothing: they read zero at
  frame 0 and behave exactly as before. Turn **Auto** off on a row to go back to a
  fixed **Base** (or a hard reset to zero) whatever the scene is doing; the
  **Base** field is only read when Auto is off.

  Existing characters pick the new default up when they are read, and **Tools →
  Refresh assets** writes it into their definitions and regenerates their Daz
  scripts and PoseAsset CSVs. Run it once after updating; Refresh from the Home
  window covers every project in the recents list, and a project window covers the
  project it is open on.

- [#800](https://github.com/polynaut/dth-character-studio/pull/800) [`30ee108`](https://github.com/polynaut/dth-character-studio/commit/30ee108ed9728dcc041d6b5ba7f8aab629483608) Thanks [@polynaut](https://github.com/polynaut)! - Reloading the app while Houdini is exporting no longer loses the run. The Daz half already survived a reload; the Houdini half didn't — and because that leg runs headless there was no window to notice: hython finished the export, the studio never reported it, and any project queued behind it silently never started at all. Each Houdini run now records its plan beside its own job file — the project being exported, the ones still waiting, the scene scope and the report so far — and the character's editor picks the run back up when it opens. You get the live log and progress back, the remaining projects still run, and the one end-of-everything report still names the legs that finished while the window was away.

### Patch Changes

- [#801](https://github.com/polynaut/dth-character-studio/pull/801) [`253d89f`](https://github.com/polynaut/dth-character-studio/commit/253d89fb081b6b78a6d1ede2b160ea90acdc2e5e) Thanks [@polynaut](https://github.com/polynaut)! - Generate project now says which Daz scene it is generating for. A generated Houdini project is defined by the scene whose export set it imports, but the dialog only ever named it when it asked — and it deliberately doesn't ask for a single-scene character, or for a character's first project. Both cases now state the scene (and mark the primary), the line updates as you pick on the ones that do ask, and the confirmation names it too, so the answer survives the dialog closing.

- [#797](https://github.com/polynaut/dth-character-studio/pull/797) [`56c2f8e`](https://github.com/polynaut/dth-character-studio/commit/56c2f8ec80fbc4a9d26b57bbd55bde32926952f8) Thanks [@polynaut](https://github.com/polynaut)! - A project window opens on its project, instead of flashing the Home screen first.

  Opening a project window painted the Home "recent projects" list for a moment
  and then jumped to the project's character overview. That was the boot order,
  not a hiccup: every window loads the same document, so the URL it starts on says
  nothing about which project it is for — the studio had to ask the desktop side,
  and it mounted the UI before the answer came back. Home's screen needs one small
  read while a project's needs a manifest read plus a character scan, so Home
  always drew first, and the correction landed later the more characters the
  project had.

  The window now works out where it belongs — and loads it — before anything is
  drawn, so it goes from its own dark background straight to the character
  overview. The lookups it needs run together rather than one after the other, so
  the window is ready sooner as well. A project window also no longer leaves a
  Home entry behind it in history.

- Updated dependencies [[`cbbe84a`](https://github.com/polynaut/dth-character-studio/commit/cbbe84a33130d7853d5c93252617984452ecae45), [`3a2fdc2`](https://github.com/polynaut/dth-character-studio/commit/3a2fdc2d49b9f26ee512d76f31132d532ea2d0e0)]:
  - @dth/rom@0.75.0
  - @dth/ui@0.75.0

## 0.74.0

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.74.0
  - @dth/ui@0.74.0

## 0.73.1

### Patch Changes

- [#782](https://github.com/polynaut/dth-character-studio/pull/782) [`c151d6f`](https://github.com/polynaut/dth-character-studio/commit/c151d6fd1bc3604d3b74e1d98df2c1619783b3f1) Thanks [@polynaut](https://github.com/polynaut)! - **The first Generate project no longer asks which Daz scene to import.**

  A character's first Houdini project is its main one — wired to the primary scene, which is what everyone answered anyway. The **Daz scene to import** picker now appears from the **second** project on, where "which scene's export set?" genuinely differs (one project per outfit scene). A single-scene character stays unasked, as before; unlink every project and the next generate counts as the first again.

- [#786](https://github.com/polynaut/dth-character-studio/pull/786) [`e92357a`](https://github.com/polynaut/dth-character-studio/commit/e92357aa2c3531acac4469107c8d577bc2470f5f) Thanks [@polynaut](https://github.com/polynaut)! - **Settings hides the "Generate Houdini Projects" panel while a Houdini installation is activated.**

  With a card activated there is nothing left in it: the install folder is the card's own (already listed on it), the docs pairing is the card's whole point, and the panel had no field and no choice — it could only restate a path shown two sections above. It now appears only while the Houdini paths are yours to type (no card activated), where its manual install-folder field and the live pairing warning actually earn their place. Same rule as the derived Daz/Houdini destinations: show only the paths the studio uses, and only the choices that exist.

- [#785](https://github.com/polynaut/dth-character-studio/pull/785) [`bc29ccb`](https://github.com/polynaut/dth-character-studio/commit/bc29ccbf0eae6fa9cf1e0711184c54db0f7e9871) Thanks [@polynaut](https://github.com/polynaut)! - **The Houdini export leg opens visibly again, and a finished run's tooltip lets go of the screen.**

  - **Houdini ran the whole export invisibly** — window never painted, exports delivered, session closed itself (measured 2026-08-11: a four-minute run with nothing on screen). The deferral that was supposed to wait for the window (`hdefereval.executeDeferred` + a 10 s timer) is not a paint guarantee: Houdini pumps the event loop during startup, so on a slow first scene load the timer fired **before the main window painted**, the batch seized the UI thread for the whole run, and `closeWhenDone` closed the never-shown window. 456.py now polls `hou.qt.mainWindow().isVisible()` and only starts the breather once the window is actually up (bounded at 2 minutes, so an odd session still exports).
  - **The DTH Export button's tooltip stayed on screen after a run finished.** The tooltip hides on mouse-leave — but a button that **unmounts under a stationary cursor** (exactly what a finishing progress state does) never emits one, leaving the tooltip pinned to a detached element forever. The tooltip host now watches for its anchor leaving the DOM and hides with it. App-wide fix: every state-swapped control gets it, not just this button.

- [#788](https://github.com/polynaut/dth-character-studio/pull/788) [`c765f71`](https://github.com/polynaut/dth-character-studio/commit/c765f71c70dc83cab63d261ce763eb1e4a67a140) Thanks [@polynaut](https://github.com/polynaut)! - **The Daz Studio plugins panel anchors each detection under its folder — and two standing hint lines retire.**

  Each found Exporter DLL is now listed directly **under the release-folder field it came from**, instead of in one block below the whole list — and the hint drops the folder path, which only echoed the field above it. When one folder holds a subfolder per generation, the subfolder still shows (`· Daz Studio 4`), since that's what tells the two builds apart. The standing _"Runner plugin — ships with this app (…)"_ line is gone too: the **Runner plugin** table header says it on hover instead.

  Two hint lines that only explained the obvious are removed outright: _"Everything up to date — Reinstall copies it all again."_ beside the plugin install buttons (the button already reads **Reinstall all** and the table above is green — the pending counter stays, it's the actionable state), and the _"New folders can't be added while a Houdini installation is activated…"_ paragraph at the bottom of Setup DTH Release (the button simply disappears; the guide documents the rule).

- [#784](https://github.com/polynaut/dth-character-studio/pull/784) [`37f6e70`](https://github.com/polynaut/dth-character-studio/commit/37f6e70a724582a626a92a339123a8aaf17a917c) Thanks [@polynaut](https://github.com/polynaut)! - **The Setup DTH Release panel reads as install targets now.** The two halves of a release install — Daz content into the library, Houdini assets into a documents folder — each get an icon-tile row under one "Ready to install DTH x.y" lead-in, so the panel reads as "one release, these destinations" instead of a run of look-alike fields and buttons. "Add another Houdini folder" became the dashed add-row it acts like, and extra folders join as further target rows.

  **Derived destinations name their true source.** The "Installs into … from the Daz installation above" sentence was hardcoded — even under the Houdini documents folder (derived from the _Houdini_ installation) and under Generate Houdini Projects' hython path, which is a tool source, not an install destination. Each now names the section it actually derives from, an empty Houdini documents folder gets the real fix ("start this Houdini once"), and the hython line says "Uses" instead of "Installs into" — including when its path is empty, where "start this Houdini once" would have been the wrong advice (a launch creates the documents folder, never the installation folder).

- Updated dependencies [[`2e061a2`](https://github.com/polynaut/dth-character-studio/commit/2e061a2fd405d060a8c3587e53113cb2796cabff), [`bc29ccb`](https://github.com/polynaut/dth-character-studio/commit/bc29ccbf0eae6fa9cf1e0711184c54db0f7e9871)]:
  - @dth/rom@0.73.1
  - @dth/ui@0.73.1

## 0.73.0

### Minor Changes

- [#779](https://github.com/polynaut/dth-character-studio/pull/779) [`68d861b`](https://github.com/polynaut/dth-character-studio/commit/68d861b726a20371bd319e57fa0aa6aeac2f02a4) Thanks [@polynaut](https://github.com/polynaut)! - **Hold Ctrl on a running DTH Export to abort it.**

  While a batch is waiting for Daz Studio the header button reads **Abort**, and clicking it takes the handoff back. The moment the Runner claims the file, that was over: the button became a live **Exporting n/m** counter whose only action was "stop watching", and the claimed job file stayed on disk.

  Which is fine when Daz is working — and a dead end when it isn't. A Runner that stalls (a modal in the way, a plugin that died mid-batch) leaves the button spinning forever, and the file it left behind makes every later export _and_ scan refuse with _"a batch is waiting for Daz Studio"_.

  Now holding **Ctrl** turns the progress button into **Abort**, the same way it turns Save into Re-save: clicking deletes the job file and resets the button. Release Ctrl and the progress counter is back, untouched. A plain click still only stops watching, and still deletes nothing.

  The toast says what actually happened, because this is the honest limit of it: the studio can delete its handoff file, it cannot stop Daz. A run Daz has genuinely started keeps going there (and a working Runner may even write the file again on its next scene). What you reliably get back is the studio — the watch, and the next export.

  Deleting a claimed batch rolls no handoff stamps back, deliberately: unlike the pending Abort, this batch may already have exported scenes, and marking those as never handed off would report work that happened as work that didn't.

- [#768](https://github.com/polynaut/dth-character-studio/pull/768) [`8a24f72`](https://github.com/polynaut/dth-character-studio/commit/8a24f72116e1b27b860110e7e93a612297963477) Thanks [@polynaut](https://github.com/polynaut)! - **"Export only": run the export batch in an older Daz Studio while everything else uses the new one.**

  The batch handoff is the one thing that needs a _plugin_ — the DTH Runner claims the job file when Daz starts — and a plugin binary is built against a single Studio major version. So moving to the newest Studio for authoring used to mean waiting for a Runner build before you could export at all, or putting the whole app back a version.

  With the newest installation active, each **older** Daz card in Settings that can still run a batch now offers an **Export only** switch. Turn it on and DTH Export starts its batch in that installation; opening scenes, running scripts and installing content stay on the active one. Only one installation can carry it — turning it on for one card turns it off everywhere else.

  Two things follow the switch, and have to: the Runner plugin's **install target** and its **gate**. A Runner sitting in the installation that does _not_ run the batch would let the export dialog report "ready", then start the other Daz, find nothing to claim the job file, and wait for a batch that never begins. The install also picks the DS4/DS6 build to match wherever it is going.

  The switch is offered only on installations older than the active one, only while the active one is the newest detected, and never on one whose folder is missing. It is also **never offered on Daz Studio 4**, which takes the Runner plugin but has no scripted export at all — a batch sent there would open Daz, run every scene and export nothing. On a DS4 + DS6 machine that means the switch appears nowhere: it becomes available once a Studio newer than 6 is installed and active, which is the situation it is for.

  If the flagged installation later disappears from the machine, Settings says so and offers to send exports back to the active one, rather than leaving them pointed at a folder that is not there.

- [#776](https://github.com/polynaut/dth-character-studio/pull/776) [`599364d`](https://github.com/polynaut/dth-character-studio/commit/599364d11ecb55e05b01ca2038f237b99e4da4b6) Thanks [@polynaut](https://github.com/polynaut)! - **Daz plugins now install into every Daz Studio on the machine.**

  Both plugins the studio puts inside Daz — the **DTH Exporter** (mrpdean's) and the **DTH Character Studio Runner** (bundled) — ship one binary per Studio generation. The old panels asked for one Exporter release folder and installed into one Daz, which on a machine with Daz Studio 4 _and_ 6 could only ever describe half the setup: it would happily offer to copy a Daz Studio 4 build into a Daz Studio 6 install, which cannot even load it.

  Settings → General now has one **Daz Studio plugins** section instead of two. Add as many Exporter release folders as you like — or just the folder holding `Daz Studio 4` and `Daz Studio 6` subfolders, which is how the plugin is published; both are scanned, one level deep. Which Studio a build is for is read from the DLL's own name (Daz Studio 6 only loads `dsp_*.dll`, so the name is the contract, not a guess), with the folder name kept as a cross-check the panel flags when the two disagree. Underneath, every Daz Studio detected on the machine is listed with what it has now and what it would get, and **Install / update all** copies each build into the installations it was built for — one labelled line per copy in the report, so one Daz needing admin rights while another doesn't reads as exactly that. An installation with no matching build is named, never served the wrong binary.

  **"Export only" can point at Daz Studio 4 again.** It was blocked there because the Studio 4 exporter had no scripted export — a batch would run every scene and export nothing. mrpdean shipped scripted export in the Daz Studio 4 plugin with **Exporter 2.0.2.0**, and a DS4 batch was measured writing its files, so the restriction is gone.

  The single `dthExporterFolder` setting is superseded by a list and carried over automatically; the Exporter version picker is gone with it — each generation simply installs the newest build found across your folders.

- [#765](https://github.com/polynaut/dth-character-studio/pull/765) [`7c762ad`](https://github.com/polynaut/dth-character-studio/commit/7c762ad9ed7f112db6f7f5234ce63ddd106f3d13) Thanks [@polynaut](https://github.com/polynaut)! - **Generated Houdini paths are shorter again: `$HIP/daz-export/…` instead of `$JOB/houdini/daz-export/…`.**

  Since the export folder moved inside the character's `houdini/` folder (v0.68), every import, PoseAsset CSV and reference-skeleton path sits directly below the `.hip` that reads it — so `$HIP`, the project's own folder, reaches all of them without climbing out. That is also what Houdini itself writes: its file picker collapses a chosen export to `$HIP/…` (measured with `hou.text.collapseCommonVars`), so a path you pick by hand and one the studio generates now read identically inside the same node.

  `$HIP` has a second advantage over `$JOB`: it is derived from where the file sits, so it cannot be wrong. A project whose `$JOB` still points at another character keeps resolving its own imports.

  `$JOB` is still used where `$HIP` cannot reach — Houdini's own output folder (`<character>/export/`, which sits beside the houdini folder, not under it), layouts from before the export move, and characters whose projects are spread across several folders, where there is no single `$HIP`. Houdini's picker falls back the same way.

  **Existing projects keep working and are not nagged about.** Projects generated under v63–v65 hold the `$JOB` form; it resolves, so no card flags it — **Utils → Make paths portable** shortens it when you ask, and only on DazToHue nodes (a `$JOB` path on your own cache or render nodes is your choice of anchor and is left alone). The older `$HIP/../…` form is still flagged, because its `..` breaks if the project ever moves a folder deeper. Characters regenerate into the new form on the next save or via Tools → Refresh assets.

- [#768](https://github.com/polynaut/dth-character-studio/pull/768) [`8a24f72`](https://github.com/polynaut/dth-character-studio/commit/8a24f72116e1b27b860110e7e93a612297963477) Thanks [@polynaut](https://github.com/polynaut)! - **Utils drawer: a "Recently used" row for transfer sources.** The source of a material or skeleton transfer is nearly always the same personal template, re-browsed from scratch every time. The last five are now offered as chips under the picker, in both the Material and Skeleton tabs, so the second use is one click. They are remembered per machine (a template usually lives outside any project), files that have since disappeared are filtered out, and re-picking one moves it back to the top.

  **An empty target node no longer reads as a figure mismatch.** Copying materials into a freshly generated project — a DTH network with no material slots yet — put an amber warning in the confirm dialog listing every incoming surface as "exist on no slot here" and telling you to check both nodes are the same figure. They were: with no slots there, every surface is unclaimed by arithmetic, and setting an empty node up from a template is the normal reason to run a transfer. The preview now stays silent, and the post-run report no longer says it about surfaces the run had just created.

  **Clearer explanations.** The Generate-project popup says what it creates in four short lines (network wired, `$JOB` on the character folder, `$HIP` on the project's own folder where `daz-export` lives) and names your project's actual Houdini subfolder instead of assuming "houdini". The Project-checks popup drops the version history for what its two repairs do. A Houdini `.hip` is called a _project_ throughout, never a "scene". And Rescan sits next to the section title rather than after the count.

- [#772](https://github.com/polynaut/dth-character-studio/pull/772) [`ad5fe72`](https://github.com/polynaut/dth-character-studio/commit/ad5fe72b3a2a43f4cc859d59f7b05e67bbd0a872) Thanks [@polynaut](https://github.com/polynaut)! - **"Import from CSV" is now "Import from Daz scene" — the studio makes the scan for you.**

  Producing a ROM import used to be a trip through Daz: select the figure's root node, find `Scan_Frames` in the content library, run it, read the dialog, come back. Now you pick the scene and the studio does that: it opens the `.duf` in Daz Studio through the job runner, runs `Scan_Frames` there with no dialogs, waits for the CSV and takes you straight to the frame-range picker.

  Before it offers to scan, it checks the scene: **exactly one figure**, **the character's own Genesis generation**, and **animation on the timeline** — the inverse of the add-scene check, since a scan with nothing keyed has nothing to read. A failed check blocks the scan and says why, with the usual "anyway" escape.

  **Scans you already made are still listed**, and that is deliberate: one scan of a scene feeds several ROM sections, so importing FBM after RET should not re-run Daz. Browsing to a hand-curated CSV still works too.

  The wait has a way out. A Daz Studio that is already open but has no **Runner plugin** never picks the scan up, so the studio takes the job back after a few seconds and says so instead of waiting on it; a scan it started itself can be dropped with **Cancel scan**, or by closing the dialog. Either way the handoff is released — a job left waiting would block your next export batch.

  Needs the Runner plugin installed (the same one DTH Export uses) and the DTH runtime in your Daz library.

### Patch Changes

- [#774](https://github.com/polynaut/dth-character-studio/pull/774) [`5cf6dcb`](https://github.com/polynaut/dth-character-studio/commit/5cf6dcb7267867a99a8601c8d7c44de886669f16) Thanks [@polynaut](https://github.com/polynaut)! - Dependency refresh: TanStack Router 1.170.22 and Lucide icons 1.30 in the app.

- [#780](https://github.com/polynaut/dth-character-studio/pull/780) [`feebdb2`](https://github.com/polynaut/dth-character-studio/commit/feebdb238aee0be9bd66c91f716dc234d4c45124) Thanks [@polynaut](https://github.com/polynaut)! - **Settings shows only the paths it actually uses, and only the choices that still exist.**

  Three small corrections in the same place — the installation cards and the destinations they drive:

  - **The DIM downloads folder is no longer listed** under "Paths from this installation". The studio never applies it (your asset sources are your own curation, in Tools → Daz assets), and the "· not used automatically" note beside it did not make that any less confusing: a path shown on a card called _paths from this installation_ reads as a path the studio takes from it.
  - **"Add another Houdini folder" is hidden while a Houdini installation is activated.** The destination follows that card then — one active installation, one target — so an extra hand-typed folder was an invitation to a second target the card could not account for. A line in its place says where the option went (**Set the paths manually**, in the Houdini installation section). Folders added before the card was activated stay visible and removable.
  - **The Houdini destination no longer claims to come from the Daz installation.** It reads "from the Houdini installation above", and a missing one now sends you to the Houdini section — the one that can actually fix it — instead of to the DAZ Install Manager, which never had that path in the first place.

- [#777](https://github.com/polynaut/dth-character-studio/pull/777) [`44a814a`](https://github.com/polynaut/dth-character-studio/commit/44a814ad376f3836e297c1a770d7833b27b0e04b) Thanks [@polynaut](https://github.com/polynaut)! - **Fixed: the scene morph scan did nothing at all in Daz Studio 4.**

  Every ROM and export run also scans its scene, so the Morph-name autocomplete keeps up with what your outfits and hair add. In Daz Studio 4 that scan was skipped every single time, with _"No Genesis 3, 8, 8.1 or 9 figure could be found in this scene"_ — logged seconds before the same run dialled morphs onto the figure it claimed not to find. The ROM and the product scan were unaffected, which is why it stayed quiet: only the morph index missed out.

  The generation is identified from a figure's source asset, and that asset lives on the figure's _object_ — asking the node alone works in Daz Studio 6 and returns nothing in Daz Studio 4. It now walks the whole chain (object → shape → geometry, the same one the product scan has always used), and a run started by the studio also carries the character's own generation as a fallback, so a scene whose figures cannot be identified is still filed correctly instead of being dropped. When neither can answer, the message finally says what actually happened.

  Runtime v68 — **Tools → Refresh assets** installs it and regenerates the character scripts.

- [#764](https://github.com/polynaut/dth-character-studio/pull/764) [`8212b1d`](https://github.com/polynaut/dth-character-studio/commit/8212b1d142af173cbebc804177e62bc3bbf17547) Thanks [@polynaut](https://github.com/polynaut)! - **A newly installed DazToHue no longer reads as the old one.** The Houdini project scan is cached per `.hip` so reopening the Utils drawer costs nothing, but its key was the project path, its modification time and the export root — not the DazToHue libraries the scan was speaking. So a verdict phrased in the installed version's vocabulary outlived the install that replaced it: with `DazToHuePoseAsset.hda` 2.5.1 sitting in `otls/`, the General tab kept reporting _"Your DazToHue version has no `pose_asset_csv_file_path`"_ — and Rescan could not clear it, because Rescan is served by the same cache. Only re-saving the `.hip` in Houdini would have.

  The key now includes a fingerprint of the operator libraries hython will load (name, size and modification time of each `.hda`/`.otl` in the paired prefs folder), so installing, updating or removing one invalidates every affected entry. Existing entries are re-scanned once, in the background, the first time each project is looked at.

  **And Rescan now actually rescans.** It went through the same cache, so on a project whose entry looked fresh it returned the stored answer in a few milliseconds — no hython, no change on screen, indistinguishable from a dead button, and no way out of a wrong verdict. It now bypasses both cache layers and re-reads every project with hython, and says how many it read when it is done.

  Consequence on 2.5.1 and newer: the PoseAsset CSV path stops being reported as missing and starts being offered — _Fill network_ writes it like every other blank parameter, with no further change needed.

- [#781](https://github.com/polynaut/dth-character-studio/pull/781) [`87e14f2`](https://github.com/polynaut/dth-character-studio/commit/87e14f2635ec649b3932aa0786bb7e9494d6496d) Thanks [@polynaut](https://github.com/polynaut)! - **The Setup DTH Release panel reads as install targets now.** The two halves of a release install — Daz content into the library, Houdini assets into a documents folder — each get an icon-tile row under one "Ready to install DTH x.y" lead-in, so the panel reads as "one release, these destinations" instead of a run of look-alike fields and buttons. "Add another Houdini folder" became the dashed add-row it acts like, and extra folders join as further target rows.

  **Derived destinations name their true source.** The "Installs into … from the Daz installation above" sentence was hardcoded — even under the Houdini documents folder (derived from the _Houdini_ installation) and under Generate Houdini Projects' hython path, which is a tool source, not an install destination. Each now names the section it actually derives from, an empty Houdini documents folder gets the real fix ("start this Houdini once"), and the hython line says "Uses" instead of "Installs into" — including when its path is empty, where "start this Houdini once" would have been the wrong advice (a launch creates the documents folder, never the installation folder).

- Updated dependencies [[`44a814a`](https://github.com/polynaut/dth-character-studio/commit/44a814ad376f3836e297c1a770d7833b27b0e04b), [`8a24f72`](https://github.com/polynaut/dth-character-studio/commit/8a24f72116e1b27b860110e7e93a612297963477)]:
  - @dth/rom@0.73.0
  - @dth/ui@0.73.0

## 0.72.0

### Minor Changes

- [#761](https://github.com/polynaut/dth-character-studio/pull/761) [`5eae024`](https://github.com/polynaut/dth-character-studio/commit/5eae0249b3012386d6d50a66f85c4b462cb2696e) Thanks [@polynaut](https://github.com/polynaut)! - The audit's deferred findings ([#755](https://github.com/polynaut/dth-character-studio/issues/755)), fixed:

  - **Orphaned Daz-library script folders are swept.** A character deleted or renamed outside the app stranded `Scripts/DTH-Character-Studio/<project>/<character>/` forever (a mid-rename generation failure leaked the old-name folder the same way). Housekeeping now removes them — under strict gates: only folders of characters provably gone from a fully readable library, only inside projects the app knows, never the shared runtime, never unknown project folders.
  - **A byte-copied project no longer shares its product-scan store with the original.** First open of the copy's new path mints it a fresh project id, so the two stores separate; the original keeps its data, and a _moved_ project keeps its id.
  - **Two windows can no longer drop each other's recents entries.** The registry write goes through a native compare-and-swap under one process-wide lock — a conflicting write retries instead of clobbering.
  - **Two spellings of a missing `.dcsp` path** (`\` vs `/`, trailing separator) now open ONE window instead of two.

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.72.0
  - @dth/ui@0.72.0

## 0.71.0

### Minor Changes

- [#754](https://github.com/polynaut/dth-character-studio/pull/754) [`66dc836`](https://github.com/polynaut/dth-character-studio/commit/66dc836ee378bd3ac8076fc578dcb8a7671e6afd) Thanks [@polynaut](https://github.com/polynaut)! - Full-app audit fix-pass: ~45 findings across the generation core, the native boundary, the UI, the Rust crate and the app's lifecycle.

  Highlights (runtime v65 — Refresh regenerates the installed scripts):

  - **The per-scene config lookup reads the open-scene capture.** A run from a saved ROM animation used to miss its scene's frame-layout override while delivering that scene's CSV — timeline and CSV disagreed on frames.
  - **Reference-skeleton frames follow the open scene**, matching the per-scene CSV's bone-scale FBX paths.
  - **Export failures reach the studio again**: they're filed into the v2 run log's per-scene runs (top-level pushes were invisible to the reader), CSV delivery failures are logged too, and the catastrophic-failure log merges per scene instead of truncating earlier scenes' failures.
  - **Relocating the export root regenerates the scripts that bake it** — after a Houdini-subfolder change, exports no longer land silently in the vacated old root; changing the subfolder in Settings relocates and regenerates at save time.
  - **A partial export-folder move keeps the failed folders in the record** and retries on the next save/Refresh instead of orphaning them silently; `move_exports` runs off the main thread (no more full-app freeze on multi-GB NAS moves) and never merges into a racing destination.
  - **Project-tab Save no longer resets the Houdini path style to `$HIP`** (the field was missing from the save payload).
  - **Project rename moves the generated Daz-script tree along**, so DTH Export keeps working without re-saving every character.
  - Plus: a styled not-found page for moved/deleted projects, unlink dialogs default to keeping files on disk, the Houdini repair is reachable from its warning badge, orphaned per-character app data is swept, the recents list no longer silently drops projects from maintenance sweeps, the runtime install self-repairs deleted files, corrupt character definitions can be deleted in-app, the update dialog can be hidden while downloading, and many smaller hardening fixes (path-traversal guards, hex validation, zod-parsed IPC returns, fail-loud CSV import).

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.71.0
  - @dth/ui@0.71.0

## 0.70.0

### Minor Changes

- [#752](https://github.com/polynaut/dth-character-studio/pull/752) [`5edc086`](https://github.com/polynaut/dth-character-studio/commit/5edc086868fae4b0f7e213432c60922a4ba0dc0d) Thanks [@polynaut](https://github.com/polynaut)! - The export folder moved into the Houdini folder, as `daz-export`

  A character's Daz→Houdini exports now land in
  `<character>/houdini/daz-export/` instead of `<character>/daz3d/dth-exports/`.

  Nothing in Daz ever opens these files again — the `.dth`, `.fbx` and `.abc` exist
  to be imported by Houdini — so they belong beside the `.hip` that reads them, not
  beside the scenes that produced them. Hence the name too: `daz-export` is _the
  Daz export_, read from the Houdini folder it now sits in. A generated project
  reaches it as `$JOB/houdini/daz-export/…`, one folder down instead of one up.

  **Your existing exports come with it.** Each character carries its files across
  the next time it is saved, and the emptied old folder is removed — **Tools →
  Refresh assets** does the whole project in one go. Only the folders the studio
  wrote are moved; anything else you kept in there stays put.

  **A Houdini project generated before this still names the old folder**, so its
  imports report as broken on the character page. **Utils → Make paths portable**
  now repairs that case: where every import broke at once — which is what a folder
  move does — there is no surviving sibling path to follow, so it rebuilds them
  from the character's current export directory instead. As before, a path is only
  written when the file it points at actually exists.

  Two smaller consequences: **Settings → Project → Houdini projects subfolder** is
  no longer greyed out when _Create the Houdini subfolder in new characters_ is
  off, because the export root lives in that folder whatever the toggle says; and
  deleting a character with **keep the Houdini files folder** still removes
  `daz-export`, since keeping your `.hip` files should not quietly keep gigabytes
  of regenerable output with them.

### Patch Changes

- [#752](https://github.com/polynaut/dth-character-studio/pull/752) [`5edc086`](https://github.com/polynaut/dth-character-studio/commit/5edc086868fae4b0f7e213432c60922a4ba0dc0d) Thanks [@polynaut](https://github.com/polynaut)! - Toasts are wider

  Notifications were 356px, which is fine for "Saved" and wrong for what this app
  mostly has to say — a Windows error with the locking process named, a path that
  could not be written, a line of hython's stderr. Those arrived as a seven-line
  paragraph you had to read rather than glance at. They now get 544px, and still
  shrink to fit a narrow window.

- Updated dependencies [[`5edc086`](https://github.com/polynaut/dth-character-studio/commit/5edc086868fae4b0f7e213432c60922a4ba0dc0d)]:
  - @dth/rom@0.70.0
  - @dth/ui@0.70.0

## 0.69.0

### Minor Changes

- [#748](https://github.com/polynaut/dth-character-studio/pull/748) [`943ecf3`](https://github.com/polynaut/dth-character-studio/commit/943ecf387adcfb4057ca679dac9acfaf20bf9417) Thanks [@polynaut](https://github.com/polynaut)! - Houdini paths are anchored on `$JOB` instead of `$HIP`

  A generated project wrote its import, CSV and export paths as
  `$HIP/../daz3d/dth-exports/…`. They now read `$JOB/daz3d/dth-exports/…`.

  `$JOB` **is** the character folder — Generate project bakes it in — so the whole
  Daz side is one hop away, and it is what Houdini itself writes: pick an export by
  hand and its file picker collapses the path to `$JOB/…`, so a hand-picked path
  and a generated one finally match inside the same node. The old form was never a
  preference; before v0.64 `$JOB` pointed _below_ the exports and could not
  express them at all.

  It is also sturdier. `$HIP/../` encodes how deep the `.hip` sits, so a project
  moved one folder down silently broke every path, and every project of a
  character had to live in the same folder for one prefix to be right. Neither
  limit remains — projects at different depths, or in different folders, now share
  one prefix.

  **Projects made before this keep their old paths and still work.** Their card
  flags them (_“…still anchored on $HIP instead of $JOB”_) and **Utils → Make
  paths portable** rewrites them. Only paths that _leave_ the houdini folder
  (`$HIP/../…`) count: a `$HIP` path that stays inside it is where Houdini itself
  writes — render output, caches — and is meant to follow the scene file, so it is
  neither flagged nor rewritten. **Fill network** now waits for a correct `$JOB`
  the way the repath already did: the values it writes are `$JOB`-relative, so
  filling a project whose `$JOB` still points elsewhere would store paths aimed at
  the wrong folder. Repair `$JOB` first — the tab says so.

- [#751](https://github.com/polynaut/dth-character-studio/pull/751) [`71ad73c`](https://github.com/polynaut/dth-character-studio/commit/71ad73c0059802a9ca75e8116acfdf4909b29efe) Thanks [@polynaut](https://github.com/polynaut)! - Unlinking a scene and unlinking a Houdini project now work the same way

  The two remove dialogs asked the same question in opposite directions. A Daz
  scene offered **“Delete file on disk”**, off by default; a Houdini project
  offered **“Keep houdini files”**, on by default — the same choice, inverted, in
  different words, next to a button that said _Unlink_ either way. They read as
  two unrelated features.

  They are one dialog now, with one toggle in one direction, and the confirm
  button says what will actually happen:

  - **A file inside the character folder** — the studio's own copy, put there when
    you created, copied or generated it — defaults to **Remove**: the card goes
    and the file goes with it. Turn the toggle off and it becomes an _Unlink_.
  - **A file linked in place**, in your own tree, can only ever be **Unlink**. The
    toggle is shown but locked off, so “this one can't be deleted” is visible
    rather than a silently missing option.

### Patch Changes

- [#749](https://github.com/polynaut/dth-character-studio/pull/749) [`fc20c37`](https://github.com/polynaut/dth-character-studio/commit/fc20c37ca7b362df178221e50ca9cd46df35c4af) Thanks [@polynaut](https://github.com/polynaut)! - A Houdini project card no longer says “Needs attention” about a problem that is already gone

  The badge is painted from the last stored scan, and the background sweep that
  refreshes that store was started without waiting for it — so the card kept
  showing whatever was found _before_ the scan, while the Utils drawer, which
  scans live, reported every check passing. Opening the drawer to a green
  **“Nothing to fix — every check already passes”** under a card marked _Needs
  attention_ was the visible symptom.

  The card now re-reads once the sweep it started has landed, and again when the
  Utils drawer closes (the drawer's own scan is the freshest answer there is). The
  first paint is still instant from the store — nothing waits on Houdini.

- Updated dependencies [[`943ecf3`](https://github.com/polynaut/dth-character-studio/commit/943ecf387adcfb4057ca679dac9acfaf20bf9417), [`71ad73c`](https://github.com/polynaut/dth-character-studio/commit/71ad73c0059802a9ca75e8116acfdf4909b29efe)]:
  - @dth/rom@0.69.0
  - @dth/ui@0.69.0

## 0.68.1

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.68.1
  - @dth/ui@0.68.1

## 0.68.0

### Minor Changes

- [#738](https://github.com/polynaut/dth-character-studio/pull/738) [`54f6ab2`](https://github.com/polynaut/dth-character-studio/commit/54f6ab27884dedd4c868cb62b50df31f8a2c8a9f) Thanks [@polynaut](https://github.com/polynaut)! - New Daz script: **Kill_Animation** — rescue an old scene that is only a ROM

  A scene the studio can use needs an empty timeline, which makes an old character
  that survives _only_ as its full ROM animation unusable as it stands. The new
  bundled `Kill_Animation` script is the way back: open the old scene, run
  `Scan_Frames` to capture the ROM frame by frame, then run this to get the
  character back on its own. It deletes every key in the scene and puts the
  animation range back to the default 0–30 frames — the figure keeps its shape,
  its clothes and the pose it holds at frame 0; only the timeline goes. It shows
  you what it found and asks before deleting anything, never saves the scene
  itself, and names any property that refused to give up its keys rather than
  reporting a clean run over a scene that still has animation in it. Installs into
  `Scripts/DTH-Character-Studio` on the next Save or Tools → Refresh assets.

- [#735](https://github.com/polynaut/dth-character-studio/pull/735) [`b8120a4`](https://github.com/polynaut/dth-character-studio/commit/b8120a49f9489e084c02d9b2b825bb3eb615586f) Thanks [@polynaut](https://github.com/polynaut)! - Generate project: pick the scene, and Houdini writes where you meant

  Two things a generated Houdini project got wrong on a character with more than
  one Daz scene.

  **It always imported the primary.** Every scene exports into its own folder, so
  an outfit variant's project came out wired to the primary's `.dth`/FBX/Alembic/
  ROM-FBX/CSV — five paths to re-pick by hand inside Houdini. The Generate dialog
  now has a **Daz scene to import** picker (only when there's a choice; it defaults
  to the primary), and the network is wired to that scene's export set. Generate
  one project per scene.

  **Its export directory pointed at `dth-exports`.** That's the Daz→Houdini
  intermediate folder — large, regenerable, the one you don't back up. Houdini's
  own Unreal-bound output now goes where the guide always said it would: the
  character's **`export/`** folder (`$HIP/../export/`, or whatever your project's
  _Final export subfolder_ is called). One per character, shared by every scene's
  project.

  Existing projects are untouched: both the studio and the Houdini-side runner
  only ever fill a **blank** export directory, so a project you already wired keeps
  exactly what it has. **Utils → Fill network** uses the corrected value too.

- [#736](https://github.com/polynaut/dth-character-studio/pull/736) [`c05c9a3`](https://github.com/polynaut/dth-character-studio/commit/c05c9a3283d519c59462cf2b7c0210aaa647860d) Thanks [@polynaut](https://github.com/polynaut)! - Houdini Utils: run DazToHue's own **Refresh Assets** from the General tab

  A `.hip` keeps the DazToHue asset definitions it was built with, so switching
  your installed DazToHue release leaves every project you already have on the old
  ones. The General tab now runs DazToHue's own **Refresh Assets** shelf tool
  against every project the scan could open, instead of you opening each one in
  Houdini by hand. It is an action rather than a check — nothing records which
  release a project's assets came from, so nothing can tell you one needs it — and
  the report says only what was observed: the tool that ran, and whether the scene
  came back modified. A project reporting no change is left alone rather than
  re-saved, and a run takes the same rolling backup as the tab's other actions.

- [#736](https://github.com/polynaut/dth-character-studio/pull/736) [`c05c9a3`](https://github.com/polynaut/dth-character-studio/commit/c05c9a3283d519c59462cf2b7c0210aaa647860d) Thanks [@polynaut](https://github.com/polynaut)! - Houdini projects: checked in the background, and copyable at last

  Linking a Houdini project used to be the only option. Copying one was refused,
  because a copied `.hip` arrives broken in ways the studio couldn't see: it
  carries the source's `$JOB` and its absolute file references, so it quietly
  imports the character it was copied _from_. Now the studio can see all of that —
  so copying is offered.

  **Projects are scanned in the background.** Opening a character (or changing its
  project list) scans its Houdini projects and caches the result, so the Utils
  drawer opens on data that is already there instead of starting hython and making
  you wait. Only projects inside the character's folder are scanned — one linked
  from your own tree is yours, and the studio has no opinion to offer about it. At
  most two run at once, and a project whose file hasn't changed since the last look
  costs nothing at all.

  **A project that needs attention says so on its card**, with the reason in the
  tooltip: `$JOB` pointing at another character, import paths that don't resolve,
  parameters still blank. Everything it reports has a repair in the Utils drawer.
  It stays quiet about a project it hasn't scanned yet — no scan is not a fault.

  **Add project can now copy** (or move) the file into the character's Houdini
  folder instead of linking it where it lies. Linking stays the default. A name
  already in that folder is refused rather than overwritten.

  **The PoseAsset CSV path gets its own row in the General tab**, because "not
  filled in yet" and "your DazToHue version hasn't got that parameter" are
  different answers and only the first is something you can fix.

  One thing the checks deliberately do _not_ cover: material texture paths. A clean
  card means `$JOB`, the DazToHue imports and the blank parameters are fine — not
  that every path in the scene resolves.

- [#737](https://github.com/polynaut/dth-character-studio/pull/737) [`050773c`](https://github.com/polynaut/dth-character-studio/commit/050773c713a5391705361d2c52b36e3a0051e1d7) Thanks [@polynaut](https://github.com/polynaut)! - The studio notices new files you save into a character's folder

  Save an outfit variant from Daz (or a new Houdini project) anywhere into the
  character's folder, tab back to the studio, and it now tells you: a banner on
  the character page reports the new `.duf` / `.hip` files the moment the window
  regains focus (and on opening the page). **Review** opens a wizard with one
  page per file — the same validation the Add-scene dialog runs (generation,
  one figure, empty timeline, geograft vs the primary, not-already-linked), then
  **Add** links it in place; a character without a primary scene gets **Set as
  primary** instead, deriving gender/genesis/GEN exactly like the link flow.
  Houdini projects link in place as always.

  **Skip is permanent** — a skipped file lands in the character's `.dcsmeta`
  skip list and is never offered again (a manual pick/drop still works). The
  banner's ✕ just hides it for the session. Files you save while the wizard is
  open append as new pages on the next focus; generated output (`dth-exports`,
  ROM animations, Houdini `backup/`) is never offered.

  It doesn't matter which page you tab back to. If the studio is showing the
  project page — or Settings, or Tools — a banner at the top of the window names
  the character whose folder the file landed in and takes you there, where the
  wizard above does the rest.

### Patch Changes

- [#734](https://github.com/polynaut/dth-character-studio/pull/734) [`e80da9f`](https://github.com/polynaut/dth-character-studio/commit/e80da9f2278897f9c920851754dd3b19d7dc60c2) Thanks [@polynaut](https://github.com/polynaut)! - Daz and Houdini paths follow their installation when it moves

  Activating an installation in Settings derives its paths and writes them, and
  they're shown read-only from then on. But the derivation was a one-time snapshot:
  point the DAZ Install Manager at a different content library afterwards, and the
  studio quietly carried on generating into the old one. Nothing said so, and the
  only cure was re-clicking a card labelled "Active" — which invites nobody to click
  it.

  The paths are now re-derived whenever the installations are scanned, so a fresh
  Settings visit (or **Rescan**) picks the change up on its own. Same for Houdini.

  Two things it deliberately won't do: it never writes an empty value over a working
  path — DIM dropping its manifests override shouldn't blank a path you depend on —
  and it never persists your other unsaved edits, so with a dirty page the fresh
  values land in the form and wait for your Save.

- [#743](https://github.com/polynaut/dth-character-studio/pull/743) [`92a2376`](https://github.com/polynaut/dth-character-studio/commit/92a23768e53700de8b75381843b795aca1048c6a) Thanks [@polynaut](https://github.com/polynaut)! - Generation stops walking scene folders one at a time

  The pass that renames the pre-v48 `.ROM_Animations` folder runs on every
  generation, and it checked each of the character's scene folders in sequence —
  up to three round trips per folder, on whatever share the character lives on.
  The folders are independent, so they are now checked together. Nothing about
  what it does changes: still idempotent, still leaves both folders alone if both
  exist, still best-effort so a locked folder can never fail the generation that
  triggered it.

- Updated dependencies [[`54f6ab2`](https://github.com/polynaut/dth-character-studio/commit/54f6ab27884dedd4c868cb62b50df31f8a2c8a9f), [`e3fb935`](https://github.com/polynaut/dth-character-studio/commit/e3fb935a8c8d37c77f8fe43d6d9ea2d3d88a7c4c), [`b1bb992`](https://github.com/polynaut/dth-character-studio/commit/b1bb992d48b68f97ee27d94e1161a33e5771736f), [`e80da9f`](https://github.com/polynaut/dth-character-studio/commit/e80da9f2278897f9c920851754dd3b19d7dc60c2)]:
  - @dth/rom@0.68.0
  - @dth/ui@0.68.0

## 0.67.0

### Patch Changes

- Updated dependencies [[`73157f8`](https://github.com/polynaut/dth-character-studio/commit/73157f8f71a50ae4a982463669c7117d192228cf), [`0543470`](https://github.com/polynaut/dth-character-studio/commit/0543470a60fc36c9f8a8659efa451772721998bc), [`8216631`](https://github.com/polynaut/dth-character-studio/commit/8216631f24a49a773a7dce3ee5b09f466e96d07a), [`ab7cc1a`](https://github.com/polynaut/dth-character-studio/commit/ab7cc1aa83f64a9dd3e86acd2fa0ac9a36f2bbc3), [`1189f4c`](https://github.com/polynaut/dth-character-studio/commit/1189f4c570cdb158ba665b70547baca418557e01), [`006962b`](https://github.com/polynaut/dth-character-studio/commit/006962b3654c8c57d8d95705856ac46fd07f5cbf), [`9076da4`](https://github.com/polynaut/dth-character-studio/commit/9076da496ff7eb28df6fe93b1459232db384e5da), [`3382ce2`](https://github.com/polynaut/dth-character-studio/commit/3382ce20b0e4ba47be8c675a23e40388c736d086)]:
  - @dth/rom@0.67.0
  - @dth/ui@0.67.0

## 0.66.0

### Patch Changes

- Updated dependencies [[`ec95f9c`](https://github.com/polynaut/dth-character-studio/commit/ec95f9c0adbe5634ad00a28b1b48f77d9a657726), [`ce08aad`](https://github.com/polynaut/dth-character-studio/commit/ce08aad4c04f6a6c2eadebf9d148fc14ff3452a5)]:
  - @dth/rom@0.66.0
  - @dth/ui@0.66.0

## 0.65.0

### Patch Changes

- Updated dependencies [[`6e448a3`](https://github.com/polynaut/dth-character-studio/commit/6e448a3b77b337cd1168ad42986b1185b028827b), [`79ed8ce`](https://github.com/polynaut/dth-character-studio/commit/79ed8ce6e76cdaf574ae9b78dec124383c2b935a), [`ca0662e`](https://github.com/polynaut/dth-character-studio/commit/ca0662e49e19229cd695912a8d8078f0ba16723a), [`8eb0506`](https://github.com/polynaut/dth-character-studio/commit/8eb0506047c144d49fab175b41777f6c279f1922), [`f4ead67`](https://github.com/polynaut/dth-character-studio/commit/f4ead67fc366b8625bac8aa61e4602dfdbff7bd9), [`8eb0506`](https://github.com/polynaut/dth-character-studio/commit/8eb0506047c144d49fab175b41777f6c279f1922), [`8eb0506`](https://github.com/polynaut/dth-character-studio/commit/8eb0506047c144d49fab175b41777f6c279f1922), [`6d92d94`](https://github.com/polynaut/dth-character-studio/commit/6d92d94ba2473e571c59cfb7a589112e5a454cf5), [`8eb0506`](https://github.com/polynaut/dth-character-studio/commit/8eb0506047c144d49fab175b41777f6c279f1922)]:
  - @dth/rom@0.65.0
  - @dth/ui@0.65.0

## 0.64.0

### Patch Changes

- Updated dependencies [[`fdbc310`](https://github.com/polynaut/dth-character-studio/commit/fdbc31045e924e23ea6ecfec3029755e2b319538), [`e4fbe79`](https://github.com/polynaut/dth-character-studio/commit/e4fbe79cc080ed5d866da4db2fffb5ce50557645), [`e4fbe79`](https://github.com/polynaut/dth-character-studio/commit/e4fbe79cc080ed5d866da4db2fffb5ce50557645)]:
  - @dth/rom@0.64.0
  - @dth/ui@0.64.0

## 0.63.1

### Patch Changes

- Updated dependencies [[`81e5bde`](https://github.com/polynaut/dth-character-studio/commit/81e5bde6635ac714dbc2ac00d72dcd50b3cdef29)]:
  - @dth/rom@0.63.1
  - @dth/ui@0.63.1

## 0.63.0

### Patch Changes

- Updated dependencies [[`5b334df`](https://github.com/polynaut/dth-character-studio/commit/5b334df8c3f34ccb7baeb0c267e8b924a6cd3fa6)]:
  - @dth/rom@0.63.0
  - @dth/ui@0.63.0

## 0.62.2

### Patch Changes

- [#676](https://github.com/polynaut/dth-character-studio/pull/676) [`adb0b1e`](https://github.com/polynaut/dth-character-studio/commit/adb0b1e56a0439241127f59e5fc8d31b4dad451e) Thanks [@polynaut](https://github.com/polynaut)! - True up in-app copy that had drifted from the code: the Houdini remove dialog
  no longer claims it deletes the shared `houdini-project` folder (only the
  scene file is deleted), the Generate-project popup resolves imports as
  `$JOB/dth-exports`, and the two "Open guide" links follow the guide's renamed
  headings (Tab 3 — Refresh assets; the Scan & index accordion).

- [#680](https://github.com/polynaut/dth-character-studio/pull/680) [`73f9372`](https://github.com/polynaut/dth-character-studio/commit/73f93724595532bdc1e1e18af7c7908db8301366) Thanks [@polynaut](https://github.com/polynaut)! - A DTH Export Houdini leg now **closes Houdini again** once its exports are
  done: the job carries a `closeWhenDone` flag and `456.py` exits the instance
  from inside (save prompt suppressed — the scene is deliberately never saved)
  right after writing its final result. A queue of projects no longer stacks
  open Houdini windows, and a session you opened yourself is never touched.
  **Open only** still leaves the project open to work in.

- [#679](https://github.com/polynaut/dth-character-studio/pull/679) [`9773c4c`](https://github.com/polynaut/dth-character-studio/commit/9773c4c50f7dbf463db514a587f009246ef12cb1) Thanks [@polynaut](https://github.com/polynaut)! - Tools now opens on **Scan & index** — the tab order is Scan & index, Daz
  Studio & Houdini, Refresh assets. A plain `/tools` lands on the scan panel;
  `?tab=install` addresses the installers, and existing `?tab=index` /
  `?tab=refresh` deep links keep working unchanged.
- Updated dependencies []:
  - @dth/rom@0.62.2
  - @dth/ui@0.62.2

## 0.62.1

### Patch Changes

- Updated dependencies [[`6aaff15`](https://github.com/polynaut/dth-character-studio/commit/6aaff15dcf28b4649d8a41c5c440f79914c054cc)]:
  - @dth/rom@0.62.1
  - @dth/ui@0.62.1

## 0.62.0

### Patch Changes

- Updated dependencies [[`c323df8`](https://github.com/polynaut/dth-character-studio/commit/c323df84ff28b398455a1209c8ab6cc163242b8b), [`4524572`](https://github.com/polynaut/dth-character-studio/commit/45245728a1f34de51dde8992bf0b8c67b15bb0f6)]:
  - @dth/rom@0.62.0
  - @dth/ui@0.62.0

## 0.61.0

### Patch Changes

- [#653](https://github.com/polynaut/dth-character-studio/pull/653) [`601e67a`](https://github.com/polynaut/dth-character-studio/commit/601e67a6b6ed6f47e30aed1742a9aae8aea583e6) Thanks [@polynaut](https://github.com/polynaut)! - Tools → Build Genesis Index no longer stalls behind invisible dialogs in a
  minimized Daz Studio. The Runner handoff now runs a hidden, dialog-free twin of
  the index builder (`.Build_Genesis_Index_Bulk.dsa`, runtime v52): the
  confirmation is skipped (the Runner's scene is a fresh empty one — there is
  nothing to lose and nobody in front of the window), the summary goes to the Daz
  log instead of a modal, and failures ("nothing to build", an unwritable index)
  fail the job row loudly so the studio's panel toasts the reason. The handoff
  also self-installs the runtime first, so pressing the button right after an app
  update just works. Double-clicking the visible `Build_Genesis_Index.dsa` in the
  Content Library keeps its dialogs — that path is interactive on purpose.

- Updated dependencies [[`601e67a`](https://github.com/polynaut/dth-character-studio/commit/601e67a6b6ed6f47e30aed1742a9aae8aea583e6), [`42abaae`](https://github.com/polynaut/dth-character-studio/commit/42abaaef9a7bde88ff76e2e4c09f810868b572ae), [`f5ce2e4`](https://github.com/polynaut/dth-character-studio/commit/f5ce2e43a96ac7f4cded4fa62822ade13e9bbe31), [`592d769`](https://github.com/polynaut/dth-character-studio/commit/592d7691a10862bd83f63c1ae377fc88bd3d11c0), [`fcf236d`](https://github.com/polynaut/dth-character-studio/commit/fcf236def2c8f8eb74c526afbad82281b33dba3c), [`bf8ee35`](https://github.com/polynaut/dth-character-studio/commit/bf8ee35293168f7e83f172d7641ac2a69679c909)]:
  - @dth/rom@0.61.0
  - @dth/ui@0.61.0

## 0.60.0

### Minor Changes

- [#645](https://github.com/polynaut/dth-character-studio/pull/645) [`d5557e2`](https://github.com/polynaut/dth-character-studio/commit/d5557e2199b9430b1b13acba7d50ff92cafb7711) Thanks [@polynaut](https://github.com/polynaut)! - Bone-scale **reference-skeleton paths** in the delivered PoseAsset CSV are now written relative to **`$HIP`** — `$HIP/dth-exports/primary/Kira_frame_432.fbx` instead of a baked-in absolute path. They resolve through a `dth-exports` shortcut kept next to each generated `.hip`: **Generate project** creates it, and every generation checks and repairs it, so projects generated before this release pick theirs up on the next save.

  The studio never writes a `$HIP` path it can't back: a character with **no Houdini project inside its folder**, or one whose shortcut can't be created (a network export root, a real folder in the way), keeps absolute paths — per character, whatever the setting says. The new **Settings → Houdini path style** switches everything back to absolute if you prefer.

- [#643](https://github.com/polynaut/dth-character-studio/pull/643) [`b43cf8f`](https://github.com/polynaut/dth-character-studio/commit/b43cf8f9d8492d1cf76df38e620b4c237f23cc31) Thanks [@polynaut](https://github.com/polynaut)! - Every **Browse** button now opens the native dialog **where the field already points** — the Daz library, the Houdini documents folder, a linked scene, a Houdini or Unreal project — instead of wherever the OS last happened to be. A field that is still empty starts at the closest folder that makes sense for it: an additional Houdini documents folder opens beside the primary one, the DTH release and Exporter folders open at each other's parent, a second asset or uninstall folder opens beside the first, "Open project" opens at your most recent one, and a character's scene pickers open in the folder its primary scene lives in. File pickers preselect the file that is already set.

- [#649](https://github.com/polynaut/dth-character-studio/pull/649) [`9234a70`](https://github.com/polynaut/dth-character-studio/commit/9234a709fa8f4d4fac73f3ccc64c9f2bb0f10900) Thanks [@polynaut](https://github.com/polynaut)! - New **Tools → Build Genesis Index** tab: one button hands the index build to Daz Studio through the Runner plugin, so you no longer have to find `Build_Genesis_Index` in the Content Library and double-click it yourself. Daz starts if it isn't running, builds and scans every generation's stock figures in a fresh scene — leaving whatever you had open alone — and the panel reports when it's done. Rebuild it after installing new morph packs, geografts or figure add-ons; it's what the **Morph name** and **Bone** autocompletes read.

### Patch Changes

- [#650](https://github.com/polynaut/dth-character-studio/pull/650) [`6fa7e35`](https://github.com/polynaut/dth-character-studio/commit/6fa7e35feb6d92b48f9c7c0605db0862957debc7) Thanks [@polynaut](https://github.com/polynaut)! - **DTH Export right after closing Daz Studio no longer strands the batch.** The wait dialog would appear, then vanish without Daz ever starting: the Daz that was still shutting down had claimed the batch on a final poll tick and exited before running anything, and the Runner only ever looks for an _unclaimed_ job file — so it sat there forever, invisible. The studio now takes such a batch back and starts Daz with it, as the dialog always promised. Only a batch on which nothing has run yet is reclaimed; one that got partway through is still reported as a run that died, rather than re-exporting scenes that already finished. The wait dialog also stands down by itself when Daz turns out to be alive after all and starts working the batch late (say, it sat behind a Save prompt) — instead of suggesting through a live export that Daz still needs closing.

- [#640](https://github.com/polynaut/dth-character-studio/pull/640) [`805ac02`](https://github.com/polynaut/dth-character-studio/commit/805ac02fff11cb5a5c0dafaab8c9c938f3dddbaf) Thanks [@polynaut](https://github.com/polynaut)! - Replacing a character's primary Daz scene now pre-selects the new scene's detected hair items, the same way creating a character, linking the first primary and adding an extra scene already did. A replacement is a different scene with different hair, so the new primary used to arrive with an empty hair list — and hair the studio is meant to keep out of the export rode straight into the FBX unless you remembered the wand. Trim the list in the editor if the guess overshoots.

- [#646](https://github.com/polynaut/dth-character-studio/pull/646) [`64b4ef1`](https://github.com/polynaut/dth-character-studio/commit/64b4ef19435c3e300aa023195904735c2bcfd485) Thanks [@polynaut](https://github.com/polynaut)! - **Export only** now verifies every selected scene's saved ROM animation before handing the batch to Daz. Start waits as **Checking scenes…** while the dialog's scene probe is still running (a row checked in that window can no longer start on unknown state), and the check runs again at Start itself — a ROM animation deleted after the dialog opened is now refused in the dialog, which names the scenes and points at **ROM + Export** or **ROM only**, instead of starting on a stale go-ahead. A scene whose `.duf` file is missing is no longer pre-checked just because a saved ROM animation survives beside it, and a selected row that turns out to be unrunnable can now be unselected (previously its checkbox was disabled outright, checked or not).

- [#644](https://github.com/polynaut/dth-character-studio/pull/644) [`3b28e24`](https://github.com/polynaut/dth-character-studio/commit/3b28e24eefa4d5126e389e27f60e1ba06a25a074) Thanks [@polynaut](https://github.com/polynaut)! - **Replacing the primary Daz scene is now only offered while it is the character's only scene.** Every extra scene is validated against the primary when you add it — above all for the same GP/DK geograft, since each scene has to produce the primary's skeleton. Swapping the primary re-decides that reference, so a replacement without Golden Palace would leave a set of already-validated scenes quietly mismatched, with nothing to re-check them. The replace button stays visible but refuses, and its tooltip says what to do: unlink the other scenes, replace, then add them back — each one is properly validated against the new primary on the way in.

- [#647](https://github.com/polynaut/dth-character-studio/pull/647) [`fe95a6c`](https://github.com/polynaut/dth-character-studio/commit/fe95a6c5e7105d52ae6f41397d306bb0b03d3012) Thanks [@polynaut](https://github.com/polynaut)! - **Renaming a character's Daz scenes folder now takes its export folder with it.** The export root is derived, and it was derived from the _project's_ Daz subfolder — so renaming `daz3d` to something else moved `dth-exports` along with the folder and then pointed the character straight back at the old, now-missing location. It follows the character's actual scenes folder now.

  The `dth-exports` shortcuts Houdini resolves through are also **re-pointed on every save**, so they survive everything that can move a character's export folder: renaming the character or its folder, renaming the Daz scenes folder, moving the project's characters root, and the one-time export-root migration. Previously only **Generate project** created them, and they kept aiming at wherever the exports used to be.

- [#641](https://github.com/polynaut/dth-character-studio/pull/641) [`9cf6552`](https://github.com/polynaut/dth-character-studio/commit/9cf6552b40d09b89a1b4db11ebfae45b7db5faa1) Thanks [@polynaut](https://github.com/polynaut)! - **"Export too" never actually ran.** It matched the scenes you ticked against a lowercased lookup table using their raw paths — and every Windows path has a capital in it — so the job came out empty and the run always died on "None of these scenes has an export path". Fixed, and covered end to end by a new browser test that plays both the Daz Runner's and Houdini's part.

  A second silent miss on the Houdini side: a network whose `.dth` was picked through the `dth-exports` shortcut the studio puts inside the project folder stores the shortcut's spelling of the path, which never matched the job's real export path — the node was skipped as if it belonged to some other character. The runner now resolves that link on both sides before comparing.

  The run also cleans up after itself now: the `.dth_houdini_job.json` and `.dth_houdini_result.json` it writes into the character folder are deleted the moment it ends, instead of being left behind until some later run happened to overwrite them. A job file Houdini never read is kept — that case can be a Houdini the liveness probe hasn't seen yet, and pulling the job out from under it would break the run.

  The finished toast also shows what the HDA's pre-flight check complained about. The studio answers its "Continue anyway?" with Yes, so those warnings only ever existed inside the result file — which is now deleted.

- [#644](https://github.com/polynaut/dth-character-studio/pull/644) [`3b28e24`](https://github.com/polynaut/dth-character-studio/commit/3b28e24eefa4d5126e389e27f60e1ba06a25a074) Thanks [@polynaut](https://github.com/polynaut)! - **The Remove-scene dialog no longer pre-ticks "Delete file on disk" for in-folder scenes.** Deleting is opt-in per removal now: an in-folder scene can be the only copy there is (Add scene's "delete the original" moves it in), the delete is permanent, and unlinking-to-re-add is the documented route around the new replace-primary gate — a pre-ticked delete would destroy exactly the file you mean to keep. A linked-in-place scene still locks the toggle off entirely.

- Updated dependencies [[`d5557e2`](https://github.com/polynaut/dth-character-studio/commit/d5557e2199b9430b1b13acba7d50ff92cafb7711), [`3b28e24`](https://github.com/polynaut/dth-character-studio/commit/3b28e24eefa4d5126e389e27f60e1ba06a25a074)]:
  - @dth/rom@0.60.0
  - @dth/ui@0.60.0

## 0.59.0

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.59.0
  - @dth/ui@0.59.0

## 0.58.0

### Minor Changes

- [#630](https://github.com/polynaut/dth-character-studio/pull/630) [`498a615`](https://github.com/polynaut/dth-character-studio/commit/498a61563680bead4dfd64868162d6ecb03e18ba) Thanks [@polynaut](https://github.com/polynaut)! - feat: every new character gets a final **export** folder

  Alongside its Daz (`daz3d`) and Houdini (`houdini`) folders, a new character now also gets an **`export`** folder — where the files Houdini generates for Unreal land. That's the end of the pipeline, and it's yours to organise; the studio only creates it.

  Not to be confused with `dth-exports`, which lives _inside_ the Daz folder and holds the Daz→Houdini intermediate the DTH Exporter writes.

  The name is a per-project setting like the other two — **Settings → Project → Final export subfolder** — so a project can call it something else, or nest it (`unreal/incoming`). Existing characters get theirs on the next generation, so nobody has to create it by hand.

- [#636](https://github.com/polynaut/dth-character-studio/pull/636) [`dd50848`](https://github.com/polynaut/dth-character-studio/commit/dd50848d32da1780a6a9276b9e6f594b873e1a5a) Thanks [@polynaut](https://github.com/polynaut)! - **New Daz script: Fix graft shell surfaces.** Fitting a nipple or navel geograft
  (STX and friends) to a figure that already wears **Golden Palace** or **Dicktator**
  adds that graft's surfaces to the genital shells — switched **on** — so the shell
  renders over the new graft and you get shell material where the graft should be.
  The fix has been to hunt down each `stx_…_Body` row in the shell's
  _Shell › Visibility › Surfaces_ list and switch it off by hand, on every shell, in
  every scene.

  `Fix_Graft_Shell_Surfaces` now does it in one run: open the scene, run the script
  from **Scripts › DTH-Character-Studio** in the Content Library, and it switches off
  every foreign-graft surface on the GP/DK shells. Nothing to select, and it is safe
  to re-run — only rows that are still on get written.

  It is deliberately narrow: other geoshells (skin overlays, tattoos, nail shells) are
  left alone, since those legitimately want the graft surfaces visible, and a shell's
  own graft always keeps its rows. A scene with no GP/DK shell is a no-op. If the
  script cannot tell which graft a shell belongs to it reports that shell as skipped
  rather than guessing — guessing wrong would blank the shell itself.

  Run **Tools → Refresh assets** once to install the new script (and its icon) into an
  existing scripts folder.

- [#629](https://github.com/polynaut/dth-character-studio/pull/629) [`d497ab1`](https://github.com/polynaut/dth-character-studio/commit/d497ab180aba0a3a55fc2652a72cec9227df5baf) Thanks [@polynaut](https://github.com/polynaut)! - feat: the saved-ROM folder is `rom-animations`, and `dth-exports` can't be taken by a scene

  The folder holding your saved ROM animations was hidden and called `.ROM_Animations` — odd for a folder whose whole purpose is scenes you open by hand. It's now a normal visible `rom-animations/`, matching the naming of the other studio folders (`dth-exports`, `houdini-project`). An existing `.ROM_Animations` beside a linked scene is renamed for you the next time the character is saved, so nothing already saved is orphaned; if both folders somehow exist, the old one is left alone rather than merged.

  Scene subfolders can no longer be named **`dth-exports`**. That name belongs to the character's export root, which sits at exactly the level scene subfolders do, so a scene moved there would have fought the studio for the same directory. It's refused wherever a subfolder is chosen — adding or replacing a scene with a copy, and renaming one from its card. (`rom-animations` needs no such rule: it lives inside each scene's own subfolder, one level below where a collision could happen.)

  Runtime v48 — Refresh assets regenerates the scripts and performs the rename.

### Patch Changes

- [#634](https://github.com/polynaut/dth-character-studio/pull/634) [`3b45f7a`](https://github.com/polynaut/dth-character-studio/commit/3b45f7a33152092c792428cd2f4891e4aac989c6) Thanks [@polynaut](https://github.com/polynaut)! - fix: old ROM animations are cleaned up, and the folder rename actually happens

  Two problems with saved ROM animations.

  **Renaming a Daz scene left its ROM animation behind forever.** The saved file is named after the scene it came from, so a rename just starts writing a new one beside the old — and Daz saves two thumbnails with each, so every rename stranded three files. They're retired on the next save now. Only files the studio itself wrote are touched, and only next to scenes the character still uses.

  **The `.ROM_Animations` → `rom-animations` rename didn't run.** It renamed the folder onto itself, which did nothing at all — so anything already saved stayed in the old hidden folder while Daz started filling the new one beside it. Fixed, and the migration now moves those files across as intended.

- Updated dependencies [[`03c72ed`](https://github.com/polynaut/dth-character-studio/commit/03c72ed9a196cddde78f6737a6302b29fe9fa701), [`dd50848`](https://github.com/polynaut/dth-character-studio/commit/dd50848d32da1780a6a9276b9e6f594b873e1a5a), [`3b45f7a`](https://github.com/polynaut/dth-character-studio/commit/3b45f7a33152092c792428cd2f4891e4aac989c6), [`d497ab1`](https://github.com/polynaut/dth-character-studio/commit/d497ab180aba0a3a55fc2652a72cec9227df5baf), [`3c180ab`](https://github.com/polynaut/dth-character-studio/commit/3c180ab523b8bb8fd278f515aa57b384ccb6a633)]:
  - @dth/rom@0.58.0
  - @dth/ui@0.58.0

## 0.57.0

### Minor Changes

- [#623](https://github.com/polynaut/dth-character-studio/pull/623) [`79b7361`](https://github.com/polynaut/dth-character-studio/commit/79b73613c24df207bf4a51231a7f5d5007dccf4e) Thanks [@polynaut](https://github.com/polynaut)! - feat: DTH Export asks what the run should do first — three modes:

  - **ROM + Export** (the default): build a fresh ROM, save the ROM animation scene, export everything (skeletal mesh + hair). Unchanged behaviour.
  - **ROM only**: build the ROM and save the `.ROM_Animations` scene, skipping the export. Needs no export directory.
  - **Export only**: export the saved ROM animations as they stand, hair included, without rebuilding — for a ROM you edited by hand in Daz. It pre-selects the scenes whose ROM animation is newer than their last delivered export, and skips scenes that have no ROM animation yet.

  Export-only rows open the saved ROM animation instead of the source scene, so every generated script now resolves such a file back to the scene it was built from (the wrong-scene guard included) — running any generated script on a ROM animation by hand works now instead of being refused. Only the full ROM + Export run marks scenes as exported. Runtime v46; Refresh assets regenerates the scripts and adds the new hidden `.Bulk_Export_Only.dsa`.

- [#627](https://github.com/polynaut/dth-character-studio/pull/627) [`bcea190`](https://github.com/polynaut/dth-character-studio/commit/bcea190ee37ce66ddd887be72fff6f19dc800c2d) Thanks [@polynaut](https://github.com/polynaut)! - feat: the groundwork for exporting a Houdini project from the studio — the job-file handoff and the Houdini-side runner.

  `houdini-runtime/456.py` is the half that runs inside Houdini: it does nothing at all unless the studio launched the session with a job, then finds every DazToHue export node whose network imported one of the selected scenes and triggers them in turn. It matches networks to scenes by the `.dth` path the studio itself wrote, so renaming a network doesn't break it, it answers the HDA's "Continue anyway?" check itself and keeps the text for the report rather than letting it vanish, and it never saves the scene or leaves a parameter changed behind it.

  Not yet wired to the DTH Export dialog — the launch, the result polling and the "Export too" toggle come next.

### Patch Changes

- Updated dependencies [[`79b7361`](https://github.com/polynaut/dth-character-studio/commit/79b73613c24df207bf4a51231a7f5d5007dccf4e), [`07d1d8d`](https://github.com/polynaut/dth-character-studio/commit/07d1d8d8c4aa1a863ceebe4ec566dda9338aecc9)]:
  - @dth/rom@0.57.0
  - @dth/ui@0.57.0

## 0.56.1

### Patch Changes

- [#621](https://github.com/polynaut/dth-character-studio/pull/621) [`ae91ddf`](https://github.com/polynaut/dth-character-studio/commit/ae91ddfcb4ba6dfa39b02e224c61cc447415e174) Thanks [@polynaut](https://github.com/polynaut)! - fix: a scene card's open menu now offers "Open ROM Animation" as soon as the animation is built. Its freshness came from the EXPORT handoff stamps, which a ROM-animation build never writes — so a freshly built animation still read stale forever (and a character that never exported read stale from the start), only looking right after a page reload. It is derived from the files themselves now: the saved `.duf` is current when it is newer than both the source scene and the character's generated ROM script, so a window focus always re-reads the truth.

  Also: the ROM-scene save logged "Could not save the ROM scene" on every successful Daz Studio 6 save — `DzScene::saveScene` returns a `DzError` (0 = success), not a bool. Runtime v45; Refresh assets regenerates the affected scripts. And the bundled Runner is v1.1.4: a scene handed to a running Daz is marked unmodified after loading, so closing it no longer asks to save changes nobody made.

- Updated dependencies [[`ae91ddf`](https://github.com/polynaut/dth-character-studio/commit/ae91ddfcb4ba6dfa39b02e224c61cc447415e174)]:
  - @dth/rom@0.56.1
  - @dth/ui@0.56.1

## 0.56.0

### Minor Changes

- [#619](https://github.com/polynaut/dth-character-studio/pull/619) [`381a2ad`](https://github.com/polynaut/dth-character-studio/commit/381a2ad141039962799bf9feb0da89e9e659f2e6) Thanks [@polynaut](https://github.com/polynaut)! - feat: "Add morphs on frame 0" — a new character panel listing morphs (name + value) the generated script sets and keys at frame 0, on every node of the figure tree that carries the morph (the figure and each fitted item) — so one clothing row like "Expand All" reaches whichever outfit pieces the open scene wears. Overridable per Daz scene (a full-replacement list, presence-armed like the preserve lists), and deliberately unvalidated: a scene without a listed morph just skips it. Schema v28, runtime v44 — Refresh assets regenerates existing scripts.

- [#614](https://github.com/polynaut/dth-character-studio/pull/614) [`c20d2b1`](https://github.com/polynaut/dth-character-studio/commit/c20d2b13d5feee067e40ed7e437d2f18007da648) Thanks [@polynaut](https://github.com/polynaut)! - feat(web): the DTH Export dialog gains an optional **Open Houdini project after export** select (empty by default) listing the character's linked Houdini projects — when picked, the studio opens that project automatically the moment the export batch finishes (skipped when every scene failed).

### Patch Changes

- [#617](https://github.com/polynaut/dth-character-studio/pull/617) [`174970b`](https://github.com/polynaut/dth-character-studio/commit/174970bd5e48c28a01a9408d7d0a894038c4d0b4) Thanks [@polynaut](https://github.com/polynaut)! - fix(web,ui): every modal dialog's **Cancel** button moves from the far left into the right-aligned button group, always as its first item — one footer layout across the app.

- [#620](https://github.com/polynaut/dth-character-studio/pull/620) [`6afb183`](https://github.com/polynaut/dth-character-studio/commit/6afb18353e61767f262abee2001c694b94f9f1b1) Thanks [@polynaut](https://github.com/polynaut)! - feat(web): new Content Library artwork for the `Export_Hair_…` script (tile + tooltip). Regenerated characters pick it up on the next save / Refresh assets.

- [#616](https://github.com/polynaut/dth-character-studio/pull/616) [`26d246b`](https://github.com/polynaut/dth-character-studio/commit/26d246b4a67a17b8d952395edced278d08c865e4) Thanks [@polynaut](https://github.com/polynaut)! - fix(web): the export button reads **"Exporting 1/2"** (processed scenes / total) instead of the percent, which only ever moved in whole-row jumps — and the whole app carries the OS **progress cursor** while a batch runs. The Runner (v1.1.1) writes a `jobsDone` counter into the job file on every rewrite; older Runners work identically (the count derives from the row statuses).

- [#614](https://github.com/polynaut/dth-character-studio/pull/614) [`c20d2b1`](https://github.com/polynaut/dth-character-studio/commit/c20d2b13d5feee067e40ed7e437d2f18007da648) Thanks [@polynaut](https://github.com/polynaut)! - fix(web): the DTH Export button shows the progress of ANY live Runner batch — including a scene card's ROM-animation generate and runs started in another window (previously only the run its own Start click armed). Display only: outcome toasts stay with the window that started the run.

- [#618](https://github.com/polynaut/dth-character-studio/pull/618) [`60ce75d`](https://github.com/polynaut/dth-character-studio/commit/60ce75d0a893b30b7f7be1329f0b6a2718bd2729) Thanks [@polynaut](https://github.com/polynaut)! - fix(web): the Daz Studio window comes to the front when a scene is opened in a running instance. The Runner raises it plugin-side, but Windows denies that while the studio holds the foreground — the studio now pulls Daz forward itself the moment the handoff is claimed (the same focus helper the Explorer-open flow uses).

- [#616](https://github.com/polynaut/dth-character-studio/pull/616) [`26d246b`](https://github.com/polynaut/dth-character-studio/commit/26d246b4a67a17b8d952395edced278d08c865e4) Thanks [@polynaut](https://github.com/polynaut)! - fix(web): a finished open-scene handoff's job file is deleted by the studio right away (a detached completion watch), instead of lingering until the next handoff sweeps it. And the bundled Runner is now v1.1.3: pressing **Cancel** in the Save Changes prompt deletes the job file — a deliberate cancel is not an outcome to report.

- [#617](https://github.com/polynaut/dth-character-studio/pull/617) [`174970b`](https://github.com/polynaut/dth-character-studio/commit/174970bd5e48c28a01a9408d7d0a894038c4d0b4) Thanks [@polynaut](https://github.com/polynaut)! - fix(web): the Replace-primary dialog drops the "Delete the old primary scene file" toggle — replacing always deletes the outgoing in-folder copy (that's what replacing means); a linked-in-place original is still only unlinked, never touched.

- [#614](https://github.com/polynaut/dth-character-studio/pull/614) [`c20d2b1`](https://github.com/polynaut/dth-character-studio/commit/c20d2b13d5feee067e40ed7e437d2f18007da648) Thanks [@polynaut](https://github.com/polynaut)! - fix(web): the scene card's Open-in-Daz menu now stands out — the Daz-green card tint and border (the `daz-card` treatment) with a heavier shadow and green hover states, so it reads as part of the card it belongs to.

- Updated dependencies [[`174970b`](https://github.com/polynaut/dth-character-studio/commit/174970bd5e48c28a01a9408d7d0a894038c4d0b4), [`381a2ad`](https://github.com/polynaut/dth-character-studio/commit/381a2ad141039962799bf9feb0da89e9e659f2e6)]:
  - @dth/ui@0.56.0
  - @dth/rom@0.56.0

## 0.55.0

### Minor Changes

- [#612](https://github.com/polynaut/dth-character-studio/pull/612) [`86bf55e`](https://github.com/polynaut/dth-character-studio/commit/86bf55e19e1b5db6b168da839259c626de044295) Thanks [@polynaut](https://github.com/polynaut)! - feat(rom,web): the scene card's **Open in Daz** now offers the saved ROM animation. Clicking the open button shows a small menu: **Open Original**, and **Open ROM Animation** when the scene's saved `.ROM_Animations/<stem>_ROM.duf` exists and is current — when it's missing, stale (the scene changed since its last handoff) or **Ctrl** is held, the entry reads **Open and Generate ROM Animation**: the Runner opens the scene, builds the ROM through the new hidden ROM-only script (`.Build_ROM_Animation.dsa`, runtime v43 — no export), and the freshly saved animation opens by itself. Also: an open-scene handoff whose Daz turned out to be closing now launches Daz directly once the process is gone, instead of showing the close-Daz dialog.

### Patch Changes

- [#608](https://github.com/polynaut/dth-character-studio/pull/608) [`9847855`](https://github.com/polynaut/dth-character-studio/commit/984785532cf87390343a96f8ae65c1ecfb009322) Thanks [@polynaut](https://github.com/polynaut)! - fix(web): **an added Daz scene now pre-selects its own hair items.** Creating a character and linking its first scene both filled the hair list from what the scene actually carries — but _Add scene_ didn't, so every outfit variant started empty. That is the case where it matters most: an outfit scene is usually the one bringing its own hair, and hair that isn't listed rides straight into the FBX instead of being hidden for the ROM export. Adding a scene now seeds the same detected list, ready to trim in the editor.

  Re-adding a scene that already has a hair list never overwrites it, and an unreadable scene still seeds nothing rather than claiming the scene is hairless.

- [#613](https://github.com/polynaut/dth-character-studio/pull/613) [`db03ed0`](https://github.com/polynaut/dth-character-studio/commit/db03ed0636fd62dc33befa01a40d8f71c08cc3f9) Thanks [@polynaut](https://github.com/polynaut)! - fix(web): the header avatar follows a replaced primary scene again. A scene-snapshot avatar whose source scene left the linked list (a replaced primary whose tip copy failed at relink time, a renamed extra) made the focus-driven avatar sync bail forever — the scene card showed the new look while the header kept the old one. The sync now adopts the primary and re-derives (the same self-heal as lost provenance; uploads stay untouched), and a scene rename repoints the avatar's provenance for extra scenes too, not just the primary.

- [#610](https://github.com/polynaut/dth-character-studio/pull/610) [`51850d5`](https://github.com/polynaut/dth-character-studio/commit/51850d51f4e44cc0fba33ca4564760c3bbd80eea) Thanks [@polynaut](https://github.com/polynaut)! - fix(web): DTH Export no longer strands the batch when Daz Studio is still shutting down. Pressing Start while the just-closed Daz process lingers used to hand the jobs to an instance that would never pick them up (and a fresh launch would die against the dying single instance) — nothing happened. The studio now watches for the Runner's claim; when it doesn't come, a "Waiting for Daz Studio to close…" dialog takes over and starts Daz automatically the moment the process is really gone — the queued batch begins by itself. The batch stays abortable throughout.

- Updated dependencies [[`86bf55e`](https://github.com/polynaut/dth-character-studio/commit/86bf55e19e1b5db6b168da839259c626de044295)]:
  - @dth/rom@0.55.0
  - @dth/ui@0.55.0

## 0.54.0

### Minor Changes

- [#602](https://github.com/polynaut/dth-character-studio/pull/602) [`c890079`](https://github.com/polynaut/dth-character-studio/commit/c8900791390a75a05d93ec8898b5745eea7e3bc2) Thanks [@polynaut](https://github.com/polynaut)! - feat(web): **Open in Daz now works while Daz Studio is already running.** Daz drops a forwarded command-line open once a scene is loaded, so clicking a scene card used to stop at a dialog asking you to close Daz first. The studio now hands the scene to the **Runner plugin** instead — a new one-row, script-less `open-scene` job (contract v3) that opens the scene in the running instance and raises the Daz window, which the studio can't do from outside.

  The old dialog is still the fallback, and it arrives on its own: a Runner too old to know the job type treats it as a foreign file and leaves it alone, so the studio takes the job back after a few seconds and behaves exactly as before. No plugin version check, nothing to configure — update the Runner (Settings → General) and the dialog simply stops appearing. Opening with Daz closed still launches it fresh, unchanged.

  A scene open is refused while an export batch is waiting or running: there is one job file and the Runner works one batch at a time.

### Patch Changes

- [#601](https://github.com/polynaut/dth-character-studio/pull/601) [`c46c792`](https://github.com/polynaut/dth-character-studio/commit/c46c79267f113fb24c34a7870641455f4fa69690) Thanks [@polynaut](https://github.com/polynaut)! - fix(web): **renaming a character no longer dies on "Access is denied. (os error 5)".** Windows refuses to rename a folder while any file inside it is open in another program — for a character folder that is almost always Daz Studio still holding the linked scene — and the raw OS error named neither the cause nor the fix. A rename now retries briefly first, so a passing antivirus scan or search-indexer touch no longer costs you the rename at all; if something really is holding it, the message says which folder and what to close instead of surfacing the plugin's error text. Applies to both rename paths: the character's name and the folder chip's edit-to-move. A failed rename still leaves the character exactly as it was — the folder move is the first thing a save writes, so nothing ends up half-renamed.

- [#607](https://github.com/polynaut/dth-character-studio/pull/607) [`cbfa3c9`](https://github.com/polynaut/dth-character-studio/commit/cbfa3c9754693b27e069e603eac8ab3e9212725c) Thanks [@polynaut](https://github.com/polynaut)! - fix(web): the two export switches ("Run the export with the ROM script", "Export hair assets too") move from the Export directory panel to the "Daz scripts generated" section — they shape which scripts generate and what the export pass covers, not the folder.

- [#606](https://github.com/polynaut/dth-character-studio/pull/606) [`86620e9`](https://github.com/polynaut/dth-character-studio/commit/86620e9dc91c72ce1c2733cd5d6d913626408f4f) Thanks [@polynaut](https://github.com/polynaut)! - fix(web): a Houdini project can no longer be generated over an existing one — the Generate dialog validates the name live (already-linked project or `<name>.hiplc` on disk → Generate disabled with an inline message, re-checked at click time), so a collision reads as form validation instead of an error toast. The dialog blurb also shrinks to the essentials ("Creates `<name>.hiplc` into `.\houdini` next to the project folder").

- [#605](https://github.com/polynaut/dth-character-studio/pull/605) [`fb4bfd3`](https://github.com/polynaut/dth-character-studio/commit/fb4bfd3d7725b914e851a4b592e21f6255216c6b) Thanks [@polynaut](https://github.com/polynaut)! - fix(web): declutter the Houdini projects section — the title gets the same size as "Daz scenes" (the two headers stack in the scenes tab and read as one pile at label size), and the Houdini project folder input moves back into the Export directory panel, next to the layout it actually configures. Its per-scene override behaviour is unchanged.

- Updated dependencies [[`0e8b892`](https://github.com/polynaut/dth-character-studio/commit/0e8b892a106d7aba0f2543aef1cfd71f6f66456a)]:
  - @dth/rom@0.54.0
  - @dth/ui@0.54.0

## 0.53.0

### Minor Changes

- [#600](https://github.com/polynaut/dth-character-studio/pull/600) [`a03581b`](https://github.com/polynaut/dth-character-studio/commit/a03581b945f029de71bc3c9341163afab4d53bea) Thanks [@polynaut](https://github.com/polynaut)! - feat(web): show the exact installed Runner plugin version and gate DTH Export on it.

  - The Settings Runner section now reads the installed DLL's version resource and shows it like the Exporter Plugin's ("Installed: 1.0.3 → updating to 1.0.5"), instead of just "a different Runner DLL is installed".
  - The DTH Export dialog blocks Start while the Runner plugin is missing or older than the bundled one — the jobs would run with stale behaviour (or never get picked up). A notice explains the state and deep-links to Settings → General; a Runner NEWER than the bundle does not block.

### Patch Changes

- [#598](https://github.com/polynaut/dth-character-studio/pull/598) [`26538db`](https://github.com/polynaut/dth-character-studio/commit/26538db39407fe9e40098fafdb4de9cec55bad14) Thanks [@polynaut](https://github.com/polynaut)! - fix(web,rom): **`Build_Genesis_Index` leaves an empty scene behind.** It already cleared between generations; now it clears once more after the last one is scanned, so a build no longer ends with the final generation's stock figures still loaded. Only the build path clears — scanning the open scene is still non-destructive, which is what makes it safe for indexing third-party geografts, add-ons and fitted clothing. Runtime v41: Refresh assets reinstalls the updated scanner.

- Updated dependencies [[`26538db`](https://github.com/polynaut/dth-character-studio/commit/26538db39407fe9e40098fafdb4de9cec55bad14)]:
  - @dth/rom@0.53.0
  - @dth/ui@0.53.0

## 0.52.0

### Minor Changes

- [#587](https://github.com/polynaut/dth-character-studio/pull/587) [`aebc321`](https://github.com/polynaut/dth-character-studio/commit/aebc32164536cbc652d430fd416b3de6416eb271) Thanks [@polynaut](https://github.com/polynaut)! - feat(web,rom): one **`Build_Genesis_Index.dsa`** replaces the four `Scan_Morphs_<Genesis>` scripts. Nothing to load or select first — it builds the stock figures itself, one generation at a time (Genesis 3/8/8.1 female **and** male, and Genesis 9 twice: it's gender-neutral, so that pair is differentiated by geograft instead — Golden Palace on one, Dicktator on the other), scans every figure root in the scene along with everything fitted to it, and writes all four `morphs_<G>.json` indexes in a single run. Each generation's female + male morphs now land in one index instead of whichever figure you happened to scan.

  The geografts load via their **Smart** preset, so the geoshells come along and get indexed with the graft. Because those products reship under new names and folders, they're found by globbing the library for the product name and **ranking** the hits — generation first (the same glob also finds the Genesis 8 versions, which must never be fitted to a G9 figure), then how complete a setup the file is; shells, UV fixes and material/pose presets are rejected outright, and the file it settled on is named in the run summary. Nothing plausible means "not installed", never the wrong graft.

  Everything resolves **before** the scene is touched, so the confirm dialog lists exactly what will be built and what will be skipped: a generation you don't have installed is skipped (its existing index left alone), a missing geograft is skipped, and if no Genesis figure is installed at all it says so and leaves the open scene untouched instead of clearing it for nothing. With neither G9 geograft installed the Genesis 9 pair collapses to one plain figure; with one installed the redundant plain figure is dropped.

  Every Daz script the studio installs now ships **Content Library artwork** (a 91x91 tile plus a 256x256 hover preview, named the way Daz names its own), so scripts show up as real items instead of broken-image placeholders: the two visible runtime scripts, and each generated per-character script — ROM, the split Export, and the hair export, with the ROM script's tile saying whether the export rides along with it or not.

  With figures already in the open scene it offers to scan **those** instead — that's how third-party geografts, add-ons and fitted clothing get indexed. Runtime v39: Refresh assets reinstalls the runtime, removes the retired wrappers, and regenerates the per-character scripts (which is what lands their artwork).

### Patch Changes

- Updated dependencies [[`aebc321`](https://github.com/polynaut/dth-character-studio/commit/aebc32164536cbc652d430fd416b3de6416eb271), [`ab51023`](https://github.com/polynaut/dth-character-studio/commit/ab5102332d27e80ae17b251c637d24dd0c217662)]:
  - @dth/rom@0.52.0
  - @dth/ui@0.52.0

## 0.51.2

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.51.2
  - @dth/ui@0.51.2

## 0.51.1

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.51.1
  - @dth/ui@0.51.1

## 0.51.0

### Minor Changes

- [#588](https://github.com/polynaut/dth-character-studio/pull/588) [`edb802d`](https://github.com/polynaut/dth-character-studio/commit/edb802d4b434f7b13f69407eaf7feaddcf24e8a2) Thanks [@polynaut](https://github.com/polynaut)! - feat(web): a new character's **export directory** starts pointed at its seeded **Houdini subfolder** — the same folder the "Choose folder…" picker already opened in, so direct export works from the first Save instead of needing a trip through the folder dialog. Nothing to point at means nothing is set: with the project's _Create Houdini subfolder_ switched off, or for a definition dropped loose in the project root, the export directory stays empty exactly as before. An existing path (a prefilled/imported definition) is never overwritten. The seed folder and the export path are now decided in one place, `createCharacterAt` — the only code that knows the folder the create actually landed in, since a name collision auto-suffixes it.

- [#585](https://github.com/polynaut/dth-character-studio/pull/585) [`9583c77`](https://github.com/polynaut/dth-character-studio/commit/9583c77d40c8ba22bb2eb85c96f49f3544c3ca74) Thanks [@polynaut](https://github.com/polynaut)! - feat(web,rom): every Daz scene lives in its **own subfolder** now — the primary in `primary` (created there on character creation), extra scenes in a folder seeded from the sanitized scene filename (character name and G9/Genesis/GP/DK-style noise stripped; editable, never empty — the scene location chips refuse an empty subfolder too). The **"Generate subfolders based on Daz scenes" switch is gone**: exports always nest under each scene's own subfolder name (schema v26, runtime v37), with the old scene-name nesting as the fallback for scenes linked outside the character folder. **Tools → Refresh assets migrates existing characters**: root-dwelling scene files are physically moved into their subfolders (primary → `primary`, extras → suggested names) with every linked path repointed — run it once after updating; a scene locked by an open Daz Studio is skipped with a note and picked up by the next refresh.

### Patch Changes

- [#583](https://github.com/polynaut/dth-character-studio/pull/583) [`58803cc`](https://github.com/polynaut/dth-character-studio/commit/58803ccb811b7d4fa544114d73e8f86cafdc1a36) Thanks [@polynaut](https://github.com/polynaut)! - fix(web): the Settings/Tools sticky header is now opaque — the frosted-glass translucency that let form content shimmer through under the title is gone (matching the character editor's header).

- Updated dependencies [[`88e47ac`](https://github.com/polynaut/dth-character-studio/commit/88e47ac55e81ec54a1960cf4a5e30753b3bd7ac8), [`9583c77`](https://github.com/polynaut/dth-character-studio/commit/9583c77d40c8ba22bb2eb85c96f49f3544c3ca74)]:
  - @dth/rom@0.51.0
  - @dth/ui@0.51.0

## 0.50.1

### Patch Changes

- Updated dependencies [[`bfa86c6`](https://github.com/polynaut/dth-character-studio/commit/bfa86c6e0b2375b647347336a3fcea804dc1081c)]:
  - @dth/rom@0.50.1
  - @dth/ui@0.50.1

## 0.50.0

### Minor Changes

- [#575](https://github.com/polynaut/dth-character-studio/pull/575) [`5a5cc24`](https://github.com/polynaut/dth-character-studio/commit/5a5cc24be180e4148b82e39fe6fb02502fca615e) Thanks [@polynaut](https://github.com/polynaut)! - New Export-directory toggle **"Export hair assets too"**: right after the main DTH export, each of the open scene's hair items is exported on its own (the Export_Hair per-item alembic pass) — in both modes, the combined ROM script and the split Export script. Scenes without a hair list skip the pass; the standalone Export_Hair script keeps being generated regardless.

- [#578](https://github.com/polynaut/dth-character-studio/pull/578) [`016f1b7`](https://github.com/polynaut/dth-character-studio/commit/016f1b703350a166724fdd85189ce6fc6daacf90) Thanks [@polynaut](https://github.com/polynaut)! - The primary Daz scene card has a **browse-to-replace** button (folder icon) now: pick a new `.duf`, pass the same validation and copy-vs-link decision as Add scene, and it replaces the primary — the Genitalia section re-derives from the new scene's geograft, the avatar follows, and the old scene's files can be deleted in the same dialog when they were an in-folder copy (a linked-in-place original is always kept).

### Patch Changes

- [#577](https://github.com/polynaut/dth-character-studio/pull/577) [`5bbe4da`](https://github.com/polynaut/dth-character-studio/commit/5bbe4da17fbc2b2032c688ebbea7ea0854b6dc00) Thanks [@polynaut](https://github.com/polynaut)! - The header avatar re-syncs again after the primary scene is re-saved in Daz: a separator/case difference between the stored avatar provenance and the scene list no longer kills the sync silently, and a scene-snapshot avatar without provenance now adopts the primary scene when no linked scene's current tip byte-matches (its source tip was simply overwritten before provenance existed).

- [#576](https://github.com/polynaut/dth-character-studio/pull/576) [`1d0da57`](https://github.com/polynaut/dth-character-studio/commit/1d0da57c5c8aa84768d470ed0bd99be91bdb74c7) Thanks [@polynaut](https://github.com/polynaut)! - Hair picker fixes: a search match no longer tears the option label apart ("Bi … xie Cut Main" — the bold highlight became separate flex items), and hair detection knows the hairstyle vocabulary (Bixie/Pixie Cut, Bob, Shag, Updo, Dreads, …) so items named after their style — never containing the word "hair" — classify as HAIR and get picked by the magic wand and creation pre-select.

- Updated dependencies [[`5a5cc24`](https://github.com/polynaut/dth-character-studio/commit/5a5cc24be180e4148b82e39fe6fb02502fca615e), [`1d0da57`](https://github.com/polynaut/dth-character-studio/commit/1d0da57c5c8aa84768d470ed0bd99be91bdb74c7), [`016f1b7`](https://github.com/polynaut/dth-character-studio/commit/016f1b703350a166724fdd85189ce6fc6daacf90), [`3ee54fb`](https://github.com/polynaut/dth-character-studio/commit/3ee54fb1841200fa16f5893af807d23c6b40f46e)]:
  - @dth/rom@0.50.0
  - @dth/ui@0.50.0

## 0.49.0

### Minor Changes

- [#570](https://github.com/polynaut/dth-character-studio/pull/570) [`505f7dd`](https://github.com/polynaut/dth-character-studio/commit/505f7dd8b65d33db3b7e9d593f18e3cabd621732) Thanks [@polynaut](https://github.com/polynaut)! - Create a character **without a Daz scene**: the create panel's "Create without scene" sets up the character folder (scenes subfolder included) so you can save your new scene into it straight from Daz Studio. Until the primary scene is linked, the character page is locked — only the Daz scenes panel (showing the exact folder to save into), Notes and Delete stay live. The first link then derives Gender, Genesis, the Genitalia section and the pre-selected hair from the scene, exactly like a scene-ful create, and unlocks the editor in place.

### Patch Changes

- [#567](https://github.com/polynaut/dth-character-studio/pull/567) [`79179c6`](https://github.com/polynaut/dth-character-studio/commit/79179c6a32eb8312eeafdbb5bafb3391fb9801fd) Thanks [@polynaut](https://github.com/polynaut)! - Unlinking an Unreal project now pauses on a confirm dialog (same recipe as removing a Daz scene), and the docs-site lightbox fits the viewport on phones — capped to the screen width with a margin instead of overflowing into a sideways scroll.

- Updated dependencies [[`6244016`](https://github.com/polynaut/dth-character-studio/commit/6244016df502ef936282a440caa06c4ac238e5e3)]:
  - @dth/ui@0.49.0
  - @dth/rom@0.49.0

## 0.48.3

### Patch Changes

- [#565](https://github.com/polynaut/dth-character-studio/pull/565) [`8917608`](https://github.com/polynaut/dth-character-studio/commit/8917608f37f3fe59e8061d52495e998a93a1f4db) Thanks [@polynaut](https://github.com/polynaut)! - The DS6 Constant-keyframe workaround (runtime v17) is rolled back — every ROM morph key is Linear again on Daz Studio 4 AND 6, matching the upcoming DTH release: Constant keys didn't actually solve DS6's key drift and introduced headaches with the DK9 ROM. Runtime v35; run Tools → Refresh assets and re-run the ROM script in Daz to re-key existing timelines.

- Updated dependencies [[`8917608`](https://github.com/polynaut/dth-character-studio/commit/8917608f37f3fe59e8061d52495e998a93a1f4db)]:
  - @dth/rom@0.48.3
  - @dth/ui@0.48.3

## 0.48.2

### Patch Changes

- [#561](https://github.com/polynaut/dth-character-studio/pull/561) [`136c9f1`](https://github.com/polynaut/dth-character-studio/commit/136c9f1a5a174a07e204684c7968a2e1346c7672) Thanks [@polynaut](https://github.com/polynaut)! - A Daz scene that already belongs to a character can't be linked again: both the create-character panel and the add-scene dialog validate the picked `.duf` against every character's scenes and hard-block on a hit (no "anyway" escape) — the error names the owning character and links straight to its page (unless it's the character you're on). Failed validation rows now read as one short sentence instead of a "rule — detail" split. The fill wizard's step 1 is one click per character (no radios, no Next), step 2 titles the source with its project and starts with JCM/RET unchecked, and the GEN section's enable rules moved from hidden Switch tooltips into an "i" popup on the section title. Side panels are 75vw (max 1000px), the add-scene dialog is wider, and the tall path chip grows with padding when a long path wraps instead of clipping.

- [#561](https://github.com/polynaut/dth-character-studio/pull/561) [`136c9f1`](https://github.com/polynaut/dth-character-studio/commit/136c9f1a5a174a07e204684c7968a2e1346c7672) Thanks [@polynaut](https://github.com/polynaut)! - The pose grid's morph column is now "Parameter name" (Daz Studio's own term; the guide wording follows, so searching for it finds the answer), with rebalanced column widths, the morphs expansion indented as one block, and a single expanded morph editing in ONE place instead of two live-synced inputs. Info popups across the character page shrank to a sentence plus an "Open guide" link (Name, Parameter name, Bone scale, Import from CSV, Art direction, Advanced options, Export directory), hidden title-tooltips became visible "i" popups (Node/Base/Auto/Value in the pose grid), the Daz scenes title gained one, and the GEN toggle's tooltip lost its tail. The two docked bars (Daz scenes / Unreal projects) are the same 80px height and reserve it while empty — no layout shift on the first link. The read-only Gender row wears the create panel's ♀/♂ badge and states what decided it ("detected Golden Palace", "detected G8 female", …).

- [#561](https://github.com/polynaut/dth-character-studio/pull/561) [`136c9f1`](https://github.com/polynaut/dth-character-studio/commit/136c9f1a5a174a07e204684c7968a2e1346c7672) Thanks [@polynaut](https://github.com/polynaut)! - Every scene card shows where its scene lives as a path chip under the title — relative like `.\daz3d\Outfit_B` (the scenes-root part dimmed), full path on copy, Alt+click reveals. In-folder chips are edit-to-move via a floating one-line panel: the scenes root is a fixed prefix, only the subfolder beyond it is editable (empty = directly in the root, vacated subfolders are pruned), and the primary moves exactly like any other scene. The scenes root itself still moves via the section chip, which now correctly moves the root even when the primary sits in a subfolder of it. Scene card titles inline-rename like the character name in the header — the `.duf` and both thumbnail sidecars follow the new name, every stored path repoints, and the generated scripts refresh (linked-in-place scenes keep their name). The Houdini projects section shows its folder chip before any project is linked. Chip pencils are ghosts with a solid hover box matching the 20×20 copy hint.

- [#561](https://github.com/polynaut/dth-character-studio/pull/561) [`136c9f1`](https://github.com/polynaut/dth-character-studio/commit/136c9f1a5a174a07e204684c7968a2e1346c7672) Thanks [@polynaut](https://github.com/polynaut)! - The character editor's sticky header grew a "Scroll Up" beside its Back link (pipe-separated, a step darker, native smooth scroll) — the pair fades in together once the page's own Back link has scrolled away. Renaming the character in the collapsed header no longer pops the title to full size: the edit input rides the same scroll-shrink timeline as the displayed title (52px at the top, 44px collapsed). The subtitle leads with the character's ♀/♂ symbol.

- [#561](https://github.com/polynaut/dth-character-studio/pull/561) [`136c9f1`](https://github.com/polynaut/dth-character-studio/commit/136c9f1a5a174a07e204684c7968a2e1346c7672) Thanks [@polynaut](https://github.com/polynaut)! - The Settings/Tools info popups joined the guide-linked style: Enable attachments, Enable Daz Products, Deduplicate, Custom morphs and Refresh assets each shrink to a sentence plus an "Open guide" link, while the field-level popups whose content the guide (or the placeholder) already covers are gone entirely — DIM manifests folder, morphs source/destination, Daz/Houdini presets folders. The enlarged Refresh-assets button gets extra vertical margin.

- [#561](https://github.com/polynaut/dth-character-studio/pull/561) [`136c9f1`](https://github.com/polynaut/dth-character-studio/commit/136c9f1a5a174a07e204684c7968a2e1346c7672) Thanks [@polynaut](https://github.com/polynaut)! - The Tools / Settings / About "Back" is a hard link to the page the utility area was entered from (tab switches and utility-to-utility hops no longer add Back steps), and the Refresh-assets version table drops its three per-row info popups — the guide's Refresh-assets section now documents what each version governs.

- Updated dependencies [[`136c9f1`](https://github.com/polynaut/dth-character-studio/commit/136c9f1a5a174a07e204684c7968a2e1346c7672), [`136c9f1`](https://github.com/polynaut/dth-character-studio/commit/136c9f1a5a174a07e204684c7968a2e1346c7672)]:
  - @dth/ui@0.48.2
  - @dth/rom@0.48.2

## 0.48.1

### Patch Changes

- [#559](https://github.com/polynaut/dth-character-studio/pull/559) [`a73f01a`](https://github.com/polynaut/dth-character-studio/commit/a73f01ac3a7f61d4e06b2a1c4e2fd6c6194804c4) Thanks [@polynaut](https://github.com/polynaut)! - Creating a character now pre-selects the primary scene's detected hair items (the same heuristic as the editor's "Select all detected hair items" wand), so the export excludes them from day one — trim the list in the editor if the guess overshoots.

- [#557](https://github.com/polynaut/dth-character-studio/pull/557) [`b9beccd`](https://github.com/polynaut/dth-character-studio/commit/b9beccdb2b52ff5f80bf80d84ef7148dd52284e9) Thanks [@polynaut](https://github.com/polynaut)! - Creating a character no longer detours through the "Copy Daz scene files?" modal: an outside-the-project scene shows **Link & Create** and **Copy & Create** (primary) right in the panel, with the "Delete original after copying" toggle beside them; an in-project scene keeps its single **Create**. The derived gender left its own row and now overlays the scene preview as a symbol badge (tooltip carries the text). The modal remains for adding extra scenes to an existing character.

- [#555](https://github.com/polynaut/dth-character-studio/pull/555) [`37ae9ed`](https://github.com/polynaut/dth-character-studio/commit/37ae9ed5b6c158b47a1eac81346d768f41cd5805) Thanks [@polynaut](https://github.com/polynaut)! - The character header's macOS-only "liquid glass" vibrancy background is removed — macOS now gets the same plain, opaque sticky header as Windows.

- [#557](https://github.com/polynaut/dth-character-studio/pull/557) [`b9beccd`](https://github.com/polynaut/dth-character-studio/commit/b9beccdb2b52ff5f80bf80d84ef7148dd52284e9) Thanks [@polynaut](https://github.com/polynaut)! - The create-character / add-scene Validation table is now a single-line checklist — check name + state icon, with detail only where it adds something (the detected generation/geograft, or what a failed check found) instead of a redundant second column.

- [#560](https://github.com/polynaut/dth-character-studio/pull/560) [`cc17cae`](https://github.com/polynaut/dth-character-studio/commit/cc17cae4ff9207535bd679fb713be1c25a9f2dc1) Thanks [@polynaut](https://github.com/polynaut)! - Toasts are redesigned on the app's dark surface: a colored left accent bar with a soft matching glow per severity (green/amber/red/sky), solid round severity icons, bold title over a muted description, and the close X on the right. Plain (severity-less) toasts keep a neutral edge.

- Updated dependencies [[`cc17cae`](https://github.com/polynaut/dth-character-studio/commit/cc17cae4ff9207535bd679fb713be1c25a9f2dc1)]:
  - @dth/ui@0.48.1
  - @dth/rom@0.48.1

## 0.48.0

### Minor Changes

- [#549](https://github.com/polynaut/dth-character-studio/pull/549) [`b60ab13`](https://github.com/polynaut/dth-character-studio/commit/b60ab13dae66a17f115112183c4da05091ee3a4f) Thanks [@polynaut](https://github.com/polynaut)! - The character JSON's per-scene data is restructured (schema v24, migrated
  automatically on read): the four parallel ROM override arrays became one
  section-keyed `rom` record whose escalation clears the sparse layers at the
  same key; the per-scene panels (identity, preserve, JCM rules) are
  presence-armed — a block existing IS the override, stored booleans are gone;
  and the character-level `groomScenes` map folded into the scene records as
  `hair`, so one structure repoints on folder moves. Empty entries and records
  self-prune, and the migration drops data that was already dead (orphaned row
  ids, disarmed panels' stored payloads). Generated artifacts are unchanged —
  the runtime consumes the compiled merge, not the stored shape.

### Patch Changes

- [#550](https://github.com/polynaut/dth-character-studio/pull/550) [`60ece3d`](https://github.com/polynaut/dth-character-studio/commit/60ece3d7177a7de1b12b05edb86a4161ece76e4c) Thanks [@polynaut](https://github.com/polynaut)! - Pose rows in a disabled ROM section can no longer be drag-reordered: Chromium
  still delivers pointer events to disabled buttons, so the drag handles slipped
  through the read-only fieldset — they're pointer-dead in that state now.

- [#546](https://github.com/polynaut/dth-character-studio/pull/546) [`3b26c95`](https://github.com/polynaut/dth-character-studio/commit/3b26c9573852d7346b4998ededa9ac55f9447b07) Thanks [@polynaut](https://github.com/polynaut)! - A disabled ROM section's content is read-only now: every edit control inside
  (fields, checkboxes, selects, add/remove buttons and the pose drag handles)
  is dead and the cursor reads forbidden — enable the section to edit it. The
  enable toggle sits in the section header and stays operable.

- [#550](https://github.com/polynaut/dth-character-studio/pull/550) [`60ece3d`](https://github.com/polynaut/dth-character-studio/commit/60ece3d7177a7de1b12b05edb86a4161ece76e4c) Thanks [@polynaut](https://github.com/polynaut)! - A ROM section's whole header row toggles its accordion now, not just the
  title and chevron — except the enable switch and the summary text beside it,
  where a slight miss must not flip the section under the pointer.
- Updated dependencies [[`b60ab13`](https://github.com/polynaut/dth-character-studio/commit/b60ab13dae66a17f115112183c4da05091ee3a4f)]:
  - @dth/rom@0.48.0
  - @dth/ui@0.48.0

## 0.47.0

### Minor Changes

- [#539](https://github.com/polynaut/dth-character-studio/pull/539) [`b8bef8e`](https://github.com/polynaut/dth-character-studio/commit/b8bef8e50751aa458ba61cc18062d8e97acdbd83) Thanks [@polynaut](https://github.com/polynaut)! - Every custom morph list gets a Clear button (ghost, right of Add group /
  Import from CSV / Add rule): confirmed via a modal, it removes the section's
  entire custom definition — all groups and frames, or every "Modify JCM
  frames" rule. On a non-primary scene the clear escalates like any structural
  edit, so the scene owns the emptied section.

- [#539](https://github.com/polynaut/dth-character-studio/pull/539) [`b8bef8e`](https://github.com/polynaut/dth-character-studio/commit/b8bef8e50751aa458ba61cc18062d8e97acdbd83) Thanks [@polynaut](https://github.com/polynaut)! - The character editor's Operations card gains a "Fill" button (beside
  Delete): a two-step wizard that copies ROM sections from any character in
  any known project. Step 1 picks the
  source character (same generation + gender, like the create dialog's ROM
  prefill), step 2 picks which of its filled sections to copy — the checked
  sections replace the current config in the editor draft. GEN keeps the
  target's scene-derived geograft setup (enabled state + GP/DK selection);
  only its art direction / custom frames copy over.

  The create-character panel's "ROM prefill" dropdown is replaced by the same
  Fill wizard: pick the source and its sections, create applies them onto the
  new character's defaults. Step 2 also offers "Also copy" extras: the
  Modify-JCM-frames rules (pre-checked), plus the preserve-morph and
  preserve-node-transform lists as separate checkboxes (offered when the
  source has them, unchecked by default). Hair scenes and
  scene overrides no longer copy on prefill: both are keyed by the source's
  own scene paths and sat inert on the new character.

### Patch Changes

- [#539](https://github.com/polynaut/dth-character-studio/pull/539) [`b8bef8e`](https://github.com/polynaut/dth-character-studio/commit/b8bef8e50751aa458ba61cc18062d8e97acdbd83) Thanks [@polynaut](https://github.com/polynaut)! - InfoPopup gains a `size` option ('xs' default, 'sm'/'md' matching the kit
  Button heights) so an "i" beside a button can match its height — used by
  "Import from CSV".

- [#539](https://github.com/polynaut/dth-character-studio/pull/539) [`b8bef8e`](https://github.com/polynaut/dth-character-studio/commit/b8bef8e50751aa458ba61cc18062d8e97acdbd83) Thanks [@polynaut](https://github.com/polynaut)! - Modal dialogs now place their Cancel button consistently: always ghost-styled
  and left-aligned, with the affirmative action on the right (remove-asset,
  bulk-delete, CSV import, scan picker, image crop, folder-move, app confirm and
  the new Fill wizard).
- Updated dependencies [[`b8bef8e`](https://github.com/polynaut/dth-character-studio/commit/b8bef8e50751aa458ba61cc18062d8e97acdbd83), [`b8bef8e`](https://github.com/polynaut/dth-character-studio/commit/b8bef8e50751aa458ba61cc18062d8e97acdbd83)]:
  - @dth/ui@0.47.0
  - @dth/rom@0.47.0

## 0.46.2

### Patch Changes

- [#536](https://github.com/polynaut/dth-character-studio/pull/536) [`7e0f89a`](https://github.com/polynaut/dth-character-studio/commit/7e0f89a18867f114a4ec475f5da84e05df6e02ff) Thanks [@polynaut](https://github.com/polynaut)! - Gender is baked at character creation and never changes again: the
  missing-primary relink flow no longer re-derives it (it still re-derives the
  GEN section from the new scene's geograft), and the Gender tooltip/guide say
  "set at creation" instead of suggesting a relink path that doesn't exist for
  a healthy character.
- Updated dependencies []:
  - @dth/rom@0.46.2
  - @dth/ui@0.46.2

## 0.46.1

### Patch Changes

- [#534](https://github.com/polynaut/dth-character-studio/pull/534) [`bb9210c`](https://github.com/polynaut/dth-character-studio/commit/bb9210c7e20d47a99de586593617884ab21992c2) Thanks [@polynaut](https://github.com/polynaut)! - The Unreal project card's buttons swapped places: the install-DTH-content
  button sits inside, the open-in-Unreal button at the very right edge of the
  card — the primary action lands where the card ends.
- Updated dependencies []:
  - @dth/rom@0.46.1
  - @dth/ui@0.46.1

## 0.46.0

### Minor Changes

- [#528](https://github.com/polynaut/dth-character-studio/pull/528) [`fbc31d5`](https://github.com/polynaut/dth-character-studio/commit/fbc31d558100b01a51a259552136c1f529b80ba2) Thanks [@polynaut](https://github.com/polynaut)! - Sections that change the figure's bone count (GEN — the geografts add bones)
  can no longer be overridden per Daz scene: every scene must produce the primary
  scene's skeleton, or the scenes' Daz/Houdini artifacts desync. On a non-primary
  scene the section is now fully read-only (disabled toggle + body) and its title
  wears an amber warning triangle whose tooltip explains why; the primary scene's
  setup applies to every scene. Override data stored before this rule still shows
  the green section mark so it can be reset.

- [#531](https://github.com/polynaut/dth-character-studio/pull/531) [`b442708`](https://github.com/polynaut/dth-character-studio/commit/b4427089e67f55034b6628fa0005fcf009a707c4) Thanks [@polynaut](https://github.com/polynaut)! - The Genitalia ROM section and the character's gender are now driven by what's
  actually in the primary Daz scene, not by hand. When a primary scene is chosen
  (character create, or relinking the primary), the studio reads it once: GEN
  auto-enables exactly when the scene carries a Golden Palace / Dicktator
  geograft (its toggle is permanently disabled — a scene without the graft can't
  run genital frames, and one with it always should), gender derives from the
  figure id (gendered generations, G3 included) or the geograft (the neutral G9:
  DK → male, GP → female), and a both-grafts G9 scene selects the GP+DK preset
  assets explicitly. The manual Gender fields are gone — the create dialog shows
  the derived value read-only, and the Identity row is display-only.

  The per-scene GEN lock from the previous release is relaxed to enable-only:
  GEN's on/off can't be overridden per scene (all scenes share one skeleton),
  but its CONTENT is a normal per-scene override surface again — e.g. a
  different art direction for a specific outfit scene. The create-character
  dialog also gained the Validation table (one character, empty timeline) with a
  "Create anyway" escape, mirroring the add-scene dialog.

### Patch Changes

- [#529](https://github.com/polynaut/dth-character-studio/pull/529) [`fd47e9e`](https://github.com/polynaut/dth-character-studio/commit/fd47e9e62b929323f3a115d1c2ae3f2b1eb76cd9) Thanks [@polynaut](https://github.com/polynaut)! - The morph-name and bone-name autocomplete menus are actually visible now: the
  old popover surface was barely lighter than the page and the menus open right
  on top of same-colored table rows. The listbox now sits on a raised (white-mix)
  surface with a light edge and a deeper shadow, and the active row uses a white
  lift instead of the accent color (which would have been darker than the new
  surface).

- [#526](https://github.com/polynaut/dth-character-studio/pull/526) [`f7dcf7b`](https://github.com/polynaut/dth-character-studio/commit/f7dcf7bda1cafd3389d1b57ab30e7b77b7a7cea9) Thanks [@polynaut](https://github.com/polynaut)! - Avatar auto-sync no longer rewrites the avatar on every editor open/refocus.
  Sync decided "stale" by comparing the scene tip against the stored avatar — but
  the stored avatar is the upscaled master since upscale-on-write, which can never
  byte-equal a 256² tip, so every sync re-copied + re-upscaled + re-saved. Every
  upscaled avatar now stores its pristine source as a `.src` sibling (scene tips
  too, not just uploads) and sync compares against that; legacy avatars without
  one rewrite once more and settle.

- [#525](https://github.com/polynaut/dth-character-studio/pull/525) [`f275ea2`](https://github.com/polynaut/dth-character-studio/commit/f275ea22381ac598ba6586d58995f02aa8d31bdf) Thanks [@polynaut](https://github.com/polynaut)! - The character editor's identity sidebar is a step narrower at the xl breakpoint
  (28rem, was 32rem), so two Daz-scene cards fit side by side instead of wrapping
  on ~1280px-wide windows.

- Updated dependencies [[`965d543`](https://github.com/polynaut/dth-character-studio/commit/965d54307971fced26285579f696b2e65c2ca3c3)]:
  - @dth/ui@0.46.0
  - @dth/rom@0.46.0

## 0.45.7

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.45.7
  - @dth/ui@0.45.7

## 0.45.6

### Patch Changes

- [#518](https://github.com/polynaut/dth-character-studio/pull/518) [`bc55b6a`](https://github.com/polynaut/dth-character-studio/commit/bc55b6a4ed9870edb8875f6f031d9abde23d3bbb) Thanks [@polynaut](https://github.com/polynaut)! - Fix two per-scene override editor bugs:

  - **Preserve lists no longer silently drop an edit.** Editing a preserve morph / node-transform row on an outfit scene so the list ends up with a duplicate entry (e.g. renaming one node to match another) used to read as "same as the primary" — the override disarmed, the typed row snapped back, and the scene generated with the base list. The "differs from the primary" test now compares as a multiset (order still doesn't matter), so a real divergence always arms the override and keeps its reset handle.
  - **Relinking the primary Daz scene onto an already-linked outfit scene no longer duplicates it.** The scene is now dropped from the extras when it becomes the primary, so it can't appear as both a primary and an extra card (which also broke the scene footer's selection animation).

  Also: the docked scene footer's rail buttons leave the tab order while it's hidden (they were focusable off-screen), and the hair panel's per-scene "overridden" mark uses the same multiset comparison.

- [#516](https://github.com/polynaut/dth-character-studio/pull/516) [`6a72e4e`](https://github.com/polynaut/dth-character-studio/commit/6a72e4e6a27fb1edb9a522a66f4df408ecf4b518) Thanks [@polynaut](https://github.com/polynaut)! - Redesign the two docked footers as matching "docks": a raised 3D look (cool-blue
  full-height gradient over the translucent blur, a lit top edge, and a light
  upward shadow) plus a shared layout — a left section label + Add shortcut, a
  horizontally-scrollable card rail, and ‹ › pager arrows that only appear when the
  rail overflows (each disables at its end). The character page's scene footer
  adopts the project page's Unreal-projects-dock layout (its scenes now sit in the
  rail, the selected one ringed green with the PRIMARY badge) and gains the same
  controls: "Add scene" links a scene and each extra card has a hover-✕ to unlink,
  driving the up-page field's own pick/copy/confirm flows.

  The root no longer reserves the scrollbar gutter, so on a page with no scrollbar
  a dock reaches the window edge instead of stopping a scrollbar-width short.

- Updated dependencies [[`bc55b6a`](https://github.com/polynaut/dth-character-studio/commit/bc55b6a4ed9870edb8875f6f031d9abde23d3bbb)]:
  - @dth/rom@0.45.6
  - @dth/ui@0.45.6

## 0.45.5

### Patch Changes

- [#493](https://github.com/polynaut/dth-character-studio/pull/493) [`5436983`](https://github.com/polynaut/dth-character-studio/commit/5436983dbd56d77100f6043d59e8d615c4e9f547) Thanks [@polynaut](https://github.com/polynaut)! - The Unreal projects footer's "Add" button now stretches to the same height as
  the linked project cards beside it (they share an `items-center` row), so it
  reads as a sibling of the cards rather than a shorter afterthought. The `sm`
  button's height floor is preserved for the empty "Link" state where no card
  sets the row height.

- [#487](https://github.com/polynaut/dth-character-studio/pull/487) [`e7dc351`](https://github.com/polynaut/dth-character-studio/commit/e7dc351485b2d5f65494a09386c8de506c50c1ba) Thanks [@polynaut](https://github.com/polynaut)! - Redesign the linked-asset cards with a brand-coloured left accent bar: the
  Daz-scene (green) and Houdini-project (orange) cards get the delete button moved
  down beside the always-present open icon (muted, red only when hovered) and a
  green ring + corner check for the selected Daz scene, with the PRIMARY badge at
  the card's bottom-left. The Unreal-project footer card joins the same visual
  language with a cyan accent bar, and the docked scene-footer pills get the green
  accent bar + a green (was orange) ring on the selected scene.

- [#466](https://github.com/polynaut/dth-character-studio/pull/466) [`6d7f0b2`](https://github.com/polynaut/dth-character-studio/commit/6d7f0b22032ead43c2af3d2121a8a10a3e95e43e) Thanks [@polynaut](https://github.com/polynaut)! - Character header: soften the portrait's rest-state over-scan zoom (1.55 → 1.4) so a
  low-resolution avatar (e.g. a 256px Daz scene `.tip.png`) is magnified less and
  reads sharper. The zoom now holds until the header starts collapsing and the pan
  is nudged up (12% → 16%), so an opaque uploaded avatar still fully covers the 3:4
  frame at the gentler zoom.

- [#469](https://github.com/polynaut/dth-character-studio/pull/469) [`54c4087`](https://github.com/polynaut/dth-character-studio/commit/54c4087e93863249ce02f05dfdec324df787ee80) Thanks [@polynaut](https://github.com/polynaut)! - Avatars now upscale to 768×768 (was 512×512). A 256px Daz scene tip becomes an
  exact xBRZ ×3, and the source comfortably exceeds the header portrait's painted
  size on HiDPI displays. Re-set an avatar or run Tools → Refresh assets to
  re-upscale existing ones to the new size.

- [#466](https://github.com/polynaut/dth-character-studio/pull/466) [`6d7f0b2`](https://github.com/polynaut/dth-character-studio/commit/6d7f0b22032ead43c2af3d2121a8a10a3e95e43e) Thanks [@polynaut](https://github.com/polynaut)! - Avatars: upscale low-resolution avatar images to 512×512 with **xBRZ**, an
  edge-directed magnifier that suits the flat-shaded Daz figures. A 256px Daz scene
  `.tip.png` (or a small cropped upload) is magnified less harshly into the
  character-header portrait now, so it reads sharper. Done in Rust (in place,
  idempotent, best-effort) at avatar-write time, covering both the crop-upload and
  "use this scene's image" paths.

  **Licensing:** `xbrz-rs` is GPL-3.0, so the distributed desktop application
  (`apps/desktop`) is now **GPL-3.0** (see `apps/desktop/LICENSE`). The libraries and
  web app — `@dth/rom`, `@dth/ui`, `@dth/web` — remain MIT and compile into the
  binary unchanged.

- [#477](https://github.com/polynaut/dth-character-studio/pull/477) [`b499e37`](https://github.com/polynaut/dth-character-studio/commit/b499e37dfb4cdaacb1318f336bc94bcf8d723d04) Thanks [@polynaut](https://github.com/polynaut)! - Character page tabs (Character / Products / Notes) now live in the URL (`?tab=`),
  so switching them pushes a history entry — the browser (or mouse) Back button
  returns to the previous tab, and a tab is deep-linkable/refresh-stable. 'Character'
  is the default, encoded as the absence of the param so the base URL stays clean.

- [#480](https://github.com/polynaut/dth-character-studio/pull/480) [`fa62f4d`](https://github.com/polynaut/dth-character-studio/commit/fa62f4d6284b76bfefd3fe7bc09347b8b84e775e) Thanks [@polynaut](https://github.com/polynaut)! - Editor visual refresh:

  - **Darker, cooler theme** — the neutral-gray surfaces move to a deeper cool-slate ramp; the orange / green accents are unchanged.
  - **Restyled toggle switch** — a squarer 4px track (was pill-shaped) with an even knob rim and a white on-knob over the orange on-state.
  - **Avatar backgrounds** use `#4B4D57` (cool slate) instead of the neutral gray behind portraits.

- [#462](https://github.com/polynaut/dth-character-studio/pull/462) [`df85486`](https://github.com/polynaut/dth-character-studio/commit/df85486aa3f029e47f85da1a01000df9418dff51) Thanks [@polynaut](https://github.com/polynaut)! - Character-page header rework:

  - **One main avatar per character**, shown everywhere and editable in any state — selecting a scene no longer swaps the big portrait. It's a square image the header over-scans with a scroll-linked zoom + pan, and it resizes as the header collapses (208×277 → 208×120).
  - **The selected scene rides the title as a green "label" pill** (the linked-scene-card green): a small landscape render of the scene (greyscaled when it's the primary) followed by its name. Clicking it jumps to the scene cards.
  - **Bigger title** that eases smaller as the header collapses; the scene label scroll-shifts with it.

  Also: the "Daz scripts generated" path chip matches the Export directory chip's height; a new `outline-destructive` button (a light-red-bordered destructive style) is used for the export-directory Clear (icon-only ×) and the folder-move Cancel buttons; and the header's vibrancy glass is now macOS-only — Windows (WebView2) uses a plain background instead of a muddy blur.

- [#486](https://github.com/polynaut/dth-character-studio/pull/486) [`912e873`](https://github.com/polynaut/dth-character-studio/commit/912e8734d0b22656727fadc2f4b2cb0444767fed) Thanks [@polynaut](https://github.com/polynaut)! - Character-editor identity block + scene-footer polish:

  - **Genesis-9 dials on one row** — FACS detail / flexion strengths and the UE5 tear-UV switch drop their fieldset border and legend and sit on a single row.
  - **Genesis is creation-only** — it can't change after a character is made, so its selector is removed from the editor. **Gender** moves to its own row at the bottom of the identity block.
  - **"Daz scenes" title** now matches the other section titles (ROM, Advanced options, …).
  - **Override toggle** reads muted grey-green with a white knob when off, so an inactive override is clearly distinct from an armed one.
  - **Scene footer** appears the moment the Daz-scene cards scroll off (keyed to the cards grid) instead of waiting for the whole panel — the "Add scene" button and all — to leave.

- [#468](https://github.com/polynaut/dth-character-studio/pull/468) [`5a22416`](https://github.com/polynaut/dth-character-studio/commit/5a22416c934e8339137c4814ec60a5fbbd90c9c6) Thanks [@polynaut](https://github.com/polynaut)! - Fix: the mini scene-avatar in the character header's scene label lost its zoom-in + lift-up. The lift lived in an arbitrary Tailwind class (`-translate-y-[…]`) placed at the very start of a template-literal `imgClassName` — Tailwind didn't scan that token, so no rule was generated, and twMerge had already stripped the `Portrait` default's lift. Switched to a clean, always-generated fraction utility (`-translate-y-1/2`), so the label's scene thumbnail is framed on the face again like the scene cards.

- [#481](https://github.com/polynaut/dth-character-studio/pull/481) [`a66c82d`](https://github.com/polynaut/dth-character-studio/commit/a66c82d607ca1e297dfcbc93bfef5e95717ea029) Thanks [@polynaut](https://github.com/polynaut)! - Form-field polish: lighter input backgrounds in dark mode (Input, MultiSelect,
  Select and Textarea move from `bg-input/30` to `/50`); the `NumberField` "%" suffix
  now fades together with its number when the field is disabled (a locked
  preserve/identity fieldset); and the "Hair items" label sits tight to its field
  like every other field's label — the override toggle is absolutely positioned so
  its height can't inflate the label row.

- [#490](https://github.com/polynaut/dth-character-studio/pull/490) [`6f472c4`](https://github.com/polynaut/dth-character-studio/commit/6f472c431135778328dca81e3f02ee458db66386) Thanks [@polynaut](https://github.com/polynaut)! - Hair-item picker now colour-codes each scene item by its guessed type — Hair
  (violet), Clothing (sky), or Graft (amber). The dropdown suggestions carry a
  pastel type badge, and each selected pill is filled with its type's pastel
  colour, so it's easy to tell real hair from the outfit items it's mixed in with.
  The type is a best-effort guess from the item's label (the scene file carries no
  authoritative asset type). `MultiSelect` gains generic `optionBadge` and
  `pillClassName` slots for the badge and the per-type pill fill.

- [#501](https://github.com/polynaut/dth-character-studio/pull/501) [`e9c1232`](https://github.com/polynaut/dth-character-studio/commit/e9c1232c020f5d726215e17dacdece5c58287b2c) Thanks [@polynaut](https://github.com/polynaut)! - **Hair items marks as overridden when it differs from the primary scene.** On a non-primary Daz scene the Hair field's Daz-scene glyph now goes green (with the override dot) exactly when that scene's hair list differs from the primary scene's — compared as a set, the same test the other per-scene fields use — instead of whenever the scene simply listed any hair. A deliberately bald outfit scene (empty list against a primary that has hair) now reads as overridden too, and the glyph's reset copies the primary's list back so the two match again.

- [#475](https://github.com/polynaut/dth-character-studio/pull/475) [`fe148c6`](https://github.com/polynaut/dth-character-studio/commit/fe148c610eb3975d4cc6bde994480707b9b093e1) Thanks [@polynaut](https://github.com/polynaut)! - Hair items: re-read the scene's `.duf` when the studio window regains focus, so a
  hair item added or removed in Daz shows up in the suggestions without switching
  scenes. The native reader already reads the file live; the editor previously only
  re-scanned on a scene-path change, so an edit made while sitting on a scene was
  missed.

- [#474](https://github.com/polynaut/dth-character-studio/pull/474) [`5b3ea00`](https://github.com/polynaut/dth-character-studio/commit/5b3ea005b6e3df81d5ee4c1d1417bdf9870a751e) Thanks [@polynaut](https://github.com/polynaut)! - Hair items: a new ✦ button beside the multiselect selects every detected hair
  item in one click (clearing the current pick first). Switching to an outfit
  scene whose `.duf` contains hair its list doesn't cover now auto-arms that
  scene's hair override and warns which item would otherwise ride into the export.

  Also: the remove (bin) buttons in Advanced options and next to the export
  directory now match the height of the fields beside them and drop their hover
  tooltips; and a keyboard reload (Ctrl/Cmd+R, F5) while there are unsaved changes
  now goes through the app's own "Unsaved changes" modal instead of the browser's
  native, unstyleable reload prompt.

- [#485](https://github.com/polynaut/dth-character-studio/pull/485) [`2d6ae80`](https://github.com/polynaut/dth-character-studio/commit/2d6ae803d09cee1440b396ef182430a1c5b154b0) Thanks [@polynaut](https://github.com/polynaut)! - Fix a bogus "not found / unlisted hair" warning that flashed for one frame when switching Daz scenes. The scene's hair scan now resets during render — the instant the selected scene changes — instead of in an effect, so a render never judges the new scene's hair list against the previous scene's wearables.

- [#463](https://github.com/polynaut/dth-character-studio/pull/463) [`e331043`](https://github.com/polynaut/dth-character-studio/commit/e3310434682cbf2e04d2c6588aed5cf8809e17b0) Thanks [@polynaut](https://github.com/polynaut)! - The character header's frosted-glass now matches macOS vibrancy more closely: the backdrop blur is saturated (colours behind it stay vivid) and feathers out at its lower edge instead of ending in a hard blur line.

- [#494](https://github.com/polynaut/dth-character-studio/pull/494) [`dc848e2`](https://github.com/polynaut/dth-character-studio/commit/dc848e226a949263ac2dd724a4dd37908e93a2a5) Thanks [@polynaut](https://github.com/polynaut)! - Houdini project cards now open only from the corner icon. A Houdini project has
  no per-card state to select (unlike a Daz scene), so clicking anywhere else on
  the card is a no-op instead of opening the project — and the inert card no
  longer carries a redundant project-name tooltip.

- [#501](https://github.com/polynaut/dth-character-studio/pull/501) [`e9c1232`](https://github.com/polynaut/dth-character-studio/commit/e9c1232c020f5d726215e17dacdece5c58287b2c) Thanks [@polynaut](https://github.com/polynaut)! - **Editor alignment polish** — three fixes to the character editor's layout:

  - **Info popups never overlap the sticky header.** The "i" popup's floating box (a z-50 portal) could open straight over the header's Discard/Save actions. It now keeps clear of the header's live height — a `placement:"top"` popup with no room above the header flips below instead. Every mounted page header (editor + Settings/Tools) publishes its height as `--sticky-header-h` via a new shared `useStickyHeaderInset` hook, which the popup and the ROM sticky section/column tiers all read.
  - **The "Bone scale" column header centers over its checkboxes** instead of floating off to the left (matching how the "Value" header mirrors its number cells).
  - **The ROM section toggle switch is vertically centered on its summary text.** It was wrapped in a bare `<span>` that blockified as a flex item and rode its text baseline a hair high; the switch is now a direct child of the `items-center` row.

- [#489](https://github.com/polynaut/dth-character-studio/pull/489) [`83a1482`](https://github.com/polynaut/dth-character-studio/commit/83a1482260501ce7c4b27943a9a38c0a8fdcd007) Thanks [@polynaut](https://github.com/polynaut)! - **Inline per-scene overrides** — every overridable panel drops its per-panel "OVERRIDE" toggle. On a non-primary Daz scene an overridable field is now editable inline: it shows the primary scene's value muted (with a "can be overridden per Daz scene" hint), and editing it to a value that differs makes it a per-scene override — a green border + a green dot that swaps to a reset button on hover. Global fields (Gender) stay editable on any scene.

  - **Identity dials** (FACS / flexion strengths, UE5 tear UV) — green-on-edit per dial; hover the dot for a reset to the inherited value.
  - **ROM grid** — the Override checkbox is gone; editing a base row arms it (the row turns green) with a reset button beside remove; the section structure stays locked.
  - **Preserve lists** (Advanced options) — per-item green + reset; rows are matched to the base by their natural key (morph name / node label), so reordering or deleting one never mismarks the others.
  - **Hair** — the toggle is gone and the list is always editable. Hair is per-scene by nature (no "primary" to inherit from), so it keeps no override chrome.

  Generation is untouched: the per-scene gates (`identity.enabled`, ROM `enabled`, `preserve.enabled`) are now derived from "a value differs from the primary," so the `.dsa` + Houdini CSV output is byte-identical.

- [#493](https://github.com/polynaut/dth-character-studio/pull/493) [`5436983`](https://github.com/polynaut/dth-character-studio/commit/5436983dbd56d77100f6043d59e8d615c4e9f547) Thanks [@polynaut](https://github.com/polynaut)! - The Unreal card's install button tooltip (and accessible label) now switches
  from "Install DTH Content" to "Reinstall DTH Content" while Ctrl/Cmd is held —
  matching the force-overwrite the button performs in that state, which is exactly
  when a re-install is what a click does.

- [#512](https://github.com/polynaut/dth-character-studio/pull/512) [`4f1de92`](https://github.com/polynaut/dth-character-studio/commit/4f1de92cfbc9c8658d268df6d6972dda62e45600) Thanks [@polynaut](https://github.com/polynaut)! - feat(web): autocomplete the JCM bone field from the scanned scene

  The bone field in "Modify JCM frames" now suggests the figure's bones as you
  type — matching either the Daz UI label ("Left Thigh Bend") or the internal name
  ("lThighBend"), and inserting the label. Free typing still works for a bone that
  wasn't scanned.

  The bones come from the existing `Scan_Morphs_<Genesis>` run: the scanner
  (`DthScanMorphs`) now also collects every bone into a `bones` array in the same
  per-generation index (`morphs_<G>.json`, index version 2), read alongside the
  morph index. Re-run Scan_Morphs in Daz (or Tools → Refresh assets, then scan) to
  populate the bone list. RUNTIME_VERSION 33 → 34 so the updated scanner reinstalls
  — no generated script changes.

- [#479](https://github.com/polynaut/dth-character-studio/pull/479) [`189da93`](https://github.com/polynaut/dth-character-studio/commit/189da937327962130da2049cbd820b5ba44c694c) Thanks [@polynaut](https://github.com/polynaut)! - The per-scene override toggle is now one integrated control: the switch is folded into the green scene-label pill (at its right edge, with a subtle divider) instead of sitting beside it. A new `Switch` `variant="green"` styles it to match — squared-off corners like the pill tile, an inset shadow, and green/white hues (a green track + white knob when on; a pale track + green knob when off) in place of the default grey/orange. The global default switch is unchanged.

- [#470](https://github.com/polynaut/dth-character-studio/pull/470) [`73f110b`](https://github.com/polynaut/dth-character-studio/commit/73f110be79385cd580a3e31b1e9479ec67bc280f) Thanks [@polynaut](https://github.com/polynaut)! - Per-scene override toggles now show the selected scene as the same green pill —
  mini scene render + name — the header tag uses, instead of a plain "for <scene>"
  text label. The pill is factored into a shared `SceneLabel` used by both the header
  and every override toggle (ROM, Genesis-9 identity, hair, preserve lists), so the
  selected scene reads identically everywhere.

- [#473](https://github.com/polynaut/dth-character-studio/pull/473) [`3dda30c`](https://github.com/polynaut/dth-character-studio/commit/3dda30c2193c0e3723d30e042df9635507363dc5) Thanks [@polynaut](https://github.com/polynaut)! - The Hair export (`Export_Hair_<Name>_<Genesis>.dsa`) now exports **each hair item of the open scene on its own** instead of one combined alembic. Open a character's Daz scene, run the single script, and it walks that scene's hair list and exports each item — hiding every other wearable (including the other hair items) so only that one is captured — as `<Name>_Hair_<item>_grooms.abc`. Houdini gets one alembic per hair asset. `RUNTIME_VERSION` 32 → 33; **Refresh assets** regenerates existing characters.

  (Unchanged and re-verified: per-scene overrides still collapse into the ONE ROM script that selects the open scene's data by filename — even with several overrides set up — while the PoseAsset CSV stays one per ROM-override Daz scene.)

- [#465](https://github.com/polynaut/dth-character-studio/pull/465) [`e3a8b5d`](https://github.com/polynaut/dth-character-studio/commit/e3a8b5d3cd8663ec611562cac236d376894ffb4d) Thanks [@polynaut](https://github.com/polynaut)! - Per-scene form overrides — a character's extra (outfit) Daz scenes can now override more than just the ROM:

  - With a **non-primary scene selected**, the overridable panels — **ROM**, the **Genesis-9 box** (FACS detail / flexion strengths, UE5 tear UV), the **hair list**, and the Advanced-options **preserve lists** (preserve morphs / node transforms) — disable by default, each with its own top-right **Override** toggle. A new scene starts fully disabled; you opt each panel in. Genesis/Gender, Houdini projects and the export directory are never per-scene (the export already nests per scene).
  - Arming a panel edits **that scene's** values, starting as a copy of the base you can tweak — or, for the lists, add to and delete from. The ROM section locks read-only on a non-primary scene until you arm it (check **Override** on a row to replace it, or add frames at a group's end).
  - **Hair simplified**: the "Hair items live in the Daz scenes" toggle is gone — hair is per scene by presence now (a scene's listed items ARE its hair; none listed, none excluded). For a hair-only variant, link it as its own scene or use Attachments.

  Under the hood the per-scene artifacts collapse into the **one** character Daz script: it embeds every linked scene's overrides and picks the open scene's values at run time (the same trick the hair map already used), instead of a separate `ROM_…_<Scene>.dsa` per scene. A ROM-override scene still gets its own PoseAsset CSV (Houdini can't select frames), delivered by the same scene lookup. **Refresh assets** regenerates existing characters onto the one script and sweeps the old per-scene scripts.

- [#509](https://github.com/polynaut/dth-character-studio/pull/509) [`fa4bb58`](https://github.com/polynaut/dth-character-studio/commit/fa4bb582009ca6d8d6ba13cc0bce3abedbe10433) Thanks [@polynaut](https://github.com/polynaut)! - feat(web): enable/disable a ROM section per Daz scene, + scene-override editor polish

  Dropping a section for one outfit used to mean clearing its whole row list. The
  section on/off toggle is now live on a non-primary scene: flipping it stores a
  `sceneOverride.sectionEnabled` entry (only when it differs from the primary), and the
  section reads as overridden like every other field — green title handle, and its reset
  restores the primary's on/off state. `applySceneOverride` flips the base section's
  `enabled` per entry (mode/groups untouched), so the section drops from the scene's
  frames + CSV while the base is unchanged; works for preset sections too, no custom row
  list needed. Schema 21 → 22 (additive, no migration).

  Same-pass editor consistency:

  - Preserve-morph / node-transform rows mute to gray when inherited on a non-primary
    scene and go white + green when overridden; deleting a row surfaces the override on
    the list label (no row left to mark).
  - The Hair-items field gets the green override border when its list differs from the
    primary scene.
  - The overridden section toggle wears the green switch variant, and its tooltip is the
    standard "can be overridden per Daz scene" hint; the primary-scene toggle drops its
    redundant tooltip.
  - Renamed the ROM timeline label to "Animation timeline".

- [#499](https://github.com/polynaut/dth-character-studio/pull/499) [`1e36cdf`](https://github.com/polynaut/dth-character-studio/commit/1e36cdf7ed5a20a3043717f1f5e139b173f209e0) Thanks [@polynaut](https://github.com/polynaut)! - fix(web): preserve overrides use one control per list, in the label

  The Advanced-options preserve morphs / node transforms showed an override cube in
  front of every row. The override is per-list (the `preserve.enabled` gate is derived
  from "the list differs"), so move it to one control in each list's label — like the
  other fields. The whole list counts as overridden the moment any row's value changes
  or a row is added/removed; reset reverts the list to the primary, and a green border
  still marks the individual rows that differ.

- [#478](https://github.com/polynaut/dth-character-studio/pull/478) [`5abdb9a`](https://github.com/polynaut/dth-character-studio/commit/5abdb9aa24bcbaecc6533ff4b39b0a83ad8a12d6) Thanks [@polynaut](https://github.com/polynaut)! - The "Preserve morphs after ROM loading" name field now autocompletes from the
  scanned morph index — the same suggestions (internal name + Daz UI name, with the
  node, matched against either) the ROM editor's Morph-name column already offers.
  A shared `MorphIndexProvider` now feeds both places one pre-lowercased index.

- [#467](https://github.com/polynaut/dth-character-studio/pull/467) [`f72adcb`](https://github.com/polynaut/dth-character-studio/commit/f72adcb29923a6154c9995b16c2977a5c31620f6) Thanks [@polynaut](https://github.com/polynaut)! - **Refresh assets** now upscales existing low-resolution avatars. A character saved
  before the xBRZ upscale-on-write feature keeps its 256px avatar until it's re-set;
  Tools → Refresh assets now xBRZ-upscales every stored avatar still under 512² to
  512² in place, so one click upgrades the whole library. Idempotent (avatars already
  ≥512² are untouched) and best-effort (a failed upscale never aborts the refresh).

- [#476](https://github.com/polynaut/dth-character-studio/pull/476) [`e6b2ca0`](https://github.com/polynaut/dth-character-studio/commit/e6b2ca0df7fc52ff17105c30508c244abe1abe3e) Thanks [@polynaut](https://github.com/polynaut)! - ROM editor on a non-primary (outfit) scene: the per-frame **Override** column now
  stays visible but disabled while that scene's ROM override is off — instead of
  disappearing — so it's clear the control is there and just needs arming. The eight
  section titles are also muted on any override scene: the section structure
  (enable / mode / groups) is locked whether the override is armed or not, so the
  titles now read as disabled to match their already-locked toggles.

- [#510](https://github.com/polynaut/dth-character-studio/pull/510) [`d6273f8`](https://github.com/polynaut/dth-character-studio/commit/d6273f8be174705291eb9a2ba4f9b304b424417e) Thanks [@polynaut](https://github.com/polynaut)! - feat: override anything in the ROM per Daz scene

  A non-primary ("outfit") Daz scene can now override the WHOLE ROM, not just custom rows
  and enable/disable — mode, preset asset, GEN art direction, custom JCM path, and the
  "Modify JCM frames" grid are all per-scene now. Editing any of them on a non-primary
  scene makes the scene own that section's config; the field greens, the section title
  carries the reset handle, and its reset restores the primary. The Add group / Import
  buttons are live per-scene too, so an outfit can build up its own section.

  Generation embeds each scene's FULL config delta into the one character script (the diff
  of the scene's config vs the base), so the script still looks its dataset up by the open
  Daz scene name at runtime and falls back to the primary. This also fixes a real desync in
  the previous per-scene enable/disable: dropping a _preset_ section for a scene now emits
  `bIncludeGP/DK/Physics:false`, so Daz and Houdini agree on the frames (before, Daz still
  built the block the CSV dropped). Character schema 22 → 23 (migrated on read); the
  migration now heals a preset-only section (RET) so a legacy override can't hard-fail load.
  A section disabled-then-customized for a scene (or the mirror) now re-toggles correctly —
  `enabled` no longer had two sources of truth that could disagree.

  Editor polish in the same pass: overridden field labels + ROM section titles read
  Daz-green; the grid reset/bin buttons get a visible hover silhouette (bin reddens on
  hover, reset centers); preserve rows mute when inherited and drop their placeholders; the
  Hair field gets the green override border; and the ROM timeline label is now "Animation
  timeline". The docked scene-footer pills now show each scene's original `.duf` filename
  stem (matching the Daz-scene cards) instead of a name-stripped, spaced label.

- [#492](https://github.com/polynaut/dth-character-studio/pull/492) [`dc4273d`](https://github.com/polynaut/dth-character-studio/commit/dc4273d5c1a102c3817e5aa0f727cf53ffd64a3c) Thanks [@polynaut](https://github.com/polynaut)! - ROM timeline bar now uses soft pastel (`-300`) block colors instead of the
  saturated `-600`/`-700` fills, which read as too vibrant against the dark UI.
  Block labels flip to dark text so they stay legible on the lighter blocks, and
  the segment dividers ease from `black/20` to `black/10`. Section hues are
  unchanged in family (RET slate, JCM indigo, …), so each block keeps its identity.

- [#511](https://github.com/polynaut/dth-character-studio/pull/511) [`a60d7a8`](https://github.com/polynaut/dth-character-studio/commit/a60d7a843b8d0e9c8dbae78180850b6ca25379ef) Thanks [@polynaut](https://github.com/polynaut)! - feat(web): show the picked scene's full path + a Cancel button in the copy dialog

  The "copy this Daz scene in?" dialog (both the create flow and the editor's
  Add-scene flow) now shows the selected file's full path as a copyable chip under a
  "Selected file" label, so you can confirm which `.duf` you picked before copying.
  The footer also gains a ghost **Cancel** button (left-aligned) to dismiss the
  dialog alongside Link-in-place / Copy.

- [#496](https://github.com/polynaut/dth-character-studio/pull/496) [`7750634`](https://github.com/polynaut/dth-character-studio/commit/7750634e6bc6a46c83e2fc797625dbae5a19cae1) Thanks [@polynaut](https://github.com/polynaut)! - Animate the scene-footer rail on selection. Picking a pill now swaps it into the
  prominent slot with a quick View Transitions morph — each pill slides from its
  old slot to its new one instead of snapping — while the rest shift to fill in.
  Falls back to a plain select where the API is unavailable or the user prefers
  reduced motion.

- [#500](https://github.com/polynaut/dth-character-studio/pull/500) [`aaac0f5`](https://github.com/polynaut/dth-character-studio/commit/aaac0f51eb4ea4209ac205da1303220d0e0461ac) Thanks [@polynaut](https://github.com/polynaut)! - fix(web): the selected Daz scene's ring in the footer hugs the pill

  The ring wrapper used `rounded-lg` while the pill inside (`Tag`) uses `rounded`, so
  the green selection ring bulged past the pill's corners. Match the wrapper's radius to
  the pill's so the ring follows its silhouette.

- [#484](https://github.com/polynaut/dth-character-studio/pull/484) [`3290a71`](https://github.com/polynaut/dth-character-studio/commit/3290a7135ec0874df37927810cadcc94ef1d5bd0) Thanks [@polynaut](https://github.com/polynaut)! - **Selected-scene footer** — a docked status bar (like the project page's Unreal-projects bar) that keeps the Daz scene you're editing on screen once its cards scroll off. The selected scene sits prominent and ringed on the left; after a divider the other linked scenes follow in a horizontally-scrollable rail (edge-fading when there are many), so you can switch scene mid-scroll. Always shown while scrolled, even for a single-scene character.

  Replaces the old sticky "OVERRIDE · scene" bar that pinned under the header (the panel override toggles already read fine on their own).

- [#508](https://github.com/polynaut/dth-character-studio/pull/508) [`f45beb5`](https://github.com/polynaut/dth-character-studio/commit/f45beb5627cd5df586927c549384cba768200d24) Thanks [@polynaut](https://github.com/polynaut)! - feat(web): scene-override editor UI polish

  Clearer per-scene override state in the character editor, and no layout shift
  when switching to a non-primary scene:

  - ROM section titles carry the override mark at the END of the title, and it goes
    green whenever the section diverges from the primary in ANY way — a per-row
    value edit, an added frame, or a whole-section escalation. Its reset clears
    every override kind at once.
  - An overridden section brightens its whole title row to white; overridable field
    labels dim to gray until overridden, then go white too.
  - Added frames now show the same reset handle + bin as edited base rows, plus a
    green "\*" new-row marker. The reset button's footprint and the name marker slot
    are reserved on every row, so scene switches (and a row becoming overridden)
    never shift the grid in X.
  - The sticky page header now sits above inline info popups (still below dialogs),
    so a popup reaching into the header is covered instead of floating over it.
  - The Unreal projects footer keeps a constant height whether empty or filled, and
    its add trigger is an icon-only "+". The footer scene ring sits flush (0 offset).

- [#505](https://github.com/polynaut/dth-character-studio/pull/505) [`8a3658a`](https://github.com/polynaut/dth-character-studio/commit/8a3658acd78d50d5459260c493b7b061da3eaefe) Thanks [@polynaut](https://github.com/polynaut)! - Per-scene ROM: reorder, insert and delete frames on a non-primary Daz scene. Drag handles and the insert "+" are no longer hidden there — the first structural edit (reorder / insert-between / delete a base frame / add a group) escalates the whole ROM section to a scene override. That section's title then shows a green overridden marker whose reset restores the section to the primary scene's ROM. Pure value edits keep the sparse per-row behaviour (green rows, per-row reset), and editing a value back to the base (e.g. a bone-scale flag toggled on then off) now un-arms the row instead of leaving it stuck green. An overridden row's bone-scale checkbox reads green to match the row.

- Updated dependencies [[`fa62f4d`](https://github.com/polynaut/dth-character-studio/commit/fa62f4d6284b76bfefd3fe7bc09347b8b84e775e), [`235cd39`](https://github.com/polynaut/dth-character-studio/commit/235cd395ce0d1e48fa6dd59be6a865c3bc735bba), [`912e873`](https://github.com/polynaut/dth-character-studio/commit/912e8734d0b22656727fadc2f4b2cb0444767fed), [`6f472c4`](https://github.com/polynaut/dth-character-studio/commit/6f472c431135778328dca81e3f02ee458db66386), [`dc848e2`](https://github.com/polynaut/dth-character-studio/commit/dc848e226a949263ac2dd724a4dd37908e93a2a5), [`e9c1232`](https://github.com/polynaut/dth-character-studio/commit/e9c1232c020f5d726215e17dacdece5c58287b2c), [`83a1482`](https://github.com/polynaut/dth-character-studio/commit/83a1482260501ce7c4b27943a9a38c0a8fdcd007), [`4f1de92`](https://github.com/polynaut/dth-character-studio/commit/4f1de92cfbc9c8658d268df6d6972dda62e45600), [`83a1482`](https://github.com/polynaut/dth-character-studio/commit/83a1482260501ce7c4b27943a9a38c0a8fdcd007), [`189da93`](https://github.com/polynaut/dth-character-studio/commit/189da937327962130da2049cbd820b5ba44c694c), [`3dda30c`](https://github.com/polynaut/dth-character-studio/commit/3dda30c2193c0e3723d30e042df9635507363dc5), [`e3a8b5d`](https://github.com/polynaut/dth-character-studio/commit/e3a8b5d3cd8663ec611562cac236d376894ffb4d), [`4a4e4a4`](https://github.com/polynaut/dth-character-studio/commit/4a4e4a424603769ff2550196283c5ff924461c0e), [`d6273f8`](https://github.com/polynaut/dth-character-studio/commit/d6273f8be174705291eb9a2ba4f9b304b424417e), [`a60d7a8`](https://github.com/polynaut/dth-character-studio/commit/a60d7a843b8d0e9c8dbae78180850b6ca25379ef)]:
  - @dth/ui@0.45.5
  - @dth/rom@0.45.5

## 0.45.4

### Patch Changes

- [#454](https://github.com/polynaut/dth-character-studio/pull/454) [`bb7711b`](https://github.com/polynaut/dth-character-studio/commit/bb7711b55757531da3c38a38bb0283e4e0744545) Thanks [@polynaut](https://github.com/polynaut)! - Softer drop shadow on the character header's avatar corner badge (0.7 → 0.35 alpha) so it reads less heavy. Guide screenshots regenerated to match.

- Updated dependencies []:
  - @dth/rom@0.45.4
  - @dth/ui@0.45.4

## 0.45.3

### Patch Changes

- [#450](https://github.com/polynaut/dth-character-studio/pull/450) [`4c8f0ec`](https://github.com/polynaut/dth-character-studio/commit/4c8f0ec52cd46ad2049d21158a3e50aa7ab3b0cf) Thanks [@polynaut](https://github.com/polynaut)! - Custom avatar images are now always square. When you upload an image (drop or pick), it's checked for size — at least 256×256 and at most 2048×2048, any aspect ratio — and then opened in a small crop editor where you drag to reposition and scroll or use the slider to zoom. Only the cropped 1:1 result is stored (at most 512×512), so every avatar preview looks consistent and the project metadata stays small. Images that are too small or too large are rejected with a clear message instead of being stored at odd sizes. Your recent uploads are now kept and shown in the image dialog, so switching to a Daz scene avatar (or a different upload) no longer discards the last one — click any recent image to switch back.

- [#448](https://github.com/polynaut/dth-character-studio/pull/448) [`2ff2410`](https://github.com/polynaut/dth-character-studio/commit/2ff241092640c7fe258962fb686870c758db9de5) Thanks [@polynaut](https://github.com/polynaut)! - The Daz Studio / Houdini brand badges on the scene and Houdini-project cards are tucked flush into the bottom-left corner (`bottom-0 left-0`), sized down slightly (`size-6`), and carry a stronger 60%-opacity drop shadow so they read clearly over any avatar.

- [#447](https://github.com/polynaut/dth-character-studio/pull/447) [`cc385cc`](https://github.com/polynaut/dth-character-studio/commit/cc385ccae7afb1c7dab0c7675005bbeaad8e2236) Thanks [@polynaut](https://github.com/polynaut)! - The sticky headers on the character page and the Settings / Tools pages now have a liquid-glass background — a translucent fill with a heavy backdrop blur, so content scrolling beneath frosts through them, echoing the native macOS title bar above. Falls back to the opaque background where `backdrop-filter` isn't supported.

- [#446](https://github.com/polynaut/dth-character-studio/pull/446) [`29ed1bb`](https://github.com/polynaut/dth-character-studio/commit/29ed1bb63f9fa187d979da3b869b33e9959930a9) Thanks [@polynaut](https://github.com/polynaut)! - The character overview's **list view** now shows each avatar in a landscape crop (the same 13:9 ratio the character page's sticky header settles into), instead of the portrait crop used by the grid. Dates across the app (overview list, scan picker) are also formatted for the OS UI language — e.g. `DD.MM.YYYY` under a German system, `MM/DD/YYYY` under English — rather than a fixed default.

- [#440](https://github.com/polynaut/dth-character-studio/pull/440) [`1d8beae`](https://github.com/polynaut/dth-character-studio/commit/1d8beae3f906d914a3eb8e1225f651cab6e610d1) Thanks [@polynaut](https://github.com/polynaut)! - The character header portrait now previews the selected Daz scene: selecting a non-primary scene swaps the avatar to that scene's `.tip.png` while it stays selected — the stored avatar itself is untouched. The home screen title also gets the studio's logo mark, and the main nav gains a "Docs" link straight to the online guide.

- Updated dependencies [[`0792e99`](https://github.com/polynaut/dth-character-studio/commit/0792e99d8a47b099bcdf976359db08eefe1f44ce), [`38a7687`](https://github.com/polynaut/dth-character-studio/commit/38a76877937c074f5ab6e5aadaaf4668845105b3), [`364625a`](https://github.com/polynaut/dth-character-studio/commit/364625a9a4cdc4836120cd9499a457f8dba3ec0f), [`9515a2a`](https://github.com/polynaut/dth-character-studio/commit/9515a2acca31ee1ec6ce1afe495fe9f1c2b89cab), [`1c53147`](https://github.com/polynaut/dth-character-studio/commit/1c531470f82d5f4e2f7faad4f52d93af1dfe44b5)]:
  - @dth/rom@0.45.3
  - @dth/ui@0.45.3

## 0.45.2

### Patch Changes

- [#428](https://github.com/polynaut/dth-character-studio/pull/428) [`56c2463`](https://github.com/polynaut/dth-character-studio/commit/56c2463e1a49129c510642c754bef3bad3e3ac5e) Thanks [@polynaut](https://github.com/polynaut)! - Accepting/clearing dedup conflicts no longer clobbers a settings change made in another window. The write now goes through the same field-level merge as a normal settings save, so it only updates the accepted-conflicts list and re-reads every other field from disk.

- [#431](https://github.com/polynaut/dth-character-studio/pull/431) [`08b15da`](https://github.com/polynaut/dth-character-studio/commit/08b15da8463a478ba9640befd53dd04506d03c3c) Thanks [@polynaut](https://github.com/polynaut)! - Saving a character is faster on projects with many characters (and much faster over a "Refresh assets" sweep or on a network-share project). Generating a character's files now resolves where it lives on disk once and reuses that, instead of re-scanning the whole character library three times per save.

- [#430](https://github.com/polynaut/dth-character-studio/pull/430) [`d8bec0c`](https://github.com/polynaut/dth-character-studio/commit/d8bec0cb848f4886f7b891e0d795aad8ff2dabea) Thanks [@polynaut](https://github.com/polynaut)! - Fix the "Modify JCM frames" grid swapping the row you're editing when you Mirror or remove a rule/drive above it. Each rule and drive now carries a stable id used as its React key (instead of the list position), so a mid-list insert no longer re-binds a focused input to a different row. The ids are editor-only — they never reach the generated Daz/Houdini output.

- [#432](https://github.com/polynaut/dth-character-studio/pull/432) [`0504f43`](https://github.com/polynaut/dth-character-studio/commit/0504f439ccfece4f808dcb794c72647bc405b86b) Thanks [@polynaut](https://github.com/polynaut)! - The "Modify JCM frames" and art-direction section toggles are now keyboard-operable — they were click-only, so keyboard and screen-reader users couldn't expand them. They're real buttons now, focusable and Enter/Space-operable, and announce their open/closed state.

- [#418](https://github.com/polynaut/dth-character-studio/pull/418) [`fc440c9`](https://github.com/polynaut/dth-character-studio/commit/fc440c9fd2e4c2fe00e7039dbf7a71c3f4b08306) Thanks [@polynaut](https://github.com/polynaut)! - Notes editor: serialize autosaves so a debounced save and an immediate blur save can no longer run at once. Previously the two could fire concurrently with the same stale expected-mtime, making the second spuriously report "Notes changed on disk" (whose Reload discarded the newest keystrokes). Saves now single-flight — the latest value is queued and flushed once the in-flight save finishes with the updated mtime — and a no-op save (nothing changed) is skipped so it can't churn the file against another open window.

- [#425](https://github.com/polynaut/dth-character-studio/pull/425) [`a479e6d`](https://github.com/polynaut/dth-character-studio/commit/a479e6d635d8593df33621224bac472b14f806e7) Thanks [@polynaut](https://github.com/polynaut)! - Settings: reconcile the open form when another window saves settings. Previously the form kept its once-loaded state, so after a background refresh the Save/Discard buttons lit up though nothing was touched — and saving would write the stale value back over the other window's change. Fields you've actually edited are kept; untouched fields quietly adopt the newer value.

- Updated dependencies [[`d575b9d`](https://github.com/polynaut/dth-character-studio/commit/d575b9dd39a5a665c36736fc2b19e090f2e00ab8), [`d8bec0c`](https://github.com/polynaut/dth-character-studio/commit/d8bec0cb848f4886f7b891e0d795aad8ff2dabea)]:
  - @dth/rom@0.45.2
  - @dth/ui@0.45.2

## 0.45.1

### Patch Changes

- [#420](https://github.com/polynaut/dth-character-studio/pull/420) [`63866f3`](https://github.com/polynaut/dth-character-studio/commit/63866f34c92de9776fe28b8f84e00cc47475dd47) Thanks [@polynaut](https://github.com/polynaut)! - Long-running jobs now show the OS "working" cursor (pointer + spinning ring) everywhere in the window while they run — installing a DTH release, the Exporter Plugin or Daz assets, library scans, deduplication, uninstall sweeps, Refresh assets, and character-folder moves. Overlapping jobs keep the cursor until the last one finishes.

- Updated dependencies []:
  - @dth/rom@0.45.1
  - @dth/ui@0.45.1

## 0.45.0

### Minor Changes

- [#405](https://github.com/polynaut/dth-character-studio/pull/405) [`db85bf8`](https://github.com/polynaut/dth-character-studio/commit/db85bf88d6f41f615859dea904b5562f3861aff4) Thanks [@polynaut](https://github.com/polynaut)! - Per-Daz-scene ROM overrides: drive different morphs for another scene (a second outfit) of the same character. Select one of the character's extra Daz scenes and flip the new **Override** toggle atop the ROM grid — the base setup locks, every existing row shows slightly transparent, and a leading **Override** checkbox per row swaps just that frame's content for the scene (uncheck to fall back to the base row). New frames can be appended at the end of a group — always as part of the override, never between existing frames — so the base frame layout stays fixed. On Save each overridden scene generates its own artifacts next to the default ones (`ROM_<Name>_<Genesis>_<Scene>.dsa` + `<Name>_<Scene>_pose_asset.csv`, plus a scene `Export_` variant when the export is split); disabling an override or unlinking its scene retires those files while keeping the stored override rows for later. Overrides live in the character JSON per scene path (schema v17), travel with folder renames/moves, and are validated on save like the base ROM — a blocked save jumps straight to the offending row. With more than one scene linked, the header now tags the selected scene next to the character name (visible in the collapsed sticky header too), so the active scene context is always in view.

### Patch Changes

- Updated dependencies [[`db85bf8`](https://github.com/polynaut/dth-character-studio/commit/db85bf88d6f41f615859dea904b5562f3861aff4)]:
  - @dth/rom@0.45.0
  - @dth/ui@0.45.0

## 0.44.11

### Patch Changes

- [#403](https://github.com/polynaut/dth-character-studio/pull/403) [`72e193f`](https://github.com/polynaut/dth-character-studio/commit/72e193f138b6731ba0365f4c724753653e36ca5a) Thanks [@polynaut](https://github.com/polynaut)! - Bone scale no longer requires an export directory. With none set, the studio just generates the ROM and a ticked Bone scale is a harmless no-op; set an export directory and it drives the DTH Exporter's per-frame reference-skeleton FBX and auto-fills the PoseAsset CSV path as before. The amber "set an export directory" warning is gone, and the guide is updated (bone scale, the character-settings chapter, and the combined-morphs / GEN art-direction screenshots).

- Updated dependencies []:
  - @dth/rom@0.44.11
  - @dth/ui@0.44.11

## 0.44.10

### Patch Changes

- [#398](https://github.com/polynaut/dth-character-studio/pull/398) [`5e34593`](https://github.com/polynaut/dth-character-studio/commit/5e3459366bb319a96a2ba2c89dc3f430d9ac655d) Thanks [@polynaut](https://github.com/polynaut)! - Bone scale no longer requires an export directory. It only drives the DTH Exporter when an export directory is set (the studio then writes each frame's reference-skeleton FBX and fills its PoseAsset CSV path); with no export directory the studio generates the ROM only, so a ticked Bone scale is simply a no-op you can handle yourself — the amber "set an export directory" warning is gone, and the docs are updated.

  Also guide-screenshot polish (docs only): dropped the redundant Setup-DTH-Exporter overview shot; automated the GEN art-direction, combined-morphs and (compact, one row ticked) bone-scale screenshots; the ROM-definition shot now shows GEN enabled + the Golden Palace timeline block; and the expanded-row value reference (Node/Property/Value/Base/Auto) moved out of a collapsed details block into the always-visible page content.

- Updated dependencies []:
  - @dth/rom@0.44.10
  - @dth/ui@0.44.10

## 0.44.9

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.44.9
  - @dth/ui@0.44.9

## 0.44.8

### Patch Changes

- [#389](https://github.com/polynaut/dth-character-studio/pull/389) [`314ec06`](https://github.com/polynaut/dth-character-studio/commit/314ec06e7095b8d26f62370ce4393cee23916b53) Thanks [@polynaut](https://github.com/polynaut)! - Modify JCM frames: dropped the redundant per-drive positive/negative selector — a drive's direction is now read from its angle range's sign (e.g. `Angle to` −115 = the negative bend), so a rule holds one signed drive list. Existing characters migrate automatically (the two lists merge) and the generated Daz script is byte-for-byte unchanged.

- Updated dependencies []:
  - @dth/rom@0.44.8
  - @dth/ui@0.44.8

## 0.44.7

### Patch Changes

- [#386](https://github.com/polynaut/dth-character-studio/pull/386) [`72fb0d1`](https://github.com/polynaut/dth-character-studio/commit/72fb0d1195204fdfcaa9b1976ca458c90095cdf4) Thanks [@polynaut](https://github.com/polynaut)! - Advanced options and Modify JCM frames now show and edit morph values as Daz-style percentages (e.g. `100%`, `33%`) instead of raw `0–1` numbers, matching the ROM pose value cells. Values are still stored 0–1, so generation is unchanged.

- Updated dependencies []:
  - @dth/rom@0.44.7
  - @dth/ui@0.44.7

## 0.44.6

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.44.6
  - @dth/ui@0.44.6

## 0.44.5

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.44.5
  - @dth/ui@0.44.5

## 0.44.4

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.44.4
  - @dth/ui@0.44.4

## 0.44.3

### Patch Changes

- [#362](https://github.com/polynaut/dth-character-studio/pull/362) [`fddd2f8`](https://github.com/polynaut/dth-character-studio/commit/fddd2f8637fb24e51272a1422eb5323a613d7103) Thanks [@polynaut](https://github.com/polynaut)! - The "unsaved changes — leave and lose them?" prompt and the "move character folders?" confirm now render in the app's own themed modal (focus trap, Escape/backdrop = cancel, "Leave"/"Move folders" buttons) instead of a native OS dialog. A single `ConfirmProvider` hosts an app-styled, promise-based confirm at the root, so both the route-navigation guard and the Tauri window-close (✕) path go through it; the native `confirmDialog` helper is gone. The browser-reload `beforeunload` prompt stays native — it can't be styled and only affects the web build.

- [#354](https://github.com/polynaut/dth-character-studio/pull/354) [`98de896`](https://github.com/polynaut/dth-character-studio/commit/98de896b234423b327dbe1db868d8edd76fadd25) Thanks [@polynaut](https://github.com/polynaut)! - Keyboard and screen-reader accessibility sweep: a new `Modal` primitive (Radix Dialog — real focus trap, initial focus, focus restore, Escape/backdrop dismissal, proper dialog semantics) now backs every previously hand-rolled overlay (remove-asset, bulk-delete, scene-copy, avatar image, scene-copy prompt and the "Daz already open" notice — the avatar dialog gains Escape support it never had). The side panel manages focus properly instead of declaring `aria-modal` without containment. ROM section headers are real accordion buttons (focusable, Enter/Space, `aria-expanded`) instead of click-only divs. `Field` labels are programmatically associated with their controls and errors (`htmlFor`/`aria-describedby`). The linked-asset card's corner-open control works from the keyboard, `NumberField` commits on Enter, the editable page title keeps its heading semantics for assistive tech, the Home screen's "remove from recents" button becomes visible on keyboard focus, and the UI-config provider no longer re-renders all consumers on every host render.

- [#360](https://github.com/polynaut/dth-character-studio/pull/360) [`847e9dd`](https://github.com/polynaut/dth-character-studio/commit/847e9ddfef123a0c42573b5808301893f2b4530e) Thanks [@polynaut](https://github.com/polynaut)! - Groom (hair) exclusion is hide-only now (runtime v31). DTH Exporter Plugin 2.0.1 moved the unfit+unparent step into the plugin — it unparents any hidden child node before exporting and reparents it after — so the generated script only has to HIDE the groom items and the plugin excludes them from both the FBX and the alembic. The script's own detach path (unfit+unparent+refit) and the app-global "Solve hair assets by hiding" setting are gone; hiding is the single mechanism. Refresh assets regenerates existing characters onto the simpler export block. Because hide-only now needs Exporter Plugin 2.0.1+ (an older one would export the hidden hair into the FBX), the character editor's groom section reads the installed plugin's DLL version and warns clearly when it's too old.

- [#361](https://github.com/polynaut/dth-character-studio/pull/361) [`0e33b5e`](https://github.com/polynaut/dth-character-studio/commit/0e33b5e84ad54af0b51398be6926aa5a9ae0cb5f) Thanks [@polynaut](https://github.com/polynaut)! - Consistent naming: in the Daz side it's "hair", not "groom" (it only becomes a "groom" downstream in Houdini/Unreal). The standalone hair-export script is now `Export_Hair_<Name>_<Genesis>.dsa` (was `Export_Groom_…`), and every user-facing Daz string — the generated script's log/dialog lines, the character editor's hair section, and the guide — reads "hair". The Houdini-bound artifacts keep their downstream term: the exported `_grooms.abc` and Houdini's DazToHueGroom Import are unchanged. Regenerating a character sweeps the old `Export_Groom_…` script from its folder. The guide's hair section also drops the stale unfit/refit + "Solve hair assets by hiding" wording (hiding has been the single mechanism since the Exporter Plugin 2.0.1 change).

- [#356](https://github.com/polynaut/dth-character-studio/pull/356) [`0b2c8dd`](https://github.com/polynaut/dth-character-studio/commit/0b2c8dd8739f2e6531d6c1dc9dac74a603337cb3) Thanks [@polynaut](https://github.com/polynaut)! - Opportunistic cleanups: the Deduplicate tool's shared-file groups gain the "Accept" button its help text always promised — marking a group as legitimately shared now actually persists (it stopped appearing on the next scan) instead of being a dead code path. The Settings route's release/exporter pickers and the network-drives section move into `components/settings/`, and the UI kit's public surface drops exports nothing consumes (the unused `Slider` primitive, plus internal-only helpers). Inside the generation core, the thrice-copied groom "hide-tree" DzScript snippet is extracted into one name-parameterised builder (byte-identical output, pinned by the existing tests). Two more Playwright smoke flows cover the character editor's inline rename end-to-end.

- [#350](https://github.com/polynaut/dth-character-studio/pull/350) [`0348765`](https://github.com/polynaut/dth-character-studio/commit/0348765bd88b4c64f5708a3f70a8f83e67140dc7) Thanks [@polynaut](https://github.com/polynaut)! - The network-drive remap result (`ensure_network_drives`) now goes through the FFI contract regime like every other structured return: zod-parsed at the invoke boundary (no more bare `invoke<T>()` cast) and pinned by a shared `contracts/remap-results.json` fixture tested on both the serde and zod side. The phantom `'unsupported'` status that no Rust path ever produced is gone from both sides. Remap failures for Explorer "reconnect at sign-in" mappings (Windows errors 1201/1202) now get actionable messages instead of a bare error number, and very long UNC paths no longer misreport as "unmapped".

- [#351](https://github.com/polynaut/dth-character-studio/pull/351) [`b243f48`](https://github.com/polynaut/dth-character-studio/commit/b243f48bcb978e381daa0ba777fd0235cb0ec23d) Thanks [@polynaut](https://github.com/polynaut)! - ROM-core hardening from the 2026-07-18 review: generated Daz scripts escape U+2028/U+2029 in every embedded string (a shared definition carrying one no longer breaks the whole script — Daz's engine treats them as line terminators); the exporter and the PoseAsset CSV now share one sanitized figure name, so a comma in a character name can't make the CSV point at a reference FBX the exporter never writes; the PHY preset block's start frame derives from the single frame-math source (`presetEndFrame`) instead of a private sum; a custom PHY section flags its CSV as experimental until the physics payload is modeled; art-direction frame offsets must be whole and non-negative; sections in unsupported modes (e.g. a crafted RET-custom) are rejected at parse instead of silently shifting every custom frame, while files missing section keys now heal to defaults; duplicate pose names within one suffix scope are flagged before they collide into the same Unreal morph; the Daz morph-CSV import handles BOMs and quoted fields (RFC-4180) instead of naive comma-splitting; `mirrorGroup` no longer corrupts non-sided names like CleftChin; and a corrupt (non-object) character JSON fails validation cleanly instead of throwing.

- [#352](https://github.com/polynaut/dth-character-studio/pull/352) [`afb2f96`](https://github.com/polynaut/dth-character-studio/commit/afb2f968429896def140b5b89432d4839b039631) Thanks [@polynaut](https://github.com/polynaut)! - Multi-window write safety for the machine settings: saving settings now merges by baseline — only the fields you actually changed on that page win, everything else is re-read fresh from disk — so with one project per window, a save in one window no longer silently reverts what another window saved in the meantime. The Tools page now arms the unsaved-changes guard like Settings and the character editor (navigating away or closing the window with unsaved Tools edits asks first). A corrupt settings.json is surfaced once at startup instead of silently resetting every tool path to defaults. The Project tab's defaults now come from the single canonical copy instead of a second hardcoded list.

- [#353](https://github.com/polynaut/dth-character-studio/pull/353) [`b645619`](https://github.com/polynaut/dth-character-studio/commit/b645619abaca8f76b75697ac9f00da391a984d43) Thanks [@polynaut](https://github.com/polynaut)! - Web-layer robustness: all file/folder pickers no-op in a plain browser like the rest of the native boundary (Browse buttons were unhandled rejections there); the export-section switches are single-flight — two quick toggles can no longer run overlapping save+generate rounds that settle the editor to the older result; hovering a character card no longer ingests (and deletes) the Daz-written ROM run log mid-write — ingestion happens only on real visits and the window-focus refetch; a failed inline rename rolls the optimistic name back instead of leaving it as a phantom dirty edit; the network-drive "Forget" and DIM-folder auto-detect surface their errors instead of rejecting silently; the unsaved-changes prompt always shows its current message; and the `dirOf` path helper lives once in lib/path instead of twice inline.

- Updated dependencies [[`98de896`](https://github.com/polynaut/dth-character-studio/commit/98de896b234423b327dbe1db868d8edd76fadd25), [`847e9dd`](https://github.com/polynaut/dth-character-studio/commit/847e9ddfef123a0c42573b5808301893f2b4530e), [`0e33b5e`](https://github.com/polynaut/dth-character-studio/commit/0e33b5e84ad54af0b51398be6926aa5a9ae0cb5f), [`0b2c8dd`](https://github.com/polynaut/dth-character-studio/commit/0b2c8dd8739f2e6531d6c1dc9dac74a603337cb3), [`b243f48`](https://github.com/polynaut/dth-character-studio/commit/b243f48bcb978e381daa0ba777fd0235cb0ec23d)]:
  - @dth/ui@0.44.3
  - @dth/rom@0.44.3

## 0.44.2

### Patch Changes

- [#357](https://github.com/polynaut/dth-character-studio/pull/357) [`5aa6386`](https://github.com/polynaut/dth-character-studio/commit/5aa63862b5a8785640afbc3a0faa4bdf60e55878) Thanks [@polynaut](https://github.com/polynaut)! - Fix a ROM-build regression (runtime v30): the base-ROM tail close-out no longer double-applies character-owned morphs. Since v26 it ran a whole-figure re-key at the FAC→GEN boundary using each morph's post-ROM value; for a morph the character or a GP/character preset drives (e.g. ProportionHeight), that stacked the value on top of the ERC-driven contribution, so a -10% dialed height showed as -20% by frame 327. The runtime now snapshots the morph baseline before the ROM loads and leaves any character-dialed (non-zero base) morph untouched — only pure ROM poses (the final FAC neck pose that v26 was added to fix) still close their dangling tail. Re-run the ROM script in Daz (Tools → Refresh assets) to rebuild affected timelines. Found by Soltude80's testing.

- Updated dependencies [[`5aa6386`](https://github.com/polynaut/dth-character-studio/commit/5aa63862b5a8785640afbc3a0faa4bdf60e55878)]:
  - @dth/rom@0.44.2
  - @dth/ui@0.44.2

## 0.44.1

### Patch Changes

- [#347](https://github.com/polynaut/dth-character-studio/pull/347) [`22c7071`](https://github.com/polynaut/dth-character-studio/commit/22c70712bf37a3cce5a26f2194b4bfad6dc51432) Thanks [@polynaut](https://github.com/polynaut)! - Groom UI polish: the switch reads "Hair items (groom) live in the Daz scenes" (bold On/Off in its popup), and the label + popup over the per-scene picker are gone — the selected scene card right above is the context, and the full how-it-works moved into the guide's new "Hair items (groom)" section.

- Updated dependencies []:
  - @dth/rom@0.44.1
  - @dth/ui@0.44.1

## 0.44.0

### Minor Changes

- [#345](https://github.com/polynaut/dth-character-studio/pull/345) [`05d3a78`](https://github.com/polynaut/dth-character-studio/commit/05d3a781f16303b3d929fe287bae5cec383305c1) Thanks [@polynaut](https://github.com/polynaut)! - The groom (hair) settings moved up under the Daz scene cards — the lists are per scene, so selecting a card now visibly swaps the hair list right beneath it. The list itself is a new multi-select combobox (new `MultiSelect` in `@dth/ui`): the selected items sit in one always-rendered field as removable pills, clicking into it lists the scene's remaining wearables (hair-ish first, type to filter), and a label the scan doesn't offer can still be typed and added. A pill whose label isn't found in the scene turns amber with a tooltip. The combobox implements the full ARIA pattern (active-descendant list, wrap-around arrow keys, Home/End, match highlighting) — pills are keyboard-reachable via ArrowLeft, Backspace asks twice before dropping one, and Escape closing the list won't also close a surrounding dialog.

### Patch Changes

- Updated dependencies [[`05d3a78`](https://github.com/polynaut/dth-character-studio/commit/05d3a781f16303b3d929fe287bae5cec383305c1)]:
  - @dth/ui@0.44.0
  - @dth/rom@0.44.0

## 0.43.1

### Patch Changes

- [#343](https://github.com/polynaut/dth-character-studio/pull/343) [`4b63955`](https://github.com/polynaut/dth-character-studio/commit/4b639551258fc175716b8dac3d4ecec2420f860e) Thanks [@polynaut](https://github.com/polynaut)! - The "Solve hair assets by hiding" setting is labeled experimental: as of Exporter Plugin 2.0 (preview), hiding keeps hair out of the Alembic but not yet the FBX — the default detach mechanism covers both.

- Updated dependencies []:
  - @dth/rom@0.43.1
  - @dth/ui@0.43.1

## 0.43.0

### Minor Changes

- [#341](https://github.com/polynaut/dth-character-studio/pull/341) [`31bd91e`](https://github.com/polynaut/dth-character-studio/commit/31bd91e785fab9be00c76291d114724ff628146e) Thanks [@polynaut](https://github.com/polynaut)! - The ROM script now finds and selects the character's figure by itself (runtime v28). Forgetting to select the figure — or having something else selected — no longer aborts the run: the runtime locates the scene's figure of the character's Genesis generation by its source-asset identity, which survives any node renaming (labels and names are user-editable; the `.dsf` a figure was instantiated from is not), selects it and proceeds. With several matching figures in a scene the first one wins. Only a scene containing no figure of the character's generation still stops with an error.

- [#340](https://github.com/polynaut/dth-character-studio/pull/340) [`fe041b9`](https://github.com/polynaut/dth-character-studio/commit/fe041b91aff2a745b02a1a974072313ebe21308f) Thanks [@polynaut](https://github.com/polynaut)! - Scene-derived avatars stay in sync with their Daz scene. Daz rewrites a scene's preview image on every scene save, but the studio copied it exactly once — now the character remembers which linked scene its avatar mirrors (schema v12, additive `imageScene`), and the editor re-copies the preview whenever it drifts: on opening the character and every time the app window regains focus (tabbing back from Daz is enough — no reload needed). Custom-uploaded images and external URLs are never touched, and picking a different linked scene's preview in the image dialog re-targets the sync to that scene. Characters created before this release self-heal: when the stored avatar still matches a linked scene's current preview, that scene is adopted as the source automatically.

- [#338](https://github.com/polynaut/dth-character-studio/pull/338) [`f335e6e`](https://github.com/polynaut/dth-character-studio/commit/f335e6e09b21d0c839128fc098da01bf97a47961) Thanks [@polynaut](https://github.com/polynaut)! - Groom workflow: one scene can carry full hair while the ROM export stays clean. A new "Groom items" list on the character's Export section names the fitted hair items (usually just the cap — its children ride along); the generated script unfits + unparents each one right before the DTH Exporter runs and restores it afterwards, even when the export fails (hide-based exclusion was measured insufficient: the FBX exporter includes hidden nodes even on plugin 2.0 — only the alembic honors them). A mistyped label aborts the export loudly instead of silently shipping a hair-polluted FBX. The groom list suggests candidates straight from the character's linked scene: a native command reads the scene `.duf` (no Daz needed) and offers the items conformed to the figure as one-click chips, hair-ish names first — and warns when a listed label isn't in the scene. Groom lists are per SCENE — outfit scenes carry different hair styles — and the single generated script bakes the whole map, resolving the open scene's list at run time by filename (a scene without a list exports as-is). The Daz scene cards are selectable (click selects — the corner icon opens; the primary scene is selected on entry), and the groom editor edits the selected scene's list. A per-character groom mode still chooses the workflow: hair in the ROM scenes (default) or the classic separate-scene files. Character schema v15 (`groomScenes` + `groomMode`, additive — no migration needed). Characters with groom lists also get an `Export_Groom_<Name>.dsa`: it hides everything worn EXCEPT the groom and runs the exporter's dedicated groom action (`doExportAlembicGroomPoses`), producing the `_grooms.abc` Houdini's DazToHueGroom Import node wants. A new global setting, "Solve hair assets by hiding" (Settings → General, off by default), switches the ROM-export exclusion from the detach bracket to hiding the items with all their children — for DTH Exporter Plugin 2.0+, which skips hidden nodes.

### Patch Changes

- [#335](https://github.com/polynaut/dth-character-studio/pull/335) [`0b498e9`](https://github.com/polynaut/dth-character-studio/commit/0b498e9da7d9710c9d72118050f6e8d2d562f704) Thanks [@polynaut](https://github.com/polynaut)! - The DTH runtime is inline-config only now (runtime v27). The file-based config paths of the old wrapper-script era — the `extraJSONs` (`*_FBMs.json`) list, the GP9/DK9 art-direction JSON path fallbacks and the unused CSV reader — are removed; the runtime is studio-owned and everything arrives inline via the single `ApplyDTHCharacter(config)` call. A config that still passes file-based options aborts loudly with a regenerate-in-studio error instead of silently building a ROM without its custom frames. The GP/DK block-tail close-outs are unconditional now (their gating meta flags no longer exist — the option behind them was removed in the previous release), and the FBM-start art-morph reset is retired since the boundary close-out covers it. Dead migration code for the long-renamed `resetGPBeforeApplying` field is cleaned up too — old definitions still parse fine (unknown keys are stripped on read, as always).

- Updated dependencies [[`31bd91e`](https://github.com/polynaut/dth-character-studio/commit/31bd91e785fab9be00c76291d114724ff628146e), [`fe041b9`](https://github.com/polynaut/dth-character-studio/commit/fe041b91aff2a745b02a1a974072313ebe21308f), [`f335e6e`](https://github.com/polynaut/dth-character-studio/commit/f335e6e09b21d0c839128fc098da01bf97a47961), [`0b498e9`](https://github.com/polynaut/dth-character-studio/commit/0b498e9da7d9710c9d72118050f6e8d2d562f704)]:
  - @dth/rom@0.43.0
  - @dth/ui@0.43.0

## 0.42.6

### Patch Changes

- [#333](https://github.com/polynaut/dth-character-studio/pull/333) [`fe2c809`](https://github.com/polynaut/dth-character-studio/commit/fe2c809951a7e274249d5ef227970bb0b48648b7) Thanks [@polynaut](https://github.com/polynaut)! - ROM block tails no longer leak into the blocks after them (runtime v26). A pose preset can only key frames inside its own range, so a block's final pose had no ramp-down key past the block end and held its value through everything that followed — the base ROM's last FAC pose (a neck morph) showed as neck/throat morph deltas across the whole GEN range in Houdini. After the base block loads, the runtime now keys any morph not back at its frame-0 value to that value at the first post-base frame (figure and G9 mouth alike), completing the sawtooth the preset couldn't author. The GP and DK blocks get the same close-out on their own node at the next block boundary — closing the gaps the FBM-start art-morph reset left (.duf-baked gen morphs, characters without art direction, and a Physics block between GEN and the custom sections). The "Reset genitalia morphs before extra frames" character option is removed (schema v11): tails never leaking is behavior now, not a choice — its off position only reproduced the bug. Re-run the character's ROM script in Daz to rebuild existing timelines; Tools → Refresh assets flags characters generated on older runtimes as stale.

- Updated dependencies [[`fe2c809`](https://github.com/polynaut/dth-character-studio/commit/fe2c809951a7e274249d5ef227970bb0b48648b7)]:
  - @dth/rom@0.42.6
  - @dth/ui@0.42.6

## 0.42.5

### Patch Changes

- [#331](https://github.com/polynaut/dth-character-studio/pull/331) [`25e3cab`](https://github.com/polynaut/dth-character-studio/commit/25e3cab3cfdf3fa9e6766a33243c0d025ff2eddb) Thanks [@polynaut](https://github.com/polynaut)! - The character editor's Discard/Save buttons keep their large "at the top" size on pages too short to scroll (e.g. the Notes tab) — the same inactive-scroll-timeline quirk as the Back-link fix: with no scrollable overflow the shrink animation yields no values, so the buttons fell to their collapsed default size while the rest of the header showed its expanded state.

- Updated dependencies []:
  - @dth/rom@0.42.5
  - @dth/ui@0.42.5

## 0.42.4

### Patch Changes

- [#330](https://github.com/polynaut/dth-character-studio/pull/330) [`0b0805f`](https://github.com/polynaut/dth-character-studio/commit/0b0805f2af9127432643bd695272035d4165bdca) Thanks [@polynaut](https://github.com/polynaut)! - Two editor fixes: the sticky header's scroll-in "Back" link no longer shows up immediately on the Notes tab (on a page too short to scroll the scroll timeline is inactive, so the link fell back to its visible base state — it now defaults to hidden, and the run-error hint gets the same guard), and the "Modify JCM frames" header is no longer a button wrapping the info popup's button (invalid HTML that React flagged and assistive tech misreads). Under the hood, the Rust↔TS boundary is now pinned by shared contract fixtures — serde round-trips and the api layer's zod schemas validate the same JSON on both sides, and the frame-measurement result is parsed at the boundary instead of blindly cast.

- [#328](https://github.com/polynaut/dth-character-studio/pull/328) [`1e768f4`](https://github.com/polynaut/dth-character-studio/commit/1e768f42efd0b94b0be77b4bbd6a63050127d22d) Thanks [@polynaut](https://github.com/polynaut)! - Hardening pass on hand-mirrored knowledge (the pattern behind the FAC staleness bug): the reference-FBX rule (`isBoneScaleRefPose`/`boneScaleRefPoses`) and the per-section preset availability (`sectionPresetAvailable`) now live once in `@dth/rom` — the editor's bone-scale warning, the CSV file column, the exporter frames and the "no asset" chip all derive from the same definitions, with tests coupling availability to path resolution. App settings collapse to ONE tolerant zod schema (`studioSettingsSchema`) covering the field list, defaults, the settings.json read and the save input; the per-project behaviour defaults are shared between the manifest and the save schema. No behaviour change.

- Updated dependencies [[`1e768f4`](https://github.com/polynaut/dth-character-studio/commit/1e768f42efd0b94b0be77b4bbd6a63050127d22d)]:
  - @dth/rom@0.42.4
  - @dth/ui@0.42.4

## 0.42.3

### Patch Changes

- [#327](https://github.com/polynaut/dth-character-studio/pull/327) [`b8aedf7`](https://github.com/polynaut/dth-character-studio/commit/b8aedf77311c07c39adff083cd892fa702fa4a1b) Thanks [@polynaut](https://github.com/polynaut)! - Internal refactor: the character editor's draft machinery (dirty tracking against the last-persisted baseline, the unsaved-changes guard, and the save → generate → settle choreography) moved out of the route into a `useCharacterDraft` hook. No behaviour change.

- [#322](https://github.com/polynaut/dth-character-studio/pull/322) [`da0f89e`](https://github.com/polynaut/dth-character-studio/commit/da0f89e61f6280ef53f5b3afce629f219a090fb6) Thanks [@polynaut](https://github.com/polynaut)! - Toggling the FAC section now re-measures the preset ROM block lengths in the character editor. The FAC preset steers which JCM base asset the ROM resolves to (with vs. without the facial block), but the editor's re-measure trigger didn't watch it — so the timeline and frame numbers could show the stale previous length until an unrelated change. The trigger's field list now lives in `@dth/rom` next to the path resolution itself (`presetFramesSignature`), with a test coupling the two so a future resolver input can't silently go missing again.

- Updated dependencies [[`da0f89e`](https://github.com/polynaut/dth-character-studio/commit/da0f89e61f6280ef53f5b3afce629f219a090fb6), [`4a172dc`](https://github.com/polynaut/dth-character-studio/commit/4a172dce43131e9a3b491554ae64529b1cbd09fd)]:
  - @dth/rom@0.42.3
  - @dth/ui@0.42.3

## 0.42.2

### Patch Changes

- [#320](https://github.com/polynaut/dth-character-studio/pull/320) [`8a696af`](https://github.com/polynaut/dth-character-studio/commit/8a696af01729c03795373c6ac05a87d9bd3d31d4) Thanks [@polynaut](https://github.com/polynaut)! - Enabling a section now defaults to the pre-defined DTH asset when the installed release ships one for the character's generation (PHY included — it wrongly defaulted to the custom morph list), falling back to custom only when no asset exists or the section already carries your own groups. Also: the FAC preset description explains the Genesis 9 Mouth companion in plain words, and the Art direction explainer moved into an info popup next to its title.

- Updated dependencies [[`8a696af`](https://github.com/polynaut/dth-character-studio/commit/8a696af01729c03795373c6ac05a87d9bd3d31d4)]:
  - @dth/rom@0.42.2
  - @dth/ui@0.42.2

## 0.42.1

### Patch Changes

- [#318](https://github.com/polynaut/dth-character-studio/pull/318) [`822ceaf`](https://github.com/polynaut/dth-character-studio/commit/822ceafafb2d9b12a8a97383a4676bdfd04c7651) Thanks [@polynaut](https://github.com/polynaut)! - Settings grew an "App Data" tab (app data folder + storage housekeeping, moved out of General/Tools), the Project tab leads in project windows, network drives got their own pane at the bottom of General, and the import picker's rows expand to a copyable path chip instead of a tooltip. Tooltips app-wide now wrap long paths correctly. The "Empty quarantine" button is gone — the dedup quarantine is a plain folder you manage yourself in Explorer.

- Updated dependencies [[`822ceaf`](https://github.com/polynaut/dth-character-studio/commit/822ceafafb2d9b12a8a97383a4676bdfd04c7651)]:
  - @dth/ui@0.42.1
  - @dth/rom@0.42.1

## 0.42.0

### Minor Changes

- [#316](https://github.com/polynaut/dth-character-studio/pull/316) [`ca0fb2f`](https://github.com/polynaut/dth-character-studio/commit/ca0fb2fe9903ddacf18d5acd89f39631e7bce20d) Thanks [@polynaut](https://github.com/polynaut)! - Scan_Frames ships with the studio: the keyframe-scan script (formerly DazToHue-Scripts' DthScanFrames) installs into Scripts/DTH-Character-Studio like the other scan scripts and writes its CSV — one per Daz scene — into the studio's own scan folder. "Import from CSV" now opens a picker listing those scans (newest first) with a Browse fallback for hand-curated files. The Tools → DazToHue-Scripts download/installer is gone — everything the workflow needs is bundled; the scan folder is bounded by the housekeeping sweep (30 days).

### Patch Changes

- Updated dependencies [[`ca0fb2f`](https://github.com/polynaut/dth-character-studio/commit/ca0fb2fe9903ddacf18d5acd89f39631e7bce20d)]:
  - @dth/rom@0.42.0
  - @dth/ui@0.42.0

## 0.41.42

### Patch Changes

- [#314](https://github.com/polynaut/dth-character-studio/pull/314) [`d1ab6e7`](https://github.com/polynaut/dth-character-studio/commit/d1ab6e7c355bd038c954959b6695ee4e1af4c98c) Thanks [@polynaut](https://github.com/polynaut)! - Character page polish: wider Genesis/Gender selects, the Genesis 9 box now stays visible with its fields disabled on non-G9 characters (instead of disappearing), the "experimental" tag is gone, and Genesis 3 is selectable — DazToHue ships a subset of G3 pose assets, so the studio offers what the release provides.

- Updated dependencies []:
  - @dth/rom@0.41.42
  - @dth/ui@0.41.42

## 0.41.41

### Patch Changes

- [#312](https://github.com/polynaut/dth-character-studio/pull/312) [`f8b478a`](https://github.com/polynaut/dth-character-studio/commit/f8b478ae51bfec1999a5b8e29a658a21b954f740) Thanks [@polynaut](https://github.com/polynaut)! - Genesis 9 box rearranged: the strength dials sit on top (baseline-aligned with Genesis/Gender, as before the toggle moved in) and the UE5 tear UV toggle sits below them.

- Updated dependencies []:
  - @dth/rom@0.41.41
  - @dth/ui@0.41.41

## 0.41.40

### Patch Changes

- [#310](https://github.com/polynaut/dth-character-studio/pull/310) [`32d9ac7`](https://github.com/polynaut/dth-character-studio/commit/32d9ac73b77b969cbade32eb0b21317f110c3206) Thanks [@polynaut](https://github.com/polynaut)! - Genesis/Gender now sit on the same baseline as the Genesis 9 box's first row (the tear-UV toggle) — matched content-top offsets and label line heights.

- Updated dependencies []:
  - @dth/rom@0.41.40
  - @dth/ui@0.41.40

## 0.41.39

### Patch Changes

- [#306](https://github.com/polynaut/dth-character-studio/pull/306) [`feafd91`](https://github.com/polynaut/dth-character-studio/commit/feafd9150fb1bbcf3f49fed6ed2c9eb020238736) Thanks [@polynaut](https://github.com/polynaut)! - The FACS detail / Flexion strength dials now show Daz-style percentages (0–100 %, with a % suffix) like every morph value field, and the Genesis 9 box got more breathing room between the tear-UV toggle and the dials. Stored values are unchanged (raw 1 = 100 %) — no migration needed.

- Updated dependencies [[`feafd91`](https://github.com/polynaut/dth-character-studio/commit/feafd9150fb1bbcf3f49fed6ed2c9eb020238736)]:
  - @dth/ui@0.41.39
  - @dth/rom@0.41.39

## 0.41.38

### Patch Changes

- [#303](https://github.com/polynaut/dth-character-studio/pull/303) [`28dd7b2`](https://github.com/polynaut/dth-character-studio/commit/28dd7b2ef178732f804899341d110cae9cea4a99) Thanks [@polynaut](https://github.com/polynaut)! - The "Set UE5 tear UV" toggle moved from the Advanced options panel into the "Genesis 9 specific" box (above the FACS/Flexion strength dials) — it's a G9-only setting, so that's where it belongs.

- Updated dependencies []:
  - @dth/rom@0.41.38
  - @dth/ui@0.41.38

## 0.41.37

### Patch Changes

- [#301](https://github.com/polynaut/dth-character-studio/pull/301) [`06f58ba`](https://github.com/polynaut/dth-character-studio/commit/06f58ba8a2fe485b066b10054e44221e118cabc7) Thanks [@polynaut](https://github.com/polynaut)! - Bone scale is now limited to GEN and FBM poses — a reference-FBX path on a MIS row breaks the DazToHue HDA's CSV import (verified in Houdini), so the toggle is hidden in MISC and generation never emits reference paths or exporter reference frames there. Refresh assets regenerates any CSV that carried one.

- Updated dependencies [[`06f58ba`](https://github.com/polynaut/dth-character-studio/commit/06f58ba8a2fe485b066b10054e44221e118cabc7)]:
  - @dth/rom@0.41.37
  - @dth/ui@0.41.37

## 0.41.36

### Patch Changes

- [#299](https://github.com/polynaut/dth-character-studio/pull/299) [`4109c82`](https://github.com/polynaut/dth-character-studio/commit/4109c820ccc55a77e182e6b75f49db90af1e44f9) Thanks [@polynaut](https://github.com/polynaut)! - About page: a "Report a problem" link that opens a prefilled GitHub bug form (app version included), plus a pointer to the new Discussions Q&A. The repo also gains bug/feature issue templates, an honest per-figure support matrix in the README, and a release smoke checklist.

- Updated dependencies []:
  - @dth/rom@0.41.36
  - @dth/ui@0.41.36

## 0.41.35

### Patch Changes

- [#296](https://github.com/polynaut/dth-character-studio/pull/296) [`0b3c955`](https://github.com/polynaut/dth-character-studio/commit/0b3c955131285eff5a34ce75042d7dad6103432e) Thanks [@polynaut](https://github.com/polynaut)! - Kill the last 1px layout shift between an empty group and its first morph row — the placeholder now mirrors the name input's exact vertical metrics instead of a hard-coded height.

- Updated dependencies []:
  - @dth/rom@0.41.35
  - @dth/ui@0.41.35

## 0.41.34

### Patch Changes

- [#294](https://github.com/polynaut/dth-character-studio/pull/294) [`9478e53`](https://github.com/polynaut/dth-character-studio/commit/9478e533275a64ac02f984880171777799a46658) Thanks [@polynaut](https://github.com/polynaut)! - Fix a layout shift when adding the first pose to an empty ROM group. The "No poses in this group yet." placeholder was taller than a real pose row, so adding the first morph made the list jump. The empty state now matches a pose row's height.

- Updated dependencies []:
  - @dth/rom@0.41.34
  - @dth/ui@0.41.34

## 0.41.33

### Patch Changes

- [#292](https://github.com/polynaut/dth-character-studio/pull/292) [`065544c`](https://github.com/polynaut/dth-character-studio/commit/065544c7fcc626646898d8ef04f494fa4f1b6a47) Thanks [@polynaut](https://github.com/polynaut)! - Guide the export-directory picker to a sensible starting folder. When no export directory is set yet, the **Choose folder…** dialog now opens in the character's own folder — already inside its Houdini subfolder when that exists — so the export lands where it usually should with one click. Re-choosing an existing directory opens at the current one. You can still browse anywhere; it only changes where the dialog starts.

- Updated dependencies []:
  - @dth/rom@0.41.33
  - @dth/ui@0.41.33

## 0.41.32

### Patch Changes

- [#289](https://github.com/polynaut/dth-character-studio/pull/289) [`1610a5b`](https://github.com/polynaut/dth-character-studio/commit/1610a5b3cba977537bd232024f1be93b4aafe7e9) Thanks [@polynaut](https://github.com/polynaut)! - Reference-skeleton FBX is now a **Bone scale** toggle instead of a free-text path. Turn it on for a morph that scales bones (e.g. Torso Length, Proportion Height) and the studio does the rest: the DTH Exporter already generates the per-frame reference-skeleton FBX, and the PoseAsset CSV's `file` column is now auto-filled with that FBX's absolute path — no more typing or drift.

  The path is resolved bulletproof at run time: the studio writes a `{{DTH_EXPORT_DIR}}` token into the CSV, and the generated Daz script substitutes the real export dir (scene subfolder included) when it copies the CSV next to the exporter output — so Houdini gets the exact absolute path it wants. A warning appears if bone-scale frames are set without an export directory (the exporter needs one to produce the FBX). Existing `referenceFbx` paths migrate to the toggle automatically.

- Updated dependencies [[`1610a5b`](https://github.com/polynaut/dth-character-studio/commit/1610a5b3cba977537bd232024f1be93b4aafe7e9)]:
  - @dth/rom@0.41.32
  - @dth/ui@0.41.32

## 0.41.31

### Patch Changes

- [#287](https://github.com/polynaut/dth-character-studio/pull/287) [`5b17fb9`](https://github.com/polynaut/dth-character-studio/commit/5b17fb956d00c417a505d0356dab99c12ea2137e) Thanks [@polynaut](https://github.com/polynaut)! - When a blocked Save jumps to the offending pose row, focus the field that's actually flagged. It used to focus the first _empty_ input in the row, which for a filled-but-invalid name (e.g. one with a space) landed on the empty optional Reference FBX field instead. It now prefers the red-bordered (`aria-invalid`) input and only falls back to the first empty one — so the cursor lands where the error is.

- Updated dependencies []:
  - @dth/rom@0.41.31
  - @dth/ui@0.41.31

## 0.41.30

### Patch Changes

- [#285](https://github.com/polynaut/dth-character-studio/pull/285) [`1f56e4c`](https://github.com/polynaut/dth-character-studio/commit/1f56e4cb152c32b201bb09634268543faafb6689) Thanks [@polynaut](https://github.com/polynaut)! - Block Save (and generation) on a custom pose name that isn't Houdini-safe, not just on empty fields. The Name cell already flags spaces/punctuation with a red border (Houdini accepts only letters, numbers and underscores), but the save gate only checked for empty fields — so a red-bordered name could still be saved. `romValidationErrors` now mirrors the cell rule, so a flagged field can't slip past Save.

- Updated dependencies [[`1f56e4c`](https://github.com/polynaut/dth-character-studio/commit/1f56e4cb152c32b201bb09634268543faafb6689)]:
  - @dth/rom@0.41.30
  - @dth/ui@0.41.30

## 0.41.29

### Patch Changes

- [#283](https://github.com/polynaut/dth-character-studio/pull/283) [`19c3a12`](https://github.com/polynaut/dth-character-studio/commit/19c3a126a621bd75f5b4c79387a5b0196721b507) Thanks [@polynaut](https://github.com/polynaut)! - Remove the generated `Open_Scene_<Character>.dsa` script and rework the "Daz Studio is already open" dialog. Opening a character always launches a fresh Daz, so the dialog now asks you to close Daz Studio first — once it has fully quit (polled every couple of seconds), the button switches from "Open anyway" to "Open now" and launches it cleanly. Any leftover `Open_Scene_*` scripts are cleaned up on the next regeneration (Tools → Refresh assets).

- Updated dependencies [[`19c3a12`](https://github.com/polynaut/dth-character-studio/commit/19c3a126a621bd75f5b4c79387a5b0196721b507)]:
  - @dth/rom@0.41.29
  - @dth/ui@0.41.29

## 0.41.28

### Patch Changes

- [#281](https://github.com/polynaut/dth-character-studio/pull/281) [`690844d`](https://github.com/polynaut/dth-character-studio/commit/690844d6e3ae0a38448892581eb2e4d25f2b04fb) Thanks [@polynaut](https://github.com/polynaut)! - Make input validation errors clearer. Invalid fields now show a **more visible red
  border** (a 2px destructive ring instead of a faint 1px border — both the ROM cell
  inputs and the shared `Input` primitive), and a field whose error lived in a `title`
  attribute (the ROM name/morph cells) now shows it in a proper **alert-style tooltip**
  (red background, light text) via a new `data-tooltip-variant="error"` on the global
  tooltip.
- Updated dependencies [[`690844d`](https://github.com/polynaut/dth-character-studio/commit/690844d6e3ae0a38448892581eb2e4d25f2b04fb)]:
  - @dth/ui@0.41.28
  - @dth/rom@0.41.28

## 0.41.27

### Patch Changes

- Updated dependencies [[`b0125f0`](https://github.com/polynaut/dth-character-studio/commit/b0125f0baa6191c188f95a5fa6575b77ce7fb150)]:
  - @dth/ui@0.41.27
  - @dth/rom@0.41.27

## 0.41.26

### Patch Changes

- [#277](https://github.com/polynaut/dth-character-studio/pull/277) [`2a125ef`](https://github.com/polynaut/dth-character-studio/commit/2a125ef49d35d60fde8437fcabcf31ba8de29643) Thanks [@polynaut](https://github.com/polynaut)! - Add a **Set UE5 tear UV** toggle to a character's Advanced options (Genesis 9 only,
  opt-in, off by default). When enabled, the generated ROM script switches the
  Genesis 9 Tear figure's shader UV set to "UE5" during the build — so DTH's Lacrimal
  Fluid material lines up without the manual Surfaces-tab step, and it can't be
  forgotten. Character schema → v9 (additive `applyUE5TearUV`, no migration step).
- Updated dependencies [[`2a125ef`](https://github.com/polynaut/dth-character-studio/commit/2a125ef49d35d60fde8437fcabcf31ba8de29643)]:
  - @dth/rom@0.41.26
  - @dth/ui@0.41.26

## 0.41.25

### Patch Changes

- [#275](https://github.com/polynaut/dth-character-studio/pull/275) [`90354b6`](https://github.com/polynaut/dth-character-studio/commit/90354b6bc1d71883ed5cb56dd3ca3f18a7f6ed82) Thanks [@polynaut](https://github.com/polynaut)! - Keep spellcheck on the Notes field. Spellcheck is disabled app-wide (the technical
  fields hold morph names and paths), but Notes are freeform prose, so re-enable it
  there with `spellCheck` on the textarea to override the inherited default.
- Updated dependencies []:
  - @dth/rom@0.41.25
  - @dth/ui@0.41.25

## 0.41.24

### Patch Changes

- [#272](https://github.com/polynaut/dth-character-studio/pull/272) [`c6d0167`](https://github.com/polynaut/dth-character-studio/commit/c6d01670bbf89b19ca3f812f6da838e63dff411e) Thanks [@polynaut](https://github.com/polynaut)! - Turn off browser spellcheck across the app. The text fields hold morph/property
  names, node labels and paths (e.g. `GP_Vagina_Open_Stretch`), not prose, so the red
  squiggly underline was pure noise. Set `spellcheck="false"` on `<body>` — it's an
  inherited attribute, so it covers every input, including the raw ROM-cell fields.
- Updated dependencies []:
  - @dth/rom@0.41.24
  - @dth/ui@0.41.24

## 0.41.23

### Patch Changes

- Updated dependencies [[`543b7ce`](https://github.com/polynaut/dth-character-studio/commit/543b7ce6e093878ed07ad044f02fe5ae07de065c)]:
  - @dth/rom@0.41.23
  - @dth/ui@0.41.23

## 0.41.22

### Patch Changes

- [#259](https://github.com/polynaut/dth-character-studio/pull/259) [`cfed18c`](https://github.com/polynaut/dth-character-studio/commit/cfed18ca90713f600dc25eb747707b4388c6b7fe) Thanks [@polynaut](https://github.com/polynaut)! - Add a reliable way to open a character's scene when Daz Studio is already running.
  The studio can't switch a running Daz's scene itself (a forwarded open is dropped
  once a scene is loaded), so generation now writes a per-character
  `Open_Scene_<Character>.dsa` into the Content Library that opens the scene from
  inside Daz (replacing the current one, after a save warning). Clicking a scene card
  while Daz is open now shows a dialog pointing at that script, with an "Open anyway"
  that still forwards (which works when Daz has no scene loaded). With Daz closed,
  cards open as before.
- Updated dependencies []:
  - @dth/rom@0.41.22
  - @dth/ui@0.41.22

## 0.41.21

### Patch Changes

- [#257](https://github.com/polynaut/dth-character-studio/pull/257) [`58d6219`](https://github.com/polynaut/dth-character-studio/commit/58d6219bf47d5365fd5f62eb22f1285e9226af21) Thanks [@polynaut](https://github.com/polynaut)! - Fix "Open in Daz" not loading the scene when Daz already has one open. The bridge
  called `openFile(path)` without the `merge` argument, which merges the character
  into the current scene instead of replacing it — so opening a new card looked like
  nothing happened (into an empty Daz there was nothing to merge with, so it seemed
  fine). It now calls `openFile(path, false)`, which clears the scene and opens the
  file fresh.
- Updated dependencies []:
  - @dth/rom@0.41.21
  - @dth/ui@0.41.21

## 0.41.20

### Patch Changes

- [#255](https://github.com/polynaut/dth-character-studio/pull/255) [`e2791bc`](https://github.com/polynaut/dth-character-studio/commit/e2791bc4b0aa171e039339c8619186c5f40289ab) Thanks [@polynaut](https://github.com/polynaut)! - Fix "Open in Daz" sometimes not loading the scene when Daz is already open. The
  scene-open bridge always wrote the same `dth_open_scene.dsa`, and a running Daz can
  ignore a repeated open of an identical path — so a second click looked like nothing
  happened. The bridge filename now rotates across a small fixed pool, so consecutive
  opens never hand Daz the same path twice.
- Updated dependencies []:
  - @dth/rom@0.41.20
  - @dth/ui@0.41.20

## 0.41.19

### Patch Changes

- [#252](https://github.com/polynaut/dth-character-studio/pull/252) [`45ec4d4`](https://github.com/polynaut/dth-character-studio/commit/45ec4d4ee707dcd73aba47ec59468241a6567ad5) Thanks [@polynaut](https://github.com/polynaut)! - Bring the target app to the foreground after "Open in …". Opening a scene in an
  already-running Daz Studio (or a Houdini `.hip` / Unreal `.uproject`) loaded it
  behind the studio window; the studio now focuses the app's window afterwards. It's
  best-effort and Windows-only — a no-op when the app isn't running yet (a fresh
  launch focuses itself) or on other platforms.
- Updated dependencies []:
  - @dth/rom@0.41.19
  - @dth/ui@0.41.19

## 0.41.18

### Patch Changes

- [#248](https://github.com/polynaut/dth-character-studio/pull/248) [`d0dcec9`](https://github.com/polynaut/dth-character-studio/commit/d0dcec95e8dad7a81653819ca27d65c2d1189ba7) Thanks [@polynaut](https://github.com/polynaut)! - Self-host the Manrope font instead of loading it from Google Fonts. The packaged
  app's CSP (`style-src 'self'`) blocked the external `@import`, so installed builds
  silently fell back to a system font — and it added a network dependency to an
  offline-capable desktop tool. Manrope is now bundled via `@fontsource-variable/manrope`,
  so it renders correctly, works offline, and passes the CSP with no policy changes.
- Updated dependencies []:
  - @dth/rom@0.41.18
  - @dth/ui@0.41.18

## 0.41.17

### Patch Changes

- [#245](https://github.com/polynaut/dth-character-studio/pull/245) [`b8a4296`](https://github.com/polynaut/dth-character-studio/commit/b8a4296dcebb3a0f53890ab16a5f282d4b643c1b) Thanks [@polynaut](https://github.com/polynaut)! - Enable the WebView2 inspector (right-click → Inspect, F12) in installed/release
  builds, not just dev — this is a self-hosted tool and it helps debug the shipped
  app against a live Daz Studio.

  Make "Open in Daz" observable when a running Daz doesn't react: the bridge script
  now reports a failed open with a message box (so it's no longer silent — and if
  no box appears at all, the running instance never executed the forwarded script),
  and the web side logs which Daz executable it launched to the console.

- Updated dependencies []:
  - @dth/rom@0.41.17
  - @dth/ui@0.41.17

## 0.41.16

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.41.16
  - @dth/ui@0.41.16

## 0.41.15

### Patch Changes

- [#240](https://github.com/polynaut/dth-character-studio/pull/240) [`0a66525`](https://github.com/polynaut/dth-character-studio/commit/0a66525d07d155dea9e04e1f996d4e2817a1f750) Thanks [@polynaut](https://github.com/polynaut)! - Fix "Open in Daz" launching the scene-open bridge script in a text editor instead
  of Daz Studio. Opening a scene while Daz is already running writes a one-shot
  `.dsa` and previously shell-opened it, which follows the OS file association — on
  machines where `.dsa` is bound to an editor (e.g. VS Code on a dev box) the script
  just opened as text and the scene never loaded. The bridge now launches the
  running Daz instance's own executable with the script as its argument
  (association-independent), and only falls back to the shell-open if the executable
  can't be located.
- Updated dependencies []:
  - @dth/rom@0.41.15
  - @dth/ui@0.41.15

## 0.41.14

### Patch Changes

- [#238](https://github.com/polynaut/dth-character-studio/pull/238) [`5df102a`](https://github.com/polynaut/dth-character-studio/commit/5df102a20ba8f1cd8a74a3f42829ed105eef2a33) Thanks [@polynaut](https://github.com/polynaut)! - Block saving a character while a custom section has empty required fields (a pose
  with no name, no morph, or an empty morph name), and jump straight to the problem:
  the offending section opens, its pose row scrolls into view and the first empty
  field is focused. A toast names the first error (or the count when there are
  several).
- Updated dependencies [[`5df102a`](https://github.com/polynaut/dth-character-studio/commit/5df102a20ba8f1cd8a74a3f42829ed105eef2a33)]:
  - @dth/rom@0.41.14
  - @dth/ui@0.41.14

## 0.41.13

### Patch Changes

- [#234](https://github.com/polynaut/dth-character-studio/pull/234) [`0e6fc32`](https://github.com/polynaut/dth-character-studio/commit/0e6fc32344c8904a29085414e7416a2dfe1b99a4) Thanks [@polynaut](https://github.com/polynaut)! - Settings: hide the "Network drives" section entirely when no mapped network
  drives are detected (previously it showed an explanatory paragraph). Users who
  don't use network drives no longer see an empty, potentially confusing block.
- Updated dependencies []:
  - @dth/rom@0.41.13
  - @dth/ui@0.41.13

## 0.41.12

### Patch Changes

- [#228](https://github.com/polynaut/dth-character-studio/pull/228) [`66fbb06`](https://github.com/polynaut/dth-character-studio/commit/66fbb062e02b2c5e28650587cec94a554df80069) Thanks [@polynaut](https://github.com/polynaut)! - Settings → DTH release install: the **Daz** install/dry-run report now appears
  directly under the "My DAZ 3D Library" buttons (instead of at the bottom of the
  whole section), while the **Houdini** report stays at the bottom. The single
  shared report was split per target so each result shows next to the buttons that
  produced it.
- Updated dependencies []:
  - @dth/rom@0.41.12
  - @dth/ui@0.41.12

## 0.41.11

### Patch Changes

- [#224](https://github.com/polynaut/dth-character-studio/pull/224) [`562b541`](https://github.com/polynaut/dth-character-studio/commit/562b541981b18a4a20d2b8adbc90cc93a20f531e) Thanks [@polynaut](https://github.com/polynaut)! - - **ROM frame-timeline**: a proportional, labelled strip on the character page
  showing the measured preset ROM blocks (base, GP/DK, Physics) and each custom
  section at their exact frames — driven by the same frame math as generation,
  so it visualises precisely what ships. Makes the frame-alignment invariant
  visible and surfaces config mistakes at a glance.
  - **Internal**: FFI integration tests (mockIPC) covering the invoke bridge's
    request shape + zod return-validation, and `tools.tsx` (1580 lines) broken up
    into `components/tools/*` — no behaviour change.
- Updated dependencies []:
  - @dth/rom@0.41.11
  - @dth/ui@0.41.11

## 0.41.10

### Patch Changes

- [#221](https://github.com/polynaut/dth-character-studio/pull/221) [`a088970`](https://github.com/polynaut/dth-character-studio/commit/a0889706aa78ce540a7005fd128e166aba2836e9) Thanks [@polynaut](https://github.com/polynaut)! - Fixes from a full code/architecture/security review:

  - **Actually wire in the zod FFI validation** — `native-types.ts` schemas were
    defined but imported nowhere (the api layer still used bare `invoke<T>()`
    casts against duplicate interfaces). `install.ts`/`maintenance.ts` now
    `Schema.parse(await invoke(...))` at each boundary, so a renamed Rust serde
    field throws where it happens instead of handing the UI `undefined`.
  - **NumberField data-corruption fix**: it never re-synced its draft, so removing
    a non-last preserve-morph row showed (and could commit) the previous row's
    number. Adds the missing `value`-change effect.
  - **Notes tab** no longer renders the ROM editor + Delete section below the
    notes (wrong tab condition).
  - **Settings** unsaved-changes guard now covers Project-tab edits too (was
    machine-fields only — project edits could be discarded silently).
  - **Security**: anchor the `shell.open` allowlist regex (it was substring-
    matchable via an unanchored middle branch, e.g. `x.pdf.exe`).
  - Editor "experimental" badge passes `gpFrames`; the G9 strength-dial gate reads
    the `GENERATIONS` table; `romFields` typed (dropped an `as unknown as`);
    ImageDialog avatar-save rolls back + toasts on failure; InfoPopup treats
    protocol-relative `//host` links as external.
  - Docs: release sign/publish split + `CHANGESETS_TOKEN` documented; dropped the
    phantom "web-only e2e" claim.

- Updated dependencies []:
  - @dth/rom@0.41.10
  - @dth/ui@0.41.10

## 0.41.9

### Patch Changes

- [#219](https://github.com/polynaut/dth-character-studio/pull/219) [`74f2203`](https://github.com/polynaut/dth-character-studio/commit/74f220345b1c2eeeeb51ee2ad4937b955c657f56) Thanks [@polynaut](https://github.com/polynaut)! - JCM "Modify JCM frames": add a **Mirror** button on each rule that copies it to
  the other side — swapping Left/Right and L/R side tokens in the bone label and
  morph names (shared centre controllers like `!Hip Bend Controller` are left
  untouched; angles/values are copied verbatim). Also set the grid off from the
  base-ROM fields above with a divider + spacing.
- Updated dependencies []:
  - @dth/rom@0.41.9
  - @dth/ui@0.41.9

## 0.41.8

### Patch Changes

- [#217](https://github.com/polynaut/dth-character-studio/pull/217) [`05e9f34`](https://github.com/polynaut/dth-character-studio/commit/05e9f342a05620c5437ebaa93812e21c973e5448) Thanks [@polynaut](https://github.com/polynaut)! - Fix broken linked-asset cards (Daz scene / Houdini project cards rendered too
  narrow with the open icon misplaced). The `@dth/ui` package's Tailwind `@source`
  directive was missing, so utility classes used only in the kit — notably the
  card's `w-80` and `group/card` — were never generated, collapsing the cards to
  content width. Re-added the `@source` scan of `packages/ui/src`.
- Updated dependencies []:
  - @dth/rom@0.41.8
  - @dth/ui@0.41.8

## 0.41.7

### Patch Changes

- [#215](https://github.com/polynaut/dth-character-studio/pull/215) [`8333af9`](https://github.com/polynaut/dth-character-studio/commit/8333af9416d2e461eec2152c5f15dbd200dce350) Thanks [@polynaut](https://github.com/polynaut)! - Follow-up cleanup (no user-facing change): route native app-menu actions through
  a new `desktop.onMenu()` helper so the last raw `@tauri-apps/api/event` import
  leaves the routes (`__root.tsx`, `index.tsx`) — the native boundary is now fully
  concentrated in `lib/desktop.ts`. Also consolidate the reinvented path-normalize
  lambdas into `normalizePath` / `normalizePathLower` in `lib/path.ts`.
- Updated dependencies []:
  - @dth/rom@0.41.7
  - @dth/ui@0.41.7

## 0.41.6

### Patch Changes

- [#213](https://github.com/polynaut/dth-character-studio/pull/213) [`42310c2`](https://github.com/polynaut/dth-character-studio/commit/42310c2bedd7827159c26b9f3a7d3ac2fbabb1c3) Thanks [@polynaut](https://github.com/polynaut)! - Internal architecture hardening (no user-facing behaviour change):

  - Adopt **oxlint** (type-aware) as the lint gate — fixes a handful of real
    latent bugs it surfaced (fire-and-forget promises, object-to-string coercions).
  - CI: the "version packages" PR is now authored with a dedicated token so its
    checks run on their own; PRs must carry a changeset; the release is split into
    a self-hosted **sign** step and a hosted **publish** step.
  - Extract a new **`@dth/ui`** package — an app-agnostic React kit (primitives,
    hooks, and composable components with no Tauri/router/filesystem coupling) so
    the UI is reusable by a future online build and the app stops carrying
    thousand-line god-files.
  - Core (`@dth/rom`) and the Rust backend get cohesion + safety cleanups
    (single frame-offset source, typed FFI returns, env-derived paths).

- Updated dependencies []:
  - @dth/rom@0.41.6
  - @dth/ui@0.41.6

## 0.41.5

### Patch Changes

- [#211](https://github.com/polynaut/dth-character-studio/pull/211) [`7b3b101`](https://github.com/polynaut/dth-character-studio/commit/7b3b101d0d490fb3cc941509b0d3f881c94ea374) Thanks [@polynaut](https://github.com/polynaut)! - Pressing Alt while hovering a reveal target (path chip, Daz/Houdini/Unreal
  card) no longer arms the native menu bar — the key is treated as the
  show-in-Explorer modifier there. Alt anywhere else keeps its normal menu
  behavior.
- Updated dependencies [[`7b3b101`](https://github.com/polynaut/dth-character-studio/commit/7b3b101d0d490fb3cc941509b0d3f881c94ea374)]:
  - @dth/rom@0.41.5

## 0.41.4

### Patch Changes

- [#209](https://github.com/polynaut/dth-character-studio/pull/209) [`4df5164`](https://github.com/polynaut/dth-character-studio/commit/4df5164c8d82d8f9b960272df4d182d4b55e7ec0) Thanks [@polynaut](https://github.com/polynaut)! - The character page's Back links are truly gray now (the global link color was
  overriding them), and holding Alt over a Daz scene / Houdini / Unreal card
  swaps its open icon for a folder icon — previewing the show-in-Explorer click,
  same as the path chips. The Daz scenes / Houdini chips dim everything through
  the character folder, so only the actual subfolder reads bright.

  The reveal hotkey moved from Shift+click to **Alt+click** everywhere (chips and
  cards) — Shift+click was selecting text along the way.

- Updated dependencies [[`4df5164`](https://github.com/polynaut/dth-character-studio/commit/4df5164c8d82d8f9b960272df4d182d4b55e7ec0)]:
  - @dth/rom@0.41.4

## 0.41.3

### Patch Changes

- [#207](https://github.com/polynaut/dth-character-studio/pull/207) [`2d3e0c0`](https://github.com/polynaut/dth-character-studio/commit/2d3e0c060a740a2e306e37331def93553081f02b) Thanks [@polynaut](https://github.com/polynaut)! - Back navigation aligned: every back link is simply "Back", always orange —
  and the character page's sticky header grows its own Back link that fades in
  as you scroll, so navigating back never requires scrolling up first. The
  Unreal bar's empty-state button is just "+ Link" now.

- [#207](https://github.com/polynaut/dth-character-studio/pull/207) [`2d3e0c0`](https://github.com/polynaut/dth-character-studio/commit/2d3e0c060a740a2e306e37331def93553081f02b) Thanks [@polynaut](https://github.com/polynaut)! - G8.1 characters no longer show the "experimental" tag when the standard
  DQS + JCM/FAC preset setup matches — regardless of which DTH release is
  active. G8.1 CSVs target the old-Houdini pipeline's HDA and the G8.1 assets
  are identical across releases, so the validated 188-frame template applies
  either way.

- [#207](https://github.com/polynaut/dth-character-studio/pull/207) [`2d3e0c0`](https://github.com/polynaut/dth-character-studio/commit/2d3e0c060a740a2e306e37331def93553081f02b) Thanks [@polynaut](https://github.com/polynaut)! - Notes render as markdown by default — the Write/Preview tabs are gone. A small
  pencil appears when hovering the notes (an empty note is fully clickable) to
  switch into the editor; Done or Escape returns to the rendered view.
- Updated dependencies [[`2d3e0c0`](https://github.com/polynaut/dth-character-studio/commit/2d3e0c060a740a2e306e37331def93553081f02b), [`2d3e0c0`](https://github.com/polynaut/dth-character-studio/commit/2d3e0c060a740a2e306e37331def93553081f02b), [`2d3e0c0`](https://github.com/polynaut/dth-character-studio/commit/2d3e0c060a740a2e306e37331def93553081f02b)]:
  - @dth/rom@0.41.3

## 0.41.2

### Patch Changes

- [#205](https://github.com/polynaut/dth-character-studio/pull/205) [`cb72bf3`](https://github.com/polynaut/dth-character-studio/commit/cb72bf3ec92d0f0d46e0590d14ae85e6529201c8) Thanks [@polynaut](https://github.com/polynaut)! - The Unreal card's install button keeps it short — tooltip is just "Install DTH
  Content" — and holding Ctrl lights the dimmed button back up on already-
  bootstrapped projects, hinting that a click now re-installs. Path chips
  preview their alternate action too: holding Shift swaps the hover copy icon
  for an open-folder icon.
- Updated dependencies [[`cb72bf3`](https://github.com/polynaut/dth-character-studio/commit/cb72bf3ec92d0f0d46e0590d14ae85e6529201c8)]:
  - @dth/rom@0.41.2

## 0.41.1

### Patch Changes

- [#203](https://github.com/polynaut/dth-character-studio/pull/203) [`69d0105`](https://github.com/polynaut/dth-character-studio/commit/69d01052a02439ba34ebed68e99c4eb418ddd838) Thanks [@polynaut](https://github.com/polynaut)! - Shift+click "show in Explorer" now also works on the Daz scene cards and the
  Houdini project cards — the one hotkey everywhere: plain click opens the file
  in its app, Shift+click reveals its folder.
- Updated dependencies [[`69d0105`](https://github.com/polynaut/dth-character-studio/commit/69d01052a02439ba34ebed68e99c4eb418ddd838)]:
  - @dth/rom@0.41.1

## 0.41.0

### Minor Changes

- [#200](https://github.com/polynaut/dth-character-studio/pull/200) [`00912f4`](https://github.com/polynaut/dth-character-studio/commit/00912f4e02bda8aa62a2e0ab2d67f3961362970f) Thanks [@polynaut](https://github.com/polynaut)! - "Modify JCM frames" — a proper grid UI in the JCM section for bone-rotation
  morph drives (formerly a raw JSON array buried in Advanced Options). Add rules
  (bone + rotation axis) and per-rule morph drives with angle→value ranges split
  by rotation direction; the Morph name field autocompletes from the scanned
  morph index. The old JSON textarea is gone.

- [#200](https://github.com/polynaut/dth-character-studio/pull/200) [`00912f4`](https://github.com/polynaut/dth-character-studio/commit/00912f4e02bda8aa62a2e0ab2d67f3961362970f) Thanks [@polynaut](https://github.com/polynaut)! - Unreal project cards grew up: bigger cards (name + folder) in the footer bar,
  each with a tiny install button that bootstraps the Unreal project with DTH —
  one click copies the linked DTH release's Unreal Engine content into the
  project's `Content/DazToHue`, making a fresh Unreal project DTH-ready in an
  instant. The button dims once the content exists; Ctrl+click always installs
  (overwrite from the currently selected release — files are copied over, never
  deleted first). Unreal linking + content syncing is now in the getting-started
  guide.

### Patch Changes

- [#201](https://github.com/polynaut/dth-character-studio/pull/201) [`635ce6f`](https://github.com/polynaut/dth-character-studio/commit/635ce6f3fff7f57b86f9a3873bb8fee7192ba1aa) Thanks [@polynaut](https://github.com/polynaut)! - Unreal cards now correctly detect installed DTH content (the check always read
  "missing" for normal Windows paths, leaving the install button hot on projects
  that already had `Content/DazToHue` — it re-checks natively now). And
  Shift+click is the app-wide "show in Explorer" hotkey: on an Unreal card it
  opens the project's folder, on any path chip it replaces the old Ctrl+click.
  The chips' hover tooltip is gone — the behaviors are documented in the guide.
- Updated dependencies [[`00912f4`](https://github.com/polynaut/dth-character-studio/commit/00912f4e02bda8aa62a2e0ab2d67f3961362970f), [`00912f4`](https://github.com/polynaut/dth-character-studio/commit/00912f4e02bda8aa62a2e0ab2d67f3961362970f), [`635ce6f`](https://github.com/polynaut/dth-character-studio/commit/635ce6f3fff7f57b86f9a3873bb8fee7192ba1aa)]:
  - @dth/rom@0.41.0

## 0.40.0

### Minor Changes

- [#198](https://github.com/polynaut/dth-character-studio/pull/198) [`9fa6c2e`](https://github.com/polynaut/dth-character-studio/commit/9fa6c2e036d401dcfe272e0c877f308252ed6776) Thanks [@polynaut](https://github.com/polynaut)! - Unreal project cards grew up: bigger cards (name + folder) in the footer bar,
  each with a tiny install button that bootstraps the Unreal project with DTH —
  one click copies the linked DTH release's Unreal Engine content into the
  project's `Content/DazToHue`, making a fresh Unreal project DTH-ready in an
  instant. The button dims once the content exists; Ctrl+click always installs
  (overwrite from the currently selected release — files are copied over, never
  deleted first). Unreal linking + content syncing is now in the getting-started
  guide.

### Patch Changes

- Updated dependencies [[`9fa6c2e`](https://github.com/polynaut/dth-character-studio/commit/9fa6c2e036d401dcfe272e0c877f308252ed6776)]:
  - @dth/rom@0.40.0

## 0.39.0

### Minor Changes

- [#196](https://github.com/polynaut/dth-character-studio/pull/196) [`8702758`](https://github.com/polynaut/dth-character-studio/commit/870275802ebc6f36bf4cdf8b5f45f1cb4fbcc4ae) Thanks [@polynaut](https://github.com/polynaut)! - G8.1 PoseAsset CSVs are validated now — no more "experimental" for the
  standard setup. Ground truth came from a working DTH 1.9.6 PoseAsset node
  (old-Houdini pipeline): a G8.1 character with DQS + JCM/FAC presets and a
  pre-2.0 DTH release selected gets the full 188-frame preset template spliced
  with its custom sections, exactly like G9. The CSV "era" boundary moved to
  DTH 2.0 where the control-row format actually flipped (CTL → CURVE — the G9
  template now correctly requires a 2.0+ release, and releases 2.0–2.4.3 count
  as one era, so switching among them no longer flags characters stale). The
  editor's experimental tag now reflects the real per-configuration validation.

### Patch Changes

- Updated dependencies [[`8702758`](https://github.com/polynaut/dth-character-studio/commit/870275802ebc6f36bf4cdf8b5f45f1cb4fbcc4ae)]:
  - @dth/rom@0.39.0

## 0.38.0

### Minor Changes

- [#194](https://github.com/polynaut/dth-character-studio/pull/194) [`98228d1`](https://github.com/polynaut/dth-character-studio/commit/98228d1c66f4498bdb66a782d0e416600f751260) Thanks [@polynaut](https://github.com/polynaut)! - Multiple Houdini installations: Settings can now hold additional Houdini
  documents folders (older/parallel Houdini versions), each with its own Dry
  run/Install pair for the DTH release's Houdini assets. Pick an older release
  in the version dropdown, install it into the old Houdini's folder, switch the
  dropdown back — the old Houdini keeps the old DTH while your primary stays
  current.

- [#193](https://github.com/polynaut/dth-character-studio/pull/193) [`dbdc712`](https://github.com/polynaut/dth-character-studio/commit/dbdc7121ece1a21127abd3457d96769c502e8f0a) Thanks [@polynaut](https://github.com/polynaut)! - Opening a linked Daz scene now works while Daz Studio is already running. Daz
  (DS 6) silently ignores scene files forwarded to a running instance — Explorer
  double-click does nothing either. The studio detects the running instance and
  routes the open through a one-shot script instead, which Daz forwards and
  executes: the scene opens inside the running instance, with Daz's normal
  unsaved-changes prompt. No instance running → unchanged direct open.

### Patch Changes

- Updated dependencies [[`98228d1`](https://github.com/polynaut/dth-character-studio/commit/98228d1c66f4498bdb66a782d0e416600f751260), [`dbdc712`](https://github.com/polynaut/dth-character-studio/commit/dbdc7121ece1a21127abd3457d96769c502e8f0a)]:
  - @dth/rom@0.38.0

## 0.37.0

### Minor Changes

- [#191](https://github.com/polynaut/dth-character-studio/pull/191) [`910f80f`](https://github.com/polynaut/dth-character-studio/commit/910f80f20d8a6e1d7c6614883f5b306e8254cd96) Thanks [@polynaut](https://github.com/polynaut)! - "Run the export with the ROM script" no longer exports when the ROM build had
  ANY problem. Runtime v20: failed morphs count as failure too (not just hard
  aborts), so a ROM with broken frames can never ship a PoseAsset CSV/FBX as if
  it were good — fix the problem and re-run. Regenerate scripts via Tools →
  Refresh assets (or any character save).

### Patch Changes

- [#190](https://github.com/polynaut/dth-character-studio/pull/190) [`2efabc0`](https://github.com/polynaut/dth-character-studio/commit/2efabc06c603eff60fe697c319fa35b072966285) Thanks [@polynaut](https://github.com/polynaut)! - Confirming "Yes" on the unsaved-changes dialog when closing the window now
  actually closes it. Registering a close-requested listener makes Tauri hold
  every close and destroy the window from the JS side afterwards — and that
  destroy call needed a permission the app never granted, so the window
  silently stayed open.
- Updated dependencies [[`2efabc0`](https://github.com/polynaut/dth-character-studio/commit/2efabc06c603eff60fe697c319fa35b072966285), [`910f80f`](https://github.com/polynaut/dth-character-studio/commit/910f80f20d8a6e1d7c6614883f5b306e8254cd96)]:
  - @dth/rom@0.37.0

## 0.36.3

### Patch Changes

- [#187](https://github.com/polynaut/dth-character-studio/pull/187) [`c3261bf`](https://github.com/polynaut/dth-character-studio/commit/c3261bfd824987ed2936b72c75d38a563a8bbc55) Thanks [@polynaut](https://github.com/polynaut)! - Hardening: zip extraction is bounded (ratio-based size + entry caps) against decompression bombs; recursive-delete rails run on canonicalized paths; a hostile manifest charactersSubdir can no longer traverse outside the project; character schema strings carry generous size bounds; the app has a styled root error boundary.

- [#182](https://github.com/polynaut/dth-character-studio/pull/182) [`2cd7be6`](https://github.com/polynaut/dth-character-studio/commit/2cd7be6b451a63f9ade98e047a860833627e8435) Thanks [@polynaut](https://github.com/polynaut)! - Fix batch: character notes now follow renames and moves (`<Name>.notes.md` is renamed with the definition in save/move/library-root moves, and removed with a loose definition on delete — previously a rename silently orphaned the notes); the unsaved-changes guard now intercepts the native window close (Tauri's ✕ never delivered `beforeunload`); the selection pill floats above the Unreal footer bar instead of overlapping it; styled tooltips track live `title` changes so PathCode's "Copied!" feedback actually shows; non-G9 characters carry an "experimental" chip until the G8/G8.1 CSV path is validated in Houdini.

- [#188](https://github.com/polynaut/dth-character-studio/pull/188) [`198ea5a`](https://github.com/polynaut/dth-character-studio/commit/198ea5a43a4bb5a626f2999954435d501f83d2b8) Thanks [@polynaut](https://github.com/polynaut)! - Notes integrity: autosave failures surface as a toast, and concurrent edits from a second window are detected instead of silently overwritten (reload option offered). Note media is garbage-collected — unreferenced files are removed after an hour on save, with a 7-day housekeeping backstop — and `.duf` preset decompression is bounded.

- [#189](https://github.com/polynaut/dth-character-studio/pull/189) [`aace849`](https://github.com/polynaut/dth-character-studio/commit/aace849c42851c6c2e6dbadc225691fd494d9789) Thanks [@polynaut](https://github.com/polynaut)! - Performance: morph index / character lookup / product scans are cached with cheap staleness checks (no more full re-reads per navigation or window focus); the cross-project prefill list loads lazily instead of stalling the project page on cold network shares; morph autocomplete is indexed and deferred; large product reports skip offscreen rendering; the update dialog's markdown renderer no longer ships in the startup chunk; removed the unused TanStack Query dependency.

- [#184](https://github.com/polynaut/dth-character-studio/pull/184) [`d821d34`](https://github.com/polynaut/dth-character-studio/commit/d821d3431fa5115081960ff0b9090fea822c7089) Thanks [@polynaut](https://github.com/polynaut)! - Internal: split the ROM sections editor into focused components (no behavior change).

- [#186](https://github.com/polynaut/dth-character-studio/pull/186) [`f26a231`](https://github.com/polynaut/dth-character-studio/commit/f26a231e084da6af82815366742c2e95c1b82ee0) Thanks [@polynaut](https://github.com/polynaut)! - Internal: split the storage substrate into focused modules behind the existing barrel (no behavior change) and add baseline tests for settings + library scanning.

- Updated dependencies [[`c3261bf`](https://github.com/polynaut/dth-character-studio/commit/c3261bfd824987ed2936b72c75d38a563a8bbc55)]:
  - @dth/rom@0.36.3

## 0.36.2

### Patch Changes

- [#179](https://github.com/polynaut/dth-character-studio/pull/179) [`a868c65`](https://github.com/polynaut/dth-character-studio/commit/a868c650705ade11ff970c307debb5adced1f0d9) Thanks [@polynaut](https://github.com/polynaut)! - The slide-in drawers (New project, Create character, …) animate reliably again
  — they used to pop in without the transition when the open raced the first
  paint.

- [#180](https://github.com/polynaut/dth-character-studio/pull/180) [`01d5a0f`](https://github.com/polynaut/dth-character-studio/commit/01d5a0f9de90b2ebaa63b8614bf213312e6be4b3) Thanks [@polynaut](https://github.com/polynaut)! - Linked Unreal projects moved into a footer bar docked to the bottom of the
  project window — always visible, compact chips that open the project in Unreal
  on click (folder in the tooltip, hover ✕ unlinks), with the picker and
  drag-drop linking right on the bar.
- Updated dependencies [[`a868c65`](https://github.com/polynaut/dth-character-studio/commit/a868c650705ade11ff970c307debb5adced1f0d9), [`01d5a0f`](https://github.com/polynaut/dth-character-studio/commit/01d5a0f9de90b2ebaa63b8614bf213312e6be4b3)]:
  - @dth/rom@0.36.2

## 0.36.1

### Patch Changes

- [#177](https://github.com/polynaut/dth-character-studio/pull/177) [`172029c`](https://github.com/polynaut/dth-character-studio/commit/172029c552f2fe0e6e6ee0f7da70dda9a838714d) Thanks [@polynaut](https://github.com/polynaut)! - Opening linked Unreal projects works now — the desktop shell-open scope only
  allowed `.duf`/`.hip` files (and https links), so clicking an Unreal card,
  Ctrl+clicking a path chip (folder reveal) or opening non-image note media was
  silently refused. The scope now covers `.uproject`, folders, and the common
  image/video/audio/document/3D media formats (executables stay refused), and
  those open actions surface errors as a toast instead of doing nothing.
- Updated dependencies [[`172029c`](https://github.com/polynaut/dth-character-studio/commit/172029c552f2fe0e6e6ee0f7da70dda9a838714d)]:
  - @dth/rom@0.36.1

## 0.36.0

### Minor Changes

- [#172](https://github.com/polynaut/dth-character-studio/pull/172) [`a2accc6`](https://github.com/polynaut/dth-character-studio/commit/a2accc6ae3bd75041a894904789be7e4f54e7477) Thanks [@polynaut](https://github.com/polynaut)! - Project & character notes — a markdown editor (Write/Preview) on a new Notes
  tab of both the project page and the character page. Autosaves while you type,
  and dropped images/media files are stored with the project (like avatar
  images, under `.dcsmeta/media`) with the right markdown tag inserted at the
  cursor — images render inline in the preview, other media opens with its
  default app. Notes live as plain `notes.md` / `<Name>.notes.md` files next to
  what they describe, so they back up (and read) like everything else.

- [#171](https://github.com/polynaut/dth-character-studio/pull/171) [`8f96436`](https://github.com/polynaut/dth-character-studio/commit/8f96436a67608dc1115a7add87cfe239d5c21bb3) Thanks [@polynaut](https://github.com/polynaut)! - Link Unreal projects to a studio project. The project page gets an "Unreal
  projects" section above the character list: link one or more `.uproject` files
  (picker or drag-and-drop), shown as prominent cards like the character pages'
  Daz scenes / Houdini projects — clicking a card opens the project in Unreal
  Engine. Links only: files stay where they are, unlinking never deletes.

- [#175](https://github.com/polynaut/dth-character-studio/pull/175) [`0f7db81`](https://github.com/polynaut/dth-character-studio/commit/0f7db818b6675ca6afd515eb7d54254adec7ceec) Thanks [@polynaut](https://github.com/polynaut)! - Unsaved changes are guarded now: navigating away from a character editor (or
  the Settings page) with unsaved edits asks "leave and lose them?" first —
  closing or reloading the window warns too. Deleting the character skips the
  question (there is nothing left to save).

### Patch Changes

- [#172](https://github.com/polynaut/dth-character-studio/pull/172) [`a2accc6`](https://github.com/polynaut/dth-character-studio/commit/a2accc6ae3bd75041a894904789be7e4f54e7477) Thanks [@polynaut](https://github.com/polynaut)! - Path chips: Ctrl+click opens the path directly in the Windows Explorer (a file
  path opens its parent folder) — plain click still copies. And the Settings
  page now hints where a Daz Studio installation is usually found.

- [#173](https://github.com/polynaut/dth-character-studio/pull/173) [`90c52f7`](https://github.com/polynaut/dth-character-studio/commit/90c52f7003c51dd52a83f3c17bea56fd70042239) Thanks [@polynaut](https://github.com/polynaut)! - Morph autocomplete: suggestions now show the Daz UI name on its own labeled
  line ("Daz UI name: …"), never truncated — a match on the UI name (e.g.
  searching "GPL*…" where the internal name is "GP*…") is clearly readable
  instead of looking like a wrong suggestion. The match tag spells it out too
  ("UI name match" / "internal match").
- Updated dependencies [[`a2accc6`](https://github.com/polynaut/dth-character-studio/commit/a2accc6ae3bd75041a894904789be7e4f54e7477), [`90c52f7`](https://github.com/polynaut/dth-character-studio/commit/90c52f7003c51dd52a83f3c17bea56fd70042239), [`a2accc6`](https://github.com/polynaut/dth-character-studio/commit/a2accc6ae3bd75041a894904789be7e4f54e7477), [`8f96436`](https://github.com/polynaut/dth-character-studio/commit/8f96436a67608dc1115a7add87cfe239d5c21bb3), [`0f7db81`](https://github.com/polynaut/dth-character-studio/commit/0f7db818b6675ca6afd515eb7d54254adec7ceec)]:
  - @dth/rom@0.36.0

## 0.35.0

### Minor Changes

- [#170](https://github.com/polynaut/dth-character-studio/pull/170) [`14f3ed3`](https://github.com/polynaut/dth-character-studio/commit/14f3ed3c9899cfd732530f7293557a6e05a9df58) Thanks [@polynaut](https://github.com/polynaut)! - The Daz scenes subfolder is now editable on an existing character: the scenes
  folder chip grows a small pencil — editing the subfolder physically moves the
  folder on disk and repoints every linked scene, so nothing breaks. Path chips
  in general now support an optional edit affordance.

- [#169](https://github.com/polynaut/dth-character-studio/pull/169) [`bb695ef`](https://github.com/polynaut/dth-character-studio/commit/bb695efae90d970981a36fd191045a94f3c8a9c8) Thanks [@polynaut](https://github.com/polynaut)! - App-styled tooltips everywhere. Every `title` attribute in the app now shows a
  proper tooltip — rounded, drop-shadowed, on the app's popover surface, smartly
  positioned by Floating UI (flips/shifts at viewport edges) — instead of the
  browser's plain native tooltip. One global host intercepts hover/focus, so all
  existing and future `title=` usage migrates automatically; keyboard focus shows
  the tooltip instantly, and icon-only controls keep an accessible name.

### Patch Changes

- [#167](https://github.com/polynaut/dth-character-studio/pull/167) [`1e1ae08`](https://github.com/polynaut/dth-character-studio/commit/1e1ae082e238f41dbfc2c508809c3340adec18bd) Thanks [@polynaut](https://github.com/polynaut)! - The update dialog now names the installed version as the reference point:
  "Version 0.34.0 is ready to install — you have 0.33.0."
- Updated dependencies [[`14f3ed3`](https://github.com/polynaut/dth-character-studio/commit/14f3ed3c9899cfd732530f7293557a6e05a9df58), [`bb695ef`](https://github.com/polynaut/dth-character-studio/commit/bb695efae90d970981a36fd191045a94f3c8a9c8), [`1e1ae08`](https://github.com/polynaut/dth-character-studio/commit/1e1ae082e238f41dbfc2c508809c3340adec18bd)]:
  - @dth/rom@0.35.0

## 0.34.0

### Minor Changes

- [#166](https://github.com/polynaut/dth-character-studio/pull/166) [`f6259cd`](https://github.com/polynaut/dth-character-studio/commit/f6259cdd2261697ec4bf4e2dd82649beadc9371b) Thanks [@polynaut](https://github.com/polynaut)! - Genesis 8 / 8.1 support. Both generations are now selectable for characters;
  everything is driven by what the installed DTH release actually ships per
  generation: G8.1 gets the full JCM (DQS/Linear) + FAC flow, plain G8 is
  Linear-only (no DQS/FAC assets exist), and Golden Palace / Dicktator / Physics
  remain G9-only — enabling a section whose asset doesn't exist for the
  generation fails loud with a clear message. New ROM entries default to the
  generation's base-figure node (Genesis8_1Female, Genesis8Male, …) instead of
  always Genesis9, skinning defaults to Linear where DTH ships no DQS ROM, and
  the runtime (v19) skips the G9-only mouth ROM pass and FACS/flexion strength
  dials on non-G9 figures instead of failing or logging spurious errors. The
  PoseAsset CSV for non-G9 characters uses the measured custom-sections path
  (the G9 ground-truth template stays G9-only for now).

- [#165](https://github.com/polynaut/dth-character-studio/pull/165) [`fd9fdd9`](https://github.com/polynaut/dth-character-studio/commit/fd9fdd927501acca778b606bb259d41655accb71) Thanks [@polynaut](https://github.com/polynaut)! - Morph scanner scripts + Morph-name autocomplete. The runtime install (v18) now
  also drops visible `Scan_Morphs_G9/G8.1/G8/G3` scripts into the DTH Character
  Studio scripts root: run one on a freshly created (unrenamed) figure in Daz and
  it scans everything dialable on the figure and all its descendants — delta
  morphs AND controller/ERC dials, across geografts like Golden Palace /
  Dicktator, nipples/navel add-ons, fitted clothing — into a per-generation
  JSON index in the studio's app folder. Once an index exists, the
  ROM editor's Morph name fields autocomplete against it: search by the Daz UI
  label or the internal name (each suggestion tags which one matched and the node
  the morph lives on), and picking a suggestion fills in both the internal morph
  name and the correct node.

### Patch Changes

- [#162](https://github.com/polynaut/dth-character-studio/pull/162) [`8888219`](https://github.com/polynaut/dth-character-studio/commit/88882194e18a8f366f95ca250c4fb6ab6af87b1d) Thanks [@polynaut](https://github.com/polynaut)! - **Main → New Project opens the create-project panel again.** The menu entry
  focused/opened the Home window but never opened the dialog. Now an
  already-running Home window gets told to open the panel, and a freshly created
  one starts with it open.

- [#160](https://github.com/polynaut/dth-character-studio/pull/160) [`bdedd9d`](https://github.com/polynaut/dth-character-studio/commit/bdedd9df93ae57a737be4131c9e7ef960ae0c0ec) Thanks [@polynaut](https://github.com/polynaut)! - **Refresh assets now always covers every known project.** Running it from a
  project window used to scope the sweep to that project only — the same button
  meant different things in different windows. It now behaves identically
  everywhere: every known (recent) project is detected and refreshed, plus the
  current window's project even if it isn't in recents yet.

- [#161](https://github.com/polynaut/dth-character-studio/pull/161) [`db82ae3`](https://github.com/polynaut/dth-character-studio/commit/db82ae383cd475d7ed39c193c0c460f14d318afe) Thanks [@polynaut](https://github.com/polynaut)! - **Removed the "Example" ROM prefill.** New characters start Empty or prefill
  from one of your own characters (any project) — the bundled example character
  is gone from the create panel, the API and the guide.

- [#164](https://github.com/polynaut/dth-character-studio/pull/164) [`8ef6ec5`](https://github.com/polynaut/dth-character-studio/commit/8ef6ec58ef04bcf87bd6fab67a5fea0356bc409b) Thanks [@polynaut](https://github.com/polynaut)! - **ROM grid: explained columns + Houdini-safe names.**

  - The **Name** and **Morph name** column headers got info popups: _Name_ is the
    one value that travels to Houdini and later Unreal Engine; _Morph name_ must
    exactly match the morph's internal name in Daz Studio.
  - Names are now normalized as you type: letters, numbers and underscores only —
    Houdini rejects anything else, so spaces/special characters are stripped on
    commit (the same rule the CSV generator already applied).
  - The **Value** column title now sits flush over its numbers instead of
    floating at the column's left edge.
  - The column titles are **sticky** too: they pin right under the sticky section
    title while the grid scrolls - frame numbers, names and values always have
    their labels in view.

- Updated dependencies [[`f6259cd`](https://github.com/polynaut/dth-character-studio/commit/f6259cdd2261697ec4bf4e2dd82649beadc9371b), [`fd9fdd9`](https://github.com/polynaut/dth-character-studio/commit/fd9fdd927501acca778b606bb259d41655accb71)]:
  - @dth/rom@0.34.0

## 0.33.0

### Patch Changes

- [#158](https://github.com/polynaut/dth-character-studio/pull/158) [`70b1f54`](https://github.com/polynaut/dth-character-studio/commit/70b1f54fa7c6638274adf34b084e1975b3814212) Thanks [@polynaut](https://github.com/polynaut)! - **The update dialog now shows what you skipped.** When the installed version is
  several releases behind, the dialog still renders the latest release's notes in
  full — and below them lists the in-between releases (newest first, up to 3) as
  links to their GitHub release pages, so the catch-up path is one click away.
- Updated dependencies [[`ce86c32`](https://github.com/polynaut/dth-character-studio/commit/ce86c32397d2138ece891b98551cad000c35fd3c)]:
  - @dth/rom@0.33.0

## 0.32.3

### Patch Changes

- [#155](https://github.com/polynaut/dth-character-studio/pull/155) [`ca93cfd`](https://github.com/polynaut/dth-character-studio/commit/ca93cfda17e084a5a48ea7409794a76de6e087f1) Thanks [@polynaut](https://github.com/polynaut)! - **ROM editor: insert frames in place + sticky section titles.**

  - Every pose row has a small `+` behind its frame number opening **Add before /
    Add after** right at the icon — a new frame slots in between existing ones
    (inheriting the neighbor's node), the new row's name field is focused
    immediately, and frame numbers simply renumber (computed from order, never
    stored).
  - The ROM section titles (RET, JCM, FAC, …) are now sticky iOS-contacts style:
    the current section's title stays pinned below the page header while its rows
    scroll, and the next section's title pushes it out as it arrives — pure CSS,
    no scroll listeners.

- [#154](https://github.com/polynaut/dth-character-studio/pull/154) [`86a7930`](https://github.com/polynaut/dth-character-studio/commit/86a7930dab6d0d37bf654018bcf1ddbfa271056b) Thanks [@polynaut](https://github.com/polynaut)! - **Settings and Tools got the character editor's sticky header.** The page title
  and back navigation stay visible while the form scrolls, and **Discard / Save**
  now ride the header (top right) — always one click away instead of buried at the
  bottom of a tab. On Settings the header buttons cover both scopes at once: the
  machine settings (General) and, in a project window, the project settings
  (Project tab) — Save persists everything pending, Discard reverts it.
- Updated dependencies []:
  - @dth/rom@0.32.3

## 0.32.2

### Patch Changes

- [#149](https://github.com/polynaut/dth-character-studio/pull/149) [`779339e`](https://github.com/polynaut/dth-character-studio/commit/779339e23d19ee526f500eac1b3ecb59b6225888) Thanks [@polynaut](https://github.com/polynaut)! - **The update dialog now renders its release notes as real markdown** — headings,
  bullets, bold, inline code and links instead of raw `##`/`**` syntax — and the
  dialog is larger with a much taller notes area, so more of the changelog is
  readable at once. Links in the notes open in your browser (never inside the app).
- Updated dependencies []:
  - @dth/rom@0.32.2

## 0.32.1

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.32.1

## 0.32.0

### Patch Changes

- [#142](https://github.com/polynaut/dth-character-studio/pull/142) [`62c4adf`](https://github.com/polynaut/dth-character-studio/commit/62c4adfd171a8287f13172c87548ea7122e01573) Thanks [@polynaut](https://github.com/polynaut)! - **Fix: a JCM base ROM without FAC no longer aborts the run.** The Daz runtime's
  base-ROM loader only reported success when the FAC/mouth ROM also loaded — so a
  character with JCM enabled but FAC disabled (e.g. a custom JCM base asset) loaded
  its base ROM, then silently aborted the rest of the workflow (custom frames never
  applied) and marked the run failed. The base ROM alone now counts as success; FAC
  stays optional. (Pre-existing bug surfaced by the runtime-v16 validation.)
- Updated dependencies [[`bdacdba`](https://github.com/polynaut/dth-character-studio/commit/bdacdba1f4df07e0553ba29ed0ee74eae289a9fc)]:
  - @dth/rom@0.32.0

## 0.31.3

### Patch Changes

- [#135](https://github.com/polynaut/dth-character-studio/pull/135) [`cfa5c6f`](https://github.com/polynaut/dth-character-studio/commit/cfa5c6f9ea55b858f88a212a36ecff45a51754a5) Thanks [@polynaut](https://github.com/polynaut)! - **The "update available" prompt is now an in-app dialog** instead of the native OS
  dialog. When a new version is found, the confirm is rendered in React in the app's
  own style (matching the other dialogs) — with the version, release notes, and
  **Later** / **Update now**. The dialog also shows a "Downloading and installing…"
  state while it works and surfaces any install error inline, then restarts the app.
- Updated dependencies []:
  - @dth/rom@0.31.3

## 0.31.2

### Patch Changes

- [#134](https://github.com/polynaut/dth-character-studio/pull/134) [`05a6233`](https://github.com/polynaut/dth-character-studio/commit/05a62336c617cab8b29e035fa0040f600e1d9dfc) Thanks [@polynaut](https://github.com/polynaut)! - **Rename the per-project "Assets" feature to "Attachments".**

  The optional per-project feature for attaching reusable Daz `.duf` scenes (bases,
  props, looks) now reads as **Attachments** everywhere in the UI — the `Enable
attachments` toggle, the `Characters / Attachments` tab, the `Character / Attachment`
  add choice, and the attachment cards/messages. This removes the confusing overlap
  with the Tools page's **Daz assets** install section (which installs downloaded Daz
  products), so the docs no longer need a "two different things called Daz assets"
  disclaimer. Internal storage is unchanged (`.assets/` folder + `assetsEnabled`
  manifest key), so existing projects keep working with no migration.

- Updated dependencies []:
  - @dth/rom@0.31.2

## 0.31.1

### Patch Changes

- [#130](https://github.com/polynaut/dth-character-studio/pull/130) [`b0058d1`](https://github.com/polynaut/dth-character-studio/commit/b0058d109b71c64d111376dc7546396b20703e78) Thanks [@polynaut](https://github.com/polynaut)! - **Tidy the Home empty-state copy and add deep-dive docs for the optional features.**

  - The "No recent projects" line no longer repeats the "drop one anywhere on the
    page" hint (still shown in the create-project instructions just below).
  - New guide pages document the optional, never-required features: the Tools page,
    the per-project Daz assets feature, and Daz product scanning.

- Updated dependencies []:
  - @dth/rom@0.31.1

## 0.31.0

### Minor Changes

- [#122](https://github.com/polynaut/dth-character-studio/pull/122) [`3e4bd09`](https://github.com/polynaut/dth-character-studio/commit/3e4bd09012b3a47a69d9440428888fa407a8bae7) Thanks [@polynaut](https://github.com/polynaut)! - **Fix a frame-alignment off-by-one + harden generated scripts against injection** (from a full app audit).

  - **Base-less characters no longer desync from Daz.** A character with no preset ROM block (FBM-only, or custom JCM groups) started its first custom frame at 1 in the PoseAsset CSV / exporter reference frames, while Daz built it at 0 — a one-frame misalignment for the whole custom sequence (the exact class of bug the "frames are computed, never stored" invariant exists to prevent). Removed the `Math.max(…, 0)` clamp in all three consumers. Runtime bumped to **v15** so **Tools → Refresh assets** regenerates affected characters' scripts/CSVs.
  - **Daz Script injection closed.** A character `name` containing a newline could break out of the generated `.dsa`'s `//` comment header into executable DzScript — reachable by opening/generating a shared malicious definition. Control chars (CR/LF/U+2028/U+2029) are now stripped from names in comment headers.
  - **CSV injection closed.** Group labels and reference-FBX paths are stripped of commas/newlines so they can't inject extra columns/rows into the Houdini PoseAsset CSV.

### Patch Changes

- [#125](https://github.com/polynaut/dth-character-studio/pull/125) [`cc6f9ad`](https://github.com/polynaut/dth-character-studio/commit/cc6f9ad94b087637afc20fc1199e0c6708045c04) Thanks [@polynaut](https://github.com/polynaut)! - **Persistence + safety fixes** (from a full app audit):

  - **The one-time project-file migration no longer clobbers your settings.** When a project was unreachable (offline drive) during the migration, every relaunch re-wrote _all_ the already-migrated projects' `.dcsp` manifests back to defaults — silently losing per-project settings (and, if `charactersSubdir` had been changed, hiding that project's characters). It now skips any project that already has a manifest.
  - **Changing the characters subfolder now asks first** and moves atomically: it confirms before the (destructive) folder move, and pre-checks every destination for collisions before moving anything — so a collision partway through can't strand some characters at the new root while the manifest still points at the old one.
  - **A manifest with no id gets a stable id** (persisted once) instead of minting a fresh one on every read.
  - **"Open scene" only opens local scene/project files** (`.duf`/`.hip`), refusing arbitrary URLs — a shared character definition can't turn it into a phishing launcher.
  - **External links go through one guarded helper**, so "open on GitHub"-style links also work in the plain-browser build (they previously threw outside the desktop app).

- Updated dependencies [[`3e4bd09`](https://github.com/polynaut/dth-character-studio/commit/3e4bd09012b3a47a69d9440428888fa407a8bae7)]:
  - @dth/rom@0.31.0

## 0.30.0

### Minor Changes

- [#120](https://github.com/polynaut/dth-character-studio/pull/120) [`ce51879`](https://github.com/polynaut/dth-character-studio/commit/ce51879339675f325938d2011c9e422a26eb168b) Thanks [@polynaut](https://github.com/polynaut)! - **Housekeeping: the studio's own generated data can no longer fill your disk.** The two things that used to accumulate unbounded are now managed:

  - **Product-scan files** (the per-Daz-scene CSVs + diagnostics under app-data) **age out after 30 days** — swept automatically on every app launch, and on demand via a new **Tools → Storage & housekeeping → "Clean up now"** button (reports how much it freed). Deleting a character now also removes its scan folder and avatar immediately, so nothing orphans.
  - **The dedup quarantine** (redundant Daz assets you moved aside — a large, reversible backup) is shown with its size in the same section, with an **"Empty quarantine"** button (with a confirm). It's never emptied automatically — you decide when the backup is safe to reclaim.

  Everything else the app writes was already bounded (run logs overwrite, generated artifacts self-prune, temp files self-delete, recents capped). New native commands: `housekeeping_sweep`, `folder_stats`, `empty_folder`.

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.30.0

## 0.29.2

### Patch Changes

- [#115](https://github.com/polynaut/dth-character-studio/pull/115) [`a91d48c`](https://github.com/polynaut/dth-character-studio/commit/a91d48c23720b7271dced957d7ce619a862cad56) Thanks [@polynaut](https://github.com/polynaut)! - **Run-report UX polish.** When the last ROM run had problems, a top-centered "Errors in the last ROM run" mini-alert fades into the sticky character header as you scroll (hidden at the top, where the full report banner is already visible); clicking it scrolls the page back up to the report. In the report, each failed morph is now **clickable** — it opens the ROM section that holds that frame and scrolls the (red-marked) row into view, so you can go straight from the error to the field to fix.

- Updated dependencies []:
  - @dth/rom@0.29.2

## 0.29.1

### Patch Changes

- [#113](https://github.com/polynaut/dth-character-studio/pull/113) [`d7f5d16`](https://github.com/polynaut/dth-character-studio/commit/d7f5d1651bbdf33f8cc50ff18d2d618fe16f1315) Thanks [@polynaut](https://github.com/polynaut)! - **Hotfix: every v0.29.0 ROM script failed with `URIError: !{{ Legacy Include }}`.** Daz resolves `include()` through its legacy-include mechanism, which fails inside a `try/catch` — and v0.29.0's catch-all wrapper had moved the runtime include into one. The include is back at the top level (with a regression-guard test), a `typeof` check covers a missing runtime instead, and the export block is now skipped when the ROM build aborts. **Save each character (or run Tools → Refresh assets once) to regenerate the broken scripts** (script runtime v14).

  Run-report UX, reworked: the Daz dialog is short and generic ("Something went wrong while building the ROM — switch back to DTH Character Studio to see what failed") — the details live in the studio. The studio now **ingests** the Daz-written log into its own `.last_rom_run.json` store and deletes the Daz file (throwaway transport). The report shows above the tabs, **failed morphs mark their rows red in the ROM editor**, and when the report is scrolled off-screen a floating "Errors in the last ROM run — click to see details" hint jumps to it.

- Updated dependencies [[`d7f5d16`](https://github.com/polynaut/dth-character-studio/commit/d7f5d1651bbdf33f8cc50ff18d2d618fe16f1315)]:
  - @dth/rom@0.29.1

## 0.29.0

### Minor Changes

- [#111](https://github.com/polynaut/dth-character-studio/pull/111) [`35ffc96`](https://github.com/polynaut/dth-character-studio/commit/35ffc96a0e31f5e7e62ec7eab51617355dfc3302) Thanks [@polynaut](https://github.com/polynaut)! - **ROM runs now report their problems back to the studio.** The generated Daz script writes a run log (`dth_rom_run_log.json` in the character folder) after every run — listing each morph that couldn't be applied (frame, node, reason) and any other error, including unexpected script failures (a catch-all reports even a missing runtime or a crash mid-run). When something failed, the script ends with a dialog pointing back to the studio, and the character page shows the full list the moment you switch back to it (re-checked on window focus), with a Dismiss button. A clean run clears the previous report automatically.

  **A missing morph can no longer break the ROM's frame alignment.** Frame slots come from the character's declaration, not from what actually applied: a morph that isn't found in the scene is logged and skipped while its frames stay in the ROM (empty), invalid frame numbers are logged instead of silently shortening the timeline, and the legacy per-frame loop no longer drops the rest of a frame's morphs on the first miss — one bad morph costs exactly that morph, nothing else.

  **The character script is now always named `ROM_<Name>_<Genesis>.dsa`** — previously the `ROM_` prefix appeared only in split-export mode. The stale un-prefixed script is cleaned up on the next Save; **Tools → Refresh assets** regenerates all characters (script runtime v13).

### Patch Changes

- Updated dependencies [[`35ffc96`](https://github.com/polynaut/dth-character-studio/commit/35ffc96a0e31f5e7e62ec7eab51617355dfc3302)]:
  - @dth/rom@0.29.0

## 0.28.0

### Minor Changes

- [#106](https://github.com/polynaut/dth-character-studio/pull/106) [`18e6787`](https://github.com/polynaut/dth-character-studio/commit/18e6787b82c74d7291c7164692487490ede09613) Thanks [@polynaut](https://github.com/polynaut)! - **Setup DTH Release** split into two independent installs, each with its own Dry run / Install buttons placed directly under its destination folder field: **Daz content** under "My DAZ 3D Library", **Houdini assets** under "Houdini documents folder". Each half is enabled by its own prerequisites (a resolved DTH release + its destination folder), so you can install only the Daz side or only the Houdini side. The Daz install still re-scans the release's poses on success; the native `install_dth_release` command gained a `target` selector (`daz` / `houdini` / `all`).

### Patch Changes

- [#104](https://github.com/polynaut/dth-character-studio/pull/104) [`d6db042`](https://github.com/polynaut/dth-character-studio/commit/d6db042511c6da702c8a2f02a81fc663f7df537b) Thanks [@polynaut](https://github.com/polynaut)! - Settings: the **DAZ Install Manager manifests folder** field (+ its "Detect installed location" button) moved from the General tab to the **Project tab, directly under the "Enable Daz Products" toggle** it belongs with. It remains a machine-wide setting (stored with the app, shared by all projects — the info popup now says so); the Project tab's Save persists it alongside the project settings. The character page's "set it in Settings" hint points at the new location.

- Updated dependencies []:
  - @dth/rom@0.28.0

## 0.27.0

### Minor Changes

- [#101](https://github.com/polynaut/dth-character-studio/pull/101) [`38aafd3`](https://github.com/polynaut/dth-character-studio/commit/38aafd3a0e5bfd3a0669b60800e4e6e27f4ec7fc) Thanks [@polynaut](https://github.com/polynaut)! - **Install Daz assets** report: each source folder is now a collapsible section. The folder header row (with an asset count) toggles its group of asset rows, so long multi-folder scan reports can be skimmed folder by folder. Folders that need attention (files to copy, or a scan error) start expanded; all-skipped folders ("already installed") start collapsed. The per-asset "files to copy" expansion works as before, and reports without folder headers (DTH release/plugin installs, morphs, Houdini presets) render unchanged.

- [#101](https://github.com/polynaut/dth-character-studio/pull/101) [`38aafd3`](https://github.com/polynaut/dth-character-studio/commit/38aafd3a0e5bfd3a0669b60800e4e6e27f4ec7fc) Thanks [@polynaut](https://github.com/polynaut)! - Add **Daz Products** — an opt-in, per-project scan of which Daz products a character uses. Turn it on in **Settings → Project → Enable Daz Products** (off by default). Each character then gets a generated **`Scan_Products_<Character>.dsa`** alongside its ROM script. Open the character's scene in Daz, run the script, and it analyses the open scene — walking used nodes + non-zero morphs and each node's material texture paths — then matches them to your installed products and writes a CSV the studio reads back.

  Set the **DAZ Install Manager manifests folder** in **Settings → General** (with a one-click **Detect installed location**) so the scan can resolve assets to real product **names, SKUs, artists and versions**; without it the scan still lists the used assets. Back on the character page, enabling the feature splits the editor into **Character** and **Products** tabs (the tabs appear only when Daz Products is on, so the scan never crowds the character form). The **Products** tab surfaces the results — a table of matched products plus an expandable list of unmatched assets (with their source files) — and a **Store on character** action persists them onto the character definition. A **Clear** button (active only while there are scan results to discard) wipes the per-scene CSVs to start fresh, leaving any products already stored on the character untouched. The tab is split into two panels: a **Scan files** panel that always shows which per-scene CSVs back the results — their output folder, and a row per scene with its source `.duf` path, product/unmatched counts and when it was last written — so it's clear what Check / Clear / Store act on and which Daz scene each scan came from; and a separate **Matched products** panel with the listing itself. Once you've stored products, a status banner makes the relationship to the files on disk explicit either way: a green **Up to date** when nothing on disk is newer than your last save, or an amber **scan changed since you last stored** (with the counts — e.g. "11 found now vs 9 stored" — and the save time) when a re-scan has produced new results. The store button follows suit, settling into a disabled **Stored — up to date** instead of an always-active "Update stored products". Each product row **expands** to list the exact scene morph(s)/node(s) that found it (each tagged Morph/Node), so you can see precisely why it's there. Store products (those with a DIM SKU) link out to their **Daz product page**, and scene render-setting singletons (the Tonemapper/Environment "Options" nodes) are excluded so they don't clutter the unmatched list. The **Match** column header carries an info popup explaining each match method (File/Texture, SKU, Keyword, Third-Party, Genesis Base, Parent/Group, Manifest).

  Scans are tracked **per Daz scene**, so a character's outfit/look variants don't overwrite each other. The runtime reads the open scene (`Scene.getFilename()`) and writes one CSV per scene; the studio reads them all and merges, so each product and unmatched asset is tagged with the scene(s) it was found in — a **Scene(s)** column appears once more than one scene has been scanned. When more than one scene has been scanned, a **View** switch ("All scenes" plus one chip per scene) lets you flip between the merged table and a single scene's products; scoping to one scene drops the now-redundant Scene(s) column. Products and unmatched assets are listed **alphabetically**. Open an outfit scene, run the scan, repeat for the next outfit, and the results accumulate with their scene attribution.

  Each matched product shows **what it was used for** in the scene — a heuristic role (Morph, Clothing, Hair, Genitalia, Geograft, Accessory, Figure, …) derived from the assets that matched it, with the specific assets on hover — so you can tell _why_ a product is in the scene. Matching links a used item to its product even when their names share nothing (e.g. a glove node "ACGloves" from "Adventure Outfit"): it reads the node's **material texture paths** — the one file reference Daz exposes for a scene node — across _every_ map channel (diffuse, normal, bump, roughness, metallic, …, not just the base color, so a metal zipper or a procedurally-tinted flower with no diffuse map still matches) and maps their `vendor/product` folder to the product that installed it. A geograft wearing a _copy_ of the figure's body skin (common — the copy-textures workflow) is recognised: the figure's own skin folders are excluded so the geograft isn't mis-identified as the skin product. A texture-folder match is treated as proof the product is genuinely used, so it intentionally bypasses the Genesis prefilter — that's how a G8 outfit auto-fitted onto a G9 figure still matches. An unmatched clothing **sub-part** — a zipper, a flower trim, a dForce layer that loads as its own node parented to the garment — inherits the product its parent matched (a "Parent Match"), provided that parent isn't the base figure, so these stop landing in "unmatched". Sub-parts the scene parents to the _figure_ rather than the garment (so parent-inheritance can't reach them) are caught by a final **"Manifest Match"**: an unmatched node whose name is the basename of a file a product installs (a "Frangipani"/"Zipper" node ↔ `Frangipani.dsf`/`Zipper.dsf`) is attributed to that product — but only to a product _already matched elsewhere in the same scene_, so a generic part name can't pull in an unrelated library product. And a decoration that loads as an empty **group/null node** (no geometry, texture or own file) whose real parts are matched children inherits its children's product (a "Group Match"). Beyond that it is **prefiltered by the character's known Genesis version** (from the studio, not guessed): products for a different generation are rejected and, when several editions of a product are installed (e.g. a G8 _and_ a G9 Golden Palace), the one matching the character's generation wins. It also needs stronger keyword confidence (two distinct shared keywords — a lone generic word like "top" or "inside" can't anchor a match) and pulls in manually-installed (non-DIM) products from `LOCAL_USER_*` metadata so they match instead of landing in "unmatched". As a final resort it **synthesizes products from the content library's `data/<Vendor>/<Product>` folders** ("Content Folder Match"), so content that carries _no_ DIM or `LOCAL_USER` metadata at all — e.g. unofficial products — is still recognised, named by its folder and attributed to its vendor (with the real artist/version read from the content's own files). These run only after the metadata-backed products and are skipped when a real product already owns the folder/name, so they never duplicate or override a properly-tracked product. Products and unmatched assets are enriched with **artist + version read straight from each asset's own `.dsf`/`.duf` metadata** (the vendor's `author` + `revision`), which the DIM install manifests don't carry — content-relative paths are resolved under the library so the real revision surfaces instead of just the DIM build number, and for a matched product a representative file from its file list is read as a fallback. That file list comes from the DIM manifest for store products and from the `LOCAL_USER_*` metadata's own asset list for manual installs — so a manually-installed product like Golden Palace now surfaces its real vendor `author` + `revision` (read from its own `.duf`/`.dsf`) instead of "Unknown". Unmatched assets still show whatever artist/version their files carry.

  Mechanics: a new bundled runtime (`DthProducts.dsa`) is installed once next to the other DTH runtime files; each scan writes a per-scene CSV into an app-local-data folder keyed by project + character id; the character schema gains additive `products` / `productsUnmatched` / `productsScannedAt` fields (each product/asset also carrying the `scenes` it was found in — no migration needed). The runtime version bumped, so **Tools → Refresh assets** regenerates existing characters' scan scripts to the per-scene layout.

- [#101](https://github.com/polynaut/dth-character-studio/pull/101) [`38aafd3`](https://github.com/polynaut/dth-character-studio/commit/38aafd3a0e5bfd3a0669b60800e4e6e27f4ec7fc) Thanks [@polynaut](https://github.com/polynaut)! - Add **assets** — reusable Daz scenes you build characters on top of. Assets are **per-project and opt-in**: turn them on for a project in **Settings → Project → Enable assets** (off by default, so a project shows characters only). Once enabled, the project page gains a **Characters / Assets** tab and the create side panel a matching **Asset** tab. There is no global/shared asset library — assets always live inside their project's `.assets` folder.

  On the Asset tab you pick a `.duf`, give it a name (prefilled from the file) and an optional description, then either **copy it into a hidden `.assets` folder** (optionally under a subfolder) or **link it in place**. The assets grid shows each scene's thumbnail with open-in-Daz and remove actions; removing a copied asset can keep or delete its files, while a linked asset's source is never touched.

  Each project can also set a **Characters subfolder** (Settings → Project): the relative folder character folders are stored under — e.g. `assets/characters` stores them at `<project>/assets/characters/<Character>/`. Empty (the default) keeps them directly in the project root, as before. Changing it **moves the existing character folders** to the new location and repoints the scene / Houdini links inside them.

  Inside a project (with assets enabled), dropping a Daz scene (`.duf`) opens the create panel and the picked scene is carried across a Character/Asset tab switch instead of being lost. On the home page, dropping a project (`.dcsp`) opens it and dropping a folder starts a new project there.

- [#101](https://github.com/polynaut/dth-character-studio/pull/101) [`38aafd3`](https://github.com/polynaut/dth-character-studio/commit/38aafd3a0e5bfd3a0669b60800e4e6e27f4ec7fc) Thanks [@polynaut](https://github.com/polynaut)! - **Tools → DazToHue-Scripts now tracks versions.** Installing records the exact commit it downloaded: the installer resolves the HEAD of `soltude/DazToHue-Scripts` `main`, downloads _that commit's_ tree (so the files always match the recorded SHA), and writes a `.dth-version.json` marker beside them. The tab then shows whether the installed scripts are **up to date** or an **update is available** by comparing that commit against the latest on GitHub — phrased and styled to match the DTH Exporter Plugin status (a green ✓ "Already installed (X) — up to date." line, **Install / Update / Reinstall** button). The check runs when the page opens and degrades to "couldn't check" when offline or rate-limited.

  The DTH Exporter Plugin status in Settings gets the matching treatment too — the same green checkmark on its "Already installed … up to date." line and consistent text sizing across all of its status lines.

- [#101](https://github.com/polynaut/dth-character-studio/pull/101) [`38aafd3`](https://github.com/polynaut/dth-character-studio/commit/38aafd3a0e5bfd3a0669b60800e4e6e27f4ec7fc) Thanks [@polynaut](https://github.com/polynaut)! - Projects are now **`.dcsp` files** ("DTH Character Studio Project") you can scatter anywhere on disk and open by double-clicking.

  - **File association + per-window projects.** The installer registers `.dcsp`; opening one launches (or, if the app is already running, adds) a window pinned to that project. Launching the app directly shows a **Home** launcher — recently opened projects plus **New project** / **Open project…** — and the app menu gains **New Project** (opens Home). Each window works on exactly one project.
  - **Self-contained projects.** A `.dcsp` is a small JSON manifest beside your character folders; per-project meta (avatars) lives next to it in a hidden `.dcsmeta/`. The app-data folder now holds only volatile, machine-specific state (the recent-projects list, machine/tool settings, network drives) — no project registry, no avatars.
  - **Split settings.** Machine/tool paths (DAZ library, Daz install, Houdini docs, DTH release/exporter) stay in **Settings**; per-project behaviour (the Daz/Houdini subfolder names) moved into each project's manifest and is edited from the project page's **Project settings**.
  - **Automatic one-time migration.** On first launch after updating, each previously known project gets a `.dcsp` (seeded from your old settings), its avatars move into the project's `.dcsmeta`, the recents list is built, and the old `projects.json` + app-data `images/` are removed. Unreachable projects are skipped and retried next launch.

- [#101](https://github.com/polynaut/dth-character-studio/pull/101) [`38aafd3`](https://github.com/polynaut/dth-character-studio/commit/38aafd3a0e5bfd3a0669b60800e4e6e27f4ec7fc) Thanks [@polynaut](https://github.com/polynaut)! - Refresh assets is now its own tab under **Tools → Refresh assets**, backed by a version-detection pass. Each of a character's three artifact groups is tracked by exactly one version:

  - **Daz scripts** (ROM + Export `.dsa`, plus the bundled runtime) → the **script runtime version** (new `RUNTIME_VERSION`), stamped in each script header. A bump means the scripts' call API changed, so refresh re-installs the runtime files **and** regenerates the character scripts.
  - **PoseAsset CSV** → the **DTH release**, via CSV-format _eras_ (`POSEASSET_CSV_BREAKING_VERSIONS`, starting at 2.4.3). A CSV is only out of date when the release it was generated for is in a different era than the active release — so moving from 2.4.3 to a non-breaking 2.4.4 stays "all good", while a future breaking release (e.g. 2.5.0, shipped alongside a new CSV variant) flags a refresh. The release the CSV was generated for is recorded in the character JSON (`generatedDthVersion`, schema **v7**) since the CSV itself can't carry a version.
  - **Character JSON** → the **schema version** (migrated + re-saved on refresh).

  The result is a compact **local-vs-app table** (DTH version, character schema, script runtime): each row is green with a checkmark when local matches what the app generates, or red with a yellow warning when it differs. A "refresh needed" banner and the (enlarged, pulsing-when-needed) **Refresh assets** button sit above it. About shows a short summary linking to the page, and on startup — right after the update check — the app routes you to Refresh assets when work is needed.

  **Refresh is now selective:** when something is out of date, each character regenerates only its affected artifact(s); characters that are current are skipped. With nothing out of date, clicking Refresh still force-regenerates everything.

  Refresh and its version table are **scoped to the window**: from a **project window** they cover that project; from the **Home window** they cover every **known** project (the recents list). With no global registry, recents is the set of projects the app knows about, so refreshing from Home brings everything up to date in one pass.

  Also adds a **character-schema migration framework** in `@dth/rom` (`migrateCharacterData` + the `characterMigrations` registry). The pre-versioning shape fix-ups move into it from the web storage layer, and future breaking schema changes register one idempotent step each (additive fields like v7's `generatedDthVersion` need none).

- [#101](https://github.com/polynaut/dth-character-studio/pull/101) [`38aafd3`](https://github.com/polynaut/dth-character-studio/commit/38aafd3a0e5bfd3a0669b60800e4e6e27f4ec7fc) Thanks [@polynaut](https://github.com/polynaut)! - Remove the **Clone character** action from the character page. Creating a character already supports prefilling its ROM definitions from an existing character (Create → prefill), which covers the same need, so the separate clone flow (and its dialog) is gone — the Operations section now just has **Delete**.

### Patch Changes

- [#101](https://github.com/polynaut/dth-character-studio/pull/101) [`38aafd3`](https://github.com/polynaut/dth-character-studio/commit/38aafd3a0e5bfd3a0669b60800e4e6e27f4ec7fc) Thanks [@polynaut](https://github.com/polynaut)! - Smaller UX fixes:

  - **Delete can keep the Houdini files.** When a character's folder has a Houdini subfolder, the delete dialog now offers a second toggle to keep it on disk — mirroring the existing "keep the Daz files" option, and shown only when such a folder actually exists.
  - **Avatar picker works with a single linked scene.** The scene-thumbnail choices in the avatar dialog now appear whenever at least one Daz scene is linked (previously they only showed with two or more), so you can switch the avatar back after unlinking a second scene.
  - **Settings → General is split into two panels:** the settings you can change, and a read-only panel for the app-data folder and detected network drives. The refresh-assets controls have moved out to their own Tools tab.

- Updated dependencies [[`38aafd3`](https://github.com/polynaut/dth-character-studio/commit/38aafd3a0e5bfd3a0669b60800e4e6e27f4ec7fc)]:
  - @dth/rom@0.27.0

## 0.26.1

### Patch Changes

- [#92](https://github.com/polynaut/dth-character-studio/pull/92) [`bdfc23d`](https://github.com/polynaut/dth-character-studio/commit/bdfc23d07aeb3796d4d9ebc5f8d73dea533cbdc3) Thanks [@polynaut](https://github.com/polynaut)! - Fix five bugs in the bundled DTH Daz runtime (`DthUtils.dsa`), surfaced from a generated ROM script's log:

  - **Fence poses restored at bogus frames.** `setFencePoses` iterated the fence-frame array with `for…in`, which in Daz's script engine also yields enumerable `Array.prototype` members — restoring the figure at `function f(){…}` (NaN time) and `""`. Switched to an indexed loop so only the real fence frames are restored.
  - **"Too many arguments" flood.** `getValueChannel(0)` logged `Too many arguments, ignoring 1` on every morph lookup (the method takes no args). Dropped the argument.
  - **Art-direction "Property not found".** Morph resolution now falls back to `findProperty`/`findPropertyByLabel`, so geo-graft "preset" morphs exposed on the figure as alias properties (e.g. Golden Palace `GP_PR_*`) resolve instead of being skipped.
  - **False "Failed to set property".** `setPropertyByName` verifies by reading the value back instead of trusting `setValue`'s return, so a no-op (value already at target, e.g. FACS Detail Strength) no longer logs a false failure.
  - **Implicit-global hygiene.** `oProp`/`oMod`/`oMorph`/`oContentMgr` are now proper `var` declarations, silencing the "used before declaration" warning.

- Updated dependencies []:
  - @dth/rom@0.26.1

## 0.26.0

### Minor Changes

- [`46703e1`](https://github.com/polynaut/dth-character-studio/commit/46703e1a2478734fbe2281923eb497e3570b5be5) Thanks [@polynaut](https://github.com/polynaut)! - - **Native app menu** (desktop): **Main → Refresh assets / Exit** and **Help →
  About / Check for Updates**. Check for Updates now reports "you're on the latest
  version" / "not available in dev" when invoked from the menu.
  - **Avatar picker**: in the character image dialog, a row of linked Daz scene
    thumbnails lets you switch the main avatar to any scene's render. Avatars now use
    a content-versioned filename, so changing one live-updates everywhere (dialog,
    header, lists) without a reload.
  - **Tools**: the **DazToHue-Scripts** tab is now first and the default; its Save
    button is gone (it has no settings); a clear error with a **Settings** link shows
    when "My DAZ 3D Library" isn't set; and the intro links to the repo.
  - **About**: a paragraph crediting Soltude's **DazToHue-Scripts** (optional add-on)
    with a link straight to the in-app installer.

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.26.0

## 0.25.0

### Minor Changes

- [#88](https://github.com/polynaut/dth-character-studio/pull/88) [`ffd930e`](https://github.com/polynaut/dth-character-studio/commit/ffd930e597a05df24e0b53b762065b3072444a9e) Thanks [@polynaut](https://github.com/polynaut)! - Character editor — Daz scene & Houdini project cards polish:

  - **Houdini project cards** now match the Daz scene cards: a gender-based character
    placeholder avatar (with the Houdini logo as a bottom-left badge), a folder path
    chip under the title (shown once a project is linked), a very light orange brand
    tint, and `%CHAR%` standing in for the character folder in the per-card path chip.
  - **Path chips** show `%CHAR%` (the character folder) as the prefix for relative
    paths, and match the header path chip's size.
  - **Card titles** drop the file extension (e.g. `KiraDefault_G9_GP`, `Kira`).
  - All cards share a **fixed width**, **top-aligned** title/chip (so they line up with
    or without a "primary" badge), and the open-in-app icon **pinned bottom-right**.

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.25.0

## 0.24.1

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.24.1

## 0.24.0

### Minor Changes

- [#83](https://github.com/polynaut/dth-character-studio/pull/83) [`a51a795`](https://github.com/polynaut/dth-character-studio/commit/a51a795db9bbbac2a12190226b3417904cbfb480) Thanks [@polynaut](https://github.com/polynaut)! - Character editor: **Import from CSV** now opens a frame-range dialog after you pick
  the file, so a full-scene morph scan (from `DthScanFrames.dsa`) can be sliced to
  just the frames that belong to the section you're importing into. The dialog shows
  the CSV's frame extent and a live in-range morph count, defaulting to the full
  range. Each "Import from CSV" button also gained an info popup explaining how to
  produce the CSV, with a link straight to the DazToHue-Scripts installer in Tools.

- [#83](https://github.com/polynaut/dth-character-studio/pull/83) [`a51a795`](https://github.com/polynaut/dth-character-studio/commit/a51a795db9bbbac2a12190226b3417904cbfb480) Thanks [@polynaut](https://github.com/polynaut)! - Tools: add a **DazToHue-Scripts** tab that downloads the companion
  [soltude/DazToHue-Scripts](https://github.com/soltude/DazToHue-Scripts) repo — the
  Daz Studio scripts behind DTH Character Studio — straight from GitHub and installs
  it into `<My DAZ 3D Library>/Scripts/DazToHue-Scripts`. It delivers
  `DthScanFrames.dsa`, which exports the full morph list of an open Daz scene as a CSV
  you can pull into a character's ROM section via a section's **Import from CSV**.

  The download + unpack run natively (the webview can't fetch the archive — codeload's
  CORS only allows render.githubusercontent.com); GitHub's top-level wrapper folder is
  stripped, the zip is unpacked beside the destination and swapped in (so a failed
  download never leaves a half-written install), and re-installing replaces the folder
  with the latest version. Reuses the reqwest/rustls (ring) stack already in the build
  via the updater, so no new dependencies.

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.24.0

## 0.23.1

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.23.1

## 0.23.0

### Minor Changes

- [#72](https://github.com/polynaut/dth-character-studio/pull/72) [`86941a6`](https://github.com/polynaut/dth-character-studio/commit/86941a68a1a82cb9f402b7b00ddd2a14db39b452) Thanks [@polynaut](https://github.com/polynaut)! - New **Tools → "Daz Studio & Houdini"** page to install and tidy your _own_ Daz/Houdini content (a port of the dth-cli installers, minus the script-repo syncing). Lives under a new muted **Tools** nav item, separate from Settings.

  - **Daz assets** — add multiple asset source folders (Genesis 3/8/9; `.zip`s read from the central directory, no extraction). Content-aware (`data`/`People`/`Runtime`/`Documentation`); copies only files that are missing or a different size, so re-runs are cheap and "already installed" is read from the real files (not guessed). Read-only **Scan** + per-asset expandable file lists. Shared files between _different_ products auto-resolve on install — **newer Genesis wins, then the bigger file** — so only the winner is installed and folder order doesn't matter (your downloaded files are never edited).
  - **Deduplicate** — finds duplicate / version assets (folder or `.zip`) and, on Apply, moves the redundant copies to a quarantine folder you choose (reversible; you pick which copy to keep). Conflicting shared files are shown read-only with the auto-resolved winner marked.
  - **Custom morphs** + **Daz presets** — merge-only installs (add new files, never overwrite your edits), with source + destination folders.
  - **Houdini presets** — replaces the presets folder in your Houdini docs folder and wires `houdini.env` (`SHARED_PRESETS` + `HOUDINI_PATH`).
  - **Danger zone** — clean up leftover Daz folders after uninstalling Daz via Windows "Add or remove programs". "Prefill folder paths" adds the standard Daz locations that currently exist; a guarded "Uninstall Daz" deletes them (Dry run first; inline confirm).

  Each section has a Dry run and a dismissible install report. The copy/scan/dedup run in native Rust (parallelized across assets).

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.23.0

## 0.22.1

### Patch Changes

- [#78](https://github.com/polynaut/dth-character-studio/pull/78) [`b8c270c`](https://github.com/polynaut/dth-character-studio/commit/b8c270c6909e0ee58785956395f17d912c32dbeb) Thanks [@polynaut](https://github.com/polynaut)! - Move the **Daz scripts** write-path out of the character header into its own pane, **Daz scripts generated**, sitting just below the first pane. The header goes back to showing only the character-definition path, and the scripts location reads as a labelled card (with a short info note) — the same chip, now easier to find and less crowded in the header.

- Updated dependencies []:
  - @dth/rom@0.22.1

## 0.22.0

### Minor Changes

- [#76](https://github.com/polynaut/dth-character-studio/pull/76) [`4c3a1d6`](https://github.com/polynaut/dth-character-studio/commit/4c3a1d6342335ca648d1024b2240fc677ab9f180) Thanks [@polynaut](https://github.com/polynaut)! - Drag morphs between groups. The pose drag-and-drop now spans a whole section instead of being locked to one group, so you can move a morph (pose) from one group into another — drop it on a pose to insert at that spot, or on an empty group's body to append — not just reorder within a group. A drag overlay shows the morph you're moving. Handy after a CSV import to redistribute morphs across groups.

- [#76](https://github.com/polynaut/dth-character-studio/pull/76) [`4c3a1d6`](https://github.com/polynaut/dth-character-studio/commit/4c3a1d6342335ca648d1024b2240fc677ab9f180) Thanks [@polynaut](https://github.com/polynaut)! - Import custom morphs from a DAZ-exported CSV. Every section that holds custom morphs (FBM, MISC, EXP, FAC, GEN, PHY) gets an **Import from CSV** button that parses a DAZ morph dump (`frame, , , node, prop, value …`) into poses — one per row, named from a cleaned form of the morph property (`xMusc_body_bs_AnconeusL_B_HD2` → `AnconeusL`, with the raw property kept on the morph) — so you no longer hand-enter long lists of individual morphs (muscles, veins, nails, expressions). Grouped sections get a new group; the flat FBM/MISC list appends to it.

- [#75](https://github.com/polynaut/dth-character-studio/pull/75) [`47c3935`](https://github.com/polynaut/dth-character-studio/commit/47c3935e1f8c2680f6d23dd8844286f765ddcbab) Thanks [@polynaut](https://github.com/polynaut)! - Show the **Daz scripts write-path** as a chip at the top of the character page, so you can see at a glance where the generated `<Name>_<Genesis>.dsa` lands in your DAZ library (`…/Scripts/DTH-Character-Studio/<project>/<character>/`) — i.e. where to find and run it in Daz. Falls back to a hint when "My DAZ 3D Library" isn't set yet.

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.22.0

## 0.21.2

### Patch Changes

- [#73](https://github.com/polynaut/dth-character-studio/pull/73) [`c44e578`](https://github.com/polynaut/dth-character-studio/commit/c44e5788261742ea193a6dff83d26090cbbd61c0) Thanks [@polynaut](https://github.com/polynaut)! - Pose catalog is now scanned live into memory instead of cached on disk — fixing the "No pose catalog yet" errors and removing the whole class of stale/missing-cache problems.

  Previously the pose list was built into a `pose-catalog.json` file only when you pressed **Save** in Settings; installing a release saved the settings (which disabled Save), so a freshly-configured release could be left with no catalog and no way to build one. Now there is no on-disk catalog at all:

  - The active release's `Poses` folder is walked by a native Rust command (one call, ~4–5× faster than the old per-directory JS walk on a network share) and classified in memory.
  - It's scanned on app startup (after network drives are mapped), on first use, and re-scanned automatically whenever the release selection changes (Save or Install) — no manual "rebuild" step.
  - A missing/unreachable release shows a clear error that links to Settings; nothing can silently go stale.

- [#73](https://github.com/polynaut/dth-character-studio/pull/73) [`c44e578`](https://github.com/polynaut/dth-character-studio/commit/c44e5788261742ea193a6dff83d26090cbbd61c0) Thanks [@polynaut](https://github.com/polynaut)! - Daz scene cards on the character page now share a uniform height within a row — previously a card with the "primary" badge stood taller than its siblings.

- Updated dependencies []:
  - @dth/rom@0.21.2

## 0.21.1

### Patch Changes

- [#70](https://github.com/polynaut/dth-character-studio/pull/70) [`303d850`](https://github.com/polynaut/dth-character-studio/commit/303d8504cb9afb3aa9791069686decec2bc82079) Thanks [@polynaut](https://github.com/polynaut)! - Morph values (and the optional base value) are now shown and edited as Daz-style percentages (0–100%) with a "%" suffix, while still stored internally as 0–1 — so a stored value of `1` shows as `100%`, `0.5` as `50%`, matching Daz Studio's UI.

- [#70](https://github.com/polynaut/dth-character-studio/pull/70) [`303d850`](https://github.com/polynaut/dth-character-studio/commit/303d8504cb9afb3aa9791069686decec2bc82079) Thanks [@polynaut](https://github.com/polynaut)! - Scene card tidy-up: the "primary" indicator is now a left-aligned line under the path chip (instead of a top-right badge that crowded the title and widened the card), and the open-in-Daz icon sits bottom-right.

- Updated dependencies []:
  - @dth/rom@0.21.1

## 0.21.0

### Minor Changes

- [#68](https://github.com/polynaut/dth-character-studio/pull/68) [`11c1766`](https://github.com/polynaut/dth-character-studio/commit/11c1766f85494b1c97ff34acb29eb7e1f43b56d3) Thanks [@polynaut](https://github.com/polynaut)! - Export: new **"Run the export with the ROM script"** toggle (in a character's Export directory section). On (default) keeps one combined `<Name>_<Genesis>.dsa` that builds the ROM and runs the export. Off splits it into `ROM_<Name>_<Genesis>.dsa` (builds the ROM) and `Export_<Name>_<Genesis>.dsa` (only runs the exporter + delivers the PoseAsset CSV) — so you can re-export, for another Daz scene or after a failed export, without rebuilding the slow ROM. Run the Export script after the ROM script in the same Daz session.

### Patch Changes

- [#68](https://github.com/polynaut/dth-character-studio/pull/68) [`11c1766`](https://github.com/polynaut/dth-character-studio/commit/11c1766f85494b1c97ff34acb29eb7e1f43b56d3) Thanks [@polynaut](https://github.com/polynaut)! - Removed the "Generate" results panel from the character page — generation feedback is now a concise toast. The character-script install location is shown in Settings under "My DAZ 3D Library".

- [#68](https://github.com/polynaut/dth-character-studio/pull/68) [`11c1766`](https://github.com/polynaut/dth-character-studio/commit/11c1766f85494b1c97ff34acb29eb7e1f43b56d3) Thanks [@polynaut](https://github.com/polynaut)! - New characters created without a pre-filled ROM now start with the **FBM** (full-body morphs) section **disabled** — there's nothing to put there until you add morphs. Characters prefilled from the example or another character keep that source's sections.

- [#68](https://github.com/polynaut/dth-character-studio/pull/68) [`11c1766`](https://github.com/polynaut/dth-character-studio/commit/11c1766f85494b1c97ff34acb29eb7e1f43b56d3) Thanks [@polynaut](https://github.com/polynaut)! - The character's original (primary) Daz scene — the one it was created from — can no longer be unlinked. Its card shows a "primary" badge instead of the unlink ✕; extra scenes stay removable.

- [#68](https://github.com/polynaut/dth-character-studio/pull/68) [`11c1766`](https://github.com/polynaut/dth-character-studio/commit/11c1766f85494b1c97ff34acb29eb7e1f43b56d3) Thanks [@polynaut](https://github.com/polynaut)! - Removed the unused "Target skeleton" (UE5 / DTH) field. It was never read during generation — the PoseAsset CSV is always the UE5 template, and the DTH skeleton node doesn't support CSV import yet — so it was a choice that looked like it mattered but didn't. Dropped the dropdown, the list column, the schema field, and the prefill copy. Existing characters keep working (the stored value is simply ignored).

- Updated dependencies []:
  - @dth/rom@0.21.0

## 0.20.0

### Minor Changes

- [#66](https://github.com/polynaut/dth-character-studio/pull/66) [`4262113`](https://github.com/polynaut/dth-character-studio/commit/426211301ad5d33f7ee024e24c9581a987fb922f) Thanks [@polynaut](https://github.com/polynaut)! - ROM prefill (Create character) now lists matching characters from **all projects**, not just the current one — each labelled `ProjectName - CharacterName` — and copies the ROM from whichever you pick (the source is resolved across projects). Still filtered to the chosen Genesis + gender for ROM compatibility.

- [#66](https://github.com/polynaut/dth-character-studio/pull/66) [`4262113`](https://github.com/polynaut/dth-character-studio/commit/426211301ad5d33f7ee024e24c9581a987fb922f) Thanks [@polynaut](https://github.com/polynaut)! - Projects list (list view) is now an aligned table: the name and path columns size to their widest entry across rows, the path chip hugs its own text instead of stretching, and each project shows its **character count**. Projects added before creation dates were tracked now fall back to the project folder's filesystem creation time, so they're no longer dateless.

### Patch Changes

- [#66](https://github.com/polynaut/dth-character-studio/pull/66) [`4262113`](https://github.com/polynaut/dth-character-studio/commit/426211301ad5d33f7ee024e24c9581a987fb922f) Thanks [@polynaut](https://github.com/polynaut)! - Replaced personal example paths in folder/name input placeholders (DTH release / exporter / Houdini folders, custom JCM path, character name & directory, scene subfolder) with generic ones, so they read sensibly for everyone.

- [#66](https://github.com/polynaut/dth-character-studio/pull/66) [`4262113`](https://github.com/polynaut/dth-character-studio/commit/426211301ad5d33f7ee024e24c9581a987fb922f) Thanks [@polynaut](https://github.com/polynaut)! - List view: the row action controls (rename/move buttons, selection checkbox) no longer overlap the row content (date, metadata). In list view they're now laid out as a flex sibling that reserves its own space, instead of being absolutely positioned over a fixed-width padding gap. Grid view is unchanged.

- [#66](https://github.com/polynaut/dth-character-studio/pull/66) [`4262113`](https://github.com/polynaut/dth-character-studio/commit/426211301ad5d33f7ee024e24c9581a987fb922f) Thanks [@polynaut](https://github.com/polynaut)! - PoseAsset CSV export now **copies** the CSV into the resolved export dir instead of moving it. A move consumed the source after the first scene, so exporting a second Daz scene from the same character (e.g. `KiraDefault` then `KiraSummertide`) left that scene without a CSV. With a copy, every scene's subfolder gets its own CSV and the character folder keeps the canonical one.

- Updated dependencies []:
  - @dth/rom@0.20.0

## 0.19.2

### Patch Changes

- [#63](https://github.com/polynaut/dth-character-studio/pull/63) [`b14ebc2`](https://github.com/polynaut/dth-character-studio/commit/b14ebc21beec2d49d4ce75f2b0afe48016a748e2) Thanks [@polynaut](https://github.com/polynaut)! - Export directory fixes:

  - Changing the export folder (set/clear) or the "Generate subfolders based on Daz scenes" toggle now regenerates the character script immediately, so the generated `.dsa` actually picks up the DTH Exporter auto-export block instead of silently lagging behind the saved setting.
  - The generated script now **moves** the PoseAsset CSV into the resolved export dir at run time — next to the exporter's `<name>.abc`/`.dth`, and inside the scene subfolder when that option is on. Previously the studio dropped the CSV in the export root at generation time, where it couldn't account for the run-time scene subfolder (so it landed in the wrong place and was duplicated).
  - Dropped the false "this folder is inside the project" warning — exporting into a folder inside the project (e.g. a Perforce-tracked `characters/<Name>/houdini`) is a valid setup; the exporter's own character subfolder nests there fine.

- [#63](https://github.com/polynaut/dth-character-studio/pull/63) [`b14ebc2`](https://github.com/polynaut/dth-character-studio/commit/b14ebc21beec2d49d4ce75f2b0afe48016a748e2) Thanks [@polynaut](https://github.com/polynaut)! - Settings: the back link now returns you to wherever you opened Settings from (popping history, like the About page) instead of always jumping to the projects list — and names the destination (e.g. "Back to Kira") when you entered from a character page.

- Updated dependencies []:
  - @dth/rom@0.19.2

## 0.19.1

### Patch Changes

- [#59](https://github.com/polynaut/dth-character-studio/pull/59) [`561d50a`](https://github.com/polynaut/dth-character-studio/commit/561d50acc41855bb9d832a3f766049133295ab31) Thanks [@polynaut](https://github.com/polynaut)! - Always show the "Generate subfolders based on Daz scenes" toggle in the Export
  directory panel — it was previously hidden until an export folder was set, which
  made it undiscoverable. It now renders disabled and muted (with a hint in its
  info popup) until an export folder is chosen.
- Updated dependencies []:
  - @dth/rom@0.19.1

## 0.19.0

### Minor Changes

- [#57](https://github.com/polynaut/dth-character-studio/pull/57) [`b4359a3`](https://github.com/polynaut/dth-character-studio/commit/b4359a3df854de73243a37d06ee8d53a4d469b94) Thanks [@polynaut](https://github.com/polynaut)! - Add a **"Generate subfolders based on Daz scenes"** toggle to the character
  editor's Export directory panel. When on, the generated Daz script resolves the
  open scene at run time via `Scene.getFilename()` and nests the export under a
  subfolder named after it (the exporter's own `<characterName>` subfolder is
  created inside that) — so a character's scene/outfit variants export side by
  side. Falls back to the export root when no scene is saved. Adds
  `exportSceneSubfolders` to the character schema (→ `CHARACTER_SCHEMA_VERSION` 4).

### Patch Changes

- Updated dependencies [[`b4359a3`](https://github.com/polynaut/dth-character-studio/commit/b4359a3df854de73243a37d06ee8d53a4d469b94)]:
  - @dth/rom@0.19.0

## 0.18.0

### Minor Changes

- [#55](https://github.com/polynaut/dth-character-studio/pull/55) [`9c2bbf4`](https://github.com/polynaut/dth-character-studio/commit/9c2bbf4c633fe930d05b21b929fca548044f61f8) Thanks [@polynaut](https://github.com/polynaut)! - Add an **About** page: a new "About" link sits next to Settings on the projects
  home, opening a page with the large app logo, the title "DTH Character Studio
  v&lt;version&gt;" (the running app version), a short description of the studio,
  and a link to the GitHub repository (opens in the OS browser).

- [#55](https://github.com/polynaut/dth-character-studio/pull/55) [`9c2bbf4`](https://github.com/polynaut/dth-character-studio/commit/9c2bbf4c633fe930d05b21b929fca548044f61f8) Thanks [@polynaut](https://github.com/polynaut)! - The studio is now **self-contained**: the DTH runtime (`DthWorkflow.dsa` /
  `DthUtils.dsa` / `DthOptions.dsa`) is bundled into the app and installed from
  there, so it no longer needs a DazToHue-Scripts checkout. The "DazToHue-Scripts
  folder" setting is removed — generating a character installs the runtime
  straight from the bundled copy. (A runtime version, to flag when an app update
  should refresh the bundled files, is planned as a follow-up.)

- [#55](https://github.com/polynaut/dth-character-studio/pull/55) [`9c2bbf4`](https://github.com/polynaut/dth-character-studio/commit/9c2bbf4c633fe930d05b21b929fca548044f61f8) Thanks [@polynaut](https://github.com/polynaut)! - Integrate the DTH Exporter Plugin's new scripting hook (v1.8.1+). A character now
  has an **export directory** (editor → Export section); when set, the generated
  Daz script runs the exporter automatically after building the ROM —
  `dthExportAction.doExport(exportDir, characterName, referenceFrames, false)` — so
  one script builds _and_ exports, no dialog. The reference frames are derived from
  the ROM's reference-skeleton poses (the poses carrying a `referenceFbx`), passed
  space-separated. The exporter creates its own `<characterName>` subfolder, so the
  export directory should sit outside the project (the editor warns otherwise).
  Adds `exportPath` to the character schema (→ `CHARACTER_SCHEMA_VERSION` 3).

### Patch Changes

- [#55](https://github.com/polynaut/dth-character-studio/pull/55) [`9c2bbf4`](https://github.com/polynaut/dth-character-studio/commit/9c2bbf4c633fe930d05b21b929fca548044f61f8) Thanks [@polynaut](https://github.com/polynaut)! - Character editor tidy-up: the **Houdini projects** hint, the **Export directory**
  section intro, and the **ROM** section intro now live in "i" info popups next to
  their labels/headings instead of inline sub-lines, matching the Settings page.
  The "Export" and "Special operations" headings are renamed to "Export directory"
  and "Operations".

- [#55](https://github.com/polynaut/dth-character-studio/pull/55) [`9c2bbf4`](https://github.com/polynaut/dth-character-studio/commit/9c2bbf4c633fe930d05b21b929fca548044f61f8) Thanks [@polynaut](https://github.com/polynaut)! - When a character has an export directory set, the generated PoseAsset CSV is now
  also written into that folder — so it sits next to the exporter's output
  (`<name>.fbx` / `.abc` / `.dth` / …) and the whole package ends up in one folder
  for the next step. The CSV still lives in the character folder too; writing to
  the export folder is best-effort and never fails generation.

- [#55](https://github.com/polynaut/dth-character-studio/pull/55) [`9c2bbf4`](https://github.com/polynaut/dth-character-studio/commit/9c2bbf4c633fe930d05b21b929fca548044f61f8) Thanks [@polynaut](https://github.com/polynaut)! - Drop the first-run "Set your DAZ 3D Library" gate on the projects home — the
  app now opens straight to the projects list and lets you start working. The
  DAZ 3D Library path is still set in Settings, and missing prerequisites are
  surfaced where they matter (character detail / install steps) rather than via
  an upfront prompt.

- [#55](https://github.com/polynaut/dth-character-studio/pull/55) [`9c2bbf4`](https://github.com/polynaut/dth-character-studio/commit/9c2bbf4c633fe930d05b21b929fca548044f61f8) Thanks [@polynaut](https://github.com/polynaut)! - Rename the generated PoseAsset CSV to DTH's convention: `<name>_pose_asset.csv`
  (was `<name>_PoseAsset.csv`). The legacy-cased file is cleaned up from the
  character folder and the export folder on the next generate.

- [#55](https://github.com/polynaut/dth-character-studio/pull/55) [`9c2bbf4`](https://github.com/polynaut/dth-character-studio/commit/9c2bbf4c633fe930d05b21b929fca548044f61f8) Thanks [@polynaut](https://github.com/polynaut)! - **Refresh Assets** now also re-installs the bundled DTH runtime files (once, up
  front) — so after a studio update that ships a newer runtime, one Refresh Assets
  push it to the Daz library even when there are no characters to regenerate. The
  result panel reports the runtime refresh (and any failure).

- [#55](https://github.com/polynaut/dth-character-studio/pull/55) [`9c2bbf4`](https://github.com/polynaut/dth-character-studio/commit/9c2bbf4c633fe930d05b21b929fca548044f61f8) Thanks [@polynaut](https://github.com/polynaut)! - Settings page tidy-up: per-field help text now lives in an info ("i") popup next
  to its label instead of as an inline sub-line — `FolderField` shows one popup
  (its rich `info`, falling back to `help`), the General tab's subfolder fields got
  the same, and the General tab's section blurbs (Refresh assets, App data folder,
  Network drives) moved into popups next to their headings. The DazToHue tab's
  multi-step setup intros stay as visible subtitles. The Exporter install's "close
  all Daz/Houdini apps and restart as administrator" guidance now shows only when
  an install actually fails, styled as an error.
- Updated dependencies [[`9c2bbf4`](https://github.com/polynaut/dth-character-studio/commit/9c2bbf4c633fe930d05b21b929fca548044f61f8), [`9c2bbf4`](https://github.com/polynaut/dth-character-studio/commit/9c2bbf4c633fe930d05b21b929fca548044f61f8)]:
  - @dth/rom@0.18.0

## 0.17.0

### Minor Changes

- [#53](https://github.com/polynaut/dth-character-studio/pull/53) [`c080d34`](https://github.com/polynaut/dth-character-studio/commit/c080d3408c4fbfab2fce0afc03d1efb68e3b41d0) Thanks [@polynaut](https://github.com/polynaut)! - Deleting a project can now remove its files from disk. The project delete
  confirm has a **"Keep project files on disk"** toggle — **off by default**, so
  deleting a project now also deletes its library folder (all character data) and
  its generated-scripts subfolder. Turn the toggle on to remove only the project
  entry and leave every file in place (the previous behaviour). (The shared delete
  dialog was generalised; the character delete keeps its "Keep the Daz files
  folder" toggle, also off by default.)

- [#53](https://github.com/polynaut/dth-character-studio/pull/53) [`c080d34`](https://github.com/polynaut/dth-character-studio/commit/c080d3408c4fbfab2fce0afc03d1efb68e3b41d0) Thanks [@polynaut](https://github.com/polynaut)! - The "Create project" pane now accepts a **dragged-in folder** — drop a folder
  onto the pane to set it as the project's location (the name is suggested from the
  folder, editable), the same way the choose-folder button works. Dropping a file
  uses its containing folder. `FileDropZone` gained an `acceptFolders` mode, since
  folders can't be matched by file extension.

### Patch Changes

- [#53](https://github.com/polynaut/dth-character-studio/pull/53) [`c080d34`](https://github.com/polynaut/dth-character-studio/commit/c080d3408c4fbfab2fce0afc03d1efb68e3b41d0) Thanks [@polynaut](https://github.com/polynaut)! - Deleting a character or project now also removes its generated Daz script folder
  from the library (`…/Scripts/DTH-Character-Studio/<project>/<character>/` for a
  character, the whole `…/<project>/` folder for a project). These are derived
  artifacts that were previously orphaned on delete. The script cleanup runs
  regardless of the "keep files" toggles, since the scripts are always
  regenerated from the character definitions.

- [#53](https://github.com/polynaut/dth-character-studio/pull/53) [`c080d34`](https://github.com/polynaut/dth-character-studio/commit/c080d3408c4fbfab2fce0afc03d1efb68e3b41d0) Thanks [@polynaut](https://github.com/polynaut)! - Fix the generated Daz script failing with "ReferenceError: options is not
  defined". Since generated scripts moved into per-character subfolders, the DTH
  runtime's internal `include()`s (DthWorkflow → DthUtils / DthOptions) still
  resolved relative to the character folder instead of the runtime root, so
  DthOptions never loaded. Those includes are now rewritten to climb two levels to
  the root (matching the character script's own `../../.DthWorkflow.dsa` include).
  Re-generate (save a character, or Settings → Refresh Assets) to update the
  installed runtime.
- Updated dependencies []:
  - @dth/rom@0.17.0

## 0.16.0

### Minor Changes

- [#51](https://github.com/polynaut/dth-character-studio/pull/51) [`9628933`](https://github.com/polynaut/dth-character-studio/commit/9628933c612c8c3761489fb75d4a06d6b2b24690) Thanks [@polynaut](https://github.com/polynaut)! - Projects can now be renamed and moved from the overview. Each project card gets
  two hover actions: **Rename** (the light operation — just changes the name) and
  **Move** (the heavy one — relocates the project to a different folder). A move
  physically relocates all character data to the new folder and repoints every
  character's in-folder references (Daz scenes / Houdini projects stored inside the
  character folder) plus its stored project name/path; scenes linked in place
  outside the project folder are left untouched.

### Patch Changes

- [#51](https://github.com/polynaut/dth-character-studio/pull/51) [`9628933`](https://github.com/polynaut/dth-character-studio/commit/9628933c612c8c3761489fb75d4a06d6b2b24690) Thanks [@polynaut](https://github.com/polynaut)! - Fix Daz scenes becoming "unlinked" after renaming a character. Renaming renames
  the character's folder, but the stored scene/Houdini paths still pointed at the
  old folder name, breaking any scene stored inside the character folder. Renaming
  now repoints those in-folder paths to the new folder (scenes linked in place
  outside the folder are left untouched).
- Updated dependencies []:
  - @dth/rom@0.16.0

## 0.15.1

### Patch Changes

- [#49](https://github.com/polynaut/dth-character-studio/pull/49) [`1e69028`](https://github.com/polynaut/dth-character-studio/commit/1e690282161c797faea15c55352e4f4b73bfb76f) Thanks [@polynaut](https://github.com/polynaut)! - Cloning a character is now a proper flow. The **Clone** button opens a dialog to
  name the copy (pre-filled "<name> copy") and choose whether to **copy its Daz
  scenes** — scenes stored in the character folder are copied into the copy, while
  scenes linked in place are kept as links (their files untouched). After cloning,
  the editor now actually lands on the new copy: it's keyed by the character id, so
  an editor→editor navigation remounts and re-seeds from the copy (previously only
  the URL changed while the editor kept showing the original).

- [#48](https://github.com/polynaut/dth-character-studio/pull/48) [`96b8044`](https://github.com/polynaut/dth-character-studio/commit/96b8044db44d3add68e53790265ff1b976126079) Thanks [@polynaut](https://github.com/polynaut)! - Make asset removal safer so a user can never delete an original file by mistake:

  - **Houdini projects** are only ever linked in place, so the _Remove Houdini
    project_ dialog no longer offers "Delete file on disk" — removal is unlink-only.
  - **Daz scenes** linked in place (outside the character folder) are the user's
    originals, so the _Remove Daz scene_ dialog now shows the "Delete file on disk"
    toggle locked off, with a "Linked in place — your original file is kept" note.
    Scenes copied _into_ the character folder keep the toggle on, as before.

- Updated dependencies []:
  - @dth/rom@0.15.1

## 0.15.0

### Minor Changes

- [#47](https://github.com/polynaut/dth-character-studio/pull/47) [`99ba2ba`](https://github.com/polynaut/dth-character-studio/commit/99ba2ba0ef94c1ff76965f8607f1efe3023d20b2) Thanks [@polynaut](https://github.com/polynaut)! - Character JSONs now carry their owning project's **name and library path**
  (`projectName` / `projectPath`), stamped on every save. Being a shape change,
  this bumps `CHARACTER_SCHEMA_VERSION` to **2** — characters last written before
  this (read as version 1) gain the fields on their next save.

- [#43](https://github.com/polynaut/dth-character-studio/pull/43) [`11d9b77`](https://github.com/polynaut/dth-character-studio/commit/11d9b770b58a2ff059305e708df66bfe705a4c35) Thanks [@polynaut](https://github.com/polynaut)! - Add a **character-JSON schema version**, independent of the app version. A new
  `CHARACTER_SCHEMA_VERSION` constant (starting at `1`) is stamped onto every saved
  character as `schemaVersion`. It changes only when the stored character shape
  changes (a field added, renamed, or removed) — pure app improvements leave it
  untouched. Existing JSONs without the field read as version `1`. This is the
  groundwork for a future migration framework: a stored version below the constant
  marks a definition that needs upgrading.

### Patch Changes

- [#45](https://github.com/polynaut/dth-character-studio/pull/45) [`bf9f145`](https://github.com/polynaut/dth-character-studio/commit/bf9f145a193b6dc7a4b97be1d2ad98264ddf0ebd) Thanks [@polynaut](https://github.com/polynaut)! - Remove the "Keep Houdini files" option from the character delete dialog. Houdini
  projects are only ever linked in place (never copied into the character folder),
  so there was no Houdini subfolder to preserve — the toggle was misleading. The
  delete dialog now offers just "Keep the Daz files folder".
- Updated dependencies [[`99ba2ba`](https://github.com/polynaut/dth-character-studio/commit/99ba2ba0ef94c1ff76965f8607f1efe3023d20b2), [`11d9b77`](https://github.com/polynaut/dth-character-studio/commit/11d9b770b58a2ff059305e708df66bfe705a4c35)]:
  - @dth/rom@0.15.0

## 0.14.0

### Minor Changes

- [#41](https://github.com/polynaut/dth-character-studio/pull/41) [`ce6d790`](https://github.com/polynaut/dth-character-studio/commit/ce6d790f69901930ed48642636a527094167348c) Thanks [@polynaut](https://github.com/polynaut)! - Overhauled the project and character overviews with management controls. Both now have a **grid / list** view toggle and **sort** (name, newest, oldest); the character overview adds **Genesis** and **Gender** filters. Items are **selectable** — the per-item trash button is gone; instead, selecting one or more reveals a bulk-action bar with **Delete**, which opens a confirm modal (for characters, with options to **keep the Daz / Houdini files** on disk). Each character now also has a **Special operations** pane with **Clone** (duplicate into a new copy) and **Delete**.

- [#40](https://github.com/polynaut/dth-character-studio/pull/40) [`2d28983`](https://github.com/polynaut/dth-character-studio/commit/2d28983450883ccd0248d116b121a79d5b38518f) Thanks [@polynaut](https://github.com/polynaut)! - Generalize the "Reset GP before applying extra frames" option: it's now **"Reset genitalia morphs before extra frames"** with a clear description, and it applies to whichever genital ROM is active — Golden Palace _or_ Dicktator — not just GP. The character field `resetGPBeforeApplying` was renamed to `resetGenBeforeApplying` (old definitions migrate automatically on load), and generation now emits the per-block reset flags the DTH runtime understands for both GP and DK.

- [#41](https://github.com/polynaut/dth-character-studio/pull/41) [`ce6d790`](https://github.com/polynaut/dth-character-studio/commit/ce6d790f69901930ed48642636a527094167348c) Thanks [@polynaut](https://github.com/polynaut)! - Generated Daz scripts are now installed into a per-character subfolder —
  `…/Scripts/DTH-Character-Studio/<project>/<character>/<Name>_<Genesis>.dsa` —
  instead of all sitting flat in the `DTH-Character-Studio` root. The DTH runtime
  (`.DthWorkflow.dsa` + `.DthUtils.dsa` + `.DthOptions.dsa`) is installed **once**
  in that root, and each character script now imports it from two levels up. A
  character rename moves its subfolder, and any flat-layout script left by an
  earlier version is cleaned up on the next generate.

### Patch Changes

- [#39](https://github.com/polynaut/dth-character-studio/pull/39) [`e2be4c4`](https://github.com/polynaut/dth-character-studio/commit/e2be4c43415abe4753987b6379a319fa2f6e128b) Thanks [@polynaut](https://github.com/polynaut)! - Give the file drag-and-drop highlight some breathing room — the dashed overlay now floats just outside the content instead of hugging it tightly.

- Updated dependencies [[`2d28983`](https://github.com/polynaut/dth-character-studio/commit/2d28983450883ccd0248d116b121a79d5b38518f), [`ce6d790`](https://github.com/polynaut/dth-character-studio/commit/ce6d790f69901930ed48642636a527094167348c)]:
  - @dth/rom@0.14.0

## 0.13.0

### Minor Changes

- [#37](https://github.com/polynaut/dth-character-studio/pull/37) [`981567d`](https://github.com/polynaut/dth-character-studio/commit/981567dd2c5c2aac6a237a3ab1221ad0555caa7d) Thanks [@polynaut](https://github.com/polynaut)! - Add a **Refresh Assets** button in Settings → General that re-generates the Daz scripts and PoseAsset CSVs for every character across all projects — run it after updating the studio or switching DTH release so every character's generated files match the current version. Per-character failures are reported rather than aborting the sweep, and character definition JSONs are left untouched (they self-migrate on open/save).

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.13.0

## 0.12.0

### Minor Changes

- [#35](https://github.com/polynaut/dth-character-studio/pull/35) [`36310ad`](https://github.com/polynaut/dth-character-studio/commit/36310ad1ff67db36af9348aebfe2c94373bcbaf4) Thanks [@polynaut](https://github.com/polynaut)! - Native OS drag-and-drop for Daz scenes (`.duf`), Houdini projects (`.hip`/`.hipnc`/`.hiplc`) and the character avatar image: drag a file from Explorer onto the **pane** where it's added — the whole area is the drop target, no need to aim at the Browse button, and it highlights while a supported file hovers it. Wired into the new-character scene picker, the editor's Daz scenes and Houdini projects fields, and the avatar image dialog. Built on Tauri's native webview drag-drop (hit-tested to the pane under the cursor), so it works with real Explorer files (HTML5 file drops don't fire when the webview captures OS drops).

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.12.0

## 0.11.0

### Minor Changes

- [#33](https://github.com/polynaut/dth-character-studio/pull/33) [`60d6eb2`](https://github.com/polynaut/dth-character-studio/commit/60d6eb2f0010bf7ea21379dfc1ffeafe3b469366) Thanks [@polynaut](https://github.com/polynaut)! - Show the app data folder in General settings — a read-only path chip pointing at where the app keeps its settings, project list, pose catalog and avatar images, so it's easy to find and back up.

- [#33](https://github.com/polynaut/dth-character-studio/pull/33) [`60d6eb2`](https://github.com/polynaut/dth-character-studio/commit/60d6eb2f0010bf7ea21379dfc1ffeafe3b469366) Thanks [@polynaut](https://github.com/polynaut)! - Record the DTH Character Studio version for traceability: each character JSON now carries a `studioVersion` field stamped on every save, and the generated Daz scripts include the version in their header comment ("generated by DTH Character Studio vX.Y.Z"). The version is read from the app at runtime (blank in the web-only build).

### Patch Changes

- Updated dependencies [[`60d6eb2`](https://github.com/polynaut/dth-character-studio/commit/60d6eb2f0010bf7ea21379dfc1ffeafe3b469366)]:
  - @dth/rom@0.11.0

## 0.10.0

### Minor Changes

- [#32](https://github.com/polynaut/dth-character-studio/pull/32) [`528ba6f`](https://github.com/polynaut/dth-character-studio/commit/528ba6fd041761fa29d5c4cd64f3b8394efe80a6) Thanks [@polynaut](https://github.com/polynaut)! - Measure pose-asset ROM frame lengths on the fly from the actual `.duf` files instead of hard-coding them. A native command (`pose_asset_frames`) reads each preset's DSON (gunzipping if needed) and returns `round(maxKeyTime × 30) + 1`; the base ROM, Golden Palace, Dicktator and Physics blocks are all measured per character — so custom assets (e.g. a user's own JCM `.duf`) work exactly like the DTH ones, and the generated PoseAsset CSV frame offsets are always correct. The editor's absolute frame numbers re-measure live as preset/custom selections change. Generation **hard-errors** if an included asset can't be read (never a silently wrong-length ROM); the `BASE_FRAMES_*`/`GP_FRAMES`/`DK_FRAMES`/`PHYS_FRAMES` constants are gone.

- [#30](https://github.com/polynaut/dth-character-studio/pull/30) [`f3f70d4`](https://github.com/polynaut/dth-character-studio/commit/f3f70d4a4578d60a459e79b63876d6bac5474096) Thanks [@polynaut](https://github.com/polynaut)! - Reorganized the DazToHue settings into two self-contained panes: **Setup DTH Release** (DTH release selection + My DAZ 3D Library + Houdini documents folder + install) and **Setup DTH Exporter Plugin Release** (Exporter Plugin selection + Daz Studio install folder + install). Each has its own dry-run, gating, and report, and the admin-sensitive plugin step fails with a clear "close all Daz and Houdini apps and restart as administrator" message. The Exporter pane also reads the version already installed in the Daz plugins folder and shows up-to-date / update-available, labelling its button Install / Update / Reinstall accordingly. The DazToHue-Scripts folder moved to General settings.

### Patch Changes

- Updated dependencies [[`528ba6f`](https://github.com/polynaut/dth-character-studio/commit/528ba6fd041761fa29d5c4cd64f3b8394efe80a6)]:
  - @dth/rom@0.10.0

## 0.9.0

### Minor Changes

- [#28](https://github.com/polynaut/dth-character-studio/pull/28) [`0bb2151`](https://github.com/polynaut/dth-character-studio/commit/0bb2151e5c351d24f0b17b107bcba5349f420d3a) Thanks [@polynaut](https://github.com/polynaut)! - Remember mapped network drives (X: → \\host\share) as you pick paths and re-map any that are missing on startup — so the app keeps working after you relaunch it as administrator, when Windows hides your interactive drive mappings from the elevated session. A new "Network drives" section in Settings → General lists them with their status, a manual re-map, and a Forget action.

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.9.0

## 0.8.0

### Minor Changes

- [#26](https://github.com/polynaut/dth-character-studio/pull/26) [`eb4a91b`](https://github.com/polynaut/dth-character-studio/commit/eb4a91b24abe0348344d903db9d9458579a5724d) Thanks [@polynaut](https://github.com/polynaut)! - Add an "i" info popup: hover to peek the rich-text content like a tooltip, click the "i" to pin it open for reading longer text and following links (closes on outside click / Escape). Positioned with Floating UI — it flips to wherever there's room and the arrow always points at the trigger. First used on the DTH Exporter Plugin field in Settings.

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.8.0

## 0.7.0

### Minor Changes

- [#24](https://github.com/polynaut/dth-character-studio/pull/24) [`d6d1f1e`](https://github.com/polynaut/dth-character-studio/commit/d6d1f1e01a20dfb0b4d3a6fec25287f253e193d9) Thanks [@polynaut](https://github.com/polynaut)! - Select a DTH Exporter Plugin release in Settings — point at the plugin folder (or a folder of versioned plugin folders) and the version is read straight from the exporter DLL.

- [#24](https://github.com/polynaut/dth-character-studio/pull/24) [`d6d1f1e`](https://github.com/polynaut/dth-character-studio/commit/d6d1f1e01a20dfb0b4d3a6fec25287f253e193d9) Thanks [@polynaut](https://github.com/polynaut)! - One-click install of a DTH release and the Exporter Plugin into your local Daz Studio and Houdini — a native (Rust) port of the dth-cli install commands, with a dry-run preview and new optional settings for the Daz Studio install folder and the Houdini documents folder.

- [#24](https://github.com/polynaut/dth-character-studio/pull/24) [`d6d1f1e`](https://github.com/polynaut/dth-character-studio/commit/d6d1f1e01a20dfb0b4d3a6fec25287f253e193d9) Thanks [@polynaut](https://github.com/polynaut)! - Settings is now organized into **General** and **DazToHue** tabs.

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.7.0

## 0.6.0

### Minor Changes

- [#22](https://github.com/polynaut/dth-character-studio/pull/22) [`55fd976`](https://github.com/polynaut/dth-character-studio/commit/55fd976ef77eaa6c6b9f9c135a0f48e537a2be72) Thanks [@polynaut](https://github.com/polynaut)! - Reworked the creation flows. The new-character form is browse-only with an explicit name (the character folder and its definition file follow that name), and it can prefill its ROM from an existing character of the same Genesis and gender. New projects are created folder-first, suggesting the name from the chosen folder.

- [#22](https://github.com/polynaut/dth-character-studio/pull/22) [`55fd976`](https://github.com/polynaut/dth-character-studio/commit/55fd976ef77eaa6c6b9f9c135a0f48e537a2be72) Thanks [@polynaut](https://github.com/polynaut)! - Characters can now link Houdini projects and open them directly in Houdini. Houdini projects are linked in place and never copied, so their stored absolute import paths keep working. New characters get an empty Houdini folder seeded so there is an obvious place to save the project — both the folder name and whether it is created are configurable in Settings.

- [#22](https://github.com/polynaut/dth-character-studio/pull/22) [`55fd976`](https://github.com/polynaut/dth-character-studio/commit/55fd976ef77eaa6c6b9f9c135a0f48e537a2be72) Thanks [@polynaut](https://github.com/polynaut)! - Characters can now link more than one Daz scene. Adding a scene from outside the character folder offers to copy or move it into a chosen subfolder, the scene folder can be relinked if it is renamed outside the app, and each scene can be unlinked (optionally deleting it from disk). Every scene shows as a card with its Daz `.tip.png` portrait, and clicking it opens the scene in Daz Studio.

### Patch Changes

- [#22](https://github.com/polynaut/dth-character-studio/pull/22) [`55fd976`](https://github.com/polynaut/dth-character-studio/commit/55fd976ef77eaa6c6b9f9c135a0f48e537a2be72) Thanks [@polynaut](https://github.com/polynaut)! - Editor and settings polish: a reusable zoomed-portrait component and Daz-branded scene cards, the character-file path management moved into Advanced options, and new default Daz / Houdini subfolder settings.

- [#22](https://github.com/polynaut/dth-character-studio/pull/22) [`55fd976`](https://github.com/polynaut/dth-character-studio/commit/55fd976ef77eaa6c6b9f9c135a0f48e537a2be72) Thanks [@polynaut](https://github.com/polynaut)! - The character editor's header (avatar + title) now sticks to the top of the
  viewport as the form scrolls beneath it (the Back / Discard / Save row above it
  scrolls away normally). The avatar also **shrinks over the first ~300px of
  scroll and then settles**, so the pinned header collapses to a compact bar — a
  pure CSS scroll-driven animation, which simply no-ops on browsers without scroll
  timelines.
- Updated dependencies [[`55fd976`](https://github.com/polynaut/dth-character-studio/commit/55fd976ef77eaa6c6b9f9c135a0f48e537a2be72), [`55fd976`](https://github.com/polynaut/dth-character-studio/commit/55fd976ef77eaa6c6b9f9c135a0f48e537a2be72)]:
  - @dth/rom@0.6.0

## 0.5.0

### Minor Changes

- [#20](https://github.com/polynaut/dth-character-studio/pull/20) [`4f00e2a`](https://github.com/polynaut/dth-character-studio/commit/4f00e2a1eeda2a2ca23c5027f36b38c24c5119e0) Thanks [@polynaut](https://github.com/polynaut)! - Rework the DTH release settings. The folder now accepts exactly two shapes: a
  single DTH release (detected by its `copyright.txt`), or a folder of versioned
  release folders. A multi-release folder shows a **version dropdown**; the chosen
  version is stored as `currentDthVersion` (`CURRENT_DTH_VERSION`) and, once set,
  newer releases dropped in later don't switch it automatically — you pick and
  save. When unset it pre-selects the latest extracted release and flags the form
  so you save once to record it.

  Saving now (re)builds the pose catalog for the active release — the separate
  "Scan DTH release" button is gone. Zipped releases are listed in the dropdown so
  you can see they exist, but they can't be used directly (Daz can't load poses
  from inside an archive); selecting one shows an "extract the release zip first"
  warning. The "point directly at a Poses folder" option was dropped — we always
  work with a full DTH release.

### Patch Changes

- [#19](https://github.com/polynaut/dth-character-studio/pull/19) [`2fa47cf`](https://github.com/polynaut/dth-character-studio/commit/2fa47cfdd80408c721605d5ca52aab102403cb7f) Thanks [@polynaut](https://github.com/polynaut)! - Remove the "DAZ 3D Library: …path… · change" line from the Projects overview —
  it's redundant there since the library is managed in Settings (reachable via the
  header link). The first-run prompt to set the library (shown only when none is
  configured) is kept.
- Updated dependencies []:
  - @dth/rom@0.5.0

## 0.4.0

### Minor Changes

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - Cache the DTH pose-preset catalog so opening a character is instant.

  Scanning the DTH release folder used to run on every character open — with many
  releases in the folder that took several seconds each time. Now scanning is a
  one-off, explicit step: "Scan DTH release" in Settings resolves the
  highest-versioned release (when the folder holds several), scans + classifies
  its presets, and writes them to a `pose-catalog.json` cache in the app folder.
  Opening or generating a character reads only that cache; it never walks the
  release folder. Zipped releases aren't auto-extracted yet — extract the latest
  one first (the scan reports this). If the catalog hasn't been built, the editor
  points you to Settings to scan.

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - Rework the "new character" form around a Daz scene file. Instead of a free-text
  name, you pick a Daz Studio scene (`.duf`); a second row then appears with a
  **Filepath** (rendered like the editor's, with a `\project\` prefix — prefilled
  `<scene>/<scene>.json`, editable; the subfolder and character name are derived
  from it, and a bare `Name.json` stores in the project root). Genesis and Gender
  stay. The
  scene's `<scene>.tip.png` thumbnail is used as the avatar automatically. The old
  "seed from FBM JSON" field is replaced by an **Optional: Prefill** dropdown
  (Empty / Example) — "Example" seeds the ROM definitions from a bundled example
  character.

  Selecting a scene shows a live avatar preview (its `.tip.png`) under the scene
  field. And if the picked scene lives outside the project, Create asks (in a
  modal) whether to copy it into the character's folder — with a "Subfolder" field
  prefilled `daz3d` — copying the `.duf` plus its `.png` / `.tip.png` thumbnails.

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - Character editor: the **Filepath** field now spans the full width of the card
  (it sits on its own row below the settings instead of being squeezed beside the
  Genesis-specific box), so long paths are fully visible. Characters created from a
  Daz scene now record that scene's path, shown read-only as a **Daz scene** field
  beneath the Filepath. Adds an optional `scenePath` to the character schema
  (empty for characters made before the scene-based create flow).

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - JCM can use a custom pose preset. The Joint Corrective section's second mode is
  now "Custom JCM asset": enter a path to a `.duf` (or pick it with a file dialog)
  and it's loaded as the base ROM exactly like a pre-defined DTH JCM asset —
  driving the skinning (DQS/linear from the file name), the frame layout, and the
  generated `jcmRomPath`. FAC stays a separate section (it mirrors the Houdini
  PoseAsset node), so its optional Mouth asset is still picked there.

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - Add **Open in Daz** / **Link Daz scene** to the character editor. When a
  character's linked scene exists on disk, an "Open in Daz" button opens that
  `.duf` straight into Daz Studio. When the scene is missing (deleted or renamed)
  or was never linked, the button becomes "Link Daz scene": it opens a file picker
  and — if the chosen scene lives outside the project — offers (via the same modal
  as create) to copy it and its thumbnails into the character's folder. Linking
  persists immediately and refreshes the avatar from the new scene. The desktop
  shell `open` scope is widened to permit `.duf` paths (was http/tel/mailto only).

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - Generate one self-contained Daz script per character instead of a pile of files.

  Save now produces a single `<CharacterName>_<Genesis>.dsa` that makes one
  `ApplyDTHCharacter({ … })` call carrying the full character config **and** all ROM
  morph definitions inline — no more separate `_FBMs.json`, `_FBMs.csv`, wrapper
  `.dsa`, or `_*ArtDirection.json` files. It's installed into a shared
  `<My DAZ 3D Library>\Scripts\DTH-Character-Studio` folder, alongside the DTH
  runtime files it imports — `.DthWorkflow.dsa`, `.DthUtils.dsa`, `.DthOptions.dsa`
  (dot-prefixed so they read as hidden; ScanKeyFrames is merged into DthWorkflow),
  copied there from the configured DazToHue-Scripts folder. The Houdini
  `<Name>_PoseAsset.csv` is written into the character's own folder next to its
  definition.

  Requires the matching DazToHue-Scripts runtime that adds the `ApplyDTHCharacter`
  entry point and inline-data support.

### Patch Changes

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - When creating a character and choosing to copy the Daz scene into the project,
  the character's stored `scenePath` now points at the in-project copy rather than
  the original external file (matching the editor's relink behaviour). Previously
  it kept the external path, so "Open in Daz" would open the outside-the-project
  original.

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - Display all filesystem paths with the OS-native separator. A new `displayPath`
  helper rewrites every `/` and `\` to the current platform separator, so the
  editor's definition path, the "Path in project" field, the generate output
  folders, the projects overview, and Settings no longer show a wild mix of
  forward and back slashes.

  Paths rendered as code chips are now click-to-copy via a shared `PathCode`
  component: clicking the chip copies the full path to the clipboard, with a copy
  icon that overlaps the top-right corner on hover.

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - Tidy the character editor's settings: drop the redundant Name field (the title
  is editable inline), group the genesis-specific tuning (FACS detail strength,
  Flexion strength) into a labelled fieldset ("Genesis 9 Specific", ready to swap
  per generation), promote the "Path in project" field to a second row of the base
  settings pane, and move "Reset GP before applying extra frames" into Advanced
  options.

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - The editor's Filepath prefix chip now shows the full project root path (e.g.
  `X:\_3d\dth-characters\`) instead of the `\project\` placeholder, now that the
  field spans the full width.

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - Use the full app-window width on every page (desktop layout) instead of a centered narrow column. Character and pose-preset grids gain columns on wide windows to use the space; forms and settings stay at a comfortable reading width, left-aligned. In the character editor, "Advanced workflow options" is renamed to "Advanced options" and now holds a single editable **Path in project** field — edit it to rename or reorganise a character (e.g. nest it in subfolders); collisions are rejected with a clear message.

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - Show absolute timeline frame numbers for GEN art-direction frames (e.g. 431 for
  ClitorisErect) instead of the relative offset (+103). The GP/DK block's absolute
  start is derived from the base ROM + skinning via a new `genRomStartFrame`
  helper.

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - In the character editor header, the title and its sibling lines now bottom-align
  with the avatar image (sitting lower) instead of being vertically centered.

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - Moving a character (via the Filepath **Move**) now repoints its linked Daz scene
  when the scene lives inside the character folder — the scene travels with the
  folder, so its stored path is rewritten to the new location instead of going
  "Missing". Scenes linked in place outside the character folder are left
  untouched (they didn't move). The editor's Daz scene field updates in step
  without discarding any unsaved edits.

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - Renaming a character now regenerates its files and cleans up the old script.

  A character's generated script is named `<Name>_<Genesis>.dsa`, so renaming
  changed the filename and left the old-named script orphaned in the shared
  `Scripts/DTH-Character-Studio` folder (while the new one wasn't written until the
  next save). Renaming now regenerates at the new name and removes the stale
  previous-named script — and likewise drops the old-named `<Name>_PoseAsset.csv`
  in the character's folder. (The folder itself moves with the rename.)

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - Make the library scan resilient to unreadable character folders. A locked or
  delete-pending folder on a network share makes `readDir`/`exists` throw — Tauri
  reports it as a "forbidden path" because it can't canonicalize the path for its
  fs scope check. The project overview no longer blanks on such a folder
  (`walkFiles` skips it and logs a warning), and creating a character whose target
  folder already exists _or_ can't be probed now rolls the numeric suffix
  (`Name (2)`) instead of failing.

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - Use the styled dropdown (the same shadcn Select as the Genesis/Gender fields)
  for the ROM section pickers — Mode, Asset, and the per-group Generation /
  Calculate-from / Suffix selects — instead of unstyled native `<select>`s, for a
  consistent look.

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - In the character editor, **Save** now also (re)generates all DTH files in the same step — the separate "Generate DTH files" button is gone. Save is the primary action, and a new **Discard** button reverts unsaved changes (enabled only when there are changes).

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - In the editor's Daz scene row, the Open in Daz / Link Daz scene button now sits
  to the left of the scene path chip.

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - Add toast notifications (via [Sonner](https://sonner.emilkowal.ski/)) for meaningful actions: saving + generating a character, creating / renaming / deleting projects and characters, moving a character, uploading an avatar, saving settings, and scanning the DTH release. Errors surface as toasts too.

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - The editor's **Daz scene** path now renders as the same two-tone copyable chip
  as the definition path under the title: the segment matching the project folder
  is dimmed and the rest emphasized, at the same size.
- Updated dependencies [[`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687)]:
  - @dth/rom@0.4.0

## 0.3.2

### Patch Changes

- [#13](https://github.com/polynaut/dth-character-studio/pull/13) [`26df863`](https://github.com/polynaut/dth-character-studio/commit/26df8634c08d082818fc4fce02abad46fde405a0) Thanks [@polynaut](https://github.com/polynaut)! - Rename a character inline from its page — hover the name, click the pencil, edit, and Enter or click away to save (the same interaction as renaming a project). Extracts a shared `EditableTitle` used by both.

- Updated dependencies []:
  - @dth/rom@0.3.2

## 0.3.1

### Patch Changes

- [#11](https://github.com/polynaut/dth-character-studio/pull/11) [`f9e8268`](https://github.com/polynaut/dth-character-studio/commit/f9e826844eeed6a5df53fd20db23c5a29a46bde2) Thanks [@polynaut](https://github.com/polynaut)! - Rename a project inline from its page: hover the title to reveal a pencil, click it to edit, and press Enter or click away to save.

- [#11](https://github.com/polynaut/dth-character-studio/pull/11) [`f9e8268`](https://github.com/polynaut/dth-character-studio/commit/f9e826844eeed6a5df53fd20db23c5a29a46bde2) Thanks [@polynaut](https://github.com/polynaut)! - Switch the UI accent color from teal to the logo's orange (`#fe5c01`) — primary buttons, links, and focus rings.

- Updated dependencies []:
  - @dth/rom@0.3.1

## 0.3.0

### Minor Changes

- [#9](https://github.com/polynaut/dth-character-studio/pull/9) [`03f575d`](https://github.com/polynaut/dth-character-studio/commit/03f575d9d4e77926870c8369fb9d1e4714596b36) Thanks [@polynaut](https://github.com/polynaut)! - Support multiple game projects, each with its own character library. On first run the studio asks for your **"My DAZ 3D Library"** path; the home screen is now a **projects** list — each project is a name + a folder that holds that project's characters. Open a project to manage its characters, with the project name and folder shown.

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.3.0

## 0.2.1

### Patch Changes

- [#6](https://github.com/polynaut/dth-character-studio/pull/6) [`d78e690`](https://github.com/polynaut/dth-character-studio/commit/d78e690659c17d20baef8aa23385c91d9515c08b) Thanks [@polynaut](https://github.com/polynaut)! - Restyle the UI to match Daz Studio's dark palette — warm-neutral grays with a teal/spring-green accent — as a single dark-only theme (no light mode, since Daz and Houdini have none). Removes the leftover light-theme template CSS.

- [#6](https://github.com/polynaut/dth-character-studio/pull/6) [`d78e690`](https://github.com/polynaut/dth-character-studio/commit/d78e690659c17d20baef8aa23385c91d9515c08b) Thanks [@polynaut](https://github.com/polynaut)! - Only render the TanStack DevTools button in development — it was shipping in installed/production builds. Gated on `import.meta.env.DEV`, so the production bundle also drops the devtools code.

- Updated dependencies []:
  - @dth/rom@0.2.1

## 0.2.0

### Minor Changes

- [#2](https://github.com/polynaut/dth-character-studio/pull/2) [`7131015`](https://github.com/polynaut/dth-character-studio/commit/71310154dfd5b07d4f2d1f150c0a66e5c6ac652d) Thanks [@polynaut](https://github.com/polynaut)! - Separate app data from a user-owned character library. Settings and avatars stay
  in the app's private folder; each character now lives in its own folder
  (`<library>/<Name>/`) holding its definition **and** its generated files
  (`.dsa`, FBM JSON, PoseAsset CSV), inside a library folder the user picks and
  backs up. Adds a first-run folder picker, native folder pickers in Settings, and
  a per-character "Storage location" panel to view the absolute path and move a
  character into subfolders.

- [#2](https://github.com/polynaut/dth-character-studio/pull/2) [`7131015`](https://github.com/polynaut/dth-character-studio/commit/71310154dfd5b07d4f2d1f150c0a66e5c6ac652d) Thanks [@polynaut](https://github.com/polynaut)! - Migrate the desktop runtime from Electron to Tauri 2, convert the frontend to a client-rendered SPA, and restructure into a 2-layer monorepo: `@dth/web` (SPA frontend), `@dth/desktop` (Tauri shell), `@dth/rom` (pure generation core). Adds in-app auto-update (GitHub Releases) and a changesets-driven release pipeline.

### Patch Changes

- [#2](https://github.com/polynaut/dth-character-studio/pull/2) [`7131015`](https://github.com/polynaut/dth-character-studio/commit/71310154dfd5b07d4f2d1f150c0a66e5c6ac652d) Thanks [@polynaut](https://github.com/polynaut)! - Store character avatars as a portable reference (a filename or an external URL) instead of a machine-specific asset URL, and resolve the loadable image at render time. Shared character JSON no longer embeds local paths, and a missing local avatar falls back to the initial-letter placeholder instead of a broken image. Legacy avatar values (old asset/Electron-route URLs) migrate to the new form on load.

- Updated dependencies [[`7131015`](https://github.com/polynaut/dth-character-studio/commit/71310154dfd5b07d4f2d1f150c0a66e5c6ac652d)]:
  - @dth/rom@0.2.0
