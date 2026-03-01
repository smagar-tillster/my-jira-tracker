# Jira Task Tracker

A comprehensive task tracking dashboard for Jira with advanced filtering, grouping, and sorting capabilities. Built with Node.js/Express backend and React/TypeScript frontend.

## 🎯 Features

### Backend
- 🔐 Secure Jira API integration with token authentication
- 📋 Fetch issues from filters or JQL queries
- 🎭 Mock data support for development
- ⚡ Fast Express server with CORS support

### Frontend
- 📊 **List View** - Organized, grouped table display
- 🔍 **Search** - Full-text search across issues
- 🎯 **Filters** - Filter by any column with visual indicators
- 📌 **Grouping** - Dynamically group by any column
- ↕️ **Sorting** - Sort columns in ascending/descending order
- 📅 **Date Parsing** - Auto-extract release dates from Fix Version
- 🎨 **Responsive UI** - Beautiful Tailwind CSS styling
- 🗂️ **Column Management** - Show/hide and add columns

## 📁 Project Structure

```
MyTracker/
├── backend/              # Node.js/Express server
│   ├── src/
│   │   ├── index.js     # Main app
│   │   ├── routes/      # API routes
│   │   └── services/    # Jira API service
│   ├── package.json
│   └── .env.example
│
├── frontend/            # React/TypeScript app
│   ├── src/
│   │   ├── components/  # React components
│   │   ├── services/    # API client & data processors
│   │   ├── hooks/       # Custom React hooks
│   │   └── types/       # TypeScript types
│   ├── package.json
│   └── vite.config.ts
│
└── README.md           # This file
```

## 🚀 Quick Start

### Prerequisites
- Node.js 16+ and npm
- Jira Cloud account (for real API, optional)

### 1. Setup Backend

```bash
cd backend

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your Jira credentials (optional for mock data)

# Start server
npm run dev
```

Backend will run on `http://localhost:5000`

### 2. Setup Frontend

```bash
cd ../frontend

# Install dependencies
npm install

# Start dev server
npm run dev
```

Frontend will open at `http://localhost:3000`

## 🎓 How to Use

### Basic Workflow

1. **Launch both servers** (backend on 5000, frontend on 3000)
2. **View issues** - App loads with mock data by default
3. **Search** - Type in search box (searches key, summary, assignee, description)
4. **Filter** - Click on any cell value to add filter, or use filter badges
5. **Group** - Select column from "Group By" dropdown
6. **Sort** - Click column header arrows to sort

### Toggle Mock Data

Use the **🎭 Mock Data** / **🔗 Live API** button in header to switch between:
- **Mock Data** - Default, no setup needed, great for demo
- **Live API** - Requires `.env` setup with real Jira credentials

### Manage Columns

- **Show/Hide** - Click "Add Column..." dropdown to toggle visibility
- **Default View** - Shows 8 important columns
- **Scroll** - Horizontal scroll for more columns if needed

### Filter & Search

- **Search box** - Type to search across multiple fields
- **Cell click** - Click cell value to filter (for filterable columns)
- **Filter badges** - Shows active filters with remove option
- **Clear Filters** - Button to reset all filters and search

### Release Date Extraction

The app automatically extracts release dates from Fix Version field:

| Fix Version | Extracted Date |
|-------------|-----------------|
| 2025.12.15_Release | 2025.12.15 |
| 2025-12-15 | 2025.12.15 |
| Q4_Release | NA |
| (empty) | NA |

## 🔧 Configuration

### Backend (.env)

```env
# Jira Configuration
JIRA_HOST=https://your-domain.atlassian.net
JIRA_EMAIL=your-email@example.com
JIRA_API_TOKEN=your-api-token-here
JIRA_FILTER_ID=filter-id-here

# Server
PORT=5000
NODE_ENV=development
```

### Frontend (.env or .env.local)

```env
VITE_API_URL=http://localhost:5000/api
```

## 📊 Data Structure

### Issue Object

