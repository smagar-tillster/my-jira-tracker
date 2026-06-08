import { randomUUID } from 'crypto';
import { getDb } from '../db/database.js';

const mapRow = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    summaryDate: row.summary_date,
    source: row.source,
    title: row.title,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

export const getLatestDailySummary = () => {
  const db = getDb();
  const row = db
    .prepare(`
      SELECT *
      FROM daily_summaries
      ORDER BY summary_date DESC, updated_at DESC
      LIMIT 1
    `)
    .get();
  return mapRow(row);
};

export const upsertDailySummary = ({ summaryDate, source, title, content }) => {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO daily_summaries (
      id, summary_date, source, title, content,
      highlights_json, blockers_json, risks_json,
      created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, '[]', '[]', '[]', ?, ?)
    ON CONFLICT(summary_date) DO UPDATE SET
      source = excluded.source,
      title = excluded.title,
      content = excluded.content,
      updated_at = excluded.updated_at
  `).run(
    id,
    summaryDate,
    source || 'ai',
    title || null,
    content || '',
    now,
    now,
  );

  const row = db
    .prepare('SELECT * FROM daily_summaries WHERE summary_date = ?')
    .get(summaryDate);

  return mapRow(row);
};
