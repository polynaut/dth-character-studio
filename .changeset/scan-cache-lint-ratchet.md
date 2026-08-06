---
'@dth/desktop': patch
'@dth/web': patch
'@dth/rom': patch
'@dth/ui': patch
---

Utils scans are cached by mtime, and CI fails on new lint warnings

Opening a `.hip` costs tens of seconds and the drawer is built for repeated use,
so scans are now served from a path + mtime cache — when every requested project
is unchanged the call returns without starting hython at all. A transfer rewrites
its target, so the next scan re-reads exactly that file and leaves its neighbours
cached.

The repo's advisory lint warnings are deliberate (see `.oxlintrc.json`), but at
that volume a *new* one was invisible. `pnpm lint:budget` now pins the count per
rule and CI fails when a rule grows.
