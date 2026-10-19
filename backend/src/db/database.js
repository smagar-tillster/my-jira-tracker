import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let _db = null;

export function getDb() {
  if (!_db) {
    const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
    const DB_PATH = path.join(dataDir, 'tracker.db');
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
  }
  return _db;
}

export function initDb() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS issue_tags (
      issue_key TEXT NOT NULL,
      tag       TEXT NOT NULL,
      PRIMARY KEY (issue_key, tag)
    );

    CREATE TABLE IF NOT EXISTS issue_important (
      issue_key TEXT PRIMARY KEY,
      important INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS issue_myday (
      issue_key TEXT PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS feteam_members (
      assignee  TEXT PRIMARY KEY,
      is_member INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS client_regions (
      client TEXT PRIMARY KEY,
      region TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS accomplishments (
      id         TEXT PRIMARY KEY,
      type       TEXT NOT NULL DEFAULT 'manual',
      title      TEXT NOT NULL,
      detail     TEXT,
      issue_key  TEXT,
      sprint     TEXT,
      date       TEXT NOT NULL,
      category   TEXT NOT NULL DEFAULT 'other',
      impact     TEXT NOT NULL DEFAULT 'medium',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  console.log('✓ SQLite database initialized');
  return db;
}
