---
'@dth/web': minor
'@dth/rom': minor
---

**Mesh SubD level** — one subdivision level for the viewport and the render.

Daz keeps those two as separate dials, and they are routinely set differently.
That is not cosmetic: it means the mesh you judge a pose on is not the mesh that
gets rendered, and not the mesh the DTH export captures. So the obvious question
about any mesh artefact — is this coming from the exporter, or is it in the scene
already? — cannot be answered by looking at it, which is exactly the question you
want to answer by looking.

A character now carries a **Mesh SubD level** (character settings, every
generation). Pick one and the ROM script stamps *both* dials, at that level, on
the figure and everything under it — geografts, conformed clothing — before it
poses or keys anything. A level above 0 also switches those meshes to High
Resolution, because a subdivision level on a base-resolution mesh does nothing at
all, silently.

The default is **Leave as-is**, which touches nothing — every existing character
keeps behaving exactly as it did. A level a mesh refuses is reported as a warning
and the export still runs on that scene's own subdivision; it never cancels an
export over what is a cosmetic mismatch.

**Export only** gets the level too, without stamping anything itself: it
re-exports the saved ROM animation, which was written after the stamp and
carries it. What follows is a staleness rule rather than a gap — a saved ROM
carries the level it was built with, so changing the level reaches an export
only once the ROM is rebuilt.
