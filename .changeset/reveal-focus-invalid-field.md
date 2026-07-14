---
"@dth/web": patch
---

When a blocked Save jumps to the offending pose row, focus the field that's actually flagged. It used to focus the first *empty* input in the row, which for a filled-but-invalid name (e.g. one with a space) landed on the empty optional Reference FBX field instead. It now prefers the red-bordered (`aria-invalid`) input and only falls back to the first empty one — so the cursor lands where the error is.
