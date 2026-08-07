---
'@dth/desktop': patch
'@dth/web': patch
'@dth/rom': patch
'@dth/ui': patch
---

Houdini Utils → Defaults gains **Make paths portable**, the other half of the
`$JOB` story: repairing `$JOB` fixes the paths you pick from now on, this fixes
the ones already stored. It rewrites every absolute reference sitting under
`$HIP`, `$JOB` or `$DAZ3D_LIB` to be relative to that variable (131 texture
paths on a real project), and rebuilds a DazToHue import path that points at a
file which isn't there — pre-v0.63 projects address their `.dth` through the
retired `dth-exports` junction, so it dangles while the `.fbx` beside it is
fine. The replacement is derived from that same node's other export files and
only written when the file actually exists, so nothing is guessed. Paths under
none of those roots can't be made portable and are reported rather than
silently left. The button stays disabled until `$JOB` is correct, because a
path is made relative to whatever `$JOB` the scene currently carries. Dry run
and rolling backup as usual.
