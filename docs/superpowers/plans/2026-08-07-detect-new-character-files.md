# Detect New Character Files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On character-page mount and window focus, detect unlinked `.duf` / `.hip*` files in the character folder, surface a banner, and offer a multi-page wizard that adds or permanently skips each file — updating live while open.

**Architecture:** A pure candidate filter (vitest-covered) fed by the existing `walkFiles`, wrapped by an api module (`fetchDetectedFiles` / `ignoreDetectedFiles` with a `.dcsmeta` ignore store), consumed by a `useDetectedFiles` hook (`useRefetchOnFocus`, content-compared). The route renders a banner + `DetectedFilesWizard`; the wizard reuses the existing scene-compat validation primitives and newly extracted add/link patch builders shared with `DazSceneField`.

**Tech Stack:** React + TanStack Router SPA, `@tauri-apps/plugin-fs` via the `lib/rom` storage/api layers, zod, vitest, Playwright smoke against the in-memory Tauri mock.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-07-detect-new-character-files-design.md`.
- Daz scene = `*.duf`; Houdini project = `*.hip|*.hipnc|*.hiplc` (case-insensitive).
- Exclusions (scenes): `.dcsmeta/`, `dth-exports/`, `rom-animations/`, `*_ROM.duf`. Exclusions (houdini): `.dcsmeta/`, any dir named `backup`.
- All path compares case-insensitive on normalized `/`-separated paths (Windows).
- Skip is permanent via `.dcsmeta/characters/<folder>/detected-ignore.json` (char-folder-relative `/`-paths).
- Banner is non-modal; ✕ hides for the session only. No filesystem watcher.
- Detection only on the character page; browser mode (`!isTauri()`) detects nothing.
- No behavior change to `DazSceneField`'s existing flows.
- Every commit message ends with the Co-Authored-By line per repo convention.

---

### Task 1: Pure detection filter

**Files:**
- Create: `apps/web/src/lib/rom/detected-files.ts`
- Test: `apps/web/src/lib/rom/detected-files.test.ts`

**Interfaces — Produces:**
```ts
export const DETECTED_IGNORE_FILE = 'detected-ignore.json'
export interface DetectedFiles { scenes: Array<string>; houdini: Array<string> } // char-folder-RELATIVE '/'-paths, sorted
export function detectNewFiles(input: {
  relFiles: Array<string>        // walkFiles output: char-folder-relative, '/'-separated
  charFolder: string             // absolute, for resolving linked paths back to rel
  linkedScenes: Array<string>    // absolute (scenePath + extraScenes, '' filtered)
  linkedHoudini: Array<string>   // absolute
  ignored: Array<string>         // char-folder-relative
}): DetectedFiles
export function parseDetectedIgnore(text: string): Array<string>   // tolerant: bad JSON/shape → []
export function detectedIgnoreJson(paths: Array<string>): string   // { ignored: [...] } pretty-printed
```

- [ ] **Step 1: Write the failing tests** — cases: picks up a root-level and a nested `.duf`; excludes `dth-exports`/`.dcsmeta`/`rom-animations` subtrees, `_ROM.duf` suffix (case-insensitive `x_rom.DUF` too); picks `.hip`/`.hipnc`/`.hiplc`, excludes `backup/` at any depth; subtracts linked paths case-insensitively across `\` vs `/` spellings; subtracts ignored rel paths case-insensitively; output sorted; `parseDetectedIgnore` round-trips `detectedIgnoreJson` and returns `[]` for garbage.
- [ ] **Step 2: Run** `pnpm --filter @dth/web test src/lib/rom/detected-files.test.ts` — expect FAIL (module missing).
- [ ] **Step 3: Implement.** Segment rules on the rel path's lowercase parts; linked subtraction via `normalizePath(p).toLowerCase()` set against `${charFolder}/${rel}` normalized.
- [ ] **Step 4: Re-run the test file** — expect PASS.
- [ ] **Step 5: Commit** `feat(web): pure detector for new character files`.

### Task 2: API module + ignore store

**Files:**
- Create: `apps/web/src/lib/rom/api/detected-files.ts`
- Modify: `apps/web/src/lib/rom/api.ts` (barrel section + re-exports)

**Interfaces — Produces:**
```ts
export interface DetectedFilesResult { scenes: Array<string>; houdini: Array<string> } // ABSOLUTE paths
export async function fetchDetectedFiles({ data }: { data: unknown }): Promise<DetectedFilesResult>
// input: { projectId, id, linkedScenes: string[], linkedHoudini: string[] } (zod: charScopeInput.extend)
export async function ignoreDetectedFiles({ data }: { data: unknown }): Promise<void>
// input: { projectId, id, paths: string[] }  — absolute paths, stored relative
```

- Pattern follows `api/products.ts`: `isTauri()` guard (empty result / no-op), `resolveProject` + `locateCharacter` from `./core`, `characterMetaDir` from `../storage`.
- `fetchDetectedFiles`: `walkFiles(location.folderAbs, '', skipDir)` with `skipDir` pruning `.dcsmeta`, `dth-exports`, `rom-animations`, `backup` (perf; the pure filter re-applies), read the ignore file (missing/unreadable → `[]`), run `detectNewFiles`, map rel → `${folderAbs}/${rel}`.
- `ignoreDetectedFiles`: read-modify-write append (deduped, case-insensitive), `mkdir` recursive first.

- [ ] **Step 1: Implement + barrel-export** (`fetchDetectedFiles`, `ignoreDetectedFiles`, type).
- [ ] **Step 2: Verify** `pnpm --filter @dth/web typecheck` (script: `tsc --noEmit`) — expect clean.
- [ ] **Step 3: Commit** `feat(web): detected-files api + .dcsmeta ignore store`.

### Task 3: Extract shared add/link patch builders

**Files:**
- Create: `apps/web/src/lib/scene-add.ts`
- Modify: `apps/web/src/components/daz-scene-field.tsx` (`applyAdd`, `applyLink` patch producers only)

**Interfaces — Produces:**
```ts
// The add flow's patch for an already-final scene path: extraScenes append + seedSceneHair.
export async function addScenePatch(scenePath: string, character: Character): Promise<Partial<Character>>
// The primary link flow's patch: scenePath swap + extrasWithoutPrimary + primarySceneDerivation
// (first link also re-derives; relink keeps gender) + seedSceneHair on first link.
export async function primaryLinkPatch(scenePath: string, character: Character, firstLink: boolean,
  onGenToggle?: (enabled: boolean) => void): Promise<Partial<Character>>
