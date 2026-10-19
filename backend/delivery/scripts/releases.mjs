#!/usr/bin/env node
// Query the release ledger (releases/ledger.json). No network, no Jira: it only reads what releases-sync / daily have recorded.
// Examples:
//   node releases.mjs --tenant BK-ES --since 7d                     what was released for BK-ES in the last week
//   node releases.mjs --since 2026-10-01 --until 2026-10-10 --status released
//   node releases.mjs --ticket NGK-102738                           which release carried this ticket
//   node releases.mjs --component FE --version FE --since 14d       FE releases and their FE versions (shown in the Components column)
//   node releases.mjs --text "loyalty" --since 30d --format full    full detail for matches
//   node releases.mjs --stats                                       what the ledger covers (dates, tenants, counts)
// Options: --tenant A,B  --since 7d|2w|1m|YYYY-MM-DD (default 7d)  --until YYYY-MM-DD  --on YYYY-MM-DD
//          --status released|open  --component X  --ticket NGK-1  --version NAME  --text WORD
//          --format table|full|json|html (default table; html writes .cache/releases.html)  --group tenant|date  --stats
import { parseArgs, md, jiraUrl, today, JIRA_HOST, CACHE_DIR } from '../lib/jira.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { loadLedger, componentList, componentText, explainRelease, groupReleases } from '../lib/releases.mjs';
import { renderReleasesHtml } from '../lib/html.mjs';

const a = parseArgs(process.argv.slice(2));
const ledger = loadLedger();
const all = Object.values(ledger.releases || {});
if (!all.length) { console.error('The release ledger is empty. Run releases-sync.mjs (or daily.mjs --backfill 30) first.'); process.exit(1); }

