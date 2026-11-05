# Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `@dth/ui` status tokens, the missing shared components, written rules, demos, a dev-only site with real app screens, and agent skills, without visibly changing the app except the `Button` disabled-state fix.

**Architecture:** Tokens stay in `apps/web/src/styles.css` and components in `packages/ui`. A dev-only Vite site in `apps/web/design-system/` globs `*.demo.tsx` and `*.screens.tsx` and renders each in its own iframe. Screens boot the real route tree on a memory history, against the existing Tauri mock.

**Tech Stack:** React 19, Tailwind 4, Vite 8, TanStack Router, Playwright, vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-11-05-design-system-design.md`

**Branch:** `feature/design-system` off `main`. Set upstream tracking before the session ends (`.ai/conventions.md` → Repo mechanics).

## Global Constraints

- No visible app change except the `Button` disabled states. No palette, font or density change; no light theme.
- No second kit. No Tauri, router or filesystem imports in `packages/ui`.
- No product behaviour changes. No `@dth/rom` changes.
- No production code changed to make a screen possible. `PathChip`'s `onRevealPath` seam is required by the kit rule, not by a screen.
- No demo or site code in the production bundle or production CSS.
- Site: `pnpm design-system`, port `4334`, `--strictPort`. Never 4330 to 4333. About 1,500 lines of site code.
- Page ids and screen ids are links: never rename one.
- Demos import only the kit (via `../index.ts`), `react` and `lucide-react`.
- **Demos and site code use inline styles with `var(--token)` for layout, never Tailwind classes.** Their classes are excluded from Tailwind's scan.
- Realistic copy (Kira, `D:/DTH Projects/Demo`, Houdini 22.0.368), never lorem ipsum.
- Comments: default none; only a constraint or a non-obvious why.
- `pnpm lint` runs `--deny-warnings`, so any warning fails.
- Tests only where logic is real, as named in each task. Presentational components are covered by demos and the check.

## Review Focus

1. A check that renders nothing passes silently: the check must fail on an empty manifest (Task 2).
2. A frame that throws, or a `drive` step that can't find its target, must fail the check rather than show a blank frame (Tasks 1, 2).
3. Demo or site classes leaking into the production build (Task 2, verified by build grep).
4. A Windows path differing only in case from its root must still dim the root; no matching root shows it all bright (Task 5).
5. Long paths and titles in `PathChip`, `ToolCard`, `Notice`: must wrap or truncate without breaking layout, shown by a long-content demo for each (Tasks 5, 6).

---

### Task 1: Spike the frame boot (go/no-go)

Everything else depends on this. **If the mock or real router can't render in a frame, stop and report to the maintainer; don't work around it.**

**Files:**
- Create: `apps/web/design-system/vite.config.ts`, `frame.html`, `frame.tsx`, `screens.ts`, `drive.ts`
- Create: `apps/web/src/components/home.screens.tsx`, `apps/web/src/components/character/character.screens.tsx`
- Modify: `apps/web/package.json`, root `package.json` (scripts)

**Interfaces:**
- Produces, in `screens.ts`:
  ```ts
  export type Screen = {
    id: string; title: string; description?: string
    route: string
    seed?: Record<string, unknown>   // JSON-serializable SeedOptions
    width?: number; height?: number  // default 1280×720
    drive?: (root: HTMLElement) => Promise<void>
  }
  export const defineScreens: (feature: string, screens: Screen[]) => { feature: string; screens: Screen[] }
  export const screenModules: Record<string, () => Promise<{ default: ReturnType<typeof defineScreens> }>>
  // import.meta.glob('../src/**/*.screens.tsx')
  ```
- Produces, in `drive.ts`: `clickByName(root, name: string | RegExp): Promise<void>`, polling ARIA name and text, rejecting after 5s with an error naming the target.
- Produces, the frame URL: `frame.html?module=<glob key>&screen=<id>`, or `?demo=<glob key>&export=<name>`, or `?fail=1`.
- Produces, frame result: `<html data-ready>` once settled; `[data-screen-error]` with the stack on any failure.

- [ ] **Step 1: Write `vite.config.ts`**

`root` is `apps/web/design-system`, `publicDir` is `../public`, plugins `tailwindcss()` and `viteReact()`, `server: { port: 4334, strictPort: true, fs: { allow: [repo root] } }`. Leave out the `tanstackRouter` plugin: the route tree is already generated and code splitting isn't needed here.

Add a small plugin serving `GET /__seed?opts=<json>`: `server.ssrLoadModule` on `../smoke/fixtures.ts`, then `buildSeed(opts)` as JSON. `fixtures.ts` uses `node:fs`, so it must stay on the Node side.

- [ ] **Step 2: Write `frame.tsx`, with this order fixed**

Static imports are only `react`, `react-dom/client`, the Manrope font and `#/styles.css`. Then, in sequence:
1. Load the screen's module (data only, no app imports).
2. `fetch('/__seed?opts=…')`.
3. `installTauriMock(seed)` from `../smoke/tauri-mock.ts`, and set `__dthHideDevtools = true`.
4. Dynamically import `@tanstack/react-router` and `#/routeTree.gen`.
5. `createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [screen.route] }) })` and render `RouterProvider` in an error boundary. Don't use `getRouter` or `main.tsx`: both are fixed to browser history or a startup redirect.
6. Wait until `router.state.status === 'idle'`, run `screen.drive?.(root)`, then set `data-ready`.

