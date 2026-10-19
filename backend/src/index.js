import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import issuesRouter from './routes/issues.js';
import accomplishmentsRouter from './routes/accomplishments.js';
import deliveryRouter from './routes/delivery.js';
import hubRouter from './routes/hub.js';
import { initDb } from './db/database.js';
import { migrateFromJson } from './db/migrate.js';

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
app.use('/api', accomplishmentsRouter);
app.use('/api', deliveryRouter);
app.use('/api', hubRouter);

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
});
