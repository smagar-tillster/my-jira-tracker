# Run

## Logs

All logs (local dev, Docker, and the NSSM Windows services) should be written under:

```
C:\Users\smagar\OneDrive - Tillster Inc\logs\MyTracker\
├── backend\
│   ├── stdout.log
│   └── stderr.log
└── frontend\
    ├── stdout.log
    └── stderr.log
```

For the NSSM services this is configured via `AppStdout`/`AppStderr` (see below). For local `npm run dev`, redirect manually if you want a file, e.g.:

```bash
npm run dev > "C:\Users\smagar\OneDrive - Tillster Inc\logs\MyTracker\backend\stdout.log" 2>&1
```

## All Configs

### backend/.env

| Var | Purpose |
|---|---|
| `DATA_DIR` | Folder for `tracker.db` (SQLite) + legacy JSON migration files. Defaults to `backend/data/`. Currently `C:\Users\smagar\OneDrive - Tillster Inc\databases\MyTracker`. |
| `JIRA_HOST` | Jira Cloud base URL, e.g. `https://tillster.atlassian.net` |
| `JIRA_EMAIL` | Jira account email used for API auth |
| `JIRA_API_TOKEN` | Jira API token ([id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens)) |
| `JIRA_FILTER_ID_SPRINT` | Filter ID for the "Tasks" (sprint) tab |
| `JIRA_FILTER_ID_ME` | Filter ID for the "Me" view |
| `JIRA_FILTER_ID_DEFECTS` | Filter ID for the "Defects" tab |
| `JIRA_FILTER_ID_ARCHIVE` | Filter ID for the "Archive" tab |
| `DAILY_SUMMARY_API_KEY` | Shared key required to `POST /api/daily-summary` |
| `DAILY_SUMMARY_MODE` | `file` reads `DAILY_SUMMARY_FILE_PATH`; `api` reads the DB record |
| `DAILY_SUMMARY_FILE_PATH` | Path to the daily briefing `.md` written by the scheduled job |
| `PORT` | Backend port (default `3050`) |
| `NODE_ENV` | `development` / `production` |

### frontend/.env

| Var | Purpose |
|---|---|
| `VITE_API_URL` | Backend API base URL, e.g. `http://localhost:3050/api` |
| `PORT` | Dev server port (default `3051`, also set in `vite.config.js`) |

## How to run local

```bash
# Backend
cd backend
npm install
cp .env.example .env   # then fill in Jira creds / DATA_DIR
npm run dev             # http://localhost:3050

# Frontend (separate terminal)
cd frontend
npm install
cp .env.example .env
npm run dev              # http://localhost:3051
```

## How to run Docker

```bash
docker-compose up --build     # builds + starts backend (3050) and frontend (3051)
docker-compose up -d           # detached
docker-compose logs -f backend # tail logs
docker-compose down            # stop + remove containers
```

Backend reads `backend/.env` via `env_file`. Frontend gets `VITE_API_URL` from `docker-compose.yml` (points at `localhost:3050`).

## How to run production build

```bash
# Backend — just run the Node process directly
cd backend
npm install
npm start                # node src/index.js, http://localhost:3050

# Frontend — build static assets, then serve them
cd frontend
npm install
npm run build             # tsc -b && vite build -> frontend/dist
npx serve -s dist -l 3051 # frontend already depends on `serve`
```

## How to install NSSM as a Windows service — important commands

NSSM at `C:\Tools\nssm\win64\nssm.exe`. Two services: `MyTrackerBE` (backend) and `MyTrackerFE` (frontend, serving the built `dist/`).

### Backend service

```bat
C:\Tools\nssm\win64\nssm.exe install MyTrackerBE "C:\Program Files\nodejs\node.exe"
C:\Tools\nssm\win64\nssm.exe set MyTrackerBE AppDirectory "...\MyTracker\backend"
C:\Tools\nssm\win64\nssm.exe set MyTrackerBE AppParameters "src\index.js"
C:\Tools\nssm\win64\nssm.exe set MyTrackerBE AppStdout "C:\Users\smagar\OneDrive - Tillster Inc\logs\MyTracker\backend\stdout.log"
C:\Tools\nssm\win64\nssm.exe set MyTrackerBE AppStderr "C:\Users\smagar\OneDrive - Tillster Inc\logs\MyTracker\backend\stderr.log"
C:\Tools\nssm\win64\nssm.exe set MyTrackerBE AppRotateFiles 1
C:\Tools\nssm\win64\nssm.exe set MyTrackerBE AppRotateBytes 10485760
C:\Tools\nssm\win64\nssm.exe set MyTrackerBE AppEnvironmentExtra NODE_ENV=production
C:\Tools\nssm\win64\nssm.exe start MyTrackerBE
```

### Frontend service

Startup directory is `frontend` (NOT `frontend\dist` — `serve` is resolved from `node_modules` relative to the startup directory, and it just points at the `dist` folder with `-s dist`).

```bat
C:\Tools\nssm\win64\nssm.exe install MyTrackerFE "C:\Program Files\nodejs\node.exe"
C:\Tools\nssm\win64\nssm.exe set MyTrackerFE AppDirectory "...\MyTracker\frontend"
C:\Tools\nssm\win64\nssm.exe set MyTrackerFE AppParameters "node_modules\serve\build\main.js -s dist -l 3051"
C:\Tools\nssm\win64\nssm.exe set MyTrackerFE AppStdout "C:\Users\smagar\OneDrive - Tillster Inc\logs\MyTracker\frontend\stdout.log"
C:\Tools\nssm\win64\nssm.exe set MyTrackerFE AppStderr "C:\Users\smagar\OneDrive - Tillster Inc\logs\MyTracker\frontend\stderr.log"
C:\Tools\nssm\win64\nssm.exe set MyTrackerFE AppRotateFiles 1
C:\Tools\nssm\win64\nssm.exe set MyTrackerFE AppRotateBytes 10485760
C:\Tools\nssm\win64\nssm.exe start MyTrackerFE
```

### Useful NSSM management commands

```bat
nssm status MyTrackerBE
nssm restart MyTrackerBE
nssm stop MyTrackerBE
nssm edit MyTrackerBE        REM opens the GUI editor for a service
nssm remove MyTrackerBE confirm
```

Before running `nssm install`, make sure the log folders exist:

```bat
mkdir "C:\Users\smagar\OneDrive - Tillster Inc\logs\MyTracker\backend"
mkdir "C:\Users\smagar\OneDrive - Tillster Inc\logs\MyTracker\frontend"
```
