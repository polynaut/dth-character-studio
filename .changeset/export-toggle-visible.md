---
"@dth/web": patch
---

Always show the "Generate subfolders based on Daz scenes" toggle in the Export
directory panel — it was previously hidden until an export folder was set, which
made it undiscoverable. It now renders disabled and muted (with a hint in its
info popup) until an export folder is chosen.
