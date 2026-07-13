---
---

CI-only: cache the Rust CI build (Swatinem/rust-cache) so the PR rust job
stops rebuilding from scratch, and add a size-growth pre-check to the release
sign step (the signed installer must be larger than the unsigned input). No
product change.
