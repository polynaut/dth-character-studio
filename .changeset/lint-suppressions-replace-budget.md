---
'@dth/web': patch
---

Internal, no behaviour change: the lint gate no longer carries a warning-count baseline. The ~223 advisory warnings the repo kept on purpose are now exempted where they happen — a file-level `oxlint-disable` with its reason in the modules whose whole shape is ordered filesystem work, an `oxlint-disable-next-line` with its reason at one-off sites, and one rule turned off in `.oxlintrc.json` because its suggested fix (mutate in place) is wrong for immutable state. `pnpm lint` now runs `--deny-warnings` over a tree at zero, so any new warning fails outright instead of hiding inside a total.
