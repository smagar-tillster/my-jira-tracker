import { getDb } from '../db/database.js';

export function getAllFETeamMembers() {
  return getDb().prepare('SELECT assignee FROM feteam_members WHERE is_member = 1').all().map(r => r.assignee);
}

export function getAllFETeamFlags() {
  const rows = getDb().prepare('SELECT assignee, is_member FROM feteam_members').all();
  const result = {};
  for (const { assignee, is_member } of rows) result[assignee] = is_member === 1;
  return result;
}

export function setFETeamMember(assignee, isMember) {
  const db = getDb();
  if (isMember) {
    db.prepare('INSERT OR REPLACE INTO feteam_members (assignee, is_member) VALUES (?, 1)').run(assignee);
  } else {
    db.prepare('DELETE FROM feteam_members WHERE assignee = ?').run(assignee);
  }
}

export function isFETeamMember(assignee) {
  const row = getDb().prepare('SELECT is_member FROM feteam_members WHERE assignee = ?').get(assignee);
  return row ? row.is_member === 1 : false;
}
