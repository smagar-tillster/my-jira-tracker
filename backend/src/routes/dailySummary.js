import express from 'express';
import fs from 'fs';
import path from 'path';
import { getLatestDailySummary, upsertDailySummary } from '../services/dailySummaryService.js';

const router = express.Router();

const isIsoDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '');

const isAuthorized = (req) => {
  const configuredKey = process.env.DAILY_SUMMARY_API_KEY || '';
  if (!configuredKey) return true;

  const apiKey = req.headers['x-api-key'];
  const authHeader = req.headers.authorization || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  return apiKey === configuredKey || bearer === configuredKey;
};

const MODE = process.env.DAILY_SUMMARY_MODE || 'file';
const FILE_PATH = process.env.DAILY_SUMMARY_FILE_PATH ||
  'C:\\Users\\smagar\\Documents\\Claude\\Scheduled\\daily-morning-briefing\\dailyBriefing.md';

// GET /api/daily-summary/latest
router.get('/daily-summary/latest', (req, res) => {
  try {
    if (MODE === 'file') {
      const filePath = path.resolve(FILE_PATH);
      if (!fs.existsSync(filePath)) {
        return res.json({ success: true, data: null });
      }
      const content = fs.readFileSync(filePath, 'utf8').trim();
      if (!content) return res.json({ success: true, data: null });

      const stat = fs.statSync(filePath);
      return res.json({
        success: true,
        data: {
          id: 'file',
          summaryDate: stat.mtime.toISOString().slice(0, 10),
          source: 'file',
          title: null,
          content,
          createdAt: stat.mtime.toISOString(),
          updatedAt: stat.mtime.toISOString(),
        },
      });
    }

    const data = getLatestDailySummary();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/daily-summary
// Body: { summaryDate, content, source?, title? }
router.post('/daily-summary', (req, res) => {
  try {
    if (!isAuthorized(req)) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { summaryDate, source, title, content } = req.body || {};

    if (!summaryDate || !isIsoDate(summaryDate)) {
      return res.status(400).json({
        success: false,
        error: 'summaryDate is required in YYYY-MM-DD format',
      });
    }

    if (!content || typeof content !== 'string') {
      return res.status(400).json({ success: false, error: 'content is required' });
    }

    const data = upsertDailySummary({ summaryDate, source, title, content });

    res.status(201).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
