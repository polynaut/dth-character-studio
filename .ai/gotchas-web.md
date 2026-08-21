# Gotchas — Web app & smoke suite

Part of the gotchas set — `.ai/gotchas.md` is the index. Learned by measurement or painful debugging; verify details against the current code, but assume the *lesson* still holds. New facts in this area land HERE, in the same PR that earned them.

## Web app

- **A row that retires from a live list needs MEMORY, and a smoke spec must
  not assert on its transient.** The DTH Export task list drops a `done` row
  1.1 s after its tick (`useRetiringTasks`, export-pipeline-panel.tsx). Two
  things bite. The run keeps re-reporting every finished job as `done` on each
  2.5 s poll for the rest of the run, so "already retired?" cannot be derived
  from the props — without a remembered set the row retires, the next poll
  re-adds it, and the list blinks. And the remembered set has to be FORGOTTEN
  when an id leaves `tasks` (a leg cleared wholesale, a second run in the same
  panel), or that scene's row never appears again. On the test side, `done` is
  now a state that lasts ~1.5 s: a Playwright assertion on
  `data-task-status="done"` is a race by construction (it cost the one such
  assertion in `houdini-export.smoke.ts`). Assert the retirement — `toHaveCount(0)`
  — and leave the dwell to the panel's own fake-timer unit tests.

- **A picker built from the OUTPUT folder can only ever re-pick the past.**
  Reported 2026-08-13 on the DTH Export dialog's Unreal section: under the
  project rows sat a tick list of export sets, read from the character's
  `export/` folder — i.e. from what an EARLIER run wrote. Running the THICK
  variant (whose Houdini project writes `LaraClassic_THICK` /
  `LaraNaked_THICK`) offered `LaraClassic` and `LaraNaked` to tick, because
  those were the folders on disk; the sets the run was about to make appeared
  nowhere, and a ticked project with no ticked set held Start. The list made
  its own reason for existing — a FIRST import into an Unreal project —
  impossible. The fix is not a better list but a different question: the dialog
  now WORKS OUT what the run puts in play (the checked Houdini projects' scanned
  `exportSets`, or the folder's contents under *Skip Houdini*, which is not a
  prediction) and asks nothing — the run's task cards name each set and whether
  it is a re-import once Start is pressed. A read-only version of the same list
  was built first and dropped on the same report: the clutter was the list, not
  only its checkboxes. Generalises: when a control's options come
  from a past run's artifacts, it cannot express the thing that has not
  happened yet — and forward-looking work is usually the point. Watch for the
  tell: an empty selection that is BOTH the default and a blocker.
  Second lesson from the same fix: "the studio cannot say" and "the answer is
  nothing" must not collapse into the same empty array — `[]` reaches
  `startUnrealImport` as *every set in the export folder*, so a run believed to
  produce nothing would have handed over a stale export (`sendSets: null` vs
  `[]`, dth-export.tsx). The same collapse hides in a PROBE's failure path:
  answering a rejected `fetchUnrealSendPlan` with `{sets: [], located: {}}` made
  "could not look" identical to "looked, found nothing", which then disabled the
  rows and stated *"nothing exported yet"* about something never read. A failed
  probe leaves the state unset; null already means "cannot say" everywhere
  downstream.
  Third, and it outlived both the tick list and the read-only list that briefly
  replaced it: **a lookup table only answers about the keys it was given —
  absence is not evidence of absence.** `UnrealSendPlan.located` is built by
  probing each Unreal project for *the export folder's* set names, and the
  pre-tick reads a missing entry as "that project does not hold this set". For a
  set the run is about to CREATE — not on disk yet, which is the whole reported
  case — the entry was missing because nobody had asked, so a genuine re-import
  of a variant the project already held read as a first import and did not
  pre-tick. Fix: probe the names you intend to report on (`extraSets` on
  `fetchUnrealSendPlan`, fed by the stored Houdini scans). The tell is a record
  built from one source being queried with keys from another; if the two
  sources cannot drift, there is no bug, and here drifting IS the feature.
- **A default set in an effect can be cancelled by a handler somewhere else in
  the same component — and nothing fails when it is.** The Utils drawer ticked
  the opened card's nodes on open (#690). #691 made every tab switch clear the
  target selection (it is per node KIND), and #706 made the drawer land on
  General, which shows no node list — so from #706 on, the only way to reach a
  tickable list was through a switch that wiped the ticks first. The preselect
  ran, wrote state nothing displayed, and was then thrown away, for four
  releases, while its own comment AND the guide kept promising it. No test
  caught it because every spec that needed a target ticked one itself. What
  caught it was a REGENERATED SCREENSHOT: the guide shot showed the box empty
  under a caption saying it starts selected. Two rules out of it — when a
  feature's default lives in one place and its reset in another, one of them is
  dead and only the rendered UI says which; and a screenshot suite is a
  behaviour assertion, so read what comes out of it, don't just commit it.
- **Every window loads the SAME document, so the start URL never says which
  project it is for.** The config window starts on `/` — which the Home route
  matches — and a runtime window (`WebviewUrl::App("index.html")`) on
  `/index.html`, which matches no route; the window→project mapping only comes
  back from Rust's `active_project_file`. Mounting the router before that answer
  arrives therefore made "recents for half a second, then a jump" the DESIGNED
  boot order of every project window, not a race occasionally lost: Home's
  loader is one small local read while the project's is a manifest read plus a
  character scan, so Home won every time (and got slower to correct the more
  characters a project had). `main.tsx` resolves the destination, `router.load()`s
  it, and only THEN calls `createRoot().render()` — the window shows its own dark
  `backgroundColor` (tauri.conf.json) until the finished screen is ready. Anything
  new on the boot path belongs INSIDE `resolveStartRoute`, before the render, and
  independent lookups there belong in its `Promise.all` rather than stacked in
  front of each other. Guarded by `apps/web/smoke/project-window-boot.smoke.ts`.
