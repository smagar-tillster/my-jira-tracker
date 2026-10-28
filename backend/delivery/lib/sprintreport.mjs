// Sprint report for project and product management: ticket stats, and the key features of the sprint by tenant with completion status
// and a one-line importance. Stored per sprint as a data source (sprint-<n>.json) with a markdown report, and configurable per sprint
// (sprint-<n>.config.json: add or exclude tickets, rename or regroup features, write importance lines, override status).
// Facts come from Jira by rules; the importance lines are written by AI on request and kept in the config so they survive rebuilds.
import fs from 'node:fs';
import path from 'node:path';
import { search, mapIssue, SEARCH_FIELDS, jiraAgile, jiraUrl, today, PROJECT } from './jira.mjs';
import { CONFIG_FILE } from './paths.mjs';
import { REPORTS_ROOT } from './focus.mjs';
import { pretty, addDays } from './weeks.mjs';

export const SPRINTS_DIR = path.join(REPORTS_ROOT, 'sprints');
const cfg = () => { try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; } };

// ---------------------------------------------------------------- finding sprints
export const listSprints = async () => {
  const prefix = String(cfg().sprintPrefix || '').toLowerCase();
  const boards = (await jiraAgile('GET', `/board?projectKeyOrId=${PROJECT}&maxResults=50`)).values || [];
  const byId = new Map();
  for (const b of boards) {
    let start = 0;
    for (;;) {
      let r;
      try { r = await jiraAgile('GET', `/board/${b.id}/sprint?state=active,closed,future&startAt=${start}&maxResults=50`); } catch { break; } // kanban boards have no sprints
      for (const s of r.values || []) byId.set(s.id, s);
      if (r.isLast || !(r.values || []).length) break;
      start += r.values.length;
    }
  }
  return [...byId.values()].filter((s) => s.name.toLowerCase().startsWith(prefix)).sort((x, y) => String(x.startDate || '').localeCompare(String(y.startDate || '')));
};

/** "current" | "last" | "227" | part of a name */
export const resolveSprint = async (q) => {
  const all = await listSprints();
  const s = String(q || 'current').toLowerCase();
  let hit;
  if (s === 'current') hit = all.filter((x) => x.state === 'active').pop();
  else if (s === 'last') hit = all.filter((x) => x.state === 'closed').pop();
  else if (/^\d+$/.test(s)) hit = all.find((x) => new RegExp(`sprint\\s*${s}\\b`, 'i').test(x.name));
  else hit = all.find((x) => x.name.toLowerCase().includes(s));
  if (!hit) throw new Error(`no sprint matches "${q}" (known: ${all.slice(-4).map((x) => x.name).join(' | ')})`);
  return { id: hit.id, name: hit.name, state: hit.state, start: String(hit.startDate || '').slice(0, 10), end: String(hit.endDate || '').slice(0, 10), complete: String(hit.completeDate || '').slice(0, 10), goal: hit.goal || '' };
};
export const sprintNumber = (s) => (s.name.match(/sprint\s*(\d+)/i) || [])[1] || String(s.id);

// ---------------------------------------------------------------- per-sprint config
export const configPath = (n) => path.join(SPRINTS_DIR, `sprint-${n}.config.json`);
export const dataPath = (n, ext) => path.join(SPRINTS_DIR, `sprint-${n}.${ext}`);
// Types left out of the stats by default: the standing exclusions plus process/test noise that would inflate completion. Add any back in the config.
export const DEFAULT_CONFIG = {
  include: [], exclude: [],
  types: ['Story', 'Feature Change Request', 'Product Assistance Request'], // only these count; add e.g. 'New Sub-Brand Request', 'Epic', 'Defect' to widen
  workedOnly: true, // only tickets worked in the sprint window (status change, resolved or created in it)
  excludeTypes: [],
  featureTypes: ['Story', 'Feature Change Request'], // "top stories" come from these types (Product Assistance Requests count in the stats only); null = every counted type
  maxFeaturesPerTenant: 5, maxTenantsInTable: 15, minTenantTickets: 5, features: {}, customFeatures: [], notes: [],
};
export const loadSprintConfig = (n) => { try { return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(configPath(n), 'utf8')) }; } catch { return { ...DEFAULT_CONFIG }; } };
// Only overrides are stored (plus the editable lists), so a change of defaults later still applies to every sprint.
const ALWAYS = new Set(['include', 'exclude', 'features', 'customFeatures', 'notes']);
export const saveSprintConfig = (n, c) => {
  const out = {};
  for (const k of Object.keys(c)) if (ALWAYS.has(k) || JSON.stringify(c[k]) !== JSON.stringify(DEFAULT_CONFIG[k])) out[k] = c[k];
  fs.mkdirSync(SPRINTS_DIR, { recursive: true });
  fs.writeFileSync(configPath(n), JSON.stringify(out, null, 2));
};

