---
'@dth/desktop': patch
'@dth/web': patch
'@dth/rom': patch
'@dth/ui': patch
---

Houdini Utils: material slots now merge **by surface** instead of being replaced
wholesale or appended by name. A Daz surface can belong to only one material
slot, so copying a `Skin` that merges fifteen surfaces removes exactly the
fifteen slots at the target claiming those surfaces and leaves the clothing and
eye slots untouched — where "Replace at target" previously reduced a 25-slot
node to 1, and appending left the same surfaces claimed twice. A slot claiming a
mix of taken and untaken surfaces keeps the ones nothing else claims. The
confirm dialog now lists what will be replaced at each target before you run,
the report names it afterwards, and both warn when the copied materials claim
surfaces that exist on no slot at the target — the sign that the two nodes
describe different figures. The replace switch now covers UV channels and
texture bakers only.
