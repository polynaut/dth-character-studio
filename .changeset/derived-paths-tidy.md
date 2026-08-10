---
# patch: three corrections to what the derived-path UI says and offers. No new
# capability, no change to what an install does.
'@dth/web': patch
---

**Settings shows only the paths it actually uses, and only the choices that still exist.**

Three small corrections in the same place — the installation cards and the destinations they drive:

- **The DIM downloads folder is no longer listed** under "Paths from this installation". The studio never applies it (your asset sources are your own curation, in Tools → Daz assets), and the "· not used automatically" note beside it did not make that any less confusing: a path shown on a card called *paths from this installation* reads as a path the studio takes from it.
- **"Add another Houdini folder" is hidden while a Houdini installation is activated.** The destination follows that card then — one active installation, one target — so an extra hand-typed folder was an invitation to a second target the card could not account for. A line in its place says where the option went (**Set the paths manually**, in the Houdini installation section). Folders added before the card was activated stay visible and removable.
- **The Houdini destination no longer claims to come from the Daz installation.** It reads "from the Houdini installation above", and a missing one now sends you to the Houdini section — the one that can actually fix it — instead of to the DAZ Install Manager, which never had that path in the first place.
