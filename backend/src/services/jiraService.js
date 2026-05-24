import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const JIRA_HOST = process.env.JIRA_HOST;
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;

// Create axios instance with Bearer token (better for Cloud API)
const jiraClient = axios.create({
  baseURL: `${JIRA_HOST}/rest/api/3`,
  headers: {
    'Authorization': `Basic ${Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64')}`,
    'Content-Type': 'application/json',
  },
});

/**
 * Extracts release date from Fix Version string
 * Expected format: YYYY.MM.DD_XXX or similar date patterns
 * @param {string} fixVersion - The fix version string
 * @returns {string} - Extracted date or 'NA'
 */
export const extractReleaseDate = (fixVersion) => {
  if (!fixVersion) return 'NA';
  
  // Try to match YYYY.MM.DD format
  const dateMatch = fixVersion.match(/(\d{4})\.(\d{2})\.(\d{2})/);
  if (dateMatch) {
    return dateMatch[0]; // Returns YYYY.MM.DD
  }
  
  // Try ISO date format
  const isoMatch = fixVersion.match(/(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) {
    return isoMatch[0];
  }
  
  return 'NA';
};

/**
 * Fetch issues from Jira filter
 * @param {string} filterId - Jira filter ID
 * @returns {Promise<Array>} - Array of issues
 */
/**
 * Fetch issues from Jira filter
 * @param {string} filterId - Jira filter ID
 * @param {number} maxResults - Max results to return (default 50, use -1 for all)
 * @returns {Promise<Array>} - Array of issues
 */
export const getIssuesFromFilter = async (filterId) => {
  try {
    // Use JQL query with filter ID and request all needed fields
    const jql = `filter = ${filterId}`;
    console.log('Requesting fields:', [
      'key',
      'summary',
      'status',
      'assignee',
      'priority',
      'duedate',
      'fixVersions',
      'created',
      'updated',
      'description',
      'issuetype',
      'labels',
      'components',
      'sprint',
    ]);
    return getIssuesByJQL(jql);
  } catch (error) {
    console.error('Error fetching filter:', error.message);
    throw error;
  }
};

/**
 * Maps raw Jira issues to standardized format
 * @param {Array} jiraIssues - Raw issues from Jira API
 * @returns {Array} - Mapped issues
 */
const extractDescription = (description) => {
  if (!description) return '';
  
  // If it's already a string, return it
  if (typeof description === 'string') {
    return description;
  }
  
  // If it's a rich text object with content property
  if (description && typeof description === 'object') {
    if (Array.isArray(description.content)) {
      // Extract text from content array
      return description.content
        .map((block) => {
          if (block.content && Array.isArray(block.content)) {
            return block.content
              .map((item) => item.text || '')
              .join('');
          }
          return '';
        })
        .join(' ');
    }
  }
  
  return '';
};

const mapIssues = (jiraIssues) => {
  return jiraIssues.map((issue, index) => {
    // Handle both API v2 and v3 response formats
    const fields = issue.fields || issue;
    
    // Log first issue for debugging
    if (index === 0) {
      console.log('First issue fields available:', Object.keys(fields).join(', '));
    }
    
    const fixVersions = fields.fixVersions || [];
    const releaseDate = fixVersions.length > 0 
      ? extractReleaseDate(fixVersions[0].name)
      : 'NA';

    // Extract sprint information - get the latest sprint by date from customfield_10007
    let sprint = null;
    let sprintStartDate = null;
    let sprintEndDate = null;
    const sprintField = fields.customfield_10007;
    if (Array.isArray(sprintField) && sprintField.length > 0) {
      // Sort sprints by startDate (or endDate if startDate not available) and get the most recent
      const sortedSprints = [...sprintField].sort((a, b) => {
        const dateA = new Date(a.startDate || a.endDate || 0);
        const dateB = new Date(b.startDate || b.endDate || 0);
        return dateB - dateA; // Descending order (most recent first)
      });
      const latestSprint = sortedSprints[0];
      sprint = latestSprint?.name || null;
      sprintStartDate = latestSprint?.startDate || null;
      sprintEndDate = latestSprint?.endDate || null;
    }

    // Extract Client field from customfield_16047 (array of objects with value property)
    let client = null;
    const clientField = fields.customfield_16047;
    if (Array.isArray(clientField) && clientField.length > 0) {
      // Get all client values and join with comma
      client = clientField.map(c => c.value).filter(Boolean).join(', ');
    }

    // Extract parent summary if it exists
    const parentSummary = fields.parent?.fields?.summary || null;

    // Extract time tracking (keep in seconds)
    // Use aggregate fields (Σ) which include subtasks, fallback to non-aggregate
    const timeSpentSeconds = fields.aggregatetimespent || fields.timespent || 0;
    const originalEstimateSeconds = fields.aggregatetimeoriginalestimate || fields.timeoriginalestimate || 0;

    // Log time tracking for first issue to verify
    if (index === 0 && (timeSpentSeconds > 0 || originalEstimateSeconds > 0)) {
      console.log(`Time tracking for ${issue.key}:`, {
        aggregatetimespent: fields.aggregatetimespent,
        timespent: fields.timespent,
        aggregatetimeoriginalestimate: fields.aggregatetimeoriginalestimate,
        timeoriginalestimate: fields.timeoriginalestimate,
        computed: { timeSpentSeconds, originalEstimateSeconds }
      });
    }

    // Extract defect-related custom fields
    // Try customfield_16024 first (Inherited from master), then customfield_17343, fallback to "Other"
    const defectCausedBy = fields.customfield_16024?.value || fields.customfield_17343?.value || 'Other';
    const qaNotes = fields.customfield_17249 || null;
    const statusCategoryChangeDate = fields.statuscategorychangedate || null;
    
    // Extract Planned UAT Date
    const plannedUatDate = fields.customfield_16050 || null;

    return {
      id: issue.id,
      key: issue.key,
      summary: fields.summary,
      status: fields.status?.name || 'Unknown',
      statusCategory: fields.status?.statusCategory?.name || 'Unknown',
      assignee: fields.assignee?.displayName || 'Unassigned',
      assigneeAvatar: fields.assignee?.avatarUrls?.['48x48'] || null,
      priority: 'N/A',
      dueDate: fields.duedate || null,
      fixVersions: fixVersions.map((v) => v.name),
      releaseDate: releaseDate,
      created: fields.created,
      updated: fields.updated,
      issueType: fields.issuetype?.name || 'Unknown',
      labels: fields.labels || [],
      components: (fields.components || []).map((c) => c.name),
      description: typeof fields.description === 'string' ? fields.description : extractDescription(fields.description),
      url: `${JIRA_HOST}/browse/${issue.key}`,
      sprint: sprint,
      sprintStartDate: sprintStartDate,
      sprintEndDate: sprintEndDate,
      client: client,
      parentSummary: parentSummary,
      timeSpent: timeSpentSeconds,
      originalEstimate: originalEstimateSeconds,
      defectCausedBy: defectCausedBy,
      qaNotes: qaNotes,
      statusCategoryChangeDate: statusCategoryChangeDate,
      plannedUatDate: plannedUatDate,
    };
  });
};

/**
 * Fetch issues using JQL
 * @param {string} jql - JQL query string
 * @param {number} maxResults - Max results to return (default 50, use -1 for all)
 * @returns {Promise<Array>} - Array of issues
 */
export const getIssuesByJQL = async (jql) => {
  try {
    console.log('Fetching issues with JQL:', jql);
    
    const fieldsArray = [
      'key',
      'summary',
      'status',
      'assignee',
      'duedate',
      'fixVersions',
      'created',
      'updated',
      'description',
      'issuetype',
      'labels',
      'components',
      'customfield_10007', // Sprint
      'customfield_16047', // Client
      'parent', // Parent issue for subtasks
      'timespent', // Time spent (logged work)
      'timeoriginalestimate', // Original estimate
      'aggregatetimespent', // Total time spent including subtasks
      'aggregatetimeoriginalestimate', // Total original estimate including subtasks
      'customfield_16024', // Defect Caused By (primary)
      'customfield_17343', // Defect Caused By (secondary)
      'customfield_17249', // QA Notes
      'statuscategorychangedate', // Status Category Change Date
      'customfield_16050', // Planned UAT Date
    ];
    
    // Jira API - /search/jql uses nextPageToken for pagination
    const allIssues = [];
    let nextPageToken = null;
    const maxResults = 100;
    
    while (true) {
      console.log(`Fetching page (maxResults=${maxResults})${nextPageToken ? `, nextPageToken=${nextPageToken.substring(0, 20)}...` : ''}`);
      
      const params = {
        jql,
        maxResults,
        fields: fieldsArray.join(','),
      };
      
      // Add nextPageToken only if we have one
      if (nextPageToken) {
        params.nextPageToken = nextPageToken;
      }
      
      const response = await jiraClient.get('/search/jql', { params });

      const { issues, isLast } = response.data;
      nextPageToken = response.data.nextPageToken;
      
      if (!issues || issues.length === 0) {
        console.log('No issues returned - done');
        break;
      }
      
      console.log(`✓ Got ${issues.length} issues`);
      allIssues.push(...issues);
      
      // If isLast is true or no nextPageToken, we're done
      if (isLast || !nextPageToken) {
        console.log(`Done fetching - isLast: ${isLast}`);
        break;
      }
    }
    
    console.log(`✓ Total fetched: ${allIssues.length} issues`);
    
    return mapIssues(allIssues);
  } catch (error) {
    console.error('Error fetching issues by JQL:', error.message);
    console.error('Status:', error.response?.status);
    console.error('Data:', error.response?.data);
    throw error;
  }
};

/**
 * Get mock issues for development
 * @returns {Array} - Array of mock issues
 */
export const getMockIssues = () => {
  return [
    {
      id: '1',
      key: 'PROJ-1001',
      summary: 'Implement user authentication system',
      status: 'In Progress',
      statusCategory: 'inprogress',
      assignee: 'John Doe',
      assigneeAvatar: null,
      priority: 'High',
      dueDate: '2025-12-20',
      fixVersions: ['2025.12.15_Release'],
      releaseDate: '2025.12.15',
      created: '2025-11-01T10:00:00.000Z',
      updated: '2025-12-10T15:30:00.000Z',
      issueType: 'Story',
      labels: ['backend', 'security'],
      components: ['Auth Service'],
      description: 'Implement a secure user authentication system with JWT tokens',
      url: 'https://example.atlassian.net/browse/PROJ-1001',
    },
    {
      id: '2',
      key: 'PROJ-1002',
      summary: 'Fix login page responsiveness',
      status: 'To Do',
      statusCategory: 'todo',
      assignee: 'Jane Smith',
      assigneeAvatar: null,
      priority: 'Medium',
      dueDate: '2025-12-25',
      fixVersions: ['2025.12.15_Release'],
      releaseDate: '2025.12.15',
      created: '2025-11-05T09:15:00.000Z',
      updated: '2025-12-08T11:45:00.000Z',
      issueType: 'Bug',
      labels: ['frontend', 'ui'],
      components: ['Web UI'],
      description: 'Login page is not responsive on mobile devices',
      url: 'https://example.atlassian.net/browse/PROJ-1002',
    },
    {
      id: '3',
      key: 'PROJ-1003',
      summary: 'Database performance optimization',
      status: 'In Progress',
      statusCategory: 'inprogress',
      assignee: 'Mike Johnson',
      assigneeAvatar: null,
      priority: 'High',
      dueDate: '2025-12-30',
      fixVersions: ['2026.01.15_Release'],
      releaseDate: '2026.01.15',
      created: '2025-10-20T08:00:00.000Z',
      updated: '2025-12-12T14:20:00.000Z',
      issueType: 'Task',
      labels: ['performance', 'database'],
      components: ['Backend', 'Database'],
      description: 'Optimize database queries for better performance',
      url: 'https://example.atlassian.net/browse/PROJ-1003',
    },
    {
      id: '4',
      key: 'PROJ-1004',
      summary: 'Add search functionality to dashboard',
      status: 'Done',
      statusCategory: 'done',
      assignee: 'Sarah Wilson',
      assigneeAvatar: null,
      priority: 'Medium',
      dueDate: '2025-12-15',
      fixVersions: ['2025.12.15_Release'],
      releaseDate: '2025.12.15',
      created: '2025-09-15T10:30:00.000Z',
      updated: '2025-12-10T16:50:00.000Z',
      issueType: 'Story',
      labels: ['frontend', 'search'],
      components: ['Web UI', 'Search Service'],
      description: 'Add global search functionality to main dashboard',
      url: 'https://example.atlassian.net/browse/PROJ-1004',
    },
    {
      id: '5',
      key: 'PROJ-1005',
      summary: 'Create API documentation',
      status: 'In Progress',
      statusCategory: 'inprogress',
      assignee: 'Tom Brown',
      assigneeAvatar: null,
      priority: 'Low',
      dueDate: null,
      fixVersions: [],
      releaseDate: 'NA',
      created: '2025-11-20T13:00:00.000Z',
      updated: '2025-12-11T10:15:00.000Z',
      issueType: 'Task',
      labels: ['documentation'],
      components: ['Backend'],
      description: 'Document all REST API endpoints',
      url: 'https://example.atlassian.net/browse/PROJ-1005',
    },
    {
      id: '6',
      key: 'PROJ-1006',
      summary: 'Setup CI/CD pipeline',
      status: 'To Do',
      statusCategory: 'todo',
      assignee: 'Lisa Anderson',
      assigneeAvatar: null,
      priority: 'High',
      dueDate: '2025-12-22',
      fixVersions: ['2025.12.15_Release'],
      releaseDate: '2025.12.15',
      created: '2025-11-10T11:45:00.000Z',
      updated: '2025-12-09T09:30:00.000Z',
      issueType: 'Story',
      labels: ['devops', 'ci-cd'],
      components: ['Infrastructure'],
      description: 'Setup automated CI/CD pipeline using GitHub Actions',
      url: 'https://example.atlassian.net/browse/PROJ-1006',
    },
    {
      id: '7',
      key: 'PROJ-1007',
      summary: 'Handle file upload edge cases',
      status: 'In Review',
      statusCategory: 'inprogress',
      assignee: 'David Lee',
      assigneeAvatar: null,
      priority: 'Medium',
      dueDate: '2025-12-18',
      fixVersions: ['2025.12.15_Release'],
      releaseDate: '2025.12.15',
      created: '2025-11-18T14:20:00.000Z',
      updated: '2025-12-11T15:45:00.000Z',
      issueType: 'Bug',
      labels: ['upload', 'edge-case'],
      components: ['File Service'],
      description: 'Handle edge cases in file upload like large files and timeouts',
      url: 'https://example.atlassian.net/browse/PROJ-1007',
    },
    {
      id: '8',
      key: 'PROJ-1008',
      summary: 'Implement dark mode',
      status: 'To Do',
      statusCategory: 'todo',
      assignee: 'Emily White',
      assigneeAvatar: null,
      priority: 'Low',
      dueDate: null,
      fixVersions: ['2026.01.15_Release'],
      releaseDate: '2026.01.15',
      created: '2025-12-01T12:00:00.000Z',
      updated: '2025-12-12T10:00:00.000Z',
      issueType: 'Story',
      labels: ['ui', 'theme'],
      components: ['Web UI'],
      description: 'Add dark mode theme support to the application',
      url: 'https://example.atlassian.net/browse/PROJ-1008',
    },
  ];
};