```typescript
interface JiraIssue {
  id: string;
  key: string;                    // PROJ-1001
  summary: string;                // Issue title
  status: string;                 // In Progress
  statusCategory: string;         // inprogress
  assignee: string;               // John Doe
  priority: string;               // High
  dueDate: string | null;        // 2025-12-20
  fixVersions: string[];         // ["2025.12.15_Release"]
  releaseDate: string;           // 2025.12.15 or NA
  created: string;               // ISO date
  updated: string;               // ISO date
  issueType: string;             // Story, Bug, Task
  labels: string[];              // ["backend", "security"]
  components: string[];          // ["Auth Service"]
  description: string;           // Full description
  url: string;                   // Link to Jira
}
```

## 🔑 Getting Jira Credentials

### API Token
1. Go to https://id.atlassian.com/manage-profile/security/api-tokens
2. Click "Create API token"
3. Copy token and add to `.env`

### Filter ID
1. In Jira, go to Filters > My Filters
2. Open your filter
3. Note the filter ID from URL: `filter=<FILTER_ID>`

## 🎯 Column Guide

| Column | Sortable | Filterable | Type | Notes |
|--------|----------|-----------|------|-------|
| Issue Key | ✅ | ✅ | text | Links to Jira |
| Summary | ✅ | ❌ | text | Issue title |
| Status | ✅ | ✅ | status | Color-coded |
| Priority | ✅ | ✅ | priority | Color-coded |
| Assignee | ✅ | ✅ | assignee | Team member |
| Release Date | ✅ | ❌ | date | Auto-extracted |
| Due Date | ✅ | ✅ | date | If set |
| Type | ✅ | ✅ | text | Story, Bug, etc |

## 🔄 API Endpoints

### Backend Routes

```
GET /api/issues
  - Query: ?useMock=true&jql=<jql>
  - Returns: Array of issues

GET /api/issues/filter/:filterId
  - Returns: Issues from Jira filter

GET /api/health
  - Returns: Health status
```

See backend README for detailed API docs.

## 🎨 Customization

### Modify Default Columns

Edit in `frontend/src/components/IssueTracker.tsx`:

```typescript
const DEFAULT_COLUMNS: Column[] = [
  { key: 'key', label: 'Issue Key', ... },
  // Add or remove columns here
];
```

### Change Colors

Edit Tailwind config in `frontend/tailwind.config.js` or override colors in CSS.

### Add New Columns

1. Add to `DEFAULT_COLUMNS`
2. Ensure field exists in backend issue object
3. Optionally add formatting in `ListView.tsx`

## 📋 Mock Data

The app includes 8 sample issues with:
- Different statuses (To Do, In Progress, In Review, Done)
- Various priorities (High, Medium, Low)
- Multiple assignees
- Release dates in different formats
- Labels and components

Perfect for testing without real Jira setup.

## 🚨 Troubleshooting

| Issue | Solution |
|-------|----------|
| Backend won't start | Check port 5000 is free, run `npm install` |
| Frontend won't load | Verify backend running on 5000, check API URL in .env |
| No data showing | Toggle mock data off/on, check console for errors |
| Filters not working | Refresh page, ensure backend is responding |
| Styling looks off | Clear cache, reinstall: `rm -rf node_modules && npm install` |

## 📚 Documentation

- [Backend README](./backend/README.md) - Detailed backend docs
- [Frontend README](./frontend/README.md) - Detailed frontend docs

## 🛠️ Development Commands

### Backend
```bash
cd backend
npm run dev        # Start with auto-reload
npm start          # Start production
npm install        # Install dependencies
```

### Frontend
```bash
cd frontend
npm run dev        # Start dev server
npm run build      # Build for production
npm run preview    # Preview production build
npm install        # Install dependencies
```

## 📦 Tech Stack

### Backend
- **Node.js** - Runtime
- **Express** - Web framework
- **Axios** - HTTP client
- **Dotenv** - Environment config

### Frontend
- **React 18** - UI library
- **TypeScript** - Type safety
- **Vite** - Build tool
- **Tailwind CSS** - Styling

## 🔒 Security Notes

⚠️ **Important:**
- Never commit `.env` files to version control
- API tokens are handled server-side only
- Use HTTPS in production
- Restrict CORS in production environment

## 📄 License

ISC

## 👨‍💻 Support

For issues or questions:
1. Check the troubleshooting section
2. Review backend/frontend README files
3. Check browser console for errors
4. Verify backend health: `curl http://localhost:5000/api/health`

---

**Happy tracking! 🎉**
