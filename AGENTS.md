# Repository Guidelines

## Project Structure & Module Organization
- `apps/desktop/`: Tauri v2 + Solid desktop app.
  - `src/`: Solid UI code (TypeScript/TSX).
  - `src-tauri/`: Rust-side Tauri config and commands.
  - `public/`: static assets.
- `apps/mobile-android/`: placeholder for Android app (read/quick-capture).
- `apps/sync-server/`: placeholder for Node sync server.
- `packages/`: shared packages (planned: core-db, core-model, editor-core, plugin-runtime, crypto, sync-protocol).
- `docs/BUILD_PLAN.md`: phased roadmap and checklists.

## Build, Test, and Development Commands
Run from repo root:
- Install Vite+ globally once using the official setup instructions, then open a new terminal session.
- `vp install`: install all workspace dependencies.
- `vp run dev:desktop`: run Solid dev server for the desktop UI.
- `vp run tauri:dev`: run the Tauri desktop app.
- `vp run build:desktop`: build the Solid UI.
- `vp run -r lint`: run linting across workspaces.
- `vp run -r check`: run workspace checks with Vite+.
- `vp run -r test`: run unit tests (Vitest).
- `vp run test:watch`: watch mode for tests.
- `vp run test:ui`: Vitest UI runner.
- `vp run ready`: run the repo readiness sweep used by this monorepo.

## Vite+ Workflow
- `vp` is expected to be available as a global CLI after the one-time Vite+ install step.
- Prefer `vp` over direct `pnpm` usage for install, dependency management, lint, check, test, build, and monorepo task execution.
- Use built-in `vp` commands for tool entrypoints inside a workspace: `vp dev`, `vp build`, `vp lint`, `vp check`, `vp test`.
- Use `vp run <script>` for custom scripts. This matters when a script name overlaps with a Vite+ built-in command.

## Coding Style & Naming Conventions
- **File names must be kebab-case** (e.g., `virtual-list.ts`, `app.tsx`).
- TypeScript + TSX; strict TS settings are enabled.
- Indentation: 2 spaces.
- Linting: ESLint with `eslint-plugin-solid`.
- Keep components small and composable; prefer Solid signals/stores.

## Testing Guidelines
- **TDD required**: write tests before implementing changes.
- Test framework: Vitest + Solid Testing Library.
- Test files live alongside code: `src/**/*.test.ts(x)`.
- Run: `vp run -r test` or `vp run test:watch`.

## Commit & Pull Request Guidelines
- Use **Conventional Commits** (e.g., `feat: add virtual list`, `fix: handle empty blocks`).
- ALWAYS run validation before finishing work or committing: `vp run -r check` and `vp run -r test`.
- PRs should include: summary, testing notes, and UI screenshots when visuals change.

## Agent-Specific Notes
- Follow repo conventions and update `docs/BUILD_PLAN.md` when checkboxes are completed.
- Prefer minimal, incremental changes; avoid reformatting unrelated files.
- Keep the `"Create page with all block types"` command in sync with supported block types: whenever a new block type is added, update the showcase seed builder and its coverage test.
