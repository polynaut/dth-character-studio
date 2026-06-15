---
"@dth/web": minor
---

Rework the "new character" form around a Daz scene file. Instead of a free-text
name, you pick a Daz Studio scene (`.duf`); a second row then appears with a
**Name** (prefilled from the scene's filename, editable) and a **Path** (a
subfolder relative to the project, prefilled the same — clear it to store the
character's files directly in the project root). Genesis and Gender stay. The
scene's `<scene>.tip.png` thumbnail is used as the avatar automatically. The old
"seed from FBM JSON" field is replaced by an **Optional: Prefill** dropdown
(Empty / Example) — "Example" seeds the ROM definitions from a bundled example
character.

Selecting a scene shows a live avatar preview (its `.tip.png`) under the scene
field. And if the picked scene lives outside the project, Create asks (in a
modal) whether to copy it into the character's folder — with a "Subfolder" field
prefilled `daz3d` — copying the `.duf` plus its `.png` / `.tip.png` thumbnails.
