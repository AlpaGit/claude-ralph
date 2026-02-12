# Ralph Desktop Orchestrator

Electron + React + TypeScript app to:

- Generate a Ralph-aligned plan from PRD text
- Persist summary + technical metadata in SQLite
- Create and track checklist tasks
- Execute one strict Ralph task per run in fresh context
- Stream real-time task progress and completion

## Requirements

- Node.js 20+
- A working local Claude Code authentication setup (for the Claude Agent SDK runtime)

## Install

```bash
npm install
```

## Run (dev)

```bash
npm run dev
```

## Build

```bash
npm run build
```

## Type check

```bash
npm run typecheck
```

## Notes

- The app stores data in a local SQLite file under Electron `userData` (`ralph-desktop.sqlite`).
- Task execution uses strict mode defaults:
  - fresh run isolation with explicit `/clear`
  - one checklist item per run
  - build/test/commit/progress expectations in the task prompt

