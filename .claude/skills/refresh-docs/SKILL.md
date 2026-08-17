---
name: refresh-docs
description: Bring docs/guide back in step with the code — propose what shipped undocumented and let the user pick which of it to document and how deeply, refresh or propose screenshots, delete what no longer applies, and hold every page to its size budget. Use after a run of feature merges, before a release, or whenever the guide feels behind.
---

Goal: a reader following the guide today succeeds — **and finishes reading it**.
Missing documentation is better than incorrect documentation, and both are better
than documentation nobody reads. So deleting counts as much as adding, and this
skill is allowed to end with a net *smaller* guide.

Scope is `docs/guide/**` (the user-facing site). `.ai/**` is agent documentation
— it follows its own rule (learnings land in the PR that earned them), so only
touch it here if you find something outright wrong.

**Never write a new section without asking first (§3).** Running this skill
repeatedly is how the guide grew to 28,000 words of unreadable prose by
2026-08-17; every pass added and none subtracted, and each addition arrived at
whatever length felt natural rather than the length the feature deserved.

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
candidate.

## 2. Find what's undocumented

For each candidate change, search the guide for the feature's user-facing name
(the button label, the tab, the setting). No hit = undocumented. Don't document
internals: the guide describes what a user does, not how the code works.

Produce a **candidate list** — one line each: the feature's user-facing name, the
page it would land on, and one sentence on what a reader would be unable to do
without it. Then go to §3. **Do not write anything yet.**

## 3. Ask: what to document, and how deeply

Two rounds of `AskUserQuestion`, in this order. Never skip to writing.

**Round 1 — which candidates.** One question, `multiSelect: true`, options being
the candidates from §2 (batch into several questions if there are more than
four). Each option's description says what a reader gains. The user striking a
candidate is a complete answer — record it under §7 "Left undocumented", never
quietly document it anyway.

**Round 2 — how deep, per accepted candidate.** One question each (up to four per
call), options being the size, not the content:

| Option | What it means | Budget |
| --- | --- | --- |
| **One line** | a bullet added to a list that already exists | ~30 words |
| **Short paragraph** | a paragraph under an existing heading | ~80 words |
| **Own section** | a heading, the steps, maybe one screenshot | ~200 words |
| **Own page** | only for a feature with its own multi-step workflow | propose the NAV entry too |

Then write to the chosen budget. A feature the user sized as "one line" gets one
line even when you can think of six caveats — the caveats are what made the guide
unreadable. Overshooting a chosen budget by more than ~25 % is a bug in this pass,
not thoroughness.

## 4. Write like a guide, not like a design doc

The guide's failure mode is **rationale prose**: explaining *why* the software
decides what it decides. That belongs in `.ai/gotchas-*.md`, where the audience is
an agent maintaining the code. The guide's reader wants to know what to press and
what happens.

Cut on sight:

- **Justification.** "Names are deliberately not consulted, because networks get
  renamed and copied around, and the import path doesn't." → the behaviour, one
  clause, if the reader can act on it. If they can't act on it, delete it.
- **The app's own history.** "Before v0.68 this folder was meant to be…",
  "(Before v0.77 that hid behind Ctrl…)", "which used to read as…". Users need
  the current behaviour plus, at most, one short upgrade note.
- **Edge-case enumeration.** Every branch of every dialog spelled out in prose.
  Document the path the reader takes; keep the exception only when hitting it
  silently costs them work.
- **Restated context.** The `$JOB`/`$HIP` layout, the Runner plugin, the
  re-import rule — each belongs on exactly ONE page, and every other page links
  to it. Duplication across pages is the single largest source of length.
- **Self-evident UI.** "The row being worked spins." "A double-click selects
  all." The screenshot already says it.

Prefer, in order: a **table** (densest), a **bullet list**, a paragraph. A
paragraph over five lines is usually a list that hasn't been written as one yet.

Keep, always: warnings the reader can act on, anything destructive or
irreversible, measured numbers that change a decision, and the one-sentence
"why" behind a behaviour that would otherwise look like a bug.

**Never merge `<details>` accordions together, and never flatten one into the
page.** Several small accordions beat one big one: each is a labelled door the
reader opens only if that box is what they came for, and folding six into one
puts them back in front of a wall of text — with five fewer entries in the search
index, since each summary is its own anchor. Accordions are a *reading* device,
so they do not count against the §6 budget the way running prose does. Trim the
text inside them instead. *Earned by:* the 2026-08-17 diet, which collapsed the
character page's six boxes into one and had to put them back.

