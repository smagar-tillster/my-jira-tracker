# Jira Tracker Backend

Node.js/Express backend service for the Jira Task Tracker application. Handles Jira API authentication and issue fetching with security for API tokens.

## Features

- 🔐 Secure Jira API token handling
- 📋 Fetch issues from Jira filters or JQL queries
- 🎯 Extract release dates from Fix Version strings
- 🗂️ Mock data support for development
- 🚀 CORS enabled for frontend integration
- ⚡ Fast and lightweight Express server

## Architecture

```
backend/
├── src/
│   ├── index.js              # Main Express app
│   ├── routes/
│   │   └── issues.js         # Issue endpoints
│   └── services/
│       └── jiraService.js    # Jira API integration
├── .env.example              # Environment variables template
└── package.json
```

## Prerequisites

- Node.js 16+ 
- npm or yarn
- Jira Cloud instance with API access

## Installation

1. **Navigate to backend directory:**
   ```bash
   cd backend
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Setup environment variables:**
   ```bash
   cp .env.example .env
   ```

4. **Configure .env file:**
   ```
   JIRA_HOST=https://your-domain.atlassian.net
   JIRA_EMAIL=your-email@example.com
   JIRA_API_TOKEN=your-api-token-here
   JIRA_FILTER_ID=filter-id-here
   PORT=5000
   NODE_ENV=development
   ```

### Getting Jira API Token

1. Go to https://id.atlassian.com/manage-profile/security/api-tokens
2. Click "Create API token"
3. Copy the generated token and add to `.env`

### Finding Filter ID

1. In Jira, go to Filters > My Filters
2. Open your filter
3. Get the filter ID from the URL: `https://domain.atlassian.net/issues/?jql=filter=<FILTER_ID>`

## Running

### Development Mode (with auto-reload)
```bash
npm run dev
```

### Production Mode
```bash
npm start
```

The server will start on `http://localhost:5000`

## API Endpoints

### Get Issues
```
GET /api/issues?useMock=true&jql=<jql-query>
```

**Query Parameters:**
- `useMock` (boolean): Use mock data if true (default: true)
- `jql` (string): Optional JQL query for real API

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "1",
      "key": "PROJ-1001",
      "summary": "Task summary",
      "status": "In Progress",
      "statusCategory": "inprogress",
      "assignee": "John Doe",
      "priority": "High",
      "dueDate": "2025-12-20",
      "fixVersions": ["2025.12.15_Release"],
      "releaseDate": "2025.12.15",
      "created": "2025-11-01T10:00:00.000Z",
      "updated": "2025-12-10T15:30:00.000Z",
      "issueType": "Story",
      "labels": ["backend", "security"],
      "components": ["Auth Service"],
      "description": "Task description",
      "url": "https://domain.atlassian.net/browse/PROJ-1001"
    }
  ],
  "source": "mock"
}
```

### Get Issues from Filter
```
GET /api/issues/filter/:filterId
```

**Response:** Same as above with `source: "jira"`

### Health Check
```
GET /api/health
```

**Response:**
```json
{
  "success": true,
  "message": "Jira Tracker Backend is running",
  "timestamp": "2025-12-15T10:00:00.000Z"
}
```

## Services

### jiraService.js

**extractReleaseDate(fixVersion: string): string**
- Extracts release date from Fix Version string
- Supports formats: `YYYY.MM.DD_XXX` and `YYYY-MM-DD`
- Returns 'NA' if no valid date found

**getIssuesFromFilter(filterId: string): Promise<Issue[]>**
- Fetches issues from a Jira filter
- Requires Jira API credentials in .env

**getIssuesByJQL(jql: string, maxResults: number): Promise<Issue[]>**
- Fetches issues using JQL query
- Default JQL: assigned to current user and unresolved

**getMockIssues(): Issue[]**
- Returns sample mock data for development
- Includes 8 sample issues with various statuses

## Development

The mock data includes realistic Jira issues for testing:
- Different statuses (To Do, In Progress, In Review, Done)
- Various priorities (High, Medium, Low)
- Multiple assignees
- Release dates in different formats
- Labels and components

To switch to real Jira API:
1. Update `.env` with your Jira credentials
2. Call `/api/issues?useMock=false` from frontend

## Error Handling

- Missing Jira credentials: 400 error with helpful message
- API failures: 500 error with error details
- All errors are logged to console for debugging

## Security Notes

- ⚠️ Never commit `.env` file to version control
- API tokens are kept server-side, not exposed to frontend
- CORS is configured for local development (customize in production)
- Always use HTTPS in production

## Testing the Backend

```bash
# Check if backend is running
curl http://localhost:5000/api/health

# Get mock issues
curl http://localhost:5000/api/issues?useMock=true

# Get real issues (requires .env setup)
curl http://localhost:5000/api/issues?useMock=false
```

## Troubleshooting

**Port already in use:**
```bash
PORT=5001 npm start
```

**Module not found errors:**
```bash
npm install
```

**Jira API authentication fails:**
- Verify email and API token in `.env`
- Check that Jira host URL is correct
- Ensure user has permission to API

## License

ISC
