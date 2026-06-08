import { randomUUID } from 'crypto';
import { getDb } from '../db/database.js';

// type: 'auto' | 'manual'
// category: 'feature' | 'bug' | 'process' | 'other'
// impact: 'high' | 'medium' | 'low'

export const getAllAccomplishments = ({ sprint, category, type } = {}) => {
  const db         = getDb();
  const conditions = [];
  const params     = [];

  if (sprint)   { conditions.push('sprint = ?');   params.push(sprint); }
  if (category) { conditions.push('category = ?'); params.push(category); }
  if (type)     { conditions.push('type = ?');     params.push(type); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return db
    .prepare(`SELECT * FROM accomplishments ${where} ORDER BY date DESC, created_at DESC`)
    .all(...params);
};

export const getSprintList = () => {
  return getDb()
    .prepare('SELECT DISTINCT sprint FROM accomplishments WHERE sprint IS NOT NULL ORDER BY sprint DESC')
    .all()
    .map(r => r.sprint);
};

export const createAccomplishment = (entry) => {
  const db  = getDb();
  const id  = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO accomplishments (id, type, title, detail, issue_key, sprint, date, category, impact, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    entry.type      || 'manual',
    entry.title,
    entry.detail    || null,
    entry.issueKey  || null,
    entry.sprint    || null,
    entry.date      || now.slice(0, 10),
    entry.category  || 'other',
    entry.impact    || 'medium',
    now,
  );
  return db.prepare('SELECT * FROM accomplishments WHERE id = ?').get(id);
};

export const updateAccomplishment = (id, updates) => {
  const db     = getDb();
  const fields = [];
  const values = [];

  if (updates.title    !== undefined) { fields.push('title = ?');    values.push(updates.title); }
  if (updates.detail   !== undefined) { fields.push('detail = ?');   values.push(updates.detail); }
  if (updates.sprint   !== undefined) { fields.push('sprint = ?');   values.push(updates.sprint); }
  if (updates.date     !== undefined) { fields.push('date = ?');     values.push(updates.date); }
  if (updates.category !== undefined) { fields.push('category = ?'); values.push(updates.category); }
  if (updates.impact   !== undefined) { fields.push('impact = ?');   values.push(updates.impact); }

  if (fields.length === 0) return db.prepare('SELECT * FROM accomplishments WHERE id = ?').get(id);

  values.push(id);
  db.prepare(`UPDATE accomplishments SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return db.prepare('SELECT * FROM accomplishments WHERE id = ?').get(id);
};

export const deleteAccomplishment = (id) => {
  const result = getDb().prepare('DELETE FROM accomplishments WHERE id = ?').run(id);
  return result.changes > 0;
};
