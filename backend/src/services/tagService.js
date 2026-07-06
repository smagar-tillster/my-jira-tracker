import { getDb } from '../db/database.js';

export const getIssueTags = (issueKey) => {
  const rows = getDb().prepare('SELECT tag FROM issue_tags WHERE issue_key = ?').all(issueKey);
  return rows.map(r => r.tag);
};

export const getAllTags = () => {
  const rows = getDb().prepare('SELECT issue_key, tag FROM issue_tags').all();
  const result = {};
  for (const { issue_key, tag } of rows) {
    if (!result[issue_key]) result[issue_key] = [];
    result[issue_key].push(tag);
  }
  return result;
};

export const setIssueTags = (issueKey, tags) => {
  const db = getDb();
  const del = db.prepare('DELETE FROM issue_tags WHERE issue_key = ?');
  const ins = db.prepare('INSERT OR IGNORE INTO issue_tags (issue_key, tag) VALUES (?, ?)');
  db.transaction(() => {
    del.run(issueKey);
    for (const tag of tags) { if (tag) ins.run(issueKey, tag); }
  })();
  return true;
};

export const addIssueTag = (issueKey, tag) => {
  getDb().prepare('INSERT OR IGNORE INTO issue_tags (issue_key, tag) VALUES (?, ?)').run(issueKey, tag);
  return true;
};

export const removeIssueTag = (issueKey, tag) => {
  getDb().prepare('DELETE FROM issue_tags WHERE issue_key = ? AND tag = ?').run(issueKey, tag);
  return true;
};

export const getAllUniqueTags = () => {
  return getDb().prepare('SELECT DISTINCT tag FROM issue_tags ORDER BY tag').all().map(r => r.tag);
};
