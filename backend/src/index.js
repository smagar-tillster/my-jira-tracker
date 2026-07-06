import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import issuesRouter from './routes/issues.js';
import todosRouter from './routes/todos.js';
import accomplishmentsRouter from './routes/accomplishments.js';
import archiveRouter from './routes/archive.js';
import dailySummaryRouter from './routes/dailySummary.js';
import { initDb } from './db/database.js';
import { migrateFromJson } from './db/migrate.js';
import { refreshArchiveCache, isCacheStale } from './services/archiveService.js';

dotenv.config();

// Initialise SQLite and migrate existing JSON data
initDb();
migrateFromJson();

const app = express();
const PORT = process.env.PORT || 3050;

// Middleware
app.use(cors());
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Routes
app.use('/api', issuesRouter);
app.use('/api', todosRouter);
app.use('/api', accomplishmentsRouter);
app.use('/api', archiveRouter);
app.use('/api', dailySummaryRouter);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: err.message,
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Jira Tracker Backend running on http://localhost:${PORT}`);
  console.log(`📝 API available at http://localhost:${PORT}/api`);
  console.log(`🏥 Health check at http://localhost:${PORT}/api/health`);

  // Seed archive cache on startup if stale, then refresh every 24 hours
  const runArchiveRefresh = () => {
    if (isCacheStale()) {
      refreshArchiveCache().catch(err =>
        console.error('[archive] Scheduled refresh failed:', err.message)
      );
    }
  };
  runArchiveRefresh();
  setInterval(runArchiveRefresh, 24 * 60 * 60 * 1000); // every 24 h
});
