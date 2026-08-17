---
'@dth/web': minor
---

Deleting a Daz scene now cleans up after itself.

Removing a scene with **Delete file on disk** ticked used to delete the scene
file and its thumbnails but leave the scene's subfolder behind — with the saved
`rom-animations/` inside it still filling the disk. Now the scene's own
subfolder is deleted whole, saved ROM animations included.

A scene that shares its folder with others (the pre-subfolder layout parked
every scene directly in the scenes root) loses only its own files plus its own
`rom-animations/<stem>_ROM.duf` — a folder any other linked scene still uses is
never touched, and a linked-in-place scene stays unlink-only as before. The
remove dialog now says which of the two a delete will do.
