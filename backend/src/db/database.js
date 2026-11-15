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

    -- Quick Analysis: every sprint ticket seen at an earlier run, the ones that were new (with whether they were marked read),
    -- the model's analysis per ticket, and the last report with its run state. Times are UTC ISO-8601.
    CREATE TABLE IF NOT EXISTS qa_known (
      issue_key     TEXT PRIMARY KEY,
      first_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS qa_new (
      issue_key     TEXT PRIMARY KEY,
      first_seen_at TEXT NOT NULL,
      read_at       TEXT
    );

    CREATE TABLE IF NOT EXISTS qa_analysis (
      issue_key  TEXT PRIMARY KEY,
      updated    TEXT NOT NULL,
      json       TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS qa_state (
      id               INTEGER PRIMARY KEY CHECK (id = 1),
      last_run_at      TEXT,
      last_status      TEXT,
      last_error       TEXT,
      last_duration_ms INTEGER,
      report_json      TEXT,
      viewed_at        TEXT,
      group_hash       TEXT,
      group_json       TEXT
    );

    -- Trends: a local copy of the NGK tickets that were in a sprint, with only what the trend pages count. Times are ISO-8601 as Jira gave them.
    CREATE TABLE IF NOT EXISTS trend_tickets (
      issue_key          TEXT PRIMARY KEY,
      type               TEXT NOT NULL,
      created            TEXT,
      resolved           TEXT,
      status_category    TEXT,
      first_sprint_start TEXT,
      updated            TEXT,
      assignee           TEXT,
      clients            TEXT,
      summary            TEXT,
      description        TEXT,
      component          TEXT,
      components         TEXT,
      labels             TEXT,
      priority           TEXT
    );

    -- Trends: model answers kept by a hash of the numbers they were written from, so the same numbers never cost a second call.
    CREATE TABLE IF NOT EXISTS trend_ai (
      hash       TEXT PRIMARY KEY,
      kind       TEXT NOT NULL,
      model      TEXT,
      json       TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trend_sync (
      id               INTEGER PRIMARY KEY CHECK (id = 1),
      last_sync_at     TEXT,
      last_full_at     TEXT,
      last_status      TEXT,
      last_error       TEXT,
      last_duration_ms INTEGER,
      last_count       INTEGER
    );
  `);

  // trend_tickets from before the assignee and clients columns existed
  const trendCols = db.prepare('PRAGMA table_info(trend_tickets)').all().map((c) => c.name);
  if (!trendCols.includes('assignee')) db.exec('ALTER TABLE trend_tickets ADD COLUMN assignee TEXT');
  if (!trendCols.includes('clients')) db.exec('ALTER TABLE trend_tickets ADD COLUMN clients TEXT');
  for (const col of ['summary', 'description', 'component', 'components', 'labels', 'priority']) if (!trendCols.includes(col)) db.exec(`ALTER TABLE trend_tickets ADD COLUMN ${col} TEXT`);

  console.log('✓ SQLite database initialized');
  return db;
}
