---
'@dth/web': patch
---

Failed-morph rows in the ROM editor are now marked by the **morph itself**, not by its row position. The run report stores frame numbers from run time, while the grid renumbers frames on every edit — so after deleting or reordering rows, the red marks stayed on the old positions and lit up whatever morph had moved into them. Rows walking a reported morph are now red immediately when the report appears (no longer only after selecting the failing scene), stay red through edits, and clicking a failure in the report jumps to the morph's actual row.
