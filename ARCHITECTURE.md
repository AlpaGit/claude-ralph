# Ralph Desktop Orchestrator - Architecture

## Overview

Ralph Desktop Orchestrator is an Electron application that orchestrates AI-powered software development workflows. It generates structured project plans from PRD (Product Requirements Document) text, breaks them into dependency-ordered checklist tasks, and executes each task in isolated Claude Agent SDK sessions with real-time streaming progress.

The application follows a strict three-process Electron architecture: **main** (Node.js backend), **preload** (secure bridge), and **renderer** (React UI). All inter-process communication flows through typed IPC channels validated by Zod schemas.

## Directory Structure

```
claude-ralph/
  electron.vite.config.ts        # Electron-Vite build configuration (main, preload, renderer)
  vitest.config.ts                # Vitest unit test configuration
  playwright.config.ts            # Playwright E2E test configuration
  tsconfig.json                   # Base TypeScript config
  tsconfig.node.json              # TS config for main + preload (Node.js target)
  tsconfig.web.json               # TS config for renderer (DOM target)
  package.json                    # Dependencies, scripts, Electron entry point
  resources/
    migrations/                   # Numbered SQL migration files (001_ through 006_)
  src/
    main/                         # Electron main process (Node.js)
      index.ts                    # App bootstrap, window creation, DB init
      ipc.ts                      # IPC handler registration, Zod validation, error formatting
      runtime/
        app-database.ts           # SQLite data access layer (better-sqlite3)
        app-database.test.ts      # Co-located smoke tests
        task-runner.ts            # Orchestration: plan CRUD, run execution, discovery, queue
        ralph-agent-service.ts    # Claude Agent SDK wrapper for all AI operations
        ralph-schema.ts           # Zod schemas for agent SDK structured outputs
        migrations/
          migration-runner.ts     # SQL migration runner (numbered file ordering, transactions)
    preload/
      index.ts                    # contextBridge: exposes ralphApi to renderer (typed IPC bridge)
    renderer/                     # React SPA (Vite-bundled)
      index.html                  # HTML entry point
      index.tsx                   # React root: StrictMode + AppErrorBoundary + RouterProvider
      router.tsx                  # Hash router with route definitions and error boundaries
      tokens.css                  # Design tokens (CSS custom properties)
      styles.css                  # Global resets and base styles
      App.tsx                     # Legacy app component (preserved for reference)
      App.module.css              # CSS Module for legacy App component
      components/
        AppShell/                 # Layout shell: sidebar + content + drag region + toast + shortcuts
        layout/
          Sidebar.tsx             # Collapsible sidebar with nav links and plan list
          ErrorBoundary.tsx       # App-level and view-level error boundaries
        plan/
          PlanOverview.tsx        # Plan summary and metadata card
          TechnicalPackPanel.tsx  # Architecture notes, risks, dependencies, test strategy
          TaskCard.tsx            # Collapsible task card with actions (run, retry, skip, abort)
          RecentEvents.tsx        # Scrollable run event list
          PlanCreationProgress.tsx # Multi-phase progress indicator for plan generation
        ui/
          UButton.tsx             # Button with variants, sizes, loading state
          ULogViewer.tsx          # Virtualized log viewer (react-window, ring buffer, search)
          RingBuffer.ts           # Generic circular buffer for log line storage
          IpcErrorDetails.tsx     # Collapsible IPC error details panel
        ui.ts                     # Barrel export for all UI primitives
        UCard/                    # Bordered panel container
        UInput/                   # Text input with label, error, helper
        UTextArea/                # Multi-line textarea with auto-resize and char count
        UModal/                   # Dialog overlay with focus trap (UModal, UConfirmModal)
        USkeleton/                # Loading placeholder (text, card, circle variants)
        UStatusPill/              # Colored status badge
        KeyboardShortcutHelp/     # Keyboard shortcut help modal
        PromptTemplateBuilder.tsx # Deprecated: legacy discovery component
      views/
        PlanListView.tsx          # Plan list with search, archive toggle, create flow
        PlanDetailView.tsx        # Plan detail: overview, tech pack, task checklist, live run
        DiscoveryView.tsx         # Discovery interview: seed input, specialist progress, Q&A
        LiveRunView.tsx           # Run detail: metadata, todos, log viewer, cancel progress
        SettingsView.tsx          # Model configuration, app preferences, about info
      stores/
        planStore.ts              # Zustand store for plan CRUD and list state
        runStore.ts               # Zustand store for active runs, logs, todos, events
        discoveryStore.ts         # Zustand store for discovery interview state
        settingsStore.ts          # Zustand store for model configuration
      services/
        toastService.ts           # Typed wrapper around react-hot-toast
        ipcErrorService.ts        # IPC error JSON parsing and extraction
      hooks/
        useKeyboardShortcuts.ts   # Global keyboard shortcut registration hook
    shared/                       # Shared between main, preload, and renderer
      types.ts                    # All TypeScript interfaces and type unions
      ipc.ts                      # IPC channel names, Zod input schemas
    test-utils/
      mock-database.ts            # In-memory SQLite factory for unit tests
      mock-ralph-api.ts           # Mock window.ralphApi for renderer tests
      index.ts                    # Barrel export for test utilities
  tests/
    unit/
      app-database.test.ts        # 73 tests for AppDatabase methods
      zod-schemas.test.ts         # 130 tests for all Zod schemas
      migrations.test.ts          # 27 tests for MigrationRunner
      stores/
        planStore.test.ts         # 32 tests for planStore
        runStore.test.ts          # 41 tests for runStore
    e2e/
      electron-fixture.ts         # Playwright Electron fixture (temp DB, page helpers)
      app-launch.e2e.ts           # Smoke tests: window opens, sidebar visible
      plan-crud.e2e.ts            # Plan CRUD lifecycle (create, view, archive, delete, search)
      task-execution.e2e.ts       # Task run lifecycle with synthetic events
      error-recovery.e2e.ts       # Retry, skip, abort queue scenarios
      discovery-flow.e2e.ts       # Discovery interview, resume, specialist progress
```

