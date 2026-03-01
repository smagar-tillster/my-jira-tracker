# Docker Setup for MyTracker

## Quick Start

### Start both frontend and backend:
```bash
docker-compose up --build
```

### Stop services:
```bash
docker-compose down
```

### Rebuild after code changes:
```bash
docker-compose up --build
```

## Access the Application

- **Frontend**: http://localhost:3051
- **Backend API**: http://localhost:3050/api
- **Health Check**: http://localhost:3050/api/health

## Service Details

### Backend (Port 3050)
- Node.js Express server
- Hot-reload enabled with volume mounts
- Reads `.env` file for JIRA credentials
- API available at `/api` endpoints

### Frontend (Port 3051)
- Vite React development server
- Hot-reload enabled
- Connects to backend at `http://localhost:3050/api`
- Built with TypeScript and Tailwind CSS

## Docker Commands

### View logs:
```bash
# All services
docker-compose logs -f

# Backend only
docker-compose logs -f backend

# Frontend only
docker-compose logs -f frontend
```

### Restart a service:
```bash
docker-compose restart backend
docker-compose restart frontend
```

### Stop and remove containers:
```bash
docker-compose down
```

### Rebuild images:
```bash
docker-compose build
```

### Run in detached mode (background):
```bash
docker-compose up -d
```

## Troubleshooting

### Port already in use:
If ports 3050 or 3051 are already in use, modify `docker-compose.yml`:
```yaml
ports:
  - "YOUR_PORT:3050"  # Backend
  - "YOUR_PORT:3051"  # Frontend
```

### Permission issues on Windows:
Make sure Docker Desktop is running with proper permissions.

### Code changes not reflecting:
1. Check if volumes are mounted correctly
2. Restart the service: `docker-compose restart backend` or `docker-compose restart frontend`
3. Rebuild if needed: `docker-compose up --build`

## Environment Variables

Backend requires `.env` file in `backend/` directory with:
```
JIRA_BASE_URL=your_jira_url
JIRA_EMAIL=your_email
JIRA_API_TOKEN=your_token
```

Frontend automatically uses `VITE_API_URL=http://localhost:3050/api` (set in docker-compose.yml)

## Development Workflow

1. Edit code in your local files
2. Changes auto-reload in containers (hot-reload enabled)
3. View logs with `docker-compose logs -f`
4. Stop with `Ctrl+C` or `docker-compose down`
