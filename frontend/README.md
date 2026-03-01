# Jira Tracker Frontend

React + TypeScript + Vite frontend for the Jira Task Tracker. Modern, responsive UI with powerful filtering, grouping, and sorting capabilities.

## Features

- 📊 **List View** - Display issues in organized, grouped tables
- 🔍 **Search** - Full-text search across key, summary, assignee, description
- 🎯 **Filters** - Filter by any column (status, priority, assignee, etc.)
- 📌 **Grouping** - Group issues dynamically by any column
- ↕️ **Sorting** - Sort by any column in ascending/descending order
- 📅 **Date Handling** - Parse release dates from Fix Version field
- 🎨 **Responsive Design** - Tailwind CSS for beautiful UI
- ⚡ **Fast Performance** - Vite for rapid development and builds
- 🗂️ **Column Management** - Show/hide columns and add custom columns
- 🏷️ **Status & Priority Badges** - Visual indicators for issue status and priority

## Architecture

```
frontend/
├── src/
│   ├── components/
│   │   ├── IssueTracker.tsx    # Main component
│   │   └── views/
│   │       └── ListView.tsx    # List view implementation
│   ├── services/
│   │   ├── api.ts             # API client
│   │   └── dataProcessor.ts   # Data filtering, sorting, grouping
│   ├── hooks/
│   │   └── useIssueFiltering.ts # Custom hook for filtering
│   ├── types/
│   │   └── index.ts           # TypeScript types
│   ├── App.tsx                # Main app component
│   └── main.tsx               # Entry point
├── vite.config.ts             # Vite configuration
├── tailwind.config.js         # Tailwind CSS config
└── package.json
```

## Prerequisites

- Node.js 16+
- npm or yarn
- Backend running on http://localhost:5000

## Installation

1. **Navigate to frontend directory:**
   ```bash
   cd frontend
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Setup environment (optional):**
   ```bash
   cp .env.example .env
   # .env defaults to http://localhost:5000/api
   ```

## Running

### Development Mode (with hot reload)
```bash
npm run dev
```

Opens automatically at `http://localhost:3000`

### Build for Production
```bash
npm run build
```

### Preview Production Build
```bash
npm run preview
```

## UI Components

### IssueTracker.tsx
Main component handling:
- Search input
- Group By selector
- Column visibility management
- Filter management
- Statistics display

### ListView.tsx
Displays issues in a grouped table with:
- Collapsible group headers with counts
- Sortable columns with visual indicators
- Filterable cells (clickable)
- Color-coded priorities and statuses
- Formatted date displays

### DataProcessor Service
Utility functions for:
- **sortIssues()** - Sort by any column
- **filterIssues()** - Filter with search term and column filters
- **groupIssues()** - Group by any column
- **getColumnUniqueValues()** - Get distinct values for dropdowns

## Features Explained

### Search
- Full-text search across multiple fields
- Real-time filtering as you type
- Searches: key, summary, assignee, description

### Filtering
- Click on any filterable cell to add filter
- Multiple filters work together (AND logic)
- Visual filter badges show active filters
- Remove individual filters or clear all

### Grouping
- Select column from "Group By" dropdown
- Issues automatically grouped
- Groups are collapsible
- Shows count per group

### Sorting
- Click column header up/down arrow to sort
- Visual indicator shows sort direction
- Works with all sortable columns
- Handles dates, text, and numbers

### Column Management
- Show/hide columns from dropdown
- Default 8 columns visible
- Add more columns as needed
- Resize columns via CSS

### Release Date Extraction
- Automatically extracts dates from Fix Version field
- Supports formats:
  - `YYYY.MM.DD_XXX` (e.g., `2025.12.15_Release`)
  - `YYYY-MM-DD` (e.g., `2025-12-15`)
- Shows "NA" for non-matching formats
- Automatically displayed in Release Date column

## Default Columns

1. **Issue Key** - Jira issue key (clickable, links to Jira)
2. **Summary** - Issue title
3. **Status** - Current status (color-coded)
4. **Priority** - Priority level (color-coded)
5. **Assignee** - Assigned person
6. **Release Date** - Extracted from Fix Version
7. **Due Date** - Due date if set
8. **Type** - Issue type (Story, Bug, Task, etc.)

Additional available columns:
- Issue ID
- Created date
- Updated date
- Labels
- Components
- Description

## Color Coding

### Priority Colors
- 🔴 Highest/High: Red/Orange
- 🟡 Medium: Yellow
- 🟢 Low/Lowest: Green/Blue

### Status Colors
- ⚪ To Do: Gray
- 🔵 In Progress: Blue
- 🟢 Done: Green

## Data Flow

```
Backend (/api/issues)
    ↓
API Service (services/api.ts)
    ↓
App.tsx (fetch & store)
    ↓
IssueTracker.tsx (manage state)
    ↓
Data Processor (filter, sort, group)
    ↓
ListView.tsx (render)
```

## API Integration

### getIssues()
```typescript
const issues = await jiraApi.getIssues(useMock: boolean);
```

- `useMock: true` - Uses mock data (default)
- `useMock: false` - Calls real Jira API (requires backend setup)

### getIssuesFromFilter()
```typescript
const issues = await jiraApi.getIssuesFromFilter(filterId: string);
```

Fetches issues from specific Jira filter.

### checkHealth()
```typescript
const isHealthy = await jiraApi.checkHealth();
```

Verifies backend is running.

## State Management

### App Level
- `issues` - All fetched issues
- `loading` - Loading state
- `error` - Error messages
- `useMockData` - Toggle between mock and real API

### IssueTracker Level
- `visibleColumns` - Which columns to show
- `sortConfig` - Current sort column and direction
- `groupConfig` - Current grouping column
- `searchTerm` - Search input value
- `filters` - Active column filters

### ListView Level
- `expandedGroups` - Which groups are expanded

## Hooks

### useIssueFiltering()
Custom hook for managing filter state:
- `searchTerm` - Current search
- `filters` - Active filters object
- `addFilter()` - Add filter
- `removeFilter()` - Remove filter
- `toggleFilterValue()` - Toggle multi-value filter
- `clearAllFilters()` - Clear all filters and search

## Performance Optimization

- Memoized components prevent unnecessary re-renders
- Efficient data processing algorithms
- Virtual scrolling ready (can be added for large datasets)
- CSS classes optimized with Tailwind

## Styling

Built with Tailwind CSS for:
- Responsive design
- Consistent spacing and colors
- Fast development
- Small bundle size

Customizable in `tailwind.config.js`

## Development Tips

1. **Hot Module Replacement** - Changes auto-reload
2. **React DevTools** - Debug component state
3. **Network Tab** - Monitor API calls
4. **Mock Data Toggle** - Test without backend

## Troubleshooting

**Backend not found:**
- Ensure backend is running: `npm run dev` in backend/
- Check backend URL in API service matches

**Issues not loading:**
- Check browser console for errors
- Verify backend health: `http://localhost:5000/api/health`
- Try toggling mock data switch

**Styling issues:**
- Clear node_modules: `rm -rf node_modules && npm install`
- Restart dev server: `npm run dev`

**Port 3000 in use:**
- Change port in vite.config.ts or use: `npm run dev -- --port 3001`

## Building for Production

```bash
npm run build
```

Creates optimized build in `dist/` folder. Deploy to any static host (Vercel, Netlify, GitHub Pages, etc.)

## Browser Support

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Mobile browsers

## License

ISC
