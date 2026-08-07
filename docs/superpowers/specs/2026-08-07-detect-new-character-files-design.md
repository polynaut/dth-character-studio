# Detect new character files on focus — design

Date: 2026-08-07
Status: approved (chat), implementing

## Problem

When the user keeps working in Daz Studio (e.g. on an outfit) and saves the result as a new
`.duf` into the character's folder — or saves a new Houdini project there — the studio does not
notice. The scene/project must be added manually via pick or drop. The app should detect such
files itself and offer to link them.

## Decisions (made with the maintainer)

1. **What counts as detectable:** any unlinked, un-ignored candidate file in the character
   folder — including files that predate the feature. No baseline snapshot; detection is
   stateless apart from the ignore list.
2. **Skip is permanent:** skipping a file in the wizard puts it on a persisted per-character
   ignore list. It is never offered again, but can still be added manually (pick/drop).
3. **Banner first, never a surprise modal:** detection surfaces as a non-modal banner on the
   character page ("N new files found — Review"). Clicking Review opens the wizard.

## Detection

A hook (`useDetectedFiles`) runs on character-page mount and on every window `focus`
(`useRefetchOnFocus` from `@dth/ui`), walking the character folder with the tolerant
`walkFiles` (`apps/web/src/lib/rom/storage/fs.ts`). Candidates:

- **Daz scene:** `*.duf` anywhere under the character folder, excluding
  - the `dth-exports` tree (generated exports),
  - `.dcsmeta/` (app-owned),
  - `*_ROM.duf` (generated ROM animations),
  - paths already linked as `scenePath` / `extraScenes` (case-insensitive; Windows paths),
  - ignored paths.
- **Houdini project:** `*.hip|*.hipnc|*.hiplc` anywhere under the character folder, excluding
  - `.dcsmeta/`,
  - any directory named `backup` (Houdini auto-backup),
  - paths already in `houdiniProjects` (case-insensitive),
  - ignored paths.

The candidate filter is a pure function (own module, vitest-covered). The hook
content-compares results so identity is stable when nothing changed, and swallows errors
(same shape as `use-rom-run-log.ts`). Rescan keeps running while the wizard is open — that is
what feeds the live wizard updates.

## Ignore store

`.dcsmeta/characters/<folder>/detected-ignore.json`: a JSON list of character-folder-relative
paths, forward slashes. Read into the filter; appended on Skip. Lives with the rest of the
app-written per-character state (`characterMetaDir`).

## Banner

On the character page, near the top: "2 new Daz scenes and 1 Houdini project found in this
character's folder — Review" + ✕. ✕ hides it for the session only (component state); the files
stay unlinked and un-ignored, so it reappears on next visit. Never steals focus.

## Wizard (`DetectedFilesModal`)

- One page per detected file, "2 of 3" counter, Back/Next.
- **Scene page:** reuses the existing add validation — `sceneWearables` compat vs the primary
  scene + the linked-to-another-character check — rendered with the existing
  `SceneValidationTable`. The file is already inside the character folder, so it is the
  add-in-place variant (no copy/subfolder step). Actions: **Add** / **Skip** (= permanent
  ignore). If the character has no primary scene, the page offers **Set as primary** instead
  of add-as-extra.
- **Houdini page:** file name + path; **Add** (link in place, same case-insensitive dedupe as
  `addProjects`) / **Skip**.
- Acting on a page auto-advances; when every page is handled the wizard closes.
- **Live update:** new detections append pages while open; files that vanish from disk drop
  their page. Pages already acted on are unaffected.

## Targeted extraction

The add-scene validation + commit logic lives as closures in `daz-scene-field.tsx` (~1580
lines). The shared parts (validation fetch, in-place add patch building) move to a small
module used by both the field and the wizard. No behavior change to the existing field.

## Testing

- vitest: the pure candidate filter (exclusion rules, case-insensitivity, linked/ignored
  subtraction).
- Playwright smoke (`apps/web/smoke`): seed files in the fake native layer → focus → banner →
  wizard → add one, skip one → ignore persisted → live append while open.

## Out of scope

- Real filesystem watchers (focus-time detection is sufficient and matches the app's pattern).
- Detection outside the character page (project list badges etc.).
- Copy/move of detected files — they are already where they belong.
