---
"@dth/web": minor
"@dth/desktop": minor
---

Add **Open in Daz** / **Link Daz scene** to the character editor. When a
character's linked scene exists on disk, an "Open in Daz" button opens that
`.duf` straight into Daz Studio. When the scene is missing (deleted or renamed)
or was never linked, the button becomes "Link Daz scene": it opens a file picker
and — if the chosen scene lives outside the project — offers (via the same modal
as create) to copy it and its thumbnails into the character's folder. Linking
persists immediately and refreshes the avatar from the new scene. The desktop
shell `open` scope is widened to permit `.duf` paths (was http/tel/mailto only).
