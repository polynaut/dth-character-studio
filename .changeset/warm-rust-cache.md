---
---

CI-only: warm the Rust build cache on the default branch so PR rust jobs
restore it (they were cold-rebuilding despite rust-cache being present). No
product change.
