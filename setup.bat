@echo off
REM Jira Tracker Setup Script for Windows

echo.
echo ========================================
echo   Jira Task Tracker - Setup Script
echo ========================================
echo.

REM Check Node.js
echo Checking Node.js installation...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js not found. Please install Node.js 16+ from https://nodejs.org/
    exit /b 1
)
echo ✓ Node.js found

echo.
echo ========================================
echo   Setting up Backend
echo ========================================
cd backend
echo.
echo Installing backend dependencies...
call npm install
if %errorlevel% neq 0 (
    echo ERROR: Failed to install backend dependencies
    exit /b 1
)
echo ✓ Backend dependencies installed

if not exist .env (
    echo.
    echo Copying .env.example to .env...
    copy .env.example .env
    echo.
    echo ⚠️  IMPORTANT: Edit backend/.env with your Jira credentials (optional for mock data)
    echo    - JIRA_HOST: Your Jira instance URL
    echo    - JIRA_EMAIL: Your Jira email
    echo    - JIRA_API_TOKEN: Your API token from https://id.atlassian.com/manage-profile/security/api-tokens
    echo    - JIRA_FILTER_ID: Your filter ID
)

cd ..

echo.
echo ========================================
echo   Setting up Frontend
echo ========================================
cd frontend
echo.
echo Installing frontend dependencies...
call npm install
if %errorlevel% neq 0 (
    echo ERROR: Failed to install frontend dependencies
    exit /b 1
)
echo ✓ Frontend dependencies installed

if not exist .env (
    echo.
    echo Copying .env.example to .env...
    copy .env.example .env
)

cd ..

echo.
echo ========================================
echo   Setup Complete! ✓
echo ========================================
echo.
echo Next steps:
echo.
echo 1. Start the Backend (in one terminal):
echo    cd backend
echo    npm run dev
echo.
echo 2. Start the Frontend (in another terminal):
echo    cd frontend
echo    npm run dev
echo.
echo 3. Open http://localhost:3000 in your browser
echo.
echo Default setup uses mock data. To use real Jira:
echo  - Edit backend/.env with your Jira credentials
echo  - Click "🎭 Mock Data" button in the UI to switch to "🔗 Live API"
echo.
echo For more information, see README.md
echo.
pause
