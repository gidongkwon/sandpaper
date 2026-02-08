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
- `pnpm install`: install all workspace dependencies.
- `pnpm dev:desktop`: run Solid dev server for the desktop UI.
- `pnpm tauri:dev`: run the Tauri desktop app.
- `pnpm build:desktop`: build the Solid UI.
- `pnpm lint`: run ESLint on the desktop app.
- `pnpm typecheck`: TypeScript typecheck for the desktop app.
- `pnpm test`: run unit tests (Vitest).
- `pnpm test:watch`: watch mode for tests.
- `pnpm test:ui`: Vitest UI runner.

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
- Run: `pnpm test` or `pnpm test:watch`.

## Commit & Pull Request Guidelines
- Use **Conventional Commits** (e.g., `feat: add virtual list`, `fix: handle empty blocks`).
- ALWAYS run lint and typecheck before finishing work or committing: `pnpm lint` and `pnpm typecheck`.
- PRs should include: summary, testing notes, and UI screenshots when visuals change.

## Agent-Specific Notes
- Follow repo conventions and update `docs/BUILD_PLAN.md` when checkboxes are completed.
- Prefer minimal, incremental changes; avoid reformatting unrelated files.
- Keep the `"Create page with all block types"` command in sync with supported block types: whenever a new block type is added, update the showcase seed builder and its coverage test.
