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
- **Entry**: `src/main.tsx` → `src/App.tsx`. `App.tsx` owns top-level fetch state (sprint issues, my issues) and renders one tab per open app. Apps are opened from a right-hand drawer (Ctrl/Cmd+K) listed in `src/apps/registry.ts`; open tabs stay mounted (hidden with `display:none`) so switching is instant, and are remembered in `localStorage`.
- **Tabs / components** (`src/components/`):
  - `JiraTasksTracker.tsx` — Sprint + "Me" issue tables (main Jira view).
  - `views/` — `ListView.tsx`, `CalendarView.tsx`, `GanttView.tsx` render issues in different layouts.
  - `shell/` — `AppDrawer` (searchable app launcher), `TabStrip`, `NotificationBell` (placeholder).
  - `apps/` — `ReportViewer` (lists and renders HTML reports from a backend folder), `EmbeddedApp` (iframe, used for the fleet monitoring page), `ComingSoon`.
  - `PrReviews.tsx` — the PR Reviews app: read, edit, skip and post the drafts. The header bell shows how many are waiting.
  - Accomplishments, Config Viewer and Menu Compare are placeholders.
- **Data access**: `src/services/api.ts` is the single axios client (base URL from `VITE_API_URL`); `src/services/dataProcessor.ts` handles client-side filter/sort/group logic.

## Backend (`backend/`)

- **Stack**: Node.js (ESM), Express, `better-sqlite3`, `axios`, `dotenv`.
- **Entry**: `src/index.js` — sets up middleware, mounts routers under `/api`, initializes the DB, migrates any legacy JSON data.
- **Routes** (`src/routes/`) map 1:1 to feature areas:
  - `issues.js` — Jira issues, tags, important/myday flags, FE-team membership, filter config, health check.
  - `accomplishments.js` — manual accomplishment entries.
  - `delivery.js` — Release & PRs data and on-demand refresh.
  - `hub.js` — lists and serves the HTML reports behind the report apps (path-restricted to the configured folders).
  - `reviews.js` — PR review drafts: `/reviews/queue` and `/reviews/packet/...` give a scheduled Claude session its work, `POST /reviews/drafts` saves a draft, and the user-confirmed `.../post` is the only route that writes to GitHub (same-machine only, comment-only, refuses stale or already-posted drafts). Logic in `backend/delivery/lib/reviews.mjs`; the review instructions are in `skills/pr-review/SKILL.md`.
- **Services** (`src/services/`) hold the actual logic per domain: `jiraService` (Jira Cloud REST calls + auth), `tagService`, `importantService`, `mydayService`, `feteamService`, `sprintSummaryService`.
- **Persistence**: `src/db/database.js` opens a single SQLite file (`tracker.db`) in WAL mode at `DATA_DIR` (env var, defaults to `backend/data/`). Tables: `issue_tags`, `issue_important`, `issue_myday`, `feteam_members`, `client_regions`, `accomplishments`. `src/db/migrate.js` one-time-migrates older JSON files into SQLite on startup.

## How the pieces communicate

1. Browser loads the Vite-built SPA and calls the backend at `VITE_API_URL` (e.g. `http://localhost:3050/api`).
2. Backend serves Jira-backed data by calling the Jira Cloud REST API with a stored API token (`JIRA_HOST`/`JIRA_EMAIL`/`JIRA_API_TOKEN`), using filter IDs from env vars (sprint/me).
3. Backend enriches Jira issues with locally-owned metadata (tags, important flag, "My Day" flag, FE-team membership) read from SQLite — this is data Jira doesn't know about.
4. Accomplishments are stored entirely in SQLite; Jira is not involved for those.
5. The report apps (MyTester, Defects, New Relic Conditions) read `.html` files from folders on the backend host through `/api/hub/*`; the Monitoring Dashboard embeds the hosted fleet page.

No message queue, no server-side rendering, no auth layer beyond the Jira API token — this is a small single-user internal tool.
