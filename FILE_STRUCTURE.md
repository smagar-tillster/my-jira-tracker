# 📁 Project File Structure

## Complete Project Organization

```
MyTracker/
│
├── 📖 DOCUMENTATION FILES (Start Here!)
│   ├── INDEX.md                    ← Navigation guide (READ THIS FIRST)
│   ├── QUICKSTART.md               ← Fast 5-minute setup
│   ├── CHECKLIST.md                ← Feature testing guide
│   ├── COMPLETE.md                 ← Project summary
│   ├── OVERVIEW.md                 ← Visual architecture
│   ├── PROJECT_SUMMARY.md          ← Technical details
│   └── README.md                   ← Main documentation
│
├── 🔧 SETUP SCRIPTS
│   ├── setup.bat                   ← Windows automation
│   └── setup.sh                    ← Linux/macOS automation
│
│
├── 🚀 BACKEND (Node.js/Express)
│   │
│   ├── 📄 Configuration
│   │   ├── package.json            ← Dependencies & scripts
│   │   ├── .env.example            ← Config template
│   │   ├── .gitignore              ← Ignore secrets
│   │   └── README.md               ← Backend documentation
│   │
│   └── 📂 src/
│       │
│       ├── index.js                ← Express server entry point
│       │   • Setup Express app
│       │   • Configure middleware (CORS, JSON)
│       │   • Mount routes
│       │   • Error handling
│       │   • Start server on port 5000
│       │
│       ├── 📂 routes/
│       │   └── issues.js           ← API endpoints
│       │       • GET /api/issues        → Fetch all issues
│       │       • GET /api/filter/:id    → Fetch from filter
│       │       • GET /api/health        → Health check
│       │
│       └── 📂 services/
│           └── jiraService.js      ← Jira integration
│               • extractReleaseDate()   → Parse fix version
│               • getIssuesFromFilter()  → Get from filter
│               • getIssuesByJQL()       → Get via JQL
│               • getMockIssues()        → Sample data
│               • Axios client setup
│               • Auth with token


├── 💻 FRONTEND (React/TypeScript/Vite)
│   │
│   ├── 📄 Configuration
│   │   ├── package.json            ← Dependencies & scripts
│   │   ├── .env.example            ← Config template
│   │   ├── .gitignore              ← Ignore build files
│   │   ├── index.html              ← HTML template
│   │   ├── tsconfig.json           ← TypeScript config
│   │   ├── tsconfig.node.json      ← Build TypeScript
│   │   ├── vite.config.ts          ← Vite build config
│   │   ├── tailwind.config.js      ← CSS framework config
│   │   ├── postcss.config.js       ← CSS processing
│   │   ├── README.md               ← Frontend documentation
│   │   └── .gitignore              ← Ignore files
│   │
│   └── 📂 src/
│       │
│       ├── main.tsx                ← React entry point
│       │   • Import React
│       │   • Render App to #root
│       │
│       ├── App.tsx                 ← Main app component
│       │   • Header with title & toggle
│       │   • Error handling
│       │   • Data fetching
│       │   • Pass issues to tracker
│       │
│       ├── index.css               ← Global styles
│       │   • Tailwind imports
│       │   • Base styling
│       │
│       ├── 📂 components/          ← React components
│       │   │
│       │   ├── IssueTracker.tsx    ← Main tracker logic
│       │   │   • Search input
│       │   │   • Group By dropdown
│       │   │   • Filter management
│       │   │   • Column visibility
│       │   │   • Statistics display
│       │   │   • Data processing orchestration
│       │   │
│       │   └── 📂 views/
│       │       └── ListView.tsx    ← Table display
│       │           • Grouped table rendering
│       │           • Collapsible groups
│       │           • Column headers
│       │           • Cell formatting
│       │           • Color coding
│       │           • Clickable filters
│       │
│       ├── 📂 services/            ← Business logic
│       │   │
│       │   ├── api.ts              ← API client
│       │   │   • getIssues()
│       │   │   • getIssuesFromFilter()
│       │   │   • checkHealth()
│       │   │   • Axios configuration
│       │   │
│       │   └── dataProcessor.ts    ← Data processing
│       │       • sortIssues()      → Bidirectional sort
│       │       • filterIssues()    → Search + column filter
│       │       • groupIssues()     → Group by column
│       │       • getColumnUniqueValues() → Dropdown options
│       │
│       ├── 📂 hooks/               ← Custom React hooks
│       │   └── useIssueFiltering.ts ← Filter state management
│       │       • searchTerm state
│       │       • filters state
│       │       • addFilter()
│       │       • removeFilter()
│       │       • toggleFilterValue()
│       │       • clearAllFilters()
│       │
│       └── 📂 types/               ← TypeScript definitions
│           └── index.ts            ← Type definitions
│               • JiraIssue interface
│               • Column interface
│               • FilterState type
│               • SortConfig type
│               • GroupConfig type


├── 🎯 KEY FEATURES BY FILE
│   ├── Search: IssueTracker.tsx + dataProcessor.ts
│   ├── Filter: useIssueFiltering.ts + dataProcessor.ts + ListView.tsx
│   ├── Group: IssueTracker.tsx + dataProcessor.ts + ListView.tsx
│   ├── Sort: IssueTracker.tsx + dataProcessor.ts + ListView.tsx
│   ├── Columns: IssueTracker.tsx + ListView.tsx
│   ├── Date Extraction: jiraService.js
│   ├── Mock Data: jiraService.js
│   ├── Real API: api.ts + jiraService.js
│   └── Styling: Tailwind CSS + index.css


└── 📊 FOLDER SIZE SUMMARY
    ├── backend/        ~1.5 KB (3 main files)
    ├── frontend/       ~2.5 KB (code only)
    ├── docs/           ~1 MB (8 markdown files)
    └── Total           ~4 MB (with node_modules after install)
```