// ---------------------------------------------------------------- classification
const bucketOf = (t) => {
  if (t.statusCategory === 'Done') return 'Done';
  if (t.status === 'Ready for QA') return 'Ready for QA';
  if (/blocked|waiting|clarification/i.test(t.status)) return 'Blocked / waiting';
  if (/returned by qa/i.test(t.status)) return 'Returned by QA';
  if (/to do|backlog|triage|open|ready to build/i.test(t.status)) return 'Not started';
  return 'In progress';
};
export const BUCKETS = ['Done', 'Ready for QA', 'In progress', 'Returned by QA', 'Blocked / waiting', 'Not started'];
const isDoneBucket = (b) => b === 'Done' || b === 'Ready for QA';
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);

const tenantOf = (t) => t.clients[0] || '(no client)';
const TYPE_WEIGHT = { Epic: 3, Story: 3, 'Feature Change Request': 3, 'Product Assistance Request': 2, Spike: 2, Task: 2, Defect: 1 };

/**
 * Tickets of the sprint that count: only the chosen types (default Story, Feature Change Request, Product Assistance Request) and, with
 * workedOnly (default), only tickets that were actually worked in the sprint window: a status change, a resolution or creation inside it.
 * A ticket that merely sits in the sprint (old carry-over, done long ago, untouched) is left out. `include` / `exclude` in the config override.
 */
export const fetchSprintTickets = async (sprint, conf, T = today()) => {
  const start = sprint.start || addDays(T, -14);
  const endExcl = addDays(sprint.state === 'closed' && sprint.complete ? sprint.complete : (sprint.state === 'active' ? T : sprint.end || T), 1); // JQL DURING ends at 00:00 of the date, so add a day
  const types = (conf.types || DEFAULT_CONFIG.types).map((x) => `"${x}"`).join(', ');
  const worked = conf.workedOnly === false ? '' : ` AND (status CHANGED DURING ("${start}", "${endExcl}") OR resolved >= "${start}" OR created >= "${start}")`;
  const fields = [...SEARCH_FIELDS, 'resolutiondate'];
  const raw = await search(`project = ${PROJECT} AND sprint = ${sprint.id} AND issuetype in (${types})${worked} ORDER BY key ASC`, fields);
  const extra = (conf.include || []).length ? await search(`key in (${conf.include.join(',')})`, fields) : [];
  const excluded = new Set((conf.excludeTypes || []).map((x) => x.toLowerCase()));
  const drop = new Set((conf.exclude || []).map((k) => k.toUpperCase()));
  const seen = new Set();
  return [...raw, ...extra].map((r) => ({ r, t: mapIssue(r) })).filter(({ t }) => {
    if (seen.has(t.key)) return false; seen.add(t.key);
    return !drop.has(t.key) && (!excluded.has(t.type.toLowerCase()) || (conf.include || []).includes(t.key));
  }).map(({ r, t }) => ({
    key: t.key, summary: t.summary, type: t.type, status: t.status, statusCategory: t.statusCategory, bucket: bucketOf(t), tenant: tenantOf(t), clients: t.clients, components: t.components,
    assignee: t.assignee || '', due: t.due, uat: t.uat, release: t.release, parentKey: t.parentKey, created: t.created, sprintsCount: t.sprints.length,
    resolved: r.fields.resolutiondate ? String(r.fields.resolutiondate).slice(0, 10) : null, starred: false,
  }));
};

