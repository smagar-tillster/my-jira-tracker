// Keeps the local copy of the NGK sprint tickets in step with Jira. The first run reads everything; later runs read only what changed
// since the last one (with a margin), and a full read repeats weekly so tickets that left every sprint are dropped.
import { search, PROJECT } from '../../../delivery/lib/jira.mjs';
import * as store from './store.js';

const SPRINT_FIELD = 'customfield_10007';
export const FIELDS = ['issuetype', 'created', 'resolutiondate', 'status', 'updated', SPRINT_FIELD];
export const FULL_EVERY_MS = 7 * 86400000;
const OVERLAP_MS = 2 * 3600000;

/** A Jira search row as the table keeps it. */
export const toRow = (issue) => {
  const f = issue.fields || {};
  const starts = (Array.isArray(f[SPRINT_FIELD]) ? f[SPRINT_FIELD] : []).map((s) => s?.startDate).filter((d) => d && !Number.isNaN(Date.parse(d))).sort((a, b) => Date.parse(a) - Date.parse(b));
  return {
    key: issue.key, type: f.issuetype?.name || 'Unknown', created: f.created || null, resolved: f.resolutiondate || null,
    statusCategory: f.status?.statusCategory?.name || '', firstSprintStart: starts[0] || null, updated: f.updated || null,
  };
};

const jqlDate = (ms) => {
  const d = new Date(ms); const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** Whether the next sync must read everything: never synced, or the last full read is over a week old. */
export const needsFull = (sync, now = Date.now()) => !sync.lastSyncAt || !sync.lastFullAt || now - Date.parse(sync.lastFullAt) >= FULL_EVERY_MS;

export const buildJql = ({ full, lastSyncAt, project = PROJECT }) =>
  `project = ${project} AND sprint is not EMPTY${full ? '' : ` AND updated >= "${jqlDate(Date.parse(lastSyncAt) - OVERLAP_MS)}"`} ORDER BY created ASC`;

export const runTrendsSync = async ({ searchJira = search, force = 'auto', now = () => new Date() } = {}) => {
  const started = now();
  const t0 = Date.now();
  const before = store.getSync();
  const full = force === 'full' || (force === 'auto' && needsFull(before, started.getTime()));
  store.startSync();
  try {
    const issues = await searchJira(buildJql({ full, lastSyncAt: before.lastSyncAt }), FIELDS);
    const rows = issues.map(toRow);
    store.upsert(rows);
    if (full) store.deleteMissing(new Set(rows.map((r) => r.key)));
    store.finishSync({ status: 'ok', durationMs: Date.now() - t0, at: started.toISOString(), full, count: store.count() });
    return { ok: true, full, read: rows.length, total: store.count() };
  } catch (e) {
    const error = String(e?.message || e).split('\n')[0].slice(0, 300);
    store.finishSync({ status: 'failed', error, durationMs: Date.now() - t0 });
    return { ok: false, full, error };
  }
};
