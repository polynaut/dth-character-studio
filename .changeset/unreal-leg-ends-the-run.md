---
'@dth/web': patch
---

The Unreal leg now ends the run instead of parking it at 100%, and tells the truth in between. The editor's answer arrives as the leg's own sticky outcome toast (success / partial-warning / error) and clears the task panel — it used to become a status line under a bar frozen at 100% forever. The stretch before it stopped lying too: the status line now says when the studio is opening the editor, and flips to "importing — the editor freezes while the DazToHue pipeline runs" the moment the bridge claims the job, instead of sitting on "waiting for the editor to pick the job up" through the whole import. Queuing got quieter to match: a clean send raises no toast at all (the task rows and status line already carry it), a dropped set arrives as a warning naming **only** the drop (the old combined wording read as if the queued set had failed), and a Daz-run-plus-Skip-Houdini send now shows its own task rows instead of being invisible until the editor answered.
