# Quick Start Guide

## ⚡ 5-Minute Setup

### Option 1: Automated Setup (Windows)
```bash
setup.bat
```

### Option 2: Automated Setup (macOS/Linux)
```bash
chmod +x setup.sh
./setup.sh
```

### Option 3: Manual Setup

#### Terminal 1 - Backend
```bash
cd backend
npm install
npm run dev
```

#### Terminal 2 - Frontend
```bash
cd frontend
npm install
npm run dev
```

## 🚀 Now What?

1. **Open Browser** → http://localhost:3000
2. **See Mock Data** → Issues load automatically
3. **Play Around** → 
   - Search in the search box
   - Click cells to add filters
   - Use "Group By" dropdown
   - Click column headers to sort

## 🔑 To Connect Real Jira

1. **Get API Token**
   - Go to: https://id.atlassian.com/manage-profile/security/api-tokens
   - Click "Create API token"
   - Copy the token

2. **Configure Backend**
   - Edit `backend/.env`
   - Add your Jira host, email, and token:
   ```
   JIRA_HOST=https://your-domain.atlassian.net
   JIRA_EMAIL=your-email@example.com
   JIRA_API_TOKEN=paste-token-here
   JIRA_FILTER_ID=your-filter-id
   ```

3. **Toggle in UI**
   - Click the **🎭 Mock Data** button in top right
   - Switch to **🔗 Live API**

## 📊 Features to Try

| Feature | How |
|---------|-----|
| Search | Type in search box |
| Filter | Click cell values or use badges |
| Group | Select from "Group By" dropdown |
| Sort | Click column header arrows |
| Add Column | Use "Add Column..." dropdown |
| Clear All | Click "Clear Filters" button |

## 🎨 What You Get

✅ **Backend**
- Express server on port 5000
- Jira API integration (secure token handling)
- Mock data for testing
- REST API endpoints

✅ **Frontend**
- React + TypeScript UI
- List view with grouping
- Inline search & filters
- Sortable columns
- Color-coded status/priority
- Release date extraction
- Responsive design

## 📁 Explore the Code

```
MyTracker/
├── backend/src/
│   ├── index.js → Main Express server
│   ├── services/jiraService.js → API integration
│   └── routes/issues.js → API endpoints
│
└── frontend/src/
    ├── App.tsx → Main component
    ├── components/IssueTracker.tsx → Logic
    ├── components/views/ListView.tsx → UI
    ├── services/api.ts → API client
    └── services/dataProcessor.ts → Filter/Sort/Group logic
```

## 🐛 Troubleshooting

| Problem | Fix |
|---------|-----|
| Port 5000 in use | `PORT=5001 npm run dev` in backend |
| Port 3000 in use | `npm run dev -- --port 3001` in frontend |
| Module not found | `npm install` in that folder |
| Blank page | Check console (F12), verify backend running |
| No filters working | Refresh page or restart backend |

## 📚 Full Docs

- [Project README.md](./README.md)
- [Backend README.md](./backend/README.md)
- [Frontend README.md](./frontend/README.md)

## 💡 Next Steps

1. ✅ Get it running with mock data
2. 🔑 Connect to your real Jira (optional)
3. 🎨 Customize columns and styling
4. 📦 Deploy to production (see README for options)

**Enjoy your new Jira tracker! 🎉**
