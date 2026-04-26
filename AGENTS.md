# AGENTS.md

## Purpose
This project is a local Electron app for browsing GitHub/GitLab PRs/MRs and rendering diffs with Pierre components.

## Stack
- Frontend: React + TypeScript + Vite + Tailwind
- Desktop shell: Electron
- Backend: TypeScript in Electron main process, Effect services, tRPC over Electron IPC
- Data source: GitHub CLI (`gh`) and GitLab CLI (`glab`) invoked from the Electron backend
- JavaScript package manager/runtime: Bun

## Important Structure
- `src/App.tsx`: top-level state and orchestration for repo/PR selection.
- `src/components/ui/repo-sidebar.tsx`: repo + PR list/selection.
- `src/components/ui/patch-viewer-main.tsx`: main patch area, tree/diff layout, tree hide/show UX.
- `src/components/ui/changed-files-tree.tsx`: changed-files tree panel.
- `src/queries/forge.ts`: renderer React Query options backed by tRPC.
- `src/lib/trpc.ts`: renderer tRPC client.
- `electron/main/`: Electron bootstrap, window security, updater, and tRPC IPC registration.
- `electron/preload/`: isolated preload exposure for `electron-trpc`.
- `electron/shared/`: shared DTOs and tRPC router type.
- `electron/backend/`: Effect services, provider implementations, CLI execution, repo id helpers, and SQLite cache.

## Current UX Behavior (keep consistent)
- App shell is fixed to viewport height (`h-screen`) with internal scrolling only.
- Main content has a single shared container for file tree + diff content.
- File tree takes roughly 1/3 width when visible.
- File tree can be hidden; hidden state uses Base UI Popover to access the tree.

## Backend Contract
- `pullRequests.list(repoId)` returns PR/MR summaries and refreshes the repo cache.
- `pullRequests.getPatch(repoId, number, headSha)` returns patch text for rendering.
- `pullRequests.listChangedFiles(repoId, number, headSha)` returns changed file paths.
- `tracked.*` owns tracked PR persistence.
- `reviewComments.*` owns viewer login, review thread loading, creation, replies, and updates.
- `preflight.getCliStatuses(gitlabHost)` reports provider CLI readiness.

## Dependency Notes
- Use `@pierre/trees@0.0.1-beta.4`.
- Do not switch to a floating/latest tag without checking installability; newer metadata can fail in this repo setup.

## Working Rules For Agents
- Keep UI changes aligned with existing Tailwind design tokens (`bg-canvas`, `bg-surface`, etc.).
- Prefer small focused components over growing `App.tsx`.
- Keep tree and diff states decoupled: one may fail while the other still renders.
- Use Bun everywhere for JS tasks (`bun install`, `bun add`, `bun run ...`); do not use npm.

## Electron Backend Architecture
- `electron/main/index.ts`: app lifecycle only.
- `electron/main/window.ts`: BrowserWindow creation, preload wiring, and navigation/window-open security.
- `electron/main/trpc.ts`: tRPC IPC registration only.
- `electron/main/updater.ts`: Electron updater integration.
- `electron/shared/router.ts`: tRPC procedures as thin adapters over Effect services.
- `electron/backend/cache.ts`: SQLite init and cache persistence.
- `electron/backend/providers/`: forge provider implementations for GitHub and GitLab.
- `electron/backend/cli/`: command execution helpers and CLI discovery.
- `electron/backend/services/`: domain services for repos, PRs, tracked PRs, review comments, and diff data.

### Module Boundary Rules
- tRPC procedures call services; procedures should not contain SQL or large provider payload parsing.
- Cache code should stay isolated from Electron window/UI concerns.
- Provider modules own CLI commands and API/GraphQL payload parsing.
- Keep renderer query keys stable when refactoring.
- Prefer domain modules over generic utility growth.

## Build/Run Policy
- NEVER build the app yourself.
- Do not run build commands like:
  - `bun run build`
  - `electron-vite build`
  - `electron-builder`
- Never start the dev server.
- Only run build/check commands if the user explicitly asks for them in the current session.
