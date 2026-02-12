# Ralph Desktop Orchestrator

Electron + React + TypeScript application for AI-powered software development orchestration. Ralph generates structured project plans from PRD text, breaks them into dependency-ordered checklist tasks, and executes each task in isolated Claude Agent SDK sessions with real-time streaming progress.

## Features

- Generate a Ralph-aligned plan from PRD text using Claude AI
- Persist plans, tasks, runs, and events in a local SQLite database
- Create and track dependency-ordered checklist tasks
- Execute one strict Ralph task per run in a fresh Claude agent context
- Stream real-time task progress, log output, and todo tracking
- Discovery interview flow with specialist agent analysis
- Retry, skip, and abort controls for failed tasks
- Model configuration for different agent roles
- Keyboard shortcuts for common actions

## Requirements

- **Node.js** 20+
- **npm** 10+
- **Python** 3.x (required by node-gyp for native module compilation)
- **C++ build tools** (required by better-sqlite3 native compilation):
  - Windows: Visual Studio Build Tools with "Desktop development with C++"
  - macOS: Xcode Command Line Tools (`xcode-select --install`)
  - Linux: `build-essential` package
- A working local **Claude Code** authentication setup (for the Claude Agent SDK runtime)

## Setup

### 1. Clone and install

```bash
git clone <repo-url>
cd claude-ralph
npm install
```

The `postinstall` script automatically rebuilds the `better-sqlite3` native module for the installed Electron version. If this fails, you can run it manually:

```bash
npm run rebuild:native
```

### 2. Verify the build

```bash
npm run build
npm run typecheck
```

### 3. Start development

```bash
npm run dev
```

This starts the electron-vite dev server with hot module replacement for the renderer process. Changes to main process files require a restart.

## Development Workflow

### Running the app

```bash
npm run dev          # Development mode with HMR
npm run build        # Production build to out/
npm run preview      # Preview the production build
```

### Type checking

```bash
npm run typecheck    # Check both main (node) and renderer (web) TypeScript configs
```

### Testing

```bash
# Unit tests (Vitest)
npm run test:unit          # Single run
npm run test:unit:watch    # Watch mode (re-runs on file change)
npm run test:coverage      # With coverage report (v8 provider)

# E2E tests (Playwright + Electron)
npm run test:e2e           # Builds app first, then runs E2E suite
```

Unit tests use in-memory SQLite for database tests and mock `window.ralphApi` for renderer store tests. E2E tests launch the built Electron app with an isolated temporary database per test.

### Project structure

See [ARCHITECTURE.md](./ARCHITECTURE.md) for a comprehensive overview of the directory structure, data flow, component hierarchy, state management, IPC contract, DB schema, and testing strategy.

### Key directories

| Directory                  | Purpose                                          |
|----------------------------|--------------------------------------------------|
| `src/main/`               | Electron main process (Node.js)                  |
| `src/main/runtime/`       | Database, task runner, agent service              |
| `src/preload/`            | Secure IPC bridge (contextBridge)                 |
| `src/renderer/`           | React SPA (components, views, stores, services)   |
| `src/shared/`             | Types and IPC channel definitions (shared across processes) |
| `resources/migrations/`   | Numbered SQL migration files                      |
| `tests/unit/`             | Vitest unit tests                                 |
| `tests/e2e/`              | Playwright E2E tests                              |

### Database

The app stores data in a local SQLite file under Electron's `userData` directory (`ralph-desktop.sqlite`). The database uses WAL mode for concurrent read/write performance and foreign keys with ON DELETE CASCADE for referential integrity.

Database schema changes are managed via numbered SQL migrations in `resources/migrations/`. New migrations should be numbered sequentially (e.g., `007_your_change.sql`).

### Adding a new IPC channel

1. Add the channel name to `IPC_CHANNELS` in `src/shared/ipc.ts`
2. Add input/response TypeScript interfaces to `src/shared/types.ts`
3. Add a Zod input validation schema to `src/shared/ipc.ts`
4. Add the method to the `RalphApi` interface in `src/shared/types.ts`
5. Implement the handler in `src/main/ipc.ts`
6. Add the pass-through method to `src/main/runtime/task-runner.ts`
7. Add the bridge method to `src/preload/index.ts`
8. Add the mock method to `src/test-utils/mock-ralph-api.ts`

## Notes

- Task execution uses strict mode defaults:
  - Fresh run isolation with explicit `/clear`
  - One checklist item per run
  - Build/test/commit/progress expectations in the task prompt
- The discovery flow runs 5 specialist analysis agents in parallel, then synthesizes results into a structured interview
- Run event pagination uses cursor-based pagination (100 events per page by default) for efficient retrieval of large event histories
