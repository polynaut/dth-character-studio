---
name: design-review
description: Review a UI change against the @dth/ui kit and the design system site — tokens, components, button and status rules, states, keyboard — using the screens of the changed features. USE WHEN design review, review the UI, check the UI change, does this follow the design system, design-review.
---

# Review a UI change

Judge the change against the kit rules (`packages/ui/README.md`), the patterns (Patterns in the site) and the surrounding UI. The site is the reference.

## Step 1: What changed

`git diff main...` (or the PR's diff). List the UIs it touches: kit components, feature UIs, and through a changed kit component every screen that uses it (`grep -rl "<Name" apps/web/src`).

## Step 2: Is it in the site?

- A changed component has a demo for every changed state or variant.
- A changed or new UI state has a screen in the feature's `*.screens.tsx`.
- Missing ones are findings: the change isn't reviewable.

## Step 3: Look at it

`pnpm design-system`, then each touched screen and demo.

- **Tokens**: no palette classes, no arbitrary colour values, no hex in the diff. The Audit page shows the same scan for the whole app; a file the change touches shouldn't gain entries.
- **Components**: built from `@dth/ui`; no new local button, field or card that duplicates one, no raw `<button>` or `<input>`. A near-duplicate is a finding.
- **Buttons**: one primary per area; Cancel, Discard and add actions are `outline`; `destructive` only on the final confirmation; Cancel first in the footer row, left of the primary.
- **Status**: `StatusIndicator` or `Notice`, not a coloured `<p>`. `ToolCard` `attention` is paired with one of them.
- **States**: loading, empty, error and unavailable exist and hold the layout still.
- **Keyboard**: tab order, visible focus, every control named, icon-only buttons have a `title`.
- **Copy**: short, specific, buttons say what they do.

## Step 4: Report

Findings ranked blockers -> improvements -> suggestions, each with file:line, the screen id where it shows, and the fix. Don't change code unless asked.
