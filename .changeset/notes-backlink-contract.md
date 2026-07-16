---
'@dth/web': patch
'@dth/desktop': patch
---

Two editor fixes: the sticky header's scroll-in "Back" link no longer shows up immediately on the Notes tab (on a page too short to scroll the scroll timeline is inactive, so the link fell back to its visible base state — it now defaults to hidden, and the run-error hint gets the same guard), and the "Modify JCM frames" header is no longer a button wrapping the info popup's button (invalid HTML that React flagged and assistive tech misreads). Under the hood, the Rust↔TS boundary is now pinned by shared contract fixtures — serde round-trips and the api layer's zod schemas validate the same JSON on both sides, and the frame-measurement result is parsed at the boundary instead of blindly cast.
