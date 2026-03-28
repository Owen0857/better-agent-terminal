# CLAUDE.md - Project Guidelines

## No Regressions Policy

- **NEVER** break existing features when implementing new ones.
- Before committing, verify ALL existing features still work — not just the new changes.
- TypeScript check (faster): `node_modules/.bin/tsc.cmd --noEmit` (use forward slashes in bash)
- Full build (Windows): `node_modules/.bin/vite.cmd build` — `npx vite build` does NOT work on this machine.
- TSC has pre-existing errors (ElectronAPI types lag behind preload); filter by changed file names to check for new errors.
- When modifying shared code (stores, IPC handlers, types), trace all consumers to ensure nothing breaks.

## Logging

- **Frontend (renderer)**: Use `window.electronAPI.debug.log(...)` instead of `console.log()`. This sends logs to the electron main process logger, which writes to disk.
- **Backend (electron)**: Use `logger.log(...)` / `logger.error(...)` from `./logger`.
- Do NOT use `console.log()` for debugging — use the logger so logs are persisted and visible in the log file.
- **Log file location**: `~/Library/Application Support/better-agent-terminal/debug.log`

## Sub-agent / Active Tasks Tracking

- The Claude Agent SDK does **NOT** reliably emit `task_started` / `task_progress` / `task_notification` system messages.
- We track Agent/Task tools from `tool_use` blocks directly in `session.activeTasks` (in `claude-agent-manager.ts`).
- `stopTask()` falls back to using `toolUseId` as `task_id` when no mapping exists.
- Tool results for Agent/Task must clean up `activeTasks` entries.

## React Rendering

- Use `flushSync` from `react-dom` for Agent/Task tool state changes (`setMessages` in `onToolUse` and `onToolResult`) to prevent rendering delays from React 18 batching during streaming.
- Do NOT use `flushSync` for regular tool calls — only for state changes that affect the active tasks bar visibility.

## Status Line

- Our status line implementation is superior to external alternatives (e.g., ccstatusline). Do not replace it.
- 13 configurable items with custom colors, zone alignment, and template-based config.
- Usage polling: Chrome session key → Edge session key → OAuth (three-tier fallback).
- Windows: Chrome 131+ uses App-Bound Encryption (v20/APPB) — DPAPI cannot decrypt; auto-skips to Edge.
- 5h pacing indicator compares utilization vs time-elapsed %; pure frontend calc, no extra API calls.

## 1M Context

- Controlled via model name suffix `[1m]` (e.g., `claude-opus-4-6[1m]`), not a separate toggle.
- SDK sends `betas: ['context-1m-2025-08-07']` automatically when model name contains `[1m]`.

## Native Modules (Electron)

- `"npmRebuild": false` in `package.json` build config — electron-builder will NOT rebuild native modules.
- Only use packages with Electron-specific prebuilts (e.g., `@lydell/node-pty`) or pure-WASM/pure-JS libs.
- **Never add native modules** (compiled `.node` files) as regular `dependencies` — they will fail at runtime with ABI mismatch (system Node.js ABI ≠ Electron ABI).
- Current example: `sql.js` (WASM) used instead of `better-sqlite3` (native) for cookie DB queries.
