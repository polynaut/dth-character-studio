---
# bump: patch is deliberate — `awaitBatchPickup()` is not new behaviour. It is
# the claim wait that `executeCharacterJobs` already performed, exported so the
# run watch can own it instead of the panel blocking on it. Nothing became
# possible that wasn't before; a ten-second freeze stopped happening.
'@dth/web': patch
---

DTH Export: Start closes the panel at once, and Daz opens where you can see it

Three fixes to one flow:

- **The wait was paid twice.** The panel awaited `executeCharacterJobs`, which
  blocked for up to 10s polling for the Runner to claim the batch — so Start sat
  on "Starting…" before the panel would close, and the run watch then waited all
  over again. The claim wait now belongs to the watch, where the run is already
  on screen and abortable; the panel closes the moment you click.
- **An export no longer launches Daz minimized.** The minimize is
  fire-and-forget and never worked, so a successful launch left no window to
  see — indistinguishable from a launch that failed, while the studio said
  "Opening Daz Studio". Scans still minimize; a run you are watching does not.
- **A claimed batch stops claiming to be unclaimed.** Between the claim and the
  Runner's first progress line, the status read "Waiting for Daz Studio to pick
  the batch up" at 0% — for the whole of a cold scene open.