```
Bodies are MOVED verbatim from `applyAdd` (`daz-scene-field.tsx:797-811`) and `applyLink` (`:857+`, the patch-building part incl. GEN toast via `onGenToggle` callback so the lib stays toast-free). The field's producers become `copy-if-needed → await builder`.

- [ ] **Step 1: Extract + rewire.** No behavior change: same order (copy first, then scan/seed on the final path), same toasts from the field.
- [ ] **Step 2: Verify** `pnpm --filter @dth/web typecheck && pnpm --filter @dth/web test` — expect clean/PASS.
- [ ] **Step 3: Run the two scene smokes** `pnpm --filter @dth/web smoke scene-replace scene-footer sceneless` — expect PASS (the flows that traverse applyAdd/applyLink).
- [ ] **Step 4: Commit** `refactor(web): extract add/link scene patch builders`.

### Task 4: `useDetectedFiles` hook

**Files:**
- Create: `apps/web/src/lib/use-detected-files.ts`

**Interfaces — Produces:**
```ts
export function useDetectedFiles(projectId: string, character: Character): {
  detected: DetectedFilesResult          // stable identity while content unchanged
  refresh: () => void                    // manual rescan (wizard actions call it)
  ignore: (paths: Array<string>) => Promise<void>  // persist skip + drop locally
  bannerDismissed: boolean               // ✕ pressed for the CURRENT detection set
  dismissBanner: () => void
}
```
- `useRefetchOnFocus` + `{ immediate: true }`, deps `[projectId, character.id, linkedKey]` where `linkedKey` joins scenePath/extraScenes/houdiniProjects — a link/unlink re-scans immediately.
- Fetch passes the LIVE draft's linked lists; `.catch(() => {})`; content-compare via `JSON.stringify` like `use-rom-run-log.ts:31-33`.
- `dismissBanner` stores the current detection key; `bannerDismissed` is `key === dismissedKey` — a later, different detection re-shows the banner.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Verify** `pnpm --filter @dth/web typecheck`.
- [ ] **Step 3: Commit** `feat(web): useDetectedFiles focus-rescan hook`.

### Task 5: Banner + wizard + route wiring

**Files:**
- Create: `apps/web/src/components/character/detected-files-banner.tsx`
- Create: `apps/web/src/components/character/detected-files-wizard.tsx`
- Modify: `apps/web/src/routes/projects.$projectId.characters.$characterId.tsx` (banner above the scenes section inside the character-tab div, wizard beside the dialogs)
- Modify: `apps/web/src/lib/scene-add.ts` (add `useSceneAddValidation`)

**Interfaces:**
```ts
// scene-add.ts addition — the wizard's per-page validation (the field keeps its own state machine):
export function useSceneAddValidation(opts: {
  projectId: string; character: Character; scenePath: string; mode: 'add' | 'primary'
}): { rows: Array<SceneCheckRow>; checking: boolean; hardBlocked: boolean; blocked: boolean;
      force: boolean; setForce: (v: boolean) => void }
