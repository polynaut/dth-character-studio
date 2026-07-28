---
'@dth/web': patch
---

The pose grid's morph column is now "Parameter name" (Daz Studio's own term; the guide wording follows, so searching for it finds the answer), with rebalanced column widths, the morphs expansion indented as one block, and a single expanded morph editing in ONE place instead of two live-synced inputs. Info popups across the character page shrank to a sentence plus an "Open guide" link (Name, Parameter name, Bone scale, Import from CSV, Art direction, Advanced options, Export directory), hidden title-tooltips became visible "i" popups (Node/Base/Auto/Value in the pose grid), the Daz scenes title gained one, and the GEN toggle's tooltip lost its tail. The two docked bars (Daz scenes / Unreal projects) are the same 80px height and reserve it while empty — no layout shift on the first link. The read-only Gender row wears the create panel's ♀/♂ badge and states what decided it ("detected Golden Palace", "detected G8 female", …).
