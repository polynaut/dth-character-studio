---
# minor: a new action on the character header's export button — behaviour that
# did not exist before (aborting was over once the Runner claimed the batch).
'@dth/web': minor
---

**Hold Ctrl on a running DTH Export to abort it.**

While a batch is waiting for Daz Studio the header button reads **Abort**, and clicking it takes the handoff back. The moment the Runner claims the file, that was over: the button became a live **Exporting n/m** counter whose only action was "stop watching", and the claimed job file stayed on disk.

Which is fine when Daz is working — and a dead end when it isn't. A Runner that stalls (a modal in the way, a plugin that died mid-batch) leaves the button spinning forever, and the file it left behind makes every later export *and* scan refuse with *"a batch is waiting for Daz Studio"*.

Now holding **Ctrl** turns the progress button into **Abort**, the same way it turns Save into Re-save: clicking deletes the job file and resets the button. Release Ctrl and the progress counter is back, untouched. A plain click still only stops watching, and still deletes nothing.

The toast says what actually happened, because this is the honest limit of it: the studio can delete its handoff file, it cannot stop Daz. A run Daz has genuinely started keeps going there (and a working Runner may even write the file again on its next scene). What you reliably get back is the studio — the watch, and the next export.

Deleting a claimed batch rolls no handoff stamps back, deliberately: unlike the pending Abort, this batch may already have exported scenes, and marking those as never handed off would report work that happened as work that didn't.
