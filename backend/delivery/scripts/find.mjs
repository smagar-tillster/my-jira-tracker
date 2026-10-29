#!/usr/bin/env node
// Ad hoc lookup in the current NGK sprint: any client, any component. Read-only; does NOT touch the snapshot cleanup uses.
// Usage: node find.mjs --client Tillster-All                     active sprint, all components, active tickets
//        node find.mjs --client "Tillster-All,Tillster-Kiosk" --component FE --text modifier
//        node find.mjs --assignee "Sandeep" | --status "Blocked,Code Review" | --include-future | --include-done | --exclude-types none
// Defaults match the skill: sprint prefix from config.json (NGK Sprint), active sprint only, not done, excluded types
// Release / Content Change Request / Coupon Change Request / Sub-task, ALL components.
import fs from 'node:fs';
import { search, mapIssue, parseArgs, today, md, jiraUrl, FIELDS } from '../lib/jira.mjs';
import { CONFIG_FILE } from '../lib/paths.mjs';

const a = parseArgs(process.argv.slice(2));
const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
const list = (v) => (v && v !== true ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : []);
const quote = (s) => `"${s.replace(/"/g, '')}"`;
const prefix = String(cfg.sprintPrefix || '').toLowerCase();
const clients = list(a.client);
const excluded = a['exclude-types'] === 'none' ? [] : (list(a['exclude-types']).length ? list(a['exclude-types']) : ['Release', 'Content Change Request', 'Coupon Change Request', 'Sub-task']).map((s) => s.toLowerCase());
const components = list(a.component).map((s) => s.toLowerCase());
const statuses = list(a.status).map((s) => s.toLowerCase());
const assignee = list(a.assignee).map((s) => s.toLowerCase());

const clauses = ['project = NGK', `sprint in ${a['include-future'] ? '(openSprints(), futureSprints())' : 'openSprints()'}`];
if (!a['include-done']) clauses.push('statusCategory != Done');
if (clients.length) clauses.push(`cf[16047] in (${clients.map(quote).join(',')})`);
if (list(a.text).length) clauses.push(`(${list(a.text).map((t) => `text ~ ${quote(t)}`).join(' OR ')})`);
const jql = `${clauses.join(' AND ')} ORDER BY duedate ASC, key ASC`;

const raw = (await search(jql)).map(mapIssue);
const states = a['include-future'] ? ['active', 'future'] : ['active'];
const rows = raw
  .filter((t) => t.sprints.some((s) => states.includes(s.state) && s.name.toLowerCase().startsWith(prefix)))
  .filter((t) => !excluded.includes(t.type.toLowerCase()))
  .filter((t) => !components.length || t.components.some((c) => components.includes(c.toLowerCase())))
  .filter((t) => !statuses.length || statuses.includes(t.status.toLowerCase()))
  .filter((t) => !assignee.length || assignee.some((x) => (t.assignee || '').toLowerCase().includes(x)));

const trunc = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1).trimEnd()}…` : String(s));
console.log(`# Sprint tickets${clients.length ? ` for client ${clients.join(', ')}` : ''} — ${today()}\n`);
console.log(`Scope: ${[...new Set(rows.flatMap((t) => t.sprints.filter((s) => states.includes(s.state)).map((s) => s.name)))].join(', ') || 'none'} · ${a['include-done'] ? 'including done' : 'active tickets only'} · components: ${components.length ? components.join(', ') : 'ALL'} · excluded types: ${excluded.join(', ') || 'none'}`);
console.log(`Loaded ${raw.length} from JQL -> ${rows.length} after sprint-name, type and filters.\n`);
if (rows.length) {
  console.log(md(rows.map((t) => [`[${t.key}](${jiraUrl(t.key)})`, trunc(t.summary, 70), t.type, t.status, t.components.join(', ') || '-', t.assignee || 'unassigned', t.uat || '-', t.due || '-', t.release || '-', t.clients.join(', ') || '-']),
    ['Ticket', 'Summary', 'Type', 'Status', 'Components', 'Assignee', 'UAT', 'Due', 'Release', 'Client']));
  const by = (f) => Object.entries(rows.reduce((m, t) => { const k = f(t); m[k] = (m[k] || 0) + 1; return m; }, {})).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k} ${n}`).join(', ');
  console.log(`\nBy status: ${by((t) => t.status)}\nBy component: ${by((t) => t.components[0] || '(none)')}`);
}
void FIELDS;