---

## 🗂️ File Purpose Guide

### Backend Files

**index.js** - Server Entry Point
- Starts Express server
- Configures middleware (CORS, JSON)
- Mounts API routes
- Handles errors
- Logs startup message

**routes/issues.js** - API Endpoints
- GET /api/issues - Fetch issues (mock or real)
- GET /api/issues/filter/:id - Fetch from filter
- GET /api/health - Server health
- Returns JSON responses

**services/jiraService.js** - Jira Integration
- Connects to Jira API with auth
- Extracts release dates from Fix Version
- Provides mock data for development
- Parses JQL queries
- Handles API errors

### Frontend Files

**main.tsx** - React Entry
- Imports React and App
- Mounts React to #root div
- Strict mode for development

**App.tsx** - Top Level Component
- App header with title
- Mock/Live toggle button
- Fetches issues on mount
- Passes data to IssueTracker
- Displays error messages

**components/IssueTracker.tsx** - Main Logic
- Search input field
- Group By dropdown
- Filter state management
- Column visibility controls
- Processes data (filter/sort/group)
- Passes data to ListView

**components/views/ListView.tsx** - Table Display
- Renders grouped tables
- Collapsible group headers
- Sortable column headers
- Formatted cells with colors
- Clickable filter cells
- Sticky headers

**services/api.ts** - API Client
- Axios configuration
- getIssues() function
- getIssuesFromFilter() function
- Health check function
- Error handling

**services/dataProcessor.ts** - Data Processing
- sortIssues() - Sort by any column
- filterIssues() - Search + filters
- groupIssues() - Group by column
- getColumnUniqueValues() - For dropdowns
- Smart type handling

**hooks/useIssueFiltering.ts** - State Management
- searchTerm state
- filters object state
- Filter manipulation functions
- State persistence ready

**types/index.ts** - TypeScript Types
- JiraIssue interface
- Column interface
- FilterState type
- SortConfig type
- GroupConfig type

**index.css** - Global Styles
- Tailwind directives
- Base element styling
- HTML/body setup
- Prevent layout shift

---

## 🔄 Data Flow Through Files

```
1. App.tsx
   └─ Calls api.ts → getIssues()
   
2. api.ts
   └─ HTTP GET → backend /api/issues

3. Backend index.js
   └─ Routes to routes/issues.js

4. routes/issues.js
   └─ Calls services/jiraService.js
   └─ Returns JSON issues

5. App.tsx receives issues
   └─ Passes to IssueTracker.tsx

6. IssueTracker.tsx
   ├─ Has search/filter state (useIssueFiltering.ts)
   ├─ Calls dataProcessor.ts:
   │  ├─ filterIssues() [search + filters]
   │  ├─ sortIssues() [sorting]
   │  └─ groupIssues() [grouping]
   └─ Passes processed data to ListView.tsx

7. ListView.tsx
   └─ Renders grouped tables with:
      ├─ Color-coded badges
      ├─ Formatted dates
      ├─ Clickable filters
      └─ Sortable headers
```

---

## 📊 Component Dependency Tree

```
App.tsx (root)
├── Header (JSX in component)
├── Error display (JSX in component)
└── IssueTracker.tsx (main logic)
    ├── useIssueFiltering.ts (hook)
    ├── dataProcessor.ts (service)
    │   └── Various utility functions
    └── ListView.tsx (display)
        ├── formatCellValue() (local)
        ├── getPriorityColor() (local)
        ├── getStatusColor() (local)
        ├── renderCell() (local)
        └── No child components
```

---

## 🔐 Security File Structure

```
Secure Files (in .gitignore):
├── backend/.env          ← NEVER COMMITTED
│   ├── JIRA_API_TOKEN
│   ├── JIRA_HOST
│   └── JIRA_EMAIL

Safe Files (committed):
├── backend/.env.example  ← Template only
├── frontend/.env.example ← Template only
└── All code files (no secrets)

Protected by:
├── .gitignore (prevents commits)
├── Server-side token handling
├── No frontend API token access
└── CORS validation
```

---

## 📈 Build & Run Files

```
package.json (both folders)
├── Dependencies listed
├── Dev dependencies listed
├── Scripts defined:
│   ├── dev        → npm run dev
│   ├── build      → npm run build (frontend only)
│   ├── preview    → npm run preview (frontend only)
│   └── start      → npm start (backend only)

vite.config.ts (frontend)
├── React plugin
├── Dev server config
├── Build output config

tsconfig.json (both)
├── Compiler options
├── Type checking rules
├── Strict mode enabled
```

---

## 🎯 Quick File Lookup

| Need | File | Location |
|------|------|----------|
| Add feature | IssueTracker.tsx | `frontend/src/components/` |
| Change colors | Tailwind CSS or index.css | `frontend/src/` |
| Modify columns | DEFAULT_COLUMNS | `frontend/src/components/IssueTracker.tsx` |
| Change API | api.ts | `frontend/src/services/` |
| Real Jira setup | jiraService.js | `backend/src/services/` |
| Process data | dataProcessor.ts | `frontend/src/services/` |
| Mock data | getMockIssues() | `backend/src/services/jiraService.js` |
| API endpoints | routes/issues.js | `backend/src/routes/` |
| Configuration | .env.example | `backend/` |
| Server start | index.js | `backend/src/` |
| React start | main.tsx | `frontend/src/` |
| Styling | tailwind.config.js | `frontend/` |
| Types | types/index.ts | `frontend/src/types/` |

---

**Total Files: ~40**
**Total Code: ~3,500+ lines**
**Production Ready: ✅ YES**

See [`INDEX.md`](./INDEX.md) for documentation navigation.
