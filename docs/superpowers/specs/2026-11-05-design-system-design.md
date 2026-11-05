# Design system (Project 1 of 2)

## Intent

The maintainer wants a clean design system first, then a rework of the app's UI on top of it.
The visual style stays: dark slate, logo orange, Manrope. It should be improved at some edges,
and the main goal is fewer inconsistencies.

The model is the `design-system-site` branch of the sibling repo `Dg.DeveloperTools`:
rules in a README, a demo next to every component, a screens file next to every feature, a
dev-only site that shows them all, and skills that keep agents inside the system. Read
`src/designSystem/README.md`, `src/designSystemSite/README.md` and
`.claude/skills/design-*/SKILL.md` there for the original. Port the mechanism, not the code: that
repo uses next-yak, WXT and light/dark, and this one uses Tailwind 4, Tauri and dark only.

**Project 2**, reworking each screen onto the system, gets its own design after this ships.

## Audit this design rests on

Measured 2026-11-05 by grep over `apps/web/src` and `packages/ui/src` (`.tsx`, tests excluded), plus
6 of the 44 PNGs in `docs/guide/screenshots`. Hover states and the other 38 screenshots were not
reviewed. Counts are raw matches; some are legitimate.

- Type and spacing mostly hold together: standard Tailwind sizes with no one-off values, and spacing
  mostly on the 4px grid. **They don't need an overhaul.**
- There are no status tokens. Amber is the most-used hardcoded family (127 matches, text shades 300
  to 700). Emerald (16), sky (18) and red (17) stand in for success, info and error, though
  `destructive` exists.
- Tinted status boxes are hand-built: 35 lines combine a status border and background, and 33 files
  use a tinted status background.
- Tool cards have at least three looks, behind `daz-card`, `daz-install-card`, `houdini-card`,
  `unreal-pick-card` and `unreal-card` in `styles.css`.
- `Button` has 8 variants and 8 sizes and carries `dark:` styles in a dark-only app. Literal usage:
  `outline` 109, `ghost` 73, `destructive` 13, `outline-destructive` 4, `secondary` 1. No literal use
  of `ghost-destructive` or `link` was found; dynamic use wasn't checked.
- `styles.css` is 887 lines. `@dth/ui` is imported by 97 app files, so it's the right home.

Rough edges, accepted by the maintainer:

- A disabled primary button ("Saved") turns muddy brown and reads as broken rather than finished.
- Disabled outline buttons ("Make paths portable", "Fill network") are hard to read.
- Heavy tints: the Houdini card in the export panel outweighs everything on screen, with the same
  strength whether or not it needs attention.
- Uneven card heights: the active Daz Studio 6 card stretches because of the Export only row beside it.

`Button` and `ToolCard` fix the first three. The last is a layout fix for Project 2.

## Goals

1. Status tokens, and a documented token set.
2. A small set of new and cleaned-up components that cover the audited inconsistencies.
3. A written rule for each recurring decision: which button, which status display, which card.
4. A dev-only site showing tokens, components, patterns and real app screens.
5. Skills and AI instructions, so agents build within the system from now on.

## Non-goals

- Migrating app screens onto the new components. That's Project 2.
- Visible changes to the shipped app, with one exception: the `Button` disabled-state fix, which
  applies everywhere at once and can't create a mismatch. Path chips move with no visual change, and
  `ToolCard` is built without changing what production cards render.
- A strict CI check against hardcoded colours. It can't pass until Project 2 clears them. It's the
  closing step of Project 2.
- A Claude Design sync. No Claude Design project exists for this app as far as is known, so
  `sync-design-system` and `prepareDesignSync.ts` aren't ported.
- Deploying the site. It's a local dev tool.

## Anti-goals

Any of these makes the work a failure even if it runs:

- A new look: changed palette, font or density. No light theme.
- A second component kit beside `@dth/ui`.
- Product behaviour changes, or anything touching `@dth/rom` generation.
- Production code changed just to make a screen possible.
- Demo or screen code reaching the production bundle, or its classes reaching production CSS.
- A copy of the original's 5,400-line site. The site is scaffolding; the app is the product.

