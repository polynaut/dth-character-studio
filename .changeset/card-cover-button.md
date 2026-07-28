---
'@dth/ui': patch
---

LinkedAssetCard's select/open action moved from the body (which was a `<button>`) to a transparent cover button, so interactive content in the `extra` slot — like the scene cards' edit-to-move path chip — is no longer nested inside a button (invalid HTML). Behavior is unchanged; hover tints now key off the card group.
