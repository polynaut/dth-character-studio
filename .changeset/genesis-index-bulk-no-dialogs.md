---
'@dth/web': patch
'@dth/rom': patch
---

Tools → Build Genesis Index no longer stalls behind invisible dialogs in a
minimized Daz Studio. The Runner handoff now runs a hidden, dialog-free twin of
the index builder (`.Build_Genesis_Index_Bulk.dsa`, runtime v52): the
confirmation is skipped (the Runner's scene is a fresh empty one — there is
nothing to lose and nobody in front of the window), the summary goes to the Daz
log instead of a modal, and failures ("nothing to build", an unwritable index)
fail the job row loudly so the studio's panel toasts the reason. The handoff
also self-installs the runtime first, so pressing the button right after an app
update just works. Double-clicking the visible `Build_Genesis_Index.dsa` in the
Content Library keeps its dialogs — that path is interactive on purpose.
