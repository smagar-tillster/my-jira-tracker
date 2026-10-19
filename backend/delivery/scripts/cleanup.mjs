#!/usr/bin/env node
// Deterministic data-cleanup report over .cache/snapshot.json. No AI involved.
// Usage: node cleanup.mjs [--stale-days 60] [--json]
// Sections: 1 no-client (+suggestions) · 2 stale/old candidates · 3 no UAT & no due · 4 past due
import { loadUniverse, leadToken, loadSnapshot, saveJson, parseArgs, isDoneType, isClosed, daysBetween, md, jiraUrl } from '../lib/jira.mjs';

const a = parseArgs(process.argv.slice(2));
const staleDays = Number(a['stale-days'] || 60);
const snap = loadSnapshot();
const T = snap.today;
const open = snap.issues.filter((t) => !isClosed(t));

// ---- client suggestion ------------------------------------------------------
const U = await loadUniverse({}); // cached aggregate; no heavy fetch when fresh
const known = new Map(U.clients.map((c) => [c, 1]));
for (const t of snap.issues) t.clients.forEach((c) => known.set(c, (known.get(c) || 0) + 1));
const tokenMap = new Map(Object.entries(U.tokens).map(([k, v]) => [k, new Map(Object.entries(v))]));
for (const t of snap.issues) {
  const tok = leadToken(t.summary);
  if (tok && t.clients[0]) {
    if (!tokenMap.has(tok)) tokenMap.set(tok, new Map());
    tokenMap.get(tok).set(t.clients[0], (tokenMap.get(tok).get(t.clients[0]) || 0) + 1);
  }
}
const byKey = new Map(snap.issues.map((t) => [t.key, t]));
const norm = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

// Rule order (first hit wins). Each suggestion carries a confidence and the reason, so the user can judge.
const siblingSets = new Map(); // title code -> multi-client set seen on a sibling ticket in this snapshot
for (const t of snap.issues) {
  const tok = leadToken(t.summary);
  if (tok && t.clients.length > 1) siblingSets.set(tok, { clients: t.clients, key: t.key });
}
const inTitle = (t) => {
  const hay = norm(t.summary);
  const pos = (c) => hay.indexOf(norm(c));
  return [...known.keys()].filter((c) => norm(c).length >= 4 && pos(c) >= 0)
    .sort((x, y) => pos(x) - pos(y) || y.length - x.length) // earliest in the title first
    .filter((c, i, arr) => !arr.some((o) => o !== c && norm(o).includes(norm(c)) && pos(o) <= pos(c))); // drop substrings of a longer match
};
const prefixSuggestion = (t) => {
  const tok = leadToken(t.summary);
  const m = tok && tokenMap.get(tok);
  if (!m) return null;
  const total = [...m.values()].reduce((x, y) => x + y, 0);
  const [c, n] = [...m.entries()].sort((x, y) => y[1] - x[1])[0];
  if (n < 3 || n / total < 0.7) return null;
  return { client: c, why: `title code "${tok}" -> ${c} in ${n}/${total} tickets`, confidence: 'high' };
};

const suggestClient = (t) => {
  const tok = leadToken(t.summary);
  // 1. internal work: "TI-XX:" is decided by the prefix, even if a tenant is named later in the title
  if (tok === 'TI-XX') {
    const internal = [...(tokenMap.get('TI-XX') || new Map()).entries()].filter(([c]) => /^Tillster-/i.test(c)).sort((x, y) => y[1] - x[1]);
    if (internal.length) {
      const alt = internal.slice(1).map(([c, n]) => `${c} ${n}x`).join(', ');
      return { client: internal[0][0], why: `TI-XX internal work: ${internal[0][0]} ${internal[0][1]}x${alt ? ` (also ${alt})` : ''}`, confidence: 'medium' };
    }
  }
  // 2. a sibling ticket with the same title code and several clients (e.g. RBE -> BK-ES, BK-PT, PLK-ES, PLK-IT)
  const sib = tok && siblingSets.get(tok);
  if (sib) return { client: sib.clients.join(', '), why: `same title code "${tok}" as ${sib.key}`, confidence: 'medium' };
  // 3. a known client named in the title (earliest wins); several named -> lower confidence
  const hits = inTitle(t);
  if (hits.length === 1) return { client: hits[0], why: 'client name in title', confidence: 'high' };
  if (hits.length > 1) return { client: hits[0], why: `several clients in title (${hits.join(', ')}); first one used`, confidence: 'low' };
  // 4. title code learned from history (strict: >=3 tickets and >=70% one client)
  const p = prefixSuggestion(t);
  if (p) return p;
  // 5. parent's client
  const par = t.parentKey && byKey.get(t.parentKey);
  if (par?.clients?.length) return { client: par.clients[0], why: `parent ${par.key}`, confidence: 'medium' };
  return { client: null, why: 'no signal', confidence: 'none' };
};