Any rejection, or an error caught by the boundary or `window.onerror`, renders `<pre data-screen-error>` with the stack. `?fail=1` throws deliberately, as the check's negative control.

Check how the route's `errorComponent` reports: a loader failure caught by `RootErrorComponent` would otherwise look like a normal render. If so, also mark `data-screen-error` from the frame by checking `router.state.matches` for `status === 'error'`.

- [ ] **Step 3: Add two screens**

`home.screens.tsx`: `home` at route `/`, seed `{ demo: true }`. `character.screens.tsx`: `character-editor` at the character route for Kira, using the project path from `P` in `fixtures.ts` and the URL shape the app's own links produce.

- [ ] **Step 4: Add scripts and run**

`apps/web`: `"design-system": "vite --config design-system/vite.config.ts"`. Root: `"design-system": "pnpm --filter @dth/web design-system"`.

Run `pnpm design-system`, open both frame URLs, and take Playwright screenshots of each.

Expected: Home and the Kira editor render as in `docs/guide/screenshots/home.png` and `character-header.png`, with no `data-screen-error` and `window.__tauriMock.unhandled` empty. If a command appears there, the startup work `main.tsx` does may be missing: note what and why, and add it to the frame without changing production code.

- [ ] **Step 5: Decide**

Works → commit. Doesn't → stop and report what failed.

```bash
git add apps/web/design-system apps/web/src/components/home.screens.tsx apps/web/src/components/character/character.screens.tsx apps/web/package.json package.json
git commit -m "feat(web): design-system site frame boots real screens on the Tauri mock"
```

---

### Task 2: Check, CSS exclusion and CI

**Files:**
- Create: `apps/web/playwright.design-system.config.ts`, `apps/web/design-system/index.html`, `apps/web/design-system/site.tsx` (minimal for now), `apps/web/design-system/design-system.check.ts`
- Modify: `apps/web/src/styles.css`, `apps/web/package.json`, root `package.json`, `.github/workflows/validate-pull-request.yml`

**Interfaces:**
- Consumes: frame URL and result contract from Task 1.
- Produces: `window.__dsManifest: { screens: {module, id}[]; demos: {module, export}[] }`, set by `site.tsx`. Task 3 extends this page.
- Produces: `pnpm check:design-system`.

- [ ] **Step 1: Exclude from production CSS**

In `styles.css` after the kit `@source`:
```css
@source not '../design-system/**';
@source not '../../../packages/ui/src/**/*.demo.tsx';
@source not './**/*.screens.tsx';
```

- [ ] **Step 2: Write `design-system.check.ts`**

Config: `testDir: './design-system'`, `testMatch: /.*\.check\.ts/`, `baseURL` on 4334, viewport 1280×720, the same locale and timezone as the screenshots config, `webServer` running the site with `reuseExistingServer: !process.env.CI`.

Tests:
- `manifest is not empty`: `screens.length > 0` and, from Task 4 on, `demos.length > 0`
- `negative control`: `frame.html?fail=1` shows `[data-screen-error]`
- For each manifest entry: goto its frame, wait for `html[data-ready]`, expect zero `[data-screen-error]` and `__tauriMock?.unhandled ?? []` equal to `[]`, and no `pageerror`

- [ ] **Step 3: Run it**

Run: `pnpm check:design-system`. Expected: PASS, including the negative control.

- [ ] **Step 4: Prove it can fail**

