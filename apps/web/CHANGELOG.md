# @dth/web

## 0.3.0

### Minor Changes

- [#9](https://github.com/polynaut/dth-character-studio/pull/9) [`03f575d`](https://github.com/polynaut/dth-character-studio/commit/03f575d9d4e77926870c8369fb9d1e4714596b36) Thanks [@polynaut](https://github.com/polynaut)! - Support multiple game projects, each with its own character library. On first run the studio asks for your **"My DAZ 3D Library"** path; the home screen is now a **projects** list — each project is a name + a folder that holds that project's characters. Open a project to manage its characters, with the project name and folder shown.

### Patch Changes

- Updated dependencies []:
  - @dth/rom@0.3.0

## 0.2.1

### Patch Changes

- [#6](https://github.com/polynaut/dth-character-studio/pull/6) [`d78e690`](https://github.com/polynaut/dth-character-studio/commit/d78e690659c17d20baef8aa23385c91d9515c08b) Thanks [@polynaut](https://github.com/polynaut)! - Restyle the UI to match Daz Studio's dark palette — warm-neutral grays with a teal/spring-green accent — as a single dark-only theme (no light mode, since Daz and Houdini have none). Removes the leftover light-theme template CSS.

- [#6](https://github.com/polynaut/dth-character-studio/pull/6) [`d78e690`](https://github.com/polynaut/dth-character-studio/commit/d78e690659c17d20baef8aa23385c91d9515c08b) Thanks [@polynaut](https://github.com/polynaut)! - Only render the TanStack DevTools button in development — it was shipping in installed/production builds. Gated on `import.meta.env.DEV`, so the production bundle also drops the devtools code.

- Updated dependencies []:
  - @dth/rom@0.2.1

## 0.2.0

### Minor Changes

- [#2](https://github.com/polynaut/dth-character-studio/pull/2) [`7131015`](https://github.com/polynaut/dth-character-studio/commit/71310154dfd5b07d4f2d1f150c0a66e5c6ac652d) Thanks [@polynaut](https://github.com/polynaut)! - Separate app data from a user-owned character library. Settings and avatars stay
  in the app's private folder; each character now lives in its own folder
  (`<library>/<Name>/`) holding its definition **and** its generated files
  (`.dsa`, FBM JSON, PoseAsset CSV), inside a library folder the user picks and
  backs up. Adds a first-run folder picker, native folder pickers in Settings, and
  a per-character "Storage location" panel to view the absolute path and move a
  character into subfolders.

- [#2](https://github.com/polynaut/dth-character-studio/pull/2) [`7131015`](https://github.com/polynaut/dth-character-studio/commit/71310154dfd5b07d4f2d1f150c0a66e5c6ac652d) Thanks [@polynaut](https://github.com/polynaut)! - Migrate the desktop runtime from Electron to Tauri 2, convert the frontend to a client-rendered SPA, and restructure into a 2-layer monorepo: `@dth/web` (SPA frontend), `@dth/desktop` (Tauri shell), `@dth/rom` (pure generation core). Adds in-app auto-update (GitHub Releases) and a changesets-driven release pipeline.

### Patch Changes

- [#2](https://github.com/polynaut/dth-character-studio/pull/2) [`7131015`](https://github.com/polynaut/dth-character-studio/commit/71310154dfd5b07d4f2d1f150c0a66e5c6ac652d) Thanks [@polynaut](https://github.com/polynaut)! - Store character avatars as a portable reference (a filename or an external URL) instead of a machine-specific asset URL, and resolve the loadable image at render time. Shared character JSON no longer embeds local paths, and a missing local avatar falls back to the initial-letter placeholder instead of a broken image. Legacy avatar values (old asset/Electron-route URLs) migrate to the new form on load.

- Updated dependencies [[`7131015`](https://github.com/polynaut/dth-character-studio/commit/71310154dfd5b07d4f2d1f150c0a66e5c6ac652d)]:
  - @dth/rom@0.2.0
