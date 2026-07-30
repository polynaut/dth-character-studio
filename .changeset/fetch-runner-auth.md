---
'@dth/desktop': patch
---

fix(release): authenticate the build-time Runner fetch. The release build stages the latest Runner DLLs via the GitHub API; unauthenticated calls share the hosted runner IP pool's rate limit and can 403 the whole build (hit on the v0.52.0 mac job). The build steps now pass `GITHUB_TOKEN` to the fetch script, which already knew how to use it.
