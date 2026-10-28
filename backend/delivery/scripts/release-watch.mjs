#!/usr/bin/env node
// Tickets set for release but not ready. Reads .cache/snapshot.json (run snapshot.mjs first); no network.
// A ticket is "set for release" when its release date (fix version date) is today or earlier, or within the next N days; "not ready" = not Done and not Ready for QA.
// Usage: node release-watch.mjs [--days 3] [--tenant X]
// Output: grouped by release date (tickets that ship together), then tenant, with status, owner and due date.
import { loadSnapshot, parseArgs, md, jiraUrl, today } from '../lib/jira.mjs';

const a = parseArgs(process.argv.slice(2));
const snap = loadSnapshot();
const T = today();
const days = Number(a.days || 3);
const shift = (day, n) => { const x = new Date(`${day}T12:00:00`); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const horizon = shift(T, days);
const ready = (t) => t.statusCategory === 'Done' || t.status === 'Ready for QA'; // repo rule: Ready for QA counts as done
const late = (d) => Math.floor((Date.parse(`${T}T12:00:00`) - Date.parse(`${d}T12:00:00`)) / 86400000);
const trunc = (s, n = 62) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const tenantQ = a.tenant && a.tenant !== true ? String(a.tenant).toLowerCase() : null;

const rows = snap.issues.filter((t) => t.release && t.release <= horizon && !ready(t) && t.statusCategory !== 'Done')
  .filter((t) => !tenantQ || t.clients.some((c) => c.toLowerCase().includes(tenantQ)));
console.log(`# Set for release but not ready — ${T} (release date up to ${horizon})\n`);
if (!rows.length) { console.log('Nothing: every ticket with a release date up to then is Ready for QA or done.'); process.exit(0); }

const byRel = new Map();
for (const t of rows) { if (!byRel.has(t.release)) byRel.set(t.release, []); byRel.get(t.release).push(t); }
const dates = [...byRel.keys()].sort();
console.log(`${rows.length} tickets across ${dates.length} release date(s); ${rows.filter((t) => t.release < T).length} are already past their release date.\n`);
for (const d of dates) {
  const list = byRel.get(d).sort((x, y) => (x.clients[0] || '~').localeCompare(y.clients[0] || '~') || x.key.localeCompare(y.key));
  console.log(`## Release ${d}${d < T ? ` ⚠ ${late(d)}d ago` : d === T ? ' (today)' : ''} — ${list.length} not ready\n`);
  console.log(md(list.map((t) => [`[${t.key}](${jiraUrl(t.key)})`, t.clients[0] || '(none)', trunc(t.summary), t.status, (t.assignee || '-').split(/\s+/)[0], t.due || '-']), ['Ticket', 'Tenant', 'Description', 'Status', 'Owner', 'Due']));
  console.log('');
}
