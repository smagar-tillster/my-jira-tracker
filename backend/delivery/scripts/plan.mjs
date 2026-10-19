#!/usr/bin/env node
// Delivery plan grouped by tenant (client). Deterministic; reads .cache/snapshot.json.
// Usage: node plan.mjs [--tenant BK-DE] [--include-done]
// Columns: Ticket, Summary, Component, UAT, Release, Due, Status, ★ (★ = flagged important in MyTracker)
import { loadSnapshot, parseArgs, isClosed, md, jiraUrl, TRACKER_API, today } from '../lib/jira.mjs';

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

const earliest = (t) => [t.uat, t.release, t.due].filter(Boolean).sort()[0] || '9999';
const trunc = (s, n = 60) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const mark = (d) => (d && d < T ? `${d} ⚠` : d || '-');

console.log(`# Delivery plan by tenant — ${T}\n`);
for (const list of groups.values()) list.sort((p, q) => earliest(p).localeCompare(earliest(q)));
for (const [tenant, list] of [...groups.entries()].sort((x, y) => earliest(x[1][0]).localeCompare(earliest(y[1][0])))) {
  console.log(`## ${tenant} (${list.length})\n`);
  console.log(md(list.map((t) => [
    `[${t.key}](${jiraUrl(t.key)})`, trunc(t.summary), t.components.join(', ') || '-',
    mark(t.uat), mark(t.release), mark(t.due), t.status, ...(wide ? [t.sprint.replace(/^.*?(\S+\s*\S*)$/, '$1') || '-'] : []), important[t.key] ? '★' : '',
  ]), ['Ticket', 'Description', 'Component', 'UAT', 'Release', 'Due', 'Status', ...(wide ? ['Sprint'] : []), '★']));
  console.log('');
}
console.log('⚠ = date is before today.');