## Data Flow Diagrams

### Plan Creation Flow

```
User enters PRD text in UI
        |
        v
[Renderer] planStore.createPlan()
        |
        v (IPC: plan:create)
[Main] ipc.ts -> Zod validation -> taskRunner.createPlan()
        |
        v
[Main] ralphAgentService.createPlan()
        |  - Calls Claude Agent SDK with structured output schema
        |  - Returns TechnicalPack + checklist items
        v
[Main] appDatabase.createPlan()
        |  - INSERT INTO plans (with technical_pack_json)
        |  - INSERT INTO tasks (one per checklist item, ordinal-ordered)
        v
Returns { planId } to renderer via IPC
```

### Task Execution Flow

```
User clicks "Run Task" on TaskCard
        |
        v
[Renderer] runStore.startRun() -> IPC: task:run
        |
        v
[Main] taskRunner.runTask()
        |  - createRun() -> DB INSERT (status: in_progress)
        |  - updateTaskStatus() -> pending -> in_progress
        |  - updatePlanStatus() -> running
        |  - emit RunEvent(started) via webContents.send("run:event")
        v
[Main] ralphAgentService.runTask()
        |  - Claude Agent SDK session with task prompt
        |  - Streaming: log lines, todo updates emitted as RunEvents
        |  - Each event: appDatabase.appendRunEvent() + webContents.send()
        v
[Main] On completion/failure:
        |  - updateRun() with final status, cost, duration
        |  - updateTaskStatus() -> completed/failed
        |  - updatePlanStatus() -> ready/completed/failed
        |  - emit RunEvent(completed/failed)
        v
[Renderer] runStore._handleRunEvent() updates UI state in real-time
```

### Discovery Interview Flow

```
User enters seed sentence, clicks Start Discovery
        |
        v
[Renderer] discoveryStore.startDiscovery() -> IPC: discovery:start
        |
        v
[Main] taskRunner.startDiscovery()
        |  - Creates DiscoverySession in memory
        |  - Calls ralphAgentService.startDiscovery()
        |    - Runs 5 specialist agents in parallel (Promise.allSettled)
        |    - Synthesizes results into DiscoveryInterviewState
        |  - Emits DiscoveryEvents via webContents.send("discovery:event")
        |  - Persists session to discovery_sessions table
        v
Returns DiscoveryInterviewState (questions, inferred context, readiness)
        |
        v
User answers questions, clicks Continue
        |
        v
[Renderer] discoveryStore.continueDiscovery() -> IPC: discovery:continue
        |
        v
[Main] taskRunner.continueDiscovery()
        |  - Passes answers + history to agent service
        |  - Returns refined state (new questions, updated readiness)
        |  - Persists updated session to DB
        v
Repeat until readiness >= threshold or user accepts PRD draft
```

## Component Hierarchy