Temporarily add a `drive` to the `home` screen that clicks a name that doesn't exist. Run. Expected: FAIL naming that screen. Revert.

- [ ] **Step 5: Verify production is clean**

Run: `pnpm build`, then grep `apps/web/dist` for `__dsManifest` and `data-screen-error`. Expected: no matches. Also compare the built CSS size against `main`'s build; expected: no meaningful increase.

- [ ] **Step 6: Add to CI**

In the `smoke` job, after `Browser smoke (Playwright)` and before the trace upload: `- name: Design system check` / `run: pnpm --filter @dth/web check:design-system`. Keep it a step, not a new required job.

- [ ] **Step 7: Commit**

```bash
git commit -am "feat(web): design-system check renders every screen, wired into smoke CI"
```
(`git add` the new files first.)

---

### Task 3: Status tokens

**Files:**
- Modify: `apps/web/src/styles.css`
- Create: `apps/web/design-system/lib/tokens.ts`, `apps/web/design-system/lib/tokens.test.ts`

**Interfaces:**
- Produces: `parseTokens(css: string): Record<string, string>` from `:root`; `contrast(a: string, b: string): number`.
- Produces tokens and utilities, consumed by Tasks 6 and 8:
  - `--warning`, `--warning-subtle`, `--warning-border` (and `--success-*`, `--info-*`), as `text-warning`, `bg-warning-subtle`, `border-warning-border`
  - `--destructive-text`, `--destructive-subtle`, `--destructive-border`

- [ ] **Step 1: Write the failing test**

```ts
const css = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8')
const t = parseTokens(css)

it.each(['warning', 'success', 'info'])('%s text reaches AA on every surface', (tone) => {
  for (const bg of [t.background, t.card, t[`${tone}-subtle`]])
    expect(contrast(t[tone], bg)).toBeGreaterThanOrEqual(4.5)
})
it('error text reaches AA on every surface', () => {
  for (const bg of [t.background, t.card, t['destructive-subtle']])
    expect(contrast(t['destructive-text'], bg)).toBeGreaterThanOrEqual(4.5)
})
it('keeps destructive and primary unchanged', () => {
  expect(t.destructive).toBe('#e5605e')
  expect(t.primary).toBe('#fe5c01')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @dth/web test design-system/lib/tokens`. Expected: FAIL, tokens undefined.

- [ ] **Step 3: Implement tokens and helpers**

Solid hex only, so the contrast test can compute them. Add each to `:root` and `@theme inline`. Start from amber-500 (`#f59e0b`), emerald-500 (`#10b981`), sky-400 (`#38bdf8`), and a lighter red for `--destructive-text`. Subtle backgrounds are a low-strength mix of the tone over `--card`. Adjust values until the test passes.

- [ ] **Step 4: Run to verify it passes, then typecheck**

Run: `pnpm --filter @dth/web test design-system/lib/tokens && pnpm --filter @dth/web typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/styles.css apps/web/design-system/lib
git commit -m "feat(web): status tokens with AA contrast pinned by test"
```

---

### Task 4: `Button` cleanup

**Files:**
- Modify: `packages/ui/src/primitives/button.tsx`
- Create: `packages/ui/src/primitives/button.demo.tsx`

- [ ] **Step 1: Collapse `dark:` to its value**

The app is always `.dark`, so this renders identically:
- Base: `aria-invalid:ring-destructive/40`, dropping the `/20` form
- `destructive`: `bg-destructive/60 text-white hover:bg-destructive/90 focus-visible:ring-destructive/40`
- `outline`: `border border-input bg-input/30 shadow-xs hover:bg-input/50 hover:text-accent-foreground`
- `ghost`: `hover:bg-accent/50 hover:text-accent-foreground`

- [ ] **Step 2: Remove unused**

Remove `ghost-destructive`, `link` and `icon-lg`. Keep `secondary` (one shipped use). Run `pnpm --filter @dth/web typecheck`; expected: PASS. A type error means it's used dynamically, so keep it.

- [ ] **Step 3: Fix disabled**

Replace base `disabled:opacity-50` per variant. `default`: `disabled:bg-secondary disabled:text-muted-foreground`. `outline`, `ghost`, `outline-destructive`: `disabled:text-muted-foreground` with no opacity. `destructive`, `secondary`: keep `disabled:opacity-50`.

- [ ] **Step 4: Replace the `outline-destructive` comment**

State: for destructive actions that aren't the final confirmation, such as Clear; Cancel is `outline`, since it only backs out.

