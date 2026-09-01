---
'@dth/web': minor
'@dth/desktop': minor
---

Community product database, phase 1 (dormant until the ingest endpoint ships):
an opt-in Settings toggle to contribute product-scan results to a shared
catalog of Daz products — names, SKUs, artists, versions and content-relative
provenance only, nothing about the user, their scenes or their machine.
Submissions ride each product-scan ingest, deduped client-side by content
hash. The build carries no endpoint yet, so the toggle renders disabled with a
note; the append-only Cloudflare Worker it will talk to lives in
`services/products-ingest`.
