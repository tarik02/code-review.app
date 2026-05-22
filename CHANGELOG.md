# Changelog

## 0.2.3

### Patch Changes

- 960aca8: improve provider api partial diffs so context expansion hydrates full file contents lazily while preserving native diff controls.
- 960aca8: fix review and quality popup scrolling, drag handling, and virtualized diff placeholder surfaces.
- cf26520: add an off-by-default review setting for floating editor toolbar and footer controls.
- fa74d9c: Improve low-width review comment headers by keeping metadata on one line and collapsing actions into a menu.

## 0.2.2

### Patch Changes

- 00d3659: improve pull request review layout and summary actions
- 799f365: improve pull request refresh, link, copy, and stale approval actions
- 00d3659: refactor provider auth around stable profile records
- 799f365: use exhaustive tagged error matching for provider failures
- 00d3659: add resizable pull request and review panels
- 799f365: reset sqlite schema migrations to a single baseline
- 799f365: retry transient GitLab read transport failures

## 0.2.1

### Patch Changes

- 57d64bc: optimize review comment rendering and GitLab merge request loading
- b105d77: add pull request data source selection

## 0.2.0

### Minor Changes

- 63f9dc6: Add code appearance settings for diff typography, ligatures, and syntax theme presets, plus a reusable number field control for numeric settings.
- 07cb391: Add provider-native pending review comments with local persistence and bulk submit controls.

### Patch Changes

- d222f43: Refactor the frontend router to TanStack file-based routing with generated route trees.

## 0.1.1

### Patch Changes

- 8251ab6: fix release asset path in ci

## 0.1.0

### Minor Changes

- 4be9249: prepare the first tagged app release

## 0.1.0

### Minor Changes

- 60b0760: Prepare the first tagged release.
  - switch tests to Vite+ test projects
  - make qg typecheck forwarding safe in CI

All notable changes to `code-review.app` will be documented in this file.
