// Quick Analysis persistence (SQLite, see db/database.js). Plain synchronous functions over getDb().
import { getDb } from '../../db/database.js';

const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

// ---- tickets seen at earlier runs
export const knownKeys = () => new Set(getDb().prepare('SELECT issue_key FROM qa_known').all().map((r) => r.issue_key));
export const addKnown = (keys, at) => {
  const ins = getDb().prepare('INSERT OR IGNORE INTO qa_known (issue_key, first_seen_at) VALUES (?, ?)');
  getDb().transaction((list) => list.forEach((k) => ins.run(k, at)))(keys);
};

// ---- tickets that were new, and whether they were marked read
export const addNew = (keys, at) => {
  const ins = getDb().prepare('INSERT OR IGNORE INTO qa_new (issue_key, first_seen_at) VALUES (?, ?)');
  getDb().transaction((list) => list.forEach((k) => ins.run(k, at)))(keys);
};
export const newRows = () => getDb().prepare('SELECT issue_key AS key, first_seen_at AS firstSeenAt, read_at AS readAt FROM qa_new ORDER BY first_seen_at DESC, issue_key').all();
export const setRead = (key, read, at) => getDb().prepare('UPDATE qa_new SET read_at = ? WHERE issue_key = ?').run(read ? at : null, key).changes > 0;

// ---- the model's analysis of a ticket, valid until the ticket is edited
export const getAnalysis = (key, updated) => {
  const r = getDb().prepare('SELECT json FROM qa_analysis WHERE issue_key = ? AND updated = ?').get(key, String(updated || ''));
  return r ? parse(r.json) : null;
};
export const putAnalysis = (key, updated, obj, at) =>
  getDb().prepare('INSERT OR REPLACE INTO qa_analysis (issue_key, updated, json, created_at) VALUES (?, ?, ?, ?)').run(key, String(updated || ''), JSON.stringify(obj), at);

// ---- run state and the last report
const ensureState = () => getDb().prepare('INSERT OR IGNORE INTO qa_state (id) VALUES (1)').run();

export const getState = () => {
  ensureState();
  const r = getDb().prepare('SELECT * FROM qa_state WHERE id = 1').get();
  return {
    lastRunAt: r.last_run_at, lastStatus: r.last_status, lastError: r.last_error, lastDurationMs: r.last_duration_ms,
    report: parse(r.report_json), viewedAt: r.viewed_at, groupHash: r.group_hash, groups: parse(r.group_json),
  };
};

/** A run has begun: the interval to the next automatic run is counted from here. */
export const startRun = (at) => {
  ensureState();
  getDb().prepare("UPDATE qa_state SET last_run_at = ?, last_status = 'running', last_error = NULL WHERE id = 1").run(at);
};

export const finishRun = ({ status, error = null, durationMs, report = undefined, groupHash = undefined, groups = undefined }) => {
  ensureState();
  const db = getDb();
  db.prepare('UPDATE qa_state SET last_status = ?, last_error = ?, last_duration_ms = ? WHERE id = 1').run(status, error, durationMs);
  if (report !== undefined) db.prepare('UPDATE qa_state SET report_json = ? WHERE id = 1').run(JSON.stringify(report));
  if (groupHash !== undefined) db.prepare('UPDATE qa_state SET group_hash = ?, group_json = ? WHERE id = 1').run(groupHash, JSON.stringify(groups));
};

export const markViewed = (at) => { ensureState(); getDb().prepare('UPDATE qa_state SET viewed_at = ? WHERE id = 1').run(at); };
