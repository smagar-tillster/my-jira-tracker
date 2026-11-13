// Trends persistence (SQLite, see db/database.js): the local copy of the sprint tickets and the sync state.
import { getDb } from '../../db/database.js';

export const allRows = () => getDb().prepare(
  'SELECT issue_key AS key, type, created, resolved, status_category AS statusCategory, first_sprint_start AS firstSprintStart FROM trend_tickets',
).all();

export const count = () => getDb().prepare('SELECT COUNT(*) AS n FROM trend_tickets').get().n;

export const upsert = (rows) => {
  const ins = getDb().prepare(`INSERT OR REPLACE INTO trend_tickets (issue_key, type, created, resolved, status_category, first_sprint_start, updated)
    VALUES (@key, @type, @created, @resolved, @statusCategory, @firstSprintStart, @updated)`);
  getDb().transaction((list) => list.forEach((r) => ins.run(r)))(rows);
};

/** Removes tickets that are no longer in the result of a full sync (moved out of every sprint, deleted, moved to another project). */
export const deleteMissing = (keys) => {
  const db = getDb();
  const have = db.prepare('SELECT issue_key AS key FROM trend_tickets').all().map((r) => r.key);
  const del = db.prepare('DELETE FROM trend_tickets WHERE issue_key = ?');
  db.transaction((list) => list.forEach((k) => del.run(k)))(have.filter((k) => !keys.has(k)));
};

const ensure = () => getDb().prepare('INSERT OR IGNORE INTO trend_sync (id) VALUES (1)').run();

export const getSync = () => {
  ensure();
  const r = getDb().prepare('SELECT * FROM trend_sync WHERE id = 1').get();
  return { lastSyncAt: r.last_sync_at, lastFullAt: r.last_full_at, lastStatus: r.last_status, lastError: r.last_error, lastDurationMs: r.last_duration_ms, lastCount: r.last_count };
};

export const startSync = () => { ensure(); getDb().prepare("UPDATE trend_sync SET last_status = 'running', last_error = NULL WHERE id = 1").run(); };

/** `at` is when the run began: the next incremental sync asks Jira for what changed since then. A failed run leaves the marks alone. */
export const finishSync = ({ status, error = null, durationMs, at = null, full = false, count = null }) => {
  ensure();
  const db = getDb();
  db.prepare('UPDATE trend_sync SET last_status = ?, last_error = ?, last_duration_ms = ? WHERE id = 1').run(status, error, durationMs);
  if (status === 'ok') {
    db.prepare('UPDATE trend_sync SET last_sync_at = ?, last_count = ? WHERE id = 1').run(at, count);
    if (full) db.prepare('UPDATE trend_sync SET last_full_at = ? WHERE id = 1').run(at);
  }
};
