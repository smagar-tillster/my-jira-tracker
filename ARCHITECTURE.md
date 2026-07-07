# Architecture

MyTracker is a personal Jira dashboard: a React frontend talks to a Node/Express backend, which talks to Jira Cloud and a local SQLite database.

```
Browser (React/TS, Vite)  --REST/HTTP-->  Express API  --REST (axios+token)-->  Jira Cloud
      localhost:3051              localhost:3050/api              tillster.atlassian.net
                                        |
                                        v
                                  SQLite (better-sqlite3)
                                  DATA_DIR/tracker.db
```

## Frontend (`frontend/`)

- **Stack**: React 18 + TypeScript, Vite, Tailwind CSS.
- **Entry**: `src/main.tsx` → `src/App.tsx`. `App.tsx` owns top-level fetch state (sprint issues, my issues, defects) and renders tabs; all visited tabs stay mounted (hidden with `display:none`) so switching tabs is instant.
- **Tabs / components** (`src/components/`):
  - `JiraTasksTracker.tsx` — Sprint + "Me" issue tables (main Jira view).
  - `TodoPage.tsx` — Personal to-do list (backed by SQLite, not Jira).
  - `ArchiveTracker.tsx` — Cached view of a Jira archive filter.
  - `DefectsTracker.tsx` — Defects filter view, lazy-loaded on first visit.
  - `views/` — `ListView.tsx`, `CalendarView.tsx`, `GanttView.tsx` render issues in different layouts.
  - Accomplishments tab is currently a placeholder.
- **Data access**: `src/services/api.ts` is the single axios client (base URL from `VITE_API_URL`); `src/services/dataProcessor.ts` handles client-side filter/sort/group logic.

## Backend (`backend/`)

- **Stack**: Node.js (ESM), Express, `better-sqlite3`, `axios`, `dotenv`.
- **Entry**: `src/index.js` — sets up middleware, mounts routers under `/api`, initializes the DB, migrates any legacy JSON data, and kicks off a 24h archive-cache refresh loop.
- **Routes** (`src/routes/`) map 1:1 to feature areas:
  - `issues.js` — Jira issues, tags, important/myday flags, FE-team membership, filter config, health check.
  - `todos.js` — personal to-do CRUD + categories.
  - `archive.js` — cached archive listing + manual refresh.
  - `accomplishments.js` — manual accomplishment entries.
  - `dailySummary.js` — ingest/read of the scheduled daily briefing.
- **Services** (`src/services/`) hold the actual logic per domain: `jiraService` (Jira Cloud REST calls + auth), `todoService`, `archiveService`, `dailySummaryService`, `tagService`, `importantService`, `mydayService`, `feteamService`, `sprintSummaryService`.
- **Persistence**: `src/db/database.js` opens a single SQLite file (`tracker.db`) in WAL mode at `DATA_DIR` (env var, defaults to `backend/data/`). Tables: `issue_tags`, `issue_important`, `issue_myday`, `feteam_members`, `todos`, plus archive/accomplishment tables. `src/db/migrate.js` one-time-migrates older JSON files into SQLite on startup.

## How the pieces communicate

1. Browser loads the Vite-built SPA and calls the backend at `VITE_API_URL` (e.g. `http://localhost:3050/api`).
2. Backend serves Jira-backed data by calling the Jira Cloud REST API with a stored API token (`JIRA_HOST`/`JIRA_EMAIL`/`JIRA_API_TOKEN`), using filter IDs from env vars (sprint/me/defects/archive).
3. Backend enriches Jira issues with locally-owned metadata (tags, important flag, "My Day" flag, FE-team membership) read from SQLite — this is data Jira doesn't know about.
4. To-dos, accomplishments, and the archive cache are stored entirely in SQLite; Jira is not involved for those.
5. A daily summary file (written externally by a scheduled job) is either read from disk or from the DB, depending on `DAILY_SUMMARY_MODE`.

No message queue, no server-side rendering, no auth layer beyond the Jira API token — this is a small single-user internal tool.
