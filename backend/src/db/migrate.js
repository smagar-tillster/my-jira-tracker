import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function migrateFromJson() {
  const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
  const db = getDb();

  const { count: tagCount }       = db.prepare('SELECT COUNT(*) as count FROM issue_tags').get();
  const { count: importantCount } = db.prepare('SELECT COUNT(*) as count FROM issue_important').get();
  const { count: feteamCount }    = db.prepare('SELECT COUNT(*) as count FROM feteam_members').get();

  // ── Tags ──────────────────────────────────────────────────────────────────
  const tagsFile = path.join(DATA_DIR, 'tags.json');
  if (fs.existsSync(tagsFile) && tagCount === 0) {
    try {
      const tags = JSON.parse(fs.readFileSync(tagsFile, 'utf8'));
      const ins  = db.prepare('INSERT OR IGNORE INTO issue_tags (issue_key, tag) VALUES (?, ?)');
      db.transaction(() => {
        for (const [issueKey, list] of Object.entries(tags)) {
          if (Array.isArray(list)) {
            for (const tag of list) { if (tag) ins.run(issueKey, tag); }
          }
        }
      })();
      console.log('✓ Migrated tags.json → SQLite');
    } catch (e) {
      console.error('Migration error (tags):', e.message);
    }
  }

  // ── Important flags ────────────────────────────────────────────────────────
  const importantFile = path.join(DATA_DIR, 'important.json');
  if (fs.existsSync(importantFile) && importantCount === 0) {
    try {
      const flags = JSON.parse(fs.readFileSync(importantFile, 'utf8'));
      const ins   = db.prepare('INSERT OR IGNORE INTO issue_important (issue_key) VALUES (?)');
      db.transaction(() => {
        for (const [issueKey, val] of Object.entries(flags)) {
          if (val === true) ins.run(issueKey);
        }
      })();
      console.log('✓ Migrated important.json → SQLite');
    } catch (e) {
      console.error('Migration error (important):', e.message);
    }
  }

  // ── FE Team ────────────────────────────────────────────────────────────────
  const feteamFile = path.join(DATA_DIR, 'feteam.json');
  if (fs.existsSync(feteamFile) && feteamCount === 0) {
    try {
      const feteam = JSON.parse(fs.readFileSync(feteamFile, 'utf8'));
      const ins    = db.prepare('INSERT OR IGNORE INTO feteam_members (assignee) VALUES (?)');
      db.transaction(() => {
        for (const [assignee, val] of Object.entries(feteam)) {
          if (val === true) ins.run(assignee);
        }
      })();
      console.log('✓ Migrated feteam.json → SQLite');
    } catch (e) {
      console.error('Migration error (feteam):', e.message);
    }
  }
}