const noClient = open.filter((t) => !t.clients.length).map((t) => ({ ...t, suggestion: suggestClient(t) }));

// ---- other sections ---------------------------------------------------------
const stale = open
  .filter((t) => {
    const idle = daysBetween(t.updated, T);
    const overdue = t.due ? daysBetween(t.due, T) : 0;
    const early = ['To Do', 'Backlog', 'Open'].includes(t.status);
    return (idle >= staleDays) || (overdue >= staleDays && early);
  })
  .map((t) => ({ ...t, idleDays: daysBetween(t.updated, T), overdueDays: t.due ? Math.max(0, daysBetween(t.due, T)) : 0 }))
  .sort((x, y) => y.idleDays - x.idleDays);

const noDates = open.filter((t) => !t.uat && !t.due && !isDoneType(t));
const pastDue = open
  .filter((t) => !isDoneType(t) && ((t.due && t.due < T) || (t.uat && t.uat < T)))
  .map((t) => ({ ...t, lateDays: Math.max(t.due ? daysBetween(t.due, T) : 0, t.uat ? daysBetween(t.uat, T) : 0) }))
  .sort((x, y) => y.lateDays - x.lateDays);

if (a.json) {
  console.log(JSON.stringify({ noClient, stale, noDates, pastDue }, null, 2));
  process.exit(0);
}
saveJson('cleanup.json', { today: T, noClient, stale, noDates, pastDue });

const link = (t) => `[${t.key}](${jiraUrl(t.key)})`;
const trunc = (s, n = 70) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

console.log(`# NGK cleanup report — ${T}  (${open.length} open tickets in scope)\n`);
console.log(`## 1. No client (${noClient.length})\n`);
console.log(md(noClient.map((t) => [link(t), trunc(t.summary), t.status, t.suggestion.client ?? '?', t.suggestion.confidence, t.suggestion.why]), ['Ticket', 'Summary', 'Status', 'Suggested client', 'Conf.', 'Why']));
console.log(`\n## 2. Old / stale candidates — idle ≥ ${staleDays}d, or overdue ≥ ${staleDays}d while still To Do/Backlog (${stale.length})\n`);
console.log(md(stale.map((t) => [link(t), trunc(t.summary), t.status, t.clients.join(',') || '-', t.assignee, `${t.idleDays}d`, t.overdueDays ? `${t.overdueDays}d` : '-']), ['Ticket', 'Summary', 'Status', 'Client', 'Assignee', 'Idle', 'Overdue']));
console.log(`\n## 3. No UAT and no Due date (${noDates.length})\n`);
console.log(md(noDates.map((t) => [link(t), trunc(t.summary), t.status, t.clients.join(',') || '-', t.assignee, t.release || '-']), ['Ticket', 'Summary', 'Status', 'Client', 'Assignee', 'Release']));
console.log(`\n## 4. Past due — Due or UAT before today, not Ready for QA/Done (${pastDue.length})\n`);
console.log(md(pastDue.map((t) => [link(t), trunc(t.summary), t.status, t.clients.join(',') || '-', t.uat, t.due, `${t.lateDays}d`]), ['Ticket', 'Summary', 'Status', 'Client', 'UAT', 'Due', 'Late']));
console.log(`\n(Details saved to .cache/cleanup.json. Suggestions are heuristic: confirm before applying.)`);
