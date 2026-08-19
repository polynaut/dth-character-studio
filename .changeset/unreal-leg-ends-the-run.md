---
'@dth/web': patch
---

The Unreal leg now ends the run instead of parking it at 100%. The editor's answer arrives as the leg's own sticky outcome toast (success / partial-warning / error) and clears the task panel — it used to become a status line under a bar frozen at 100% forever. Queuing got quieter to match: a clean send raises no toast at all (the task rows and status line already carry it), a dropped set arrives as a warning toast, and a Daz-run-plus-Skip-Houdini send now shows its own task rows instead of being invisible until the editor answered.
