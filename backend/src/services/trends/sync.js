// Reads the NGK sprint tickets from Jira into the local copy. Only when asked (the Refresh button): there is no background sync.
// One read covers the tickets updated in the last WINDOW_DAYS days, which is more than the 6 months the page can show (a ticket that
// entered a sprint, was created or was resolved in those months was updated in them), and the copy is replaced by what Jira returned.
import { search, PROJECT, FIELDS as JIRA_FIELDS } from '../../../delivery/lib/jira.mjs';
import * as store from './store.js';

const SPRINT_FIELD = JIRA_FIELDS.sprint;
export const WINDOW_DAYS = 200;
export const FIELDS = ['issuetype', 'created', 'resolutiondate', 'status', 'updated', 'assignee', JIRA_FIELDS.client, SPRINT_FIELD];

/** A Jira search row as the table keeps it. */
export const toRow = (issue) => {
  const f = issue.fields || {};
  const starts = (Array.isArray(f[SPRINT_FIELD]) ? f[SPRINT_FIELD] : []).map((s) => s?.startDate).filter((d) => d && !Number.isNaN(Date.parse(d))).sort((a, b) => Date.parse(a) - Date.parse(b));
  return {
    key: issue.key, type: f.issuetype?.name || 'Unknown', created: f.created || null, resolved: f.resolutiondate || null,
    statusCategory: f.status?.statusCategory?.name || '', firstSprintStart: starts[0] || null, updated: f.updated || null,
    assignee: f.assignee?.displayName || null,
    clients: [...new Set((Array.isArray(f[JIRA_FIELDS.client]) ? f[JIRA_FIELDS.client] : []).map((c) => c?.value).filter(Boolean))],
  };
};

export const buildJql = ({ project = PROJECT, days = WINDOW_DAYS } = {}) => `project = ${project} AND sprint is not EMPTY AND updated >= -${days}d ORDER BY created ASC`;

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
