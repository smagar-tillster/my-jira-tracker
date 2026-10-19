#!/usr/bin/env node
// My open tickets (assignee = currentUser()), straight from Jira, independent of the sprint snapshot.
// Usage: node mine.mjs [--project NGK|all] [--sprint-only] [--include-done] [--save]
//   --save also writes .cache/snapshot.json so cleanup.mjs / plan.mjs can run on "my tickets".
// Sorted by earliest of UAT/Release/Due. Risk uses the repo rule (Ready for QA = done):
//   OVERDUE (past), URGENT (today/tomorrow), SOON (<=3d).
import { loadUniverse, search, mapIssue, saveJson, parseArgs, PROJECT, FIELDS, today, daysBetween, isDoneType, md, jiraUrl } from '../lib/jira.mjs';

const a = parseArgs(process.argv.slice(2));
const proj = a.project === 'all' ? '' : `project = ${a.project || PROJECT} AND `;
const jql = `${proj}assignee = currentUser()${a['include-done'] ? '' : ' AND statusCategory != Done'}${a['sprint-only'] ? ' AND sprint in openSprints()' : ''} ORDER BY duedate ASC, updated DESC`;

const T = today();
const issues = (await search(jql)).map(mapIssue);
const next = (t) => [t.uat, t.release, t.due].filter(Boolean).sort()[0] || null;
const risk = (t) => {
  if (isDoneType(t)) return 'ok';
  const dates = [t.due, t.release, t.uat].filter(Boolean);
  if (!dates.length) return 'NO DATE';
  const d = daysBetween(T, dates.sort()[0]);
  return d < 0 ? 'OVERDUE' : d <= 1 ? 'URGENT' : d <= 3 ? 'SOON' : 'ok';
};
const rank = { OVERDUE: 0, URGENT: 1, SOON: 2, 'NO DATE': 3, ok: 4 };
const rows = issues.map((t) => ({ ...t, risk: risk(t) })).sort((x, y) => rank[x.risk] - rank[y.risk] || (next(x) || '9').localeCompare(next(y) || '9'));

if (a.save) {
  const u = await loadUniverse({});
  saveJson('snapshot.json', { takenAt: new Date().toISOString(), today: T, scope: { jql, mine: true }, count: issues.length, issues });
  console.error(`(saved snapshot; client lookup ${u.note})`);
}

const counts = rows.reduce((c, t) => ({ ...c, [t.risk]: (c[t.risk] || 0) + 1 }), {});
const trunc = (s, n = 60) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
console.log(`# My open tickets — ${T} (${rows.length})\n`);
console.log(Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(' · ') + '\n');
console.log(md(rows.map((t) => [`[${t.key}](${jiraUrl(t.key)})`, trunc(t.summary), t.clients.join(',') || '-', t.status, t.uat, t.release, t.due, t.risk]), ['Ticket', 'Summary', 'Client', 'Status', 'UAT', 'Release', 'Due', 'Risk']));
console.log(`\nJQL: ${jql}${a.save ? '\n(saved to .cache/snapshot.json)' : ''}`);