## 5. Screenshots

Three kinds, and they are NOT interchangeable:

- **Generated** (`docs/guide/screenshots/*.png`) — produced by
  `apps/web/smoke/guide.screenshots.ts` against an in-memory fake, with a frozen
  clock. Regenerate with `pnpm screenshots`. A new one needs BOTH a test that
  navigates to the state and writes the PNG, AND a reference from a guide page —
  the coverage test asserts a 1:1 match and fails on either a missing file or an
  orphan.
- **Clips** (`docs/guide/clips/*.webp`) — same idea via `pnpm clips`.
- **Hand-taken** — Daz/Houdini captures the studio cannot produce. Only the user
  can retake these.

Audit:

1. Re-run `pnpm screenshots` and check `git status` — a changed PNG means the UI
   moved under a shot that was already correct. Keep it.
2. Decide whether a new section needs a shot at all. A screenshot earns its place
   by showing something words can't: a layout, a state, a place to click. Don't
   illustrate a sentence.
3. **Ask before generating**, with `AskUserQuestion` — one question, options being
   the shots you'd add, each described by what it would show and where it sits.
4. **Screenshots are the cheapest thing on the page.** When cutting, cut prose and
   keep the images: they are what makes a page scannable, and deleting one also
   means deleting its shot test.
5. For hand-taken shots that look stale, list them with what changed and why the
   studio can't regenerate them. Never claim a hand-taken shot is updated.

## 6. Delete, and hold the budget

Grep the guide for names the code no longer has:

```sh
grep -rn "<removed setting or button>" docs/guide
```

When a paragraph documents something that still exists but works differently now,
rewrite it — never append a correction beneath the stale text.

Then measure. Word count, not line count — reflowing hides growth:

```sh
wc -w docs/guide/*.md
```

**Per-page budget: ~1,200 words of prose; ~1,800 for a page the whole workflow
runs through.** A page over budget is doing two jobs or restating a third page.
Tighten first — most oversized pages are long because of §4 material, not because
they cover too much. If tightening isn't enough, **propose** the split and let the
user choose:

- what the split pages would be called, and what moves to each
- which keeps the current filename (the other needs a NAV entry in
  `scripts/build-guide-site.mjs`, or the build fails)
- what inbound links would need updating

**A refresh pass that only added is a failed pass.** Report the before/after word
count of every page you touched (§7); if the guide grew, say by how much and why
that was the right call.

## 7. Report

Close with, in this order:

1. **Documented** — new sections, where they landed, and the depth the user chose
   vs. the words actually written.
2. **Deleted** — what went, and why it no longer applies.
3. **Size** — a before/after word count per touched page, plus the total.
4. **Screenshots** — regenerated (list), proposed and accepted (list), and
   **hand-taken shots the user must retake** (list, with what changed).
5. **Proposed splits** — for any page still over budget, not performed.
6. **Left undocumented** — everything the user struck in §3 Round 1, plus anything
   else skipped and why. Never silently drop a candidate from §2.

## 8. Gates

```sh
pnpm build:guide        # NAV, asset existence (1:1, both directions), search extraction, dead anchors
pnpm changeset --empty  # docs-only PRs still need a changeset
```

`build:guide` is the whole gate for a prose-only pass: its asset check is the
static mirror of the `coverage` test in `guide.screenshots.ts`, so a reference to
a missing PNG *and* a PNG no page references both fail it. The Playwright side
(`pnpm screenshots`) only needs running when you actually changed which shots
exist — note it is **not** part of `pnpm smoke`, which matches `*.smoke.ts` only.

Anchor gotchas — `build:guide` is the only gate that catches these, and it is NOT
part of `/verify`:

- **`&` in a heading slugifies to `-amp-`**, not `-`: `## Tab 1 — Scan & index` is
  `#tab-1--scan-amp-index`.
- **An apostrophe slugifies to `39`.** marked escapes `'` to `&#39;` before the
  slugger sees it, so `## Finding a morph's internal name` becomes
  `#finding-a-morph39s-internal-name`. Measured 2026-08-17. Write the heading
  without the apostrophe rather than linking to that.
- **`<details>` summaries are anchors too**, and they drop entities — a summary
  reading `morphs &amp; node` slugs to `morphs--node`, not `morphs-amp-node`.

Never hand-derive a slug; trust the build.
