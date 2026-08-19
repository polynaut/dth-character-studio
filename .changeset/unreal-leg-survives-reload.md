---
# bump: patch is deliberate — adoptUnrealImports is internal plumbing for a
# bug fix (the leg forgetting its state on reload), not a new user capability:
# it restores what the run already promised, exactly like the sidecar restores
# the other two legs.
'@dth/web': patch
---

The Unreal leg survives a reload. Reloading the window — or just navigating away and coming back to the character — during the send used to "forget" the task rows, the status line and even the outcome toast, while the bridge kept working unwatched. The leg's own job files are its sidecar now, exactly like the Daz batch and the Houdini run: on mount the studio reads the linked projects' `job.json`/`running_job.json`/`result.json`, recognises this character's send by the `.dth` paths (or, for a finished result, by its export-set names), and re-arms the rows, the status line and the watch — so an import that finished while nobody was looking still lands as its outcome toast.
