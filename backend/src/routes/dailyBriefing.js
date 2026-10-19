import express from 'express';
import { buildDailyBriefing } from '../services/dailyBriefingService.js';

const router = express.Router();

/**
 * GET /api/daily-briefing
 * Read-only endpoint: fetches the whole-team sprint filter (same filter used
 * by /api/config/filters -> data.sprint), merges in local IMP flags, and
 * returns pre-classified/pre-grouped data for the daily briefing workflow —
 * replacing what used to be many separate Jira JQL calls.
 */
router.get('/daily-briefing', async (req, res) => {
  try {
    const sprintFilterId =
      process.env.JIRA_FILTER_ID_SPRINT || process.env.JIRA_FILTER_ID || '60259';

    const briefing = await buildDailyBriefing(sprintFilterId);

    res.json({
      success: true,
      data: briefing,
    });
  } catch (error) {
    console.error('Error building daily briefing:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to build daily briefing',
    });
  }
});

export default router;
