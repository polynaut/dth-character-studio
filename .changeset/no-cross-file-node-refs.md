---
'@dth/desktop': patch
'@dth/web': patch
'@dth/rom': patch
'@dth/ui': patch
---

Utils: a copied parameter never carries a reference to the source project's nodes

The DazToHue HDA's own **Linking** feature rewrites a node's parameters to
`ch("<source>/<parm>")` so it mirrors another node. Copying *from* a linked node
used to carry those expressions across files — and because DTH names every node
identically between projects, such a reference silently **rebinds** to the target
project's own node and reads wrong values without erroring.

Export now flattens any node-referencing expression to its evaluated value.
Expressions with no node reference still travel as expressions.
