# 🚀 Getting Started Checklist

## ✅ Project Setup Complete

Your Jira Task Tracker is fully developed and ready to use!

### What's Included

- ✅ **Backend Server** (Node.js/Express)
  - Jira API integration
  - Mock data service
  - REST API endpoints

- ✅ **Frontend Application** (React/TypeScript)
  - List view with grouping
  - Search and filtering
  - Sorting and column management
  - Date extraction
  - Responsive UI

- ✅ **Documentation**
  - Main README
  - Quick start guide
  - Backend documentation
  - Frontend documentation
  - This checklist

- ✅ **Setup Scripts**
  - Windows (setup.bat)
  - Linux/macOS (setup.sh)

---

## 🎯 Quick Start (Choose One)

### Option A: Automated Setup (Recommended)

**Windows:**
```bash
setup.bat
```

**Linux/macOS:**
```bash
chmod +x setup.sh
./setup.sh
```

### Option B: Manual Setup

**Terminal 1 - Backend:**
```bash
cd backend
npm install
npm run dev
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm install
npm run dev
```

**Then open:** http://localhost:3000

---

## 📋 First Time Setup Checklist

- [ ] Run setup script OR follow manual setup
- [ ] Verify backend starts (look for "🚀 Jira Tracker Backend running")
- [ ] Verify frontend starts (look for "VITE v..." message)
- [ ] Browser opens to http://localhost:3000
- [ ] See issues in the list view
- [ ] Try searching for an issue
- [ ] Try filtering by clicking a cell
- [ ] Try grouping by selecting a column
- [ ] Try sorting by clicking a header

---

## 🎮 Feature Testing Checklist

### Search Feature
- [ ] Type in search box
- [ ] Results filter in real-time
- [ ] Clear search and results reset

### Filtering Feature
- [ ] Click on a cell value to filter
- [ ] Filter badge appears
- [ ] Click badge X to remove filter
- [ ] Click "Clear Filters" button

### Grouping Feature
- [ ] Select "Group By..." from dropdown
- [ ] Issues reorganize by group
- [ ] Group headers show count
- [ ] Click group header to collapse
- [ ] Change grouping and see update

### Sorting Feature
- [ ] Click column header arrow to sort
- [ ] Click again to reverse sort
- [ ] Arrow indicator shows direction
- [ ] Sort works on all columns

### Column Management
- [ ] Click "Add Column..." dropdown
- [ ] Select a column to add
- [ ] New column appears
- [ ] Columns don't overlap (scroll right if needed)

### Mock Data Toggle
- [ ] See "🎭 Mock Data" button in top right
- [ ] Click it to toggle
- [ ] Button changes to "🔗 Live API" when off
- [ ] (Live API mode requires backend .env setup)

---

## 🔑 Optional: Connect to Real Jira

Follow these steps only if you want to use your real Jira account:

### Step 1: Get Your Jira API Token
- [ ] Visit: https://id.atlassian.com/manage-profile/security/api-tokens
- [ ] Click "Create API token"
- [ ] Copy the generated token
- [ ] Keep it safe (treat like a password)

### Step 2: Get Your Filter ID
- [ ] Go to your Jira instance
- [ ] Navigate to: Filters > My Filters
- [ ] Open a filter you want to track
- [ ] Note the filter ID from the URL
  - Look for: `filter=<YOUR_FILTER_ID>`

### Step 3: Configure Backend
- [ ] Open `backend/.env` file
- [ ] Fill in these values:
  ```
  JIRA_HOST=https://your-domain.atlassian.net
  JIRA_EMAIL=your-email@example.com
  JIRA_API_TOKEN=paste-your-token-here
  JIRA_FILTER_ID=your-filter-id
  ```
- [ ] Save the file
- [ ] Restart backend (stop and `npm run dev` again)

### Step 4: Toggle in UI
- [ ] Look for "🎭 Mock Data" button in top right
- [ ] Click it to toggle
- [ ] Should change to "🔗 Live API"
- [ ] Issues should now load from your Jira
- [ ] If issues don't load, check browser console for errors

---

## 🎨 Customization Checklist

### Modify Colors
- [ ] Open `frontend/tailwind.config.js`
- [ ] Edit color values
- [ ] Restart frontend to see changes

### Change Default Columns
- [ ] Open `frontend/src/components/IssueTracker.tsx`
- [ ] Find `DEFAULT_COLUMNS` array
- [ ] Add/remove columns as needed
- [ ] Restart frontend

### Modify Column Width
- [ ] In same file, add `width: 200` to column definition
- [ ] Adjust number as needed

### Change Header Text
- [ ] Edit `App.tsx` in frontend/src
- [ ] Modify header content
- [ ] Restart frontend

---

## 🐛 Troubleshooting Checklist

**Backend won't start:**
- [ ] Check Node.js is installed: `node --version`
- [ ] Check port 5000 is free
- [ ] Try: `PORT=5001 npm run dev`
- [ ] Check for errors in terminal
- [ ] Try: `npm install` (dependencies missing?)

**Frontend won't start:**
- [ ] Check backend is running first
- [ ] Try: `npm install` in frontend/
- [ ] Clear cache: `rm -rf node_modules && npm install`
- [ ] Try different port: `npm run dev -- --port 3001`

**Can't see any data:**
- [ ] Refresh page (Cmd/Ctrl + R)
- [ ] Check backend health: `curl http://localhost:5000/api/health`
- [ ] Open browser console (F12) and look for errors
- [ ] Check "🎭 Mock Data" button is ON (blue)

**Real Jira not working:**
- [ ] Double-check .env values (no extra spaces)
- [ ] Verify API token is correct
- [ ] Test token at: https://id.atlassian.com/manage-profile/security/api-tokens
- [ ] Verify Jira host URL is correct (https://...)
- [ ] Check browser console for specific error

**Styling looks weird:**
- [ ] Hard refresh: Ctrl+Shift+R or Cmd+Shift+R
- [ ] Clear browser cache
- [ ] Restart frontend: stop and `npm run dev`

---

## 📁 Project Structure Quick Reference

```
MyTracker/
├── backend/              ← Start with: npm run dev
├── frontend/             ← Start with: npm run dev
├── README.md             ← Full documentation
├── QUICKSTART.md         ← Quick setup (1 min)
├── PROJECT_SUMMARY.md    ← Technical overview
├── setup.bat             ← Windows automation
└── setup.sh              ← Linux/macOS automation
```

---

## 📞 Need Help?

1. **Quick questions?**
   - Check `QUICKSTART.md`

2. **Feature details?**
   - Check `README.md`

3. **Backend questions?**
   - Check `backend/README.md`

4. **Frontend questions?**
   - Check `frontend/README.md`

5. **Something not working?**
   - Check "Troubleshooting" section in README.md
   - Check this checklist's troubleshooting section
   - Look for errors in browser console (F12)
   - Look for errors in backend terminal

---

## 🎉 You're All Set!

Everything is ready to go. Your Jira Task Tracker has:

✅ Working backend server
✅ Beautiful React frontend
✅ Mock data for testing
✅ Real Jira API support (optional)
✅ Advanced filtering & grouping
✅ Comprehensive documentation

### Now:
1. **Run the setup** (manual or automated)
2. **Explore with mock data** (test features)
3. **Connect to real Jira** (when ready)
4. **Customize as needed** (colors, columns, etc)
5. **Deploy** (when satisfied)

---

**Happy tracking! 📊🚀**

*Created: December 15, 2025*
*Status: Ready to Use* ✅
