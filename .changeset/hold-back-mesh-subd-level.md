---
'@dth/web': patch
'@dth/rom': patch
---

**Mesh SubD level is held back** — reverted before it reached a release.

The feature stamps one subdivision level on the viewport dial and the render
dial of every mesh under the figure, and it was built against **guessed Daz
property names**: there was no live Daz Studio to measure them on. The design
absorbs that (candidate names, then a search by shape, then a read-back of every
setter, and a run warning when nothing is found), but "absorbs it" is not
"verified", and the one thing the feature promises — that what you judge a pose
on is what gets exported — is exactly the thing that cannot be claimed until a
real figure has been stamped.

So it comes out of this release rather than shipping unverified. Nothing changes
for anyone: it merged and was reverted without a version in between, so no build
ever offered the setting. It goes back in once the property names are measured.
