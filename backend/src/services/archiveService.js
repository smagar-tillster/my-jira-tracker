import { getDb } from '../db/database.js';
import { getIssuesFromFilter } from './jiraService.js';
import { getAllTags } from './tagService.js';
import { getAllImportantFlags } from './importantService.js';

const ARCHIVE_FILTER_ID = () => process.env.JIRA_FILTER_ID_ARCHIVE || '56341';
const CACHE_TTL_MS = 23 * 60 * 60 * 1000; // 23 hours — refresh daily

// Track in-progress background refresh so we don't run two at once
let _refreshing = false;
let _refreshStartedAt = null;

export function isRefreshing() { return _refreshing; }
export function refreshStartedAt() { return _refreshStartedAt; }

/**
 * Read the cached archive from SQLite. Returns null if no cache exists.
 */
export function getCachedArchive() {
  const db = getDb();
  const row = db.prepare('SELECT data_json, fetched_at, issue_count FROM archive_cache WHERE id = 1').get();
  if (!row) return null;
  return {
    issues: JSON.parse(row.data_json),
    fetchedAt: row.fetched_at,
    issueCount: row.issue_count,
  };
}

/**
 * Fetch archive from Jira, merge tags/important flags, store in SQLite.
 */
export async function refreshArchiveCache() {
  if (_refreshing) {
    console.log('[archive] Refresh already in progress — skipping duplicate call');
    return null;
  }
  const filterId = ARCHIVE_FILTER_ID();
  if (!filterId) {
    console.warn('[archive] No JIRA_FILTER_ID_ARCHIVE configured — skipping refresh');
    return null;
  }

  console.log(`[archive] Fetching archive from filter ${filterId}…`);
  _refreshing = true;
  _refreshStartedAt = new Date().toISOString();
  try {
    const [data, tags, importantFlags] = await Promise.all([
      getIssuesFromFilter(filterId),
      getAllTags(),
      getAllImportantFlags(),
    ]);

    const issues = data.map(issue => ({
      ...issue,
      tags: tags[issue.key] || [],
      important: importantFlags[issue.key] || false,
      source: 'archive',
      searchText: [
        issue.key,
        issue.summary,
        issue.assignee,
        issue.client || '',
        (issue.labels || []).join(' '),
        (issue.components || []).join(' '),
      ].join(' ').toLowerCase(),
    }));

    const fetchedAt = new Date().toISOString();
    const db = getDb();
    db.prepare(`
      INSERT INTO archive_cache (id, data_json, fetched_at, issue_count)
      VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        data_json   = excluded.data_json,
        fetched_at  = excluded.fetched_at,
        issue_count = excluded.issue_count
    `).run(JSON.stringify(issues), fetchedAt, issues.length);

    console.log(`[archive] Cache updated: ${issues.length} issues at ${fetchedAt}`);
    return { issues, fetchedAt, issueCount: issues.length };
  } catch (err) {
    console.error('[archive] refreshArchiveCache failed:', err.message);
    throw err;
  } finally {
    _refreshing = false;
  }
}

/**
 * Returns true if the cache is missing or older than CACHE_TTL_MS.
 */
export function isCacheStale() {
  const cached = getCachedArchive();
  if (!cached) return true;
  return Date.now() - new Date(cached.fetchedAt).getTime() > CACHE_TTL_MS;
}