// mode 'add' → sceneCompatRows(candidate, primary) ; mode 'primary' → sceneCreateRows(candidate);
// both + sceneNotLinkedRow(other characters via fetchCharactersWithProblems + this character's live lists).
// Reads keyed/superseded on scenePath; failures leave rows unchecked (never throw).

// detected-files-banner.tsx
export function DetectedFilesBanner({ scenes, houdini, onReview, onDismiss }:
  { scenes: number; houdini: number; onReview: () => void; onDismiss: () => void })

// detected-files-wizard.tsx
export function DetectedFilesWizard({ open, onClose, projectId, character, persistPatch, detected, onIgnore, onActed }: {
  open: boolean; onClose: () => void; projectId: string; character: Character
  persistPatch: PersistCharacterPatch; detected: DetectedFilesResult
  onIgnore: (paths: Array<string>) => Promise<void>; onActed: () => void  // → hook.refresh
})
```
Wizard internals: `items = [...detected.scenes.map(p => ({kind:'scene', path:p})), ...detected.houdini.map(...)]` minus a `handled` path-set kept in state — live detection updates append/drop pages by construction; `idx` clamped to `items.length - 1`; `items.length === 0` while open → `onClose()`. Header shows `Modal` title + "N of M". Scene page: `PathCode` chip, `SceneValidationTable` fed by `useSceneAddValidation` (mode `'primary'` when `!character.scenePath`), buttons Skip / Add scene (or Set as primary → `primaryLinkPatch` + `relinkScene` persist, mirroring `applyLink`'s options). Houdini page: `PathCode` chip, Skip / Add project (persistPatch `houdiniProjects` append with the case-insensitive dedupe from `houdini-projects-field.tsx:233-234`). Every action: mark handled, run, `onActed()`; Add errors surface inline and un-handle.
Banner copy: "N new file(s) found in this character's folder" + per-kind counts; buttons Review / ✕ (aria-label "Dismiss").

- [ ] **Step 1: Implement banner + wizard + `useSceneAddValidation`.**
- [ ] **Step 2: Wire the route:** `const detect = useDetectedFiles(projectId, character)` + `[reviewOpen, setReviewOpen]`; banner rendered when `detect.detected` non-empty && !bannerDismissed && !reviewOpen; wizard `open={reviewOpen}`.
- [ ] **Step 3: Verify** `pnpm --filter @dth/web typecheck && pnpm lint`.
- [ ] **Step 4: Commit** `feat(web): new-file banner + add wizard on the character page`.

### Task 6: Playwright smoke

**Files:**
- Create: `apps/web/smoke/detected-files.smoke.ts`

Seed (`buildSeed` + extra `files`): unlinked `D:/DTH Projects/Demo/Kira/daz3d/KiraBeach_G9_GP.duf` (+ `sceneWearables` entry so validation passes) and unlinked `D:/DTH Projects/Demo/Kira/houdini/KiraExtra.hip`; decoys that must NOT surface: a `.duf` under `daz3d/dth-exports/...`, a `..._ROM.duf`, a `.hip` under `houdini/backup/`.
Flow asserted:
1. Open character page → banner shows "2 new files…".
2. ✕ dismisses; `page.evaluate(() => { window.__tauriMock.files.set('D:/DTH Projects/Demo/Kira/daz3d/KiraParty_G9_GP.duf', '…'); window.dispatchEvent(new Event('focus')) })` → banner returns with 3.
3. Review → wizard "1 of 3"; while open, seed a 4th file + focus event → "1 of 4" (live append).
4. Add the scene page → definition JSON in the mock fs gains the path in `extraScenes`.
5. Skip the `.hip` page → `D:/DTH Projects/Demo/.dcsmeta/characters/Kira/detected-ignore.json` contains `houdini/KiraExtra.hip`; remaining pages acted → wizard closes, banner gone.
6. Standard closing assertion: `__tauriMock.unhandled` empty.

- [ ] **Step 1: Write the smoke.**
- [ ] **Step 2: Run** `pnpm --filter @dth/web smoke detected-files` — expect PASS.
- [ ] **Step 3: Commit** `test(web): detected-files smoke`.

### Task 7: Changeset, docs, verify, push

- [ ] **Step 1: Changeset** (minor, fixed group — follow an existing `.changeset/*.md`'s shape) describing the feature.
- [ ] **Step 2: Guide touch:** if `docs/guide` documents adding scenes/Houdini projects, add a short paragraph on auto-detection (banner + wizard + permanent skip). Run `pnpm build:guide` if touched.
- [ ] **Step 3: Full gate:** `pnpm -r typecheck && pnpm lint && pnpm -r test && pnpm --filter @dth/web smoke` — all PASS (fix anything that isn't).
- [ ] **Step 4: Commit remaining files**, push `feature/detect-new-character-files`, set upstream per the hook's three commands.
