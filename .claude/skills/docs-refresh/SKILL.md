---
name: docs-refresh
description: Bring docs/guide back in step with the code — document features that shipped without docs, refresh or propose screenshots, delete what no longer applies, and keep pages short (proposing splits when one grows too big). Use after a run of feature merges, before a release, or whenever the guide feels behind.
---

Goal: a reader following the guide today succeeds. **Missing documentation is
better than incorrect documentation** — a gap sends them to the app, a lie sends
them down a path with confidence. So deleting a stale paragraph counts as much
as adding a new one.

Scope is `docs/guide/**` (the user-facing site). `.ai/**` is agent
documentation — it follows its own rule (learnings land in the PR that earned
them), so only touch it here if you find something outright wrong.

## 1. Establish the window

What shipped since the guide last moved:

```sh
git log -1 --format=%cd -- docs/guide            # guide's last touch
git log --oneline <that-date-or-tag>..origin/main -- apps packages
gh release view --json tagName -q .tagName       # or use the last release as the edge
ls .changeset/*.md                               # unreleased, user-visible by definition
```

Changesets are the highest-signal input: each one describes a **user-visible**
change in the author's own words. Every changeset since the window opened is a
candidate for documentation.

## 2. Find what's undocumented

For each candidate change, search the guide for the feature's user-facing name
(the button label, the tab, the setting). No hit = undocumented.

Report the list BEFORE writing anything, so the user can strike items that
aren't worth documenting. Don't document internals: the guide describes what a
user does, not how the code works.

Then write the missing sections into the page where a reader would look for
them — not a new page per feature (see §5).

## 3. Screenshots

Three kinds, and they are NOT interchangeable:

- **Generated** (`docs/guide/screenshots/*.png`) — produced by
  `apps/web/smoke/guide.screenshots.ts` against an in-memory fake, with a frozen
  clock. Regenerate with `pnpm screenshots`. A new one needs BOTH a test that
  navigates to the state and writes the PNG, AND a reference from a guide page —
  the coverage test asserts a 1:1 match and fails on either a missing file or an
  orphan.
- **Clips** (`docs/guide/clips/*.webp`) — same idea via `pnpm clips`.
- **Hand-taken** — photographs and Daz/Houdini captures the studio cannot
  produce (real Daz Studio, real Houdini, hardware). These can only be retaken
  by the user.

Audit:

1. Re-run `pnpm screenshots` and check `git status` — a changed PNG means the UI
   moved under a shot that was already correct. Keep it.
2. For a section you just wrote, decide whether it needs a shot at all. A
   screenshot earns its place by showing something words can't: a layout, a
   state, a place to click. Don't illustrate a sentence.
3. **Ask before generating.** Use the AskUserQuestion tool to propose new
   screenshots — one question, options being the shots you'd add, each described
   by what it would show and where it would sit. Generating a batch nobody wanted
   costs review time and repo weight.
4. For hand-taken shots that look stale, list them explicitly with what changed
   and why the studio can't regenerate them. That list is the user's to action —
   never claim a hand-taken shot is updated.

## 4. Delete what no longer applies

Retired features, removed settings, workflows that changed shape. Grep the guide
for the names of things the code no longer has:

```sh
grep -rn "<removed setting or button>" docs/guide
```

Deleting is the point, not a side effect. A guide that only grows becomes a guide
nobody reads. When a paragraph documents something that still exists but works
differently now, rewrite it — do not append a correction beneath the stale text.

## 5. Keep pages short

Check size:

```sh
wc -l docs/guide/*.md
```

A page much past ~250 lines is usually doing two jobs. When one is too big, do
NOT silently restructure it — **propose** the split and let the user choose:

- what the split pages would be called, and what moves to each
- which one keeps the current filename (the other is a new page and needs a NAV
  entry in `scripts/build-guide-site.mjs`, or the build fails)
- what inbound links would need updating

Prefer tightening over splitting first: most oversized pages are long because of
restated context and hedging, not because they cover too much.

## 6. Gates

```sh
pnpm build:guide      # NAV completeness, asset existence, search extraction, dead in-guide anchors
pnpm --filter @dth/web smoke   # includes the screenshot coverage test (1:1 references)
pnpm changeset --empty         # docs-only PRs still need a changeset
```

Gotcha: a heading containing `&` slugifies to `-amp-`, so an in-guide link to it
is `#tools--amp--index` shaped. `build:guide` fails on a dead anchor — trust it
over hand-derived slugs.

## 7. Report

Close with, in this order:

1. **Documented** — new sections, and where they landed.
2. **Deleted** — what went, and why it no longer applies.
3. **Screenshots** — regenerated (list), proposed and accepted (list), and
   **hand-taken shots the user must retake** (list, with what changed).
4. **Proposed splits** — for any oversized page, not performed.
5. **Left undocumented** — anything skipped, and why. Never silently drop a
   candidate from §2.
