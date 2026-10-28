#!/usr/bin/env node
// Sprint report for project and product management: ticket stats + key features by tenant with completion status and a one-line importance.
// Stored per sprint (data source + markdown) in the reports folder next to the focus file; configurable per sprint; any sprint can be rebuilt.
// Usage: node sprint-report.mjs build [--sprint current|last|227]     read Jira, save, print the report (default: current)
//        node sprint-report.mjs show [--sprint 227]                    print the saved report
//        node sprint-report.mjs list                                   saved sprints;   sprints = recent sprints in Jira
//        node sprint-report.mjs features [--sprint 227] [--missing]    features as JSON (id, tenant, name, tickets) so importance lines can be written
//        node sprint-report.mjs importance --sprint 227 --file map.json   save {featureId: "one line"} into the sprint config
//        node sprint-report.mjs set --sprint 227 --feature "<id>" [--importance ".."] [--name ".."] [--status Done|"In progress"|"At risk"|"Not started"] [--hide] [--top | --small]
//        node sprint-report.mjs add --sprint 227 NGK-1 NGK-2   |   exclude --sprint 227 NGK-3   (add / remove tickets in the report; then build again)
//        node sprint-report.mjs group --sprint 227 --name "PENN loyalty" --tenant PENN-US --tickets NGK-1,NGK-2 [--importance ".."]   custom feature
//        node sprint-report.mjs due                                    is today a report day (every 14 days from config sprintReport.anchor)? exit code 3 if not
import fs from 'node:fs';
import { parseArgs, today } from '../lib/jira.mjs';
import { buildSprintReport, listSprints, resolveSprint, sprintNumber, loadSprintConfig, saveSprintConfig, dataPath, configPath, isDue, SPRINTS_DIR } from '../lib/sprintreport.mjs';
import { getFlags } from './flag.mjs';

const a = parseArgs(process.argv.slice(2));
const [cmd, ...rest] = a._;
const T = today();
const q = a.sprint && a.sprint !== true ? String(a.sprint) : 'current';
const keys = (list) => list.map((k) => (/^\d+$/.test(k) ? `NGK-${k}` : k.toUpperCase()));
const numberOf = async () => sprintNumber(await resolveSprint(q));