- **A `disabled` button still RECEIVES pointer events in Chromium** — only
  click/activation is suppressed. So `fieldset[disabled]` does NOT stop
  dnd-kit's `onPointerDown` drag handles: a read-only ROM section stayed
  reorderable until the fieldset's read-only classes added
  `[&_button]:pointer-events-none` (the forbidden cursor survives — a
  pointer-events-none element takes its ancestor's cursor). Any future
  pointer-listener control inside the read-only fieldset needs the same
  treatment (`rom-sections.tsx`).
- **`useReactTable`'s `data` must be referentially stable.** A derived rows array
  built inline in render (the override grid's merged `displayPoses`) fed the
  table a new identity every render and — once a row's content actually differed —
  tipped React into an **endless synchronous re-render loop** that hard-froze the
  window (~9,500 self-renders in 5s, no error, no yield). jsdom tests never catch
  it; only the browser smoke did. Memoize derived table data AND keep the memo's
  inputs stable (memoized Maps, shared `EMPTY_…` constants instead of fresh `[]`
  per call) — see `group-card.tsx` `displayPoses` / `rom-sections.tsx`
  `overriddenById`.
- **The ui kit's TooltipHost rewrites a hovered control's `title` into
  `data-tooltip` + `aria-label`.** Playwright `getByTitle` therefore silently
  stops matching any control the test already hovered/clicked — locate by ROLE
  (accessible name survives the rewrite). Documented in
  `apps/web/smoke/override.smoke.ts`.
- **A Playwright drag must `scrollIntoViewIfNeeded()` BEFORE it measures, or it
  drags nothing and says nothing.** `boundingBox()` reports viewport
  coordinates even for an element below the fold — it happily returns
  `y: 743` in a 720px-tall viewport — while `mouse.move` CLAMPS to the
  viewport. So the press lands on whatever is at the clamped point (usually
  nothing), no sensor ever activates, and the failure surfaces only as "the
  order did not change": no error, no missed-click warning, nothing pointing at
  the coordinates. Measured 2026-08-18 while covering the card-reorder grip —
  `document.elementFromPoint` at the measured spot returning `null` is what
  named it. Two more things that gesture needs, both dnd-kit's doing: clear the
  4px activation constraint in its OWN move first (droppables are measured when
  the drag activates, so one uninterrupted sweep can arrive before there is
  anything to collide with), and put a beat between moves — a burst of
  synthetic moves in one task reads as a jump, not a travelling pointer. The
  worked example is `apps/web/smoke/card-drag-reorder.smoke.ts`; the pose
  tables' row drag has no smoke and would need the same recipe.
- **A second `EditableTitle` on a page collides with the header's accessible
  name, and the collision is the DEFAULT, not an edge case.** The button says
  `Rename — <name>`, so making Houdini project cards renamable put two buttons
  announcing the identical *"Rename — Kira"* on the character page — because
  since #809 a generated project takes the CHARACTER's own name. Only position
  distinguished them: an a11y defect, and a Playwright strict-mode violation in
  `studio.smoke.ts` (a spec about character rename, nothing to do with the
  feature). Two lessons. **The fix is the accessible name, not the locator** —
  `EditableTitle` takes an optional `subject` ("Houdini project") woven into the
  button, and `LinkedAssetCard` derives it plus its input's label from one
  `renameSubject`; re-scoping the spec would have left two identical names in
  the product. And **a new rename affordance means auditing every OTHER editable
  title on the same screen**, because the names that collide are data-dependent
  and a unit test on either component alone cannot see the pair. Only the FULL
  smoke run caught it — a single-spec run passed, since the ambiguity depends on
  which cards happen to be seeded.
- **`behavior: 'smooth'` scrolling degrades to an instant jump** when Windows'
  reduced-motion setting is on (WebView2 honors `prefers-reduced-motion`).
  Deliberate glides are rAF-driven instead — `smoothScrollToTop` in the character
  route (wheel/touch cancels it).
- **`routeTree.gen.ts` is generated** — adding/removing a route *file* requires
  `pnpm generate-routes`; forgetting it is a silent 404. Its import ORDER follows
  the installed router-cli version: after a tooling bump the dev-server watcher
  rewrites it with a different ordering — **commit the regenerated file** (it's
  the new canonical output; restoring the old one just fights the watcher, which
  can even re-dirty it fast enough to block a `git pull` while `pnpm dev` runs).
- **Settings saves merge by baseline** — only fields changed on that page win,
  the rest re-read from disk (multi-window safety). A new settings field must be
  added to `studioSettingsSchema` AND covered by the page's `dirty` flag, or its
  value never reaches disk.
- **Character page sticky stack:** the character header (`sticky top-0`) has a
  DYNAMIC height (it collapses on scroll), published live as
  `--sticky-header-h` on `:root` by `useStickyHeaderInset`
  (`packages/ui/src/hooks/use-sticky-header-inset.ts`, called from
  `editor-header.tsx` / `form-header.tsx`). ROM section titles pin at
  `calc(var(--sticky-header-h, 128px) + var(--override-bar-h, 0px))`
  (`rom-sections.tsx`), pose-table column headers at that `+ 48px`
  (`group-card.tsx`). Any new fixed-top element must READ the var — a
  hardcoded px silently drifts as the design changes. The guide-screenshot
  suite no longer compensates per shot: it un-sticks all sticky/fixed chrome
  before shooting.
- **The guide SITE build (`scripts/build-guide-site.mjs`) is a separate pipeline
  from the screenshot suite's coverage guard.** Each guide asset dir
  (`screenshots/`, `clips/`) must be BOTH `cpSync`'d into `site/guide/`
  AND reference-guarded. This shipped broken: `clips/` (animated `.webp`
  interaction clips) was referenced and coverage-checked but never copied, so
  `path-chip-copy.webp` 404'd **only on the deployed Pages site** — `pnpm build:guide`
  and the vitest coverage test both stayed green because they read `docs/guide`, not
  the built output. The build now re-checks the referenced sets against the OUTPUT
  (`site/guide/`), so a dropped or mis-pathed copy step fails the build. Adding a new
  guide asset dir needs its own `cpSync`; the output check then covers it.
- **Immediate-persist flows go through `useCharacterDraft.persistPatch` — never a
  bare `saveCharacter` + settle from a component.** The audited bug class: scene/
  Houdini-link, avatar, and product-store flows persisted without `validate()`,
  without the `saving` single-flight, without regenerating artifacts, then wiped
  the dirty signal — silently committing invalid drafts with stale artifacts.
  `persistPatch` owns all of it (guards → optimistic patch → persist → regenerate
  → interim-edit-safe settle → rollback of exactly the patched fields on failure);
  side-effecting steps (file copies/moves) belong INSIDE its async patch producer
  so they run only past the guards. The form stays editable during a save, so
  `save()` snapshots the draft and only replaces it on settle if unchanged
  (`settleAfterSave`) — otherwise interim keystrokes are reverted. The hook has
  its own test suite (`use-character-draft.test.tsx`) — extend it with any new
  settle semantics. Round-two refinements: the baseline settles the moment the
  PERSIST lands (a generate failure warns and never rolls back a landed save),
  the pre-patch snapshot is taken AFTER the async producer resolves (edits typed
  during a slow producer survive), and even the inline rename rides persistPatch
  (`previousName`/`rethrow` options) — no flow holds save state by hand.
- **`Number('') === 0`, not `NaN`** — a numeric input that commits on blur via
  `Number(draft)` silently commits 0 when the user clears the field; an
  empty/whitespace draft must revert instead (NumberField, test-pinned).
- **A map keyed by `normalizeSceneKey` must normalize AT THE ACCESSOR — never
  trust callers to.** `sceneDthPath` looked up `sceneExportFolderRel`'s
  lowercase-keyed map with the caller's raw scene path; the export panel passes
  the character's STORED paths, and every real Windows path has a capital letter
  in it, so every lookup missed — "Export too" built an empty job and died on
  "none of these scenes has an export path" on every real run. The pure tests
  stayed green the whole time because they fed themselves pre-normalized keys,
  the one spelling no real caller ever uses — which is exactly how it shipped
  broken (#637, fixed in #641). Apply the fold inside the accessor
  (`sceneDthPath`/`buildHoudiniJob` do now) and give any normalized-key lookup
  at least one RAW-spelling test case (`houdini-jobs.test.ts` pins both).
- **`readManifest` throws on a CORRUPT `.dcsp`** (an existing file that won't
  parse) rather than returning defaults — else the next save writes defaults over
  the real settings, and `fetchProject` can never 404. It also throws a typed
  **`ProjectUnreachableError`** for a MISSING/OFFLINE project folder (an offline
  network share must not render as a phantom empty project); only an EXISTING
  folder without a `.dcsp` still reads defaults. Every multi-project loop over
  recents must therefore try/catch per project (findCharacterAcrossProjects/
  fetchAllCharacters/sweepTargets do).
- **Radix's modal `Dialog` sets `pointer-events: none` on `<body>`, and
  `document.elementsFromPoint` skips pointer-events-disabled elements** — so a
  modal Radix overlay silently breaks `lib/file-drop.ts`'s drop-through
  hit-testing. That's why `SidePanel` is built from the `radix-ui/internal`
  primitives (`FocusScope` + `DismissableLayer` — the exact pieces Dialog
  composes) instead of Dialog itself. Related: `DismissableLayer`'s Escape is a
  document-CAPTURE listener, so React `stopPropagation` (bubble phase) can never
  block a surrounding Radix layer's dismissal. The working counter (MultiSelect):
  a WINDOW-level capture listener registered while the widget is open — capture
  visits window before document, beating Radix regardless of registration order.
  An IME-cancel Escape (`isComposing`) must be CLAIMED there too —
  `stopImmediatePropagation` with no `preventDefault` and no action — or it
  falls through and closes the surrounding dialog mid-composition (Radix checks
  only `event.key`).
- **The click that re-focuses the app window must never backdrop-dismiss an
  overlay** — with a dialog open and the native window unfocused, the user's
  click back into the app often lands on the backdrop. Both kit overlays route
  `onPointerDownOutside` through `packages/ui/src/refocus-click.ts` (a
  blur/focus/pointerdown state machine — identity-marks the first pointerdown
  after a window blur if it lands within 400 ms of the `focus` event, or before
  it); any new dismissable overlay must do the same. Measured Radix detail:
  modal `Dialog` DEFERS the outside dismiss to the *click* after the
  pointerdown (`deferPointerDownOutside`), but `detail.originalEvent` is still
  the pointerdown — so the identity guard works for both, and a jsdom test must
  fire `pointerDown` **and** `click` to dismiss a Dialog (SidePanel's bare
  `DismissableLayer` dismisses on pointerdown alone).
- **A floating layer that renders ABOVE the overlays must be SWEPT when one
  opens — hit-testing at show time is not enough.** The kit stacks dialogs and
  side panels at z-50, InfoPopups at `z-[60]` and tooltips at `z-[100]`; the two
  upper layers are deliberately above so they stay usable INSIDE a dialog, which
  also means anything left over from the control that opened the dialog floats
  on top of it. Both overlays therefore call `closeFloatingLayers()`
  (`primitives/overlay-sweep.ts` — one call, not two exported closers, so a site
  can't remember half the sweep) in a **`useLayoutEffect`**: a passive effect is
  deferred until after paint, which is one frame of the new overlay with the old
  tooltip still on top of it.
  The host's toasts (sonner, top-center) also stack above z-50 and outlive the
  action that raised them; **SidePanel additionally sweeps those** via the
  `dismissToasts` config seam (`config.tsx` — the kit has no sonner dependency;
  provider-less default no-op, wired to `toast.dismiss()` in `__root.tsx`).
  Deliberately SidePanel-only: a modal is a short-lived confirm where a toast
  on top is tolerable, a drawer is a workspace the user settles into.
  **Modal/SidePanel do NOT cover the whole app** — `update-prompt.tsx` is
  hand-rolled and sweeps itself, and it is the case that matters most: it is the
  only overlay that appears with *no user gesture* (an update check finishing),
  so the host's own `pointerdown` hide — which quietly covers every click-opened
  dialog — never fires. Any future hand-rolled overlay owes the same call.
  `TooltipHost.show()` does hit-test (`elementFromPoint`
  at the anchor's centre, skipped on a 0×0 rect so jsdom can't trip it), but that
  only guards the *moment of showing*: a tooltip already up, or a hover delay
  still counting down, never re-runs it. Same reason the host hides on window
  `blur` + `visibilitychange` — launching Daz/Unreal/Houdini or revealing a path
  in Explorer moves the pointer nowhere, so neither `mouseleave` nor the anchor's
  `blur` fires and the tooltip stays painted over the app while the other tool is
  in front. Deliberately NOT a `document.hasFocus()` guard inside `show()`: a
  missed hide is cosmetic, a `hasFocus()` reading false in some webview state
  would suppress every tooltip in the app.
  **A sweep closes what is OPEN; the thing that bites is what is about to be.**
  `closeAllInfoPopups` registered from an effect guarded on `open`, so a hover
  peek still on its 90 ms `delay.open` was invisible to it: the overlay swept
  nothing, the timer fired, and the popup painted at `z-[60]` over the fresh
  z-50 dialog. A tooltip there is cosmetic (`pointer-events-none`, hit-testing
  skips it); an InfoPopup is INTERACTIVE and swallows the clicks aimed at the
  dialog underneath — a `locator.click` that never becomes actionable. Fixed by
  registering EVERY mounted popup and having the sweep mark a pending open
  stale. **Any floating layer with an open DELAY needs both halves**: close the
  open ones, and cancel the ones counting down.
  **And scope that cancellation to the hover reason.** The sweep marks every
  mounted popup stale, and the flag is cleared by `mouseenter` or a click —
  neither of which a keyboard user performs. Refusing every reason therefore
  left every "i" on the page unopenable by Tab after the session's first dialog
  (`useFocus` opens with reason `'focus'`), which is a permanent a11y
  regression traded for a transient cosmetic one. There is nothing to cancel
  there anyway: only a DELAYED open can outlive a sweep, and focus opens
  synchronously. Caught by a fail-then-pass test, not by review.
- **floating-ui's `useFocus` must stay enabled while an InfoPopup is pinned**
  (its escape-key handler arms the block-focus guard that stops the
  return-focus from re-peeking the popup) — but that also leaves its reference
  BLUR-close live, so `handleOpenChange` must ignore closes with
  `reason === 'focus'` while pinned, or Shift+Tabbing out silently drops the
  pin. Gating the hook off while pinned reintroduces the Escape re-peek loop;
  both edges are test-pinned in `info-popup.test.tsx` (with a switchable
  `:focus-visible` stub — a permanently-mouse stub masks the re-peek bug).
- **An InfoPopup longer than the room under its "i" used to run off the bottom
  of the window, unreachably.** Measured 2026-08-20 on the Houdini-refresh
  offer's `OfferInfo` (1088 characters, the longest in the app — the next is
  872): a **664 px** panel in a 900 px window, bottom edge at 1082 px, with the
  paragraph that says to close Houdini first sitting 57 px below the fold; at
  768 px and 700 px it was worse. Nothing recovers it — `shift()` only moves
  along the CROSS axis, so it cannot pull a tall panel up, and the floating
  element is portaled and absolutely positioned, so scrolling the page just
  makes `autoUpdate` re-anchor it to the "i". The panel had `max-w-xs` and no
  height cap at all, which is why 51 short popups never found it.
  Fixed in `info-popup.tsx` with floating-ui's `size` middleware capping an
  INNER scroller at `availableHeight`. Two details that are not decoration: the
  scroller is a child rather than the floating element itself, because
  `FloatingArrow` is positioned outside the padding box and an `overflow` on
  that element clips it away; and the scroller becomes a tab stop
  (`tabIndex = scrollHeight > max ? 0 : -1`) only when it actually overflows, so
  a keyboard user can scroll it without adding a pointless focus stop to every
  popup that fits.
  **The lesson beyond the primitive:** `toBeVisible()` passed the entire time —
  the element was rendered, unclipped and non-transparent, 282 px below the
  window. Content that has to be READ needs `toBeInViewport({ ratio: 1 })`;
  visibility is not readability. The regression test is in
  `tools-houdini-refresh.smoke.ts` (fail-then-pass verified) rather than
  `info-popup.test.tsx`, because jsdom has no layout and `availableHeight` there
  is meaningless.
- **`role="combobox"` removes an input from `getByRole('textbox')` queries** —
  after the morph-autocomplete a11y work, tests locate those cells by
  `combobox`/`option` roles (rom-sections tests hit this). The JCM **bone** field
  (`bone-name-cell.tsx`) is a second such combobox — same query rule applies.
- **The `Build_Genesis_Index` index feeds TWO autocompletes, from ONE file per
  generation.** `DthScanMorphs.dsa` writes `morphs_<G>.json` (in app-data) with both
  a `morphs` array (morph dials) and, since index version 2 / RUNTIME_VERSION 34, a
  `bones` array (every `DzBone`'s `{ name, label }`). `fetchMorphIndex`/`fetchBoneIndex`
  read the two arrays from that same file, cached separately. Bones are otherwise
  skipped by the morph scan (they carry no morph dials). An old (v1) or
  never-scanned file just yields empty lists — re-run Build_Genesis_Index in Daz.
  Since runtime v39 ONE run writes all four generations (index `version: 3`, with a
  `figures` array naming what was scanned); the readers only ever look at `morphs` +
  `bones`, so the metadata is free to change. The BUILD path owns the scene — it
  clears between generations and again after the last one (v41), so a run ends
  empty; the "scan the open scene" branch must never clear, it is the user's own
  scene and the only way third-party grafts/clothing get indexed.
- **The morph autocomplete reads TWO files per generation, and they must stay
  separate.** Since runtime v53 `morphs_<G>.json` (the stock figures) has a
  sibling `morphs_scenes_<G>.json` (what individual SCENES add: fitted clothing,
  hair, third-party grafts), merged by `fetchMorphIndex` so callers still see one
  index. They are separate FILES on purpose — the base build rewrites its file
  wholesale per generation, so merging scene finds into it would lose them on
  every rebuild. Consequences worth knowing:
  - A scene entry carries `scenes: [<normalizeSceneKey>…]`; a base entry has NO
    `scenes` field, and that absence IS the "always offer it" signal.
    `MorphIndexProvider` drops every scene entry whose list doesn't hold the
    SELECTED scene — including when no scene is selected at all.
  - The reader dedups base-first, so a scene entry can never shadow a base one
    (otherwise a dial the figure genuinely carries would vanish from the
    autocomplete whenever its scene wasn't selected).
  - `fetchMorphIndex` returns EMPTY when the base file is missing, even if a
    scene index exists — a scene index alone means the generation was never
    indexed, and offering only clothing dials would be worse than silence.
  - The scan filters itself against the base index IN DAZ — it reports what a
    scene adds by SUBTRACTING that index — so **the base row must run before
    the scene rows** in a bulk batch (`startProjectScan` enqueues it first).
    With nothing to subtract, the whole stock figure files itself as "what this
    scene adds". That was harmless while only the Tools batch scanned scenes;
    runtime v55 put the scene scan on EVERY generated ROM/export script
    (`DthScanSceneMorphsQuiet`, right after the wrong-scene guard —
    `indexSyncSnippet` in `packages/rom/src/dsa.ts`, pinned by
    `index-sync.test.ts`), which put it in front of anyone who had never built
    the index: a plain export silently filed thousands of stock G9 dials under
    that scene and the autocomplete drowned in them. **Fixed in runtime v58**
    (#675): `dthHasBaseIndex` gates `DthScanSceneMorphs`, which now refuses
    rather than misfiles — a `throw` under `bulk` (so the quiet wrapper logs
    and the export row still succeeds), a dialog interactively. An index
    holding ZERO morphs counts as missing, since subtracting it misfiles
    identically. Nothing is lost by refusing: a later scan REPLACES a scene's
    contribution wholesale (next bullet), so the first run after the base index
    exists files it correctly. `dthBaseIndexKeys` itself still returns an empty
    filter set for a missing index — the refusal is the caller's, deliberately,
    so the two concerns stay separable.
  - A re-scan REPLACES that scene's contribution (`dthWriteSceneIndex` strips
    the scene out of every stored entry first, dropping entries left with no
    scene). Without that, clothing removed from a scene would haunt its
    autocomplete forever. Pinned in `runtime.test.ts`.
- **`projectId` is the project FOLDER PATH everywhere, never `ProjectInfo.id`.**
  `resolveProject(projectDir)` takes the path and returns a record whose `id` is
  the `.dcsp` manifest's own id — a different value that resolves to nothing.
  The route param is the path, so route-scoped code gets this right by accident;
  code reading the ACTIVE project (`fetchActiveProject()`, e.g. the Tools →
  Scan project panel) must pass `project.path`. Measured: passing `.id` made the
  panel's plan probe throw, which the `.catch` turned into a permanently
  disabled button with no error anywhere — caught only by a smoke test.
  `storage.productScanDir(project.id, …)` is the exception that proves it: that
  one genuinely wants the manifest id.
- **The shell.open scope regex is anchored by the PLUGIN, not the config.**
  `tauri-plugin-shell` wraps the configured `plugins.shell.open` validator as
  `^{validator}$` before compiling (see the plugin's `lib.rs`), so the app's
  pattern in `tauri.conf.json` need not carry `^…$` — and an audit that reads only
  the `is_match` call in the plugin's `scope.rs` will wrongly conclude it's
  unanchored. It is anchored: only URLs, the allow-listed extensions, and
  trailing-separator folder paths match — NOT arbitrary `.exe`. The real residual
  is that `.dsa` IS allow-listed (it must be, to open a generated ROM script), and
  a `.dsa` executes in Daz — so `openNoteMedia`/attachments keep their OWN
  extension allowlist rather than trusting the broad shell scope.
- **A `.duf` frame count is deterministic per file version** — `measureFrames`
  caches it by `path|mtime:size`, so hover-preloads/generation don't re-parse tens
  of MB of DSON JSON. Resolved avatar data URLs cache by their content-versioned
  filename. Both are self-invalidating; follow this pattern, don't add TTLs.
- **Literal-char footgun when scripting edits:** writing a raw U+2028/U+2029 (or a
  NUL) via an editor tool that decodes `\uXXXX` escapes lands a real control byte in
  the source (grep then reports "binary file"; a raw U+2028 can even break the JS
  parse, since it's a line terminator there too). Emit the escape-sequence TEXT
  instead (author `\\u2028` so the file receives the escape sequence as text), or do the
  replace with a `String.fromCharCode`-based Node script. A printable delimiter like
  `|` (illegal in Windows paths) is a safe cache-key separator — never a NUL.
- **An `overflow-x-auto` rail clips its descendants to the PADDING box** (and
  forces `overflow-y` to `auto`). Anything a child draws OUTSIDE its own border —
  a Tailwind `ring` (box-shadow) or a negative-offset overlay like a hover-✕ — is
  cut off at the rail's first/last item, and can spawn a stray vertical scrollbar.
  Reserve rail padding equal to the overshoot: the docked scene/Unreal docks use
  `px-1.5 py-2` so the selected card's ring and the corner ✕ stay inside the clip
  region (`scene-footer.tsx` / `unreal-projects-field.tsx`). Playwright's overlay
  scrollbars hide the vertical half of this — assert the visible geometry (ring
  edge vs rail box, `scrollHeight <= clientHeight`), not just element presence.
- **`scrollbar-gutter: stable` on the root stops a viewport-fixed `inset-x-0` bar
  from reaching the window edge.** The reserved gutter sits outside the fixed
  element's containing block, so on a scrollbar-LESS page a docked footer lands a
  scrollbar-width short (measured 1265 vs a 1280 viewport), leaving an empty strip
  the bar can't cover. Dropped `stable` so the docks reach the edge — the accepted
  trade-off is the ~1-scrollbar sideways nudge between a tall tab and a short one
  that the reservation used to hide. `width: 100vw` "fixes" the gap in Playwright's
  overlay-scrollbar harness but re-introduces the classic 100vw horizontal-scroll
  bug under real (Windows/WebView2) scrollbars — measure both states before trusting a fix.
- **A CSS `scale`/`transform: scale()` rasterises the element at its LAYOUT size,
  then GPU-upscales that texture** — so an image shown via an up-scale is soft /
  aliased even from a high-res source. The header avatar once rested at
  `scale: 1.55` (204px laid out → a 204px texture stretched to ~316px). Fix: lay
  the element out at the painted size and rest at `scale: 1` so the browser
  resamples the 768px source straight to size; animate the zoom FROM 1
  (currently a 168×224 portrait wrapper clipping a 254×254 image at
  `-ml-[45px] -mt-[45px]` — see `editor-header.tsx` + `dth-avatar-zoom`). Two
  traps when sizing an `<img>` up: Tailwind preflight's
  `img { max-width: 100% }` silently CAPS an explicit width back to the container
  (needs `max-w-none`), and a `%` width on the replaced `<img>` was ignored
  outright — use fixed px. Verify with computed `getBoundingClientRect`, not the eye.
- **Hand the webview a large image to shrink and its edges ALIAS, not just soften.**
  The header avatar (a 256px Daz tip xBRZ-upscaled to a 768px master with hard
  edges) looked jagged when the browser scaled 768 down to the ~208px painted size
  in the composited scroll layer — the GPU path doesn't low-pass hard edges. The fix
  is to pre-resize server-side to the EXACT painted size × the screen DPR with a real
  low-pass and paint 1:1: a Rust `image`-crate **Lanczos3** pass (`downscale_avatar_png`
  in `avatar.rs`) returning raw PNG bytes (`tauri::ipc::Response` → an ArrayBuffer, not
  a JSON number array), resolved by `resolveImageSrcAtSize` and requested via
  `Avatar renderPx` (currently 254 in the character header). A canvas `imageSmoothingQuality:'high'` pass is NOT good enough
  here — it came out mushy; Lanczos was the one that read crisp. Diagnostic tell: if a
  static side-by-side shows the browser downsample ≈ a hand pass, the defect is
  aliasing (missing low-pass), not the resample quality.
- **A custom property used in `@keyframes` must be REGISTERED (`@property`) or
  carry a `var()` fallback — otherwise it has no value where you inspect it.**
  Unregistered and fallback-less, `translateY(var(--dth-avatar-pan-from))` has
  nothing to resolve against outside an element context, and the Styles pane
  reports "`--dth-avatar-pan-from` is not defined" over a variable that is
  defined and animating on the element. Indistinguishable from a real bug: it
  cost two rounds of "the vars aren't working" on #860, and the variable was
  correct throughout (measured in dev AND the minified bundle — `11%` on the
  wrapper and the inherited image, painting `matrix(1,0,0,1,0,27.94)` on a 254px
  element). `@property` with `syntax`/`inherits`/
  `initial-value` gives it a computed value everywhere, which is the actual gap;
  a fallback in the `var()` closes it locally. **This is a note on how to write
  the technique, NOT a reason to avoid it** — the first version of this entry
  said "don't parameterise keyframes", which was the wrong lesson drawn from one
  badly-written instance. (Whether registration also changes what DevTools
  prints is unverified — the resolution gap is the part that is understood.)
  The avatar pan ended up as literal percentages regardless. **Inspect the
  ELEMENT, never the keyframe**: `getComputedStyle($0).transform`.
- **`translate`, `scale` and `transform` are three separate properties, and
  which one you land in decides whether a percentage is scaled.** CSS composes
  them as `translate · rotate · scale · transform`, so `transform` is applied to
  the element FIRST (innermost — the `scale` property multiplies it) and
  `translate` LAST (outermost — untouched by it). Measured in Chromium
  (2026-08-18) on a 133px-tall image at `scale: 2.3`: an added
  `transform: translateY(10%)` moved it **30.59px** — 10% of the 305.9px PAINTED
  height — while an added `translate: 0 10%` moved it **13.30px**, 10% of the
  laid-out height. That is half the mechanism behind `character.imageOffsetY`
  (lib/avatar-offset): the same stored % has to mean the same fraction of the
  picture in a 224px header portrait and a 32px scene chip, so it goes in the
  slot the variant's own zoom multiplies. It also means an avatar crop and a
  per-character nudge can share an element WITHOUT a merge step — Tailwind v4
  spends `translate` + `scale` on the crop utilities and leaves `transform` free,
  which is exactly the slot the offset wants.
- **A `translateY` percentage is a percentage of the ELEMENT, and under
  `object-cover` the element is not the picture — use `cqmax`.** A square source
  in an `object-cover` box paints a square as tall as the box's LONGER side, so
  in a portrait frame `translateY(n%)` happens to be n% of the picture and in a
  landscape one it is n% × height/width of it. Shipped exactly that (2026-08-18):
  `imageOffsetY: 7` measured **7.00%** on the 3:4 scene cards and **4.20%** on
  the 64×40 landscape chips — the two families disagreed, the correction
  under-shot in every landscape tile, and it took a human's eye to notice. The
  fix is `translateY(calc(<n> * 1cqmax))` with `container-type: size` on the
  frame: `cqmax` is 1% of the LARGER container axis, which IS the painted picture
  height for both shapes, so the browser computes what a per-variant table would
  otherwise have to hardcode (and drift from). Re-measured: 7.000% in both.
  Two costs to know: `container-type: size` brings size containment, so a frame
  using it must be explicitly sized or it collapses — `Portrait` therefore only
  emits it when there IS an offset; and the character header cannot use it at
  all (its `cqmax` would be the 168×224 wrapper, not the 254px image), which is
  fine because there the element already IS the picture.
  Pinned by `smoke/avatar-offset.smoke.ts`, which asserts the RATIO — it survives
  retuning the crops and fails only if the offset stops landing where it should.
- **Overriding which keyframes an element runs: swap `animation-name`, NEVER the
  `animation` shorthand.** The shorthand resets `animation-timeline` to `auto`,
  which silently takes a scroll-driven element OFF its timeline and freezes it at
  the resting value — measured on #860, where a rule that swapped the avatar pan
  by shorthand froze the portrait while its resting assertion kept passing. (It
  is the same reason the base rule declares `animation-timeline` AFTER its
  shorthand.) The trap for the test: an element frozen at rest still
  reports the correct RESTING offset, so a spec that only checks the rest state
  passes over a completely dead animation. Assert both ends — scroll past the
  range and read the transform again.

## `prefers-reduced-motion: reduce` is ON for this dev machine — and it is NOT `MinAnimate` (measured 2026-08-14)

**A busy/loading indicator must never `animation: none` under reduced motion.**
Shipped exactly that on the Houdini card's busy accent bar and the reporter saw
a bar with stripes that never moved — the pattern rendered (it is a
`background-image`) while the only thing carrying the MEANING, the motion, was
switched off by our own accessibility rule. A stopped indicator does not read as
"reduced motion", it reads as decoration, and the signal that work is happening
is gone. Slow it instead (the bar runs 0.7s → 2.1s); reserve `animation: none`
for decorative motion, or pair it with a state that is still visibly distinct
from idle the way `.refresh-pulse` holds a lit fill.

**Diagnosing it is the trap.** Windows exposes two different animation flags and
Chromium reads the one you probably didn't check:

- `HKCU:\Control Panel\Desktop\WindowMetrics\MinAnimate` — window
  minimize/maximize animations. **Not what Chromium reads.** It was `1` on the
  machine that showed the frozen bar, which is why the first check cleared the
  media query wrongly.
- **`SPI_GETCLIENTAREAANIMATION` (`0x1042`)** — Settings → Accessibility →
  Visual effects → **Animation effects**. THIS is what Chromium maps
  `prefers-reduced-motion` from, and it was `False`.

```powershell
Add-Type '…[DllImport("user32.dll")] public static extern bool SystemParametersInfo(uint a,uint b,ref bool c,uint d);'
$anim = $true; [void][SPI]::SystemParametersInfo(0x1042, 0, [ref]$anim, 0)   # False => reduce
```

Consequence for verification: **Playwright's default context is
`reducedMotion: 'no-preference'`**, so a spec proves nothing about the branch
the developer's own machine takes. Assert the reduced path explicitly with
`test.use({ reducedMotion: 'reduce' })` whenever an indicator has one.

## The smoke fake's `stat` mtime (measured 2026-08-07)

`tauri-mock`'s `stat` must return a **`Date`**, stamped **once when the fake is
installed** — not a number, and not a fixed date in the past. Both wrong forms
shipped within an hour of each other:

- A **number** (`Date.now()`) means every `.getTime()` in the studio throws, so
  no mtime-keyed cache is ever exercised in smoke. A cache that never hits looks
  exactly like a cache that works.
- A **fixed past date** makes every file in the fake world read as months old,
  and `sweepStaleRunFiles` (material-util run files, 1h cutoff) compares against
  the REAL clock — so it deleted the request file the studio had just written,
  hython got nothing, and the Utils drawer reported "0 projects read".

Stable-but-current satisfies both. It is exposed as `__tauriMock.mtimeMs` so a
spec can seed an mtime-keyed cache entry that reads as fresh.

The wider lesson: three fixes were aimed at plausible causes before anyone dumped
the drawer's own text, which had the error string in it the whole time. When a UI
assertion fails, print what the UI actually says before theorising.

## A modifier-revealed control that RELAYS OUT under the cursor is untestable in Playwright (measured 2026-08-13)

`useModifierHeld` re-syncs from every `mousemove`/`mouseover`: pointer events
carry the live modifier bits, and that is how it self-heals a missed keyup (Alt
on Windows, where the native menu bar swallows key events). Fine in the app —
and a trap under CDP.

CDP's `Input.dispatchKeyEvent` does **not** update the modifier state the browser
stamps onto its OWN generated events. So when a Ctrl press changes the layout
under a stationary cursor, the browser fires `mouseover` on whatever is now
there, that event says `ctrlKey: false`, the store clears, the layout reverts —
and the two states flip-flop. `toBeVisible()` still passes (it polls and catches
a transient true); `.click()` hangs to the test timeout, because it needs a
stable target. Real users are unaffected: their Ctrl genuinely is down.

Measured while adding **Interrupt** beside the export progress button, whose Ctrl
branch then rendered one button where the normal branch rendered two. Those two
modifier hatches are gone now (v0.77 — Interrupt replaced them), so the export
buttons no longer hit this, but `useModifierHeld` is still behind the path chips
and the Unreal card's open button. If a spec has to hold a modifier:

- park the pointer off the affected element first (`page.mouse.move(0, 0)`), and
- design the reveal so it does not move anything: **a modifier may swap what a
  control does, never how much space it takes.**
- **A figure's source asset is on the OBJECT, not reliably on the node — and in
  Daz Studio 4 the node answers nothing.** `node.getAssetUri()` returns a usable
  path in DS6 and empty in DS4, which silently disabled every generation
  detection built on it: the scene morph scan skipped all of DS4 with "No
  Genesis 3, 8, 8.1 or 9 figure could be found" while the same run keyed morphs
  on `Genesis8_1Female` seven seconds later (measured 2026-08-10). The identity
  is reachable — the product scan had always walked node → `getObject()` →
  `getCurrentShape()` → `getGeometry()` and resolves assets fine in DS4 — so
  `dthNodeAssetPath` (DthUtils, runtime v68) does the same walk, plus
  `getAssetFileInfo()` where `getAssetUri()` is absent. Two lessons: an
  identity probe gets the WHOLE chain, never one accessor; and a detection that
  can fail needs a fallback the caller can supply (the studio passes the
  character's declared generation), because "we could not read it" and "it is
  not there" are different answers that had been collapsed into one message.
- **DS4 exporter 2.0.2's scripted `doExport` goes STATIC when its output files
  already exist.** Measured 2026-08-11 (DS 4.24, the exporter DLL installed
  2026-08-09 08:00): with the target files present, the whole per-frame ROM
  walk is skipped — the run drops from 3.5 min to 26 s, the viewport never
  plays, and the Alembic is rewritten with the FULL time range but every
  sample identical (8 MB instead of 332 MB for the same 240-frame scene).
  Fresh mtimes, clean run log, no error on any channel — the only tells are
  the file size and the missing frame walk. Into an EMPTY folder the same
  build exports correctly, and DS6's build never skipped. Since runtime v69
  the export block deletes the set's own name patterns (`<name>.dth/.abc/
  .fbx`, `_base`/`_experimental_rom.fbx`, `_pose_asset.csv`,
  `_Hair_*_grooms.abc`, `Reference Skeletons/<name>_frame_*`) before calling
  `doExport`, which both forces the real walk and stops stale grooms/reference
  skeletons from outliving a rename or a frame-layout change. Verification
  pattern that caught it: hython `alembicTimeRange` + a two-frame
  `pointFloatAttribValues('P')` compare (set the Alembic SOP's `frame` parm
  explicitly — `hou.setFrame` alone does not re-cook the packed prims).
  **UPDATE (runtime v99): this bug is FIXED in the current plugin, and the
  block STAYED anyway** — for its other, un-planned effect. PR #901 proposed
  deleting it outright now the skip-guard is obsolete, which is sound on the
  guard and wrong on the rest: v85 turned the delete into a MOVE-ASIDE
  (`.dthprev`), and that parking is the only thing standing between a
  half-written export and the previous one. Measured 2026-08-19 — the DTH
  Exporter aborted with "Could not create alembic archive", leaving a 0-byte
  `.dth` and a 29 MB fragment of an 807 MB Alembic; the real export, both
  `.fbx`s and the PoseAsset CSV survived only as `.dthprev`. So when a
  workaround is retired, check what it started doing by accident before
  deleting the code: the two reasons this block existed retire on completely
  different schedules.
- **Modal → SidePanel un-blocks the page BEHIND the overlay: file drops land on
  it again.** Measured 2026-08-14 while moving the DTH Export picker off `Modal`
  onto the drawer. `Modal` is Radix Dialog, whose `disableOutsidePointerEvents`
  puts `pointer-events: none` on `<body>`; `SidePanel` deliberately is NOT that
  Dialog (the app's file-drop hit-testing must keep working through a drawer's
  backdrop — see its doc comment). Same probe, same spot (`elementsFromPoint` at
  8% viewport width, mid-height, the app's own `zoneIdAt` walk from
  `lib/file-drop.ts`), overlay open: under `Modal` the stack is `[DIV, HTML]`
  and no zone is found; under `SidePanel` it returns the character route's
  `data-filedrop-id`. So with the export drawer open a `.duf`/`.hip`/`.dcsc.zip`
  dropped on the dimmed editor links a scene, links a project, or opens the
  overwrite-import wizard — all inert while it was a `Modal`. Nothing about the
  drawer says this, and the two mount-only probes in `dth-export.tsx` had
  "the panel is modal" written up as their REASON. The general shape: swapping
  overlay primitives silently changes what the page underneath can still
  receive, and any comment that leans on modality has to be re-read, not just
  the visible layout.

## An overlay's focus RESTORE re-shows the tooltip its sweep just hid (measured 2026-08-20)

`Modal` / `SidePanel` sweep the floating layers on open (`closeFloatingLayers`)
precisely because tooltips are `z-[100]`, above the z-50 overlay. The other end
of the same interaction undid it: Radix `FocusScope` restores focus to the
control that opened the overlay on unmount, `TooltipHost` shows on `focusin`
with **no delay** (700 ms is hover only), and the pointer has not moved — so
closing a drawer put the opener's tooltip straight back over the app.

Measured in Chromium with the smoke fake: hover a card's Utils button → tooltip
shows → click → swept → close with the ✕ → **`display: block` again**, focus on
the button, `:focus-visible` **false**. Closing with **Escape** gives
`:focus-visible` **true** — the modality split is the whole answer.

The fix is a `keyboardInput` flag in the host (set in its existing `keydown` /
`pointerdown` capture listeners), gating the `focusin` show. Deliberately NOT
`el.matches(':focus-visible')`, which was tried first:

- **jsdom's answer is not stable across a test file.** It is not "`:focus` with
  a different name" — it tracks modality too, so a `mouseDown` in an *earlier*
  test leaves the document in pointer modality and the next test's real
  `.focus()` reports `false`. The keyboard test passed alone and failed in the
  file. `fireEvent.pointerDown` does **not** flip it back; `fireEvent.mouseDown`
  does. Own the flag and both branches are one `fireEvent` away.
- `matches` **throws** on a pseudo the engine doesn't know, and this runs inside
  a document-level listener — one throw takes every tooltip in the app with it.

Testing note for the smoke half: a single `hover()` onto a control that is
`opacity-0` until its card is hovered does not arm the tooltip in Playwright.
Hover the **card** first, then the control — which is also the real gesture.
