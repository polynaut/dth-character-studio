# @dth/ui

## 0.45.2

## 0.45.1

## 0.45.0

## 0.44.11

## 0.44.10

## 0.44.9

## 0.44.8

## 0.44.7

## 0.44.6

## 0.44.5

## 0.44.4

## 0.44.3

### Patch Changes

- [#354](https://github.com/polynaut/dth-character-studio/pull/354) [`98de896`](https://github.com/polynaut/dth-character-studio/commit/98de896b234423b327dbe1db868d8edd76fadd25) Thanks [@polynaut](https://github.com/polynaut)! - Keyboard and screen-reader accessibility sweep: a new `Modal` primitive (Radix Dialog — real focus trap, initial focus, focus restore, Escape/backdrop dismissal, proper dialog semantics) now backs every previously hand-rolled overlay (remove-asset, bulk-delete, scene-copy, avatar image, scene-copy prompt and the "Daz already open" notice — the avatar dialog gains Escape support it never had). The side panel manages focus properly instead of declaring `aria-modal` without containment. ROM section headers are real accordion buttons (focusable, Enter/Space, `aria-expanded`) instead of click-only divs. `Field` labels are programmatically associated with their controls and errors (`htmlFor`/`aria-describedby`). The linked-asset card's corner-open control works from the keyboard, `NumberField` commits on Enter, the editable page title keeps its heading semantics for assistive tech, the Home screen's "remove from recents" button becomes visible on keyboard focus, and the UI-config provider no longer re-renders all consumers on every host render.

- [#356](https://github.com/polynaut/dth-character-studio/pull/356) [`0b2c8dd`](https://github.com/polynaut/dth-character-studio/commit/0b2c8dd8739f2e6531d6c1dc9dac74a603337cb3) Thanks [@polynaut](https://github.com/polynaut)! - Opportunistic cleanups: the Deduplicate tool's shared-file groups gain the "Accept" button its help text always promised — marking a group as legitimately shared now actually persists (it stopped appearing on the next scan) instead of being a dead code path. The Settings route's release/exporter pickers and the network-drives section move into `components/settings/`, and the UI kit's public surface drops exports nothing consumes (the unused `Slider` primitive, plus internal-only helpers). Inside the generation core, the thrice-copied groom "hide-tree" DzScript snippet is extracted into one name-parameterised builder (byte-identical output, pinned by the existing tests). Two more Playwright smoke flows cover the character editor's inline rename end-to-end.

## 0.44.2

## 0.44.1

## 0.44.0

### Minor Changes

- [#345](https://github.com/polynaut/dth-character-studio/pull/345) [`05d3a78`](https://github.com/polynaut/dth-character-studio/commit/05d3a781f16303b3d929fe287bae5cec383305c1) Thanks [@polynaut](https://github.com/polynaut)! - The groom (hair) settings moved up under the Daz scene cards — the lists are per scene, so selecting a card now visibly swaps the hair list right beneath it. The list itself is a new multi-select combobox (new `MultiSelect` in `@dth/ui`): the selected items sit in one always-rendered field as removable pills, clicking into it lists the scene's remaining wearables (hair-ish first, type to filter), and a label the scan doesn't offer can still be typed and added. A pill whose label isn't found in the scene turns amber with a tooltip. The combobox implements the full ARIA pattern (active-descendant list, wrap-around arrow keys, Home/End, match highlighting) — pills are keyboard-reachable via ArrowLeft, Backspace asks twice before dropping one, and Escape closing the list won't also close a surrounding dialog.

## 0.43.1

## 0.43.0

## 0.42.6

## 0.42.5

## 0.42.4

## 0.42.3

## 0.42.2

## 0.42.1

### Patch Changes

- [#318](https://github.com/polynaut/dth-character-studio/pull/318) [`822ceaf`](https://github.com/polynaut/dth-character-studio/commit/822ceafafb2d9b12a8a97383a4676bdfd04c7651) Thanks [@polynaut](https://github.com/polynaut)! - Settings grew an "App Data" tab (app data folder + storage housekeeping, moved out of General/Tools), the Project tab leads in project windows, network drives got their own pane at the bottom of General, and the import picker's rows expand to a copyable path chip instead of a tooltip. Tooltips app-wide now wrap long paths correctly. The "Empty quarantine" button is gone — the dedup quarantine is a plain folder you manage yourself in Explorer.

## 0.42.0

## 0.41.42

## 0.41.41

## 0.41.40

## 0.41.39

### Patch Changes

- [#306](https://github.com/polynaut/dth-character-studio/pull/306) [`feafd91`](https://github.com/polynaut/dth-character-studio/commit/feafd9150fb1bbcf3f49fed6ed2c9eb020238736) Thanks [@polynaut](https://github.com/polynaut)! - The FACS detail / Flexion strength dials now show Daz-style percentages (0–100 %, with a % suffix) like every morph value field, and the Genesis 9 box got more breathing room between the tear-UV toggle and the dials. Stored values are unchanged (raw 1 = 100 %) — no migration needed.

## 0.41.38

## 0.41.37

## 0.41.36

## 0.41.35

## 0.41.34

## 0.41.33

## 0.41.32

## 0.41.31

## 0.41.30

## 0.41.29

## 0.41.28

### Patch Changes

- [#281](https://github.com/polynaut/dth-character-studio/pull/281) [`690844d`](https://github.com/polynaut/dth-character-studio/commit/690844d6e3ae0a38448892581eb2e4d25f2b04fb) Thanks [@polynaut](https://github.com/polynaut)! - Make input validation errors clearer. Invalid fields now show a **more visible red
  border** (a 2px destructive ring instead of a faint 1px border — both the ROM cell
  inputs and the shared `Input` primitive), and a field whose error lived in a `title`
  attribute (the ROM name/morph cells) now shows it in a proper **alert-style tooltip**
  (red background, light text) via a new `data-tooltip-variant="error"` on the global
  tooltip.

## 0.41.27

### Patch Changes

- [#279](https://github.com/polynaut/dth-character-studio/pull/279) [`b0125f0`](https://github.com/polynaut/dth-character-studio/commit/b0125f0baa6191c188f95a5fa6575b77ce7fb150) Thanks [@polynaut](https://github.com/polynaut)! - Stop tooltips floating above modal dialogs. The global tooltip (`z-100`) could show
  over a dialog (`z-50`) — e.g. the "Open in Daz" tooltip lingering above the
  "Daz Studio is already open" modal. The tooltip now stays hidden when its anchor is
  covered by an element in another subtree (a dialog overlay), while tooltips on
  elements inside a dialog still work.

## 0.41.26

## 0.41.25

## 0.41.24

## 0.41.23

## 0.41.22

## 0.41.21

## 0.41.20

## 0.41.19

## 0.41.18

## 0.41.17

## 0.41.16

## 0.41.15

## 0.41.14

## 0.41.13

## 0.41.12

## 0.41.11

## 0.41.10

## 0.41.9

## 0.41.8

## 0.41.7

## 0.41.6
