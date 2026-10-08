import express from 'express';
import { getIssuesByJQL, getMockIssues, getIssuesFromFilter, getBoardSprints } from '../services/jiraService.js';
import { getAllTags, setIssueTags, getAllUniqueTags } from '../services/tagService.js';
import { getAllImportantFlags, setIssueImportant } from '../services/importantService.js';
import { getAllFETeamFlags, setFETeamMember } from '../services/feteamService.js';
import { getAllClientRegions, setClientRegion } from '../services/regionService.js';
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
 * GET /api/regions
 * Get the client -> region mapping (clients with no mapping are treated as 'Other')
 */
router.get('/regions', (req, res) => {
  try {
    res.json({ success: true, data: getAllClientRegions() });
  } catch (error) {
    console.error('Error fetching client regions:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch client regions',
    });
  }
});

/**
 * PUT /api/regions/:client
 * Set (or clear, with an empty region) the region for a client
 */
router.put('/regions/:client', (req, res) => {
  try {
    const { client } = req.params;
    const { region } = req.body;

    if (typeof region !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'region must be a string (empty string clears the mapping)',
      });
    }

    setClientRegion(client, region);
    res.json({ success: true, data: { client, region: region.trim() } });
  } catch (error) {
    console.error('Error setting client region:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to set client region',
    });
  }
});

/**
 * GET /api/sprints
 * List active + future sprints for the configured board, filtered to the
 * numbered sprint track (name prefix), sorted chronologically by start date.
 */
router.get('/sprints', async (req, res) => {
  try {
    const boardId = process.env.JIRA_BOARD_ID || '269';
    const prefix = (req.query.prefix || 'NGK Sprint').toLowerCase();

    const sprints = await getBoardSprints(boardId, 'active,future');
    const filtered = sprints
      .filter(s => s.name && s.name.toLowerCase().startsWith(prefix))
      .map(s => ({
        id: s.id,
        name: s.name,
        state: s.state,
        startDate: s.startDate || null,
        endDate: s.endDate || null,
      }))
      .sort((a, b) => {
        if (!a.startDate && !b.startDate) return 0;
        if (!a.startDate) return 1;
        if (!b.startDate) return -1;
        return new Date(a.startDate) - new Date(b.startDate);
      });

    res.json({ success: true, data: filtered });
  } catch (error) {
    console.error('Error fetching board sprints:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch sprints',
    });
  }
});

/**
 * GET /api/issues/by-sprints?sprints=NGK Sprint 224,NGK Sprint 225
 * Fetch issues for one or more specific sprints, applying the same
 * type/subtask/stale-done exclusions as the default sprint filter.
 */
router.get('/issues/by-sprints', async (req, res) => {
  try {
    const { sprints } = req.query;
    const sprintNames = (sprints || '').split(',').map(s => s.trim()).filter(Boolean);

    if (sprintNames.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'At least one sprint name is required (sprints=Name1,Name2)',
      });
    }

    const projectKey = process.env.JIRA_PROJECT_KEY || 'NGK';
    const quotedSprints = sprintNames.map(n => `"${n.replace(/"/g, '\\"')}"`).join(', ');
    const jql = `project = ${projectKey} `
      + `and sprint in (${quotedSprints}) `
      + `and type NOT IN (Release, "Test Case Execution-Smoke/Sanity/Regression", Epic) `
      + `and issuetype not in subTaskIssueTypes() `
      + `and not (statusCategory = Done and statusCategoryChangedDate <= -15d) `
      + `ORDER BY created ASC, updated DESC`;

    const issues = await getIssuesByJQL(jql);
    res.json({ success: true, data: issues, source: 'jira' });
  } catch (error) {
    console.error('Error fetching issues by sprints:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch issues by sprints',
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