// ---------------------------------------------------------------- stats
const countBy = (rows, f) => rows.reduce((m, r) => { const k = f(r); m[k] = (m[k] || 0) + 1; return m; }, {});
export const computeStats = (rows, sprint, T) => {
  const total = rows.length;
  const done = rows.filter((r) => isDoneBucket(r.bucket)).length;
  const byBucket = BUCKETS.map((b) => ({ name: b, n: rows.filter((r) => r.bucket === b).length }));
  const byType = Object.entries(countBy(rows, (r) => r.type)).map(([name, n]) => ({ name, n, done: rows.filter((r) => r.type === name && isDoneBucket(r.bucket)).length })).sort((x, y) => y.n - x.n);
  const tenants = Object.entries(countBy(rows, (r) => r.tenant)).map(([name, n]) => ({ name, n, done: rows.filter((r) => r.tenant === name && isDoneBucket(r.bucket)).length, blocked: rows.filter((r) => r.tenant === name && r.bucket === 'Blocked / waiting').length })).sort((x, y) => y.n - x.n);
  const overdue = rows.filter((r) => !isDoneBucket(r.bucket) && r.due && r.due < T).length;
  const carried = rows.filter((r) => r.sprintsCount >= 3 && !isDoneBucket(r.bucket)).length;
  const createdDuring = sprint.start ? rows.filter((r) => r.created >= sprint.start).length : 0;
  const defects = rows.filter((r) => r.type === 'Defect').length;
  return { total, done, completionPct: pct(done, total), byBucket, byType, tenants, overdue, carried, createdDuring, defects, doneStrict: rows.filter((r) => r.bucket === 'Done').length };
};

// ---------------------------------------------------------------- features
/** Auto features: tickets sharing a parent form one feature; everything else is its own. Ranked by importance signals. */
export const deriveFeatures = (allRows, parents, conf) => {
  const ft = conf.featureTypes ? new Set(conf.featureTypes.map((x) => x.toLowerCase())) : null;
  const rows = ft ? allRows.filter((r) => ft.has(r.type.toLowerCase()) || (conf.include || []).includes(r.key)) : allRows;
  const groups = new Map();
  for (const r of rows) {
    const gk = r.parentKey && parents[r.parentKey] ? `${r.tenant}|P|${r.parentKey}` : `${r.tenant}|T|${r.key}`;
    if (!groups.has(gk)) groups.set(gk, { id: gk, tenant: r.tenant, name: r.parentKey && parents[r.parentKey] ? parents[r.parentKey] : r.summary, parent: r.parentKey && parents[r.parentKey] ? r.parentKey : null, tickets: [] });
    groups.get(gk).tickets.push(r.key);
  }
  const byKey = new Map(rows.map((r) => [r.key, r]));
  let feats = [...groups.values()];
  // user overrides and custom features
  const taken = new Set();
  for (const c of conf.customFeatures || []) {
    const ks = (c.tickets || []).map((k) => k.toUpperCase()).filter((k) => byKey.has(k));
    if (!ks.length) continue;
    ks.forEach((k) => taken.add(k));
    feats.push({ id: c.id || `${c.tenant || byKey.get(ks[0]).tenant}|C|${ks[0]}`, tenant: c.tenant || byKey.get(ks[0]).tenant, name: c.name, parent: null, tickets: ks, custom: true });
  }
  feats = feats.map((f) => (f.custom ? f : { ...f, tickets: f.tickets.filter((k) => !taken.has(k)) })).filter((f) => f.tickets.length);
  return feats.map((f) => {
    const o = (conf.features || {})[f.id] || {};
    const ts = f.tickets.map((k) => byKey.get(k));
    const done = ts.filter((r) => isDoneBucket(r.bucket)).length;
    const blocked = ts.filter((r) => r.bucket === 'Blocked / waiting').length;
    const status = o.status || (done === ts.length ? 'Done' : blocked ? 'At risk' : done > 0 || ts.some((r) => r.bucket === 'In progress') ? 'In progress' : 'Not started');
    const score = ts.reduce((n, r) => n + (r.starred ? 4 : 0) + (TYPE_WEIGHT[r.type] || 1) + (r.uat || r.release ? 1 : 0), 0) + Math.min(ts.length, 5);
    // "top" = not a smaller item: under an epic, 3+ tickets, starred, or with a UAT date (a user override in the config wins)
    const top = o.top !== undefined ? !!o.top : !!(f.parent || ts.length >= 3 || ts.some((r) => r.starred) || ts.some((r) => r.uat) || f.custom);
    return { id: f.id, tenant: f.tenant, name: o.name || f.name, parent: f.parent, tickets: f.tickets, done, total: ts.length, status, importance: o.importance || null, hide: !!o.hide, top, score };
  }).filter((f) => !f.hide).sort((x, y) => y.score - x.score);
};

