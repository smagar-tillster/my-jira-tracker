#!/usr/bin/env node
// "What changed in the last few days": merged PRs (with their change understanding) and releases, from the local ledgers.
// No network. PRs come from prs/ledger.json (recorded by every daily run), releases from releases/ledger.json.
// Examples:
//   node changes.mjs --since 3d                         everything that merged or was released in the last 3 days
//   node changes.mjs --since 1w --tenant BK-DE          one tenant
//   node changes.mjs --since 5d --repo kiosk-menu-service --what prs
//   node changes.mjs --ticket NGK-102178 --since 30d    follow one ticket across PRs and releases
//   node changes.mjs --text "packaging" --since 2w --format full
// Options: --since 3d|2w|1m|YYYY-MM-DD (default 3d)  --until YYYY-MM-DD  --tenant X  --repo X  --ticket NGK-1  --text WORD
//          --what all|prs|releases  --format table|full|json
import { parseArgs, md, jiraUrl, today } from '../lib/jira.mjs';
import { loadPrLedger, inferTenants } from '../lib/prledger.mjs';
import { loadLedger, groupReleases, componentList, componentText, explainRelease } from '../lib/releases.mjs';

const a = parseArgs(process.argv.slice(2));
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
const since = parseDate(a.since) || shift(T, -3);
const until = parseDate(a.until) || T;
const what = String(a.what || 'all');
const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const has = (hay, needle) => String(hay || '').toLowerCase().includes(String(needle).toLowerCase());
const tenantQ = a.tenant && a.tenant !== true ? String(a.tenant).split(',').map(norm) : null;
const ticketQ = a.ticket && a.ticket !== true ? String(a.ticket).toUpperCase().replace(/^(\d+)$/, 'NGK-$1') : null;
const textQ = a.text && a.text !== true ? String(a.text) : null;
const tenantOk = (list) => !tenantQ || (list || []).some((t) => tenantQ.some((x) => norm(t).includes(x)));

// ---- PRs
const prLedger = loadPrLedger();
const allPrs = Object.values(prLedger.prs || {});
const knownTenants = [...new Set(Object.values(loadLedger().releases || {}).flatMap((x) => x.tenants))];
for (const r of allPrs) if (!(r.tenants || []).length) r.tenants = inferTenants(r, knownTenants); // ticket without a Client: use a tenant code in the title/summary
const prs = allPrs.filter((r) => {
  const d = String(r.mergedAt).slice(0, 10);
  if (d < since || d > until) return false;
  if (!tenantOk(r.tenants)) return false;
  if (a.repo && a.repo !== true && !has(r.repo, a.repo)) return false;
  if (ticketQ && !r.keys.includes(ticketQ)) return false;
  if (textQ && !has([r.title, r.line1, r.line2, r.analysis?.summary, ...(r.tickets || []).map((t) => t.summary)].join(' '), textQ)) return false;
  return true;
}).sort((x, y) => String(y.mergedAt).localeCompare(String(x.mergedAt)));

// ---- releases
const relLedger = loadLedger();
const allRels = Object.values(relLedger.releases || {});
const relHits = allRels.filter((r) => {
  if (r.date < since || r.date > until) return false;
  if (!tenantOk(r.tenants)) return false;
  if (a.repo && a.repo !== true) return false; // repo filter only makes sense for PRs
  if (ticketQ && !r.tickets.some((t) => t.key === ticketQ) && !(r.others || []).some((t) => t.key === ticketQ) && r.key !== ticketQ) return false;
  if (textQ && !has([r.title, r.what, r.notes, ...r.tickets.map((t) => `${t.key} ${t.summary}`)].join(' '), textQ)) return false;
  return true;
}).sort((x, y) => y.date.localeCompare(x.date) || x.tenant.localeCompare(y.tenant));
const rels = groupReleases(relHits).sort((x, y) => y.date.localeCompare(x.date) || x.tenant.localeCompare(y.tenant));

if (a.format === 'json') { console.log(JSON.stringify({ since, until, prs: what === 'releases' ? [] : prs, releases: what === 'prs' ? [] : rels }, null, 2)); process.exit(0); }

const prDates = allPrs.map((r) => String(r.mergedAt).slice(0, 10)).sort();
const filt = [tenantQ ? `tenant ${a.tenant}` : '', a.repo ? `repo ${a.repo}` : '', ticketQ ? `ticket ${ticketQ}` : '', textQ ? `text "${textQ}"` : ''].filter(Boolean).join(', ');
console.log(`# Changes from ${since} to ${until}${filt ? ` · ${filt}` : ''}\n`);
if (prDates.length && since < prDates[0] && what !== 'releases') console.log(`Note: the PR ledger starts at ${prDates[0]}; earlier merges were not recorded. Catch up with: node daily.mjs --since ${since} --no-save\n`);

const trunc = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1).trimEnd() + '…' : String(s));
if (what !== 'releases') {
  const analyzed = prs.filter((r) => r.analysis).length;
  console.log(`## Merged PRs (${prs.length}, ${analyzed} with change understanding)\n`);
  if (!prs.length) console.log('None recorded in this span.\n');
  else if (a.format === 'full') {
    for (const r of prs) {
      console.log(`### ${r.repo}#${r.number} · ${r.line1} (${String(r.mergedAt).slice(0, 10)}${(r.tenants || []).length ? ' · ' + r.tenants.join(', ') : ''})`);
      console.log(`- Tickets: ${r.keys.join(', ') || '-'} · ${r.author} · ${r.url}`);
      if (r.analysis) { console.log(`- Risk (AI-assisted): ${r.analysis.risk}`); console.log(`- Understanding: ${r.analysis.summary}`); for (const c of r.analysis.confirm || []) console.log(`  - confirm: ${c}`); }
      else console.log('- Understanding: not analyzed yet');
      if ((r.bumps || []).length) console.log(`- Version bumps: ${r.bumps.map((b) => `${b.name} ${b.from ?? 'new'}→${b.to ?? 'removed'}`).join('; ')}`);
      console.log('');
    }
  } else {
    console.log(md(prs.map((r) => [String(r.mergedAt).slice(0, 10), `${r.repo}#${r.number}`, r.keys.join(', ') || '-', (r.tenants || []).join(', ') || '-', trunc(r.line1, 70), r.analysis ? trunc(r.analysis.summary, 170) : 'not analyzed yet', r.analysis?.risk || '-']), ['Merged', 'PR', 'Ticket', 'Tenants', 'What it builds', 'Understanding (AI-assisted)', 'Risk']));
    console.log('');
  }
}
if (what !== 'prs') {
  console.log(`## Releases (${rels.length}, ${rels.filter((g) => g.tickets.every((t) => t.done)).length} fully released)\n`);
  if (!rels.length) console.log('None recorded in this span.\n');
  else console.log(md(rels.map((g) => [g.date, g.tenant, g.tickets.map((t) => `[${t.key}](${jiraUrl(t.key)})${t.env ? ' ' + t.env : ''} ${t.done ? '✓' : '⚠'} ${t.status}`).join('; '), `${g.what}. ${trunc(explainRelease(g), 230)}`, componentText(componentList(g)) || '-']), ['Date', 'Tenant', 'Release ticket', 'What was released', 'Components (version)']));
  console.log('\nRelease status = Jira status of the release ticket; it can lag the real deployment.');
}
