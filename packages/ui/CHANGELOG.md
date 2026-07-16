# @dth/ui

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
