---
name: design-screen
description: Add or update the screens of a feature UI in the design system site — the feature's `<feature>.screens.tsx` with route, seed, tune and drive, one screen per state. USE WHEN add a screen, document a feature UI, new feature UI, new state, screens file, show this in the design system, design-screen.
---

# Document a feature UI as screens

A screen is the real app, rendered in the site's frame against the fake native layer (the same one the smoke suite uses), at a route, with seeded data. How the site does it: [apps/web/design-system/README.md](../../../apps/web/design-system/README.md). Read it, `apps/web/design-system/screens.ts`, and an existing screens file (`apps/web/src/components/settings/settings.screens.tsx`) first.

A new UI state isn't done until its screen exists.

## Step 1: Which screens

List the feature's states that matter: populated with realistic data, empty, busy, error, unavailable (tool not installed, scan stale). One screen per state, not per prop.

## Step 2: Write `<feature>.screens.tsx`

Next to the feature: `export default defineScreens('<Feature as users call it>', [ ... ])`. A screen is:

- `id`: stable and unique, it is the frame's URL.
- `route`: the route the frame opens.
- `seed`: options for `buildSeed` (characters, scenes).
- `tune(seed)`: edits the seed for state those options don't cover (installs, scans, files).
- `drive(root)`: reaches state only interaction produces. `clickByName(root, /name/)` clicks a button, tab or link by accessible name; `waitFor(cond)` waits for the result before the next click.
- `width` / `height` when the default doesn't fit.

Rules:

- Fixtures look like the app's real data: Daz and Houdini paths, character names. Obviously fake people.
- Never change production code to make a screen possible. If a state can't be reached, leave it out and say why.
- Screens files are dev only; nothing in production imports them.

## Step 3: Check every screen

`pnpm design-system`, Screens page. Open each frame and look:

- nothing threw (a red stack, `data-screen-error`);
- no spinner, empty state or error you didn't mean;
- the layout fits.

Then `pnpm check:design-system` (renders every screen and demo, fails on a page error or an unhandled native call), `pnpm lint`, `pnpm -r typecheck`.

## Report

The screens you added or changed (id, route, state), the states you couldn't show and why.
