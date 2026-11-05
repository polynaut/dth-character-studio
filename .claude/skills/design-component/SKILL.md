---
name: design-component
description: Add or change a component of the @dth/ui kit — the component, its tokens, its `<name>.demo.tsx` — and check it in the design system site. USE WHEN add a component, new kit component, change a component, new variant, add a prop to a component, design-component.
---

# Build a kit component

The kit is `packages/ui`; its rules are in [packages/ui/README.md](../../../packages/ui/README.md). Read them first. The site (`pnpm design-system`, http://localhost:4334) shows every component through its demos.

## Step 1: Reuse before you build

Stop at the first rung that holds:

1. **`@dth/ui` first.** An existing component does the job: look at Components in the site and `packages/ui/src/index.ts`. Use it.
2. **One is close, and the difference is per use** (a label, an icon, a tone) -> add a prop or variant. Two components that differ by one string are one component.
3. **A composition of kit components does it** -> it is a pattern, not a component. If it recurs, add it to `apps/web/design-system/pages/patterns.tsx`.
4. Only then a new component.

A component one feature needs stays in that feature. A second feature needing it moves it into `@dth/ui`.

## Step 2: Write it

- One file in `packages/ui/src/components` (composed) or `primitives` (wraps a native element), exported from `index.ts` only if the app consumes it.
- Tokens only: Tailwind classes from the token colours (`bg-card`, `text-success`), no palette classes, no colour literals. Status colours come from the `success`/`warning`/`info`/`destructive` sets.
- No Tauri, router or filesystem imports; host behaviour comes from `UiConfigProvider`.
- Controlled: `value`/`checked` + `onChange`.
- Icons are Lucide at `size-4`. A plain `title` is the tooltip (`TooltipHost` styles it); icon-only buttons always get one.
- Accessible by default: a real element, a name for every control, visible focus, `role="alert"` for errors.
- Its states hold the layout still: loading, error, a label that changes reserve their space.
- Colour alone never carries meaning (`ToolCard` `attention`): pair it with an icon or text.

## Step 3: The demo

`<name>.demo.tsx` next to it. Each exported function is one demo: default, every variant, disabled, busy, error, long content. Demos:

- use inline styles with `var(--token)` and no Tailwind classes (they sit outside the Tailwind scan);
- use realistic copy from the app (character names, Daz and Houdini paths), never lorem ipsum;
- hold controlled state with `useState`; `export const height` for overlays and animated content.

A kit component without a demo is listed on the Overview page.

## Step 4: Check it

1. `pnpm design-system`, open the component's group. Hover, tab through, check every demo.
2. Check the screens that use it (Screens page, `grep -rl "<Name" apps/web/src`): a kit change reaches all of them.
3. `pnpm check:design-system`, `pnpm lint`, `pnpm -r typecheck`, `pnpm --filter @dth/ui test`.

## Report

Two or three sentences: what the component is, its props, which screens use it. If you extended an existing one, say that first.
