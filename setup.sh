#!/bin/bash

# Jira Tracker Setup Script for macOS/Linux

echo ""
echo "========================================"
echo "  Jira Task Tracker - Setup Script"
echo "========================================"
echo ""

# Check Node.js
echo "Checking Node.js installation..."
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js not found. Please install Node.js 16+ from https://nodejs.org/"
    exit 1
fi
node --version
echo "✓ Node.js found"

echo ""
echo "========================================"
echo "  Setting up Backend"
echo "========================================"
cd backend
echo ""
echo "Installing backend dependencies..."
npm install || { echo "ERROR: Failed to install backend dependencies"; exit 1; }
echo "✓ Backend dependencies installed"

if [ ! -f .env ]; then
    echo ""
    echo "Copying .env.example to .env..."
    cp .env.example .env
    echo ""
    echo "⚠️  IMPORTANT: Edit backend/.env with your Jira credentials (optional for mock data)"
    echo "   - JIRA_HOST: Your Jira instance URL"
    echo "   - JIRA_EMAIL: Your Jira email"
    echo "   - JIRA_API_TOKEN: Your API token from https://id.atlassian.com/manage-profile/security/api-tokens"
    echo "   - JIRA_FILTER_ID: Your filter ID"
fi

cd ..

echo ""
echo "========================================"
echo "  Setting up Frontend"
echo "========================================"
cd frontend
echo ""
echo "Installing frontend dependencies..."
npm install || { echo "ERROR: Failed to install frontend dependencies"; exit 1; }
echo "✓ Frontend dependencies installed"

if [ ! -f .env ]; then
    echo ""
    echo "Copying .env.example to .env..."
    cp .env.example .env
fi

cd ..

echo ""
echo "========================================"
echo "  Setup Complete! ✓"
echo "========================================"
echo ""
echo "Next steps:"
echo ""
echo "1. Start the Backend (in one terminal):"
echo "   cd backend"
echo "   npm run dev"
echo ""
echo "2. Start the Frontend (in another terminal):"
echo "   cd frontend"
echo "   npm run dev"
echo ""
echo "3. Open http://localhost:3000 in your browser"
echo ""
echo "Default setup uses mock data. To use real Jira:"
echo " - Edit backend/.env with your Jira credentials"
echo " - Click '🎭 Mock Data' button in the UI to switch to '🔗 Live API'"
echo ""
echo "For more information, see README.md"
echo ""
