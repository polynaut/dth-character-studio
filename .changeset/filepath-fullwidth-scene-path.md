---
"@dth/web": minor
"@dth/rom": minor
---

Character editor: the **Filepath** field now spans the full width of the card
(it sits on its own row below the settings instead of being squeezed beside the
Genesis-specific box), so long paths are fully visible. Characters created from a
Daz scene now record that scene's path, shown read-only as a **Daz scene** field
beneath the Filepath. Adds an optional `scenePath` to the character schema
(empty for characters made before the scene-based create flow).
