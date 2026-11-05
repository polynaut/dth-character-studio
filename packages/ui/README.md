# @dth/ui

The kit: primitives and presentational components every screen is built from. The catalog is the design system site in `apps/web/design-system` (`pnpm design-system`, http://localhost:4334).

The app has not been migrated to these rules yet. Existing screens still have drift (palette colours, arbitrary colour values, raw controls), listed on the site's Audit page; that list is the worklist for the rework. Nothing in CI blocks hardcoded colours yet; a gate comes at the end of the rework. Until then these rules are followed by hand, and new code follows them.

## Tokens

- Tokens are CSS variables in `apps/web/src/styles.css`, surfaced as Tailwind colours: `bg-primary`, `text-muted-foreground`, `border-warning-border`. No palette classes (`text-red-500`) and no colour literals in new code.
- Status colours come in sets: `success`, `warning`, `info`, `destructive`, each with `-subtle` (fill) and `-border`. Error text is `text-destructive-text`.
- Named exceptions, not drift: the tool brand colours (`daz-green`, `houdini-orange`, `unreal-blue`) and the ROM timeline's section colours in `apps/web/src/components/rom/rom-timeline.tsx` (the Audit page skips that file).
- The site's Foundations pages read `:root` directly. There is no second token list to keep in step.

## Icons

Lucide, from `lucide-react`. 16px (`size-4`) in controls and status lines.

## Tooltips

`TooltipHost` is mounted once and turns every `title` into a styled tooltip, so a plain `title` is correct. Icon-only buttons always get one.

## Which button

- `default` (primary): the one main action of an area.
- `outline`: other actions, including Cancel, Discard and every add action. Dashed add buttons go away.
- `ghost`: quiet inline actions such as Rescan or All/None, with an icon when one helps.
- `destructive` (filled): only the final confirmation of a destructive action.
- `outline-destructive`: other destructive actions, such as Clear. Cancel isn't one, since it only backs out.
- `secondary` is legacy until Project 2 moves its one use. Don't add new ones.

In a modal footer, Cancel is the first child of the right-aligned row, left of the primary.

## Which status display

- `StatusIndicator`: an inline line, a tone-coloured icon and text.
- `Notice`: a tinted callout that needs reading or has an action.
- `ToolCard`'s `attention` state is colour-only. Pair it with a `StatusIndicator` or `Notice` that says what needs attention.

Tones: `success`, `warning`, `error`, `info`, `neutral`.

## What stays in a feature

A component one feature needs stays in that feature. When a second feature needs it, it moves here. Anything that touches Tauri, the router or the filesystem never belongs in the kit; inject it through `UiConfigProvider`.

## Demos and screens

- Every component has a `<name>.demo.tsx` next to it; each exported function is one state or variant. `export const height` fixes the frame height for overlays and animated content.
- A new UI state gets a screen (`*.screens.tsx` in the feature), a new component or variant gets a demo. `pnpm check:design-system` fails if any of them throws.
- Demos use inline styles with `var(--token)` and no Tailwind classes: they sit outside the app's Tailwind scan, so classes would silently not apply.
