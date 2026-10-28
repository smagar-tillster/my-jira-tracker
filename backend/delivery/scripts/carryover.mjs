#!/usr/bin/env node
// Tickets carried over through many sprints. Reads the snapshot (run snapshot.mjs first); no network, read-only.
// A ticket that has sat in N sprints and is already Ready for QA / In QA is a candidate to release, close or take out of the sprint.
// Usage: node carryover.mjs [--min-sprints 4] [--status "Ready for QA,In QA"] [--any-status] [--not-ready] [--tenant X]
//   --not-ready  the opposite question: carried over many sprints and NOT Ready for QA / In QA (still real work, or stuck)
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, md, jiraUrl, today, CACHE_DIR } from '../lib/jira.mjs';

const a = parseArgs(process.argv.slice(2));
const min = Number(a['min-sprints'] || 4);
const statuses = (a.status && a.status !== true ? String(a.status) : 'Ready for QA,In QA').split(',').map((s) => s.trim().toLowerCase());
const snap = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'snapshot.json'), 'utf8'));
const T = today();
const days = (d) => (d ? Math.floor((Date.parse(`${T}T12:00:00`) - Date.parse(`${d}T12:00:00`)) / 86400000) : null);
const tenant = a.tenant && a.tenant !== true ? String(a.tenant).toUpperCase() : null;

const rows = snap.issues
  .map((t) => ({ t, n: (t.sprints || []).length, first: (t.sprints || []).map((s) => s.name)[0] }))
  .filter((r) => r.n >= min)
  .filter((r) => a['any-status'] || statuses.includes(r.t.status.toLowerCase()) || (a['not-ready'] && !['ready for qa', 'in qa'].includes(r.t.status.toLowerCase())))
  .filter((r) => !a['not-ready'] || !['ready for qa', 'in qa'].includes(r.t.status.toLowerCase()))
  .filter((r) => !tenant || r.t.clients.some((c) => c.toUpperCase() === tenant))
  .sort((x, y) => y.n - x.n);

const trunc = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1).trimEnd()}…` : String(s));
console.log(`# Carried over ≥ ${min} sprints${a['any-status'] ? '' : ` and ${statuses.join(' / ')}`} — ${T}\n`);
console.log(`${rows.length} of ${snap.issues.length} tickets in the snapshot (${snap.scope?.sprints?.join?.(', ') || 'current sprint'}).\n`);
console.log(md(rows.map(({ t, n }) => [`[${t.key}](${jiraUrl(t.key)})`, trunc(t.summary, 62), n, t.status, t.clients.join(', ') || '(none)', t.assignee || 'unassigned', t.release ? `${t.release}${days(t.release) > 0 ? ' ⚠' : ''}` : '-', t.due || '-', t.updated || '-']),
  ['Ticket', 'Summary', 'Sprints', 'Status', 'Client', 'Owner', 'Release', 'Due', 'Updated']));
const by = rows.reduce((m, { t }) => { const k = t.clients[0] || '(none)'; m[k] = (m[k] || 0) + 1; return m; }, {});
console.log(`\nBy client: ${Object.entries(by).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join(', ')}\n⚠ = release date already passed.`);
