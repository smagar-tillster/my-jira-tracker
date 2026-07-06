import { getDb } from '../db/database.js';

export const getIssueImportant = (issueKey) => {
  const row = getDb().prepare('SELECT important FROM issue_important WHERE issue_key = ?').get(issueKey);
  return row ? row.important === 1 : false;
};

export const setIssueImportant = (issueKey, important) => {
  const db = getDb();
  if (important) {
    db.prepare('INSERT OR REPLACE INTO issue_important (issue_key, important) VALUES (?, 1)').run(issueKey);
  } else {
    db.prepare('DELETE FROM issue_important WHERE issue_key = ?').run(issueKey);
  }
  return true;
};

export const getAllImportantFlags = () => {
  const rows = getDb().prepare('SELECT issue_key FROM issue_important WHERE important = 1').all();
  const result = {};
  for (const { issue_key } of rows) result[issue_key] = true;
  return result;
};
