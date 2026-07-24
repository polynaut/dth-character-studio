---
'@dth/web': patch
---

feat(web): show the picked scene's full path + a Cancel button in the copy dialog

The "copy this Daz scene in?" dialog (both the create flow and the editor's
Add-scene flow) now shows the selected file's full path as a copyable chip under a
"Selected file" label, so you can confirm which `.duf` you picked before copying.
The footer also gains a ghost **Cancel** button (left-aligned) to dismiss the
dialog alongside Link-in-place / Copy.
