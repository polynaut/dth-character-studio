# Design system site

Dev-only catalog of the kit, the foundations and the app's screens. Not part of the product build.

```sh
pnpm design-system        # http://localhost:4334
pnpm check:design-system  # every screen and demo must render without errors
```

- Demos: `packages/ui/src/**/*.demo.tsx`. Each exported function is one demo; an optional `export const height` fixes the frame height (overlays, animated content).
- Screens: `apps/web/src/**/*.screens.tsx` via `defineScreens`. `seed` takes `buildSeed` options; `tune` edits the seed for state those options don't cover; `drive` clicks through the app.
- Demos and the site use inline styles with `var(--token)`: these files are outside Tailwind's scan, so classes would not apply.
- Foundations read `:root` in `src/styles.css`. There is no second token list.
