# Proposal: pruning `.ai/` — measured, not felt

**Status: proposal. Nothing has been deleted.** This exists to make the decision
a ten-minute read instead of a 4,700-line audit. Delete this file once decided.

> **Filenames have since split (2026-08-14):** `gotchas.md` → the
> `gotchas-*.md` area files, `domain.md` → `domain-rom.md` +
> `domain-exporter.md` (the old names remain as routing indexes). Per-file line
> numbers below refer to the pre-split files; the bullet-level analysis and the
> cut rules apply unchanged to the part files.

## What changed the calculus

`.ai/*` used to be retrieved one way: an agent greps for what it already
suspects. That is why the volume felt like the problem — a fact on line 800 of
`gotchas.md` was worth nothing to a session that never guessed the keyword.

The `PreToolUse` hook (#828) changes that for **69 facts**: it names a doc plus
an anchor phrase and extracts the bullet **at run time**, so the fact arrives
when the action happens. Which produces a rule that is not obvious:

> **Hook-anchored bullets are load-bearing. Deleting one silently disables a
> trigger.** `node .claude/hooks/inject-gotchas.mjs --audit` is the check, and
> it catches three ways an edit kills an anchor: the text MOVED (nothing
> extracts), the phrase now matches TWICE (the wrong bullet is extracted,
> confidently), and the bullet grew past the `MAX_NOTE` cut so the fact no
> longer survives into the note. Only the first is what "deleting a bullet"
> does — the other two are what REWRITING one does, which is most of the work
> proposed below.

So the loop for any prune is: cut → `--audit` → `node
.claude/hooks/inject-gotchas.test.mjs`. Both run on a fresh clone in seconds,
and neither is run by CI, so a prune that skips them ships a silently smaller
hook.

Pruning is therefore no longer "which prose is boring". It is three distinct
piles.

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
| `.ai/testing.md` | 291 | 9 † | 0 |
| `.ai/release.md` | 126 | 36 | 31 (25%) |
| `.ai/docs-site.md` | 116 | 32 | 6 (5%) |
| **Total** | **4324** | **967 (22%)** | **1037 (24%)** |

† `testing.md` was zero-anchored when this was first counted; the `SMOKE_PORT`
bullet became an anchor when #828 stopped copying its text into the trigger
table. Counts here move whenever a trigger is added — re-measure rather than
trusting this column a month from now.

**~1,000 lines — a quarter of `.ai/` — is version archaeology**, and half of it
is in one file.

> **The two columns are NOT disjoint — read this before cutting anything.**
> Measured against the trigger table: **11 hook-anchored bullets also match the
> history-marker heuristic above**, four of them in `domain.md`, the file
> recommended for the deepest cut. `export-dir-derived` says *"pre-v29"*,
> `character-meta-dir` says *"until v0.68"*, `which-daz-launches` says *"used
> to"*, `houdini-project-generate` says *"until v0.65"*. Every one is a live
> fact that mentions its own past, and every one is extracted at run time.
> So "history-only" is a **search result, not a verdict** — 1,037 candidate
> lines, of which an unknown number are load-bearing. The anchored column is
> the floor under the cut, not a separate pile beside it.

Two more files are load-bearing that this table does not list: `.ai/testing.md`
(the `SMOKE_PORT` collision) and — the one outside `.ai/` entirely —
**`CLAUDE.md`**, whose character-schema bullet is the single anchor no `.ai/`
page duplicates. Editing either can disable a trigger.

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
This is the item with the **highest chance of breaking a trigger while looking
harmless**: nothing is deleted, so the obvious check ("is the bullet still
there?") passes, while an anchor phrase reworded, duplicated into a merged
bullet, or pushed past the cut is exactly what the audit's other two modes
exist for. Compress with `--audit` in the loop, not after the batch.

**5. `testing.md` is the model.** 291 lines, zero archaeology: when something is
superseded it gets rewritten in place rather than appended to.

## What NOT to do

- **Don't cut `gotchas.md` for being long.** It is the highest-value file per
  line and the most hook-anchored.
- **Don't delete OR reword a hook-anchored bullet** without running `--audit`
  and the hook test. And don't read the table's two columns as separate piles:
  11 anchored bullets carry a history marker.
- **Don't treat `CLAUDE.md` as prose while pruning.** One trigger anchors there
  (the character-schema ritual — the only fact no `.ai/` page states), so it is
  in the same load-bearing set as the seven files above.
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
