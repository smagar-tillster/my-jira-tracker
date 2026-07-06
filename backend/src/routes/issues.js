import express from 'express';
import { getIssuesByJQL, getMockIssues, getIssuesFromFilter } from '../services/jiraService.js';
import { getAllTags, setIssueTags, getAllUniqueTags } from '../services/tagService.js';
import { getAllImportantFlags, setIssueImportant } from '../services/importantService.js';
import { getAllFETeamFlags, setFETeamMember } from '../services/feteamService.js';
import { getAllMyDayFlags, setIssueMyDay } from '../services/mydayService.js';

const router = express.Router();

/**
 * GET /api/issues
 * Fetch issues from Jira filter or mock data
 * Query params:
 *   - useMock: true to use mock data (default: false)
 *   - limit: max issues to return (default: 50, use -1 for all)
 */
router.get('/issues', async (req, res) => {
  try {
    const { useMock = 'false' } = req.query;

    // Use mock data if explicitly requested
    if (useMock === 'true') {
      console.log('Using mock data');
      return res.json({
        success: true,
        data: getMockIssues(),
        source: 'mock',
      });
    }

    // Fetch from Jira filter
    const filterId = process.env.JIRA_FILTER_ID;
    if (!filterId) {
      return res.status(400).json({
        success: false,
        error: 'JIRA_FILTER_ID not configured in .env',
      });
    }

    console.log(`Fetching issues from filter: ${filterId}`);
    const issues = await getIssuesFromFilter(filterId);
    console.log(`✓ Successfully fetched ${issues.length} issues from Jira filter`);
    
    res.json({
      success: true,
      data: issues,
      source: 'jira',
    });
  } catch (error) {
    console.error('Error fetching issues from filter:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch issues',
    });
  }
});

/**
 * GET /api/issues/filter/:filterId
 * Fetch issues from a specific Jira filter
 */
router.get('/issues/filter/:filterId', async (req, res) => {
  try {
    const { filterId } = req.params;

    if (!process.env.JIRA_API_TOKEN) {
      return res.status(400).json({
        success: false,
        error: 'Jira API token not configured',
      });
    }

    const issues = await getIssuesFromFilter(filterId);
    res.json({
      success: true,
      data: issues,
      source: 'jira',
    });
  } catch (error) {
    console.error('Error fetching filter issues:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch issues from filter',
    });
  }
});

/**
 * GET /api/tags
 * Get all tags for all issues
 */
router.get('/tags', (req, res) => {
  try {
    const tags = getAllTags();
    res.json({
      success: true,
      data: tags,
    });
  } catch (error) {
    console.error('Error fetching tags:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch tags',
    });
  }
});

/**
 * GET /api/tags/unique
 * Get all unique tags
 */
router.get('/tags/unique', (req, res) => {
  try {
    const tags = getAllUniqueTags();
    res.json({
      success: true,
      data: tags,
    });
  } catch (error) {
    console.error('Error fetching unique tags:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch unique tags',
    });
  }
});

/**
 * PUT /api/tags/:issueKey
 * Set tags for a specific issue
 */
router.put('/tags/:issueKey', (req, res) => {
  try {
    const { issueKey } = req.params;
    const { tags } = req.body;

    if (!Array.isArray(tags)) {
      return res.status(400).json({
        success: false,
        error: 'Tags must be an array',
      });
    }

    const success = setIssueTags(issueKey, tags);
    res.json({
      success,
      data: { issueKey, tags },
    });
  } catch (error) {
    console.error('Error setting tags:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to set tags',
    });
  }
});

/**
 * GET /api/important
 * Get all important flags
 */
router.get('/important', (req, res) => {
  try {
    const important = getAllImportantFlags();
    res.json({
      success: true,
      data: important,
    });
  } catch (error) {
    console.error('Error fetching important flags:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch important flags',
    });
  }
});

/**
 * PUT /api/important/:issueKey
 * Set important flag for an issue
 */
router.put('/important/:issueKey', (req, res) => {
  try {
    const { issueKey } = req.params;
    const { important } = req.body;

    if (typeof important !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'important must be a boolean value',
      });
    }

    const success = setIssueImportant(issueKey, important);
    res.json({
      success,
      data: { issueKey, important },
    });
  } catch (error) {
    console.error('Error setting important flag:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to set important flag',
    });
  }
});

/**
 * GET /api/myday
 * Get all My Day flags for issues
 */
router.get('/myday', (req, res) => {
  try {
    res.json({ success: true, data: getAllMyDayFlags() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/myday/:issueKey
 * Set My Day flag for an issue
 */
router.put('/myday/:issueKey', (req, res) => {
  try {
    const { issueKey } = req.params;
    const { myDay } = req.body;
    if (typeof myDay !== 'boolean') {
      return res.status(400).json({ success: false, error: 'myDay must be a boolean' });
    }
    setIssueMyDay(issueKey, myDay);
    res.json({ success: true, data: { issueKey, myDay } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/feteam
 * Get all FE Team membership flags
 */
router.get('/feteam', (req, res) => {
  try {
    const feteam = getAllFETeamFlags();
    res.json({
      success: true,
      data: feteam,
    });
  } catch (error) {
    console.error('Error fetching FE team flags:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch FE team flags',
    });
  }
});

/**
 * PUT /api/feteam/:assignee
 * Set FE Team membership for an assignee
 */
router.put('/feteam/:assignee', (req, res) => {
  try {
    const { assignee } = req.params;
    const { isMember } = req.body;

    if (typeof isMember !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'isMember must be a boolean value',
      });
    }

    setFETeamMember(assignee, isMember);
    res.json({
      success: true,
      data: { assignee, isMember },
    });
  } catch (error) {
    console.error('Error setting FE team membership:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to set FE team membership',
    });
  }
});

/**
 * GET /api/config/filters
 * Get filter IDs configuration
 */
router.get('/config/filters', (req, res) => {
  res.json({
    success: true,
    data: {
      sprint:  process.env.JIRA_FILTER_ID_SPRINT   || process.env.JIRA_FILTER_ID || '',
      me:      process.env.JIRA_FILTER_ID_ME      || '',
      defects: process.env.JIRA_FILTER_ID_DEFECTS || '',
      archive: process.env.JIRA_FILTER_ID_ARCHIVE || '',
    },
  });
});

/**
 * GET /api/health
 * Health check endpoint
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Jira Tracker Backend is running',
    timestamp: new Date().toISOString(),
  });
});

export default router;
