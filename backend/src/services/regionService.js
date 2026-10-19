import { getDb } from '../db/database.js';

export function getAllClientRegions() {
  const rows = getDb().prepare('SELECT client, region FROM client_regions').all();
  const result = {};
  for (const { client, region } of rows) result[client] = region;
  return result;
}

export function setClientRegion(client, region) {
  const db = getDb();
  const trimmed = (region || '').trim();
  if (trimmed) {
    db.prepare('INSERT OR REPLACE INTO client_regions (client, region) VALUES (?, ?)').run(client, trimmed);
  } else {
    // Empty region = unmapped, falls back to 'Other' on the frontend
    db.prepare('DELETE FROM client_regions WHERE client = ?').run(client);
  }
}
