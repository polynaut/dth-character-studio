---
'@dth/web': patch
---

A refused Unreal send now fails loudly instead of spinning politely. When the studio cannot queue an import at all (Runner bridge missing from the project, no export on disk, a vanished `.uproject`), the run's task rows for that project turn **failed** instead of spinning "Re-import · 0%" forever, the refusal arrives as an **error** toast rather than a blue info one, and the "open the editor" hint only accompanies sends that actually queued something.
