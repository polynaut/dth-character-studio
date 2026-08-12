---
'@dth/web': patch
---

**Generate Unreal project opens prefilled.**

**Create in** now defaults to an **`unreal` subfolder of the project folder** —
beside `daz3d/` and the characters — instead of wherever the first already-linked
Unreal project happened to sit. A generated project belongs to the DTH project
that generated it, so that is where it lands unless you say otherwise: the path
is an ordinary editable field, and **Browse** still puts it anywhere (an existing
`D:\Unreal Projects`, another drive).

**Project name** is prefilled with the DTH project's own name. The two
namespaces don't agree — a `.dcsp` may be called anything, while Unreal accepts
letters, digits and `_` and won't start with a digit — so the suggestion is
made legal first: illegal characters become `_`, runs collapse, and a leading
digit gets one `_` in front (`3d-workflow` → `_3d_workflow`). A name with
nothing usable left prefills empty rather than suggesting something meaningless.

With both filled, the common case — one DTH project, one Unreal project — is now
open-dialog-and-press-Create.
