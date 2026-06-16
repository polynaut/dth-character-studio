# @dth/rom

## 0.5.0

## 0.4.0

### Minor Changes

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - Character editor: the **Filepath** field now spans the full width of the card
  (it sits on its own row below the settings instead of being squeezed beside the
  Genesis-specific box), so long paths are fully visible. Characters created from a
  Daz scene now record that scene's path, shown read-only as a **Daz scene** field
  beneath the Filepath. Adds an optional `scenePath` to the character schema
  (empty for characters made before the scene-based create flow).

## 0.3.2

## 0.3.1

## 0.3.0

## 0.2.1

## 0.2.0

### Minor Changes

- [#2](https://github.com/polynaut/dth-character-studio/pull/2) [`7131015`](https://github.com/polynaut/dth-character-studio/commit/71310154dfd5b07d4f2d1f150c0a66e5c6ac652d) Thanks [@polynaut](https://github.com/polynaut)! - Migrate the desktop runtime from Electron to Tauri 2, convert the frontend to a client-rendered SPA, and restructure into a 2-layer monorepo: `@dth/web` (SPA frontend), `@dth/desktop` (Tauri shell), `@dth/rom` (pure generation core). Adds in-app auto-update (GitHub Releases) and a changesets-driven release pipeline.