const bar = (n, d, w = 20) => { const f = d ? Math.round((n / d) * w) : 0; return '█'.repeat(f) + '░'.repeat(w - f); };
const L = (key) => `[${key}](${jiraUrl(key)})`;
const cell = (s) => String(s).replace(/\|/g, '/');
const ICON = { Done: '✅', 'In progress': '🔄', 'At risk': '⚠️', 'Not started': '⏳' };

/** The simple report: overall stats, then the top stories by tenant with status. Smaller items are left out. */
export const renderReport = (d) => {
  const s = d.stats; const sp = d.sprint;
  const nb = (name) => s.byBucket.find((b) => b.name === name)?.n || 0;
  const completed = s.done; const blocked = nb('Blocked / waiting'); const inProg = nb('In progress') + nb('Returned by QA'); const notStarted = nb('Not started');
  const row = (label, n) => `| ${label} | ${n} | \`${bar(n, s.total, 20)}\` ${pct(n, s.total)}% |`;
  const out = [`# Sprint report — ${sp.name}`, '', `${pretty(sp.start)} – ${pretty(sp.end)} · ${sp.state}${sp.state === 'active' ? ` · as of ${pretty(d.asOf)}` : ''}${sp.goal ? ` · Goal: ${sp.goal}` : ''}`, '',
    '## Overall', '', '| | Tickets | Share |', '|---|---|---|', `| **Tickets in sprint** | **${s.total}** | |`, row('Completed (Done or Ready for QA)', completed), row('In progress', inProg), row('Blocked / waiting', blocked),
    ...(notStarted ? [row('Not started', notStarted)] : []), '', `Counted: ${(d.config.types || []).join(', ')}${d.config.workedOnly ? ', worked during the sprint' : ''}.`, ''];

  const tops = d.features.filter((f) => f.top);
  const byT = new Map();
  for (const f of tops) { if (!byT.has(f.tenant)) byT.set(f.tenant, []); byT.get(f.tenant).push(f); }
  const NOC = '(no client)';
  const order = [...s.tenants.filter((t) => t.name !== NOC), ...s.tenants.filter((t) => t.name === NOC)].filter((t) => byT.has(t.name));
  const max = d.config.maxFeaturesPerTenant || 5; const cap = d.config.maxTenantsInTable || 15;
  const showWhy = tops.some((f) => f.importance);
  out.push('## Top stories by tenant', '');
  for (const t of order.slice(0, cap)) {
    const fs_ = byT.get(t.name).slice(0, max);
    out.push(`### ${t.name} — ${t.n} tickets, ${t.done} done (${pct(t.done, t.n)}%)`, '', `| Story | Status | Done |${showWhy ? ' Why it matters |' : ''}`, `|---|---|---|${showWhy ? '---|' : ''}`,
      ...fs_.map((f) => `| ${cell(f.name.slice(0, 80))} (${f.tickets.slice(0, 3).map(L).join(', ')}${f.tickets.length > 3 ? ` +${f.tickets.length - 3}` : ''}) | ${ICON[f.status] || ''} ${f.status} | ${f.done}/${f.total} |${showWhy ? ` ${f.importance ? cell(f.importance) : ''} |` : ''}`), '');
  }
  if (order.length > cap) out.push(`_${order.length - cap} more tenants have top stories; see the data file._`, '');
  const hidden = d.features.length - tops.length;
  if ((d.config.notes || []).length) out.push('## Notes', '', ...d.config.notes.map((n) => `- ${n}`), '');
  out.push(`_Source: Jira, statuses as of ${d.generatedAt.slice(0, 10)}. Ready for QA counts as done. ${hidden} smaller items are not listed (single tickets with no epic, UAT date or star). Edit \`sprint-${d.number}.config.json\` to add or exclude tickets, mark a feature as top or small, or change the wording._`);
  return out.join('\n');
};

