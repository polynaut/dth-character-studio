---
"@dth/web": patch
---

Web-layer robustness: all file/folder pickers no-op in a plain browser like the rest of the native boundary (Browse buttons were unhandled rejections there); the export-section switches are single-flight — two quick toggles can no longer run overlapping save+generate rounds that settle the editor to the older result; hovering a character card no longer ingests (and deletes) the Daz-written ROM run log mid-write — ingestion happens only on real visits and the window-focus refetch; a failed inline rename rolls the optimistic name back instead of leaving it as a phantom dirty edit; the network-drive "Forget" and DIM-folder auto-detect surface their errors instead of rejecting silently; the unsaved-changes prompt always shows its current message; and the `dirOf` path helper lives once in lib/path instead of twice inline.
