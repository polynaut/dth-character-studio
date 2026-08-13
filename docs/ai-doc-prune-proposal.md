# Proposal: pruning `.ai/` — measured, not felt

**Status: proposal. Nothing has been deleted.** This exists to make the decision
a ten-minute read instead of a 4,700-line audit. Delete this file once decided.

## What changed the calculus

`.ai/*` used to be retrieved one way: an agent greps for what it already
suspects. That is why the volume felt like the problem — a fact on line 800 of
`gotchas.md` was worth nothing to a session that never guessed the keyword.

The `PreToolUse` hook (#828) changes that for **69 facts**: it names a doc plus
an anchor phrase and extracts the bullet **at run time**, so the fact arrives
when the action happens. Which produces a rule that is not obvious:

> **Hook-anchored bullets are load-bearing. Deleting one silently disables a
> trigger.** `node .claude/hooks/inject-gotchas.mjs --audit` fails on any anchor
> whose text moved, so a rewrite is caught — but only if it is run.

So pruning is no longer "which prose is boring". It is three distinct piles.

## The measurement

Counted by whole bullet (a `RETIRED` line heads a 12-line passage; counting
marker *lines* undercounts by ~10x). History markers: retired / no longer /
until v0.x / removed / legacy / superseded / used to / pre-v / earlier version.

| File | Lines | Hook-anchored (keep) | History-only (cut candidate) |
|---|---:|---:|---:|
| `.ai/gotchas.md` | 1575 | 419 | 201 (13%) |
| `.ai/domain.md` | 1315 | 259 | **646 (49%)** |
| `.ai/conventions.md` | 455 | 38 | 130 (29%) |
| `.ai/architecture.md` | 446 | 174 | 23 (5%) |
| `.ai/testing.md` | 291 | 0 | 0 |
| `.ai/release.md` | 126 | 36 | 31 (25%) |
| `.ai/docs-site.md` | 116 | 32 | 6 (5%) |
| **Total** | **4324** | **958 (22%)** | **1037 (24%)** |

**~1,000 lines — a quarter of `.ai/` — is version archaeology**, and half of it
is in one file.

## The recommendation

**1. `domain.md` is the whole problem.** 646 of its 1,315 lines describe states
that no longer exist: the retired `dth-exports` junctions, the removed
`houdiniProjectFolder`, the deleted Generate-Unreal-project feature, the
`$JOB` → `$HIP` anchor history across v63/v64/v66, `<dazSubdir>/dth-exports`
before v64. Every one is written as *"it was X until vN, now it is Y"*.

Cut rule that preserves what matters: **keep the current answer, delete the
path that led to it — unless the history is the reason.** Some of it genuinely
is: the `$HIP`/`$JOB` passage explains why the anchor MOVED and warns that the
premise is the layout, so re-measure after a layout change. That earns its
lines. *"A `houdini-project/` subfolder appeared until v0.68"* does not — no
current reader can act on it.
Realistic saving: **~450 of the 646**, leaving ~870 lines.

**2. `conventions.md` (130 lines, 29%) and `release.md` (31, 25%)** are smaller
versions of the same thing. Same rule.

**3. `gotchas.md` is mostly fine at 13%** — and it is the most hook-anchored
file (419 lines). Its length is the point: every entry is a measured fact
somebody paid for. **Do not prune it by volume.**

**4. 24 bullets run ≥25 lines.** Compression candidates independent of topic —
the longest is `domain.md:200`, at **61 lines**, on implicit per-scene ROM
overrides. Halving the worst ten is another ~150 lines without losing a fact.

**5. `testing.md` is the model.** 291 lines, zero archaeology: when something is
superseded it gets rewritten in place rather than appended to.

## What NOT to do

- **Don't cut `gotchas.md` for being long.** It is the highest-value file per
  line and the most hook-anchored.
- **Don't delete a hook-anchored bullet** without running `--audit`.
- **Don't prune `philosophy.md`/`README.md`** (132 lines combined) — the
  SessionStart hook injects philosophy verbatim into every session.
- **Don't confuse "historical" with "explains why".** A retired feature whose
  removal encodes a constraint (junctions fought Perforce; a relative path has
  no stored target to go stale) is a live fact wearing a past tense.

## Estimated outcome

~4,700 → ~3,900 lines (−17%), with **every hook-anchored fact and every
measured gotcha intact**. The saving is entirely narrative about states nobody
can reach any more.

Ordered by value per minute: `domain.md` first (450), long-bullet compression
second (150), `conventions.md` + `release.md` third (160).
