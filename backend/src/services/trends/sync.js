// Reads the NGK sprint tickets from Jira into the local copy. Only when asked (the Refresh button): there is no background sync.
// The ticket filter is the Tasks page's (NGK Sprint, without Release, Test Case Execution, Epic and sub-tasks) but for tickets that are DONE
// (Jira's Done category: passed QA or later) and were resolved in the last 6 months, the current month included. Jira filters that exactly, so
// the read is the tickets the page counts and nothing else. Past sprints count too, not only open ones. The copy is replaced by what Jira returned.
import { search, PROJECT, FIELDS as JIRA_FIELDS } from '../../../delivery/lib/jira.mjs';
import * as store from './store.js';

const SPRINT_FIELD = JIRA_FIELDS.sprint;
export const FIELDS = ['issuetype', 'created', 'resolutiondate', 'status', 'updated', 'assignee', JIRA_FIELDS.client, SPRINT_FIELD, 'summary', 'components', 'labels', 'priority'];

/** A Jira search row as the table keeps it. */
export const toRow = (issue) => {
  const f = issue.fields || {};
  const starts = (Array.isArray(f[SPRINT_FIELD]) ? f[SPRINT_FIELD] : []).map((s) => s?.startDate).filter((d) => d && !Number.isNaN(Date.parse(d))).sort((a, b) => Date.parse(a) - Date.parse(b));
  return {
    key: issue.key, type: f.issuetype?.name || 'Unknown', created: f.created || null, resolved: f.resolutiondate || null,
    statusCategory: f.status?.statusCategory?.name || '', firstSprintStart: starts[0] || null, updated: f.updated || null,
    assignee: f.assignee?.displayName || null,
    summary: String(f.summary || '').slice(0, 300), component: f.components?.[0]?.name || null,
    components: [...new Set((Array.isArray(f.components) ? f.components : []).map((c) => c?.name).filter(Boolean))],
    labels: (Array.isArray(f.labels) ? f.labels : []).filter((l) => typeof l === 'string').slice(0, 20), priority: f.priority?.name || null,
    clients: [...new Set((Array.isArray(f[JIRA_FIELDS.client]) ? f[JIRA_FIELDS.client] : []).map((c) => c?.value).filter(Boolean))],
  };
};

export const EXCLUDED_TYPES = ['Release', 'Test Case Execution-Smoke/Sanity/Regression', 'Epic'];

/**
 * `months` back from the current one: 6 shows the current month and the five before it. The read goes one month further back (MARGIN_MONTHS)
 * because Jira works out startOfMonth in its own account's timezone and the page counts months in this machine's: with the extra month the
 * first month's edge can never be clipped, and the page itself cuts the months it shows (the extra tickets are counted as "before this range").
 */
export const MARGIN_MONTHS = 1;
export const buildJql = ({ project = PROJECT, months = 6 } = {}) =>
  `project = ${project} AND sprint in ("NGK Sprint") AND type NOT IN (${EXCLUDED_TYPES.map((t) => (/^\w+$/.test(t) ? t : `"${t}"`)).join(', ')}) `
  + `AND issuetype not in subTaskIssueTypes() AND statusCategory = Done AND resolved >= startOfMonth(-${months - 1 + MARGIN_MONTHS}) ORDER BY created ASC`;

export const runTrendsSync = async ({ searchJira = search, now = () => new Date() } = {}) => {
  const started = now();
  const t0 = Date.now();
  store.startSync();
  try {
    const rows = (await searchJira(buildJql(), FIELDS)).map(toRow);
    store.upsert(rows);
    store.deleteMissing(new Set(rows.map((r) => r.key)));
    store.finishSync({ status: 'ok', durationMs: Date.now() - t0, at: started.toISOString(), full: true, count: store.count() });
    return { ok: true, read: rows.length, total: store.count() };
  } catch (e) {
    const error = String(e?.message || e).split('\n')[0].slice(0, 300);
    store.finishSync({ status: 'failed', error, durationMs: Date.now() - t0 });
    return { ok: false, error };
  }
};
