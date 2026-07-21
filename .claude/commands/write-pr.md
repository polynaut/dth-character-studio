---
description: "Guidelines for writing a high-quality PR description"
argument-hint: "[optional context]"
---

# PR Description Guidelines

## The "Why" comes first

Determine the **why** — the motivation or problem being solved — before writing anything. Sources: branch name, commit messages, the current session's context, any plan files. Don't fabricate motivation; if it isn't clear, ask.

## Preflight (dth-specific)

- Branch off `main` — `main` is PR-only. Feature branches are `feature/…`, fixes `fix/…`.
- **Every feature PR needs a changeset.** Confirm `.changeset/*.md` exists (`pnpm changeset`, or `pnpm changeset --empty` for a docs/CI-only PR — the CI gate enforces this).
- The four packages (`@dth/web`, `@dth/desktop`, `@dth/rom`, `@dth/ui`) version in lockstep; don't hand-pick versions.

## Title

Concise, imperative mood, under 70 characters. Match the repo's `type(scope): summary` commit style (e.g. `fix(web): …`, `feat: …`).

## Body

```markdown
<1-2 sentences: the reason or problem being solved.>

### <Short section heading>

<Terse summary of the approach — only what the diff doesn't already show. Bullets for multi-part changes.>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

## Rules

- **Brevity is mandatory.** Why + What fits on one screen (3-8 lines excluding any test plan).
- **Why > What > How.** The "why" is the most valuable part; "how" belongs in code comments.
- **No AI slop.** No "enhance", "streamline", "leverage", "comprehensive", "seamless", "robust". Write like a sharp engineer — direct, one idea per sentence.
- **No filler.** No "This PR…", no restating the title, no summarizing what's obvious from the diff.
- Only mention breaking changes if there are any. List affected packages only if the change spans 3+.
- Don't list CI checks or re-generated files (`routeTree.gen.ts`, snapshots) unless the PR is mostly about regeneration.
- Keep the harness's PR footer (`🤖 Generated with [Claude Code]` + session link) — exactly one footer.