- [ ] **Step 5: Write the demo**

Exports: `Variants`, `Sizes`, `Disabled` (every kept variant, including a "Saved" primary), `WithIcon`.

- [ ] **Step 6: Verify**

Run: `pnpm --filter @dth/ui test && pnpm --filter @dth/web smoke`. Expected: PASS, as `Button` is a shared primitive. Screenshot the demo and the Tools page: "Saved" is neutral grey and readable, and enabled buttons are unchanged.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/primitives
git commit -m "fix(ui): readable disabled buttons, drop dark: styles and unused variants"
```

---

### Task 5: `PathChip` moves into the kit

No visual change.

**Files:**
- Create: `packages/ui/src/components/path-chip.tsx`, `path-chip.test.tsx` (ported from `path-code.test.tsx`), `path-chip.demo.tsx`
- Modify: `packages/ui/src/config.tsx`, `packages/ui/src/index.ts`, `apps/web/src/routes/__root.tsx`, `apps/web/src/styles.css`, all callers
- Delete: `apps/web/src/components/path-code.tsx`, `path-code.test.tsx`, and the chip in `dir-path-chip.tsx`. `displayDirOf` moves to `apps/web/src/lib/path.ts`, since it needs `displayPath`.

**Interfaces:**
- Produces:
  ```ts
  PathChip(props: {
    path: string            // what a click copies
    display?: string        // shown text, default path
    roots?: string[]        // first case-insensitive prefix of display is dimmed
    children?: ReactNode    // custom display, wins over display and roots
    className?: string
    variant?: 'default' | 'secondary'
    onEdit?: () => void
  })
  ```
- Produces: `pathChipClass`, `tallPathChipClass`, exported from `@dth/ui`.
- Produces: `UiConfig.onRevealPath: (path: string) => void`, default no-op. Add it to the per-handler memo in `UiConfigProvider`.

- [ ] **Step 1: Port tests, adding root matching**

Port `path-code.test.tsx`, replacing the `revealPath` mock with a `UiConfigProvider` `onRevealPath` spy. Add:
```tsx
it('dims the root case-insensitively', () => {
  render(<PathChip path="d:/x" display="D:/Proj/Kira" roots={['d:/proj']} />)
  expect(dimmedText()).toBe('D:/Proj')
})
it('shows everything bright when no root matches', () => {
  render(<PathChip path="x" display="E:/Other" roots={['d:/proj']} />)
  expect(dimmedText()).toBe('')
})
it('uses the first matching root, so most-specific-first order holds', () => {
  render(<PathChip path="x" display="D:/Proj/Kira/daz" roots={['D:/Proj/Kira', 'D:/Proj']} />)
  expect(dimmedText()).toBe('D:/Proj/Kira')
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @dth/ui test path-chip`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement and wire**

Move the logic unchanged. Replace the hardcoded `#333` with a new token `--chip-adornment: #333` in `styles.css`; everything else about the chip stays as is. In `__root.tsx`, add a referentially stable `onRevealPath` calling `revealPath({ data: { path } }).catch(() => {})`.

- [ ] **Step 4: Repoint callers**

21 files use the chips. `DirPathChip dir={d} roots={r} copyPath={c}` becomes `PathChip path={c ?? d} display={d} roots={r}`. Non-JSX imports of `pathChipClass` and `tallPathChipClass` go to `@dth/ui`.

- [ ] **Step 5: Write demos**

`Default`, `Secondary`, `WithRoot`, `Editable`, `LongPath` (a long Houdini install path).

- [ ] **Step 6: Verify**

Run: `pnpm --filter @dth/ui test && pnpm --filter @dth/web test && pnpm -r typecheck && pnpm --filter @dth/web smoke`. Expected: PASS. Compare the Settings screen with `docs/guide/screenshots/settings-installations.png`: chips unchanged.

- [ ] **Step 7: Commit**

```bash
git add packages/ui apps/web/src
git commit -m "refactor(ui): PathChip moves into the kit, reveal injected through UiConfig"
```

---

### Task 6: New components

Presentational, so covered by demos and the check rather than unit tests. Not used in the app yet.

**Files:**
- Create in `packages/ui/src/components/`: `status-indicator.tsx`, `notice.tsx`, `tool-card.tsx`, `page.tsx`, each with a `.demo.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: tokens from Task 3; `InfoPopup`.
- Produces:
  ```ts
  type Tone = 'success' | 'warning' | 'error' | 'info' | 'neutral'
  StatusIndicator(props: { tone: Tone; icon?: LucideIcon | null; children: ReactNode })
  Notice(props: { tone: Exclude<Tone, 'neutral'>; title?: ReactNode; action?: ReactNode; children?: ReactNode })
  ToolCard(props: {
    tone: 'daz' | 'houdini' | 'unreal'
    state?: 'idle' | 'selected' | 'attention'
    title: ReactNode; subtitle?: ReactNode; media?: ReactNode
    actions?: ReactNode; children?: ReactNode; className?: string
  })
  Page(props: { width?: 'default' | 'wide'; children: ReactNode })      // default max-w-3xl, wide full
  PageHeader(props: { title: ReactNode; back?: ReactNode; description?: ReactNode; actions?: ReactNode })
  Section(props: { title?: ReactNode; info?: ReactNode; description?: ReactNode; actions?: ReactNode; plain?: boolean; children: ReactNode })
  ```

- [ ] **Step 1: `StatusIndicator` and `Notice`**

Default icons: `Check`, `TriangleAlert`, `CircleX`, `Info`; `neutral` has none and uses `text-muted-foreground`. Error tone uses `text-destructive-text`. `Notice` uses `role="alert"` for error, otherwise `role="status"`.

Demos: `StatusIndicator` shows "Active", "differs", "Export failed", "Scanning", "matches". `Notice` shows each tone, `WithAction`, `LongContent`.

- [ ] **Step 2: `ToolCard`**

A left accent bar in the tool colour on every state. Idle: `border` and a very low tint, at most `/5`. Selected: tool-colour border and at most `/10` tint, so it no longer outweighs the page. Attention: `border-warning-border`, same tint as idle. Height comes from content (`self-start`), so a card beside a taller neighbour doesn't stretch.

Demos: `Daz`, `Houdini`, `Unreal`, `Selected`, `Attention`, `LongTitleAndPath`, `SideBySide` (cards with different heights).

- [ ] **Step 3: `Page`, `PageHeader`, `Section`**

`Section` renders in a card by default; `plain` drops the card for full-width content like ROM. Its heading is the same size and weight in both. Demos: `SettingsSection`, `PlainSection`, `HeaderWithActions`.

- [ ] **Step 4: Verify**

Export all from `index.ts`, then run `pnpm --filter @dth/ui typecheck && pnpm check:design-system`. Screenshot each demo; long-content demos must wrap or truncate within their box.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src
git commit -m "feat(ui): StatusIndicator, Notice, ToolCard, Page and Section"
```

---

### Task 7: The site and remaining demos

**Files:**
- Create: `apps/web/design-system/pages/{overview,foundations,components,patterns,screens,audit}.tsx`, `lib/drift.ts`, `lib/drift.test.ts`, `README.md`
- Create: demos for every remaining kit component: Input, Label, Select, Modal, SidePanel, Switch, Tabs, Textarea, InfoPopup, Tag, EditableTitle, Field, NumberField, OverrideMark, RemoveAssetDialog, KeyedListEditor, MultiSelect, LinkedAssetCard
- Create: `apps/web/src/components/tools/tools.screens.tsx`, `apps/web/src/components/settings/settings.screens.tsx`
- Modify: `apps/web/design-system/site.tsx`, `apps/web/src/components/character/character.screens.tsx`

**Interfaces:**
- Consumes: `parseTokens` (Task 3), `screenModules` (Task 1), `__dsManifest` (Task 2).
- Produces: `scanDrift(files: Record<string, string>): { file: string; line: number; kind: 'palette' | 'arbitrary' | 'hex' | 'raw-control'; match: string }[]`.
- Produces page ids: `overview`, `color`, `type`, `shape`, `icons`, `components/<name>`, `patterns`, `screens/<id>`, `audit`.

- [ ] **Step 1: Write the failing test for `scanDrift`**

```ts
const hits = (src: string) => scanDrift({ 'a.tsx': src }).map((h) => h.kind)
it('flags each kind', () => {
  expect(hits('className="text-amber-500"')).toEqual(['palette'])
  expect(hits('className="bg-[#333]"')).toEqual(['arbitrary'])
  expect(hits('const c = "#fe5c01"')).toEqual(['hex'])
  expect(hits('<button onClick={f}>')).toEqual(['raw-control'])
})
it('ignores tokens and the kit Button', () => {
  expect(hits('className="text-warning bg-card"')).toEqual([])
  expect(hits('<Button variant="outline">')).toEqual([])
})
it('reports the line', () => {
  expect(scanDrift({ 'a.tsx': 'x\ny text-red-500' })[0]).toMatchObject({ line: 2 })
})
```

- [ ] **Step 2: Run to verify it fails, implement, verify it passes**

Run: `pnpm --filter @dth/web test design-system/lib/drift`.

- [ ] **Step 3: Build the pages**

- `site.tsx`: left nav, hash routing on page ids, manifest, Manrope and `#/styles.css`.
- Foundations: render from `parseTokens` (`styles.css?raw`), never a second list.
- Components: one iframe per demo export from the glob of `../../../packages/ui/src/**/*.demo.tsx`.
- Screens: one iframe per screen at its real size, scaled to fit, with an Open link.
- Patterns: a settings section, a side panel, a tool-card list, with the button rules in words.
- Audit: `scanDrift` over `import.meta.glob('../../src/**/*.tsx', { query: '?raw' })` and the kit, excluding tests and demos, grouped by file with totals.
- Overview: counts, components without demos, features without screens.

- [ ] **Step 4: Write remaining demos and screens**

Every kit component gets a demo. Add screens: `tools-scan`, `settings-installations`, `export-panel` and `houdini-utils-general` (these two via `drive` clicking through the app, following `guide.screenshots.ts`). Use the guide suite's seed options for each state.

- [ ] **Step 5: Verify**

Run: `pnpm check:design-system && pnpm --filter @dth/web typecheck && pnpm lint`. Expected: PASS. Then `wc -l` the site: about 1,500 lines. Screenshot each page; the Overview's gap list is empty for kit components.

- [ ] **Step 6: Commit**

```bash
git add apps/web/design-system packages/ui/src apps/web/src/components
git commit -m "feat(web): design system site with foundations, demos, patterns, screens, audit"
```

---

### Task 8: Rules, skills and AI instructions

**Files:**
- Create: `packages/ui/README.md`
- Create: `.claude/skills/design-component/SKILL.md`, `.claude/skills/design-screen/SKILL.md`, `.claude/skills/design-review/SKILL.md`
- Modify: `CLAUDE.md`, `.ai/README.md`, `.ai/architecture.md`, `.ai/conventions.md`, `.ai/testing.md`, `.ai/gotchas-web.md`
- Create: `.changeset/<name>.md`

- [ ] **Step 1: Write `packages/ui/README.md`**

Short, in the style of `Dg.DeveloperTools/src/designSystem/README.md`. Sections: tokens (including named exceptions: tool brand colours, ROM timeline colours), icons, tooltips (`TooltipHost` handles every `title`, so a plain `title` is correct), which button (the spec's rules verbatim), which status display, what stays in a feature, demo rules (inline styles, no Tailwind classes, and why).

- [ ] **Step 2: Rewrite the skills**

Read the three originals in `Dg.DeveloperTools/.claude/skills/`. Same structure and descriptions, adapted: pnpm, `pnpm design-system`, `pnpm check:design-system`; no command menu, shop docs tools or two shades; screens drive through route, seed and `drive`. Add the kit ladder rung "`@dth/ui` first; a second feature needing it moves it there". `design-component` doesn't reference a Claude Design step.

- [ ] **Step 3: Update `CLAUDE.md` and `.ai/`**

`CLAUDE.md`: the two commands, a short `design-system` architecture note, and "a new UI state gets a screen, a new component or variant gets a demo." `.ai/README.md`: index. `.ai/architecture.md`: the site. `.ai/conventions.md`: the ritual. `.ai/testing.md`: the check, in its table. `.ai/gotchas-web.md`: anything hard-won from Task 1, and the inline-style rule's reason.

Run: `node .claude/hooks/inject-gotchas.mjs --audit`. Expected: anchors resolve.

- [ ] **Step 4: Changeset**

`pnpm changeset`, a minor bump: the design system site, status tokens, new kit components, readable disabled buttons.

- [ ] **Step 5: Full gate**

Run `/verify` (typecheck, lint, tests, smoke, cargo), then `pnpm check:design-system`. Expected: PASS. `pnpm build:guide` isn't needed, as no guide files changed.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/README.md .claude/skills CLAUDE.md .ai .changeset
git commit -m "docs: design system rules, skills and agent instructions"
```

Opening the PR is the maintainer's call, via `superpowers:finishing-a-development-branch`.
