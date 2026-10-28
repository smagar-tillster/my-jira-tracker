#!/usr/bin/env node
// Delivery plan grouped by tenant (client), with each ticket's latest comment, and tickets of the same release grouped together.
// Reads .cache/snapshot.json (run snapshot.mjs first); one extra Jira read for the comments.
// Usage: node plan.mjs [--tenant BK-DE] [--include-done] [--no-comments]
// Per tenant: one block per release date (tickets that ship together), then "No release date". Columns: Ticket, Description, Component, UAT, Due, Status, ★, Last comment.
// ★ = flagged important in MyTracker.
import { loadSnapshot, parseArgs, isClosed, md, jiraUrl, TRACKER_API, today, search } from '../lib/jira.mjs';
import { adfText } from '../lib/releases.mjs';

const a = parseArgs(process.argv.slice(2));
const snap = loadSnapshot();
const T = today();
const wide = !!snap.scope?.future; // future sprints loaded -> show which sprint each ticket is in

let important = {};
try {
  const r = await fetch(`${TRACKER_API}/important`, { signal: AbortSignal.timeout(2500) });
  important = (await r.json()).data || {};
} catch {
  console.error('(MyTracker backend not reachable — ★ flags omitted. Start it or set TRACKER_API_URL.)\n');
}

const items = snap.issues.filter((t) => a['include-done'] || !isClosed(t));
const groups = new Map();
for (const t of items) {
  const tenant = t.clients[0] || 'UNASSIGNED (no client)';
  if (a.tenant && !tenant.toLowerCase().includes(String(a.tenant).toLowerCase())) continue;
  if (!groups.has(tenant)) groups.set(tenant, []);
  groups.get(tenant).push(t);
}

// latest comment per ticket (author first name, date, first words), one search per 80 keys
const comments = new Map();
if (!a['no-comments']) {
  const keys = [...groups.values()].flat().map((t) => t.key);
  for (let i = 0; i < keys.length; i += 80) {
    try {
      for (const r of await search(`key in (${keys.slice(i, i + 80).join(',')})`, ['comment'])) {
        const list = r.fields.comment?.comments || [];
        const c = list[list.length - 1];
        if (c) comments.set(r.key, `${String(c.created).slice(5, 10)} ${String(c.author?.displayName || '?').split(/\s+/)[0]}: ${adfText(c.body).replace(/\s+/g, ' ').trim().slice(0, 90)}`);
      }
    } catch (e) { console.error(`(comments unavailable: ${String(e.message).split('\n')[0]})\n`); break; }
  }
}

const earliest = (t) => [t.uat, t.release, t.due].filter(Boolean).sort()[0] || '9999';
const trunc = (s, n = 60) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const mark = (d) => (d && d < T ? `${d} ⚠` : d || '-');
const cmt = (s) => String(s || '').replace(/\|/g, '/');

console.log(`# Delivery plan by tenant — ${T}\n`);
for (const list of groups.values()) list.sort((p, q) => earliest(p).localeCompare(earliest(q)));
for (const [tenant, list] of [...groups.entries()].sort((x, y) => earliest(x[1][0]).localeCompare(earliest(y[1][0])))) {
  console.log(`## ${tenant} (${list.length})\n`);
  const byRel = new Map();
  for (const t of list) { const k = t.release || ''; if (!byRel.has(k)) byRel.set(k, []); byRel.get(k).push(t); }
  const rels = [...byRel.keys()].sort((x, y) => (x || '9999').localeCompare(y || '9999')); // dated releases first, no release date last
  for (const rel of rels) {
    const rows = byRel.get(rel);
    console.log(`**${rel ? `Release ${mark(rel)}` : 'No release date'}** (${rows.length})\n`);
    console.log(md(rows.map((t) => [
      `[${t.key}](${jiraUrl(t.key)})`, trunc(t.summary), t.components.join(', ') || '-', mark(t.uat), mark(t.due), t.status,
      ...(wide ? [t.sprint.replace(/^.*?(\S+\s*\S*)$/, '$1') || '-'] : []), important[t.key] ? '★' : '', ...(a['no-comments'] ? [] : [cmt(comments.get(t.key)) || '-']),
    ]), ['Ticket', 'Description', 'Component', 'UAT', 'Due', 'Status', ...(wide ? ['Sprint'] : []), '★', ...(a['no-comments'] ? [] : ['Last comment'])]));
    console.log('');
  }
}
console.log('⚠ = date is before today.');
