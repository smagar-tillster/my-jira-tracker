import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'tracker.db');

let _db = null;

export function getDb() {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
  }
  return _db;
}

const addColIfMissing = (db, table, col, definition) => {
  const cols = db.pragma(`table_info(${table})`);
  if (!cols.find(c => c.name === col)) {
    db.exec(`ALTER TABLE "${table}" ADD COLUMN ${col} ${definition}`);
    console.log(`✓ Migrated: added ${table}.${col}`);
  }
};

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

    CREATE TABLE IF NOT EXISTS feteam_members (
      assignee  TEXT PRIMARY KEY,
      is_member INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS todos (
      id         TEXT PRIMARY KEY,
      type       TEXT NOT NULL,
      title      TEXT NOT NULL,
      brief      TEXT,
      url        TEXT,
      issue_key  TEXT,
      due_date   TEXT,
      done       INTEGER NOT NULL DEFAULT 0,
      priority   TEXT NOT NULL DEFAULT 'medium',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
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

    CREATE TABLE IF NOT EXISTS todo_categories (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS todo_checklist (
      id         TEXT PRIMARY KEY,
      todo_id    TEXT NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
      text       TEXT NOT NULL,
      done       INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS archive_cache (
      id         INTEGER PRIMARY KEY CHECK (id = 1),
      data_json  TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      issue_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS daily_summaries (
      id             TEXT PRIMARY KEY,
      summary_date   TEXT NOT NULL UNIQUE,
      source         TEXT NOT NULL DEFAULT 'cowork-daily-briefing',
      title          TEXT,
      content        TEXT NOT NULL DEFAULT '',
      highlights_json TEXT NOT NULL DEFAULT '[]',
      blockers_json   TEXT NOT NULL DEFAULT '[]',
      risks_json      TEXT NOT NULL DEFAULT '[]',
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Idempotent column additions for existing todos table
  addColIfMissing(db, 'todos', 'my_day',   'INTEGER NOT NULL DEFAULT 0');
  addColIfMissing(db, 'todos', 'category', "TEXT NOT NULL DEFAULT 'Tasks'");

  // Seed default category
  db.prepare("INSERT OR IGNORE INTO todo_categories (id, name) VALUES ('cat-tasks', 'Tasks')").run();

  console.log('✓ SQLite database initialized');
  return db;
}