/** The fuller report kept for reference: by type, completion by tenant, every feature. Not used by default. */
export const renderDetailed = (d) => {
  const s = d.stats; const sp = d.sprint;
  const out = [`# Sprint report — ${sp.name}`, '', `${pretty(sp.start)} – ${pretty(sp.end)} · ${sp.state}${sp.state === 'active' ? ` · as of ${pretty(d.asOf)}` : ''}${sp.goal ? ` · Goal: ${sp.goal}` : ''}`, '',
    `${s.total} tickets worked in this sprint (${(d.config.types || []).join(' / ')}).`, ''];
  out.push(`## At a glance`, '', `**${s.completionPct}% complete** (${s.done} of ${s.total} tickets Done or Ready for QA)`, '', '`' + bar(s.done, s.total, 30) + '`', '');
  out.push('| Status | Tickets | Share |', '|---|---|---|', ...s.byBucket.filter((b) => b.n).map((b) => `| ${b.name} | ${b.n} | \`${bar(b.n, s.total, 16)}\` ${pct(b.n, s.total)}% |`), '');
  out.push(`- **Overdue:** ${s.overdue} open tickets past their due date · **Carried over 3+ sprints:** ${s.carried} not yet ready · **Created during the sprint:** ${s.createdDuring}`, '');
  out.push('## By type', '', '| Type | Tickets | Done / Ready | Complete |', '|---|---|---|---|', ...s.byType.map((t) => `| ${t.name} | ${t.n} | ${t.done} | \`${bar(t.done, t.n, 12)}\` ${pct(t.done, t.n)}% |`), '');
  const NOC = '(no client)';
  const ordered = [...s.tenants.filter((t) => t.name !== NOC), ...s.tenants.filter((t) => t.name === NOC)]; // tenants first, tickets with no client last
  const topN = d.config.maxTenantsInTable || 15;
  const small = ordered.slice(topN);
  out.push('## Completion by tenant', '', '| Tenant | Tickets | Done / Ready | Complete | Blocked / waiting |', '|---|---|---|---|---|',
    ...ordered.slice(0, topN).map((t) => `| ${cell(t.name)} | ${t.n} | ${t.done} | \`${bar(t.done, t.n, 12)}\` ${pct(t.done, t.n)}% | ${t.blocked || '-'} |`));
  if (small.length) { const n = small.reduce((x, t) => x + t.n, 0); const dn = small.reduce((x, t) => x + t.done, 0); out.push(`| _${small.length} smaller tenants_ | ${n} | ${dn} | \`${bar(dn, n, 12)}\` ${pct(dn, n)}% | ${small.reduce((x, t) => x + t.blocked, 0) || '-'} |`); }
  out.push('');
  out.push('## Key features by tenant', '');
  const byT = new Map();
  for (const f of d.features) { if (!byT.has(f.tenant)) byT.set(f.tenant, []); byT.get(f.tenant).push(f); }
  const max = d.config.maxFeaturesPerTenant || 5;
  const minTickets = d.config.minTenantTickets || 5; // tenants with fewer tickets share one section
  const big = ordered.filter((t) => t.n >= minTickets && byT.has(t.name)).map((t) => t.name);
  const featRow = (f) => `| ${cell(f.name.slice(0, 80))} (${f.tickets.slice(0, 3).map(L).join(', ')}${f.tickets.length > 3 ? ` +${f.tickets.length - 3}` : ''}) | ${ICON[f.status] || ''} ${f.status} | ${f.done}/${f.total} | ${f.importance ? cell(f.importance) : '_not written yet_'} |`;
  for (const tn of big) {
    const fs_ = byT.get(tn); const rest = fs_.slice(max);
    out.push(`### ${tn}`, '', '| Feature | Status | Done | Why it matters |', '|---|---|---|---|', ...fs_.slice(0, max).map(featRow));
    if (rest.length) out.push(`| _+${rest.length} smaller items_ | | ${rest.reduce((n, f) => n + f.done, 0)}/${rest.reduce((n, f) => n + f.total, 0)} | |`);
    out.push('');
  }
  const others = ordered.filter((t) => !big.includes(t.name) && byT.has(t.name));
  if (others.length) {
    out.push('### Smaller tenants', '', '| Tenant | Feature | Status | Done | Why it matters |', '|---|---|---|---|---|');
    for (const t of others) for (const f of byT.get(t.name).slice(0, 2)) out.push(`| ${t.name} | ${featRow(f).slice(2)}`);
    out.push('');
  }
  if ((d.config.notes || []).length) out.push('## Notes', '', ...d.config.notes.map((n) => `- ${n}`), '');
  out.push(`_Source: Jira, statuses as of ${d.generatedAt.slice(0, 10)}. Ready for QA counts as done. Counted: ${(d.config.types || []).join(', ')}${d.config.workedOnly ? ', and only tickets worked in the sprint (a status change, a resolution or creation during it)' : ''}. Edit \`sprint-${d.number}.config.json\` to add or exclude tickets, change types, rename features or change the wording._`);
  return out.join('\n');
};