## What gets built

### Tokens (`apps/web/src/styles.css`)

Keep every current value. Add `warning`, `success` and `info`, each with a text colour, a subtle
background and a border, exposed through `@theme inline` as Tailwind utilities. `destructive` gains
the same subtle and border pair. Start from the shades the app already uses most: amber-500 and
emerald-500 for warning and success, and sky for info. Text values must reach WCAG AA on `background`,
`card` and their own subtle background, even if that means a lighter shade than these starting points.

`--destructive` (#e5605e) measures 3.99:1 on `card`, below AA, and it stays unchanged because it's also
a button fill. Add a separate lighter text token for error text.

Tool brand colours (`daz-green`, `houdini-orange`, `unreal-blue`) stay. ROM timeline colours stay
data colours. Both are the named exceptions to the no-literal rule, alongside any others the audit
page shows are legitimate.

### Components (`packages/ui`)

Each follows the kit's rule of no Tauri, router or filesystem imports, and gets a demo.

| Component | Replaces | Requirements |
|---|---|---|
| `ToolCard` | The five card utilities; reuse or evolve `LinkedAssetCard` rather than cloning it | Tones `daz`, `houdini`, `unreal`; one defined look each for idle, selected and needs-attention; a quiet tint, so a card doesn't outweigh the page |
| `StatusIndicator` | Mixed "Active", "differs", "matches" displays | Tones `success`, `warning`, `error`, `info`, `neutral`; icon plus short text; `neutral` covers plain "enabled"/"matches" |
| `Notice` | Hand-built tinted boxes | The same tones; optional title and action |
| `Page`, `PageHeader`, `Section` | Varying page widths and section wrappers | One default content width with an explicit wide option for ROM-like content; the same section heading wherever it appears |
| `PathChip` | `path-code.tsx`, `dir-path-chip.tsx` | Move into the kit; copy and open behaviour injected through `UiConfigProvider`. Whether `folder-move-chip.tsx` belongs is the builder's call |

### `Button` cleanup

- Remove the `dark:` styles, collapsing each to its dark value.
- Remove variants and sizes with no use at all, verified by typecheck. `secondary` has one shipped
  use (`unreal-projects-field.tsx:90`) and stays until Project 2 moves it.
- Fix disabled states: a disabled primary must not turn muddy brown, and disabled outline text must
  stay legible.

Written rules, approved by the maintainer. Project 1 writes them down and corrects the comments in
`button.tsx`, and Project 2 applies them to existing screens:

- **Primary:** the one main action of an area.
- **Outline:** other actions, including Cancel, Discard and every add action. Dashed add buttons go
  away.
- **Ghost:** quiet inline actions such as Rescan or All/None, with an icon when one helps.
- **Destructive filled:** only for the final confirmation of a destructive action.
- **Outline-destructive:** other destructive actions, such as Clear. Cancel isn't one: it only backs
  out.

### Rules (`packages/ui/README.md`)

The equivalent of the original's design system README: tokens, icons, tooltips, which button, which
status display, what stays local to a feature. Rules that don't apply are dropped. In particular,
"no native `title`" doesn't port, because `TooltipHost` already turns every `title` into a styled
tooltip. Say that instead.

A component one feature needs stays in that feature, and moves to the kit when a second needs it.

### Demos

`<name>.demo.tsx` next to each kit component; named exports are demos, one per state or variant that
matters. They import only `@dth/ui`, `react` and `lucide-react`, and use realistic copy from this app
(Kira, `D:/DTH Projects/Demo`, Houdini versions), never lorem ipsum. A component without a demo shows
as a gap on the Overview page.

### Site (`apps/web/design-system/`)

Dev only, on its own Vite config: `pnpm design-system` on port 4334 with `--strictPort`. 4330 is dev,
4331 smoke, 4332 screenshots and 4333 clips. Those suites reuse an existing server, so sharing a port
would silently test the wrong thing. It's built with the design system it documents.

Pages:

- **Overview**, including gaps: components without demos and features without screens
- **Foundations:** colour, type, space and shape, motion, icons. Read from `styles.css`, never a second copy.
- **Components:** globbed from the demos
- **Patterns:** hand-composed from components (a settings section, a side panel, a tool-card list)
- **Screens:** globbed from the screens files
- **Audit:** hardcoded colours and raw controls scanned from source, the worklist for Project 2

Page ids are links, so never rename one. Aim for roughly 1,500 lines of site code. Only one shade
exists, so each screen needs one frame, not two.

### Screens (`<feature>.screens.tsx`)

Next to each feature: the real UI, rendered from the real code, seeded through the existing fake, in
the states that matter. A screen has a stable id, title, description, a route, an optional seed, and
an optional drive step for states only interaction reaches.

A frame boots the real router at the screen's route, not `main.tsx`, which forces its own start route.
Route components like `HomePage` aren't exported, and exporting them would break the rule against
changing production code for screens. **Spike this and the mock together first**, before building
the site around them.

The first batch is the audited screens: Home, Tools, Settings, the character editor, the export panel
and Houdini utils. Project 2 adds more as it reaches them.

Known constraints:

- `installTauriMock` in `smoke/tauri-mock.ts` is self-contained and must install before any app
  module runs. In a frame, that means installing it before dynamically importing the app.
  **Running it this way is untested.**
- `buildSeed` in `smoke/fixtures.ts` uses `node:fs`, so it can't run in the browser. It needs a
  Node-side step, such as a Vite plugin serving the seed as JSON, or a split of that file. Don't
  break the smoke, screenshot or clip suites that use it.
- Don't put screens files in `src/routes`, because the route generator would treat them as routes.
- `@source` and Tailwind's auto-detection would pull demo and screen classes into production CSS.
  Exclude them with `@source not`, and verify against the production build.
- The mock rejects unknown commands and records them in `__tauriMock.unhandled`. A screen's check
  must treat a non-empty list as a failure.

### Check

`pnpm check:design-system` renders every demo and screen in Playwright and fails on a thrown error or
an unhandled mock command. It runs in CI inside the existing `smoke` job rather than as a new required
check. Prove once that it can fail, because `.ai/testing.md` records a gate here that silently couldn't.

### Skills and AI instructions

Rewrite, don't copy, in `.claude/skills/`. The originals hardcode yarn, the command menu, shop docs
tools and two shades.

- `design-component`: the reuse ladder, then component, demo, check
- `design-screen`: which states, the screens file, check
- `design-review`: review a UI diff against the rules and the site

Update `CLAUDE.md` (commands, a short architecture note, and "a new UI state gets a screen, a new
component or variant gets a demo"), `.ai/README.md`, `.ai/architecture.md`, `.ai/conventions.md` and
`.ai/testing.md`. Run `node .claude/hooks/inject-gotchas.mjs --audit` after editing `.ai/`. Anything
learned the hard way goes in `.ai/gotchas-web.md`. Each PR needs a changeset.

## Decisions

**The maintainer's:** the visual style stays; design system first, rework second; the audit's lists of
inconsistencies and rough edges are accepted; the only visible change before Project 2 is the `Button`
disabled-state fix; the button rules above.

**Design calls, not explicitly agreed:**

- The system stays in `@dth/ui`, with Tailwind 4 tokens.
- Site location and port.
- A separate text token for error text, leaving `--destructive` unchanged.
- No Claude Design sync.
- The strict CI check waits for the end of Project 2.
- Guide screenshots are regenerated at the end of Project 2, unless a Project 1 change makes a guide
  page wrong.

## Left to the builder

- How to split this into PRs, and whether the mock runs through a Vite plugin or a split fixture file.
- Exact token values within the constraints above.
- Component prop APIs, and whether `ToolCard` evolves `LinkedAssetCard` or replaces it.
- Screen dimensions; the screenshot suite's 1280×720 is the default.