if (cmd === 'build') {
  const d = await buildSprintReport({ query: q, getFlags, T });
  console.log(fs.readFileSync(dataPath(d.number, 'md'), 'utf8'));
  const tops = d.features.filter((f) => f.top).length;
  console.log(`\n_Saved sprint ${d.number} to ${SPRINTS_DIR}. ${tops} top stories listed, ${d.features.length - tops} smaller items left out._`);
} else if (cmd === 'show') {
  const n = await numberOf();
  try { console.log(fs.readFileSync(dataPath(n, 'md'), 'utf8')); } catch { console.log(`No saved report for sprint ${n}. Run: sprint-report.mjs build --sprint ${n}`); }
} else if (cmd === 'list') {
  let files = []; try { files = fs.readdirSync(SPRINTS_DIR).filter((f) => /^sprint-\d+\.json$/.test(f)).sort(); } catch { /* none yet */ }
  console.log(files.length ? files.map((f) => { const d = JSON.parse(fs.readFileSync(`${SPRINTS_DIR}/${f}`, 'utf8')); return `- ${d.sprint.name}: ${d.stats.completionPct}% of ${d.stats.total} (as of ${d.asOf}, ${d.features.filter((x) => x.importance).length}/${d.features.length} features described)`; }).join('\n') : 'No saved sprint reports yet. Run: sprint-report.mjs build');
} else if (cmd === 'sprints') {
  const all = await listSprints();
  console.log(all.slice(-8).map((s) => `- ${s.name} [${s.state}] ${String(s.startDate || '').slice(0, 10)} to ${String(s.endDate || '').slice(0, 10)}`).join('\n'));
} else if (cmd === 'features') {
  const n = await numberOf();
  const d = JSON.parse(fs.readFileSync(dataPath(n, 'json'), 'utf8'));
  const byKey = new Map(d.tickets.map((t) => [t.key, t]));
  const max = d.config.maxFeaturesPerTenant || 5; const rank = {};
  const tn = new Map(d.stats.tenants.map((t) => [t.name, t.n])); const minT = d.config.minTenantTickets || 5;
  void tn; void minT;
  const shown = d.features.filter((f) => f.top).filter((f) => { rank[f.tenant] = (rank[f.tenant] || 0) + 1; return rank[f.tenant] <= max; }); // only the top stories that appear in the report
  const out = shown.filter((f) => !a.missing || !f.importance).map((f) => ({ id: f.id, tenant: f.tenant, name: f.name, status: f.status, done: `${f.done}/${f.total}`, importance: f.importance, tickets: f.tickets.slice(0, 6).map((k) => `${k}: ${byKey.get(k)?.summary || ''}`) }));
  console.log(JSON.stringify(out, null, 2));
} else if (cmd === 'importance') {
  const n = await numberOf(); const file = a.file && a.file !== true ? String(a.file) : null;
  if (!file) { console.error('Usage: sprint-report.mjs importance --sprint N --file map.json'); process.exit(2); }
  const map = JSON.parse(fs.readFileSync(file, 'utf8')); const c = loadSprintConfig(n);
  c.features = c.features || {};
  for (const [id, text] of Object.entries(map)) c.features[id] = { ...(c.features[id] || {}), importance: String(text) };
  saveSprintConfig(n, c);
  console.log(`Saved ${Object.keys(map).length} importance line(s) in ${configPath(n)}. Run build to render them.`);
} else if (cmd === 'set') {
  const n = await numberOf(); const id = a.feature && a.feature !== true ? String(a.feature) : null;
  if (!id) { console.error('Usage: sprint-report.mjs set --sprint N --feature "<id>" [--importance ..] [--name ..] [--status ..] [--hide]'); process.exit(2); }
  const c = loadSprintConfig(n); c.features = c.features || {};
  const o = c.features[id] || {};
  if (a.importance && a.importance !== true) o.importance = String(a.importance);
  if (a.name && a.name !== true) o.name = String(a.name);
  if (a.status && a.status !== true) o.status = String(a.status);
  if (a.hide) o.hide = true;
  if (a.top) o.top = true;
  if (a.small) o.top = false; // mark as a smaller item: left out of the report
  c.features[id] = o; saveSprintConfig(n, c);
  console.log(`Updated feature ${id} in ${configPath(n)}. Run build to render it.`);
} else if (cmd === 'add' || cmd === 'exclude') {
  const n = await numberOf(); const c = loadSprintConfig(n);
  const ks = keys(rest);
  if (!ks.length) { console.error(`Usage: sprint-report.mjs ${cmd} --sprint N NGK-1 NGK-2`); process.exit(2); }
  const field = cmd === 'add' ? 'include' : 'exclude';
  c[field] = [...new Set([...(c[field] || []), ...ks])];
  saveSprintConfig(n, c);
  console.log(`${cmd === 'add' ? 'Added' : 'Excluded'} ${ks.join(', ')} for sprint ${n}. Run build to apply.`);
} else if (cmd === 'group') {
  const n = await numberOf(); const c = loadSprintConfig(n);
  const name = a.name && a.name !== true ? String(a.name) : null; const tickets = a.tickets && a.tickets !== true ? keys(String(a.tickets).split(',').map((s) => s.trim())) : [];
  if (!name || !tickets.length) { console.error('Usage: sprint-report.mjs group --sprint N --name "<feature>" --tickets NGK-1,NGK-2 [--tenant X] [--importance ".."]'); process.exit(2); }
  c.customFeatures = (c.customFeatures || []).filter((f) => f.name !== name);
  c.customFeatures.push({ name, tenant: a.tenant && a.tenant !== true ? String(a.tenant).toUpperCase() : undefined, tickets });
  if (a.importance && a.importance !== true) { c.features = c.features || {}; c.features[`${a.tenant ? String(a.tenant).toUpperCase() : '?'}|C|${tickets[0]}`] = { importance: String(a.importance) }; }
  saveSprintConfig(n, c);
  console.log(`Custom feature "${name}" saved for sprint ${n}. Run build to apply.`);
} else if (cmd === 'due') {
  const r = isDue(T);
  console.log(r.due ? `Today (${T}) is a sprint report day.` : `Not a sprint report day. Next: ${r.nextDue} (every 14 days from ${r.anchor}).`);
  process.exit(r.due ? 0 : 3);
} else {
  console.error('Commands: build | show | list | sprints | features | importance | set | add | exclude | group | due  (see the header of sprint-report.mjs)');
  process.exit(2);
}