export const buildSprintReport = async ({ query, getFlags, T = today() }) => {
  const sprint = await resolveSprint(query);
  const n = sprintNumber(sprint);
  const conf = loadSprintConfig(n);
  const rows = await fetchSprintTickets(sprint, conf, T);
  const flags = getFlags ? await getFlags() : { keys: [] };
  const star = new Set(flags.keys);
  rows.forEach((r) => { r.starred = star.has(r.key); });
  const parentKeys = [...new Set(rows.map((r) => r.parentKey).filter(Boolean))];
  const parents = {};
  for (let i = 0; i < parentKeys.length; i += 80) for (const r of await search(`key in (${parentKeys.slice(i, i + 80).join(',')})`, ['summary'])) parents[r.key] = r.fields.summary;
  const asOf = sprint.state === 'closed' && sprint.complete ? sprint.complete : T;
  const stats = computeStats(rows, sprint, asOf);
  const features = deriveFeatures(rows, parents, conf);
  const data = { number: n, sprint, asOf, generatedAt: new Date().toISOString(), config: { maxFeaturesPerTenant: conf.maxFeaturesPerTenant || 5, maxTenantsInTable: conf.maxTenantsInTable || 15, minTenantTickets: conf.minTenantTickets || 5, notes: conf.notes || [], types: conf.types, workedOnly: conf.workedOnly !== false }, stats, features, tickets: rows };
  fs.mkdirSync(SPRINTS_DIR, { recursive: true });
  if (!fs.existsSync(configPath(n))) saveSprintConfig(n, conf); // create the editable config on first build
  fs.writeFileSync(dataPath(n, 'json'), JSON.stringify(data, null, 2));
  fs.writeFileSync(dataPath(n, 'md'), renderReport(data));
  return data;
};

/** Biweekly schedule: due on the anchor Friday and every 14 days after (config "sprintReport.anchor"). */
export const isDue = (T = today(), anchor = cfg().sprintReport?.anchor || '2026-10-30') => {
  const d = Math.round((Date.parse(`${T}T12:00:00`) - Date.parse(`${anchor}T12:00:00`)) / 86400000);
  return { due: d >= 0 && d % 14 === 0, anchor, nextDue: d < 0 ? anchor : addDays(anchor, Math.ceil(d / 14) * 14 + (d % 14 === 0 ? 14 : 0)) };
};
