---
'@dth/desktop': patch
---

fix(desktop): bundle the first **loadable** DTH Character Studio Runner (v1.0.3). v0.51.1 shipped with Runner v1.0.0, which Daz Studio refused to load — the SDK's Windows plugin macro exports C++-mangled entry points while Daz resolves plain C names, and the DLL was built against an SDK newer than released Studios (Daz rejects plugin SDK > studio build). Both are fixed in the Runner repo (v1.0.3: `extern "C"` entry points, built against the oldest supported 6.25 SDK); this release just re-bundles. If Settings → Install DTH Character Studio Runner Plugin previously installed v1.0.0 for you, install again after updating — the panel will show the bundled version differs.