```
<StrictMode>
  <AppErrorBoundary>
    <RouterProvider router={hashRouter}>
      <AppShell>                          # Layout + Toaster + Keyboard shortcuts
        <Sidebar />                       # Nav links + plan list + collapse toggle
        <Outlet>                          # Route content
          <RouteErrorBoundary>
            <PlanListView />              # Route: /
            <PlanDetailView />            # Route: /plan/:planId
              <PlanOverview />
              <TechnicalPackPanel />
              <TaskCard /> (per task)
              <RecentEvents />
              <PlanCreationProgress />
            <DiscoveryView />             # Route: /discovery
            <LiveRunView />               # Route: /run/:runId
              <ULogViewer />
            <SettingsView />              # Route: /settings
          </RouteErrorBoundary>
        </Outlet>
      </AppShell>
    </RouterProvider>
  </AppErrorBoundary>
</StrictMode>
```

## State Management

Four Zustand stores manage client-side state. All stores use the standard Zustand `create` pattern; `runStore` additionally uses `immer` middleware for efficient nested map updates.

### planStore
- **State**: `currentPlan`, `plansList`, `loadingPlan`, `loadingList`, `creating`, `error`, `lastIpcError`
- **Actions**: `createPlan`, `loadPlan`, `loadPlanList`, `deletePlan`, `archivePlan`, `unarchivePlan`, `clearError`
- **IPC**: `plan:create`, `plan:get`, `plan:list`, `plan:delete`, `plan:archive`, `plan:unarchive`

### runStore
- **State**: `activeRuns` (Map), `runLogs` (Map), `runTodos` (Map), `selectedRunId`, `recentEvents`, `runLogOverflow`, `cancelRequestedAt`
- **Actions**: `startRun`, `cancelRun`, `appendLog`, `appendTodo`, `selectRun`
- **Events**: Subscribes to `run:event` channel; dispatches `started`, `log`, `todo_update`, `completed`, `failed`, `cancelled`, `task_status` events
- **Ring Buffer**: Log lines per run capped at 5,000 in-memory (full history persisted in DB)

### discoveryStore
- **State**: `seedSentence`, `additionalContext`, `interview`, `answerMap`, `events`, `loading`, `error`, `activeSessions`
- **Actions**: `startDiscovery`, `continueDiscovery`, `cancelDiscovery`, `checkActiveSessions`, `resumeSession`, `abandonSession`, `reset`
- **Events**: Subscribes to `discovery:event` channel during active discovery

### settingsStore
- **State**: `modelConfig` (Record by AgentRole), `loading`, `error`
- **Actions**: `loadSettings`, `updateModelForRole`
- **IPC**: `config:getModels`, `config:updateModel`

## IPC Contract

All IPC communication uses Electron's `ipcMain.handle` / `ipcRenderer.invoke` pattern. Each channel has a corresponding Zod schema for input validation in the main process.

| Channel              | Direction       | Input Schema                    | Response Type                |
|----------------------|-----------------|---------------------------------|------------------------------|
| `plan:create`        | renderer->main  | `createPlanInputSchema`         | `CreatePlanResponse`         |
| `plan:get`           | renderer->main  | `getPlanInputSchema`            | `RalphPlan \| null`          |
| `plan:list`          | renderer->main  | `listPlansInputSchema`          | `PlanListItem[]`             |
| `plan:delete`        | renderer->main  | `deletePlanInputSchema`         | `void`                       |
| `plan:archive`       | renderer->main  | `archivePlanInputSchema`        | `void`                       |
| `plan:unarchive`     | renderer->main  | `unarchivePlanInputSchema`      | `void`                       |
| `task:run`           | renderer->main  | `runTaskInputSchema`            | `RunTaskResponse`            |
| `task:runAll`        | renderer->main  | `runAllInputSchema`             | `RunAllResponse`             |
| `run:cancel`         | renderer->main  | `cancelRunInputSchema`          | `CancelRunResponse`          |
| `run:getEvents`      | renderer->main  | `getRunEventsInputSchema`       | `GetRunEventsResponse`       |
| `task:retry`         | renderer->main  | `retryTaskInputSchema`          | `RetryTaskResponse`          |
| `task:skip`          | renderer->main  | `skipTaskInputSchema`           | `void`                       |
| `queue:abort`        | renderer->main  | `abortQueueInputSchema`         | `void`                       |
| `discovery:start`    | renderer->main  | `startDiscoveryInputSchema`     | `DiscoveryInterviewState`    |
| `discovery:continue` | renderer->main  | `continueDiscoveryInputSchema`  | `DiscoveryInterviewState`    |
| `discovery:sessions` | renderer->main  | (none)                          | `DiscoverySessionSummary[]`  |
| `discovery:resume`   | renderer->main  | `discoveryResumeInputSchema`    | `DiscoveryInterviewState`    |
| `discovery:abandon`  | renderer->main  | `discoveryAbandonInputSchema`   | `void`                       |
| `discovery:cancel`   | renderer->main  | `discoveryCancelInputSchema`    | `CancelDiscoveryResponse`    |
| `wizard:guidance`    | renderer->main  | `getWizardGuidanceInputSchema`  | `WizardGuidanceResult`       |
| `wizard:inferStack`  | renderer->main  | `inferStackInputSchema`         | `InferStackResult`           |
| `config:getModels`   | renderer->main  | (none)                          | `ModelConfigEntry[]`         |
| `config:updateModel` | renderer->main  | `updateModelConfigInputSchema`  | `void`                       |
| `run:event`          | main->renderer  | (push, no request)              | `RunEvent`                   |
| `discovery:event`    | main->renderer  | (push, no request)              | `DiscoveryEvent`             |

