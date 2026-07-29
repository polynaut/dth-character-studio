---
'@dth/web': minor
---

feat(web): a new character's **export directory** starts pointed at its seeded **Houdini subfolder** — the same folder the "Choose folder…" picker already opened in, so direct export works from the first Save instead of needing a trip through the folder dialog. Nothing to point at means nothing is set: with the project's *Create Houdini subfolder* switched off, or for a definition dropped loose in the project root, the export directory stays empty exactly as before. An existing path (a prefilled/imported definition) is never overwritten. The seed folder and the export path are now decided in one place, `createCharacterAt` — the only code that knows the folder the create actually landed in, since a name collision auto-suffixes it.