const T = today();
const shift = (day, n) => { const x = new Date(`${day}T12:00:00`); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const parseDate = (v) => {
  if (!v || v === true) return null;
  const s = String(v).toLowerCase();
  if (s === 'today') return T;
  if (s === 'yesterday') return shift(T, -1);
  const m = s.match(/^(\d+)([dwm])$/);
  if (m) return shift(T, -Number(m[1]) * ({ d: 1, w: 7, m: 30 }[m[2]]));
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

const dates = all.map((r) => r.date).sort();
if (a.stats) {
  const byTenant = {};
  for (const r of all) for (const t of r.tenants) byTenant[t] = (byTenant[t] || 0) + 1;
  console.log(`Ledger: ${all.length} release tickets, dated ${dates[0]} to ${dates[dates.length - 1]} (updated ${ledger.updated}).`);
  console.log(`Released (done): ${all.filter((r) => r.done).length} · not marked released: ${all.filter((r) => !r.done).length} · with ticket list: ${all.filter((r) => r.tickets.some((t) => t.key)).length} · with versions: ${all.filter((r) => r.versions.length).length}`);
  console.log(`Tenants (${Object.keys(byTenant).length}): ${Object.entries(byTenant).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  process.exit(0);
}

let since = parseDate(a.since) || (a.on ? null : shift(T, -7));
let until = parseDate(a.until) || T;
if (a.on) { since = parseDate(a.on); until = since; }
if (since && since < dates[0]) console.error(`Note: the ledger starts at ${dates[0]}; releases before that were not recorded. Run: node releases-sync.mjs --days ${Math.ceil((Date.parse(`${T}T12:00:00`) - Date.parse(`${since}T12:00:00`)) / 86400000) + 2}\n`);

const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const tenants = a.tenant && a.tenant !== true ? String(a.tenant).split(',').map(norm) : null;
const has = (hay, needle) => String(hay || '').toLowerCase().includes(String(needle).toLowerCase());
const match = (r) => {
  if (since && r.date < since) return false;
  if (until && r.date > until) return false;
  if (tenants && !r.tenants.some((t) => tenants.some((x) => norm(t).includes(x)))) return false;
  if (a.status === 'released' && !r.done) return false;
  if (a.status === 'open' && r.done) return false;
  if (a.component && a.component !== true && !has([r.titleComponents, ...r.components, ...r.tickets.map((t) => t.component)].join(' '), a.component)) return false;
  if (a.ticket && a.ticket !== true) { const k = String(a.ticket).toUpperCase().replace(/^(\d+)$/, 'NGK-$1'); if (!r.tickets.some((t) => t.key === k) && !(r.others || []).some((t) => t.key === k) && r.key !== k) return false; }
  if (a.version && a.version !== true && !r.versions.some((v) => has(v.name, a.version))) return false;
  if (a.text && a.text !== true && !has([r.title, r.what, r.notes, ...r.tickets.map((t) => `${t.key} ${t.summary} ${t.notes}`)].join(' '), a.text)) return false;
  return true;
};
const hits = all.filter(match).sort((x, y) => y.date.localeCompare(x.date) || x.tenant.localeCompare(y.tenant) || x.key.localeCompare(y.key));

// UAT/LAB + PROD tickets of one release are merged into one group
const list = groupReleases(hits);
const releasedN = list.filter((g) => g.tickets.every((t) => t.done)).length;

if (a.format === 'html') {
  const filtTxt = [tenants ? `tenant ${a.tenant}` : '', a.status ? `status ${a.status}` : '', a.component ? `component ${a.component}` : '', a.ticket ? `ticket ${a.ticket}` : '', a.version ? `version ${a.version}` : '', a.text ? `text "${a.text}"` : ''].filter(Boolean).join(', ');
  const title = `Releases${tenants ? ' · ' + a.tenant : ''}`;
  const sub = `${since === until ? `on ${since}` : `${since || 'start'} to ${until}`}${filtTxt ? ` · ${filtTxt}` : ''}`;
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const out = path.join(CACHE_DIR, 'releases.html');
  fs.writeFileSync(out, renderReleasesHtml({ title, subtitle: sub, groups: list.map((g) => ({ ...g, items: g.items })), jiraBase: JIRA_HOST, generatedAt: new Date().toLocaleString('en-US') }));
  console.log(`${list.length} releases written to ${out}\nOpen: http://127.0.0.1:8791/releases.html (serve with: node scripts/serve.mjs)`);
  process.exit(0);
}
if (a.format === 'json') { console.log(JSON.stringify(list, null, 2)); process.exit(0); }

const filt = [tenants ? `tenant ${a.tenant}` : '', a.status ? `status ${a.status}` : '', a.component ? `component ${a.component}` : '', a.ticket ? `ticket ${a.ticket}` : '', a.version ? `version ${a.version}` : '', a.text ? `text "${a.text}"` : ''].filter(Boolean).join(', ');
console.log(`# Releases ${since === until ? `on ${since}` : `from ${since || 'the start'} to ${until}`}${filt ? ` · ${filt}` : ''}\n`);
console.log(`${list.length} releases (${releasedN} fully released, ${list.length - releasedN} not marked released). Status = Jira status of the release ticket; it can lag the real deployment.\n`);
if (!list.length) process.exit(0);

const tix = (g) => g.tickets.map((t) => `[${t.key}](${jiraUrl(t.key)})${t.env ? ' ' + t.env : ''} ${t.done ? '✓' : '⚠'} ${t.status}`).join('; ');
const comps = (g) => componentText(componentList(g)) || '-';
const nKeys = (g) => g.items.filter((i) => i.key).length;

const render = (gs) => {
  if (a.format === 'full') {
    for (const g of gs) {
      console.log(`## ${g.date} · ${g.tenant} · ${g.what}`);
      console.log(`- Release tickets: ${tix(g)}`);
      console.log(`- Components: ${comps(g)}`);
      console.log(`- What: ${explainRelease(g)}`);
      if (g.owner) console.log(`- Owner: ${g.owner}`);
      if (g.notes) console.log(`- Notes: ${g.notes}`);
      console.log(`- Tickets (${nKeys(g)}):`);
      for (const i of g.items) console.log(`  - ${i.key || i.label}${i.summary ? ` — ${i.summary}` : ''}${i.status ? ` [${i.status}]` : ''}${i.component ? ` · ${i.component}` : ''}${i.version ? ` · ${i.version}` : ''}`);
      console.log('');
    }
  } else {
    console.log(md(gs.map((g) => [g.date, g.tenant, tix(g), `${g.what}. ${explainRelease(g)}`, comps(g), nKeys(g) ? `${nKeys(g)}: ${g.items.filter((i) => i.key).slice(0, 5).map((i) => i.key.replace('NGK-', '')).join(', ')}${nKeys(g) > 5 ? ', …' : ''}` : '-']), ['Date', 'Tenant', 'Release ticket', 'What was released', 'Components (version)', 'Tickets']));
    console.log('');
  }
};

if (a.group === 'tenant') {
  for (const t of [...new Set(list.map((g) => g.tenant))].sort()) { console.log(`### ${t}\n`); render(list.filter((g) => g.tenant === t)); }
} else if (a.group === 'date') {
  for (const d of [...new Set(list.map((g) => g.date))]) { console.log(`### ${d}\n`); render(list.filter((g) => g.date === d)); }
} else render(list);