## DB Schema

SQLite database with WAL mode and foreign keys enabled. Managed by numbered SQL migrations applied in order by `MigrationRunner`.

### Tables

**plans**
| Column             | Type    | Notes                              |
|--------------------|---------|------------------------------------|
| id                 | TEXT PK | UUID                               |
| project_path       | TEXT    | NOT NULL                           |
| prd_text           | TEXT    | NOT NULL, full PRD input text      |
| summary            | TEXT    | NOT NULL, AI-generated summary     |
| technical_pack_json| TEXT    | NOT NULL, JSON-serialized TechnicalPack |
| status             | TEXT    | draft/ready/running/completed/failed |
| created_at         | TEXT    | ISO 8601 timestamp                 |
| updated_at         | TEXT    | ISO 8601 timestamp                 |
| archived_at        | TEXT    | nullable, ISO 8601 (soft archive)  |

**tasks**
| Column                   | Type    | Notes                                  |
|--------------------------|---------|----------------------------------------|
| id                       | TEXT PK | Task identifier (e.g. "p1-02")        |
| plan_id                  | TEXT FK | References plans(id) CASCADE           |
| ordinal                  | INTEGER | Execution order                        |
| title                    | TEXT    | NOT NULL                               |
| description              | TEXT    | NOT NULL                               |
| dependencies_json        | TEXT    | JSON array of task IDs                 |
| acceptance_criteria_json | TEXT    | JSON array of strings                  |
| technical_notes          | TEXT    | NOT NULL                               |
| status                   | TEXT    | pending/in_progress/completed/failed/skipped |
| created_at               | TEXT    | ISO 8601                               |
| updated_at               | TEXT    | ISO 8601                               |
| completed_at             | TEXT    | nullable, ISO 8601                     |

**runs**
| Column         | Type    | Notes                                    |
|----------------|---------|------------------------------------------|
| id             | TEXT PK | UUID                                     |
| plan_id        | TEXT FK | References plans(id) CASCADE             |
| task_id        | TEXT FK | References tasks(id) CASCADE             |
| session_id     | TEXT    | nullable, Agent SDK session ID           |
| status         | TEXT    | queued/in_progress/completed/failed/cancelled |
| started_at     | TEXT    | ISO 8601                                 |
| ended_at       | TEXT    | nullable, ISO 8601                       |
| duration_ms    | INTEGER | nullable                                 |
| total_cost_usd | REAL    | nullable                                 |
| result_text    | TEXT    | nullable                                 |
| stop_reason    | TEXT    | nullable                                 |
| error_text     | TEXT    | nullable                                 |
| retry_count    | INTEGER | NOT NULL DEFAULT 0                       |

**run_events**
| Column       | Type    | Notes                            |
|--------------|---------|----------------------------------|
| id           | TEXT PK | UUID                             |
| run_id       | TEXT FK | References runs(id) CASCADE      |
| ts           | TEXT    | ISO 8601 timestamp               |
| level        | TEXT    | "info" or "error"                |
| event_type   | TEXT    | started/log/todo_update/completed/failed/cancelled/info |
| payload_json | TEXT    | JSON-serialized event payload    |

**todo_snapshots**
| Column      | Type    | Notes                            |
|-------------|---------|----------------------------------|
| id          | TEXT PK | UUID                             |
| run_id      | TEXT FK | References runs(id) CASCADE      |
| ts          | TEXT    | ISO 8601 timestamp               |
| total       | INTEGER | Total todo count                 |
| pending     | INTEGER | Pending count                    |
| in_progress | INTEGER | In-progress count                |
| completed   | INTEGER | Completed count                  |
| todos_json  | TEXT    | JSON-serialized TodoItem[]       |

