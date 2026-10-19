#!/usr/bin/env node
// Pull tickets into .cache/snapshot.json (plus a client "universe" used for client suggestions).
// Usage: node snapshot.mjs [--sprint-prefix "NGK Sprint"] [--fe] [--fe-members "A,B"] [--jql "..."] [--filter 123]
//                          [--include-done] [--include-future|--future-only]
// Default scope: project = NGK, in an ACTIVE sprint whose name starts with the prefix (default "NGK Sprint"), not done.
// --include-future adds future (planned) sprints to the active ones; --future-only loads only future sprints.
// Client-suggestion lookup (small aggregate) is cached 7 days in .cache/universe.json;
// --refresh-universe forces a reload, --no-universe skips it.
// Issue types excluded by default: Release, Content Change Request, Coupon Change Request, Sub-task (case-insensitive).
// --exclude-types "A,B" replaces that list; --exclude-types none keeps every type.
// Component filter: default FE (Jira component, case-insensitive exact). --component NAME changes it, --component any disables it.
// --fe keeps only tickets assigned to the FE team (MyTracker /api/feteam list, or --fe-members).
import { loadUniverse, search, mapIssue, saveJson, parseArgs, PROJECT, FIELDS, today, TRACKER_API } from '../lib/jira.mjs';

const a = parseArgs(process.argv.slice(2));
const prefix = a['sprint-prefix'] === undefined ? 'NGK Sprint' : a['sprint-prefix'];
const done = a['include-done'] ? '' : ' AND statusCategory != Done';

let jql = a.jql;
if (!jql && a.filter) jql = `filter = ${a.filter}`;
const sprintFn = a['future-only'] ? 'futureSprints()' : a['include-future'] ? null : 'openSprints()';
if (!jql) {
  const sp = sprintFn ? `sprint in ${sprintFn}` : '(sprint in openSprints() OR sprint in futureSprints())';
  jql = `project = ${PROJECT} AND ${sp}${done}`;
}
const custom = !!(a.jql || a.filter);

let issues = (await search(`${jql} ORDER BY duedate ASC, key ASC`)).map(mapIssue);
const loaded = issues.length;

// Sprint scope: JQL openSprints() also matches tickets that merely CARRIED OVER through old sprints, so filter
// client-side on the ticket's sprints: state must be active (or future with --include-future / --future-only)
// AND the name must start with the prefix (JQL cannot do "starts with"). Skipped for custom --jql/--filter.
if (!custom) {
  const states = a['future-only'] ? ['future'] : a['include-future'] ? ['active', 'future'] : ['active'];
  const p = String(prefix || '').toLowerCase();
  issues = issues.filter((t) => t.sprints.some((s) => states.includes(s.state) && s.name.toLowerCase().startsWith(p)));
  issues.forEach((t) => { t.sprint = t.sprints.filter((s) => states.includes(s.state) && s.name.toLowerCase().startsWith(p)).map((s) => s.name).join(', '); });
}
const afterSprint = issues.length;
const EXCLUDE_DEFAULT = ['Release', 'Content Change Request', 'Coupon Change Request', 'Sub-task'];
const excluded = a['exclude-types'] === undefined ? EXCLUDE_DEFAULT : String(a['exclude-types']).toLowerCase() === 'none' ? [] : String(a['exclude-types']).split(',').map((x) => x.trim());
let typeNote = '';
if (excluded.length) {
  const ex = new Set(excluded.map((x) => x.toLowerCase()));
  const before = issues.length;
  issues = issues.filter((t) => !ex.has(t.type.toLowerCase()));
  typeNote = ` -> ${issues.length} after excluding types (${before - issues.length} removed: ${excluded.join(', ')})`;
}


let feNote = '';
const component = a.component === undefined ? 'FE' : a.component; // default FE; --component any disables
if (component && String(component).toLowerCase() !== 'any') {
  const c = String(component).toLowerCase();
  issues = issues.filter((t) => t.components.some((x) => x.toLowerCase() === c));
  feNote += ` -> ${issues.length} with component "${component}"`;
}
if (a.fe) {
  let members = a['fe-members'] ? String(a['fe-members']).split(',').map((s) => s.trim()) : null;
  if (!members) {
    try {
      const r = await fetch(`${TRACKER_API}/feteam`, { signal: AbortSignal.timeout(3000) });
      members = Object.entries((await r.json()).data || {}).filter(([, v]) => v).map(([k]) => k);
    } catch {
      console.error('FE filter requested but MyTracker backend is not reachable. Start it or pass --fe-members "Name1,Name2".');
      process.exit(1);
    }
  }
  if (!members.length) { console.error('FE team list is empty. Pass --fe-members or set members in MyTracker.'); process.exit(1); }
  const set = new Set(members.map((m) => m.toLowerCase()));
  issues = issues.filter((t) => t.assignee && set.has(t.assignee.toLowerCase()));
  feNote += ` -> ${issues.length} after FE team filter (${members.length} members)`;
}

const uni = await loadUniverse({ refresh: !!a['refresh-universe'], skip: !!a['no-universe'] });

const scope = { jql, excludedTypes: excluded, component: String(component).toLowerCase() === 'any' ? null : component, future: !!(a['include-future'] || a['future-only']), sprintPrefix: custom ? null : prefix || null, fe: !!a.fe, includeDone: !!a['include-done'] };
const snapshot = { takenAt: new Date().toISOString(), today: today(), scope, count: issues.length, issues };
const p = saveJson('snapshot.json', snapshot);
console.log(`Loaded ${loaded} from JQL -> ${afterSprint} after sprint-name filter${scope.sprintPrefix ? ` ("${scope.sprintPrefix}*")` : ' (none)'}${typeNote}${feNote}`);
console.log(`Snapshot: ${issues.length} tickets, client lookup ${uni.note} -> ${p}`);
const sprints = [...new Set(issues.flatMap((t) => t.sprint.split(', ').filter(Boolean)))];
console.log(`Sprints in scope: ${sprints.join(' | ') || '-'}`);
console.log(`JQL: ${jql}`);
