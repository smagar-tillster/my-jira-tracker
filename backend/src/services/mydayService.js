import { getDb } from '../db/database.js';

export const setIssueMyDay = (issueKey, myDay) => {
  const db = getDb();
  if (myDay) {
    db.prepare('INSERT OR REPLACE INTO issue_myday (issue_key) VALUES (?)').run(issueKey);
  } else {
    db.prepare('DELETE FROM issue_myday WHERE issue_key = ?').run(issueKey);
  }
  return true;
};

export const getAllMyDayFlags = () => {
  const rows = getDb().prepare('SELECT issue_key FROM issue_myday').all();
  const result = {};
  for (const { issue_key } of rows) result[issue_key] = true;
  return result;
};
