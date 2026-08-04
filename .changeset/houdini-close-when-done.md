---
'@dth/web': patch
---

A DTH Export Houdini leg now **closes Houdini again** once its exports are
done: the job carries a `closeWhenDone` flag and `456.py` exits the instance
from inside (save prompt suppressed — the scene is deliberately never saved)
right after writing its final result. A queue of projects no longer stacks
open Houdini windows, and a session you opened yourself is never touched.
**Open only** still leaves the project open to work in.