**discovery_sessions**
| Column               | Type    | Notes                              |
|----------------------|---------|------------------------------------|
| id                   | TEXT PK | UUID                               |
| project_path         | TEXT    | NOT NULL                           |
| seed_sentence        | TEXT    | NOT NULL                           |
| additional_context   | TEXT    | NOT NULL DEFAULT ''                |
| answer_history_json  | TEXT    | NOT NULL DEFAULT '[]'              |
| round_number         | INTEGER | NOT NULL DEFAULT 1                 |
| latest_state_json    | TEXT    | JSON-serialized DiscoveryInterviewState |
| status               | TEXT    | active/completed/abandoned         |
| created_at           | TEXT    | ISO 8601                           |
| updated_at           | TEXT    | ISO 8601                           |

**model_config**
| Column      | Type    | Notes                                |
|-------------|---------|--------------------------------------|
| id          | TEXT PK | UUID                                 |
| agent_role  | TEXT    | UNIQUE, discovery_specialist/plan_synthesis/task_execution |
| model_id    | TEXT    | NOT NULL, Claude model identifier    |
| updated_at  | TEXT    | ISO 8601                             |

**schema_migrations** (managed by MigrationRunner)
| Column     | Type    | Notes                      |
|------------|---------|----------------------------|
| name       | TEXT PK | Migration filename         |
| applied_at | TEXT    | ISO 8601 timestamp         |

### Indexes

| Index Name                       | Table              | Columns                    |
|----------------------------------|--------------------|----------------------------|
| idx_tasks_plan_ordinal           | tasks              | (plan_id, ordinal)         |
| idx_runs_task_started            | runs               | (task_id, started_at DESC) |
| idx_run_events_run_ts            | run_events         | (run_id, ts)               |
| idx_run_events_run_ts_id         | run_events         | (run_id, ts ASC, id ASC)   |
| idx_discovery_sessions_status    | discovery_sessions | (status)                   |
| idx_discovery_sessions_project   | discovery_sessions | (project_path)             |

## Testing Strategy

### Unit Tests (Vitest)

Run with `npm run test:unit`. Configuration in `vitest.config.ts`.

- **Environment**: Node.js by default; renderer tests opt in to jsdom via `// @vitest-environment jsdom` annotation
- **Database tests**: Use in-memory SQLite via `createMockDatabase()` factory. Guarded by `describe.skipIf(!sqliteAvailable)` for environments where better-sqlite3 is compiled for a different Electron ABI
- **Store tests**: Mock `window.ralphApi` via `installMockRalphApi()`. Reset store state between tests
- **Schema tests**: Validate all Zod schemas with success and error branch coverage

Coverage: `npm run test:coverage` (v8 provider, text + lcov reporters)

### E2E Tests (Playwright)

Run with `npm run test:e2e` (auto-builds via `pretest:e2e` script). Configuration in `playwright.config.ts`.

- **Fixture**: Custom Electron fixture launches the built app with an isolated temp SQLite database per test via `TEST_DB_PATH` env var
- **Serial execution**: `workers: 1`, `fullyParallel: false` (Electron limitation)
- **Data seeding**: Tests inject data directly into SQLite via `electronApp.evaluate()` and emit synthetic events via `webContents.send()` to avoid requiring the Claude Agent SDK
- **Suites**: App launch smoke, plan CRUD lifecycle, task execution, error recovery (retry/skip/abort), discovery interview and resume flow

## Build & Deploy

### Development

```bash
npm install                # Install dependencies + rebuild native modules
npm run dev                # Start electron-vite dev server with HMR
```

### Production Build

```bash
npm run build              # Build main, preload, and renderer to out/
```

The build output in `out/` contains:
- `out/main/index.js` - Main process bundle
- `out/preload/index.js` - Preload script bundle
- `out/renderer/` - Renderer HTML, JS, CSS assets

### Type Checking

```bash
npm run typecheck          # Run tsc on both node and web configs
```

### Testing

```bash
npm run test:unit          # Run all unit tests (single run)
npm run test:unit:watch    # Run unit tests in watch mode
npm run test:coverage      # Run unit tests with coverage report
npm run test:e2e           # Build app and run E2E tests
```

### Native Module Rebuild

```bash
npm run rebuild:native     # Rebuild better-sqlite3 for current Electron ABI
```

This runs automatically via the `postinstall` script.

### Packaging

Packaging for distribution (e.g. via electron-builder or electron-forge) is not yet configured. The `out/` directory contains the built application ready for integration with a packaging tool. The `resources/migrations/` directory must be included in the packaged app's resources (resolved at runtime via `process.resourcesPath`).
